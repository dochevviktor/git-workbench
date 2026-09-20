import { useMemo, useState } from 'react';
import type {
  RepositoryGitFlowAction,
  RepositoryGitFlowBranch,
  RepositoryGitFlowContext,
  RepositoryGitFlowType,
} from '../../../common/ipc/contracts';
import type { Platform } from '../lib/platform';
import { BranchIcon, TagIcon } from './Icons';
import { DialogShell } from './DialogShell';

export type GitFlowActionDraft = RepositoryGitFlowAction extends infer Action
  ? Action extends RepositoryGitFlowAction
    ? Omit<Action, 'snapshot'>
    : never
  : never;

export type GitFlowDialogRequest =
  | { readonly kind: 'initialize' }
  | { readonly kind: 'start'; readonly type: RepositoryGitFlowType }
  | { readonly kind: 'finish'; readonly branch: RepositoryGitFlowBranch };

interface GitFlowDialogProps {
  readonly request: GitFlowDialogRequest;
  readonly context: RepositoryGitFlowContext | undefined;
  readonly platform: Platform;
  readonly busy: boolean;
  readonly failure: string | undefined;
  readonly onSubmit: (action: GitFlowActionDraft) => void;
  readonly onClose: () => void;
}

const typeLabels: Record<RepositoryGitFlowType, string> = {
  feature: 'Feature',
  release: 'Release',
  hotfix: 'Hotfix',
};

export function GitFlowDialog(props: GitFlowDialogProps) {
  switch (props.request.kind) {
    case 'initialize':
      return <InitializeGitFlowDialog {...props} />;
    case 'start':
      return <StartGitFlowDialog {...props} type={props.request.type} />;
    case 'finish':
      return <FinishGitFlowDialog {...props} branch={props.request.branch} />;
  }
}

function InitializeGitFlowDialog({
  context,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: GitFlowDialogProps) {
  const branches = context?.localBranches ?? [];
  const [productionBranch, setProductionBranch] = useState(context?.head.name ?? branches[0]?.name ?? 'main');
  const [developBranch, setDevelopBranch] = useState('develop');
  const [featurePrefix, setFeaturePrefix] = useState('feature/');
  const [releasePrefix, setReleasePrefix] = useState('release/');
  const [hotfixPrefix, setHotfixPrefix] = useState('hotfix/');
  const duplicateBranches = productionBranch.trim() === developBranch.trim();
  const prefixes = [featurePrefix.trim(), releasePrefix.trim(), hotfixPrefix.trim()];
  const duplicatePrefixes = new Set(prefixes).size !== prefixes.length;
  const invalidPrefix = prefixes.some((prefix) => prefix.length === 0 || !prefix.endsWith('/'));
  const warning =
    failure ??
    (duplicateBranches
      ? 'Production and develop must be different branches.'
      : duplicatePrefixes
        ? 'Feature, release, and hotfix prefixes must be different.'
        : invalidPrefix
          ? 'Each prefix must be non-empty and end with /. '
          : null);

  return (
    <DialogShell
      title="Initialize Git-flow"
      subtitle="Configure the production, integration, and topic branches"
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={warning}
      submitLabel="Initialize"
      submitDisabled={
        productionBranch.trim().length === 0 ||
        developBranch.trim().length === 0 ||
        duplicateBranches ||
        duplicatePrefixes ||
        invalidPrefix
      }
      busy={busy}
      onSubmit={() =>
        onSubmit({
          kind: 'initialize',
          config: {
            productionBranch: productionBranch.trim(),
            developBranch: developBranch.trim(),
            featurePrefix: featurePrefix.trim(),
            releasePrefix: releasePrefix.trim(),
            hotfixPrefix: hotfixPrefix.trim(),
          },
        })
      }
      onClose={onClose}
    >
      <dt>
        <label htmlFor="git-flow-production">Production branch:</label>
      </dt>
      <dd>
        {branches.length > 0 ? (
          <select
            id="git-flow-production"
            className="reference-input"
            value={productionBranch}
            onChange={(event) => setProductionBranch(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="git-flow-production"
            className="reference-input"
            value={productionBranch}
            spellCheck={false}
            onChange={(event) => setProductionBranch(event.target.value)}
          />
        )}
      </dd>
      <NameInput
        label="Develop branch:"
        id="git-flow-develop"
        value={developBranch}
        onChange={setDevelopBranch}
      />
      <PrefixInput
        label="Feature prefix:"
        id="git-flow-feature-prefix"
        value={featurePrefix}
        onChange={setFeaturePrefix}
      />
      <PrefixInput
        label="Release prefix:"
        id="git-flow-release-prefix"
        value={releasePrefix}
        onChange={setReleasePrefix}
      />
      <PrefixInput
        label="Hotfix prefix:"
        id="git-flow-hotfix-prefix"
        value={hotfixPrefix}
        onChange={setHotfixPrefix}
      />
      <dt />
      <dd className="dialog-inline-note">
        If the develop branch does not exist, Git Workbench creates it from the selected production branch.
      </dd>
    </DialogShell>
  );
}

function StartGitFlowDialog({
  context,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
  type,
}: GitFlowDialogProps & { readonly type: RepositoryGitFlowType }) {
  const [name, setName] = useState('');
  const config = context?.config;
  const prefix = config
    ? type === 'feature'
      ? config.featurePrefix
      : type === 'release'
        ? config.releasePrefix
        : config.hotfixPrefix
    : '';
  const base = type === 'hotfix' ? config?.productionBranch : config?.developBranch;
  const invalid = name.trim().length === 0;

  return (
    <DialogShell
      title={`Start ${typeLabels[type]}`}
      subtitle={`Create ${prefix || `${type}/`}… from ${base ?? 'the configured base branch'}`}
      icon={<BranchIcon size={26} />}
      platform={platform}
      warning={failure ?? (invalid ? `Enter a ${type} name.` : null)}
      submitLabel="Start"
      submitDisabled={invalid || !config}
      busy={busy}
      onSubmit={() => onSubmit({ kind: 'start', type, name: name.trim() })}
      onClose={onClose}
    >
      <dt>
        <label htmlFor="git-flow-topic-name">Name:</label>
      </dt>
      <dd>
        <input
          id="git-flow-topic-name"
          className="reference-input"
          value={name}
          placeholder={type === 'feature' ? 'my-feature' : '1.0.0'}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <p className="dialog-inline-note">
          Branch: {prefix}
          {name.trim() || '…'}
        </p>
      </dd>
      <dt>Base:</dt>
      <dd>{base ?? 'Unavailable'}</dd>
    </DialogShell>
  );
}

function FinishGitFlowDialog({
  branch,
  context,
  platform,
  busy,
  failure,
  onSubmit,
  onClose,
}: GitFlowDialogProps & { readonly branch: RepositoryGitFlowBranch }) {
  const [noFastForward, setNoFastForward] = useState(true);
  const [mergeIntoDevelop, setMergeIntoDevelop] = useState(true);
  const [tagMessage, setTagMessage] = useState('');
  const [keepBranch, setKeepBranch] = useState(false);
  const isFeature = branch.type === 'feature';
  const target = isFeature ? context?.config?.developBranch : context?.config?.productionBranch;

  return (
    <DialogShell
      title={`Finish ${typeLabels[branch.type]}`}
      subtitle={`Merge ${branch.fullName.replace(/^refs\/heads\//u, '')} into ${target ?? 'its base branch'}`}
      icon={branch.type === 'feature' ? <BranchIcon size={26} /> : <TagIcon size={26} />}
      platform={platform}
      warning={failure ?? null}
      submitLabel="Finish"
      submitDisabled={!context?.config || !target}
      busy={busy}
      onSubmit={() =>
        onSubmit({
          kind: 'finish',
          type: branch.type,
          name: branch.name,
          noFastForward,
          mergeIntoDevelop: isFeature ? true : mergeIntoDevelop,
          tagMessage,
          keepBranch,
        })
      }
      onClose={onClose}
    >
      <dt>Topic:</dt>
      <dd>{branch.fullName.replace(/^refs\/heads\//u, '')}</dd>
      <dt>Production:</dt>
      <dd>{context?.config?.productionBranch ?? 'Unavailable'}</dd>
      <dt>Develop:</dt>
      <dd>{context?.config?.developBranch ?? 'Unavailable'}</dd>
      <dt />
      <dd className="reference-dialog-options">
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={noFastForward}
            onChange={(event) => setNoFastForward(event.target.checked)}
          />
          <span>Create a merge commit (no fast-forward)</span>
        </label>
        {!isFeature && (
          <label className="reference-checkbox">
            <input
              type="checkbox"
              checked={mergeIntoDevelop}
              onChange={(event) => setMergeIntoDevelop(event.target.checked)}
            />
            <span>Merge the completed {branch.type} into develop</span>
          </label>
        )}
        <label className="reference-checkbox">
          <input
            type="checkbox"
            checked={keepBranch}
            onChange={(event) => setKeepBranch(event.target.checked)}
          />
          <span>Keep the topic branch after finishing</span>
        </label>
      </dd>
      {!isFeature && (
        <>
          <dt>
            <label htmlFor="git-flow-tag-message">Tag message:</label>
          </dt>
          <dd>
            <textarea
              id="git-flow-tag-message"
              className="reference-input reference-message"
              value={tagMessage}
              placeholder={`${typeLabels[branch.type]} ${branch.name}`}
              onChange={(event) => setTagMessage(event.target.value)}
            />
          </dd>
        </>
      )}
    </DialogShell>
  );
}

function NameInput({
  label,
  id,
  value,
  onChange,
}: {
  readonly label: string;
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <>
      <dt>
        <label htmlFor={id}>{label}</label>
      </dt>
      <dd>
        <input
          id={id}
          className="reference-input"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </dd>
    </>
  );
}

function PrefixInput({
  label,
  id,
  value,
  onChange,
}: {
  readonly label: string;
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const warning = useMemo(() => (value && !value.endsWith('/') ? 'Must end with /' : null), [value]);
  return (
    <>
      <dt>
        <label htmlFor={id}>{label}</label>
      </dt>
      <dd>
        <input
          id={id}
          className="reference-input"
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {warning && <p className="dialog-inline-note">{warning}</p>}
      </dd>
    </>
  );
}
