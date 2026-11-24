import { useRef, useState, type PointerEvent } from 'react';
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

type DragZustand =
  | { typ: 'neu'; start: Punkt2D; elementId: string }
  | { typ: 'verschieben'; id: string; letzterPunkt: Punkt2D }
  | { typ: 'pfeil_start'; id: string }
  | { typ: 'pfeil_ende'; id: string };

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function abstand(a: Punkt2D, b: Punkt2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function trefferTest(el: TelestrationElement, p: Punkt2D): boolean {
  switch (el.type) {
    case 'spotlight':
      return abstand(el.center, p) <= Math.max(el.radius, 0.04);
    case 'circle': {
      const dx = (p.x - el.center.x) / Math.max(el.radiusX, 0.03);
      const dy = (p.y - el.center.y) / Math.max(el.radiusY, 0.03);
      return dx * dx + dy * dy <= 1.25;
    }
    case 'arrow': {
      const len = abstand(el.start, el.end);
      if (len < 0.001) return abstand(el.start, p) < 0.03;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - el.start.x) * (el.end.x - el.start.x) +
            (p.y - el.start.y) * (el.end.y - el.start.y)) /
            (len * len)
        )
      );
      const proj = {
        x: el.start.x + t * (el.end.x - el.start.x),
        y: el.start.y + t * (el.end.y - el.start.y),
      };
      return abstand(p, proj) <= 0.03;
    }
    case 'text':
      return Math.abs(p.x - el.position.x) <= 0.14 && Math.abs(p.y - el.position.y) <= 0.05;
    case 'freehand':
      return el.points.some((pt) => abstand(pt, p) <= 0.03);
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragZustand | null>(null);
  const [textEingabe, setTextEingabe] = useState<{ pos: Punkt2D; wert: string } | null>(null);

  const holeNormalisiert = (e: PointerEvent<SVGSVGElement>): Punkt2D => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const p = holeNormalisiert(e);

    if (werkzeug === 'select') {
      const selektiert = elements.find((el) => el.id === selectedId);
      if (selektiert && selektiert.type === 'arrow') {
        if (abstand(selektiert.start, p) <= 0.028) {
          setDrag({ typ: 'pfeil_start', id: selektiert.id });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (abstand(selektiert.end, p) <= 0.028) {
          setDrag({ typ: 'pfeil_ende', id: selektiert.id });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }

      const treffer = [...elements].reverse().find((el) => trefferTest(el, p));
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

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag || readOnly) return;
    const p = holeNormalisiert(e);

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
              return {
                ...el,
                center: { x: clamp01(el.center.x + dx), y: clamp01(el.center.y + dy) },
              };
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

    // Neu zeichnen
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
          return {
            ...el,
            radius: Math.max(0.03, abstand(drag.start, p)),
          };
        }
        return el;
      })
    );
  };

  const handlePointerUp = () => {
    setDrag(null);
  };

  const spotlights = elements.filter((el) => el.type === 'spotlight');

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg
        ref={svgRef}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`h-full w-full ${
          readOnly ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'
        }`}
      >
        <defs>
          {spotlights.length > 0 && (
            <mask id="sideline-spotlight-mask">
              <rect x="0" y="0" width="1" height="1" fill="white" />
              {spotlights.map((sp) => (
                <circle
                  key={sp.id}
                  cx={sp.center.x}
                  cy={sp.center.y}
                  r={sp.radius}
                  fill="black"
                />
              ))}
            </mask>
          )}
        </defs>

        {spotlights.length > 0 && (
          <rect
            x="0"
            y="0"
            width="1"
            height="1"
            fill="rgba(0,0,0,0.58)"
            mask="url(#sideline-spotlight-mask)"
          />
        )}

        {elements.map((el) => {
          const istSelektiert = el.id === selectedId && !readOnly;
          if (el.type === 'freehand') {
            const d = el.points
              .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
              .join(' ');
            return (
              <path
                key={el.id}
                d={d}
                fill="none"
                stroke={el.color}
                strokeWidth={el.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={istSelektiert ? 0.85 : 1}
              />
            );
          }

          if (el.type === 'arrow') {
            const angle = Math.atan2(el.end.y - el.start.y, el.end.x - el.start.x);
            const headLen = 0.025;
            const p1 = {
              x: el.end.x - headLen * Math.cos(angle - Math.PI / 6),
              y: el.end.y - headLen * Math.sin(angle - Math.PI / 6),
            };
            const p2 = {
              x: el.end.x - headLen * Math.cos(angle + Math.PI / 6),
              y: el.end.y - headLen * Math.sin(angle + Math.PI / 6),
            };
            return (
              <g key={el.id}>
                <line
                  x1={el.start.x}
                  y1={el.start.y}
                  x2={el.end.x}
                  y2={el.end.y}
                  stroke={el.color}
                  strokeWidth={el.strokeWidth}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${el.end.x},${el.end.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                  fill={el.color}
                />
                {istSelektiert && (
                  <>
                    <circle cx={el.start.x} cy={el.start.y} r="0.012" fill="#FFFFFF" stroke="#0B0E11" strokeWidth="0.003" />
                    <circle cx={el.end.x} cy={el.end.y} r="0.012" fill="#F59E0B" stroke="#0B0E11" strokeWidth="0.003" />
                  </>
                )}
              </g>
            );
          }

          if (el.type === 'circle') {
            return (
              <ellipse
                key={el.id}
                cx={el.center.x}
                cy={el.center.y}
                rx={el.radiusX}
                ry={el.radiusY}
                fill="none"
                stroke={el.color}
                strokeWidth={el.strokeWidth}
                strokeDasharray={istSelektiert ? '0.012 0.008' : undefined}
              />
            );
          }

          if (el.type === 'spotlight') {
            return (
              <circle
                key={el.id}
                cx={el.center.x}
                cy={el.center.y}
                r={el.radius}
                fill="none"
                stroke={istSelektiert ? '#FFFFFF' : el.color}
                strokeWidth={el.strokeWidth}
              />
            );
          }

          return (
            <text
              key={el.id}
              x={el.position.x}
              y={el.position.y}
              fill={el.color}
              fontSize="0.036"
              fontWeight="700"
              stroke="#0B0E11"
              strokeWidth="0.002"
              paintOrder="stroke"
            >
              {el.text}
            </text>
          );
        })}
      </svg>

      {textEingabe && !readOnly && (
        <div
          className="pointer-events-auto absolute z-20 flex items-center gap-1 rounded-lg border border-[#F59E0B] bg-[#0B0E11] p-1.5"
          style={{
            left: `${Math.min(72, textEingabe.pos.x * 100)}%`,
            top: `${Math.min(82, textEingabe.pos.y * 100)}%`,
          }}
        >
          <input
            type="text"
            autoFocus
            value={textEingabe.wert}
            onChange={(e) => setTextEingabe({ ...textEingabe, wert: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && textEingabe.wert.trim()) {
                onChange([
                  ...elements,
                  {
                    id: `txt-${Date.now()}`,
                    type: 'text',
                    color: farbe,
                    strokeWidth: 0.002,
                    position: textEingabe.pos,
                    text: textEingabe.wert.trim(),
                  },
                ]);
                setTextEingabe(null);
              } else if (e.key === 'Escape') {
                setTextEingabe(null);
              }
            }}
            placeholder="Text + Enter"
            className="w-36 bg-transparent px-1.5 text-xs text-white focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
