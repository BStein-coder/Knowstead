/** Worker-Thread für die Textgewinnung aus Anhängen und die Seitenbilder eingescannter PDFs. */
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { extractText } from './textract.ts';
import { pdfPageImages } from './ocr.ts';

type Job =
  | { id: number; type?: 'text'; file: string; filename: string; mime: string }
  | { id: number; type: 'images'; file: string; outDir: string; maxPages: number };

parentPort?.on('message', (job: Job) => {
  const work =
    job.type === 'images'
      ? pdfPageImages(new Uint8Array(fs.readFileSync(job.file)), job.outDir, job.maxPages).then((files) => ({ files }))
      : extractText(job.file, job.filename, job.mime);
  work
    .then((result) => parentPort?.postMessage({ id: job.id, ...result }))
    .catch((err: unknown) => parentPort?.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) }));
});
