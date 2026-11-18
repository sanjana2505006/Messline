import { BookingStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";

const countSchema = z.number().int().positive();

export type BookingFailure =
  | "INVALID_COUNT"
  | "NOT_FOUND"
  | "NOT_PUBLISHED"
  | "CUTOFF_PASSED"
  | "ALREADY_BOOKED"
  | "SOLD_OUT";

export type BookPlatesResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: BookingFailure };

// Thrown inside the transaction so Prisma rolls everything back.
class BookingError extends Error {
  constructor(public reason: BookingFailure) {
    super(reason);
  }
}

export async function bookPlates(
  userId: string,
  offeringId: string,
  count: number
): Promise<BookPlatesResult> {
  const parsed = countSchema.safeParse(count);
  if (!parsed.success) return { ok: false, reason: "INVALID_COUNT" };
  const plates = parsed.data;

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // 1. Acquire an exclusive row lock on the Offering inside the interactive transaction.
      // Any competing transaction attempting to book or modify this offering will wait here.
      const lockedOffering = await tx.$queryRaw<
        Array<{
          id: string;
          serviceId: string;
          quantityTotal: number;
          quantityLeft: number;
        }>
      >`
        SELECT id, "serviceId", "quantityTotal", "quantityLeft"
        FROM "Offering"
        WHERE id = ${offeringId}
        FOR UPDATE
      `;

      if (lockedOffering.length === 0) throw new BookingError("NOT_FOUND");
      const offering = lockedOffering[0];

      // 2. Once the lock is acquired, execute a separate database query to check the service
      // status and evaluate cutoff against PostgreSQL clock_timestamp() (the actual current
      // database wall-clock time), NOT NOW() (which is fixed at transaction start).
      const serviceCheck = await tx.$queryRaw<
        Array<{
          published: boolean;
          is_open: boolean;
        }>
      >`
        SELECT
          published,
          (clock_timestamp() < "cutoffAt") AS is_open
        FROM "Service"
        WHERE id = ${offering.serviceId}
      `;

      if (serviceCheck.length === 0) throw new BookingError("NOT_FOUND");
      const service = serviceCheck[0];

      if (!service.published) throw new BookingError("NOT_PUBLISHED");
      if (!service.is_open) throw new BookingError("CUTOFF_PASSED");

      // 3. Check for an existing BOOKED record for this user and offering.
      // Since the offering row is locked, concurrent transactions for the same student & offering
      // serialize here and observe the committed state.
      const existing = await tx.booking.findFirst({
        where: { userId, offeringId, status: BookingStatus.BOOKED },
        select: { id: true, count: true },
      });

      if (!existing) {
        // A. New booking:
        // Conditional decrement: UPDATE Offering SET quantityLeft = quantityLeft - plates WHERE id = offeringId AND quantityLeft >= plates
        const updated = await tx.offering.updateMany({
          where: { id: offeringId, quantityLeft: { gte: plates } },
          data: { quantityLeft: { decrement: plates } },
        });
        if (updated.count === 0) throw new BookingError("SOLD_OUT");

        return tx.booking.create({
          data: { userId, offeringId, count: plates, status: BookingStatus.BOOKED },
          select: { id: true },
        });
      }

      // B. Existing booking modification:
      const delta = plates - existing.count;

      if (delta === 0) {
        return existing;
      }

      if (delta > 0) {
        // C. Increasing plate count:
        // Must reserve delta more plates.
        const updated = await tx.offering.updateMany({
          where: { id: offeringId, quantityLeft: { gte: delta } },
          data: { quantityLeft: { decrement: delta } },
        });
        if (updated.count === 0) throw new BookingError("SOLD_OUT");

        return tx.booking.update({
          where: { id: existing.id },
          data: { count: plates },
          select: { id: true },
        });
      } else {
        // D. Decreasing plate count (delta < 0):
        // Release plates back to inventory, capped at quantityTotal using PostgreSQL LEAST().
        const releaseCount = Math.abs(delta);
        await tx.$executeRaw`
          UPDATE "Offering"
          SET "quantityLeft" = LEAST("quantityLeft" + ${releaseCount}, "quantityTotal")
          WHERE id = ${offeringId}
        `;

        return tx.booking.update({
          where: { id: existing.id },
          data: { count: plates },
          select: { id: true },
        });
      }
    });

    return { ok: true, bookingId: booking.id };
  } catch (err) {
    if (err instanceof BookingError) return { ok: false, reason: err.reason };
    throw err; // real errors (DB down, etc.) are not a failed booking
  }
}

export type CancelBookingErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_BOOKED";

export class CancelBookingError extends Error {
  code: CancelBookingErrorCode;

  constructor(code: CancelBookingErrorCode, message: string) {
    super(message);
    this.name = "CancelBookingError";
    this.code = code;
  }
}

const cancelInput = z.object({
  userId: z.string().min(1),
  bookingId: z.string().min(1),
});

export type CancelBookingResult = {
  bookingId: string;
  // true when the plates went back into quantityLeft (cancelled before cutoffAt)
  restocked: boolean;
  quantityLeft: number;
};

/**
 * Cancel a booking, following the Cancel section of docs/rules.md.
 *
 * - Only the student who made the booking can cancel it.
 * - Only a BOOKED row can be cancelled.
 * - Before cutoffAt: status becomes CANCELLED and quantityLeft goes up by
 *   count, capped at quantityTotal.
 * - At or after cutoffAt: status becomes CANCELLED and quantityLeft does not
 *   change, because the kitchen already cooked for that count.
 *
 * The status change and the stock change run in one transaction.
 */
export async function cancelBooking(
  userId: string,
  bookingId: string,
): Promise<CancelBookingResult> {
  const parsed = cancelInput.safeParse({ userId, bookingId });
  if (!parsed.success) {
    throw new CancelBookingError(
      "INVALID_INPUT",
      "userId and bookingId are required.",
    );
  }

  return prisma.$transaction(async (tx) => {
    // 1. First locate the booking to find the associated offeringId.
    const booking = await tx.booking.findUnique({
      where: { id: parsed.data.bookingId },
      select: { id: true, userId: true, offeringId: true, status: true, count: true },
    });

    // Same error for "missing" and "someone else's", so ids can't be probed.
    if (!booking || booking.userId !== parsed.data.userId) {
      throw new CancelBookingError("NOT_FOUND", "Booking not found.");
    }

    if (booking.status !== BookingStatus.BOOKED) {
      throw new CancelBookingError(
        "NOT_BOOKED",
        "Only a booking that is still BOOKED can be cancelled.",
      );
    }

    // 2. Lock the Offering row first to ensure consistent lock acquisition order
    // across both bookPlates() and cancelBooking() (Offering -> Booking/Inventory).
    const lockedOffering = await tx.$queryRaw<
      Array<{
        id: string;
        serviceId: string;
        quantityTotal: number;
        quantityLeft: number;
      }>
    >`
      SELECT id, "serviceId", "quantityTotal", "quantityLeft"
      FROM "Offering"
      WHERE id = ${booking.offeringId}
      FOR UPDATE
    `;

    if (lockedOffering.length === 0) {
      throw new CancelBookingError("NOT_FOUND", "Offering not found.");
    }

    // 3. Atomically check service cutoff using database clock_timestamp() post-lock.
    const serviceCheck = await tx.$queryRaw<
      Array<{
        is_before_cutoff: boolean;
      }>
    >`
      SELECT
        (clock_timestamp() < "cutoffAt") AS is_before_cutoff
      FROM "Service"
      WHERE id = ${lockedOffering[0].serviceId}
    `;

    const beforeCutoff = serviceCheck.length > 0 && serviceCheck[0].is_before_cutoff;

    // 4. Update the booking status and obtain the latest count after acquiring the Offering lock.
    // We execute a conditional UPDATE on Booking conditioned on status = 'BOOKED' that returns
    // the actual count from the row transitioned. This ensures that if a concurrent bookPlates()
    // modified the plate count before the Offering lock was acquired, the cancellation releases
    // exactly the latest count rather than a stale pre-lock value.
    const transitioned = await tx.$queryRaw<
      Array<{
        id: string;
        count: number;
      }>
    >`
      UPDATE "Booking"
      SET "status" = 'CANCELLED'::"BookingStatus", "updatedAt" = clock_timestamp()
      WHERE id = ${booking.id}
        AND "userId" = ${parsed.data.userId}
        AND "status" = 'BOOKED'::"BookingStatus"
      RETURNING id, count
    `;

    if (transitioned.length === 0) {
      throw new CancelBookingError(
        "NOT_BOOKED",
        "Only a booking that is still BOOKED can be cancelled.",
      );
    }

    const latestCount = transitioned[0].count;

    if (beforeCutoff) {
      // LEAST keeps quantityLeft from going past quantityTotal.
      await tx.$executeRaw`
        UPDATE "Offering"
        SET "quantityLeft" = LEAST("quantityLeft" + ${latestCount}, "quantityTotal")
        WHERE id = ${booking.offeringId}
      `;
    }

    const offering = await tx.offering.findUniqueOrThrow({
      where: { id: booking.offeringId },
      select: { quantityLeft: true },
    });

    return {
      bookingId: booking.id,
      restocked: beforeCutoff,
      quantityLeft: offering.quantityLeft,
    };
  });
}