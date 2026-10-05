---
title: Vorlagen
icon: 🧩
---

# Vorlagen

Vorlagen sorgen für einheitliche, vollständige Seiten – vom Besprechungsprotokoll bis zum Runbook.

<!-- toc -->

## Mitgelieferte Vorlagen

| Vorlage | Zweck |
| --- | --- |
| Besprechungsprotokoll | Agenda, Teilnehmende, Entscheidungen, Aufgaben |
| Anleitung (How-to) | Schritt-für-Schritt-Anleitungen mit Voraussetzungen |
| Entscheidungsdokument (ADR) | Kontext, Optionen, Entscheidung, Konsequenzen |
| Fehlerbehebung | Symptome, Ursache, Lösung |
| Produktanforderungen | Ziele, User Stories, offene Fragen |
| Retrospektive | Was lief gut, was verbessern wir, Maßnahmen |
| Versionshinweise (Changelog) | Änderungen einer Version im Stil „Keep a Changelog“ |
| API-Dokumentation | Endpunkte, Authentifizierung, Beispiele |
| Projektsteckbrief | Ziele, Team, Meilensteine, Risiken – mit Eigenschaften |
| Prozessbeschreibung | Rollen, Ablauf (Diagramm), Änderungshistorie |
| Onboarding-Checkliste | Aufgaben für die ersten Wochen |
| Betriebshandbuch (Runbook) | Dienstübersicht, Alarme, Eskalation |
| Tagesnotiz | Vorlage für das Journal |

## Platzhalter

Titelmuster und Inhalte können Platzhalter enthalten, die beim Anlegen einer Seite ersetzt werden:

| Platzhalter | Ergebnis (Beispiel) |
| --- | --- |
| `{{datum}}` | 11.09.2026 |
| `{{isodatum}}` | 2026-09-11 |
| `{{uhrzeit}}` | 14:30 |
| `{{wochentag}}` | Freitag |
| `{{kw}}` | 37 |
| `{{monat}}` / `{{jahr}}` | September / 2026 |
| `{{benutzer}}` | Name der anlegenden Person |
| `{{ich}}` | Erwähnung der anlegenden Person (@Name) |
| `{{bereich}}` | Name des Bereichs |

Für englischsprachige Vorlagen gibt es gleichwertige Platzhalter: `{{date}}`, `{{time}}`, `{{weekday}}`, `{{week}}`, `{{month}}`, `{{year}}`, `{{user}}`, `{{me}}`, `{{space}}` und `{{spacekey}}`.

## Eigene Vorlagen

- **Global** (für alle Bereiche): Administration → Vorlagen (Recht „Globale Vorlagen verwalten“).
- **Je Bereich**: Bereichseinstellungen → Vorlagen.
- **Aus einer Seite**: **… → Als Vorlage speichern** übernimmt Inhalt, Stichwörter und Eigenschaften.

Vorlagen können Stichwörter und Eigenschaften vorgeben, die jede neue Seite automatisch erhält.
