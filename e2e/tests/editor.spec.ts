import { test, expect, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.use({ storageState: AUTH.editor });

test.describe('Editor', () => {
  test('Slash-Befehle, Formatierung und Markdown-Kürzel', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.getByPlaceholder('Seitentitel').fill(unique('Editortest'));
    const editor = page.locator('.editor-page .tiptap');
    await editor.click();

    // Markdown-Kürzel für Überschrift und Liste
    await page.keyboard.type('## Abschnitt');
    await page.keyboard.press('Enter');
    await expect(editor.locator('h2')).toHaveText('Abschnitt');
    await page.keyboard.type('- Punkt eins');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Punkt zwei');
    await expect(editor.locator('ul li')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Fett über Tastenkürzel
    await page.keyboard.press('Control+b');
    await page.keyboard.type('fett');
    await page.keyboard.press('Control+b');
    await expect(editor.locator('strong')).toHaveText('fett');
    await page.keyboard.press('Enter');

    // Slash-Menü: Hinweisbox und Tabelle
    await page.keyboard.type('/info');
    await expect(page.locator('.suggestion-list')).toBeVisible();
    await expectAccessible(page, '.suggestion-list');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Wichtiger Hinweis');
    await expect(editor.locator('[data-type="callout"], .callout').first()).toContainText('Wichtiger Hinweis');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/tabelle');
    await page.keyboard.press('Enter');
    await expect(editor.locator('table')).toBeVisible();

    // Entwurf wird automatisch gespeichert
    await expect(page.getByText(/Entwurf gespeichert/)).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page, '.editor-page');

    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page).toHaveURL(/\/p\/\d+/);
    const article = page.locator('article');
    await expect(article.locator('h2', { hasText: 'Abschnitt' })).toBeVisible();
    await expect(article.getByText('Wichtiger Hinweis')).toBeVisible();
    await expect(article.locator('table')).toBeVisible();
  });

  test('Baustein „Stand der Seite“: zeigt das Datum der Seite, lässt sich einstellen, kommt ohne festen Text aus', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.getByPlaceholder('Seitentitel').fill(unique('Standtest'));
    const editor = page.locator('.editor-page .tiptap');
    await editor.click();
    await page.keyboard.type('Richtlinie – ');
    await page.keyboard.type('/stand');
    await expect(page.locator('.suggestion-list')).toContainText('Stand der Seite');
    await page.keyboard.press('Enter');

    // Im Editor ein Knopf mit dem Datum der Seite (Vorgabe: mit Uhrzeit)
    const stamp = editor.locator('button.page-stand');
    await expect(stamp).toHaveText(/^Stand: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    await expectAccessible(page, '.editor-page');

    // Einstellen: eigene Beschriftung, ohne Uhrzeit, mit Namen
    await stamp.click();
    await page.getByLabel('Beschriftung').fill('Gültig seit');
    await page.getByLabel('Mit Uhrzeit').uncheck();
    await page.getByLabel('Mit Namen der Person').check();
    await expect(stamp).toHaveText(/^Gültig seit: \d{2}\.\d{2}\.\d{4} · .+$/);
    await page.keyboard.press('Escape');

    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page).toHaveURL(/\/p\/(\d+)/);
    const shown = page.locator('article span.page-stand');
    await expect(shown).toHaveText(/^Gültig seit: \d{2}\.\d{2}\.\d{4} · .+$/);
    await expect(page.locator('article')).toContainText('Richtlinie – Gültig seit:');

    // Gespeichert ist nur der Baustein mit seinen Einstellungen – kein Datum
    const id = /\/p\/(\d+)/.exec(page.url())![1];
    const stored = await page.evaluate(async (pageId) => (await (await fetch(`/api/v1/pages/${pageId}`)).json()).content as string, id);
    expect(stored).toContain('data-type="page-stand"');
    expect(stored).toContain('data-label="Gültig seit"');
    expect(stored).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  test('Ohne Titel wird nicht veröffentlicht', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.locator('.editor-page .tiptap').click();
    await page.keyboard.type('Inhalt ohne Titel');
    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page.getByText('Seitentitel').last()).toBeVisible();
    await expect(page).toHaveURL(/\/edit\/\d+/);
  });

  test('Markdown-Seite mit Vorschau', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.getByRole('button', { name: /Markdown/ }).first().click();
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.getByPlaceholder('Seitentitel').fill(unique('Markdowntest'));
    const code = page.locator('.cm-content');
    await code.click();
    await page.keyboard.type('# Titel im Markdown\n\n**Fett** und `Code`');
    if (!(await page.locator('.preview-pane').isVisible())) await page.getByRole('button', { name: 'Vorschau' }).click();
    await expect(page.locator('.preview-pane').getByRole('heading', { name: 'Titel im Markdown' })).toBeVisible();
    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page).toHaveURL(/\/p\/\d+/);
    await expect(page.locator('article').getByRole('heading', { name: 'Titel im Markdown' })).toBeVisible();
  });
});
