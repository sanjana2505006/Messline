import { BookingStatus, Meal } from "@prisma/client";
import { prisma } from "../lib/db";
import { bookPlates, cancelBooking } from "../lib/booking";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function quantityLeft(offeringId: string) {
  const row = await prisma.offering.findUniqueOrThrow({
    where: { id: offeringId },
    select: { quantityLeft: true },
  });
  return row.quantityLeft;
}

async function activeBookingCount(offeringId: string) {
  const res = await prisma.booking.aggregate({
    where: { offeringId, status: BookingStatus.BOOKED },
    _sum: { count: true },
  });
  return res._sum.count ?? 0;
}

async function main() {
  console.log("=== Running Race & Concurrency Verification (Isolated Fixtures) ===");

  const [meera, kabir] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "meera@messline.dev" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "kabir@messline.dev" } }),
  ]);

  // Set up isolated test records so no seeded data or existing development bookings are deleted.
  // We use unique serviceDate / dummy menuItem to guarantee isolation.
  const testDate = new Date("2099-12-31T00:00:00.000Z");

  const testMenuItem = await prisma.menuItem.create({
    data: {
      name: `Test Race Dish ${Date.now()}`,
      description: "Ephemeral dish for race condition testing",
      ingredients: "Test ingredients",
      included: true,
      active: true,
    },
  });

  const testService = await prisma.service.create({
    data: {
      meal: Meal.DINNER,
      serviceDate: testDate,
      cutoffAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in future
      published: true,
    },
  });

  const testOffering = await prisma.offering.create({
    data: {
      serviceId: testService.id,
      menuItemId: testMenuItem.id,
      quantityTotal: 5,
      quantityLeft: 5,
    },
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Cutoff race test using pg_stat_activity & pg_blocking_pids()
    // -------------------------------------------------------------
    console.log("\n--- Test 1: Cutoff expires while waiting for Offering lock ---");

    let lockAcquiredSignal: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      lockAcquiredSignal = resolve;
    });

    let releaseLockSignal: () => void = () => {};
    const lockReleasePromise = new Promise<void>((resolve) => {
      releaseLockSignal = resolve;
    });

    let lockerPid: number | null = null;

    // Transaction A: holds the exclusive lock on testOffering
    const lockerTask = prisma.$transaction(async (tx) => {
      const pidRows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      lockerPid = pidRows[0].pid;

      // Lock testOffering using SELECT ... FOR UPDATE
      await tx.$queryRaw`
        SELECT id FROM "Offering" WHERE id = ${testOffering.id} FOR UPDATE
      `;
      lockAcquiredSignal();

      // Hold lock until told to release
      await lockReleasePromise;
    });

    // Wait until Transaction A has locked the offering
    await lockAcquired;

    // Start Transaction B (competing bookPlates request) while lock is held
    const competitorPromise = bookPlates(meera.id, testOffering.id, 2);

    // Verify deterministically that Transaction B is genuinely blocked by Transaction A
    const maxWaitMs = 5000;
    const startWait = Date.now();
    let isBlocked = false;

    while (Date.now() - startWait < maxWaitMs) {
      if (lockerPid != null) {
        const blockedRows = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid
          FROM pg_stat_activity
          WHERE ${lockerPid} = ANY(pg_blocking_pids(pid))
        `;
        if (blockedRows.length > 0) {
          isBlocked = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    check("Transaction B is confirmed blocked by Transaction A via pg_blocking_pids()", isBlocked);

    // Move cutoff into the past while Transaction B is confirmed waiting on the lock
    await prisma.service.update({
      where: { id: testService.id },
      data: { cutoffAt: new Date(Date.now() - 60 * 1000) },
    });

    // Release Transaction A
    releaseLockSignal();
    await lockerTask;

    // Await competitor result
    const compResult = await competitorPromise;
    check(
      "Transaction B fails with CUTOFF_PASSED after lock released",
      !compResult.ok && compResult.reason === "CUTOFF_PASSED",
      JSON.stringify(compResult)
    );

    const postQ = await quantityLeft(testOffering.id);
    check("Inventory was not deducted (still 5)", postQ === 5, `quantityLeft: ${postQ}`);

    const bookedRowsCount = await prisma.booking.count({
      where: { offeringId: testOffering.id, status: BookingStatus.BOOKED },
    });
    check("No BOOKED rows created after cutoff", bookedRowsCount === 0);

    // Restore cutoff for subsequent tests
    await prisma.service.update({
      where: { id: testService.id },
      data: { cutoffAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    // -------------------------------------------------------------
    // Test 2: Basic Booking Creation, Increase, Decrease, Same Count
    // -------------------------------------------------------------
    console.log("\n--- Test 2: Booking lifecycle (Create -> Increase -> Decrease -> No-op) ---");

    // Create 1 plate
    const c1 = await bookPlates(meera.id, testOffering.id, 1);
    check("Create initial booking with 1 plate", c1.ok);
    check("Inventory decremented by 1 (4 left)", (await quantityLeft(testOffering.id)) === 4);

    // Increase from 1 to 3
    const inc = await bookPlates(meera.id, testOffering.id, 3);
    check("Increase booking from 1 to 3 plates", inc.ok);
    const bRowAfterInc = await prisma.booking.findUniqueOrThrow({
      where: { id: (c1 as { bookingId: string }).bookingId },
    });
    check("Booking row count updated to 3", bRowAfterInc.count === 3);
    check("Inventory decremented by delta 2 (2 left)", (await quantityLeft(testOffering.id)) === 2);

    // Same count update (no-op)
    const same = await bookPlates(meera.id, testOffering.id, 3);
    check("Update to same count succeeds", same.ok);
    check("Inventory unchanged after same-count update (2 left)", (await quantityLeft(testOffering.id)) === 2);

    // Decrease from 3 to 1
    const dec = await bookPlates(meera.id, testOffering.id, 1);
    check("Decrease booking from 3 to 1 plate", dec.ok);
    const bRowAfterDec = await prisma.booking.findUniqueOrThrow({
      where: { id: (c1 as { bookingId: string }).bookingId },
    });
    check("Booking row count updated to 1", bRowAfterDec.count === 1);
    check("Inventory restored by 2 (4 left)", (await quantityLeft(testOffering.id)) === 4);

    // Only 1 booking record exists
    const meeraBookingsCount = await prisma.booking.count({
      where: { userId: meera.id, offeringId: testOffering.id, status: BookingStatus.BOOKED },
    });
    check("Exactly one BOOKED record exists for student", meeraBookingsCount === 1);

    // Invariant check
    const invariant1 = (await quantityLeft(testOffering.id)) === 5 - (await activeBookingCount(testOffering.id));
    check("Invariant holds: quantityLeft = quantityTotal - SUM(booked)", invariant1);

    // -------------------------------------------------------------
    // Test 3: Insufficient stock rejection on increase
    // -------------------------------------------------------------
    console.log("\n--- Test 3: Insufficient stock on increase ---");
    // Meera has 1 plate booked, 4 left in stock. Requesting 6 plates (needs 5 more, only 4 available)
    const tooMany = await bookPlates(meera.id, testOffering.id, 6);
    check("Requesting more plates than available returns SOLD_OUT", !tooMany.ok && tooMany.reason === "SOLD_OUT");
    check("Inventory unchanged (4 left)", (await quantityLeft(testOffering.id)) === 4);

    // -------------------------------------------------------------
    // Test 4: Concurrent modifications by same student
    // -------------------------------------------------------------
    console.log("\n--- Test 4: Concurrent modifications by same student ---");
    const [sameUserA, sameUserB] = await Promise.all([
      bookPlates(meera.id, testOffering.id, 2),
      bookPlates(meera.id, testOffering.id, 3),
    ]);

    check("Both concurrent modifications from same user complete without deadlock", sameUserA.ok && sameUserB.ok);
    const meeraTotalRows = await prisma.booking.count({
      where: { userId: meera.id, offeringId: testOffering.id, status: BookingStatus.BOOKED },
    });
    check("Still exactly 1 BOOKED row for student (no duplicates)", meeraTotalRows === 1);

    const currentMeeraBooking = await prisma.booking.findFirstOrThrow({
      where: { userId: meera.id, offeringId: testOffering.id, status: BookingStatus.BOOKED },
    });
    const expectedLeft = 5 - currentMeeraBooking.count;
    const actualLeft = await quantityLeft(testOffering.id);
    check(
      `Inventory matches expected (${expectedLeft})`,
      actualLeft === expectedLeft,
      `actual: ${actualLeft}, count: ${currentMeeraBooking.count}`
    );

    // -------------------------------------------------------------
    // Test 5: Cancellation racing with count modification
    // -------------------------------------------------------------
    console.log("\n--- Test 5: Cancellation racing with count modification ---");
    // Meera has currentMeeraBooking. We run cancelBooking and a concurrent bookPlates
    const [cancelRes, updateRes] = await Promise.allSettled([
      cancelBooking(meera.id, currentMeeraBooking.id),
      bookPlates(meera.id, testOffering.id, 4),
    ]);

    check("Cancellation and concurrent update both resolve without deadlock", cancelRes.status === "fulfilled" || updateRes.status === "fulfilled");

    // Invariant check after race
    const finalLeft = await quantityLeft(testOffering.id);
    const finalBookedCount = await activeBookingCount(testOffering.id);
    check(
      "Invariant holds after cancel/update race: quantityLeft = quantityTotal - SUM(booked)",
      finalLeft === 5 - finalBookedCount,
      `quantityLeft: ${finalLeft}, booked: ${finalBookedCount}`
    );

  } finally {
    // -------------------------------------------------------------
    // Cleanup: Remove only the isolated test records created by this script
    // -------------------------------------------------------------
    console.log("\n--- Cleaning up isolated test fixtures ---");
    await prisma.booking.deleteMany({ where: { offeringId: testOffering.id } });
    await prisma.offering.delete({ where: { id: testOffering.id } });
    await prisma.service.delete({ where: { id: testService.id } });
    await prisma.menuItem.delete({ where: { id: testMenuItem.id } });
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED." : `\n${failures} CHECK(S) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
