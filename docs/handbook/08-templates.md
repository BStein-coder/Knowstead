---
title: Templates
icon: 🧩
---

# Templates

Templates ensure consistent, complete pages – from meeting minutes to runbooks.

<!-- toc -->

## Included templates

| Template | Purpose |
| --- | --- |
| Meeting minutes | Agenda, participants, decisions, tasks |
| How-to guide | Step-by-step instructions with prerequisites |
| Decision record (ADR) | Context, options, decision, consequences |
| Troubleshooting | Symptoms, cause, solution |
| Product requirements | Goals, user stories, open questions |
| Retrospective | What went well, what we improve, actions |
| Release notes (changelog) | Changes of a version in "Keep a Changelog" style |
| API documentation | Endpoints, authentication, examples |
| Project profile | Goals, team, milestones, risks – with properties |
| Process description | Roles, flow (diagram), change history |
| Onboarding checklist | Tasks for the first weeks |
| Runbook | Service overview, alerts, escalation |
| Daily note | Template for the journal |

## Placeholders

Title patterns and content can contain placeholders that are replaced when a page is created:

| Placeholder | Result (example) |
| --- | --- |
| `{{date}}` | 2026-09-11 |
| `{{time}}` | 14:30 |
| `{{weekday}}` | Friday |
| `{{week}}` | 37 |
| `{{month}}` / `{{year}}` | September / 2026 |
| `{{user}}` | name of the creating person |
| `{{me}}` | mention of the creating person (@Name) |
| `{{space}}` / `{{spacekey}}` | name / key of the space |

German placeholders (`{{datum}}`, `{{wochentag}}`, `{{benutzer}}`, `{{ich}}` …) work as well.

## Your own templates

- **Global** (for all spaces): Administration → Templates (permission "Manage global templates").
- **Per space**: Space settings → Templates.
- **From a page**: **… → Save as template** takes over content, tags and properties.

Templates can predefine tags and properties that every new page receives automatically.
