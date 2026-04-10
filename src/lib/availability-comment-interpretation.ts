import { labelCommentText } from "@/lib/comment-labeler";
import type { Label } from "@/lib/comment-labeler";
import {
  toLlmInterpretationInput,
  type AppliesToTokenLink,
  type LlmInterpretationInput,
  type LlmInterpretationOutput,
  type StructuralTokenLink,
} from "@/lib/availability-interpretation";
import type { AutoInterpretationResult, AutoInterpretationRule, EventCandidateRecord } from "@/lib/domain";
import { getCandidateDateValues } from "@/lib/utils";

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
): AutoInterpretationResult {
  const rules = graph.links
    .filter((link): link is AppliesToTokenLink => link.relation === "applies_to")
    .map((link) => toAutoInterpretationRule(executionInput, graph, link));

  if (rules.length === 0) {
    return {
      status: "failed",
      sourceComment: executionInput.originalText,
      rules: [],
      ambiguities: graph.ambiguities ?? [],
      failureReason: "安全に表示できる自動解釈ルールを作れませんでした。",
      debugGraphJson: JSON.stringify(graph, null, 2),
    };
  }

  return {
    status: "success",
    sourceComment: executionInput.originalText,
    rules,
    ambiguities: graph.ambiguities ?? [],
    failureReason: null,
    debugGraphJson: JSON.stringify(graph, null, 2),
  };
}

export function formatAutoInterpretationTarget(rule: AutoInterpretationRule) {
  return rule.targetText;
}

export function formatAutoInterpretationAvailability(rule: AutoInterpretationRule) {
  const modifierTexts = [...new Set(rule.modifierTexts.map((text) => text.trim()).filter(Boolean))];

  return modifierTexts.length > 0 ? `${modifierTexts.join(" ")} ${rule.availabilityText}` : rule.availabilityText;
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
    const contextTargetGroups = anchorGroups.filter(
      (group) => Math.max(...group.tokenIndexes) < availabilityStart && Math.min(...group.tokenIndexes) >= clauseStart,
    );
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
    targetTokenIndexes: link.targetTokenIndexes,
    targetText: formatTokenText(executionInput, link.targetTokenIndexes),
    targetLabels: targetTokens.map((token) => token.label),
    targetNormalizedTexts: targetTokens.map((token) => token.normalizedText).filter((value): value is string => Boolean(value)),
    availabilityTokenIndexes: link.availabilityTokenIndexes,
    availabilityText: formatTokenText(executionInput, link.availabilityTokenIndexes),
    availabilityLabel: availabilityTokens[0]?.label as AutoInterpretationRule["availabilityLabel"],
    modifierTokenIndexes: link.modifierTokenIndexes ?? [],
    modifierTexts: modifierTokens.map((token) => token.text),
    modifierLabels: modifierTokens.map((token) => token.label),
    residualOfTokenIndexes,
    exceptionTargetTokenIndexes,
    contrastClauseTokenIndexes,
    notes,
    sourceComment: executionInput.originalText,
  };
}

function formatTokenText(executionInput: AvailabilityInterpretationExecutionInput, tokenIndexes: number[]) {
  return [...new Set(tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.text.trim()).filter(Boolean))].join(" / ");
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

function isTargetGroupJoinerLabel(label: Label) {
  return label === "particle_topic" || label === "particle_link" || label === "particle_limit";
}

function isSemanticModifierLabel(label: Label) {
  return label === "uncertainty_marker" || label === "desire_marker" || label === "hypothetical_marker" || label === "emphasis_marker";
}
