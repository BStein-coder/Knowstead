#!/usr/bin/env python3
"""Attrappe für Node.js und die Kommandozeile von Knowstead – nur für update-root-check.sh.

Sie beantwortet genau die Aufrufe, die update.sh absetzt: Felder aus JSON-Dateien lesen, das Ergebnis der
Prüfung (doctor --json) auswerten, die Node-Version nennen und die Befehle stop, doctor, restore und
handbook:sync der Kommandozeile. Welcher Stand »läuft«, steht wie in server/test/update-script.test.ts in
Dateien unter STATE_DIR. Jeder Aufruf der Kommandozeile wird mit Konto und Datenverzeichnis festgehalten.
"""
import json
import os
import pwd
import sys

args = sys.argv[1:]
state = os.environ.get('STATE_DIR', '')


def read(name):
    try:
        with open(os.path.join(state, name), encoding='utf-8') as handle:
            return handle.read().strip()
    except OSError:
        return ''


def write(name, text):
    # Erst entfernen: Die Datei kann einem anderen Konto gehören, der Ordner ist für alle beschreibbar
    path = os.path.join(state, name)
    try:
        os.unlink(path)
    except OSError:
        pass
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)


def schema_of(version):
    if version.startswith('1.7'):
        return 23
    return 24 if version.startswith('1.') else 25


def product(version):
    # Bis 1.9 hieß das Programm „Doku“ – so nennt es sich auch in seinen Meldungen
    return 'Doku' if version.startswith('1.') else 'Knowstead'


def db_file(data):
    # Eine Installation aus der Zeit vor der Umbenennung behält ihre doku.db
    legacy = os.path.join(data, 'doku.db')
    return legacy if os.path.exists(legacy) else os.path.join(data, 'knowstead.db')


if args[:1] == ['-v']:
    print('v24.0.0')
    sys.exit(0)

if args[:1] == ['-p']:
    print('24')
    sys.exit(0)

if args[:1] == ['-e']:
    script = args[1] if len(args) > 1 else ''
    if script == '':
        sys.exit(0)
    if 'readFileSync(process.argv[1]' in script:
        # json_field <datei> <feld>
        try:
            with open(args[2], encoding='utf-8') as handle:
                value = json.load(handle).get(args[3])
            if value is not None:
                sys.stdout.write(str(value))
        except (OSError, ValueError, IndexError):
            pass
        sys.exit(0)
    if 'process.stdin.on' in script:
        # doctor_says <ausdruck>: die beiden Ausdrücke aus update.sh, hier in Python nachgebildet
        expression = args[2]
        try:
            checks = json.loads(sys.stdin.read())['checks']
        except (ValueError, KeyError):
            sys.exit(1)

        def by(check_id):
            return next((c for c in checks if c['id'] == check_id), None)

        if 'neueren (Knowstead|Doku)-Version' in expression:
            message = (by('database') or {}).get('message') or ''
            result = 'neueren Knowstead-Version' in message or 'neueren Doku-Version' in message
        else:
            result = (
                (by('server') or {}).get('message') == 'läuft'
                and (by('http') is None or by('http')['status'] == 'ok')
                and by('program') is None
                and (by('database') or {}).get('status') != 'error'
            )
        sys.exit(0 if result else 1)
    sys.stderr.write('fake-node: unbekanntes Skript\n')
    sys.exit(2)

if len(args) >= 3 and args[1] == 'server/src/cli.ts':
    here = os.getcwd()
    command, rest = args[2], args[3:]
    user = pwd.getpwuid(os.geteuid()).pw_name
    data = os.environ.get('DATA_DIR', '')
    with open(os.path.join(here, 'package.json'), encoding='utf-8') as handle:
        version = json.load(handle)['version']
    with open(os.path.join(state, 'calls.log'), 'a', encoding='utf-8') as handle:
        handle.write('cli %s %s [%s] [%s]\n' % (version, ' '.join([command] + rest), user, data))
    # Wie die echte Kommandozeile: ohne lesbare .env und ohne Zugriff auf das Datenverzeichnis geht nichts
    try:
        with open(os.path.join(here, '.env'), encoding='utf-8') as handle:
            handle.read()
        os.listdir(data)
    except OSError as err:
        sys.stderr.write('Fehler: %s\n' % err)
        sys.exit(1)

    if command == 'stop':
        try:
            os.unlink(os.path.join(state, 'running'))
        except OSError:
            pass
    elif command == 'doctor':
        running = read('running')
        checks = [{'id': 'node', 'status': 'ok', 'title': 'Node.js', 'message': 'ok'}]
        checks.append({'id': 'server', 'status': 'ok', 'title': 'Server', 'message': 'läuft' if running else 'läuft nicht – Port 3000 ist frei'})
        if running and not version.startswith('1.7'):
            checks.append({'id': 'http', 'status': 'warn' if read('broken') == running else 'ok', 'title': 'Erreichbarkeit', 'message': 'x'})
            if running != version:
                checks.append({'id': 'program', 'status': 'warn', 'title': 'Programmstand', 'message': 'alter Stand'})
        schema = int(read('schema') or 23)
        if schema > schema_of(version):
            checks.append({'id': 'database', 'status': 'error', 'title': 'Datenbank', 'message': 'stammt von einer neueren %s-Version' % product(version)})
        else:
            checks.append({'id': 'database', 'status': 'ok', 'title': 'Datenbank', 'message': 'Schema %d' % schema})
        failed = any(c['status'] == 'error' for c in checks)
        if '--json' in rest:
            print(json.dumps({'ok': not failed, 'checks': checks}))
        else:
            print('\n'.join('%s: %s' % (c['title'], c['message']) for c in checks))
        sys.exit(1 if failed else 0)
    elif command == 'restore':
        # Wie die echte Wiederherstellung: Sicherung des jetzigen Stands anlegen, Datenbankdatei ersetzen
        os.makedirs(os.path.join(data, 'backups', 'backup-20261005-091500-restore'), exist_ok=True)
        target = db_file(data)
        temp = target + '.restore-tmp'
        with open(temp, 'w', encoding='utf-8') as handle:
            handle.write('zurückgespielt aus %s' % rest[0])
        os.replace(temp, target)
        write('schema', str(schema_of(version)))
        print('Datenbank aus %s zurückgespielt' % rest[0])
    elif command == 'handbook:sync':
        print('Handbuch: 2 Kapitel ergänzt')
    sys.exit(0)

sys.stderr.write('fake-node: unbekannter Aufruf: %s\n' % ' '.join(args))
sys.exit(2)
