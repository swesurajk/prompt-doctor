import type { Settings } from './types.ts';

/** Sensible defaults. Model ids are user-editable — providers rename them often. */
export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  customBaseUrl: '',
  defaultMode: 'quick',
  showButton: true,
  showHealth: true,
  historyEnabled: false,
  customInstructions: '',
};

export const SUGGESTED_MODELS: Record<Settings['provider'], string[]> = {
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  custom: [],
};

/**
 * Settings live in chrome.storage.sync (small, non-secret, nice to roam).
 * The API key lives in chrome.storage.local under a separate key and is NEVER
 * synced and NEVER readable by a content script — only the service worker
 * touches it.
 */
const KEY_STORE = 'apiKeys';

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(raw.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function getApiKey(provider: Settings['provider']): Promise<string> {
  const raw = await chrome.storage.local.get(KEY_STORE);
  const keys = (raw[KEY_STORE] ?? {}) as Record<string, string>;
  return keys[provider] ?? '';
}

export async function setApiKey(provider: Settings['provider'], key: string): Promise<void> {
  const raw = await chrome.storage.local.get(KEY_STORE);
  const keys = (raw[KEY_STORE] ?? {}) as Record<string, string>;
  if (key) keys[provider] = key;
  else delete keys[provider];
  await chrome.storage.local.set({ [KEY_STORE]: keys });
}

export async function clearLocalData(): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.sync.remove('settings');
}
