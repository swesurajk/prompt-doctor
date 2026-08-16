/**
 * Live provider check + prompt-quality eval.
 *
 * This is the ONLY thing that exercises a real provider endpoint — the unit
 * tests and the browser testbed both use canned data. Run it after changing
 * `brief.ts` or `providers.ts`, and before any release.
 *
 *   PROMPT_DOCTOR_KEY=sk-... npm run eval                    # anthropic default
 *   PROMPT_DOCTOR_KEY=... npm run eval -- --provider openai --model gpt-4.1-mini
 *   ... npm run eval -- --provider custom --base-url http://localhost:11434/v1
 *   ... npm run eval -- --case short-factual                  # one case only
 *
 * Costs real money: ~14 small requests per full run.
 *
 * Assertions encode the product's central claim — quality is judged against
 * intent, not a checklist — so a regression that starts padding short prompts
 * fails here rather than in a user's face.
 */
import { callProvider, ProviderError } from '../src/shared/providers.ts';
import { buildUserBrief, SYSTEM_BRIEF } from '../src/shared/brief.ts';
import { extractJson, parseAnalysis, withScore } from '../src/shared/scoring.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const provider = flag('provider', 'anthropic');
const DEFAULT_MODEL = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1-mini',
  google: 'gemini-2.5-flash',
  custom: 'local',
};
const model = flag('model', DEFAULT_MODEL[provider] ?? 'claude-sonnet-4-5');
const baseUrl = flag('base-url', '');
const only = flag('case', '');
const apiKey = process.env.PROMPT_DOCTOR_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

if (!apiKey) {
  console.error('Set PROMPT_DOCTOR_KEY (or ANTHROPIC_API_KEY) in the environment.');
  process.exit(2);
}

const words = (s) => s.trim().split(/\s+/).length;

/**
 * Each case says what MUST hold. Deliberately loose on wording and tight on
 * behaviour — the point is catching "it started padding everything", not
 * pinning an exact sentence.
 */
const CASES = [
  {
    id: 'short-factual',
    mode: 'quick',
    prompt: 'What is a Java HashMap?',
    expect: (a) => [
      [a.score >= 85, `score ${a.score} — a clear factual question must not be marked down for missing an audience it never needed`],
      [words(a.improvedPrompt) <= words('What is a Java HashMap?') + 12, `improved prompt ballooned to ${words(a.improvedPrompt)} words`],
      [a.changes.length <= 2, `${a.changes.length} "improvements" invented for an already-fine prompt`],
      [a.dimensions.filter((d) => d.relevance !== 'not_applicable').length <= 6, 'too many dimensions judged relevant for a one-line question'],
    ],
  },
  {
    id: 'already-strong',
    mode: 'quick',
    prompt: [
      'Act as a senior Postgres DBA. Our orders table has 40M rows and this query takes 9s:',
      '',
      'SELECT * FROM orders WHERE customer_id = $1 AND created_at > now() - interval \'30 days\' ORDER BY created_at DESC LIMIT 50;',
      '',
      'Postgres 16, existing index: orders_pkey only. Give me: (1) the EXPLAIN issue you expect,',
      '(2) the exact CREATE INDEX statements, (3) the trade-off on write throughput.',
      'Assume no schema changes are possible.',
    ].join('\n'),
    expect: (a) => [
      [a.score >= 80, `score ${a.score} — this prompt already states role, versions, constraints and output structure`],
      [a.changes.length <= 3, `${a.changes.length} changes to an already-strong prompt`],
      [words(a.improvedPrompt) <= words(CASES[1].prompt) * 1.6, 'inflated an already-complete prompt'],
    ],
  },
  {
    id: 'vague-needs-question',
    mode: 'quick',
    prompt: 'Create a system design for my application.',
    expect: (a) => [
      [a.clarifyingQuestions.length >= 1, 'no clarifying question for a prompt with no application, no scale and no constraints'],
      [a.clarifyingQuestions.length <= 2, `${a.clarifyingQuestions.length} questions — capped at 2 by design`],
      [a.score < 60, `score ${a.score} is too generous for a prompt this underspecified`],
      [!/e-?commerce|banking|social media/i.test(a.improvedPrompt), 'invented a domain the user never mentioned'],
      [a.improvedPrompt.length > 0, 'must still return a best-effort prompt, never block on the question'],
    ],
  },
  {
    id: 'interview-notes',
    mode: 'interview',
    prompt: 'I have java notes from 10 years ago. I want you to check everything and tell me what is missing because I want to prepare for interviews.',
    expect: (a) => [
      [a.taskType === 'interview_prep' || a.taskType === 'learning', `classified as ${a.taskType}`],
      [a.score < 80, `score ${a.score} — scope and output format really are missing here`],
      [a.changes.length >= 2, 'should have found real gaps in this one'],
      [/note/i.test(a.improvedPrompt), 'dropped the user\'s own subject matter'],
    ],
  },
  {
    id: 'coding-with-stacktrace',
    mode: 'technical',
    prompt: [
      'my spring boot app throws this on startup, fix it',
      '',
      'org.springframework.beans.factory.UnsatisfiedDependencyException: Error creating bean with name \'orderController\'',
      'Caused by: NoSuchBeanDefinitionException: No qualifying bean of type \'com.acme.OrderRepository\'',
    ].join('\n'),
    expect: (a) => [
      [['debugging', 'coding'].includes(a.taskType), `classified as ${a.taskType}`],
      [a.improvedPrompt.includes('NoSuchBeanDefinitionException'), 'dropped the stack trace — the single most useful thing in the prompt'],
      [!/spring boot 3\.\d|java (17|21)/i.test(a.improvedPrompt) || /which|specify|version\?/i.test(a.improvedPrompt), 'invented a Spring Boot / Java version the user never gave'],
    ],
  },
  {
    id: 'secret-redaction',
    mode: 'quick',
    prompt: 'Write a curl command to test my API. My key is sk-live-9f8a7b6c5d4e3f2a1b0c9d8e and the endpoint is https://api.acme.internal/v1/orders.',
    expect: (a) => [
      [!a.improvedPrompt.includes('sk-live-9f8a7b6c5d4e3f2a1b0c9d8e'), 'echoed the API key back into the improved prompt'],
    ],
  },
  {
    id: 'non-english',
    mode: 'quick',
    prompt: 'Erkläre mir bitte, wie Garbage Collection in der JVM funktioniert. Ich bin Anfänger.',
    expect: (a) => [
      [/[äöüß]|und|die|der|mir|bitte/i.test(a.improvedPrompt), 'answered in English — the improved prompt must stay in the user\'s language'],
      [a.score >= 70, `score ${a.score} — audience and objective are both stated`],
    ],
  },
];

const RESET = '\x1b[0m';
const c = (code, s) => `${code}${s}${RESET}`;
const green = (s) => c('\x1b[32m', s);
const red = (s) => c('\x1b[31m', s);
const dim = (s) => c('\x1b[2m', s);

async function runCase(tc) {
  const t0 = Date.now();
  const text = await callProvider({
    provider,
    model,
    apiKey,
    baseUrl,
    system: SYSTEM_BRIEF,
    user: buildUserBrief({ type: 'analyze', prompt: tc.prompt, mode: tc.mode }, ''),
  });
  const parsed = parseAnalysis(extractJson(text), tc.prompt);
  if (!parsed) {
    return { id: tc.id, ms: Date.now() - t0, fatal: 'model returned unparseable output', raw: text.slice(0, 300) };
  }
  const a = withScore(parsed);
  const failures = tc.expect(a).filter(([ok]) => !ok).map(([, why]) => why);
  return { id: tc.id, ms: Date.now() - t0, a, failures };
}

const selected = only ? CASES.filter((t) => t.id === only) : CASES;
if (selected.length === 0) {
  console.error(`No case named "${only}". Known: ${CASES.map((t) => t.id).join(', ')}`);
  process.exit(2);
}

console.log(dim(`provider=${provider} model=${model} cases=${selected.length}\n`));

let failed = 0;
for (const tc of selected) {
  let r;
  try {
    r = await runCase(tc);
  } catch (e) {
    failed++;
    const how = e instanceof ProviderError ? `${e.code}: ${e.message}` : String(e);
    console.log(`${red('✕')} ${tc.id}\n  ${red(how)}\n`);
    continue;
  }

  if (r.fatal) {
    failed++;
    console.log(`${red('✕')} ${r.id} ${dim(`${r.ms}ms`)}\n  ${red(r.fatal)}\n  ${dim(r.raw)}\n`);
    continue;
  }

  const ok = r.failures.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? green('✓') : red('✕')} ${r.id} ${dim(`· ${r.a.score}/100 ${r.a.band} · ${r.a.taskType} · ${r.a.changes.length} changes · ${r.ms}ms`)}`,
  );
  for (const f of r.failures) console.log(`  ${red('→')} ${f}`);
  if (!ok || process.env.VERBOSE) {
    console.log(dim(`  improved: ${r.a.improvedPrompt.replace(/\n/g, ' ⏎ ').slice(0, 220)}…`));
  }
  console.log();
}

console.log(failed === 0 ? green(`all ${selected.length} cases passed`) : red(`${failed}/${selected.length} cases failed`));
process.exit(failed === 0 ? 0 : 1);
