import {
  clearLocalData,
  DEFAULT_SETTINGS,
  getApiKey,
  getSettings,
  saveSettings,
  setApiKey,
  SUGGESTED_MODELS,
} from '../shared/settings.ts';
import type { HistoryEntry, Mode, ProviderId } from '../shared/types.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const providerEl = $<HTMLSelectElement>('provider');
const modelEl = $<HTMLInputElement>('model');
const modelsEl = $<HTMLDataListElement>('models');
const apiKeyEl = $<HTMLInputElement>('apiKey');
const baseUrlEl = $<HTMLInputElement>('baseUrl');
const baseUrlField = $<HTMLElement>('baseUrlField');
const modeEl = $<HTMLSelectElement>('mode');
const showButtonEl = $<HTMLInputElement>('showButton');
const showHealthEl = $<HTMLInputElement>('showHealth');
const historyEl = $<HTMLInputElement>('historyEnabled');
const instructionsEl = $<HTMLTextAreaElement>('customInstructions');
const savedEl = $<HTMLElement>('saved');
const historyCountEl = $<HTMLElement>('historyCount');
const historyListEl = $<HTMLElement>('historyList');

const KEY_PLACEHOLDER = '••••••••••••••••';

function fillModels(provider: ProviderId): void {
  modelsEl.innerHTML = SUGGESTED_MODELS[provider].map((m) => `<option value="${m}"></option>`).join('');
  baseUrlField.hidden = provider !== 'custom';
}

async function loadKeyField(provider: ProviderId): Promise<void> {
  const existing = await getApiKey(provider);
  apiKeyEl.value = existing ? KEY_PLACEHOLDER : '';
  apiKeyEl.placeholder = existing ? 'Saved — type to replace' : 'Not set';
  apiKeyEl.dataset.dirty = '';
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const when = (at: number): string => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
};

async function readHistory(): Promise<HistoryEntry[]> {
  const raw = await chrome.storage.local.get('history');
  return (raw.history ?? []) as HistoryEntry[];
}

/**
 * Shows what is actually stored. A privacy toggle the user cannot inspect is
 * just a promise — this makes "history is on" mean something they can see and
 * delete, entry by entry.
 */
async function refreshHistoryCount(): Promise<void> {
  const list = await readHistory();
  historyCountEl.textContent = list.length
    ? `${list.length} improvement${list.length === 1 ? '' : 's'} stored locally.`
    : 'No local data stored.';

  historyListEl.innerHTML = list
    .map(
      (e, i) => `<div class="entry">
        <span class="score">${e.score}</span>
        <div class="grow">
          <div class="prompt">${esc(e.original)}</div>
          <div class="meta">${when(e.at)} · ${esc(e.taskType.replace(/_/g, ' '))}</div>
        </div>
        <button type="button" data-copy="${i}">Copy</button>
        <button type="button" class="danger" data-del="${i}" aria-label="Delete this entry">✕</button>
      </div>`,
    )
    .join('');

  historyListEl.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(list[Number(b.dataset.copy)]!.improved);
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), 1400);
    }),
  );
  historyListEl.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const next = list.filter((_, i) => i !== Number(b.dataset.del));
      await chrome.storage.local.set({ history: next });
      await refreshHistoryCount();
    }),
  );
}

async function load(): Promise<void> {
  const s = await getSettings();
  providerEl.value = s.provider;
  modelEl.value = s.model;
  baseUrlEl.value = s.customBaseUrl;
  modeEl.value = s.defaultMode;
  showButtonEl.checked = s.showButton;
  showHealthEl.checked = s.showHealth;
  historyEl.checked = s.historyEnabled;
  instructionsEl.value = s.customInstructions;
  fillModels(s.provider);
  await loadKeyField(s.provider);
  await refreshHistoryCount();
}

providerEl.addEventListener('change', async () => {
  const p = providerEl.value as ProviderId;
  fillModels(p);
  modelEl.value = SUGGESTED_MODELS[p][0] ?? '';
  await loadKeyField(p);
});

apiKeyEl.addEventListener('input', () => {
  apiKeyEl.dataset.dirty = '1';
});

$('clearKey').addEventListener('click', async () => {
  await setApiKey(providerEl.value as ProviderId, '');
  await loadKeyField(providerEl.value as ProviderId);
  flash('Key removed');
});

$('clearData').addEventListener('click', async () => {
  if (!confirm('Remove API keys, history and settings stored by Prompt Copilot on this device?')) return;
  await clearLocalData();
  await load();
  flash('Cleared');
});

$('save').addEventListener('click', async () => {
  const provider = providerEl.value as ProviderId;
  const baseUrl = baseUrlEl.value.trim();

  // Custom endpoints are not in the manifest, so ask for the host at save time.
  if (provider === 'custom' && baseUrl) {
    try {
      const origin = `${new URL(baseUrl).origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) return flash('Permission denied — cannot call that host', true);
    } catch {
      return flash('That base URL is not valid', true);
    }
  }

  await saveSettings({
    provider,
    model: modelEl.value.trim() || DEFAULT_SETTINGS.model,
    customBaseUrl: baseUrl,
    defaultMode: modeEl.value as Mode,
    showButton: showButtonEl.checked,
    showHealth: showHealthEl.checked,
    historyEnabled: historyEl.checked,
    customInstructions: instructionsEl.value.trim(),
  });

  if (apiKeyEl.dataset.dirty && apiKeyEl.value !== KEY_PLACEHOLDER) {
    await setApiKey(provider, apiKeyEl.value.trim());
    await loadKeyField(provider);
  }
  await refreshHistoryCount();
  flash('Saved');
});

function flash(text: string, bad = false): void {
  savedEl.textContent = text;
  savedEl.style.color = bad ? 'var(--bad)' : 'var(--ok)';
  savedEl.classList.add('show');
  setTimeout(() => savedEl.classList.remove('show'), 1800);
}

void load();
