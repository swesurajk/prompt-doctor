import { buildUserBrief, SYSTEM_BRIEF } from '../shared/brief.ts';
import { callProvider, ProviderError } from '../shared/providers.ts';
import { extractJson, parseAnalysis, precheck, withScore } from '../shared/scoring.ts';
import { getApiKey, getSettings } from '../shared/settings.ts';
import type { AnalyzeRequest, AnalyzeResponse, HistoryEntry } from '../shared/types.ts';

/**
 * The service worker is the only place that ever sees the API key. Content
 * scripts run in the page's tab and share an origin with the AI site, so
 * anything they can read a hostile page could in principle reach. Keys stay here.
 */

const HISTORY_KEY = 'history';
const HISTORY_MAX = 50;

async function recordHistory(entry: HistoryEntry): Promise<void> {
  const raw = await chrome.storage.local.get(HISTORY_KEY);
  const list = ((raw[HISTORY_KEY] ?? []) as HistoryEntry[]).slice(0, HISTORY_MAX - 1);
  await chrome.storage.local.set({ [HISTORY_KEY]: [entry, ...list] });
}

async function analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  const pre = precheck(req.prompt);
  if (!pre.ok) return { ok: false, error: pre.message, code: pre.code };

  const settings = await getSettings();
  const apiKey = await getApiKey(settings.provider);

  try {
    const text = await callProvider({
      provider: settings.provider,
      model: settings.model,
      apiKey,
      baseUrl: settings.customBaseUrl,
      system: SYSTEM_BRIEF,
      user: buildUserBrief(req, settings.customInstructions),
    });

    const analysis = parseAnalysis(extractJson(text), req.prompt);
    if (!analysis) {
      return {
        ok: false,
        code: 'malformed_response',
        error: 'The model returned something unexpected. Try again, or switch to a stronger model in settings.',
      };
    }

    const scored = withScore(analysis);

    if (settings.historyEnabled) {
      await recordHistory({
        at: Date.now(),
        taskType: scored.taskType,
        score: scored.score,
        original: req.prompt,
        improved: scored.improvedPrompt,
      });
    }

    return { ok: true, analysis: scored };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: 'Something went wrong while analyzing.', code: 'provider_error' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'analyze') {
    analyze(msg as AnalyzeRequest).then(sendResponse);
    return true; // async
  }
  if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type === 'ping') {
    getSettings().then(async (s) => sendResponse({ configured: Boolean(await getApiKey(s.provider)), settings: s }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
