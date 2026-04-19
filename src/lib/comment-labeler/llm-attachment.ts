import type { Label } from "./types";
import {
  ATTACHMENT_FEATURE_TYPES,
  ATTACHMENT_RELATION_TYPES,
  ATTACHMENT_UNRESOLVED_REASONS,
  buildAttachmentCandidatesFromLabeledComment,
  CLAUSE_RELATION_KINDS,
  PREFERENCE_MODE_VALUES,
  REASON_MODE_VALUES,
  UNCERTAINTY_MODE_VALUES,
  type AttachmentCandidate,
  type AttachmentResolutionAttachment,
  type AttachmentResolutionFeature,
  type AttachmentResolutionInput,
  type AttachmentResolutionOutput,
  type AttachmentResolutionUnresolved,
} from "./attachment-types";
import type { LabeledComment } from "./types";

export type AttachmentResolutionErrorStage = "request" | "parse" | "validate";

export type AttachmentResolutionResult = {
  input: AttachmentResolutionInput;
  output: AttachmentResolutionOutput | null;
  rawResponse: string | null;
  error:
    | {
        stage: AttachmentResolutionErrorStage;
        message: string;
      }
    | null;
};

export type AttachmentResolutionOllamaOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export class AttachmentResolutionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentResolutionParseError";
  }
}

export class AttachmentResolutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentResolutionValidationError";
  }
}

const ATTACHMENT_AVAILABILITY_SOURCE_LABELS = new Set<Label>([
  "availability_positive",
  "availability_negative",
  "availability_unknown",
]);

const ATTACHMENT_TARGET_LABELS = new Set<Label>([
  "target_date",
  "target_date_range",
  "target_weekday",
  "target_weekday_group",
  "target_relative_period",
  "target_month_part",
  "target_week_ordinal",
  "target_time_of_day",
  "target_holiday_related",
]);

const ATTACHMENT_MODIFIER_SOURCE_LABELS = new Set<Label>([
  "uncertainty_marker",
  "conditional_marker",
  "hypothetical_marker",
  "negation_marker",
  "strength_marker",
  "weak_commitment_marker",
]);

const ATTACHMENT_REASON_SOURCE_LABELS = new Set<Label>(["reason_marker"]);

const ATTACHMENT_PREFERENCE_SOURCE_LABELS = new Set<Label>([
  "preference_positive_marker",
  "preference_negative_marker",
  "comparison_marker",
]);

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const trimmed = typeof baseUrl === "string" && baseUrl.trim().length > 0 ? baseUrl.trim() : "http://127.0.0.1:11434/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function toAttachmentResolutionInput(
  comment: string,
  candidates: AttachmentCandidate[],
): AttachmentResolutionInput {
  return {
    comment,
    candidates: [...candidates].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id)),
  };
}

export function toAttachmentResolutionInputFromLabeledComment(labeledComment: LabeledComment): AttachmentResolutionInput {
  return {
    comment: labeledComment.originalText,
    candidates: buildAttachmentCandidatesFromLabeledComment(labeledComment),
  };
}

const ATTACHMENT_SYSTEM_PROMPT = [
  "あなたの役割は、元のコメント文と候補一覧を見て、候補どうしの係り受けだけを JSON で返すことです。",
  "新しい日付、新しい可否、新しい理由、新しい希望を作ってはいけません。",
  "候補一覧に存在しない id を参照してはいけません。",
  "候補一覧に存在しない target / availability / reason / preference を作ってはいけません。",
  "金曜を具体的な日付に変換してはいけません。",
  "可否の最終確定、希望順位の最終決定、ranking 用スコア化をしてはいけません。",
  "意味を完成させず、候補間の relation だけを返してください。",
  "わからない場合は invent せず unresolved に落としてください。",
  "出力は JSON のみです。",
  "",
  "relation の意味:",
  "- availability_target: availability 系候補がどの target にかかるか",
  "- modifier_predicate: uncertainty / conditional / hypothetical / negation / strength / weak_commitment がどの predicate にかかるか",
  "- reason_predicate: reason_marker がどの predicate にかかるか",
  "- comparison_scope: 比較や条件付き選好のスコープ target 群",
  "- preference_target: 希望ラベルがどの target を向くか",
  "- clause_relation: clause 間の関係 (supplement / restriction / override / exception / residual)",
  "",
  "feature は補助情報のみです。意味を最終確定してはいけません。",
  "出力は JSON のみです。",
].join("\n");

export function buildAttachmentResolutionUserPrompt(input: AttachmentResolutionInput) {
  return [
    "元のコメントと候補一覧を見て、候補間の係り受け relation だけを返してください。",
    "候補にない id を参照してはいけません。",
    "候補にない解釈を作ってはいけません。",
    "JSON のみを返してください。",
    "",
    "入力:",
    JSON.stringify(input, null, 2),
    "",
    "出力形式:",
    '{ "attachments": [...], "features": [...], "unresolved": [...] }',
    "",
    "JSON のみを返してください。",
  ].join("\n");
}

export function buildAttachmentResolutionMessages(input: AttachmentResolutionInput) {
  return {
    systemPrompt: ATTACHMENT_SYSTEM_PROMPT,
    userPrompt: buildAttachmentResolutionUserPrompt(input),
  };
}

export function parseAttachmentResolutionResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  if (!trimmed) {
    throw new AttachmentResolutionParseError("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new AttachmentResolutionParseError("LLM response was not valid JSON.");
  }
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AttachmentResolutionValidationError(message);
  }
  return value as Record<string, unknown>;
}

function validateConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new AttachmentResolutionValidationError("confidence must be a finite number between 0 and 1.");
  }
  return value;
}

function candidateMap(input: AttachmentResolutionInput) {
  return new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
}

function validateCandidateId(map: Map<string, AttachmentCandidate>, id: unknown, fieldName: string) {
  if (typeof id !== "string" || !map.has(id)) {
    throw new AttachmentResolutionValidationError(`${fieldName} must reference an existing candidate id.`);
  }
  return id;
}

function validateTargetIds(map: Map<string, AttachmentCandidate>, targetIds: unknown) {
  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    throw new AttachmentResolutionValidationError("targetIds must be a non-empty array.");
  }

  const seen = new Set<string>();
  return targetIds.map((targetId) => {
    const validated = validateCandidateId(map, targetId, "targetIds");
    if (seen.has(validated)) {
      throw new AttachmentResolutionValidationError("targetIds must not contain duplicates.");
    }
    seen.add(validated);
    return validated;
  });
}

function validateAttachment(
  map: Map<string, AttachmentCandidate>,
  attachment: unknown,
): AttachmentResolutionAttachment {
  const record = assertObject(attachment, "Each attachment must be an object.");
  const type = record.type;

  if (typeof type !== "string" || !ATTACHMENT_RELATION_TYPES.includes(type as (typeof ATTACHMENT_RELATION_TYPES)[number])) {
    throw new AttachmentResolutionValidationError("attachment type is unsupported.");
  }

  switch (type) {
    case "availability_target": {
      const allowedKeys = new Set(["type", "sourceId", "targetId", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("availability_target contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetId = validateCandidateId(map, record.targetId, "targetId");
      const source = map.get(sourceId)!;
      const target = map.get(targetId)!;

      if (!ATTACHMENT_AVAILABILITY_SOURCE_LABELS.has(source.label)) {
        throw new AttachmentResolutionValidationError("availability_target source must be an availability candidate.");
      }
      if (!ATTACHMENT_TARGET_LABELS.has(target.label)) {
        throw new AttachmentResolutionValidationError("availability_target target must be a target candidate.");
      }

      return {
        type,
        sourceId,
        targetId,
        confidence: validateConfidence(record.confidence),
      };
    }
    case "modifier_predicate": {
      const allowedKeys = new Set(["type", "sourceId", "targetId", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("modifier_predicate contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetId = validateCandidateId(map, record.targetId, "targetId");
      const source = map.get(sourceId)!;

      if (!ATTACHMENT_MODIFIER_SOURCE_LABELS.has(source.label)) {
        throw new AttachmentResolutionValidationError("modifier_predicate source must be a modifier candidate.");
      }

      return {
        type,
        sourceId,
        targetId,
        confidence: validateConfidence(record.confidence),
      };
    }
    case "reason_predicate": {
      const allowedKeys = new Set(["type", "sourceId", "targetId", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("reason_predicate contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetId = validateCandidateId(map, record.targetId, "targetId");
      const source = map.get(sourceId)!;

      if (!ATTACHMENT_REASON_SOURCE_LABELS.has(source.label)) {
        throw new AttachmentResolutionValidationError("reason_predicate source must be reason_marker.");
      }

      return {
        type,
        sourceId,
        targetId,
        confidence: validateConfidence(record.confidence),
      };
    }
    case "comparison_scope": {
      const allowedKeys = new Set(["type", "sourceId", "targetIds", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("comparison_scope contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetIds = validateTargetIds(map, record.targetIds);
      const source = map.get(sourceId)!;
      if (!ATTACHMENT_PREFERENCE_SOURCE_LABELS.has(source.label)) {
        throw new AttachmentResolutionValidationError("comparison_scope source must be a preference/comparison candidate.");
      }
      for (const targetId of targetIds) {
        const target = map.get(targetId)!;
        if (!ATTACHMENT_TARGET_LABELS.has(target.label)) {
          throw new AttachmentResolutionValidationError("comparison_scope targetIds must reference target candidates.");
        }
      }
      return {
        type,
        sourceId,
        targetIds,
        confidence: validateConfidence(record.confidence),
      };
    }
    case "preference_target": {
      const allowedKeys = new Set(["type", "sourceId", "targetId", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("preference_target contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetId = validateCandidateId(map, record.targetId, "targetId");
      const source = map.get(sourceId)!;
      const target = map.get(targetId)!;
      if (!ATTACHMENT_PREFERENCE_SOURCE_LABELS.has(source.label)) {
        throw new AttachmentResolutionValidationError("preference_target source must be a preference/comparison candidate.");
      }
      if (!ATTACHMENT_TARGET_LABELS.has(target.label)) {
        throw new AttachmentResolutionValidationError("preference_target target must be a target candidate.");
      }
      return {
        type,
        sourceId,
        targetId,
        confidence: validateConfidence(record.confidence),
      };
    }
    case "clause_relation": {
      const allowedKeys = new Set(["type", "sourceId", "targetId", "relationKind", "confidence"]);
      if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
        throw new AttachmentResolutionValidationError("clause_relation contains unsupported fields.");
      }
      const sourceId = validateCandidateId(map, record.sourceId, "sourceId");
      const targetId = validateCandidateId(map, record.targetId, "targetId");
      const relationKind = record.relationKind;
      if (
        typeof relationKind !== "string" ||
        !CLAUSE_RELATION_KINDS.includes(relationKind as (typeof CLAUSE_RELATION_KINDS)[number])
      ) {
        throw new AttachmentResolutionValidationError("clause_relation relationKind is unsupported.");
      }
      return {
        type,
        sourceId,
        targetId,
        relationKind,
        confidence: validateConfidence(record.confidence),
      };
    }
  }
}

function validateFeature(
  map: Map<string, AttachmentCandidate>,
  feature: unknown,
): AttachmentResolutionFeature {
  const record = assertObject(feature, "Each feature must be an object.");
  const allowedKeys = new Set(["type", "sourceId", "value"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new AttachmentResolutionValidationError("feature contains unsupported fields.");
  }
  const type = record.type;
  const sourceId = validateCandidateId(map, record.sourceId, "feature.sourceId");

  if (typeof type !== "string" || !ATTACHMENT_FEATURE_TYPES.includes(type as (typeof ATTACHMENT_FEATURE_TYPES)[number])) {
    throw new AttachmentResolutionValidationError("feature type is unsupported.");
  }

  switch (type) {
    case "preference_mode": {
      if (
        typeof record.value !== "string" ||
        !PREFERENCE_MODE_VALUES.includes(record.value as (typeof PREFERENCE_MODE_VALUES)[number])
      ) {
        throw new AttachmentResolutionValidationError("preference_mode value is unsupported.");
      }
      return { type, sourceId, value: record.value };
    }
    case "uncertainty_mode": {
      if (
        typeof record.value !== "string" ||
        !UNCERTAINTY_MODE_VALUES.includes(record.value as (typeof UNCERTAINTY_MODE_VALUES)[number])
      ) {
        throw new AttachmentResolutionValidationError("uncertainty_mode value is unsupported.");
      }
      return { type, sourceId, value: record.value };
    }
    case "reason_mode": {
      if (
        typeof record.value !== "string" ||
        !REASON_MODE_VALUES.includes(record.value as (typeof REASON_MODE_VALUES)[number])
      ) {
        throw new AttachmentResolutionValidationError("reason_mode value is unsupported.");
      }
      return { type, sourceId, value: record.value };
    }
  }
}

function validateUnresolved(
  map: Map<string, AttachmentCandidate>,
  unresolved: unknown,
): AttachmentResolutionUnresolved {
  const record = assertObject(unresolved, "Each unresolved item must be an object.");
  const allowedKeys = new Set(["sourceId", "reason"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new AttachmentResolutionValidationError("unresolved contains unsupported fields.");
  }
  const sourceId = validateCandidateId(map, record.sourceId, "unresolved.sourceId");
  const reason = record.reason;

  if (
    typeof reason !== "string" ||
    !ATTACHMENT_UNRESOLVED_REASONS.includes(reason as (typeof ATTACHMENT_UNRESOLVED_REASONS)[number])
  ) {
    throw new AttachmentResolutionValidationError("unresolved reason is unsupported.");
  }

  return {
    sourceId,
    reason,
  };
}

export function validateAttachmentResolutionOutput(
  parsed: unknown,
  input: AttachmentResolutionInput,
): AttachmentResolutionOutput {
  const record = assertObject(parsed, "Attachment resolution output must be a JSON object.");
  const keys = Object.keys(record);
  const allowedKeys = new Set(["attachments", "features", "unresolved"]);

  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new AttachmentResolutionValidationError("Attachment resolution output contains unsupported fields.");
  }

  if (!Array.isArray(record.attachments) || !Array.isArray(record.features) || !Array.isArray(record.unresolved)) {
    throw new AttachmentResolutionValidationError("attachments, features, and unresolved must all be arrays.");
  }

  const map = candidateMap(input);

  return {
    attachments: record.attachments.map((attachment) => validateAttachment(map, attachment)),
    features: record.features.map((feature) => validateFeature(map, feature)),
    unresolved: record.unresolved.map((item) => validateUnresolved(map, item)),
  };
}

function buildFallbackAttachmentResolutionResult(
  input: AttachmentResolutionInput,
  stage: AttachmentResolutionErrorStage,
  message: string,
  rawResponse: string | null,
): AttachmentResolutionResult {
  return {
    input,
    output: null,
    rawResponse,
    error: {
      stage,
      message,
    },
  };
}

export async function callOllamaForAttachmentResolution(
  input: AttachmentResolutionInput,
  options: AttachmentResolutionOllamaOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_BASE_URL);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const prompts = buildAttachmentResolutionMessages(input);
    const response = await fetchImpl(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          additionalProperties: false,
          properties: {
            attachments: {
              type: "array",
              items: {
                type: "object",
              },
            },
            features: {
              type: "array",
              items: {
                type: "object",
              },
            },
            unresolved: {
              type: "array",
              items: {
                type: "object",
              },
            },
          },
          required: ["attachments", "features", "unresolved"],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: "system",
            content: prompts.systemPrompt,
          },
          {
            role: "user",
            content: prompts.userPrompt,
          },
        ],
      }),
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveAttachmentsWithLlm(
  input: AttachmentResolutionInput,
  options: AttachmentResolutionOllamaOptions = {},
): Promise<AttachmentResolutionResult> {
  let rawResponse: string | null = null;

  try {
    rawResponse = await callOllamaForAttachmentResolution(input, options);
  } catch (error) {
    return buildFallbackAttachmentResolutionResult(
      input,
      "request",
      error instanceof Error ? error.message : "Failed to request attachment resolution from Ollama.",
      rawResponse,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseAttachmentResolutionResponse(rawResponse);
  } catch (error) {
    return buildFallbackAttachmentResolutionResult(
      input,
      "parse",
      error instanceof Error ? error.message : "Failed to parse attachment resolution response.",
      rawResponse,
    );
  }

  try {
    return {
      input,
      output: validateAttachmentResolutionOutput(parsed, input),
      rawResponse,
      error: null,
    };
  } catch (error) {
    return buildFallbackAttachmentResolutionResult(
      input,
      "validate",
      error instanceof Error ? error.message : "Attachment resolution response failed validation.",
      rawResponse,
    );
  }
}
