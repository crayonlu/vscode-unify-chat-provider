import { t } from '../i18n';

export type MainInstanceErrorCode =
  | 'LEADER_GONE'
  | 'NO_LEADER'
  | 'INCOMPATIBLE_VERSION'
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'PORT_IN_USE'
  | 'BUSY'
  | 'NOT_IMPLEMENTED'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export type RpcError = {
  code: MainInstanceErrorCode;
  message: string;
};

export class MainInstanceError extends Error {
  readonly code: MainInstanceErrorCode;

  constructor(code: MainInstanceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'MainInstanceError';
  }
}

export function isLeaderUnavailableError(
  error: unknown,
): error is MainInstanceError {
  return (
    error instanceof MainInstanceError &&
    (error.code === 'NO_LEADER' || error.code === 'LEADER_GONE')
  );
}

export function isVersionIncompatibleError(
  error: unknown,
): error is MainInstanceError {
  return (
    error instanceof MainInstanceError && error.code === 'INCOMPATIBLE_VERSION'
  );
}

export type MainInstanceCompatibilityMismatchDetails = {
  localExtensionVersion?: string;
  peerExtensionVersion?: string;
  localProtocolVersion: number;
  peerProtocolVersion?: number;
  localCompatibilityVersion: number;
  peerCompatibilityVersion?: number;
};

function formatOptionalText(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'unknown';
}

function formatOptionalNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : 'unknown';
}

export function buildMainInstanceCompatibilityMismatchMessage(
  details: MainInstanceCompatibilityMismatchDetails,
): string {
  return t(
    'Detected another VS Code window running an incompatible main-instance coordination version (peer extension {0}, protocol {1}, compatibility {2}; local extension {3}, protocol {4}, compatibility {5}). Please reload or update all VS Code windows to compatible versions, then try again.',
    formatOptionalText(details.peerExtensionVersion),
    formatOptionalNumber(details.peerProtocolVersion),
    formatOptionalNumber(details.peerCompatibilityVersion),
    formatOptionalText(details.localExtensionVersion),
    formatOptionalNumber(details.localProtocolVersion),
    formatOptionalNumber(details.localCompatibilityVersion),
  );
}

export function asRpcError(value: unknown): RpcError {
  if (
    value instanceof MainInstanceError &&
    typeof value.code === 'string' &&
    value.code.trim() !== ''
  ) {
    return { code: value.code, message: value.message };
  }

  if (value instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: value.message };
  }

  return { code: 'INTERNAL_ERROR', message: String(value) };
}
