## Was ändert sich?

<!-- Kurz beschreiben, was und warum. Zugehöriges Issue: #… -->

## Prüfliste

- [ ] `npm run lint` und `npm run typecheck` ohne Befund
- [ ] `npm test` grün; neue Funktionen haben Server-Tests
- [ ] Oberfläche betroffen: `npm run test:e2e` grün, neue Seiten stehen in `e2e/tests/support/routes.ts`
- [ ] Neue Texte in `web/src/i18n/de.ts` **und** `en.ts`; neue Fehlermeldungen des Servers in `server/src/i18n/en.ts`
- [ ] Datenbankänderung als neue Migration (bestehende Migrationen nie ändern)
- [ ] Rechte geprüft (wer darf das? Test mit einer Person ohne Recht)
- [ ] Handbuch (`docs/handbuch`, `docs/handbook`), `docs/API.md` bzw. `docs/ADMINISTRATION.md` und `CHANGELOG.md` ergänzt
