---
title: Spaces and pages
icon: 🗂️
---

# Spaces and pages

<!-- toc -->

## Spaces

A **space** bundles the pages of a team, project or topic – with its own permissions, templates, trash and change log. Every space has a short, unique **key** (e.g. `DEV`) that is used in addresses: `/s/DEV/…`.

When creating a space you choose the access:

| Preset | Meaning |
| --- | --- |
| **Open** | All signed-in users may read and edit |
| **Readable** | Everyone may read, only members may edit |
| **Private** | Only you – add further people or groups in the space settings |

The **home page** of a space ("Overview") is created automatically. It contains macros for child pages and recently changed pages and can be designed freely.

### Categories: departments, projects & co.

In the left navigation and in the space directory, spaces are grouped by **categories** – for example **Departments**, **Projects** or **Archive**. Spaces without a category appear under "Other spaces".

- **Giving a space a category**: when creating the space or later under **Space settings → General → Category**.
- **Adding, renaming, sorting or removing categories**: this is done by the administrators under **Administration → Spaces → Categories**. If a category is removed, its spaces remain.
- **Taking a space out of the navigation**: **Space settings → Archive & delete**. Archived spaces remain readable, deleted ones are gone for good.

### Space settings

Space administrators find under **Space settings**:

- **General** – name, description, icon, colour, category, home page, mandatory review, editing mode of new pages and **review schedule** (see chapter **Review schedule**)
- **Permissions** – roles for users, groups, all signed-in users or anonymous visitors
- **Members** – effective roles of all people (directly or via groups)
- **Approvals** – multi-stage approval workflow (see chapter **Review and approval**)
- **Restricted pages** – overview of all pages with restrictions
- **Templates** – space templates
- **Export & import** – export the space as a manual (PDF or Word), Markdown, HTML or Knowstead archive, import files and take over content from Confluence, MediaWiki, DokuWiki or XWiki
- **Archive & delete** – archived spaces are read-only

## Pages

Pages are organised hierarchically: every page can have any number of **child pages**. There are three page types:

| Type | Suitable for |
| --- | --- |
| **Document** (rich text) | Most content – with macros, tables, images |
| **Markdown** | Technical documentation that is also read outside Knowstead |
| **Code** | Scripts, configurations, snippets with syntax highlighting and line numbers |

### Moving, copying, deleting

- **Move**: in the page tree via drag & drop (upper/lower edge = before/after, centre = as child page) or via **… → Move** – also to other spaces.
- **Copy**: via **… → Copy**, optionally with child pages, attachments and tags – also to another space or below another page.
- **Duplicate**: **… → Duplicate** creates a copy right next to the original with one click ("… (copy)", with attachments and tags) – ideal as a starting point for similar pages.
- **Delete**: moves the page including its child pages to the **trash**. It can be restored from there. After the configured period (default: 30 days) the trash is emptied automatically.

> [!WARNING]
> The home page of a space cannot be deleted. Set a different home page first.

### Page information and link map

Under **… → Page information** you see the ID, authors, views and incoming and outgoing links. The **Link map** tab shows the page's connections as an interactive graph – clicking a node opens the page.
