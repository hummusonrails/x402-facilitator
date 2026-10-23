import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts validates at import time, so each case re-imports it under a fresh environment
const VARS = ['DISCOVERY_SCHEMA_TIMEOUT_MS', 'DISCOVERY_MAX_DECLARATION_BYTES'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of VARS) saved[name] = process.env[name];
  vi.resetModules();
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('discovery config guards', () => {
  it('boots on the defaults', async () => {
    for (const name of VARS) delete process.env[name];
    const config = await import('../src/config.js');
    expect(config.DISCOVERY_SCHEMA_TIMEOUT_MS).toBe(250);
    expect(config.DISCOVERY_MAX_DECLARATION_BYTES).toBe(16384);
  });

  // NaN compares false against everything, so a bare `< 1` guard lets these through
  it.each(['abc', 'NaN', '0', '-5'])('refuses to boot on DISCOVERY_SCHEMA_TIMEOUT_MS=%s', async (value) => {
    process.env.DISCOVERY_SCHEMA_TIMEOUT_MS = value;
    await expect(import('../src/config.js')).rejects.toThrow(/DISCOVERY_SCHEMA_TIMEOUT_MS must be/);
  });

  it.each(['abc', 'NaN', '0', '16'])('refuses to boot on DISCOVERY_MAX_DECLARATION_BYTES=%s', async (value) => {
    process.env.DISCOVERY_MAX_DECLARATION_BYTES = value;
    await expect(import('../src/config.js')).rejects.toThrow(/DISCOVERY_MAX_DECLARATION_BYTES must be/);
  });
});
