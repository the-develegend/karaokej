import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InvalidLibraryPathDto, LibraryStatusDto } from '@karaokej/shared';
import { api } from '../api';
import { useSession } from '../session/SessionProvider';

export function SettingsLibraryPathsSection() {
  const { state } = useSession();
  const [drafts, setDrafts] = useState<string[]>(state.settings.libraryPaths);
  const [mainPath, setMainPath] = useState<string | null>(
    state.settings.mainLibraryPath ?? state.settings.libraryPaths[0] ?? null,
  );
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatusDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(state.settings.libraryPaths);
    setMainPath(
      state.settings.mainLibraryPath ?? state.settings.libraryPaths[0] ?? null,
    );
  }, [state.settings.libraryPaths, state.settings.mainLibraryPath]);

  const loadLibraryStatus = useCallback(() => {
    void api.libraryStatus().then(setLibraryStatus).catch(() => {
      setLibraryStatus(null);
    });
  }, []);

  useEffect(() => {
    loadLibraryStatus();
  }, [loadLibraryStatus, state.settings.libraryPaths]);

  const storedMain =
    state.settings.mainLibraryPath ?? state.settings.libraryPaths[0] ?? null;
  const dirty =
    JSON.stringify(drafts) !== JSON.stringify(state.settings.libraryPaths) ||
    mainPath !== storedMain;

  const invalidByPath = new Map<string, InvalidLibraryPathDto>(
    (libraryStatus?.invalidLibraryPaths ?? []).map((entry) => [entry.path, entry]),
  );

  const addManualPath = () => {
    const trimmed = manualPath.trim();
    if (!trimmed) {
      return;
    }
    setDrafts((prev) => {
      if (prev.includes(trimmed)) {
        return prev;
      }
      const next = [...prev, trimmed];
      if (mainPath == null) {
        setMainPath(trimmed);
      }
      return next;
    });
    setManualPath('');
  };

  const pickFolders = async () => {
    setError(null);
    if (!window.karaokejDesktop?.pickLibraryFolders) {
      setError('Enter folder paths manually, or use the desktop app to pick folders.');
      return;
    }
    try {
      const picked = await window.karaokejDesktop.pickLibraryFolders();
      if (picked.length === 0) {
        return;
      }
      setDrafts((prev) => {
        const next = [...prev];
        for (const folder of picked) {
          if (!next.includes(folder)) {
            next.push(folder);
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.patchSettings({
        libraryPaths: drafts,
        mainLibraryPath: mainPath ?? drafts[0] ?? null,
      });
      setMessage('Library folders saved.');
      loadLibraryStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onRebase = async () => {
    setRebasing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.libraryRebase();
      setMessage(result.message);
      loadLibraryStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRebasing(false);
    }
  };

  return (
    <section className="settings-panel">
      <p className="settings-copy">
        Add one or more folders that contain your music files. Scans walk these
        paths for audio files. Choose one folder as <strong>main</strong> for
        organizing tracks into the library layout. After you change folders,
        choose <strong>Apply / Rebase</strong> so existing catalogue paths match
        before you scan again.
      </p>

      <form onSubmit={onSave}>
        <div className="setup-actions">
          <button type="button" className="secondary" onClick={() => void pickFolders()}>
            Choose folders…
          </button>
          <div className="setup-manual">
            <input
              type="text"
              className="setup-input"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/Music"
              aria-label="Library folder path"
            />
            <button type="button" className="secondary" onClick={addManualPath}>
              Add path
            </button>
          </div>
        </div>

        {drafts.length > 0 ? (
          <ul className="setup-path-list">
            {drafts.map((path) => {
              const invalid = invalidByPath.get(path);
              return (
                <li key={path}>
                  <label className="settings-main-choice" title="Main library folder">
                    <input
                      type="radio"
                      name="main-library-path"
                      checked={mainPath === path}
                      onChange={() => setMainPath(path)}
                    />
                    <span className="sr-only">Main library folder</span>
                  </label>
                  <span className="setup-path-list__path">{path}</span>
                  <span className="setup-path-list__badges">
                    <span className="setup-path-list__main-slot">
                      {mainPath === path ? (
                        <span className="badge">Main</span>
                      ) : null}
                    </span>
                    {invalid ? (
                      <span className="badge warn" title={invalid.reason}>
                        {invalid.reason}
                      </span>
                    ) : !dirty &&
                      state.settings.libraryPaths.includes(path) &&
                      libraryStatus ? (
                      <span className="badge ok">OK</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="modal-secondary"
                    onClick={() => {
                      setDrafts((prev) => {
                        const next = prev.filter((p) => p !== path);
                        if (mainPath === path) {
                          setMainPath(next[0] ?? null);
                        }
                        return next;
                      });
                    }}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="setup-empty">No library folders yet.</p>
        )}

        <div className="settings-actions">
          <button type="submit" className="primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save library folders'}
          </button>
          <button
            type="button"
            disabled={rebasing || !libraryStatus?.rebasePending}
            onClick={() => void onRebase()}
          >
            {rebasing ? 'Applying…' : 'Apply / Rebase'}
          </button>
        </div>

        {libraryStatus?.rebasePending ? (
          <p className="settings-feedback warn">
            Library folders changed since the last rebase. Apply / Rebase before
            scanning or downloading.
          </p>
        ) : null}
        {message ? <p className="settings-feedback">{message}</p> : null}
        {error ? <p className="settings-feedback error">{error}</p> : null}
      </form>

      {!libraryStatus?.libraryConfigured ? (
        <p className="settings-copy">
          Save at least one folder, then{' '}
          <Link to="/">scan the library</Link> from the main page.
        </p>
      ) : null}
    </section>
  );
}
