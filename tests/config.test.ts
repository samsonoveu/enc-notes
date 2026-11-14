import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.NODE_ENV).toBe('development');
    expect(config.corsAllowAll).toBe(true);
  });

  it('coerces PORT to a number', () => {
    const config = loadConfig({ PORT: '8080' });

    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('splits and trims the CORS origin list', () => {
    const config = loadConfig({ CORS_ORIGIN: 'https://a.test, https://b.test' });

    expect(config.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(config.corsAllowAll).toBe(false);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid environment configuration/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
  });
});
