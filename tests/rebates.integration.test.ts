import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const url = process.env.REBATE_TEST_DATABASE_URL;
const marker = process.env.REBATE_TEST_ISOLATION;
if (!url || !marker)
  throw new Error(
    "Use a newly provisioned private database with REBATE_TEST_DATABASE_URL and REBATE_TEST_ISOLATION.",
  );
const parsed = new URL(url);
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/rebates_private_test"
)
  throw new Error(
    "Only the isolated loopback rebates_private_test database is accepted.",
  );
process.env.DATABASE_URL = url;
const db = new PrismaClient({ datasources: { db: { url } } });
let engine: typeof import("../lib/rebates");
let bookings: typeof import("../lib/booking");
const now = new Date("2026-11-19T18:30:00Z"),
  settled = new Date("2026-11-22T18:30:00Z");
let secretary: string;
const rates = {
  version: 1,
  minimumDays: 2,
  noticeHours: 24,
  breakfastPaise: 2000,
  lunchPaise: 4000,
  dinnerPaise: 4000,
};
async function user(
  role: "STUDENT" | "SECRETARY" = "STUDENT",
  prefix = "fixture",
) {
  const id = `${prefix}-${randomUUID()}`;
  await db.user.create({
    data: {
      id,
      name: `Test ${prefix}`,
      email: `${id}@example.invalid`,
      password: "fixture-unused",
      role,
    },
  });
  return id;
}
const application = {
  start: "2026-11-21",
  end: "2026-11-22",
  reason: "Local absence test",
};
before(async () => {
  const rows = await db.$queryRawUnsafe<Array<{ token: string }>>(
    'SELECT token FROM "_RebateTestIsolation"',
  );
  assert.equal(rows[0]?.token, marker, "Database isolation marker mismatch");
  engine = await import("../lib/rebates");
  bookings = await import("../lib/booking");
  secretary = await user("SECRETARY");
  await engine.updateRebatePolicy(secretary, rates);
});
after(async () => {
  await db.$disconnect();
  if (engine) {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  }
});
test("database roles guard application, policy, decisions and statements", async () => {
  const student = await user();
  await assert.rejects(
    engine.applyForRebate(secretary, application, now),
    /authorized/,
  );
  await assert.rejects(
    engine.updateRebatePolicy(student, { ...rates, version: 2 }),
    /authorized/,
  );
  await assert.rejects(
    engine.decideRebate(student, "missing", "APPROVED", "test reason"),
    /authorized/,
  );
  await assert.rejects(
    engine.getRebateStatement(student, "2026-11"),
    /authorized/,
  );
});
test("concurrent overlapping applications produce one request and one applied audit", async () => {
  const student = await user();
  const results = await Promise.allSettled([
    engine.applyForRebate(student, application, now),
    engine.applyForRebate(student, application, now),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rows = await db.absenceRebate.findMany({
    where: { studentId: student },
    include: { audits: true },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].audits.length, 1);
  const decisions = await Promise.allSettled([
    engine.decideRebate(
      secretary,
      rows[0].id,
      "APPROVED",
      "Eligible test leave",
    ),
    engine.decideRebate(
      secretary,
      rows[0].id,
      "REJECTED",
      "Duplicate review test",
    ),
  ]);
  assert.equal(decisions.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await db.rebateAudit.count({ where: { rebateId: rows[0].id } }),
    2,
  );
});
test("request snapshots survive later policy changes and stale edits are rejected", async () => {
  const student = await user();
  const request = await engine.applyForRebate(student, application, now);
  assert.equal(request.estimatedPaise, 20000);
  await engine.updateRebatePolicy(secretary, {
    ...rates,
    version: 2,
    lunchPaise: 9000,
  });
  await assert.rejects(
    engine.updateRebatePolicy(secretary, { ...rates, version: 2 }),
    /changed/,
  );
  assert.equal(
    (await db.absenceRebate.findUniqueOrThrow({ where: { id: request.id } }))
      .estimatedPaise,
    20000,
  );
  await engine.updateRebatePolicy(secretary, { ...rates, version: 3 });
});
test("settlement excludes consumed/late-cancelled included meals, ignores extras, and is concurrency-idempotent", async () => {
  const student = await user();
  async function offering(
    day: string,
    meal: "BREAKFAST" | "LUNCH" | "DINNER",
    included = true,
  ) {
    const service = await db.service.upsert({
      where: {
        meal_serviceDate: { meal, serviceDate: new Date(`${day}T00:00Z`) },
      },
      create: {
        meal,
        serviceDate: new Date(`${day}T00:00Z`),
        cutoffAt: new Date(`${day}T03:00Z`),
        published: true,
      },
      update: {},
    });
    const dish = await db.menuItem.create({
      data: {
        name: "Fixture dish",
        description: "Synthetic",
        ingredients: "rice",
        included,
      },
    });
    return db.offering.create({
      data: {
        serviceId: service.id,
        menuItemId: dish.id,
        quantityTotal: 10,
        quantityLeft: 10,
      },
    });
  }
  const breakfast = await offering("2026-11-21", "BREAKFAST"),
    lunch = await offering("2026-11-21", "LUNCH"),
    extra = await offering("2026-11-21", "DINNER", false),
    early = await offering("2026-11-22", "BREAKFAST"),
    noShow = await offering("2026-11-22", "DINNER");
  await db.booking.createMany({
    data: [
      {
        userId: student,
        offeringId: breakfast.id,
        count: 1,
        status: "CANCELLED",
        updatedAt: new Date("2026-11-21T03:00Z"),
      },
      { userId: student, offeringId: lunch.id, count: 3, status: "SERVED" },
      { userId: student, offeringId: lunch.id, count: 2, status: "SERVED" },
      { userId: student, offeringId: extra.id, count: 1, status: "SERVED" },
      {
        userId: student,
        offeringId: early.id,
        count: 1,
        status: "CANCELLED",
        updatedAt: new Date("2026-11-22T02:59:59Z"),
      },
      { userId: student, offeringId: noShow.id, count: 1, status: "NO_SHOW" },
    ],
  });
  const request = await engine.applyForRebate(student, application, now);
  await engine.decideRebate(
    secretary,
    request.id,
    "APPROVED",
    "Local verified absence",
  );
  assert.deepEqual(await bookings.bookPlates(student, early.id, 1), {
    ok: false,
    reason: "ABSENCE_ACTIVE",
  });
  await assert.rejects(
    engine.settleRebate(secretary, request.id, new Date(+settled - 1)),
    /last absence/,
  );
  const values = await Promise.all([
    engine.settleRebate(secretary, request.id, settled),
    engine.settleRebate(secretary, request.id, settled),
    engine.settleRebate(secretary, request.id, settled),
  ]);
  assert.equal(new Set(values.map((v) => v.id)).size, 1);
  assert.equal(values[0].amountPaise, 10000);
  assert.equal(
    await db.rebateLedger.count({ where: { rebateId: request.id } }),
    1,
  );
  const audits = await db.rebateAudit.findMany({
    where: { rebateId: request.id },
    orderBy: { sequence: "asc" },
  });
  assert.deepEqual(
    audits.map((a) => a.action),
    ["APPLIED", "APPROVED", "SETTLED"],
  );
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    assert.equal(a.previousHash, i ? audits[i - 1].auditHash : null);
    assert.equal(
      a.auditHash,
      engine.hashRebateAudit({
        rebateId: a.rebateId,
        sequence: a.sequence,
        actorId: a.actorId,
        action: a.action,
        details: a.details,
        previousHash: a.previousHash,
        createdAt: a.createdAt.toISOString(),
      }),
    );
  }
  await assert.rejects(
    db.rebateLedger.update({
      where: { id: values[0].id },
      data: { amountPaise: 1 },
    }),
    /immutable/,
  );
  await assert.rejects(
    db.rebateAudit.delete({ where: { id: audits[0].id } }),
    /immutable/,
  );
  const statement = await engine.getRebateStatement(secretary, "2026-11");
  assert.ok(statement.entries.some((e) => e.id === values[0].id));
  assert.equal(
    statement.totalPaise,
    statement.entries.reduce((sum, e) => sum + e.amountPaise, 0),
  );
});
test("ledger insertion failure rolls back the settlement audit and status", async () => {
  const student = await user("STUDENT", "rollback");
  const request = await engine.applyForRebate(student, application, now);
  await engine.decideRebate(
    secretary,
    request.id,
    "APPROVED",
    "Rollback test eligibility",
  );
  await db.$executeRawUnsafe(
    `CREATE FUNCTION rebate_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."studentId" LIKE 'rollback-%' THEN RAISE EXCEPTION 'fixture ledger failure'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER rebate_test_fail BEFORE INSERT ON "RebateLedger" FOR EACH ROW EXECUTE FUNCTION rebate_test_fail()',
  );
  try {
    await assert.rejects(
      engine.settleRebate(secretary, request.id, settled),
      /fixture ledger failure/,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER rebate_test_fail ON "RebateLedger"',
    );
    await db.$executeRawUnsafe("DROP FUNCTION rebate_test_fail()");
  }
  assert.equal(
    (await db.absenceRebate.findUniqueOrThrow({ where: { id: request.id } }))
      .status,
    "APPROVED",
  );
  assert.equal(
    await db.rebateAudit.count({
      where: { rebateId: request.id, action: "SETTLED" },
    }),
    0,
  );
  assert.equal(
    await db.rebateLedger.count({ where: { rebateId: request.id } }),
    0,
  );
});
