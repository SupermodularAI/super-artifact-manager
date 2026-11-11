const { defineConfig, devices } = require('@playwright/test');
// PM_E2E_PORT moves both servers (gate on the next port) when 4641/4642 are taken.
const PORT = +process.env.PM_E2E_PORT || 4641;
module.exports = defineConfig({
  testMatch: ['**/*.spec.cjs'],
  timeout: 30_000,
  retries: 0,
  use: { ...devices['Desktop Chrome'], headless: true },
  webServer: [
    { command: 'node bin/serve.js .. --port ' + PORT, port: PORT, reuseExistingServer: false },
    { command: 'node bin/serve.js .. --port ' + (PORT + 1), port: PORT + 1, reuseExistingServer: false,
      env: { PROTO_GATE: 'password', PROTO_SESSION_SECRET: 'e2e-'.repeat(10), PROTO_NAME: 'Expenses',
             PROTO_PASSWORD_HASH: require('crypto').createHash('sha256').update('let me in').digest('hex') } },
  ],
});
