import { demoCandidates, demoEvents, demoResponses } from "@/lib/demo-data";
import type { EventDetail } from "@/lib/domain";
import { sortCandidatesByDate } from "@/lib/utils";

export function makeDemoEventDetail(eventId = "demo-team-dinner"): EventDetail {
  const event = demoEvents.find((item) => item.id === eventId);

  if (!event) {
    throw new Error(`Unknown demo event: ${eventId}`);
  }

  return {
    event: structuredClone(event),
    candidates: sortCandidatesByDate(demoCandidates.filter((candidate) => candidate.eventId === eventId)),
    responses: structuredClone(demoResponses.filter((response) => response.eventId === eventId)),
  };
}
