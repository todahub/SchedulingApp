import type { EventCandidateRecord } from "@/lib/domain";
import { aggregateInterpretation } from "./aggregation";
import { requestBaseInterpretation } from "./base-interpretation";
import { assessCommentRisk } from "./risk-detection";
import type { SelfConsistencyInterpretationResult, SelfConsistencyPipelineOptions } from "./types";

export async function interpretCommentWithSelfConsistency(
  note: string,
  candidates: EventCandidateRecord[],
  options: SelfConsistencyPipelineOptions = {},
): Promise<SelfConsistencyInterpretationResult> {
  const trimmed = note.trim();

  if (!trimmed) {
    return {
      interpretation: {
        sourceText: trimmed,
        targetEvaluations: [],
        comparisons: [],
        conditions: [],
        unresolved: [],
        meta: {
          totalInterpretationRuns: 0,
          performedAdditionalRuns: 0,
          multiRunTriggered: false,
        },
      },
      debug: {
        baseInterpretation: {
          evaluations: [],
          comparisons: [],
          conditions: [],
          unresolved: [],
        },
        risks: [],
        interpretationRuns: [],
        multiRunTriggered: false,
        performedAdditionalRuns: 0,
      },
    };
  }

  const baseInterpretation = await requestBaseInterpretation(trimmed, candidates, options);
  const commentRisk = assessCommentRisk(trimmed, candidates);
  const maxAdditionalRuns = options.maxAdditionalInterpretationRuns ?? options.maxAdditionalReviewCalls ?? 3;
  const performedAdditionalRuns = commentRisk.shouldReview ? Math.max(0, maxAdditionalRuns) : 0;
  const interpretationRuns = [baseInterpretation];

  for (let runIndex = 0; runIndex < performedAdditionalRuns; runIndex += 1) {
    interpretationRuns.push(await requestBaseInterpretation(trimmed, candidates, options));
  }

  const interpretation = aggregateInterpretation({
    note: trimmed,
    drafts: interpretationRuns,
    candidates,
  });

  return {
    interpretation,
    debug: {
      baseInterpretation,
      interpretationRuns,
      risks: [commentRisk],
      multiRunTriggered: performedAdditionalRuns > 0,
      performedAdditionalRuns,
    },
  };
}
