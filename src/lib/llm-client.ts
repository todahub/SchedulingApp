import {
  resolveGeminiApiKey,
  resolveGeminiBaseUrl,
  resolveLlmModel,
  resolveLlmProvider,
  resolveOllamaBaseUrl,
  type LlmProvider,
} from "./runtime-environment";

export type StructuredLlmRequestOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type StructuredLlmRequestInput = {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
};

type GeminiJsonSchema = Record<string, unknown>;

export class StructuredLlmRequestError extends Error {
  constructor(
    message: string,
    readonly responseText: string | null = null,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "StructuredLlmRequestError";
  }
}

async function readResponseBodyAsText(response: Response) {
  const responseWithText = response as Response & {
    text?: () => Promise<string>;
  };

  if (typeof responseWithText.text === "function") {
    return await responseWithText.text();
  }

  const responseWithJson = response as Response & {
    json?: () => Promise<unknown>;
  };

  if (typeof responseWithJson.json === "function") {
    const payload = await responseWithJson.json();
    return JSON.stringify(payload);
  }

  throw new StructuredLlmRequestError("LLM response could not be read as text or JSON.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof StructuredLlmRequestError) {
    return error.statusCode !== null && [429, 500, 502, 503, 504].includes(error.statusCode);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  return /fetch failed|network|timed out|timeout|econnreset|socket hang up/i.test(error.message);
}

function getRetryDelayMs(error: unknown, attemptNumber: number) {
  if (error instanceof StructuredLlmRequestError) {
    if (error.statusCode === 429) {
      return 2_000 * attemptNumber;
    }

    if (error.statusCode === 503) {
      return 1_500 * attemptNumber;
    }

    if (error.statusCode !== null && [500, 502, 504].includes(error.statusCode)) {
      return 1_000 * attemptNumber;
    }
  }

  return 750 * attemptNumber;
}

function normalizeGeminiSchemaType(type: unknown) {
  if (Array.isArray(type)) {
    const normalized = [...new Set(type.filter((entry): entry is string => typeof entry === "string"))];
    return normalized.length === 1 ? normalized[0] : normalized;
  }

  return type;
}

function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => sanitizeSchemaForGemini(entry));
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const record = schema as Record<string, unknown>;
  const oneOf = Array.isArray(record.oneOf) ? record.oneOf : null;

  if (oneOf && oneOf.length > 0) {
    const sanitizedVariants = oneOf.map((variant) => sanitizeSchemaForGemini(variant)).filter(Boolean) as GeminiJsonSchema[];
    const typeValues = [
      ...new Set(
        sanitizedVariants.flatMap((variant) => {
          const candidateType = variant.type;
          return Array.isArray(candidateType)
            ? candidateType.filter((entry): entry is string => typeof entry === "string")
            : typeof candidateType === "string"
              ? [candidateType]
              : [];
        }),
      ),
    ];
    const enumValues = sanitizedVariants.flatMap((variant) =>
      Array.isArray(variant.enum) ? variant.enum : variant.type === "null" ? [null] : [],
    );

    return {
      ...(typeValues.length > 0
        ? {
            type: typeValues.length === 1 ? typeValues[0] : typeValues,
          }
        : {}),
      ...(enumValues.length > 0 ? { enum: [...new Set(enumValues)] } : {}),
      ...(typeof record.description === "string" ? { description: record.description } : {}),
    };
  }

  const sanitized: GeminiJsonSchema = {};

  if (record.type !== undefined) {
    sanitized.type = normalizeGeminiSchemaType(record.type);
  }
  if (typeof record.description === "string") {
    sanitized.description = record.description;
  }
  if (Array.isArray(record.enum)) {
    sanitized.enum = record.enum;
  }
  if (record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)) {
    sanitized.properties = Object.fromEntries(
      Object.entries(record.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        sanitizeSchemaForGemini(value),
      ]),
    );
  }
  if (Array.isArray(record.required)) {
    sanitized.required = record.required;
  }
  if (record.items !== undefined) {
    sanitized.items = sanitizeSchemaForGemini(record.items);
  }

  return sanitized;
}

async function requestStructuredJsonFromOllama(
  options: StructuredLlmRequestOptions,
  input: StructuredLlmRequestInput,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = resolveOllamaBaseUrl(options.baseUrl);
  const model = resolveLlmModel("ollama", options.model);
  const response = await fetchImpl(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: input.schema,
      options: {
        temperature: input.temperature ?? 0,
      },
      messages: [
        {
          role: "system",
          content: input.systemPrompt,
        },
        {
          role: "user",
          content: input.userPrompt,
        },
      ],
    }),
  });

  const responseText = await readResponseBodyAsText(response);
  let payload: {
    error?: string;
    message?: {
      content?: string;
    };
  };

  try {
    payload = JSON.parse(responseText) as {
      error?: string;
      message?: {
        content?: string;
      };
    };
  } catch {
    throw new StructuredLlmRequestError(
      `Ollama returned a non-JSON response: ${responseText.slice(0, 200)}`,
      responseText,
    );
  }

  if (!response.ok) {
    throw new StructuredLlmRequestError(
      payload.error ?? `Ollama request failed with status ${response.status}.`,
      responseText,
      response.status,
    );
  }

  const content = payload.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new StructuredLlmRequestError("Ollama response did not contain JSON content.", responseText);
  }

  return content.trim();
}

async function requestStructuredJsonFromGemini(
  options: StructuredLlmRequestOptions,
  input: StructuredLlmRequestInput,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = resolveGeminiBaseUrl(options.baseUrl);
  const apiKey = resolveGeminiApiKey(options.apiKey);
  const model = resolveLlmModel("gemini", options.model);
  const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: input.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: input.temperature ?? 0,
        responseMimeType: "application/json",
        responseJsonSchema: sanitizeSchemaForGemini(input.schema),
      },
    }),
  });

  const responseText = await readResponseBodyAsText(response);
  let payload: {
    error?: {
      message?: string;
    };
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  try {
    payload = JSON.parse(responseText) as {
      error?: {
        message?: string;
      };
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };
  } catch {
    throw new StructuredLlmRequestError(
      `Gemini returned a non-JSON response: ${responseText.slice(0, 200)}`,
      responseText,
    );
  }

  if (!response.ok) {
    throw new StructuredLlmRequestError(
      payload.error?.message ?? `Gemini request failed with status ${response.status}.`,
      responseText,
      response.status,
    );
  }

  const content =
    payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!content) {
    throw new StructuredLlmRequestError("Gemini response did not contain JSON content.", responseText);
  }

  return content;
}

export async function requestStructuredJsonFromLlm(
  options: StructuredLlmRequestOptions,
  input: StructuredLlmRequestInput,
) {
  const provider = resolveLlmProvider(options.provider);
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const wrappedFetch: typeof fetch = (resource, init) =>
      (options.fetchImpl ?? fetch)(resource, {
        ...init,
        signal: controller.signal,
      });

    try {
      const requestOptions = {
        ...options,
        fetchImpl: wrappedFetch,
      } satisfies StructuredLlmRequestOptions;

      return provider === "gemini"
        ? await requestStructuredJsonFromGemini(requestOptions, input)
        : await requestStructuredJsonFromOllama(requestOptions, input);
    } catch (error) {
      if (attemptNumber >= maxAttempts || !isRetryableRequestError(error)) {
        throw error;
      }

      await sleep(getRetryDelayMs(error, attemptNumber));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error("LLM request attempts exhausted unexpectedly.");
}
