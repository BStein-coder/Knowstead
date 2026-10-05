import { useRef, useState, type ReactNode } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { Popover, type Placement } from './Popover';

export type MenuEntry =
  | {
      label: string;
      icon?: LucideIcon;
      onClick?: () => void;
      href?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      shortcut?: string;
      hint?: string;
      hidden?: boolean;
    }
  | { separator: true; hidden?: boolean }
  | { heading: string; hidden?: boolean };

interface MenuProps {
  trigger: (props: { onClick: () => void; ref: (el: HTMLElement | null) => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuEntry[];
  placement?: Placement;
  className?: string;
}

/** Aufklappmenü mit Tastaturbedienung. */
export function Menu({ trigger, items, placement = 'bottom-end', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.menu-item:not([disabled])') ?? [])];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <>
      {trigger({ onClick: () => setOpen((o) => !o), ref: setAnchor, 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement={placement} className={`menu ${className ?? ''}`} role="menu">
        <div ref={listRef} onKeyDown={onKeyDown}>
          {visible.map((item, i) => {
            if ('separator' in item) return <div key={i} className="menu-sep" role="separator" />;
            if ('heading' in item) return <div key={i} className="menu-heading">{item.heading}</div>;
            const Icon = item.icon;
            const content = (
              <>
                <span className="menu-icon">{item.checked !== undefined ? item.checked ? <Check size={15} /> : null : Icon ? <Icon size={15} /> : null}</span>
                <span className="menu-label">
                  {item.label}
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </span>
                {item.shortcut && <kbd className="menu-shortcut">{item.shortcut}</kbd>}
              </>
            );
            if (item.href) {
              return (
                <a
                  key={i}
                  className={`menu-item ${item.danger ? 'danger' : ''}`}
                  href={item.href}
                  target={item.href.startsWith('http') || item.href.startsWith('/api/') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {content}
                </a>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                autoFocus={i === 0}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
