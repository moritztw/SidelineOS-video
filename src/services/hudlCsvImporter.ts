import type {
  HudlCsvImportErgebnis,
  HudlCsvImportVorschau,
  HudlCsvSpaltenMapping,
  HudlCsvZeilenZuordnung,
  PlayBreakdownDaten,
  PlayEintrag,
  TaggingFeldKonfig,
  TeamTaggingSchema,
} from '../types/video';

/**
 * Heuristik-Tabelle von typischen Hudl-CSV-Spaltenüberschriften (EN & DE)
 * auf die Standard-Feld-Keys im TeamTaggingSchema.
 */
const HUDL_HEADER_ALIASES: Record<string, string> = {
  'play #': 'play_number',
  'play#': 'play_number',
  'play no': 'play_number',
  'play number': 'play_number',
  'play nr': 'play_number',
  'spielzug': 'play_number',
  'clip #': 'play_number',
  'clip': 'play_number',
  '#': 'play_number',

  'odk': 'odk',
  'o/d/k': 'odk',
  'phase': 'odk',

  'dn': 'down',
  'down': 'down',

  'dist': 'distance',
  'distance': 'distance',
  'to go': 'distance',
  'yds to go': 'distance',

  'yard ln': 'yard_line',
  'yard line': 'yard_line',
  'yd ln': 'yard_line',
  'yardline': 'yard_line',
  'los': 'yard_line',

  'off form': 'off_form',
  'formation': 'off_form',
  'off formation': 'off_form',
  'offense formation': 'off_form',

  'off str': 'off_strg',
  'off strg': 'off_strg',
  'form str': 'off_strg',
  'strength': 'off_strg',

  'backfield': 'backfield',
  'back set': 'backfield',

  'motion': 'motion',
  'mot': 'motion',

  'off pers': 'off_pers',
  'personnel': 'off_pers',
  'pers': 'off_pers',

  'off play': 'off_play',
  'play': 'off_play',
  'play call': 'off_play',
  'offense play': 'off_play',

  'rpo': 'rpo',

  'play dir': 'play_dir',
  'direction': 'play_dir',
  'dir': 'play_dir',

  'result': 'result',
  'play type': 'result',

  'gn/ls': 'gn_ls',
  'gain/loss': 'gn_ls',
  'gain': 'gn_ls',
  'yards': 'gn_ls',
  'yds': 'gn_ls',

  'def front': 'def_front',
  'front': 'def_front',

  'def str': 'def_str',
  'def strg': 'def_str',

  'def pers': 'def_pers',
  'def personnel': 'def_pers',

  'stunt': 'stunt',
  'stunts': 'stunt',

  'blitz': 'blitz',
  'pressure': 'blitz',

  'eff': 'eff',
  'efficiency': 'eff',
};

const NUMERISCHE_ZIEL_KEYS = new Set(['play_number', 'down', 'distance', 'yard_line', 'gn_ls']);

function normalisiereHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function erzeugeCustomFeldKey(header: string, bestehendeKeys: Set<string>): string {
  const slug = header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const basis = slug ? `hudl_${slug}` : 'hudl_field';
  if (!bestehendeKeys.has(basis)) return basis;
  let i = 2;
  while (bestehendeKeys.has(`${basis}_${i}`)) {
    i += 1;
  }
  return `${basis}_${i}`;
}

/**
 * Erkennt das wahrscheinlichste CSV-Trennzeichen (Komma vs. Semikolon vs. Tab)
 * anhand der ersten nicht-leeren Zeile außerhalb von Anführungszeichen.
 */
export function erkenneCsvTrennzeichen(csvText: string): ',' | ';' | '\t' {
  const bereinigt = csvText.replace(/^\uFEFF/, '');
  let ersteZeile = '';
  for (let i = 0; i < bereinigt.length; i += 1) {
    const ch = bereinigt[i];
    if (ch === '\n' || ch === '\r') break;
    ersteZeile += ch;
  }

  let inQuotes = false;
  let komma = 0;
  let semikolon = 0;
  let tab = 0;

  for (let i = 0; i < ersteZeile.length; i += 1) {
    const ch = ersteZeile[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') komma += 1;
      else if (ch === ';') semikolon += 1;
      else if (ch === '\t') tab += 1;
    }
  }

  if (semikolon > komma && semikolon >= tab) return ';';
  if (tab > komma && tab > semikolon) return '\t';
  return ',';
}

/**
 * RFC-4180-konformer CSV-Parser ohne externe Abhängigkeiten.
 * Unterstützt BOM, Anführungszeichen, escapte `""`, mehrzeilige Zellen und `,`/`;`/`\t`.
 */
export function parseCsvTabelle(
  csvText: string,
  trennzeichenOverride?: ',' | ';' | '\t'
): { delimiter: ',' | ';' | '\t'; headers: string[]; rows: string[][] } {
  const text = csvText.replace(/^\uFEFF/, '');
  const delimiter = trennzeichenOverride ?? erkenneCsvTrennzeichen(text);

  const zeilen: string[][] = [];
  let aktuelleZeile: string[] = [];
  let feld = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          feld += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        feld += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      aktuelleZeile.push(feld.trim());
      feld = '';
    } else if (ch === '\r' && next === '\n') {
      aktuelleZeile.push(feld.trim());
      if (aktuelleZeile.some((z) => z !== '')) {
        zeilen.push(aktuelleZeile);
      }
      aktuelleZeile = [];
      feld = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      aktuelleZeile.push(feld.trim());
      if (aktuelleZeile.some((z) => z !== '')) {
        zeilen.push(aktuelleZeile);
      }
      aktuelleZeile = [];
      feld = '';
    } else {
      feld += ch;
    }
  }

  aktuelleZeile.push(feld.trim());
  if (aktuelleZeile.some((z) => z !== '')) {
    zeilen.push(aktuelleZeile);
  }

  if (zeilen.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headers = zeilen[0].map((h, idx) => h || `Spalte ${idx + 1}`);
  const rows = zeilen.slice(1).map((r) => {
    const kopie = [...r];
    while (kopie.length < headers.length) kopie.push('');
    return kopie;
  });

  return { delimiter, headers, rows };
}

function erkenneSpaltenTyp(werte: string[]): 'text' | 'number' {
  const nichtLeer = werte.map((w) => w.trim()).filter(Boolean);
  if (nichtLeer.length === 0) return 'text';
  const alleNumerisch = nichtLeer.every((w) => /^-?\d+([.,]\d+)?$/.test(w));
  return alleNumerisch ? 'number' : 'text';
}

function parseZahl(raw: string): number | undefined {
  const norm = raw.trim().replace(',', '.');
  if (!norm) return undefined;
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}

export interface ZielPlayReferenz {
  id?: string;
  playNumber: number;
  label?: string;
}

/**
 * Erstellt die interaktive Hudl-CSV-Import-Vorschau inkl. automatischer Spalten-Heuristik
 * und Play-Nummern-/Reihenfolge-Zuordnung (#9).
 */
export function erstelleHudlCsvVorschau(
  csvText: string,
  teamSchema: TeamTaggingSchema,
  zielPlays: ReadonlyArray<ZielPlayReferenz>
): HudlCsvImportVorschau {
  const { delimiter, headers, rows } = parseCsvTabelle(csvText);

  const schemaByKey = new Map<string, TaggingFeldKonfig>();
  const schemaByLabel = new Map<string, TaggingFeldKonfig>();
  const bestehendeKeys = new Set<string>();
  for (const feld of teamSchema.fields) {
    schemaByKey.set(feld.key.toLowerCase(), feld);
    schemaByLabel.set(normalisiereHeader(feld.label), feld);
    bestehendeKeys.add(feld.key);
  }

  const belegteZielKeys = new Set<string>();
  let playNumberColumnIndex: number | null = null;

  const columns: HudlCsvSpaltenMapping[] = headers.map((header, columnIndex) => {
    const norm = normalisiereHeader(header);
    const beispielWerte = rows
      .map((r) => r[columnIndex] ?? '')
      .filter((v) => v.trim() !== '')
      .slice(0, 3);
    const alleWerte = rows.map((r) => r[columnIndex] ?? '');
    const inferredType = erkenneSpaltenTyp(alleWerte);

    let gematchtesFeld: TaggingFeldKonfig | undefined;
    const aliasKey = HUDL_HEADER_ALIASES[norm];
    if (aliasKey) {
      gematchtesFeld = schemaByKey.get(aliasKey);
    }
    if (!gematchtesFeld) {
      gematchtesFeld = schemaByKey.get(norm.replace(/\s+/g, '_')) ?? schemaByLabel.get(norm);
    }

    if (aliasKey === 'play_number' && playNumberColumnIndex === null) {
      playNumberColumnIndex = columnIndex;
    }

    if (gematchtesFeld && !belegteZielKeys.has(gematchtesFeld.key)) {
      belegteZielKeys.add(gematchtesFeld.key);
      return {
        columnIndex,
        csvHeader: header,
        sampleValues: beispielWerte,
        action: 'map_existing',
        targetFieldKey: gematchtesFeld.key,
        customFieldLabel: header.trim(),
        customFieldType: inferredType,
      };
    }

    // Standard-Vorschlag für unbekannte Spalten: wenn Werte vorhanden -> als Custom-Feld anlegbar oder ignorieren;
    // Play-# Spalte falls noch nicht im Schema trotzdem als play_number vermerken
    if (aliasKey === 'play_number') {
      return {
        columnIndex,
        csvHeader: header,
        sampleValues: beispielWerte,
        action: 'map_existing',
        targetFieldKey: 'play_number',
        customFieldLabel: header.trim(),
        customFieldType: 'number',
      };
    }

    return {
      columnIndex,
      csvHeader: header,
      sampleValues: beispielWerte,
      action: beispielWerte.length > 0 ? 'create_custom' : 'ignore',
      targetFieldKey: undefined,
      customFieldLabel: header.trim(),
      customFieldType: inferredType,
    };
  });

  const rowMatches = berechneZeilenZuordnungen(rows, playNumberColumnIndex, zielPlays);
  const matchedCount = rowMatches.filter((m) => m.matchedPlayNumber !== null).length;

  return {
    delimiter,
    totalRows: rows.length,
    matchedCount,
    unmatchedCount: rows.length - matchedCount,
    playNumberColumnIndex,
    columns,
    rows,
    rowMatches,
  };
}

export function berechneZeilenZuordnungen(
  rows: readonly string[][],
  playNumberColumnIndex: number | null,
  zielPlays: ReadonlyArray<ZielPlayReferenz>
): HudlCsvZeilenZuordnung[] {
  const byPlayNumber = new Map<number, ZielPlayReferenz>();
  for (const p of zielPlays) {
    byPlayNumber.set(p.playNumber, p);
  }

  return rows.map((row, rowIndex) => {
    const rawNum =
      playNumberColumnIndex !== null ? parseZahl(row[playNumberColumnIndex] ?? '') : undefined;
    const csvPlayNumber = rawNum !== undefined && rawNum > 0 ? Math.round(rawNum) : null;

    if (csvPlayNumber !== null && byPlayNumber.has(csvPlayNumber)) {
      const target = byPlayNumber.get(csvPlayNumber)!;
      return {
        rowIndex,
        csvPlayNumber,
        matchedPlayId: target.id,
        matchedPlayNumber: target.playNumber,
        matchReason: 'play_number',
      };
    }

    const seqTarget = zielPlays[rowIndex];
    if (seqTarget) {
      return {
        rowIndex,
        csvPlayNumber,
        matchedPlayId: seqTarget.id,
        matchedPlayNumber: seqTarget.playNumber,
        matchReason: 'sequence',
      };
    }

    return {
      rowIndex,
      csvPlayNumber,
      matchedPlayId: undefined,
      matchedPlayNumber: null,
      matchReason: 'unmatched',
    };
  });
}

/**
 * Wendet das vom Nutzer bestätigte Spalten-Mapping auf die geparste Hudl-CSV an
 * und erzeugt sowohl neue Custom-Felder als auch die Breakdown-Patches pro Play.
 */
export function wendeHudlCsvMappingAn(
  vorschau: HudlCsvImportVorschau,
  teamSchema: TeamTaggingSchema,
  zielPlays: ReadonlyArray<Pick<PlayEintrag, 'id' | 'playNumber' | 'breakdown'>>,
  modus: 'merge_empty' | 'overwrite' = 'merge_empty'
): HudlCsvImportErgebnis {
  const bestehendeKeys = new Set(teamSchema.fields.map((f) => f.key));
  const fieldTypByKey = new Map<string, TaggingFeldKonfig['typ']>(
    teamSchema.fields.map((f) => [f.key, f.typ])
  );

  const newCustomFields: TaggingFeldKonfig[] = [];
  const aufgeloesteSpalten: Array<{
    columnIndex: number;
    fieldKey: string;
    typ: 'text' | 'number' | 'select';
  }> = [];

  let playNrCol = vorschau.playNumberColumnIndex;

  for (const col of vorschau.columns) {
    if (col.action === 'ignore') continue;

    if (col.action === 'map_existing' && col.targetFieldKey) {
      if (col.targetFieldKey === 'play_number') {
        playNrCol = col.columnIndex;
      }
      aufgeloesteSpalten.push({
        columnIndex: col.columnIndex,
        fieldKey: col.targetFieldKey,
        typ:
          fieldTypByKey.get(col.targetFieldKey) ??
          (NUMERISCHE_ZIEL_KEYS.has(col.targetFieldKey) ? 'number' : 'text'),
      });
    } else if (col.action === 'create_custom') {
      const label = (col.customFieldLabel || col.csvHeader).trim();
      if (!label) continue;
      const key = erzeugeCustomFeldKey(label, bestehendeKeys);
      bestehendeKeys.add(key);
      const neuesFeld: TaggingFeldKonfig = {
        key,
        label,
        gruppe: 'CUSTOM',
        typ: col.customFieldType === 'number' ? 'number' : 'text',
        aktiv: true,
        custom: true,
      };
      newCustomFields.push(neuesFeld);
      aufgeloesteSpalten.push({
        columnIndex: col.columnIndex,
        fieldKey: key,
        typ: neuesFeld.typ,
      });
    }
  }

  const referenzen: ZielPlayReferenz[] = zielPlays.map((p) => ({
    id: p.id,
    playNumber: p.playNumber,
  }));
  const zuordnungen = berechneZeilenZuordnungen(vorschau.rows, playNrCol, referenzen);
  const playById = new Map(zielPlays.map((p) => [p.id, p]));
  const playByNr = new Map(zielPlays.map((p) => [p.playNumber, p]));

  const playPatches: Array<{
    playId?: string;
    playNumber: number;
    breakdown: PlayBreakdownDaten;
  }> = [];

  for (const match of zuordnungen) {
    if (match.matchedPlayNumber === null) continue;
    const row = vorschau.rows[match.rowIndex];
    if (!row) continue;

    const zielPlay =
      (match.matchedPlayId ? playById.get(match.matchedPlayId) : undefined) ??
      playByNr.get(match.matchedPlayNumber);

    const basis: PlayBreakdownDaten = { ...(zielPlay?.breakdown ?? {}) };
    let geaendert = false;

    for (const spalte of aufgeloesteSpalten) {
      const roh = (row[spalte.columnIndex] ?? '').trim();
      if (!roh) continue;

      const aktuellerWert = basis[spalte.fieldKey];
      const hatWert =
        aktuellerWert !== undefined && aktuellerWert !== null && String(aktuellerWert).trim() !== '';
      if (modus === 'merge_empty' && hatWert) {
        continue;
      }

      if (spalte.typ === 'number' || NUMERISCHE_ZIEL_KEYS.has(spalte.fieldKey)) {
        const zahl = parseZahl(roh);
        if (zahl !== undefined) {
          basis[spalte.fieldKey] = zahl;
          geaendert = true;
        }
      } else {
        basis[spalte.fieldKey] = roh;
        geaendert = true;
      }
    }

    if (geaendert || !zielPlay) {
      playPatches.push({
        playId: match.matchedPlayId,
        playNumber: match.matchedPlayNumber,
        breakdown: basis,
      });
    }
  }

  return {
    newCustomFields,
    playPatches,
    matchedCount: zuordnungen.filter((m) => m.matchedPlayNumber !== null).length,
    unmatchedCount: zuordnungen.filter((m) => m.matchedPlayNumber === null).length,
  };
}
