import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
  buildAvailabilityInterpretationExecutionInputForGroupingHypothesis,
  buildDerivedResponseFromAvailabilityInterpretation,
} from "@/lib/availability-comment-interpretation";
import { buildComparisonPreferenceInterpretationInput } from "@/lib/comparison-preference-interpretation";
import {
  interpretAvailabilityCommentSubmissionWithOllama,
  interpretAvailabilityCommentWithOllama,
} from "@/lib/availability-comment-interpretation-server";
import type { EventCandidateRecord } from "@/lib/domain";

function buildCandidates(): EventCandidateRecord[] {
  return [
    {
      id: "candidate-april",
      eventId: "event-april",
      date: "2026-04-01",
      timeSlotKey: "all_day",
      selectionMode: "range",
      dateType: "range",
      startDate: "2026-04-01",
      endDate: "2026-04-12",
      selectedDates: [],
      timeType: "all_day",
      startTime: null,
      endTime: null,
      note: null,
      sortOrder: 10,
    },
  ];
}

function buildDiscreteDayCandidates(days: number[], timeSlotKey: "all_day" | "day" | "night" = "all_day"): EventCandidateRecord[] {
  return days.map((day, index) => ({
    id: `candidate-${day}-${timeSlotKey}`,
    eventId: "event-april",
    date: `2026-04-${String(day).padStart(2, "0")}`,
    timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(day).padStart(2, "0")}`,
    endDate: `2026-04-${String(day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: timeSlotKey === "all_day" ? "all_day" : "fixed",
    startTime: timeSlotKey === "night" ? "18:00" : timeSlotKey === "day" ? "12:00" : null,
    endTime: timeSlotKey === "night" ? "22:00" : timeSlotKey === "day" ? "17:00" : null,
    note: null,
    sortOrder: index + 1,
  }));
}

function buildRangeCandidate(
  startDay: number,
  endDay: number,
  timeSlotKey: "all_day" | "unspecified" | "night" = "all_day",
): EventCandidateRecord[] {
  return [
    {
      id: `candidate-range-${startDay}-${endDay}-${timeSlotKey}`,
      eventId: "event-april",
      date: `2026-04-${String(startDay).padStart(2, "0")}`,
      timeSlotKey,
      selectionMode: "range",
      dateType: startDay === endDay ? "single" : "range",
      startDate: `2026-04-${String(startDay).padStart(2, "0")}`,
      endDate: `2026-04-${String(endDay).padStart(2, "0")}`,
      selectedDates: [],
      timeType: timeSlotKey === "all_day" ? "all_day" : timeSlotKey === "unspecified" ? "unspecified" : "fixed",
      startTime: timeSlotKey === "night" ? "18:00" : null,
      endTime: timeSlotKey === "night" ? "22:00" : null,
      note: null,
      sortOrder: 1,
    },
  ];
}

function buildFixedTimeCandidates(
  entries: Array<{
    day: number;
    timeSlotKey: "morning" | "day" | "night";
  }>,
): EventCandidateRecord[] {
  return entries.map((entry, index) => ({
    id: `candidate-${entry.day}-${entry.timeSlotKey}`,
    eventId: "event-april",
    date: `2026-04-${String(entry.day).padStart(2, "0")}`,
    timeSlotKey: entry.timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(entry.day).padStart(2, "0")}`,
    endDate: `2026-04-${String(entry.day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: "fixed",
    startTime: entry.timeSlotKey === "morning" ? "09:00" : entry.timeSlotKey === "day" ? "13:00" : "18:00",
    endTime: entry.timeSlotKey === "morning" ? "12:00" : entry.timeSlotKey === "day" ? "17:00" : "22:00",
    note: null,
    sortOrder: index + 1,
  }));
}

function findClauseTargetGroupId(
  comment: string,
  candidates: EventCandidateRecord[],
  clausePattern: RegExp,
  hypothesisId: string,
  expectedTexts: string[],
) {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
  const clause = input.relevantClauses.find((candidate) => clausePattern.test(candidate.text));

  if (!clause) {
    throw new Error(`Relevant clause not found for ${String(clausePattern)} in "${comment}"`);
  }

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

function findComparisonTriggerTokenIndex(
  comment: string,
  candidates: EventCandidateRecord[],
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
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
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${comment}"`,
    );
  }

  return match.index;
}

function findTokenIndex(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const matches = executionInput.tokens.filter((token) => {
    const labelMatch = !options.label || token.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? token.text === options.text : options.text.test(token.text));

    return labelMatch && textMatch;
  });

  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${executionInput.originalText}"`,
    );
  }

  return match.index;
}

describe("availability comment auto interpretation", () => {
  it("builds grouping input, calls Ollama, validates the graph, and produces structured rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [2],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [5],
                availabilityTokenIndexes: [7],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("5日はたぶんいける、6日は無理ではない", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "http://127.0.0.1:11434/api",
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      format: Record<string, unknown>;
      messages: Array<{ role: string; content: string }>;
    };

    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.model).toBe("mock-model");
    expect(body.stream).toBe(false);
    expect(body.format).toBeTruthy();
    expect(body.messages[0]?.content).toContain("condition_for");
    expect(body.messages[1]?.content).toContain('"targetGroups"');
    expect(body.messages[1]?.content).toContain('"availabilityGroups"');

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]).toMatchObject({
      targetText: "5日",
      availabilityText: "いける",
      modifierTexts: ["たぶん"],
    });
    expect(result.rules[1]).toMatchObject({
      targetText: "6日",
      availabilityText: "無理ではない",
    });
  });

  it("builds submission-ready answers and parsed constraints from the validated auto graph", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("5日は無理", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.usedDefault).toBe(false);
    expect(result.defaultReason).toBeNull();
    expect(result.parsedConstraints).toHaveLength(1);
    expect(result.parsedConstraints[0]).toMatchObject({
      level: "hard_no",
      source: "auto_llm",
      reasonText: "5日は無理",
    });
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.availabilityKey).toBe("no");
  });

  it("treats 12ならいける as conditional availability without using condition_for", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [1],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("12ならいける", buildDiscreteDayCandidates([12]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "12",
      availabilityText: "いける",
      modifierLabels: ["conditional_marker"],
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({
        targetValue: "2026-04-12",
        level: "conditional",
      }),
    ]);
  });

  it("keeps residual interpretation tied to prior target groups only when the graph is explicit", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "平日は無理、5日は午前が無理、あとはいける",
      buildCandidates(),
    );
    const weekdayIndex = findTokenIndex(executionInput, { label: "target_weekday_group", text: /平日/ });
    const dayFiveIndex = findTokenIndex(executionInput, { label: "target_date", text: /5/ });
    const morningIndex = findTokenIndex(executionInput, { label: "target_time_of_day", text: /午前/ });
    const residualIndex = findTokenIndex(executionInput, { label: "scope_residual" });
    const positiveIndex = findTokenIndex(executionInput, { label: "availability_positive", text: /いける/ });
    const negativeIndexes = [
      findTokenIndex(executionInput, { label: "availability_negative", text: /無理/, nth: 0 }),
      findTokenIndex(executionInput, { label: "availability_negative", text: /無理/, nth: 1 }),
    ];
    const residualMarkers = executionInput.tokens
      .filter((token) => token.index < residualIndex && (token.label === "punctuation_boundary" || token.label === "conjunction_parallel"))
      .slice(-2)
      .map((token) => token.index);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [weekdayIndex],
                availabilityTokenIndexes: [negativeIndexes[0]],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [dayFiveIndex, morningIndex],
                availabilityTokenIndexes: [negativeIndexes[1]],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [residualIndex],
                availabilityTokenIndexes: [positiveIndex],
                confidence: "medium",
              },
              {
                relation: "residual_of",
                sourceTokenIndexes: [residualIndex],
                targetTokenIndexes: [weekdayIndex, dayFiveIndex, morningIndex],
                markerTokenIndexes: residualMarkers,
                confidence: "medium",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日は無理、5日は午前が無理、あとはいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules[2]?.targetText).toBe("あとは");
    expect(result.rules[2]?.residualOfTokenIndexes).toEqual([weekdayIndex, dayFiveIndex, morningIndex]);
    expect(result.rules[2]?.notes).toContain("残り範囲: 平日 / 5日 / 午前 の残り");
  });

  it("keeps prior target context for residual clauses even across sentence boundaries", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "10〜13は無理です。12日の夜ならいけます。それ以外は大丈夫です。",
      buildRangeCandidate(1, 20),
    );
    const residualClause = executionInput.grouping.clauseGroups.find((group) =>
      group.appliesToTargetTokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "scope_residual"),
    );

    expect(residualClause?.appliesToTargetTokenIndexes).toEqual([12]);
    expect(residualClause?.contextTargetGroups).toEqual([
      { id: "tg1", tokenIndexes: [0] },
      { id: "tg2", tokenIndexes: [5, 7] },
    ]);
  });

  it("canonicalizes residual clauses when the model omits residual_of for a clear prior target set", async () => {
    const candidates = [
      ...buildDiscreteDayCandidates([10, 11, 12, 13, 14], "all_day"),
      ...buildDiscreteDayCandidates([12], "night"),
    ];
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "10〜13は無理です。ただ、12日の夜ならいけます。それ以外は大丈夫です。",
      candidates,
    );
    const rangeTarget = executionInput.grouping.targetGroups.find((group) =>
      group.tokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.text === "10〜13"),
    );
    const dateNightTarget = executionInput.grouping.targetGroups.find((group) => {
      const texts = group.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]?.text);
      return texts.includes("12日") && texts.includes("夜");
    });
    const residualScope = executionInput.grouping.scopeGroups.find((group) =>
      group.tokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "scope_residual"),
    );
    const negativeAvailability = executionInput.grouping.availabilityGroups.find((group) =>
      group.tokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "availability_negative"),
    );
    const positiveAvailabilityGroups = executionInput.grouping.availabilityGroups.filter((group) =>
      group.tokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "availability_positive"),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: rangeTarget?.tokenIndexes,
                availabilityTokenIndexes: negativeAvailability?.tokenIndexes,
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: dateNightTarget?.tokenIndexes,
                availabilityTokenIndexes: positiveAvailabilityGroups[0]?.tokenIndexes,
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: residualScope?.tokenIndexes,
                availabilityTokenIndexes: positiveAvailabilityGroups[1]?.tokenIndexes,
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(
      "10〜13は無理です。ただ、12日の夜ならいけます。それ以外は大丈夫です。",
      candidates,
      {
        fetchImpl: fetchMock as typeof fetch,
        model: "mock-model",
      },
    );

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(3);
    expect(result.autoInterpretation.rules[2]?.targetText).toBe("それ以外は");
    expect(result.autoInterpretation.rules[2]?.residualOfTokenIndexes).toEqual([0, 7, 9]);
    expect(result.parsedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetValue: "2026-04-10", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-11", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-12", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-13", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-12_night", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-12_night", level: "conditional" }),
        expect.objectContaining({ targetValue: "2026-04-14", level: "strong_yes" }),
      ]),
    );
  });

  it("builds grouping hypotheses for mixed-separator date lists", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "行ける日は11,12、13,14だけ",
      buildRangeCandidate(1, 20),
    );

    expect(executionInput.grouping.targetGroups.map((group) => group.tokenIndexes)).toEqual([[2], [4], [6], [8]]);
    expect(executionInput.groupingHypotheses).toHaveLength(5);
    expect(
      executionInput.groupingHypotheses.some(
        (hypothesis) =>
          hypothesis.kind === "merge_list_cluster" &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4,6,8"),
      ),
    ).toBe(true);
    expect(
      executionInput.groupingHypotheses.some(
        (hypothesis) =>
          hypothesis.kind === "split_list_cluster" &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4") &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "6,8"),
      ),
    ).toBe(true);
  });

  it("can anchor an availability clause to a selected post-predicate target group", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "行ける日は11,12、13,14だけ",
      buildRangeCandidate(1, 20),
    );
    const splitHypothesis = executionInput.groupingHypotheses.find(
      (hypothesis) =>
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4") &&
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "6,8"),
    );
    const selected = buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
      executionInput,
      splitHypothesis?.id ?? null,
    );

    expect(selected.grouping.clauseGroups[0]?.appliesToTargetTokenIndexes).toEqual([2, 4]);
  });

  it("selects a grouping hypothesis before relation generation when alternatives exist", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "行ける日は11,12、13,14は無理",
      buildDiscreteDayCandidates([11, 12, 13, 14]),
    );
    const splitHypothesis = executionInput.groupingHypotheses.find(
      (hypothesis) =>
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4") &&
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "6,8"),
    );
    const selected = buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
      executionInput,
      splitHypothesis?.id ?? null,
    );
    const positiveAvailability = selected.grouping.availabilityGroups.find((group) =>
      group.tokenIndexes.some((tokenIndex) => selected.tokens[tokenIndex]?.label === "availability_positive"),
    );
    const negativeAvailability = selected.grouping.availabilityGroups.find((group) =>
      group.tokenIndexes.some((tokenIndex) => selected.tokens[tokenIndex]?.label === "availability_negative"),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              selectedHypothesisId: splitHypothesis?.id ?? null,
              confidence: "high",
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [2, 4],
                  availabilityTokenIndexes: positiveAvailability?.tokenIndexes,
                  confidence: "high",
                },
                {
                  relation: "applies_to",
                  targetTokenIndexes: [6, 8],
                  availabilityTokenIndexes: negativeAvailability?.tokenIndexes,
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(
      "行ける日は11,12、13,14は無理",
      buildDiscreteDayCandidates([11, 12, 13, 14]),
      {
        fetchImpl: fetchMock as typeof fetch,
        model: "mock-model",
      },
    );

    expect(result.autoInterpretation.rules).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetValue: "2026-04-11", level: "strong_yes" }),
        expect.objectContaining({ targetValue: "2026-04-12", level: "strong_yes" }),
        expect.objectContaining({ targetValue: "2026-04-13", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-14", level: "hard_no" }),
      ]),
    );
  });

  it("canonicalizes dropped semantic modifiers onto applies_to before validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0],
                  availabilityTokenIndexes: [3],
                  confidence: "high",
                },
                {
                  relation: "applies_to",
                  targetTokenIndexes: [5],
                  availabilityTokenIndexes: [7],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0],
                  availabilityTokenIndexes: [3],
                  modifierTokenIndexes: [2],
                  confidence: "high",
                },
                {
                  relation: "applies_to",
                  targetTokenIndexes: [5],
                  availabilityTokenIndexes: [7],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentWithOllama("5日はたぶんいける、6日は無理ではない", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.rules[0]?.modifierTexts).toEqual(["たぶん"]);
  });

  it("deduplicates identical applies_to links before building UI rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [2],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("18日はたぶんいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      targetText: "18日",
      availabilityText: "いける",
      modifierTexts: ["たぶん"],
    });
  });

  it("canonicalizes flattened exception clauses into scope applies_to and exception_to", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0, 2],
                  availabilityTokenIndexes: [4],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [3],
                  availabilityTokenIndexes: [4],
                  confidence: "high",
                },
                {
                  relation: "exception_to",
                  sourceTokenIndexes: [3],
                  targetTokenIndexes: [0, 2],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentWithOllama("金曜の夜以外はいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.rules[0]).toMatchObject({
      targetText: "以外は",
      availabilityText: "いける",
      exceptionTargetTokenIndexes: [0, 2],
    });
    expect(result.rules[0]?.notes).toContain("除外対象: 金曜 / 夜");
  });

  it("fails safely when Ollama returns invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: "not-json",
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日は無理", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.rules).toEqual([]);
    expect(result.failureReason).toContain("valid JSON");
  });

  it("fails safely when Ollama returns a forbidden relation", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "平日ならいけるけど金曜は厳しい",
      buildCandidates(),
    );
    const weekdayIndex = findTokenIndex(executionInput, { label: "target_weekday_group", text: /平日/ });
    const positiveIndex = findTokenIndex(executionInput, { label: "availability_positive", text: /いける/ });
    const conditionMarkers = executionInput.tokens
      .filter((token) => token.text === "なら" && (token.label === "conditional_marker" || token.label === "particle_condition"))
      .map((token) => token.index);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "condition_for",
                sourceTokenIndexes: [weekdayIndex],
                targetTokenIndexes: [positiveIndex],
                markerTokenIndexes: conditionMarkers,
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日ならいけるけど金曜は厳しい", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("Only applies_to, contrast_with, residual_of, and exception_to are supported.");
  });

  it("builds composite target groups deterministically before calling the model", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("5日は午前が無理", buildCandidates());

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "5日", "target_date"],
      [1, "は", "particle_topic"],
      [2, "午前", "target_time_of_day"],
      [3, "無理", "availability_negative"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
    expect(executionInput.grouping.availabilityGroups).toEqual([{ id: "ag1", tokenIndexes: [3] }]);
    expect(executionInput.grouping.clauseGroups).toEqual([
      {
        id: "cg1",
        tokenIndexes: [0, 2, 3],
        anchorGroupId: "tg1",
        availabilityGroupId: "ag1",
        appliesToTargetTokenIndexes: [0, 2],
        contextTargetGroupIds: ["tg1"],
        contextTargetGroups: [{ id: "tg1", tokenIndexes: [0, 2] }],
        semanticModifierTokenIndexes: [],
      },
    ]);
  });

  it("keeps safe bare numeric targets for availability, limit, and exception clauses", () => {
    const conditional = buildAvailabilityInterpretationExecutionInput("10ならいける", buildCandidates());
    const limited = buildAvailabilityInterpretationExecutionInput("10だけいける", buildCandidates());
    const exceptive = buildAvailabilityInterpretationExecutionInput("10以外無理", buildCandidates());

    expect(conditional.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_date"],
      [1, "なら", "conditional_marker"],
      [2, "なら", "particle_condition"],
      [3, "いける", "availability_positive"],
    ]);
    expect(conditional.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);

    expect(limited.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_date"],
      [1, "だけ", "particle_limit"],
      [2, "いける", "availability_positive"],
    ]);
    expect(limited.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);

    expect(exceptive.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_date"],
      [1, "以外", "scope_exception"],
      [2, "無理", "availability_negative"],
    ]);
    expect(exceptive.grouping.exceptionScopeGroups).toEqual([{ id: "eg1", tokenIndexes: [1] }]);
  });

  it("keeps bare numeric date targets attached when a time-of-day target is also present", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("10は昼ならいける", buildCandidates());

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_date"],
      [1, "は", "particle_topic"],
      [2, "昼", "target_time_of_day"],
      [3, "なら", "conditional_marker"],
      [4, "なら", "particle_condition"],
      [5, "いける", "availability_positive"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
  });

  it("builds preference interpretations from richer desire markers without converting them to availability", async () => {
    const candidates = buildDiscreteDayCandidates([10, 12]);
    const ideal = await interpretAvailabilityCommentSubmissionWithOllama("10が理想", candidates, {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });
    const helpful = await interpretAvailabilityCommentSubmissionWithOllama("10だと助かる", candidates, {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });
    const possible = await interpretAvailabilityCommentSubmissionWithOllama("可能なら10", candidates, {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });

    expect(ideal.autoInterpretation.status).toBe("failed");
    expect(ideal.autoInterpretation.rules).toHaveLength(0);
    expect(ideal.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "strong_preferred",
    });
    expect(ideal.parsedConstraints).toEqual([]);
    expect(ideal.usedDefault).toBe(true);

    expect(helpful.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(helpful.parsedConstraints).toEqual([]);

    expect(possible.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(possible.parsedConstraints).toEqual([]);
  });

  it("expands bare numeric exception clauses without inventing a direct negative on the excluded day", () => {
    const candidates = buildDiscreteDayCandidates([9, 10, 11]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("10以外無理", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.exceptionScopeGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
          {
            relation: "exception_to",
            sourceTokenIndexes: executionInput.grouping.exceptionScopeGroups[0]!.tokenIndexes,
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.usedDefault).toBe(false);
    expect(derived.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual(["2026-04-09", "2026-04-11"]);
    expect(derived.parsedConstraints.every((constraint) => constraint.level === "hard_no")).toBe(true);
  });

  it("does not collapse multiple explicit slash dates onto the candidate start date", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("4/8は 4/9は 行ける", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.usedDefault).toBe(false);
    expect(derived.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual(["2026-04-08", "2026-04-09"]);
    expect(derived.answers[0]?.selectedDates).toEqual(["2026-04-08", "2026-04-09"]);
  });

  it("keeps a single slash date as that exact day instead of the month start", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("4/10はいけます", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.parsedConstraints[0]?.targetValue).toBe("2026-04-10");
    expect(derived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
  });

  it("keeps a zero-padded slash date as that exact day instead of the month start", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("04/12は無理", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.parsedConstraints[0]).toMatchObject({
      targetValue: "2026-04-12",
      level: "hard_no",
    });
  });

  it("keeps month-day and day-only dates on their matched day instead of the month start", () => {
    const candidates = buildCandidates();
    const monthDayExecutionInput = buildAvailabilityInterpretationExecutionInput("4月8日いける", candidates);
    const monthDayDerived = buildDerivedResponseFromAvailabilityInterpretation(
      monthDayExecutionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: monthDayExecutionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: monthDayExecutionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );
    const dayOnlyExecutionInput = buildAvailabilityInterpretationExecutionInput("8日いける", candidates);
    const dayOnlyDerived = buildDerivedResponseFromAvailabilityInterpretation(
      dayOnlyExecutionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: dayOnlyExecutionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: dayOnlyExecutionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(monthDayDerived.parsedConstraints[0]?.targetValue).toBe("2026-04-08");
    expect(dayOnlyDerived.parsedConstraints[0]?.targetValue).toBe("2026-04-08");
    expect(monthDayDerived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
    expect(dayOnlyDerived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
  });

  it("keeps day-range targets and time-of-day targets together for range clauses", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("10-13の夜ならいけます", buildDiscreteDayCandidates([10, 11, 12, 13], "night"));

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10-13", "target_date_range"],
      [1, "の", "particle_link"],
      [2, "夜", "target_time_of_day"],
      [3, "なら", "conditional_marker"],
      [4, "なら", "particle_condition"],
      [5, "いけます", "availability_positive"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
  });

  it("expands a date-range applies_to into all matched candidate dates", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12, 13], "night");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0, 2],
                availabilityTokenIndexes: [5],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10-13の夜ならいけます", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.parsedConstraints).toHaveLength(4);
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10_night",
      "2026-04-11_night",
      "2026-04-12_night",
      "2026-04-13_night",
    ]);
  });

  it("keeps concrete time-of-day targets when a range candidate uses unspecified time", async () => {
    const candidates = buildRangeCandidate(10, 13, "unspecified");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0, 2],
                availabilityTokenIndexes: [5],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10-13の夜ならいけます", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10_night",
      "2026-04-11_night",
      "2026-04-12_night",
      "2026-04-13_night",
    ]);
  });

  it("expands a negative date-range applies_to into all matched candidate dates", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12, 13]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10〜13は無理です", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints).toHaveLength(4);
    expect(result.parsedConstraints.every((constraint) => constraint.level === "hard_no")).toBe(true);
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
    ]);
  });

  it("does not invent a complement when only one side of a month-part statement is explicit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("前半はきついです", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.targetText).toBe("前半");
  });

  it("returns deterministic preference interpretations even when no availability token exists", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12]);
    const result = await interpretAvailabilityCommentSubmissionWithOllama("できたら10がいいです", candidates, {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("failed");
    expect(result.autoInterpretation.rules).toHaveLength(0);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([]);
    expect(result.usedDefault).toBe(true);
    expect(result.answers.every((answer) => answer.availabilityKey === "yes")).toBe(true);
  });

  it("keeps availability and preference separate when both are present", async () => {
    const candidates = buildDiscreteDayCandidates([10, 12]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("4/10はいけますが、できれば12の方がいいです", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toEqual([]);
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-10" }),
    ]);
  });

  it("keeps availability and preference separate even when they refer to the same date", async () => {
    const candidates = buildDiscreteDayCandidates([10]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("4/10はたぶんいけます。できたら10がいいです", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "4/10",
      availabilityText: "いけます",
    });
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-10" }),
    ]);
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.availabilityKey).toBe("yes");
  });

  it.each([
    { input: "11がいい", targetText: "11", level: "preferred" },
    { input: "11が第一希望", targetText: "11", level: "strong_preferred" },
    { input: "11がベスト", targetText: "11", level: "strong_preferred" },
    { input: "11だと嬉しい", targetText: "11", level: "preferred" },
    { input: "11だと助かる", targetText: "11", level: "preferred" },
    { input: "できれば11がいい", targetText: "11", level: "preferred" },
    { input: "11に行きたい", targetText: "11", level: "preferred" },
    { input: "11を優先したい", targetText: "11", level: "strong_preferred" },
    { input: "11は避けたい", targetText: "11", level: "avoid" },
    { input: "11はできれば避けたい", targetText: "11", level: "avoid" },
    { input: "11なら嬉しい", targetText: "11", level: "preferred" },
  ] as const)("lifts %s into autoInterpretation.preferences without emitting preference constraints", async ({ input, targetText, level }) => {
    const result = await interpretAvailabilityCommentSubmissionWithOllama(input, buildDiscreteDayCandidates([11, 12]), {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText,
      level,
    });
    expect(result.parsedConstraints.some((constraint) => constraint.intent === "preference")).toBe(false);
  });

  it("marks fallback-based preference targets so later comparison work can distinguish them", async () => {
    const result = await interpretAvailabilityCommentSubmissionWithOllama("11を優先したい", buildDiscreteDayCandidates([11, 12]), {
      fetchImpl: vi.fn() as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "11",
      targetTokenIndexes: [],
      targetNormalizedTexts: ["2026-04-11"],
      notes: ["raw_text_target_fallback"],
    });
  });

  it("keeps unsupported soft-preference phrases out of preference structures for now", async () => {
    const results = await Promise.all(
      ["11でもいい", "11でも大丈夫", "11でも構わない"].map((input) =>
        interpretAvailabilityCommentSubmissionWithOllama(input, buildDiscreteDayCandidates([11, 12]), {
          fetchImpl: vi.fn() as typeof fetch,
          model: "mock-model",
        }),
      ),
    );

    expect(results.every((result) => (result.autoInterpretation.preferences ?? []).length === 0)).toBe(true);
  });

  it("does not promote plain availability clauses into preference structures", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("11ならいける", buildDiscreteDayCandidates([11]));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [1],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11ならいける", buildDiscreteDayCandidates([11]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toEqual([]);
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-11", level: "conditional" }),
    ]);
  });

  it("keeps availability and preference side by side without turning preference into parsed constraints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [1],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11なら行けるしありがたい", buildDiscreteDayCandidates([11, 12]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "11",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-11", level: "conditional" }),
    ]);
  });

  it("can keep a later preference clause even when an earlier availability clause is not fully anchored", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11もいけるけど12がいい", buildDiscreteDayCandidates([11, 12]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences).toEqual([
      expect.objectContaining({
        targetText: "12",
        level: "preferred",
      }),
    ]);
    expect(result.parsedConstraints.some((constraint) => constraint.intent === "preference")).toBe(false);
  });

  it("wires comparison judgments into autoInterpretation comparisonPreferenceSignals in the main submission flow", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11]);
    const comment = "10と11なら11がいい";
    const mergedHypothesisId = "gh-merge-1";
    const comparedSetId = findClauseTargetGroupId(comment, candidates, /10と11なら11がいい/u, mergedHypothesisId, ["10", "11"]);
    const preferredId = findClauseTargetGroupId(comment, candidates, /10と11なら11がいい/u, mergedHypothesisId, ["11"]);
    const conditionIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "conditional_marker", text: "なら" });
    const markerIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "preference_positive_marker", text: /がいい/ });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              selectedHypothesisId: null,
              confidence: "medium",
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
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
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.autoInterpretation.comparisonPreferenceSignals).toEqual([
      expect.objectContaining({
        targetGroupId: preferredId,
        targetType: "date",
        targetValue: "2026-04-11",
        signal: "preferred",
      }),
    ]);
  });

  it("does not attach comparisonPreferenceSignals for plain availability comments", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [3],
                modifierTokenIndexes: [1],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11ならいける", buildDiscreteDayCandidates([11]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.autoInterpretation.comparisonPreferenceSignals).toBeUndefined();
  });

  it("attaches date_time comparison signals and safely skips unsupported group-level signals", async () => {
    const candidates = buildFixedTimeCandidates([
      { day: 10, timeSlotKey: "morning" },
      { day: 11, timeSlotKey: "day" },
    ]);
    const comment = "10日の午前より11日の午後の方がいい";
    const worseId = findClauseTargetGroupId(comment, candidates, /10日の午前より11日の午後/u, "gh-default", ["10日", "午前"]);
    const preferredId = findClauseTargetGroupId(comment, candidates, /10日の午前より11日の午後/u, "gh-default", ["11日", "午後"]);
    const markerIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "comparison_marker", text: /より|方が/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            judgments: [
              {
                groupingHypothesisId: "gh-default",
                kind: "comparison",
                comparedTargetGroupIds: [worseId, preferredId],
                preferredTargetGroupId: preferredId,
                dispreferredTargetGroupIds: [worseId],
                relation: "better_than",
                strength: "strong",
                confidence: "high",
                triggerTokenIndexes: [markerIndex],
                supportingClauseIndexes: [0],
                notes: null,
              },
            ],
            warnings: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.comparisonPreferenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetGroupId: preferredId,
          targetType: "date_time",
          targetValue: "2026-04-11_day",
          signal: "preferred",
        }),
        expect.objectContaining({
          targetGroupId: worseId,
          targetType: "date_time",
          targetValue: "2026-04-10_morning",
          signal: "dispreferred",
        }),
      ]),
    );
  });
});
