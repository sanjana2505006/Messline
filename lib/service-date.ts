/**
 * Service-date helpers for the database's calendar-day convention.
 *
 * A service date is persisted as 00:00 UTC for the corresponding IST
 * calendar day (for example, 2026-11-24 in India is
 * 2026-11-24T00:00:00.000Z in the database). Derive the calendar components
 * from Asia/Kolkata explicitly so the server's local timezone is irrelevant.
 */
const IST_TIME_ZONE = "Asia/Kolkata";

const istCalendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Return the IST calendar day containing `now`, represented as midnight UTC.
 * `offsetDays` shifts that calendar date (not the instant) by whole days.
 */
export function getISTServiceDate(
  now: Date = new Date(),
  offsetDays = 0,
): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError("A valid date is required to calculate an IST service date.");
  }
  if (!Number.isSafeInteger(offsetDays)) {
    throw new RangeError("Service-date offset must be a whole number of days.");
  }

  const parts = istCalendarFormatter.formatToParts(now);
  const partValue = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;

  const year = Number(partValue("year"));
  const month = Number(partValue("month"));
  const day = Number(partValue("day"));

  if (![year, month, day].every(Number.isInteger)) {
    throw new RangeError("Unable to determine the IST calendar date.");
  }

  // Keep the database representation stable: service-date midnight is UTC.
  return new Date(Date.UTC(year, month - 1, day + offsetDays));
}

/**
 * Whether a stored service date is today or earlier in the IST calendar.
 */
export function isServiceDateTodayOrPast(
  serviceDate: Date,
  now: Date = new Date(),
): boolean {
  return serviceDate.getTime() <= getISTServiceDate(now).getTime();
}
