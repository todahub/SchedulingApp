import { availabilityToneClass } from "@/lib/config";
import type { AvailabilityLevel } from "@/lib/domain";

type StatusPillProps = {
  level: AvailabilityLevel;
};

export function StatusPill({ level }: StatusPillProps) {
  return <span className={`status-pill ${availabilityToneClass[level.tone]}`}>{level.label}</span>;
}
