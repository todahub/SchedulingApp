import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
  buildAvailabilityInterpretationExecutionInputForGroupingHypothesis,
} from "@/lib/availability-comment-interpretation";
import { interpretAvailabilityCommentSubmissionWithOllama } from "@/lib/availability-comment-interpretation-server";
import type { LlmInterpretationOutput } from "@/lib/availability-interpretation";
import type {
  AvailabilityCommentSubmissionInterpretation,
} from "@/lib/availability-comment-interpretation-server";
import type { EventCandidateRecord } from "@/lib/domain";

type GraphContext = {
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>;
  findTokenIndex: (options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  }) => number;
  findTokenIndexes: (options: {
    label?: string;
    text?: string | RegExp;
  }) => number[];
};

type Scenario = {
  name: string;
  input: string;
  candidates: EventCandidateRecord[];
  buildGraph: (context: GraphContext) => LlmInterpretationOutput;
  selectGroupingHypothesisId?: (
    executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  ) => string | null;
};

function buildAllDayCandidate(day: number): EventCandidateRecord {
  const date = `2026-04-${String(day).padStart(2, "0")}`;

  return {
    id: `candidate-${day}-all_day`,
    eventId: "event-april",
    date,
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: date,
    endDate: date,
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: day,
  };
}

function buildFixedTimeCandidate(
  day: number,
  timeSlotKey: "morning" | "day" | "night",
  startTime: string,
  endTime: string,
): EventCandidateRecord {
  const date = `2026-04-${String(day).padStart(2, "0")}`;

  return {
    id: `candidate-${day}-${timeSlotKey}`,
    eventId: "event-april",
    date,
    timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: date,
    endDate: date,
    selectedDates: [],
    timeType: "fixed",
    startTime,
    endTime,
    note: null,
    sortOrder: day,
  };
}

function buildAllDayCandidates(days: number[]) {
  return days.map((day) => buildAllDayCandidate(day));
}

function buildResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      message: {
        content,
      },
    }),
  };
}

function createGraphContext(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
): GraphContext {
  return {
    executionInput,
    findTokenIndex: ({ label, text, nth = 0 }) => {
      const matches = executionInput.tokens.filter((token) => {
        const labelMatch = !label || token.label === label;
        const textMatch =
          !text ||
          (typeof text === "string" ? token.text === text : text.test(token.text));
        return labelMatch && textMatch;
      });
      const match = matches[nth];

      if (!match) {
        throw new Error(
          `Token not found for label=${String(label)} text=${String(text)} nth=${nth} in "${executionInput.originalText}"`,
        );
      }

      return match.index;
    },
    findTokenIndexes: ({ label, text }) => {
      return executionInput.tokens
        .filter((token) => {
          const labelMatch = !label || token.label === label;
          const textMatch =
            !text ||
            (typeof text === "string" ? token.text === text : text.test(token.text));
          return labelMatch && textMatch;
        })
        .map((token) => token.index);
    },
  };
}

function extractUnlabeledSegments(
  text: string,
  tokens: Array<{ start: number; end: number }>,
) {
  const spans = tokens
    .map((token) => ({ start: token.start, end: token.end }))
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const span of spans) {
    const previous = merged[merged.length - 1];

    if (!previous || span.start > previous.end) {
      merged.push({ ...span });
      continue;
    }

    previous.end = Math.max(previous.end, span.end);
  }

  const gaps: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;

  for (const span of merged) {
    if (cursor < span.start) {
      const gapText = text.slice(cursor, span.start);

      if (gapText.trim()) {
        gaps.push({
          start: cursor,
          end: span.start,
          text: gapText,
        });
      }
    }
    cursor = Math.max(cursor, span.end);
  }

  if (cursor < text.length) {
    const gapText = text.slice(cursor);

    if (gapText.trim()) {
      gaps.push({
        start: cursor,
        end: text.length,
        text: gapText,
      });
    }
  }

  return gaps;
}

function summarizeTargets(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
) {
  return executionInput.grouping.targetGroups.map((group) => ({
    id: group.id,
    tokenIndexes: group.tokenIndexes,
    texts: group.tokenIndexes.map((index) => executionInput.tokens[index]?.text),
    labels: group.tokenIndexes.map((index) => executionInput.tokens[index]?.label),
  }));
}

function summarizeRules(
  interpretation: AvailabilityCommentSubmissionInterpretation["autoInterpretation"],
) {
  return interpretation.rules.map((rule) => ({
    targetText: rule.targetText,
    targetLabels: rule.targetLabels,
    availabilityText: rule.availabilityText,
    availabilityLabel: rule.availabilityLabel,
    modifierTexts: rule.modifierTexts,
    modifierLabels: rule.modifierLabels,
    notes: rule.notes,
  }));
}

async function runScenario(scenario: Scenario) {
  const baseExecutionInput = buildAvailabilityInterpretationExecutionInput(
    scenario.input,
    scenario.candidates,
  );
  const selectedGroupingHypothesisId =
    scenario.selectGroupingHypothesisId?.(baseExecutionInput) ?? null;
  const selectedExecutionInput = selectedGroupingHypothesisId
    ? buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
        baseExecutionInput,
        selectedGroupingHypothesisId,
      )
    : baseExecutionInput;
  const graphContext = createGraphContext(selectedExecutionInput);
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      format?: { properties?: Record<string, unknown> };
    };
    const isGroupingSelectionRequest =
      Boolean(body.format?.properties) &&
      Object.prototype.hasOwnProperty.call(body.format.properties, "selectedHypothesisId");

    if (isGroupingSelectionRequest) {
      return buildResponse(
        JSON.stringify({
          selectedHypothesisId,
          confidence: "high",
        }),
      );
    }

    return buildResponse(JSON.stringify(scenario.buildGraph(graphContext)));
  });

  const interpretation = await interpretAvailabilityCommentSubmissionWithOllama(
    scenario.input,
    scenario.candidates,
    {
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "http://127.0.0.1:11434/api",
      model: "mock-model",
    },
  );

  return {
    executionInput: selectedExecutionInput,
    interpretation,
    fetchMock,
  };
}

const scenarios: Scenario[] = [
  {
    name: "basic positive",
    input: "12はいける",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "basic negative",
    input: "12は無理",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_negative", text: /無理/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "basic uncertain positive",
    input: "12は多分いける",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "uncertainty_marker" })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "range available",
    input: "10から13まではいける",
    candidates: buildAllDayCandidates([10, 11, 12, 13]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date_range" })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "enumerated list available",
    input: "11、12、13はいける",
    candidates: buildAllDayCandidates([11, 12, 13]),
    buildGraph: ({ findTokenIndexes, findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: findTokenIndexes({ label: "target_date" }),
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "linked list available",
    input: "10と12はいける",
    candidates: buildAllDayCandidates([10, 12]),
    buildGraph: ({ findTokenIndexes, findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: findTokenIndexes({ label: "target_date" }),
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "conditional choice available",
    input: "10か12ならいける",
    candidates: buildAllDayCandidates([10, 12]),
    buildGraph: ({ findTokenIndexes, findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: findTokenIndexes({ label: "target_date" }),
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "conditional_marker", text: /なら/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "night availability",
    input: "12日の夜はいける",
    candidates: [buildFixedTimeCandidate(12, "night", "18:00", "22:00")],
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [
            findTokenIndex({ label: "target_date", text: /12/ }),
            findTokenIndex({ label: "target_time_of_day", text: /夜/ }),
          ],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "morning negative",
    input: "5日は午前が無理",
    candidates: [buildFixedTimeCandidate(5, "morning", "09:00", "12:00")],
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [
            findTokenIndex({ label: "target_date", text: /5/ }),
            findTokenIndex({ label: "target_time_of_day", text: /午前/ }),
          ],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_negative", text: /無理/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "exception scope available",
    input: "金曜の夜以外はいける",
    candidates: [
      buildAllDayCandidate(9),
      buildFixedTimeCandidate(10, "night", "18:00", "22:00"),
      buildAllDayCandidate(11),
    ],
    buildGraph: ({ findTokenIndex }) => {
      const scopeExceptionIndex = findTokenIndex({ label: "scope_exception" });

      return {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [scopeExceptionIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
            confidence: "high",
          },
          {
            relation: "exception_to",
            sourceTokenIndexes: [scopeExceptionIndex],
            targetTokenIndexes: [
              findTokenIndex({ label: "target_weekday", text: /金曜/ }),
              findTokenIndex({ label: "target_time_of_day", text: /夜/ }),
            ],
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    name: "residual after weekday negative",
    input: "平日は無理、あとはいける",
    candidates: buildAllDayCandidates([9, 10, 11, 12]),
    buildGraph: ({ findTokenIndex }) => {
      const residualIndex = findTokenIndex({ label: "scope_residual" });
      const weekdayIndex = findTokenIndex({ label: "target_weekday_group", text: /平日/ });

      return {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [weekdayIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_negative", text: /無理/ })],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [residualIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
            confidence: "medium",
          },
          {
            relation: "residual_of",
            sourceTokenIndexes: [residualIndex],
            targetTokenIndexes: [weekdayIndex],
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    name: "residual after weekday and morning negatives",
    input: "平日は無理、5日は午前が無理、あとはいける",
    candidates: [
      buildAllDayCandidate(3),
      buildAllDayCandidate(4),
      buildFixedTimeCandidate(5, "morning", "09:00", "12:00"),
      buildAllDayCandidate(6),
    ],
    buildGraph: ({ findTokenIndex }) => {
      const weekdayIndex = findTokenIndex({ label: "target_weekday_group", text: /平日/ });
      const dayFiveIndex = findTokenIndex({ label: "target_date", text: /5/ });
      const morningIndex = findTokenIndex({ label: "target_time_of_day", text: /午前/ });
      const residualIndex = findTokenIndex({ label: "scope_residual" });
      const negativeIndexes = [
        findTokenIndex({ label: "availability_negative", text: /無理/, nth: 0 }),
        findTokenIndex({ label: "availability_negative", text: /無理/, nth: 1 }),
      ];

      return {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [weekdayIndex],
            availabilityTokenIndexes: [negativeIndexes[0]!],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [dayFiveIndex, morningIndex],
            availabilityTokenIndexes: [negativeIndexes[1]!],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [residualIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
            confidence: "medium",
          },
          {
            relation: "residual_of",
            sourceTokenIndexes: [residualIndex],
            targetTokenIndexes: [weekdayIndex, dayFiveIndex, morningIndex],
            confidence: "medium",
          },
        ],
      };
    },
  },
  {
    name: "uncertain positive with かも",
    input: "12はいけるかも",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "uncertainty_marker", text: /かも/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "double negation soft positive",
    input: "12は無理ではない",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /無理ではない/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "reason-like prefix before conditional positive",
    input: "次の日早いけど12ならいける",
    candidates: buildAllDayCandidates([12]),
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_date", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "conditional_marker", text: /なら/ })],
          confidence: "high",
        },
      ],
      ambiguities: ["前半の事情説明は現行パイプラインでは未解決のまま残る。"],
    }),
  },
];

describe("availability interpretation integration", () => {
  it.each(scenarios)("logs current pipeline output for $name", async (scenario) => {
    const { executionInput, interpretation, fetchMock } = await runScenario(scenario);

    const debugPayload = {
      input: scenario.input,
      labeledTokens: executionInput.tokens.map((token) => ({
        index: token.index,
        text: token.text,
        label: token.label,
        start: token.start,
        end: token.end,
        ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
      })),
      unlabeledSegments: extractUnlabeledSegments(
        executionInput.originalText,
        executionInput.tokens.map((token) => ({ start: token.start, end: token.end })),
      ),
      targets: summarizeTargets(executionInput),
      groupingHypotheses: executionInput.groupingHypotheses.map((hypothesis) => ({
        id: hypothesis.id,
        kind: hypothesis.kind,
        note: hypothesis.note,
      })),
      interpretedRules: summarizeRules(interpretation.autoInterpretation),
      resolvedCandidateStatuses: interpretation.autoInterpretation.resolvedCandidateStatuses ?? [],
      parsedConstraints: interpretation.parsedConstraints,
      answers: interpretation.answers,
      ambiguities: interpretation.autoInterpretation.ambiguities,
    };

    console.log(
      `\n[availability-interpretation.integration] ${scenario.name}\n${JSON.stringify(debugPayload, null, 2)}`,
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(interpretation.autoInterpretation.sourceComment).toBe(scenario.input.trim());
    expect(Array.isArray(interpretation.autoInterpretation.rules)).toBe(true);
    expect(Array.isArray(interpretation.parsedConstraints)).toBe(true);
    expect(Array.isArray(interpretation.answers)).toBe(true);
  });

  it("keeps a simple available day as a strong yes before ranking", async () => {
    const scenario = scenarios.find((entry) => entry.name === "basic positive");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(interpretation.autoInterpretation.status).toBe("success");
    expect(interpretation.autoInterpretation.resolvedCandidateStatuses).toEqual([
      {
        candidateId: "candidate-12-all_day",
        dateValue: "2026-04-12",
        timeSlotKey: null,
        level: "strong_yes",
        detailLabel: "12 → 参加可能",
      },
    ]);
    expect(interpretation.parsedConstraints).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-12",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "12はいける",
        intent: "availability",
        source: "auto_llm",
      },
    ]);
  });

  it("keeps a simple unavailable day as a hard no before ranking", async () => {
    const scenario = scenarios.find((entry) => entry.name === "basic negative");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(interpretation.autoInterpretation.status).toBe("success");
    expect(interpretation.autoInterpretation.resolvedCandidateStatuses).toEqual([
      {
        candidateId: "candidate-12-all_day",
        dateValue: "2026-04-12",
        timeSlotKey: null,
        level: "hard_no",
        detailLabel: "12 → 参加不可",
      },
    ]);
  });

  it("keeps uncertainty on a positive predicate as soft yes", async () => {
    const scenario = scenarios.find((entry) => entry.name === "basic uncertain positive");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(interpretation.autoInterpretation.status).toBe("success");
    expect(interpretation.autoInterpretation.resolvedCandidateStatuses).toEqual([
      {
        candidateId: "candidate-12-all_day",
        dateValue: "2026-04-12",
        timeSlotKey: null,
        level: "soft_yes",
        detailLabel: "12 → たぶん参加可能",
      },
    ]);
  });

  it.each([
    {
      name: "range available",
      expected: [
        { targetValue: "2026-04-10", level: "strong_yes" },
        { targetValue: "2026-04-11", level: "strong_yes" },
        { targetValue: "2026-04-12", level: "strong_yes" },
        { targetValue: "2026-04-13", level: "strong_yes" },
      ],
    },
    {
      name: "enumerated list available",
      expected: [
        { targetValue: "2026-04-11", level: "strong_yes" },
        { targetValue: "2026-04-12", level: "strong_yes" },
        { targetValue: "2026-04-13", level: "strong_yes" },
      ],
    },
    {
      name: "linked list available",
      expected: [
        { targetValue: "2026-04-10", level: "strong_yes" },
        { targetValue: "2026-04-12", level: "strong_yes" },
      ],
    },
    {
      name: "night availability",
      expected: [
        { targetValue: "2026-04-12_night", level: "strong_yes" },
      ],
    },
    {
      name: "residual after weekday negative",
      expected: [
        { targetValue: "2026-04-09", level: "hard_no" },
        { targetValue: "2026-04-10", level: "hard_no" },
        { targetValue: "2026-04-11", level: "strong_yes" },
        { targetValue: "2026-04-12", level: "strong_yes" },
      ],
    },
  ])("preserves the existing simple case for $name", async ({ name, expected }) => {
    const scenario = scenarios.find((entry) => entry.name === name);

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(
      interpretation.parsedConstraints.map((constraint) => ({
        targetValue: constraint.targetValue,
        level: constraint.level,
      })),
    ).toEqual(expected);
  });

  it("treats 10か12ならいける as conditional availability on both candidate dates", async () => {
    const scenario = scenarios.find((entry) => entry.name === "conditional choice available");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(interpretation.autoInterpretation.status).toBe("success");
    expect(interpretation.autoInterpretation.rules).toHaveLength(1);
    expect(interpretation.autoInterpretation.rules[0]).toMatchObject({
      targetText: "10 / 12",
      availabilityText: "いける",
      modifierLabels: ["conditional_marker"],
    });
    expect(
      interpretation.parsedConstraints.map((constraint) => ({
        targetValue: constraint.targetValue,
        level: constraint.level,
      })),
    ).toEqual([
      { targetValue: "2026-04-10", level: "conditional" },
      { targetValue: "2026-04-12", level: "conditional" },
    ]);
  });

  it("keeps excluded exception targets from falling back to a default yes", async () => {
    const scenario = scenarios.find((entry) => entry.name === "exception scope available");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);

    expect(interpretation.parsedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetValue: "2026-04-09", level: "strong_yes" }),
        expect.objectContaining({ targetValue: "2026-04-10_night", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-11", level: "strong_yes" }),
      ]),
    );
    expect(
      interpretation.answers.find((answer) => answer.candidateId === "candidate-10-night")?.availabilityKey,
    ).toBe("no");
  });

  it("does not let residual positives override prior explicit negatives", async () => {
    const scenario = scenarios.find((entry) => entry.name === "residual after weekday and morning negatives");

    expect(scenario).toBeTruthy();

    const { interpretation } = await runScenario(scenario!);
    const constraints = interpretation.parsedConstraints.map((constraint) => ({
      targetValue: constraint.targetValue,
      level: constraint.level,
    }));

    expect(constraints).toEqual(
      expect.arrayContaining([
        { targetValue: "2026-04-03", level: "hard_no" },
        { targetValue: "2026-04-04", level: "strong_yes" },
        { targetValue: "2026-04-05_morning", level: "hard_no" },
        { targetValue: "2026-04-06", level: "hard_no" },
      ]),
    );
    expect(constraints).not.toContainEqual({ targetValue: "2026-04-03", level: "strong_yes" });
    expect(constraints).not.toContainEqual({ targetValue: "2026-04-05_morning", level: "strong_yes" });
    expect(constraints).not.toContainEqual({ targetValue: "2026-04-06", level: "strong_yes" });
  });
});
