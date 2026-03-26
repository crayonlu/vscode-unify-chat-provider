import { t } from '../i18n';
import type {
  ModelConfig,
  PresetTemplate,
  ServiceTier,
  ThinkingEffort,
} from '../types';

type Verbosity = NonNullable<ModelConfig['verbosity']>;

const DEFAULT_PRESET_ID = 'default';

const REASONING_EFFORT_ORDER: readonly ThinkingEffort[] = [
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none',
];

const VERBOSITY_ORDER: readonly Verbosity[] = ['low', 'medium', 'high'];

const SERVICE_TIER_ORDER: readonly ServiceTier[] = [
  'auto',
  'standard',
  'flex',
  'scale',
  'priority',
];

const REASONING_EFFORT_PRESET_METADATA = {
  xhigh: {
    name: t('Extra High'),
    description: t('Maximum depth of inference'),
  },
  high: {
    name: t('High'),
    description: t('High depth of inference'),
  },
  medium: {
    name: t('Medium'),
    description: t('Balance thinking with speed'),
  },
  low: {
    name: t('Low'),
    description: t('Faster response times and lower depth of inference'),
  },
  minimal: {
    name: t('Minimal'),
    description: t('Minimum depth of inference'),
  },
  none: {
    name: t('None'),
    description: t('Responding without reasoning'),
  },
} satisfies Record<ThinkingEffort, { name: string; description: string }>;

const VERBOSITY_PRESET_METADATA = {
  low: {
    name: t('Low'),
    description: t('More concise responses'),
  },
  medium: {
    name: t('Medium'),
    description: t('Balanced verbosity'),
  },
  high: {
    name: t('High'),
    description: t('More verbose responses'),
  },
} satisfies Record<Verbosity, { name: string; description: string }>;

const SERVICE_TIER_PRESET_METADATA = {
  auto: {
    name: t('Auto'),
    description: t('Let the provider choose automatically'),
  },
  standard: {
    name: t('Standard'),
    description: t('Standard pricing and speed'),
  },
  flex: {
    name: t('Flex'),
    description: t('Lower prices and slower speeds'),
  },
  scale: {
    name: t('Scale'),
    description: t('Higher price and faster speed'),
  },
  priority: {
    name: t('Priority'),
    description: t('Higher price and faster speed'),
  },
} satisfies Record<ServiceTier, { name: string; description: string }>;

export interface ReasoningEffortTemplateOptions {
  default?: ThinkingEffort;
  supported?: readonly ThinkingEffort[];
}

interface SupportedTemplateOptions<T> {
  supported?: readonly T[];
}

export type VerbosityTemplateOptions = SupportedTemplateOptions<Verbosity>;

export type ServiceTierTemplateOptions = SupportedTemplateOptions<ServiceTier>;

function isReasoningEffortTemplateOptions(
  input: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions | undefined,
): input is ReasoningEffortTemplateOptions {
  return input !== undefined && !Array.isArray(input);
}

function normalizeReasoningEffortTemplateOptions(
  input?: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions,
): ReasoningEffortTemplateOptions | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (isReasoningEffortTemplateOptions(input)) {
    return input;
  }
  return { supported: input };
}

function isSupportedTemplateOptions<T>(
  input: readonly T[] | SupportedTemplateOptions<T> | undefined,
): input is SupportedTemplateOptions<T> {
  return input !== undefined && !Array.isArray(input);
}

function normalizeSupportedTemplateOptions<T>(
  input?: readonly T[] | SupportedTemplateOptions<T>,
): SupportedTemplateOptions<T> | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (isSupportedTemplateOptions(input)) {
    return input;
  }
  return { supported: input };
}

function resolveSupportedValues<T>(
  order: readonly T[],
  supported: readonly T[] | undefined,
): readonly T[] {
  return supported && supported.length > 0
    ? order.filter((value) => supported.includes(value))
    : order;
}

function createDefaultPreset(
  description: string,
): PresetTemplate['presets'][number] {
  return {
    id: DEFAULT_PRESET_ID,
    name: t('Default'),
    description,
    config: {},
  };
}

export function reasoningEffort(
  supported?: readonly ThinkingEffort[],
): PresetTemplate;
export function reasoningEffort(
  opts?: ReasoningEffortTemplateOptions,
): PresetTemplate;
export function reasoningEffort(
  input?: readonly ThinkingEffort[] | ReasoningEffortTemplateOptions,
): PresetTemplate {
  const resolvedOptions = normalizeReasoningEffortTemplateOptions(input);
  const supportedEfforts = resolveSupportedValues(
    REASONING_EFFORT_ORDER,
    resolvedOptions?.supported,
  );
  const presets = supportedEfforts.map(
    (effort): PresetTemplate['presets'][number] => ({
      ...REASONING_EFFORT_PRESET_METADATA[effort],
      id: effort,
      config: {
        thinking: {
          type: 'enabled',
          effort,
        },
      },
    }),
  );
  const defaultPreset =
    resolvedOptions?.default &&
    supportedEfforts.includes(resolvedOptions.default)
      ? resolvedOptions.default
      : (presets[0]?.id ?? 'xhigh');

  return {
    name: t('Reasoning Effort'),
    id: 'reasoningEffort',
    presets,
    default: defaultPreset,
  };
}

export function verbosity(supported?: readonly Verbosity[]): PresetTemplate;
export function verbosity(opts?: VerbosityTemplateOptions): PresetTemplate;
export function verbosity(
  input?: readonly Verbosity[] | VerbosityTemplateOptions,
): PresetTemplate {
  const resolvedOptions = normalizeSupportedTemplateOptions(input);
  const supportedVerbosity = resolveSupportedValues(
    VERBOSITY_ORDER,
    resolvedOptions?.supported,
  );
  const presets: PresetTemplate['presets'] = [
    createDefaultPreset(t('Use provider default')),
    ...supportedVerbosity.map((value): PresetTemplate['presets'][number] => ({
      ...VERBOSITY_PRESET_METADATA[value],
      id: value,
      config: {
        verbosity: value,
      },
    })),
  ];

  return {
    name: t('Verbosity'),
    id: 'verbosity',
    presets,
    default: DEFAULT_PRESET_ID,
  };
}

export function serviceTier(supported?: readonly ServiceTier[]): PresetTemplate;
export function serviceTier(opts?: ServiceTierTemplateOptions): PresetTemplate;
export function serviceTier(
  input?: readonly ServiceTier[] | ServiceTierTemplateOptions,
): PresetTemplate {
  const resolvedOptions = normalizeSupportedTemplateOptions(input);
  const supportedServiceTiers = resolveSupportedValues(
    SERVICE_TIER_ORDER,
    resolvedOptions?.supported,
  );
  const presets: PresetTemplate['presets'] = [
    createDefaultPreset(t('Use provider default behavior')),
    ...supportedServiceTiers.map(
      (value): PresetTemplate['presets'][number] => ({
        ...SERVICE_TIER_PRESET_METADATA[value],
        id: value,
        config: {
          serviceTier: value,
        },
      }),
    ),
  ];

  return {
    name: t('Service Tier'),
    id: 'serviceTier',
    presets,
    default: DEFAULT_PRESET_ID,
  };
}
