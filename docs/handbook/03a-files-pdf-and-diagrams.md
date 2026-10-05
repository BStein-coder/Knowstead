---
title: Files, PDF and diagrams
icon: 📎
labels: [files, pdf, drawio, whiteboard]
---

# Files, PDF and diagrams

<!-- toc -->

## Uploading files

Files belong directly to the page where they are needed:

- **Drag and drop**: drag a file from the file explorer into the editor – it lands where you let go.
- **Toolbar**: click the paper clip icon **File** and choose one or more files.
- **Slash menu**: `/pdf` inserts the macro **Show PDF / Office**, where you can select a file or upload it directly.

Knowstead decides how the file appears:

| File | Display in the page |
| --- | --- |
| Images | as an image (several images preferably as a **gallery**) |
| PDF | as a **PDF viewer** with paging, zoom, full screen and download |
| Word, Excel, PowerPoint, Visio, OpenDocument | as a **file card** with preview (if set up) and download |
| Video and audio | as a **file card** with **Play** – the browser plays them in a window |
| everything else | as a **file card** with download |

Every uploaded file also appears under **Attachments** at the end of the page – with versions, comments and a trash for files.

> [!NOTE]
> Which file extensions are allowed and how large files may be is set by the administrators.

## Video and audio

Video and audio files (MP4, WebM, MP3, WAV, M4A and similar) get a **Play** button on the file card.
Knowstead opens a window with the browser's usual controls: play, pause, **seek**, volume and full screen.

The server delivers such files in ranges. Playback therefore starts immediately even for a large
recording, seeking on the timeline works, and an interrupted download resumes instead of starting over.

> [!NOTE]
> Which formats can be played is up to the browser. If it cannot handle a format, the window says so –
> the file can still be downloaded.

## PDF viewer

The PDF viewer shows documents directly in the page – without download and without browser extension:

- **Page** with the arrows or by entering the page number,
- **Zoom** with `+`/`−`; **Fit width** adapts the document to the column,
- **Full screen** for longer documents, **Download** for the original file.

In the editor you set via the gear icon which PDF is shown and how tall the viewer is. A file card of a PDF can be turned into a viewer with **Embed**.

## Office and Visio files

Knowstead shows PowerPoint (`.pptx`, `.ppt`), Word (`.docx`), Excel (`.xlsx`), Visio (`.vsdx`, `.vsd`) and OpenDocument files as a **preview** if LibreOffice is set up on the server. The file is then converted to PDF once and opened in the PDF viewer; the original remains unchanged.

If the preview is not set up, the file card offers the download.

> [!TIP]
> Presentations that should remain visible in a page can also be exported as PDF and uploaded – then everyone can page through them right in the page.

## draw.io diagrams

With draw.io you draw processes, network plans, organisation charts or architecture sketches directly in Knowstead:

1. Type `/drawio` in the editor and choose **draw.io diagram**.
2. **Edit diagram** opens the editor in full screen.
3. Draw, then **Save** (editor stays open) or **Save & exit**.

The diagram is stored as a graphic in the page and remains editable at any time. Since diagrams are part of the page content, changes appear in the **version history** and can be restored.

> [!NOTE]
> By default Knowstead loads the editor from `embed.diagrams.net`. The editor runs in your browser; the diagram is stored exclusively in Knowstead. The administrators can configure their own draw.io installation – then the editor works without any internet access.

For diagrams described as text (flowcharts, sequences, Gantt) there is still the **Mermaid diagram** – see chapter **Editor and macros**.

## Whiteboard

The **whiteboard** is the free sketching surface next to draw.io – ideal for collecting ideas, workshop results, rough processes or a quick drawing that does not need to be exact:

1. Type `/whiteboard` in the editor and choose **Whiteboard**.
2. **Open whiteboard** starts the drawing surface in full screen.
3. Draw: freehand, rectangles, circles, arrows, lines, text and images – all in hand-drawn style, freely movable and groupable.
4. Optionally give it a **title**, then **Save & close**.

The sketch appears as a graphic in the page and remains editable. Changes are recorded in the **version history**; when exporting to PDF or Word the whiteboard is included as a graphic.

> [!TIP]
> **draw.io** or **whiteboard**? For clean processes, network plans and organisation charts with exact shapes, draw.io is the right tool. For quick, loose sketches the whiteboard is faster.

> [!NOTE]
> The whiteboard runs entirely in Knowstead – without external services and without internet access. A sketch may be up to 4 MB; shrink large images beforehand.
