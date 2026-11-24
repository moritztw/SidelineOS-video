import type {
  PlayEintrag,
  PlaylistFilterRegel,
  WinkelCode,
} from '../types/video';

function holeFeldWert(play: PlayEintrag, fieldKey: string): string | number | undefined {
  if (fieldKey === 'play_number') return play.playNumber;
  const wert = play.breakdown[fieldKey];
  if (typeof wert === 'boolean') return wert ? 'Ja' : 'Nein';
  return wert;
}

export function pruefeRegelAufPlay(play: PlayEintrag, regel: PlaylistFilterRegel): boolean {
  const rohWert = holeFeldWert(play, regel.fieldKey);
  const ziel = regel.value.trim();

  if (regel.operator === 'not_empty') {
    return rohWert !== undefined && String(rohWert).trim().length > 0;
  }

  if (rohWert === undefined || rohWert === null) {
    return regel.operator === 'not_equals' && ziel.length > 0;
  }

  const istNumerisch =
    typeof rohWert === 'number' ||
    (ziel !== '' && !Number.isNaN(Number(ziel)) && !Number.isNaN(Number(rohWert)));

  switch (regel.operator) {
    case 'equals':
      return String(rohWert).trim().toLowerCase() === ziel.toLowerCase();
    case 'not_equals':
      return String(rohWert).trim().toLowerCase() !== ziel.toLowerCase();
    case 'contains':
      return String(rohWert).toLowerCase().includes(ziel.toLowerCase());
    case 'gt':
      return istNumerisch && Number(rohWert) > Number(ziel);
    case 'gte':
      return istNumerisch && Number(rohWert) >= Number(ziel);
    case 'lt':
      return istNumerisch && Number(rohWert) < Number(ziel);
    case 'lte':
      return istNumerisch && Number(rohWert) <= Number(ziel);
    default:
      return false;
  }
}

export function filterePlaysNachRegeln(
  plays: readonly PlayEintrag[],
  regeln: readonly PlaylistFilterRegel[],
  matchMode: 'ALL' | 'ANY' = 'ALL'
): PlayEintrag[] {
  if (regeln.length === 0) return [...plays];
  return plays.filter((play) => {
    if (matchMode === 'ANY') {
      return regeln.some((r) => pruefeRegelAufPlay(play, r));
    }
    return regeln.every((r) => pruefeRegelAufPlay(play, r));
  });
}

export interface PlaySyncAnalyse {
  playId: string;
  playNumber: number;
  fehlendeWinkel: WinkelCode[];
  vorhandeneWinkel: WinkelCode[];
  hatOffset: boolean;
}

export function analysierePlaySyncStatus(
  plays: readonly PlayEintrag[],
  reelWinkel: readonly WinkelCode[]
): PlaySyncAnalyse[] {
  return plays.map((play) => {
    const vorhandeneWinkel = reelWinkel.filter((w) => Boolean(play.sources[w]));
    const fehlendeWinkel = reelWinkel.filter((w) => !play.sources[w]);
    const hatOffset = Object.values(play.sources).some(
      (s) => typeof s.offsetMs === 'number' && s.offsetMs !== 0
    );
    return {
      playId: play.id,
      playNumber: play.playNumber,
      fehlendeWinkel,
      vorhandeneWinkel,
      hatOffset,
    };
  });
}
