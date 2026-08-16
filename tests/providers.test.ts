import { afterEach, describe, expect, it, vi } from 'vitest';
import { callProvider, describeEmpty, ProviderError, retryDelayMs, spec } from '../src/shared/providers.ts';
import type { CallOptions } from '../src/shared/providers.ts';

/**
 * Request shapes and response pickers, against recorded response bodies.
 *
 * `npm run eval` is the only thing that proves a live endpoint accepts these,
 * but it costs money and a key. These assertions catch the half of the problem
 * that is pure data handling — the half that historically breaks silently and
 * surfaces as "the provider returned an empty response".
 */
const base = (over: Partial<CallOptions> = {}): CallOptions => ({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: 'k',
  system: 'SYS',
  user: 'USER',
  ...over,
});

const body = (o: Partial<CallOptions>): any => spec(base(o)).body;

describe('anthropic request', () => {
  it('sends the browser-access header, a prefill, and a low temperature', () => {
    const s = spec(base());
    expect(s.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(s.headers['anthropic-version']).toBe('2023-06-01');
    expect(s.body).toMatchObject({
      system: 'SYS',
      temperature: 0.3,
      messages: [
        { role: 'user', content: 'USER' },
        { role: 'assistant', content: '{' },
      ],
    });
    expect((s.body as any).max_tokens).toBeGreaterThan(0);
  });
});

describe('anthropic pick', () => {
  const pick = spec(base()).pick;

  it('restores the brace the prefill consumed', () => {
    expect(pick({ content: [{ type: 'text', text: '"taskType":"coding"}' }] })).toBe('{"taskType":"coding"}');
  });

  it('does not double the brace when the model ignores the prefill', () => {
    // Real behaviour: some models restate the whole object instead of continuing.
    expect(pick({ content: [{ type: 'text', text: '{"taskType":"coding"}' }] })).toBe('{"taskType":"coding"}');
  });

  it('finds the text block when a non-text block comes first', () => {
    expect(
      pick({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '"a":1}' }] }),
    ).toBe('{"a":1}');
  });

  it('yields only the bare prefill when there is no text at all', () => {
    // Must stay ≤1 char so callProvider reports it rather than returning "{".
    expect(pick({ content: [] })).toBe('{');
    expect(pick({}).length).toBeLessThanOrEqual(1);
  });
});

describe('google request', () => {
  it('disables thinking on the flash tier, where it would eat the whole budget', () => {
    const g = body({ provider: 'google', model: 'gemini-2.5-flash' });
    expect(g.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(g.generationConfig.responseMimeType).toBe('application/json');
    expect(g.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
  });

  it('does not send thinkingBudget 0 to pro, which rejects it, and gives it headroom instead', () => {
    const flash = body({ provider: 'google', model: 'gemini-2.5-flash' });
    const pro = body({ provider: 'google', model: 'gemini-2.5-pro' });
    expect(pro.generationConfig.thinkingConfig).toBeUndefined();
    expect(pro.generationConfig.maxOutputTokens).toBeGreaterThan(flash.generationConfig.maxOutputTokens);
  });

  it('puts the key in a header, never the URL', () => {
    const s = spec(base({ provider: 'google', model: 'gemini-2.5-flash', apiKey: 'AIzaSECRET' }));
    expect(s.headers['x-goog-api-key']).toBe('AIzaSECRET');
    expect(s.url).not.toContain('AIzaSECRET');
  });
});

describe('google pick', () => {
  const pick = spec(base({ provider: 'google', model: 'gemini-2.5-flash' })).pick;

  it('joins every text part', () => {
    expect(pick({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] })).toBe('{"a":1}');
  });

  it('returns nothing when the candidate has no parts (the MAX_TOKENS shape)', () => {
    expect(pick({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toBe('');
  });

  it('returns nothing when the prompt was blocked and there are no candidates', () => {
    expect(pick({ promptFeedback: { blockReason: 'SAFETY' } })).toBe('');
  });
});

describe('openai / custom request', () => {
  it('normalises a custom base URL with a trailing slash', () => {
    expect(spec(base({ provider: 'custom', baseUrl: 'https://api.groq.com/openai/v1/' })).url).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
  });

  it('defaults to the OpenAI base and asks for a JSON object', () => {
    const s = spec(base({ provider: 'openai', model: 'gpt-4.1-mini' }));
    expect(s.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(s.headers.authorization).toBe('Bearer k');
    expect(s.body).toMatchObject({
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
    });
  });

  it('picks the message content', () => {
    const pick = spec(base({ provider: 'openai' })).pick;
    expect(pick({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
    expect(pick({ choices: [] })).toBe('');
  });
});

describe('describeEmpty', () => {
  it('names a Google prompt block', () => {
    expect(describeEmpty({ promptFeedback: { blockReason: 'SAFETY' } })).toMatch(/blocked this prompt \(SAFETY\)/);
  });

  it('explains the truncation case for every provider spelling', () => {
    expect(describeEmpty({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toMatch(/output limit/);
    expect(describeEmpty({ stop_reason: 'max_tokens' })).toMatch(/output limit/);
    expect(describeEmpty({ choices: [{ finish_reason: 'length' }] })).toMatch(/output limit/);
  });

  it('reports a refusal as a refusal', () => {
    expect(describeEmpty({ choices: [{ finish_reason: 'content_filter' }] })).toMatch(/declined/);
    expect(describeEmpty({ candidates: [{ finishReason: 'SAFETY' }] })).toMatch(/declined/);
  });

  it('falls back without inventing a reason', () => {
    expect(describeEmpty({})).toBe('The provider returned an empty response.');
    expect(describeEmpty(null)).toBe('The provider returned an empty response.');
  });
});

/**
 * callProvider end to end with fetch stubbed. This is everything except "does
 * the real endpoint accept this body" — retry, classification, abort and the
 * empty-response path all live here and are otherwise only exercised by a paid
 * live run.
 */
describe('callProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, json: unknown, headers: Record<string, string> = {}) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => json,
      text: async () => JSON.stringify(json),
    }) as unknown as Response;

  const stub = (...responses: Response[]) => {
    const fetchMock = vi.fn();
    for (const r of responses) fetchMock.mockResolvedValueOnce(r);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const ok = { choices: [{ message: { content: '{"improvedPrompt":"x"}' } }] };
  const call = (over: Partial<CallOptions> = {}) => callProvider(base({ provider: 'openai', ...over }));

  it('refuses to call out at all without a key', async () => {
    const fetchMock = stub();
    await expect(call({ apiKey: '' })).rejects.toMatchObject({ code: 'no_api_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the text on success, after exactly one request', async () => {
    const fetchMock = stub(reply(200, ok));
    await expect(call()).resolves.toBe('{"improvedPrompt":"x"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 once and succeeds', async () => {
    const fetchMock = stub(reply(429, {}, { 'retry-after': '0' }), reply(200, ok));
    await expect(call()).resolves.toContain('improvedPrompt');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 500 once, then gives up rather than hammering', async () => {
    const fetchMock = stub(reply(500, {}), reply(500, { error: { message: 'upstream down' } }));
    await expect(call()).rejects.toMatchObject({ code: 'provider_error', message: 'upstream down' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 401 — a bad key will still be bad in one second', async () => {
    const fetchMock = stub(reply(401, {}));
    await expect(call()).rejects.toMatchObject({ code: 'bad_api_key' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 404 to a model-name hint and 429-twice to rate_limited', async () => {
    stub(reply(404, {}));
    await expect(call()).rejects.toMatchObject({ code: 'provider_error', message: /Model not found/ });
    vi.unstubAllGlobals();
    stub(reply(429, {}, { 'retry-after': '0' }), reply(429, {}, { 'retry-after': '0' }));
    await expect(call()).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('reports a network failure as network, not as a provider fault', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(call()).rejects.toMatchObject({ code: 'network' });
  });

  it('surfaces an abort as aborted', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    await expect(call()).rejects.toMatchObject({ code: 'aborted' });
  });

  it('explains WHY a 200 carried no text instead of saying "empty"', async () => {
    stub(reply(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] }));
    await expect(
      callProvider(base({ provider: 'google', model: 'gemini-2.5-flash' })),
    ).rejects.toMatchObject({ code: 'malformed_response', message: /output limit/ });
  });

  it('treats a bare Anthropic prefill as empty, not as the string "{"', async () => {
    stub(reply(200, { content: [], stop_reason: 'max_tokens' }));
    await expect(callProvider(base())).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('retryDelayMs', () => {
  const withHeader = (v: string | null) => ({ status: 429, headers: { get: () => v } });

  it('honours Retry-After but never waits longer than 5s', () => {
    expect(retryDelayMs(withHeader('2'))).toBe(2000);
    expect(retryDelayMs(withHeader('600'))).toBe(5000);
  });

  it('uses a floor when the header is missing or junk', () => {
    expect(retryDelayMs(withHeader(null))).toBe(900);
    expect(retryDelayMs(withHeader('soon'))).toBe(900);
  });
});
