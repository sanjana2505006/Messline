import { z } from "zod";

export const DAY_MS = 86400000;
export const IST_OFFSET_MS = 330 * 60000;
export const policySchema = z.object({
  version: z.number().int().positive(),
  minimumDays: z.number().int().min(1).max(31),
  noticeHours: z.number().int().min(0).max(720),
  breakfastPaise: z.number().int().min(0).max(100000),
  lunchPaise: z.number().int().min(0).max(100000),
  dinnerPaise: z.number().int().min(0).max(100000),
});
export type RebatePolicyView = z.infer<typeof policySchema>;
export const DEFAULT_REBATE_POLICY: RebatePolicyView = {
  version: 1,
  minimumDays: 2,
  noticeHours: 24,
  breakfastPaise: 0,
  lunchPaise: 0,
  dinnerPaise: 0,
};
export class RebateError extends Error {}
export function dateInput(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RebateError("Use a valid calendar date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value)
    throw new RebateError("Use a valid calendar date.");
  return date;
}
export function qualifyAbsence(
  start: string,
  end: string,
  rawPolicy: unknown,
  now = new Date(),
) {
  const policy = policySchema.parse(rawPolicy),
    startDate = dateInput(start),
    endDate = dateInput(end);
  const days = (+endDate - +startDate) / DAY_MS + 1;
  if (days < policy.minimumDays || days > 31)
    throw new RebateError(
      `Absence must be ${policy.minimumDays}–31 consecutive days.`,
    );
  const startsAt = +startDate - IST_OFFSET_MS;
  if (startsAt - +now < policy.noticeHours * 3600000)
    throw new RebateError(
      `Apply at least ${policy.noticeHours} hours before midnight IST on the first day.`,
    );
  if (startsAt - +now > 366 * DAY_MS)
    throw new RebateError("Apply within one year of the start date.");
  const daily = policy.breakfastPaise + policy.lunchPaise + policy.dinnerPaise;
  if (!daily)
    throw new RebateError(
      "The secretary must configure meal rates before applications open.",
    );
  return {
    startDate,
    endDate,
    qualifyingDays: days,
    estimatedPaise: days * daily,
    policySnapshot: policy,
  };
}
export function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
export function statementMonth(value: string | undefined, now = new Date()) {
  const month =
    value ?? new Date(+now + IST_OFFSET_MS).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new RebateError("Choose a valid statement month.");
  const startDate = dateInput(`${month}-01`);
  const next = new Date(startDate);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return {
    month,
    start: new Date(+startDate - IST_OFFSET_MS),
    end: new Date(+next - IST_OFFSET_MS),
  };
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
