import { BAND_LABEL, findSecrets, visibleDimensions } from '../shared/scoring.ts';
import { MODES, type AnalyzeResponse, type DimensionId, type Mode, type ScoredAnalysis } from '../shared/types.ts';
import { PANEL_CSS } from './panel.css.ts';

const DIM_LABEL: Record<DimensionId, string> = {
  objective: 'Objective',
  context: 'Context',
  specificity: 'Specificity',
  constraints: 'Constraints',
  output_format: 'Output format',
  audience: 'Audience',
  role: 'Role',
  scope: 'Scope',
  examples: 'Examples',
  technical_requirements: 'Technical detail',
  success_criteria: 'Success criteria',
  ambiguity: 'Ambiguity',
  completeness: 'Completeness',
  consistency: 'Consistency',
  efficiency: 'Conciseness',
};

const MODE_LABEL: Record<Mode, string> = {
  quick: 'Quick',
  deep: 'Deep',
  technical: 'Technical',
  research: 'Research',
  interview: 'Interview',
};

const STEPS = [
  'Understanding your objective',
  'Detecting task type',
  'Checking context & scope',
  'Checking ambiguity',
  'Checking output expectations',
  'Drafting improvements',
];

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PanelHooks {
  getPrompt(): string;
  applyPrompt(text: string): boolean;
  analyze(prompt: string, mode: Mode, answers?: { question: string; answer: string }[]): Promise<AnalyzeResponse>;
  openSettings(): void;
  platform: string;
  defaultMode: Mode;
  /** When false, skip the health card and go straight to the improved prompt. */
  showHealth: boolean;
}

type State =
  | { name: 'idle' }
  | { name: 'analyzing' }
  | { name: 'secrets'; prompt: string; hits: { label: string; preview: string }[] }
  | { name: 'health'; a: ScoredAnalysis }
  | { name: 'improved'; a: ScoredAnalysis }
  | { name: 'error'; message: string; settings: boolean };

export class Copilot {
  private host = document.createElement('div');
  private root: ShadowRoot;
  private trigger!: HTMLButtonElement;
  private panel!: HTMLElement;
  private body!: HTMLElement;
  private foot!: HTMLElement;
  private anchor: HTMLElement | null = null;
  private state: State = { name: 'idle' };
  private mode: Mode;
  private reqId = 0;
  private stepTimer: number | undefined;
  private ro = new ResizeObserver(() => this.position());

  constructor(private hooks: PanelHooks) {
    this.mode = hooks.defaultMode;
    this.host.setAttribute('data-prompt-copilot', '');
    // Keep the host out of the page's layout entirely; children are position:fixed.
    // No `all:initial` here — inline styles beat :host rules, and that would undo
    // the font-family the shadow CSS sets. The reset lives in :host instead.
    this.host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${PANEL_CSS}</style>
      <button class="trigger" type="button" part="trigger" aria-haspopup="dialog"
        title="Analyze and improve this prompt (Alt+Shift+P)">
        <span class="spark" aria-hidden="true">✨</span><span>Improve</span>
      </button>
      <section class="panel" role="dialog" aria-modal="false" aria-label="Prompt Copilot" hidden>
        <header>
          <div>
            <div class="title">✨ Prompt Copilot</div>
            <div class="sub">AI Prompt Analyzer &amp; Assistant</div>
          </div>
          <div class="grow"></div>
          <button class="iconbtn settings" type="button" title="Settings" aria-label="Settings">⚙</button>
          <button class="iconbtn close" type="button" title="Close (Esc)" aria-label="Close">✕</button>
        </header>
        <div class="body"></div>
        <footer></footer>
      </section>`;

    this.trigger = this.root.querySelector('.trigger')!;
    this.panel = this.root.querySelector('.panel')!;
    this.body = this.root.querySelector('.body')!;
    this.foot = this.root.querySelector('footer')!;

    this.trigger.addEventListener('click', () => this.start());
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.querySelector('.settings')!.addEventListener('click', () => this.hooks.openSettings());
    this.panel.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key === 'Escape') {
        e.stopPropagation();
        this.close();
        return;
      }
      // Trap Tab inside the panel. Without this, Tab walks into the AI site's
      // own controls behind the dialog, which is disorienting on a keyboard and
      // unusable with a screen reader.
      if (ev.key !== 'Tab') return;
      const focusable = [
        ...this.panel.querySelectorAll<HTMLElement>('button, textarea, select, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = this.root.activeElement;
      if (ev.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });

    document.documentElement.appendChild(this.host);
    addEventListener('scroll', this.position, { passive: true, capture: true });
    addEventListener('resize', this.position, { passive: true });
  }

  /* ---------------- lifecycle ---------------- */

  attach(el: HTMLElement, platform: string): void {
    if (this.anchor === el) return;
    if (this.anchor) this.ro.unobserve(this.anchor);
    this.anchor = el;
    this.hooks.platform = platform;
    this.ro.observe(el);
    this.position();
  }

  setVisible(v: boolean): void {
    this.trigger.hidden = !v;
    if (!v) this.close();
  }

  destroy(): void {
    removeEventListener('scroll', this.position, { capture: true } as EventListenerOptions);
    removeEventListener('resize', this.position);
    this.ro.disconnect();
    this.host.remove();
  }

  private position = (): void => {
    if (!this.anchor?.isConnected) return;
    const r = this.anchor.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    // Sit just above the input's top-right corner: almost always empty space,
    // and it can never cover the send button, which lives inside/below the box.
    const gap = 6;
    const th = 28;
    const above = r.top - th - gap >= 8;
    const tw = this.trigger.offsetWidth || 96;
    this.trigger.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, r.right - tw))}px`;
    this.trigger.style.top = `${above ? r.top - th - gap : Math.max(8, r.top + gap)}px`;

    if (this.panel.hidden) return;
    const pw = this.panel.offsetWidth;
    const ph = this.panel.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw));
    const fitsAbove = r.top - ph - 40 >= 8;
    this.panel.style.left = `${left}px`;
    this.panel.style.top = fitsAbove
      ? `${r.top - ph - 38}px`
      : `${Math.max(8, Math.min(window.innerHeight - ph - 8, r.bottom - ph))}px`;
  };

  /* ---------------- flow ---------------- */

  private open(): void {
    this.panel.hidden = false;
    this.position();
    (this.panel.querySelector('button.primary, textarea, button') as HTMLElement | null)?.focus();
  }

  close(): void {
    this.panel.hidden = true;
    this.reqId++; // orphan any in-flight response
    clearInterval(this.stepTimer);
    this.trigger.classList.remove('busy');
    this.state = { name: 'idle' };
    this.anchor?.focus();
  }

  /** Entry point: the ✨ button and the keyboard shortcut both land here. */
  start(): void {
    const prompt = this.hooks.getPrompt().trim();
    if (!prompt) {
      this.set({ name: 'error', message: 'Type a prompt in the box first, then click ✨ Improve.', settings: false });
      this.open();
      return;
    }
    const hits = findSecrets(prompt);
    if (hits.length) {
      this.set({ name: 'secrets', prompt, hits });
      this.open();
      return;
    }
    this.run(prompt);
  }

  private async run(prompt: string, answers?: { question: string; answer: string }[]): Promise<void> {
    const id = ++this.reqId;
    this.set({ name: 'analyzing' });
    this.open();
    this.trigger.classList.add('busy');

    const res = await this.hooks.analyze(prompt, this.mode, answers);
    if (id !== this.reqId) return; // user cancelled or restarted
    this.trigger.classList.remove('busy');
    clearInterval(this.stepTimer);

    if (!res.ok) {
      this.set({
        name: 'error',
        message: res.error,
        settings: res.code === 'no_api_key' || res.code === 'bad_api_key',
      });
      return;
    }
    this.set(
      this.hooks.showHealth
        ? { name: 'health', a: res.analysis }
        : { name: 'improved', a: res.analysis },
    );
  }

  private set(s: State): void {
    this.state = s;
    if (s.name !== 'analyzing') this.panel.removeAttribute('aria-busy');
    this.render();
    this.position();
  }

  /* ---------------- rendering ---------------- */

  private render(): void {
    const s = this.state;
    if (s.name === 'analyzing') return this.renderAnalyzing();
    if (s.name === 'secrets') return this.renderSecrets(s.prompt, s.hits);
    if (s.name === 'error') return this.renderError(s.message, s.settings);
    if (s.name === 'health') return this.renderHealth(s.a);
    if (s.name === 'improved') return this.renderImproved(s.a);
  }

  private renderAnalyzing(): void {
    this.panel.setAttribute('aria-busy', 'true');
    this.body.innerHTML = `<ul class="steps" role="status" aria-live="polite">${STEPS.map(
      (t, i) => `<li data-i="${i}"><span class="mark">${i === 0 ? '✓' : '·'}</span><span>${esc(t)}</span></li>`,
    ).join('')}</ul>`;
    this.foot.innerHTML = `<span class="muted grow">Analyzing on ${esc(this.hooks.platform)}…</span>
      <button class="btn cancel" type="button">Cancel</button>`;
    this.foot.querySelector('.cancel')!.addEventListener('click', () => this.close());

    // Progressive ticks are honest here: they mark elapsed stages of one request,
    // not fabricated per-step results, and they stop at the last step.
    let i = 0;
    const items = [...this.body.querySelectorAll<HTMLElement>('.steps li')];
    items[0]?.classList.add('done');
    this.stepTimer = setInterval(() => {
      i++;
      const li = items[i];
      if (!li) return clearInterval(this.stepTimer);
      li.classList.add('done');
      li.querySelector('.mark')!.textContent = '✓';
    }, 550) as unknown as number;
  }

  private renderSecrets(prompt: string, hits: { label: string; preview: string }[]): void {
    this.body.innerHTML = `<div class="notice warn">
      <h4>Possible secrets in this prompt</h4>
      <div class="muted">Nothing has left your browser yet. Analyzing sends this prompt to your configured AI
      provider. Found:</div>
      <ul style="margin:7px 0 0;padding-left:16px">${hits
        .map((h) => `<li>${esc(h.label)} — <code>${esc(h.preview)}</code></li>`)
        .join('')}</ul></div>`;
    this.foot.innerHTML = `<div class="grow"></div>
      <button class="btn cancel" type="button">Cancel</button>
      <button class="btn primary go" type="button">Analyze anyway</button>`;
    this.foot.querySelector('.cancel')!.addEventListener('click', () => this.close());
    this.foot.querySelector('.go')!.addEventListener('click', () => this.run(prompt));
  }

  private renderError(message: string, settings: boolean): void {
    this.body.innerHTML = `<div class="notice bad"><h4>Can't analyze right now</h4>
      <div class="muted">${esc(message)}</div></div>`;
    this.foot.innerHTML = `<div class="grow"></div>
      ${settings ? '<button class="btn primary settings2" type="button">Open settings</button>' : '<button class="btn primary retry" type="button">Try again</button>'}
      <button class="btn cancel" type="button">Close</button>`;
    this.foot.querySelector('.cancel')!.addEventListener('click', () => this.close());
    this.foot.querySelector('.settings2')?.addEventListener('click', () => this.hooks.openSettings());
    this.foot.querySelector('.retry')?.addEventListener('click', () => this.start());
  }

  private ring(score: number): string {
    const color = score >= 85 ? 'var(--pc-ok)' : score >= 70 ? 'var(--pc-ok)' : score >= 50 ? 'var(--pc-warn)' : 'var(--pc-bad)';
    const c = 2 * Math.PI * 20;
    return `<svg class="ring" width="52" height="52" viewBox="0 0 52 52" role="img" aria-label="Prompt health ${score} out of 100">
      <circle cx="26" cy="26" r="20" fill="none" stroke="var(--pc-line)" stroke-width="5"/>
      <circle cx="26" cy="26" r="20" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
        stroke-dasharray="${(c * score) / 100} ${c}" transform="rotate(-90 26 26)"/>
      <text x="26" y="31" text-anchor="middle">${score}</text></svg>`;
  }

  private renderHealth(a: ScoredAnalysis): void {
    const dims = visibleDimensions(a.dimensions);
    const mark = { missing: '✕', weak: '!', ok: '✓' } as const;
    const questions = a.clarifyingQuestions;

    this.body.innerHTML = `
      <div class="score">
        ${this.ring(a.score)}
        <div>
          <div class="band">${esc(BAND_LABEL[a.band])}<span class="tag">${esc(a.taskType.replace(/_/g, ' '))}</span></div>
          ${a.intent ? `<div class="intent">${esc(a.intent)}</div>` : ''}
        </div>
      </div>
      ${
        dims.length
          ? `<ul class="dims">${dims
              .map(
                (d) => `<li class="${d.status}"><span class="mark">${mark[d.status]}</span>
                  <span><span class="name">${esc(DIM_LABEL[d.id])}</span>${d.note ? ` — <span class="note">${esc(d.note)}</span>` : ''}</span></li>`,
              )
              .join('')}</ul>`
          : `<div class="muted">Nothing worth flagging — this prompt is already clear for what you are asking.</div>`
      }
      ${
        questions.length
          ? `<div class="section"><h3>Answer these for a sharper prompt (optional)</h3>
              ${questions
                .map(
                  (q) => `<div class="q" data-q="${esc(q.id)}"><p>${esc(q.question)}</p>
                    <div class="opts">${q.options
                      .map((o) => `<button class="chip" type="button" aria-pressed="false" data-v="${esc(o)}">${esc(o)}</button>`)
                      .join('')}</div></div>`,
                )
                .join('')}</div>`
          : ''
      }`;

    const modeSel = MODES.map(
      (m) => `<option value="${m}"${m === this.mode ? ' selected' : ''}>${MODE_LABEL[m]}</option>`,
    ).join('');
    this.foot.innerHTML = `<select class="modesel" aria-label="Improvement mode">${modeSel}</select>
      <div class="grow"></div>
      ${questions.length ? '<button class="btn refine" type="button" disabled>Refine with answers</button>' : ''}
      <button class="btn primary next" type="button">${a.alreadyStrong ? 'View prompt' : 'See improved prompt'}</button>`;

    const answers: Record<string, string> = {};
    this.body.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.closest<HTMLElement>('.q')!;
        q.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        chip.setAttribute('aria-pressed', 'true');
        answers[q.dataset.q!] = chip.dataset.v!;
        const refine = this.foot.querySelector<HTMLButtonElement>('.refine');
        if (refine) refine.disabled = false;
      });
    });

    this.foot.querySelector<HTMLSelectElement>('.modesel')!.addEventListener('change', (e) => {
      this.mode = (e.target as HTMLSelectElement).value as Mode;
      this.run(this.hooks.getPrompt().trim());
    });
    this.foot.querySelector('.next')!.addEventListener('click', () => this.set({ name: 'improved', a }));
    this.foot.querySelector('.refine')?.addEventListener('click', () => {
      const pairs = questions
        .filter((q) => answers[q.id])
        .map((q) => ({ question: q.question, answer: answers[q.id]! }));
      this.run(this.hooks.getPrompt().trim(), pairs);
    });
  }

  private renderImproved(a: ScoredAnalysis): void {
    this.body.innerHTML = `
      <textarea class="preview" spellcheck="false" aria-label="Improved prompt">${esc(a.improvedPrompt)}</textarea>
      <div class="section"><h3>${a.alreadyStrong ? 'Your prompt was already strong' : 'Why this is better'}</h3>
        ${
          a.changes.length
            ? `<ul class="dims">${a.changes
                .map((c) => `<li class="ok"><span class="mark">✓</span><span>${esc(c)}</span></li>`)
                .join('')}</ul>`
            : `<div class="muted">No substantive changes were needed.</div>`
        }
      </div>`;
    // No "Back" when the health card is switched off — there is nothing behind this.
    this.foot.innerHTML = `${this.hooks.showHealth ? '<button class="btn back" type="button">Back</button>' : ''}
      <div class="grow"></div>
      <button class="btn copy" type="button">Copy</button>
      <button class="btn primary use" type="button">Use this prompt</button>`;

    const ta = this.body.querySelector<HTMLTextAreaElement>('.preview')!;
    this.foot.querySelector('.back')?.addEventListener('click', () => this.set({ name: 'health', a }));
    this.foot.querySelector('.copy')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(ta.value);
        btn.textContent = 'Copied';
      } catch {
        ta.select();
        btn.textContent = document.execCommand('copy') ? 'Copied' : 'Press ⌘C';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1400);
    });
    this.foot.querySelector('.use')!.addEventListener('click', () => {
      if (this.hooks.applyPrompt(ta.value)) return this.close();
      this.set({
        name: 'error',
        message:
          "Couldn't write into this site's input box — it may have changed. Your prompt is on the clipboard instead; paste it manually.",
        settings: false,
      });
      navigator.clipboard.writeText(ta.value).catch(() => {});
    });
    ta.focus();
  }
}
