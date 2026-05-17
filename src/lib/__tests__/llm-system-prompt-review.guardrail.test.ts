import { describe, expect, it } from "vitest";
import {
  buildCommentLabelCompletionSystemPrompt,
} from "@/lib/comment-labeler/llm-label-completion";
import {
  buildAttachmentResolutionMessages,
  toAttachmentResolutionInput,
} from "@/lib/comment-labeler/llm-attachment";
import {
  buildComparisonPreferenceInterpretationInput,
  buildComparisonPreferenceMessages,
} from "@/lib/comparison-preference-interpretation";
import { buildAvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";
import {
  buildConditionInterpretationInputFromExecutionInput,
  buildConditionInterpretationMessages,
} from "@/lib/condition-interpretation";
import {
  buildGroupingSelectionMessages,
  toLlmGroupingSelectionInput,
  type DateSequenceInterpretation,
} from "@/lib/date-sequence";
import type { EventCandidateRecord } from "@/lib/domain";

function buildAllDayCandidate(dateValue: string, sortOrder: number): EventCandidateRecord {
  return {
    id: `candidate-${dateValue}`,
    eventId: "event-prompt-review",
    date: dateValue,
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: dateValue,
    endDate: dateValue,
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder,
  };
}

function buildAprilCandidates(days: number[]) {
  return days.map((day, index) => buildAllDayCandidate(`2026-04-${String(day).padStart(2, "0")}`, index + 1));
}

function findTokenIndex(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  text: string | RegExp,
) {
  const token = executionInput.tokens.find((candidate) =>
    typeof text === "string" ? candidate.text === text : text.test(candidate.text),
  );

  if (!token) {
    throw new Error(`Token not found for ${String(text)} in "${executionInput.originalText}"`);
  }

  return token.index;
}

function expectPromptReviewChecklist(prompt: string) {
  expect(prompt).toContain("あなたの役割");
  expect(prompt).toContain("優先順位:");
  expect(prompt).toContain("禁止事項:");
  expect(prompt).toContain("JSON のみ");
}

describe("llm system prompt review guardrails", () => {
  it("keeps the label completion system prompt narrow, constrained, and ambiguity-safe", () => {
    const prompt = buildCommentLabelCompletionSystemPrompt();

    expectPromptReviewChecklist(prompt);
    expect(prompt).toContain("辞書で未ラベルだった断片に対して、既存ラベルだけを補完することです。");
    expect(prompt).toContain("わからなければ invent せず none を返す。");
    expect(prompt).toContain("reason_marker を便利な逃げラベルとして使ってはいけません。");
    expect(prompt).toContain("返してよい top-level key は segments だけです。");
  });

  it("keeps the attachment system prompt schema-first and forbids invented relation types", () => {
    const input = toAttachmentResolutionInput("11と12なら12がいい", [
      {
        id: "t1",
        text: "11",
        label: "target_date",
        start: 0,
        end: 2,
        sentenceIndex: 0,
        clauseIndex: 0,
      },
      {
        id: "t2",
        text: "12",
        label: "target_date",
        start: 3,
        end: 5,
        sentenceIndex: 0,
        clauseIndex: 0,
      },
      {
        id: "p1",
        text: "12がいい",
        label: "preference_positive_marker",
        start: 5,
        end: 10,
        sentenceIndex: 0,
        clauseIndex: 0,
      },
    ]);
    const prompt = buildAttachmentResolutionMessages(input).systemPrompt;

    expectPromptReviewChecklist(prompt);
    expect(prompt).toContain("6種類以外の type を返してはいけません。");
    expect(prompt).toContain("comparison_target / condition_target / availability_relation / preference_scope / comparison_relation");
    expect(prompt).toContain("同じ object 配列に混在させず、type ごとの専用配列に入れてください。");
    expect(prompt).toContain("availabilityAttachments.sourceId は availability-* id だけ、targetId は target-* id だけです。");
    expect(prompt).toContain("clause_relation は補助 relation です。");
    expect(prompt).toContain("availability-* と target-* の対応が読み取れるなら、availability_target を返してください。");
    expect(prompt).toContain("可否コメントとして読める文で availability-* と target-* の両方があるのに、availability_target が0件なのは通常は不正です。");
    expect(prompt).toContain("schema に合わない attachment を返すくらいなら attachments を空にしてください。");
    expect(prompt).toContain("unresolved の各 item は {sourceId, reason} だけです。");
    expect(prompt).toContain("sourceId を選べないなら unresolved item を作らず unresolved を空配列にしてください。");
    expect(prompt).toContain("空オブジェクト {} を unresolved に入れてはいけません。");
    expect(prompt).toContain("すべての item が正しい専用配列に入っているか。");
  });

  it("keeps the comparison system prompt comparison-only and hypothesis-bound", () => {
    const input = buildComparisonPreferenceInterpretationInput(
      "11と12なら12がいい",
      buildAprilCandidates([11, 12]),
    );
    const prompt = buildComparisonPreferenceMessages(input).systemPrompt;

    expectPromptReviewChecklist(prompt);
    expect(prompt).toContain("plain preference を新しく作ってはいけません。plain preference は前段で確定済みです。");
    expect(prompt).toContain("comparison でないものを comparison にしない。");
    expect(prompt).toContain("judgment.kind に comparison 以外を入れてはいけません。");
    expect(prompt).toContain("invent するくらいなら judgments を空にする。");
  });

  it("keeps the condition system prompt from inventing hidden baseline emotions or availability", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "他の人がみんな行けるなら11がいい",
      buildAprilCandidates([11, 12]),
    );
    const targetTokenIndex = findTokenIndex(executionInput, "11");
    const markerTokenIndex = findTokenIndex(executionInput, /がいい/);
    const input = buildConditionInterpretationInputFromExecutionInput(executionInput, {
      finalPreferences: [
        {
          targetTokenIndexes: [targetTokenIndex],
          targetText: "11",
          targetLabels: ["target_numeric_candidate"],
          targetNormalizedTexts: [],
          markerTokenIndexes: [markerTokenIndex],
          markerTexts: ["がいい"],
          markerLabels: ["preference_positive_marker"],
          level: "preferred",
          notes: [],
          sourceComment: executionInput.originalText,
        },
      ],
    });
    const prompt = buildConditionInterpretationMessages(input).systemPrompt;

    expectPromptReviewChecklist(prompt);
    expect(prompt).toContain("暗黙の本音や baseline の dislike / no を invent しない。");
    expect(prompt).toContain("条件が未達成のときの hidden preference / hidden dislike / hidden no を推定してはいけません。");
    expect(prompt).toContain("返してよい top-level key は conditions と warnings だけです。");
    expect(prompt).toContain("不確かなら壊れた condition を返すより conditions を空にしてください。");
  });

  it("keeps the grouping system prompt selection-only and fallback-safe", () => {
    const sequence: DateSequenceInterpretation = {
      sequenceId: "seq-review",
      sourceText: "11,12",
      span: { start: 0, end: 5 },
      connectors: [{ text: ",", start: 2, end: 3, type: "comma" }],
      targets: [
        {
          targetId: "t1",
          text: "11",
          normalizedValue: "2026-04-11",
          start: 0,
          end: 2,
          sourceTargetKind: "date",
          sourceTargetIndex: 0,
          derivedFromRange: false,
        },
        {
          targetId: "t2",
          text: "12",
          normalizedValue: "2026-04-12",
          start: 3,
          end: 5,
          sourceTargetKind: "date",
          sourceTargetIndex: 1,
          derivedFromRange: false,
        },
      ],
      context: {
        originalText: "11,12ならいける",
        normalizedText: "11,12ならいける",
        beforeText: "",
        afterText: "ならいける",
      },
      groupingHypotheses: [
        {
          hypothesisId: "h1",
          kind: "single_group",
          groups: [["t1", "t2"]],
          evidence: ["single_adjacent_sequence"],
        },
        {
          hypothesisId: "h2",
          kind: "isolated_targets",
          groups: [["t1"], ["t2"]],
          evidence: ["connector_is_ambiguous"],
        },
      ],
    };
    const prompt = buildGroupingSelectionMessages(toLlmGroupingSelectionInput(sequence)).systemPrompt;

    expectPromptReviewChecklist(prompt);
    expect(prompt).toContain("判断できない場合は無理に選ばず undetermined を返す。");
    expect(prompt).toContain("返してよい key は selectedHypothesisId / decision / reasonCodes だけです。");
    expect(prompt).toContain("hypothesis を編集しない。");
  });
});
