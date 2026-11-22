import { test } from "node:test";
import assert from "node:assert/strict";
import {
  qualifyAbsence,
  dateInput,
  policySchema,
  statementMonth,
  csvCell,
  RebateError,
  rupees,
} from "../lib/rebate-policy";
const policy = {
  version: 1,
  minimumDays: 2,
  noticeHours: 24,
  breakfastPaise: 2000,
  lunchPaise: 4000,
  dinnerPaise: 4000,
};
const now = new Date("2026-11-19T18:30:00Z");
test("inclusive IST dates, integer paise and exact notice cutoff", () => {
  const result = qualifyAbsence("2026-11-21", "2026-11-22", policy, now);
  assert.equal(result.qualifyingDays, 2);
  assert.equal(result.estimatedPaise, 20000);
  assert.throws(
    () =>
      qualifyAbsence("2026-11-21", "2026-11-22", policy, new Date(+now + 1)),
    /at least 24 hours/,
  );
});
test("leap days and invalid dates never normalize silently", () => {
  assert.equal(
    dateInput("2028-02-29").toISOString().slice(0, 10),
    "2028-02-29",
  );
  for (const date of [
    "2026-02-29",
    "2026-13-01",
    "2026-02-30",
    "oops",
    "2026-11-21T00:00Z",
  ]) {
    assert.throws(() => dateInput(date), RebateError);
  }
});
test("minimum, maximum, reversed and stale absence windows", () => {
  for (const [start, end] of [
    ["2026-11-21", "2026-11-21"],
    ["2026-11-22", "2026-11-21"],
    ["2026-11-21", "2026-12-22"],
    ["2026-11-19", "2026-11-20"],
    ["2028-11-21", "2028-11-22"],
  ])
    assert.throws(() => qualifyAbsence(start, end, policy, now));
});
test("rates must be whole paise within limits; zero policy keeps applications closed", () => {
  assert.equal(
    policySchema.safeParse({ ...policy, lunchPaise: 1.5 }).success,
    false,
  );
  assert.equal(
    policySchema.safeParse({ ...policy, lunchPaise: -1 }).success,
    false,
  );
  assert.throws(
    () =>
      qualifyAbsence(
        "2026-11-21",
        "2026-11-22",
        { ...policy, breakfastPaise: 0, lunchPaise: 0, dinnerPaise: 0 },
        now,
      ),
    /configure/,
  );
  assert.equal(rupees(10001), "₹100.01");
});
test("statements use a half-open IST posting month including the year boundary", () => {
  const range = statementMonth("2026-12");
  assert.equal(range.start.toISOString(), "2026-11-30T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-12-31T18:30:00.000Z");
  assert.throws(() => statementMonth("2026-13"));
});
test("CSV escapes quotes, delimiters, newlines and spreadsheet formulas", () => {
  assert.equal(csvCell('A,"B"\nC'), '"A,""B""\nC"');
  for (const v of ["=1+2", "+SUM(1)", "-2+3", " @NOW()", "\t=cmd"]) {
    assert.equal(csvCell(v).startsWith("\"'"), true);
  }
  assert.equal(csvCell("Meera"), '"Meera"');
});
