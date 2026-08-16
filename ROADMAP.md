# Roadmap

## Shipped (v0.1 MVP)

Six platforms · resilient detection · overlay ✨ button · prompt health with intent-aware scoring ·
task classification · clarifying questions · five improvement modes · improved-prompt preview with
edit/copy/apply · "why this is better" · local secret scanning · four providers incl. local models ·
opt-in local history · settings · typed error handling · 39 unit tests.

## Next — earns its place

**Real-site regression checks.** The one thing that will break this product is a DOM change on a
site nobody tested that week. A scripted check per platform beats every feature below it.

**An eval set for the brief.** ~20 prompts with expected behaviour (short factual → unchanged;
vague → asks; already-good → minimal diff). Without it, edits to `brief.ts` are guesswork, and
quality regressions ship silently.

**Diff view.** Original vs improved, word-level. Cheap, and it makes "why this is better" verifiable
instead of asserted.

**Undo.** Restore the original prompt after applying. Currently the original is gone once you click
Use.

**Streaming.** The improved prompt appears token by token instead of after a 3–6 s wait. Meaningful
perceived-latency win for the single most-used path.

## Later — plausible, not yet justified

- **Templates / prompt library.** Only once there is evidence people re-run prompts, otherwise it is
  a folder nobody opens.
- **Model-specific optimisation.** Real (Claude and GPT reward different structures), but needs
  evidence per target before it is more than a system-brief line.
- **Custom rules.** `customInstructions` already covers the 80% case as free text. Structured rules
  when free text demonstrably is not enough.
- **A/B comparison.** Run both prompts, compare answers. Genuinely useful, 2× cost, needs a
  cost-conscious UI.
- **Firefox / Edge.** MV3 is close enough that the port is mostly manifest work.

## Only with a business reason

- **Hosted backend + free tier.** The moment you want users without an API key. Read the trade-off
  table in [ARCHITECTURE.md](ARCHITECTURE.md) first: it moves every prompt through servers you
  operate and inverts the product's privacy promise. Do it with a published retention policy and a
  BYOK mode that stays direct, or not at all.
- **Teams / shared libraries / enterprise policy.** Needs accounts, which needs the backend.
- **Analytics.** Would require asking, and the honest version (aggregate counts, no prompt content)
  answers few questions worth the trust cost. Aggregate score distributions might justify it; prompt
  text never will.

## Explicitly not doing

- **Auto-improving prompts without approval.** The user stays in control. This is the product.
- **Scoring against a fixed checklist.** Short prompts scoring badly for missing an "audience" they
  never needed is the failure mode this whole design exists to avoid.
- **`<all_urls>`.** Six sites, added one at a time.
- **Sending prompts anywhere the user did not choose.**
