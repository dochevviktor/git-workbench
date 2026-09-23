import { useState } from 'react';
import type {
  RepositoryGroup,
  RepositoryManagerAction,
  RepositoryManagerLocation,
} from '../../../common/ipc/contracts';
import { unwrapResult } from '../../../common/ipc/result';
import { DialogShell } from './DialogShell';
import { FolderIcon } from './Icons';

export type ManagerEditor =
  | { kind: 'add-group'; parentId: string | null }
  | { kind: 'rename-group' | 'move-group'; group: RepositoryGroup }
  | { kind: 'edit-repository'; location: RepositoryManagerLocation; name: string; groupId: string | null };

export function RepositoryManagerEditor({
  editor,
  groups,
  onClose,
  onSaved,
}: {
  readonly editor: ManagerEditor;
  readonly groups: readonly RepositoryGroup[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [name, setName] = useState(
    editor.kind === 'edit-repository' ? editor.name : 'group' in editor ? editor.group.name : '',
  );
  const [parentId, setParentId] = useState(
    editor.kind === 'add-group'
      ? editor.parentId
      : editor.kind === 'edit-repository'
        ? editor.groupId
        : editor.group.parentId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!window.desktop) return;
    let action: RepositoryManagerAction;
    switch (editor.kind) {
      case 'add-group':
        action = { kind: 'add-group', name: name.trim(), parentId };
        break;
      case 'rename-group':
        action = { kind: 'rename-group', id: editor.group.id, name: name.trim() };
        break;
      case 'move-group':
        action = { kind: 'move-group', id: editor.group.id, parentId };
        break;
      case 'edit-repository':
        action = { kind: 'edit-repository', location: editor.location, name: name.trim(), groupId: parentId };
        break;
    }
    setBusy(true);
    try {
      unwrapResult(await window.desktop.repository.editManager(action));
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The manager could not be updated.');
    } finally {
      setBusy(false);
    }
  };
  const title =
    editor.kind === 'add-group'
      ? 'New Folder'
      : editor.kind === 'rename-group'
        ? 'Rename Folder'
        : editor.kind === 'move-group'
          ? 'Move Folder'
          : 'Organize Repository';
  const allowedGroups = groups.filter((group) => {
    if (editor.kind !== 'move-group') return true;
    let current: RepositoryGroup | undefined = group;
    while (current) {
      if (current.id === editor.group.id) return false;
      current = groups.find((candidate) => candidate.id === current?.parentId);
    }
    return true;
  });
  return (
    <DialogShell
      title={title}
      subtitle="Organize repositories in the manager. Folders on disk stay in place."
      icon={<FolderIcon size={26} />}
      platform="linux"
      warning={error ?? null}
      submitLabel="Save"
      submitDisabled={editor.kind !== 'edit-repository' && !name.trim()}
      busy={busy}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {editor.kind !== 'move-group' && (
        <>
          <dt>
            <label htmlFor="manager-edit-name">
              {editor.kind === 'edit-repository' ? 'Display name:' : 'Name:'}
            </label>
          </dt>
          <dd>
            <input
              id="manager-edit-name"
              className="reference-input"
              autoFocus
              maxLength={editor.kind === 'edit-repository' ? 512 : 100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </dd>
        </>
      )}
      {editor.kind !== 'rename-group' && (
        <>
          <dt>
            <label htmlFor="manager-edit-folder">Folder:</label>
          </dt>
          <dd>
            <select
              id="manager-edit-folder"
              className="reference-input"
              value={parentId ?? ''}
              onChange={(event) => setParentId(event.target.value || null)}
            >
              <option value="">Repositories</option>
              {allowedGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </dd>
        </>
      )}
    </DialogShell>
  );
}
