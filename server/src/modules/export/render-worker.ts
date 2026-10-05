/** Worker-Thread zum Setzen von PDF- und Word-Dokumenten (rechenintensiv, blockiert sonst den Server). */
import { parentPort } from 'node:worker_threads';
import type { Block, ExportDocument, ExportTemplate } from './model.ts';
import { renderPdf } from './pdf.ts';
import { renderDocx } from './docx.ts';

interface Job {
  id: number;
  format: 'pdf' | 'docx';
  doc: ExportDocument;
  tpl: ExportTemplate;
}

/** Beim Übertragen werden Buffer zu Uint8Array – für die Renderer wieder Buffer daraus machen. */
function revive(blocks: Block[]): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      const raw = block.image.data as Uint8Array;
      block.image.data = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    } else if (block.type === 'quote' || block.type === 'callout') revive(block.blocks);
    else if (block.type === 'list') for (const item of block.items) revive(item.blocks);
    else if (block.type === 'table') for (const row of block.rows) for (const cell of row.cells) revive(cell.blocks);
  }
}

parentPort?.on('message', (job: Job) => {
  for (const chapter of job.doc.chapters) revive(chapter.blocks);
  const run = job.format === 'pdf' ? renderPdf(job.doc, job.tpl) : renderDocx(job.doc, job.tpl);
  run
    .then((data) => parentPort?.postMessage({ id: job.id, data }))
    .catch((err: unknown) => parentPort?.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) }));
});
