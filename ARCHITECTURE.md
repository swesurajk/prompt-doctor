# Architecture

## The decisions that mattered

### 1. No backend for the MVP — bring your own key

The brief offered a Spring Boot backend in front of an AI provider abstraction. For v1 that is
infrastructure without a job.

| | BYOK, direct from the extension (**chosen**) | Hosted backend |
|---|---|---|
| Who pays inference | The user, their own account | You, per user, forever |
| Prompt exposure | User → their provider | User → **your servers** → provider |
| What you must operate | Nothing | API, secrets, rate limits, abuse handling, uptime |
| Time to working v1 | Hours | Weeks |
| Enables | Local models, custom endpoints | Free tier, shared limits, team features |

Privacy is the deciding argument, not effort. A backend makes the product's central promise —
"your prompts are between you and your provider" — impossible to keep. Every prompt would transit
a server you operate, which is exactly the data you least want custody of.

The seam is preserved: `src/shared/providers.ts` is the only file that knows how to talk to a
provider. A hosted tier is one more `case` there plus an auth token, not a rewrite. Ship it when
there is a paying reason to (free tier, teams, enterprise policy) — see [ROADMAP.md](ROADMAP.md).

### 2. The model judges; local code scores

The model returns *relevance* and *status* per dimension. The number is computed in
`src/shared/scoring.ts`. Models are good at "does this prompt need an output format?" and
unreliable at "is that 71 or 78?" — they drift, they like round numbers, and the same input gets
different totals on different days.

Deterministic scoring buys: identical verdicts → identical score, a score explainable line by line,
and a scoring model that can be tuned without touching a prompt or re-running evals.

### 3. One request per click, not two

The UI shows health first and the improved prompt second, but both come from a single call. Two
calls would double cost and latency for a flow where the user almost always continues. Clarifying
questions are returned in that same response; answering them is the only thing that costs a second
call.

### 4. No framework in the content script

The panel is ~10 KB of DOM code in a shadow root. React would add ~45 KB to a bundle that loads on
every page visit of six heavily-used sites, to render a card with six states. Options and popup are
plain TypeScript for the same reason. Total shipped: **25 KB content script**, 13 KB service worker.

### 5. Overlay, never injection

The ✨ button is not inserted into the site's DOM tree. It is a `position: fixed` element inside a
shadow root attached to `<html>`, positioned over the input's bounding rect and kept in place by a
`ResizeObserver` plus passive scroll/resize listeners.

This is what makes "does not break the website layout" true rather than hoped-for: the site's flex
and grid containers never see a new child, and `all: initial` on the shadow host plus closed-off
styling means neither side can affect the other.

It sits just **above** the input's top-right corner — empty space on all six sites, and structurally
incapable of covering a send button, which always lives inside or below the composer.

---

## Layout

```
src/
  shared/          # pure, testable, no DOM and no chrome.* except settings.ts
    types.ts       # the contract between all three contexts
    scoring.ts     # scoring · pre-flight (secrets, size) · response validation
    brief.ts       # the system brief — the actual product quality lives here
    providers.ts   # OpenAI / Anthropic / Google / OpenAI-compatible
    settings.ts    # storage access, key isolation
  background/      # service worker: the only holder of the API key
  content/
    adapters.ts    # prompt box detection · read · write-back
    panel.ts       # shadow-root UI state machine
    panel.css.ts   # inlined so no web_accessible_resources are needed
    index.ts       # detection lifecycle, observers, keyboard shortcut
  ui/              # options page + popup
tools/
  build.mjs        # esbuild, three configs
  make-icons.mjs   # PNG generation via node:zlib, no image dependency
  testbed/         # fake AI site for driving the content script locally
```

## Message flow

```
content script                service worker                provider
──────────────                ──────────────                ────────
click ✨
  precheck() locally
  secrets? → confirm
  sendMessage{analyze} ────▶  precheck() again (trust boundary)
                              getApiKey()        ◀── chrome.storage.local
                              buildUserBrief()
                              callProvider()     ────────────▶ one POST
                              extractJson()      ◀────────────
                              parseAnalysis()
                              withScore()
  ◀──────────────────────── {ok, analysis}
  render health → improved
  writePrompt() on approval
```

The content script never sees the API key, the provider URL, or the system brief. If a hostile page
compromised the content script, the worst it gets is the prompt the user typed on that page.

## Prompt box detection

Ranked scoring over every `textarea`, `[contenteditable]` and `[role="textbox"]`:

| Signal | Points |
|---|---|
| Matches a host hint selector | +60 |
| aria-label/placeholder matches `ask\|message\|prompt\|…` | +30 |
| In the bottom 45% of the viewport | +25 (+15 if bottom 20%) |
| Width | up to +25 |
| `role="textbox"` | +15 |
| `.ProseMirror` / `.ql-editor` | +20 |
| `<textarea>` | +10 |
| Looks like a search field | −20 |
| Small and near the top | −25 |

Floor of 20 points: below that it shows nothing rather than attaching to the wrong box. Host hints
only *add* points, so a rotted selector degrades to generic detection instead of breaking — there is
a test for exactly that.

Rescans are driven by a `MutationObserver` that only sets a flag (the scan runs once per idle tick),
a `focusin` listener, and a bounded 6-attempt retry ladder for composers that exist before they have
layout. No polling.

## Writing back

The two hard cases, both handled in `writePrompt`:

- **React-controlled `<textarea>`** — `el.value = x` is swallowed, because React caches the previous
  value on the node. Fix: the native `HTMLTextAreaElement.prototype.value` setter, then a bubbling
  `input` event so `onChange` runs.
- **ProseMirror / Quill / Lexical** — DOM writes are ignored; state lives in a document model. Fix:
  select all, then `document.execCommand('insertText')`, which routes through the browser's own
  editing pipeline and every one of these editors handles. Deprecated but universally supported;
  fallbacks are a synthetic `paste` with a `DataTransfer`, then a direct DOM write.

Every path returns a boolean, and the UI copies to the clipboard and says so if the write failed.

## Error handling

Typed `ErrorCode` from the worker, mapped to one sentence and one useful action in the panel:
`no_api_key`/`bad_api_key` → *Open settings*; `rate_limited`, `network`, `provider_error`,
`malformed_response` → *Try again*; `prompt_empty`, `prompt_too_long` → explains what to do.

Stale responses are dropped by request id when the user cancels, re-runs, or closes the panel.

## Long prompts

Hard limit 24,000 characters (≈6k tokens). Over it, the extension refuses and explains — it does not
truncate. Silently dropping half of someone's prompt and returning an "improved" version of the
remainder is worse than doing nothing.
