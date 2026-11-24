import type { HotkeyAktion, HotkeyBelegung } from '../types/video';

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
  markCut: 'KeyI',
  fastCutReverse: 'KeyJ',
  fastCutPause: 'KeyK',
  fastCutForward: 'KeyL',
};

export const HOTKEY_AKTION_LABELS: Record<HotkeyAktion, { de: string; en: string }> = {
  playPause: { de: 'Wiedergabe / Pause', en: 'Play / Pause' },
  stepBack: { de: '1 Frame zurück (-40ms)', en: 'Step Back 1 Frame (-40ms)' },
  stepForward: { de: '1 Frame vor (+40ms)', en: 'Step Forward 1 Frame (+40ms)' },
  prevPlay: { de: 'Vorheriger Spielzug', en: 'Previous Play' },
  nextPlay: { de: 'Nächster Spielzug', en: 'Next Play' },
  toggleFullscreen: { de: 'Vollbild umschalten', en: 'Toggle Fullscreen' },
  addNote: { de: 'Coach-Notiz am Frame', en: 'Add Coach Note at Frame' },
  toggleDraw: { de: 'Zeichenleiste umschalten', en: 'Toggle Telestration Bar' },
  markCut: { de: 'Fast-Cut Schnitt setzen (I)', en: 'Fast-Cut Set Cut (I)' },
  fastCutReverse: { de: 'Fast-Cut Rückwärts (J)', en: 'Fast-Cut Reverse (J)' },
  fastCutPause: { de: 'Fast-Cut Pause (K)', en: 'Fast-Cut Pause (K)' },
  fastCutForward: { de: 'Fast-Cut Vorwärts (L)', en: 'Fast-Cut Forward (L)' },
};

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
 * Verhindert verfrühtes Stoppen/Aufblitzen vor Erreichen des Ziel-Frames.
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

export function normalisiereTaste(codeOderKey: string): string {
  const bereinigt = codeOderKey.trim();
  if (!bereinigt) return '';
  if (bereinigt === ' ') return 'Space';
  return bereinigt;
}

export function formatiereHotkeyAnzeige(code: string): string {
  if (!code) return '—';
  if (code === 'Space') return 'Leertaste';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  return code;
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
    if (bestehendeAktion !== aktion && belegteTaste.toLowerCase() === neueTaste.toLowerCase()) {
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
 * Migriert alte In/Out-Hotkey-Belegungen sauber auf das aktuelle Ein-Punkt-Schnitt-Schema.
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
      ergebnis[aktion] = normalisiereTaste(wert);
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
