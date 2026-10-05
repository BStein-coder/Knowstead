import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Loading } from '../../components/ui';

interface GraphNode {
  id: number;
  title: string;
  icon: string | null;
  url: string;
  current: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: number;
  target: number;
  kind: 'link' | 'tree';
}

/** Kraftbasierte Link-Karte (wie Trilium „Note Map“) – ohne externe Bibliothek. */
export function LinkMap({ pageId }: { pageId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['graph', pageId],
    queryFn: () => api.get<{ nodes: Omit<GraphNode, 'x' | 'y' | 'vx' | 'vy'>[]; edges: GraphEdge[] }>(`/api/v1/pages/${pageId}/graph`, { depth: 2 }),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    const color = {
      text: styles.getPropertyValue('--text').trim() || '#1f2937',
      muted: styles.getPropertyValue('--text-faint').trim() || '#9ca3af',
      accent: styles.getPropertyValue('--accent').trim() || '#2563eb',
      bg: styles.getPropertyValue('--bg').trim() || '#fff',
      border: styles.getPropertyValue('--border-strong').trim() || '#d1d5db',
    };
    const nodes: GraphNode[] = data.nodes.map((n, i) => {
      const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
      const r = n.current ? 0 : 140 + Math.random() * 60;
      return { ...n, x: width / 2 + Math.cos(angle) * r, y: height / 2 + Math.sin(angle) * r, vx: 0, vy: 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = data.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
    let offsetX = 0;
    let offsetY = 0;
    let dragging: GraphNode | null = null;
    let panning: { x: number; y: number } | null = null;
    let raf = 0;
    let ticks = 0;

    const step = () => {
      const k = 0.02;
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = Math.max(dx * dx + dy * dy, 100);
          const f = 2200 / d2;
          a.vx += (dx / Math.sqrt(d2)) * f;
          a.vy += (dy / Math.sqrt(d2)) * f;
        }
      }
      for (const e of edges) {
        const a = byId.get(e.source)!;
        const b = byId.get(e.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 130) * k;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const n of nodes) {
        if (n === dragging) continue;
        n.vx += (width / 2 - n.x) * 0.002;
        n.vy += (height / 2 - n.y) * 0.002;
        n.vx *= 0.82;
        n.vy *= 0.82;
        if (n.current && ticks < 5) continue;
        n.x += n.vx;
        n.y += n.vy;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(offsetX, offsetY);
      for (const e of edges) {
        const a = byId.get(e.source)!;
        const b = byId.get(e.target)!;
        ctx.strokeStyle = e.kind === 'tree' ? color.border : color.muted;
        ctx.setLineDash(e.kind === 'tree' ? [4, 4] : []);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (e.kind === 'link') {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const tx = b.x - Math.cos(angle) * 10;
          const ty = b.y - Math.sin(angle) * 10;
          ctx.fillStyle = color.muted;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(angle - 0.4) * 7, ty - Math.sin(angle - 0.4) * 7);
          ctx.lineTo(tx - Math.cos(angle + 0.4) * 7, ty - Math.sin(angle + 0.4) * 7);
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const n of nodes) {
        ctx.fillStyle = n.current ? color.accent : color.bg;
        ctx.strokeStyle = n.current ? color.accent : color.border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.current ? 9 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color.text;
        const label = `${n.icon ? `${n.icon} ` : ''}${n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title}`;
        ctx.fillText(label, n.x, n.y + 22);
      }
      ctx.restore();
    };

    const loop = () => {
      if (ticks < 400 || dragging) {
        step();
        ticks++;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();

    const hit = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left - offsetX;
      const y = ev.clientY - rect.top - offsetY;
      return nodes.find((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < 14 ** 2) ?? null;
    };
    let moved = false;
    const onDown = (ev: MouseEvent) => {
      moved = false;
      dragging = hit(ev);
      if (!dragging) panning = { x: ev.clientX - offsetX, y: ev.clientY - offsetY };
    };
    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (dragging) {
        moved = true;
        dragging.x = ev.clientX - rect.left - offsetX;
        dragging.y = ev.clientY - rect.top - offsetY;
        ticks = Math.min(ticks, 300);
      } else if (panning) {
        moved = true;
        offsetX = ev.clientX - panning.x;
        offsetY = ev.clientY - panning.y;
      } else {
        canvas.style.cursor = hit(ev) ? 'pointer' : 'grab';
      }
    };
    const onUp = (ev: MouseEvent) => {
      const target = dragging;
      dragging = null;
      panning = null;
      if (!moved) {
        const n = target ?? hit(ev);
        if (n && !n.current) navigate(n.url);
      }
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [data, navigate]);

  if (isLoading) return <Loading />;
  return <canvas ref={canvasRef} className="graph-canvas" />;
}
