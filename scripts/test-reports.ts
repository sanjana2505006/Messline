import assert from "node:assert/strict";
import { BookingStatus } from "@prisma/client";
import {
  calculateConsumptionMetrics,
  calculateRevenueMetrics,
  toInputDate,
  buildCSV,
  escapeCSVField,
} from "../lib/reports";

console.log("Running reconciliation & audit tests for meal consumption & revenue reports...");

const cutoffAt = new Date("2026-04-10T10:00:00.000Z");
const beforeCutoff = new Date("2026-04-10T09:00:00.000Z");
const afterCutoff = new Date("2026-04-10T11:00:00.000Z");

// 1. Seed bookings across served, no-show, pre-cutoff cancel, post-cutoff cancel, and active booked
const bookings = [
  // 3 plates active booked
  { count: 3, status: BookingStatus.BOOKED, updatedAt: beforeCutoff },
  // 2 plates served
  { count: 2, status: BookingStatus.SERVED, updatedAt: afterCutoff },
  // 1 plate no-show
  { count: 1, status: BookingStatus.NO_SHOW, updatedAt: afterCutoff },
  // 1 plate cancelled BEFORE cutoff (kitchen does not prepare, not charged)
  { count: 1, status: BookingStatus.CANCELLED, updatedAt: beforeCutoff },
  // 2 plates cancelled AFTER cutoff (kitchen has already prepared, counted as cooked & wasted)
  { count: 2, status: BookingStatus.CANCELLED, updatedAt: afterCutoff },
];

console.log("Testing calculateConsumptionMetrics...");
const consumption = calculateConsumptionMetrics(bookings, cutoffAt);

// Verification:
// Total cooked = 3 (active) + 2 (served) + 1 (no-show) + 2 (cancelled post-cutoff) = 8
assert.equal(consumption.totalCooked, 8, "Total cooked must include active, served, no-show, and post-cutoff cancelled");
assert.equal(consumption.served, 2, "Served plates must match");
assert.equal(consumption.noShow, 1, "No-show plates must match");
assert.equal(consumption.cancelledPreCutoff, 1, "Pre-cutoff cancelled must match");
assert.equal(consumption.cancelledPostCutoff, 2, "Post-cutoff cancelled must match");

// Wastage = 1 (no-show) + 2 (post-cutoff cancelled) = 3
assert.equal(consumption.wastageCount, 3, "Wastage must equal no-show + post-cutoff cancelled");
// Wastage % = round(3 / 8 * 100) = 38%
assert.equal(consumption.wastagePercent, 38, "Wastage percentage must be correctly rounded");

console.log("✓ Consumption metrics match expected audit numbers.");

// 2. Extra dish revenue calculations
console.log("Testing calculateRevenueMetrics...");
const priceRupees = 50;
const revenue = calculateRevenueMetrics(bookings, cutoffAt, priceRupees);

// Sold count = 3 (booked) + 2 (served) + 1 (no-show) + 2 (post-cutoff cancelled) = 8
assert.equal(revenue.totalSold, 8, "Total sold must equal 8 plates");
assert.equal(revenue.servedCount, 2, "Served count must equal 2");
assert.equal(revenue.noShowCount, 1, "No show count must equal 1");

// Revenue calculations:
// Total revenue = 8 * 50 = 400
assert.equal(revenue.totalRevenueRupees, 400, "Total revenue must be 8 * 50 = 400");
// Served revenue = 2 * 50 = 100
assert.equal(revenue.servedRevenueRupees, 100, "Served revenue must be 2 * 50 = 100");
// No-show / post-cutoff revenue = (1 + 2) * 50 = 150
assert.equal(revenue.noShowRevenueRupees, 150, "No-show + post-cutoff cancellation revenue must be 150");

console.log("✓ Revenue metrics match expected audit numbers.");

// 3. Edge Cases
console.log("Testing edge cases...");
const emptyConsumption = calculateConsumptionMetrics([], cutoffAt);
assert.equal(emptyConsumption.totalCooked, 0);
assert.equal(emptyConsumption.wastageCount, 0);
assert.equal(emptyConsumption.wastagePercent, 0, "Empty bookings yield 0% wastage");

const allServed = calculateConsumptionMetrics(
  [{ count: 5, status: BookingStatus.SERVED, updatedAt: afterCutoff }],
  cutoffAt
);
assert.equal(allServed.totalCooked, 5);
assert.equal(allServed.wastageCount, 0);
assert.equal(allServed.wastagePercent, 0, "All served yields 0% wastage");

const allWasted = calculateConsumptionMetrics(
  [
    { count: 3, status: BookingStatus.NO_SHOW, updatedAt: afterCutoff },
    { count: 2, status: BookingStatus.CANCELLED, updatedAt: afterCutoff },
  ],
  cutoffAt
);
assert.equal(allWasted.totalCooked, 5);
assert.equal(allWasted.wastageCount, 5);
assert.equal(allWasted.wastagePercent, 100, "All no-show / post-cutoff yields 100% wastage");

// 4. CSV Escaping & Header generation
console.log("Testing CSV builder and date formatting...");
assert.equal(escapeCSVField('Test "Special" Dish'), '"Test ""Special"" Dish"');
assert.equal(escapeCSVField("Dish, with comma"), '"Dish, with comma"');
assert.equal(escapeCSVField("NormalDish"), "NormalDish");

const csvResult = buildCSV(["Name", "Count"], [["Biryani", 10], ['Kheer, "Sweet"', 5]]);
assert.equal(
  csvResult,
  'Name,Count\nBiryani,10\n"Kheer, ""Sweet""",5'
);

const d = new Date(Date.UTC(2026, 3, 15)); // 2026-04-15
assert.equal(toInputDate(d), "2026-04-15");

console.log("✓ All report audit, calculation, and CSV checks passed successfully.");
