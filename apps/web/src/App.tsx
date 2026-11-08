import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LibraryStatusDto } from '@karaokej/shared';
import { api } from './api';
import { LibraryPage } from './pages/LibraryPage';
import { KaraokePage } from './pages/KaraokePage';
import { SettingsPage } from './pages/SettingsPage';
export function App() {
  const [status, setStatus] = useState<LibraryStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.libraryStatus();
      setStatus(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (loadError) {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <h1>Could not reach Karaokej</h1>
          <p className="setup-error">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <p>Starting…</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/karaoke" element={<KaraokePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
