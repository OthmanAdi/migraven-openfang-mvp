import { encode } from "gpt-tokenizer";
import { resolveDeployment, type FoundryDeployment } from "./models.js";

export type BudgetCheck = {
  ok: boolean;
  promptTokens: number;
  contextWindow: number;
  outputCap: number;
  headroom: number;
  recommendation?: string;
};

export function countPromptTokens(text: string): number {
  return encode(text).length;
}

export function preflightBudget(deploymentAlias: string, prompt: string): BudgetCheck {
  const dep: FoundryDeployment = resolveDeployment(deploymentAlias);
  const promptTokens = countPromptTokens(prompt);
  const reserved = dep.outputCap;
  const headroom = dep.contextWindow - promptTokens - reserved;
  if (headroom < 0) {
    return {
      ok: false,
      promptTokens,
      contextWindow: dep.contextWindow,
      outputCap: reserved,
      headroom,
      recommendation:
        `Prompt is ${promptTokens} tokens. Context window ${dep.contextWindow}, reserved ${reserved} for output. ` +
        `Need to drop ${-headroom} tokens or swap to a larger deployment.`,
    };
  }
  return {
    ok: true,
    promptTokens,
    contextWindow: dep.contextWindow,
    outputCap: reserved,
    headroom,
  };
}
