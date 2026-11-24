import type {
  SprachWoerterbuecher,
  UnterstuetzteSprache,
} from '@sidelineos/plugin-sdk';

export function uebersetzeSchluessel(
  woerterbuecher: SprachWoerterbuecher,
  sprache: string | undefined,
  schluessel: string,
  variablen?: Record<string, string | number | undefined>
): string {
  const code: UnterstuetzteSprache = sprache === 'en' ? 'en' : 'de';
  let text = woerterbuecher[code]?.[schluessel] ?? woerterbuecher.de[schluessel] ?? schluessel;
  if (variablen) {
    for (const [k, v] of Object.entries(variablen)) {
      text = text.replaceAll(`{{${k}}}`, String(v ?? ''));
    }
  }
  return text;
}

export function createPluginTranslator(
  woerterbuecher: SprachWoerterbuecher,
  locale?: string
) {
  return (schluessel: string, variablen?: Record<string, string | number | undefined>) =>
    uebersetzeSchluessel(woerterbuecher, locale, schluessel, variablen);
}

export function ermittleEintragSaison(eintrag: {
  saison?: string;
  eventDate: string;
}): string {
  const explizit = eintrag.saison?.trim();
  if (explizit) return explizit;
  return eintrag.eventDate.slice(0, 4);
}

export function filtereNachSaison<T extends { saison?: string; eventDate: string }>(
  eintraege: readonly T[],
  saison: string
): T[] {
  if (!saison || saison === 'ALL') return [...eintraege];
  return eintraege.filter((eintrag) => ermittleEintragSaison(eintrag) === saison);
}
