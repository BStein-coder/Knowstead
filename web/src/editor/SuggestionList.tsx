import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { cx } from '../components/ui';

export interface SuggestionEntry {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  group?: string;
}

export interface SuggestionListProps {
  items: SuggestionEntry[];
  command: (item: SuggestionEntry) => void;
  emptyText: string;
}

export interface SuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/** Aufklappliste für Slash-Befehle, Erwähnungen und Seitenlinks. */
export const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(function SuggestionList({ items, command, emptyText }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [items]);

  useEffect(() => {
    listRef.current?.querySelector('.suggestion-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setIndex((i) => (items.length ? (i + 1) % items.length : 0));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[index];
        if (item) {
          command(item);
          return true;
        }
        return false;
      }
      return false;
    },
  }));

  let lastGroup: string | undefined;
  return (
    <div className="suggestion-list" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <div className="suggestion-empty">{emptyText}</div>}
      {items.map((item, i) => {
        const header = item.group && item.group !== lastGroup ? <div className="suggestion-group">{item.group}</div> : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header}
            <button type="button" className={cx('suggestion-item', i === index && 'selected')} onMouseEnter={() => setIndex(i)} onClick={() => command(item)}>
              {item.icon !== undefined && <span className="suggestion-icon">{item.icon}</span>}
              <span className="suggestion-text">
                <span className="suggestion-title">{item.title}</span>
                {item.description && <span className="suggestion-desc">{item.description}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});
