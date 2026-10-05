---
title: Export and import
icon: 📦
---

# Export and import

<!-- toc -->

## Exporting pages

Via **… → Export …** on every page the export dialog opens:

| Format | Suitable for |
| --- | --- |
| **PDF** | sharing and archiving – with company template, cover page and table of contents |
| **Word (.docx)** | further editing in Word, e.g. for contracts or offers |
| **Markdown** | Git, Obsidian & co. – with front matter (title, version, tags, properties) |
| **HTML** | standalone, styled web page |

- **Include child pages**: for PDF and Word a document with all child pages as chapters is created; for Markdown and HTML a ZIP with the page tree. On a space's home page the option is called **Include all pages of the space**.
- **Cover page** (title, space, date, version, owners) and **table of contents** (from headings and child pages, with page numbers) can be deselected individually for PDF and Word. Fixed labels follow your language.
- **Print** in the same menu uses the browser's print dialog; navigation and controls are hidden.

### What ends up in the PDF and Word document

Headings, paragraphs, lists and task lists, tables, callouts, quotes, code, images and galleries, draw.io diagrams and whiteboards are included. Mermaid diagrams and formulas appear as source text, embedded PDFs and files as a note, the tasks macro as a reference to the online view. Open suggestions are not included. The design follows the administration's **export template** (logo, colour, header and footer).

> [!NOTE]
> A document contains at most 300 pages. It only contains pages and images you may see yourself.

## Exporting spaces

In **Space settings → Export & import**:

| Format | Content |
| --- | --- |
| Markdown (ZIP) | folder structure matching the page tree, attachments under `_anhaenge/`, relative links |
| HTML website (ZIP) | static website with table of contents – e.g. for offline sharing |
| Knowstead archive (ZIP) | complete archive including **all versions**, tags, properties and attachments – for migration between installations |
| **Manual as PDF or Word** | all pages of the space in one document with cover page, table of contents, header and footer according to the company template |

## Importing

In the space settings you can import:

- individual **Markdown, HTML or text files**,
- **ZIP archives** with folders (become page hierarchies, `index.md`/`README.md` become the folder page) and images (become attachments),
- **Knowstead archives** – including version history.

When importing Markdown, GitHub callouts (`> [!NOTE]`), task lists, tables, Mermaid diagrams and `<!-- toc -->` are converted into the corresponding Knowstead macros. Front matter fields `title`, `labels` and `properties` are taken over.

A Knowstead archive can also be imported as a **new space**: Administration → Spaces → "Import Knowstead archive".

## Moving from another wiki

Under **Space settings → Export & import → Take over from another wiki** you bring content from **Confluence**, **MediaWiki**, **DokuWiki** or **XWiki** into Knowstead – with page hierarchy, formatting, tables, images and files.

| Source | What you upload |
| --- | --- |
| **MediaWiki** | the XML file from *Special:Export* (or `dumpBackup.php`); with images as ZIP together with the `images` folder |
| **DokuWiki** | the `data` folder as ZIP – with `pages` and `media`, for the version history also `attic` and `meta` |
| **XWiki** | the XAR package from *Administration → Content → Export* |
| **Confluence** | the space export as ZIP – *Space settings → Export space* as **XML** (recommended: with page tree, attachments, labels and versions) or as **HTML** |

How to proceed:

1. Optionally choose a **target page** below which the imported pages are placed – otherwise they are created at the top level.
2. Leave the **source** on *Detect automatically* or set it.
3. Optionally **take over version history** (up to 50 versions per page).
4. **Choose file and import**. The import runs in the background – you can leave the page and are notified when it is finished.

**How large may it be?** A file up to 2 GB, an archive up to 8 GB unpacked with at most 100,000 files (a single attachment inside up to 512 MB). Knowstead reads the archive piece by piece from the server's disk – so even a large wiki does not need much memory, but it does need as much free disk space as the archive is large. If the archive is larger, split the export by spaces or namespaces.

Taken over are:

- **Hierarchy**: Confluence page tree, MediaWiki subpages (`Handbook/Installation`), DokuWiki namespaces and nested XWiki pages; levels without their own page become folder pages.
- **Content**: headings, formatting, lists, tables, code, callouts and internal links.
- **Confluence macros**: info, note, warning and tip boxes become callouts, code macros become code blocks, task lists become checklists, page links become internal links; macros that cannot be transferred appear as a note in the text.
- **Files** as attachments of the pages, **categories** or **labels** as tags.

At the end a **report** shows how many pages, files and versions were taken over – and which links point to pages not contained in the import (they are marked grey), as well as missing files.

> [!TIP]
> Try a large move in a test space first. Templates (MediaWiki) and script macros (XWiki) cannot be transferred – callout templates become callouts, others appear as a note in the text and can be reworked afterwards.
