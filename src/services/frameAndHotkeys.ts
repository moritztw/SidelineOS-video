import type { HotkeyAktion, HotkeyBelegung, HotkeyScope } from '../types/video';

export const FPS = 25;
export const FRAME_MS = 1000 / FPS; // 40 ms Raster

export const STANDARD_HOTKEYS: HotkeyBelegung = {
  playPause: 'Space',
  stepBack: 'ArrowLeft',
  stepForward: 'ArrowRight',
  prevPlay: 'ArrowUp',
  nextPlay: 'ArrowDown',
  toggleFullscreen: 'KeyF',
  addNote: 'KeyN',
  toggleDraw: 'KeyD',
  deleteAnnotation: 'Delete',
  toggleBreakdownOverlay: 'KeyB',
  markCut: 'KeyI',
  fastCutReverse: 'KeyJ',
  fastCutPause: 'KeyK',
  fastCutForward: 'KeyL',
};

export const HOTKEY_SCOPES: Record<HotkeyAktion, HotkeyScope> = {
  playPause: 'GLOBAL',
  stepBack: 'GLOBAL',
  stepForward: 'GLOBAL',
  prevPlay: 'GLOBAL',
  nextPlay: 'GLOBAL',
  toggleFullscreen: 'GLOBAL',
  addNote: 'FILM_ROOM',
  toggleDraw: 'FILM_ROOM',
  deleteAnnotation: 'FILM_ROOM',
  toggleBreakdownOverlay: 'FILM_ROOM',
  markCut: 'FAST_CUT',
  fastCutReverse: 'FAST_CUT',
  fastCutPause: 'FAST_CUT',
  fastCutForward: 'FAST_CUT',
};

export const HOTKEY_SCOPE_LABELS: Record<HotkeyScope, { de: string; en: string }> = {
  GLOBAL: { de: 'Allgemeine Videosteuerung (Film Room, Sync & Fast-Cut)', en: 'Global Video Transport' },
  FILM_ROOM: { de: 'Film Room (Zeichnen, Notizen & Breakdown-Overlay)', en: 'Film Room' },
  FAST_CUT: { de: 'Fast-Cut & Schnitt (darf Film-Room-Tasten doppelt nutzen)', en: 'Fast-Cut' },
};

export const HOTKEY_AKTION_LABELS: Record<HotkeyAktion, { de: string; en: string }> = {
  playPause: { de: 'Wiedergabe / Pause', en: 'Play / Pause' },
  stepBack: { de: '1 Frame zurück (-40ms)', en: 'Step Back 1 Frame (-40ms)' },
  stepForward: { de: '1 Frame vor (+40ms)', en: 'Step Forward 1 Frame (+40ms)' },
  prevPlay: { de: 'Clip-Beginn / Vorheriger Clip', en: 'Clip Start / Previous Clip' },
  nextPlay: { de: 'Nächster Clip / Spielzug', en: 'Next Clip / Play' },
  toggleFullscreen: { de: 'Vollbild umschalten', en: 'Toggle Fullscreen' },
  addNote: { de: 'Coach-Notiz am Frame fokussieren', en: 'Focus Coach Note at Frame' },
  toggleDraw: { de: 'Zeichenleiste umschalten', en: 'Toggle Telestration Bar' },
  deleteAnnotation: { de: 'Ausgewählte Einzeichnung löschen', en: 'Delete Selected Drawing' },
  toggleBreakdownOverlay: { de: 'Breakdown-Overlay ein-/ausblenden', en: 'Toggle Breakdown Overlay' },
  markCut: { de: 'Fast-Cut Schnitt setzen', en: 'Fast-Cut Set Cut' },
  fastCutReverse: { de: 'Fast-Cut Rückwärts (-2x/-4x)', en: 'Fast-Cut Reverse' },
  fastCutPause: { de: 'Fast-Cut Pause', en: 'Fast-Cut Pause' },
  fastCutForward: { de: 'Fast-Cut Vorwärts (1x/2x/4x)', en: 'Fast-Cut Forward' },
};

const REINE_MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
  'Control',
  'Alt',
  'Shift',
  'Meta',
]);

export function istReineModifierTaste(codeOderKey: string): boolean {
  return REINE_MODIFIER_CODES.has(codeOderKey.trim());
}

/**
 * Quantisiert Millisekunden strikt auf das 25-fps-Raster (40 ms).
 */
export function msZuFrameIndex(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / FRAME_MS);
}

/**
 * Rechnet einen 25-fps-Frame-Index exakt in Millisekunden um.
 */
export function frameIndexZuMs(frameIndex: number): number {
  if (!Number.isFinite(frameIndex) || frameIndex <= 0) return 0;
  return Math.round(frameIndex) * FRAME_MS;
}

/**
 * Formatiert Millisekunden als `mm:ss.ff` (25 fps Frame-Zähler).
 */
export function formatiereFrameTimecode(ms: number): string {
  const frameIndex = msZuFrameIndex(ms);
  const gesamtSekunden = Math.floor(frameIndex / FPS);
  const frameRest = frameIndex % FPS;
  const minuten = Math.floor(gesamtSekunden / 60);
  const sekunden = gesamtSekunden % 60;
  return `${String(minuten).padStart(2, '0')}:${String(sekunden).padStart(2, '0')}.${String(frameRest).padStart(2, '0')}`;
}

/**
 * Exakter Frame-Vergleich ohne vorzeitiges Aufblitzen vor dem Ziel-Frame.
 */
export function hatExaktenFrameTreffer(aktuelleMs: number, zielFrameIndex: number): boolean {
  return msZuFrameIndex(aktuelleMs) === Math.max(0, Math.round(zielFrameIndex));
}

/**
 * Sucht strikt im aktuellen Frame-Fenster bzw. vorwärts den nächsten Auto-Stop-Frame.
 */
export function findeNaechstenAutoStopFrame(
  aktuelleMs: number,
  zielFrames: readonly number[],
  vorlaufMs = 0
): number | null {
  if (zielFrames.length === 0) return null;
  const aktuellerFrame = msZuFrameIndex(aktuelleMs);
  const maxUeberschreitungFrames = Math.max(0, Math.floor(vorlaufMs / FRAME_MS));

  const sortiert = Array.from(
    new Set(zielFrames.map((f) => Math.max(0, Math.round(f))))
  ).sort((a, b) => a - b);

  for (const ziel of sortiert) {
    if (ziel === aktuellerFrame) {
      return ziel;
    }
    if (ziel > aktuellerFrame && ziel - aktuellerFrame <= maxUeberschreitungFrames) {
      return ziel;
    }
  }
  return null;
}

/**
 * Ermittelt alle Auto-Stop-Ziel-Frames beim Überschreiten zwischen zwei Playback-Ticks.
 */
export function findeUeberfahrenenAutoStopFrame(
  vorherMs: number,
  jetztMs: number,
  zielFrames: readonly number[]
): number | null {
  if (zielFrames.length === 0 || jetztMs < vorherMs) return null;
  const startFrame = msZuFrameIndex(vorherMs);
  const endFrame = msZuFrameIndex(jetztMs);

  const sortiert = Array.from(
    new Set(zielFrames.map((f) => Math.max(0, Math.round(f))))
  ).sort((a, b) => a - b);

  for (const ziel of sortiert) {
    if (ziel > startFrame && ziel <= endFrame) {
      return ziel;
    }
  }
  return null;
}

function normalisiereEinzelTaste(raw: string): string {
  const bereinigt = raw.trim();
  if (!bereinigt) return '';
  const low = bereinigt.toLowerCase();
  if (bereinigt === ' ' || low === 'space' || low === 'spacebar') return 'Space';
  if (low === 'del' || low === 'delete') return 'Delete';
  if (low === 'backspace') return 'Backspace';
  if (low === 'arrowleft') return 'ArrowLeft';
  if (low === 'arrowright') return 'ArrowRight';
  if (low === 'arrowup') return 'ArrowUp';
  if (low === 'arrowdown') return 'ArrowDown';
  if (low === 'escape' || low === 'esc') return 'Escape';
  if (low === 'enter') return 'Enter';
  if (low === 'tab') return 'Tab';
  if (bereinigt.length === 1 && /[a-zA-Z]/.test(bereinigt)) {
    return `Key${bereinigt.toUpperCase()}`;
  }
  if (bereinigt.length === 1 && /[0-9]/.test(bereinigt)) {
    return `Digit${bereinigt}`;
  }
  return bereinigt;
}

/**
 * Normalisiert eine Tastenkombination (inkl. optionaler Modifier Ctrl / Alt / Shift)
 * in eine kanonische Form, z. B. "Ctrl+Shift+ArrowLeft" oder "Space".
 */
export function normalisiereTaste(codeOderKombination: string): string {
  const roh = codeOderKombination.trim();
  if (!roh) return '';
  if (roh === ' ') return 'Space';

  const teile = roh.split('+').map((t) => t.trim()).filter(Boolean);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let hauptTaste = '';

  for (const teil of teile) {
    const low = teil.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'strg' || low === 'meta' || low === 'cmd') {
      ctrl = true;
    } else if (low === 'alt' || low === 'option') {
      alt = true;
    } else if (low === 'shift' || low === 'umschalt') {
      shift = true;
    } else if (!istReineModifierTaste(teil)) {
      hauptTaste = normalisiereEinzelTaste(teil);
    }
  }

  if (!hauptTaste) return '';
  const praefixe: string[] = [];
  if (ctrl) praefixe.push('Ctrl');
  if (alt) praefixe.push('Alt');
  if (shift) praefixe.push('Shift');
  return [...praefixe, hauptTaste].join('+');
}

/**
 * Erzeugt eine kanonische Hotkey-Kombination direkt aus einem KeyboardEvent (inkl. Ctrl/Alt/Shift).
 * Gibt `null` zurück, wenn nur eine reine Modifier-Taste gedrückt wurde.
 */
export function kombinationAusKeyboardEvent(e: {
  code?: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string | null {
  const basis = (e.code || e.key || '').trim();
  if (!basis || istReineModifierTaste(basis)) {
    return null;
  }
  const haupt = normalisiereEinzelTaste(basis);
  if (!haupt) return null;

  const teile: string[] = [];
  if (e.ctrlKey || e.metaKey) teile.push('Ctrl');
  if (e.altKey) teile.push('Alt');
  if (e.shiftKey) teile.push('Shift');
  teile.push(haupt);
  return teile.join('+');
}

/**
 * Prüft exakt, ob ein KeyboardEvent (inkl. Ctrl/Alt/Shift-Zustand) einer Belegung entspricht.
 */
export function matchesHotkeyEvent(
  e: {
    code?: string;
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  belegung: string
): boolean {
  const gedrueckt = kombinationAusKeyboardEvent(e);
  const ziel = normalisiereTaste(belegung);
  if (!gedrueckt || !ziel) return false;
  return gedrueckt.toLowerCase() === ziel.toLowerCase();
}

function formatiereBasisTaste(code: string): string {
  if (!code) return '—';
  if (code === 'Space') return 'Leertaste';
  if (code === 'Delete') return 'Entf';
  if (code === 'Backspace') return '⌫';
  if (code === 'Escape') return 'Esc';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  return code;
}

export function formatiereHotkeyAnzeige(kombination: string): string {
  const norm = normalisiereTaste(kombination);
  if (!norm) return '—';
  return norm
    .split('+')
    .map((teil) => {
      if (teil === 'Ctrl') return 'Strg';
      if (teil === 'Alt') return 'Alt';
      if (teil === 'Shift') return 'Shift';
      return formatiereBasisTaste(teil);
    })
    .join(' + ');
}

/**
 * Prüft, ob zwei Hotkey-Aktionen im selben Sichtbarkeits-Scope liegen und sich deshalb nicht
 * dieselbe Taste teilen dürfen. FILM_ROOM und FAST_CUT dürfen sich Tasten teilen!
 */
export function habenHotkeyKonfliktScope(a: HotkeyAktion, b: HotkeyAktion): boolean {
  if (a === b) return false;
  const scopeA = HOTKEY_SCOPES[a];
  const scopeB = HOTKEY_SCOPES[b];
  if (scopeA === 'GLOBAL' || scopeB === 'GLOBAL') return true;
  return scopeA === scopeB;
}

export function aktualisiereBenutzerHotkey(
  aktuelleBelegung: HotkeyBelegung,
  aktion: HotkeyAktion,
  neueTasteRoh: string
): {
  ok: boolean;
  konfliktAktion?: HotkeyAktion;
  belegung: HotkeyBelegung;
} {
  const neueTaste = normalisiereTaste(neueTasteRoh);
  if (!neueTaste) {
    return { ok: false, belegung: aktuelleBelegung };
  }

  const eintraege = Object.entries(aktuelleBelegung) as Array<[HotkeyAktion, string]>;
  for (const [bestehendeAktion, belegteTaste] of eintraege) {
    if (
      habenHotkeyKonfliktScope(aktion, bestehendeAktion) &&
      normalisiereTaste(belegteTaste).toLowerCase() === neueTaste.toLowerCase()
    ) {
      return {
        ok: false,
        konfliktAktion: bestehendeAktion,
        belegung: aktuelleBelegung,
      };
    }
  }

  return {
    ok: true,
    belegung: {
      ...aktuelleBelegung,
      [aktion]: neueTaste,
    },
  };
}

/**
 * Berechnet das gewünschte Verhalten für "Beginn des Clips / Vorheriger Clip":
 * - Liegt der Playhead hinter dem Clip-Anfang (> 1 Frame), springt er zuerst auf 0 ms.
 * - Steht der Playhead bereits am Clip-Anfang (<= 1 Frame), wechselt er zum vorherigen Play.
 */
export function berechnePrevPlayOderClipStart(
  aktuelleMs: number,
  aktiverPlayIndex: number
): { aktion: 'clipStart'; zielMs: 0 } | { aktion: 'prevPlay'; zielIndex: number } {
  if (aktuelleMs > FRAME_MS) {
    return { aktion: 'clipStart', zielMs: 0 };
  }
  if (aktiverPlayIndex > 0) {
    return { aktion: 'prevPlay', zielIndex: aktiverPlayIndex - 1 };
  }
  return { aktion: 'clipStart', zielMs: 0 };
}

/**
 * Migriert alte Hotkey-Belegungen abwärtskompatibel auf das aktuelle Schema.
 */
export function bereinigeHotkeyBelegung(
  roh: Partial<Record<string, string>> | null | undefined
): HotkeyBelegung {
  const ergebnis: HotkeyBelegung = { ...STANDARD_HOTKEYS };
  if (!roh || typeof roh !== 'object') return ergebnis;

  for (const aktion of Object.keys(STANDARD_HOTKEYS) as HotkeyAktion[]) {
    const wert =
      aktion === 'markCut'
        ? roh.markCut ?? roh.markIn
        : roh[aktion];
    if (typeof wert === 'string' && wert.trim()) {
      const norm = normalisiereTaste(wert);
      if (norm) {
        ergebnis[aktion] = norm;
      }
    }
  }
  return ergebnis;
}

/**
 * Berechnet Position und Restdauer innerhalb des aktiven ungeschnittenen Videoabschnitts [cutStartMs .. totalDauerMs].
 */
export function berechneRestclipZeit(
  absoluteMs: number,
  cutStartMs: number,
  totalDauerMs: number
): {
  startMs: number;
  dauerMs: number;
  relativMs: number;
  geclamptAbsMs: number;
} {
  const startMs = Math.max(0, Math.round(cutStartMs / FRAME_MS) * FRAME_MS);
  const endeMs = Math.max(startMs + FRAME_MS, Math.round(totalDauerMs / FRAME_MS) * FRAME_MS);
  const geclamptAbsMs = Math.max(startMs, Math.min(endeMs, Math.round(absoluteMs / FRAME_MS) * FRAME_MS));
  return {
    startMs,
    dauerMs: Math.max(FRAME_MS, endeMs - startMs),
    relativMs: Math.max(0, geclamptAbsMs - startMs),
    geclamptAbsMs,
  };
}
