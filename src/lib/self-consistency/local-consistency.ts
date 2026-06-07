import { requestStructuredJsonFromLlm } from "@/lib/llm-client";
import {
  INTERPRETATION_AVAILABILITIES,
  INTERPRETATION_PREFERENCES,
  INTERPRETATION_TIME_ROLES,
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

function isTimeRole(value: unknown): value is EvaluationReviewDecision["timeRole"] {
  return typeof value === "string" && (INTERPRETATION_TIME_ROLES as readonly string[]).includes(value);
}

function isTargetType(value: unknown): value is ConditionReviewDecision["targetType"] {
  return typeof value === "string" && (INTERPRETATION_TARGET_TYPES as readonly string[]).includes(value);
}

function validateEvaluationDecision(parsed: unknown, note: string): EvaluationReviewDecision {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Evaluation review was not an object.");
  }

  const targetText = "targetText" in parsed && typeof parsed.targetText === "string" ? parsed.targetText.trim() : "";
  const timeText =
    "timeText" in parsed && (typeof parsed.timeText === "string" || parsed.timeText === null)
      ? typeof parsed.timeText === "string"
        ? parsed.timeText.trim()
        : null
      : null;
  const timeRole = "timeRole" in parsed ? parsed.timeRole : null;
  const availability = "availability" in parsed ? parsed.availability : null;
  const preference = "preference" in parsed ? parsed.preference : null;
  const evidenceText = "evidenceText" in parsed && typeof parsed.evidenceText === "string" ? parsed.evidenceText.trim() : "";

  if (
    !targetText ||
    !containsLoosely(note, targetText) ||
    !isTimeRole(timeRole) ||
    (timeText !== null && (!timeText || !containsLoosely(note, timeText))) ||
    (timeText === null && timeRole !== "指定なし") ||
    (timeText !== null && timeRole === "指定なし") ||
    !isAvailability(availability) ||
    !isNullablePreference(preference) ||
    !containsLoosely(note, evidenceText)
  ) {
    throw new Error("Evaluation review response was invalid.");
  }

  return {
    targetText,
    timeText,
    timeRole,
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
  const timeText =
    "timeText" in parsed && (typeof parsed.timeText === "string" || parsed.timeText === null)
      ? typeof parsed.timeText === "string"
        ? parsed.timeText.trim()
        : null
      : null;
  const timeRole = "timeRole" in parsed ? parsed.timeRole : null;
  const availability = "availability" in parsed ? parsed.availability : null;
  const conditionText = "conditionText" in parsed && typeof parsed.conditionText === "string" ? parsed.conditionText.trim() : "";
  const evidenceText = "evidenceText" in parsed && typeof parsed.evidenceText === "string" ? parsed.evidenceText.trim() : "";

  if (
    !targetText ||
    !containsLoosely(note, targetText) ||
    !isTargetType(targetType) ||
    !isTimeRole(timeRole) ||
    (timeText !== null && (!timeText || !containsLoosely(note, timeText))) ||
    (timeText === null && timeRole !== "指定なし") ||
    (timeText !== null && timeRole === "指定なし") ||
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
    timeText,
    timeRole,
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

const REVIEW_KIND_PRIORITY: Record<ReviewTask["kind"], number> = {
  comparison: 0,
  condition: 1,
  evaluation: 2,
};

function compareTasks(left: ReviewTask, right: ReviewTask) {
  const priorityDiff = REVIEW_KIND_PRIORITY[left.kind] - REVIEW_KIND_PRIORITY[right.kind];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return left.id.localeCompare(right.id, "ja");
}

export function buildReviewSchedule(reviewTasks: ReviewTask[], maxAdditionalCalls: number) {
  const budget = Math.max(0, maxAdditionalCalls);
  const sortedTasks = [...reviewTasks].sort(compareTasks);

  if (budget === 0 || sortedTasks.length === 0) {
    return [] as Array<{ task: ReviewTask; attempt: number }>;
  }

  const attemptsByTask = new Map<string, number>();
  const schedule: Array<{ task: ReviewTask; attempt: number }> = [];
  let remainingBudget = budget;

  for (const task of sortedTasks) {
    if (remainingBudget === 0) {
      break;
    }

    attemptsByTask.set(task.id, 1);
    schedule.push({ task, attempt: 1 });
    remainingBudget -= 1;
  }

  while (remainingBudget > 0 && sortedTasks.length > 0) {
    for (const task of sortedTasks) {
      if (remainingBudget === 0) {
        break;
      }

      const nextAttempt = (attemptsByTask.get(task.id) ?? 0) + 1;
      attemptsByTask.set(task.id, nextAttempt);
      schedule.push({ task, attempt: nextAttempt });
      remainingBudget -= 1;
    }
  }

  return schedule;
}

export async function runLocalConsistency(
  reviewTasks: ReviewTask[],
  options: InterpretationLlmOptions & { maxAdditionalCalls: number },
) {
  const reviewRuns: ReviewRun[] = [];

  for (const scheduled of buildReviewSchedule(reviewTasks, options.maxAdditionalCalls)) {
    const decision = await requestSingleReview(scheduled.task, options);
    reviewRuns.push({
      taskId: scheduled.task.id,
      kind: scheduled.task.kind,
      attempt: scheduled.attempt,
      decision,
    });
  }

  return reviewRuns;
}
