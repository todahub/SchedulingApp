import { AVAILABILITY_LEVELS } from "./config";
import type { AdjustmentSuggestion, EventDetail, RankedCandidate, ResultMode } from "./domain";
import { formatCandidateLabel, getLevelByKey, sortCandidatesByDate } from "./utils";

export function rankCandidates(detail: EventDetail, mode: ResultMode): RankedCandidate[] {
  const orderedCandidates = sortCandidatesByDate(detail.candidates);

  const ranked = orderedCandidates.map((candidate) => {
    const statusGroups = Object.fromEntries(AVAILABILITY_LEVELS.map((level) => [level.key, [] as string[]])) as Record<string, string[]>;

    const participantStatuses = detail.responses.map((response) => {
      const answer = response.answers.find((item) => item.candidateId === candidate.id);
      const level = getLevelByKey(answer?.availabilityKey);

      statusGroups[level.key].push(response.participantName);

      return {
        participantName: response.participantName,
        availabilityKey: level.key,
        label: level.label,
        weight: level.weight,
      };
    });

    const yesCount = participantStatuses.filter((status) => status.availabilityKey === "yes").length;
    const maybeCount = participantStatuses.filter((status) => status.availabilityKey === "maybe").length;
    const noCount = participantStatuses.filter((status) => status.availabilityKey === "no").length;
    const totalScore = participantStatuses.reduce((sum, status) => sum + status.weight, 0);

    return {
      candidate,
      totalScore,
      yesCount,
      maybeCount,
      noCount,
      statusGroups,
      participantStatuses,
    };
  });

  const filtered = mode === "strict_all" ? ranked.filter((candidate) => candidate.noCount === 0) : ranked;

  return filtered.sort((left, right) => {
    if (mode === "maximize_attendance" && left.noCount !== right.noCount) {
      return left.noCount - right.noCount;
    }

    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }

    if (left.yesCount !== right.yesCount) {
      return right.yesCount - left.yesCount;
    }

    return left.candidate.sortOrder - right.candidate.sortOrder;
  });
}

export function buildAdjustmentSuggestions(candidates: RankedCandidate[]): AdjustmentSuggestion[] {
  return candidates
    .filter((candidate) => candidate.participantStatuses.length > 0)
    .map((candidate) => {
      const maybeNames = candidate.statusGroups.maybe;
      const noNames = candidate.statusGroups.no;

      if (noNames.length === 1) {
        return {
          candidateId: candidate.candidate.id,
          title: `${formatCandidateLabel(candidate.candidate)} はあと一歩`,
          body: `${noNames[0]}さんの都合が動くと、この候補は一気に有力になります。微妙メンバーが少ないので調整効果が大きい日です。`,
        };
      }

      if (noNames.length === 0 && maybeNames.length > 0) {
        return {
          candidateId: candidate.candidate.id,
          title: `${formatCandidateLabel(candidate.candidate)} は確度を上げやすい候補`,
          body: `${maybeNames.join("、")}さんの「微妙」を解消できると、全員参加の本命として押しやすくなります。`,
        };
      }

      return null;
    })
    .filter((suggestion): suggestion is AdjustmentSuggestion => Boolean(suggestion))
    .slice(0, 3);
}
