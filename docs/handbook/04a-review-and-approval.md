---
title: Review and approval
icon: ✅
---

# Review and approval

Important pages should not be published unreviewed – and a mistake should be quick to undo. Knowstead handles both with two tools: the **review** and **recent changes**.

<!-- toc -->

## Requesting a review

1. Open the page and choose **Request review** in the **"…"** menu.
2. Optionally select a reviewer – without a selection the request goes to the space's editorial team (all space administrators).
3. Add a short message ("Please proofread section 2") and send it.

The page then carries the banner **In review**. It remains visible and editable for everyone – the review blocks nothing, it only makes the state traceable.

## Mandatory review for a whole space

In the **space settings** you can turn on **"Changes must be approved"**. Then:

- Every change by a person **without** review permission automatically creates a review request.
- Whoever may review approves their own change directly.
- In the space directory you recognise such spaces by the check mark icon.

> [!TIP]
> This is suitable for policies, work instructions and everything that is binding. For lively team notes, voluntary review is usually more pleasant.

## Reviewing: approve or reject

Open requests collect under **Review requests** in the main menu (with a counter as soon as something is pending). Everyone with the **Moderate** permission in the space and the **assigned reviewer** may decide – even without moderation permission. There and directly on the page there are two buttons:

| Action | Effect |
| --- | --- |
| **Approve** | The page receives the green banner **Approved** with name and time. |
| **Reject** | The page is marked **Needs revision**; the reason appears in the banner and the notification. |

Before deciding, **Compare** helps: it shows exactly what has changed since the last version.

> [!NOTE]
> **Four-eyes principle:** whoever requests a review cannot approve it themselves – not even if they enter themselves as reviewer. People with moderation permission, however, approve their own changes directly in spaces with mandatory review.

If a new version appears after an approval, the notice **"There is already a newer version"** is shown – an approval always refers to a specific version.

> [!TIP]
> An approval also counts as a review for the **review schedule**: the page's review interval starts again (see chapter **Review schedule**).

## Multi-stage approval workflows

Some documents need more than one pair of eyes – for example **department → quality management → publication**. For this, the space administrators set up an approval workflow under **Space settings → Approvals**:

1. Turn on **Use approval workflow**.
2. For each **stage** define a name, the **approvers** (groups or people) and the number of **approvals required**. Use **Add stage** and the arrows to build the order.
3. Optional **escalation after days**: if a stage remains pending that long, Knowstead reminds the approvers and the space administrators.
4. Optional **Each stage by a different person**: whoever approved a stage cannot approve another stage of the same version – not even as a deputy.

The workflow applies to requested reviews and – with mandatory review turned on – to every change, including those by the space administrators. On the page a **progress bar** shows which stage is currently deciding and how many approvals are still missing ("1 of 2 approvals").

| Event | Effect |
| --- | --- |
| a stage reaches its approvals | the next stage is notified |
| last stage approved | the page is **Approved** |
| rejection in a stage | the request ends; the reason goes to the requester |
| new version during the workflow | the workflow starts again at the first stage |

> [!NOTE]
> If nobody can be reached in a stage (for example because the group is empty), the space administrators decide.

## Absence and deputies

So that approvals do not pile up during holidays, everyone enters their absences under **Profile → Deputy**: **Deputy**, **From**, **Until (inclusive)** and optionally a note.

- During this period the deputy may decide all approvals the absent person is assigned to. The button is then called **Approve for …**.
- The decision is recorded as "on behalf of …" – traceable in the approval history and the audit log.
- The deputy also receives notifications about new approvals.
- Under **I am deputising for** everyone sees for whom they are currently standing in. User management can also enter deputies for others.

## Undoing recent changes

**Main menu → Recent changes** shows the latest edits of all spaces you may see – 50 by default, adjustable up to 200.

For each entry:

- **Compare** – what exactly was changed?
- **Undo** – resets the page to the state **before** this change.

> [!NOTE]
> Undo deletes nothing: a **new** version with the old content is created. The undone version remains in the version history and can be restored at any time.

The list can be filtered by space; entries for pages in the trash are marked accordingly – you get those pages back via the space's **trash**.

## What is recorded where

| Place | Content |
| --- | --- |
| Page header | current review state with person and time |
| Review requests | all open and completed requests |
| Version history | every version with change note and author |
| Change log | all changes of a space |
| Notifications | request, approval and rejection |

<div data-type="changelog" data-limit="10"></div>
