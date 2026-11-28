import assert from "node:assert/strict";
import { getISTServiceDate, isServiceDateTodayOrPast } from "../lib/service-date";

// This script is intended to be run under TZ=UTC. Set it explicitly as well
// so the regression can be executed consistently with: npm run test:service-date.
process.env.TZ = "UTC";

assert.equal(
  new Date("2026-11-23T20:30:00.000Z").getHours(),
  20,
  "the test process should use UTC as its local timezone",
);

const asServiceDate = (value: string) => getISTServiceDate(new Date(value)).toISOString();

assert.equal(
  asServiceDate("2026-11-23T18:29:59.999Z"),
  "2026-11-23T00:00:00.000Z",
  "one millisecond before IST midnight still belongs to the previous service day",
);
assert.equal(
  asServiceDate("2026-11-23T18:30:00.000Z"),
  "2026-11-24T00:00:00.000Z",
  "the exact IST midnight boundary advances the service date",
);
assert.equal(
  asServiceDate("2026-11-23T20:30:00.000Z"),
  "2026-11-24T00:00:00.000Z",
  "2:00 AM IST must not use the previous UTC calendar date",
);
assert.equal(
  asServiceDate("2026-11-24T18:29:59.999Z"),
  "2026-11-24T00:00:00.000Z",
  "the last millisecond of an IST calendar day keeps that service date",
);
assert.equal(
  asServiceDate("2026-11-24T18:30:00.000Z"),
  "2026-11-25T00:00:00.000Z",
  "the next IST midnight advances to the next service date",
);
assert.equal(
  getISTServiceDate(new Date("2026-12-31T20:00:00.000Z"), 1).toISOString(),
  "2027-01-02T00:00:00.000Z",
  "offsets are applied to the IST calendar day across year boundaries",
);

const now = new Date("2026-11-23T20:30:00.000Z");
assert.equal(
  isServiceDateTodayOrPast(new Date("2026-11-23T00:00:00.000Z"), now),
  true,
  "yesterday's service remains eligible",
);
assert.equal(
  isServiceDateTodayOrPast(new Date("2026-11-24T00:00:00.000Z"), now),
  true,
  "today's IST service is eligible even while UTC is on the previous day",
);
assert.equal(
  isServiceDateTodayOrPast(new Date("2026-11-25T00:00:00.000Z"), now),
  false,
  "future IST services are not eligible for attendance",
);

assert.throws(
  () => getISTServiceDate(new Date("invalid")),
  RangeError,
  "invalid instants should fail clearly",
);
assert.throws(
  () => getISTServiceDate(new Date("2026-11-23T20:30:00.000Z"), 0.5),
  RangeError,
  "service-date offsets must be whole days",
);

console.log("IST service-date regression checks passed (TZ=UTC).");
