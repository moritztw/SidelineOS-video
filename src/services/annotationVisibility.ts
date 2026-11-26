import type { SpielerUnit, TeamRolle } from '@sidelineos/plugin-sdk';
import type {
  AnmerkungsFreigabeKonfig,
  CoachNotiz,
  FrameTelestration,
  SichtbarkeitsStufe,
  TelestrationElement,
} from '../types/video';

export const ANMERKUNGS_ZIELGRUPPEN: ReadonlyArray<{
  id: SichtbarkeitsStufe;
  labelDe: string;
  kurzDe: string;
  labelEn: string;
  kurzEn: string;
}> = [
  { id: 'COACHES_ONLY', labelDe: 'Coaches intern', kurzDe: 'Coaches', labelEn: 'Coaches Only', kurzEn: 'Coaches' },
  { id: 'ALL_PLAYERS', labelDe: 'Alle', kurzDe: 'Alle', labelEn: 'Everyone', kurzEn: 'All' },
  { id: 'UNIT_OFFENSE', labelDe: 'Offense', kurzDe: 'Offense', labelEn: 'Offense', kurzEn: 'Off' },
  { id: 'UNIT_DEFENSE', labelDe: 'Defense', kurzDe: 'Defense', labelEn: 'Defense', kurzEn: 'Def' },
  { id: 'UNIT_SPECIAL_TEAMS', labelDe: 'Special Teams', kurzDe: 'ST', labelEn: 'Special Teams', kurzEn: 'ST' },
];

export const STANDARD_ANMERKUNGS_FARBEN: Record<SichtbarkeitsStufe, string> = {
  COACHES_ONLY: '#EF4444',
  ALL_PLAYERS: '#F59E0B',
  UNIT_OFFENSE: '#38BDF8',
  UNIT_DEFENSE: '#22C55E',
  UNIT_SPECIAL_TEAMS: '#A855F7',
};

export function erstelleStandardAnmerkungsKonfig(): AnmerkungsFreigabeKonfig {
  return {
    enabled: true,
    colorMap: { ...STANDARD_ANMERKUNGS_FARBEN },
  };
}

function istHexFarbe(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

export function bereinigeAnmerkungsKonfig(
  roh: Partial<AnmerkungsFreigabeKonfig> | null | undefined
): AnmerkungsFreigabeKonfig {
  const basis = erstelleStandardAnmerkungsKonfig();
  if (!roh || typeof roh !== 'object') return basis;

  const colorMap: Record<SichtbarkeitsStufe, string> = { ...basis.colorMap };
  if (roh.colorMap && typeof roh.colorMap === 'object') {
    for (const gruppe of ANMERKUNGS_ZIELGRUPPEN) {
      const k = roh.colorMap[gruppe.id];
      if (istHexFarbe(k)) {
        colorMap[gruppe.id] = k.trim().toUpperCase();
      }
    }
  }

  return {
    enabled: roh.enabled !== false,
    colorMap,
  };
}

/**
 * Prüft, ob eine Anmerkung (Notiz oder Einzeichnung) für den aktuellen Benutzer sichtbar ist.
 * - Coaches & Team-Admins sehen immer alle Gruppen.
 * - Ist das Farb-Sharing deaktiviert, sehen Spieler alles außer COACHES_ONLY.
 * - Ist das Farb-Sharing aktiv, sehen Spieler ALL_PLAYERS sowie ihre zugeordneten Core-Units.
 */
export function istAnmerkungFuerBenutzerSichtbar(
  visibility: SichtbarkeitsStufe | undefined,
  teamRolle: TeamRolle,
  userUnits?: readonly SpielerUnit[],
  sharingEnabled = true
): boolean {
  if (teamRolle === 'COACH' || teamRolle === 'TEAM_ADMIN') {
    return true;
  }
  const ziel: SichtbarkeitsStufe = visibility ?? 'ALL_PLAYERS';
  if (ziel === 'COACHES_ONLY') {
    return false;
  }
  if (!sharingEnabled) {
    return true;
  }
  if (ziel === 'ALL_PLAYERS') {
    return true;
  }
  const units = userUnits ?? [];
  if (ziel === 'UNIT_OFFENSE') return units.includes('OFFENSE');
  if (ziel === 'UNIT_DEFENSE') return units.includes('DEFENSE');
  if (ziel === 'UNIT_SPECIAL_TEAMS') return units.includes('SPECIAL_TEAMS');
  return false;
}

export function filtereTelestrationElementeFuerBenutzer(
  elements: readonly TelestrationElement[],
  teamRolle: TeamRolle,
  userUnits?: readonly SpielerUnit[],
  sharingEnabled = true
): TelestrationElement[] {
  if (teamRolle === 'COACH' || teamRolle === 'TEAM_ADMIN') {
    return [...elements];
  }
  return elements.filter((el) =>
    istAnmerkungFuerBenutzerSichtbar(el.visibility, teamRolle, userUnits, sharingEnabled)
  );
}

export function findeZielgruppeZuFarbe(
  konfig: AnmerkungsFreigabeKonfig,
  farbe: string
): SichtbarkeitsStufe {
  const norm = farbe.trim().toUpperCase();
  for (const gruppe of ANMERKUNGS_ZIELGRUPPEN) {
    if (konfig.colorMap[gruppe.id].toUpperCase() === norm) {
      return gruppe.id;
    }
  }
  return 'ALL_PLAYERS';
}

export interface TimelineAnmerkungsMarker {
  frameIndex: number;
  hasDrawing: boolean;
  hasNote: boolean;
  authors: string[];
  primaryColor: string;
  count: number;
}

/**
 * Aggregiert alle sichtbaren Zeichnungs- und Notiz-Frames eines Plays/Winkels für
 * die klickbare Zeitleisten-Markierung (#1).
 */
export function sammleFrameAnmerkungsMarker(
  telestrations: readonly FrameTelestration[],
  notizen: readonly CoachNotiz[],
  playId: string,
  angleCode: string
): TimelineAnmerkungsMarker[] {
  const byFrame = new Map<
    number,
    { hasDrawing: boolean; hasNote: boolean; authors: Set<string>; primaryColor: string; count: number }
  >();

  for (const tel of telestrations) {
    if (tel.playId !== playId || tel.angleCode !== angleCode || tel.elements.length === 0) continue;
    const eintrag = byFrame.get(tel.frameIndex) ?? {
      hasDrawing: false,
      hasNote: false,
      authors: new Set<string>(),
      primaryColor: tel.elements[0]?.color ?? '#F59E0B',
      count: 0,
    };
    eintrag.hasDrawing = true;
    eintrag.count += tel.elements.length;
    if (tel.authorName) eintrag.authors.add(tel.authorName);
    for (const el of tel.elements) {
      if (el.authorName) eintrag.authors.add(el.authorName);
    }
    byFrame.set(tel.frameIndex, eintrag);
  }

  for (const n of notizen) {
    if (n.playId !== playId || n.angleCode !== angleCode) continue;
    const eintrag = byFrame.get(n.frameIndex) ?? {
      hasDrawing: false,
      hasNote: false,
      authors: new Set<string>(),
      primaryColor: n.color ?? '#F59E0B',
      count: 0,
    };
    eintrag.hasNote = true;
    eintrag.count += 1;
    if (n.color) eintrag.primaryColor = n.color;
    if (n.authorName) eintrag.authors.add(n.authorName);
    byFrame.set(n.frameIndex, eintrag);
  }

  return Array.from(byFrame.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([frameIndex, info]) => ({
      frameIndex,
      hasDrawing: info.hasDrawing,
      hasNote: info.hasNote,
      authors: Array.from(info.authors),
      primaryColor: info.primaryColor,
      count: info.count,
    }));
}

export interface PlayAnmerkungsZaehler {
  drawingFrames: number;
  noteCount: number;
}

/**
 * Zählt pro Play, wie viele annotierte Frames (Zeichnungen) und Coach-Notizen existieren,
 * für die Symbol-Anzeige in der Play-/Breakdown-Liste (#1).
 */
export function sammlePlayAnmerkungsZaehler(
  telestrations: readonly FrameTelestration[],
  notizen: readonly CoachNotiz[]
): Record<string, PlayAnmerkungsZaehler> {
  const result: Record<string, PlayAnmerkungsZaehler> = {};

  for (const tel of telestrations) {
    if (tel.elements.length === 0) continue;
    const item = result[tel.playId] ?? { drawingFrames: 0, noteCount: 0 };
    item.drawingFrames += 1;
    result[tel.playId] = item;
  }

  for (const n of notizen) {
    const item = result[n.playId] ?? { drawingFrames: 0, noteCount: 0 };
    item.noteCount += 1;
    result[n.playId] = item;
  }

  return result;
}
