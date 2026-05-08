import { describe, expect, it, vi } from "vitest";
import { buildAvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";
import {
  buildConditionInterpretationInputFromExecutionInput,
  buildConditionInterpretationMessages,
  hasConditionInterpretationCandidateMaterial,
  interpretConditionsForInput,
  validateConditionInterpretationOutput,
  ConditionInterpretationValidationError,
} from "@/lib/condition-interpretation";
import type { EventCandidateRecord } from "@/lib/domain";

function buildAllDayCandidate(dateValue: string, sortOrder: number): EventCandidateRecord {
  return {
    id: `candidate-${dateValue}`,
    eventId: "event-condition-interpretation",
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

describe("condition interpretation guardrails", () => {
  it("builds a constrained prompt using finalPreferences and targetContexts", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "他の人がみんな行けるなら11がいい",
      buildAprilCandidates([11, 12]),
    );
    const targetTokenIndex = findTokenIndex(executionInput, { text: "11" });
    const markerTokenIndex = findTokenIndex(executionInput, { label: "preference_positive_marker", text: /がいい/ });
    const conditionTokenIndex = findTokenIndex(executionInput, { text: /なら/ });
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
      targetContexts: [
        {
          targetTokenIndexes: [targetTokenIndex],
          relationContext: [
            {
              kind: "conditional_choice_scope",
              hint: "condition_context",
              markerTokenIndexes: [conditionTokenIndex],
            },
          ],
        },
      ],
    });

    const prompts = buildConditionInterpretationMessages(input);
    expect(prompts.systemPrompt).toContain("返してよい top-level key は conditions と warnings だけです。");
    expect(prompts.systemPrompt).toContain("threshold は attendance_threshold の時だけ入れてよく");
    expect(prompts.userPrompt).toContain('"finalPreferences"');
    expect(prompts.userPrompt).toContain('"targetContexts"');
    expect(prompts.userPrompt).toContain('"relevantClauses"');
  });

  it("rejects unsupported fields and unknown target token indexes", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "他の人がみんな行けるなら11がいい",
      buildAprilCandidates([11, 12]),
    );
    const targetTokenIndex = findTokenIndex(executionInput, { text: "11" });
    const markerTokenIndex = findTokenIndex(executionInput, { label: "preference_positive_marker", text: /がいい/ });
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

    expect(() =>
      validateConditionInterpretationOutput(
        {
          conditions: [
            {
              targetTokenIndexes: [999],
              targetText: "11",
              targetLabels: ["target_numeric_candidate"],
              targetNormalizedTexts: [],
              conditionTokenIndexes: [0],
              markerTokenIndexes: [0],
              supportingClauseIndexes: [0],
              kind: "others_condition",
              resolverType: "all_others_available",
              participantScope: "all_others",
              requiredAvailabilityLevels: ["strong_yes", "soft_yes"],
              unresolvedBehavior: "blocked",
              resolvedAvailabilityLevel: "soft_yes",
              resolvedPreferenceLevel: "preferred",
              sourceComment: executionInput.originalText,
              confidence: "high",
              extra: true,
            },
          ],
          warnings: [],
        },
        input,
      ),
    ).toThrow(ConditionInterpretationValidationError);
  });

  it("returns a structured condition record through the Ollama wrapper", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "他の人がみんな行けるなら11がいい",
      buildAprilCandidates([11, 12]),
    );
    const targetTokenIndex = findTokenIndex(executionInput, { text: "11" });
    const markerTokenIndex = findTokenIndex(executionInput, { label: "preference_positive_marker", text: /がいい/ });
    const conditionTokenIndex = findTokenIndex(executionInput, { text: /なら/ });
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
    const result = await interpretConditionsForInput(input, {
      fetchImpl: mockOllamaJson({
        conditions: [
          {
            targetTokenIndexes: input.finalPreferences[0]!.targetTokenIndexes,
            targetText: input.finalPreferences[0]!.targetText,
            targetLabels: ["target_numeric_candidate"],
            targetNormalizedTexts: [],
            conditionTokenIndexes: [conditionTokenIndex],
            markerTokenIndexes: [conditionTokenIndex],
            supportingClauseIndexes: [0],
            kind: "others_condition",
            resolverType: "all_others_available",
            participantScope: "all_others",
            requiredAvailabilityLevels: ["strong_yes", "soft_yes"],
            unresolvedBehavior: "blocked",
            resolvedAvailabilityLevel: "soft_yes",
            resolvedPreferenceLevel: "preferred",
            sourcePreferenceTargetTokenIndexes: input.finalPreferences[0]!.targetTokenIndexes,
            sourceComment: executionInput.originalText,
            confidence: "high",
          },
        ],
        warnings: [],
      }) as typeof fetch,
    });

    expect(result.error).toBeNull();
    expect(result.relevantClauseIndexes).toEqual([0]);
    expect(result.conditions).toEqual([
      expect.objectContaining({
        kind: "others_condition",
        resolverType: "all_others_available",
        participantScope: "all_others",
        unresolvedBehavior: "blocked",
        resolvedAvailabilityLevel: "soft_yes",
        resolvedPreferenceLevel: "preferred",
        sourcePreferenceTargetTokenIndexes: [targetTokenIndex],
      }),
    ]);
  });

  it("does not treat plain conditional availability as ranking condition material", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "11ならいける",
      buildAprilCandidates([11]),
    );
    const targetTokenIndex = findTokenIndex(executionInput, { text: "11" });
    const modifierTokenIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });
    const availabilityTokenIndex = findTokenIndex(executionInput, { label: "availability_positive", text: /いける/ });
    const input = buildConditionInterpretationInputFromExecutionInput(executionInput, {
      availabilityRules: [
        {
          targetTokens: [],
          targetTokenIndexes: [targetTokenIndex],
          targetText: "11",
          targetLabels: ["target_numeric_candidate"],
          targetNormalizedTexts: [],
          residualOfTokens: [],
          availabilityTokenIndexes: [availabilityTokenIndex],
          availabilityText: "いける",
          availabilityLabel: "availability_positive",
          modifierTokenIndexes: [modifierTokenIndex],
          modifierTexts: ["なら"],
          modifierLabels: ["conditional_marker"],
          residualOfTokenIndexes: [],
          residualOfTargetGroups: [],
          exceptionTargetTokens: [],
          exceptionTargetTokenIndexes: [],
          contrastClauseTokenIndexes: [],
          notes: [],
          sourceComment: executionInput.originalText,
        },
      ],
    });

    expect(input.availabilityRules).toHaveLength(1);
    expect(hasConditionInterpretationCandidateMaterial(input)).toBe(false);
  });

  it("does not treat comparison choice scope as ranking condition material", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "11か12なら11がいい",
      buildAprilCandidates([11, 12]),
    );
    const preferredTargetIndex = findTokenIndex(executionInput, { text: "11", nth: 1 });
    const markerTokenIndex = findTokenIndex(executionInput, { label: "preference_positive_marker", text: /がいい/ });
    const conditionTokenIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });
    const input = buildConditionInterpretationInputFromExecutionInput(executionInput, {
      finalPreferences: [
        {
          targetTokenIndexes: [preferredTargetIndex],
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
      targetContexts: [
        {
          targetTokenIndexes: [preferredTargetIndex],
          relationContext: [
            {
              kind: "conditional_choice_scope",
              hint: "comparison_candidate",
              markerTokenIndexes: [conditionTokenIndex],
            },
          ],
        },
      ],
    });

    expect(input.finalPreferences).toHaveLength(1);
    expect(hasConditionInterpretationCandidateMaterial(input)).toBe(false);
  });
});
