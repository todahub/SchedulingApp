import type { EventCandidateRecord } from "@/lib/domain";
import { labelCommentText } from "@/lib/comment-labeler";
import { getCandidateDateValues } from "@/lib/utils";
import type {
  BaseInterpretationConditionDraft,
  BaseInterpretationComparisonDraft,
  BaseInterpretationDraft,
  BaseInterpretationEvaluationDraft,
  ConditionReviewTask,
  ComparisonReviewTask,
  EvaluationReviewTask,
  ReviewTask,
  RiskAssessment,
  RiskSignal,
} from "./types";

function buildEventDateRange(candidates: EventCandidateRecord[]) {
  const dates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );

  if (dates.length === 0) {
    return undefined;
  }

  return {
    start: dates[0]!,
    end: dates[dates.length - 1]!,
  };
}

function uniqueSignals(signals: RiskSignal[]) {
  return [...new Set(signals)];
}

function assessSnippetRisk(text: string, candidates: EventCandidateRecord[], reviewKind: "evaluation" | "comparison" | "condition"): RiskAssessment {
  const dateRange = buildEventDateRange(candidates);
  const labeled = labelCommentText(text, dateRange ? { eventDateRange: dateRange } : undefined);
  const labels = new Set(labeled.tokens.map((token) => token.label));
  const targetCount = labeled.tokens.filter((token) => token.label.startsWith("target_")).length;
  const signals: RiskSignal[] = [];

  if (reviewKind === "comparison" || labels.has("comparison_marker") || /より|方が|ほうが|どっち|どちら|なら/u.test(text)) {
    signals.push("comparison");
  }
  if (reviewKind === "condition" || labels.has("conditional_marker") || labels.has("hypothetical_marker")) {
    signals.push("condition");
  }
  if (labels.has("uncertainty_marker") || /たぶん|かな|かも|未定|わからない|分からない/u.test(text)) {
    signals.push("uncertainty");
  }
  if (labels.has("weak_commitment_marker")) {
    signals.push("weak_commitment");
  }
  if (labels.has("negation_marker") || /行けなくはない|いけなくはない|無理ではない|ないことはない/u.test(text)) {
    signals.push("negation_complexity");
  }
  if (targetCount >= 2) {
    signals.push("multi_target");
  }
  if (labels.has("preference_positive_marker") || labels.has("preference_negative_marker") || labels.has("emotion_weak_accept_marker")) {
    signals.push("preference");
  }

  const unique = uniqueSignals(signals);
  const shouldReview =
    reviewKind === "comparison" ||
    reviewKind === "condition" ||
    unique.includes("comparison") ||
    unique.includes("condition") ||
    unique.includes("uncertainty") ||
    unique.includes("negation_complexity") ||
    unique.includes("multi_target") ||
    unique.includes("weak_commitment");

  return {
    reviewKind,
    sourceText: text,
    signals: unique,
    shouldReview,
  };
}

function buildEvaluationTask(draft: BaseInterpretationEvaluationDraft, note: string, index: number): EvaluationReviewTask {
  return {
    id: `evaluation:${index}`,
    kind: "evaluation",
    note,
    focusText: draft.evidenceText,
    targetText: draft.targetText,
    conditionText: draft.conditionText,
    base: draft,
  };
}

function buildComparisonTask(draft: BaseInterpretationComparisonDraft, note: string, index: number): ComparisonReviewTask {
  return {
    id: `comparison:${index}`,
    kind: "comparison",
    note,
    focusText: draft.evidenceText,
    candidateSetText: draft.candidateSetText,
    preferredTargetText: draft.preferredTargetText,
    base: draft,
  };
}

function buildConditionTask(draft: BaseInterpretationConditionDraft, note: string, index: number): ConditionReviewTask {
  return {
    id: `condition:${index}`,
    kind: "condition",
    note,
    focusText: draft.evidenceText,
    targetText: draft.targetText,
    conditionText: draft.conditionText,
    base: draft,
  };
}

export function buildReviewPlan(note: string, draft: BaseInterpretationDraft, candidates: EventCandidateRecord[]) {
  const risks: RiskAssessment[] = [];
  const reviewTasks: ReviewTask[] = [];

  draft.evaluations.forEach((evaluation, index) => {
    const risk = assessSnippetRisk(
      evaluation.conditionText ? `${evaluation.conditionText} ${evaluation.evidenceText}` : evaluation.evidenceText,
      candidates,
      "evaluation",
    );
    risks.push(risk);
    if (risk.shouldReview) {
      reviewTasks.push(buildEvaluationTask(evaluation, note, index));
    }
  });

  draft.comparisons.forEach((comparison, index) => {
    const risk = assessSnippetRisk(
      comparison.conditionText ? `${comparison.conditionText} ${comparison.evidenceText}` : comparison.evidenceText,
      candidates,
      "comparison",
    );
    risks.push(risk);
    if (risk.shouldReview) {
      reviewTasks.push(buildComparisonTask(comparison, note, index));
    }
  });

  draft.conditions.forEach((condition, index) => {
    const risk = assessSnippetRisk(`${condition.conditionText} ${condition.evidenceText}`, candidates, "condition");
    risks.push(risk);
    if (risk.shouldReview) {
      reviewTasks.push(buildConditionTask(condition, note, index));
    }
  });

  return {
    risks,
    reviewTasks,
  };
}

export function assessCommentRisk(note: string, candidates: EventCandidateRecord[]) {
  return assessSnippetRisk(note, candidates, "evaluation");
}

export { assessSnippetRisk };
