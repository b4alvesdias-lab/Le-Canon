const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  webServer: {
    command: 'node tests/static-server.js',
    url: 'http://127.0.0.1:4173/v9.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
