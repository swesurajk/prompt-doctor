# Privacy

Prompt Doctor reads what you type into AI chat boxes. That is about as sensitive as browser
extensions get, so the design starts from the data and works outwards.

## What leaves your browser

**Your prompt, when you click ✨ Improve, to the AI provider you configured. Nothing else, ever.**

- No backend. There is no Prompt Doctor server to send anything to.
- No analytics, no telemetry, no crash reporting, no remote config, no update pings.
- Nothing is sent on page load, on focus, or as you type. The button appearing costs zero requests.
- One click = exactly one request, to one host you chose.

## What is stored, and where

| Data | Where | Synced | Default |
|---|---|---|---|
| Settings (provider, model, mode, toggles) | `chrome.storage.sync` | yes | — |
| API key | `chrome.storage.local` | **no** | none |
| Improvement history | `chrome.storage.local` | **no** | **off** |
| Prompt content | nowhere, unless history is on | — | not stored |

Prompts are not logged, not cached, and not written to disk. They exist in memory for the duration
of one request.

## Your API key

- Held in `chrome.storage.local`, which never syncs to your Google account.
- Read **only** by the service worker. The content script — the part that runs alongside the AI
  site's own JavaScript — has no code path to it and never receives it in a message.
- Never placed in a URL, only in request headers.
- Removable individually ("Remove") or wholesale ("Clear all local data").

This split matters: a content script shares a tab with a third-party site. Keeping the key in the
worker means that even a compromised content script yields only the prompt the user just typed.

## Secret scanning, locally, before sending

Before any request, the prompt is scanned **in your browser** for OpenAI / Anthropic / Google / AWS /
GitHub / Slack credentials, bearer tokens, JWTs, private key blocks, and payment card numbers
(Luhn-checked to avoid flagging order numbers). If anything matches you get a warning naming the
type and a redacted preview, and the request does not go out until you confirm.

The scan is regex over local memory. It never sees the network. It is a safety net for accidents,
not a guarantee — it cannot recognise your customer list or an unreleased product name.

## History

Off by default. When you turn it on: last 50 entries, on this device only, never uploaded. The
settings page lists every stored entry with its score and date, and each one can be deleted
individually — a privacy toggle you cannot inspect is only a promise. "Clear all local data"
removes the lot along with your keys.

It is opt-in because the useful version of this feature is a searchable archive of everything you
have ever asked an AI, and that should never happen without a deliberate choice.

## Permissions

| Permission | Why | Why not more |
|---|---|---|
| `storage` | Settings and your key | — |
| `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` | The worker's provider calls | Only these three hosts |
| `optional_host_permissions` | Custom endpoints | Requested at the moment you save one, not up front |
| Content scripts on six AI sites | Finding the prompt box | Not `<all_urls>` — the extension is inert everywhere else |

No `tabs` (cannot enumerate your tabs), no `scripting` (cannot inject into arbitrary pages), no
`webRequest`, no `cookies`, no remote code — everything executed ships in the package.

## Third parties

Your chosen provider receives your prompt and applies **their** privacy policy, which may include
retention for abuse monitoring. Prompt Doctor cannot change that; it can only make sure that
transfer is deliberate, visible, and to a destination you picked. If that is not acceptable for
certain prompts, point the custom provider at a local model (Ollama, LM Studio) and nothing leaves
the machine at all.
