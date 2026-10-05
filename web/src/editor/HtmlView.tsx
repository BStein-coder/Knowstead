import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { cx } from '../components/ui';
import { enhanceHtml } from './render';

/**
 * Zeigt bereits bereinigtes HTML an (Markdown-Seiten, Versionen, Diffs)
 * und ergänzt Syntaxhervorhebung, Diagramme und Anker.
 */
export function HtmlView({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    void enhanceHtml(el);
    const onTheme = () => {
      el.innerHTML = html;
      void enhanceHtml(el);
    };
    window.addEventListener('knowstead:theme', onTheme);
    return () => window.removeEventListener('knowstead:theme', onTheme);
  }, [html]);

  return (
    <div
      ref={ref}
      className={cx('doc doc-html', className)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('/') && !href.startsWith('/api/') && !e.ctrlKey && !e.metaKey && a.target !== '_blank') {
          e.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
