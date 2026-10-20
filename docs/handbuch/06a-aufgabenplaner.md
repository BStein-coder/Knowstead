---
title: Aufgabenplaner
icon: ✅
labels: [aufgaben, projekte, planung, kalender]
---

# Aufgabenplaner

<!-- toc -->

Der Aufgabenplaner ordnet Arbeitspakete in **Pläne** mit Spalten – ähnlich wie Microsoft Planner, bewusst schlank: Jede Aufgabe hat eine verantwortliche Person, ein Ziel (Beschreibung und Checkliste), ein Enddatum, eine Priorität und einen Fortschritt. Pläne gehören zu einem Bereich; wer dort bearbeiten darf, darf auch planen.

## Plan anlegen

1. Im Bereich links auf **Aufgaben** klicken.
2. **Neuer Plan** wählen, Namen und kurze Beschreibung eintragen.
3. Die Spalten sind vorbelegt mit *Zu erledigen*, *In Arbeit*, *Prüfung* und *Erledigt* – über das Zahnrad lassen sie sich umbenennen, einfärben, ergänzen (bis 12) und sortieren.

> [!NOTE]
> Die **letzte Spalte gilt als „erledigt“**: Karten dort werden automatisch abgeschlossen, und wer eine Aufgabe abhakt, findet sie danach in dieser Spalte. Wird eine Spalte gelöscht, wandern ihre Karten in die erste Spalte.

## Aufgaben erfassen

- **Schnell**: In der Spalte auf **+** klicken, Titel tippen, `Enter`.
- **Ausführlich**: Karte anklicken und im Dialog ausfüllen:

| Feld | Wofür |
| --- | --- |
| **Verantwortlich** | Eine Person mit Zugriff auf den Bereich – sie wird benachrichtigt |
| **Beginn / Fällig** | Zeitraum; überfällige Aufgaben werden rot markiert |
| **Priorität** | Niedrig, Normal, Hoch, Dringend |
| **Status und Fortschritt** | Offen, In Arbeit, Erledigt sowie ein Fortschrittsbalken in Prozent. Wahlweise von Hand am Regler oder mit dem Schalter **Fortschritt aus der Checkliste** automatisch aus dem Anteil erledigter Punkte (4 Punkte, 1 erledigt = 25 %) |
| **Beschreibung** | Ziel und Hintergrund der Aufgabe – das *Was* |
| **Chat** | Fragen, Zwischenstände und Absprachen mit @-Erwähnungen – das *Wer hat wann was gesagt* (siehe unten) |
| **Checkliste** | Teilschritte zum Abhaken (Fortschritt auf der Karte sichtbar) |
| **Stichwörter** | z. B. `analyse`, `rollout` – als farbige Marken auf der Karte; bis zu 30 je Aufgabe, bereits im Plan verwendete werden beim Tippen vorgeschlagen |
| **Seite** | Verknüpft die Aufgabe mit einer Seite, etwa dem Projektsteckbrief |
| **Abhängigkeiten** | Aufgaben, auf die diese Aufgabe wartet (siehe unten) |
| **Wiederholen** | Täglich, wöchentlich, alle 2 Wochen, monatlich, vierteljährlich oder jährlich (siehe unten) |

## Chat je Aufgabe

Rechts neben den Feldern (auf schmalen Bildschirmen darunter) hat jede Aufgabe einen **Chat** – für
Rückfragen, Zwischenstände und Absprachen, die nicht in die Beschreibung gehören. Die Spalte bleibt
beim Blättern durch die Felder stehen; ältere Nachrichten scrollen in ihr nach oben weg. Er
funktioniert wie die Kommentare einer Seite:

- **@Name** erwähnt eine Person; sie bekommt eine Benachrichtigung (und eine E-Mail, falls
  eingerichtet) mit Sprung direkt in die Aufgabe. Nach dem **@** erscheint eine Liste: zuerst die
  Beteiligten der Aufgabe (verantwortliche Person, wer sie angelegt hat, wer schon mitgeschrieben hat),
  dann alle anderen – weitertippen filtert, **Enter** oder ein Klick übernimmt, **Esc** schließt nur die
  Liste.
- Wer **keinen Zugriff** auf den Bereich hat, ist in der Liste so gekennzeichnet. Wird die Person
  trotzdem erwähnt, meldet Knowstead nach dem Senden, dass sie nicht benachrichtigt wurde – sie kann die
  Aufgabe ja nicht öffnen.
- Wer erst beim **Bearbeiten** einer Nachricht erwähnt wird, bekommt die Benachrichtigung dann; wer
  schon erwähnt war, nicht noch einmal. Ein Klick auf eine Erwähnung öffnet das Profil der Person.
- Ohne Erwähnung werden die **verantwortliche Person**, wer die Aufgabe **angelegt** hat und alle, die
  **schon mitgeschrieben** haben, über neue Nachrichten informiert.
- **Schreiben** darf, wer im Bereich mindestens *Kommentieren* darf – also auch, wer die Aufgabe selbst
  nicht bearbeiten kann. Wer nur *Lesen* darf, liest mit.
- Eigene Nachrichten lassen sich nachträglich **ändern** und **löschen**; die Bereichsverwaltung darf
  jede Nachricht löschen. Änderungen sind als *bearbeitet* gekennzeichnet.
- Neue Nachrichten anderer erscheinen im offenen Dialog **ohne Neuladen**.

Auf der Karte zeigt ein Zähler (💬 3) die Anzahl der Nachrichten; im CSV-Export steht sie in der Spalte
*Nachrichten*. Der Chat wandert mit der Aufgabe in den Papierkorb und beim Wiederherstellen zurück;
beim endgültigen Löschen verschwindet er mit ihr.

**Ungelesenes erkennen:** Haben andere geschrieben, seit du zuletzt in den Chat geschaut hast, ist der
Zähler farbig hervorgehoben und trägt einen Punkt – auf der Karte im Plan und unter *Meine
Aufgaben*. Der Hinweis beim Darüberfahren nennt die Zahl („2 neue Nachrichten im Chat“). Sobald du die
Aufgabe öffnest, gilt der Chat als gelesen; eigene Nachrichten zählen nie als ungelesen.

> [!TIP]
> Die **Beschreibung** ist das *Was* – sie wird exportiert. Der Chat ist das *Wer hat wann was
> gesagt*. Die Suche findet beides; was dauerhaft gelten soll, gehört trotzdem in die Beschreibung.

## Steuern und koordinieren

- **Ziehen und ablegen** verschiebt Karten zwischen Spalten und ändert die Reihenfolge. Beim Ziehen wird die Karte abgedunkelt und leicht gekippt, die Zielspalte leuchtet, und eine Linie zeigt, wo die Karte landet; beim Ablegen gleitet sie an ihren Platz, die übrigen rücken gleitend nach.
- **Abhaken auf der Karte**: Der Kreis links vom Titel schließt die Aufgabe ab – der Haken zeichnet sich nach, der Titel wird durchgestrichen und die Karte gleitet in die letzte Spalte. Ein zweiter Klick öffnet sie wieder (zurück in die erste Spalte). Die Zähler der Spalten und die Kennzahlen darüber leuchten dabei kurz auf. Den Kreis sehen nur Personen, die im Bereich bearbeiten dürfen.
- **Mehrere Karten auf einmal**: Mit gedrückter **Strg**- oder **Umschalttaste** anklicken. Oben erscheint
  eine Leiste, die für alle ausgewählten Karten Verantwortliche, Spalte, Fälligkeit und Priorität setzt,
  sie auf *erledigt* stellt oder in den Papierkorb legt (höchstens 100 auf einmal).
- **Live**: Ändert jemand anderes etwas im selben Plan, erscheint es ohne Neuladen.
- **Suche**: Aufgaben findet auch die normale Suche – über Titel, Beschreibung, Stichwörter und die
  **Nachrichten im Chat**. Der Treffer öffnet die Karte direkt im Plan; steckt das Gesuchte im Chat,
  zeigt er unter *Im Chat* den Ausschnitt mit dem Namen der Person und springt zu genau dieser Nachricht.
- **Papierkorb**: Gelöschte Aufgaben liegen im Papierkorb des Bereichs und lassen sich dort mitsamt ihren
  Abhängigkeiten wiederherstellen. Nach der eingestellten Aufbewahrungszeit räumt die Wartung sie weg.
- **Export**: Das Symbol **Plan als CSV herunterladen** erzeugt eine Tabelle mit allen Spalten
  (Titel, Spalte, Status, Fortschritt, Verantwortliche, Termine, Priorität, Stichwörter, Checkliste,
  Vorgängerinnen, Beschreibung, Anzahl der Nachrichten) – für Besprechungen und Berichte.
- **Filter** oben: *Alle*, *Meine*, *Offen*, *Überfällig*.
- **Board, Liste, Zeitachse oder Kalender**: Die Liste zeigt alle Aufgaben mit Spalte, Verantwortlichen, Fälligkeit, Priorität und Fortschritt in einer Tabelle – praktisch für Besprechungen. Die Zeitachse und der Kalender zeigen die Termine im Überblick (siehe unten).
- Über dem Plan stehen vier **Kennzahlen**: *Offen*, *Diese Woche fällig*, *Überfällig* und *Diese Woche erledigt*. Die Zahlen zählen beim Öffnen hoch und leuchten auf, wenn sie sich ändern. Die Zeile darunter nennt die Anzahl der Aufgaben, den **Anteil erledigter** und die **überfälligen** Aufgaben.

## Zeitachse

Die **Zeitachse** (Symbol neben Board und Liste) stellt jede Aufgabe mit Beginn oder Fälligkeit als Balken dar – wie ein schlankes Gantt-Diagramm:

- **Balken ziehen** verschiebt den ganzen Zeitraum, **die Enden ziehen** ändert Beginn oder Fälligkeit (mit Bearbeitungsrecht im Bereich).
- Der **Maßstab** lässt sich zwischen Tagen, Wochen und Monaten umschalten; eine Linie markiert heute.
- Die Aufgaben sind nach Spalten gruppiert und in deren Farbe dargestellt, überfällige rot. Aufgaben nur mit Fälligkeit erscheinen als Markierung am Fälligkeitstag.
- Die Filter oben (Alle, Meine, Offen, Überfällig) gelten auch hier. Aufgaben ohne Termin stehen darunter; ein Klick auf eine Aufgabe öffnet sie.

## Kalender

Der **Kalender** (Symbol neben der Zeitachse) stellt die Aufgaben an ihrem **Fälligkeitstag** dar – als **Monat** oder als **Woche**:

- Die Pfeile blättern, **Heute** springt zurück; das neue Raster gleitet aus der Richtung herein, in die du blätterst.
- Aufgaben stehen als Marken im Tag: rot, wenn sie überfällig oder dringend sind, gelb bei hoher Priorität, grau und durchgestrichen, wenn sie erledigt sind. Hat ein Tag mehr als drei, öffnet **+n weitere** die Liste dieses Tages.
- Rechts steht die **Liste des gewählten Tages** – zunächst heute, mit allem, was **überfällig** ist. Der Kreis davor schließt die Aufgabe ab, ein Klick auf den Titel öffnet sie.
- Aufgaben **ohne Fälligkeit** erscheinen nicht im Kalender; ein Hinweis darunter nennt ihre Zahl. Die Filter des Plans gelten auch hier.
- Auf dem Handy zeigt das Raster nur einen Punkt an Tagen mit Terminen; die Liste darunter nennt sie.

**Über alle Bereiche:** Unter **Kalender** (linke Navigation) steht dieselbe Darstellung für alle Aufgaben. **Meine** zeigt, was dir zugewiesen ist, **Alle** alles, was du sehen darfst. Das Überfällige in der Liste von heute stammt aus allen Monaten. **Kalender abonnieren** (oben rechts) bringt die Fälligkeiten in dein Kalenderprogramm (siehe unten).

## Projekte

Unter **Projekte** (linke Navigation) liegen **alle Pläne** aller Bereiche, die du sehen darfst, als Karten – ein Überblick darüber, was läuft:

| Auf der Karte | Bedeutung |
| --- | --- |
| **Status** | *In Planung* (keine Aufgaben oder noch nichts begonnen), *In Arbeit* oder *Abgeschlossen* (alle Aufgaben erledigt) |
| **Ring** | Anteil erledigter Aufgaben; der Bogen zeichnet sich beim Öffnen |
| **Nächster Termin** | Die früheste offene Aufgabe mit Fälligkeit – mit dem Abstand in Tagen, rot, wenn der Termin verstrichen ist |
| **Beteiligte** | Wer die meisten Aufgaben hat, zuerst; „+n“ für weitere |
| **Zeile unten** | Erledigte von allen Aufgaben und das späteste Fälligkeitsdatum |

Oben stehen die Kennzahlen *Aktiv*, *Abgeschlossen*, *Im Plan* (Anteil der laufenden Projekte ohne überfällige Aufgabe) und *Diesen Monat fällig*. Die Filter (*Alle*, *Aktiv*, *In Planung*, *Abgeschlossen*) und das Suchfeld engen die Karten ein; die Suche schaut auf Planname, Bereich und Beschreibung. Ein Klick auf die Karte öffnet den Plan. **Neuer Plan** fragt zuerst nach dem Bereich und öffnet dort den Dialog.

> [!NOTE]
> Ein „Projekt“ ist hier ein Plan im Aufgabenbereich eines Bereichs – dieselben Pläne, die du dort anlegst. Pläne in Bereichen, die du nicht sehen darfst, erscheinen nicht.

## Bewegung

Haken, Karten und Zähler sind bewusst lebendig: Abgehakte Karten gleiten in die letzte Spalte, Kennzahlen zählen hoch, Fortschrittsbalken und -ringe wachsen von null, Karten und Zeilen erscheinen beim Öffnen nacheinander. Wem das zu unruhig ist, wählt im Benutzermenü **Animationen und 3D-Effekte** aus (oder im Betriebssystem „Bewegung reduzieren“) – dann steht alles sofort an seinem Platz.

## Abhängigkeiten

Wie in Microsoft Planner Premium können Aufgaben aufeinander **warten**. Im Aufgabendialog unter
**Abhängigkeiten** wählst du in der Liste *Wartet auf …* die Aufgabe, auf die gewartet wird – sie steht
sofort darunter. Dort stellst du die **Art der Abhängigkeit** ein:

| Art | Bedeutung |
| --- | --- |
| **Ende → Anfang** | die Aufgabe beginnt, wenn die Vorgängerin fertig ist (üblich) |
| **Anfang → Anfang** | beide beginnen gleichzeitig |
| **Ende → Ende** | beide enden gleichzeitig |
| **Anfang → Ende** | die Aufgabe endet, wenn die Vorgängerin beginnt |

Der **Versatz** verschiebt um Tage (Kalendertage) – positiv mit Puffer, negativ überlappend. Eine Aufgabe
kann bis zu 20 Vorgängerinnen haben; Kreise („A wartet auf B, B wartet auf A“) lehnt Knowstead ab.

**Über Pläne hinweg:** Die Vorgängerin darf in einem anderen Plan liegen – auch in einem anderen Bereich,
sofern du ihn sehen darfst. Dafür wählst du im Aufgabendialog zuerst den Plan und dann die Aufgabe; in der
Liste steht der Plan dahinter. So hängt ein Teilprojekt an einem Meilenstein des Hauptplans. Verschoben
wird eine wartende Aufgabe nur, wenn in **ihrem eigenen** Plan „automatisch planen“ eingeschaltet ist.

- **Termine sind Voraussetzung für die Pfeile:** Eine Aufgabe ohne Beginn und Fälligkeit hat auf der
  Zeitachse keinen Balken und damit auch keinen Pfeil – sie steht unter *ohne Termin*, dort mit einem
  kleinen Zeichen für ihre Abhängigkeiten. Der Aufgabendialog weist darauf hin. Die Abhängigkeit ist
  trotzdem gespeichert und wirkt als Kennzeichen **Wartet**.
- **Karten** mit offenen Vorgängerinnen tragen das Kennzeichen **Wartet** („Wartet auf: …“). Zusätzlich
  zeigt ein Zeichen mit Zahl, wie viele Aufgaben verknüpft sind – auch bei der Vorgängerin selbst. Beim
  Darüberfahren stehen die Namen mit Pfeilrichtung.
- Die **Zeitachse** zeichnet Pfeile von der Vorgängerin zur wartenden Aufgabe; das Symbol
  **Abhängigkeiten** blendet sie ein und aus. Passt ein Termin nicht zur Abhängigkeit, ist der Pfeil rot
  markiert und oben steht die Zahl der **Terminkonflikte**.
- **Abhängige Aufgaben automatisch verschieben** (Schalter beim Bearbeiten des Plans, standardmäßig an): Verschiebt oder verlängert
  sich eine Aufgabe, rücken die wartenden Aufgaben samt ihrer Dauer nach – auch über mehrere Stufen.
  Legst du eine wartende Aufgabe vor ihre Vorgängerin, rückt sie wieder dahinter; ein Hinweis zeigt das an.
  Nach vorne verschiebt Knowstead nie etwas. Ausgeschaltet werden Konflikte nur markiert; beim Einschalten
  löst Knowstead bestehende Konflikte auf.
- **Erledigte Aufgaben** bleiben, wo sie sind. Eine erledigte Vorgängerin hält niemanden mehr auf – auch
  wenn ihr eingetragener Termin noch in der Zukunft liegt, darfst du die wartende Aufgabe vorziehen.
  Öffnest du eine erledigte Aufgabe wieder, legt Knowstead sie bei Bedarf hinter ihre offenen Vorgängerinnen.

## Wiederkehrende Aufgaben

Für regelmäßige Arbeiten – Monatsabschluss, Zugriffsrechte prüfen, Backup-Test – im Aufgabendialog **Wiederholen** wählen. Auf der Karte erscheint ein Wiederholungssymbol.

Sobald die Aufgabe **erledigt** ist, legt Knowstead die nächste automatisch in der ersten Spalte an: gleicher Titel, gleiche verantwortliche Person, Beginn und Fälligkeit um das Intervall verschoben, Checkliste wieder offen. Liegt die Aufgabe weit zurück, springt der nächste Termin in die Zukunft – verpasste Termine werden nicht nachgeholt.

> [!TIP]
> Ohne Fälligkeit zählt die nächste Wiederholung ab dem Tag, an dem die Aufgabe erledigt wurde.

## Erinnerungen

Verantwortliche werden **vor der Fälligkeit** erinnert und **einmal bei Überfälligkeit** – als Benachrichtigung und, je nach Profileinstellung, per E-Mail. Wie früh die Erinnerung kommt (am Tag der Fälligkeit, 1, 2 oder 3 Tage oder eine Woche vorher, oder gar nicht), stellt jede Person unter **Profil & Einstellungen → Einstellungen** ein. Standard ist ein Tag vorher.

## Kalender abonnieren

Fälligkeiten erscheinen auf Wunsch in deinem Kalenderprogramm – Outlook, Apple-Kalender, Google Kalender oder Thunderbird:

1. Unter **Meine Aufgaben** oder im Kopf eines Plans **Kalender abonnieren** wählen.
2. **Meine Aufgaben und Wiedervorlagen** (alles, was dir zugewiesen ist, und Seiten, für die du verantwortlich bist) oder **Plan „…“** (alle offenen Aufgaben des Plans – praktisch als Team-Kalender).
3. **Link erzeugen** und den Link im Kalenderprogramm abonnieren:
   - **Outlook**: Kalender → *Kalender hinzufügen* → *Aus dem Internet abonnieren* → Link einfügen.
   - **Google Kalender**: *Weitere Kalender* → **+** → *Per URL* → Link einfügen.
   - **Apple-Kalender**: *Ablage* → *Neues Kalenderabonnement* → Link einfügen – oder direkt **Im Kalenderprogramm öffnen**.

Der Kalender aktualisiert sich etwa stündlich; Aufgaben erscheinen als ganztägige Termine mit Link zurück in Knowstead.

> [!WARNING]
> Der Link funktioniert **ohne Anmeldung** – gib ihn nicht weiter. Aus Sicherheitsgründen wird er nur direkt nach dem Erzeugen angezeigt. Mit **Neuen Link erzeugen** wird der alte ungültig, **Abo beenden** sperrt ihn sofort.

## Meine Aufgaben

Unter **Meine Aufgaben** (linke Navigation, mit Zähler) siehst du alles, was dir zugewiesen ist – über alle Bereiche hinweg und nach Dringlichkeit gruppiert: *Überfällig*, *Heute*, *Nächste 7 Tage*, *Später*, *Ohne Frist*. Ein Klick auf den Kreis hakt die Aufgabe ab: Der Haken zeichnet sich nach, der Titel wird durchgestrichen, die Zeile gleitet hinaus und die übrigen rücken nach. Dieselben Aufgaben stehen im **Kalender** (linke Navigation) an ihrem Fälligkeitstag, die Pläne im Überblick unter **Projekte**.

## Aufgaben in Seiten zeigen

Mit dem Makro **Aufgaben** (Slash-Menü `/aufgaben`, Gruppe *Makros*) erscheinen Aufgaben direkt in einer Seite, zum Beispiel im Projektsteckbrief. Über das Zahnrad wählst du den Plan und was angezeigt wird:

- **Offen** – alle noch nicht erledigten Aufgaben des Plans,
- **Nur mit dieser Seite verknüpfte** Aufgaben,
- **Alle** Aufgaben des Plans.

Wer im Bereich des Plans bearbeiten darf, kann Aufgaben dort direkt abhaken und neue anlegen. Wer den Bereich des Plans nicht sehen darf, sieht im Makro keine Aufgaben.

## Prüfaufgaben aus der Wiedervorlage

Ist in den Bereichseinstellungen ein Plan für die **Wiedervorlage** hinterlegt, legt Knowstead für überfällige Seitenprüfungen automatisch Aufgaben an („Seite prüfen: …“, Stichwort `wiedervorlage`). Erledigst du die Aufgabe, gilt die Seite als geprüft – und umgekehrt. Mehr im Kapitel **Wiedervorlage**.

> [!TIP]
> Bewährter Aufbau für Projekte: eine Seite **Projektsteckbrief** (Ziel, Rahmen, Beteiligte) mit dem Aufgaben-Makro, darunter Unterseiten für Protokolle und Entscheidungen – und ein Plan im selben Bereich.
