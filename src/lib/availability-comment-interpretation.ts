import { labelCommentText } from "@/lib/comment-labeler";
import type { Label } from "@/lib/comment-labeler";
import { buildAnswersFromConstraints, buildDefaultAnswers } from "@/lib/comment-parser";
import {
  toLlmInterpretationInput,
  type AppliesToTokenLink,
  type LlmInterpretationInput,
  type LlmInterpretationOutput,
  type StructuralTokenLink,
} from "@/lib/availability-interpretation";
import type {
  AutoInterpretationPreference,
  AutoInterpretationResolvedCandidateStatus,
  AutoInterpretationResult,
  AutoInterpretationRule,
  EventCandidateRecord,
  ParsedCommentConstraint,
  ParsedConstraintLevel,
  ParticipantAnswerRecord,
} from "@/lib/domain";
import { getCandidateDateValues, normalizeCandidate } from "@/lib/utils";

export type TokenIndexGroup = {
  id: string;
  tokenIndexes: number[];
};

export type ClauseGroup = TokenIndexGroup & {
  anchorGroupId: string | null;
  availabilityGroupId: string;
  appliesToTargetTokenIndexes: number[];
  contextTargetGroupIds: string[];
  contextTargetGroups: TokenIndexGroup[];
  semanticModifierTokenIndexes: number[];
};

export type AvailabilityInterpretationGrouping = {
  targetGroups: TokenIndexGroup[];
  scopeGroups: TokenIndexGroup[];
  availabilityGroups: TokenIndexGroup[];
  clauseGroups: ClauseGroup[];
  contrastMarkers: TokenIndexGroup[];
  residualScopeGroups: TokenIndexGroup[];
  exceptionScopeGroups: TokenIndexGroup[];
};

export type AvailabilityInterpretationExecutionInput = {
  originalText: string;
  tokens: LlmInterpretationInput["tokens"];
  grouping: AvailabilityInterpretationGrouping;
};

export type DerivedAvailabilityInterpretationResponse = {
  parsedConstraints: ParsedCommentConstraint[];
  usedDefault: boolean;
  defaultReason: "empty" | "unparsed" | null;
  answers: ParticipantAnswerRecord[];
};

export function buildAvailabilityInterpretationExecutionInput(
  comment: string,
  candidates: EventCandidateRecord[],
): AvailabilityInterpretationExecutionInput {
  const eventDateRange = buildEventDateRange(candidates);
  const labeledComment = labelCommentText(comment, eventDateRange ? { eventDateRange } : undefined);
  const llmInput = toLlmInterpretationInput(labeledComment);

  return {
    originalText: llmInput.originalText,
    tokens: llmInput.tokens,
    grouping: buildAvailabilityInterpretationGrouping(llmInput),
  };
}

export function buildEventDateRange(candidates: EventCandidateRecord[]) {
  const allDates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );

  if (allDates.length === 0) {
    return undefined;
  }

  return {
    start: allDates[0]!,
    end: allDates[allDates.length - 1]!,
  };
}

export function buildAvailabilityInterpretationGrouping(input: LlmInterpretationInput): AvailabilityInterpretationGrouping {
  const targetGroups = buildTargetGroups(input);
  const scopeGroups = buildSingleTokenGroups(input, isScopeLabel, "sg");
  const availabilityGroups = buildSingleTokenGroups(input, isAvailabilityLabel, "ag");

  return {
    targetGroups,
    scopeGroups,
    availabilityGroups,
    clauseGroups: buildClauseGroups(input, [...targetGroups, ...scopeGroups], availabilityGroups),
    contrastMarkers: buildSingleTokenGroups(input, (label) => label === "conjunction_contrast", "cm"),
    residualScopeGroups: buildSingleTokenGroups(input, (label) => label === "scope_residual", "rg"),
    exceptionScopeGroups: buildSingleTokenGroups(input, (label) => label === "scope_exception", "eg"),
  };
}

export function buildAutoInterpretationResult(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  candidates: EventCandidateRecord[] = [],
): AutoInterpretationResult {
  const rules = graph.links
    .filter((link): link is AppliesToTokenLink => link.relation === "applies_to")
    .map((link) => toAutoInterpretationRule(executionInput, graph, link));
  const preferences = buildPreferenceInterpretations(executionInput);
  const resolvedCandidateStatuses = buildResolvedCandidateStatusesFromAvailabilityInterpretation(rules, candidates);

  if (rules.length === 0 && preferences.length === 0) {
    return {
      status: "failed",
      sourceComment: executionInput.originalText,
      rules: [],
      resolvedCandidateStatuses,
      preferences: [],
      ambiguities: graph.ambiguities ?? [],
      failureReason: "安全に表示できる自動解釈ルールを作れませんでした。",
      debugGraphJson: JSON.stringify(graph, null, 2),
    };
  }

  return {
    status: "success",
    sourceComment: executionInput.originalText,
    rules,
    resolvedCandidateStatuses,
    preferences,
    ambiguities: graph.ambiguities ?? [],
    failureReason: null,
    debugGraphJson: JSON.stringify(graph, null, 2),
  };
}

export function buildDerivedResponseFromAvailabilityInterpretation(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  candidates: EventCandidateRecord[],
): DerivedAvailabilityInterpretationResponse {
  const trimmed = executionInput.originalText.trim();

  if (!trimmed) {
    return {
      parsedConstraints: [],
      usedDefault: true,
      defaultReason: "empty",
      answers: buildDefaultAnswers(candidates),
    };
  }

  const parsedConstraints = buildParsedConstraintsFromAvailabilityInterpretation(executionInput, graph, candidates);

  if (parsedConstraints.length === 0) {
    return {
      parsedConstraints,
      usedDefault: true,
      defaultReason: "unparsed",
      answers: buildDefaultAnswers(candidates),
    };
  }

  return {
    parsedConstraints,
    usedDefault: false,
    defaultReason: null,
    answers: buildAnswersFromConstraints(candidates, parsedConstraints),
  };
}

export function formatAutoInterpretationTarget(rule: AutoInterpretationRule) {
  return rule.targetText;
}

export function formatAutoInterpretationAvailability(rule: AutoInterpretationRule) {
  const modifierTexts = [...new Set(rule.modifierTexts.map((text) => text.trim()).filter(Boolean))];

  return modifierTexts.length > 0 ? `${modifierTexts.join(" ")} ${rule.availabilityText}` : rule.availabilityText;
}

export function formatAutoInterpretationPreference(preference: AutoInterpretationPreference) {
  return preference.strength === "preferred_if_possible" ? "できれば希望" : "希望";
}

function buildTargetGroups(input: LlmInterpretationInput) {
  const groups: TokenIndexGroup[] = [];
  let current: number[] = [];

  for (const token of input.tokens) {
    if (!isTargetLabel(token.label)) {
      continue;
    }

    if (current.length === 0) {
      current = [token.index];
      continue;
    }

    const previousIndex = current[current.length - 1]!;
    const betweenLabels = input.tokens.slice(previousIndex + 1, token.index).map((entry) => entry.label);

    if (betweenLabels.length > 0 && betweenLabels.every(isTargetGroupJoinerLabel)) {
      current.push(token.index);
      continue;
    }

    groups.push({
      id: `tg${groups.length + 1}`,
      tokenIndexes: current,
    });
    current = [token.index];
  }

  if (current.length > 0) {
    groups.push({
      id: `tg${groups.length + 1}`,
      tokenIndexes: current,
    });
  }

  return groups;
}

function buildSingleTokenGroups(
  input: LlmInterpretationInput,
  predicate: (label: Label) => boolean,
  prefix: string,
) {
  return input.tokens
    .filter((token) => predicate(token.label))
    .map((token, index) => ({
      id: `${prefix}${index + 1}`,
      tokenIndexes: [token.index],
    }));
}

function buildClauseGroups(
  input: LlmInterpretationInput,
  anchorGroups: TokenIndexGroup[],
  availabilityGroups: TokenIndexGroup[],
) {
  return availabilityGroups.map((availabilityGroup, index) => {
    const availabilityStart = availabilityGroup.tokenIndexes[0]!;
    const clauseStart = findClauseStart(input, availabilityStart);
    const anchorGroup = [...anchorGroups]
      .filter((group) => Math.max(...group.tokenIndexes) < availabilityStart && Math.min(...group.tokenIndexes) >= clauseStart)
      .sort((left, right) => Math.max(...left.tokenIndexes) - Math.max(...right.tokenIndexes))
      .at(-1);
    const localContextTargetGroups = anchorGroups.filter(
      (group) => Math.max(...group.tokenIndexes) < availabilityStart && Math.min(...group.tokenIndexes) >= clauseStart,
    );
    const isResidualScopeAnchor =
      Boolean(anchorGroup) &&
      anchorGroup!.tokenIndexes.length === 1 &&
      input.tokens[anchorGroup!.tokenIndexes[0]!]!.label === "scope_residual";
    const contextTargetGroups =
      isResidualScopeAnchor && localContextTargetGroups.filter((group) => group.id.startsWith("tg")).length === 0
        ? anchorGroups.filter((group) => group.id.startsWith("tg") && Math.max(...group.tokenIndexes) < availabilityStart)
        : localContextTargetGroups;
    const modifierIndexes = input.tokens
      .filter(
        (token) => token.index >= clauseStart && token.index < availabilityStart && isSemanticModifierLabel(token.label),
      )
      .map((token) => token.index);
    const tokenIndexes = sortIndexes([...(anchorGroup?.tokenIndexes ?? []), ...modifierIndexes, ...availabilityGroup.tokenIndexes]);

    return {
      id: `cg${index + 1}`,
      tokenIndexes,
      anchorGroupId: anchorGroup?.id ?? null,
      availabilityGroupId: availabilityGroup.id,
      appliesToTargetTokenIndexes: anchorGroup?.tokenIndexes ?? [],
      contextTargetGroupIds: contextTargetGroups
        .filter((group) => group.id.startsWith("tg"))
        .map((group) => group.id),
      contextTargetGroups: contextTargetGroups
        .filter((group) => group.id.startsWith("tg"))
        .map((group) => ({
          id: group.id,
          tokenIndexes: group.tokenIndexes,
        })),
      semanticModifierTokenIndexes: modifierIndexes,
    } satisfies ClauseGroup;
  });
}

function findClauseStart(input: LlmInterpretationInput, availabilityStart: number) {
  let clauseStart = 0;

  for (let index = availabilityStart - 1; index >= 0; index -= 1) {
    const label = input.tokens[index]!.label;

    if (label === "punctuation_boundary" || label === "sentence_boundary" || label === "conjunction_contrast") {
      clauseStart = index + 1;
      break;
    }
  }

  return clauseStart;
}

function toAutoInterpretationRule(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  link: AppliesToTokenLink,
): AutoInterpretationRule {
  const targetTokens = link.targetTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!);
  const availabilityTokens = link.availabilityTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!);
  const modifierTokens = (link.modifierTokenIndexes ?? []).map((tokenIndex) => executionInput.tokens[tokenIndex]!);
  const notes: string[] = [];
  let residualOfTokenIndexes: number[] = [];
  let exceptionTargetTokenIndexes: number[] = [];
  let contrastClauseTokenIndexes: number[] = [];

  if (targetTokens.some((token) => token.label === "scope_residual")) {
    const residualLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "residual_of" && areSameIndexes(graphLink.sourceTokenIndexes, link.targetTokenIndexes),
    );

    if (residualLink) {
      residualOfTokenIndexes = residualLink.targetTokenIndexes;
      notes.push(`残り範囲: ${formatTokenText(executionInput, residualLink.targetTokenIndexes)} の残り`);
    } else {
      notes.push("残り範囲の参照先は確定できませんでした");
    }
  }

  if (targetTokens.some((token) => token.label === "scope_exception")) {
    const exceptionLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "exception_to" && areSameIndexes(graphLink.sourceTokenIndexes, link.targetTokenIndexes),
    );

    if (exceptionLink) {
      exceptionTargetTokenIndexes = exceptionLink.targetTokenIndexes;
      notes.push(`除外対象: ${formatTokenText(executionInput, exceptionLink.targetTokenIndexes)}`);
    } else {
      notes.push("除外対象は確定できませんでした");
    }
  }

  const clauseGroup = executionInput.grouping.clauseGroups.find((group) =>
    areSameIndexes(group.tokenIndexes, [
      ...link.targetTokenIndexes,
      ...(link.modifierTokenIndexes ?? []),
      ...link.availabilityTokenIndexes,
    ]),
  );

  if (clauseGroup) {
    const contrastLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "contrast_with" &&
        (areSameIndexes(graphLink.sourceTokenIndexes, clauseGroup.tokenIndexes) ||
          areSameIndexes(graphLink.targetTokenIndexes, clauseGroup.tokenIndexes)),
    );

    if (contrastLink) {
      contrastClauseTokenIndexes = areSameIndexes(contrastLink.sourceTokenIndexes, clauseGroup.tokenIndexes)
        ? contrastLink.targetTokenIndexes
        : contrastLink.sourceTokenIndexes;
      notes.push(`対比: ${formatTokenText(executionInput, contrastClauseTokenIndexes)}`);
    }
  }

  return {
    targetTokens: targetTokens.map((token) => ({
      text: token.text,
      label: token.label,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    targetTokenIndexes: link.targetTokenIndexes,
    targetText: formatTokenText(executionInput, link.targetTokenIndexes),
    targetLabels: targetTokens.map((token) => token.label),
    targetNormalizedTexts: targetTokens.map((token) => token.normalizedText).filter((value): value is string => Boolean(value)),
    residualOfTokens: residualOfTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!).map((token) => ({
      text: token.text,
      label: token.label,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    availabilityTokenIndexes: link.availabilityTokenIndexes,
    availabilityText: formatTokenText(executionInput, link.availabilityTokenIndexes),
    availabilityLabel: availabilityTokens[0]?.label as AutoInterpretationRule["availabilityLabel"],
    modifierTokenIndexes: link.modifierTokenIndexes ?? [],
    modifierTexts: modifierTokens.map((token) => token.text),
    modifierLabels: modifierTokens.map((token) => token.label),
    residualOfTokenIndexes,
    exceptionTargetTokens: exceptionTargetTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!).map((token) => ({
      text: token.text,
      label: token.label,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    exceptionTargetTokenIndexes,
    contrastClauseTokenIndexes,
    notes,
    sourceComment: executionInput.originalText,
  };
}

function formatTokenText(executionInput: AvailabilityInterpretationExecutionInput, tokenIndexes: number[]) {
  return [...new Set(tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.text.trim()).filter(Boolean))].join(" / ");
}

function buildPreferenceInterpretations(
  executionInput: AvailabilityInterpretationExecutionInput,
): AutoInterpretationPreference[] {
  const clauses = buildPreferenceClauses(executionInput);
  const preferences: AutoInterpretationPreference[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    const coreDesireTokenIndexes = clause.tokenIndexes.filter((tokenIndex) =>
      isExplicitPreferenceCoreToken(executionInput.tokens[tokenIndex]!),
    );

    if (coreDesireTokenIndexes.length === 0 || clause.targetGroups.length === 0) {
      continue;
    }

    const markerTokenIndexes = sortIndexes(
      clause.tokenIndexes.filter((tokenIndex) =>
        isPreferenceMarkerLabel(executionInput.tokens[tokenIndex]!.label),
      ),
    );
    const anchorTargetGroup = choosePreferenceTargetGroup(clause.targetGroups, coreDesireTokenIndexes);

    if (!anchorTargetGroup) {
      continue;
    }

    const markerTokens = markerTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!);
    const preference: AutoInterpretationPreference = {
      targetTokenIndexes: anchorTargetGroup.tokenIndexes,
      targetText: formatTokenText(executionInput, anchorTargetGroup.tokenIndexes),
      targetLabels: anchorTargetGroup.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.label),
      targetNormalizedTexts: anchorTargetGroup.tokenIndexes
        .map((tokenIndex) => executionInput.tokens[tokenIndex]!.normalizedText)
        .filter((value): value is string => Boolean(value)),
      markerTokenIndexes,
      markerTexts: markerTokens.map((token) => token.text),
      markerLabels: markerTokens.map((token) => token.label),
      strength: inferPreferenceStrength(markerTokens),
      notes: [],
      sourceComment: executionInput.originalText,
    };
    const key = JSON.stringify(preference);

    if (!seen.has(key)) {
      seen.add(key);
      preferences.push(preference);
    }
  }

  return preferences;
}

function buildPreferenceClauses(executionInput: AvailabilityInterpretationExecutionInput) {
  const clauses: Array<{
    start: number;
    end: number;
    tokenIndexes: number[];
    targetGroups: TokenIndexGroup[];
  }> = [];
  let clauseStart = 0;

  for (let index = 0; index <= executionInput.tokens.length; index += 1) {
    const token = executionInput.tokens[index];
    const isBoundary =
      index === executionInput.tokens.length ||
      token?.label === "punctuation_boundary" ||
      token?.label === "sentence_boundary" ||
      token?.label === "conjunction_contrast";

    if (!isBoundary) {
      continue;
    }

    const clauseTokenIndexes = executionInput.tokens
      .slice(clauseStart, index)
      .map((entry) => entry.index);

    if (clauseTokenIndexes.length > 0) {
      clauses.push({
        start: clauseStart,
        end: index - 1,
        tokenIndexes: clauseTokenIndexes,
        targetGroups: executionInput.grouping.targetGroups.filter((group) =>
          group.tokenIndexes.every((tokenIndex) => clauseTokenIndexes.includes(tokenIndex)),
        ),
      });
    }

    clauseStart = index + 1;
  }

  return clauses;
}

function choosePreferenceTargetGroup(targetGroups: TokenIndexGroup[], coreDesireTokenIndexes: number[]) {
  const lastCoreDesireIndex = Math.max(...coreDesireTokenIndexes);
  const candidate = [...targetGroups]
    .filter((group) => Math.max(...group.tokenIndexes) < lastCoreDesireIndex)
    .sort((left, right) => Math.max(...right.tokenIndexes) - Math.max(...left.tokenIndexes))
    .at(0);

  return candidate ?? targetGroups[targetGroups.length - 1] ?? null;
}

function inferPreferenceStrength(
  markerTokens: Array<AvailabilityInterpretationExecutionInput["tokens"][number]>,
): AutoInterpretationPreference["strength"] {
  return markerTokens.some(
    (token) =>
      token.label === "hypothetical_marker" ||
      /できれば|なるべく|可能なら|できたら/u.test(token.text),
  )
    ? "preferred_if_possible"
    : "preferred";
}

function isExplicitPreferenceCoreToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
) {
  return (
    ((token.label === "desire_marker" &&
      /の方がいい|方がいい|がいい|希望|いいな|いいね|理想|ベスト|一番いい|嬉しい|うれしい|助かる|ありがたい|都合いい|第一希望|優先|行きたい|いきたい|参加したい/u.test(
        token.text,
      )) ||
      ((token.label === "desire_marker" || token.label === "hypothetical_marker") &&
        /できれば|なるべく|可能なら|できたら/u.test(token.text)))
  );
}

function buildParsedConstraintsFromAvailabilityInterpretation(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  candidates: EventCandidateRecord[],
) {
  const constraints: ParsedCommentConstraint[] = [];
  const seen = new Set<string>();

  for (const link of graph.links) {
    if (link.relation !== "applies_to") {
      continue;
    }

    const level = inferConstraintLevelFromAppliesToLink(executionInput, link);

    if (!level) {
      continue;
    }

    const matchedCandidates = resolveMatchedCandidatesForAppliesToLink(executionInput, graph, link, candidates);

    for (const candidate of matchedCandidates) {
      const matchedDateValues = resolveMatchedDateValuesForTargetTokenIndexes(link.targetTokenIndexes, executionInput, candidate, candidates);
      const timeSlotKey = resolveTimeSlotKeyForTargetTokenIndexes(link.targetTokenIndexes, executionInput);

      for (const dateValue of matchedDateValues) {
        const constraint = buildCandidateConstraintFromAutoRule(candidate, level, executionInput.originalText, "availability", {
          dateValue,
          timeSlotKey,
        });
        const key = JSON.stringify(constraint);

        if (!seen.has(key)) {
          seen.add(key);
          constraints.push(constraint);
        }
      }
    }
  }

  const preferences = buildPreferenceInterpretations(executionInput);

  for (const preference of preferences) {
    const level = inferConstraintLevelFromPreference(preference);
    const matchedCandidates = candidates.filter((candidate) =>
      matchesTargetTokenIndexes(preference.targetTokenIndexes, executionInput, candidate, candidates),
    );

    for (const candidate of matchedCandidates) {
      const matchedDateValues = resolveMatchedDateValuesForTargetTokenIndexes(preference.targetTokenIndexes, executionInput, candidate, candidates);
      const timeSlotKey = resolveTimeSlotKeyForTargetTokenIndexes(preference.targetTokenIndexes, executionInput);

      for (const dateValue of matchedDateValues) {
        const constraint = buildCandidateConstraintFromAutoRule(candidate, level, executionInput.originalText, "preference", {
          dateValue,
          timeSlotKey,
        });
        const key = JSON.stringify(constraint);

        if (!seen.has(key)) {
          seen.add(key);
          constraints.push(constraint);
        }
      }
    }
  }

  return constraints;
}

function buildResolvedCandidateStatusesFromAvailabilityInterpretation(
  rules: AutoInterpretationRule[],
  candidates: EventCandidateRecord[],
): AutoInterpretationResolvedCandidateStatus[] {
  if (candidates.length === 0 || rules.length === 0) {
    return [];
  }

  const statuses: AutoInterpretationResolvedCandidateStatus[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const level = inferConstraintLevelFromAutoInterpretationRule(rule);
    const timeSlotKey = resolveTimeSlotKeyForRuleTargetTokens(rule.targetTokens);
    const matchedCandidates =
      timeSlotKey === null
        ? resolveMatchedCandidatesForAutoInterpretationRule(rule, candidates)
        : resolveDateMatchedCandidatesForAutoInterpretationRule(rule, candidates);
    const detailLabel = `${rule.targetText} → ${formatConstraintLevelLabelForAutoInterpretationLevel(level)}`;

    for (const candidate of matchedCandidates) {
      const matchedDateValues = resolveMatchedDateValuesForRuleTargetTokens(rule.targetTokens, candidate, candidates);

      for (const dateValue of matchedDateValues) {
        const status: AutoInterpretationResolvedCandidateStatus = {
          candidateId: candidate.id,
          dateValue,
          timeSlotKey,
          level,
          detailLabel,
        };
        const key = JSON.stringify(status);

        if (!seen.has(key)) {
          seen.add(key);
          statuses.push(status);
        }
      }
    }
  }

  return statuses;
}

function resolveDateMatchedCandidatesForAutoInterpretationRule(
  rule: AutoInterpretationRule,
  candidates: EventCandidateRecord[],
) {
  if (rule.targetLabels.includes("scope_exception") || rule.targetLabels.includes("scope_residual")) {
    return resolveMatchedCandidatesForAutoInterpretationRule(rule, candidates);
  }

  return candidates.filter((candidate) => matchesRuleTargetTokensIgnoringTime(rule.targetTokens, candidate, candidates));
}

function formatConstraintLevelLabelForAutoInterpretationLevel(level: ParsedConstraintLevel) {
  switch (level) {
    case "hard_no":
      return "参加不可";
    case "soft_no":
      return "できれば避けたい";
    case "unknown":
      return "未定";
    case "conditional":
      return "条件付きで参加可能";
    case "soft_yes":
      return "たぶん参加可能";
    case "strong_yes":
      return "参加可能";
    default:
      return level;
  }
}

function resolveMatchedCandidatesForAutoInterpretationRule(
  rule: AutoInterpretationRule,
  candidates: EventCandidateRecord[],
) {
  if (rule.targetLabels.includes("scope_exception")) {
    if (rule.exceptionTargetTokens.length === 0) {
      return [];
    }

    return candidates.filter((candidate) => !matchesRuleTargetTokens(rule.exceptionTargetTokens, candidate, candidates));
  }

  if (rule.targetLabels.includes("scope_residual")) {
    if (rule.residualOfTokens.length === 0) {
      return [];
    }

    return candidates.filter((candidate) => !matchesRuleTargetTokens(rule.residualOfTokens, candidate, candidates));
  }

  return candidates.filter((candidate) => doesAutoInterpretationRuleMatchCandidate(rule, candidate, candidates));
}

function inferConstraintLevelFromAppliesToLink(
  executionInput: AvailabilityInterpretationExecutionInput,
  link: AppliesToTokenLink,
): ParsedConstraintLevel | null {
  const availabilityText = formatTokenText(executionInput, link.availabilityTokenIndexes);
  const modifierLabels = (link.modifierTokenIndexes ?? []).map((tokenIndex) => executionInput.tokens[tokenIndex]!.label);

  if (modifierLabels.includes("hypothetical_marker") || modifierLabels.includes("desire_marker")) {
    return "conditional";
  }

  if (executionInput.tokens[link.availabilityTokenIndexes[0]]?.label === "availability_unknown") {
    return "unknown";
  }

  if (executionInput.tokens[link.availabilityTokenIndexes[0]]?.label === "availability_negative") {
    return /厳しい|厳しそう|微妙|難しい|避けたい/u.test(availabilityText) ? "soft_no" : "hard_no";
  }

  if (modifierLabels.includes("uncertainty_marker")) {
    return "soft_yes";
  }

  if (/無理ではない|行けなくはない|いけなくはない|行けなくもない|いけなくもない/u.test(availabilityText)) {
    return "soft_yes";
  }

  return "strong_yes";
}

export function inferConstraintLevelFromAutoInterpretationRule(
  rule: AutoInterpretationRule,
): ParsedConstraintLevel {
  if (rule.modifierLabels.includes("hypothetical_marker") || rule.modifierLabels.includes("desire_marker")) {
    return "conditional";
  }

  if (rule.availabilityLabel === "availability_unknown") {
    return "unknown";
  }

  if (rule.availabilityLabel === "availability_negative") {
    return /厳しい|厳しそう|微妙|難しい|避けたい/u.test(rule.availabilityText) ? "soft_no" : "hard_no";
  }

  if (rule.modifierLabels.includes("uncertainty_marker")) {
    return "soft_yes";
  }

  if (/無理ではない|行けなくはない|いけなくはない|行けなくもない|いけなくもない/u.test(rule.availabilityText)) {
    return "soft_yes";
  }

  return "strong_yes";
}

function inferConstraintLevelFromPreference(preference: AutoInterpretationPreference): ParsedConstraintLevel {
  return preference.strength === "preferred_if_possible" ? "conditional" : "soft_yes";
}

function resolveMatchedCandidatesForAppliesToLink(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  link: AppliesToTokenLink,
  candidates: EventCandidateRecord[],
) {
  const targetLabels = link.targetTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.label);

  if (targetLabels.includes("scope_exception")) {
    const exceptionLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "exception_to" && areSameIndexes(graphLink.sourceTokenIndexes, link.targetTokenIndexes),
    );

    if (!exceptionLink) {
      return [];
    }

    return candidates.filter(
      (candidate) =>
        !matchesTargetTokenIndexes(exceptionLink.targetTokenIndexes, executionInput, candidate, candidates),
    );
  }

  if (targetLabels.includes("scope_residual")) {
    const residualLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "residual_of" && areSameIndexes(graphLink.sourceTokenIndexes, link.targetTokenIndexes),
    );

    if (!residualLink) {
      return [];
    }

    const antecedentGroups = executionInput.grouping.targetGroups.filter((group) =>
      group.tokenIndexes.every((tokenIndex) => residualLink.targetTokenIndexes.includes(tokenIndex)),
    );

    if (antecedentGroups.length === 0) {
      return [];
    }

    return candidates.filter(
      (candidate) =>
        !antecedentGroups.some((group) =>
          matchesTargetTokenIndexes(group.tokenIndexes, executionInput, candidate, candidates),
        ),
    );
  }

  return candidates.filter((candidate) =>
    matchesTargetTokenIndexes(link.targetTokenIndexes, executionInput, candidate, candidates),
  );
}

function matchesTargetTokenIndexes(
  tokenIndexes: number[],
  executionInput: AvailabilityInterpretationExecutionInput,
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  return tokenIndexes.every((tokenIndex) =>
    doesTargetTokenMatchCandidate(executionInput.tokens[tokenIndex]!, candidate, allCandidates),
  );
}

function doesRuleTargetTokenMatchCandidate(
  token: AutoInterpretationRule["targetTokens"][number],
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  const candidateDates = getCandidateDateValues(candidate);

  switch (token.label) {
    case "target_date":
      return candidateDates.some((dateValue) => matchesDateTargetToken(token, dateValue));
    case "target_date_range":
      return candidateDates.some((dateValue) => matchesDateRangeTargetToken(token, dateValue));
    case "target_weekday":
      return candidateDates.some((dateValue) => getWeekdayValue(dateValue) === token.normalizedText);
    case "target_weekday_group":
      return candidateDates.some((dateValue) => matchesWeekdayGroupTargetToken(token, dateValue));
    case "target_time_of_day":
      return matchesTimeOfDayTargetToken(token, candidate);
    case "target_month_part":
      return candidateDates.some((dateValue) => matchesMonthPartTargetToken(token, dateValue));
    case "target_week_ordinal":
      return candidateDates.some((dateValue) => matchesWeekOrdinalTargetToken(token, dateValue));
    case "target_relative_period":
      return candidateDates.some((dateValue) => matchesRelativePeriodTargetToken(token, dateValue, allCandidates));
    case "target_holiday_related":
      return candidateDates.some((dateValue) => matchesHolidayRelatedTargetToken(token, dateValue));
    default:
      return false;
  }
}

function matchesDateTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  if (token.normalizedText && /^\d{4}-\d{2}-\d{2}$/u.test(token.normalizedText)) {
    return token.normalizedText === dateValue;
  }

  const slashMatch = token.text.match(/(\d{1,2})\/(\d{1,2})/u);

  if (slashMatch) {
    return `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}` === `${Number(slashMatch[1])}/${Number(slashMatch[2])}`;
  }

  const monthDayMatch = token.text.match(/(\d{1,2})月\s*(\d{1,2})日?/u);

  if (monthDayMatch) {
    return `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}` === `${Number(monthDayMatch[1])}/${Number(monthDayMatch[2])}`;
  }

  const dayOnlyMatch = token.text.match(/(\d{1,2})日?/u);

  return dayOnlyMatch ? Number(dateValue.slice(8, 10)) === Number(dayOnlyMatch[1]) : false;
}

function matchesDateRangeTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  const [start, end] = (token.normalizedText ?? "").split("..");

  if (!start || !end) {
    return false;
  }

  return dateValue >= start && dateValue <= end;
}

function matchesWeekdayGroupTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  const weekday = getWeekdayValue(dateValue);

  if (token.normalizedText === "weekday") {
    return ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(weekday);
  }

  if (token.normalizedText === "weekend" || token.normalizedText === "weekend_pair") {
    return weekday === "saturday" || weekday === "sunday";
  }

  return false;
}

function matchesTimeOfDayTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  candidate: EventCandidateRecord,
) {
  const normalized = normalizeCandidate(candidate);
  const timeValue = mapTimeOfDayValue(token.normalizedText ?? token.text);

  if (timeValue === "all_day") {
    return true;
  }

  if (normalized.timeSlotKey === "all_day" || normalized.timeType === "unspecified") {
    return true;
  }

  return normalized.timeSlotKey === timeValue;
}

function matchesMonthPartTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  const day = Number(dateValue.slice(8, 10));

  switch (token.normalizedText) {
    case "first_half":
      return day <= 15;
    case "second_half":
      return day >= 16;
    case "early_month":
      return day <= 10;
    case "mid_month":
      return day >= 11 && day <= 20;
    case "late_month":
      return day >= 21;
    case "month_start":
      return day <= 5;
    case "month_end":
      return day >= 26;
    default:
      return false;
  }
}

function matchesWeekOrdinalTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  const match = (token.normalizedText ?? "").match(/^week_(\d)$/u);

  if (!match) {
    return false;
  }

  return Math.floor((Number(dateValue.slice(8, 10)) - 1) / 7) + 1 === Number(match[1]);
}

function matchesRelativePeriodTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
  allCandidates: EventCandidateRecord[],
) {
  const allDates = [...new Set(allCandidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const anchor = allDates[0];

  if (!anchor) {
    return false;
  }

  const anchorDate = new Date(`${anchor}T00:00:00+09:00`);
  const currentDate = new Date(`${dateValue}T00:00:00+09:00`);
  const anchorWeekStart = getWeekStart(anchorDate);
  const currentWeekStart = getWeekStart(currentDate);

  switch (token.normalizedText) {
    case "this_week":
      return currentWeekStart.getTime() === anchorWeekStart.getTime();
    case "next_week":
      return currentWeekStart.getTime() === addDays(anchorWeekStart, 7).getTime();
    case "week_after_next":
      return currentWeekStart.getTime() === addDays(anchorWeekStart, 14).getTime();
    case "this_month":
      return currentDate.getFullYear() === anchorDate.getFullYear() && currentDate.getMonth() === anchorDate.getMonth();
    case "next_month":
      return currentDate.getFullYear() === addMonths(anchorDate, 1).getFullYear() && currentDate.getMonth() === addMonths(anchorDate, 1).getMonth();
    default:
      return false;
  }
}

function matchesHolidayRelatedTargetToken(
  token: AutoInterpretationRule["targetTokens"][number],
  dateValue: string,
) {
  if (token.normalizedText === "holiday") {
    const weekday = getWeekdayValue(dateValue);

    return weekday === "saturday" || weekday === "sunday";
  }

  return false;
}

function matchesRuleTargetTokens(
  tokens: AutoInterpretationRule["targetTokens"],
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  if (tokens.length === 0) {
    return false;
  }

  const dateFilteringTokens = tokens.filter((token) => isDateFilteringTargetLabel(token.label as Label));
  const timeTokens = tokens.filter((token) => token.label === "target_time_of_day");

  const candidateDates = getCandidateDateValues(candidate);
  const dateMatch =
    dateFilteringTokens.length === 0 ||
    candidateDates.some((dateValue) => {
      const explicitDateTokens = dateFilteringTokens.filter(
        (token) => token.label === "target_date" || token.label === "target_date_range",
      );
      const contextualDateTokens = dateFilteringTokens.filter(
        (token) => token.label !== "target_date" && token.label !== "target_date_range",
      );

      const dateCandidate: EventCandidateRecord = {
        ...candidate,
        date: dateValue,
        startDate: dateValue,
        endDate: dateValue,
        selectedDates: [],
        dateType: "single",
        selectionMode: "range",
      };

      const explicitMatch =
        explicitDateTokens.length === 0 ||
        explicitDateTokens.some((token) => doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates));
      const contextualMatch = contextualDateTokens.every((token) =>
        doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates),
      );

      return explicitMatch && contextualMatch;
    });

  const timeMatch = timeTokens.length === 0 || timeTokens.every((token) => matchesTimeOfDayTargetToken(token, candidate));

  return dateMatch && timeMatch;
}

function matchesRuleTargetTokensIgnoringTime(
  tokens: AutoInterpretationRule["targetTokens"],
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  if (tokens.length === 0) {
    return false;
  }

  const dateFilteringTokens = tokens.filter(
    (token) => isDateFilteringTargetLabel(token.label as Label) && token.label !== "target_time_of_day",
  );

  if (dateFilteringTokens.length === 0) {
    return true;
  }

  const candidateDates = getCandidateDateValues(candidate);

  return candidateDates.some((dateValue) => {
    const explicitDateTokens = dateFilteringTokens.filter(
      (token) => token.label === "target_date" || token.label === "target_date_range",
    );
    const contextualDateTokens = dateFilteringTokens.filter(
      (token) => token.label !== "target_date" && token.label !== "target_date_range",
    );

    const dateCandidate: EventCandidateRecord = {
      ...candidate,
      date: dateValue,
      startDate: dateValue,
      endDate: dateValue,
      selectedDates: [],
      dateType: "single",
      selectionMode: "range",
    };

    const explicitMatch =
      explicitDateTokens.length === 0 ||
      explicitDateTokens.some((token) => doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates));
    const contextualMatch = contextualDateTokens.every((token) =>
      doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates),
    );

    return explicitMatch && contextualMatch;
  });
}

export function doesAutoInterpretationRuleMatchCandidate(
  rule: AutoInterpretationRule,
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  if (rule.targetLabels.includes("scope_exception")) {
    return rule.exceptionTargetTokens.length > 0 && !matchesRuleTargetTokens(rule.exceptionTargetTokens, candidate, allCandidates);
  }

  if (rule.targetLabels.includes("scope_residual")) {
    return rule.residualOfTokens.length > 0 && !matchesRuleTargetTokens(rule.residualOfTokens, candidate, allCandidates);
  }

  return matchesRuleTargetTokens(rule.targetTokens, candidate, allCandidates);
}

function doesTargetTokenMatchCandidate(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  const candidateDates = getCandidateDateValues(candidate);

  switch (token.label) {
    case "target_date":
      return candidateDates.some((dateValue) => matchesDateToken(token, dateValue));
    case "target_date_range":
      return candidateDates.some((dateValue) => matchesDateRangeToken(token, dateValue));
    case "target_weekday":
      return candidateDates.some((dateValue) => getWeekdayValue(dateValue) === token.normalizedText);
    case "target_weekday_group":
      return candidateDates.some((dateValue) => matchesWeekdayGroupToken(token, dateValue));
    case "target_time_of_day":
      return matchesTimeOfDayToken(token, candidate);
    case "target_month_part":
      return candidateDates.some((dateValue) => matchesMonthPartToken(token, dateValue));
    case "target_week_ordinal":
      return candidateDates.some((dateValue) => matchesWeekOrdinalToken(token, dateValue));
    case "target_relative_period":
      return candidateDates.some((dateValue) => matchesRelativePeriodToken(token, dateValue, allCandidates));
    case "target_holiday_related":
      return false;
    default:
      return false;
  }
}

function matchesDateToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
) {
  if (token.normalizedText && /^\d{4}-\d{2}-\d{2}$/u.test(token.normalizedText)) {
    return token.normalizedText === dateValue;
  }

  const slashMatch = token.text.match(/(\d{1,2})\/(\d{1,2})/u);

  if (slashMatch) {
    return `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}` === `${Number(slashMatch[1])}/${Number(slashMatch[2])}`;
  }

  const monthDayMatch = token.text.match(/(\d{1,2})月\s*(\d{1,2})日?/u);

  if (monthDayMatch) {
    return `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}` === `${Number(monthDayMatch[1])}/${Number(monthDayMatch[2])}`;
  }

  const dayOnlyMatch = token.text.match(/(\d{1,2})日?/u);

  return dayOnlyMatch ? Number(dateValue.slice(8, 10)) === Number(dayOnlyMatch[1]) : false;
}

function matchesDateRangeToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
) {
  const [start, end] = (token.normalizedText ?? "").split("..");

  if (!start || !end) {
    return false;
  }

  return dateValue >= start && dateValue <= end;
}

function matchesWeekdayGroupToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
) {
  const weekday = getWeekdayValue(dateValue);

  if (token.normalizedText === "weekday") {
    return ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(weekday);
  }

  if (token.normalizedText === "weekend" || token.normalizedText === "weekend_pair") {
    return weekday === "saturday" || weekday === "sunday";
  }

  return false;
}

function matchesTimeOfDayToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  candidate: EventCandidateRecord,
) {
  const normalized = normalizeCandidate(candidate);
  const timeValue = mapTimeOfDayValue(token.normalizedText ?? token.text);

  if (timeValue === "all_day") {
    return true;
  }

  if (normalized.timeSlotKey === "all_day" || normalized.timeType === "unspecified") {
    return true;
  }

  return normalized.timeSlotKey === timeValue;
}

function matchesMonthPartToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
) {
  const day = Number(dateValue.slice(8, 10));

  switch (token.normalizedText) {
    case "first_half":
      return day <= 15;
    case "second_half":
      return day >= 16;
    case "early_month":
      return day <= 10;
    case "mid_month":
      return day >= 11 && day <= 20;
    case "late_month":
      return day >= 21;
    case "month_start":
      return day <= 5;
    case "month_end":
      return day >= 26;
    default:
      return false;
  }
}

function matchesWeekOrdinalToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
) {
  const match = (token.normalizedText ?? "").match(/^week_(\d)$/u);

  if (!match) {
    return false;
  }

  return Math.floor((Number(dateValue.slice(8, 10)) - 1) / 7) + 1 === Number(match[1]);
}

function matchesRelativePeriodToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
  dateValue: string,
  allCandidates: EventCandidateRecord[],
) {
  const allDates = [...new Set(allCandidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const anchor = allDates[0];

  if (!anchor) {
    return false;
  }

  const anchorDate = new Date(`${anchor}T00:00:00+09:00`);
  const currentDate = new Date(`${dateValue}T00:00:00+09:00`);
  const anchorWeekStart = getWeekStart(anchorDate);
  const currentWeekStart = getWeekStart(currentDate);

  switch (token.normalizedText) {
    case "this_week":
      return currentWeekStart.getTime() === anchorWeekStart.getTime();
    case "next_week":
      return currentWeekStart.getTime() === addDays(anchorWeekStart, 7).getTime();
    case "week_after_next":
      return currentWeekStart.getTime() === addDays(anchorWeekStart, 14).getTime();
    case "this_month":
      return currentDate.getFullYear() === anchorDate.getFullYear() && currentDate.getMonth() === anchorDate.getMonth();
    case "next_month":
      return currentDate.getFullYear() === addMonths(anchorDate, 1).getFullYear() && currentDate.getMonth() === addMonths(anchorDate, 1).getMonth();
    default:
      return false;
  }
}

function buildCandidateConstraintFromAutoRule(
  candidate: EventCandidateRecord,
  level: ParsedConstraintLevel,
  reasonText: string,
  intent: ParsedCommentConstraint["intent"] = "availability",
  options: {
    dateValue?: string;
    timeSlotKey?: string | null;
  } = {},
): ParsedCommentConstraint {
  const normalized = normalizeCandidate(candidate);
  const dateValue = options.dateValue ?? getCandidateDateValues(normalized)[0] ?? normalized.startDate;
  const polarity = level === "hard_no" || level === "soft_no" ? "negative" : level === "unknown" ? "neutral" : "positive";
  const effectiveTimeSlotKey =
    options.timeSlotKey && options.timeSlotKey !== "all_day"
      ? options.timeSlotKey
      : normalized.timeSlotKey !== "all_day" && normalized.timeType !== "unspecified"
        ? normalized.timeSlotKey
        : null;

  if (!effectiveTimeSlotKey) {
    return {
      targetType: "date",
      targetValue: dateValue,
      polarity,
      level,
      reasonText,
      intent,
      source: "auto_llm",
    };
  }

  return {
    targetType: "date_time",
    targetValue: `${dateValue}_${effectiveTimeSlotKey}`,
    polarity,
    level,
    reasonText,
    intent,
    source: "auto_llm",
  };
}

function resolveMatchedDateValuesForTargetTokenIndexes(
  tokenIndexes: number[],
  executionInput: AvailabilityInterpretationExecutionInput,
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  const candidateDates = getCandidateDateValues(candidate);
  const dateFilteringTokens = tokenIndexes
    .map((tokenIndex) => executionInput.tokens[tokenIndex]!)
    .filter((token) => isDateFilteringTargetLabel(token.label));

  if (dateFilteringTokens.length === 0) {
    return candidateDates;
  }

  const explicitDateTokens = dateFilteringTokens.filter(
    (token) => token.label === "target_date" || token.label === "target_date_range",
  );
  const contextualDateTokens = dateFilteringTokens.filter(
    (token) => token.label !== "target_date" && token.label !== "target_date_range",
  );

  return candidateDates.filter((dateValue) => {
    const dateCandidate: EventCandidateRecord = {
      ...candidate,
      date: dateValue,
      startDate: dateValue,
      endDate: dateValue,
      selectedDates: [],
      dateType: "single",
      selectionMode: "range",
    };

    const explicitMatch =
      explicitDateTokens.length === 0 ||
      explicitDateTokens.some((token) => doesTargetTokenMatchCandidate(token, dateCandidate, allCandidates));
    const contextualMatch = contextualDateTokens.every((token) =>
      doesTargetTokenMatchCandidate(token, dateCandidate, allCandidates),
    );

    return explicitMatch && contextualMatch;
  });
}

function resolveMatchedDateValuesForRuleTargetTokens(
  targetTokens: AutoInterpretationRule["targetTokens"],
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  const candidateDates = getCandidateDateValues(candidate);
  const dateFilteringTokens = targetTokens.filter((token) => isDateFilteringTargetLabel(token.label as Label));

  if (dateFilteringTokens.length === 0) {
    return candidateDates;
  }

  const explicitDateTokens = dateFilteringTokens.filter(
    (token) => token.label === "target_date" || token.label === "target_date_range",
  );
  const contextualDateTokens = dateFilteringTokens.filter(
    (token) => token.label !== "target_date" && token.label !== "target_date_range",
  );

  return candidateDates.filter((dateValue) => {
    const dateCandidate: EventCandidateRecord = {
      ...candidate,
      date: dateValue,
      startDate: dateValue,
      endDate: dateValue,
      selectedDates: [],
      dateType: "single",
      selectionMode: "range",
    };

    const explicitMatch =
      explicitDateTokens.length === 0 ||
      explicitDateTokens.some((token) => doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates));
    const contextualMatch = contextualDateTokens.every((token) =>
      doesRuleTargetTokenMatchCandidate(token, dateCandidate, allCandidates),
    );

    return explicitMatch && contextualMatch;
  });
}

function resolveTimeSlotKeyForTargetTokenIndexes(
  tokenIndexes: number[],
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  const timeToken = tokenIndexes
    .map((tokenIndex) => executionInput.tokens[tokenIndex]!)
    .find((token) => token.label === "target_time_of_day");

  if (!timeToken) {
    return null;
  }

  const mapped = mapTimeOfDayValue(timeToken.normalizedText ?? timeToken.text);

  return mapped === "all_day" ? null : mapped;
}

function resolveTimeSlotKeyForRuleTargetTokens(
  targetTokens: AutoInterpretationRule["targetTokens"],
) {
  const timeToken = targetTokens.find((token) => token.label === "target_time_of_day");

  if (!timeToken) {
    return null;
  }

  const mapped = mapTimeOfDayValue(timeToken.normalizedText ?? timeToken.text);

  return mapped === "all_day" ? null : mapped;
}

function getWeekdayValue(dateValue: string) {
  const weekday = new Date(`${dateValue}T00:00:00`).getDay();

  return weekday === 0
    ? "sunday"
    : weekday === 1
      ? "monday"
      : weekday === 2
        ? "tuesday"
        : weekday === 3
          ? "wednesday"
          : weekday === 4
            ? "thursday"
            : weekday === 5
              ? "friday"
              : "saturday";
}

function mapTimeOfDayValue(value: string) {
  switch (value) {
    case "morning":
      return "morning";
    case "noon":
    case "afternoon":
      return "day";
    case "evening":
    case "night":
    case "late_night":
    case "until_last_train":
      return "night";
    case "all_day":
    case "overnight":
      return "all_day";
    default:
      return "all_day";
  }
}

function getWeekStart(date: Date) {
  const value = new Date(date);
  const diff = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - diff);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, count: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + count);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addMonths(date: Date, count: number) {
  const value = new Date(date);
  value.setMonth(value.getMonth() + count);
  value.setHours(0, 0, 0, 0);
  return value;
}

function sortIndexes(indexes: number[]) {
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function areSameIndexes(left: number[], right: number[]) {
  const normalizedLeft = sortIndexes(left);
  const normalizedRight = sortIndexes(right);

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((tokenIndex, index) => tokenIndex === normalizedRight[index])
  );
}

function isAvailabilityLabel(label: Label) {
  return label.startsWith("availability_");
}

function isTargetLabel(label: Label) {
  return label.startsWith("target_");
}

function isScopeLabel(label: Label) {
  return label.startsWith("scope_");
}

function isDateFilteringTargetLabel(label: Label) {
  return (
    label === "target_date" ||
    label === "target_date_range" ||
    label === "target_weekday" ||
    label === "target_weekday_group" ||
    label === "target_relative_period" ||
    label === "target_month_part" ||
    label === "target_week_ordinal" ||
    label === "target_holiday_related"
  );
}

function isTargetGroupJoinerLabel(label: Label) {
  return label === "particle_topic" || label === "particle_link" || label === "particle_limit";
}

function isSemanticModifierLabel(label: Label) {
  return label === "uncertainty_marker" || label === "desire_marker" || label === "hypothetical_marker" || label === "emphasis_marker";
}

function isPreferenceMarkerLabel(label: Label) {
  return label === "desire_marker" || label === "hypothetical_marker";
}
