import type { TeamRolle } from '@sidelineos/plugin-sdk';
import type {
  AnmerkungsFreigabeKonfig,
  CoachNotiz,
  FrameTelestration,
  GruppenFarbEintrag,
  SichtbarkeitsStufe,
  TelestrationElement,
} from '../types/video';

export interface AufgeloesteZielgruppe {
  id: SichtbarkeitsStufe;
  label: string;
  kurz: string;
  color: string;
  istSystemGruppe: boolean;
  groupName?: string;
}

export const STANDARD_GRUPPEN_FARBEN: ReadonlyArray<GruppenFarbEintrag> = [
  { group: 'Offense', label: 'Offense', color: '#38BDF8' },
  { group: 'Defense', label: 'Defense', color: '#22C55E' },
  { group: 'Special Teams', label: 'Special Teams', color: '#A855F7' },
];

export const STANDARD_STAFF_FARBE = '#EF4444';
export const STANDARD_ALLE_FARBE = '#F59E0B';

export const STANDARD_ANMERKUNGS_FARBEN: Record<string, string> = {
  STAFF_ONLY: STANDARD_STAFF_FARBE,
  COACHES_ONLY: STANDARD_STAFF_FARBE,
  ALL_MEMBERS: STANDARD_ALLE_FARBE,
  ALL_PLAYERS: STANDARD_ALLE_FARBE,
  'GROUP:Offense': '#38BDF8',
  'GROUP:Defense': '#22C55E',
  'GROUP:Special Teams': '#A855F7',
  UNIT_OFFENSE: '#38BDF8',
  UNIT_DEFENSE: '#22C55E',
  UNIT_SPECIAL_TEAMS: '#A855F7',
};

function istHexFarbe(val: unknown): val is string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim());
}

export function istStaffOderAdminRolle(rolle: TeamRolle | null | undefined): boolean {
  return rolle === 'TEAM_ADMIN' || rolle === 'STAFF';
}

export function normalisiereGruppenName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Wandelt Legacy-Sichtbarkeiten (SDK v1) oder dynamische Gruppen in eine konsistente
 * Darstellung um, ohne Alt-Daten zu verlieren.
 */
export function normalisiereSichtbarkeit(raw?: string | null): SichtbarkeitsStufe {
  if (!raw) return 'ALL_MEMBERS';
  const trimmed = raw.trim();
  if (trimmed === 'COACHES_ONLY' || trimmed === 'STAFF_ONLY') return 'STAFF_ONLY';
  if (trimmed === 'ALL_PLAYERS' || trimmed === 'ALL_MEMBERS') return 'ALL_MEMBERS';
  if (trimmed === 'UNIT_OFFENSE') return 'GROUP:Offense';
  if (trimmed === 'UNIT_DEFENSE') return 'GROUP:Defense';
  if (trimmed === 'UNIT_SPECIAL_TEAMS') return 'GROUP:Special Teams';
  if (trimmed.startsWith('GROUP:') && trimmed.length > 6) {
    return trimmed as SichtbarkeitsStufe;
  }
  return 'ALL_MEMBERS';
}

export function baueColorMap(konfig: Pick<AnmerkungsFreigabeKonfig, 'staffColor' | 'allMembersColor' | 'groupColors'>): Record<string, string> {
  const map: Record<string, string> = {
    STAFF_ONLY: konfig.staffColor,
    COACHES_ONLY: konfig.staffColor,
    ALL_MEMBERS: konfig.allMembersColor,
    ALL_PLAYERS: konfig.allMembersColor,
  };
  for (const eintrag of konfig.groupColors) {
    const key = `GROUP:${eintrag.group}`;
    map[key] = eintrag.color;
    const norm = normalisiereGruppenName(eintrag.group);
    if (norm === 'offense') map.UNIT_OFFENSE = eintrag.color;
    if (norm === 'defense') map.UNIT_DEFENSE = eintrag.color;
    if (norm === 'specialteams') map.UNIT_SPECIAL_TEAMS = eintrag.color;
  }
  return map;
}

export function erstelleStandardAnmerkungsKonfig(): AnmerkungsFreigabeKonfig {
  const groupColors = STANDARD_GRUPPEN_FARBEN.map((g) => ({ ...g }));
  return {
    enabled: true,
    staffColor: STANDARD_STAFF_FARBE,
    allMembersColor: STANDARD_ALLE_FARBE,
    groupColors,
    colorMap: baueColorMap({
      staffColor: STANDARD_STAFF_FARBE,
      allMembersColor: STANDARD_ALLE_FARBE,
      groupColors,
    }),
  };
}

export function bereinigeAnmerkungsKonfig(
  roh: Partial<AnmerkungsFreigabeKonfig> | null | undefined
): AnmerkungsFreigabeKonfig {
  const basis = erstelleStandardAnmerkungsKonfig();
  if (!roh || typeof roh !== 'object') return basis;

  const legacyMap =
    roh.colorMap && typeof roh.colorMap === 'object' ? (roh.colorMap as Record<string, string>) : {};

  const staffColor = istHexFarbe(roh.staffColor)
    ? roh.staffColor.trim().toUpperCase()
    : istHexFarbe(legacyMap.STAFF_ONLY ?? legacyMap.COACHES_ONLY)
      ? (legacyMap.STAFF_ONLY ?? legacyMap.COACHES_ONLY).trim().toUpperCase()
      : basis.staffColor;

  const allMembersColor = istHexFarbe(roh.allMembersColor)
    ? roh.allMembersColor.trim().toUpperCase()
    : istHexFarbe(legacyMap.ALL_MEMBERS ?? legacyMap.ALL_PLAYERS)
      ? (legacyMap.ALL_MEMBERS ?? legacyMap.ALL_PLAYERS).trim().toUpperCase()
      : basis.allMembersColor;

  let groupColors: GruppenFarbEintrag[];
  if (Array.isArray(roh.groupColors)) {
    const seen = new Set<string>();
    groupColors = [];
    for (const item of roh.groupColors) {
      if (!item || typeof item !== 'object') continue;
      const group = String(item.group ?? '').trim();
      if (!group) continue;
      const norm = normalisiereGruppenName(group);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const color = istHexFarbe(item.color) ? item.color.trim().toUpperCase() : '#38BDF8';
      groupColors.push({
        group,
        label: String(item.label ?? group).trim() || group,
        color,
      });
    }
  } else {
    groupColors = basis.groupColors.map((g) => {
      const legacyKey =
        g.group === 'Offense'
          ? 'UNIT_OFFENSE'
          : g.group === 'Defense'
            ? 'UNIT_DEFENSE'
            : 'UNIT_SPECIAL_TEAMS';
      const custom = legacyMap[`GROUP:${g.group}`] ?? legacyMap[legacyKey];
      return {
        ...g,
        color: istHexFarbe(custom) ? custom.trim().toUpperCase() : g.color,
      };
    });
  }

  return {
    enabled: roh.enabled !== false,
    staffColor,
    allMembersColor,
    groupColors,
    colorMap: baueColorMap({ staffColor, allMembersColor, groupColors }),
  };
}

/**
 * Liefert alle auswählbaren Zielgruppen (Staff intern, Alle Mitglieder + dynamische Team-Gruppen)
 * für Farb-Picker im Film Room und Einstellungs-Panel.
 */
export function ermittleZielgruppenOptionen(
  konfig: AnmerkungsFreigabeKonfig,
  locale: string = 'de'
): AufgeloesteZielgruppe[] {
  const isEn = locale.toLowerCase().startsWith('en');
  const ergebnis: AufgeloesteZielgruppe[] = [
    {
      id: 'STAFF_ONLY',
      label: isEn ? 'Staff / Admins only' : 'Staff & Admins intern',
      kurz: isEn ? 'Staff' : 'Staff',
      color: konfig.staffColor,
      istSystemGruppe: true,
    },
    {
      id: 'ALL_MEMBERS',
      label: isEn ? 'All Members' : 'Alle Mitglieder',
      kurz: isEn ? 'All' : 'Alle',
      color: konfig.allMembersColor,
      istSystemGruppe: true,
    },
  ];

  for (const g of konfig.groupColors) {
    ergebnis.push({
      id: `GROUP:${g.group}`,
      label: g.label || g.group,
      kurz: (g.label || g.group).slice(0, 10),
      color: g.color,
      istSystemGruppe: false,
      groupName: g.group,
    });
  }

  return ergebnis;
}

export function holeFarbeFuerSichtbarkeit(
  konfig: AnmerkungsFreigabeKonfig,
  visibility: SichtbarkeitsStufe | undefined
): string {
  const norm = normalisiereSichtbarkeit(visibility);
  if (norm === 'STAFF_ONLY') return konfig.staffColor;
  if (norm === 'ALL_MEMBERS') return konfig.allMembersColor;
  if (norm.startsWith('GROUP:')) {
    const zielName = normalisiereGruppenName(norm.slice(6));
    const gefunden = konfig.groupColors.find(
      (g) => normalisiereGruppenName(g.group) === zielName
    );
    if (gefunden) return gefunden.color;
  }
  return konfig.allMembersColor;
}

export function holeLabelFuerSichtbarkeit(
  konfig: AnmerkungsFreigabeKonfig,
  visibility: SichtbarkeitsStufe | undefined,
  locale: string = 'de'
): string {
  const isEn = locale.toLowerCase().startsWith('en');
  const norm = normalisiereSichtbarkeit(visibility);
  if (norm === 'STAFF_ONLY') return isEn ? 'Staff / Admins only' : 'Staff & Admins';
  if (norm === 'ALL_MEMBERS') return isEn ? 'All Members' : 'Alle Mitglieder';
  if (norm.startsWith('GROUP:')) {
    const name = norm.slice(6);
    const gefunden = konfig.groupColors.find(
      (g) => normalisiereGruppenName(g.group) === normalisiereGruppenName(name)
    );
    return gefunden?.label || name;
  }
  return isEn ? 'All Members' : 'Alle Mitglieder';
}

/**
 * Prüft, ob eine Anmerkung (Notiz oder Einzeichnung) für den aktuellen Benutzer sichtbar ist.
 * - TEAM_ADMIN & STAFF sehen immer alle Gruppen.
 * - Ist das Farb-Sharing deaktiviert, sehen MEMBER alles außer STAFF_ONLY/COACHES_ONLY.
 * - Ist das Farb-Sharing aktiv, sehen MEMBER ALL_MEMBERS sowie Gruppen aus ihrem ctx.userGroups.
 */
export function istAnmerkungFuerBenutzerSichtbar(
  visibility: SichtbarkeitsStufe | undefined,
  teamRolle: TeamRolle | null | undefined,
  userGroups?: readonly string[],
  sharingEnabled = true
): boolean {
  if (istStaffOderAdminRolle(teamRolle)) {
    return true;
  }
  const ziel = normalisiereSichtbarkeit(visibility);
  if (ziel === 'STAFF_ONLY') {
    return false;
  }
  if (!sharingEnabled) {
    return true;
  }
  if (ziel === 'ALL_MEMBERS') {
    return true;
  }
  if (ziel.startsWith('GROUP:')) {
    const zielNorm = normalisiereGruppenName(ziel.slice(6));
    const nutzerGruppen = (userGroups ?? []).map(normalisiereGruppenName);
    return nutzerGruppen.includes(zielNorm);
  }
  return false;
}

export function filtereTelestrationElementeFuerBenutzer(
  elements: readonly TelestrationElement[],
  teamRolle: TeamRolle | null | undefined,
  userGroups?: readonly string[],
  sharingEnabled = true
): TelestrationElement[] {
  if (istStaffOderAdminRolle(teamRolle)) {
    return [...elements];
  }
  return elements.filter((el) =>
    istAnmerkungFuerBenutzerSichtbar(el.visibility, teamRolle, userGroups, sharingEnabled)
  );
}

export function findeZielgruppeZuFarbe(
  konfig: AnmerkungsFreigabeKonfig,
  farbe: string
): SichtbarkeitsStufe {
  const norm = farbe.trim().toUpperCase();
  if (konfig.staffColor.toUpperCase() === norm) return 'STAFF_ONLY';
  if (konfig.allMembersColor.toUpperCase() === norm) return 'ALL_MEMBERS';
  for (const g of konfig.groupColors) {
    if (g.color.toUpperCase() === norm) {
      return `GROUP:${g.group}`;
    }
  }
  return 'ALL_MEMBERS';
}

export interface TimelineAnmerkungsMarker {
  frameIndex: number;
  hasDrawing: boolean;
  hasNote: boolean;
  authors: string[];
  primaryColor: string;
  count: number;
}

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
      primaryColor: tel.elements[0]?.color ?? STANDARD_ALLE_FARBE,
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
      primaryColor: n.color ?? STANDARD_ALLE_FARBE,
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
