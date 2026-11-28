import { useEffect } from 'react';
import {
  definierePlugin,
  type PluginLaufzeitKontext,
  type PluginManifest,
  type UnterstuetzteSprache,
} from '@sidelineos/plugin-sdk';
import { Archive } from 'lucide-react';
import manifest from '../plugin.json';
import { ClubVideoManagementView } from './components/ClubVideoManagementView';
import { DashboardView } from './components/DashboardView';
import { FilmRoomView } from './components/FilmRoomView';
import { PublicShareView } from './components/PublicShareView';
import { SmartPlaylistView } from './components/SmartPlaylistView';
import { SyncAndCutView } from './components/SyncAndCutView';
import { UploadPanel } from './components/UploadPanel';
import { VideoSettingsPanel } from './components/VideoSettingsPanels';
import {
  VideoAnalysisProvider,
  useVideoAnalysis,
} from './context/VideoAnalysisContext';
import { erstelleVideoTranslator } from './i18n/woerterbuch';
import { istStaffOderAdminRolle } from './services/annotationVisibility';

function VideoMainShell({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const t = erstelleVideoTranslator(ctx.locale);
  const { ladeBasisDaten, gewaehlteSaison } = useVideoAnalysis();
  const istStaffOderAdmin = istStaffOderAdminRolle(ctx.effektiveTeamRolle);

  useEffect(() => {
    if (ctx.team) {
      void ladeBasisDaten(ctx.team.id, gewaehlteSaison, ctx.user.uuid);
    }
  }, [ctx.team?.id, gewaehlteSaison, ctx.user.uuid, ladeBasisDaten]);

  const istClubAnsicht = ctx.activeView === 'club-library' || (!ctx.team && ctx.clubRolle === 'CLUB_ADMIN');

  return (
    <div className="sideline-video-root space-y-4">
      {ctx.isReadOnly && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-sl-border bg-sl-surface px-4 py-2.5 text-xs text-sl-muted"
        >
          <Archive className="h-4 w-4 shrink-0 text-sl-accent" aria-hidden="true" />
          <span>{t('archivedReadOnlyBanner')}</span>
        </div>
      )}

      {istClubAnsicht ? (
        <ClubVideoManagementView ctx={ctx} />
      ) : ctx.activeView === 'film-room' ? (
        <FilmRoomView ctx={ctx} />
      ) : ctx.activeView === 'sync-cut' && istStaffOderAdmin ? (
        <SyncAndCutView ctx={ctx} />
      ) : ctx.activeView === 'playlists' ? (
        <SmartPlaylistView ctx={ctx} />
      ) : ctx.activeView === 'upload' && istStaffOderAdmin && !ctx.isReadOnly ? (
        <UploadPanel ctx={ctx} inline />
      ) : (
        <DashboardView ctx={ctx} />
      )}

      {ctx.activeView !== 'upload' && <UploadPanel ctx={ctx} />}
    </div>
  );
}

function HauptAnsicht({ ctx }: { ctx: PluginLaufzeitKontext }) {
  return (
    <VideoAnalysisProvider apiFetch={ctx.apiFetch}>
      <VideoMainShell ctx={ctx} />
    </VideoAnalysisProvider>
  );
}

function OeffentlicheAnsicht({ token, locale }: { token: string; locale: UnterstuetzteSprache }) {
  return (
    <div className="sideline-video-root">
      <PublicShareView token={token} locale={locale} />
    </div>
  );
}

const plugin = definierePlugin({
  manifest: manifest as unknown as PluginManifest,
  HauptAnsicht,
  OeffentlicheAnsicht,
  SettingsPanel: VideoSettingsPanel,
});

export default plugin;
