export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

/** USD per one million tokens, verified against OpenAI model pages on 2026-08-24. */
export const MODEL_TOKEN_RATES_USD = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
} as const;

export function estimateTokenCostUsd(model: string, usage: TokenUsage): number | null {
  const rates = MODEL_TOKEN_RATES_USD[model as keyof typeof MODEL_TOKEN_RATES_USD];
  if (!rates) return null;
  return (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / 1_000_000;
}
