export type FoundryDeployment = {
  alias: "gpt-5.5" | "opus-4.5";
  deploymentName: string;
  contextWindow: number;
  outputCap: number;
  format: "responses" | "chat-completions";
  family: "openai" | "anthropic";
};

const ENDPOINT = process.env.AZURE_FOUNDRY_ENDPOINT?.trim() || "";

export function foundryBaseUrl(): string {
  if (!ENDPOINT) throw new Error("AZURE_FOUNDRY_ENDPOINT is not set.");
  return ENDPOINT.replace(/\/+$/, "") + "/openai/v1";
}

export const FOUNDRY_DEPLOYMENTS: Record<string, FoundryDeployment> = {
  "gpt-5.5": {
    alias: "gpt-5.5",
    deploymentName: process.env.AZURE_FOUNDRY_GPT55_DEPLOYMENT?.trim() || "gpt-5.5",
    contextWindow: 400_000,
    outputCap: 16_384,
    format: "responses",
    family: "openai",
  },
  "opus-4.5": {
    alias: "opus-4.5",
    deploymentName: process.env.AZURE_FOUNDRY_OPUS_DEPLOYMENT?.trim() || "claude-opus-4-5",
    contextWindow: 200_000,
    outputCap: 8_192,
    format: "chat-completions",
    family: "anthropic",
  },
};

export function resolveDeployment(alias: string): FoundryDeployment {
  const dep = FOUNDRY_DEPLOYMENTS[alias];
  if (!dep) {
    throw new Error(
      `Unknown Foundry deployment alias '${alias}'. Valid: ${Object.keys(FOUNDRY_DEPLOYMENTS).join(", ")}`
    );
  }
  return dep;
}
