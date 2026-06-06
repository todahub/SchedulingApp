import { requestStructuredJsonFromLlm } from "@/lib/llm-client";
import {
  INTERPRETATION_AVAILABILITIES,
  INTERPRETATION_PREFERENCES,
  INTERPRETATION_TARGET_TYPES,
  type ConditionReviewDecision,
  type ComparisonReviewDecision,
  type EvaluationReviewDecision,
  type InterpretationLlmOptions,
  type ReviewRun,
  type ReviewTask,
} from "./types";
import {
  buildComparisonReviewSchema,
  buildConditionReviewSchema,
  buildEvaluationReviewSchema,
  buildLocalReviewSystemPrompt,
  buildLocalReviewUserPrompt,
} from "./prompts";

function parseJson(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("LLM response was not valid JSON.");
  }
}

function containsLoosely(note: string, candidate: string | null) {
  if (candidate === null) {
    return true;
  }

  const normalize = (value: string) => value.replace(/\s+/gu, "").trim();
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return normalize(note).includes(normalizedCandidate);
}

function isAvailability(value: unknown): value is EvaluationReviewDecision["availability"] {
  return typeof value === "string" && (INTERPRETATION_AVAILABILITIES as readonly string[]).includes(value);
}

function isPreference(value: unknown): value is EvaluationReviewDecision["preference"] {
  return typeof value === "string" && (INTERPRETATION_PREFERENCES as readonly string[]).includes(value);
}

function isNullablePreference(value: unknown): value is EvaluationReviewDecision["preference"] {
  return value === null || isPreference(value);
}

function isTargetType(value: unknown): value is ConditionReviewDecision["targetType"] {
  return typeof value === "string" && (INTERPRETATION_TARGET_TYPES as readonly string[]).includes(value);
}

function validateEvaluationDecision(parsed: unknown, note: string): EvaluationReviewDecision {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Evaluation review was not an object.");
  }

  const targetText = "targetText" in parsed && typeof parsed.targetText === "string" ? parsed.targetText.trim() : "";
  const availability = "availability" in parsed ? parsed.availability : null;
  const preference = "preference" in parsed ? parsed.preference : null;
  const evidenceText = "evidenceText" in parsed && typeof parsed.evidenceText === "string" ? parsed.evidenceText.trim() : "";

  if (!targetText || !containsLoosely(note, targetText) || !isAvailability(availability) || !isNullablePreference(preference) || !containsLoosely(note, evidenceText)) {
    throw new Error("Evaluation review response was invalid.");
  }

  return {
    targetText,
    availability,
    preference,
    evidenceText,
  };
}

function validateComparisonDecision(parsed: unknown, note: string): ComparisonReviewDecision {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Comparison review was not an object.");
  }

  const candidateSetText =
    "candidateSetText" in parsed && (typeof parsed.candidateSetText === "string" || parsed.candidateSetText === null)
      ? parsed.candidateSetText
      : null;
  const preferredTargetText =
    "preferredTargetText" in parsed && typeof parsed.preferredTargetText === "string" ? parsed.preferredTargetText.trim() : "";
  const preference = "preference" in parsed ? parsed.preference : null;
  const conditionText =
    "conditionText" in parsed && (typeof parsed.conditionText === "string" || parsed.conditionText === null)
      ? parsed.conditionText
      : null;
  const evidenceText = "evidenceText" in parsed && typeof parsed.evidenceText === "string" ? parsed.evidenceText.trim() : "";

  if (
    !preferredTargetText ||
    !containsLoosely(note, preferredTargetText) ||
    !isPreference(preference) ||
    !containsLoosely(note, evidenceText) ||
    (candidateSetText !== null && !containsLoosely(note, candidateSetText)) ||
    (conditionText !== null && !containsLoosely(note, conditionText))
  ) {
    throw new Error("Comparison review response was invalid.");
  }

  const validatedPreference = preference as ComparisonReviewDecision["preference"];

  return {
    candidateSetText,
    preferredTargetText,
    preference: validatedPreference,
    conditionText,
    evidenceText,
  };
}

function validateConditionDecision(parsed: unknown, note: string): ConditionReviewDecision {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Condition review was not an object.");
  }

  const targetText = "targetText" in parsed && typeof parsed.targetText === "string" ? parsed.targetText.trim() : "";
  const targetType = "targetType" in parsed ? parsed.targetType : null;
  const availability = "availability" in parsed ? parsed.availability : null;
  const conditionText = "conditionText" in parsed && typeof parsed.conditionText === "string" ? parsed.conditionText.trim() : "";
  const evidenceText = "evidenceText" in parsed && typeof parsed.evidenceText === "string" ? parsed.evidenceText.trim() : "";

  if (
    !targetText ||
    !containsLoosely(note, targetText) ||
    !isTargetType(targetType) ||
    !isAvailability(availability) ||
    !conditionText ||
    !containsLoosely(note, conditionText) ||
    !containsLoosely(note, evidenceText)
  ) {
    throw new Error("Condition review response was invalid.");
  }

  return {
    targetText,
    targetType,
    availability,
    conditionText,
    evidenceText,
  };
}

async function requestSingleReview(task: ReviewTask, options: InterpretationLlmOptions) {
  const schema =
    task.kind === "evaluation"
      ? buildEvaluationReviewSchema()
      : task.kind === "comparison"
        ? buildComparisonReviewSchema()
        : buildConditionReviewSchema();
  const responseText = await requestStructuredJsonFromLlm(options, {
    systemPrompt: buildLocalReviewSystemPrompt(task),
    userPrompt: buildLocalReviewUserPrompt(task),
    schema,
    temperature: 0.45,
  });
  const parsed = parseJson(responseText);

  if (task.kind === "evaluation") {
    return validateEvaluationDecision(parsed, task.note);
  }
  if (task.kind === "comparison") {
    return validateComparisonDecision(parsed, task.note);
  }

  return validateConditionDecision(parsed, task.note);
}

function getAgreementRate(runs: ReviewRun[]) {
  if (runs.length === 0) {
    return 1;
  }

  const counts = new Map<string, number>();

  for (const run of runs) {
    let key = "";
    if (run.kind === "evaluation") {
      const decision = run.decision as EvaluationReviewDecision;
      key = `${decision.targetText}:${decision.availability}:${decision.preference}`;
    } else if (run.kind === "comparison") {
      const decision = run.decision as ComparisonReviewDecision;
      key = `${decision.preferredTargetText}:${decision.preference}`;
    } else {
      const decision = run.decision as ConditionReviewDecision;
      key = `${decision.targetText}:${decision.availability}:${decision.conditionText}`;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.values()].sort((left, right) => right - left)[0] ?? 0;
  return top / runs.length;
}

export async function runLocalConsistency(
  reviewTasks: ReviewTask[],
  options: InterpretationLlmOptions & { reviewAttempts: number; escalationAttempts: number },
) {
  const reviewRuns: ReviewRun[] = [];

  for (const task of reviewTasks) {
    const initialAttempts = Math.max(1, options.reviewAttempts);

    for (let attempt = 1; attempt <= initialAttempts; attempt += 1) {
      const decision = await requestSingleReview(task, options);
      reviewRuns.push({
        taskId: task.id,
        kind: task.kind,
        attempt,
        decision,
      });
    }

    const currentRuns = reviewRuns.filter((run) => run.taskId === task.id);
    if (getAgreementRate(currentRuns) >= 0.67) {
      continue;
    }

    const extraAttempts = Math.max(0, options.escalationAttempts - initialAttempts);
    for (let extraIndex = 0; extraIndex < extraAttempts; extraIndex += 1) {
      const decision = await requestSingleReview(task, options);
      reviewRuns.push({
        taskId: task.id,
        kind: task.kind,
        attempt: initialAttempts + extraIndex + 1,
        decision,
      });
    }
  }

  return reviewRuns;
}
