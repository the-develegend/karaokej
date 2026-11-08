import { FormEvent, useEffect, useState } from 'react';
import { ManagedTagDto, TagFileFailureDto, tagNameError } from '@karaokej/shared';
import { api } from '../api';
import { Modal } from './Modal';
import { TagPickerModal } from './TagPickerModal';

export function SettingsTagsSection() {
  const [tags, setTags] = useState<ManagedTagDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<TagFileFailureDto[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [merge, setMerge] = useState<{ id: number; name: string; existingName: string; songCount: number } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ManagedTagDto | null>(null);

  const load = async () => {
    const list = await api.tags();
    setTags(list.tags);
  };

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  const showFailures = (next: TagFileFailureDto[]) => {
    setFailures(next);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (renameId == null) {
      return;
    }
    const validation = tagNameError(renameValue);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    try {
      const result = await api.renameTag(renameId, renameValue, false);
      if (result.conflict) {
        setMerge({
          id: renameId,
          name: renameValue,
          existingName: result.existingName ?? renameValue,
          songCount: result.songCount ?? 0,
        });
        return;
      }
      showFailures(result.result?.failures ?? []);
      setRenameId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmMerge = async () => {
    if (!merge) {
      return;
    }
    setError(null);
    try {
      const result = await api.renameTag(merge.id, merge.name, true);
      showFailures(result.result?.failures ?? []);
      setMerge(null);
      setRenameId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) {
      return;
    }
    setError(null);
    try {
      const result = await api.deleteTag(removeTarget.id);
      showFailures(result.failures);
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-panel">
      <p className="settings-copy">
        Renaming a tag renames it on every song that uses it.
      </p>
      <button type="button" onClick={() => setCreateOpen(true)}>
        Add tag
      </button>
      {tags.length === 0 ? (
        <p className="settings-copy">No tags yet.</p>
      ) : (
        <ul className="settings-list">
          {tags.map((tag) => (
            <li key={tag.id}>
              {renameId === tag.id ? (
                <form className="tag-rename-form" onSubmit={(event) => void submitRename(event)}>
                  <input
                    type="text"
                    value={renameValue}
                    maxLength={15}
                    aria-label={`Rename ${tag.name}`}
                    onChange={(event) => setRenameValue(event.target.value)}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenameId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span>
                    <strong>{tag.name}</strong>
                    <span className="settings-copy">
                      {' '}
                      · {tag.songCount} {tag.songCount === 1 ? 'song' : 'songs'}
                    </span>
                  </span>
                  <span className="settings-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameId(tag.id);
                        setRenameValue(tag.name);
                        setError(null);
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" onClick={() => setRemoveTarget(tag)}>
                      Remove
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="settings-feedback error">{error}</p> : null}
      {failures.length > 0 ? (
        <div className="settings-feedback error">
          <p>Some files could not be updated. The songs that succeeded kept the change.</p>
          <ul>
            {failures.map((failure) => (
              <li key={`${failure.trackId}-${failure.path}`}>
                {failure.path}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {createOpen ? (
        <TagPickerModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            void load();
          }}
        />
      ) : null}
      <Modal
        open={merge != null}
        title="Merge tags"
        confirmLabel="Merge"
        onConfirm={() => void confirmMerge()}
        onCancel={() => setMerge(null)}
      >
        <p>
          “{merge?.existingName}” already exists. Merge {merge?.songCount ?? 0}{' '}
          {(merge?.songCount ?? 0) === 1 ? 'song' : 'songs'} onto it?
        </p>
      </Modal>
      <Modal
        open={removeTarget != null}
        title="Remove tag"
        confirmLabel="Remove"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      >
        <p>
          Remove “{removeTarget?.name}” from {removeTarget?.songCount ?? 0}{' '}
          {(removeTarget?.songCount ?? 0) === 1 ? 'song' : 'songs'}?
        </p>
      </Modal>
    </section>
  );
}
