import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import {
  DEFAULT_REBATE_POLICY,
  DAY_MS,
  IST_OFFSET_MS,
  policySchema,
  qualifyAbsence,
  RebateError,
  statementMonth,
} from "./rebate-policy";
export { RebateError } from "./rebate-policy";
type Tx = Prisma.TransactionClient;
async function requireRole(tx: Tx, id: string, role: "STUDENT" | "SECRETARY") {
  const actor = await tx.user.findUnique({
    where: { id },
    select: { role: true },
  });
  if (actor?.role !== role)
    throw new RebateError("Not authorized for this operation.");
}
export async function lockRebateStudent(tx: Tx, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`absence:${id}`},0))`;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(object[key]))
      .join(",") +
    "}"
  );
}
export function hashRebateAudit(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
async function audit(
  tx: Tx,
  rebateId: string,
  actorId: string,
  action: string,
  details: Prisma.InputJsonObject,
) {
  const previous = await tx.rebateAudit.findFirst({
    where: { rebateId },
    orderBy: { sequence: "desc" },
  });
  const sequence = (previous?.sequence ?? 0) + 1;
  const createdAt = new Date();
  const previousHash = previous?.auditHash ?? null;
  const auditHash = hashRebateAudit({
    rebateId,
    sequence,
    actorId,
    action,
    details,
    previousHash,
    createdAt: createdAt.toISOString(),
  });
  return tx.rebateAudit.create({
    data: {
      rebateId,
      sequence,
      actorId,
      action,
      details,
      previousHash,
      auditHash,
      createdAt,
    },
  });
}
export async function getRebatePolicy() {
  return (
    (await prisma.rebatePolicy.findUnique({ where: { id: "single-mess" } })) ??
    DEFAULT_REBATE_POLICY
  );
}
export async function updateRebatePolicy(actorId: string, input: unknown) {
  const policy = policySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireRole(tx, actorId, "SECRETARY");
    // A stable advisory key serializes first creation and edits with applications.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('absence-policy',0))`;
    const current = await tx.rebatePolicy.findUnique({
      where: { id: "single-mess" },
    });
    if (policy.version !== (current?.version ?? 1))
      throw new RebateError("Policy changed. Reload before saving.");
    return tx.rebatePolicy.upsert({
      where: { id: "single-mess" },
      create: { id: "single-mess", ...policy, version: policy.version + 1 },
      update: { ...policy, version: policy.version + 1 },
    });
  });
}
export async function applyForRebate(
  studentId: string,
  input: unknown,
  now = new Date(),
) {
  const value = z
    .object({
      start: z.string(),
      end: z.string(),
      reason: z.string().trim().min(3).max(500),
    })
    .parse(input);
  return prisma.$transaction(async (tx) => {
    await requireRole(tx, studentId, "STUDENT");
    await lockRebateStudent(tx, studentId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('absence-policy',0))`;
    const policy =
      (await tx.rebatePolicy.findUnique({ where: { id: "single-mess" } })) ??
      DEFAULT_REBATE_POLICY;
    const qualified = qualifyAbsence(value.start, value.end, policy, now);
    const overlap = await tx.absenceRebate.findFirst({
      where: {
        studentId,
        status: { in: ["PENDING", "APPROVED", "SETTLED"] },
        startDate: { lte: qualified.endDate },
        endDate: { gte: qualified.startDate },
      },
    });
    if (overlap)
      throw new RebateError(
        "An active application already covers part of these dates.",
      );
    const request = await tx.absenceRebate.create({
      data: { studentId, ...qualified, reason: value.reason, createdAt: now },
    });
    await audit(tx, request.id, studentId, "APPLIED", {
      start: value.start,
      end: value.end,
      policyVersion: policy.version,
      estimatedPaise: qualified.estimatedPaise,
    });
    return request;
  });
}
export async function decideRebate(
  actorId: string,
  rebateId: string,
  decision: "APPROVED" | "REJECTED",
  reason: string,
) {
  if (!["APPROVED", "REJECTED"].includes(decision))
    throw new RebateError("Invalid decision.");
  const note = z.string().trim().min(3).max(500).parse(reason);
  return prisma.$transaction(async (tx) => {
    await requireRole(tx, actorId, "SECRETARY");
    await tx.$queryRaw`SELECT id FROM "AbsenceRebate" WHERE id=${rebateId} FOR UPDATE`;
    const request = await tx.absenceRebate.findUnique({
      where: { id: rebateId },
    });
    if (!request || request.status !== "PENDING")
      throw new RebateError("Only pending applications can be decided.");
    const updated = await tx.absenceRebate.update({
      where: { id: rebateId },
      data: {
        status: decision,
        decisionReason: note,
        approvedById: actorId,
        decidedAt: new Date(),
      },
    });
    await audit(tx, rebateId, actorId, decision, { reason: note });
    return updated;
  });
}
export async function settleRebate(
  actorId: string,
  rebateId: string,
  now = new Date(),
) {
  return prisma.$transaction(
    async (tx) => {
      await requireRole(tx, actorId, "SECRETARY");
      const initial = await tx.absenceRebate.findUnique({
        where: { id: rebateId },
      });
      if (!initial) throw new RebateError("Application not found.");
      await lockRebateStudent(tx, initial.studentId);
      await tx.$queryRaw`SELECT id FROM "AbsenceRebate" WHERE id=${rebateId} FOR UPDATE`;
      const request = await tx.absenceRebate.findUniqueOrThrow({
        where: { id: rebateId },
      });
      if (request.status === "SETTLED")
        return tx.rebateLedger.findUniqueOrThrow({ where: { rebateId } });
      if (request.status !== "APPROVED")
        throw new RebateError("Only approved applications can be settled.");
      if (+now < +request.endDate + DAY_MS - IST_OFFSET_MS)
        throw new RebateError(
          "Settle only after the last absence day ends in IST.",
        );
      const policy = policySchema.parse(request.policySnapshot);
      const bookings = await tx.booking.findMany({
        where: {
          userId: request.studentId,
          offering: {
            menuItem: { included: true },
            service: {
              serviceDate: { gte: request.startDate, lte: request.endDate },
            },
          },
        },
        include: { offering: { include: { service: true } } },
        orderBy: { id: "asc" },
      });
      const excluded = new Set(
        bookings
          .filter(
            (b) =>
              b.status !== "CANCELLED" ||
              b.updatedAt >= b.offering.service.cutoffAt,
          )
          .map(
            (b) =>
              `${b.offering.service.serviceDate.toISOString().slice(0, 10)}:${b.offering.service.meal}`,
          ),
      );
      const lines: Array<{
        date: string;
        meal: string;
        amountPaise: number;
        excluded: boolean;
      }> = [];
      const rates = {
        BREAKFAST: policy.breakfastPaise,
        LUNCH: policy.lunchPaise,
        DINNER: policy.dinnerPaise,
      };
      for (
        let date = +request.startDate;
        date <= +request.endDate;
        date += DAY_MS
      ) {
        for (const [meal, rate] of Object.entries(rates)) {
          const day = new Date(date).toISOString().slice(0, 10),
            skip = excluded.has(`${day}:${meal}`);
          lines.push({
            date: day,
            meal,
            amountPaise: skip ? 0 : rate,
            excluded: skip,
          });
        }
      }
      const amountPaise = lines.reduce(
        (sum, line) => sum + line.amountPaise,
        0,
      );
      const record = await audit(tx, rebateId, actorId, "SETTLED", {
        amountPaise,
        lines,
        bookingIds: bookings.map((b) => b.id),
      });
      const ledger = await tx.rebateLedger.create({
        data: {
          rebateId,
          studentId: request.studentId,
          amountPaise,
          details: { lines, policyVersion: policy.version },
          auditHash: record.auditHash,
          createdAt: now,
          bookings: { connect: bookings.map((b) => ({ id: b.id })) },
        },
      });
      await tx.absenceRebate.update({
        where: { id: rebateId },
        data: { status: "SETTLED" },
      });
      return ledger;
    },
    { timeout: 15000 },
  );
}
export async function getRebateStatement(actorId: string, month?: string) {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (actor?.role !== "SECRETARY")
    throw new RebateError("Not authorized for statements.");
  const range = statementMonth(month);
  const entries = await prisma.rebateLedger.findMany({
    where: { createdAt: { gte: range.start, lt: range.end } },
    include: {
      student: { select: { name: true } },
      rebate: { select: { startDate: true, endDate: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 10001,
  });
  if (entries.length > 10000)
    throw new RebateError(
      "This statement is too large. Contact the maintainer for a paginated export.",
    );
  return {
    ...range,
    entries,
    totalPaise: entries.reduce((sum, e) => sum + e.amountPaise, 0),
  };
}
