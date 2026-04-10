"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/utils";

type InlineDateCalendarProps = {
  selectedDates: string[];
  rangeAnchor: string | null;
  mode: "single" | "range";
  onSelectDate: (date: string) => void;
  allowedDates?: string[] | null;
  initialMonth?: string;
};

function startOfMonth(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(value: string, diff: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + diff);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function addDays(value: string, diff: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + diff);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthDays(monthStart: string) {
  const first = new Date(`${monthStart}T00:00:00`);
  const month = first.getMonth();
  const days: string[] = [];
  const leading = (first.getDay() + 6) % 7;

  for (let index = 0; index < leading; index += 1) {
    days.push("");
  }

  const cursor = new Date(`${monthStart}T00:00:00`);
  while (cursor.getMonth() === month) {
    const year = cursor.getFullYear();
    const monthValue = String(cursor.getMonth() + 1).padStart(2, "0");
    const dayValue = String(cursor.getDate()).padStart(2, "0");
    days.push(`${year}-${monthValue}-${dayValue}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  while (days.length % 7 !== 0) {
    days.push("");
  }

  return days;
}

function getRangeDates(start: string, end: string) {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const values: string[] = [];
  let current = from;

  while (current <= to) {
    values.push(current);
    current = addDays(current, 1);
  }

  return values;
}

const weekdayLabels = ["月", "火", "水", "木", "金", "土", "日"];

export function InlineDateCalendar({
  selectedDates,
  rangeAnchor,
  mode,
  onSelectDate,
  allowedDates,
  initialMonth,
}: InlineDateCalendarProps) {
  const selectableDates = useMemo(
    () => (allowedDates && allowedDates.length > 0 ? [...allowedDates].sort((left, right) => left.localeCompare(right)) : null),
    [allowedDates],
  );

  const monthStarts = useMemo(() => {
    if (selectableDates && selectableDates.length > 0) {
      return [...new Set(selectableDates.map((date) => startOfMonth(date)))];
    }

    const baseMonth = startOfMonth(initialMonth ?? new Date().toISOString().slice(0, 10));
    return [baseMonth, addMonths(baseMonth, 1)];
  }, [initialMonth, selectableDates]);

  const [visibleMonth, setVisibleMonth] = useState(monthStarts[0] ?? startOfMonth(new Date().toISOString().slice(0, 10)));
  const visibleMonthIndex = selectableDates ? monthStarts.indexOf(visibleMonth) : -1;
  const canGoPreviousMonth = selectableDates ? visibleMonthIndex > 0 : true;
  const canGoNextMonth = selectableDates ? visibleMonthIndex >= 0 && visibleMonthIndex < monthStarts.length - 1 : true;
  const monthsToRender = [visibleMonth];

  return (
    <div className="inline-calendar">
      <div className="inline-calendar__nav">
        <button
          className="button button--ghost"
          disabled={!canGoPreviousMonth}
          onClick={() =>
            setVisibleMonth((current) =>
              selectableDates ? monthStarts[Math.max(monthStarts.indexOf(current) - 1, 0)] ?? current : addMonths(current, -1),
            )
          }
          type="button"
        >
          前の月
        </button>
        <span className="mode-chip">
          {new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(new Date(`${visibleMonth}T00:00:00`))}
        </span>
        <button
          className="button button--ghost"
          disabled={!canGoNextMonth}
          onClick={() =>
            setVisibleMonth((current) =>
              selectableDates
                ? monthStarts[Math.min(monthStarts.indexOf(current) + 1, monthStarts.length - 1)] ?? current
                : addMonths(current, 1),
            )
          }
          type="button"
        >
          次の月
        </button>
      </div>

      <div className="inline-calendar__months">
        {monthsToRender.map((monthStart) => {
          const days = getMonthDays(monthStart);
          return (
            <section className="inline-calendar__month" key={monthStart}>
              <h4>{new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long" }).format(new Date(`${monthStart}T00:00:00`))}</h4>
              <div className="inline-calendar__weekdays">
                {weekdayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="inline-calendar__grid">
                {days.map((date, index) => {
                  if (!date) {
                    return <span className="inline-calendar__blank" key={`${monthStart}-blank-${index}`} />;
                  }

                  const disabled = selectableDates ? !selectableDates.includes(date) : false;
                  const isSelected = selectedDates.includes(date);
                  const isAnchor = rangeAnchor === date;
                  const isPreview =
                    mode === "range" && rangeAnchor && !isSelected && !disabled ? getRangeDates(rangeAnchor, date).includes(date) : false;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`inline-calendar__day ${isSelected ? "is-selected" : ""} ${isAnchor ? "is-anchor" : ""} ${
                        isPreview ? "is-preview" : ""
                      }`}
                      disabled={disabled}
                      key={date}
                      onClick={() => onSelectDate(date)}
                      type="button"
                    >
                      <span className="inline-calendar__day-number">{Number(date.slice(8, 10))}</span>
                      <span className="inline-calendar__day-label">{formatDate(date)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
