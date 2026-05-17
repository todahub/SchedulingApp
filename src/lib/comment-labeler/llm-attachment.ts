import type { Label } from "./types";
import { requestStructuredJsonFromLlm } from "../llm-client";
import { StructuredLlmRequestError } from "../llm-client";
import type { LlmProvider } from "../runtime-environment";
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
  provider?: LlmProvider;
  apiKey?: string;
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
  "target_numeric_candidate",
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
  "emotion_weak_accept_marker",
]);

function classifyAttachmentCandidateIds(input: AttachmentResolutionInput) {
  const targetIds: string[] = [];
  const availabilityIds: string[] = [];
  const modifierIds: string[] = [];
  const reasonIds: string[] = [];
  const preferenceIds: string[] = [];
  const clauseIds: string[] = [];

  for (const candidate of input.candidates) {
    if (ATTACHMENT_TARGET_LABELS.has(candidate.label)) {
      targetIds.push(candidate.id);
      continue;
    }

    if (ATTACHMENT_AVAILABILITY_SOURCE_LABELS.has(candidate.label)) {
      availabilityIds.push(candidate.id);
      continue;
    }

    if (ATTACHMENT_MODIFIER_SOURCE_LABELS.has(candidate.label) || candidate.label === "particle_condition") {
      modifierIds.push(candidate.id);
      continue;
    }

    if (ATTACHMENT_REASON_SOURCE_LABELS.has(candidate.label)) {
      reasonIds.push(candidate.id);
      continue;
    }

    if (ATTACHMENT_PREFERENCE_SOURCE_LABELS.has(candidate.label)) {
      preferenceIds.push(candidate.id);
      continue;
    }

    clauseIds.push(candidate.id);
  }

  return {
    targetIds,
    availabilityIds,
    modifierIds,
    reasonIds,
    preferenceIds,
    clauseIds,
    allIds: input.candidates.map((candidate) => candidate.id),
  };
}

function buildSchemaStringField(enumValues: string[]) {
  return enumValues.length > 0
    ? {
        type: "string",
        enum: enumValues,
      }
    : {
        type: "string",
      };
}

function buildAttachmentResolutionSchema(input: AttachmentResolutionInput) {
  const candidateIds = classifyAttachmentCandidateIds(input);

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      availabilityAttachments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["availability_target"],
            },
            sourceId: buildSchemaStringField(candidateIds.availabilityIds),
            targetId: buildSchemaStringField(candidateIds.targetIds),
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetId", "confidence"],
        },
      },
      modifierAttachments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["modifier_predicate"],
            },
            sourceId: buildSchemaStringField(candidateIds.modifierIds),
            targetId: buildSchemaStringField(candidateIds.allIds),
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetId", "confidence"],
        },
      },
      reasonAttachments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["reason_predicate"],
            },
            sourceId: buildSchemaStringField(candidateIds.reasonIds),
            targetId: buildSchemaStringField(candidateIds.allIds),
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetId", "confidence"],
        },
      },
      comparisonScopes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["comparison_scope"],
            },
            sourceId: buildSchemaStringField(candidateIds.preferenceIds),
            targetIds: {
              type: "array",
              items: buildSchemaStringField(candidateIds.targetIds),
            },
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetIds", "confidence"],
        },
      },
      preferenceAttachments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["preference_target"],
            },
            sourceId: buildSchemaStringField(candidateIds.preferenceIds),
            targetId: buildSchemaStringField(candidateIds.targetIds),
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetId", "confidence"],
        },
      },
      clauseRelations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["clause_relation"],
            },
            sourceId: buildSchemaStringField(candidateIds.allIds),
            targetId: buildSchemaStringField(candidateIds.allIds),
            relationKind: {
              type: "string",
              enum: [...CLAUSE_RELATION_KINDS],
            },
            confidence: {
              type: "number",
            },
          },
          required: ["type", "sourceId", "targetId", "relationKind", "confidence"],
        },
      },
      features: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: [...ATTACHMENT_FEATURE_TYPES],
            },
            sourceId: buildSchemaStringField(candidateIds.allIds),
            value: {
              type: "string",
            },
          },
          required: ["type", "sourceId", "value"],
        },
      },
      unresolved: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceId: buildSchemaStringField(candidateIds.allIds),
            reason: {
              type: "string",
              enum: [...ATTACHMENT_UNRESOLVED_REASONS],
            },
          },
          required: ["sourceId", "reason"],
        },
      },
    },
    required: [
      "availabilityAttachments",
      "modifierAttachments",
      "reasonAttachments",
      "comparisonScopes",
      "preferenceAttachments",
      "clauseRelations",
      "features",
      "unresolved",
    ],
  } satisfies Record<string, unknown>;
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
  "あなたの役割は、元のコメント文と候補一覧を見て、候補どうしの係り受けだけを relation として JSON で返すことです。",
  "あなたは relation 抽出器であり、可否の最終確定、希望順位の最終決定、ranking 用スコア化をしてはいけません。",
  "",
  "優先順位:",
  "1. schema を守る。",
  "2. invent しない。",
  "3. わからなければ relation 配列を増やさず unresolved に落とす。",
  "",
  "禁止事項:",
  "- 新しい日付、新しい可否、新しい理由、新しい希望、新しい clause 関係を作ってはいけません。",
  "- 新しい日付、新しい可否、新しい理由、新しい希望を作ってはいけません。",
  "- 候補一覧に存在しない id を参照してはいけません。",
  "- 候補一覧に存在しない target / availability / reason / preference を作ってはいけません。",
  "- 金曜を具体的な日付に変換してはいけません。",
  "- comparison_target / condition_target / availability_relation / preference_scope / comparison_relation のような未定義 type を作ってはいけません。",
  "",
  "返してよい attachment type は availability_target / modifier_predicate / reason_predicate / comparison_scope / preference_target / clause_relation の6種類だけです。",
  "6種類以外の type を返してはいけません。1文字でも違う type を返してはいけません。",
  "attachment object には定義された key だけを入れてください。余計な key を1つでも入れてはいけません。",
  "同じ object 配列に混在させず、type ごとの専用配列に入れてください。",
  "",
  "type ごとの出力契約:",
  "- availabilityAttachments の各 item は {type, sourceId, targetId, confidence} だけです。",
  "- modifierAttachments の各 item は {type, sourceId, targetId, confidence} だけです。",
  "- reasonAttachments の各 item は {type, sourceId, targetId, confidence} だけです。",
  "- preferenceAttachments の各 item は {type, sourceId, targetId, confidence} だけです。",
  "- comparisonScopes の各 item は {type, sourceId, targetIds, confidence} だけです。targetIds は target 候補 id の非空配列です。",
  "- clauseRelations の各 item は {type, sourceId, targetId, relationKind, confidence} だけです。relationKind は supplement / restriction / override / exception / residual だけです。",
  "- unresolved の各 item は {sourceId, reason} だけです。sourceId は入力 candidate.id の1つ、reason は定義済み reason の1つです。",
  "- availabilityAttachments.sourceId は availability-* id だけ、targetId は target-* id だけです。",
  "- preferenceAttachments.sourceId と comparisonScopes.sourceId は preference-* id だけです。",
  "- modifierAttachments.sourceId は modifier-* id だけです。",
  "- reasonAttachments.sourceId は reason-* id だけです。",
  "",
  "relation の意味:",
  "- availability_target: availability 系候補がどの target にかかるか",
  "- modifier_predicate: uncertainty / conditional / hypothetical / negation / strength / weak_commitment がどの predicate にかかるか",
  "- reason_predicate: reason_marker がどの predicate にかかるか",
  "- comparison_scope: 比較や条件付き選択の候補集合 target 群",
  "- preference_target: 希望ラベルや弱い許容ラベルがどの target を向くか",
  "- clause_relation: clause 間の関係 (supplement / restriction / override / exception / residual)",
  "",
  "判断ルール:",
  "- comparison_scope は比較対象や条件付き選択の候補集合だけを返します。単独 target に comparison_scope を使ってはいけません。",
  "- 11と12なら12がいい: preference_target(がいい -> 後半の12) と comparison_scope(がいい -> 11と前半12) を別々に返してください。availability_target は返しません。",
  "- 11より12がいい: preference_target(がいい -> 12) と comparison_scope(比較 source -> 11と12) を返してよいですが、availability_target は返しません。",
  "- 11なら行ける: availability_target(行ける -> 11) と modifier_predicate(なら -> 行ける) を返し、comparison_scope / preference_target は返しません。",
  "- 意味を完成させず、候補間の relation だけを返してください。",
  "",
  "曖昧時の扱い:",
  "- 返答に迷ったら、無理に relation 配列を増やさず unresolved に落としてください。",
  "- unresolved item を作るのは、sourceId に使う candidate.id を1つ選べる時だけです。",
  "- sourceId を選べないなら unresolved item を作らず unresolved を空配列にしてください。",
  "- 空オブジェクト {} を unresolved に入れてはいけません。",
  "- schema に合わない attachment を返すくらいなら attachments を空にしてください。",
  "",
  "feature は補助情報のみです。意味を最終確定してはいけません。",
  "",
  "返答前に確認:",
  "- すべての item が正しい専用配列に入っているか。",
  "- すべての object に余計な key がないか。",
  "- sourceId / targetId / targetIds は入力候補 id だけを参照しているか。",
  "- comparison_scope を単独 target に使っていないか。",
  "",
  "出力は JSON のみです。",
].join("\n");

export function buildAttachmentResolutionUserPrompt(input: AttachmentResolutionInput) {
  const candidateIds = classifyAttachmentCandidateIds(input);

  return [
    "元のコメントと候補一覧を見て、候補間の係り受け relation だけを返してください。",
    "候補にない id を参照してはいけません。",
    "候補にない解釈を作ってはいけません。",
    "id は role を表しています。target-* は日付 target、availability-* は可否語、modifier-* は条件や強弱、reason-* は理由、preference-* は希望系です。",
    "item を入れる配列は type ごとに固定です。availability_target を preferenceAttachments に入れてはいけません。",
    'availabilityAttachments item: {"type":"availability_target","sourceId":"availability-0","targetId":"target-0","confidence":0.0}',
    'modifierAttachments item: {"type":"modifier_predicate","sourceId":"modifier-0","targetId":"availability-0","confidence":0.0}',
    'reasonAttachments item: {"type":"reason_predicate","sourceId":"reason-0","targetId":"availability-0","confidence":0.0}',
    'preferenceAttachments item: {"type":"preference_target","sourceId":"preference-0","targetId":"target-0","confidence":0.0}',
    'comparisonScopes item: {"type":"comparison_scope","sourceId":"preference-0","targetIds":["target-0","target-1"],"confidence":0.0}',
    'clauseRelations item: {"type":"clause_relation","sourceId":"availability-1","targetId":"availability-0","relationKind":"supplement","confidence":0.0}',
    'unresolved item: {"sourceId":"preference-0","reason":"ambiguous_clause_boundary"}',
    "comparison_scope は複数 target の候補集合にだけ使ってください。単独 target には使わないでください。",
    "sourceId を選べない unresolved item は作らないでください。{} を unresolved に入れてはいけません。",
  "不明なら relation 配列を増やさず unresolved に落としてください。",
    "JSON のみを返してください。",
    "",
    "利用可能な id 一覧:",
    `- target ids: ${JSON.stringify(candidateIds.targetIds)}`,
    `- availability ids: ${JSON.stringify(candidateIds.availabilityIds)}`,
    `- modifier ids: ${JSON.stringify(candidateIds.modifierIds)}`,
    `- reason ids: ${JSON.stringify(candidateIds.reasonIds)}`,
    `- preference ids: ${JSON.stringify(candidateIds.preferenceIds)}`,
    `- clause/other ids: ${JSON.stringify(candidateIds.clauseIds)}`,
    "",
    "入力:",
    JSON.stringify(input, null, 2),
    "",
    "出力形式:",
    '{ "availabilityAttachments": [...], "modifierAttachments": [...], "reasonAttachments": [...], "comparisonScopes": [...], "preferenceAttachments": [...], "clauseRelations": [...], "features": [...], "unresolved": [...] }',
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
      const validatedRelationKind = relationKind as (typeof CLAUSE_RELATION_KINDS)[number];
      return {
        type,
        sourceId,
        targetId,
        relationKind: validatedRelationKind,
        confidence: validateConfidence(record.confidence),
      };
    }
  }

  throw new AttachmentResolutionValidationError("attachment type is unsupported.");
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
      return { type, sourceId, value: record.value as (typeof PREFERENCE_MODE_VALUES)[number] };
    }
    case "uncertainty_mode": {
      if (
        typeof record.value !== "string" ||
        !UNCERTAINTY_MODE_VALUES.includes(record.value as (typeof UNCERTAINTY_MODE_VALUES)[number])
      ) {
        throw new AttachmentResolutionValidationError("uncertainty_mode value is unsupported.");
      }
      return { type, sourceId, value: record.value as (typeof UNCERTAINTY_MODE_VALUES)[number] };
    }
    case "reason_mode": {
      if (
        typeof record.value !== "string" ||
        !REASON_MODE_VALUES.includes(record.value as (typeof REASON_MODE_VALUES)[number])
      ) {
        throw new AttachmentResolutionValidationError("reason_mode value is unsupported.");
      }
      return { type, sourceId, value: record.value as (typeof REASON_MODE_VALUES)[number] };
    }
  }

  throw new AttachmentResolutionValidationError("feature type is unsupported.");
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
    reason: reason as (typeof ATTACHMENT_UNRESOLVED_REASONS)[number],
  };
}

export function validateAttachmentResolutionOutput(
  parsed: unknown,
  input: AttachmentResolutionInput,
): AttachmentResolutionOutput {
  const record = assertObject(parsed, "Attachment resolution output must be a JSON object.");
  const keys = Object.keys(record);
  const map = candidateMap(input);
  const isLegacyShape = Object.prototype.hasOwnProperty.call(record, "attachments");

  if (isLegacyShape) {
    const allowedKeys = new Set(["attachments", "features", "unresolved"]);

    if (keys.some((key) => !allowedKeys.has(key))) {
      throw new AttachmentResolutionValidationError("Attachment resolution output contains unsupported fields.");
    }

    if (!Array.isArray(record.attachments) || !Array.isArray(record.features) || !Array.isArray(record.unresolved)) {
      throw new AttachmentResolutionValidationError("attachments, features, and unresolved must all be arrays.");
    }

    return {
      attachments: record.attachments.map((attachment) => validateAttachment(map, attachment)),
      features: record.features.map((feature) => validateFeature(map, feature)),
      unresolved: record.unresolved.map((item) => validateUnresolved(map, item)),
    };
  }

  const allowedKeys = new Set([
    "availabilityAttachments",
    "modifierAttachments",
    "reasonAttachments",
    "comparisonScopes",
    "preferenceAttachments",
    "clauseRelations",
    "features",
    "unresolved",
  ]);

  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new AttachmentResolutionValidationError("Attachment resolution output contains unsupported fields.");
  }

  if (
    !Array.isArray(record.availabilityAttachments) ||
    !Array.isArray(record.modifierAttachments) ||
    !Array.isArray(record.reasonAttachments) ||
    !Array.isArray(record.comparisonScopes) ||
    !Array.isArray(record.preferenceAttachments) ||
    !Array.isArray(record.clauseRelations) ||
    !Array.isArray(record.features) ||
    !Array.isArray(record.unresolved)
  ) {
    throw new AttachmentResolutionValidationError(
      "availabilityAttachments, modifierAttachments, reasonAttachments, comparisonScopes, preferenceAttachments, clauseRelations, features, and unresolved must all be arrays.",
    );
  }

  const attachments = [
    ...record.availabilityAttachments,
    ...record.modifierAttachments,
    ...record.reasonAttachments,
    ...record.comparisonScopes,
    ...record.preferenceAttachments,
    ...record.clauseRelations,
  ].map((attachment) => validateAttachment(map, attachment));

  return {
    attachments,
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
  const prompts = buildAttachmentResolutionMessages(input);

  return requestStructuredJsonFromLlm(options, {
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    schema: buildAttachmentResolutionSchema(input),
    temperature: 0,
  });
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
      error instanceof StructuredLlmRequestError ? error.responseText : rawResponse,
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
