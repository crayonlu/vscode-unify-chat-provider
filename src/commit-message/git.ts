import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '../i18n';
import {
  GitExtensionUnavailableError,
  NoGitRepositoriesFoundError,
} from './types';

interface GitBranchUpstream {
  readonly remote: string;
  readonly name: string;
}

interface GitBranch {
  readonly name?: string;
  readonly upstream?: GitBranchUpstream;
}

interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly authorDate?: Date;
}

interface GitChange {
  readonly uri: vscode.Uri;
  readonly status?: number;
}

interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  readonly workingTreeChanges?: readonly GitChange[];
  readonly untrackedChanges: readonly GitChange[];
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  readonly state: GitRepositoryState;
  diff(cached?: boolean): Promise<string>;
  log(options?: { maxEntries?: number; path?: string }): Promise<GitCommit[]>;
  status(): Promise<void>;
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtensionExports {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface RepositoryQuickPickItem extends vscode.QuickPickItem {
  repository: GitRepository;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUri(value: unknown): value is vscode.Uri {
  return isRecord(value) && value instanceof vscode.Uri;
}

function isSourceControl(value: unknown): value is vscode.SourceControl {
  if (!isRecord(value)) {
    return false;
  }

  const rootUri = value.rootUri;
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    (rootUri === undefined || isUri(rootUri)) &&
    typeof value.dispose === 'function'
  );
}

function isGitRepository(value: unknown): value is GitRepository {
  if (!isRecord(value)) {
    return false;
  }

  const rootUri = value.rootUri;
  const inputBox = value.inputBox;
  const state = value.state;

  return (
    isUri(rootUri) &&
    isRecord(inputBox) &&
    typeof inputBox.value === 'string' &&
    isRecord(state) &&
    typeof value.diff === 'function' &&
    typeof value.log === 'function' &&
    typeof value.status === 'function'
  );
}

function normalizeFsPath(fsPath: string): string {
  const normalized = path
    .normalize(fsPath)
    .replace(/[\\/]+/g, path.sep)
    .toLowerCase();

  let result = normalized;
  while (result.length > 3 && result.endsWith(path.sep)) {
    result = result.slice(0, -1);
  }

  return result;
}

function isSameOrChildPath(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) {
    return true;
  }

  if (!targetPath.startsWith(rootPath)) {
    return false;
  }

  return targetPath.charAt(rootPath.length) === path.sep;
}

async function setGitAvailabilityContext(enabled: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    'unifyChatProvider.gitAvailable',
    enabled,
  );
}

export function registerGitAvailabilityContext(): vscode.Disposable {
  const subscriptions: vscode.Disposable[] = [];

  const refresh = async (): Promise<void> => {
    const extension =
      vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) {
      await setGitAvailabilityContext(false);
      return;
    }

    try {
      const gitExports = extension.isActive
        ? extension.exports
        : await extension.activate();
      await setGitAvailabilityContext(gitExports.enabled);
    } catch {
      await setGitAvailabilityContext(false);
    }
  };

  void refresh();
  subscriptions.push(
    vscode.extensions.onDidChange(() => {
      void refresh();
    }),
  );

  return new vscode.Disposable(() => {
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  });
}

export async function getGitApi(): Promise<GitApi> {
  const extension =
    vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    throw new GitExtensionUnavailableError();
  }

  const gitExports = extension.isActive
    ? extension.exports
    : await extension.activate();

  if (!gitExports.enabled) {
    throw new GitExtensionUnavailableError();
  }

  return gitExports.getAPI(1);
}

export async function getRepositories(): Promise<readonly GitRepository[]> {
  const gitApi = await getGitApi();
  if (gitApi.repositories.length === 0) {
    throw new NoGitRepositoriesFoundError();
  }
  return gitApi.repositories;
}

export async function selectRepository(
  repositories: readonly GitRepository[],
): Promise<GitRepository | undefined> {
  const items: RepositoryQuickPickItem[] = repositories.map((repository) => {
    const branchName = repository.state.HEAD?.name;
    return {
      label: repository.rootUri.fsPath,
      description: branchName ? t('Branch: {0}', branchName) : undefined,
      repository,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: t('Select a Git repository'),
    matchOnDescription: true,
  });

  return selected?.repository;
}

function inferRepositoryFromResourceGroup(
  repositories: readonly GitRepository[],
  resourceGroup: vscode.SourceControlResourceGroup | undefined,
): GitRepository | undefined {
  const firstResource = resourceGroup?.resourceStates[0];
  const resourcePath = firstResource?.resourceUri?.fsPath;
  if (!resourcePath) {
    return undefined;
  }

  const normalizedTargetPath = normalizeFsPath(resourcePath);

  return repositories
    .map((repository) => ({
      repository,
      rootPath: normalizeFsPath(repository.rootUri.fsPath),
    }))
    .filter((candidate) =>
      isSameOrChildPath(normalizedTargetPath, candidate.rootPath),
    )
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0]
    ?.repository;
}

function inferRepositoryFromSourceControl(
  gitApi: GitApi,
  sourceControl: unknown,
): GitRepository | undefined {
  if (!isSourceControl(sourceControl) || !sourceControl.rootUri) {
    return undefined;
  }

  return gitApi.getRepository(sourceControl.rootUri) ?? undefined;
}

export async function resolveRepositoryFromContext(
  explicitRepository: unknown,
  resourceGroup: vscode.SourceControlResourceGroup | undefined,
): Promise<GitRepository> {
  if (isGitRepository(explicitRepository)) {
    return explicitRepository;
  }

  const gitApi = await getGitApi();
  const sourceControlRepository = inferRepositoryFromSourceControl(
    gitApi,
    explicitRepository,
  );
  if (sourceControlRepository) {
    return sourceControlRepository;
  }

  const repositories = gitApi.repositories;
  if (repositories.length === 0) {
    throw new NoGitRepositoriesFoundError();
  }
  if (repositories.length === 1) {
    return repositories[0];
  }

  const inferredRepository = inferRepositoryFromResourceGroup(
    repositories,
    resourceGroup,
  );
  if (inferredRepository) {
    return inferredRepository;
  }

  const selectedRepository = await selectRepository(repositories);
  if (selectedRepository) {
    return selectedRepository;
  }

  throw new vscode.CancellationError();
}
