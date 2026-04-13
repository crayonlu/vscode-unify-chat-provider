import * as vscode from 'vscode';
import type {
  CommitMessageGenerationConfiguration,
  CommitMessageGenerationFormat,
  CommitMessageGenerationModelConfiguration,
} from './types';

const CONFIGURATION_SECTION = 'unifyChatProvider.commitMessageGeneration';
const MODEL_CONFIGURATION_KEY = 'unifyChatProvider.commitMessageGeneration.model';
const ENABLE_BUTTONS_CONFIGURATION_KEY =
  'unifyChatProvider.commitMessageGeneration.enableButtons';
const BUTTONS_ENABLED_CONTEXT_KEY =
  'unifyChatProvider.commitMessageGenerationButtonsEnabled';

const DEFAULT_MODEL_CONFIGURATION: CommitMessageGenerationModelConfiguration = {
  vendor: '',
  id: '',
};

const DEFAULT_FORMAT: CommitMessageGenerationFormat = 'auto';
const DEFAULT_ENABLE_BUTTONS = true;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readModelConfiguration(
  value: unknown,
): CommitMessageGenerationModelConfiguration {
  if (!isRecord(value)) {
    return { ...DEFAULT_MODEL_CONFIGURATION };
  }

  const vendor = typeof value.vendor === 'string' ? value.vendor : '';
  const id = typeof value.id === 'string' ? value.id : '';

  return { vendor, id };
}

function readFormat(value: unknown): CommitMessageGenerationFormat {
  switch (value) {
    case 'auto':
    case 'conventional':
    case 'angular':
    case 'google':
    case 'atom':
    case 'plain':
    case 'custom':
      return value;
    default:
      return DEFAULT_FORMAT;
  }
}

function readEnableButtons(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_ENABLE_BUTTONS;
}

function readExcludeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

export function readCommitMessageGenerationConfiguration(): CommitMessageGenerationConfiguration {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  const customInstructionsValue = config.get<unknown>('customInstructions');

  return {
    model: readModelConfiguration(config.get<unknown>('model')),
    format: readFormat(config.get<unknown>('format')),
    customInstructions:
      typeof customInstructionsValue === 'string' ? customInstructionsValue : '',
    excludeFiles: readExcludeFiles(config.get<unknown>('excludeFiles')),
  };
}

export interface CommitMessageModelConfigurationInspection {
  globalValue?: CommitMessageGenerationModelConfiguration;
  workspaceValue?: CommitMessageGenerationModelConfiguration;
}

export function inspectCommitMessageModelConfiguration(): CommitMessageModelConfigurationInspection {
  const rootConfig = vscode.workspace.getConfiguration();
  const inspection = rootConfig.inspect<unknown>(MODEL_CONFIGURATION_KEY);

  if (!inspection) {
    return {};
  }

  return {
    globalValue:
      inspection.globalValue === undefined
        ? undefined
        : readModelConfiguration(inspection.globalValue),
    workspaceValue:
      inspection.workspaceValue === undefined
        ? undefined
        : readModelConfiguration(inspection.workspaceValue),
  };
}

export async function updateCommitMessageModelConfiguration(
  value: CommitMessageGenerationModelConfiguration,
  target: vscode.ConfigurationTarget,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  await config.update('model', value, target);
}

export function areCommitMessageGenerationButtonsEnabled(): boolean {
  const rootConfig = vscode.workspace.getConfiguration();
  return readEnableButtons(
    rootConfig.get<unknown>(ENABLE_BUTTONS_CONFIGURATION_KEY),
  );
}

async function setCommitMessageGenerationButtonsContext(
  enabled: boolean,
): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    BUTTONS_ENABLED_CONTEXT_KEY,
    enabled,
  );
}

export function registerCommitMessageGenerationButtonsContext(): vscode.Disposable {
  const refresh = (): void => {
    void setCommitMessageGenerationButtonsContext(
      areCommitMessageGenerationButtonsEnabled(),
    );
  };

  refresh();

  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(ENABLE_BUTTONS_CONFIGURATION_KEY)) {
      return;
    }

    refresh();
  });
}
