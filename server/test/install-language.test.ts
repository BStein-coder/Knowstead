import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage, texts } from '../../scripts/lang.mjs';

test('Sprache der Installationsskripte: gewählt, aus der Umgebung, aus dem System', () => {
  // Ausdrücklich gewählt (--lang) geht vor
  assert.equal(resolveLanguage('en', { KNOWSTEAD_LANG: 'de', LANG: 'de_DE.UTF-8' }), 'en');
  assert.equal(resolveLanguage('de', { LANG: 'en_US.UTF-8' }), 'de');
  assert.throws(() => resolveLanguage('fr', {}), /unknown language: fr \(de, en\)/);

  // Dann KNOWSTEAD_LANG – alles außer Deutsch ist Englisch
  assert.equal(resolveLanguage(undefined, { KNOWSTEAD_LANG: 'en', LANG: 'de_DE.UTF-8' }), 'en');
  assert.equal(resolveLanguage(undefined, { KNOWSTEAD_LANG: 'de-DE', LANG: 'en_US.UTF-8' }), 'de');
  assert.equal(resolveLanguage(undefined, { KNOWSTEAD_LANG: 'fr' }), 'en');

  // Dann die Sprache des Systems in der üblichen Rangfolge; »C« und »POSIX« sagen nichts über die Person
  assert.equal(resolveLanguage('', { LC_ALL: 'de_AT.UTF-8', LANG: 'en_US.UTF-8' }), 'de');
  assert.equal(resolveLanguage(null, { LC_MESSAGES: 'en_GB.UTF-8', LANG: 'de_DE.UTF-8' }), 'en');
  assert.equal(resolveLanguage(undefined, { LC_ALL: 'C.UTF-8', LANG: 'de_DE.UTF-8' }), 'de');
  assert.equal(resolveLanguage(undefined, { LC_ALL: 'POSIX', LC_MESSAGES: 'C', LANG: 'de_CH' }), 'de');
  assert.equal(resolveLanguage(undefined, { LANG: 'ja_JP.UTF-8' }), 'en');
  // Ohne jede Angabe entscheidet die Regionseinstellung des Rechners – eine der beiden Sprachen ist es immer
  assert.match(resolveLanguage(undefined, {}), /^(de|en)$/);

  assert.equal(texts('de')('deutsch', 'english'), 'deutsch');
  assert.equal(texts('en')('deutsch', 'english'), 'english');
});
