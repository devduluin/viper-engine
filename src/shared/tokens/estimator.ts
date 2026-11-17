// Provenance: ai-intent-api-v2/src/utils/token-estimator.utils.ts
// SHA-256 b53697f6049c9cca5c53cdde379898cfeea6cabab98754dc045e90f870876f8c (P02-03 extraction).
// Extracted TokenEstimator.estimate weighting only; model presets/message framing deferred.

export interface TextTokenFactors {
  /** Average characters per token; legacy default 3.5 for mixed Indonesian/English. */
  readonly charsPerToken: number;
  /** Average tokens per whitespace-separated word; legacy default 1.3. */
  readonly tokensPerWord: number;
}

/** Preflight approximation only; provider-reported usage remains authoritative. */
export interface TextTokenEstimate {
  readonly tokens: number;
  readonly approximate: true;
}

export const DEFAULT_TEXT_TOKEN_FACTORS: TextTokenFactors = Object.freeze({
  charsPerToken: 3.5,
  tokensPerWord: 1.3,
});

const LATIN_TEXT = /^[A-Za-z\s\d\p{P}]+$/u;

/**
 * Approximates tokens for plain text by blending character- and word-based counts.
 * Character length is UTF-16 code units, as in the legacy estimator. Does not price
 * media, structured content or provider message framing.
 */
export function estimateTextTokens(
  text: string,
  factors: Partial<TextTokenFactors> = {},
): TextTokenEstimate {
  if (typeof text !== 'string') throw new TypeError('Token estimation expects text');
  const resolved = resolveFactors(factors);
  if (text.length === 0) return estimate(0);
  const byChar = Math.ceil(text.length / resolved.charsPerToken);
  const byWord = Math.ceil(countWords(text) * resolved.tokensPerWord);
  const charWeight = LATIN_TEXT.test(text) ? 0.5 : 0.7;
  const blended = Math.ceil(byChar * charWeight + byWord * (1 - charWeight));
  return estimate(Math.max(1, blended));
}

function resolveFactors(factors: Partial<TextTokenFactors>): TextTokenFactors {
  const charsPerToken = factors.charsPerToken ?? DEFAULT_TEXT_TOKEN_FACTORS.charsPerToken;
  const tokensPerWord = factors.tokensPerWord ?? DEFAULT_TEXT_TOKEN_FACTORS.tokensPerWord;
  assertPositiveFactor('charsPerToken', charsPerToken);
  assertPositiveFactor('tokensPerWord', tokensPerWord);
  return { charsPerToken, tokensPerWord };
}

function assertPositiveFactor(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function estimate(tokens: number): TextTokenEstimate {
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new RangeError('Estimated token count exceeds the safe integer range');
  }
  return Object.freeze({ tokens, approximate: true });
}
