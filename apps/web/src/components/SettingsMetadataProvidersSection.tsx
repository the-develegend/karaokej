import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  METADATA_SEARCH_PROVIDER_IDS,
  MetadataProviderId,
  MetadataProvidersSettingsDto,
} from '@karaokej/shared';
import { api } from '../api';
import { ProcessingText } from './ProcessingText';

type ProviderCard = {
  id: MetadataProviderId;
  title: string;
  hint: string;
  signupUrl: string;
  searchCapable: boolean;
};

const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: 'musicbrainz',
    title: 'MusicBrainz',
    hint: 'No API key. Identify your app with a contact email. Rate limit: about 1 request per second.',
    signupUrl: 'https://musicbrainz.org/doc/MusicBrainz_API',
    searchCapable: true,
  },
  {
    id: 'discogs',
    title: 'Discogs',
    hint: 'Personal access token required. Authenticated limit is about 60 requests per minute.',
    signupUrl: 'https://www.discogs.com/settings/developers',
    searchCapable: true,
  },
  {
    id: 'lastfm',
    title: 'Last.fm',
    hint: 'API key required. Apply rate limits locally if you search heavily.',
    signupUrl: 'https://www.last.fm/api/account/create',
    searchCapable: true,
  },
  {
    id: 'gnudb',
    title: 'GnuDB',
    hint: 'No API key. Use a real contact email and client name. Supports text/fuzzy search over CDDB data.',
    signupUrl: 'https://gnudb.org/',
    searchCapable: true,
  },
  {
    id: 'spotify',
    title: 'Spotify',
    hint: 'Client ID and secret (Client Credentials). Subject to Spotify API rate limits.',
    signupUrl: 'https://developer.spotify.com/dashboard',
    searchCapable: true,
  },
  {
    id: 'acoustid',
    title: 'AcoustID',
    hint: 'API key required. Fingerprint search in Edit metadata is planned later; configure and test the key now.',
    signupUrl: 'https://acoustid.org/new-application',
    searchCapable: false,
  },
];

function orderIndex(order: MetadataProviderId[], id: MetadataProviderId): number {
  return order.indexOf(id);
}

export function SettingsMetadataProvidersSection({
  providers,
}: {
  providers: MetadataProvidersSettingsDto;
}) {
  const [draft, setDraft] = useState(providers);

  useEffect(() => {
    setDraft(providers);
  }, [providers]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<
    Partial<Record<MetadataProviderId, { running: boolean; message: string | null }>>
  >({});

  const orderedCards = useMemo(() => {
    const rank = new Map(draft.order.map((id, index) => [id, index]));
    return [...PROVIDER_CARDS].sort(
      (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99),
    );
  }, [draft.order]);

  const patchProviders = useCallback(
    async (partial: Partial<MetadataProvidersSettingsDto>) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await api.patchSettings({
          metadataProviders: { ...draft, ...partial },
        });
        setDraft(updated.metadataProviders);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [draft],
  );

  const moveProvider = (id: MetadataProviderId, delta: -1 | 1) => {
    const order = [...draft.order];
    const index = orderIndex(order, id);
    if (index < 0) {
      return;
    }
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= order.length) {
      return;
    }
    const swapped = order[nextIndex]!;
    order[nextIndex] = id;
    order[index] = swapped;
    void patchProviders({ order });
  };

  const runTest = async (id: MetadataProviderId) => {
    setTestState((prev) => ({ ...prev, [id]: { running: true, message: null } }));
    try {
      const result = await api.testMetadataProvider(id);
      setTestState((prev) => ({
        ...prev,
        [id]: { running: false, message: result.message },
      }));
      if (result.ok) {
        const refreshed = await api.getSettings();
        setDraft(refreshed.metadataProviders);
      }
    } catch (err) {
      setTestState((prev) => ({
        ...prev,
        [id]: {
          running: false,
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const saveProvider = (id: MetadataProviderId) => {
    void patchProviders({ [id]: draft[id] });
  };

  const configured = (id: MetadataProviderId): boolean => {
    switch (id) {
      case 'musicbrainz':
        return draft.musicbrainz.contactEmail.includes('@');
      case 'discogs':
        return draft.discogs.tokenSaved || draft.discogs.token.length > 0;
      case 'lastfm':
        return draft.lastfm.apiKeySaved || draft.lastfm.apiKey.length > 0;
      case 'gnudb':
        return draft.gnudb.contactEmail.includes('@');
      case 'spotify':
        return (
          draft.spotify.clientId.length > 0 &&
          (draft.spotify.clientSecretSaved || draft.spotify.clientSecret.length > 0)
        );
      case 'acoustid':
        return draft.acoustid.apiKeySaved || draft.acoustid.apiKey.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="settings-metadata-providers">
      {error ? <p className="settings-feedback error">{error}</p> : null}
      <ul className="metadata-provider-list">
        {orderedCards.map((card) => {
          const idx = orderIndex(draft.order, card.id);
          const test = testState[card.id];
          const isSearch = (
            METADATA_SEARCH_PROVIDER_IDS as readonly string[]
          ).includes(card.id);
          const cfgEnabled = draft[card.id].enabled;
          return (
            <li key={card.id} className="metadata-provider-card">
              <div className="metadata-provider-card-header">
                <h3>{card.title}</h3>
                <div className="metadata-provider-order">
                  <button
                    type="button"
                    aria-label={`Move ${card.title} up`}
                    disabled={idx <= 0}
                    onClick={() => moveProvider(card.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${card.title} down`}
                    disabled={idx < 0 || idx >= draft.order.length - 1}
                    onClick={() => moveProvider(card.id, 1)}
                  >
                    ↓
                  </button>
                </div>
                <span className="metadata-provider-status">
                  {configured(card.id)
                    ? cfgEnabled
                      ? isSearch
                        ? 'Ready for search'
                        : 'Configured'
                      : 'Not enabled'
                    : 'Not configured'}
                </span>
              </div>
              <p className="metadata-provider-hint">{card.hint}</p>
              <a
                className="metadata-provider-link"
                href={card.signupUrl}
                target="_blank"
                rel="noreferrer"
              >
                Provider signup / docs
              </a>
              {card.id === 'musicbrainz' ? (
                <label>
                  Contact email
                  <input
                    type="email"
                    value={draft.musicbrainz.contactEmail}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        musicbrainz: {
                          ...prev.musicbrainz,
                          contactEmail: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ) : null}
              {card.id === 'gnudb' ? (
                <label>
                  Contact email
                  <input
                    type="email"
                    value={draft.gnudb.contactEmail}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        gnudb: {
                          ...prev.gnudb,
                          contactEmail: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              ) : null}
              {card.id === 'discogs' ? (
                <label>
                  Personal access token
                  <input
                    type="password"
                    placeholder={
                      draft.discogs.tokenSaved ? 'Saved (leave blank to keep)' : ''
                    }
                    value={draft.discogs.token}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        discogs: { ...prev.discogs, token: event.target.value },
                      }))
                    }
                  />
                </label>
              ) : null}
              {card.id === 'lastfm' ? (
                <label>
                  API key
                  <input
                    type="password"
                    placeholder={
                      draft.lastfm.apiKeySaved ? 'Saved (leave blank to keep)' : ''
                    }
                    value={draft.lastfm.apiKey}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        lastfm: { ...prev.lastfm, apiKey: event.target.value },
                      }))
                    }
                  />
                </label>
              ) : null}
              {card.id === 'acoustid' ? (
                <label>
                  API key
                  <input
                    type="password"
                    placeholder={
                      draft.acoustid.apiKeySaved ? 'Saved (leave blank to keep)' : ''
                    }
                    value={draft.acoustid.apiKey}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        acoustid: { ...prev.acoustid, apiKey: event.target.value },
                      }))
                    }
                  />
                </label>
              ) : null}
              {card.id === 'spotify' ? (
                <>
                  <label>
                    Client ID
                    <input
                      type="text"
                      value={draft.spotify.clientId}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          spotify: { ...prev.spotify, clientId: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Client secret
                    <input
                      type="password"
                      placeholder={
                        draft.spotify.clientSecretSaved
                          ? 'Saved (leave blank to keep)'
                          : ''
                      }
                      value={draft.spotify.clientSecret}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          spotify: {
                            ...prev.spotify,
                            clientSecret: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}
              <div className="metadata-provider-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveProvider(card.id)}
                >
                  Save credentials
                </button>
                <button
                  type="button"
                  disabled={test?.running}
                  onClick={() => void runTest(card.id)}
                >
                  {test?.running ? <ProcessingText>Testing…</ProcessingText> : 'Test'}
                </button>
              </div>
              {test?.message ? (
                <p
                  className={
                    test.message.toLowerCase().startsWith('ok') ||
                    test.message.toLowerCase().includes('accepted')
                      ? 'settings-feedback'
                      : 'settings-feedback error'
                  }
                >
                  {test.message}
                </p>
              ) : null}
              {isSearch && configured(card.id) && !cfgEnabled ? (
                <p className="settings-feedback warn">
                  Credentials saved. Run Test to enable for metadata search.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
