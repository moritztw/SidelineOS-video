import { useEffect, useState } from 'react';
import type { PluginSettingsKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { HardDrive, Keyboard, Palette, RotateCcw, Tag } from 'lucide-react';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import {
  ANMERKUNGS_ZIELGRUPPEN,
  STANDARD_ANMERKUNGS_FARBEN,
  bereinigeAnmerkungsKonfig,
} from '../services/annotationVisibility';
import { videoApi } from '../services/apiClient';
import {
  HOTKEY_AKTION_LABELS,
  HOTKEY_SCOPES,
  HOTKEY_SCOPE_LABELS,
  STANDARD_HOTKEYS,
  aktualisiereBenutzerHotkey,
  bereinigeHotkeyBelegung,
  formatiereHotkeyAnzeige,
  kombinationAusKeyboardEvent,
} from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  AnmerkungsFreigabeKonfig,
  BenutzerVideoPraeferenzen,
  EckPosition,
  HotkeyAktion,
  HotkeyScope,
  SichtbarkeitsStufe,
  TeamTaggingSchema,
} from '../types/video';
import { TaggingSchemaSettings } from './TaggingSchemaSettings';

const SCOPE_REIHENFOLGE: HotkeyScope[] = ['GLOBAL', 'FILM_ROOM', 'FAST_CUT'];

export function VideoUserSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const lang = ctx.locale === 'en' ? 'en' : 'de';

  const [prefs, setPrefs] = useState<BenutzerVideoPraeferenzen>({
    userUuid: ctx.benutzer.uuid,
    hotkeys: STANDARD_HOTKEYS,
    defaultCorner: 'top-right',
    defaultPlaybackRate: 1,
    autoStopEnabled: true,
    updatedAt: new Date().toISOString(),
  });
  const [aufnahmeAktion, setAufnahmeAktion] = useState<HotkeyAktion | null>(null);
  const [konfliktHinweis, setKonfliktHinweis] = useState<string | null>(null);

  useEffect(() => {
    videoApi
      .holePraeferenzen(ctx.team.id)
      .then((res) =>
        setPrefs({
          ...res.prefs,
          hotkeys: bereinigeHotkeyBelegung(res.prefs.hotkeys),
        })
      )
      .catch(() => undefined);
  }, [ctx.team.id]);

  const speicherePrefs = async (next: BenutzerVideoPraeferenzen) => {
    setPrefs(next);
    await videoApi.speicherePraeferenzen(ctx.team.id, next).catch(() => undefined);
  };

  const alleAktionen = Object.keys(STANDARD_HOTKEYS) as HotkeyAktion[];

  return (
    <section id="modul-video-hotkeys" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Keyboard className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            <h2 className="text-base font-semibold text-sl-heading">{t('settingsUserTitle')}</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setKonfliktHinweis(null);
              setAufnahmeAktion(null);
              speicherePrefs({ ...prefs, hotkeys: { ...STANDARD_HOTKEYS } });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-muted hover:border-sl-accent hover:text-sl-heading whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Standard-Hotkeys wiederherstellen
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="text-sl-muted">Standard-Kommentar-Ecke</span>
            <select
              value={prefs.defaultCorner}
              onChange={(e) =>
                speicherePrefs({ ...prefs, defaultCorner: e.target.value as EckPosition })
              }
              className="w-full rounded-md border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading"
            >
              <option value="top-left">Oben links</option>
              <option value="top-right">Oben rechts</option>
              <option value="bottom-left">Unten links</option>
              <option value="bottom-right">Unten rechts</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-sl-muted">Standard-Tempo</span>
            <select
              value={prefs.defaultPlaybackRate}
              onChange={(e) =>
                speicherePrefs({ ...prefs, defaultPlaybackRate: Number(e.target.value) })
              }
              className="w-full rounded-md border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={1.5}>1.5x</option>
            </select>
          </label>

          <label className="flex items-center gap-2 pt-5 text-xs text-sl-primary">
            <input
              type="checkbox"
              checked={prefs.autoStopEnabled}
              onChange={(e) =>
                speicherePrefs({ ...prefs, autoStopEnabled: e.target.checked })
              }
              className="accent-sl-accent"
            />
            Auto-Stop an Notiz-/Zeichnungs-Frames aktiv
          </label>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-sl-heading">Persönliche Hotkeys</div>
            <p className="text-xs text-sl-muted">
              Unterstützt auch Kombinationen mit Strg, Alt und Shift. Film Room und Fast-Cut dürfen
              dieselben Tasten unabhängig voneinander belegen.
            </p>
          </div>

          {SCOPE_REIHENFOLGE.map((scope) => {
            const aktionen = alleAktionen.filter((a) => HOTKEY_SCOPES[a] === scope);
            return (
              <div key={scope} className="space-y-2 border-t border-sl-border/70 pt-3">
                <div className="text-xs font-medium text-sl-muted">
                  {HOTKEY_SCOPE_LABELS[scope][lang]}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {aktionen.map((aktion) => (
                    <div
                      key={aktion}
                      className="flex items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs"
                    >
                      <span className="text-sl-primary">
                        {HOTKEY_AKTION_LABELS[aktion][lang]}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setKonfliktHinweis(null);
                          setAufnahmeAktion(aktion);
                        }}
                        onBlur={() => {
                          if (aufnahmeAktion === aktion) setAufnahmeAktion(null);
                        }}
                        onKeyDown={(e) => {
                          if (aufnahmeAktion !== aktion) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                            setAufnahmeAktion(null);
                            return;
                          }
                          const kombi = kombinationAusKeyboardEvent(e);
                          if (!kombi) return; // Warten auf Haupttaste nach Strg/Alt/Shift
                          const ergebnis = aktualisiereBenutzerHotkey(
                            prefs.hotkeys,
                            aktion,
                            kombi
                          );
                          if (!ergebnis.ok && ergebnis.konfliktAktion) {
                            setKonfliktHinweis(
                              `Kombination "${formatiereHotkeyAnzeige(kombi)}" ist im selben Bereich bereits belegt durch "${HOTKEY_AKTION_LABELS[ergebnis.konfliktAktion][lang]}".`
                            );
                          } else {
                            setKonfliktHinweis(null);
                            setAufnahmeAktion(null);
                            speicherePrefs({ ...prefs, hotkeys: ergebnis.belegung });
                          }
                        }}
                        className={`rounded px-2.5 py-1 font-mono text-xs whitespace-nowrap shrink-0 ${
                          aufnahmeAktion === aktion
                            ? 'bg-sl-accent font-semibold text-sl-accent-contrast'
                            : 'bg-sl-surface text-sl-primary hover:bg-sl-elevated'
                        }`}
                      >
                        {aufnahmeAktion === aktion
                          ? 'Taste / Kombi drücken...'
                          : formatiereHotkeyAnzeige(prefs.hotkeys[aktion])}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {konfliktHinweis && <p className="text-xs text-sl-danger-text">{konfliktHinweis}</p>}
        </div>
      </div>
    </section>
  );
}

export function VideoTeamSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const istTeamAdmin = ctx.aktiveTeamAnsicht === 'TEAM_ADMIN';

  const [schema, setSchema] = useState<TeamTaggingSchema>(() => ({
    ...erstelleStandardTeamSchema(ctx.team.id),
    annotationSharing: bereinigeAnmerkungsKonfig(null),
  }));
  const [speicherHinweis, setSpeicherHinweis] = useState<string | null>(null);

  useEffect(() => {
    videoApi
      .holeSchema(ctx.team.id)
      .then((res) =>
        setSchema({
          ...res.schema,
          annotationSharing: bereinigeAnmerkungsKonfig(res.schema.annotationSharing),
        })
      )
      .catch(() => undefined);
  }, [ctx.team.id]);

  const sharingKonfig = bereinigeAnmerkungsKonfig(schema.annotationSharing);

  const speichereSharingKonfig = async (nextKonfig: AnmerkungsFreigabeKonfig) => {
    const nextSchema: TeamTaggingSchema = {
      ...schema,
      annotationSharing: nextKonfig,
    };
    setSchema(nextSchema);
    try {
      const saved = await videoApi.speichereSchema(ctx.team.id, {
        fields: nextSchema.fields,
        dictionary: nextSchema.dictionary,
        annotationSharing: nextKonfig,
      });
      setSchema(saved.schema);
      setSpeicherHinweis('Farb-Freigaben gespeichert.');
    } catch (err) {
      setSpeicherHinweis(
        err instanceof Error ? err.message : 'Farb-Freigaben konnten nicht gespeichert werden.'
      );
    }
  };

  return (
    <section id="modul-video-tagging-schema" className="sideline-video-root space-y-6">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Tag className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsTeamTitle')}</h2>
        </div>
        <TaggingSchemaSettings
          schema={schema}
          teamRolle={ctx.aktiveTeamAnsicht}
          onSave={async (next) => {
            const komplett: TeamTaggingSchema = {
              ...next,
              annotationSharing: sharingKonfig,
            };
            setSchema(komplett);
            await videoApi.speichereSchema(ctx.team.id, komplett).catch(() => undefined);
          }}
        />
      </div>

      {/* Gezieltes Farb-Sharing für Kommentare & Einzeichnungen (#2) */}
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Palette className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-sl-heading">
                {t('annotationSharingTitle')}
              </h2>
              <p className="text-xs text-sl-muted">
                Ordne jeder Zeichen- und Notizfarbe eine Spieler-Zielgruppe zu. Spieler sehen nur
                Anmerkungen ihrer freigegebenen Gruppe.
              </p>
            </div>
          </div>

          {istTeamAdmin && (
            <button
              type="button"
              onClick={() =>
                speichereSharingKonfig({
                  ...sharingKonfig,
                  colorMap: { ...STANDARD_ANMERKUNGS_FARBEN },
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-muted hover:border-sl-accent hover:text-sl-heading whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Standardfarben
            </button>
          )}
        </div>

        <label className="flex items-center gap-2.5 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5 text-xs text-sl-primary">
          <input
            type="checkbox"
            disabled={!istTeamAdmin}
            checked={sharingKonfig.enabled}
            onChange={(e) =>
              speichereSharingKonfig({
                ...sharingKonfig,
                enabled: e.target.checked,
              })
            }
            className="accent-sl-accent"
          />
          <span>
            <strong className="font-semibold text-sl-heading">
              Zielgerichtetes Farb-Sharing aktivieren
            </strong>{' '}
            – Wenn deaktiviert, stehen alle Farben frei ohne Gruppenbindung zur Verfügung.
          </span>
        </label>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {ANMERKUNGS_ZIELGRUPPEN.map((gruppe) => {
            const hex = sharingKonfig.colorMap[gruppe.id];
            return (
              <div
                key={gruppe.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-sl-heading">{gruppe.labelDe}</div>
                  <div className="font-mono text-[11px] text-sl-muted video-tabular">{hex}</div>
                </div>
                <input
                  type="color"
                  aria-label={`Farbe für ${gruppe.labelDe}`}
                  disabled={!istTeamAdmin || !sharingKonfig.enabled}
                  value={hex}
                  onChange={(e) => {
                    const nextMap: Record<SichtbarkeitsStufe, string> = {
                      ...sharingKonfig.colorMap,
                      [gruppe.id]: e.target.value.toUpperCase(),
                    };
                    speichereSharingKonfig({
                      ...sharingKonfig,
                      colorMap: nextMap,
                    });
                  }}
                  className="h-8 w-10 cursor-pointer rounded border border-sl-border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            );
          })}
        </div>

        {!istTeamAdmin && (
          <p className="text-xs text-sl-muted">
            Nur der Team Admin kann das Farb-Mapping ändern oder deaktivieren.
          </p>
        )}
        {speicherHinweis && <p className="text-xs text-sl-accent">{speicherHinweis}</p>}
      </div>
    </section>
  );
}

export function VideoSysadminSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  return (
    <section id="modul-video-s3-cleanup" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsSysadminTitle')}</h2>
        </div>
        <p className="text-xs text-sl-muted">
          DSGVO-konforme S3-Isolation ohne Einsicht in Team-Videos oder Coach-Notizen.
        </p>
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Anonymisierter S3-Präfix</dt>
            <dd className="mt-0.5 font-mono text-sl-heading">
              teams/&lt;teamId&gt;/plugins/video-analysis/
            </dd>
          </div>
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Cleanup-Schonfrist (Retention)</dt>
            <dd className="mt-0.5 font-mono text-sl-heading video-tabular">
              {ctx.s3Konfig.cleanupRetentionDays ?? 14} Tage
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
