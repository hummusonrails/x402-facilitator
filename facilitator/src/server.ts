import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { Address } from 'viem';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { config, FACILITATOR_ADDRESS, PORT, BODY_SIZE_LIMIT, RECOVERY_INTERVAL_MS } from './config.js';
import { publicClient } from './clients.js';
import { parseFacilitatorRequest } from './x402.js';
import { verifyPayment } from './verify.js';
import { settlePayment } from './settle.js';
import { generateRequirements } from './requirements.js';
import { getHealth } from './health.js';
import { createLogger, generateCorrelationId } from './logging.js';
import { runStartupValidations } from './startup.js';
import { startRecoveryWorker } from './recovery.js';
import { isDatabaseConfigured } from './db.js';
import { getAllMerchants } from './merchantStore.js';
import { authenticateMerchant, authenticateAdmin, AuthenticatedRequest } from './auth.js';
import { executeRefund } from './refund.js';
import * as Errors from './errors.js';
import type { SupportedKind, SupportedResponse, RequirementsRequest, PaymentRequired } from './types.js';

const app = express();

app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.static('public'));

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

const facilitatorAddress = FACILITATOR_ADDRESS;

console.log('='.repeat(60));
console.log('X402 Facilitator for Arbitrum');
console.log('='.repeat(60));
console.log(`Network:            ${config.network}`);
console.log(`Chain ID:           ${config.chainId}`);
console.log(`USDC Address:       ${config.usdcAddress}`);
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

app.get('/', (req: Request, res: Response) => {
  const facilitatorUrl = process.env.FACILITATOR_URL || `http://localhost:${PORT}`;
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X402 Facilitator - Arbitrum</title>
  
  <!-- OG Metadata -->
  <meta property="og:title" content="X402 Facilitator for Arbitrum">
  <meta property="og:description" content="X402 payment facilitator for Arbitrum networks. Supports gasless USDC transfers with EIP-3009.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${facilitatorUrl}">
  <meta property="og:image" content="${facilitatorUrl}/og-image.png">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="X402 Facilitator for Arbitrum">
  <meta name="twitter:description" content="X402 payment facilitator for Arbitrum networks.">
  <meta name="twitter:image" content="${facilitatorUrl}/og-image.png">
  
  <!-- Favicon -->
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      max-width: 800px; 
      margin: 50px auto; 
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #2563eb; }
    .endpoint { 
      background: #f3f4f6; 
      padding: 10px; 
      margin: 10px 0; 
      border-radius: 5px;
      font-family: monospace;
    }
    .network { color: #059669; font-weight: bold; }
  </style>
</head>
<body>
  <h1>X402 Facilitator for Arbitrum</h1>
  <p>Production-ready payment settlement service supporting the X402 protocol.</p>
  <p>Caution: This is an unvetted service. Use at your own risk.</p>
  
  <h2>Configuration</h2>
  <ul>
    <li><strong>Network:</strong> <span class="network">${config.network}</span></li>
    <li><strong>Chain ID:</strong> ${config.chainId}</li>
    <li><strong>USDC Address:</strong> <code>${config.usdcAddress}</code></li>
    <li><strong>Facilitator Address:</strong> <code>${facilitatorAddress}</code></li>
  </ul>
  
  <h2>API Endpoints</h2>
  <div class="endpoint">GET /health</div>
  <div class="endpoint">GET /supported</div>
  <div class="endpoint">GET /requirements</div>
  <div class="endpoint">POST /requirements</div>
  <div class="endpoint">POST /verify</div>
  <div class="endpoint">POST /settle</div>
  
  <h2>Documentation</h2>
  <p>For integration details, visit the <a href="https://github.com/hummusonrails/x402-facilitator" target="_blank">X402 Arbitrum Facilitator Documentation</a>.</p>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.get('/health', (req: Request, res: Response) => {
  const health = getHealth();
  res.json(health);
});

app.get('/supported', (req: Request, res: Response) => {
  const logger = (req as any).logger;
  logger.info('GET /supported');

  // Each instance settles on exactly one network
  const kinds: SupportedKind[] = [
    { x402Version: 2, scheme: 'exact', network: config.network },
    { x402Version: 1, scheme: 'exact', network: config.legacyNetwork as SupportedKind['network'] },
  ];

  const response: SupportedResponse = {
    kinds,
    extensions: [],
    // Also the required payTo address under the fee split model
    signers: { 'eip155:*': [facilitatorAddress] },
  };
  res.json(response);
});

function sendRequirements(res: Response, requirements: ReturnType<typeof generateRequirements>) {
  if (requirements.x402Version === 2) {
    res.setHeader('PAYMENT-REQUIRED', encodePaymentRequiredHeader(requirements as PaymentRequired));
  }
  res.json(requirements);
}

app.get('/requirements', (req: Request, res: Response) => {
  const logger = (req as any).logger;
  logger.info('GET /requirements');

  const version = req.query.version ? Number(req.query.version) : undefined;
  const amount = typeof req.query.amount === 'string' ? req.query.amount : undefined;
  sendRequirements(res, generateRequirements({ amount, x402Version: Number.isFinite(version) ? version : undefined }));
});

app.post('/requirements', (req: Request, res: Response) => {
  const logger = (req as any).logger;
  logger.info('POST /requirements');

  try {
    const request: RequirementsRequest = req.body || {};
    sendRequirements(res, generateRequirements(request));
  } catch (error: any) {
    logger.error('Requirements generation error', { error: error.message });
    res.status(500).json({
      error: 'Failed to generate requirements',
      message: error.message,
    });
  }
});

app.post('/verify', async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  logger.info('POST /verify');

  const parsed = parseFacilitatorRequest(req.body);
  if (!parsed.ok) {
    logger.warn('Invalid verify request', { reason: parsed.reason, message: parsed.message });
    return res.status(400).json({
      isValid: false,
      invalidReason: parsed.reason,
      invalidMessage: parsed.message,
      ...(parsed.payer && { payer: parsed.payer }),
    });
  }

  try {
    const nonceLogger = logger.child({ nonce: parsed.payment.authorization.nonce });
    const { response } = await verifyPayment(parsed.payment, nonceLogger);
    res.json(response);
  } catch (error: any) {
    logger.error('Verify endpoint error', { error: error.message });
    res.status(500).json({
      isValid: false,
      invalidReason: Errors.ErrUnexpectedVerifyError,
      payer: parsed.payment.authorization.from,
    });
  }
});

app.post('/settle', settleLimiter, authenticateMerchant, async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  const authReq = req as AuthenticatedRequest;
  const merchantAddress = authReq.merchant!.address as Address;
  logger.info('POST /settle', { merchant: merchantAddress });

  const parsed = parseFacilitatorRequest(req.body);
  if (!parsed.ok) {
    logger.warn('Invalid settle request', { reason: parsed.reason, message: parsed.message });
    return res.status(400).json({
      success: false,
      errorReason: parsed.reason,
      errorMessage: parsed.message,
      ...(parsed.payer && { payer: parsed.payer }),
      transaction: '',
      network: parsed.network ?? config.network,
    });
  }

  try {
    const nonceLogger = logger.child({ nonce: parsed.payment.authorization.nonce, merchant: merchantAddress });
    const result = await settlePayment(parsed.payment, merchantAddress, nonceLogger);
    res.json(result);
  } catch (error: any) {
    logger.error('Settle endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      errorReason: Errors.ErrUnexpectedSettleError,
      payer: parsed.payment.authorization.from,
      transaction: '',
      network: config.network,
    });
  }
});

app.get('/admin/wallet', adminLimiter, authenticateAdmin, async (req: Request, res: Response) => {
  const logger = (req as any).logger;
  
  try {
    logger.info('GET /admin/wallet');

    // ERC-20 balanceOf ABI
    const balanceOfAbi = [{
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    }] as const;

    // Fetch both USDC and ETH balances in parallel
    const [usdcBalance, ethBalance] = await Promise.all([
      publicClient.readContract({
        address: config.usdcAddress as Address,
        abi: balanceOfAbi,
        functionName: 'balanceOf',
        args: [facilitatorAddress],
      }),
      publicClient.getBalance({
        address: facilitatorAddress,
      }),
    ]);

    logger.info('Wallet balances retrieved', { 
      address: facilitatorAddress,
      usdcBalance: usdcBalance.toString(),
      ethBalance: ethBalance.toString(),
    });

    res.json({
      balance: usdcBalance.toString(),
      ethBalance: ethBalance.toString(),
      address: facilitatorAddress,
    });
  } catch (error: any) {
    logger.error('Wallet endpoint error', { error: error.message });
    res.status(500).json({
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
      console.log('Public Endpoints:');
      console.log(`  GET  http://localhost:${PORT}/health          - Health check`);
      console.log(`  GET  http://localhost:${PORT}/supported       - Supported payment kinds`);
      console.log(`  GET  http://localhost:${PORT}/requirements    - Get default payment requirements`);
      console.log(`  POST http://localhost:${PORT}/requirements    - Generate payment requirements`);
      console.log(`  POST http://localhost:${PORT}/verify          - Verify payment payload`);
      console.log('');
      console.log('Authenticated Endpoints:');
      console.log(`  POST http://localhost:${PORT}/settle          - Execute payment settlement (merchant)`);
      console.log(`  GET  http://localhost:${PORT}/admin/wallet    - Get facilitator wallet balance (admin)`);
      console.log(`  POST http://localhost:${PORT}/admin/refund    - Execute refund (admin)`);
      console.log('');
    });
  } catch (error: any) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
