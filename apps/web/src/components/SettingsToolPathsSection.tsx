import { useCallback, useEffect, useState } from 'react';
import { AppSettingsDto, ToolId, ToolPathsStatusDto } from '@karaokej/shared';
import { api } from '../api';
import { ProcessingText } from './ProcessingText';

type ToolPathKey = keyof Pick<
  AppSettingsDto,
  'ytdlpPath' | 'ffmpegPath' | 'ffprobePath' | 'ytdlpNodePath' | 'ytsaverPath' | 'demucsPath'
>;

const TOOL_CARDS: Array<{
  id: ToolId;
  settingKey: ToolPathKey;
  title: string;
  description: string;
}> = [
  {
    id: 'ffmpeg',
    settingKey: 'ffmpegPath',
    title: 'ffmpeg',
    description: 'Cover art thumbnails and audio processing.',
  },
  {
    id: 'ffprobe',
    settingKey: 'ffprobePath',
    title: 'ffprobe',
    description: 'Reads track metadata during library scans.',
  },
  {
    id: 'ytdlp',
    settingKey: 'ytdlpPath',
    title: 'yt-dlp',
    description: 'YouTube search and MP3 download.',
  },
  {
    id: 'node',
    settingKey: 'ytdlpNodePath',
    title: 'Node.js (yt-dlp)',
    description: 'Node binary yt-dlp uses for YouTube JS challenges.',
  },
  {
    id: 'demucs',
    settingKey: 'demucsPath',
    title: 'Demucs',
    description: 'AI vocal removal (source separation).',
  },
  {
    id: 'ytsaver',
    settingKey: 'ytsaverPath',
    title: 'YT Saver',
    description: 'Optional download helper GUI.',
  },
];

type CheckState = { message: string; version: string | null } | null;

export function SettingsToolPathsSection({
  savedPaths,
}: {
  savedPaths: Pick<
    AppSettingsDto,
    'ytdlpPath' | 'ffmpegPath' | 'ffprobePath' | 'ytdlpNodePath' | 'ytsaverPath' | 'demucsPath'
  >;
}) {
  const [drafts, setDrafts] = useState(savedPaths);
  const [status, setStatus] = useState<ToolPathsStatusDto | null>(null);
  const [checking, setChecking] = useState<ToolId | null>(null);
  const [checkByTool, setCheckByTool] = useState<Partial<Record<ToolId, CheckState>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(savedPaths);
  }, [savedPaths]);

  const loadStatus = useCallback(() => {
    void api.toolPathsStatus().then(setStatus).catch(() => {
      /* leave null */
    });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, savedPaths]);

  const effectiveFor = (id: ToolId): string | undefined =>
    status?.tools.find((tool) => tool.id === id)?.effectivePath;

  const runCheck = async (tool: (typeof TOOL_CARDS)[number]) => {
    setError(null);
    setChecking(tool.id);
    setCheckByTool((prev) => ({ ...prev, [tool.id]: null }));
    try {
      await api.patchSettings({ [tool.settingKey]: drafts[tool.settingKey] });
      const result = await api.checkTool(tool.id);
      setCheckByTool((prev) => ({
        ...prev,
        [tool.id]: { message: result.message, version: result.version },
      }));
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(null);
    }
  };

  return (
    <>
      {TOOL_CARDS.map((tool) => {
        const check = checkByTool[tool.id];
        const effective = effectiveFor(tool.id);
        const showEffective = !drafts[tool.settingKey].trim() && effective;
        return (
          <section key={tool.id} className="settings-panel">
            <h2>{tool.title}</h2>
            <p className="settings-copy">{tool.description}</p>
            <div className="settings-tool-path-row">
              <input
                type="text"
                value={drafts[tool.settingKey]}
                placeholder="Leave blank to use .env, then default"
                aria-label={`${tool.title} path`}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [tool.settingKey]: event.target.value }))
                }
              />
              <button
                type="button"
                disabled={checking === tool.id}
                onClick={() => void runCheck(tool)}
              >
                {checking === tool.id ? 'Checking…' : 'Check'}
              </button>
            </div>
            {showEffective ? (
              <p className="settings-tool-path-effective">
                Using: <code>{effective}</code>
              </p>
            ) : null}
            {checking === tool.id ? (
              <p className="settings-feedback">
                <ProcessingText>Checking…</ProcessingText>
              </p>
            ) : null}
            {check ? (
              <p
                className={`settings-feedback${check.version ? '' : ' error'}`}
                role="status"
              >
                {check.version ?? check.message}
              </p>
            ) : null}
          </section>
        );
      })}
      {error ? (
        <p className="settings-feedback error">{error}</p>
      ) : null}
    </>
  );
}
