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
};

export type StructuredLlmRequestInput = {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
};

type GeminiJsonSchema = Record<string, unknown>;

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

  const payload = (await response.json()) as {
    error?: string;
    message?: {
      content?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error ?? `Ollama request failed with status ${response.status}.`);
  }

  const content = payload.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Ollama response did not contain JSON content.");
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

  const payload = (await response.json()) as {
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

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini request failed with status ${response.status}.`);
  }

  const content =
    payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!content) {
    throw new Error("Gemini response did not contain JSON content.");
  }

  return content;
}

export async function requestStructuredJsonFromLlm(
  options: StructuredLlmRequestOptions,
  input: StructuredLlmRequestInput,
) {
  const provider = resolveLlmProvider(options.provider);
  const timeoutMs = options.timeoutMs ?? 45_000;
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
      ? requestStructuredJsonFromGemini(requestOptions, input)
      : requestStructuredJsonFromOllama(requestOptions, input);
  } finally {
    clearTimeout(timeoutId);
  }
}
