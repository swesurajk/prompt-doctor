import type { ErrorCode, ProviderId } from './types.ts';

export class ProviderError extends Error {
  readonly code: ErrorCode;
  // Not a `readonly code` parameter property: that is the one TS syntax Node
  // cannot type-strip, and tools/eval.mjs imports this file directly.
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CallOptions {
  provider: ProviderId;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

interface Spec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  pick: (json: any) => string;
}

const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3; // default 1.0 makes rule-following flaky run to run

export function spec(o: CallOptions): Spec {
  switch (o.provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': o.apiKey,
          'anthropic-version': '2023-06-01',
          // Required for browser-origin calls; without it the API rejects us.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model: o.model,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          system: o.system,
          messages: [
            { role: 'user', content: o.user },
            // Prefill forces JSON without needing a tool definition.
            { role: 'assistant', content: '{' },
          ],
        },
        // Two things this must survive: a non-text block arriving first (a
        // thinking block, if the model ever emits one), and the model ignoring
        // the prefill and returning a whole object — blindly prepending "{"
        // there would produce "{{...}" and an unparseable response.
        pick: (j) => {
          const text = (j?.content ?? []).find((b: any) => typeof b?.text === 'string')?.text ?? '';
          return text.trimStart().startsWith('{') ? text : '{' + text;
        },
      };

    case 'google': {
      // Gemini 2.5 models think by default, and thinking tokens come out of
      // maxOutputTokens. Left alone, the budget is spent before any answer is
      // emitted and the candidate comes back with finishReason MAX_TOKENS and
      // no content.parts at all — which reads as "empty response". This call is
      // structured extraction; thinking buys little here.
      // `thinkingBudget: 0` is rejected by 2.5-pro (it cannot be fully
      // disabled), so only send it for the flash tier.
      const canDisableThinking = /flash/i.test(o.model);
      return {
        url:
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey },
        body: {
          systemInstruction: { parts: [{ text: o.system }] },
          contents: [{ role: 'user', parts: [{ text: o.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            // Headroom for the thinking tier that cannot be switched off.
            maxOutputTokens: canDisableThinking ? MAX_TOKENS : MAX_TOKENS * 4,
            temperature: TEMPERATURE,
            ...(canDisableThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        },
        pick: (j) =>
          (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join(''),
      };
    }

    case 'openai':
    case 'custom': {
      const base = (o.provider === 'custom' ? o.baseUrl : 'https://api.openai.com/v1') ?? '';
      return {
        url: `${base.replace(/\/+$/, '')}/chat/completions`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: {
          model: o.model,
          max_completion_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: o.system },
            { role: 'user', content: o.user },
          ],
        },
        pick: (j) => j?.choices?.[0]?.message?.content ?? '',
      };
    }
  }
}

function classify(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('bad_api_key', 'Your API key was rejected. Check it in Prompt Copilot settings.');
  }
  if (status === 429) {
    return new ProviderError('rate_limited', 'Rate limit or quota reached at your provider. Try again shortly.');
  }
  if (status === 404) {
    return new ProviderError('provider_error', 'Model not found. Check the model name in settings.');
  }
  let detail = '';
  try {
    detail = JSON.parse(body)?.error?.message ?? '';
  } catch {
    detail = body.slice(0, 160);
  }
  return new ProviderError('provider_error', detail || `Provider returned HTTP ${status}.`);
}

/**
 * Why an otherwise-successful response carried no text. Every provider has its
 * own way of saying "I stopped early" or "I refused", and all of them arrive as
 * HTTP 200 with an empty text field. Without this, all three collapse into
 * "empty response" and cost an afternoon to tell apart.
 */
export function describeEmpty(json: any): string {
  const blocked = json?.promptFeedback?.blockReason; // Google, prompt-side
  if (blocked) return `The provider blocked this prompt (${blocked}).`;

  const finish =
    json?.candidates?.[0]?.finishReason ?? // Google
    json?.stop_reason ?? // Anthropic
    json?.choices?.[0]?.finish_reason; // OpenAI-compatible

  if (finish === 'MAX_TOKENS' || finish === 'max_tokens' || finish === 'length') {
    return 'The model hit its output limit before returning anything usable. Try a shorter prompt.';
  }
  if (typeof finish === 'string' && /safety|recitation|content_filter|refusal/i.test(finish)) {
    return `The model declined to answer (${finish}).`;
  }
  return finish
    ? `The provider returned an empty response (finish reason: ${finish}).`
    : 'The provider returned an empty response.';
}

/** Seconds from a Retry-After header, clamped so we never sit there for a minute. */
export function retryDelayMs(res: { status: number; headers: { get(n: string): string | null } }): number {
  const raw = Number(res.headers.get('retry-after'));
  const fromHeader = Number.isFinite(raw) && raw > 0 ? raw * 1000 : 0;
  return Math.min(Math.max(fromHeader, 900), 5000);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Single round-trip to the configured provider, with one retry on the two
 * failures that are usually transient: a rate limit and a provider 5xx. One,
 * not three — the user is watching a spinner, and a second failure means the
 * message is more useful than more waiting.
 */
export async function callProvider(o: CallOptions): Promise<string> {
  if (!o.apiKey) throw new ProviderError('no_api_key', 'Add an API key in Prompt Copilot settings to get started.');
  const s = spec(o);

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(s.url, {
        method: 'POST',
        headers: s.headers,
        body: JSON.stringify(s.body),
        signal: o.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new ProviderError('aborted', 'Cancelled.');
      throw new ProviderError('network', 'Could not reach the AI provider. Check your connection.');
    }

    const worthRetrying = res.status === 429 || res.status >= 500;
    if (!worthRetrying || attempt > 0) break;
    await sleep(retryDelayMs(res));
    if (o.signal?.aborted) throw new ProviderError('aborted', 'Cancelled.');
  }

  if (!res.ok) throw classify(res.status, await res.text().catch(() => ''));

  const json = await res.json().catch(() => null);
  const text = json ? s.pick(json) : '';
  // Anthropic's prefill means pick() always returns at least "{", so compare
  // against the prefill rather than emptiness.
  if (text.trim().length <= 1) throw new ProviderError('malformed_response', describeEmpty(json));
  return text;
}
