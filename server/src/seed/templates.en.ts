/** English versions of the built-in page templates – used for installations with English as default language. */
import type { BuiltinTemplate } from './templates.ts';

const history = '<h2>Change history</h2><div data-type="changelog" data-limit="15"></div>';

export const BUILTIN_TEMPLATES_EN: BuiltinTemplate[] = [
  {
    key: 'meeting',
    name: 'Meeting minutes',
    description: 'Record agenda, participants, decisions and tasks of a meeting.',
    icon: '🗓️',
    category: 'Collaboration',
    titlePattern: 'Meeting {{date}}',
    labels: ['minutes'],
    properties: [
      { name: 'Date', value: '{{date}}', type: 'date' },
      { name: 'Minutes', value: '{{user}}', type: 'text' },
    ],
    content: `<p><strong>Date:</strong> {{date}} · <strong>Minutes:</strong> {{me}} · <span data-type="status" data-color="blue">Draft</span></p>
<h2>Participants</h2><ul><li><p>@Name</p></li></ul>
<h2>Goals</h2><ul><li><p>What should be achieved by the end of the meeting?</p></li></ul>
<h2>Agenda</h2>
<table><tbody><tr><th><p>Time</p></th><th><p>Topic</p></th><th><p>Owner</p></th><th><p>Notes</p></th></tr>
<tr><td><p>10 min</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>
<tr><td><p>20 min</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Decisions</h2><div data-type="callout" data-variant="success"><p>Record decisions made here.</p></div>
<h2>Tasks</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task – owner – due</p></li></ul>
<h2>Next steps</h2><p></p>`,
  },
  {
    key: 'howto',
    name: 'How-to guide',
    description: 'Step-by-step instructions for a specific task.',
    icon: '🧭',
    category: 'Knowledge',
    titlePattern: 'How to: ',
    labels: ['how-to'],
    properties: [{ name: 'Audience', value: 'Everyone', type: 'text' }],
    content: `<div data-type="callout" data-variant="info"><p>Briefly describe what this guide explains and who it is for.</p></div>
<div data-type="toc"></div>
<h2>Prerequisites</h2><ul><li><p>Permission / access to …</p></li></ul>
<h2>Steps</h2><ol><li><p>First step</p></li><li><p>Second step</p></li><li><p>Third step</p></li></ol>
<div data-type="callout" data-variant="warning"><p>Common pitfall: …</p></div>
<h2>Result</h2><p>How can you tell that everything worked?</p>
<h2>Related pages</h2><ul><li><p></p></li></ul>
${history}`,
  },
  {
    key: 'decision',
    name: 'Decision record (ADR)',
    description: 'Document architecture or product decisions in a traceable way.',
    icon: '⚖️',
    category: 'Planning',
    titlePattern: 'Decision: ',
    labels: ['decision', 'adr'],
    properties: [
      { name: 'Status', value: 'proposed', type: 'status' },
      { name: 'Decision maker', value: '{{user}}', type: 'text' },
      { name: 'Date', value: '{{date}}', type: 'date' },
    ],
    content: `<p><span data-type="status" data-color="yellow">Proposed</span></p>
<h2>Context</h2><p>What problem should be solved? What constraints apply?</p>
<h2>Options</h2>
<table><tbody><tr><th><p>Option</p></th><th><p>Pros</p></th><th><p>Cons</p></th><th><p>Effort</p></th></tr>
<tr><td><p>A</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>
<tr><td><p>B</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Decision</h2><div data-type="callout" data-variant="note"><p>We decide on … because …</p></div>
<h2>Consequences</h2><ul><li><p>Positive: …</p></li><li><p>Negative / risks: …</p></li></ul>
${history}`,
  },
  {
    key: 'troubleshooting',
    name: 'Troubleshooting',
    description: 'Describe a known problem with symptoms, cause and solution.',
    icon: '🛠️',
    category: 'Knowledge',
    titlePattern: 'Problem: ',
    labels: ['troubleshooting'],
    properties: [
      { name: 'Affected system', value: '', type: 'text' },
      { name: 'Severity', value: 'medium', type: 'text' },
    ],
    content: `<h2>Problem</h2><p>Short description of the error.</p>
<h2>Symptoms</h2><ul><li><p>Error message: <code>…</code></p></li></ul>
<h2>Cause</h2><p></p>
<h2>Solution</h2><ol><li><p></p></li></ol>
<details><summary>Technical details</summary><div data-type="detailsContent"><pre><code class="language-bash"># Commands / log excerpts</code></pre></div></details>
<h2>Prevention</h2><p></p>`,
  },
  {
    key: 'requirements',
    name: 'Product requirements',
    description: 'Goals, user stories and requirements for a feature or product.',
    icon: '🎯',
    category: 'Planning',
    titlePattern: 'Requirements: ',
    labels: ['requirements'],
    properties: [
      { name: 'Status', value: 'Draft', type: 'status' },
      { name: 'Owner', value: '{{user}}', type: 'text' },
      { name: 'Target version', value: '', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Background</h2><p>Why is this important? What data or feedback supports it?</p>
<h2>Goals &amp; success criteria</h2><ul><li><p></p></li></ul>
<h2>User stories</h2>
<table><tbody><tr><th><p>#</p></th><th><p>As a …</p></th><th><p>I want …</p></th><th><p>so that …</p></th><th><p>Priority</p></th></tr>
<tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p><span data-type="status" data-color="red">Must</span></p></td></tr></tbody></table>
<h2>Out of scope</h2><ul><li><p></p></li></ul>
<h2>Open questions</h2><table><tbody><tr><th><p>Question</p></th><th><p>Answer</p></th><th><p>Date</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
${history}`,
  },
  {
    key: 'retro',
    name: 'Retrospective',
    description: 'What went well, what we improve – with concrete actions.',
    icon: '🔁',
    category: 'Collaboration',
    titlePattern: 'Retrospective {{date}}',
    labels: ['retrospective'],
    properties: [{ name: 'Sprint', value: '', type: 'text' }],
    content: `<p><strong>Date:</strong> {{date}} · <strong>Facilitation:</strong> {{me}}</p>
<div data-type="callout" data-variant="success"><p><strong>What went well?</strong></p><ul><li><p></p></li></ul></div>
<div data-type="callout" data-variant="warning"><p><strong>What can we improve?</strong></p><ul><li><p></p></li></ul></div>
<h2>Actions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Action – owner</p></li></ul>`,
  },
  {
    key: 'releasenotes',
    name: 'Release notes (changelog)',
    description: 'Changes of a version in the "Keep a Changelog" format.',
    icon: '🚀',
    category: 'Documentation',
    titlePattern: 'Version ',
    labels: ['changelog', 'release'],
    properties: [
      { name: 'Version', value: '1.0.0', type: 'text' },
      { name: 'Released', value: '{{date}}', type: 'date' },
    ],
    content: `<div data-type="callout" data-variant="info"><p>All notable changes of this version. Format based on <a href="https://keepachangelog.com/en/1.1.0/" target="_blank">Keep a Changelog</a>.</p></div>
<h2>Added</h2><ul><li><p></p></li></ul>
<h2>Changed</h2><ul><li><p></p></li></ul>
<h2>Fixed</h2><ul><li><p></p></li></ul>
<h2>Removed</h2><ul><li><p></p></li></ul>
<h2>Security</h2><ul><li><p></p></li></ul>`,
  },
  {
    key: 'apidoc',
    name: 'API documentation',
    description: 'Endpoints, authentication and examples of an interface.',
    icon: '🔌',
    category: 'Documentation',
    titlePattern: 'API: ',
    labels: ['api'],
    properties: [
      { name: 'Base URL', value: 'https://', type: 'url' },
      { name: 'Version', value: 'v1', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Overview</h2><p>What is the interface used for?</p>
<h2>Authentication</h2><pre><code class="language-http">Authorization: Bearer &lt;token&gt;</code></pre>
<h2>Endpoints</h2>
<table><tbody><tr><th><p>Method</p></th><th><p>Path</p></th><th><p>Description</p></th></tr>
<tr><td><p><span data-type="status" data-color="green">GET</span></p></td><td><p><code>/items</code></p></td><td><p>Retrieve list</p></td></tr>
<tr><td><p><span data-type="status" data-color="blue">POST</span></p></td><td><p><code>/items</code></p></td><td><p>Create entry</p></td></tr></tbody></table>
<h2>Example</h2><pre><code class="language-bash">curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/items</code></pre>
<pre><code class="language-json">{ "items": [] }</code></pre>
<h2>Error codes</h2><table><tbody><tr><th><p>Code</p></th><th><p>Meaning</p></th></tr><tr><td><p>401</p></td><td><p>Not signed in</p></td></tr></tbody></table>
${history}`,
  },
  {
    key: 'project',
    name: 'Project profile',
    description: 'Goals, team, milestones and risks of a project at a glance.',
    icon: '📋',
    category: 'Planning',
    titlePattern: 'Project: ',
    labels: ['project'],
    properties: [
      { name: 'Status', value: 'planned', type: 'status' },
      { name: 'Owner', value: '{{user}}', type: 'text' },
      { name: 'Start', value: '{{date}}', type: 'date' },
      { name: 'End', value: '', type: 'date' },
    ],
    content: `<h2>Goal</h2><p>What should the project achieve?</p>
<h2>Team</h2><ul><li><p>Project lead: {{me}}</p></li></ul>
<h2>Milestones</h2><table><tbody><tr><th><p>Milestone</p></th><th><p>Date</p></th><th><p>Status</p></th></tr>
<tr><td><p>Kick-off</p></td><td><p>{{date}}</p></td><td><p><span data-type="status" data-color="green">Done</span></p></td></tr>
<tr><td><p></p></td><td><p></p></td><td><p><span data-type="status" data-color="gray">Open</span></p></td></tr></tbody></table>
<h2>Risks</h2><table><tbody><tr><th><p>Risk</p></th><th><p>Probability</p></th><th><p>Impact</p></th><th><p>Mitigation</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Child pages</h2><div data-type="children" data-depth="1"></div>`,
  },
  {
    key: 'process',
    name: 'Process description',
    description: 'Flow, roles and responsibilities of a process – including diagram.',
    icon: '🔄',
    category: 'Documentation',
    titlePattern: 'Process: ',
    labels: ['process'],
    properties: [
      { name: 'Process owner', value: '{{user}}', type: 'text' },
      { name: 'Valid from', value: '{{date}}', type: 'date' },
      { name: 'Next review', value: '', type: 'date' },
    ],
    content: `<h2>Purpose</h2><p></p>
<h2>Scope</h2><p></p>
<h2>Roles</h2><table><tbody><tr><th><p>Role</p></th><th><p>Responsibility</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Flow</h2>
<div data-type="mermaid" data-code="flowchart LR
  A[Request] --&gt; B{Review}
  B -- ok --&gt; C[Approval]
  B -- question --&gt; A
  C --&gt; D[Implementation]"></div>
<ol><li><p>Step</p></li></ol>
${history}`,
  },
  {
    key: 'onboarding',
    name: 'Onboarding checklist',
    description: 'Structure the onboarding of new colleagues.',
    icon: '👋',
    category: 'Collaboration',
    titlePattern: 'Onboarding: ',
    labels: ['onboarding'],
    properties: [
      { name: 'Start date', value: '', type: 'date' },
      { name: 'Buddy', value: '', type: 'text' },
    ],
    content: `<div data-type="callout" data-variant="success"><p>Welcome to the team! This checklist guides you through the first weeks.</p></div>
<h2>Before the first day</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Hardware ordered</p></li><li data-type="taskItem" data-checked="false"><p>Accounts created</p></li></ul>
<h2>First week</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Meet the team</p></li><li data-type="taskItem" data-checked="false"><p>Check access</p></li><li data-type="taskItem" data-checked="false"><p>Watch important spaces in Knowstead</p></li></ul>
<h2>First month</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>First own project</p></li><li data-type="taskItem" data-checked="false"><p>Feedback meeting</p></li></ul>`,
  },
  {
    key: 'runbook',
    name: 'Runbook',
    description: 'Operating information, alerts and escalation for a service.',
    icon: '🚨',
    category: 'Documentation',
    titlePattern: 'Runbook: ',
    labels: ['runbook', 'operations'],
    properties: [
      { name: 'Service', value: '', type: 'text' },
      { name: 'On call', value: '', type: 'text' },
      { name: 'Criticality', value: 'high', type: 'text' },
    ],
    content: `<div data-type="toc"></div>
<h2>Service overview</h2><table><tbody><tr><th><p>Property</p></th><th><p>Value</p></th></tr>
<tr><td><p>Environment</p></td><td><p></p></td></tr><tr><td><p>Monitoring</p></td><td><p></p></td></tr><tr><td><p>Logs</p></td><td><p></p></td></tr></tbody></table>
<h2>Alerts</h2><details><summary>Alert: service unreachable</summary><div data-type="detailsContent"><ol><li><p>Check status</p></li><li><p>Restart</p></li></ol></div></details>
<h2>Escalation</h2><ol><li><p>On call</p></li><li><p>Team lead</p></li></ol>
${history}`,
  },
  {
    key: 'journal',
    name: 'Daily note',
    description: 'Template for the personal journal.',
    icon: '📝',
    category: 'Personal',
    titlePattern: '{{date}} {{weekday}}',
    labels: ['journal'],
    properties: [],
    content: `<h2>Focus for today</h2><ul><li><p></p></li></ul>
<h2>Tasks</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
<h2>Notes</h2><p></p>`,
  },
];
