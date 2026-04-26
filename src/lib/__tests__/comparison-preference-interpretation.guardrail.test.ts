import { describe, expect, it, vi } from "vitest";
import {
  buildAutoInterpretationPreferencesFromJudgments,
  buildComparisonPreferenceInterpretationInput,
  buildComparisonPreferenceMessages,
  buildRankingPreferenceSignalsFromJudgments,
  interpretComparisonPreferences,
  validateComparisonPreferenceOutput,
  ComparisonPreferenceValidationError,
  type ComparisonPreferenceInterpretationInput,
} from "@/lib/comparison-preference-interpretation";
import type { EventCandidateRecord } from "@/lib/domain";

function buildAllDayCandidate(dateValue: string, sortOrder: number): EventCandidateRecord {
  return {
    id: `candidate-${dateValue}`,
    eventId: "event-comparison-preference",
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

function findClause(
  input: ComparisonPreferenceInterpretationInput,
  clauseTextPattern: RegExp,
) {
  const clause = input.relevantClauses.find((candidate) => clauseTextPattern.test(candidate.text));

  if (!clause) {
    throw new Error(`Relevant clause not found for ${String(clauseTextPattern)} in "${input.originalText}"`);
  }

  return clause;
}

function findTargetGroupId(
  input: ComparisonPreferenceInterpretationInput,
  clauseTextPattern: RegExp,
  hypothesisId: string,
  expectedTexts: string[],
) {
  const clause = findClause(input, clauseTextPattern);
  const hypothesis = clause.groupingHypotheses.find((candidate) => candidate.hypothesisId === hypothesisId);

  if (!hypothesis) {
    throw new Error(`Hypothesis ${hypothesisId} not found for clause "${clause.text}"`);
  }

  const targetGroup = hypothesis.targetGroups.find(
    (candidate) => JSON.stringify(candidate.texts) === JSON.stringify(expectedTexts),
  );

  if (!targetGroup) {
    throw new Error(
      `Target group ${JSON.stringify(expectedTexts)} not found in hypothesis ${hypothesisId} for clause "${clause.text}"`,
    );
  }

  return targetGroup.id;
}

function findTriggerTokenIndex(
  input: ComparisonPreferenceInterpretationInput,
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const matches = input.tokens.filter((token) => {
    const labelMatch = !options.label || token.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? token.text === options.text : options.text.test(token.text));

    return labelMatch && textMatch;
  });

  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${input.originalText}"`,
    );
  }

  return match.index;
}

function mockOllamaJson(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      message: {
        content: JSON.stringify(payload),
      },
    }),
  });
}

describe("comparison preference interpretation guardrails", () => {
  it("builds relevant clauses and grouping hypotheses for date-time comparisons", () => {
    const input = buildComparisonPreferenceInterpretationInput(
      "10日夜と11日夜なら11日夜がいい",
      buildAprilCandidates([10, 11]),
    );

    expect(input.relevantClauses).toHaveLength(1);
    expect(input.relevantClauses[0]?.groupingHypotheses.some((hypothesis) =>
      hypothesis.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["10日", "夜"])),
    )).toBe(true);
    expect(input.relevantClauses[0]?.groupingHypotheses.some((hypothesis) =>
      hypothesis.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11日", "夜"])),
    )).toBe(true);
  });

  it("includes availability-stage targetContexts when building comparison/preference input", () => {
    const input = buildComparisonPreferenceInterpretationInput(
      "11,12なら13がいい",
      buildAprilCandidates([11, 12, 13]),
      {
        availabilityRules: [
          {
            targetTokens: [{ text: "11", label: "target_date", normalizedText: "2026-04-11" }],
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            residualOfTokens: [],
            availabilityTokenIndexes: [99],
            availabilityText: "行ける",
            availabilityLabel: "availability_positive",
            modifierTokenIndexes: [],
            modifierTexts: [],
            modifierLabels: [],
            residualOfTokenIndexes: [],
            residualOfTargetGroups: [],
            exceptionTargetTokens: [],
            exceptionTargetTokenIndexes: [],
            contrastClauseTokenIndexes: [],
            notes: [],
            sourceComment: "11は行ける",
          },
        ],
        targetContexts: [
          {
            targetTokenIndexes: [5],
            relationContext: [
              {
                kind: "conditional_choice_scope",
                hint: "comparison_candidate",
                relatedTargetGroupIds: ["tg1", "tg2"],
                markerTokenIndexes: [3],
              },
            ],
          },
        ],
      },
    );

    expect(input.targetContexts).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [5],
        relationContext: [
          expect.objectContaining({
            kind: "conditional_choice_scope",
            hint: "comparison_candidate",
            relatedTargetGroupIds: ["tg1", "tg2"],
            markerTokenIndexes: [3],
          }),
        ],
      }),
    ]);
    expect(input.availabilityRules).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [0],
        availabilityLabel: "availability_positive",
        targetText: "11",
      }),
    ]);

    const prompts = buildComparisonPreferenceMessages(input);
    expect(prompts.userPrompt).toContain('"targetContexts"');
    expect(prompts.userPrompt).toContain('"availabilityRules"');
  });

  it("absorbs duplicate preference judgments when the same evidence already produced a comparison", () => {
    const candidates = buildAprilCandidates([11, 12]);
    const input = buildComparisonPreferenceInterpretationInput("11より12がいい", candidates);
    const dispreferredId = findTargetGroupId(input, /11より12がいい/u, "gh-default", ["11"]);
    const preferredId = findTargetGroupId(input, /11より12がいい/u, "gh-default", ["12"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "comparison_marker", text: /より/ });

    const judgments = [
      {
        groupingHypothesisId: "gh-default",
        kind: "comparison" as const,
        comparedTargetGroupIds: [dispreferredId, preferredId],
        preferredTargetGroupId: preferredId,
        dispreferredTargetGroupIds: [dispreferredId],
        relation: "better_than" as const,
        strength: "strong" as const,
        confidence: "high" as const,
        triggerTokenIndexes: [markerIndex],
        supportingClauseIndexes: [0],
        notes: null,
      },
      {
        groupingHypothesisId: "gh-default",
        kind: "preference" as const,
        comparedTargetGroupIds: [preferredId],
        preferredTargetGroupId: preferredId,
        dispreferredTargetGroupIds: [],
        relation: "preferred" as const,
        strength: "strong" as const,
        confidence: "high" as const,
        triggerTokenIndexes: [markerIndex],
        supportingClauseIndexes: [0],
        notes: null,
      },
    ];

    const signals = buildRankingPreferenceSignalsFromJudgments(input, judgments);
    const preferences = buildAutoInterpretationPreferencesFromJudgments(input, judgments);

    expect(signals).toEqual([
      expect.objectContaining({
        targetGroupId: preferredId,
        signal: "preferred",
      }),
      expect.objectContaining({
        targetGroupId: dispreferredId,
        signal: "dispreferred",
      }),
    ]);
    expect(signals.filter((signal) => signal.targetGroupId === preferredId && signal.signal === "preferred")).toHaveLength(1);
    expect(preferences).toEqual([]);
  });

  it("returns a structured explicit comparison without changing availability behavior", async () => {
    const candidates = buildAprilCandidates([10, 11]);
    const input = buildComparisonPreferenceInterpretationInput("10と11なら11がいい", candidates);
    const mergedHypothesisId = "gh-merge-1";
    const comparedSetId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["10", "11"]);
    const preferredId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["11"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "preference_positive_marker", text: /がいい/ });
    const conditionIndex = findTriggerTokenIndex(input, { label: "conditional_marker", text: "なら" });

    const fetchMock = mockOllamaJson({
      judgments: [
        {
          groupingHypothesisId: mergedHypothesisId,
          kind: "comparison",
          comparedTargetGroupIds: [comparedSetId, preferredId],
          preferredTargetGroupId: preferredId,
          dispreferredTargetGroupIds: [comparedSetId],
          relation: "better_than",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [conditionIndex, markerIndex],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      warnings: [],
    });

    const result = await interpretComparisonPreferences("10と11なら11がいい", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.relevantClauseIndexes).toEqual([0]);
    expect(result.warnings).toEqual([]);
    expect(result.judgments).toEqual([
      expect.objectContaining({
        groupingHypothesisId: mergedHypothesisId,
        kind: "comparison",
        comparedTargetGroupIds: [comparedSetId, preferredId],
        preferredTargetGroupId: preferredId,
        relation: "better_than",
        strength: "strong",
        confidence: "high",
      }),
    ]);
  });

  it("returns explicit date-time comparisons with default target groups", async () => {
    const candidates = buildAprilCandidates([10, 11]);
    const input = buildComparisonPreferenceInterpretationInput("10日の午前より11日の午後の方がいい", candidates);
    const preferredId = findTargetGroupId(input, /10日の午前より11日の午後/u, "gh-default", ["11日", "午後"]);
    const otherId = findTargetGroupId(input, /10日の午前より11日の午後/u, "gh-default", ["10日", "午前"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "comparison_marker", text: /より|方が/ });

    const result = await interpretComparisonPreferences("10日の午前より11日の午後の方がいい", candidates, {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "comparison",
            comparedTargetGroupIds: [otherId, preferredId],
            preferredTargetGroupId: preferredId,
            dispreferredTargetGroupIds: [otherId],
            relation: "better_than",
            strength: "strong",
            confidence: "high",
            triggerTokenIndexes: [markerIndex],
            supportingClauseIndexes: [0],
            notes: null,
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.judgments[0]).toMatchObject({
      groupingHypothesisId: "gh-default",
      preferredTargetGroupId: preferredId,
      relation: "better_than",
    });
  });

  it("returns explicit weekday comparisons", async () => {
    const candidates = buildAprilCandidates([10, 11]);
    const input = buildComparisonPreferenceInterpretationInput("金土なら土の方がいい", candidates);
    const groupId = findTargetGroupId(input, /金土なら土/u, "gh-default", ["金土"]);
    const preferredId = findTargetGroupId(input, /金土なら土/u, "gh-default", ["土"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "comparison_marker", text: /方がいい/ });

    const result = await interpretComparisonPreferences("金土なら土の方がいい", candidates, {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "comparison",
            comparedTargetGroupIds: [groupId, preferredId],
            preferredTargetGroupId: preferredId,
            dispreferredTargetGroupIds: [groupId],
            relation: "better_than",
            strength: "weak",
            confidence: "medium",
            triggerTokenIndexes: [markerIndex],
            supportingClauseIndexes: [0],
            notes: null,
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.judgments[0]).toMatchObject({
      kind: "comparison",
      preferredTargetGroupId: preferredId,
      confidence: "medium",
    });
  });

  it("returns weak preferences without forcing a comparison", async () => {
    const candidates = buildAprilCandidates([11, 12]);
    const input = buildComparisonPreferenceInterpretationInput("どっちかといえば11", candidates);
    const preferredId = findTargetGroupId(input, /どっちかといえば11/u, "gh-default", ["11"]);
    const weakIndex = findTriggerTokenIndex(input, { text: /どっちかといえば/ });

    const result = await interpretComparisonPreferences("どっちかといえば11", candidates, {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "preference",
            comparedTargetGroupIds: [preferredId],
            preferredTargetGroupId: preferredId,
            dispreferredTargetGroupIds: [],
            relation: "preferred",
            strength: "weak",
            confidence: "medium",
            triggerTokenIndexes: [weakIndex],
            supportingClauseIndexes: [0],
            notes: null,
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.judgments[0]).toMatchObject({
      kind: "preference",
      preferredTargetGroupId: preferredId,
      strength: "weak",
      confidence: "medium",
    });
  });

  it("keeps mixed availability comments scoped to preference/comparison clauses only", async () => {
    const candidates = buildAprilCandidates([10, 11, 12]);
    const input = buildComparisonPreferenceInterpretationInput("平日は無理、土の方がいい", candidates);
    const preferredId = findTargetGroupId(input, /土の方がいい/u, "gh-default", ["土"]);
    const weekdayId = findTargetGroupId(input, /土の方がいい/u, "gh-default", ["平日"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "comparison_marker", text: /方がいい/ });

    const result = await interpretComparisonPreferences("平日は無理、土の方がいい", candidates, {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "comparison",
            comparedTargetGroupIds: [weekdayId, preferredId],
            preferredTargetGroupId: preferredId,
            dispreferredTargetGroupIds: [weekdayId],
            relation: "better_than",
            strength: "weak",
            confidence: "medium",
            triggerTokenIndexes: [markerIndex],
            supportingClauseIndexes: [1],
            notes: null,
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.relevantClauseIndexes).toEqual([1]);
    expect(result.judgments).toHaveLength(1);
    expect(result.judgments[0]?.preferredTargetGroupId).toBe(preferredId);
  });

  it("allows low-confidence unknown judgments for ambiguous preference phrasing", async () => {
    const candidates = buildAprilCandidates([11, 12]);
    const input = buildComparisonPreferenceInterpretationInput("11がいいかも", candidates);
    const targetId = findTargetGroupId(input, /11がいいかも/u, "gh-default", ["11"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "preference_positive_marker", text: /がいい/ });

    const result = await interpretComparisonPreferences("11がいいかも", candidates, {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "preference",
            comparedTargetGroupIds: [targetId],
            preferredTargetGroupId: null,
            dispreferredTargetGroupIds: [],
            relation: "unknown",
            strength: "unknown",
            confidence: "low",
            triggerTokenIndexes: [markerIndex],
            supportingClauseIndexes: [0],
            notes: "ambiguous_preference",
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.judgments[0]).toMatchObject({
      preferredTargetGroupId: null,
      relation: "unknown",
      confidence: "low",
    });
  });

  it("includes emotion weak-accept clauses in the LLM input and prompt", () => {
    const input = buildComparisonPreferenceInterpretationInput("11でもいい", buildAprilCandidates([11, 12]));
    const clause = findClause(input, /11でもいい/u);
    const { systemPrompt, userPrompt } = buildComparisonPreferenceMessages(input);

    expect(clause.text).toBe("11でもいい");
    expect(clause.triggerTexts).toContain("でもいい");
    expect(clause.groupingHypotheses[0]?.localTargetGroupIds).toHaveLength(1);
    expect(clause.groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11"]))).toBe(true);
    expect(systemPrompt).toContain("emotion_weak_accept_marker は availability ではなく、弱い許容・消極的な受容の手がかりです。");
    expect(systemPrompt).toContain("originalText と tokens は全文文脈です。");
    expect(systemPrompt).toContain("weak accept は availability ではなく");
    expect(userPrompt).toContain("emotion_weak_accept_marker");
    expect(userPrompt).toContain("originalText / tokens / groupingHypotheses は全文文脈です。");
  });

  it("keeps negative feeling clauses available as preference material without reclassifying availability", () => {
    const input = buildComparisonPreferenceInterpretationInput("11はいけるけど嫌", buildAprilCandidates([11, 12]));
    const clause = findClause(input, /^嫌$/u);

    expect(clause.tokenIndexes.map((tokenIndex) => input.tokens[tokenIndex]?.label)).toEqual([
      "preference_negative_marker",
    ]);
    expect(input.tokens.some((token) => token.label === "availability_negative" && token.text === "嫌")).toBe(false);
  });

  it("keeps single-target dislike clauses tied to their explicit date context", () => {
    const input = buildComparisonPreferenceInterpretationInput("11は嫌", buildAprilCandidates([11, 12]));
    const clause = findClause(input, /11は嫌/u);

    expect(clause.text).toBe("11は嫌");
    expect(clause.groupingHypotheses[0]?.localTargetGroupIds).toHaveLength(1);
    expect(clause.groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11"]))).toBe(true);
  });

  it("keeps fallback date targets available in later weak-accept clauses", () => {
    const input = buildComparisonPreferenceInterpretationInput("10がいいけど11でもいい", buildAprilCandidates([10, 11]));
    const firstClause = findClause(input, /^10がいい$/u);
    const secondClause = findClause(input, /11でもいい/u);

    expect(firstClause.groupingHypotheses[0]?.localTargetGroupIds).toHaveLength(1);
    expect(firstClause.groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["10"]))).toBe(true);
    expect(secondClause.text).toBe("11でもいい");
    expect(secondClause.groupingHypotheses[0]?.localTargetGroupIds).toHaveLength(1);
    expect(secondClause.groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11"]))).toBe(true);
  });

  it("keeps both weak-accept clauses when each side names a different date", () => {
    const input = buildComparisonPreferenceInterpretationInput("10でもいいし、11でもいい", buildAprilCandidates([10, 11]));

    expect(input.relevantClauses).toHaveLength(2);
    expect(findClause(input, /10でもいいし/u).groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["10"]))).toBe(true);
    expect(findClause(input, /11でもいい/u).groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11"]))).toBe(true);
  });

  it("keeps unlabeled condition text inside the clause context for downstream LLM judgment", () => {
    const input = buildComparisonPreferenceInterpretationInput("遅いなら11がいい", buildAprilCandidates([10, 11]));
    const clause = findClause(input, /遅いなら11がいい/u);

    expect(clause.text).toBe("遅いなら11がいい");
    expect(clause.groupingHypotheses[0]?.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(["11"]))).toBe(true);
  });

  it("does not call Ollama for plain availability clauses", async () => {
    const fetchMock = vi.fn();

    const result = await interpretComparisonPreferences("11ならいける", buildAprilCandidates([11, 12]), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.judgments).toEqual([]);
    expect(result.relevantClauseIndexes).toEqual([]);
  });

  it("rejects judgments that reference unknown target groups", () => {
    const input = buildComparisonPreferenceInterpretationInput("11がいい", buildAprilCandidates([11, 12]));

    expect(() =>
      validateComparisonPreferenceOutput(
        {
          judgments: [
            {
              groupingHypothesisId: "gh-default",
              kind: "preference",
              comparedTargetGroupIds: ["tg-missing"],
              preferredTargetGroupId: "tg-missing",
              dispreferredTargetGroupIds: [],
              relation: "preferred",
              strength: "strong",
              confidence: "high",
              triggerTokenIndexes: [0],
              supportingClauseIndexes: [0],
              notes: null,
            },
          ],
          warnings: [],
        },
        input,
      ),
    ).toThrow(ComparisonPreferenceValidationError);
  });

  it("fails safely when the model returns malformed judgments", async () => {
    const result = await interpretComparisonPreferences("11がいい", buildAprilCandidates([11, 12]), {
      fetchImpl: mockOllamaJson({
        judgments: [
          {
            groupingHypothesisId: "gh-default",
            kind: "preference",
            comparedTargetGroupIds: [],
            preferredTargetGroupId: "tg-unknown",
            relation: "preferred",
            strength: "strong",
            confidence: "high",
            triggerTokenIndexes: [0],
            supportingClauseIndexes: [0],
            notes: null,
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.judgments).toEqual([]);
    expect(result.warnings.some((warning) => /target group|comparedTargetGroupIds|validation/i.test(warning))).toBe(true);
  });
});
