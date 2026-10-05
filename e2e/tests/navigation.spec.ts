import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH } from './support/data';

test.use({ storageState: AUTH.editor });

test.describe('Suche und Navigation', () => {
  test('Befehlspalette (Strg+K) findet Seiten und öffnet sie', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await expectAccessible(page, '[role="dialog"]');
    await palette.getByRole('textbox').fill('Makro');
    await palette.getByRole('button', { name: /Makroseite/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Makroseite' })).toBeVisible();
  });

  test('Volltextsuche mit Treffern im Inhalt, Stichwort-Filter und Anhangsuche', async ({ page }) => {
    await page.goto('/search?q=Infokasten');
    await expect(page.locator('.search-hit').filter({ hasText: 'Makroseite' })).toBeVisible();
    // Code-Markup gehört nicht in die Trefferanzeige
    await expect(page.locator('.search-hit-snippet').first()).not.toContainText('language-');

    await page.locator('.search-hit').filter({ hasText: 'Makroseite' }).getByRole('button', { name: 'makros' }).click();
    await expect(page).toHaveURL(/label=makros/);
    await expect(page.locator('.search-hit')).toHaveCount(1);

    await page.goto('/search?q=Tannenbaum');
    await expect(page.getByText('notiz.txt')).toBeVisible({ timeout: 20_000 });
  });

  test('Tastenkürzel g s öffnet die Bereiche, ? zeigt die Kürzel', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/spaces$/);
    await page.keyboard.press('Shift+?');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Seitenbaum klappt Unterseiten auf und navigiert', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}`);
    await ready(page);
    const tree = page.locator('.sidebar');
    await tree.getByText('Makroseite').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Makroseite' })).toBeVisible();
    const item = tree.getByRole('treeitem').filter({ hasText: 'Makroseite' }).first();
    if (!(await tree.getByText('Unterseite Alpha').isVisible())) await item.getByRole('button', { name: 'Aufklappen' }).click();
    await expect(tree.getByText('Unterseite Alpha')).toBeVisible();
    await tree.getByText('Unterseite Alpha').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Unterseite Alpha' })).toBeVisible();
  });

  test('Dunkles Design über das Benutzermenü', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await page.getByRole('button', { name: 'Erika Editor' }).click();
    await page.getByRole('menuitem', { name: 'Dunkel' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Erika Editor' }).click();
    await page.getByRole('menuitem', { name: 'Hell' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
