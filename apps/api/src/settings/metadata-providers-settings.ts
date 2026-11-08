import {
  DEFAULT_METADATA_PROVIDER_ORDER,
  MetadataProviderId,
  MetadataProvidersSettingsDto,
  METADATA_SETTINGS_PROVIDER_IDS,
} from '@karaokej/shared';
type SettingsDb = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => unknown;
  };
};

export interface StoredMetadataProviders {
  order: MetadataProviderId[];
  musicbrainz: { enabled: boolean; contactEmail: string };
  discogs: { enabled: boolean; token: string };
  lastfm: { enabled: boolean; apiKey: string };
  gnudb: { enabled: boolean; contactEmail: string };
  spotify: { enabled: boolean; clientId: string; clientSecret: string };
  acoustid: { enabled: boolean; apiKey: string };
}

const PROVIDER_LABELS: Record<MetadataProviderId, string> = {
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
  lastfm: 'Last.fm',
  gnudb: 'GnuDB',
  spotify: 'Spotify',
  acoustid: 'AcoustID',
};

export function metadataProviderLabel(id: MetadataProviderId): string {
  return PROVIDER_LABELS[id];
}

function emptyStored(): StoredMetadataProviders {
  return {
    order: [...DEFAULT_METADATA_PROVIDER_ORDER],
    musicbrainz: { enabled: false, contactEmail: '' },
    discogs: { enabled: false, token: '' },
    lastfm: { enabled: false, apiKey: '' },
    gnudb: { enabled: false, contactEmail: '' },
    spotify: { enabled: false, clientId: '', clientSecret: '' },
    acoustid: { enabled: false, apiKey: '' },
  };
}

function isProviderId(value: unknown): value is MetadataProviderId {
  return (
    typeof value === 'string' &&
    (METADATA_SETTINGS_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

function normalizeOrder(order: unknown): MetadataProviderId[] {
  if (!Array.isArray(order)) {
    return [...DEFAULT_METADATA_PROVIDER_ORDER];
  }
  const seen = new Set<MetadataProviderId>();
  const next: MetadataProviderId[] = [];
  for (const item of order) {
    if (!isProviderId(item) || seen.has(item)) {
      continue;
    }
    seen.add(item);
    next.push(item);
  }
  for (const id of DEFAULT_METADATA_PROVIDER_ORDER) {
    if (!seen.has(id)) {
      next.push(id);
    }
  }
  return next;
}

function parseStored(raw: string | undefined): StoredMetadataProviders {
  const base = emptyStored();
  if (!raw?.trim()) {
    return base;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredMetadataProviders>;
    return {
      order: normalizeOrder(parsed.order),
      musicbrainz: {
        enabled: parsed.musicbrainz?.enabled === true,
        contactEmail:
          typeof parsed.musicbrainz?.contactEmail === 'string'
            ? parsed.musicbrainz.contactEmail.trim()
            : '',
      },
      discogs: {
        enabled: parsed.discogs?.enabled === true,
        token:
          typeof parsed.discogs?.token === 'string'
            ? parsed.discogs.token.trim()
            : '',
      },
      lastfm: {
        enabled: parsed.lastfm?.enabled === true,
        apiKey:
          typeof parsed.lastfm?.apiKey === 'string'
            ? parsed.lastfm.apiKey.trim()
            : '',
      },
      gnudb: {
        enabled: parsed.gnudb?.enabled === true,
        contactEmail:
          typeof parsed.gnudb?.contactEmail === 'string'
            ? parsed.gnudb.contactEmail.trim()
            : '',
      },
      spotify: {
        enabled: parsed.spotify?.enabled === true,
        clientId:
          typeof parsed.spotify?.clientId === 'string'
            ? parsed.spotify.clientId.trim()
            : '',
        clientSecret:
          typeof parsed.spotify?.clientSecret === 'string'
            ? parsed.spotify.clientSecret.trim()
            : '',
      },
      acoustid: {
        enabled: parsed.acoustid?.enabled === true,
        apiKey:
          typeof parsed.acoustid?.apiKey === 'string'
            ? parsed.acoustid.apiKey.trim()
            : '',
      },
    };
  } catch {
    return base;
  }
}

export function readStoredMetadataProviders(
  db: SettingsDb,
  key: string,
): StoredMetadataProviders {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return parseStored(row?.value);
}

export function writeStoredMetadataProviders(
  db: SettingsDb,
  key: string,
  stored: StoredMetadataProviders,
): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(stored));
}

export function storedToPublicDto(
  stored: StoredMetadataProviders,
): MetadataProvidersSettingsDto {
  return {
    order: stored.order,
    musicbrainz: {
      enabled: stored.musicbrainz.enabled,
      contactEmail: stored.musicbrainz.contactEmail,
    },
    discogs: {
      enabled: stored.discogs.enabled,
      token: '',
      tokenSaved: stored.discogs.token.length > 0,
    },
    lastfm: {
      enabled: stored.lastfm.enabled,
      apiKey: '',
      apiKeySaved: stored.lastfm.apiKey.length > 0,
    },
    gnudb: {
      enabled: stored.gnudb.enabled,
      contactEmail: stored.gnudb.contactEmail,
    },
    spotify: {
      enabled: stored.spotify.enabled,
      clientId: stored.spotify.clientId,
      clientSecret: '',
      clientSecretSaved: stored.spotify.clientSecret.length > 0,
    },
    acoustid: {
      enabled: stored.acoustid.enabled,
      apiKey: '',
      apiKeySaved: stored.acoustid.apiKey.length > 0,
    },
  };
}

export function isProviderConfigured(
  id: MetadataProviderId,
  stored: StoredMetadataProviders,
): boolean {
  switch (id) {
    case 'musicbrainz':
      return stored.musicbrainz.contactEmail.includes('@');
    case 'discogs':
      return stored.discogs.token.length > 0;
    case 'lastfm':
      return stored.lastfm.apiKey.length > 0;
    case 'gnudb':
      return stored.gnudb.contactEmail.includes('@');
    case 'spotify':
      return (
        stored.spotify.clientId.length > 0 &&
        stored.spotify.clientSecret.length > 0
      );
    case 'acoustid':
      return stored.acoustid.apiKey.length > 0;
    default:
      return false;
  }
}

export function mergeMetadataProvidersPatch(
  stored: StoredMetadataProviders,
  patch: Partial<MetadataProvidersSettingsDto>,
): StoredMetadataProviders {
  const next: StoredMetadataProviders = {
    ...stored,
    order: patch.order ? normalizeOrder(patch.order) : stored.order,
    musicbrainz: { ...stored.musicbrainz },
    discogs: { ...stored.discogs },
    lastfm: { ...stored.lastfm },
    gnudb: { ...stored.gnudb },
    spotify: { ...stored.spotify },
    acoustid: { ...stored.acoustid },
  };
  if (patch.musicbrainz) {
    if (patch.musicbrainz.enabled !== undefined) {
      next.musicbrainz.enabled = patch.musicbrainz.enabled;
    }
    if (typeof patch.musicbrainz.contactEmail === 'string') {
      next.musicbrainz.contactEmail = patch.musicbrainz.contactEmail.trim();
    }
  }
  if (patch.discogs) {
    if (patch.discogs.enabled !== undefined) {
      next.discogs.enabled = patch.discogs.enabled;
    }
    if (typeof patch.discogs.token === 'string' && patch.discogs.token.trim()) {
      next.discogs.token = patch.discogs.token.trim();
    }
  }
  if (patch.lastfm) {
    if (patch.lastfm.enabled !== undefined) {
      next.lastfm.enabled = patch.lastfm.enabled;
    }
    if (typeof patch.lastfm.apiKey === 'string' && patch.lastfm.apiKey.trim()) {
      next.lastfm.apiKey = patch.lastfm.apiKey.trim();
    }
  }
  if (patch.gnudb) {
    if (patch.gnudb.enabled !== undefined) {
      next.gnudb.enabled = patch.gnudb.enabled;
    }
    if (typeof patch.gnudb.contactEmail === 'string') {
      next.gnudb.contactEmail = patch.gnudb.contactEmail.trim();
    }
  }
  if (patch.spotify) {
    if (patch.spotify.enabled !== undefined) {
      next.spotify.enabled = patch.spotify.enabled;
    }
    if (typeof patch.spotify.clientId === 'string') {
      next.spotify.clientId = patch.spotify.clientId.trim();
    }
    if (
      typeof patch.spotify.clientSecret === 'string' &&
      patch.spotify.clientSecret.trim()
    ) {
      next.spotify.clientSecret = patch.spotify.clientSecret.trim();
    }
  }
  if (patch.acoustid) {
    if (patch.acoustid.enabled !== undefined) {
      next.acoustid.enabled = patch.acoustid.enabled;
    }
    if (typeof patch.acoustid.apiKey === 'string' && patch.acoustid.apiKey.trim()) {
      next.acoustid.apiKey = patch.acoustid.apiKey.trim();
    }
  }
  return next;
}

export function setProviderEnabled(
  stored: StoredMetadataProviders,
  id: MetadataProviderId,
  enabled: boolean,
): StoredMetadataProviders {
  const next = { ...stored };
  switch (id) {
    case 'musicbrainz':
      next.musicbrainz = { ...stored.musicbrainz, enabled };
      break;
    case 'discogs':
      next.discogs = { ...stored.discogs, enabled };
      break;
    case 'lastfm':
      next.lastfm = { ...stored.lastfm, enabled };
      break;
    case 'gnudb':
      next.gnudb = { ...stored.gnudb, enabled };
      break;
    case 'spotify':
      next.spotify = { ...stored.spotify, enabled };
      break;
    case 'acoustid':
      next.acoustid = { ...stored.acoustid, enabled };
      break;
    default:
      break;
  }
  return next;
}
