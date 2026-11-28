import { useEffect, useMemo, useState } from 'react';
import type { PluginSettingsPanelProps, TeamRolle } from '@sidelineos/plugin-sdk';
import {
  Calendar,
  Check,
  HardDrive,
  Keyboard,
  Palette,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import {
  STANDARD_ALLE_FARBE,
  STANDARD_GRUPPEN_FARBEN,
  STANDARD_STAFF_FARBE,
  bereinigeAnmerkungsKonfig,
  normalisiereGruppenName,
} from '../services/annotationVisibility';
import { erstelleVideoApi } from '../services/apiClient';
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
  PluginSaisonEintrag,
  TeamTaggingSchema,
} from '../types/video';
import { TaggingSchemaSettings } from './TaggingSchemaSettings';

const SCOPE_REIHENFOLGE: HotkeyScope[] = ['GLOBAL', 'FILM_ROOM', 'FAST_CUT'];

function formatiereBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const einheiten = ['B', 'KB', 'MB', 'GB', 'TB'];
  let wert = bytes;
  let idx = 0;
  while (wert >= 1024 && idx < einheiten.length - 1) {
    wert /= 1024;
    idx += 1;
  }
  return `${wert.toFixed(idx >= 2 ? 1 : 0)} ${einheiten[idx]}`;
}

function VideoAccountSettingsPanel({ props }: { props: PluginSettingsPanelProps }) {
  const t = erstelleVideoTranslator(props.locale);
  const lang = props.locale === 'en' ? 'en' : 'de';
  const api = useMemo(() => erstelleVideoApi(props.apiFetch), [props.apiFetch]);

  const [prefs, setPrefs] = useState<BenutzerVideoPraeferenzen>({
    userUuid: props.user.uuid,
    hotkeys: STANDARD_HOTKEYS,
    defaultCorner: 'top-right',
    defaultPlaybackRate: 1,
    autoStopEnabled: true,
    updatedAt: new Date().toISOString(),
  });
  const [aufnahmeAktion, setAufnahmeAktion] = useState<HotkeyAktion | null>(null);
  const [konfliktHinweis, setKonfliktHinweis] = useState<string | null>(null);

  useEffect(() => {
    api
      .holePraeferenzen()
      .then((res) =>
        setPrefs({
          ...res.prefs,
          hotkeys: bereinigeHotkeyBelegung(res.prefs.hotkeys),
        })
      )
      .catch(() => undefined);
  }, [api]);

  const speicherePrefs = async (next: BenutzerVideoPraeferenzen) => {
    setPrefs(next);
    await api.speicherePraeferenzen(next).catch(() => undefined);
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
              void speicherePrefs({ ...prefs, hotkeys: { ...STANDARD_HOTKEYS } });
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
                void speicherePrefs({ ...prefs, defaultCorner: e.target.value as EckPosition })
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
                void speicherePrefs({ ...prefs, defaultPlaybackRate: Number(e.target.value) })
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
                void speicherePrefs({ ...prefs, autoStopEnabled: e.target.checked })
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
                          if (!kombi) return;
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
                            void speicherePrefs({ ...prefs, hotkeys: ergebnis.belegung });
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

function VideoClubSettingsPanel({ props }: { props: PluginSettingsPanelProps }) {
  const t = erstelleVideoTranslator(props.locale);
  const api = useMemo(() => erstelleVideoApi(props.apiFetch), [props.apiFetch]);
  const teamId = props.team?.id ?? props.club?.id ?? 'team';
  // Im Club-/Team-Settings-Kontext sind Club-/Team-Admins schreibberechtigt
  const effektiveRolle: TeamRolle = 'TEAM_ADMIN';

  const [schema, setSchema] = useState<TeamTaggingSchema>(() => ({
    ...erstelleStandardTeamSchema(teamId),
    annotationSharing: bereinigeAnmerkungsKonfig(null),
  }));
  const [seasons, setSeasons] = useState<PluginSaisonEintrag[]>([]);
  const [neueSaisonName, setNeueSaisonName] = useState('');
  const [neueGruppeName, setNeueGruppeName] = useState('');
  const [neueGruppeFarbe, setNeueGruppeFarbe] = useState('#38BDF8');
  const [speicherHinweis, setSpeicherHinweis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    api
      .holeSchema()
      .then((res) =>
        setSchema({
          ...res.schema,
          annotationSharing: bereinigeAnmerkungsKonfig(res.schema.annotationSharing),
        })
      )
      .catch(() => undefined);
    api
      .holeSaisons()
      .then((res) => setSeasons(res.seasons))
      .catch(() => undefined);
  }, [api]);

  const sharingKonfig = bereinigeAnmerkungsKonfig(schema.annotationSharing);

  const speichereSharingKonfig = async (nextKonfig: AnmerkungsFreigabeKonfig) => {
    setFehler(null);
    const nextSchema: TeamTaggingSchema = {
      ...schema,
      annotationSharing: nextKonfig,
    };
    setSchema(nextSchema);
    try {
      const saved = await api.speichereSchema({
        fields: nextSchema.fields,
        dictionary: nextSchema.dictionary,
        annotationSharing: nextKonfig,
      });
      setSchema(saved.schema);
      setSpeicherHinweis('Gruppen-Farb-Freigaben gespeichert.');
    } catch (err) {
      setFehler(
        err instanceof Error ? err.message : 'Farb-Freigaben konnten nicht gespeichert werden.'
      );
    }
  };

  const handleGruppeHinzufuegen = async () => {
    const label = neueGruppeName.trim();
    const norm = normalisiereGruppenName(label);
    if (!label || !norm) return;
    if (sharingKonfig.groupColors.some((g) => normalisiereGruppenName(g.group) === norm)) {
      setFehler(`Die Gruppe "${label}" existiert bereits.`);
      return;
    }
    setNeueGruppeName('');
    await speichereSharingKonfig({
      ...sharingKonfig,
      groupColors: [
        ...sharingKonfig.groupColors,
        { group: label, label, color: neueGruppeFarbe.toUpperCase() },
      ],
    });
  };

  const handleSaisonErstellen = async () => {
    const name = neueSaisonName.trim();
    if (!name) return;
    setFehler(null);
    try {
      const res = await api.erstelleSaison({ name, setActive: seasons.length === 0 });
      setSeasons((alt) => [res.season, ...alt]);
      setNeueSaisonName('');
      setSpeicherHinweis(`Saison "${name}" angelegt.`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Saison konnte nicht angelegt werden.');
    }
  };

  const handleSaisonAktivieren = async (seasonId: string) => {
    setFehler(null);
    try {
      await api.setzeAktiveSaison(seasonId);
      setSeasons((alt) => alt.map((s) => ({ ...s, isActive: s.id === seasonId })));
      setSpeicherHinweis('Aktive Video-Saison aktualisiert.');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Saison konnte nicht aktiviert werden.');
    }
  };

  return (
    <section id="modul-video-tagging-schema" className="sideline-video-root space-y-6">
      {/* Tagging-Schema & Lernendes Wörterbuch */}
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Tag className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsTeamTitle')}</h2>
        </div>
        <TaggingSchemaSettings
          schema={schema}
          teamRolle={effektiveRolle}
          onSave={async (next) => {
            const komplett: TeamTaggingSchema = {
              ...next,
              annotationSharing: sharingKonfig,
            };
            setSchema(komplett);
            await api.speichereSchema(komplett).catch(() => undefined);
          }}
        />
      </div>

      {/* Dynamische userGroups-Farben für Kommentare & Einzeichnungen (SDK v2.0 / #2) */}
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Palette className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-sl-heading">
                {t('annotationSharingTitle')}
              </h2>
              <p className="text-xs text-sl-muted">
                Ordne Staff, allen Mitgliedern sowie beliebigen Team-Gruppen (SDK v2.0 userGroups)
                eigene Zeichen- und Notizfarben zu.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              void speichereSharingKonfig({
                enabled: sharingKonfig.enabled,
                staffColor: STANDARD_STAFF_FARBE,
                allMembersColor: STANDARD_ALLE_FARBE,
                groupColors: STANDARD_GRUPPEN_FARBEN.map((g) => ({ ...g })),
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-muted hover:border-sl-accent hover:text-sl-heading whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Standardfarben
          </button>
        </div>

        <label className="flex items-center gap-2.5 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5 text-xs text-sl-primary">
          <input
            type="checkbox"
            checked={sharingKonfig.enabled}
            onChange={(e) =>
              void speichereSharingKonfig({
                ...sharingKonfig,
                enabled: e.target.checked,
              })
            }
            className="accent-sl-accent"
          />
          <span>
            <strong className="font-semibold text-sl-heading">
              Zielgerichtetes Gruppen-Farb-Sharing aktivieren
            </strong>{' '}
            – Mitglieder sehen nur Anmerkungen für ihre freigegebenen Gruppen (userGroups).
          </span>
        </label>

        {/* Basis-Farben: Staff & Alle */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5">
            <div>
              <div className="text-xs font-semibold text-sl-heading">{t('visStaffOnly')}</div>
              <div className="font-mono text-[11px] text-sl-muted video-tabular">
                {sharingKonfig.staffColor}
              </div>
            </div>
            <input
              type="color"
              aria-label="Farbe für Staff & Admins"
              disabled={!sharingKonfig.enabled}
              value={sharingKonfig.staffColor}
              onChange={(e) =>
                void speichereSharingKonfig({
                  ...sharingKonfig,
                  staffColor: e.target.value.toUpperCase(),
                })
              }
              className="h-8 w-10 cursor-pointer rounded border border-sl-border bg-transparent p-0.5 disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5">
            <div>
              <div className="text-xs font-semibold text-sl-heading">{t('visAllMembers')}</div>
              <div className="font-mono text-[11px] text-sl-muted video-tabular">
                {sharingKonfig.allMembersColor}
              </div>
            </div>
            <input
              type="color"
              aria-label="Farbe für Alle Mitglieder"
              disabled={!sharingKonfig.enabled}
              value={sharingKonfig.allMembersColor}
              onChange={(e) =>
                void speichereSharingKonfig({
                  ...sharingKonfig,
                  allMembersColor: e.target.value.toUpperCase(),
                })
              }
              className="h-8 w-10 cursor-pointer rounded border border-sl-border bg-transparent p-0.5 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Dynamische Gruppen */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-sl-heading">
            Dynamische Zielgruppen (userGroups)
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {sharingKonfig.groupColors.map((eintrag) => (
              <div
                key={eintrag.group}
                className="flex items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-sl-heading">
                    {eintrag.label || eintrag.group}
                  </div>
                  <div className="font-mono text-[11px] text-sl-muted video-tabular">
                    {eintrag.color}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="color"
                    aria-label={`Farbe für Gruppe ${eintrag.group}`}
                    disabled={!sharingKonfig.enabled}
                    value={eintrag.color}
                    onChange={(e) =>
                      void speichereSharingKonfig({
                        ...sharingKonfig,
                        groupColors: sharingKonfig.groupColors.map((g) =>
                          g.group === eintrag.group
                            ? { ...g, color: e.target.value.toUpperCase() }
                            : g
                        ),
                      })
                    }
                    className="h-7 w-9 cursor-pointer rounded border border-sl-border bg-transparent p-0.5 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    title={`Gruppe ${eintrag.group} entfernen`}
                    onClick={() =>
                      void speichereSharingKonfig({
                        ...sharingKonfig,
                        groupColors: sharingKonfig.groupColors.filter(
                          (g) => g.group !== eintrag.group
                        ),
                      })
                    }
                    className="rounded p-1 text-sl-muted hover:text-sl-danger-text"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <input
              type="text"
              value={neueGruppeName}
              onChange={(e) => setNeueGruppeName(e.target.value)}
              placeholder="Neue Gruppe (z. B. Angriff, Torhüter, Offense)"
              className="flex-1 min-w-[200px] rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
            />
            <input
              type="color"
              value={neueGruppeFarbe}
              onChange={(e) => setNeueGruppeFarbe(e.target.value.toUpperCase())}
              className="h-8 w-10 cursor-pointer rounded border border-sl-border bg-transparent p-0.5"
            />
            <button
              type="button"
              onClick={() => void handleGruppeHinzufuegen()}
              className="inline-flex items-center gap-1 rounded-md bg-sl-accent px-3 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Gruppe hinzufügen
            </button>
          </div>
        </div>
      </div>

      {/* Plugin-eigene Saisons (SDK v2.0) */}
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Calendar className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-sl-heading">{t('seasonsTitle')}</h2>
            <p className="text-xs text-sl-muted">
              Verwalte Saisons direkt im Videoanalyse-Plugin (sportartagnostisch, unabhängig vom
              Core).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={neueSaisonName}
            onChange={(e) => setNeueSaisonName(e.target.value)}
            placeholder="z. B. 2026 oder 2026/27"
            className="flex-1 min-w-[180px] rounded-md border border-sl-border bg-sl-canvas px-3 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleSaisonErstellen()}
            className="inline-flex items-center gap-1 rounded-md bg-sl-accent px-3 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Saison anlegen
          </button>
        </div>

        {seasons.length > 0 && (
          <div className="space-y-1.5">
            {seasons.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-sl-border bg-sl-canvas px-3.5 py-2 text-xs"
              >
                <span className="font-mono font-semibold text-sl-heading video-tabular">
                  {s.name}
                </span>
                {s.isActive ? (
                  <span className="inline-flex items-center gap-1 text-sl-accent font-medium">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Aktiv
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSaisonAktivieren(s.id)}
                    className="rounded border border-sl-border bg-sl-surface px-2.5 py-1 text-xs text-sl-primary hover:border-sl-accent"
                  >
                    Als aktiv setzen
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {fehler && <p className="text-xs text-sl-danger-text">{fehler}</p>}
        {speicherHinweis && <p className="text-xs text-sl-accent">{speicherHinweis}</p>}
      </div>
    </section>
  );
}

function VideoSystemSettingsPanel({ props }: { props: PluginSettingsPanelProps }) {
  const t = erstelleVideoTranslator(props.locale);
  const quota = props.club?.speicher;

  return (
    <section id="modul-video-s3-cleanup" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsSysadminTitle')}</h2>
        </div>
        <p className="text-xs text-sl-muted">
          SDK v2.0 Storage-Isolation mit Zero-Copy-Referenzzähler und Vereins-Speicherlimit.
        </p>
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Plugin Storage-Präfix</dt>
            <dd className="mt-0.5 font-mono text-sl-heading">
              clubs/&lt;clubId&gt;/video/
            </dd>
          </div>
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Aktuelles Vereins-Quota</dt>
            <dd className="mt-0.5 font-mono text-sl-heading video-tabular">
              {quota
                ? `${formatiereBytes(quota.usedBytes)} / ${
                    quota.quotaBytes ? formatiereBytes(quota.quotaBytes) : 'Unbegrenzt'
                  }`
                : 'Vom Host verwaltet (HTTP 413 bei Überschreitung)'}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/**
 * Einheitliches SDK v2.0 SettingsPanel mit Dispatching nach `target` ('account' | 'club' | 'system').
 */
export function VideoSettingsPanel(props: PluginSettingsPanelProps) {
  if (props.target === 'account' || props.panelId === 'video-hotkeys') {
    return <VideoAccountSettingsPanel props={props} />;
  }
  if (props.target === 'system' || props.panelId === 'video-storage') {
    return <VideoSystemSettingsPanel props={props} />;
  }
  return <VideoClubSettingsPanel props={props} />;
}
