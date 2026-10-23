---
title: Getting started
icon: 🚀
---

# Getting started

<!-- toc -->

## Signing in

Sign in with your username (or email address) and password. Depending on the setup, the sign-in page also offers buttons such as **Sign in with Microsoft** or **Sign in with Windows account** – then you do not need a separate Knowstead password (see the chapter **Permissions**).

## The user interface

Knowstead is divided into three zones:

- **Top bar**: search or command palette, **Create**, notifications, help and your user menu (profile, appearance, language, log out).
- **Sidebar** (left): on the home page you see the navigation (including **My tasks**, **Review requests** and **Review schedule**, each with a counter) and your spaces, grouped by categories such as "Departments" or "Projects". Inside a space it shows the **page tree** as well as overview, tasks, change log, trash and settings.
- **Content** (centre): the current page. Long pages show a table of contents on the right that follows you as you scroll.

> [!NOTE]
> Toggle the sidebar with <kbd>[</kbd>. In the editor it is hidden automatically so you can concentrate on the text. On a phone the menu icon at the top left opens it as a drawer; a tap beside it closes it again.

The navigation shows where you are with a **light marker** on the active entry. In the page tree a glowing line leads from the parent page to the open subpage.

## Tour and checklist

When you sign in for the first time, a short **tour** of the user interface starts. You can skip it at any time and repeat it later via **Help → Take the tour again**.

The home page also shows the **Getting started** list with small tasks (profile, space, first page, editor, search, handbook). It disappears once everything is done – or immediately via the cross.

## Creating your first page

1. Open a space (e.g. via **Spaces** in the sidebar).
2. Click **Create → New page** or the **+** next to "Pages".
3. Choose a **template** – or "Blank page", "Markdown page" or "Code page".
4. Enter a title and start writing. Type `/` to insert headings, tables, callouts and macros.
5. Optional: note at the bottom **what you changed**. This change note appears in the version history and the change log.
6. Click **Publish** (or <kbd>Ctrl</kbd> + <kbd>S</kbd>).

As long as you have not published, the page is a **draft** and only visible to you. Drafts are saved automatically – you will find them under **Drafts**.

## Navigating and finding

- **Command palette**: <kbd>Ctrl</kbd> + <kbd>K</kbd> – type, choose with the arrow keys, Enter.
- **Full-text search**: choose "Full-text search for …" in the command palette or open `/search`. Filters for space, tag and page type are available on the right.
- **Page tree**: expand and collapse branches, reorder via drag & drop, filter via the magnifier icon or **focus** a branch.
- **Breadcrumbs**: above every page you see the path to the page and can jump back with one click.

## Personal space and journal

Everyone can use a **personal space** (user menu → "Personal space"). Only you have access there, unless you share it.

Via **Create → Daily note** Knowstead automatically creates a page for today – organised by year and month (`Journal › 2026 › 09 September › 2026-09-11 Friday`). Ideal for notes, tasks and meeting notes.

## Appearance and language

In the user menu you choose **Light**, **Dark** or **System**, the **appearance** and the language (German/English). The settings are stored in your profile and apply on all devices – including emails and exports.

### Appearance: Classic, Glass, Paper, Frost

Besides the colour scheme (light/dark), the **appearance** decides how the interface is designed. It combines freely with Light and Dark, and your installation's accent colour is kept in every appearance.

| Appearance | Character |
| --- | --- |
| **Classic** | The default: plain and practical, floating glass layers for navigation and the top bar, calm cards. |
| **Glass** | Spacious and luminous: wide rounding, translucent cards with a bright edge in front of strong pools of light, large page titles, tabs as segments. |
| **Paper** | Warm and calm: a warm gradient as the ground, flat cards on paper, **ink** instead of the accent colour for main actions, active entries and tabs; the home page without the 3D scene. |
| **Frost** | Looks like glass but needs hardly any processing power: opaque surfaces with a bright edge and small shadows, a calm colour gradient as the ground, main actions with a solid edge at the bottom like a key. No blur, no 3D scene, no tilt towards the mouse pointer. Meant for older devices, terminal servers and virtual machines. |

You choose the appearance in the user menu under **Appearance** or in the profile under *Settings → Appearance*. The choice applies to your account on all devices; before you sign in, the choice last made on this device applies. Every combination reaches a contrast of **4.5 : 1** (WCAG AA); with *Motion and effects → Reduced* or "Reduce transparency" in the operating system, the blur behind the glass is dropped.

> [!TIP]
> **Does Knowstead feel sluggish** – in a terminal server, over remote access, on an older computer? Choose **Frost**. In measurements without a graphics card (software rendering), Frost needed about a sixth of Glass's processing work when scrolling the home page and stayed smooth where Classic and Glass stuttered – and nothing keeps running when idle. If you only want to get rid of the motion, switch off **Animations and 3D effects** in the user menu.

### Motion and 3D effects

The sign-in page, the home page and the error page show a **3D scene**: pages floating in space, connected
by lines like in the page tree. The camera glides slowly, follows the mouse pointer slightly and moves
into the scene as you scroll. There are also small movements in everyday use:

- The **home page** greets you with the date and key figures (spaces, pages, open tasks, new
  notifications). The numbers count up when the page opens; a click leads to the matching overview.
- **Tiles** (quick actions, spaces) tilt towards the mouse pointer, cards get a spotlight.
- Content **appears** with a short move when you change pages and when you scroll.
- In the page view a thin line below the breadcrumbs shows the **reading progress**.

If that is too restless for you, switch off **Animations and 3D effects** in the user menu (or choose
"Reduced" in the profile under *Settings → Motion and effects*). Everything is then in place immediately
and the scene stays as a still image. The choice applies to your account on all devices.

> [!NOTE]
> If **reduce motion** is switched on in the operating system, it always takes precedence – regardless of
> the setting in Knowstead. The scene is pure decoration: it cannot be clicked, screen readers skip it, and it
> stops as soon as it is out of view or nobody has entered anything for a minute.
