import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppSettingsDto } from '@karaokej/shared';
import { AppTopbar } from '../components/AppTopbar';
import { PlayerBar } from '../components/PlayerBar';
import {
  getDismissedIds,
  KNOWN_MODALS,
  resetDismissedModals,
} from '../modals/dismissedModals';
import {
  BACKGROUND_MODE_LABELS,
  BACKGROUND_MODE_OPTIONS,
  BackgroundMode,
  readBackgroundMode,
  writeBackgroundMode,
} from '../backgrounds/backgroundMode';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';
import { SettingsTagsSection } from '../components/SettingsTagsSection';
import { SettingsLibraryPathsSection } from '../components/SettingsLibraryPathsSection';
import { SettingsToolPathsSection } from '../components/SettingsToolPathsSection';
import { SettingsMetadataProvidersSection } from '../components/SettingsMetadataProvidersSection';
import { SettingsGroup } from '../components/SettingsGroup';

const RATING_COLOR_FIELDS: Array<{
  key: keyof Pick<
    AppSettingsDto,
    'ratingGold' | 'ratingSilver' | 'ratingBlue' | 'ratingRaspberry'
  >;
  label: string;
  ranges: string;
}> = [
  { key: 'ratingGold', label: 'Gold', ranges: '5 and 4.5 stars' },
  { key: 'ratingSilver', label: 'Silver', ranges: '4 and 3.5 stars' },
  { key: 'ratingBlue', label: 'Blue', ranges: '3 and 2.5 stars' },
  { key: 'ratingRaspberry', label: 'Raspberry', ranges: '2 through 0.5 stars' },
];

export function SettingsPage() {
  const { state } = useSession();
  const [dismissedIds, setDismissedIds] = useState(() => getDismissedIds());
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => readBackgroundMode());

  const handleReset = () => {
    resetDismissedModals();
    setDismissedIds([]);
    setResetMessage('Dismissed dialogs reset.');
  };

  const handleRemovePlayedChange = (checked: boolean) => {
    setSettingsError(null);
    void api.patchSettings({ removePlayedFromQueue: checked }).catch((err) => {
      setSettingsError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleCrossfadeChange = (seconds: number) => {
    setSettingsError(null);
    void api.patchSettings({ crossfadeSeconds: seconds }).catch((err) => {
      setSettingsError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleRatingColorChange = (
    key: (typeof RATING_COLOR_FIELDS)[number]['key'],
    value: string,
  ) => {
    setSettingsError(null);
    void api.patchSettings({ [key]: value }).catch((err) => {
      setSettingsError(err instanceof Error ? err.message : String(err));
    });
  };

  const crossfadeLabel =
    state.settings.crossfadeSeconds === 0
      ? 'Off'
      : `${state.settings.crossfadeSeconds} second${state.settings.crossfadeSeconds === 1 ? '' : 's'}`;

  const handleBackgroundModeChange = (mode: BackgroundMode) => {
    writeBackgroundMode(mode);
    setBackgroundMode(mode);
  };

  return (
    <div className="app-shell settings-shell">
      <header className="topbar">
        <Link className="topbar-link" to="/">
          Back to library
        </Link>
        <AppTopbar
          eyebrow="Perhaps I can't sing well, but it is..."
          title={
            <>
              <span className="brand-kara">Kara</span>okej
            </>
          }
          trailing={null}
        />
      </header>

      <main className="settings-page">
        <SettingsGroup title="Music library folders">
          <SettingsLibraryPathsSection />
        </SettingsGroup>

        <SettingsGroup title="Tags">
          <SettingsTagsSection />
        </SettingsGroup>

        <SettingsGroup
          title="Metadata providers"
          lead="Configure online metadata sources for Edit metadata search. Order controls which provider is tried first."
        >
          <SettingsMetadataProvidersSection providers={state.settings.metadataProviders} />
        </SettingsGroup>

        <SettingsGroup title="Queue">
          <section className="settings-panel">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={state.settings.removePlayedFromQueue}
                onChange={(event) => handleRemovePlayedChange(event.target.checked)}
              />
              <span>Remove played songs from the Queue List</span>
            </label>
            <p className="settings-copy">
              When enabled, a song is removed from the queue after it finishes playing
              naturally. Skipped songs stay in the queue. Audio files are not deleted.
            </p>
            {settingsError && <p className="settings-feedback error">{settingsError}</p>}
          </section>
        </SettingsGroup>

        <SettingsGroup title="Playback">
          <section className="settings-panel">
            <label className="karaoke-slider-label">
              Crossfade
              <input
                className="karaoke-slider"
                type="range"
                min={0}
                max={10}
                step={1}
                value={state.settings.crossfadeSeconds}
                onChange={(event) => handleCrossfadeChange(Number(event.target.value))}
                aria-valuetext={crossfadeLabel}
              />
              <span className="karaoke-slider-value">{crossfadeLabel}</span>
            </label>
            <p className="settings-copy">
              When enabled, the next queued song starts fading in before the current
              song ends. Set to 0 to turn off. Use the crossfade button in the
              player bar to toggle quickly; it stays on for every song until you
              turn it off.
            </p>
            {settingsError && <p className="settings-feedback error">{settingsError}</p>}
          </section>
        </SettingsGroup>

        <SettingsGroup title="Star rating colors">
          <section className="settings-panel">
            <p className="settings-copy">
              Rating ranges are fixed. Adjust the four colors used for library stars.
            </p>
            <ul className="settings-color-list">
              {RATING_COLOR_FIELDS.map(({ key, label, ranges }) => (
                <li key={key}>
                  <label className="settings-color-row">
                    <span className="settings-color-copy">
                      <strong>{label}</strong>
                      <span className="settings-color-ranges">{ranges}</span>
                    </span>
                    <input
                      type="color"
                      value={state.settings[key]}
                      onChange={(event) =>
                        handleRatingColorChange(key, event.target.value)
                      }
                      aria-label={`${label} star color`}
                    />
                  </label>
                </li>
              ))}
            </ul>
            {settingsError && <p className="settings-feedback error">{settingsError}</p>}
          </section>
        </SettingsGroup>

        <SettingsGroup title="Karaoke background">
          <section className="settings-panel">
            <fieldset className="settings-fieldset">
              <legend className="sr-only">Karaoke background</legend>
              {BACKGROUND_MODE_OPTIONS.map((option) => (
                <label key={option} className="settings-toggle">
                  <input
                    type="radio"
                    name="karaoke-background"
                    value={option}
                    checked={backgroundMode === option}
                    onChange={() => handleBackgroundModeChange(option)}
                  />
                  <span>{BACKGROUND_MODE_LABELS[option]}</span>
                </label>
              ))}
            </fieldset>
            <p className="settings-copy">
              Applies to the karaoke display on this device. Shuffle picks a random
              animation for each song.
            </p>
          </section>
        </SettingsGroup>

        <SettingsGroup
          title="External tools"
          lead="Optional paths for ffmpeg, yt-dlp, Demucs, and related helpers."
          layout="cards-2"
        >
          <SettingsToolPathsSection savedPaths={state.settings} />
        </SettingsGroup>

        <SettingsGroup title="Help dialogs">
          <section className="settings-panel">
            <p className="settings-copy">
              Help dialogs can be hidden with &ldquo;Do not show again&rdquo;. Reset
              them here to show the next time you start a scan or lyrics fetch.
            </p>
            <ul className="settings-list">
              {KNOWN_MODALS.map((modal) => (
                <li key={modal.id}>
                  <span>{modal.label}</span>
                  <span className={`badge ${dismissedIds.includes(modal.id) ? 'warn' : 'ok'}`}>
                    {dismissedIds.includes(modal.id) ? 'Hidden' : 'Shown'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="settings-actions">
              <button type="button" onClick={handleReset}>
                Reset dismissed dialogs
              </button>
              {resetMessage && <p className="settings-feedback">{resetMessage}</p>}
            </div>
          </section>
        </SettingsGroup>
      </main>

      <PlayerBar />
    </div>
  );
}
