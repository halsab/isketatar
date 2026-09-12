import { test as base } from '@playwright/test';
import { artifactServer } from './releases';
export { expect } from '@playwright/test';
// Обрыв HTTP-потока действует и на worker; setOffline в WebKit/Firefox даёт ложные отказы SW.
export const test = base.extend<{ network: Awaited<ReturnType<typeof artifactServer>> }>({
  network: async ({}, use) => { const server = await artifactServer(); try { await use(server); } finally { await server.close(); } },
  baseURL: async ({ network }, use) => { await use(network.url); },
});
