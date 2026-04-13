import * as vscode from 'vscode';
import { t } from '../i18n';
import {
  readCommitMessageGenerationConfiguration,
  registerCommitMessageGenerationButtonsContext,
} from './config';
import { collectCommitMessageRepositoryContext } from './collector';
import {
  registerGitAvailabilityContext,
  resolveRepositoryFromContext,
} from './git';
import { changeCommitMessageModelConfiguration, resolveCommitMessageGenerationModel } from './model';
import {
  buildPromptMessages,
  normalizeGeneratedCommitMessage,
} from './prompt';
import type {
  CommitMessageCompressionResult,
  CommitMessageGenerationScope,
  CommitMessagePromptState,
} from './types';
import {
  GitExtensionUnavailableError,
  NoChangesDetectedError,
  NoGitRepositoriesFoundError,
  NoLanguageModelsAvailableError,
  PromptTooLargeError,
} from './types';

const MIN_FILE_HISTORY_ENTRIES = 5;
const MIN_REPOSITORY_HISTORY_ENTRIES = 5;
const SUMMARY_TRUNCATION_NOTICE = '\n... [summary truncated for context limit]';

let isGeneratingCommitMessage = false;

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}

function clonePromptState(state: CommitMessagePromptState): CommitMessagePromptState {
  return {
    configuration: {
      ...state.configuration,
      model: { ...state.configuration.model },
      excludeFiles: [...state.configuration.excludeFiles],
    },
    context: {
      ...state.context,
      filePromptItems: state.context.filePromptItems.map((item) => ({
        ...item,
      })),
      fileHistoryEntries: state.context.fileHistoryEntries.map((entry) => ({
        ...entry,
      })),
      repositoryHistoryEntries: state.context.repositoryHistoryEntries.map(
        (entry) => ({ ...entry }),
      ),
    },
  };
}

async function countPromptTokens(
  model: vscode.LanguageModelChat,
  messages: readonly vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken,
): Promise<number> {
  const tokenCounts = await Promise.all(
    messages.map((message) => model.countTokens(message, token)),
  );
  return tokenCounts.reduce((sum, count) => sum + count, 0);
}

function stripSummaryTruncationNotice(summary: string): string {
  return summary.endsWith(SUMMARY_TRUNCATION_NOTICE)
    ? summary.slice(0, -SUMMARY_TRUNCATION_NOTICE.length)
    : summary;
}

function truncateSummary(summary: string): string | undefined {
  const baseSummary = stripSummaryTruncationNotice(summary);
  if (baseSummary.length <= SUMMARY_TRUNCATION_NOTICE.length + 1) {
    return undefined;
  }

  const targetBaseLength = Math.max(
    1,
    Math.floor(baseSummary.length * 0.8) - SUMMARY_TRUNCATION_NOTICE.length,
  );
  if (targetBaseLength >= baseSummary.length) {
    return undefined;
  }

  return (
    baseSummary.slice(0, targetBaseLength) + SUMMARY_TRUNCATION_NOTICE
  );
}

function truncateLongestFileSummaries(state: CommitMessagePromptState): boolean {
  const longestItems = [...state.context.filePromptItems]
    .sort((left, right) => right.summary.length - left.summary.length)
    .slice(0, 10);

  let changed = false;
  for (const item of longestItems) {
    const truncatedSummary = truncateSummary(item.summary);
    if (!truncatedSummary || truncatedSummary === item.summary) {
      continue;
    }

    item.summary = truncatedSummary;
    changed = true;
  }

  return changed;
}

async function buildCompressedPromptMessages(
  model: vscode.LanguageModelChat,
  promptState: CommitMessagePromptState,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<CommitMessageCompressionResult> {
  const workingState = clonePromptState(promptState);

  for (;;) {
    throwIfCancelled(token);

    const messages = buildPromptMessages(workingState);
    const totalTokens = await countPromptTokens(model, messages, token);
    if (totalTokens <= model.maxInputTokens) {
      return { messages, totalTokens };
    }

    progress.report({
      message: t('Compressing prompt to fit model context...'),
    });

    if (
      workingState.context.repositoryHistoryEntries.length >
      MIN_REPOSITORY_HISTORY_ENTRIES
    ) {
      workingState.context.repositoryHistoryEntries.pop();
      continue;
    }

    if (workingState.context.fileHistoryEntries.length > MIN_FILE_HISTORY_ENTRIES) {
      workingState.context.fileHistoryEntries.pop();
      continue;
    }

    if (truncateLongestFileSummaries(workingState)) {
      continue;
    }

    throw new PromptTooLargeError();
  }
}

async function generateCommitMessage(
  explicitRepository: unknown,
  scope: CommitMessageGenerationScope,
  resourceGroup: vscode.SourceControlResourceGroup | undefined,
): Promise<void> {
  if (isGeneratingCommitMessage) {
    vscode.window.showInformationMessage(
      t('Commit message generation is already in progress.'),
    );
    return;
  }

  isGeneratingCommitMessage = true;

  try {
    let repositoryLabel = '';

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl },
      async () => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('Commit message generation'),
            cancellable: true,
          },
          async (progress, token) => {
            progress.report({
              message: t('Initializing commit message generation...'),
            });

            const configuration = readCommitMessageGenerationConfiguration();

            progress.report({
              message: t('Resolving Git repository...'),
            });
            const repository = await resolveRepositoryFromContext(
              explicitRepository,
              resourceGroup,
            );
            repositoryLabel = repository.rootUri.fsPath;
            throwIfCancelled(token);

            progress.report({
              message: t('Collecting repository changes...'),
            });
            const repositoryContext = await collectCommitMessageRepositoryContext(
              repository,
              scope,
              configuration,
              token,
            );
            throwIfCancelled(token);

            progress.report({
              message: t('Loading language model...'),
            });
            const model = await resolveCommitMessageGenerationModel();
            throwIfCancelled(token);

            const promptState: CommitMessagePromptState = {
              configuration,
              context: repositoryContext,
            };

            const promptMessages = await buildCompressedPromptMessages(
              model,
              promptState,
              progress,
              token,
            );
            throwIfCancelled(token);

            progress.report({
              message: t('Requesting commit message generation...'),
            });
            const response = await model.sendRequest(promptMessages.messages, undefined, token);

            let generatedText = '';
            for await (const chunk of response.text) {
              throwIfCancelled(token);
              generatedText += chunk;
              progress.report({
                message: t(
                  'Generating commit message... ({0} chars)',
                  generatedText.length,
                ),
              });
            }

            const normalizedCommitMessage =
              normalizeGeneratedCommitMessage(generatedText);
            if (!normalizedCommitMessage) {
              throw new Error(t('The selected model returned an empty commit message.'));
            }

            progress.report({
              message: t('Applying commit message to SCM input...'),
            });
            repository.inputBox.value = normalizedCommitMessage;
          },
        );
      },
    );

    if (repositoryLabel) {
      vscode.window.showInformationMessage(
        t(
          'Commit message generated and inserted into the SCM input box for {0}.',
          repositoryLabel,
        ),
      );
    }
  } catch (error) {
    await handleCommitMessageGenerationError(error);
  } finally {
    isGeneratingCommitMessage = false;
  }
}

async function handleCommitMessageGenerationError(
  error: unknown,
): Promise<void> {
  if (error instanceof vscode.CancellationError) {
    return;
  }

  if (error instanceof NoChangesDetectedError) {
    vscode.window.showWarningMessage(
      t('No changes were detected for commit message generation.'),
    );
    return;
  }

  if (error instanceof NoGitRepositoriesFoundError) {
    vscode.window.showWarningMessage(t('No Git repositories were found.'));
    return;
  }

  if (error instanceof GitExtensionUnavailableError) {
    vscode.window.showErrorMessage(t('Git extension is unavailable.'));
    return;
  }

  if (error instanceof NoLanguageModelsAvailableError) {
    vscode.window.showWarningMessage(
      t('No available language models were found.'),
    );
    return;
  }

  if (error instanceof PromptTooLargeError) {
    vscode.window.showErrorMessage(
      t('Unable to fit the commit prompt into the selected model context window.'),
    );
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(
    t('Failed to generate a commit message: {0}', message),
  );
}

export function registerCommitMessageGeneration(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    registerCommitMessageGenerationButtonsContext(),
    registerGitAvailabilityContext(),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'unifyChatProvider.commitMessageGeneration.generate',
      async (repository?: unknown) => {
        await generateCommitMessage(repository, 'all', undefined);
      },
    ),
    vscode.commands.registerCommand(
      'unifyChatProvider.commitMessageGeneration.generateStaged',
      async (resourceGroup?: vscode.SourceControlResourceGroup) => {
        await generateCommitMessage(undefined, 'staged', resourceGroup);
      },
    ),
    vscode.commands.registerCommand(
      'unifyChatProvider.commitMessageGeneration.generateWorkingTree',
      async (resourceGroup?: vscode.SourceControlResourceGroup) => {
        await generateCommitMessage(undefined, 'workingTree', resourceGroup);
      },
    ),
    vscode.commands.registerCommand(
      'unifyChatProvider.commitMessageGeneration.changeModel',
      async () => {
        try {
          await changeCommitMessageModelConfiguration();
        } catch (error) {
          await handleCommitMessageGenerationError(error);
        }
      },
    ),
  );
}
