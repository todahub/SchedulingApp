import type { DateSequenceGroupingHypothesis, DateSequenceInterpretation, DateSequenceTarget } from "./types";

export const GROUPING_SELECTION_REASON_CODES = [
  "single_adjacent_sequence",
  "delimiter_pattern_change",
  "whitespace_boundary",
  "range_connector_adopted",
  "connector_is_ambiguous",
  "context_boundary_signal",
  "insufficient_context",
] as const;

export type GroupingSelectionReasonCode = (typeof GROUPING_SELECTION_REASON_CODES)[number];

export type GroupingSelectionDecision = "selected" | "undetermined";

export type GroupingSelectionOutput = {
  selectedHypothesisId: string | null;
  decision: GroupingSelectionDecision;
  reasonCodes: GroupingSelectionReasonCode[];
};

export type GroupingSelectionLlmInput = {
  originalText: string;
  normalizedText: string;
  sequence: {
    sequenceId: string;
    sourceText: string;
    span: {
      start: number;
      end: number;
    };
    beforeText: string;
    afterText: string;
    targets: Array<{
      targetId: string;
      text: string;
      normalizedValue?: string;
      start: number;
      end: number;
      sourceTargetKind: string;
      derivedFromRange: boolean;
    }>;
    groupingHypotheses: Array<{
      hypothesisId: string;
      kind: string;
      groups: string[][];
      evidence: string[];
      connectorPolicy?: Record<string, string>;
    }>;
  };
};

export type GroupingSelectionErrorStage = "request" | "parse" | "validate";

export type GroupingSelectionResult = {
  input: GroupingSelectionLlmInput;
  output: GroupingSelectionOutput;
  selectedHypothesis: DateSequenceGroupingHypothesis | null;
  rawResponse: string | null;
  error:
    | {
        stage: GroupingSelectionErrorStage;
        message: string;
      }
    | null;
};

export type SelectGroupingHypothesisWithLlmOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
};

export class GroupingSelectionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupingSelectionParseError";
  }
}

export class GroupingSelectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupingSelectionValidationError";
  }
}

const GROUPING_SELECTION_SYSTEM_PROMPT = [
  "あなたの仕事は、与えられた grouping hypothesis の中から最も自然な 1 件だけを選ぶことです。",
  "候補にない解釈を作ってはいけません。",
  "target を追加・削除してはいけません。",
  "日付や曜日を具体化してはいけません。",
  "availability や希望の意味解釈をしてはいけません。",
  "出力は JSON のみです。",
  "",
  "必ず守ること:",
  "- hypothesis を新規作成しない",
  "- groups を編集しない",
  "- hypothesisId 以外で選択を表現しない",
  "- 迷う場合は undetermined を返す",
  "",
  "出力は JSON のみです。",
].join("\n");

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const trimmed = typeof baseUrl === "string" && baseUrl.trim().length > 0 ? baseUrl.trim() : "http://127.0.0.1:11434/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function inferReasonCodes(hypothesis: DateSequenceGroupingHypothesis | null): GroupingSelectionReasonCode[] {
  if (!hypothesis) {
    return ["insufficient_context"];
  }

  const mapped = hypothesis.evidence.flatMap((evidence) => {
    switch (evidence) {
      case "single_adjacent_sequence":
      case "delimiter_pattern_change":
      case "whitespace_boundary":
      case "connector_is_ambiguous":
        return [evidence];
      default:
        if (evidence.endsWith("_between_date_targets")) {
          return ["range_connector_adopted"];
        }

        return [];
    }
  });

  return mapped.length > 0 ? [...new Set(mapped)] : ["context_boundary_signal"];
}

function buildFallbackUndeterminedResult(
  input: GroupingSelectionLlmInput,
  stage: GroupingSelectionErrorStage,
  message: string,
  rawResponse: string | null,
): GroupingSelectionResult {
  return {
    input,
    output: {
      selectedHypothesisId: null,
      decision: "undetermined",
      reasonCodes: ["insufficient_context"],
    },
    selectedHypothesis: null,
    rawResponse,
    error: {
      stage,
      message,
    },
  };
}

function toSerializableTarget(target: DateSequenceTarget) {
  return {
    targetId: target.targetId,
    text: target.text,
    normalizedValue: target.normalizedValue,
    start: target.start,
    end: target.end,
    sourceTargetKind: target.sourceTargetKind,
    derivedFromRange: target.derivedFromRange,
  };
}

export function toLlmGroupingSelectionInput(sequence: DateSequenceInterpretation): GroupingSelectionLlmInput {
  return {
    originalText: sequence.context.originalText,
    normalizedText: sequence.context.normalizedText,
    sequence: {
      sequenceId: sequence.sequenceId,
      sourceText: sequence.sourceText,
      span: sequence.span,
      beforeText: sequence.context.beforeText,
      afterText: sequence.context.afterText,
      targets: sequence.targets.map(toSerializableTarget),
      groupingHypotheses: sequence.groupingHypotheses.map((hypothesis) => ({
        hypothesisId: hypothesis.hypothesisId,
        kind: hypothesis.kind,
        groups: hypothesis.groups,
        evidence: hypothesis.evidence,
        ...(hypothesis.connectorPolicy ? { connectorPolicy: hypothesis.connectorPolicy } : {}),
      })),
    },
  };
}

export function buildGroupingSelectionPrompt(input: GroupingSelectionLlmInput) {
  return [
    "与えられた候補の中から、最も自然な grouping hypothesis を 1 件だけ選んでください。",
    "候補にない grouping を作ってはいけません。",
    "判断できない場合は undetermined を返してください。",
    "JSON のみを返してください。",
    "",
    "出力形式:",
    '{ "selectedHypothesisId": "..." | null, "decision": "selected" | "undetermined", "reasonCodes": ["..."] }',
    "",
    "allowedReasonCodes:",
    JSON.stringify(GROUPING_SELECTION_REASON_CODES),
    "",
    "input:",
    JSON.stringify(input, null, 2),
    "",
    "JSON のみを返してください。",
  ].join("\n");
}

export function buildGroupingSelectionMessages(input: GroupingSelectionLlmInput) {
  return {
    systemPrompt: GROUPING_SELECTION_SYSTEM_PROMPT,
    userPrompt: buildGroupingSelectionPrompt(input),
  };
}

export function parseGroupingSelectionResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  if (!trimmed) {
    throw new GroupingSelectionParseError("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new GroupingSelectionParseError("LLM response was not valid JSON.");
  }
}

export function validateGroupingSelectionOutput(
  parsed: unknown,
  hypotheses: DateSequenceGroupingHypothesis[],
): GroupingSelectionOutput {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GroupingSelectionValidationError("Grouping selection output must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowedKeys = new Set(["selectedHypothesisId", "decision", "reasonCodes"]);

  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new GroupingSelectionValidationError("Grouping selection output contains unsupported fields.");
  }

  const { selectedHypothesisId, decision, reasonCodes } = record;

  if (decision !== "selected" && decision !== "undetermined") {
    throw new GroupingSelectionValidationError("decision must be 'selected' or 'undetermined'.");
  }

  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    throw new GroupingSelectionValidationError("reasonCodes must be a non-empty array.");
  }

  const invalidReasonCode = reasonCodes.find(
    (reasonCode) => typeof reasonCode !== "string" || !GROUPING_SELECTION_REASON_CODES.includes(reasonCode as GroupingSelectionReasonCode),
  );

  if (invalidReasonCode) {
    throw new GroupingSelectionValidationError("reasonCodes contains unsupported values.");
  }

  if (decision === "selected") {
    if (typeof selectedHypothesisId !== "string") {
      throw new GroupingSelectionValidationError("selected decision requires a hypothesis id.");
    }

    if (!hypotheses.some((hypothesis) => hypothesis.hypothesisId === selectedHypothesisId)) {
      throw new GroupingSelectionValidationError("selectedHypothesisId does not exist in the provided hypotheses.");
    }

    return {
      selectedHypothesisId,
      decision,
      reasonCodes: reasonCodes as GroupingSelectionReasonCode[],
    };
  }

  if (selectedHypothesisId !== null) {
    throw new GroupingSelectionValidationError("undetermined decision requires selectedHypothesisId to be null.");
  }

  return {
    selectedHypothesisId: null,
    decision,
    reasonCodes: reasonCodes as GroupingSelectionReasonCode[],
  };
}

async function requestGroupingSelectionJson(
  options: SelectGroupingHypothesisWithLlmOptions,
  prompts: {
    systemPrompt: string;
    userPrompt: string;
    selectedHypothesisIds: string[];
  },
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_BASE_URL);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
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
          selectedHypothesisId: {
            oneOf: [
              {
                type: "string",
                enum: prompts.selectedHypothesisIds,
              },
              { type: "null" },
            ],
          },
          decision: {
            type: "string",
            enum: ["selected", "undetermined"],
          },
          reasonCodes: {
            type: "array",
            items: {
              type: "string",
              enum: [...GROUPING_SELECTION_REASON_CODES],
            },
            minItems: 1,
          },
        },
        required: ["selectedHypothesisId", "decision", "reasonCodes"],
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

export async function selectGroupingHypothesisWithLlm(
  sequence: DateSequenceInterpretation,
  options: SelectGroupingHypothesisWithLlmOptions = {},
): Promise<GroupingSelectionResult> {
  const input = toLlmGroupingSelectionInput(sequence);
  const prompts = buildGroupingSelectionMessages(input);

  let rawResponse: string | null = null;

  try {
    rawResponse = await requestGroupingSelectionJson(options, {
      ...prompts,
      selectedHypothesisIds: sequence.groupingHypotheses.map((hypothesis) => hypothesis.hypothesisId),
    });
  } catch (error) {
    return buildFallbackUndeterminedResult(
      input,
      "request",
      error instanceof Error ? error.message : "Failed to request grouping selection from Ollama.",
      rawResponse,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseGroupingSelectionResponse(rawResponse);
  } catch (error) {
    return buildFallbackUndeterminedResult(
      input,
      "parse",
      error instanceof Error ? error.message : "Failed to parse grouping selection response.",
      rawResponse,
    );
  }

  let output: GroupingSelectionOutput;
  try {
    output = validateGroupingSelectionOutput(parsed, sequence.groupingHypotheses);
  } catch (error) {
    return buildFallbackUndeterminedResult(
      input,
      "validate",
      error instanceof Error ? error.message : "Grouping selection response failed validation.",
      rawResponse,
    );
  }

  const selectedHypothesis =
    output.selectedHypothesisId === null
      ? null
      : sequence.groupingHypotheses.find((hypothesis) => hypothesis.hypothesisId === output.selectedHypothesisId) ?? null;

  return {
    input,
    output:
      output.selectedHypothesisId === null
        ? {
            ...output,
            reasonCodes: output.reasonCodes.length > 0 ? output.reasonCodes : ["insufficient_context"],
          }
        : {
            ...output,
            reasonCodes: output.reasonCodes.length > 0 ? output.reasonCodes : inferReasonCodes(selectedHypothesis),
          },
    selectedHypothesis,
    rawResponse,
    error: null,
  };
}
