import { request } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.use({ storageState: AUTH.editor });

test.describe('Vorschlagsmodus', () => {
  test('Lektorin schlägt Änderungen vor, Autor nimmt sie an', async ({ page, browser, seed, baseURL }) => {
    const api = (state: string) => request.newContext({ baseURL, storageState: state, extraHTTPHeaders: { 'x-knowstead-client': 'e2e' } });
    const admin = await api(AUTH.admin);
    const viewer = await api(AUTH.viewer);
    const title = unique('Vorschlagsseite');
    const created = await (await admin.post('/api/v1/pages', { data: { spaceKey: seed.spaceKey, title, content: '<p>Alle Türen schließen.</p>' } })).json();
    expect((await admin.put(`/api/v1/pages/${created.id}/edit-mode`, { data: { mode: 'suggest' } })).ok()).toBeTruthy();

    // Erika darf nur vorschlagen
    await page.goto(`/s/${seed.spaceKey}/edit/${created.id}`);
    const editor = page.locator('.editor-page .tiptap');
    await expect(editor).toContainText('Alle Türen schließen.');
    // Auswahl, wie der Editor sie sieht (TipTap hängt sich an sein Element)
    const selectedText = () =>
      editor.evaluate((el) => {
        const { state } = (el as HTMLElement & { editor: { state: { selection: { from: number; to: number }; doc: { textBetween(a: number, b: number): string } } } }).editor;
        return state.doc.textBetween(state.selection.from, state.selection.to);
      });
    const toggle = page.getByRole('button', { name: 'Vorschlagen' });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Bitte sofort.');
    await expect(editor.locator('ins[data-suggestion]')).toHaveText(' Bitte sofort.');

    // Markieren per Tastatur, bis der Editor die Auswahl übernommen hat. Er liest sie erst beim „selectionchange“
    // des Browsers; trifft zugleich die Live-Synchronisierung ein, setzt sie die Auswahl zurück – dann erneut markieren.
    const selectByKeyboard = async (start: string, keys: string[], expected: (text: string) => boolean) => {
      await expect(async () => {
        await page.keyboard.press(start);
        for (const key of keys) await page.keyboard.press(key);
        await expect.poll(async () => expected(await selectedText()), { timeout: 1500 }).toBe(true);
      }).toPass({ timeout: 20_000 });
    };

    // Das erste Wort löschen: bleibt durchgestrichen stehen
    await selectByKeyboard('Control+Home', Array(4).fill('Shift+ArrowRight'), (text) => text === 'Alle');
    await page.keyboard.press('Backspace');
    await expect(editor.locator('del[data-suggestion]')).toHaveText('Alle');
    await expect(editor).toContainText('Alle Türen schließen. Bitte sofort.');

    // Formatierung ist im Vorschlagsmodus gesperrt
    await selectByKeyboard('Control+End', Array(3).fill('Shift+ArrowLeft'), (text) => text.length === 3);
    await page.keyboard.press('Control+b');
    await expect(editor.locator('strong')).toHaveCount(0);

    const panel = page.getByRole('region', { name: 'Änderungsvorschläge' });
    await expect(panel).toContainText('2 Vorschläge');
    await expect(panel.getByRole('button', { name: 'Alle annehmen' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/s/${seed.spaceKey}/p/${created.id}`));

    // Lesende sehen den bisherigen Text
    const beforeAccept = await (await viewer.get(`/api/v1/pages/${created.id}?render=true`)).json();
    expect(beforeAccept.html).toBe('<p>Alle Türen schließen.</p>');

    // Autor nimmt alle Vorschläge an
    const authorContext = await browser.newContext({ storageState: AUTH.admin });
    const authorPage = await authorContext.newPage();
    await authorPage.goto(`/s/${seed.spaceKey}/p/${created.id}`);
    await expect(authorPage.getByText('2 Vorschläge')).toBeVisible();
    await authorPage.goto(`/s/${seed.spaceKey}/edit/${created.id}`);
    const authorPanel = authorPage.getByRole('region', { name: 'Änderungsvorschläge' });
    await expect(authorPanel.getByText('Erika Editor').first()).toBeVisible();
    await authorPanel.getByRole('button', { name: 'Alle annehmen' }).click();
    await expect(authorPage.locator('.editor-page .tiptap')).toHaveText('Türen schließen. Bitte sofort.');
    await authorPage.getByRole('button', { name: 'Aktualisieren', exact: true }).first().click();
    await expect(authorPage).toHaveURL(new RegExp(`/s/${seed.spaceKey}/p/${created.id}`));

    const afterAccept = await (await viewer.get(`/api/v1/pages/${created.id}?render=true`)).json();
    expect(afterAccept.html).toBe('<p> Türen schließen. Bitte sofort.</p>');
    expect(afterAccept.editMode.pending).toBe(0);

    await authorContext.close();
    await admin.dispose();
    await viewer.dispose();
  });
});
