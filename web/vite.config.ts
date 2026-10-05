import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.KNOWSTEAD_BACKEND ?? 'http://localhost:3000';

/**
 * PDF.js braucht zur Laufzeit Zeichensatztabellen, Standardschriften und
 * WebAssembly-Module. Sie werden unter /pdfjs/ ausgeliefert: im Entwicklungsmodus
 * direkt aus node_modules, im Build als Kopie im Ausgabeverzeichnis.
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const folders = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  return {
    name: 'knowstead-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const [folder] = rel.split('/');
        const file = path.resolve(root, rel);
        if (!folders.includes(folder) || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const out = path.resolve(options.dir ?? 'dist', 'pdfjs');
      for (const folder of folders) {
        const src = path.join(root, folder);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(out, folder), { recursive: true });
      }
    },
  };
}

/**
 * Excalidraw lädt seine Schriften zur Laufzeit nach. Damit kein CDN nötig ist
 * (Content-Security-Policy, Betrieb ohne Internet), liegen sie unter /excalidraw/fonts.
 */
function excalidrawAssets(): Plugin {
  const require = createRequire(import.meta.url);
  // Paketeinstieg ist dist/prod/index.js – die Schriften liegen daneben
  const root = path.dirname(require.resolve('@excalidraw/excalidraw'));
  const fonts = path.join(root, 'fonts');
  return {
    name: 'knowstead-excalidraw-assets',
    configureServer(server) {
      server.middlewares.use('/excalidraw', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(root, rel);
        if (!file.startsWith(fonts + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      if (fs.existsSync(fonts)) fs.cpSync(fonts, path.resolve(options.dir ?? 'dist', 'excalidraw', 'fonts'), { recursive: true });
    },
  };
}

/**
 * Vorkomprimierte Fassungen (.br, .gz) der Text-Dateien erzeugen. Der Server liefert
 * sie direkt aus, ohne bei jeder Anfrage selbst zu komprimieren.
 */
function precompress(): Plugin {
  const TEXT = /\.(js|mjs|css|html|svg|json|map|txt|bcmap)$/i;
  return {
    name: 'knowstead-precompress',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname ?? '.', 'dist');
      if (!fs.existsSync(outDir)) return;
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          return entry.isDirectory() ? walk(full) : TEXT.test(entry.name) ? [full] : [];
        });
      for (const file of walk(outDir)) {
        const data = fs.readFileSync(file);
        if (data.length < 1024) continue;
        const brotli = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
        if (brotli.length < data.length * 0.9) fs.writeFileSync(`${file}.br`, brotli);
        const gzip = zlib.gzipSync(data, { level: 9 });
        if (gzip.length < data.length * 0.9) fs.writeFileSync(`${file}.gz`, gzip);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets(), excalidrawAssets(), precompress()],
  resolve: {
    // Excalidraw bringt über Abhängigkeiten React 18 in den Workspace-Root –
    // die Oberfläche muss aber genau eine React-Instanz (die eigene) verwenden.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      // ws: gemeinsame Bearbeitung (WebSocket unter /api/v1/collab)
      '/api': { target: backend, changeOrigin: false, ws: true },
      '/plugin-assets': { target: backend, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
