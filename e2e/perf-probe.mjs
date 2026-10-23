/**
 * Was kostet ein Aussehen? Misst im Browser, wie viel Arbeit die Oberfläche macht – im Leerlauf und beim Scrollen –
 * und stellt Klassisch, Glas, Papier und Frost nebeneinander. Gedacht für die Frage „läuft das auch auf einem
 * schwachen Rechner oder im Terminalserver?“: Der Browser wird auf Wunsch gebremst (Standard 4-fach), und die Zahlen
 * sind Vergleichswerte, keine Absolutwerte – sie hängen von Rechner und Grafikkarte ab.
 *
 * Gemessen wird je Aussehen und Ansicht:
 *  - Leerlauf (3 s ohne Eingabe): Anteil der Zeit, in der der Hauptthread arbeitet – Dauerbewegung (3D-Szene) fällt hier auf
 *  - Scrollen (3 s): Bilder pro Sekunde und Anteil der Bilder über 33 ms
 *  - Arbeit beim Scrollen laut Ablaufprotokoll des Browsers: alle Aufgaben aller Threads (CPU) und die Arbeit des
 *    Grafikprozesses (GPU) – je Sekunde Scrollen
 *
 * Mit `--software` startet der Browser ohne Grafikkarte (Software-Rendering wie in einem Terminalserver oder einer
 * virtuellen Maschine); dort kosten Unschärfe, Masken und große Schatten am meisten.
 *
 * Aufruf (die Oberfläche muss gebaut sein):
 *   node perf-probe.mjs [--look classic,glass,paper,frost] [--scheme light,dark] [--views home,board,page] [--throttle 4] [--repeat 3] [--software]
 */
import { chromium } from 'playwright';
import { startInstance } from './support/instance.mjs';
import { views } from './support/views.mjs';

const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const looks = option('look', 'classic,glass,paper,frost').split(',');
const schemes = option('scheme', 'light').split(',');
const wanted = option('views', 'home,board,page').split(',');
const throttle = Number(option('throttle', 4));
const repeats = Number(option('repeat', 3));
const software = args.includes('--software');

/* global document, requestAnimationFrame -- die folgende Funktion läuft im Browser */

/** Ein paar Sekunden lang abwechselnd nach unten und oben scrollen, jedes Bild messen */
function scrollFrames(ms) {
  return new Promise((resolve) => {
    const candidates = [document.querySelector('.main'), document.scrollingElement].filter(Boolean);
    const scroller = candidates.find((el) => el.scrollHeight > el.clientHeight + 40) ?? candidates[0];
    const deltas = [];
    const start = performance.now();
    let last = start;
    let direction = 1;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      scroller.scrollTop += direction * 18;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) direction = -1;
      else if (scroller.scrollTop <= 0) direction = 1;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve({ deltas: deltas.slice(1), scrolled: scroller.scrollHeight > scroller.clientHeight + 40 });
    };
    requestAnimationFrame(tick);
  });
}

const metric = (list, name) => list.find((m) => m.name === name)?.value ?? 0;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Arbeit des Grafikprozesses – die Namen stammen aus dem Ablaufprotokoll von Chromium
const GPU = new Set(['GPUTask', 'SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass', 'DirectRenderer::DrawRenderPass']);

const instance = await startInstance({ port: process.env.E2E_SCAN_PORT ?? 3895, ui: 'en' });
const rows = [];
let browser = null;
try {
  const { base, cookie, ids } = instance;
  const name = cookie.slice(0, cookie.indexOf('='));
  const value = cookie.slice(cookie.indexOf('=') + 1);
  browser = await chromium.launch({
    ...(channel ? { channel } : {}),
    ...(software ? { args: ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas'] } : {}),
  });
  const list = views(ids).filter(([view]) => wanted.includes(view));
  for (const look of looks) {
    for (const scheme of schemes) {
      for (const [view, url, storage] of list) {
        const samples = [];
        for (let run = 0; run < repeats; run++) {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'en-GB' });
          await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
          await context.addInitScript(
            ([lookName, schemeName, extra]) => {
              localStorage.setItem('knowstead.locale', 'en');
              localStorage.setItem('knowstead.theme', schemeName);
              localStorage.setItem('knowstead.appearance', lookName);
              // Volle Bewegung: Gemessen wird, was die Oberfläche im Normalbetrieb kostet
              localStorage.setItem('knowstead.motion', 'full');
              for (const [key, entry] of Object.entries(extra ?? {})) localStorage.setItem(key, entry);
            },
            [look, scheme, storage ?? null],
          );
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
          await page.goto(base + url, { waitUntil: 'networkidle', timeout: 60_000 });
          await page.waitForTimeout(1800);

          // Leerlauf
          const idle0 = (await cdp.send('Performance.getMetrics')).metrics;
          await page.waitForTimeout(3000);
          const idle1 = (await cdp.send('Performance.getMetrics')).metrics;
          const wall = metric(idle1, 'Timestamp') - metric(idle0, 'Timestamp');
          const idle = ((metric(idle1, 'TaskDuration') - metric(idle0, 'TaskDuration')) / wall) * 100;

          // Scrollen, mit Ablaufprotokoll
          await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'cc', 'viz'] });
          const { deltas, scrolled } = await page.evaluate(scrollFrames, 3000);
          const trace = JSON.parse((await browser.stopTracing()).toString());
          let cpuMs = 0;
          let gpuMs = 0;
          for (const event of trace.traceEvents) {
            if (event.ph !== 'X' || !event.dur) continue;
            if (event.name === 'RunTask') cpuMs += event.dur / 1000;
            if (GPU.has(event.name)) gpuMs += event.dur / 1000;
          }
          const total = deltas.reduce((a, b) => a + b, 0);
          samples.push({ idle, fps: (deltas.length / total) * 1000, slow: (deltas.filter((d) => d > 33.4).length / deltas.length) * 100, cpu: cpuMs / (total / 1000), gpu: gpuMs / (total / 1000), scrolled });
          await context.close();
        }
        const r = {
          look,
          scheme,
          view,
          idle: median(samples.map((s) => s.idle)),
          fps: median(samples.map((s) => s.fps)),
          slow: median(samples.map((s) => s.slow)),
          cpu: median(samples.map((s) => s.cpu)),
          gpu: median(samples.map((s) => s.gpu)),
          scrolled: samples[0].scrolled,
        };
        rows.push(r);
        console.log(`${look}-${scheme} ${view}: Leerlauf ${r.idle.toFixed(1)} %, ${r.fps.toFixed(0)} B/s, ${r.slow.toFixed(0)} % langsam, CPU ${r.cpu.toFixed(0)} ms/s, GPU ${r.gpu.toFixed(0)} ms/s`);
      }
    }
  }
} finally {
  await browser?.close();
  await instance.stop();
}

console.log('');
console.log(`Browser ${throttle}-fach gebremst${software ? ', ohne Grafikkarte (Software-Rendering)' : ''}, Median aus ${repeats} Läufen.`);
console.log('Leerlauf = Hauptthread-Last ohne Eingabe; langsam = Bilder über 33 ms beim Scrollen; CPU/GPU = Arbeit je Sekunde Scrollen (alle Threads bzw. Grafikprozess).');
console.log('');
console.log(`${'Aussehen'.padEnd(14)}${'Ansicht'.padEnd(8)}${'Leerlauf'.padStart(10)}${'Bilder/s'.padStart(10)}${'langsam'.padStart(10)}${'CPU ms/s'.padStart(10)}${'GPU ms/s'.padStart(10)}`);
for (const r of rows) {
  console.log(
    `${`${r.look}-${r.scheme}`.padEnd(14)}${r.view.padEnd(8)}${`${r.idle.toFixed(1)} %`.padStart(10)}${r.fps.toFixed(0).padStart(10)}${`${r.slow.toFixed(0)} %`.padStart(10)}${r.cpu.toFixed(0).padStart(10)}${r.gpu.toFixed(0).padStart(10)}${r.scrolled ? '' : '   (Seite zu kurz zum Scrollen)'}`,
  );
}
