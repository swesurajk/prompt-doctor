/**
 * Prompt-box detection.
 *
 * Deliberately NOT "one CSS selector per site". Those selectors are hashed
 * class names on apps that redeploy weekly; the extension would silently die.
 *
 * Instead: a generic scorer that ranks every plausible editable element on the
 * page using properties that are stable because they are semantic (role,
 * aria-label, placeholder, size, position), plus per-host *hints* that only add
 * points. If a hint selector rots, detection degrades to generic and keeps
 * working. If a site adds a new one, it usually wins on the generic score alone.
 */

export interface PromptBox {
  el: HTMLElement;
  kind: 'textarea' | 'contenteditable';
}

/** Hints, not requirements. Verified as of Feb 2025; expected to drift. */
const HOST_HINTS: { match: RegExp; selectors: string[]; label: string }[] = [
  { match: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, selectors: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]'], label: 'ChatGPT' },
  { match: /(^|\.)claude\.ai$/, selectors: ['div.ProseMirror[contenteditable="true"]', '[aria-label*="prompt" i][contenteditable="true"]'], label: 'Claude' },
  { match: /(^|\.)gemini\.google\.com$/, selectors: ['rich-textarea div.ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]'], label: 'Gemini' },
  { match: /(^|\.)perplexity\.ai$/, selectors: ['#ask-input', 'div[contenteditable="true"]', 'textarea[placeholder]'], label: 'Perplexity' },
  { match: /(^|\.)copilot\.microsoft\.com$|(^|\.)m365\.cloud\.microsoft$/, selectors: ['textarea#userInput', 'textarea[data-testid="composer-input"]', 'div[contenteditable="true"]'], label: 'Microsoft Copilot' },
  { match: /(^|\.)grok\.com$|(^|\.)x\.com$/, selectors: ['textarea[aria-label*="Grok" i]', 'textarea[placeholder*="ask" i]', 'div[contenteditable="true"]'], label: 'Grok' },
];

const LABEL_RE = /(ask|message|prompt|question|send|type|chat|search|reply|talk)/i;

export function platformLabel(host = location.hostname): string {
  return HOST_HINTS.find((h) => h.match.test(host))?.label ?? host;
}

function hintSelectors(host = location.hostname): string[] {
  return HOST_HINTS.find((h) => h.match.test(host))?.selectors ?? [];
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 120 || r.height < 16) return false;
  const s = getComputedStyle(el);
  const opacity = s.opacity === '' ? 1 : Number(s.opacity); // '' when the engine has no layout yet
  return s.visibility !== 'hidden' && s.display !== 'none' && !(opacity <= 0.05);
}

function accessibleText(el: HTMLElement): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  const labelled = labelledBy ? document.getElementById(labelledBy)?.textContent ?? '' : '';
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('data-placeholder'),
    el.getAttribute('name'),
    el.getAttribute('id'),
    labelled,
    // Quill/ProseMirror render their placeholder on a child or via ::before content
    el.firstElementChild?.getAttribute('data-placeholder') ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function score(el: HTMLElement, hints: string[]): number {
  if (!isVisible(el)) return -1;
  if (el.closest('[data-prompt-copilot]')) return -1;
  if ((el as HTMLTextAreaElement).disabled || (el as HTMLTextAreaElement).readOnly) return -1;
  if (el.getAttribute('aria-hidden') === 'true') return -1;

  let s = 0;
  const r = el.getBoundingClientRect();

  // Composers live at the bottom of the viewport and are wide.
  const bottomness = r.bottom / Math.max(1, window.innerHeight);
  if (bottomness > 0.55) s += 25;
  if (bottomness > 0.8) s += 15;
  s += Math.min(25, r.width / 40);

  if (el.getAttribute('role') === 'textbox') s += 15;
  if (LABEL_RE.test(accessibleText(el))) s += 30;
  if (el.tagName === 'TEXTAREA') s += 10;
  if (el.matches('.ProseMirror, .ql-editor')) s += 20;
  if (el.closest('form')) s += 5;
  // A search field in a header is the classic false positive.
  if ((el as HTMLInputElement).type === 'search' || /search/i.test(el.getAttribute('role') ?? '')) s -= 20;
  if (r.top < window.innerHeight * 0.25 && r.height < 60) s -= 25;

  for (const sel of hints) {
    try {
      if (el.matches(sel)) {
        s += 60;
        break;
      }
    } catch {
      /* bad selector in hints — ignore */
    }
  }
  return s;
}

/** Returns the most likely prompt box on the page, or null. */
export function findPromptBox(root: ParentNode = document, host = location.hostname): PromptBox | null {
  const hints = hintSelectors(host);
  const candidates = root.querySelectorAll<HTMLElement>(
    'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
  );

  let best: HTMLElement | null = null;
  let bestScore = 20; // floor: below this we would rather show nothing than the wrong box
  for (const el of candidates) {
    const s = score(el, hints);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) return null;
  return { el: best, kind: best.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable' };
}

export function readPrompt(box: PromptBox): string {
  return box.kind === 'textarea'
    ? (box.el as HTMLTextAreaElement).value
    : (box.el.innerText ?? box.el.textContent ?? '');
}

/**
 * Writing back is the part that breaks naively.
 *
 * React-controlled textareas ignore `el.value = x` because React caches the
 * previous value on the DOM node — you have to go through the native setter and
 * then dispatch an InputEvent so React's onChange runs.
 *
 * ProseMirror/Quill editors ignore innerHTML writes because their state lives in
 * a document model, not the DOM. The only reliable public path is to let the
 * browser's own editing pipeline do it: select all, then insertText. execCommand
 * is deprecated but every one of these editors still handles it, and the
 * beforeinput/paste fallback covers the day it is removed.
 */
export function writePrompt(box: PromptBox, text: string): boolean {
  box.el.focus();

  if (box.kind === 'textarea') {
    const el = box.el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter ? setter.call(el, text) : (el.value = text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.selectionStart = el.selectionEnd = text.length;
    return true;
  }

  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(box.el);
  sel?.removeAllRanges();
  sel?.addRange(range);

  try {
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) {
      collapseToEnd(box.el);
      return true;
    }
  } catch {
    /* execCommand removed or refused — fall through */
  }

  // Fallback: synthesise a paste, which rich editors handle natively.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const notCancelled = box.el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    if (!notCancelled) {
      collapseToEnd(box.el);
      return true;
    }
  } catch {
    /* DataTransfer/ClipboardEvent unavailable — fall through */
  }

  // Last resort: direct DOM write. Works on plain contenteditable divs.
  box.el.textContent = text;
  box.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  collapseToEnd(box.el);
  return readPrompt(box).trim() === text.trim();
}

function collapseToEnd(el: HTMLElement): void {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}
