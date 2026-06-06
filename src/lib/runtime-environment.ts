import type { RepositoryMode } from "./domain";

export type LlmProvider = "ollama" | "gemini";

const DEFAULT_LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
const DEFAULT_OLLAMA_MODEL = "gpt-oss:20b";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

export function resolveLlmProvider(provider?: string): LlmProvider {
  const configuredProvider = provider?.trim() || process.env.LLM_PROVIDER?.trim();

  if (!configuredProvider) {
    return "ollama";
  }

  if (configuredProvider !== "ollama" && configuredProvider !== "gemini") {
    throw new Error("LLM_PROVIDER は ollama か gemini を指定してください。");
  }

  return configuredProvider;
}

export function resolveOllamaBaseUrl(baseUrl?: string) {
  const configuredBaseUrl = baseUrl?.trim() || process.env.OLLAMA_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    if (isProductionRuntime()) {
      throw new Error("本番環境では OLLAMA_BASE_URL を設定してください。");
    }

    return DEFAULT_LOCAL_OLLAMA_BASE_URL;
  }

  const normalized = configuredBaseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
}

export function resolveOllamaModel(model?: string) {
  return model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}

export function resolveGeminiBaseUrl(baseUrl?: string) {
  const configuredBaseUrl = baseUrl?.trim() || process.env.GEMINI_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return DEFAULT_GEMINI_BASE_URL;
  }

  return configuredBaseUrl.replace(/\/+$/u, "");
}

export function resolveGeminiModel(model?: string) {
  return model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
}

export function resolveGeminiApiKey(apiKey?: string) {
  const configuredApiKey = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim();

  if (!configuredApiKey) {
    throw new Error("Gemini を使うには GEMINI_API_KEY を設定してください。");
  }

  return configuredApiKey;
}

export function resolveLlmModel(provider?: LlmProvider, model?: string) {
  return provider === "gemini" ? resolveGeminiModel(model) : resolveOllamaModel(model);
}

export function resolveRepositoryMode(hasSupabaseConfig: boolean): RepositoryMode {
  const configuredMode = process.env.REPOSITORY_MODE?.trim();

  if (configuredMode) {
    if (configuredMode !== "demo" && configuredMode !== "supabase") {
      throw new Error("REPOSITORY_MODE は demo か supabase を指定してください。");
    }

    if (configuredMode === "demo") {
      if (isProductionRuntime()) {
        throw new Error("本番環境では REPOSITORY_MODE=demo を使用できません。");
      }

      return "demo";
    }

    if (!hasSupabaseConfig) {
      throw new Error("REPOSITORY_MODE=supabase を使うには SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。");
    }

    return "supabase";
  }

  if (hasSupabaseConfig) {
    return "supabase";
  }

  if (isProductionRuntime()) {
    throw new Error("本番環境では Supabase 環境変数を設定するか、REPOSITORY_MODE を明示してください。");
  }

  return "demo";
}
