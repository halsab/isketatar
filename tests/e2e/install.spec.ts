import { test, expect } from '@playwright/test';

test('captures an early install event, prompts on click once and distinguishes acceptance from installation', async ({ page }) => {
  await page.goto('./#/'); await expect(page.getByRole('main')).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(window, 'installCalls', 0);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { Reflect.set(window, 'installCalls', Reflect.get(window, 'installCalls') + 1); return { outcome: 'dismissed' }; } });
    window.dispatchEvent(event);
  });
  await page.getByRole('link', { name: 'Көйләүләр', exact: true }).first().click();
  const button = page.getByRole('button', { name: 'Кушымтаны урнаштырырга', exact: true });
  await expect(button).toBeVisible(); expect(await page.evaluate(() => Reflect.get(window, 'installCalls'))).toBe(0);
  await button.click(); await expect(page.getByText('Урнаштыру кире кагылды.', { exact: false })).toBeVisible();
  await expect(button).toHaveCount(0); expect(await page.evaluate(() => Reflect.get(window, 'installCalls'))).toBe(1);
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => ({ outcome: 'accepted' }) })));
  await button.click(); await expect(page.getByText('Урнаштыру тәкъдиме кабул ителде.', { exact: false })).toBeVisible();
  await expect(page.getByText('Браузер кушымтаның урнаштырылуын раслады.', { exact: false })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByText('Браузер кушымтаның урнаштырылуын раслады.', { exact: false })).toBeVisible();
  await expect(button).toHaveCount(0);
});

test('manual guides and storage transfer remain available without an install offer', async ({ page }) => {
  await page.goto('./#/settings'); const install = page.locator('#install');
  await expect(install.getByRole('button', { name: 'Кушымтаны урнаштырырга', exact: true })).toHaveCount(0);
  for (const platform of ['ios26', 'ios_previous', 'android', 'mac_safari', 'desktop_chromium', 'firefox']) {
    await page.setViewportSize({ width: 320, height: 844 });
    await install.getByRole('combobox').selectOption(platform); await expect(install.getByRole('listitem')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await install.getByRole('link', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click();
  await expect(page.locator('#offline-heading')).toBeFocused(); await expect(page).toHaveURL(/#\/settings$/u);
  await install.getByRole('link', { name: 'Нәтиҗәләрнең резерв күчермәсе', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings\/backup$/u);
  await page.goBack(); await expect(page.locator('#install select')).toHaveValue('firefox');
  await page.reload(); await expect(page.locator('#install select')).toHaveValue('firefox');
});

test('standalone surface never offers installation again', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('./#/settings');
  await expect(page.getByText('Кушымта аерым тәрәзәдә ачылган.', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { throw new Error('must not prompt'); } })));
  await expect(page.getByRole('button', { name: 'Кушымтаны урнаштырырга', exact: true })).toHaveCount(0);
});

test('a denied guide write keeps the current choice on return from backup', async ({ page }) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'iske-imla-install-guide') throw new DOMException('Full', 'QuotaExceededError'); return write.call(this, key, value); };
  });
  await page.goto('./#/settings'); await page.locator('#install select').selectOption('android');
  await page.locator('#install').getByRole('link', { name: 'Нәтиҗәләрнең резерв күчермәсе', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings\/backup$/u); await page.goBack();
  await expect(page.locator('#install select')).toHaveValue('android');
});
