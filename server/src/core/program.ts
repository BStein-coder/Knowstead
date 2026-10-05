import fs from 'node:fs';
import path from 'node:path';
import { packageBuiltAt, type Config } from '../config.ts';
import { HttpError } from './errors.ts';
import { systemdServiceName } from './legacy.ts';
import type { Logger } from '../services.ts';

/**
 * Läuft der Server noch mit dem Programmstand, der auf der Platte liegt?
 *
 * Ein Update ersetzt den Programmordner. Wird der Dienst dabei nicht neu gestartet, arbeitet der alte Prozess
 * aus dem Speicher weiter – mit zwei Folgen:
 *
 *  1. Er zeigt und tut, was die alte Version konnte, während Oberfläche und Dateien schon neu sind.
 *  2. Wird der alte Ordner gelöscht, existiert das Arbeitsverzeichnis des Prozesses nicht mehr. Node kann dann
 *     keinen Worker mehr starten („process.cwd failed … uv_cwd“): Export, Sicherung und Textgewinnung aus
 *     Anhängen fallen aus.
 *
 * Beides erkennt der Server hier selbst, meldet es der Administration und hält die Worker am Laufen.
 */

/** Woran sich ein Programmstand wiedererkennen lässt. */
export interface ProgramIdentity {
  /** Gerät und Inode des Ordners – ein ersetzter Ordner (alter verschoben, neuer an derselben Stelle) hat andere */
  folder: string;
  version: string;
  /** Bauzeitpunkt des Installationspakets, falls aus einem Paket installiert */
  builtAt: string | null;
}

/** `missing` = der Ordner fehlt, `replaced` = ein anderer Ordner liegt am selben Pfad, `updated` = neuer Stand im selben Ordner */
export type ProgramChange = 'missing' | 'replaced' | 'updated';

/** Was der laufende Server beim Start über sich festhält (Einstellung `internal:app:running`) – für `cli status` und `doctor`. */
export interface RunningProgram {
  version: string;
  builtAt: string | null;
  startedAt: string;
  pid: number;
}

export const RUNNING_KEY = 'app:running';

export function identifyProgram(rootDir: string): ProgramIdentity | null {
  let stat: fs.BigIntStats;
  try {
    stat = fs.statSync(rootDir, { bigint: true });
  } catch {
    return null;
  }
  let version = '';
  try {
    version = String((JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: unknown }).version ?? '');
  } catch {
    /* Ordner wird gerade ersetzt und ist unvollständig */
  }
  return { folder: `${stat.dev}:${stat.ino}`, version, builtAt: packageBuiltAt(rootDir) };
}

export function programChange(started: ProgramIdentity | null, now: ProgramIdentity | null): ProgramChange | null {
  // Beim Start nicht feststellbar: keine Aussage
  if (!started) return null;
  if (!now) return 'missing';
  if (now.folder !== started.folder) return 'replaced';
  if (now.builtAt !== started.builtAt || (now.version !== '' && now.version !== started.version)) return 'updated';
  return null;
}

/**
 * Passt der laufende Server zum Programmstand auf der Platte? Für die Kommandozeile, die neben dem Server läuft.
 * `running` ist der Eintrag des Servers – fehlt er, stammt der Prozess aus einer Version, die ihn noch nicht schrieb.
 */
export function runningIsCurrent(running: RunningProgram | null, onDisk: { version: string; packageBuiltAt: string | null }): boolean {
  return !!running && running.version === onDisk.version && running.builtAt === onDisk.packageBuiltAt;
}

/** Wie sich der Dienst neu starten lässt – je nach Betriebsart laut Installationsassistent. */
export function restartHint(service: string | null): string {
  switch (service) {
    case 'systemd':
      return `systemctl restart ${systemdServiceName()}`;
    case 'task':
    case 'nssm':
      return 'Knowstead-Dienst.cmd restart';
    case 'docker':
      return 'docker compose restart';
    default:
      return 'Server beenden und neu starten';
  }
}

export class ProgramState {
  private readonly config: Config;
  private readonly log: Logger;
  private readonly started: ProgramIdentity | null;
  private warned = false;

  constructor(config: Config, log: Logger) {
    this.config = config;
    this.log = log;
    this.started = identifyProgram(config.rootDir);
  }

  /** Wurde der Programmordner seit dem Start ersetzt, aktualisiert oder entfernt? Dann läuft noch der alte Stand. */
  change(): ProgramChange | null {
    return programChange(this.started, identifyProgram(this.config.rootDir));
  }

  /**
   * Vor dem Start eines Workers: Arbeitsverzeichnis auf den Programmordner setzen.
   *
   * Ob das bisherige Arbeitsverzeichnis noch existiert, lässt sich im Hauptthread nicht zuverlässig erfragen
   * (process.cwd() antwortet aus einem Zwischenspeicher) – der Wechsel in den Ordner unter dem bekannten Pfad
   * ist dagegen immer richtig und kostet nichts. Fehlt der Ordner ganz, hilft nur ein Neustart.
   */
  prepareWorker(): void {
    const change = this.change();
    if (change && !this.warned) {
      this.warned = true;
      this.log.warn(
        change === 'missing'
          ? `Der Programmordner ${this.config.rootDir} ist nicht mehr vorhanden – Knowstead wurde im laufenden Betrieb verschoben oder entfernt. Bitte den Dienst neu starten (${restartHint(this.config.service)}).`
          : `Die Programmdateien in ${this.config.rootDir} wurden seit dem Start ersetzt – der Server läuft noch mit dem alten Stand. Bitte den Dienst neu starten (${restartHint(this.config.service)}).`,
      );
    }
    try {
      process.chdir(this.config.rootDir);
    } catch {
      throw new HttpError(503, 'restart_required', 'Die Programmdateien von Knowstead wurden im laufenden Betrieb verschoben oder entfernt. Der Dienst muss neu gestartet werden – bitte die Administration informieren.');
    }
  }
}
