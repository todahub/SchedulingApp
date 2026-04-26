import { labelCommentText } from "@/lib/comment-labeler";
import type { Label, LabeledComment } from "@/lib/comment-labeler";
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

export type AvailabilityInterpretationGroupingHypothesis = {
  id: string;
  kind:
    | "default"
    | "merge_list_cluster"
    | "split_list_cluster";
  note: string;
  grouping: AvailabilityInterpretationGrouping;
};

export type AvailabilityInterpretationExecutionInput = {
  originalText: string;
  tokens: LlmInterpretationInput["tokens"];
  grouping: AvailabilityInterpretationGrouping;
  groupingHypotheses: AvailabilityInterpretationGroupingHypothesis[];
  selectedGroupingHypothesisId: string | null;
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
  return buildAvailabilityInterpretationExecutionInputFromLabeledComment(labeledComment);
}

export function buildAvailabilityInterpretationExecutionInputFromLabeledComment(
  labeledComment: LabeledComment,
): AvailabilityInterpretationExecutionInput {
  const llmInput = toLlmInterpretationInput(labeledComment);
  const grouping = buildAvailabilityInterpretationGrouping(llmInput);
  const groupingHypotheses = buildAvailabilityInterpretationGroupingHypotheses(llmInput, grouping);

  return {
    originalText: llmInput.originalText,
    tokens: llmInput.tokens,
    grouping,
    groupingHypotheses,
    selectedGroupingHypothesisId: groupingHypotheses[0]?.id ?? null,
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
  return buildAvailabilityInterpretationGroupingFromTargetGroups(input, targetGroups);
}

export function buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
  executionInput: AvailabilityInterpretationExecutionInput,
  hypothesisId: string | null,
): AvailabilityInterpretationExecutionInput {
  if (!hypothesisId) {
    return executionInput;
  }

  const hypothesis = executionInput.groupingHypotheses.find((candidate) => candidate.id === hypothesisId);

  if (!hypothesis) {
    return executionInput;
  }

  return {
    ...executionInput,
    grouping: hypothesis.grouping,
    selectedGroupingHypothesisId: hypothesis.id,
  };
}

function buildAvailabilityInterpretationGroupingFromTargetGroups(
  input: LlmInterpretationInput,
  targetGroups: TokenIndexGroup[],
): AvailabilityInterpretationGrouping {
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

function buildAvailabilityInterpretationGroupingHypotheses(
  input: LlmInterpretationInput,
  defaultGrouping: AvailabilityInterpretationGrouping,
): AvailabilityInterpretationGroupingHypothesis[] {
  const hypotheses: AvailabilityInterpretationGroupingHypothesis[] = [
    {
      id: "gh-default",
      kind: "default",
      note: "現在の target group をそのまま使う",
      grouping: defaultGrouping,
    },
  ];
  const seen = new Set<string>([serializeTargetGroups(defaultGrouping.targetGroups)]);
  const clauseRanges = buildClauseRanges(input);

  for (const clauseRange of clauseRanges) {
    const clauseTargetGroups = defaultGrouping.targetGroups.filter(
      (group) => Math.min(...group.tokenIndexes) >= clauseRange.start && Math.max(...group.tokenIndexes) <= clauseRange.end,
    );

    const listClusters = buildListTargetGroupClusters(input, clauseTargetGroups);

    for (const cluster of listClusters) {
      if (cluster.length < 2) {
        continue;
      }

      const mergedTargetGroups = replaceTargetGroups(defaultGrouping.targetGroups, cluster, [
        {
          id: buildMergedTargetGroupId(cluster),
          tokenIndexes: sortIndexes(cluster.flatMap((group) => group.tokenIndexes)),
        },
      ]);
      const mergedKey = serializeTargetGroups(mergedTargetGroups);

      if (!seen.has(mergedKey)) {
        seen.add(mergedKey);
        hypotheses.push({
          id: `gh-merge-${hypotheses.length}`,
          kind: "merge_list_cluster",
          note: `${formatTokenGroupText(input, cluster.flatMap((group) => group.tokenIndexes))} を1つの date group として扱う`,
          grouping: buildAvailabilityInterpretationGroupingFromTargetGroups(input, mergedTargetGroups),
        });
      }

      if (cluster.length <= 3) {
        continue;
      }

      for (let splitIndex = 1; splitIndex < cluster.length; splitIndex += 1) {
        const splitTargetGroups = replaceTargetGroups(defaultGrouping.targetGroups, cluster, [
          {
            id: `${buildMergedTargetGroupId(cluster.slice(0, splitIndex))}-a`,
            tokenIndexes: sortIndexes(cluster.slice(0, splitIndex).flatMap((group) => group.tokenIndexes)),
          },
          {
            id: `${buildMergedTargetGroupId(cluster.slice(splitIndex))}-b`,
            tokenIndexes: sortIndexes(cluster.slice(splitIndex).flatMap((group) => group.tokenIndexes)),
          },
        ]);
        const splitKey = serializeTargetGroups(splitTargetGroups);

        if (seen.has(splitKey)) {
          continue;
        }

        seen.add(splitKey);
        hypotheses.push({
          id: `gh-split-${hypotheses.length}`,
          kind: "split_list_cluster",
          note: `${formatTokenGroupText(input, cluster.slice(0, splitIndex).flatMap((group) => group.tokenIndexes))} と ${formatTokenGroupText(input, cluster.slice(splitIndex).flatMap((group) => group.tokenIndexes))} を別 group として扱う`,
          grouping: buildAvailabilityInterpretationGroupingFromTargetGroups(input, splitTargetGroups),
        });
      }
    }
  }

  return hypotheses.slice(0, 5);
}

export function buildAutoInterpretationResult(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  candidates: EventCandidateRecord[] = [],
): AutoInterpretationResult {
  const rules = graph.links
    .filter((link): link is AppliesToTokenLink => link.relation === "applies_to")
    .map((link) => toAutoInterpretationRule(executionInput, graph, link));
  // comparison / preference の最終判断は後段 LLM に寄せる。
  // 前段 deterministic 処理では、availability 主導線に必要な rule/status のみ確定し、
  // 希望・比較は候補抽出材料として残す。
  const preferences: AutoInterpretationPreference[] = [];
  const resolvedCandidateStatuses = buildResolvedCandidateStatusesFromAvailabilityInterpretation(rules, candidates);

  if (rules.length === 0 && preferences.length === 0) {
    return {
      status: "failed",
      sourceComment: executionInput.originalText,
      rules: [],
      resolvedCandidateStatuses,
      preferences: [],
      ...(graph.targetContexts && graph.targetContexts.length > 0 ? { targetContexts: graph.targetContexts } : {}),
      ambiguities: graph.ambiguities ?? [],
      failureReason: "安全に表示できる自動解釈ルールを作れませんでした。",
      debugGraphJson: JSON.stringify(graph, null, 2),
    };
  }

  // Preference-only comments should not switch the ranking pipeline into
  // parsed-comment availability mode until ranking is ready to consume them.
  if (rules.length === 0) {
    return {
      status: "failed",
      sourceComment: executionInput.originalText,
      rules: [],
      resolvedCandidateStatuses,
      preferences,
      ...(graph.targetContexts && graph.targetContexts.length > 0 ? { targetContexts: graph.targetContexts } : {}),
      ambiguities: graph.ambiguities ?? [],
      failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
      debugGraphJson: JSON.stringify(graph, null, 2),
    };
  }

  return {
    status: "success",
    sourceComment: executionInput.originalText,
    rules,
    resolvedCandidateStatuses,
    preferences,
    ...(graph.targetContexts && graph.targetContexts.length > 0 ? { targetContexts: graph.targetContexts } : {}),
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
  if (preference.level === "strong_preferred") {
    return "強い希望";
  }

  if (preference.level === "avoid") {
    return "避けたい";
  }

  return "希望";
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
    const previousToken = input.tokens[previousIndex]!;
    const betweenTokens = input.tokens.slice(previousIndex + 1, token.index);

    if (betweenTokens.length === 0 && shouldMergeAdjacentTargetTokens(previousToken, token)) {
      current.push(token.index);
      continue;
    }

    if (betweenTokens.length > 0 && betweenTokens.every(isTargetGroupJoinerToken)) {
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
    const clauseEnd = findClauseEnd(input, availabilityStart);
    const clauseAnchorGroups = [...anchorGroups].filter(
      (group) =>
        Math.min(...group.tokenIndexes) >= clauseStart &&
        Math.max(...group.tokenIndexes) <= clauseEnd,
    );
    const priorAnchorGroup = clauseAnchorGroups
      .filter((group) => Math.max(...group.tokenIndexes) < availabilityStart)
      .sort((left, right) => Math.max(...left.tokenIndexes) - Math.max(...right.tokenIndexes))
      .at(-1);
    const nextAnchorGroup = clauseAnchorGroups
      .filter((group) => Math.min(...group.tokenIndexes) > availabilityStart)
      .sort((left, right) => Math.min(...left.tokenIndexes) - Math.min(...right.tokenIndexes))
      .at(0);
    const anchorGroup = priorAnchorGroup ?? nextAnchorGroup ?? null;
    const localContextTargetGroups = anchorGroups.filter(
      (group) =>
        Math.min(...group.tokenIndexes) >= clauseStart &&
        Math.max(...group.tokenIndexes) <= clauseEnd,
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

    if (label === "sentence_boundary" || label === "conjunction_contrast") {
      clauseStart = index + 1;
      break;
    }

    if (label === "punctuation_boundary" && isBackwardClauseBoundaryPunctuation(input, index)) {
      clauseStart = index + 1;
      break;
    }
  }

  return clauseStart;
}

function findClauseEnd(input: LlmInterpretationInput, availabilityStart: number) {
  let clauseEnd = input.tokens.length - 1;

  for (let index = availabilityStart + 1; index < input.tokens.length; index += 1) {
    const label = input.tokens[index]!.label;

    if (label === "sentence_boundary" || label === "conjunction_contrast") {
      clauseEnd = index - 1;
      break;
    }

    if (label === "punctuation_boundary" && isForwardClauseBoundaryPunctuation(input, availabilityStart, index)) {
      clauseEnd = index - 1;
      break;
    }
  }

  return Math.max(clauseEnd, availabilityStart);
}

function buildClauseRanges(input: LlmInterpretationInput) {
  const ranges: Array<{ start: number; end: number }> = [];
  let clauseStart = 0;

  for (let index = 0; index <= input.tokens.length; index += 1) {
    const token = input.tokens[index];
    const isBoundary =
      index === input.tokens.length ||
      token?.label === "sentence_boundary" ||
      token?.label === "conjunction_contrast";

    if (!isBoundary) {
      continue;
    }

    if (clauseStart <= index - 1) {
      ranges.push({ start: clauseStart, end: index - 1 });
    }

    clauseStart = index + 1;
  }

  return ranges;
}

function isBackwardClauseBoundaryPunctuation(input: LlmInterpretationInput, punctuationIndex: number) {
  for (let index = punctuationIndex - 1; index >= 0; index -= 1) {
    const label = input.tokens[index]!.label;

    if (label === "sentence_boundary" || label === "conjunction_contrast") {
      break;
    }

    if (isAvailabilityLabel(label)) {
      return true;
    }
  }

  return false;
}

function isForwardClauseBoundaryPunctuation(
  input: LlmInterpretationInput,
  availabilityStart: number,
  punctuationIndex: number,
) {
  for (let index = availabilityStart + 1; index < punctuationIndex; index += 1) {
    const label = input.tokens[index]!.label;

    if (isTargetLabel(label) || isScopeLabel(label)) {
      return false;
    }
  }

  return true;
}

function buildListTargetGroupClusters(
  input: LlmInterpretationInput,
  targetGroups: TokenIndexGroup[],
) {
  const clusters: TokenIndexGroup[][] = [];
  let currentCluster: TokenIndexGroup[] = [];

  for (const group of targetGroups) {
    if (!isListHypothesisEligibleTargetGroup(input, group)) {
      if (currentCluster.length > 1) {
        clusters.push(currentCluster);
      }
      currentCluster = [];
      continue;
    }

    if (currentCluster.length === 0) {
      currentCluster = [group];
      continue;
    }

    const previousGroup = currentCluster[currentCluster.length - 1]!;
    const betweenTokens = input.tokens.slice(Math.max(...previousGroup.tokenIndexes) + 1, Math.min(...group.tokenIndexes));

    if (betweenTokens.length > 0 && betweenTokens.every(isListClusterJoinerToken)) {
      currentCluster.push(group);
      continue;
    }

    if (currentCluster.length > 1) {
      clusters.push(currentCluster);
    }
    currentCluster = [group];
  }

  if (currentCluster.length > 1) {
    clusters.push(currentCluster);
  }

  return clusters;
}

function replaceTargetGroups(
  sourceGroups: TokenIndexGroup[],
  targetCluster: TokenIndexGroup[],
  replacementGroups: TokenIndexGroup[],
) {
  const targetIds = new Set(targetCluster.map((group) => group.id));
  const replaced: TokenIndexGroup[] = [];
  let inserted = false;

  for (const group of sourceGroups) {
    if (!targetIds.has(group.id)) {
      replaced.push(group);
      continue;
    }

    if (!inserted) {
      replaced.push(...replacementGroups);
      inserted = true;
    }
  }

  return replaced;
}

function serializeTargetGroups(targetGroups: TokenIndexGroup[]) {
  return JSON.stringify(
    targetGroups.map((group) => sortIndexes(group.tokenIndexes)),
  );
}

function buildMergedTargetGroupId(groups: TokenIndexGroup[]) {
  return `tg-merged-${groups.map((group) => group.id).join("-")}`;
}

function formatTokenGroupText(input: LlmInterpretationInput, tokenIndexes: number[]) {
  return tokenIndexes.map((tokenIndex) => input.tokens[tokenIndex]?.text ?? "").filter(Boolean).join(" / ");
}

function toAutoInterpretationRuleToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
) {
  return {
    text: token.text,
    label: token.label,
    ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
  };
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
  let residualOfTargetGroups: AutoInterpretationRule["residualOfTargetGroups"] = [];
  let exceptionTargetTokenIndexes: number[] = [];
  let contrastClauseTokenIndexes: number[] = [];

  if (targetTokens.some((token) => token.label === "scope_residual")) {
    const residualLink = graph.links.find(
      (graphLink): graphLink is StructuralTokenLink =>
        graphLink.relation === "residual_of" && areSameIndexes(graphLink.sourceTokenIndexes, link.targetTokenIndexes),
    );

    if (residualLink) {
      residualOfTokenIndexes = residualLink.targetTokenIndexes;
      residualOfTargetGroups = executionInput.grouping.targetGroups
        .filter((group) => group.tokenIndexes.every((tokenIndex) => residualOfTokenIndexes.includes(tokenIndex)))
        .map((group) => ({
          tokenIndexes: group.tokenIndexes,
          tokens: group.tokenIndexes.map((tokenIndex) => toAutoInterpretationRuleToken(executionInput.tokens[tokenIndex]!)),
        }));

      if (residualOfTargetGroups.length === 0 && residualOfTokenIndexes.length > 0) {
        residualOfTargetGroups = [
          {
            tokenIndexes: residualOfTokenIndexes,
            tokens: residualOfTokenIndexes.map((tokenIndex) => toAutoInterpretationRuleToken(executionInput.tokens[tokenIndex]!)),
          },
        ];
      }

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
    targetTokens: targetTokens.map((token) => toAutoInterpretationRuleToken(token)),
    targetTokenIndexes: link.targetTokenIndexes,
    targetText: formatTokenText(executionInput, link.targetTokenIndexes),
    targetLabels: targetTokens.map((token) => token.label),
    targetNormalizedTexts: targetTokens.map((token) => token.normalizedText).filter((value): value is string => Boolean(value)),
    residualOfTokens: residualOfTokenIndexes.map((tokenIndex) => toAutoInterpretationRuleToken(executionInput.tokens[tokenIndex]!)),
    availabilityTokenIndexes: link.availabilityTokenIndexes,
    availabilityText: formatTokenText(executionInput, link.availabilityTokenIndexes),
    availabilityLabel: availabilityTokens[0]?.label as AutoInterpretationRule["availabilityLabel"],
    modifierTokenIndexes: link.modifierTokenIndexes ?? [],
    modifierTexts: modifierTokens.map((token) => token.text),
    modifierLabels: modifierTokens.map((token) => token.label),
    residualOfTokenIndexes,
    residualOfTargetGroups,
    exceptionTargetTokens: exceptionTargetTokenIndexes.map((tokenIndex) => toAutoInterpretationRuleToken(executionInput.tokens[tokenIndex]!)),
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
  candidates: EventCandidateRecord[] = [],
): AutoInterpretationPreference[] {
  const clauses = buildPreferenceClauses(executionInput);
  const preferences: AutoInterpretationPreference[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    if (clause.tokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "comparison_marker")) {
      continue;
    }

    const explicitPreferenceCoreTokenIndexes = clause.tokenIndexes.filter((tokenIndex) =>
      isExplicitPreferenceCoreToken(executionInput.tokens[tokenIndex]!),
    );
    const implicitPreferenceCoreTokenIndexes =
      explicitPreferenceCoreTokenIndexes.length === 0 &&
      clause.targetGroups.length > 0 &&
      !clause.tokenIndexes.some((tokenIndex) => isAvailabilityLabel(executionInput.tokens[tokenIndex]!.label))
        ? clause.tokenIndexes.filter((tokenIndex) => isImplicitPreferenceCoreToken(executionInput.tokens[tokenIndex]!))
        : [];

    const corePreferenceTokenIndexes = explicitPreferenceCoreTokenIndexes.length > 0
      ? explicitPreferenceCoreTokenIndexes
      : implicitPreferenceCoreTokenIndexes;

    if (corePreferenceTokenIndexes.length === 0) {
      continue;
    }

    const markerTokenIndexes = sortIndexes(
      clause.tokenIndexes.filter((tokenIndex) =>
        isPreferenceContextLabel(executionInput.tokens[tokenIndex]!.label),
      ),
    );
    const anchorTargetGroup = choosePreferenceTargetGroup(clause.targetGroups, corePreferenceTokenIndexes);
    const inferredTarget = anchorTargetGroup
      ? null
      : inferPreferenceTargetFromCommentText(executionInput.originalText, candidates);

    if (!anchorTargetGroup && !inferredTarget) {
      continue;
    }

    const markerTokens = markerTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!);
    const preference: AutoInterpretationPreference = {
      targetTokenIndexes: anchorTargetGroup?.tokenIndexes ?? [],
      targetText: anchorTargetGroup ? formatTokenText(executionInput, anchorTargetGroup.tokenIndexes) : inferredTarget!.text,
      targetLabels: anchorTargetGroup
        ? anchorTargetGroup.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.label)
        : [],
      targetNormalizedTexts: anchorTargetGroup
        ? anchorTargetGroup.tokenIndexes
            .map((tokenIndex) => executionInput.tokens[tokenIndex]!.normalizedText)
            .filter((value): value is string => Boolean(value))
        : inferredTarget!.normalizedTexts,
      markerTokenIndexes,
      markerTexts: markerTokens.map((token) => token.text),
      markerLabels: markerTokens.map((token) => token.label),
      level: inferPreferenceLevel(markerTokens),
      notes: anchorTargetGroup ? [] : ["raw_text_target_fallback"],
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

function isExplicitPreferenceCoreToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
) {
  return token.label === "preference_positive_marker" || token.label === "preference_negative_marker";
}

function buildParsedConstraintsFromAvailabilityInterpretation(
  executionInput: AvailabilityInterpretationExecutionInput,
  graph: LlmInterpretationOutput,
  candidates: EventCandidateRecord[],
) {
  const constraints: ParsedCommentConstraint[] = [];
  const seen = new Set<string>();
  const autoInterpretation = buildAutoInterpretationResult(executionInput, graph, candidates);

  for (const resolvedStatus of autoInterpretation.resolvedCandidateStatuses) {
    const candidate = candidates.find((entry) => entry.id === resolvedStatus.candidateId);

    if (!candidate) {
      continue;
    }

    const constraint = buildCandidateConstraintFromAutoRule(candidate, resolvedStatus.level, executionInput.originalText, "availability", {
      dateValue: resolvedStatus.dateValue,
      timeSlotKey: resolvedStatus.timeSlotKey,
    });
    const key = JSON.stringify(constraint);

    if (!seen.has(key)) {
      seen.add(key);
      constraints.push(constraint);
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
  const pushStatus = (status: AutoInterpretationResolvedCandidateStatus) => {
    const key = JSON.stringify(status);

    if (!seen.has(key)) {
      seen.add(key);
      statuses.push(status);
    }
  };

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
        pushStatus({
          candidateId: candidate.id,
          dateValue,
          timeSlotKey,
          level,
          detailLabel,
        });
      }
    }

    if (rule.targetLabels.includes("scope_exception") && rule.availabilityLabel === "availability_positive") {
      // "X以外はいける" should not silently fall back to a default yes on the excluded side.
      const excludedLevel: ParsedConstraintLevel = "hard_no";
      const excludedTimeSlotKey = resolveTimeSlotKeyForRuleTargetTokens(rule.exceptionTargetTokens);
      const excludedDetailLabel = `${formatAutoRuleTargetText(rule.exceptionTargetTokens)} → ${formatConstraintLevelLabelForAutoInterpretationLevel(excludedLevel)}`;
      const excludedCandidates = candidates.filter((candidate) =>
        matchesRuleTargetTokens(rule.exceptionTargetTokens, candidate, candidates),
      );

      for (const candidate of excludedCandidates) {
        const matchedDateValues = resolveMatchedDateValuesForRuleTargetTokens(rule.exceptionTargetTokens, candidate, candidates);

        for (const dateValue of matchedDateValues) {
          pushStatus({
            candidateId: candidate.id,
            dateValue,
            timeSlotKey: excludedTimeSlotKey,
            level: excludedLevel,
            detailLabel: excludedDetailLabel,
          });
        }
      }
    }
  }

  return statuses;
}

function formatAutoRuleTargetText(
  tokens: Array<{ text: string }>,
) {
  return [...new Set(tokens.map((token) => token.text.trim()).filter(Boolean))].join(" / ");
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

    return candidates.filter((candidate) => !matchesResidualScopeAntecedent(rule, candidate, candidates));
  }

  return candidates.filter((candidate) => doesAutoInterpretationRuleMatchCandidate(rule, candidate, candidates));
}

export function inferConstraintLevelFromAutoInterpretationRule(
  rule: AutoInterpretationRule,
): ParsedConstraintLevel {
  if (
    rule.modifierLabels.includes("hypothetical_marker") ||
    rule.modifierLabels.includes("desire_marker") ||
    rule.modifierLabels.includes("conditional_marker")
  ) {
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
    case "target_numeric_candidate":
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

  if (typeof token.normalizedText === "string" && token.normalizedText.includes("+")) {
    return token.normalizedText.split("+").includes(weekday);
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
        (token) =>
          token.label === "target_date" ||
          token.label === "target_numeric_candidate" ||
          token.label === "target_date_range",
      );
      const contextualDateTokens = dateFilteringTokens.filter(
        (token) =>
          token.label !== "target_date" &&
          token.label !== "target_numeric_candidate" &&
          token.label !== "target_date_range",
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
      (token) =>
        token.label === "target_date" ||
        token.label === "target_numeric_candidate" ||
        token.label === "target_date_range",
    );
    const contextualDateTokens = dateFilteringTokens.filter(
      (token) =>
        token.label !== "target_date" &&
        token.label !== "target_numeric_candidate" &&
        token.label !== "target_date_range",
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

function matchesResidualScopeAntecedent(
  rule: AutoInterpretationRule,
  candidate: EventCandidateRecord,
  allCandidates: EventCandidateRecord[],
) {
  if (rule.residualOfTargetGroups.length > 0) {
    return rule.residualOfTargetGroups.some((group) => matchesRuleTargetTokens(group.tokens, candidate, allCandidates));
  }

  return rule.residualOfTokens.length > 0 && matchesRuleTargetTokens(rule.residualOfTokens, candidate, allCandidates);
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
    return rule.residualOfTokens.length > 0 && !matchesResidualScopeAntecedent(rule, candidate, allCandidates);
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
    case "target_numeric_candidate":
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

  if (typeof token.normalizedText === "string" && token.normalizedText.includes("+")) {
    return token.normalizedText.split("+").includes(weekday);
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
    (token) =>
      token.label === "target_date" ||
      token.label === "target_numeric_candidate" ||
      token.label === "target_date_range",
  );
  const contextualDateTokens = dateFilteringTokens.filter(
    (token) =>
      token.label !== "target_date" &&
      token.label !== "target_numeric_candidate" &&
      token.label !== "target_date_range",
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
    (token) =>
      token.label === "target_date" ||
      token.label === "target_numeric_candidate" ||
      token.label === "target_date_range",
  );
  const contextualDateTokens = dateFilteringTokens.filter(
    (token) =>
      token.label !== "target_date" &&
      token.label !== "target_numeric_candidate" &&
      token.label !== "target_date_range",
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
    label === "target_numeric_candidate" ||
    label === "target_date_range" ||
    label === "target_weekday" ||
    label === "target_weekday_group" ||
    label === "target_relative_period" ||
    label === "target_month_part" ||
    label === "target_week_ordinal" ||
    label === "target_holiday_related"
  );
}

function isTargetGroupJoinerToken(token: AvailabilityInterpretationExecutionInput["tokens"][number]) {
  if (token.label === "particle_topic" || token.label === "particle_limit") {
    return true;
  }

  if (token.label !== "particle_link") {
    return false;
  }

  return token.text === "の" || token.text === "で" || token.text === "に";
}

function isListClusterJoinerToken(token: AvailabilityInterpretationExecutionInput["tokens"][number]) {
  if (token.label === "punctuation_boundary") {
    return true;
  }

  if (token.label === "conjunction_parallel") {
    return true;
  }

  if (token.label !== "particle_link") {
    return false;
  }

  const normalizedText = token.text.trim().toLowerCase();

  return token.text === "と" || token.text === "や" || token.text === "か" || token.text === "とか" || normalizedText === "or";
}

function isListHypothesisEligibleTargetGroup(
  input: LlmInterpretationInput,
  group: TokenIndexGroup,
) {
  const labels = group.tokenIndexes.map((tokenIndex) => input.tokens[tokenIndex]?.label);

  return (
    labels.length > 0 &&
    labels.every(
      (label) =>
        label === "target_date" ||
        label === "target_numeric_candidate" ||
        label === "target_date_range" ||
        label === "target_weekday" ||
        label === "target_weekday_group" ||
        label === "target_time_of_day",
    ) &&
    labels.some((label) => label !== "target_time_of_day")
  );
}

function shouldMergeAdjacentTargetTokens(
  left: AvailabilityInterpretationExecutionInput["tokens"][number],
  right: AvailabilityInterpretationExecutionInput["tokens"][number],
) {
  return isDateLikeOrWeekLikeTargetLabel(left.label) && right.label === "target_time_of_day";
}

function isDateLikeOrWeekLikeTargetLabel(label: Label) {
  return (
    label === "target_date" ||
    label === "target_numeric_candidate" ||
    label === "target_date_range" ||
    label === "target_weekday" ||
    label === "target_weekday_group"
  );
}

function isSemanticModifierLabel(label: Label) {
  return (
    label === "uncertainty_marker" ||
    label === "desire_marker" ||
    label === "hypothetical_marker" ||
    label === "emphasis_marker" ||
    label === "conditional_marker"
  );
}

function isPreferenceMarkerLabel(label: Label) {
  return label === "preference_positive_marker" || label === "preference_negative_marker";
}

function isPreferenceContextLabel(label: Label) {
  return (
    isPreferenceMarkerLabel(label) ||
    label === "strength_marker" ||
    label === "weak_commitment_marker" ||
    label === "hypothetical_marker" ||
    label === "conditional_marker"
  );
}

function isImplicitPreferenceCoreToken(
  token: AvailabilityInterpretationExecutionInput["tokens"][number],
) {
  return (
    (token.label === "hypothetical_marker" || token.label === "weak_commitment_marker") &&
    /できれば|なるべく|可能なら|できたら/u.test(token.text)
  );
}

function inferPreferenceLevel(
  markerTokens: Array<AvailabilityInterpretationExecutionInput["tokens"][number]>,
): AutoInterpretationPreference["level"] {
  if (markerTokens.some((token) => token.label === "preference_negative_marker")) {
    return "avoid";
  }

  if (
    markerTokens.some(
      (token) =>
        token.label === "strength_marker" ||
        /第一希望|ベスト|一番いい|理想|優先/u.test(token.text),
    )
  ) {
    return "strong_preferred";
  }

  return "preferred";
}

function inferPreferenceTargetFromCommentText(comment: string, candidates: EventCandidateRecord[]) {
  const matchedDates = resolveExplicitDateTargetsFromComment(comment, candidates);

  if (matchedDates.length !== 1) {
    return null;
  }

  return {
    text: matchedDates[0]!.text,
    normalizedTexts: [matchedDates[0]!.normalizedText],
  };
}

export function resolveExplicitDateTargetsFromComment(comment: string, candidates: EventCandidateRecord[]) {
  const uniqueDates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const uniqueDayMap = new Map<string, string | null>();
  const uniqueMonthDayMap = new Map<string, string>();

  for (const dateValue of uniqueDates) {
    const dayKey = String(Number(dateValue.slice(8, 10)));
    const monthDayKey = `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}`;
    uniqueMonthDayMap.set(monthDayKey, dateValue);
    uniqueDayMap.set(dayKey, uniqueDayMap.has(dayKey) && uniqueDayMap.get(dayKey) !== dateValue ? null : dateValue);
  }

  const matches = [...comment.matchAll(/(\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?|\d{1,2})/gu)]
    .map((match) => {
      const text = match[1]!;
      const normalizedText = resolveExplicitDateTarget(text, uniqueDayMap, uniqueMonthDayMap);

      return normalizedText ? { text, normalizedText } : null;
    })
    .filter((entry): entry is { text: string; normalizedText: string } => entry !== null);

  return matches.filter(
    (entry, index, entries) =>
      entries.findIndex(
        (candidate) => candidate.text === entry.text && candidate.normalizedText === entry.normalizedText,
      ) === index,
  );
}

function resolveExplicitDateTarget(
  rawText: string,
  uniqueDayMap: Map<string, string | null>,
  uniqueMonthDayMap: Map<string, string>,
) {
  const slashMatch = rawText.match(/^(\d{1,2})\/(\d{1,2})$/u);

  if (slashMatch) {
    return uniqueMonthDayMap.get(`${Number(slashMatch[1])}/${Number(slashMatch[2])}`) ?? null;
  }

  const monthDayMatch = rawText.match(/^(\d{1,2})月\s*(\d{1,2})日?$/u);

  if (monthDayMatch) {
    return uniqueMonthDayMap.get(`${Number(monthDayMatch[1])}/${Number(monthDayMatch[2])}`) ?? null;
  }

  const dayOnlyMatch = rawText.match(/^(\d{1,2})日?$/u);

  if (dayOnlyMatch) {
    return uniqueDayMap.get(String(Number(dayOnlyMatch[1]))) ?? null;
  }

  return null;
}
