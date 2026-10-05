---
title: Prüfung und Freigabe
icon: ✅
---

# Prüfung und Freigabe

Wichtige Seiten sollen nicht ungeprüft veröffentlicht werden – und ein Versehen soll sich schnell
zurücknehmen lassen. Beides erledigt Knowstead mit zwei Werkzeugen: der **Prüfung** und den
**letzten Änderungen**.

<!-- toc -->

## Eine Prüfung anfordern

1. Seite öffnen und im Menü **„…“** den Eintrag **Prüfung anfordern** wählen.
2. Optional eine prüfende Person auswählen – ohne Auswahl geht der Auftrag an die Redaktion des
   Bereichs (alle Bereichsadministratoren).
3. Eine kurze Nachricht dazuschreiben („Bitte Abschnitt 2 gegenlesen“) und abschicken.

Die Seite trägt danach das Band **In Prüfung**. Sie bleibt für alle sichtbar und bearbeitbar – die
Prüfung blockiert nichts, sie macht den Stand nur nachvollziehbar.

## Prüfpflicht für einen ganzen Bereich

In den **Bereichseinstellungen** lässt sich **„Änderungen müssen freigegeben werden“** einschalten.
Dann gilt:

- Jede Änderung einer Person **ohne** Prüfrecht erzeugt automatisch einen Prüfauftrag.
- Wer selbst prüfen darf, gibt die eigene Änderung direkt frei.
- Im Bereichsverzeichnis erkennst du solche Bereiche am Häkchen-Symbol.

> [!TIP]
> Das eignet sich für Richtlinien, Arbeitsanweisungen und alles, was verbindlich ist. Für lebendige
> Teamnotizen ist die freiwillige Prüfung meist angenehmer.

## Prüfen: freigeben oder zurückgeben

Offene Aufträge sammeln sich unter **Prüfaufträge** im Hauptmenü (mit Zähler, sobald etwas ansteht).
Entscheiden dürfen alle mit dem Recht **Moderieren** im Bereich und die **eingetragene prüfende
Person** – auch ohne Moderationsrecht. Dort und direkt auf der Seite gibt es zwei Knöpfe:

| Aktion | Wirkung |
| --- | --- |
| **Freigeben** | Die Seite erhält das grüne Band **Freigegeben** mit Name und Zeitpunkt. |
| **Zurückweisen** | Die Seite wird als **Überarbeitung nötig** markiert; die Begründung steht im Band und in der Benachrichtigung. |

Vor der Entscheidung hilft **Vergleichen**: Damit siehst du genau, was sich seit der letzten Version
geändert hat.

> [!NOTE]
> **Vier-Augen-Prinzip:** Wer eine Prüfung anfordert, kann sie nicht selbst freigeben – auch nicht, wenn
> er sich als prüfende Person einträgt. Personen mit Moderationsrecht geben eigene Änderungen in
> Bereichen mit Prüfpflicht dagegen direkt frei.

Erscheint nach einer Freigabe eine neue Version, wird der Hinweis **„Es gibt bereits eine neuere
Version“** angezeigt – die Freigabe bezieht sich immer auf eine bestimmte Version.

> [!TIP]
> Eine Freigabe gilt zugleich als Prüfung für die **Wiedervorlage**: Das Prüfintervall der Seite
> beginnt danach von vorn (siehe Kapitel **Wiedervorlage**).

## Mehrstufige Freigabeabläufe

Manche Dokumente brauchen mehr als ein Paar Augen – etwa **Fachbereich → Qualitätsmanagement →
Veröffentlichung**. Dafür richtet die Bereichsverwaltung unter **Bereichseinstellungen → Freigaben**
einen Freigabeablauf ein:

1. **Freigabeablauf verwenden** einschalten.
2. Je **Stufe** einen Namen, die **Freigebenden** (Gruppen oder Personen) und die Zahl der nötigen
   **Freigaben** festlegen. Mit **Stufe hinzufügen** und den Pfeilen baust du die Reihenfolge.
3. Optional **Eskalation nach Tagen**: Bleibt eine Stufe so lange liegen, erinnert Knowstead die
   Freigebenden und die Bereichsverwaltung.
4. Optional **Jede Stufe durch eine andere Person**: Wer eine Stufe freigegeben hat, kann – auch in
   Vertretung – keine weitere Stufe derselben Version freigeben.

Der Ablauf gilt für angeforderte Prüfungen und – bei eingeschalteter Prüfpflicht – für jede Änderung,
auch von der Bereichsverwaltung. Auf der Seite zeigt eine **Fortschrittsleiste**, welche Stufe gerade
entscheidet und wie viele Freigaben noch fehlen („1 von 2 Freigaben“).

| Ereignis | Wirkung |
| --- | --- |
| Stufe erreicht ihre Freigaben | die nächste Stufe wird benachrichtigt |
| letzte Stufe freigegeben | die Seite gilt als **Freigegeben** |
| Zurückweisung in einer Stufe | der Auftrag endet; die Begründung geht an die anfordernde Person |
| neue Version während des Ablaufs | der Ablauf beginnt wieder bei der ersten Stufe |

> [!NOTE]
> Ist in einer Stufe niemand erreichbar (etwa weil die Gruppe leer ist), entscheidet die
> Bereichsverwaltung.

## Abwesenheit und Vertretung

Damit Freigaben im Urlaub nicht liegen bleiben, trägt jede Person unter **Profil → Vertretung** ihre
Abwesenheiten ein: **Vertretung**, **Von**, **Bis einschließlich** und optional einen Hinweis.

- In diesem Zeitraum darf die Vertretung alle Freigaben entscheiden, für die die abwesende Person
  eingetragen ist. Der Knopf heißt dann **Freigeben für …**.
- Die Entscheidung wird als „in Vertretung für …“ protokolliert – nachvollziehbar im Freigabeverlauf
  und im Audit-Log.
- Benachrichtigungen über neue Freigaben erhält die Vertretung ebenfalls.
- Unter **Ich vertrete** sieht jede Person, für wen sie gerade einspringt. Die Benutzerverwaltung kann
  Vertretungen auch für andere eintragen.

## Letzte Änderungen zurücknehmen

**Hauptmenü → Letzte Änderungen** zeigt die jüngsten Bearbeitungen aller Bereiche, die du sehen
darfst – standardmäßig 50, einstellbar bis 200.

Je Eintrag stehen zur Verfügung:

- **Vergleichen** – was genau wurde geändert?
- **Rückgängig** – setzt die Seite auf den Stand **vor** dieser Änderung zurück.

> [!NOTE]
> Rückgängig löscht nichts: Es entsteht eine **neue** Version mit dem alten Inhalt. Die
> zurückgenommene Fassung bleibt in der Versionsgeschichte erhalten und kann jederzeit wieder
> hergestellt werden.

Filtern lässt sich die Liste nach Bereich; Einträge zu Seiten im Papierkorb sind entsprechend
gekennzeichnet – diese Seiten holst du über den **Papierkorb** des Bereichs zurück.

## Was wo protokolliert wird

| Ort | Inhalt |
| --- | --- |
| Seitenkopf | aktueller Prüfstand mit Person und Zeitpunkt |
| Prüfaufträge | alle offenen und erledigten Aufträge |
| Versionsgeschichte | jede Version mit Änderungsnotiz und Autor |
| Änderungsprotokoll | alle Änderungen eines Bereichs |
| Benachrichtigungen | Anfrage, Freigabe und Zurückweisung |

<div data-type="changelog" data-limit="10"></div>
