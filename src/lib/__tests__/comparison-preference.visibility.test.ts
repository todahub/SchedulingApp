import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labelCommentText, extractUnlabeledSegments } from "@/lib/comment-labeler";
import {
  buildAutoInterpretationResult,
  buildAvailabilityInterpretationExecutionInput,
  buildDerivedResponseFromAvailabilityInterpretation,
  buildEventDateRange,
} from "@/lib/availability-comment-interpretation";
import type { EventCandidateRecord, ParsedCommentConstraint } from "@/lib/domain";

const OUTPUT_PATH = "/tmp/comparison-preference-visibility.json";

const EMPTY_GRAPH = {
  links: [],
} as const;

type ObservationCase = {
  category: "comparison" | "preference";
  input: string;
  candidates: EventCandidateRecord[];
};

type ObservationResult = {
  category: ObservationCase["category"];
  input: string;
  labeledTokens: Array<{
    index: number;
    text: string;
    label: string;
    start: number;
    end: number;
    normalizedText?: string;
  }>;
  unlabeledSegments: ReturnType<typeof extractUnlabeledSegments>;
  targets: {
    targetTokens: Array<{
      index: number;
      text: string;
      label: string;
      normalizedText?: string;
    }>;
    targetGroups: Array<{
      id: string;
      tokenIndexes: number[];
      texts: string[];
      labels: string[];
    }>;
    scopeGroups: Array<{
      id: string;
      tokenIndexes: number[];
      texts: string[];
      labels: string[];
    }>;
  };
  groupingHypotheses: Array<{
    id: string;
    kind: string;
    note: string;
    targetGroups: Array<{
      id: string;
      tokenIndexes: number[];
      texts: string[];
      labels: string[];
    }>;
  }>;
  interpretedRules: Array<{
    targetText: string;
    targetLabels: string[];
    availabilityText: string;
    availabilityLabel: string;
    modifierTexts: string[];
    modifierLabels: string[];
    notes: string[];
  }>;
  preferences: Array<{
    targetText: string;
    targetLabels: string[];
    markerTexts: string[];
    markerLabels: string[];
    level: string;
    notes: string[];
  }>;
  parsedConstraints: ParsedCommentConstraint[];
  resolvedCandidateStatuses: ReturnType<typeof buildAutoInterpretationResult>["resolvedCandidateStatuses"];
  answers: ReturnType<typeof buildDerivedResponseFromAvailabilityInterpretation>["answers"];
  ambiguities: string[];
  observationComment: string;
};

function buildCandidate(dateValue: string, sortOrder: number): EventCandidateRecord {
  return {
    id: `candidate-${dateValue}`,
    eventId: "event-visibility",
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

function buildDateCandidates(dateValues: string[]) {
  return dateValues.map((dateValue, index) => buildCandidate(dateValue, index + 1));
}

function buildAprilCandidates(days: number[]) {
  return buildDateCandidates(
    days.map((day) => `2026-04-${String(day).padStart(2, "0")}`),
  );
}

function buildMayCandidates(days: number[]) {
  return buildDateCandidates(
    days.map((day) => `2026-05-${String(day).padStart(2, "0")}`),
  );
}

const comparisonCases: ObservationCase[] = [
  { category: "comparison", input: "10と11なら11がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10より11の方がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10より11が都合いい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10と11ならどっちでもいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10か11なら11がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10と11はいける", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10、11、12なら11がいい", candidates: buildAprilCandidates([10, 11, 12]) },
  { category: "comparison", input: "10と11と12なら11が第一候補", candidates: buildAprilCandidates([10, 11, 12]) },
  { category: "comparison", input: "11の方がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "11がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10より11の方がまだ行きやすい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10と11なら11の方が助かる", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10,11なら11", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10 or 11 なら 11", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "金土なら土の方がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "5/10と5/11なら5/11がいい", candidates: buildMayCandidates([10, 11]) },
  { category: "comparison", input: "10日夜と11日夜なら11日夜がいい", candidates: buildAprilCandidates([10, 11]) },
  { category: "comparison", input: "10日の午前より11日の午後の方がいい", candidates: buildAprilCandidates([10, 11]) },
];

const preferenceCases: ObservationCase[] = [
  { category: "preference", input: "11がいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11が第一希望", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11に行きたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11だと嬉しい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11だと助かる", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11が理想", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11が望ましい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "できれば11がいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "できれば11にしたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11がベスト", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11が一番いい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11を優先したい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11は避けたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11はできれば避けたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11より12がいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11はいけるけど12の方がいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11ならいける", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11なら嬉しい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11なら行けるしありがたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11はいけるし良さそう", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11もいけるけど12がいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11でもいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11でも大丈夫", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11でも構わない", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11が無難", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11がありがたい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11の方が嬉しい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11の方がまだいい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11にしてほしい", candidates: buildAprilCandidates([11, 12]) },
  { category: "preference", input: "11だと理想的", candidates: buildAprilCandidates([11, 12]) },
];

function summarizeTokenGroup(
  tokenIndexes: number[],
  tokens: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>["tokens"],
) {
  return {
    tokenIndexes,
    texts: tokenIndexes.map((tokenIndex) => tokens[tokenIndex]?.text ?? ""),
    labels: tokenIndexes.map((tokenIndex) => tokens[tokenIndex]?.label ?? ""),
  };
}

function looksComparisonLike(input: string) {
  return /より|方が|第一候補|どっちでも|or|金土なら|助かる/u.test(input);
}

function looksPreferenceLike(input: string) {
  return /いい|希望|行きたい|嬉しい|助かる|理想|望ましい|ベスト|優先|避けたい|ありがたい|無難|してほしい/u.test(input);
}

function buildObservationComment(result: Omit<ObservationResult, "observationComment">) {
  const tokenLabels = new Set(result.labeledTokens.map((token) => token.label));
  const preferenceConstraints = result.parsedConstraints.filter((constraint) => constraint.intent === "preference");
  const availabilityConstraints = result.parsedConstraints.filter((constraint) => constraint.intent !== "preference");
  const comments: string[] = [];

  if (result.targets.targetGroups.length >= 2) {
    comments.push("複数の target group は取れている。");
  } else if (result.targets.targetGroups.length === 1) {
    comments.push("target group は 1 つだけで、比較対象の分離はまだ弱い。");
  } else {
    comments.push("比較対象になりそうな target group が十分に取れていない。");
  }

  if (looksComparisonLike(result.input)) {
    if (tokenLabels.has("comparison_marker")) {
      comments.push("comparison_marker は付いている。");
    } else {
      comments.push("比較文っぽいが comparison_marker は付いていない。");
    }
  }

  if (preferenceConstraints.length > 0) {
    comments.push(`preference constraint が ${preferenceConstraints.length} 件生成されている。`);
  } else if (tokenLabels.has("desire_marker")) {
    comments.push("desire_marker はあるが、preference constraint にはまだ落ちていない。");
  } else {
    comments.push("preference として独立した constraint はまだ見えていない。");
  }

  if (availabilityConstraints.length > 0) {
    comments.push(`availability constraint が ${availabilityConstraints.length} 件生成されている。`);
  }

  if (preferenceConstraints.length > 0 && availabilityConstraints.length === 0) {
    comments.push("現状でも可否とは別に希望情報として扱えている。");
  }

  if (preferenceConstraints.length > 0 && availabilityConstraints.length > 0) {
    comments.push("preference と availability が同時に出ていて、混在ケースの材料はある。");
  }

  if (result.input.includes("なら")) {
    if (availabilityConstraints.length > 0) {
      comments.push("「なら」は可否条件として ranking 入力に落ちている。");
    } else if (preferenceConstraints.length > 0) {
      comments.push("「なら」はあるが、現状は希望側の材料として残っている。");
    } else {
      comments.push("「なら」はあるが、現状は最終 constraint に十分反映されていない。");
    }
  }

  if (result.answers.length > 0 && preferenceConstraints.length === 0 && availabilityConstraints.length === 0) {
    comments.push("answers は default 由来の可能性があり、希望/比較の観察には注意が必要。");
  }

  if (looksPreferenceLike(result.input) && availabilityConstraints.length > 0 && preferenceConstraints.length === 0) {
    comments.push("希望文が availability 側に吸われている可能性がある。");
  }

  if (result.unlabeledSegments.length > 0) {
    comments.push("未ラベル断片が残っている。");
  }

  return comments.join(" ");
}

function buildObservationResult(testCase: ObservationCase): ObservationResult {
  const eventDateRange = buildEventDateRange(testCase.candidates);
  const labeledComment = labelCommentText(
    testCase.input,
    eventDateRange ? { eventDateRange } : undefined,
  );
  const executionInput = buildAvailabilityInterpretationExecutionInput(testCase.input, testCase.candidates);
  const autoInterpretation = buildAutoInterpretationResult(executionInput, EMPTY_GRAPH, testCase.candidates);
  const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, EMPTY_GRAPH, testCase.candidates);

  const baseResult = {
    category: testCase.category,
    input: testCase.input,
    labeledTokens: executionInput.tokens.map((token) => ({
      index: token.index,
      text: token.text,
      label: token.label,
      start: token.start,
      end: token.end,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    unlabeledSegments: extractUnlabeledSegments(labeledComment),
    targets: {
      targetTokens: executionInput.tokens
        .filter((token) => token.label.startsWith("target_") || token.label.startsWith("scope_"))
        .map((token) => ({
          index: token.index,
          text: token.text,
          label: token.label,
          ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
        })),
      targetGroups: executionInput.grouping.targetGroups.map((group) => ({
        id: group.id,
        ...summarizeTokenGroup(group.tokenIndexes, executionInput.tokens),
      })),
      scopeGroups: executionInput.grouping.scopeGroups.map((group) => ({
        id: group.id,
        ...summarizeTokenGroup(group.tokenIndexes, executionInput.tokens),
      })),
    },
    groupingHypotheses: executionInput.groupingHypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      kind: hypothesis.kind,
      note: hypothesis.note,
      targetGroups: hypothesis.grouping.targetGroups.map((group) => ({
        id: group.id,
        ...summarizeTokenGroup(group.tokenIndexes, executionInput.tokens),
      })),
    })),
    interpretedRules: autoInterpretation.rules.map((rule) => ({
      targetText: rule.targetText,
      targetLabels: rule.targetLabels,
      availabilityText: rule.availabilityText,
      availabilityLabel: rule.availabilityLabel,
      modifierTexts: rule.modifierTexts,
      modifierLabels: rule.modifierLabels,
      notes: rule.notes,
    })),
    preferences: (autoInterpretation.preferences ?? []).map((preference) => ({
      targetText: preference.targetText,
      targetLabels: preference.targetLabels,
      markerTexts: preference.markerTexts,
      markerLabels: preference.markerLabels,
      level: preference.level,
      notes: preference.notes,
    })),
    parsedConstraints: derived.parsedConstraints,
    resolvedCandidateStatuses: autoInterpretation.resolvedCandidateStatuses ?? [],
    answers: derived.answers,
    ambiguities: autoInterpretation.ambiguities,
  };

  return {
    ...baseResult,
    observationComment: buildObservationComment(baseResult),
  };
}

describe("comparison and preference current-state visibility", () => {
  it("captures the current pipeline output for comparison-like and preference-like comments", () => {
    const results = [...comparisonCases, ...preferenceCases].map((testCase) =>
      buildObservationResult(testCase),
    );

    const payload = {
      generatedAt: "2026-04-19",
      outputPath: OUTPUT_PATH,
      comparison: results.filter((result) => result.category === "comparison"),
      preference: results.filter((result) => result.category === "preference"),
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `\n[comparison-preference.visibility] wrote ${results.length} cases to ${OUTPUT_PATH}`,
    );

    expect(results).toHaveLength(comparisonCases.length + preferenceCases.length);
    expect(payload.comparison).toHaveLength(comparisonCases.length);
    expect(payload.preference).toHaveLength(preferenceCases.length);
  });
});
