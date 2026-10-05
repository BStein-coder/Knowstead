/** Namensschema der Sicherungsordner: `backup-JJJJMMTT-HHMMSS[-art]`, z. B. `backup-20260913-030000-auto`. */
import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_NAME_RE = /^backup-\d{8}-\d{6}(-[a-z]+)?$/;

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Freien Namen finden – zwei Sicherungen in derselben Sekunde überschreiben sich nicht. */
export function uniqueBackupName(backupsDir: string, suffix = '', at = new Date()): string {
  const nameAt = (d: Date) => `backup-${stamp(d)}${suffix ? `-${suffix}` : ''}`;
  let name = nameAt(at);
  for (let i = 1; fs.existsSync(path.join(backupsDir, name)); i++) name = nameAt(new Date(at.getTime() + i * 1000));
  return name;
}
