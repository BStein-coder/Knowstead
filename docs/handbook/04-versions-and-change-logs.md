---
title: Versions and change logs
icon: 🕓
---

# Versions and change logs

Traceability is a core principle of Knowstead: every published change creates a new **version** – nothing is lost.

<!-- toc -->

## Versions of a page

Open the version history via **… → Versions** (or <kbd>H</kbd>):

- Every version shows the **author**, **time**, **type of change** (created, edited, renamed, restored …) and the **change note**.
- **View** shows the page exactly as it looked in this version.
- **Compare** shows differences between two versions – **visually** (inserted text in green, removed text struck through in red) or as **source** (line diff).
- **Restore** takes over the content of an old version as a new version. The history remains complete.

> [!TIP]
> Good change notes are short and specific: "Added rollback instructions to chapter 3" instead of "Update". They appear in notifications, webhooks and the change log.

**Minor changes** (untick "Notify watchers") are versioned but do not trigger notifications and are hidden in the change log by default.

## Change log of a space

In every space you find **Change log** on the left. It lists all changes chronologically, grouped by day:

- new and edited pages with version and change note,
- moved, deleted and restored pages,
- uploaded and deleted attachments.

Filter by period and export the log as **Markdown** – e.g. for release notes, audits or handover to customers.

## Change history on the page

The **Change history** macro (`/change history`) shows the versions of a page as a table directly in the document – as known from policies and procedures:

<div data-type="changelog" data-limit="10"></div>

## Maintaining release notes and changelogs

For software releases Knowstead includes the template **Release notes (changelog)** in the style of *Keep a Changelog*. Build pipelines can add entries automatically via the REST API:

```bash
curl -X POST "$KNOWSTEAD/api/v1/pages/42/append" \
  -H "Authorization: Bearer $KNOWSTEAD_TOKEN" -H "Content-Type: application/json" \
  -d '{"format":"markdown","position":"start","content":"## 2.4.0\n- New export feature","changeNote":"Release 2.4.0"}'
```

## Activity and audit log

- **Activity** (sidebar on the home page) shows what happened recently in all spaces you have access to.
- The **audit log** (administration) additionally records security-relevant events: sign-ins, failed sign-in attempts, permission changes, tokens, settings and integrations – filterable and exportable as CSV.
