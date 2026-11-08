import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initApiClient } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { markBootOk, showBootError } from './bootStatus';
import { SessionProvider } from './session/SessionProvider';
import { applyUiScale, readUiScale } from './uiScale';
import './styles.css';

applyUiScale(readUiScale());

async function start(): Promise<void> {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    showBootError('Missing #root element.');
    return;
  }

  try {
    // Electron: wait for the resolved ephemeral API port before any fetch/ws.
    await initApiClient();
    createRoot(rootEl).render(
      <StrictMode>
        <ErrorBoundary>
          <BrowserRouter>
            <SessionProvider>
              <App />
            </SessionProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </StrictMode>,
    );
    markBootOk();
  } catch (error) {
    showBootError(error instanceof Error ? error.message : String(error));
  }
}

void start();
