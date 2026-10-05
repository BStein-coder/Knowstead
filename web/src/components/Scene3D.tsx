import { memo, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { cx } from './ui';
import { motionReduced } from '../lib/motion';

/**
 * Filmische 3D-Szene „Wissensraum“: Seiten schweben in der Tiefe und sind – wie im Seitenbaum und in der
 * Verknüpfungskarte – durch Linien verbunden. Die Kamera gleitet langsam, folgt leicht dem Zeiger und
 * fährt beim Scrollen in die Szene hinein.
 *
 * Technik: reine CSS-3D-Transformationen (kein WebGL, keine Bibliothek). Animiert werden nur `transform`
 * und `opacity`, die Arbeit erledigt die Grafikkarte; der Hauptthread bleibt frei. Die Szene ist Dekoration:
 * `aria-hidden`, nicht anklickbar, pausiert außerhalb des Bildes und im Leerlauf und steht bei reduzierter
 * Bewegung still – die Ruhestellung ist das gestaltete Standbild.
 */
export type SceneVariant = 'stage' | 'hero' | 'lost';

type Kind = 'home' | 'text' | 'table' | 'tasks' | 'code' | 'chart' | 'image';

interface NodeDef {
  id: string;
  parent?: string;
  x: number;
  y: number;
  z: number;
  /** Drehung um Y, X und Z in Grad */
  r: [number, number, number];
  /** Größenfaktor */
  s: number;
  kind: Kind;
  /** 2 = Detailstufe, die auf kleinen Flächen und schwachen Geräten entfällt */
  lod?: 2;
}

/** Komposition in Welt-Einheiten: x nach rechts, y nach unten, z zum Betrachter. Die Schärfeebene liegt bei z ≈ 0. */
const NODES: NodeDef[] = [
  { id: 'hub', x: -40, y: 10, z: 40, r: [12, -3, -1.5], s: 1.3, kind: 'home' },
  { id: 'n1', parent: 'hub', x: -400, y: -170, z: -160, r: [26, 5, -4], s: 1, kind: 'text' },
  { id: 'n2', parent: 'hub', x: 250, y: -215, z: -300, r: [-20, 7, 3], s: 1.05, kind: 'table' },
  { id: 'n3', parent: 'hub', x: -365, y: 205, z: 110, r: [24, -7, 3], s: 0.95, kind: 'tasks' },
  { id: 'n4', parent: 'hub', x: 215, y: 225, z: -90, r: [-17, -6, -2.5], s: 0.92, kind: 'code' },
  { id: 'n5', parent: 'hub', x: 520, y: 10, z: -470, r: [-28, 2, 2], s: 1, kind: 'chart' },
  { id: 'n6', parent: 'hub', x: -700, y: 20, z: -420, r: [32, 0, -2], s: 1, kind: 'image' },
  { id: 'n1a', parent: 'n1', x: -760, y: -330, z: -640, r: [34, 6, -5], s: 1, kind: 'text', lod: 2 },
  { id: 'n1b', parent: 'n1', x: -330, y: -420, z: -780, r: [18, 10, 3], s: 1, kind: 'code', lod: 2 },
  { id: 'n2a', parent: 'n2', x: 120, y: -430, z: -820, r: [-8, 10, -3], s: 1, kind: 'text', lod: 2 },
  { id: 'n2b', parent: 'n2', x: 560, y: -360, z: -900, r: [-26, 8, 4], s: 1, kind: 'tasks', lod: 2 },
  { id: 'n3a', parent: 'n3', x: -720, y: 350, z: -330, r: [30, -8, 4], s: 1, kind: 'text' },
  { id: 'n4a', parent: 'n4', x: 430, y: 400, z: -560, r: [-22, -9, -3], s: 1, kind: 'table', lod: 2 },
  { id: 'n5a', parent: 'n5', x: 840, y: -150, z: -980, r: [-34, 4, 3], s: 1, kind: 'text', lod: 2 },
  { id: 'n5b', parent: 'n5', x: 800, y: 250, z: -820, r: [-32, -5, -2], s: 1, kind: 'image' },
  { id: 'n6a', parent: 'n6', x: -1040, y: -160, z: -900, r: [38, 3, -3], s: 1, kind: 'chart', lod: 2 },
  // Vordergrund: groß, unscharf, angeschnitten – gibt dem Bild Tiefe
  { id: 'fg1', x: -900, y: 300, z: 300, r: [36, -6, 5], s: 1.15, kind: 'text' },
  { id: 'fg2', x: 700, y: -380, z: 280, r: [-34, 8, -4], s: 1.05, kind: 'table', lod: 2 },
  // Ferne
  { id: 'far1', x: -120, y: 420, z: -1050, r: [6, -10, 2], s: 1, kind: 'text', lod: 2 },
  { id: 'far2', x: 1100, y: 420, z: -1100, r: [-30, -8, -3], s: 1, kind: 'text', lod: 2 },
];

/**
 * Rahmen je Variante: das Band der Startseite ist breit und niedrig. Die Fehlerseite zeigt den Raum ohne
 * Mittelpunkt und ohne Verbindungen – die gesuchte Seite fehlt, die übrigen treiben lose.
 */
const FRAMES: Record<SceneVariant, { sx: number; sy: number; motes: number; lodMax: 1 | 2; hub: boolean; links: boolean }> = {
  stage: { sx: 1, sy: 1, motes: 26, lodMax: 2, hub: true, links: true },
  hero: { sx: 0.92, sy: 0.52, motes: 16, lodMax: 2, hub: true, links: true },
  lost: { sx: 1.08, sy: 0.62, motes: 14, lodMax: 2, hub: false, links: false },
};

const FOCUS_Z = 20;

/** Kleiner, reproduzierbarer Zufallsgenerator – die Szene sieht bei jedem Aufruf gleich aus. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

/** Unschärfe (px) und Deckkraft aus dem Abstand zur Schärfeebene – Tiefenschärfe und Dunst. */
function depthLook(z: number): { blur: number; opacity: number } {
  const blur = z > FOCUS_Z ? Math.max(0, (z - 80) / 55) : Math.max(0, (FOCUS_Z - z - 140) / 130);
  const opacity = z >= -100 ? (z > 200 ? 0.9 : 1) : Math.max(0.26, 1 + (z + 100) / 1150);
  return { blur: round(Math.min(blur, 5.5), 1), opacity: round(opacity) };
}

interface Built {
  nodes: { def: NodeDef; style: CSSProperties; cardStyle: CSSProperties }[];
  links: { key: string; lod?: 2; style: CSSProperties; pulse: CSSProperties }[];
  motes: { key: number; lod?: 2; style: CSSProperties }[];
}

function build(variant: SceneVariant): Built {
  const frame = FRAMES[variant];
  const rand = prng(variant === 'stage' ? 7 : variant === 'hero' ? 19 : 31);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const placed = NODES.filter((n) => (n.lod ?? 1) <= frame.lodMax && (frame.hub || n.kind !== 'home')).map((n) => ({ ...n, x: n.x * frame.sx, y: n.y * frame.sy }));
  const byId = new Map(placed.map((n) => [n.id, n]));

  const nodes = placed.map((def) => {
    const look = depthLook(def.z);
    const duration = between(9, 17);
    return {
      def,
      style: { '--x': round(def.x, 0), '--y': round(def.y, 0), '--z': def.z, '--ry': `${def.r[0]}deg`, '--rx': `${def.r[1]}deg`, '--rz': `${def.r[2]}deg` } as CSSProperties,
      cardStyle: {
        '--s': def.s,
        '--o': look.opacity,
        '--fd': `${round(duration, 1)}s`,
        '--fl': `${round(-between(0, duration), 1)}s`,
        '--fy': `${round(between(0.5, 1.3))}em`,
        '--fr': `${round(between(0.5, 1.7))}deg`,
        // Scharfe Karten bekommen gar keinen Filter – jeder Filter kostet eine eigene Ebene
        ...(look.blur > 0.2 ? { filter: `blur(${look.blur}px)` } : {}),
      } as CSSProperties,
    };
  });

  const links: Built['links'] = [];
  for (const child of frame.links ? placed : []) {
    const parent = child.parent ? byId.get(child.parent) : undefined;
    if (!parent) continue;
    const dx = child.x - parent.x;
    const dy = child.y - parent.y;
    const dz = child.z - parent.z;
    const full = Math.hypot(dx, dy, dz);
    // Linie beginnt und endet am Kartenrand, nicht in der Kartenmitte
    const trimStart = 105 * parent.s;
    const trimEnd = 100 * child.s;
    const length = full - trimStart - trimEnd;
    if (length < 60) continue;
    const ux = dx / full;
    const uy = dy / full;
    const uz = dz / full;
    const flat = Math.hypot(dx, dz);
    const yaw = (Math.atan2(-dz, dx) * 180) / Math.PI;
    const roll = (Math.atan2(dy, flat) * 180) / Math.PI;
    const midZ = (parent.z + child.z) / 2;
    const look = depthLook(midZ);
    const duration = between(5, 9);
    links.push({
      key: `${parent.id}-${child.id}`,
      lod: child.lod ?? parent.lod,
      style: {
        '--x': round(parent.x + ux * trimStart, 0),
        '--y': round(parent.y + uy * trimStart, 0),
        '--z': round(parent.z + uz * trimStart, 0),
        '--l': round(length, 0),
        '--yaw': `${round(yaw, 1)}deg`,
        '--roll': `${round(roll, 1)}deg`,
        '--o': round(look.opacity * 0.9),
      } as CSSProperties,
      pulse: { '--pd': `${round(duration, 1)}s`, '--pl': `${round(-between(0, duration), 1)}s` } as CSSProperties,
    });
  }

  const motes: Built['motes'] = [];
  for (let i = 0; i < frame.motes; i++) {
    const z = between(-950, 360);
    const near = z > 120;
    const duration = between(11, 23);
    motes.push({
      key: i,
      lod: i % 2 ? 2 : undefined,
      style: {
        '--x': round(between(-1050, 1050) * frame.sx, 0),
        '--y': round(between(-480, 480) * frame.sy, 0),
        '--z': round(z, 0),
        '--d': round(near ? between(18, 34) : between(5, 13), 0),
        '--o': round(near ? between(0.22, 0.4) : Math.max(0.25, depthLook(z).opacity * between(0.5, 0.9))),
        '--dx': round(between(-46, 46), 0),
        '--dy': round(between(-34, 34), 0),
        '--dz': round(between(-70, 70), 0),
        '--fd': `${round(duration, 1)}s`,
        '--fl': `${round(-between(0, duration), 1)}s`,
      } as CSSProperties,
    });
  }
  return { nodes, links, motes };
}

const built = new Map<SceneVariant, Built>();
function layout(variant: SceneVariant): Built {
  let b = built.get(variant);
  if (!b) {
    b = build(variant);
    built.set(variant, b);
  }
  return b;
}

const w = (...widths: number[]) => widths.map((width, i) => <i key={i} style={{ '--w': `${width}%` } as CSSProperties} />);

/** Inhalt einer Karte – angedeutet, wie die Seitentypen in Knowstead: Text, Tabelle, Aufgaben, Code, Diagramm, Bild. */
function CardBody({ kind }: { kind: Kind }): ReactNode {
  switch (kind) {
    case 'home':
      return <div className="sc-lines">{w(100, 94, 72, 98, 86, 58)}</div>;
    case 'table':
      return (
        <div className="sc-table">
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      );
    case 'tasks':
      return (
        <div className="sc-tasks">
          {[true, true, false, false].map((done, i) => (
            <span key={i} className={done ? 'done' : undefined}>
              <b />
              <i style={{ '--w': `${[78, 62, 86, 54][i]}%` } as CSSProperties} />
            </span>
          ))}
        </div>
      );
    case 'code':
      return (
        <div className="sc-code">
          <i data-c="k" style={{ '--w': '46%' } as CSSProperties} />
          <i data-c="s" style={{ '--w': '68%', '--ind': '1.2em' } as CSSProperties} />
          <i data-c="f" style={{ '--w': '52%', '--ind': '1.2em' } as CSSProperties} />
          <i data-c="n" style={{ '--w': '34%', '--ind': '2.4em' } as CSSProperties} />
          <i data-c="k" style={{ '--w': '24%' } as CSSProperties} />
        </div>
      );
    case 'chart':
      return (
        <>
          <div className="sc-chart">
            {[38, 62, 48, 84, 70].map((h, i) => (
              <i key={i} style={{ '--h': `${h}%` } as CSSProperties} />
            ))}
          </div>
          <div className="sc-lines">{w(88, 60)}</div>
        </>
      );
    case 'image':
      return (
        <>
          <div className="sc-image" />
          <div className="sc-lines">{w(92, 70, 46)}</div>
        </>
      );
    default:
      return <div className="sc-lines">{w(100, 92, 96, 70, 88, 54)}</div>;
  }
}

/** Nach so langer Zeit ohne Eingabe halten die Szenen an (die Startseite bleibt oft stundenlang offen). */
const IDLE_MS = 60_000;

export const Scene3D = memo(function Scene3D({ variant = 'stage', className, scroll }: { variant?: SceneVariant; className?: string; scroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = layout(variant);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rig = el.querySelector<HTMLElement>('.scene-rig');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let px = 0;
    let py = 0;
    let visible = true;
    let idle = false;
    let idleTimer = 0;

    const sync = () => {
      if (!visible) el.dataset.paused = 'hidden';
      else if (idle) el.dataset.paused = 'idle';
      else delete el.dataset.paused;
    };
    const wake = () => {
      if (idle) {
        idle = false;
        sync();
      }
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idle = true;
        sync();
      }, IDLE_MS);
    };

    // Kamera folgt dem Zeiger: zwei Zahlen am Kamera-Element, den weichen Nachlauf macht eine CSS-Transition
    const onMove = (e: PointerEvent) => {
      wake();
      if (!rig || e.pointerType === 'touch' || !fine.matches || motionReduced()) return;
      px = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      py = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        rig.style.setProperty('--px', px.toFixed(3));
        rig.style.setProperty('--py', py.toFixed(3));
      });
    };

    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 2 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 2;
    if (lowEnd) el.dataset.lite = '';

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    io?.observe(el);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
    window.addEventListener('scroll', wake, { passive: true, capture: true });
    window.addEventListener('touchstart', wake, { passive: true });
    wake();
    return () => {
      io?.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('scroll', wake, { capture: true });
      window.removeEventListener('touchstart', wake);
      window.clearTimeout(idleTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={cx('scene', `scene-${variant}`, className)} data-scene={variant} data-scroll={scroll ? '' : undefined} aria-hidden="true">
      <div className="scene-sky">
        <i />
        <i />
        <i />
      </div>
      <div className="scene-stage">
        <div className="scene-rig">
          <div className="scene-scroll">
            <div className="scene-dolly">
              <div className="scene-world">
                <div className="scene-floor" />
                {scene.links.map((link) => (
                  <div key={link.key} className={cx('scene-link', link.lod === 2 && 'lod-2')} style={link.style}>
                    <i style={link.pulse} />
                  </div>
                ))}
                {scene.nodes.map(({ def, style, cardStyle }) => (
                  <div key={def.id} className={cx('scene-node', def.lod === 2 && 'lod-2')} style={style}>
                    <div className={cx('scene-card', def.kind === 'home' && 'is-hub')} style={cardStyle}>
                      <div className="sc-head">
                        <span className="sc-ico">{def.kind === 'home' && <BookOpen />}</span>
                        <span className="sc-title" />
                      </div>
                      <CardBody kind={def.kind} />
                    </div>
                  </div>
                ))}
                {scene.motes.map((mote) => (
                  <i key={mote.key} className={cx('scene-mote', mote.lod === 2 && 'lod-2')} style={mote.style} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="scene-beam" />
      <div className="scene-vignette" />
      <div className="scene-grain" />
    </div>
  );
});
