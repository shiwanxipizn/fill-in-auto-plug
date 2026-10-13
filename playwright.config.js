import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test', testMatch: '**/*.spec.js', workers: 1, timeout: 30000, reporter: 'list' });
