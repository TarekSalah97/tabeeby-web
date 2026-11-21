import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

const base = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;

test('a wrong DATABASE_URL is refused with a clear message that never repeats the value', () => {
  const secret = 'Set up this app on Neon secretpassword123 npm i -g neon@latest';
  assert.throws(
    () => loadConfig({ ...base, DATABASE_URL: secret }),
    (e: Error) => /DATABASE_URL: must be the database connection string/.test(e.message) && !e.message.includes('secretpassword123'),
  );
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://u:p@host/db extra words' }));
  assert.equal(loadConfig({ ...base, DATABASE_URL: ' postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require ' }).DATABASE_URL.startsWith('postgresql://'), true);
});
