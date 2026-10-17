import { EventType, type AGUIEvent } from '@zllling/pageway-protocol';

/** Provider-reported routing information, never an assertion about billing. */
export interface ProviderInfo {
  requestedModel: string;
  /** Null until the provider identifies the model in a header or response chunk. */
  model: string | null;
  provider: string;
  modelSource: 'response' | 'header' | 'unknown';
  fallback?: boolean;
  freeModel?: string;
  originalModel?: string;
  fallbackModel?: string;
}

function safeLabel(value: unknown, apiKey?: string): string | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in untrusted provider labels.
  if (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))
    return;
  const label = value.trim();
  if (!label || (apiKey && label.includes(apiKey))) return;
  return label;
}

/** Only explicitly allowlisted response fields may enter browser telemetry. */
export function createProviderReporter(
  options: { baseURL: string; model: string; apiKey?: string },
  headers: Headers,
  emit: (event: AGUIEvent) => void,
): (model?: unknown) => void {
  const read = (name: string) => safeLabel(headers.get(name), options.apiKey);
  const freeModel = read('X-Free-Model');
  const originalModel = read('X-Original-Model');
  const fallbackModel = read('X-Fallback-Model');
  const fallbackFlag = read('X-Fallback-Used')?.toLowerCase();
  const fallback = ['true', '1'].includes(fallbackFlag ?? '')
    ? true
    : ['false', '0'].includes(fallbackFlag ?? '')
      ? false
      : undefined;
  const headerModel = (fallback ? fallbackModel : undefined) ?? freeModel;
  const info: ProviderInfo = {
    requestedModel: safeLabel(options.model, options.apiKey) ?? '[unavailable]',
    model: headerModel ?? null,
    provider: new URL(options.baseURL).host,
    modelSource: headerModel ? 'header' : 'unknown',
    ...(fallback !== undefined ? { fallback } : {}),
    ...(freeModel ? { freeModel } : {}),
    ...(originalModel ? { originalModel } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
  };
  let previous = '';
  return (value) => {
    const model = safeLabel(value, options.apiKey);
    if (model) {
      info.model = model;
      info.modelSource = 'response';
    }
    const serialized = JSON.stringify(info);
    if (serialized === previous) return;
    previous = serialized;
    // Copy so consumers cannot observe later mutations to this event's value.
    emit({ type: EventType.CUSTOM, name: 'pageway.provider', value: { ...info } });
  };
}
