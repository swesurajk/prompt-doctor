import {
  DIMENSIONS,
  TASK_TYPES,
  type Analysis,
  type Band,
  type DimensionVerdict,
  type ScoredAnalysis,
  type TaskType,
} from './types.ts';

/**
 * Scoring is done here, in deterministic code, NOT by the model.
 *
 * The model's job is the subjective part it is actually good at: deciding
 * which dimensions matter for *this* prompt (relevance) and whether the prompt
 * clears the bar (status). Turning that into a number is arithmetic, and doing
 * it locally means the same verdicts always produce the same score, the score
 * can be explained line by line, and a model that likes round numbers can't
 * drift.
 *
 * Consequence that matters: dimensions marked not_applicable carry zero weight.
 * "What is a Java HashMap?" has no audience, no output format and no success
 * criteria, and still scores 100 — because none of those were ever relevant.
 * Quality is measured against intent, not against a checklist.
 */
const RELEVANCE_WEIGHT = { critical: 3, useful: 1, not_applicable: 0 } as const;
const STATUS_CREDIT = { ok: 1, weak: 0.5, missing: 0 } as const;

export function scoreDimensions(dimensions: DimensionVerdict[]): number {
  let earned = 0;
  let possible = 0;
  for (const d of dimensions) {
    const w = RELEVANCE_WEIGHT[d.relevance];
    if (!w) continue;
    possible += w;
    earned += w * STATUS_CREDIT[d.status];
  }
  if (possible === 0) return 100; // nothing was relevant: the prompt is fine as-is
  return Math.round((earned / possible) * 100);
}

/**
 * Bands are deliberately harsher than "60 = good". A prompt that misses a third
 * of what actually matters for its own task is not a good prompt.
 */
export function bandFor(score: number): Band {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'fair';
  return 'weak';
}

export const BAND_LABEL: Record<Band, string> = {
  excellent: 'Excellent prompt',
  strong: 'Strong prompt',
  fair: 'Needs work',
  weak: 'Weak prompt',
};

export function withScore(analysis: Analysis): ScoredAnalysis {
  const score = scoreDimensions(analysis.dimensions);
  return { ...analysis, score, band: bandFor(score) };
}

/** Dimensions worth showing: the relevant ones, problems first. */
export function visibleDimensions(dimensions: DimensionVerdict[]): DimensionVerdict[] {
  const rank = { missing: 0, weak: 1, ok: 2 } as const;
  return dimensions
    .filter((d) => d.relevance !== 'not_applicable')
    .sort((a, b) => rank[a.status] - rank[b.status] || RELEVANCE_WEIGHT[b.relevance] - RELEVANCE_WEIGHT[a.relevance]);
}

/* ------------------------------------------------------------------ */
/* Local pre-flight: runs before anything leaves the browser.          */
/* ------------------------------------------------------------------ */

export const MAX_PROMPT_CHARS = 24_000; // ≈6k tokens. Above this we ask, we don't truncate.
export const MIN_PROMPT_CHARS = 3;

export interface SecretHit {
  label: string;
  /** Redacted sample so the user can find it without us echoing the secret. */
  preview: string;
}

const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'OpenAI-style API key', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{16,}\b/g },
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { label: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { label: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

function redact(match: string): string {
  const head = match.slice(0, 6);
  return `${head}${'•'.repeat(Math.min(8, Math.max(3, match.length - 6)))}`;
}

/** Finds things you almost certainly did not mean to send to a third party. */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const seen = new Set<string>();
  for (const { label, re } of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (seen.has(label)) break;
      seen.add(label);
      hits.push({ label, preview: redact(m[0]) });
    }
  }
  // Card numbers: only flag if Luhn passes, otherwise every order id trips it.
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      hits.push({ label: 'Possible payment card number', preview: redact(digits) });
      break;
    }
  }
  return hits;
}

export type Precheck =
  | { ok: true; warnings: SecretHit[] }
  | { ok: false; code: 'prompt_empty' | 'prompt_too_long'; message: string };

export function precheck(prompt: string): Precheck {
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_PROMPT_CHARS) {
    return { ok: false, code: 'prompt_empty', message: 'Type a prompt first — there is nothing to analyze yet.' };
  }
  if (trimmed.length > MAX_PROMPT_CHARS) {
    const over = trimmed.length - MAX_PROMPT_CHARS;
    return {
      ok: false,
      code: 'prompt_too_long',
      message:
        `This prompt is ${trimmed.length.toLocaleString()} characters — ${over.toLocaleString()} over the limit. ` +
        `Prompt Copilot will not silently cut your text. Analyze the instruction part on its own, ` +
        `then paste the bulk data back in afterwards.`,
    };
  }
  return { ok: true, warnings: findSecrets(trimmed) };
}

/* ------------------------------------------------------------------ */
/* Validation of model output                                          */
/* ------------------------------------------------------------------ */

const TASK_SET = new Set<string>(TASK_TYPES);
const DIM_SET = new Set<string>(DIMENSIONS);

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Models drift. Rather than reject a response that is 95% right, coerce it into
 * the contract and drop what does not fit — but never invent an improved prompt.
 */
export function parseAnalysis(raw: unknown, originalPrompt: string): Analysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const improvedPrompt = str(o.improvedPrompt, 40_000);
  if (!improvedPrompt) return null;

  const taskType = (TASK_SET.has(String(o.taskType)) ? o.taskType : 'other') as TaskType;

  const seen = new Set<string>();
  const dimensions: DimensionVerdict[] = Array.isArray(o.dimensions)
    ? (o.dimensions as unknown[])
        .map((d) => {
          if (!d || typeof d !== 'object') return null;
          const e = d as Record<string, unknown>;
          const id = String(e.id);
          if (!DIM_SET.has(id) || seen.has(id)) return null;
          seen.add(id);
          const relevance =
            e.relevance === 'critical' || e.relevance === 'useful' ? e.relevance : 'not_applicable';
          const status = e.status === 'ok' || e.status === 'weak' ? e.status : 'missing';
          return { id, relevance, status, note: str(e.note, 160) } as DimensionVerdict;
        })
        .filter((d): d is DimensionVerdict => d !== null)
    : [];

  const clarifyingQuestions = Array.isArray(o.clarifyingQuestions)
    ? (o.clarifyingQuestions as unknown[])
        .slice(0, 3)
        .map((q, i) => {
          if (!q || typeof q !== 'object') return null;
          const e = q as Record<string, unknown>;
          const question = str(e.question, 160);
          if (!question) return null;
          const options = Array.isArray(e.options)
            ? (e.options as unknown[]).slice(0, 5).map((x) => str(x, 60)).filter(Boolean)
            : [];
          return { id: `q${i}`, question, options };
        })
        .filter((q): q is { id: string; question: string; options: string[] } => q !== null)
    : [];

  const changes = Array.isArray(o.changes)
    ? (o.changes as unknown[]).slice(0, 8).map((c) => str(c, 140)).filter(Boolean)
    : [];

  return {
    taskType,
    intent: str(o.intent, 200),
    dimensions,
    clarifyingQuestions,
    improvedPrompt,
    changes,
    // Trust the model's own "already strong" claim only if the score agrees.
    alreadyStrong: o.alreadyStrong === true || improvedPrompt.trim() === originalPrompt.trim(),
  };
}

/** Pulls a JSON object out of a model response that may be fenced or chatty. */
export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace scan */
  }
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
