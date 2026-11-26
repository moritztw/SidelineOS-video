import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type {
  Punkt2D,
  TelestrationElement,
  TelestrationWerkzeug,
} from '../types/video';

interface TelestrationCanvasProps {
  elements: TelestrationElement[];
  werkzeug: TelestrationWerkzeug;
  farbe: string;
  readOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: TelestrationElement[]) => void;
}

type Groesse = { width: number; height: number };

type DragZustand =
  | { typ: 'neu'; start: Punkt2D; elementId: string }
  | { typ: 'verschieben'; id: string; letzterPunkt: Punkt2D }
  | { typ: 'pfeil_start'; id: string }
  | { typ: 'pfeil_ende'; id: string };

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function abstandPx(a: Punkt2D, b: Punkt2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function zuPx(p: Punkt2D, groesse: Groesse): Punkt2D {
  return { x: p.x * groesse.width, y: p.y * groesse.height };
}

function trefferTestPx(el: TelestrationElement, pPx: Punkt2D, groesse: Groesse): boolean {
  const minDim = Math.min(groesse.width, groesse.height);
  switch (el.type) {
    case 'spotlight': {
      const c = zuPx(el.center, groesse);
      return abstandPx(c, pPx) <= Math.max(el.radius * minDim, 18);
    }
    case 'circle': {
      const c = zuPx(el.center, groesse);
      const rx = Math.max(el.radiusX * groesse.width, 14);
      const ry = Math.max(el.radiusY * groesse.height, 14);
      const dx = (pPx.x - c.x) / rx;
      const dy = (pPx.y - c.y) / ry;
      return dx * dx + dy * dy <= 1.25;
    }
    case 'arrow': {
      const s = zuPx(el.start, groesse);
      const e = zuPx(el.end, groesse);
      const len = abstandPx(s, e);
      if (len < 1) return abstandPx(s, pPx) < 14;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((pPx.x - s.x) * (e.x - s.x) + (pPx.y - s.y) * (e.y - s.y)) / (len * len)
        )
      );
      const proj = { x: s.x + t * (e.x - s.x), y: s.y + t * (e.y - s.y) };
      return abstandPx(pPx, proj) <= 14;
    }
    case 'text': {
      const pos = zuPx(el.position, groesse);
      return (
        pPx.x >= pos.x - 10 &&
        pPx.x <= pos.x + 220 &&
        pPx.y >= pos.y - 10 &&
        pPx.y <= pos.y + 48
      );
    }
    case 'freehand':
      return el.points.some((pt) => abstandPx(zuPx(pt, groesse), pPx) <= 14);
  }
}

export function TelestrationCanvas({
  elements,
  werkzeug,
  farbe,
  readOnly,
  selectedId,
  onSelect,
  onChange,
}: TelestrationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const maskId = `sideline-spotlight-${useId().replace(/:/g, '')}`;

  const [groesse, setGroesse] = useState<Groesse>({ width: 1280, height: 720 });
  const [drag, setDrag] = useState<DragZustand | null>(null);
  const [textEingabe, setTextEingabe] = useState<{
    pos: Punkt2D;
    wert: string;
    editId?: string;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setGroesse({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const holeNormalisiert = (clientX: number, clientY: number): Punkt2D => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const handleContainerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // Eingabefeld-Klicks nicht abfangen
    if ((e.target as HTMLElement).closest('[data-telestration-input="true"]')) return;

    const p = holeNormalisiert(e.clientX, e.clientY);
    const pPx = zuPx(p, groesse);

    if (werkzeug === 'select') {
      const selektiert = elements.find((el) => el.id === selectedId);
      if (selektiert && selektiert.type === 'arrow') {
        if (abstandPx(zuPx(selektiert.start, groesse), pPx) <= 14) {
          setDrag({ typ: 'pfeil_start', id: selektiert.id });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (abstandPx(zuPx(selektiert.end, groesse), pPx) <= 14) {
          setDrag({ typ: 'pfeil_ende', id: selektiert.id });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }

      const treffer = [...elements].reverse().find((el) => trefferTestPx(el, pPx, groesse));
      if (treffer) {
        onSelect(treffer.id);
        setDrag({ typ: 'verschieben', id: treffer.id, letzterPunkt: p });
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        onSelect(null);
      }
      return;
    }

    if (werkzeug === 'text') {
      setTextEingabe({ pos: p, wert: '' });
      return;
    }

    const id = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let neu: TelestrationElement;
    if (werkzeug === 'freehand') {
      neu = { id, type: 'freehand', color: farbe, strokeWidth: 0.005, points: [p] };
    } else if (werkzeug === 'arrow') {
      neu = { id, type: 'arrow', color: farbe, strokeWidth: 0.005, start: p, end: p };
    } else if (werkzeug === 'circle') {
      neu = {
        id,
        type: 'circle',
        color: farbe,
        strokeWidth: 0.005,
        center: p,
        radiusX: 0.01,
        radiusY: 0.01,
      };
    } else {
      neu = { id, type: 'spotlight', color: farbe, strokeWidth: 0.004, center: p, radius: 0.07 };
    }

    onChange([...elements, neu]);
    onSelect(id);
    setDrag({ typ: 'neu', start: p, elementId: id });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleContainerPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || readOnly) return;
    const p = holeNormalisiert(e.clientX, e.clientY);

    if (drag.typ === 'pfeil_start') {
      onChange(
        elements.map((el) =>
          el.id === drag.id && el.type === 'arrow' ? { ...el, start: p } : el
        )
      );
      return;
    }

    if (drag.typ === 'pfeil_ende') {
      onChange(
        elements.map((el) =>
          el.id === drag.id && el.type === 'arrow' ? { ...el, end: p } : el
        )
      );
      return;
    }

    if (drag.typ === 'verschieben') {
      const dx = p.x - drag.letzterPunkt.x;
      const dy = p.y - drag.letzterPunkt.y;
      setDrag({ ...drag, letzterPunkt: p });
      onChange(
        elements.map((el) => {
          if (el.id !== drag.id) return el;
          switch (el.type) {
            case 'spotlight':
            case 'circle':
              return {
                ...el,
                center: { x: clamp01(el.center.x + dx), y: clamp01(el.center.y + dy) },
              };
            case 'arrow':
              return {
                ...el,
                start: { x: clamp01(el.start.x + dx), y: clamp01(el.start.y + dy) },
                end: { x: clamp01(el.end.x + dx), y: clamp01(el.end.y + dy) },
              };
            case 'text':
              return {
                ...el,
                position: { x: clamp01(el.position.x + dx), y: clamp01(el.position.y + dy) },
              };
            case 'freehand':
              return {
                ...el,
                points: el.points.map((pt) => ({
                  x: clamp01(pt.x + dx),
                  y: clamp01(pt.y + dy),
                })),
              };
          }
        })
      );
      return;
    }

    const minDim = Math.min(groesse.width, groesse.height);
    onChange(
      elements.map((el) => {
        if (el.id !== drag.elementId) return el;
        if (el.type === 'freehand') {
          return { ...el, points: [...el.points, p] };
        }
        if (el.type === 'arrow') {
          return { ...el, end: p };
        }
        if (el.type === 'circle') {
          return {
            ...el,
            radiusX: Math.max(0.02, Math.abs(p.x - drag.start.x)),
            radiusY: Math.max(0.02, Math.abs(p.y - drag.start.y)),
          };
        }
        if (el.type === 'spotlight') {
          const distPx = abstandPx(zuPx(drag.start, groesse), zuPx(p, groesse));
          return {
            ...el,
            radius: Math.max(0.03, distPx / Math.max(1, minDim)),
          };
        }
        return el;
      })
    );
  };

  const handleContainerPointerUp = () => {
    setDrag(null);
  };

  const uebernehmeText = () => {
    if (!textEingabe) return;
    const bereinigt = textEingabe.wert.trim();
    if (textEingabe.editId) {
      if (bereinigt) {
        onChange(
          elements.map((el) =>
            el.id === textEingabe.editId && el.type === 'text'
              ? { ...el, text: bereinigt }
              : el
          )
        );
      } else {
        onChange(elements.filter((el) => el.id !== textEingabe.editId));
      }
    } else if (bereinigt) {
      const id = `txt-${Date.now()}`;
      onChange([
        ...elements,
        {
          id,
          type: 'text',
          color: farbe,
          strokeWidth: 0.002,
          position: textEingabe.pos,
          text: bereinigt,
        },
      ]);
      onSelect(id);
    }
    setTextEingabe(null);
  };

  const minDim = Math.min(groesse.width, groesse.height);
  const spotlights = elements.filter((el) => el.type === 'spotlight');
  const textBoxen = elements.filter((el) => el.type === 'text');

  return (
    <div
      ref={containerRef}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      className={`absolute inset-0 ${
        readOnly
          ? 'pointer-events-none'
          : werkzeug === 'select'
            ? 'pointer-events-auto cursor-default'
            : 'pointer-events-auto cursor-crosshair'
      }`}
    >
      {/* Isotropes Pixel-SVG ohne Seitenverhältnis-Streckung */}
      <svg
        viewBox={`0 0 ${groesse.width} ${groesse.height}`}
        className="h-full w-full block select-none"
      >
        <defs>
          {spotlights.length > 0 && (
            <mask id={maskId}>
              <rect x="0" y="0" width={groesse.width} height={groesse.height} fill="white" />
              {spotlights.map((sp) => {
                const c = zuPx(sp.center, groesse);
                return (
                  <circle
                    key={sp.id}
                    cx={c.x}
                    cy={c.y}
                    r={sp.radius * minDim}
                    fill="black"
                  />
                );
              })}
            </mask>
          )}
        </defs>

        {spotlights.length > 0 && (
          <rect
            x="0"
            y="0"
            width={groesse.width}
            height={groesse.height}
            fill="rgba(0,0,0,0.58)"
            mask={`url(#${maskId})`}
          />
        )}

        {elements.map((el) => {
          if (el.type === 'text') return null;
          const istSelektiert = el.id === selectedId && !readOnly;
          const strokePx = Math.max(2, Math.round(el.strokeWidth * minDim * 1.4));

          if (el.type === 'freehand') {
            const d = el.points
              .map((pt, i) => {
                const px = zuPx(pt, groesse);
                return `${i === 0 ? 'M' : 'L'} ${px.x.toFixed(1)} ${px.y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <path
                key={el.id}
                d={d}
                fill="none"
                stroke={el.color}
                strokeWidth={strokePx}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={istSelektiert ? 0.8 : 1}
              />
            );
          }

          if (el.type === 'arrow') {
            const s = zuPx(el.start, groesse);
            const e = zuPx(el.end, groesse);
            const angle = Math.atan2(e.y - s.y, e.x - s.x);
            const headLen = Math.max(12, strokePx * 3.4);
            const p1 = {
              x: e.x - headLen * Math.cos(angle - Math.PI / 6),
              y: e.y - headLen * Math.sin(angle - Math.PI / 6),
            };
            const p2 = {
              x: e.x - headLen * Math.cos(angle + Math.PI / 6),
              y: e.y - headLen * Math.sin(angle + Math.PI / 6),
            };
            return (
              <g key={el.id}>
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={e.x}
                  y2={e.y}
                  stroke={el.color}
                  strokeWidth={strokePx}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${e.x},${e.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                  fill={el.color}
                />
                {istSelektiert && (
                  <>
                    <circle cx={s.x} cy={s.y} r={6} fill="#FFFFFF" stroke="#0B0E11" strokeWidth={2} />
                    <circle cx={e.x} cy={e.y} r={6} fill="#F59E0B" stroke="#0B0E11" strokeWidth={2} />
                  </>
                )}
              </g>
            );
          }

          if (el.type === 'circle') {
            const c = zuPx(el.center, groesse);
            return (
              <ellipse
                key={el.id}
                cx={c.x}
                cy={c.y}
                rx={el.radiusX * groesse.width}
                ry={el.radiusY * groesse.height}
                fill="none"
                stroke={el.color}
                strokeWidth={strokePx}
                strokeDasharray={istSelektiert ? '8 6' : undefined}
              />
            );
          }

          const c = zuPx(el.center, groesse);
          return (
            <circle
              key={el.id}
              cx={c.x}
              cy={c.y}
              r={el.radius * minDim}
              fill="none"
              stroke={istSelektiert ? '#FFFFFF' : el.color}
              strokeWidth={strokePx}
            />
          );
        })}
      </svg>

      {/* Text immer als unverzerrte HTML-Textbox */}
      {textBoxen.map((el) => {
        const istSelektiert = el.id === selectedId && !readOnly;
        return (
          <div
            key={el.id}
            onPointerDown={(e) => {
              if (readOnly || werkzeug !== 'select') return;
              e.stopPropagation();
              onSelect(el.id);
              const p = holeNormalisiert(e.clientX, e.clientY);
              setDrag({ typ: 'verschieben', id: el.id, letzterPunkt: p });
              containerRef.current?.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={(e) => {
              if (readOnly) return;
              e.stopPropagation();
              setTextEingabe({ pos: el.position, wert: el.text, editId: el.id });
            }}
            className={`absolute z-10 max-w-[260px] rounded-md border bg-[#0B0E11]/90 px-2.5 py-1 text-xs font-semibold leading-snug shadow-sm backdrop-blur-xs whitespace-pre-wrap break-words ${
              readOnly
                ? 'pointer-events-none'
                : werkzeug === 'select'
                  ? 'pointer-events-auto cursor-move'
                  : 'pointer-events-none'
            } ${istSelektiert ? 'ring-1 ring-white' : ''}`}
            style={{
              left: `${Math.min(82, Math.max(1, el.position.x * 100))}%`,
              top: `${Math.min(86, Math.max(1, el.position.y * 100))}%`,
              borderColor: el.color,
              color: el.color,
            }}
          >
            {el.text}
          </div>
        );
      })}

      {textEingabe && !readOnly && (
        <div
          data-telestration-input="true"
          className="pointer-events-auto absolute z-30 flex items-center gap-1.5 rounded-lg border border-sl-accent bg-sl-canvas/95 p-1.5 shadow-lg"
          style={{
            left: `${Math.min(68, textEingabe.pos.x * 100)}%`,
            top: `${Math.min(80, textEingabe.pos.y * 100)}%`,
          }}
        >
          <input
            type="text"
            autoFocus
            value={textEingabe.wert}
            onChange={(e) => setTextEingabe({ ...textEingabe, wert: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                uebernehmeText();
              } else if (e.key === 'Escape') {
                setTextEingabe(null);
              }
            }}
            placeholder="Textbox-Text + Enter"
            className="w-44 bg-transparent px-1.5 text-xs text-sl-heading placeholder:text-sl-subtle focus:outline-none"
          />
          <button
            type="button"
            onClick={uebernehmeText}
            className="rounded bg-sl-accent px-2 py-0.5 text-[11px] font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}
