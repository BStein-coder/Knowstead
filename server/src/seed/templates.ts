/** Eingebaute Seitenvorlagen (werden beim ersten Start angelegt und können angepasst werden). */

export interface BuiltinTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  titlePattern: string;
  labels: string[];
  properties: { name: string; value: string; type: string }[];
  content: string;
}

const history = '<h2>Änderungshistorie</h2><div data-type="changelog" data-limit="15"></div>';

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: 'meeting',
    name: 'Besprechungsprotokoll',
    description: 'Agenda, Teilnehmende, Entscheidungen und Aufgaben einer Besprechung festhalten.',
    icon: '🗓️',
    category: 'Zusammenarbeit',
    titlePattern: 'Besprechung {{isodatum}}',
    labels: ['protokoll'],
    properties: [
      { name: 'Datum', value: '{{isodatum}}', type: 'date' },
      { name: 'Protokoll', value: '{{benutzer}}', type: 'text' },
    ],
    content: `<p><strong>Datum:</strong> {{datum}} · <strong>Protokoll:</strong> {{ich}} · <span data-type="status" data-color="blue">Entwurf</span></p>
<h2>Teilnehmende</h2><ul><li><p>@Name</p></li></ul>
<h2>Ziele</h2><ul><li><p>Was soll am Ende der Besprechung erreicht sein?</p></li></ul>
<h2>Agenda</h2>
<table><tbody><tr><th><p>Zeit</p></th><th><p>Thema</p></th><th><p>Verantwortlich</p></th><th><p>Notizen</p></th></tr>
<tr><td><p>10 Min.</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>
<tr><td><p>20 Min.</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Entscheidungen</h2><div data-type="callout" data-variant="success"><p>Getroffene Entscheidungen hier festhalten.</p></div>
<h2>Aufgaben</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Aufgabe – verantwortlich – bis wann</p></li></ul>
<h2>Nächste Schritte</h2><p></p>`,
  },
  {
    key: 'howto',
    name: 'Anleitung (How-to)',
    description: 'Schritt-für-Schritt-Anleitung für eine konkrete Aufgabe.',
    icon: '🧭',
    category: 'Wissen',
    titlePattern: 'Anleitung: ',
    labels: ['anleitung'],
    properties: [{ name: 'Zielgruppe', value: 'Alle', type: 'text' }],
    content: `<div data-type="callout" data-variant="info"><p>Kurz beschreiben, was diese Anleitung erklärt und für wen sie gedacht ist.</p></div>
<div data-type="toc"></div>
<h2>Voraussetzungen</h2><ul><li><p>Berechtigung / Zugang zu …</p></li></ul>
<h2>Schritte</h2><ol><li><p>Erster Schritt</p></li><li><p>Zweiter Schritt</p></li><li><p>Dritter Schritt</p></li></ol>
<div data-type="callout" data-variant="warning"><p>Häufige Stolperfalle: …</p></div>
<h2>Ergebnis</h2><p>Woran erkennt man, dass alles funktioniert hat?</p>
<h2>Verwandte Seiten</h2><ul><li><p></p></li></ul>
${history}`,
  },
  {
    key: 'decision',
    name: 'Entscheidungsdokument (ADR)',
    description: 'Architektur- oder Produktentscheidungen nachvollziehbar dokumentieren.',
    icon: '⚖️',
    category: 'Planung',
    titlePattern: 'Entscheidung: ',
    labels: ['entscheidung', 'adr'],
    properties: [
      { name: 'Status', value: 'vorgeschlagen', type: 'status' },
      { name: 'Entscheider', value: '{{benutzer}}', type: 'text' },
      { name: 'Datum', value: '{{isodatum}}', type: 'date' },
    ],
    content: `<p><span data-type="status" data-color="yellow">Vorgeschlagen</span></p>
<h2>Kontext</h2><p>Welches Problem soll gelöst werden? Welche Rahmenbedingungen gelten?</p>
<h2>Optionen</h2>
<table><tbody><tr><th><p>Option</p></th><th><p>Vorteile</p></th><th><p>Nachteile</p></th><th><p>Aufwand</p></th></tr>
<tr><td><p>A</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>
<tr><td><p>B</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Entscheidung</h2><div data-type="callout" data-variant="note"><p>Wir entscheiden uns für … weil …</p></div>
<h2>Konsequenzen</h2><ul><li><p>Positiv: …</p></li><li><p>Negativ / Risiken: …</p></li></ul>
${history}`,
  },
  {
    key: 'troubleshooting',
    name: 'Fehlerbehebung',
    description: 'Bekanntes Problem mit Symptomen, Ursache und Lösung beschreiben.',
    icon: '🛠️',
    category: 'Wissen',
    titlePattern: 'Fehler: ',
    labels: ['fehlerbehebung'],
    properties: [
      { name: 'Betroffenes System', value: '', type: 'text' },
      { name: 'Schweregrad', value: 'mittel', type: 'text' },
    ],
    content: `<h2>Problem</h2><p>Kurze Beschreibung des Fehlers.</p>
<h2>Symptome</h2><ul><li><p>Fehlermeldung: <code>…</code></p></li></ul>
<h2>Ursache</h2><p></p>
<h2>Lösung</h2><ol><li><p></p></li></ol>
<details><summary>Technische Details</summary><div data-type="detailsContent"><pre><code class="language-bash"># Befehle / Logauszüge</code></pre></div></details>
<h2>Vorbeugung</h2><p></p>`,
  },
  {
    key: 'requirements',
    name: 'Produktanforderungen',
    description: 'Ziele, User Stories und Anforderungen für ein Feature oder Produkt.',
    icon: '🎯',
    category: 'Planung',
    titlePattern: 'Anforderungen: ',
    labels: ['anforderungen'],
    properties: [
      { name: 'Status', value: 'Entwurf', type: 'status' },
      { name: 'Verantwortlich', value: '{{benutzer}}', type: 'text' },
      { name: 'Zielversion', value: '', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Hintergrund</h2><p>Warum ist das wichtig? Welche Daten oder Rückmeldungen stützen das?</p>
<h2>Ziele &amp; Erfolgskriterien</h2><ul><li><p></p></li></ul>
<h2>User Stories</h2>
<table><tbody><tr><th><p>#</p></th><th><p>Als …</p></th><th><p>möchte ich …</p></th><th><p>damit …</p></th><th><p>Priorität</p></th></tr>
<tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p><span data-type="status" data-color="red">Muss</span></p></td></tr></tbody></table>
<h2>Nicht im Umfang</h2><ul><li><p></p></li></ul>
<h2>Offene Fragen</h2><table><tbody><tr><th><p>Frage</p></th><th><p>Antwort</p></th><th><p>Datum</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
${history}`,
  },
  {
    key: 'retro',
    name: 'Retrospektive',
    description: 'Was lief gut, was verbessern wir – mit konkreten Maßnahmen.',
    icon: '🔁',
    category: 'Zusammenarbeit',
    titlePattern: 'Retrospektive {{isodatum}}',
    labels: ['retrospektive'],
    properties: [{ name: 'Sprint', value: '', type: 'text' }],
    content: `<p><strong>Datum:</strong> {{datum}} · <strong>Moderation:</strong> {{ich}}</p>
<div data-type="callout" data-variant="success"><p><strong>Was lief gut?</strong></p><ul><li><p></p></li></ul></div>
<div data-type="callout" data-variant="warning"><p><strong>Was können wir verbessern?</strong></p><ul><li><p></p></li></ul></div>
<h2>Maßnahmen</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Maßnahme – verantwortlich</p></li></ul>`,
  },
  {
    key: 'releasenotes',
    name: 'Versionshinweise (Changelog)',
    description: 'Änderungen einer Version im Format „Keep a Changelog“.',
    icon: '🚀',
    category: 'Dokumentation',
    titlePattern: 'Version ',
    labels: ['changelog', 'release'],
    properties: [
      { name: 'Version', value: '1.0.0', type: 'text' },
      { name: 'Veröffentlicht', value: '{{isodatum}}', type: 'date' },
    ],
    content: `<div data-type="callout" data-variant="info"><p>Alle wesentlichen Änderungen dieser Version. Format angelehnt an <a href="https://keepachangelog.com/de/1.1.0/" target="_blank">Keep a Changelog</a>.</p></div>
<h2>Hinzugefügt</h2><ul><li><p></p></li></ul>
<h2>Geändert</h2><ul><li><p></p></li></ul>
<h2>Behoben</h2><ul><li><p></p></li></ul>
<h2>Entfernt</h2><ul><li><p></p></li></ul>
<h2>Sicherheit</h2><ul><li><p></p></li></ul>`,
  },
  {
    key: 'apidoc',
    name: 'API-Dokumentation',
    description: 'Endpunkte, Authentifizierung und Beispiele einer Schnittstelle.',
    icon: '🔌',
    category: 'Dokumentation',
    titlePattern: 'API: ',
    labels: ['api'],
    properties: [
      { name: 'Basis-URL', value: 'https://', type: 'url' },
      { name: 'Version', value: 'v1', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Überblick</h2><p>Wofür wird die Schnittstelle genutzt?</p>
<h2>Authentifizierung</h2><pre><code class="language-http">Authorization: Bearer &lt;token&gt;</code></pre>
<h2>Endpunkte</h2>
<table><tbody><tr><th><p>Methode</p></th><th><p>Pfad</p></th><th><p>Beschreibung</p></th></tr>
<tr><td><p><span data-type="status" data-color="green">GET</span></p></td><td><p><code>/items</code></p></td><td><p>Liste abrufen</p></td></tr>
<tr><td><p><span data-type="status" data-color="blue">POST</span></p></td><td><p><code>/items</code></p></td><td><p>Eintrag anlegen</p></td></tr></tbody></table>
<h2>Beispiel</h2><pre><code class="language-bash">curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/items</code></pre>
<pre><code class="language-json">{ "items": [] }</code></pre>
<h2>Fehlercodes</h2><table><tbody><tr><th><p>Code</p></th><th><p>Bedeutung</p></th></tr><tr><td><p>401</p></td><td><p>Nicht angemeldet</p></td></tr></tbody></table>
${history}`,
  },
  {
    key: 'project',
    name: 'Projektsteckbrief',
    description: 'Ziele, Team, Meilensteine und Risiken eines Projekts auf einen Blick.',
    icon: '📋',
    category: 'Planung',
    titlePattern: 'Projekt: ',
    labels: ['projekt'],
    properties: [
      { name: 'Status', value: 'geplant', type: 'status' },
      { name: 'Verantwortlich', value: '{{benutzer}}', type: 'text' },
      { name: 'Start', value: '{{isodatum}}', type: 'date' },
      { name: 'Ende', value: '', type: 'date' },
    ],
    content: `<h2>Ziel</h2><p>Was soll mit dem Projekt erreicht werden?</p>
<h2>Team</h2><ul><li><p>Projektleitung: {{ich}}</p></li></ul>
<h2>Meilensteine</h2><table><tbody><tr><th><p>Meilenstein</p></th><th><p>Termin</p></th><th><p>Status</p></th></tr>
<tr><td><p>Kick-off</p></td><td><p>{{datum}}</p></td><td><p><span data-type="status" data-color="green">Erledigt</span></p></td></tr>
<tr><td><p></p></td><td><p></p></td><td><p><span data-type="status" data-color="gray">Offen</span></p></td></tr></tbody></table>
<h2>Risiken</h2><table><tbody><tr><th><p>Risiko</p></th><th><p>Wahrscheinlichkeit</p></th><th><p>Auswirkung</p></th><th><p>Maßnahme</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Unterseiten</h2><div data-type="children" data-depth="1"></div>`,
  },
  {
    key: 'process',
    name: 'Prozessbeschreibung',
    description: 'Ablauf, Rollen und Verantwortlichkeiten eines Prozesses – inkl. Diagramm.',
    icon: '🔄',
    category: 'Dokumentation',
    titlePattern: 'Prozess: ',
    labels: ['prozess'],
    properties: [
      { name: 'Prozessverantwortlich', value: '{{benutzer}}', type: 'text' },
      { name: 'Gültig ab', value: '{{isodatum}}', type: 'date' },
      { name: 'Nächste Prüfung', value: '', type: 'date' },
    ],
    content: `<h2>Zweck</h2><p></p>
<h2>Geltungsbereich</h2><p></p>
<h2>Rollen</h2><table><tbody><tr><th><p>Rolle</p></th><th><p>Verantwortung</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Ablauf</h2>
<div data-type="mermaid" data-code="flowchart LR
  A[Antrag] --&gt; B{Prüfung}
  B -- ok --&gt; C[Freigabe]
  B -- Rückfrage --&gt; A
  C --&gt; D[Umsetzung]"></div>
<ol><li><p>Schritt</p></li></ol>
${history}`,
  },
  {
    key: 'onboarding',
    name: 'Onboarding-Checkliste',
    description: 'Einarbeitung neuer Kolleginnen und Kollegen strukturieren.',
    icon: '👋',
    category: 'Zusammenarbeit',
    titlePattern: 'Onboarding: ',
    labels: ['onboarding'],
    properties: [
      { name: 'Startdatum', value: '', type: 'date' },
      { name: 'Buddy', value: '', type: 'text' },
    ],
    content: `<div data-type="callout" data-variant="success"><p>Willkommen im Team! Diese Checkliste hilft dir durch die ersten Wochen.</p></div>
<h2>Vor dem ersten Tag</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Hardware bestellt</p></li><li data-type="taskItem" data-checked="false"><p>Konten angelegt</p></li></ul>
<h2>Erste Woche</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Team kennenlernen</p></li><li data-type="taskItem" data-checked="false"><p>Zugänge prüfen</p></li><li data-type="taskItem" data-checked="false"><p>Wichtige Bereiche in Knowstead beobachten</p></li></ul>
<h2>Erster Monat</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Erstes eigenes Projekt</p></li><li data-type="taskItem" data-checked="false"><p>Feedbackgespräch</p></li></ul>`,
  },
  {
    key: 'runbook',
    name: 'Betriebshandbuch (Runbook)',
    description: 'Betriebsinformationen, Alarme und Eskalation für einen Dienst.',
    icon: '🚨',
    category: 'Dokumentation',
    titlePattern: 'Runbook: ',
    labels: ['runbook', 'betrieb'],
    properties: [
      { name: 'Dienst', value: '', type: 'text' },
      { name: 'Bereitschaft', value: '', type: 'text' },
      { name: 'Kritikalität', value: 'hoch', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Dienstübersicht</h2><table><tbody><tr><th><p>Eigenschaft</p></th><th><p>Wert</p></th></tr>
<tr><td><p>Umgebung</p></td><td><p></p></td></tr><tr><td><p>Monitoring</p></td><td><p></p></td></tr><tr><td><p>Logs</p></td><td><p></p></td></tr></tbody></table>
<h2>Alarme</h2><details><summary>Alarm: Dienst nicht erreichbar</summary><div data-type="detailsContent"><ol><li><p>Status prüfen</p></li><li><p>Neustart</p></li></ol></div></details>
<h2>Eskalation</h2><ol><li><p>Bereitschaft</p></li><li><p>Teamleitung</p></li></ol>
${history}`,
  },
  {
    key: 'journal',
    name: 'Tagesnotiz',
    description: 'Vorlage für das persönliche Journal.',
    icon: '📝',
    category: 'Persönlich',
    titlePattern: '{{isodatum}} {{wochentag}}',
    labels: ['journal'],
    properties: [],
    content: `<h2>Fokus für heute</h2><ul><li><p></p></li></ul>
<h2>Aufgaben</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
<h2>Notizen</h2><p></p>`,
  },
];
