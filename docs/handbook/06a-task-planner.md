---
title: Task planner
icon: ✅
labels: [tasks, projects, planning, calendar]
---

# Task planner

<!-- toc -->

The task planner organises work packages in **boards** with columns – similar to Microsoft Planner, deliberately lean: every task has an assignee, a goal (description and checklist), a due date, a priority and progress. Boards belong to a space; whoever may edit there may also plan.

## Creating a board

1. In the space, click **Tasks** on the left.
2. Choose **New board**, enter a name and short description.
3. The columns are preset with *To do*, *In progress*, *Review* and *Done* – via the gear icon they can be renamed, coloured, added (up to 12) and sorted.

> [!NOTE]
> The **last column counts as "done"**: cards there are completed automatically, and whoever ticks off a task finds it in this column afterwards. If a column is deleted, its cards move to the first column.

## Capturing tasks

- **Quickly**: click **+** in the column, type a title, `Enter`.
- **In detail**: click the card and fill in the dialog:

| Field | Purpose |
| --- | --- |
| **Assignee** | A person with access to the space – they are notified |
| **Start / Due** | Period; overdue tasks are marked red |
| **Priority** | Low, Normal, High, Urgent |
| **Status and progress** | Open, In progress, Done plus a progress bar in percent. Either by hand on the slider or, with the switch **Progress from the checklist**, automatically from the share of completed items (4 items, 1 done = 25 %) |
| **Description** | Goal and background of the task – the *what* |
| **Chat** | Questions, status updates and agreements with @-mentions – the *who said what, when* (see below) |
| **Checklist** | Sub-steps to tick off (progress visible on the card) |
| **Tags** | e.g. `analysis`, `rollout` – as coloured badges on the card |
| **Page** | Links the task with a page, such as the project profile |
| **Dependencies** | Tasks this task waits for (see below) |
| **Repeat** | Daily, weekly, every 2 weeks, monthly, quarterly or yearly (see below) |

## Chat per task

To the right of the fields (below them on narrow screens) every task has a **chat** – for follow-up
questions, status updates and agreements that do not belong in the description. The column stays put
while you scroll through the fields; older messages scroll away inside it. It works like the comments
on a page:

- **@name** mentions a person; they receive a notification (and an email, if set up) that jumps
  straight into the task. After the **@** a list appears: first the people involved in the task (the
  assignee, whoever created it, everyone who has already written), then everyone else – keep typing to
  filter, **Enter** or a click selects, **Esc** closes only the list.
- People **without access** to the space are marked as such in the list. If you mention them anyway,
  Knowstead tells you after sending that they were not notified – they could not open the task.
- Anyone mentioned only when a message is **edited** is notified then; anyone already mentioned is not
  notified again. Clicking a mention opens that person's profile.
- Without a mention, the **assignee**, whoever **created** the task and everyone who has **already
  written** in the chat are informed about new messages.
- **Writing** requires at least the *Comment* role in the space – so people who cannot edit the task
  itself can still take part. Anyone who may only *read* reads along.
- Your own messages can be **edited** and **deleted** afterwards; space administrators may delete any
  message. Edits are marked as *edited*.
- New messages from others appear in the open dialog **without reloading**.

The card shows a counter (💬 3) with the number of messages; the CSV export has a *Messages* column.
The chat moves to the trash together with the task and comes back when it is restored; it disappears
with the task when it is deleted permanently.

**Spotting unread messages:** if others have written since you last looked into the chat, the counter
is highlighted in colour and carries a dot – on the card in the board and under *My tasks*. The tooltip
gives the number ("2 new messages in the chat"). As soon as you open the task the chat counts as read;
your own messages never count as unread.

> [!TIP]
> The **description** is the *what* – it is exported. The chat is the *who said what, when*. The
> search finds both; anything that should apply permanently still belongs in the description.

## Steering and coordinating

- **Drag and drop** moves cards between columns and changes the order. While dragging, the card is dimmed and tilts slightly, the target column lights up and a line shows where the card will land; when dropped it glides into place and the others slide up.
- **Ticking off on the card**: the circle left of the title completes the task – the tick draws itself, the title is struck through and the card glides into the last column. A second click reopens it (back to the first column). The column counters and the key figures above flash briefly. Only people who may edit in the space see the circle.
- **Several cards at once**: click them while holding **Ctrl** or **Shift**. A bar appears that sets the assignee, column, due date and priority for all selected cards, marks them done or moves them to the trash (at most 100 at a time).
- **Live**: if someone else changes something in the same board, it appears without reloading.
- **Search**: the normal search also finds tasks – by title, description, labels and the **messages in the chat**. The hit opens the card in its board; if the term is in the chat, the hit shows the excerpt with the person's name under *In the chat* and jumps to exactly that message.
- **Trash**: deleted tasks stay in the space trash and can be restored together with their dependencies. Maintenance removes them after the configured retention time.
- **Export**: the **Download plan as CSV** icon creates a table with all columns (title, column, status, progress, assignee, dates, priority, labels, checklist, predecessors, description, number of messages) – for meetings and reports.
- **Filters** at the top: *All*, *Mine*, *Open*, *Overdue*.
- **Board, list, timeline or calendar**: the list shows all tasks with column, assignee, due date, priority and progress in a table – handy for meetings. The timeline and the calendar give an overview of the dates (see below).
- Above the plan are four **key figures**: *Open*, *Due this week*, *Overdue* and *Done this week*. The numbers count up when the plan opens and flash when they change. The line below shows the number of tasks, the **share completed** and the **overdue** tasks.

## Timeline

The **timeline** (icon next to board and list) shows every task with a start or due date as a bar – like a lean Gantt chart:

- **Dragging a bar** moves the whole period, **dragging the ends** changes start or due date (with edit permission in the space).
- The **scale** can be switched between days, weeks and months; a line marks today.
- Tasks are grouped by column and shown in its colour, overdue ones in red. Tasks with only a due date appear as a marker on the due day.
- The filters at the top (All, Mine, Open, Overdue) apply here too. Tasks without dates are listed below; clicking a task opens it.

## Calendar

The **calendar** (icon next to the timeline) shows tasks with their **dates** – as a **month** or a **week**:

- The arrows page through, **Today** jumps back; the new grid slides in from the direction you page.
- A task with **start and due date** appears as a **continuous bar** across its whole period; a period across the weekend continues in the next row. With only one of the two dates it appears on that day. The colour shows the state: red if overdue or urgent, yellow for high priority, grey and struck through when done. If a day has more than three bars, **+n more** opens that day's list.
- On the right is the **list of the selected day** – today at first, including everything that is **overdue**. It tells apart what is **due** that day and what is **ongoing** ("until 23 Oct", on the first day "Starts · until …"). The circle in front completes the task, a click on the title opens it.
- Tasks **without a start and without a due date** do not appear in the calendar; a note below gives their number. The plan's filters apply here too.
- On a phone the grid shows only a dot on days with dates; the list below names them.

**Across all spaces:** under **Calendar** (left navigation) the same view shows all tasks. **Mine** shows what is assigned to you, **All** everything you may see. The overdue tasks in today's list come from every month. **Subscribe to calendar** (top right) brings the due dates into your calendar app (see below).

## Projects

Under **Projects** (left navigation) you find **all plans** of all spaces you may see, as cards – an overview of what is running:

| On the card | Meaning |
| --- | --- |
| **Status** | *Planning* (no tasks or nothing started yet), *In progress* or *Completed* (all tasks done) |
| **Ring** | Share of completed tasks; the arc draws itself when the page opens |
| **Next date** | The earliest open task with a due date – with the distance in days, red if the date has passed |
| **People** | Whoever has the most tasks first; "+n" for more |
| **Bottom line** | Completed out of all tasks and the latest due date |

At the top are the key figures *Active*, *Completed*, *On track* (share of running projects without overdue tasks) and *Due this month*. The filters (*All*, *Active*, *Planning*, *Completed*) and the search box narrow the cards; the search looks at plan name, space and description. A click on the card opens the plan. **New plan** first asks for the space and opens the dialog there.

> [!NOTE]
> A "project" here is a plan in the task area of a space – the same plans you create there. Plans in spaces you may not see do not appear.

## Motion

Ticks, cards and counters are deliberately lively: ticked cards glide into the last column, key figures count up, progress bars and rings grow from zero, cards and rows appear one after another. If that is too restless, switch off **Animations and 3D effects** in the user menu (or choose "Reduce motion" in the operating system) – everything is then in place immediately.

## Dependencies

As in Microsoft Planner Premium, tasks can **wait** for each other. In the task dialog under **Dependencies** you pick the task being waited for from the *Waiting for …* list – it appears right below. There you set the **dependency type**:

| Type | Meaning |
| --- | --- |
| **Finish → Start** | the task starts when the predecessor is finished (typical) |
| **Start → Start** | both start at the same time |
| **Finish → Finish** | both finish at the same time |
| **Start → Finish** | the task finishes when the predecessor starts |

The **lag** shifts by days (calendar days) – positive with a buffer, negative overlapping. A task can have up to 20 predecessors; Knowstead rejects cycles ("A waits for B, B waits for A").

**Across boards:** the predecessor may be in another board – even in another space, as long as you can see it. In the task dialog you first pick the board and then the task; the list shows the board behind the name. That way a sub-project depends on a milestone of the main plan. A waiting task is only moved if "move dependent tasks automatically" is on in **its own** board.

- **Dates are required for the arrows:** a task without a start and due date has no bar on the timeline and therefore no arrow – it is listed under *without date*, there with a small mark for its dependencies. The task dialog points this out. The dependency is still saved and shows as the **Waiting** badge.
- **Cards** with open predecessors carry the badge **Waiting** ("Waiting for: …"). A mark with a number also shows how many tasks are linked – on the predecessor as well. Hovering shows the names with the direction.
- The **timeline** draws arrows from the predecessor to the waiting task; the **Dependencies** icon shows and hides them. If a date does not fit the dependency, the arrow is marked red and the number of **scheduling conflicts** is shown at the top.
- **Move dependent tasks automatically** (switch when editing the board, on by default): if a task moves or becomes longer, the waiting tasks follow including their duration – across several levels. If you place a waiting task before its predecessor, it moves back behind it; a notice tells you so. Knowstead never moves anything forward. When turned off, conflicts are only marked; turning it on resolves existing conflicts.
- **Completed tasks** stay where they are. A completed predecessor no longer holds anyone up – even if its entered date is still in the future, you may bring the waiting task forward. If you reopen a completed task, Knowstead places it behind its open predecessors if necessary.

## Recurring tasks

For regular work – month-end closing, reviewing access rights, backup test – choose **Repeat** in the task dialog. A repeat icon appears on the card.

As soon as the task is **done**, Knowstead automatically creates the next one in the first column: same title, same assignee, start and due date shifted by the interval, checklist open again. If the task lies far in the past, the next date jumps into the future – missed dates are not made up.

> [!TIP]
> Without a due date, the next repetition counts from the day the task was completed.

## Reminders

Assignees are reminded **before the due date** and **once when overdue** – as a notification and, depending on the profile setting, by email. How early the reminder comes (on the due day, 1, 2 or 3 days or a week before, or not at all) is set by each person under **Profile & settings → Preferences**. The default is one day before.

## Subscribing to the calendar

Due dates can appear in your calendar application – Outlook, Apple Calendar, Google Calendar or Thunderbird:

1. Under **My tasks** or in the header of a board choose **Subscribe to calendar**.
2. **My tasks and reviews** (everything assigned to you and pages you are responsible for) or **Board "…"** (all open tasks of the board – handy as a team calendar).
3. **Generate link** and subscribe to the link in your calendar application:
   - **Outlook**: Calendar → *Add calendar* → *Subscribe from web* → paste link.
   - **Google Calendar**: *Other calendars* → **+** → *From URL* → paste link.
   - **Apple Calendar**: *File* → *New Calendar Subscription* → paste link – or directly **Open in calendar app**.

The calendar updates roughly every hour; tasks appear as all-day events with a link back to Knowstead.

> [!WARNING]
> The link works **without signing in** – do not share it. For security reasons it is only shown right after generating it. **Generate new link** invalidates the old one, **End subscription** blocks it immediately.

## My tasks

Under **My tasks** (left navigation, with counter) you see everything assigned to you – across all spaces and grouped by urgency: *Overdue*, *Today*, *Next 7 days*, *Later*, *No due date*. Clicking the circle ticks off the task: the tick draws itself, the title is struck through, the row glides out and the others move up. The same tasks appear in the **calendar** (left navigation) on their due date, and the plans at a glance under **Projects**.

## Showing tasks in pages

With the **Tasks** macro (slash menu `/tasks`, group *Macros*) tasks appear directly in a page, for example in the project profile. Via the gear icon you choose the board and what is shown:

- **Open** – all tasks of the board not yet done,
- **Only linked to this page**,
- **All** tasks of the board.

Whoever may edit in the board's space can tick off tasks right there and create new ones. Whoever may not see the board's space sees no tasks in the macro.

## Review tasks from the review schedule

If a board for the **review schedule** is set in the space settings, Knowstead automatically creates tasks for overdue page reviews ("Review page: …", tag `review-schedule`). Completing the task counts as reviewing the page – and vice versa. More in the chapter **Review schedule**.

> [!TIP]
> Proven structure for projects: a **project profile** page (goal, scope, participants) with the tasks macro, below it child pages for minutes and decisions – and a board in the same space.
