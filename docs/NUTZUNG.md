# Nutzung

Diese Anleitung zeigt in Kürze, wie Knowstead im Alltag genutzt wird – gegliedert nach Aufgaben. Die
ausführliche Beschreibung jeder Funktion steht im **Handbuch**, das beim Einrichten als Bereich
„Handbuch“ in Knowstead angelegt wird (Quelltext: [docs/handbuch](handbuch/), englisch:
[docs/handbook](handbook/)).

<!-- toc -->

## Inhalt

- [Grundbegriffe](#grundbegriffe)
- [Für alle: lesen, finden, mitreden](#für-alle-lesen-finden-mitreden)
- [Für Schreibende: Seiten anlegen und pflegen](#für-schreibende-seiten-anlegen-und-pflegen)
- [Für Teams: planen und zusammenarbeiten](#für-teams-planen-und-zusammenarbeiten)
- [Für die Redaktion: Qualität sichern](#für-die-redaktion-qualität-sichern)
- [Für die Bereichsverwaltung](#für-die-bereichsverwaltung)
- [Für die Administration](#für-die-administration)
- [Typische Abläufe](#typische-abläufe)
- [Tastenkürzel](#tastenkürzel)

---

## Grundbegriffe

| Begriff | Bedeutung |
| --- | --- |
| **Bereich** | Sammlung von Seiten eines Teams, Projekts oder Themas – mit eigenen Rechten, Vorlagen, Papierkorb und Änderungsprotokoll |
| **Seite** | Dokument im Seitenbaum eines Bereichs: Rich-Text, Markdown oder Code |
| **Version** | jede veröffentlichte Änderung; alle Versionen bleiben erhalten und lassen sich vergleichen und wiederherstellen |
| **Rolle** | Recht in einem Bereich: Lesen, Kommentieren, Bearbeiten oder Verwalten |
| **Gruppe** | Personenkreis mit globalen Rechten, oft aus Active Directory oder Entra ID abgeglichen |
| **Plan** | Aufgabenboard eines Bereichs mit Spalten, Zeitachse und Abhängigkeiten |

## Für alle: lesen, finden, mitreden

**Anmelden** – mit Benutzername und Passwort, dem Windows-Konto oder per „Mit Microsoft anmelden“,
je nach Einrichtung. Sprache (Deutsch/Englisch) und helles oder dunkles Design stellst du im Benutzermenü
um.

**Finden**

- <kbd>Strg</kbd> + <kbd>K</kbd> öffnet die Befehlspalette: Seiten, Bereiche und Befehle.
- Die **Volltextsuche** durchsucht Seiten, den Inhalt von Anhängen (PDF, Office, eingescannte
  Dokumente mit eingerichteter Texterkennung) und Aufgaben samt den Nachrichten in ihrem Chat. Filter wie `space:IT`, `label:anleitung`, `"genaue Phrase"`
  oder `#Status=erledigt` grenzen ein.
- **Stichwörter**, **Rückverweise** und die **Link-Karte** zeigen Zusammenhänge.

**Mitreden**

- **Kommentare** unter der Seite oder zu einer markierten Textstelle, mit `@Erwähnungen`.
- **Beobachten** (Auge) informiert über Änderungen – in der Glocke und, falls eingerichtet, per E-Mail
  sofort oder als tägliche Zusammenfassung.
- **Favoriten** (Stern) erscheinen auf der Startseite.

**Pflichtdokumente** – Wird eine Lesebestätigung verlangt, zeigt die Seite ein Band mit **Gelesen und
verstanden**. Offene Dokumente stehen unter **Lesebestätigungen → Für mich**.

→ Handbuch: *Erste Schritte*, *Suche, Stichwörter und Eigenschaften*, *Zusammenarbeit*, *Lesebestätigungen*

## Für Schreibende: Seiten anlegen und pflegen

1. Im Bereich **Erstellen → Neue Seite** wählen, eine **Vorlage** aussuchen (Besprechungsprotokoll,
   Anleitung, Runbook …) oder leer beginnen.
2. Schreiben: `/` öffnet das Menü für Überschriften, Tabellen, Hinweisboxen, Diagramme und Makros;
   `[[` verlinkt Seiten, `@` erwähnt Personen. Dateien per Drag & Drop einfügen.
3. Unten eine **Änderungsnotiz** eintragen und **Veröffentlichen** (<kbd>Strg</kbd> + <kbd>S</kbd>).

| Aufgabe | So geht's |
| --- | --- |
| gemeinsam schreiben | Rich-Text-Seiten öffnen mehrere Personen gleichzeitig – Cursor mit Namen zeigen, wer wo schreibt |
| Änderungen vorschlagen | auf Seiten im Vorschlagsmodus werden Änderungen zu Vorschlägen, die die Autorin oder der Autor annimmt |
| Versionen vergleichen | **… → Versionen**, zwei Versionen wählen, **Vergleichen** |
| Fehler zurücknehmen | **Letzte Änderungen → Rückgängig** oder eine alte Version wiederherstellen |
| exportieren | **… → Exportieren** als PDF oder Word (mit Firmenvorlage), Markdown oder HTML |
| Diagramme | `/drawio`, `/whiteboard` oder `/diagramm` (Mermaid) |
| KI-Hilfe | Knopf **KI** im Editor: verbessern, kürzen, übersetzen, zusammenfassen (falls eingerichtet) |

→ Handbuch: *Bereiche und Seiten*, *Editor und Makros*, *Dateien, PDF und Diagramme*, *Versionen und
Änderungsprotokolle*, *Vorlagen*, *KI-Assistent*, *Export und Import*

## Für Teams: planen und zusammenarbeiten

- **Aufgabenplaner** (im Bereich links **Aufgaben**): Board, Liste und Zeitachse, Verantwortliche,
  Fristen, Prioritäten, Checklisten, wiederkehrende Aufgaben.
- **Abhängigkeiten**: Aufgaben warten aufeinander (Ende → Anfang u. a.); abhängige Termine rücken
  automatisch nach, die Zeitachse zeigt die Verbindungen.
- **Meine Aufgaben** sammelt alles, was dir zugewiesen ist; das **Kalender-Abo** bringt Fristen nach
  Outlook, Google oder Apple Kalender.
- **Journal**: **Erstellen → Tagesnotiz** legt eine Seite für heute im persönlichen Bereich an.

→ Handbuch: *Aufgabenplaner*, *Zusammenarbeit*

## Für die Redaktion: Qualität sichern

| Werkzeug | Wofür |
| --- | --- |
| **Prüfung und Freigabe** | Seite gegenlesen lassen; im Bereich optional Pflicht für jede Änderung |
| **Mehrstufige Freigaben** | z. B. Fachbereich → Qualitätsmanagement → Veröffentlichung, mit Vertretungen bei Abwesenheit |
| **Vorschlagsmodus** | andere schlagen Änderungen vor, die Autorin oder der Autor entscheidet |
| **Lesebestätigungen** | Richtlinien und Unterweisungen nachweislich lesen lassen – mit Frist, Erinnerungen und Nachweis als CSV |
| **Wiedervorlage** | Verantwortliche und Prüfintervall je Seite, Erinnerungen vor der Fälligkeit |
| **Inhaltsanalyse** | meistgelesene und ungelesene Seiten, Suchbegriffe ohne Treffer, verwaiste Seiten, defekte Verweise |

→ Handbuch: *Prüfung und Freigabe*, *Wiedervorlage*, *Lesebestätigungen*, *Inhaltsanalyse*

## Für die Bereichsverwaltung

Unter **Bereichseinstellungen**:

- **Berechtigungen**: Rollen für Personen, Gruppen, alle Angemeldeten oder anonyme Besucher.
- **Allgemein**: Kategorie, Startseite, Prüfpflicht, Bearbeitungsmodus neuer Seiten, Wiedervorlage.
- **Freigaben**: mehrstufiger Freigabeablauf.
- **Export & Import**: Bereich als Handbuch (PDF/Word), Markdown, HTML oder Knowstead-Archiv; Übernahme aus
  **Confluence**, MediaWiki, DokuWiki und XWiki.
- **Archivieren & Löschen**.

Einzelne Seiten lassen sich zusätzlich über **… → Einschränkungen** auf Personen oder Gruppen begrenzen.

→ Handbuch: *Bereiche und Seiten*, *Berechtigungen*, *Export und Import*

## Für die Administration

| Seite | Inhalt |
| --- | --- |
| Benutzer, Gruppen, Rechte | Konten, Dienstkonten, globale Rechte, Zuordnung von AD- und SSO-Gruppen |
| Verzeichnis | Anmeldung über Active Directory/LDAP |
| Single Sign-on | Microsoft Entra ID, SAML, Windows-Anmeldung (Kerberos) |
| E-Mail | SMTP, Benachrichtigungen, Versandprotokoll |
| KI & Dateien | KI-Anbieter, Office-Vorschau, Texterkennung (Tesseract), draw.io |
| Export-Vorlage | Firmenlayout für PDF und Word |
| Webhooks, Konnektoren, Plugins | Anbindung anderer Systeme |
| Audit-Log, Sicherungen, Wartung | Nachvollziehbarkeit und Betrieb |

Installation und Betrieb: [INSTALLATION.md](INSTALLATION.md) und [ADMINISTRATION.md](ADMINISTRATION.md).

## Typische Abläufe

**Neue Richtlinie veröffentlichen**

1. Seite mit der Vorlage *Prozessbeschreibung* anlegen, Bearbeitungsmodus **Nur Vorschläge** wählen.
2. Fachkolleginnen und -kollegen schlagen Änderungen vor; die Autorin nimmt sie an.
3. **Prüfung anfordern** – der Freigabeablauf des Bereichs führt durch Fachbereich und QM.
4. Nach der Freigabe **Lesebestätigung …** für die betroffenen Gruppen anfordern (Frist 14 Tage,
   jährlich wiederholen).
5. **Verantwortung & Wiedervorlage**: Prüfintervall 12 Monate.

**Umzug aus Confluence**

1. In Confluence *Bereichseinstellungen → Bereich exportieren → XML* mit Anhängen.
2. In Knowstead einen Bereich anlegen, **Export & Import → Aus anderem Wiki übernehmen**, ZIP wählen,
   Versionsgeschichte übernehmen.
3. Den Bericht prüfen, danach in der **Inhaltsanalyse** defekte Verweise und verwaiste Seiten nacharbeiten.

**Projekt aufsetzen**

1. Seite mit der Vorlage *Projektsteckbrief*, darunter Protokolle und Entscheidungen.
2. Einen **Plan** im Bereich anlegen, Aufgaben mit Abhängigkeiten erfassen, Zeitachse prüfen.
3. Das Makro **Aufgaben** in den Projektsteckbrief einfügen, Kalender-Abo für das Team teilen.

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| <kbd>Strg</kbd> + <kbd>K</kbd> | Befehlspalette |
| <kbd>/</kbd> | Suche (in der Ansicht) bzw. Makromenü (im Editor) |
| <kbd>E</kbd> | Seite bearbeiten |
| <kbd>C</kbd> | Unterseite erstellen |
| <kbd>H</kbd> | Versionsgeschichte |
| <kbd>Strg</kbd> + <kbd>S</kbd> | Veröffentlichen |
| <kbd>?</kbd> | alle Tastenkürzel |
