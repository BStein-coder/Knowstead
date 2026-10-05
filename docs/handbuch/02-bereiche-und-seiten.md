---
title: Bereiche und Seiten
icon: 🗂️
---

# Bereiche und Seiten

<!-- toc -->

## Bereiche

Ein **Bereich** bündelt die Seiten eines Teams, Projekts oder Themas – mit eigenen Berechtigungen, Vorlagen, Papierkorb und Änderungsprotokoll. Jeder Bereich hat einen kurzen, eindeutigen **Schlüssel** (z. B. `DEV`), der in Adressen verwendet wird: `/s/DEV/…`.

Beim Anlegen wählst du einen Zugriff:

| Voreinstellung | Bedeutung |
| --- | --- |
| **Offen** | Alle angemeldeten Benutzer dürfen lesen und bearbeiten |
| **Lesbar** | Alle dürfen lesen, nur Mitglieder bearbeiten |
| **Privat** | Nur du – weitere Personen oder Gruppen fügst du in den Bereichseinstellungen hinzu |

Die **Startseite** eines Bereichs („Übersicht“) wird automatisch angelegt. Sie enthält Makros für Unterseiten und zuletzt geänderte Seiten und kann frei gestaltet werden.

### Kategorien: Abteilungen, Projekte & Co.

In der linken Navigation und im Bereichsverzeichnis sind die Bereiche nach **Kategorien** gruppiert – zum Beispiel **Abteilungen**, **Projekte** oder **Archiv**. Bereiche ohne Kategorie stehen unter „Weitere Bereiche“.

- **Einem Bereich eine Kategorie geben**: beim Anlegen des Bereichs oder später unter **Bereichseinstellungen → Allgemein → Kategorie**.
- **Kategorien hinzufügen, umbenennen, sortieren oder entfernen**: Das erledigt die Administration unter **Administration → Bereiche → Kategorien**. Wird eine Kategorie entfernt, bleiben ihre Bereiche erhalten.
- **Einen Bereich aus der Navigation nehmen**: **Bereichseinstellungen → Archivieren & Löschen**. Archivierte Bereiche bleiben lesbar, gelöschte sind endgültig weg.

### Bereichseinstellungen

Bereichsverwalter finden unter **Bereichseinstellungen**:

- **Allgemein** – Name, Beschreibung, Symbol, Farbe, Kategorie, Startseite, Prüfpflicht, Bearbeitungsmodus neuer Seiten und **Wiedervorlage** (siehe Kapitel **Wiedervorlage**)
- **Berechtigungen** – Rollen für Benutzer, Gruppen, alle Angemeldeten oder anonyme Besucher
- **Mitglieder** – effektive Rollen aller Personen (direkt oder über Gruppen)
- **Freigaben** – mehrstufiger Freigabeablauf (siehe Kapitel **Prüfung und Freigabe**)
- **Eingeschränkte Seiten** – Überblick über alle Seiten mit Einschränkungen
- **Vorlagen** – bereichseigene Vorlagen
- **Export & Import** – Bereich als Handbuch (PDF oder Word), Markdown, HTML oder Knowstead-Archiv exportieren, Dateien importieren und Inhalte aus Confluence, MediaWiki, DokuWiki oder XWiki übernehmen
- **Archivieren & Löschen** – archivierte Bereiche sind schreibgeschützt

## Seiten

Seiten sind hierarchisch organisiert: Jede Seite kann beliebig viele **Unterseiten** haben. Es gibt drei Seitentypen:

| Typ | Geeignet für |
| --- | --- |
| **Dokument** (Rich-Text) | Die meisten Inhalte – mit Makros, Tabellen, Bildern |
| **Markdown** | Technische Dokumentation, die auch außerhalb von Knowstead gelesen wird |
| **Code** | Skripte, Konfigurationen, Snippets mit Syntaxhervorhebung und Zeilennummern |

### Verschieben, Kopieren, Löschen

- **Verschieben**: im Seitenbaum per Drag & Drop (oberer/unterer Rand = davor/danach, Mitte = als Unterseite) oder über **… → Verschieben** – auch in andere Bereiche.
- **Kopieren**: über **… → Kopieren**, optional mit Unterseiten, Anhängen und Stichwörtern – auch in einen anderen Bereich oder unter eine andere Seite.
- **Duplizieren**: über **… → Duplizieren** entsteht mit einem Klick eine Kopie direkt neben dem Original („… (Kopie)“, mit Anhängen und Stichwörtern) – ideal als Ausgangspunkt für ähnliche Seiten.
- **Löschen**: verschiebt die Seite samt Unterseiten in den **Papierkorb**. Von dort lässt sie sich wiederherstellen. Nach der eingestellten Frist (Standard: 30 Tage) wird der Papierkorb automatisch geleert.

> [!WARNING]
> Die Startseite eines Bereichs kann nicht gelöscht werden. Lege zuerst eine andere Startseite fest.

### Seiteninformationen und Link-Karte

Unter **… → Seiteninformationen** siehst du ID, Autoren, Aufrufe sowie ein- und ausgehende Verweise. Der Reiter **Link-Karte** zeigt die Verknüpfungen der Seite als interaktiven Graphen – ein Klick auf einen Knoten öffnet die Seite.
