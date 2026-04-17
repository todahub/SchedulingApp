import type { BuildDateSequencesInput, DateSequence, DateSequenceConnectorType, DateSequenceGroupingHypothesis, DateSequenceInterpretation } from "./types";
import { buildDateSequences } from "./build-date-sequences";

function buildSingleGroupHypothesis(sequence: DateSequence): DateSequenceGroupingHypothesis {
  const rangeConnector = sequence.targets.find((target) => target.derivedFromRange)?.metadata?.rangeConnectorText;

  if (typeof rangeConnector === "string" && sequence.targets.length === 2) {
    return {
      hypothesisId: `${sequence.sequenceId}-h1`,
      kind: "range_group",
      groups: [sequence.targets.map((target) => target.targetId)],
      evidence: [
        "single_adjacent_sequence",
        `${rangeConnector}_between_date_targets`,
      ],
      connectorPolicy: {
        rangeConnector: rangeConnector,
        rangeInterpretation: "range",
      },
    };
  }

  return {
    hypothesisId: `${sequence.sequenceId}-h1`,
    kind: "single_group",
    groups: [sequence.targets.map((target) => target.targetId)],
    evidence: ["single_adjacent_sequence"],
  };
}

function buildRangeIsolatedHypothesis(sequence: DateSequence): DateSequenceGroupingHypothesis | null {
  const rangeConnector = sequence.targets.find((target) => target.derivedFromRange)?.metadata?.rangeConnectorText;

  if (typeof rangeConnector !== "string" || sequence.targets.length !== 2) {
    return null;
  }

  return {
    hypothesisId: `${sequence.sequenceId}-h2`,
    kind: "isolated_targets",
    groups: sequence.targets.map((target) => [target.targetId]),
    evidence: ["connector_is_ambiguous"],
    connectorPolicy: {
      rangeConnector: rangeConnector,
      rangeInterpretation: "ignored",
    },
  };
}

function collectSplitIndices(sequence: DateSequence) {
  const connectorTypes = sequence.connectors.map((connector) => connector.type);
  const splitIndices = new Set<number>();

  for (let index = 1; index < connectorTypes.length - 1; index += 1) {
    const previous = connectorTypes[index - 1];
    const current = connectorTypes[index];
    const next = connectorTypes[index + 1];

    if (previous === next && current !== previous) {
      splitIndices.add(index);
    }
  }

  connectorTypes.forEach((type, index) => {
    if (type === "space") {
      splitIndices.add(index);
    }
  });

  return [...splitIndices].sort((left, right) => left - right);
}

function getSplitEvidence(connectorType: DateSequenceConnectorType) {
  if (connectorType === "space") {
    return "whitespace_boundary";
  }

  return "delimiter_pattern_change";
}

function buildSplitHypothesis(sequence: DateSequence, splitConnectorIndex: number, hypothesisOrdinal: number): DateSequenceGroupingHypothesis {
  const splitTargetIndex = splitConnectorIndex + 1;
  const connector = sequence.connectors[splitConnectorIndex]!;
  const leftGroup = sequence.targets.slice(0, splitTargetIndex).map((target) => target.targetId);
  const rightGroup = sequence.targets.slice(splitTargetIndex).map((target) => target.targetId);

  return {
    hypothesisId: `${sequence.sequenceId}-h${hypothesisOrdinal}`,
    kind: "split_groups",
    groups: [leftGroup, rightGroup],
    evidence: [getSplitEvidence(connector.type)],
    connectorPolicy: {
      splitConnectorText: connector.text,
      splitConnectorType: connector.type,
      splitInterpretation: "split",
    },
  };
}

export function buildGroupingHypotheses(sequence: DateSequence): DateSequenceGroupingHypothesis[] {
  const hypotheses: DateSequenceGroupingHypothesis[] = [buildSingleGroupHypothesis(sequence)];
  const rangeIsolated = buildRangeIsolatedHypothesis(sequence);

  if (rangeIsolated) {
    hypotheses.push(rangeIsolated);
    return hypotheses;
  }

  if (sequence.targets.length <= 2) {
    return hypotheses;
  }

  const splitIndices = collectSplitIndices(sequence);

  splitIndices.forEach((splitConnectorIndex, index) => {
    hypotheses.push(buildSplitHypothesis(sequence, splitConnectorIndex, hypotheses.length + index + 1));
  });

  return hypotheses;
}

export function buildDateSequenceInterpretations(input: BuildDateSequencesInput): { sequences: DateSequenceInterpretation[] } {
  const sequences = buildDateSequences(input).map((sequence) => ({
    ...sequence,
    groupingHypotheses: buildGroupingHypotheses(sequence),
  }));

  return { sequences };
}

