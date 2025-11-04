import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { privateKeyToAccount } from 'viem/accounts';
import { config, FACILITATOR_PRIVATE_KEY, PORT, BODY_SIZE_LIMIT, RECOVERY_INTERVAL_MS, allNetworkConfigs, Network } from './config.js';
import { verifyPayment } from './verify.js';
import { settlePayment } from './settle.js';
import { getHealth } from './health.js';
import { createLogger, generateCorrelationId } from './logging.js';
import { runStartupValidations } from './startup.js';
import { startRecoveryWorker } from './recovery.js';
import { isDatabaseConfigured } from './db.js';
import { getAllMerchants } from './merchantStore.js';
import { authenticateMerchant, authenticateAdmin, AuthenticatedRequest } from './auth.js';
import { executeRefund } from './refund.js';
import type {
  VerifyRequest,
  SettleRequest,
  SupportedResponse,
  SupportedPaymentKind,
} from './types.js';
import {
  VerifyRequestSchema,
  SettleRequestSchema,
} from './types.js';

const app = express();

app.use(express.json({ limit: BODY_SIZE_LIMIT }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = generateCorrelationId();
  (req as any).correlationId = correlationId;
  (req as any).logger = createLogger({ correlationId, path: req.path });
  next();
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const settleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many settlement requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many admin requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY);
const facilitatorAddress = facilitatorAccount.address;

console.log('='.repeat(60));
console.log('X402 Facilitator for Arbitrum');
console.log('='.repeat(60));
console.log(`Network:            ${config.network}`);
console.log(`Chain ID:           ${config.chainId}`);
console.log(`USDC Address:       ${config.usdcAddress}`);
console.log(`Facilitator Address: ${facilitatorAddress}`);
console.log(`RPC URL:            ${config.rpcUrl}`);
console.log('='.repeat(60));
console.log('');

if (isDatabaseConfigured()) {
  getAllMerchants().then(merchants => {
    console.log(`Registered Merchants: ${merchants.length}`);
  }).catch(() => {
    console.log('Registered Merchants: Unable to load from database');
  });
} else {
  console.log('Registered Merchants: Database not configured');
}

app.get('/health', (req: Request, res: Response) => {
  const health = getHealth();
  res.json(health);
});

app.get('/supported', (req: Request, res: Response) => {
  const logger = (req as any).logger;
  logger.info('GET /supported');

  const kinds: SupportedPaymentKind[] = [];

  Object.values(allNetworkConfigs).forEach((networkConfig) => {
    kinds.push({
      x402Version: 1,
      scheme: 'exact',
      network: networkConfig.network,
    });
  });

  const response: SupportedResponse = { kinds };
  res.json(response);
});

app.post('/verify', async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  
  try {
    logger.info('POST /verify');

    const validation = VerifyRequestSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn('Invalid request body', { errors: validation.error.errors });
      return res.status(400).json({
        valid: false,
        invalidReason: 'Invalid request format',
        errors: validation.error.errors,
      });
    }

    const request: VerifyRequest = validation.data;
    
    if (!request.paymentRequirements.merchantAddress) {
      logger.warn('Missing merchantAddress in payment requirements');
      return res.status(400).json({
        valid: false,
        invalidReason: 'Missing merchantAddress in payment requirements',
      });
    }
    
    const merchantAddress = request.paymentRequirements.merchantAddress as `0x${string}`;
    
    const nonceLogger = logger.child({ nonce: request.paymentPayload.payload.nonce, merchant: merchantAddress });

    const result = await verifyPayment(request, facilitatorAddress, merchantAddress, nonceLogger);
    
    res.json(result);
  } catch (error: any) {
    logger.error('Verify endpoint error', { error: error.message });
    res.status(500).json({
      valid: false,
      invalidReason: 'Internal server error',
    });
  }
});

app.post('/settle', settleLimiter, authenticateMerchant, async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  const authReq = req as AuthenticatedRequest;
  
  try {
    logger.info('POST /settle', { merchant: authReq.merchant?.address });

    const validation = SettleRequestSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn('Invalid request body', { errors: validation.error.errors });
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: validation.error.errors,
      });
    }

    const request: SettleRequest = validation.data;
    
    const merchantAddress = authReq.merchant!.address as `0x${string}`;
    
    // Add nonce to logger context
    const nonceLogger = logger.child({ nonce: request.paymentPayload.payload.nonce, merchant: merchantAddress });

    const result = await settlePayment(request, merchantAddress, nonceLogger);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Settle endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

app.post('/admin/refund', adminLimiter, authenticateAdmin, async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  
  try {
    logger.info('POST /admin/refund');

    const { nonce, reason } = req.body;

    if (!nonce || !reason) {
      logger.warn('Missing required fields', { nonce, reason });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: nonce and reason',
      });
    }

    const result = await executeRefund(nonce, reason);

    if (result.success) {
      logger.info('Refund executed successfully', { 
        nonce, 
        refundHash: result.refundHash 
      });
      res.json(result);
    } else {
      logger.warn('Refund failed', { nonce, error: result.error });
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error('Refund endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`,
  });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const logger = (req as any).logger || createLogger();
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  
  res.status(500).json({
    error: 'Internal server error',
  });
});

async function startServer() {
  try {
    await runStartupValidations();
    
    // Start recovery worker if database is configured
    if (isDatabaseConfigured()) {
      startRecoveryWorker(RECOVERY_INTERVAL_MS);
      console.log(`Recovery worker started (checking every ${RECOVERY_INTERVAL_MS / 1000}s)`);
    } else {
      console.log('WARNING: Recovery worker disabled (no database configured)');
    }
    
    app.listen(PORT, () => {
      console.log(`X402 Facilitator listening at http://localhost:${PORT}`);
      console.log('');
      console.log('Endpoints:');
      console.log(`  GET  http://localhost:${PORT}/health     - Health check`);
      console.log(`  GET  http://localhost:${PORT}/supported  - Supported payment kinds`);
      console.log(`  POST http://localhost:${PORT}/verify     - Verify payment payload`);
      console.log(`  POST http://localhost:${PORT}/settle     - Execute payment settlement`);
      console.log('');
    });
  } catch (error: any) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
