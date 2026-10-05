---
title: Search, tags and properties
icon: 🔎
---

# Search, tags and properties

<!-- toc -->

## Full-text search

The search covers titles, content and tags of all pages you may see. Results are sorted by relevance, matches highlighted. On the right you filter by space, tag and page type.

### Searching attachments

Knowstead also searches the **content of uploaded files**. Matching attachments appear to the right of the page results – with a text excerpt and the note **in content** if the term occurs in the file itself.

| Files | Searched |
| --- | --- |
| PDF | the contained text; scanned pages if the administrators have set up text recognition (OCR) |
| Images (PNG, JPEG, TIFF, BMP, GIF, WebP) | recognised text if text recognition is set up |
| Word, Excel, PowerPoint, Visio | text, worksheets, slides and notes |
| OpenDocument, RTF, HTML, text, CSV | the text |
| older Office formats (`.doc`, `.xls`, `.ppt`) | if the administrators have set up the Office preview |

New files can be found after a few seconds. You only find attachments of pages you may read, and always the latest version of a file.

### Tasks and their chat

Besides pages and attachments the search shows matching **tasks** from the boards of your spaces – found by title, description, labels and the **messages in the chat** of the task. Upper and lower case do not matter, not even for umlauts. If the term is in a message, the hit says **In the chat** with the person's name and the excerpt; a click opens the task and jumps to that message. Deleted messages and tasks in the trash do not appear.

### Search syntax

| Input | Meaning |
| --- | --- |
| `database backup` | pages containing both terms (word beginnings are enough) |
| `"backup and restore"` | exact phrase |
| `backup -test` | "backup", but not "test" |
| `backup OR restore` | one of the terms |
| `space:DEV` | only in the DEV space |
| `label:how-to` | only pages with the tag "how-to" |
| `author:max` | created or last changed by user "max" |
| `type:markdown` | only Markdown pages (`text`, `markdown`, `code`) |
| `in:title release` | search only in the title |
| `#Status` | pages with the property "Status" |
| `#Status=done` | property with a specific value |
| `#Priority>2` | numeric comparison (`>`, `<`, `>=`, `<=`, `!=`) |
| `#Owner~anna` | value contains "anna" |

Filters can be combined freely: `label:runbook space:OPS #Criticality=high database`.

## Tags (labels)

Tags organise pages across spaces. You add them below the page title (pencil icon) or directly below the title while editing. Clicking a tag shows all pages with this tag. Tags are lowercase; spaces become hyphens.

The **Tags** page in the left navigation shows all tags as a cloud or list with the number of pages – optionally for one space only. Administrators can **rename** tags there (if the new name already exists, both are **merged**) and **delete** them; the search is updated automatically.

> [!TIP]
> If the AI assistant is set up, it suggests matching tags via **… → AI assistant → Tags**, which you adopt with one click.

## Properties

Properties are structured **key-value pairs** of a page – for example `Status = in progress`, `Owner = Anna`, `Due = 2026-10-01`. They appear as a table below the content and can have a type (text, number, date, URL, status, yes/no).

The **Properties report** macro combines the properties of several pages into one table – for example all projects below "Projects" with status and owners. This creates a small, always up-to-date dashboard without maintaining tables.

> [!TIP]
> Templates can predefine properties. The "Project profile" template, for example, creates Status, Owner, Start and End.
