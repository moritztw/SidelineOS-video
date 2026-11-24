import type {
  PlayEintrag,
  QuellenModus,
  SichtbarkeitsStufe,
  SidelineBundleV1,
  VideoKategorie,
  VideoReelEintrag,
} from '../types/video';
import { filtereBreakdownAufFelder } from './taggingEngine';

const GUELTIGE_KATEGORIEN = new Set<VideoKategorie>([
  'GAME',
  'PRACTICE',
  'SCOUTING',
  'SELF_SCOUT',
  'CUSTOM',
]);

const GUELTIGE_SICHTBARKEITEN = new Set<SichtbarkeitsStufe>([
  'COACHES_ONLY',
  'ALL_PLAYERS',
  'UNIT_OFFENSE',
  'UNIT_DEFENSE',
  'UNIT_SPECIAL_TEAMS',
]);

const GUELTIGE_MODI = new Set<QuellenModus>(['CLIP_FILE', 'TIME_SLICE']);

export function validiereSidelineBundle(
  roh: unknown
): { ok: true; bundle: SidelineBundleV1 } | { ok: false; fehler: string[] } {
  const fehler: string[] = [];
  if (!roh || typeof roh !== 'object') {
    return { ok: false, fehler: ['Bundle muss ein gültiges JSON-Objekt sein.'] };
  }

  const obj = roh as Record<string, unknown>;
  if (obj.schema_version !== '1.0') {
    fehler.push('schema_version muss exakt "1.0" sein.');
  }

  const reel = obj.reel as Record<string, unknown> | undefined;
  if (!reel || typeof reel !== 'object') {
    fehler.push('reel-Objekt fehlt.');
  } else {
    if (typeof reel.title !== 'string' || !reel.title.trim()) {
      fehler.push('reel.title darf nicht leer sein.');
    }
    if (typeof reel.category !== 'string' || !GUELTIGE_KATEGORIEN.has(reel.category as VideoKategorie)) {
      fehler.push('reel.category ist ungültig.');
    }
    if (typeof reel.event_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reel.event_date)) {
      fehler.push('reel.event_date muss im Format YYYY-MM-DD vorliegen.');
    }
    if (
      reel.visibility !== undefined &&
      !GUELTIGE_SICHTBARKEITEN.has(reel.visibility as SichtbarkeitsStufe)
    ) {
      fehler.push('reel.visibility ist ungültig.');
    }
  }

  if (!Array.isArray(obj.angles) || obj.angles.length === 0) {
    fehler.push('angles muss mindestens einen Kamerawinkel enthalten.');
  }

  if (!Array.isArray(obj.plays)) {
    fehler.push('plays muss ein Array sein.');
  } else {
    obj.plays.forEach((p, idx) => {
      const play = p as Record<string, unknown>;
      if (typeof play.play_number !== 'number' || !Number.isInteger(play.play_number) || play.play_number < 1) {
        fehler.push(`plays[${idx}].play_number muss eine positive Ganzzahl sein.`);
      }
      const sources = play.sources as Record<string, Record<string, unknown>> | undefined;
      if (!sources || typeof sources !== 'object') {
        fehler.push(`plays[${idx}].sources fehlt.`);
        return;
      }
      for (const [angle, src] of Object.entries(sources)) {
        if (!src || typeof src !== 'object') {
          fehler.push(`plays[${idx}].sources.${angle} ist ungültig.`);
          continue;
        }
        if (typeof src.file !== 'string' || !src.file.trim()) {
          fehler.push(`plays[${idx}].sources.${angle}.file fehlt.`);
        }
        if (src.source_mode !== undefined && !GUELTIGE_MODI.has(src.source_mode as QuellenModus)) {
          fehler.push(`plays[${idx}].sources.${angle}.source_mode ist ungültig.`);
        }
        if (typeof src.start_ms !== 'number' || src.start_ms < 0) {
          fehler.push(`plays[${idx}].sources.${angle}.start_ms muss >= 0 sein.`);
        }
        if (typeof src.end_ms !== 'number' || src.end_ms <= Number(src.start_ms ?? 0)) {
          fehler.push(`plays[${idx}].sources.${angle}.end_ms muss > start_ms sein.`);
        }
        if (src.offset_ms !== undefined && src.offset_ms !== null && typeof src.offset_ms !== 'number') {
          fehler.push(`plays[${idx}].sources.${angle}.offset_ms muss eine Zahl oder weggelassen sein.`);
        }
      }
    });
  }

  if (fehler.length > 0) {
    return { ok: false, fehler };
  }
  return { ok: true, bundle: roh as SidelineBundleV1 };
}

export function konvertiereReelZuSidelineBundle(
  reel: Pick<VideoReelEintrag, 'title' | 'category' | 'eventDate' | 'visibility' | 'angles'>,
  plays: readonly PlayEintrag[],
  optionen: { allowedFields?: string[]; includeVisibility?: boolean } = {}
): SidelineBundleV1 {
  return {
    schema_version: '1.0',
    reel: {
      title: reel.title,
      category: reel.category,
      event_date: reel.eventDate,
      ...(optionen.includeVisibility !== false ? { visibility: reel.visibility } : {}),
    },
    angles: [...reel.angles],
    plays: plays.map((play) => {
      const sources: SidelineBundleV1['plays'][number]['sources'] = {};
      for (const [angle, src] of Object.entries(play.sources)) {
        sources[angle] = {
          file: src.fileName,
          source_mode: src.sourceMode,
          start_ms: src.startMs,
          end_ms: src.endMs,
          ...(typeof src.offsetMs === 'number' && src.offsetMs !== 0
            ? { offset_ms: src.offsetMs }
            : {}),
        };
      }
      const breakdown = optionen.allowedFields
        ? filtereBreakdownAufFelder(play.breakdown, optionen.allowedFields)
        : { ...play.breakdown };

      return {
        play_number: play.playNumber,
        sources,
        breakdown,
      };
    }),
  };
}

function escapeCsvWert(wert: unknown): string {
  const str = wert === undefined || wert === null ? '' : String(wert);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function konvertierePlaysZuCsv(
  plays: readonly PlayEintrag[],
  spaltenKeys: readonly string[]
): string {
  const kopf = ['play_number', ...spaltenKeys].map(escapeCsvWert).join(',');
  const zeilen = plays.map((play) => {
    const werte = [
      play.playNumber,
      ...spaltenKeys.map((k) => (k === 'play_number' ? play.playNumber : play.breakdown[k])),
    ];
    return werte.map(escapeCsvWert).join(',');
  });
  return [kopf, ...zeilen].join('\n');
}
