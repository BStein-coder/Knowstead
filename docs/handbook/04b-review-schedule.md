---
title: Review schedule
icon: 🔁
labels: [review-schedule, quality, ownership]
---

# Review schedule

Documentation goes stale quietly. The **review schedule** makes sure someone checks regularly: every page can have an **owner** and a **review interval** – for example "review every 12 months". Knowstead reminds in good time, shows due pages in one place and optionally connects the review with the task planner.

<!-- toc -->

## Setting ownership and interval

1. Open the page and choose **… → Ownership & review schedule**.
2. **Owner**: the person responsible for the content. They receive the reminders and are notified about the responsibility.
3. **Review interval**: 1, 3, 6, 12, 24 or 36 months – or **Space default** or **No review schedule**.

Whoever may edit the page may set this.

> [!TIP]
> For spaces with binding content (policies, work instructions, emergency plans) the space administrators set a **default**: **Space settings → General → Review schedule**. It applies to all pages without their own setting.

## How to recognise the state

In the page header a badge shows the state – clicking it opens the settings:

| Display | Meaning |
| --- | --- |
| **Reviewed** with date | last confirmed, next review not yet in sight |
| **Review by** with date | due within the next 14 days – additionally a notice above the content |
| **Review overdue since** with date | the deadline has passed |

## Confirming a page as up to date

If the content is still correct, **Confirm as up to date** is enough – in the notice above the content, in the overview or under **… → Ownership & review schedule**. The interval starts again.

The owner and everyone who may edit the page may confirm. A page also automatically counts as reviewed when

- the **owner publishes a change** that is not marked as minor,
- a **review is approved** (see chapter **Review and approval**),
- the associated **review task** in the task planner is completed.

If the content needs revision, edit the page as usual. If you are the owner, publishing confirms it at the same time.

## Reminders

- **14 days before** the due date and **when overdue**, the owner receives a notification – and, depending on the profile setting, an email.
- If nobody is responsible, the reminder goes to the person who last edited the page.
- Each reminder is sent only once per due date.

## Overview of due pages

**Review schedule** in the left navigation (with counter) collects all pages that should be reviewed – overdue ones first:

- **My pages** (for which you are responsible) or **All visible**,
- filters **Action needed**, **Overdue**, **Due soon** and **All**,
- per page the owner, interval, last and next review – and the **Confirm** button.

Your due dates also appear in the **calendar subscription** (see chapter **Task planner**).

## Connection to the task planner

In **Space settings → General → Review schedule** you can choose a board: **Create overdue reviews as tasks in …**. When a page becomes overdue, the task **Review page: …** is created there – with high priority, the owner, due date, tag `review-schedule` and a link to the page.

- Whoever confirms the page completes the task automatically.
- Whoever completes the task confirms the page.

> [!NOTE]
> This way reviews end up where teams plan their work anyway – with board, timeline, reminder and calendar.
