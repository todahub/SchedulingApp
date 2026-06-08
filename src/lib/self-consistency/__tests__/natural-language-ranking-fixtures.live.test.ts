import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";
import type {
  AiScheduleDecisionKind,
  EventCandidateRecord,
  EventDetail,
  EventRecord,
  ParticipantAnswerRecord,
  ParticipantResponseRecord,
  ResultMode,
} from "@/lib/domain";
import { buildAiScheduleDecision, buildRankedCandidateCollections, rankCandidates } from "@/lib/ranking";
import { interpretCommentWithSelfConsistency, projectSelfConsistencyToRankingArtifacts } from "@/lib/self-consistency";
import type {
  FinalComparison,
  FinalEvaluation,
  InterpretationAvailability,
  InterpretationPreference,
  NormalizedScope,
} from "@/lib/self-consistency";

loadEnvConfig(process.cwd());
loadLocalEnvFallback();

const liveIt = process.env.RUN_LIVE_FIXTURE === "1" ? it : it.skip;
const FIXTURE_PATH = join(process.cwd(), "docs", "natural-language-ranking-fixtures.md");
const REPORT_PATH = process.env.LIVE_FIXTURE_REPORT_PATH ?? "/tmp/natural-language-ranking-fixture-report.json";

type ScopeExpectation = {
  dateValues: string[];
  timeValues: string[];
};

type EvaluationExpectation = ScopeExpectation & {
  availabilityOneOf: InterpretationAvailability[];
  reviewStatusOneOf: Array<"base_only" | "stable" | "mixed">;
  minAvailabilityConfidence?: number;
  preferenceRepresentative?: InterpretationPreference | null;
  preferenceRepresentativeOneOf?: InterpretationPreference[];
  externalConditionTexts?: string[];
  externalConditionTextsContains?: string[];
};

type ComparisonExpectation = {
  candidateScopes: ScopeExpectation[];
  preferredScope: ScopeExpectation;
  preferenceRepresentativeOneOf: InterpretationPreference[];
  reviewStatusOneOf: Array<"base_only" | "stable" | "mixed">;
  minDirectionConfidence?: number;
};

type InterpretationExpectation = {
  evaluationsCount: number;
  comparisonsCount: number;
  unresolvedCount: number;
  evaluations?: EvaluationExpectation[];
  comparisons?: ComparisonExpectation[];
};

type RankingExpectation = {
  mode: ResultMode;
  rankedCandidateIds?: string[];
  topCandidateId?: string;
  decisionKind?: AiScheduleDecisionKind;
  perfectNowTopCandidateId?: string | null;
  perfectIfResolvedTopCandidateId?: string | null;
  blockedCandidateIds?: string[];
};

type FixtureCase = {
  id: string;
  description: string;
  template: "pair_days" | "split_same_day";
  note: string;
  expectedInterpretation: InterpretationExpectation;
  expectedRanking: RankingExpectation;
};

type FixtureFile = {
  formatVersion: number;
  cases: FixtureCase[];
};

type EvaluationDigest = {
  scope: ScopeExpectation;
  availability: InterpretationAvailability;
  reviewStatus: "base_only" | "stable" | "mixed";
  availabilityConfidence: number;
  preferenceRepresentative: InterpretationPreference | null;
  externalConditionTexts: string[];
};

type ComparisonDigest = {
  candidateScopes: ScopeExpectation[];
  preferredScope: ScopeExpectation | null;
  preferenceRepresentative: InterpretationPreference;
  reviewStatus: "base_only" | "stable" | "mixed";
  directionConfidence: number;
};

function loadLocalEnvFallback() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");

    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex < 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch {
    // Ignore missing .env.local in CI-like environments.
  }
}

function extractFixtureJson(markdown: string) {
  const match = markdown.match(/```json fixture-cases\r?\n([\s\S]*?)\r?\n```/u);

  if (!match?.[1]) {
    throw new Error(`Fixture JSON block not found in ${FIXTURE_PATH}`);
  }

  return JSON.parse(match[1]) as FixtureFile;
}

function sortUnique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeScope(scope: NormalizedScope): ScopeExpectation {
  return {
    dateValues: sortUnique(scope.dateMembers.filter((member) => member.kind !== "補助").map((member) => member.value)),
    timeValues: sortUnique(scope.timeMembers.map((member) => member.value)),
  };
}

function scopeSignature(scope: ScopeExpectation) {
  return `${sortUnique(scope.dateValues).join(",")}|${sortUnique(scope.timeValues).join(",")}`;
}

function matchesPreferredScopeText(scope: NormalizedScope, preferredScopeText: string) {
  const normalizedPreferred = preferredScopeText.replace(/\s+/gu, "").trim();

  if (!normalizedPreferred) {
    return false;
  }

  if (scope.dateText.replace(/\s+/gu, "").trim() === normalizedPreferred) {
    return true;
  }

  if (scope.timeText.replace(/\s+/gu, "").trim() === normalizedPreferred) {
    return true;
  }

  if (scope.dateMemberTexts.some((value) => value.replace(/\s+/gu, "").trim() === normalizedPreferred)) {
    return true;
  }

  return [...scope.dateMembers, ...scope.timeMembers, ...scope.placeMembers].some(
    (member) => member.sourceText.replace(/\s+/gu, "").trim() === normalizedPreferred,
  );
}

function summarizeEvaluation(evaluation: FinalEvaluation): EvaluationDigest {
  return {
    scope: normalizeScope(evaluation.scope),
    availability: evaluation.availability,
    reviewStatus: evaluation.reviewStatus,
    availabilityConfidence: evaluation.availabilityConfidence,
    preferenceRepresentative: evaluation.preference?.representative ?? null,
    externalConditionTexts: evaluation.externalConditionTexts,
  };
}

function summarizeComparison(comparison: FinalComparison): ComparisonDigest {
  const preferredScope =
    comparison.candidateScopes.find((scope) => matchesPreferredScopeText(scope, comparison.preferredScopeText)) ?? null;

  return {
    candidateScopes: comparison.candidateScopes.map((scope) => normalizeScope(scope)).sort((left, right) =>
      scopeSignature(left).localeCompare(scopeSignature(right)),
    ),
    preferredScope: preferredScope ? normalizeScope(preferredScope) : null,
    preferenceRepresentative: comparison.preference.representative,
    reviewStatus: comparison.reviewStatus,
    directionConfidence: comparison.directionConfidence,
  };
}

function buildResponse(
  id: string,
  eventId: string,
  participantName: string,
  availabilityMap: Record<string, ParticipantAnswerRecord["availabilityKey"]>,
): ParticipantResponseRecord {
  return {
    id,
    eventId,
    participantName,
    note: null,
    parsedConstraints: [],
    autoInterpretation: null,
    submittedAt: "2026-04-07T09:00:00+09:00",
    answers: Object.entries(availabilityMap).map(([candidateId, availabilityKey]) => ({
      candidateId,
      availabilityKey,
      selectedDates: [],
      preferredTimeSlotKey: null,
      dateTimePreferences: {},
      availableStartTime: null,
      availableEndTime: null,
    })),
  };
}

function buildTemplateDetail(template: FixtureCase["template"]): EventDetail {
  if (template === "pair_days") {
    const event: EventRecord = {
      id: "fixture-pair-days",
      title: "Fixture Pair Days",
      createdAt: "2026-04-07T00:00:00+09:00",
      defaultResultMode: "maximize_attendance",
    };
    const candidates: EventCandidateRecord[] = [
      {
        id: "cand-18-day",
        eventId: event.id,
        date: "2026-04-18",
        timeSlotKey: "day",
        selectionMode: "range",
        dateType: "single",
        startDate: "2026-04-18",
        endDate: "2026-04-18",
        selectedDates: [],
        timeType: "fixed",
        startTime: "12:00",
        endTime: "17:00",
        note: null,
        sortOrder: 10,
      },
      {
        id: "cand-19-day",
        eventId: event.id,
        date: "2026-04-19",
        timeSlotKey: "day",
        selectionMode: "range",
        dateType: "single",
        startDate: "2026-04-19",
        endDate: "2026-04-19",
        selectedDates: [],
        timeType: "fixed",
        startTime: "12:00",
        endTime: "17:00",
        note: null,
        sortOrder: 20,
      },
    ];

    return {
      event,
      candidates,
      responses: [
        buildResponse("baseline-nao", event.id, "Nao", {
          "cand-18-day": "yes",
          "cand-19-day": "yes",
        }),
        buildResponse("baseline-mina", event.id, "Mina", {
          "cand-18-day": "yes",
          "cand-19-day": "yes",
        }),
      ],
    };
  }

  const event: EventRecord = {
    id: "fixture-split-same-day",
    title: "Fixture Split Same Day",
    createdAt: "2026-04-07T00:00:00+09:00",
    defaultResultMode: "maximize_attendance",
  };
  const candidates: EventCandidateRecord[] = [
    {
      id: "cand-18-day",
      eventId: event.id,
      date: "2026-04-18",
      timeSlotKey: "day",
      selectionMode: "range",
      dateType: "single",
      startDate: "2026-04-18",
      endDate: "2026-04-18",
      selectedDates: [],
      timeType: "fixed",
      startTime: "12:00",
      endTime: "17:00",
      note: null,
      sortOrder: 10,
    },
    {
      id: "cand-18-night",
      eventId: event.id,
      date: "2026-04-18",
      timeSlotKey: "night",
      selectionMode: "range",
      dateType: "single",
      startDate: "2026-04-18",
      endDate: "2026-04-18",
      selectedDates: [],
      timeType: "fixed",
      startTime: "18:00",
      endTime: "22:00",
      note: null,
      sortOrder: 20,
    },
  ];

  return {
    event,
    candidates,
    responses: [
      buildResponse("baseline-nao", event.id, "Nao", {
        "cand-18-day": "yes",
        "cand-18-night": "yes",
      }),
      buildResponse("baseline-mina", event.id, "Mina", {
        "cand-18-day": "yes",
        "cand-18-night": "yes",
      }),
    ],
  };
}

function buildLiveOptions() {
  const provider =
    process.env.LIVE_FIXTURE_PROVIDER?.trim() ||
    (process.env.GEMINI_API_KEY?.trim() ? "gemini" : process.env.LLM_PROVIDER?.trim() || "ollama");

  if (provider === "gemini") {
    return {
      provider: "gemini" as const,
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
      baseUrl: process.env.GEMINI_BASE_URL,
      maxAttempts: Number.parseInt(process.env.LIVE_FIXTURE_MAX_ATTEMPTS ?? "3", 10),
      timeoutMs: Number.parseInt(process.env.LIVE_FIXTURE_TIMEOUT_MS ?? "60000", 10),
    };
  }

  return {
    provider: "ollama" as const,
    model: process.env.OLLAMA_MODEL,
    baseUrl: process.env.OLLAMA_BASE_URL,
    maxAttempts: Number.parseInt(process.env.LIVE_FIXTURE_MAX_ATTEMPTS ?? "3", 10),
    timeoutMs: Number.parseInt(process.env.LIVE_FIXTURE_TIMEOUT_MS ?? "60000", 10),
  };
}

function compareInterpretation(
  actualEvaluations: EvaluationDigest[],
  actualComparisons: ComparisonDigest[],
  unresolvedCount: number,
  expected: InterpretationExpectation,
) {
  const failures: string[] = [];

  if (actualEvaluations.length !== expected.evaluationsCount) {
    failures.push(`evaluationsCount mismatch: expected ${expected.evaluationsCount}, got ${actualEvaluations.length}`);
  }

  if (actualComparisons.length !== expected.comparisonsCount) {
    failures.push(`comparisonsCount mismatch: expected ${expected.comparisonsCount}, got ${actualComparisons.length}`);
  }

  if (unresolvedCount !== expected.unresolvedCount) {
    failures.push(`unresolvedCount mismatch: expected ${expected.unresolvedCount}, got ${unresolvedCount}`);
  }

  for (const evaluationExpectation of expected.evaluations ?? []) {
    const match = actualEvaluations.find(
      (evaluation) =>
        scopeSignature(evaluation.scope) ===
          scopeSignature({
            dateValues: evaluationExpectation.dateValues,
            timeValues: evaluationExpectation.timeValues,
          }) &&
        evaluationExpectation.availabilityOneOf.includes(evaluation.availability),
    );

    if (!match) {
      failures.push(
        `evaluation not found for ${scopeSignature({
          dateValues: evaluationExpectation.dateValues,
          timeValues: evaluationExpectation.timeValues,
        })}`,
      );
      continue;
    }

    if (!evaluationExpectation.reviewStatusOneOf.includes(match.reviewStatus)) {
      failures.push(
        `evaluation reviewStatus mismatch for ${scopeSignature(match.scope)}: expected one of ${evaluationExpectation.reviewStatusOneOf.join(", ")}, got ${match.reviewStatus}`,
      );
    }

    if (
      typeof evaluationExpectation.minAvailabilityConfidence === "number" &&
      match.availabilityConfidence < evaluationExpectation.minAvailabilityConfidence
    ) {
      failures.push(
        `evaluation confidence too low for ${scopeSignature(match.scope)}: expected >= ${evaluationExpectation.minAvailabilityConfidence}, got ${match.availabilityConfidence}`,
      );
    }

    if (
      evaluationExpectation.preferenceRepresentative !== undefined &&
      match.preferenceRepresentative !== evaluationExpectation.preferenceRepresentative
    ) {
      failures.push(
        `evaluation preferenceRepresentative mismatch for ${scopeSignature(match.scope)}: expected ${String(evaluationExpectation.preferenceRepresentative)}, got ${String(match.preferenceRepresentative)}`,
      );
    }

    if (
      evaluationExpectation.preferenceRepresentativeOneOf &&
      !evaluationExpectation.preferenceRepresentativeOneOf.includes(match.preferenceRepresentative as InterpretationPreference)
    ) {
      failures.push(
        `evaluation preferenceRepresentative mismatch for ${scopeSignature(match.scope)}: expected one of ${evaluationExpectation.preferenceRepresentativeOneOf.join(", ")}, got ${String(match.preferenceRepresentative)}`,
      );
    }

    if (
      evaluationExpectation.externalConditionTexts &&
      JSON.stringify(match.externalConditionTexts) !== JSON.stringify(evaluationExpectation.externalConditionTexts)
    ) {
      failures.push(
        `evaluation externalConditionTexts mismatch for ${scopeSignature(match.scope)}: expected ${JSON.stringify(evaluationExpectation.externalConditionTexts)}, got ${JSON.stringify(match.externalConditionTexts)}`,
      );
    }

    for (const expectedConditionText of evaluationExpectation.externalConditionTextsContains ?? []) {
      if (!match.externalConditionTexts.includes(expectedConditionText)) {
        failures.push(
          `evaluation externalConditionTexts missing "${expectedConditionText}" for ${scopeSignature(match.scope)}`,
        );
      }
    }
  }

  for (const comparisonExpectation of expected.comparisons ?? []) {
    const expectedScopeSignatures = comparisonExpectation.candidateScopes
      .map((scope) => scopeSignature(scope))
      .sort((left, right) => left.localeCompare(right));
    const expectedPreferredSignature = scopeSignature(comparisonExpectation.preferredScope);
    const match = actualComparisons.find((comparison) => {
      const actualScopeSignatures = comparison.candidateScopes
        .map((scope) => scopeSignature(scope))
        .sort((left, right) => left.localeCompare(right));

      return JSON.stringify(actualScopeSignatures) === JSON.stringify(expectedScopeSignatures);
    });

    if (!match) {
      failures.push(`comparison not found for scopes ${expectedScopeSignatures.join(" vs ")}`);
      continue;
    }

    if (scopeSignature(match.preferredScope ?? { dateValues: [], timeValues: [] }) !== expectedPreferredSignature) {
      failures.push(
        `comparison preferred scope mismatch: expected ${expectedPreferredSignature}, got ${match.preferredScope ? scopeSignature(match.preferredScope) : "null"}`,
      );
    }

    if (!comparisonExpectation.preferenceRepresentativeOneOf.includes(match.preferenceRepresentative)) {
      failures.push(
        `comparison preferenceRepresentative mismatch: expected one of ${comparisonExpectation.preferenceRepresentativeOneOf.join(", ")}, got ${match.preferenceRepresentative}`,
      );
    }

    if (!comparisonExpectation.reviewStatusOneOf.includes(match.reviewStatus)) {
      failures.push(
        `comparison reviewStatus mismatch: expected one of ${comparisonExpectation.reviewStatusOneOf.join(", ")}, got ${match.reviewStatus}`,
      );
    }

    if (
      typeof comparisonExpectation.minDirectionConfidence === "number" &&
      match.directionConfidence < comparisonExpectation.minDirectionConfidence
    ) {
      failures.push(
        `comparison directionConfidence too low: expected >= ${comparisonExpectation.minDirectionConfidence}, got ${match.directionConfidence}`,
      );
    }
  }

  return failures;
}

function compareRanking(
  rankedCandidateIds: string[],
  perfectNowCandidateIds: string[],
  perfectIfResolvedCandidateIds: string[],
  decisionKind: AiScheduleDecisionKind,
  blockedCandidateIds: string[],
  expected: RankingExpectation,
) {
  const failures: string[] = [];

  if (expected.rankedCandidateIds && JSON.stringify(rankedCandidateIds) !== JSON.stringify(expected.rankedCandidateIds)) {
    failures.push(
      `rankedCandidateIds mismatch: expected ${JSON.stringify(expected.rankedCandidateIds)}, got ${JSON.stringify(rankedCandidateIds)}`,
    );
  }

  if (expected.topCandidateId && rankedCandidateIds[0] !== expected.topCandidateId) {
    failures.push(`topCandidateId mismatch: expected ${expected.topCandidateId}, got ${rankedCandidateIds[0] ?? "none"}`);
  }

  if (expected.decisionKind && decisionKind !== expected.decisionKind) {
    failures.push(`decisionKind mismatch: expected ${expected.decisionKind}, got ${decisionKind}`);
  }

  const actualPerfectNowTop = perfectNowCandidateIds[0] ?? null;
  if (expected.perfectNowTopCandidateId !== undefined && actualPerfectNowTop !== expected.perfectNowTopCandidateId) {
    failures.push(
      `perfectNowTopCandidateId mismatch: expected ${String(expected.perfectNowTopCandidateId)}, got ${String(actualPerfectNowTop)}`,
    );
  }

  const actualPerfectIfResolvedTop = perfectIfResolvedCandidateIds[0] ?? null;
  if (
    expected.perfectIfResolvedTopCandidateId !== undefined &&
    actualPerfectIfResolvedTop !== expected.perfectIfResolvedTopCandidateId
  ) {
    failures.push(
      `perfectIfResolvedTopCandidateId mismatch: expected ${String(expected.perfectIfResolvedTopCandidateId)}, got ${String(actualPerfectIfResolvedTop)}`,
    );
  }

  if (
    expected.blockedCandidateIds &&
    JSON.stringify(sortUnique(blockedCandidateIds)) !== JSON.stringify(sortUnique(expected.blockedCandidateIds))
  ) {
    failures.push(
      `blockedCandidateIds mismatch: expected ${JSON.stringify(sortUnique(expected.blockedCandidateIds))}, got ${JSON.stringify(sortUnique(blockedCandidateIds))}`,
    );
  }

  return failures;
}

describe("natural language ranking fixtures live", () => {
  liveIt("runs fixture markdown through self-consistency and ranking", async () => {
    const fixtureFile = extractFixtureJson(readFileSync(FIXTURE_PATH, "utf8"));
    const liveOptions = buildLiveOptions();
    const caseReports: Array<Record<string, unknown>> = [];
    const failures: string[] = [];

    for (const testCase of fixtureFile.cases) {
      const templateDetail = buildTemplateDetail(testCase.template);
      const interpretation = await interpretCommentWithSelfConsistency(
        testCase.note,
        templateDetail.candidates,
        liveOptions,
      );
      const projected = projectSelfConsistencyToRankingArtifacts(
        testCase.note,
        interpretation,
        templateDetail.candidates,
      );
      const testResponse: ParticipantResponseRecord = {
        id: `fixture-response-${testCase.id}`,
        eventId: templateDetail.event.id,
        participantName: "Fixture User",
        note: testCase.note,
        parsedConstraints: projected.parsedConstraints,
        autoInterpretation: projected.autoInterpretation,
        submittedAt: "2026-04-07T09:10:00+09:00",
        answers: projected.answers,
      };
      const detail: EventDetail = {
        ...templateDetail,
        responses: [...templateDetail.responses, testResponse],
      };

      const evaluationDigests = interpretation.interpretation.evaluations.map((evaluation) => summarizeEvaluation(evaluation));
      const comparisonDigests = interpretation.interpretation.comparisons.map((comparison) => summarizeComparison(comparison));
      const ranked = rankCandidates(detail, testCase.expectedRanking.mode);
      const collections = buildRankedCandidateCollections(detail);
      const decision = buildAiScheduleDecision(detail);
      const rankedCandidateIds = ranked.map((candidate) => candidate.candidate.id);
      const perfectNowCandidateIds = collections.perfectNowRanking.map((candidate) => candidate.candidate.id);
      const perfectIfResolvedCandidateIds = collections.perfectIfResolvedRanking.map((candidate) => candidate.candidate.id);
      const blockedCandidateIds = ranked
        .filter((candidate) =>
          candidate.participantStatuses.some(
            (status) => status.responseId === testResponse.id && status.isConditionBlocked === true,
          ),
        )
        .map((candidate) => candidate.candidate.id);

      const interpretationFailures = compareInterpretation(
        evaluationDigests,
        comparisonDigests,
        interpretation.interpretation.unresolved.length,
        testCase.expectedInterpretation,
      );
      const rankingFailures = compareRanking(
        rankedCandidateIds,
        perfectNowCandidateIds,
        perfectIfResolvedCandidateIds,
        decision.kind,
        blockedCandidateIds,
        testCase.expectedRanking,
      );
      const caseFailures = [...interpretationFailures, ...rankingFailures];

      caseReports.push({
        id: testCase.id,
        description: testCase.description,
        passed: caseFailures.length === 0,
        failures: caseFailures,
        actualInterpretation: {
          evaluations: evaluationDigests,
          comparisons: comparisonDigests,
          unresolvedCount: interpretation.interpretation.unresolved.length,
          meta: interpretation.interpretation.meta,
        },
        actualRanking: {
          rankedCandidateIds,
          perfectNowCandidateIds,
          perfectIfResolvedCandidateIds,
          bestAttendanceCandidateIds: collections.bestAttendanceRanking.map((candidate) => candidate.candidate.id),
          blockedCandidateIds,
          decisionKind: decision.kind,
        },
      });

      for (const failure of caseFailures) {
        failures.push(`${testCase.id}: ${failure}`);
      }
    }

    const report = {
      fixturePath: FIXTURE_PATH,
      provider: liveOptions.provider,
      model: liveOptions.model ?? null,
      cases: caseReports,
      summary: {
        total: fixtureFile.cases.length,
        passed: caseReports.filter((item) => item.passed === true).length,
        failed: caseReports.filter((item) => item.passed !== true).length,
      },
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    expect(failures).toEqual([]);
  }, 480000);
});
