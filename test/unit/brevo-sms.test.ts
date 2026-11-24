import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrevoSmsProvider, createSmsProvider } from '../../src/services/sms.js';
import { loadConfig } from '../../src/config.js';

test('Brevo SMS: posts to the transactional SMS API with the key, an 11-character sender and the number without +', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  try {
    await new BrevoSmsProvider('key-123', 'TabeebyClinics').send('+201012345678', 'Code 123456');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls[0]!.url, 'https://api.brevo.com/v3/transactionalSMS/send');
  assert.equal((calls[0]!.init.headers as Record<string, string>)['api-key'], 'key-123');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { sender: 'TabeebyClin', recipient: '201012345678', content: 'Code 123456', type: 'transactional' });
});

test('Brevo SMS: a failed send is an error (so the message is retried), and the provider is picked from config', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
  try {
    await assert.rejects(new BrevoSmsProvider('k', 'Tabeeby').send('+201012345678', 'x'), /responded 401/);
  } finally {
    globalThis.fetch = realFetch;
  }
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x@localhost/x', SMS_PROVIDER: 'brevo', BREVO_API_KEY: 'k' });
  assert.ok(createSmsProvider(cfg) instanceof BrevoSmsProvider);
});
