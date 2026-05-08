import type { RepositoryMode } from "./domain";

const DEFAULT_LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434/api";
const DEFAULT_OLLAMA_MODEL = "gpt-oss:20b";

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
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
