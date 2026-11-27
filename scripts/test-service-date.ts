import assert from "node:assert/strict";
import { getServiceCalendarDate, getServiceDateString } from "../lib/service-date";

// The reported production failure occurs when the Node process runs in UTC.
process.env.TZ = "UTC";

const issueScenario = new Date("2026-11-23T20:30:00.000Z");
assert.equal(getServiceDateString(issueScenario), "2026-11-24");
assert.equal(
  getServiceCalendarDate(issueScenario).toISOString(),
  "2026-11-24T00:00:00.000Z",
);

const lastMinuteOfServiceDate = new Date("2026-11-24T18:29:59.999Z");
assert.equal(getServiceDateString(lastMinuteOfServiceDate), "2026-11-24");
assert.equal(
  getServiceDateString(new Date("2026-11-24T18:30:00.000Z")),
  "2026-11-25",
);
assert.equal(getServiceDateString(issueScenario, 1), "2026-11-25");

console.log("IST service-date regression cases passed.");
