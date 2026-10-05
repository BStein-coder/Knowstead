# Contributing to Knowstead

*[Deutsche Fassung](CONTRIBUTING.de.md)*

Thank you for wanting to improve Knowstead! Bug reports, ideas, translations, documentation and code are
equally welcome. Issues and pull requests can be written in English or German.

## Before you start

- **Bugs** are reported via *Issues → Fehler melden* (bug report). Helpful details are the version, how
  Knowstead is run, steps to reproduce and the matching lines from the server log (without credentials).
- **Security vulnerabilities:** please **never** as a public issue – see [SECURITY.md](SECURITY.md).
- **Larger changes** (new modules, database changes, new dependencies): please discuss them in an issue
  first. That way the implementation fits the architecture before a lot of work has gone into it.

## Development environment

The only requirement is **Node.js 24**. Nothing else – no database server, no Docker.

```bash
npm install
npm run dev          # API on :3000, interface with hot reload on :5173
```

Structure, conventions and typical tasks (new module, macro, migration, permission) are described in
[docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md), the internal design in
[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) (both German).

## Rules for changes

| Topic | Rule |
| --- | --- |
| Language | interface texts, comments, commit messages and the technical documentation are in German; identifiers in the code are in English |
| Texts | every interface text goes into `web/src/i18n/de.ts` **and** `en.ts`; new server error messages additionally into `server/src/i18n/en.ts` |
| Database | schema changes only as a **new** migration under `server/src/db/migrations/` – never change an existing one |
| Permissions | never check them yourself – use the permission services (`perms.requireGlobal`, `pages.requireAccess` …) and test with a person **without** the permission |
| Tests | new features get server tests (`server/test/`), new pages of the interface an entry in `e2e/tests/support/routes.ts` |
| Dependencies | sparingly; justify new packages in the pull request (licence, maintenance, size) |
| Documentation | keep the handbook (`docs/handbuch` and `docs/handbook`), `docs/API.md`, `docs/ADMINISTRATION.md` and `CHANGELOG.md` up to date |

If you do not write German, say so in your pull request – we help with the German texts during review.

## Checks before the pull request

```bash
npm run lint         # ESLint and completeness of the translations
npm run typecheck    # TypeScript for server and interface
npm run build        # build the interface – the server tests need it
npm test             # server tests
npm run test:e2e     # interface tests (once: npm --prefix e2e ci)
```

The same steps run in GitHub Actions for every pull request.

## Commit messages

Short and in the imperative, in German – e.g. „Lesebestätigung: Erinnerung vor Fristende“. One change per
commit; formatting changes separate from changes in substance.

## Licence

By contributing you agree that your contribution is published under the project's licence
([LICENSE](LICENSE)).
