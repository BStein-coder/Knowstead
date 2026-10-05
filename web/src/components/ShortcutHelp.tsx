import { Keyboard } from 'lucide-react';
import { useI18n } from '../i18n';
import { Kbd, Modal } from './ui';
import { modKey } from '../lib/utils';

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const mod = modKey(locale);
  const groups: { title: string; items: [string[], string][] }[] = [
    {
      title: t('shortcutHelp.general'),
      items: [
        [[mod, 'K'], t('shortcutHelp.commandPalette')],
        [['/'], t('shortcutHelp.openSearch')],
        [['['], t('shortcutHelp.toggleSidebar')],
        [['G', 'H'], t('shortcutHelp.goHome')],
        [['G', 'S'], t('shortcutHelp.goSpaces')],
        [['G', 'A'], t('shortcutHelp.goActivity')],
        [['G', 'D'], t('shortcutHelp.goDrafts')],
        [['?'], t('shortcutHelp.thisHelp')],
      ],
    },
    {
      title: t('shortcutHelp.page'),
      items: [
        [['E'], t('shortcutHelp.editPage')],
        [['C'], t('shortcutHelp.newPage')],
        [['S'], t('shortcutHelp.toggleFavorite')],
        [['H'], t('shortcutHelp.showVersions')],
      ],
    },
    {
      title: t('shortcutHelp.editor'),
      items: [
        [[mod, 'S'], t('shortcutHelp.publish')],
        [['Esc'], t('shortcutHelp.closeEditor')],
        [['/'], t('shortcutHelp.insertCommands')],
        [['@'], t('shortcutHelp.mention')],
        [['[['], t('shortcutHelp.linkPage')],
        [[mod, 'B'], t('shortcutHelp.bold')],
        [[mod, 'I'], t('shortcutHelp.italic')],
        [[mod, 'U'], t('shortcutHelp.underline')],
        [[mod, 'K'], t('shortcutHelp.insertLink')],
        [[mod, 'Shift', '8'], t('shortcutHelp.bulletList')],
        [[mod, 'Shift', '9'], t('shortcutHelp.taskList')],
        [[mod, 'Alt', '1–4'], t('shortcutHelp.headings')],
        [['```'], t('shortcutHelp.codeBlock')],
        [['>'], t('shortcutHelp.quote')],
      ],
    },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('app.shortcuts')} icon={Keyboard} size="lg">
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
        {groups.map((g) => (
          <div key={g.title}>
            <h4 className="mb-1">{g.title}</h4>
            <div className="col gap-sm">
              {g.items.map(([keys, label]) => (
                <div key={label} className="row">
                  <span className="grow soft">{label}</span>
                  <span className="row gap-xs">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
