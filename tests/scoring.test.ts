import { describe, expect, it } from 'vitest';
import {
  bandFor,
  extractJson,
  findSecrets,
  parseAnalysis,
  precheck,
  scoreDimensions,
  visibleDimensions,
  MAX_PROMPT_CHARS,
} from '../src/shared/scoring.ts';
import type { DimensionVerdict } from '../src/shared/types.ts';

const dim = (
  id: DimensionVerdict['id'],
  relevance: DimensionVerdict['relevance'],
  status: DimensionVerdict['status'],
): DimensionVerdict => ({ id, relevance, status, note: '' });

describe('scoreDimensions', () => {
  it('ignores dimensions that do not apply to the prompt', () => {
    // "What is a Java HashMap?" — only the objective matters, and it is clear.
    const score = scoreDimensions([
      dim('objective', 'critical', 'ok'),
      dim('ambiguity', 'critical', 'ok'),
      dim('audience', 'not_applicable', 'missing'),
      dim('output_format', 'not_applicable', 'missing'),
      dim('success_criteria', 'not_applicable', 'missing'),
    ]);
    expect(score).toBe(100);
  });

  it('weights critical gaps three times heavier than useful ones', () => {
    const criticalMiss = scoreDimensions([dim('objective', 'critical', 'missing'), dim('role', 'useful', 'ok')]);
    const usefulMiss = scoreDimensions([dim('objective', 'critical', 'ok'), dim('role', 'useful', 'missing')]);
    expect(criticalMiss).toBe(25);
    expect(usefulMiss).toBe(75);
  });

  it('gives half credit for weak', () => {
    expect(scoreDimensions([dim('context', 'critical', 'weak')])).toBe(50);
  });

  it('returns 100 when nothing is relevant rather than dividing by zero', () => {
    expect(scoreDimensions([dim('role', 'not_applicable', 'missing')])).toBe(100);
    expect(scoreDimensions([])).toBe(100);
  });
});

describe('bandFor', () => {
  it('maps the boundaries', () => {
    expect(bandFor(100)).toBe('excellent');
    expect(bandFor(85)).toBe('excellent');
    expect(bandFor(84)).toBe('strong');
    expect(bandFor(70)).toBe('strong');
    expect(bandFor(69)).toBe('fair');
    expect(bandFor(50)).toBe('fair');
    expect(bandFor(49)).toBe('weak');
    expect(bandFor(0)).toBe('weak');
  });
});

describe('visibleDimensions', () => {
  it('hides non-applicable ones and puts problems first', () => {
    const out = visibleDimensions([
      dim('objective', 'critical', 'ok'),
      dim('role', 'not_applicable', 'missing'),
      dim('context', 'useful', 'weak'),
      dim('output_format', 'critical', 'missing'),
    ]);
    expect(out.map((d) => d.id)).toEqual(['output_format', 'context', 'objective']);
  });
});

describe('findSecrets', () => {
  it('flags provider keys and tokens', () => {
    const labels = findSecrets(
      'use sk-abcdefghijklmnop1234 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 plus AKIA1234567890ABCDEF',
    ).map((h) => h.label);
    expect(labels).toContain('OpenAI-style API key');
    expect(labels).toContain('GitHub token');
    expect(labels).toContain('AWS access key id');
  });

  it('reports an Anthropic key once, not also as an OpenAI key', () => {
    expect(findSecrets('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA').map((h) => h.label)).toEqual([
      'Anthropic API key',
    ]);
  });

  it('redacts rather than echoing the secret back', () => {
    const [hit] = findSecrets('key sk-abcdefghijklmnop1234');
    expect(hit!.preview).toBe('sk-abc••••••••');
    expect(hit!.preview).not.toContain('mnop1234');
  });

  it('flags a card number only when the checksum passes', () => {
    expect(findSecrets('card 4111111111111111')).toHaveLength(1);
    expect(findSecrets('order 4111111111111112')).toHaveLength(0);
    expect(findSecrets('invoice 1234567890123456789')).toHaveLength(0);
  });

  it('leaves ordinary prompts alone', () => {
    expect(findSecrets('Explain how Java HashMap resizing works, with an example.')).toEqual([]);
  });
});

describe('precheck', () => {
  it('rejects empty input', () => {
    expect(precheck('   ')).toMatchObject({ ok: false, code: 'prompt_empty' });
  });

  it('accepts a two-word prompt — short is not the same as bad', () => {
    expect(precheck('explain closures')).toMatchObject({ ok: true });
  });

  it('refuses oversized prompts instead of silently truncating them', () => {
    const res = precheck('x'.repeat(MAX_PROMPT_CHARS + 1));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/will not silently cut/i);
  });

  it('passes secrets through as warnings, not failures', () => {
    const res = precheck('deploy with sk-ant-abcdefghijklmnopqrst');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('handles emoji, multiline and non-English text', () => {
    expect(precheck('Erkläre mir Java HashMap 🚀\n\nmit Beispielen')).toMatchObject({ ok: true });
    expect(precheck('用中文解释 Java 的 HashMap')).toMatchObject({ ok: true });
  });
});

describe('extractJson', () => {
  it('parses plain json', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('finds the object inside chatty output', () => {
    expect(extractJson('Sure! Here you go:\n{"a":{"b":2}}\nHope that helps.')).toEqual({ a: { b: 2 } });
  });
  it('is not fooled by braces inside strings', () => {
    expect(extractJson('noise {"a":"}{"} tail')).toEqual({ a: '}{' });
  });
  it('returns null when there is no json', () => {
    expect(extractJson('sorry, I cannot')).toBeNull();
  });
});

describe('parseAnalysis', () => {
  const good = {
    taskType: 'coding',
    intent: 'Fix a null pointer',
    dimensions: [{ id: 'objective', relevance: 'critical', status: 'ok', note: 'clear' }],
    clarifyingQuestions: [{ question: 'Which Java version?', options: ['8', '17', '21'] }],
    improvedPrompt: 'Better prompt',
    changes: ['Added version'],
    alreadyStrong: false,
  };

  it('accepts a well formed response', () => {
    const a = parseAnalysis(good, 'orig')!;
    expect(a.taskType).toBe('coding');
    expect(a.improvedPrompt).toBe('Better prompt');
    expect(a.clarifyingQuestions[0]!.id).toBe('q0');
  });

  it('rejects a response with no improved prompt', () => {
    expect(parseAnalysis({ ...good, improvedPrompt: '' }, 'orig')).toBeNull();
    expect(parseAnalysis(null, 'orig')).toBeNull();
    expect(parseAnalysis('nope', 'orig')).toBeNull();
  });

  it('drops unknown dimensions and duplicates instead of failing', () => {
    const a = parseAnalysis(
      {
        ...good,
        dimensions: [
          { id: 'objective', relevance: 'critical', status: 'ok' },
          { id: 'objective', relevance: 'useful', status: 'weak' },
          { id: 'vibes', relevance: 'critical', status: 'ok' },
        ],
      },
      'orig',
    )!;
    expect(a.dimensions).toHaveLength(1);
  });

  it('falls back to safe values for junk enum fields', () => {
    const a = parseAnalysis(
      { ...good, taskType: 'astrology', dimensions: [{ id: 'context', relevance: 'x', status: 'y' }] },
      'orig',
    )!;
    expect(a.taskType).toBe('other');
    expect(a.dimensions[0]).toMatchObject({ relevance: 'not_applicable', status: 'missing' });
  });

  it('treats an unchanged prompt as already strong even if the model forgot to say so', () => {
    const a = parseAnalysis({ ...good, improvedPrompt: 'orig', alreadyStrong: false }, 'orig')!;
    expect(a.alreadyStrong).toBe(true);
  });

  it('caps runaway lists', () => {
    const a = parseAnalysis(
      { ...good, changes: Array(50).fill('x'), clarifyingQuestions: Array(9).fill({ question: 'q?', options: [] }) },
      'orig',
    )!;
    expect(a.changes.length).toBeLessThanOrEqual(8);
    expect(a.clarifyingQuestions.length).toBeLessThanOrEqual(3);
  });
});
