import { getApiKey, getSettings } from '../shared/settings.ts';

const dot = document.getElementById('dot')!;
const text = document.getElementById('statusText')!;
const hint = document.getElementById('statusHint')!;

document.getElementById('settings')!.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

void (async () => {
  const s = await getSettings();
  const configured = Boolean(await getApiKey(s.provider));
  dot.classList.add(configured ? 'on' : 'off');
  text.textContent = configured ? `Ready — ${s.provider} · ${s.model}` : 'No API key yet';
  hint.textContent = configured
    ? `Default mode: ${s.defaultMode}. Prompts are sent only when you click ✨ Improve.`
    : 'Add your own provider API key in Settings to start analyzing prompts.';
})();
