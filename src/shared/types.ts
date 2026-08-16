/** Shared contracts between content script, service worker and UI pages. */

export const TASK_TYPES = [
  'general_question',
  'research',
  'coding',
  'debugging',
  'code_review',
  'writing',
  'rewriting',
  'summarization',
  'analysis',
  'data_analysis',
  'learning',
  'interview_prep',
  'system_design',
  'creative',
  'planning',
  'decision_making',
  'other',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const DIMENSIONS = [
  'objective',
  'context',
  'specificity',
  'constraints',
  'output_format',
  'audience',
  'role',
  'scope',
  'examples',
  'technical_requirements',
  'success_criteria',
  'ambiguity',
  'completeness',
  'consistency',
  'efficiency',
] as const;
export type DimensionId = (typeof DIMENSIONS)[number];

/** How much this dimension matters *for this particular prompt*. */
export type Relevance = 'critical' | 'useful' | 'not_applicable';
/** Whether the prompt currently clears the bar for that dimension. */
export type Status = 'ok' | 'weak' | 'missing';

export interface DimensionVerdict {
  id: DimensionId;
  relevance: Relevance;
  status: Status;
  /** Short human sentence. Empty when relevance is not_applicable. */
  note: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  /** Suggested answers. May be empty — then it is free-text only. */
  options: string[];
}

export const MODES = ['quick', 'deep', 'technical', 'research', 'interview'] as const;
export type Mode = (typeof MODES)[number];

/** Raw model output (validated). Score is computed locally, not by the model. */
export interface Analysis {
  taskType: TaskType;
  /** One sentence: what the model believes the user is actually trying to do. */
  intent: string;
  dimensions: DimensionVerdict[];
  clarifyingQuestions: ClarifyingQuestion[];
  improvedPrompt: string;
  /** Why it is better. Empty array is legal when nothing needed changing. */
  changes: string[];
  alreadyStrong: boolean;
}

export type Band = 'excellent' | 'strong' | 'fair' | 'weak';

export interface ScoredAnalysis extends Analysis {
  score: number;
  band: Band;
}

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'custom';

export interface Settings {
  provider: ProviderId;
  model: string;
  /** Only used when provider === 'custom'. OpenAI-compatible /chat/completions. */
  customBaseUrl: string;
  defaultMode: Mode;
  showButton: boolean;
  showHealth: boolean;
  /** Opt-in, local-only. */
  historyEnabled: boolean;
  /** Extra instructions appended to the improvement brief. */
  customInstructions: string;
}

export interface HistoryEntry {
  at: number;
  taskType: TaskType;
  score: number;
  original: string;
  improved: string;
}

/* ---- messaging ---- */

export interface AnalyzeRequest {
  type: 'analyze';
  prompt: string;
  mode: Mode;
  /** Answers to clarifying questions from a previous round. */
  answers?: { question: string; answer: string }[];
  /** Host of the AI site the prompt was written on — used as a hint only. */
  platform?: string;
}

export type AnalyzeResponse =
  | { ok: true; analysis: ScoredAnalysis }
  | { ok: false; error: string; code: ErrorCode };

export type ErrorCode =
  | 'no_api_key'
  | 'bad_api_key'
  | 'rate_limited'
  | 'network'
  | 'provider_error'
  | 'malformed_response'
  | 'prompt_empty'
  | 'prompt_too_long'
  | 'aborted';
