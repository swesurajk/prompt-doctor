import type { AnalyzeRequest, AnalyzeResponse, Mode, Settings } from '../shared/types.ts';
import { findPromptBox, platformLabel, readPrompt, writePrompt, type PromptBox } from './adapters.ts';
import { PromptDoctor } from './panel.ts';

let box: PromptBox | null = null;
let ui: PromptDoctor | null = null;
let settings: Settings | null = null;

function analyze(prompt: string, mode: Mode, answers?: { question: string; answer: string }[]): Promise<AnalyzeResponse> {
  const req: AnalyzeRequest = { type: 'analyze', prompt, mode, answers, platform: platformLabel() };
  return chrome.runtime.sendMessage(req).catch(
    (): AnalyzeResponse => ({
      ok: false,
      code: 'network',
      error: 'Prompt Doctor lost its connection to the extension. Reload the page and try again.',
    }),
  );
}

function ensureUi(): PromptDoctor {
  ui ??= new PromptDoctor({
    getPrompt: () => (box ? readPrompt(box) : ''),
    applyPrompt: (text) => (box ? writePrompt(box, text) : false),
    analyze,
    openSettings: () => chrome.runtime.sendMessage({ type: 'openOptions' }).catch(() => {}),
    platform: platformLabel(),
    defaultMode: settings?.defaultMode ?? 'quick',
    showHealth: settings?.showHealth ?? true,
  });
  return ui;
}

/**
 * Rescan is cheap (one querySelectorAll + a few getBoundingClientRect) but not
 * free, so it never runs from a mutation directly — mutations only set a flag
 * and the actual scan happens once per idle tick.
 */
function rescan(): void {
  if (settings && !settings.showButton) {
    ui?.setVisible(false);
    return;
  }
  if (box?.el.isConnected) {
    ensureUi().setVisible(true);
    return; // still valid; nothing to do
  }
  const found = findPromptBox();
  box = found;
  if (!found) {
    ui?.setVisible(false);
    return;
  }
  const copilot = ensureUi();
  copilot.attach(found.el, platformLabel());
  copilot.setVisible(true);
}

let scheduled = false;
function scheduleRescan(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    rescan();
  };
  'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 800 }) : setTimeout(run, 300);
}

/**
 * Mutations alone are not enough: a composer can be in the DOM at document_idle
 * but still have no layout (width 0) until fonts and CSS settle, and a page that
 * then mutates nothing would never get a second look. Short bounded retry ladder,
 * stops as soon as a box is found — not a polling loop.
 */
function retryUntilFound(attemptsLeft = 6): void {
  if (box?.el.isConnected || attemptsLeft <= 0) return;
  scheduleRescan();
  setTimeout(() => retryUntilFound(attemptsLeft - 1), 500);
}

function start(): void {
  rescan();
  retryUntilFound();
  addEventListener('load', () => retryUntilFound(2), { once: true });
  addEventListener('resize', () => retryUntilFound(1), { passive: true });

  // SPA route changes and lazily-mounted composers both surface as mutations.
  new MutationObserver(scheduleRescan).observe(document.documentElement, { childList: true, subtree: true });

  // Focusing an editable is the strongest possible signal that it is the composer.
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.matches?.('textarea, [contenteditable="true"], [role="textbox"]') && t !== box?.el) {
        box = null;
        scheduleRescan();
      }
    },
    true,
  );

  addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        rescan();
        if (box) ensureUi().start();
      }
    },
    true,
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      settings = changes.settings.newValue as Settings;
      ui?.setVisible(settings.showButton);
      scheduleRescan();
    }
  });
}

chrome.runtime
  .sendMessage({ type: 'ping' })
  .then((r: { settings: Settings } | undefined) => {
    settings = r?.settings ?? null;
  })
  .catch(() => {})
  .finally(start);
