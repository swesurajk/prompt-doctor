# Development

```bash
npm install
npm run build      # → dist/
npm run watch      # rebuild JS on save (re-run build after editing html/css/manifest)
npm test           # vitest
npm run typecheck
npm run check      # typecheck + test + build
```

Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**. After a rebuild, hit
reload on the extension card, then reload the AI site tab (content scripts do not hot-swap).

## The local testbed

Driving six real AI sites by hand for every change is slow and needs six logins. `tools/testbed/`
is a fake AI site that stubs `chrome.*` and returns a canned analysis, so `dist/content.js` runs as
a plain script:

```bash
npm run build && python3 -m http.server 8765
```

Open <http://localhost:8765/tools/testbed/index.html>. It covers the three composer shapes in the
wild — `contenteditable` ProseMirror (ChatGPT, Claude), plain `textarea` (Copilot, Grok), and Quill
`.ql-editor` (Gemini) — plus a "mount after 2s" toggle for the dynamic-DOM case, and a log pane
showing every message the content script sends and every `input` event the site receives.

It cannot verify the real sites' markup. Before a release, spot-check each one for real.

`?auto=health` / `?auto=improved` drive the panel to one state and stop, which is how the README
screenshots are produced — no mockups, the real UI:

```bash
npm run build && python3 -m http.server 8765 &
for s in health improved; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --window-size=1000,620 --virtual-time-budget=9000 \
    --screenshot="docs/panel-$s.png" "http://localhost:8765/tools/testbed/index.html?auto=$s"
done
```

`tools/testbed/options.html` does the same for the settings page: it renders `dist/options.html`
against an in-memory `chrome.storage` stub seeded with settings and history entries, so the
history list, per-entry delete and key masking can be checked without loading the extension.

## Live eval (`npm run eval`)

The only thing that touches a real provider. Unit tests and the testbed both use canned data, so
until this passes, nothing has proven that a request body, a response shape or an error code is
right.

```bash
PROMPT_DOCTOR_KEY=sk-ant-... npm run eval
PROMPT_DOCTOR_KEY=sk-...     npm run eval -- --provider openai --model gpt-4.1-mini
PROMPT_DOCTOR_KEY=...        npm run eval -- --provider google --model gemini-2.5-flash
PROMPT_DOCTOR_KEY=x          npm run eval -- --provider custom --base-url http://localhost:11434/v1
npm run eval -- --case short-factual      # one case
VERBOSE=1 npm run eval                    # print every improved prompt
```

Seven cases, ~7 small requests, a few cents. They assert **behaviour, not wording**:

| Case | Must hold |
|---|---|
| `short-factual` | "What is a Java HashMap?" scores ≥85 and comes back essentially unchanged |
| `already-strong` | A complete prompt scores ≥80 and gets ≤3 changes |
| `vague-needs-question` | Asks 1–2 questions, scores <60, invents no domain, still returns a prompt |
| `interview-notes` | Classified as interview/learning, finds real gaps, keeps the user's subject |
| `coding-with-stacktrace` | Keeps the stack trace, does not invent a version |
| `secret-redaction` | Never echoes the API key into the improved prompt |
| `non-english` | German in, German out |

If a change to `brief.ts` starts padding short prompts or inventing weaknesses, `short-factual` and
`already-strong` fail. That is the whole point.

`src/shared/*` uses `.ts` import specifiers so Node can run it directly via type stripping — no
build step for the eval. The one TS syntax Node cannot strip is `readonly` constructor parameter
properties; do not reintroduce them in `shared/`.

## ⚠️ Known verification gap

**Verified live:** the `openai` / `custom` path, against Groq
(`llama-3.3-70b-versatile`, `https://api.groq.com/openai/v1`). All 7 eval cases pass.

**Not verified live:** the `anthropic` and `google` paths. Both were repaired by inspection against
the published API contracts, never observed working. Two specific fixes are inferences, not
observations:

- **Google** — Gemini 2.5 models think by default and thinking tokens come out of
  `maxOutputTokens`; left alone the budget is spent before any text is emitted and the candidate
  returns `finishReason: MAX_TOKENS` with no `content.parts`. Mitigated with
  `thinkingConfig: { thinkingBudget: 0 }` on the flash tier (2.5-pro rejects a zero budget, so it
  gets 4× token headroom instead).
- **Anthropic** — the `{` assistant prefill. Note that prefill is rejected outright when extended
  thinking is enabled; `claude-sonnet-4-5` has it off by default, so the call should be accepted,
  but that is the first thing to check on a 400.

The response pickers for both are covered by fixture tests in `tests/providers.test.ts` against
recorded response bodies, including the empty-candidate shape. That proves the data handling, not
that the endpoint accepts the request body.

To close the gap, get a key and run:

```bash
PROMPT_DOCTOR_KEY=AIza... npm run eval -- --provider google --model gemini-2.5-flash
PROMPT_DOCTOR_KEY=sk-ant-... npm run eval
```

Google AI Studio (aistudio.google.com/apikey) has a free tier that covers a full 7-case run.
Delete this section once both are green.

## Tests

`tests/scoring.test.ts` — scoring weights and the not-applicable rule, bands, secret detection
(including Luhn and redaction), pre-flight, JSON extraction from chatty output, and response
validation against malformed model output.

`tests/adapters.test.ts` — detection against synthetic composers (jsdom has no layout, so each test
declares its own rects), search-box rejection, hint-selector precedence, hint-selector rot,
self-exclusion, and read/write round-trips including multiline, emoji and code.

Not covered by unit tests, verified in the testbed and by hand: panel state machine, positioning,
real provider responses.

## Adding a platform

1. `HOST_HINTS` in `src/content/adapters.ts` — regex, hint selectors, display name.
2. `content_scripts.matches` in `public/manifest.json`.
3. A detection test in `tests/adapters.test.ts`.

Hints are optional. If generic detection already finds the box, steps 1 and 3 are just insurance.

## Adding a provider

One `case` in `spec()` in `src/shared/providers.ts` (URL, headers, body, response picker), one entry
in `SUGGESTED_MODELS`, one `<option>` in `options.html`, and the API host in `host_permissions`.
Anything OpenAI-compatible needs none of this — users point the `custom` provider at it.

## Tuning analysis quality

`src/shared/brief.ts` is where prompt quality actually lives. When output regresses — padding short
prompts, inventing weaknesses, adding role-play nobody asked for — that file is the fix, not the UI.

Keep a handful of prompts on hand as an informal eval set, at minimum: a one-line factual question
(must score high and change nothing), a vague request (must ask a question), a code prompt with a
stack trace, and an already-excellent long prompt (must not be "improved").

## Release checklist

- [ ] `npm run check`
- [ ] Spot-check all six sites: button appears, does not cover the send button, writes back
- [ ] Bump `version` in `public/manifest.json`
- [ ] `cd dist && zip -r ../prompt-doctor-<version>.zip .`
