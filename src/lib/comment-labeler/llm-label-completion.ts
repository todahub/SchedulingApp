import { labelCommentText } from "./rule-labeler";
import type { CommentLabelerOptions, Label, LabeledComment, LabeledToken } from "./types";

export const COMMENT_LABEL_COMPLETION_ALLOWED_LABELS = [
  "availability_positive",
  "availability_negative",
  "availability_unknown",
  "uncertainty_marker",
  "conditional_marker",
  "hypothetical_marker",
  "negation_marker",
  "strength_marker",
  "weak_commitment_marker",
  "preference_positive_marker",
  "preference_negative_marker",
  "comparison_marker",
  "scope_residual",
  "scope_exception",
  "scope_all",
  "particle_topic",
  "particle_link",
  "particle_condition",
  "particle_limit",
  "conjunction_parallel",
  "conjunction_contrast",
  "punctuation_boundary",
  "sentence_boundary",
  "reason_marker",
] as const satisfies readonly Exclude<Label, `target_${string}` | "desire_marker" | "emphasis_marker">[];

export type CommentLabelCompletionAllowedLabel = (typeof COMMENT_LABEL_COMPLETION_ALLOWED_LABELS)[number];
export type CommentLabelCompletionOutputLabel = CommentLabelCompletionAllowedLabel | "none";

export type CommentLabelMeaningGuide = {
  useWhen: string;
  doNotUseWhen: string;
  llmOnly?: boolean;
};

export const COMMENT_LABEL_MEANING_GUIDE: Record<CommentLabelCompletionAllowedLabel, CommentLabelMeaningGuide> = {
  availability_positive: {
    useWhen: "参加可能・行ける・大丈夫など、肯定的な可否そのものを表すときに使う。",
    doNotUseWhen: "理由説明や不確実性、条件つき参加だけを表す断片には使わない。",
  },
  availability_negative: {
    useWhen: "行けない・無理・厳しいなど、否定的な可否そのものを表すときに使う。",
    doNotUseWhen: "理由説明や比較、条件そのものには使わない。",
  },
  availability_unknown: {
    useWhen: "未定・わからない・判断保留など、可否そのものが未確定なときに使う。",
    doNotUseWhen: "不確実な肯定や条件つき肯定を安易に unknown にしない。",
  },
  uncertainty_marker: {
    useWhen: "たぶん・かも・おそらく等、不確実さを表すときに使う。",
    doNotUseWhen: "背景事情や理由説明には使わない。",
  },
  conditional_marker: {
    useWhen: "なら・次第など、条件が満たされる前提を表すときに使う。",
    doNotUseWhen: "背景事情だけの断片や比較表現には使わない。",
  },
  hypothetical_marker: {
    useWhen: "もし・たら・れば等、仮定や仮説の前提を表すときに使う。",
    doNotUseWhen: "単なる不確実さや背景事情だけには使わない。",
  },
  negation_marker: {
    useWhen: "ない・ではない・なくはない等、否定や反転を表すときに使う。",
    doNotUseWhen: "可否そのものの核を代わりに表すためには使わない。",
  },
  strength_marker: {
    useWhen: "確実に・第一希望など、強さや優先度を強めるときに使う。",
    doNotUseWhen: "比較構造や背景事情の代わりには使わない。",
  },
  weak_commitment_marker: {
    useWhen: "一応・できれば等、弱いコミットや弱い希望修飾を表すときに使う。",
    doNotUseWhen: "可否そのものや比較構造の代わりには使わない。",
  },
  preference_positive_marker: {
    useWhen: "がいい・助かる・嬉しい等、その候補が好ましいことを表すときに使う。",
    doNotUseWhen: "比較対象を前提にする「方がいい」「より」には使わない。",
  },
  preference_negative_marker: {
    useWhen: "他の日がいい・避けたい等、その候補を好まないことを表すときに使う。",
    doNotUseWhen: "参加不可そのものや単なる背景事情には使わない。",
  },
  comparison_marker: {
    useWhen: "方がいい・より等、比較対象を前提にする表現に使う。",
    doNotUseWhen: "単なる好ましさや事情説明には使わない。",
  },
  scope_residual: {
    useWhen: "あとは・それ以外等、残余範囲を表すときに使う。",
    doNotUseWhen: "単なる接続語や比較表現には使わない。",
  },
  scope_exception: {
    useWhen: "以外・除いて等、例外範囲を表すときに使う。",
    doNotUseWhen: "単なる条件や理由説明には使わない。",
  },
  scope_all: {
    useWhen: "全部・いつでも等、全体範囲を表すときに使う。",
    doNotUseWhen: "残余や例外には使わない。",
  },
  particle_topic: {
    useWhen: "は・って等、話題提示を表すときに使う。",
    doNotUseWhen: "条件や比較の意味を持つと決めつけない。",
  },
  particle_link: {
    useWhen: "と・や・か等、語をつなぐ機能句に使う。",
    doNotUseWhen: "比較・条件・可否の意味を代用しない。",
  },
  particle_condition: {
    useWhen: "だと・なら等、条件の接続粒子として読むときに使う。",
    doNotUseWhen: "背景事情だけの断片には使わない。",
  },
  particle_limit: {
    useWhen: "だけ・しか等、限定を表すときに使う。",
    doNotUseWhen: "可否そのものや比較そのものには使わない。",
  },
  conjunction_parallel: {
    useWhen: "あと・それと等、並列的につなぐときに使う。",
    doNotUseWhen: "対比や条件の代わりには使わない。",
  },
  conjunction_contrast: {
    useWhen: "けど・でも・ただ等、対比や逆接を表すときに使う。",
    doNotUseWhen: "並列接続や背景事情の代わりには使わない。",
  },
  punctuation_boundary: {
    useWhen: "、や, のような区切り記号を保持したいときに使う。",
    doNotUseWhen: "比較や条件の意味を持つと決めつけない。",
  },
  sentence_boundary: {
    useWhen: "。や！等、文境界を表すときに使う。",
    doNotUseWhen: "可否や比較の意味を持つと決めつけない。",
  },
  reason_marker: {
    useWhen: "可否・条件・選好・比較そのものではなく、本人の事情・背景・都合・予定・負担などの説明断片を表すときにだけ使う。",
    doNotUseWhen: "既存ラベルで説明できる条件・不確実性・比較・選好・可否を reason に落としてはいけない。",
    llmOnly: true,
  },
};

export const COMMENT_LABEL_COMPLETION_RULES = [
  "まず既存ラベルで説明できるなら必ず既存ラベルを使う。",
  "reason_marker は最後の手段であり、便利な逃げラベルとして使わない。",
  "reason_marker は説明断片専用であり、可否・条件・比較・選好・不確実性を代用しない。",
  "既に辞書で付いているラベルは書き換えない。",
  "新しい日付、時間、対象、可否を作らない。",
  "複数の節を勝手に統合しない。",
] as const;

export type CommentLabelCompletionSegmentInput = {
  segmentId: string;
  text: string;
  start: number;
  end: number;
  beforeText: string;
  afterText: string;
};

export type CommentLabelCompletionLlmInput = {
  originalText: string;
  normalizedText: string;
  labeledTokens: Array<Pick<LabeledToken, "text" | "label" | "start" | "end">>;
  unlabeledSegments: CommentLabelCompletionSegmentInput[];
};

export type CommentLabelCompletionSegmentOutput = {
  segmentId: string;
  text: string;
  labels: CommentLabelCompletionOutputLabel[];
};

export type CommentLabelCompletionOutput = {
  segments: CommentLabelCompletionSegmentOutput[];
};

export type CommentLabelCompletionErrorStage = "request" | "parse" | "validate";

export type CommentLabelCompletionResult = {
  input: CommentLabelCompletionLlmInput;
  output: CommentLabelCompletionOutput | null;
  rawResponse: string | null;
  error:
    | {
        stage: CommentLabelCompletionErrorStage;
        message: string;
      }
    | null;
};

export type CommentLabelCompletionOllamaOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export type CompleteLabeledCommentWithLlmResult = {
  labeledComment: LabeledComment;
  unlabeledSegments: CommentLabelCompletionSegmentInput[];
  completion: CommentLabelCompletionResult | null;
  llmWasCalled: boolean;
};

export class CommentLabelCompletionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentLabelCompletionParseError";
  }
}

export class CommentLabelCompletionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentLabelCompletionValidationError";
  }
}

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const trimmed = typeof baseUrl === "string" && baseUrl.trim().length > 0 ? baseUrl.trim() : "http://127.0.0.1:11434/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function buildCoveredRanges(tokens: LabeledToken[]) {
  const ranges = tokens
    // 助詞リンクは事情断片の内部にも誤爆しやすく、
    // LLM 補完用の未ラベル segment を不自然に分断するため、
    // ここでは coverage から外して最大断片を保つ。
    .filter((token) => token.label !== "particle_link")
    .map((token) => ({ start: token.start, end: token.end }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }

    last.end = Math.max(last.end, range.end);
  }

  return merged;
}

function collectGapSegments(
  text: string,
  start: number,
  end: number,
  originalText: string,
): CommentLabelCompletionSegmentInput[] {
  if (end <= start) {
    return [];
  }

  const gapText = text.slice(start, end);
  const segments: CommentLabelCompletionSegmentInput[] = [];
  const segmentRegex = /\S+/gu;
  let matchIndex = 0;

  for (const match of gapText.matchAll(segmentRegex)) {
    const textFragment = match[0];
    const relativeStart = match.index ?? 0;
    const segmentStart = start + relativeStart;
    const segmentEnd = segmentStart + textFragment.length;

    segments.push({
      segmentId: `seg-${start}-${end}-${matchIndex}`,
      text: textFragment,
      start: segmentStart,
      end: segmentEnd,
      beforeText: originalText.slice(Math.max(0, segmentStart - 20), segmentStart),
      afterText: originalText.slice(segmentEnd, Math.min(originalText.length, segmentEnd + 20)),
    });
    matchIndex += 1;
  }

  return segments;
}

export function toCommentLabelCompletionInput(args: {
  originalText: string;
  normalizedText: string;
  labeledTokens: LabeledToken[];
  unlabeledSegments: CommentLabelCompletionSegmentInput[];
}): CommentLabelCompletionLlmInput {
  return {
    originalText: args.originalText,
    normalizedText: args.normalizedText,
    labeledTokens: args.labeledTokens.map((token) => ({
      text: token.text,
      label: token.label,
      start: token.start,
      end: token.end,
    })),
    unlabeledSegments: args.unlabeledSegments,
  };
}

export function extractUnlabeledSegments(labeledComment: LabeledComment): CommentLabelCompletionSegmentInput[] {
  const text = labeledComment.normalizedText;
  const coveredRanges = buildCoveredRanges(labeledComment.tokens);
  const segments: CommentLabelCompletionSegmentInput[] = [];
  let cursor = 0;

  for (const range of coveredRanges) {
    if (cursor < range.start) {
      segments.push(...collectGapSegments(text, cursor, range.start, labeledComment.originalText));
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < text.length) {
    segments.push(...collectGapSegments(text, cursor, text.length, labeledComment.originalText));
  }

  return segments;
}

function formatLabelGuides() {
  return COMMENT_LABEL_COMPLETION_ALLOWED_LABELS.map((label) => {
    const guide = COMMENT_LABEL_MEANING_GUIDE[label];
    return `- ${label}: ${guide.useWhen} 使わない: ${guide.doNotUseWhen}`;
  }).join("\n");
}

export function buildCommentLabelCompletionSystemPrompt() {
  return [
    "あなたの役割は、辞書で未ラベルだったテキスト片に対して、既存ラベルを補完することです。",
    "",
    "重要:",
    "- あなたは新しい意味を作ってはいけません",
    "- あなたは辞書が付けたラベルを書き換えてはいけません",
    "- あなたは新しい日付、時間、対象、可否を作ってはいけません",
    "- あなたは文全体を要約してはいけません",
    "- あなたは与えられたテキスト片に対してのみラベルを選択してください",
    "- 出力は JSON のみです",
    "",
    "まず既存ラベルで説明できるなら、必ず既存ラベルを使ってください。",
    "reason_marker は最後の手段です。",
    "reason_marker は「既存ラベルで説明できないものを全部入れる箱」ではありません。",
    "reason_marker は、本人の都合・背景・事情・予定・負担などの説明断片だけに使います。",
    "条件・比較・不確実性・選好・可否を reason_marker にしてはいけません。",
    "",
    "選べるラベル:",
    `- ${COMMENT_LABEL_COMPLETION_ALLOWED_LABELS.join("\n- ")}`,
    "- none",
    "",
    "ラベル定義:",
    formatLabelGuides(),
    "",
    "出力形式:",
    '{ "segments": [{ "segmentId": "...", "text": "...", "labels": ["..."] }] }',
    "",
    "JSON のみを返してください。",
  ].join("\n");
}

export function buildCommentLabelCompletionUserPrompt(input: CommentLabelCompletionLlmInput) {
  return [
    "以下の未ラベル断片だけに対して、既存ラベルを補完してください。",
    "候補にないラベルを作ってはいけません。",
    "辞書で既に付いているラベルは変更してはいけません。",
    "どうしてもラベルが付かないときだけ none を返してください。",
    "",
    "選択ルール:",
    ...COMMENT_LABEL_COMPLETION_RULES.map((rule) => `- ${rule}`),
    "",
    "入力:",
    JSON.stringify(input, null, 2),
    "",
    "出力は JSON のみです。",
  ].join("\n");
}

export function buildCommentLabelCompletionMessages(input: CommentLabelCompletionLlmInput) {
  return {
    system: buildCommentLabelCompletionSystemPrompt(),
    user: buildCommentLabelCompletionUserPrompt(input),
  };
}

export function parseCommentLabelCompletionResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  if (!trimmed) {
    throw new CommentLabelCompletionParseError("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new CommentLabelCompletionParseError("LLM response was not valid JSON.");
  }
}

function validateOutputLabels(labels: unknown): CommentLabelCompletionOutputLabel[] {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new CommentLabelCompletionValidationError("labels must be a non-empty array.");
  }

  const seen = new Set<string>();
  const validated = labels.map((label) => {
    if (
      label !== "none" &&
      (typeof label !== "string" ||
        !COMMENT_LABEL_COMPLETION_ALLOWED_LABELS.includes(label as CommentLabelCompletionAllowedLabel))
    ) {
      throw new CommentLabelCompletionValidationError("labels contains unsupported values.");
    }

    if (typeof label !== "string") {
      throw new CommentLabelCompletionValidationError("labels must contain strings.");
    }

    if (seen.has(label)) {
      throw new CommentLabelCompletionValidationError("labels contains duplicates.");
    }

    seen.add(label);
    return label as CommentLabelCompletionOutputLabel;
  });

  if (validated.includes("none") && validated.length > 1) {
    throw new CommentLabelCompletionValidationError("none must not be combined with other labels.");
  }

  if (validated.includes("reason_marker") && validated.length > 1) {
    throw new CommentLabelCompletionValidationError("reason_marker must not be combined with other labels.");
  }

  return validated;
}

export function validateCommentLabelCompletionOutput(
  parsed: unknown,
  input: CommentLabelCompletionLlmInput,
): CommentLabelCompletionOutput {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CommentLabelCompletionValidationError("Output must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || !("segments" in record)) {
    throw new CommentLabelCompletionValidationError("Output must contain only the segments field.");
  }

  if (!Array.isArray(record.segments)) {
    throw new CommentLabelCompletionValidationError("segments must be an array.");
  }

  const expectedSegments = new Map(input.unlabeledSegments.map((segment) => [segment.segmentId, segment]));
  const seenSegmentIds = new Set<string>();

  const segments = record.segments.map((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new CommentLabelCompletionValidationError("Each segment must be an object.");
    }

    const segmentRecord = segment as Record<string, unknown>;
    const segmentKeys = Object.keys(segmentRecord);
    const allowedSegmentKeys = new Set(["segmentId", "text", "labels"]);

    if (segmentKeys.some((key) => !allowedSegmentKeys.has(key))) {
      throw new CommentLabelCompletionValidationError("Segment contains unsupported fields.");
    }

    const { segmentId, text, labels } = segmentRecord;

    if (typeof segmentId !== "string" || !expectedSegments.has(segmentId)) {
      throw new CommentLabelCompletionValidationError("segmentId does not exist in input.");
    }

    if (seenSegmentIds.has(segmentId)) {
      throw new CommentLabelCompletionValidationError("segmentId must appear exactly once.");
    }
    seenSegmentIds.add(segmentId);

    const expected = expectedSegments.get(segmentId)!;
    if (typeof text !== "string" || text !== expected.text) {
      throw new CommentLabelCompletionValidationError("segment text must exactly match the input segment text.");
    }

    return {
      segmentId,
      text,
      labels: validateOutputLabels(labels),
    };
  });

  if (seenSegmentIds.size !== expectedSegments.size) {
    throw new CommentLabelCompletionValidationError("Output must cover every input segment exactly once.");
  }

  return { segments };
}

function buildFallbackCompletionResult(
  input: CommentLabelCompletionLlmInput,
  stage: CommentLabelCompletionErrorStage,
  message: string,
  rawResponse: string | null,
): CommentLabelCompletionResult {
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

export async function callOllamaForLabelCompletion(
  input: CommentLabelCompletionLlmInput,
  options: CommentLabelCompletionOllamaOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_BASE_URL);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const timeoutMs = options.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const messages = buildCommentLabelCompletionMessages(input);
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
            segments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  segmentId: {
                    type: "string",
                    enum: input.unlabeledSegments.map((segment) => segment.segmentId),
                  },
                  text: {
                    type: "string",
                    enum: input.unlabeledSegments.map((segment) => segment.text),
                  },
                  labels: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: [...COMMENT_LABEL_COMPLETION_ALLOWED_LABELS, "none"],
                    },
                    minItems: 1,
                  },
                },
                required: ["segmentId", "text", "labels"],
              },
            },
          },
          required: ["segments"],
        },
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: "system",
            content: messages.system,
          },
          {
            role: "user",
            content: messages.user,
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

export async function completeLabelsWithLlm(
  input: CommentLabelCompletionLlmInput,
  options: CommentLabelCompletionOllamaOptions = {},
): Promise<CommentLabelCompletionResult> {
  let rawResponse: string | null = null;

  try {
    rawResponse = await callOllamaForLabelCompletion(input, options);
  } catch (error) {
    return buildFallbackCompletionResult(
      input,
      "request",
      error instanceof Error ? error.message : "Failed to request label completion from Ollama.",
      rawResponse,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseCommentLabelCompletionResponse(rawResponse);
  } catch (error) {
    return buildFallbackCompletionResult(
      input,
      "parse",
      error instanceof Error ? error.message : "Failed to parse label completion response.",
      rawResponse,
    );
  }

  let output: CommentLabelCompletionOutput;
  try {
    output = validateCommentLabelCompletionOutput(parsed, input);
  } catch (error) {
    return buildFallbackCompletionResult(
      input,
      "validate",
      error instanceof Error ? error.message : "Label completion response failed validation.",
      rawResponse,
    );
  }

  return {
    input,
    output,
    rawResponse,
    error: null,
  };
}

export function applyLlmLabelCompletion(
  labeledComment: LabeledComment,
  completionOutput: CommentLabelCompletionOutput,
): LabeledComment {
  const segmentById = new Map(completionOutput.segments.map((segment) => [segment.segmentId, segment]));
  const unlabeledSegments = extractUnlabeledSegments(labeledComment);

  const llmTokens = unlabeledSegments.flatMap((segment) => {
    const completion = segmentById.get(segment.segmentId);
    if (!completion) {
      return [];
    }

    return completion.labels
      .filter((label): label is CommentLabelCompletionAllowedLabel => label !== "none")
      .map((label) => ({
        text: segment.text,
        normalizedText: segment.text,
        label,
        start: segment.start,
        end: segment.end,
        source: "llm_completion" as const,
        meta: {
          llmCompleted: true,
          segmentId: segment.segmentId,
        },
      }));
  });

  return {
    ...labeledComment,
    tokens: [...labeledComment.tokens, ...llmTokens].sort(
      (left, right) => left.start - right.start || left.end - right.end || left.label.localeCompare(right.label),
    ),
  };
}

export async function completeLabeledCommentWithLlm(
  labeledComment: LabeledComment,
  options: CommentLabelCompletionOllamaOptions = {},
): Promise<CompleteLabeledCommentWithLlmResult> {
  const unlabeledSegments = extractUnlabeledSegments(labeledComment);

  if (unlabeledSegments.length === 0) {
    return {
      labeledComment,
      unlabeledSegments,
      completion: null,
      llmWasCalled: false,
    };
  }

  const input = toCommentLabelCompletionInput({
    originalText: labeledComment.originalText,
    normalizedText: labeledComment.normalizedText,
    labeledTokens: labeledComment.tokens,
    unlabeledSegments,
  });

  const completion = await completeLabelsWithLlm(input, options);

  if (!completion.output) {
    return {
      labeledComment,
      unlabeledSegments,
      completion,
      llmWasCalled: true,
    };
  }

  return {
    labeledComment: applyLlmLabelCompletion(labeledComment, completion.output),
    unlabeledSegments,
    completion,
    llmWasCalled: true,
  };
}

export async function labelCommentTextWithLlm(
  comment: string,
  labelerOptions?: CommentLabelerOptions,
  completionOptions: CommentLabelCompletionOllamaOptions = {},
): Promise<CompleteLabeledCommentWithLlmResult> {
  const labeledComment = labelCommentText(comment, labelerOptions);
  return completeLabeledCommentWithLlm(labeledComment, completionOptions);
}
