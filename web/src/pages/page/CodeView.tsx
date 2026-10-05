import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from '../../editor/render';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui';

/** Anzeige einer Code-Seite mit Zeilennummern und Syntaxhervorhebung. */
export function CodeView({ code, language }: { code: string; language: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => {
    const html = highlightCode(code, language);
    // Hervorgehobenes HTML zeilenweise aufteilen, offene Spans je Zeile schließen/wieder öffnen
    const result: string[] = [];
    const open: string[] = [];
    for (const raw of html.split('\n')) {
      let line = open.join('') + raw;
      const tags = raw.match(/<span[^>]*>|<\/span>/g) ?? [];
      for (const tag of tags) {
        if (tag === '</span>') open.pop();
        else open.push(tag);
      }
      line += '</span>'.repeat(open.length);
      result.push(line);
    }
    return result;
  }, [code, language]);
  return (
    <div className="col">
      <div className="row">
        <span className="badge">{language ?? 'plaintext'}</span>
        <span className="small muted">{lines.length} Zeilen</span>
        <span className="spacer" />
        <Button
          size="sm"
          icon={copied ? Check : Copy}
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {t('common.copy')}
        </Button>
      </div>
      <div className="code-view">
        <table>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="ln">{i + 1}</td>
                <td className="code hljs" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
