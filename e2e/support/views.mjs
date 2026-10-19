/**
 * Ansichten für Werkzeuge, die die Oberfläche von außen ansehen (shots.mjs, contrast-scan.mjs): Name, Adresse,
 * Einstellungen im Browser (localStorage) und eine Aktion nach dem Laden. Die IDs liefert instance.mjs.
 *
 * @returns {Array<[string, string, Record<string, string> | null | undefined, ((page: import('playwright').Page) => Promise<void>) | undefined]>}
 */
export function views({ pageId, boardId }) {
  const plan = `/s/TEAM/tasks?board=${boardId}`;
  const click = (selector) => async (page) => {
    await page.locator(selector).first().click();
    await page.waitForTimeout(500);
  };
  return [
    ['home', '/'],
    ['spaces', '/spaces'],
    ['space', '/s/TEAM'],
    ['page', `/s/TEAM/p/${pageId}`],
    ['editor', `/s/TEAM/edit/${pageId}`],
    ['board', plan, { 'knowstead.tasks.view': 'board' }],
    ['list', plan, { 'knowstead.tasks.view': 'list' }],
    ['timeline', plan, { 'knowstead.tasks.view': 'timeline', 'knowstead.tasks.zoom': 'month' }],
    ['task-dialog', plan, { 'knowstead.tasks.view': 'board' }, click('.task-card')],
    ['search', '/search?q=page'],
    ['activity', '/activity'],
    ['profile-preferences', '/profile/preferences'],
    ['admin', '/admin'],
    ['admin-users', '/admin/users'],
    ['admin-settings', '/admin/settings'],
    ['user-menu', '/', null, click('.user-button')],
    [
      'palette',
      '/',
      null,
      async (page) => {
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(500);
      },
    ],
  ];
}
