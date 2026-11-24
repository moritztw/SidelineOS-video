import type { TeamRolle } from '@sidelineos/plugin-sdk';
import type {
  PlayBreakdownDaten,
  TaggingFeldKonfig,
  TeamTaggingSchema,
} from '../types/video';

export const STANDARD_BREAKDOWN_FELDER: TaggingFeldKonfig[] = [
  { key: 'odk', label: 'ODK', gruppe: 'GENERAL', typ: 'select', aktiv: true, optionen: ['O', 'D', 'K'] },
  { key: 'play_number', label: 'PLAY #', gruppe: 'GENERAL', typ: 'number', aktiv: true },
  { key: 'down', label: 'DN', gruppe: 'GENERAL', typ: 'select', aktiv: true, optionen: ['1', '2', '3', '4'] },
  { key: 'distance', label: 'DIST', gruppe: 'GENERAL', typ: 'number', aktiv: true },
  { key: 'yard_line', label: 'YARD LN', gruppe: 'GENERAL', typ: 'number', aktiv: true },
  { key: 'off_form', label: 'OFF FORM', gruppe: 'OFFENSE', typ: 'text', aktiv: true },
  { key: 'off_strg', label: 'OFF STRG', gruppe: 'OFFENSE', typ: 'select', aktiv: true, optionen: ['R', 'L', 'Middle'] },
  { key: 'backfield', label: 'BACKFIELD', gruppe: 'OFFENSE', typ: 'text', aktiv: true },
  { key: 'motion', label: 'MOTION', gruppe: 'OFFENSE', typ: 'text', aktiv: true },
  { key: 'off_pers', label: 'OFF PERS', gruppe: 'OFFENSE', typ: 'text', aktiv: true },
  { key: 'off_play', label: 'OFF PLAY', gruppe: 'OFFENSE', typ: 'text', aktiv: true },
  { key: 'rpo', label: 'RPO', gruppe: 'OFFENSE', typ: 'select', aktiv: true, optionen: ['Ja', 'Nein'] },
  { key: 'play_dir', label: 'PLAY DIR', gruppe: 'OFFENSE', typ: 'select', aktiv: true, optionen: ['R', 'L', 'Middle'] },
  {
    key: 'result',
    label: 'RESULT',
    gruppe: 'GENERAL',
    typ: 'select',
    aktiv: true,
    optionen: ['COMPLETE', 'INCOMPLETE', 'FUMBLE', 'TD', 'INTERCEPTION', 'SACK', 'SAFETY', 'FLAG'],
  },
  { key: 'gn_ls', label: 'GN/LS', gruppe: 'GENERAL', typ: 'number', aktiv: true },
  { key: 'def_front', label: 'DEF FRONT', gruppe: 'DEFENSE', typ: 'text', aktiv: true },
  { key: 'def_str', label: 'DEF STR', gruppe: 'DEFENSE', typ: 'select', aktiv: true, optionen: ['R', 'L'] },
  { key: 'def_pers', label: 'DEF PERS', gruppe: 'DEFENSE', typ: 'text', aktiv: true },
  { key: 'stunt', label: 'STUNT', gruppe: 'DEFENSE', typ: 'text', aktiv: true },
  { key: 'blitz', label: 'BLITZ', gruppe: 'DEFENSE', typ: 'text', aktiv: true },
  { key: 'eff', label: 'EFF', gruppe: 'GENERAL', typ: 'select', aktiv: true, optionen: ['+', '-', '0'] },
];

export const STANDARD_WOERTERBUCH: Record<string, string[]> = {
  off_form: ['Trips Right', 'Trips Left', 'Doubles', 'Empty', 'I-Pro', 'Ace', 'Bunch Right', 'Trey'],
  backfield: ['Pistol', 'Gun Split', 'Offset Right', 'Offset Left', 'Dot', 'Empty'],
  motion: ['Jet', 'Orbit', 'Shift', 'Across', 'Short'],
  off_pers: ['11', '12', '21', '10', '20', '22'],
  off_play: ['Inside Zone', 'Outside Zone', 'Power', 'Counter', 'Mesh', 'Stick', 'Four Verts', 'Flood', 'Screen'],
  def_front: ['4-3 Over', '4-3 Under', '4-2-5', '3-4 Odd', 'Bear', 'Nickel'],
  def_pers: ['Base', 'Nickel', 'Dime', 'Goal Line'],
  stunt: ['TEX', 'ET', 'Pirate', 'Slant Strong', 'Pinch'],
  blitz: ['Mike A', 'Sam Edge', 'Will B', 'Corner Fire', 'Zero'],
};

export function erstelleStandardTeamSchema(teamId: string): TeamTaggingSchema {
  return {
    teamId,
    fields: STANDARD_BREAKDOWN_FELDER.map((f) => ({ ...f })),
    dictionary: Object.fromEntries(
      Object.entries(STANDARD_WOERTERBUCH).map(([k, v]) => [k, [...v]])
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Wandelt Football-Feldposition (-50 bis +50, negativ = eigene Hälfte) in 0..100 (eigene Goal Line = 0) um.
 */
export function yardLnZuAbsolut(yardLn: number): number | undefined {
  if (!Number.isFinite(yardLn)) return undefined;
  if (yardLn === 50 || yardLn === -50) return 50;
  if (yardLn < 0 && yardLn >= -49) return Math.abs(yardLn);
  if (yardLn > 0 && yardLn < 50) return 100 - yardLn;
  if (yardLn === 0) return 0;
  return undefined;
}

/**
 * Wandelt absolute 0..100 Feldposition zurück in -50..+50 Yard-Line-Notation.
 */
export function absolutZuYardLn(absolut: number): number {
  const geclampt = Math.max(0, Math.min(100, Math.round(absolut)));
  if (geclampt === 50) return 50;
  if (geclampt < 50) return -geclampt;
  return 100 - geclampt;
}

/**
 * Berechnet GN/LS aus vorheriger und neuer YARD LN.
 * Bei RESULT === 'FLAG' wird gezielt null/undefined zurückgegeben, damit Strafen keine reale Statistik verfälschen.
 */
export function berechneGainLoss(
  vorherYardLn: number | undefined,
  nachherYardLn: number | undefined,
  result?: string
): number | undefined {
  if (result?.trim().toUpperCase() === 'FLAG') {
    return undefined;
  }
  if (vorherYardLn === undefined || nachherYardLn === undefined) {
    return undefined;
  }
  const absVorher = yardLnZuAbsolut(vorherYardLn);
  const absNachher = yardLnZuAbsolut(nachherYardLn);
  if (absVorher === undefined || absNachher === undefined) {
    return undefined;
  }
  return absNachher - absVorher;
}

/**
 * Berechnet neue YARD LN aus Start-YARD LN und GN/LS.
 * Bei RESULT === 'FLAG' unverändert, damit Strafen separat gepflegt werden.
 */
export function berechneNeueFeldposition(
  startYardLn: number | undefined,
  gainLoss: number | undefined,
  result?: string
): number | undefined {
  if (result?.trim().toUpperCase() === 'FLAG') {
    return undefined;
  }
  if (startYardLn === undefined || gainLoss === undefined || !Number.isFinite(gainLoss)) {
    return undefined;
  }
  const absStart = yardLnZuAbsolut(startYardLn);
  if (absStart === undefined) return undefined;
  return absolutZuYardLn(absStart + gainLoss);
}

/**
 * Nimmt einen neu getaggten Begriff automatisch in das lernende Team-Wörterbuch auf.
 */
export function ergaenzeTeamWoerterbuch(
  schema: TeamTaggingSchema,
  feldKey: string,
  wertRoh: string
): TeamTaggingSchema {
  const wert = wertRoh.trim();
  if (!wert) return schema;
  const bestehend = schema.dictionary[feldKey] ?? [];
  if (bestehend.some((eintrag) => eintrag.toLowerCase() === wert.toLowerCase())) {
    return schema;
  }
  return {
    ...schema,
    dictionary: {
      ...schema.dictionary,
      [feldKey]: [...bestehend, wert],
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Entfernt einen Fehleintrag aus dem Wörterbuch — ausschließlich für TEAM_ADMIN zulässig.
 */
export function entferneWoerterbuchEintrag(
  schema: TeamTaggingSchema,
  feldKey: string,
  wert: string,
  rolle: TeamRolle
): { ok: boolean; schema: TeamTaggingSchema; fehler?: string } {
  if (rolle !== 'TEAM_ADMIN') {
    return {
      ok: false,
      schema,
      fehler: 'Nur der Team Admin darf Einträge aus dem Team-Wörterbuch löschen.',
    };
  }
  const bestehend = schema.dictionary[feldKey] ?? [];
  return {
    ok: true,
    schema: {
      ...schema,
      dictionary: {
        ...schema.dictionary,
        [feldKey]: bestehend.filter((e) => e !== wert),
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

export function ermittleSichtbareSpalten(
  schema: TeamTaggingSchema,
  erlaubteSpalten?: string[] | null
): TaggingFeldKonfig[] {
  const aktive = schema.fields.filter((f) => f.aktiv);
  if (!erlaubteSpalten) return aktive;
  const erlaubtesSet = new Set(erlaubteSpalten);
  return aktive.filter((f) => erlaubtesSet.has(f.key));
}

export function filtereBreakdownAufFelder(
  breakdown: PlayBreakdownDaten,
  erlaubteFelder: readonly string[]
): PlayBreakdownDaten {
  const erlaubtesSet = new Set(erlaubteFelder);
  const gefiltert: PlayBreakdownDaten = {};
  for (const [k, v] of Object.entries(breakdown)) {
    if (erlaubtesSet.has(k) && v !== undefined) {
      gefiltert[k] = v;
    }
  }
  return gefiltert;
}
