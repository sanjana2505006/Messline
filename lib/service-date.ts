const SERVICE_TIME_ZONE = "Asia/Kolkata";

/** Return the service calendar date for an instant, independent of server TZ. */
export function getServiceCalendarDate(now: Date, offsetDays = 0): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + offsetDays,
    ),
  );
}

/** Keep YYYY-MM-DD service date fields anchored at midnight UTC in storage. */
export function getServiceDateString(now: Date, offsetDays = 0): string {
  return getServiceCalendarDate(now, offsetDays).toISOString().slice(0, 10);
}
