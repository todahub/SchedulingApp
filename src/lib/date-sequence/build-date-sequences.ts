import type { ExtractedTimeTargetCandidate } from "@/lib/comment-target-extractor";
import type {
  BuildDateSequencesInput,
  DateSequence,
  DateSequenceConnector,
  DateSequenceConnectorType,
  DateSequenceTarget,
} from "./types";

type SequenceTargetDraft = Omit<DateSequenceTarget, "targetId">;

const JOINABLE_SEQUENCE_GAP = /^(?:\s|、|,|，|・|\.|と|か|〜|~|-|から|まで|の|は|も)+$/u;

function normalizeDigits(text: string) {
  return text.replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function classifyConnector(gapText: string): DateSequenceConnectorType {
  const compact = gapText.replace(/\s+/gu, " ").trim();

  if (!compact) {
    return gapText.length > 0 ? "space" : "adjacent";
  }

  if (/^(?:~|〜|-|から|まで)+$/u.test(compact)) {
    return "range";
  }

  if (compact === "、") {
    return "jp_comma";
  }

  if (compact === "," || compact === "，") {
    return "comma";
  }

  if (compact === "・" || compact === ".") {
    return "dot";
  }

  if (compact === "と") {
    return "and";
  }

  if (compact === "か") {
    return "or";
  }

  if (/^[のはも]+$/u.test(compact)) {
    return "link";
  }

  return "other";
}

function buildConnector(text: string, start: number, end: number): DateSequenceConnector {
  return {
    text,
    start,
    end,
    type: classifyConnector(text),
  };
}

function shouldStayInSameSequence(gapText: string) {
  return JOINABLE_SEQUENCE_GAP.test(gapText);
}

function decomposeRangeTarget(target: ExtractedTimeTargetCandidate, sourceTargetIndex: number): SequenceTargetDraft[] | null {
  if (target.kind !== "date_range") {
    return null;
  }

  const match = normalizeDigits(target.text).match(
    /^\s*(\d{1,2}(?:\/\d{1,2}|月\s*\d{1,2}日?|\d{1,2}日?))\s*(~|〜|-|から)\s*(\d{1,2}(?:\/\d{1,2}|月\s*\d{1,2}日?|\d{1,2}日?))(?:まで)?\s*$/u,
  );

  if (!match) {
    return null;
  }

  const startText = match[1]!;
  const connectorText = match[2]!;
  const endText = match[3]!;
  const startOffset = target.text.indexOf(startText);
  const endOffset = target.text.lastIndexOf(endText);
  const resolvedStartDate = typeof target.metadata?.resolvedStartDate === "string" ? target.metadata.resolvedStartDate : undefined;
  const resolvedEndDate = typeof target.metadata?.resolvedEndDate === "string" ? target.metadata.resolvedEndDate : undefined;

  if (startOffset < 0 || endOffset < 0) {
    return null;
  }

  return [
    {
      text: startText,
      normalizedValue: resolvedStartDate ?? startText,
      start: target.start + startOffset,
      end: target.start + startOffset + startText.length,
      sourceTargetKind: target.kind,
      sourceTargetIndex,
      metadata: {
        ...(target.metadata ?? {}),
        rangeEndpointPosition: "start",
        rangeConnectorText: connectorText,
      },
      derivedFromRange: true,
    },
    {
      text: endText,
      normalizedValue: resolvedEndDate ?? endText,
      start: target.start + endOffset,
      end: target.start + endOffset + endText.length,
      sourceTargetKind: target.kind,
      sourceTargetIndex,
      metadata: {
        ...(target.metadata ?? {}),
        rangeEndpointPosition: "end",
        rangeConnectorText: connectorText,
      },
      derivedFromRange: true,
    },
  ];
}

function toSequenceTargetDrafts(extractedTargets: ExtractedTimeTargetCandidate[]) {
  return extractedTargets
    .flatMap((target, index) => {
      const rangeTargets = decomposeRangeTarget(target, index);

      if (rangeTargets) {
        return rangeTargets;
      }

      return [
        {
          text: target.text,
          normalizedValue: target.normalizedValue,
          start: target.start,
          end: target.end,
          sourceTargetKind: target.kind,
          sourceTargetIndex: index,
          metadata: target.metadata,
          derivedFromRange: false,
        } satisfies SequenceTargetDraft,
      ];
    })
    .sort((left, right) => left.start - right.start || left.end - right.end || left.text.localeCompare(right.text));
}

function assignTargetIds(sequenceId: string, targets: SequenceTargetDraft[]): DateSequenceTarget[] {
  return targets.map((target, index) => ({
    ...target,
    targetId: `${sequenceId}-t${index + 1}`,
  }));
}

export function buildDateSequences(input: BuildDateSequencesInput): DateSequence[] {
  const contextWindow = input.contextWindow ?? 24;
  const targetDrafts = toSequenceTargetDrafts(input.extractedTargets);

  if (targetDrafts.length === 0) {
    return [];
  }

  const sequences: DateSequence[] = [];
  let currentTargets: SequenceTargetDraft[] = [];
  let currentConnectors: DateSequenceConnector[] = [];

  const flush = () => {
    if (currentTargets.length === 0) {
      return;
    }

    const sequenceId = `seq-${sequences.length + 1}`;
    const start = currentTargets[0]!.start;
    const end = currentTargets[currentTargets.length - 1]!.end;

    sequences.push({
      sequenceId,
      sourceText: input.normalizedText.slice(start, end),
      span: { start, end },
      targets: assignTargetIds(sequenceId, currentTargets),
      connectors: currentConnectors,
      context: {
        originalText: input.originalText,
        normalizedText: input.normalizedText,
        beforeText: input.normalizedText.slice(Math.max(0, start - contextWindow), start),
        afterText: input.normalizedText.slice(end, Math.min(input.normalizedText.length, end + contextWindow)),
      },
    });

    currentTargets = [];
    currentConnectors = [];
  };

  for (const target of targetDrafts) {
    if (currentTargets.length === 0) {
      currentTargets.push(target);
      continue;
    }

    const previous = currentTargets[currentTargets.length - 1]!;
    const gapText = input.normalizedText.slice(previous.end, target.start);

    if (!shouldStayInSameSequence(gapText)) {
      flush();
      currentTargets.push(target);
      continue;
    }

    currentConnectors.push(buildConnector(gapText, previous.end, target.start));
    currentTargets.push(target);
  }

  flush();

  return sequences;
}

