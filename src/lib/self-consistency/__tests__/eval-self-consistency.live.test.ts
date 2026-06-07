import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getEventDetail } from "@/lib/repository";
import { interpretCommentWithSelfConsistency } from "@/lib/self-consistency";

const liveIt = process.env.RUN_LIVE_EVAL === "1" ? it : it.skip;
const requestedLabels = (process.env.LIVE_LABELS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const liveMaxAttempts = Number.parseInt(process.env.LIVE_MAX_ATTEMPTS ?? "5", 10);

const scenarios = [
  {
    label: "short_clear_no",
    eventId: "demo-team-dinner",
    note: "18日は無理",
  },
  {
    label: "short_clear_conditional",
    eventId: "demo-team-dinner",
    note: "18日は夜なら行ける",
  },
  {
    label: "short_ambiguous_comparison",
    eventId: "demo-team-dinner",
    note: "18と19なら19かな",
  },
  {
    label: "short_soft_preference",
    eventId: "demo-team-dinner",
    note: "19日はいけたら行きたい",
  },
  {
    label: "long_clear",
    eventId: "demo-team-dinner",
    note: "4月前半は難しいです。18日は夜なら行けます。19日は行けます。20日は終日いけます。平日は遅めの時間の方が助かります。",
  },
  {
    label: "long_ambiguous",
    eventId: "demo-team-dinner",
    note: "4月前半は少し厳しいかもです。18日は夜なら行けると思います。19日と20日なら19日の方が嬉しいですが、他の日が難しければ20日でも大丈夫です。平日は遅めの時間なら助かります。",
  },
] as const;

const activeScenarios =
  requestedLabels.length > 0 ? scenarios.filter((scenario) => requestedLabels.includes(scenario.label)) : scenarios;

type Scenario = (typeof scenarios)[number];
type InterpretationResult = Awaited<ReturnType<typeof interpretCommentWithSelfConsistency>>;

function summarize(result: InterpretationResult, scenario: Scenario) {
  return {
    label: scenario.label,
    eventId: scenario.eventId,
    note: scenario.note,
    meta: result.interpretation.meta,
    risks: result.debug.risks,
    evaluations: result.interpretation.evaluations.map((item) => ({
      scope: item.scope,
      availability: item.availability,
      availabilityConfidence: item.availabilityConfidence,
      availabilityWeight: item.availabilityWeight,
      preference: item.preference
        ? {
            representative: item.preference.representative,
            mean: item.preference.mean,
            histogram: item.preference.histogram,
          }
        : null,
      externalConditionTexts: item.externalConditionTexts,
      reviewStatus: item.reviewStatus,
      evidenceTexts: item.evidenceTexts,
    })),
    comparisons: result.interpretation.comparisons.map((item) => ({
      candidateSetText: item.candidateSetText,
      candidateScopes: item.candidateScopes,
      preferredScopeText: item.preferredScopeText,
      directionConfidence: item.directionConfidence,
      preference: {
        representative: item.preference.representative,
        mean: item.preference.mean,
        histogram: item.preference.histogram,
      },
      externalConditionTexts: item.externalConditionTexts,
      reviewStatus: item.reviewStatus,
      evidenceTexts: item.evidenceTexts,
    })),
    unresolved: result.interpretation.unresolved,
  };
}

describe("live self-consistency evaluation", () => {
  liveIt("runs representative comments and writes summaries", async () => {
    const summaries: ReturnType<typeof summarize>[] = [];

    for (const scenario of activeScenarios) {
      const detail = await getEventDetail(scenario.eventId);
      expect(detail).not.toBeNull();

      const result = await interpretCommentWithSelfConsistency(scenario.note, detail!.candidates, {
        provider: "gemini",
        model: process.env.GEMINI_MODEL,
        apiKey: process.env.GEMINI_API_KEY,
        baseUrl: process.env.GEMINI_BASE_URL,
        maxAttempts: Number.isFinite(liveMaxAttempts) ? liveMaxAttempts : 5,
      });

      summaries.push(summarize(result, scenario));
    }

    const outputPath = process.env.LIVE_OUTPUT_PATH ?? "/tmp/self-consistency-eval-results.json";
    writeFileSync(outputPath, JSON.stringify(summaries, null, 2), "utf8");
    console.log(JSON.stringify(summaries, null, 2));
  }, 240000);
});
