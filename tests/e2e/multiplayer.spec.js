const { test, expect } = require('@playwright/test');

async function openOnline(page, name) {
  await page.goto('/v9.html?emulator=1');
  await page.waitForFunction(() => window.firebase && window.firebase.apps.length > 0);
  await page.locator('#mode-online').click();
  await page.locator('#online-name').fill(name);
}

async function preparePlayer(page) {
  await page.locator('#v9-prepare').click();
  await expect(page.locator('#p-setup')).toHaveClass(/on/);
  await page.locator('#setup-body .mcard').first().click();
  await page.locator('#p-setup button[onclick="checkSetup()"]').click();
  await expect(page.locator('#p-online-lobby')).toHaveClass(/on/);
}

test('deux joueurs préparent leurs mains privées et terminent les huit tours', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await openOnline(host, 'Alice');
    await host.locator('button[onclick="createOnlineRoom()"]').click();
    await expect(host.locator('#p-online-lobby')).toHaveClass(/on/);
    const code = (await host.locator('#online-room-code').textContent()).trim();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await openOnline(guest, 'Bob');
    await guest.locator('#online-code').fill(code);
    await guest.locator('button[onclick="joinOnlineRoom()"]').click();
    await expect(guest.locator('#online-room-code')).toHaveText(code);

    await preparePlayer(host);
    await preparePlayer(guest);
    await expect(host.locator('#v9-start')).toBeEnabled({ timeout: 20000 });
    await host.locator('#v9-start').click();

    await expect(host.locator('#p-game')).toHaveClass(/on/, { timeout: 30000 });
    await expect(host.locator('#g-body .card.pick').first()).toBeVisible({ timeout: 30000 });

    // Joue une carte spéciale : avec ou sans choix de cible selon son type.
    const hand = host.locator('#g-hand .hand-card');
    const before = await hand.count();
    if (before > 0) {
      await hand.first().click();
      const modal = host.locator('#modal-special');
      if (await modal.evaluate(el => el.classList.contains('on'))) {
        await modal.locator('.tbtn').first().click();
      }
      await expect(host.locator('#g-hand .hand-card')).toHaveCount(before - 1, { timeout: 30000 });
      await expect(host.locator('#g-body .card.pick').first()).toBeVisible({ timeout: 30000 });
    }

    // L’hôte commence, puis les deux appareils alternent jusqu’au tour 8.
    for (let turn = 0; turn < 16; turn++) {
      const active = turn % 2 === 0 ? host : guest;
      const next = turn % 2 === 0 ? guest : host;
      await expect(active.locator('#p-game')).toHaveClass(/on/, { timeout: 30000 });
      await expect(active.locator('#g-body .card.pick').first()).toBeVisible({ timeout: 30000 });
      await active.locator('#g-body .card.pick').first().click();
      await expect(active.locator('#btn-ok')).toBeVisible();
      await active.locator('#btn-ok').click();

      if (turn < 15) {
        await expect(next.locator('#g-body .card.pick').first()).toBeVisible({ timeout: 30000 });
      }
    }

    await expect(host.locator('#p-end')).toHaveClass(/on/, { timeout: 30000 });
    await expect(guest.locator('#p-end')).toHaveClass(/on/, { timeout: 30000 });
    await expect(host.locator('#end-podium .pod')).toHaveCount(2);
    await expect(guest.locator('#end-podium .pod')).toHaveCount(2);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
