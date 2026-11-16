// Runs before every test file. config.ts reads these at import time.
process.env.NODE_ENV = 'test';
process.env.NETWORK = 'eip155:421614';
// Throwaway key (private key 0x01…01); never funded, never used onchain in tests
process.env.FACILITATOR_PRIVATE_KEY = '0x0101010101010101010101010101010101010101010101010101010101010101';
// Empty rather than deleted: dotenv never overwrites a key that is already present, so a
// developer's local .env cannot leak a database or discovery settings into the suite
process.env.DATABASE_URL = '';
process.env.ADMIN_API_KEY_HASH = '';
process.env.DISCOVERY_ALLOW_PRIVATE_RESOURCE_URLS = '';
// Discovery is off by default; suites that exercise it opt in before importing the server
process.env.DISCOVERY_ENABLED = '';
