import type { EventCandidateRecord } from "@/lib/domain";
import { aggregateInterpretation } from "./aggregation";
import { requestBaseInterpretation } from "./base-interpretation";
import { runLocalConsistency } from "./local-consistency";
import { buildReviewPlan } from "./risk-detection";
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
          reviewedTaskCount: 0,
          reviewRunCount: 0,
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
        reviewTasks: [],
        reviewRuns: [],
      },
    };
  }

  const baseInterpretation = await requestBaseInterpretation(trimmed, candidates, options);
  const { risks, reviewTasks } = buildReviewPlan(trimmed, baseInterpretation, candidates);
  const reviewRuns = await runLocalConsistency(reviewTasks, {
    ...options,
    reviewAttempts: options.reviewAttempts ?? 3,
    escalationAttempts: options.escalationAttempts ?? 5,
  });
  const interpretation = aggregateInterpretation({
    note: trimmed,
    draft: baseInterpretation,
    reviewRuns,
    candidates,
  });

  return {
    interpretation,
    debug: {
      baseInterpretation,
      risks,
      reviewTasks,
      reviewRuns,
    },
  };
}
