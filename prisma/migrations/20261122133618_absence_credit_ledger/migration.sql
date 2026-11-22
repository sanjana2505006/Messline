-- CreateEnum
CREATE TYPE "RebateStatus" AS ENUM ('PENDING', 'APPROVED', 'SETTLED', 'REJECTED');

-- CreateTable
CREATE TABLE "RebatePolicy" (
    "id" TEXT NOT NULL DEFAULT 'single-mess',
    "version" INTEGER NOT NULL DEFAULT 1,
    "minimumDays" INTEGER NOT NULL DEFAULT 2,
    "noticeHours" INTEGER NOT NULL DEFAULT 24,
    "breakfastPaise" INTEGER NOT NULL DEFAULT 0,
    "lunchPaise" INTEGER NOT NULL DEFAULT 0,
    "dinnerPaise" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebatePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceRebate" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "qualifyingDays" INTEGER NOT NULL,
    "estimatedPaise" INTEGER NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "status" "RebateStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "decisionReason" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AbsenceRebate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebateLedger" (
    "id" TEXT NOT NULL,
    "rebateId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "auditHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RebateLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebateAudit" (
    "id" TEXT NOT NULL,
    "rebateId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "previousHash" TEXT,
    "auditHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RebateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BookingToRebateLedger" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "AbsenceRebate_studentId_startDate_endDate_idx" ON "AbsenceRebate"("studentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "AbsenceRebate_status_createdAt_idx" ON "AbsenceRebate"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RebateLedger_rebateId_key" ON "RebateLedger"("rebateId");

-- CreateIndex
CREATE INDEX "RebateLedger_createdAt_studentId_idx" ON "RebateLedger"("createdAt", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "RebateAudit_auditHash_key" ON "RebateAudit"("auditHash");

-- CreateIndex
CREATE UNIQUE INDEX "RebateAudit_rebateId_sequence_key" ON "RebateAudit"("rebateId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "_BookingToRebateLedger_AB_unique" ON "_BookingToRebateLedger"("A", "B");

-- CreateIndex
CREATE INDEX "_BookingToRebateLedger_B_index" ON "_BookingToRebateLedger"("B");

-- AddForeignKey
ALTER TABLE "AbsenceRebate" ADD CONSTRAINT "AbsenceRebate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRebate" ADD CONSTRAINT "AbsenceRebate_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebateLedger" ADD CONSTRAINT "RebateLedger_rebateId_fkey" FOREIGN KEY ("rebateId") REFERENCES "AbsenceRebate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebateLedger" ADD CONSTRAINT "RebateLedger_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebateAudit" ADD CONSTRAINT "RebateAudit_rebateId_fkey" FOREIGN KEY ("rebateId") REFERENCES "AbsenceRebate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebateAudit" ADD CONSTRAINT "RebateAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingToRebateLedger" ADD CONSTRAINT "_BookingToRebateLedger_A_fkey" FOREIGN KEY ("A") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BookingToRebateLedger" ADD CONSTRAINT "_BookingToRebateLedger_B_fkey" FOREIGN KEY ("B") REFERENCES "RebateLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Financial history is append-only. Corrections require a reviewed compensating design.
CREATE FUNCTION reject_rebate_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rebate financial history is immutable';
END;
$$;
CREATE TRIGGER rebate_ledger_immutable BEFORE UPDATE OR DELETE ON "RebateLedger"
FOR EACH ROW EXECUTE FUNCTION reject_rebate_history_mutation();
CREATE TRIGGER rebate_audit_immutable BEFORE UPDATE OR DELETE ON "RebateAudit"
FOR EACH ROW EXECUTE FUNCTION reject_rebate_history_mutation();
ALTER TABLE "RebatePolicy" ADD CONSTRAINT rebate_policy_bounds CHECK (
 id='single-mess' AND version>=1 AND "minimumDays" BETWEEN 1 AND 31 AND "noticeHours" BETWEEN 0 AND 720
 AND "breakfastPaise" BETWEEN 0 AND 100000 AND "lunchPaise" BETWEEN 0 AND 100000 AND "dinnerPaise" BETWEEN 0 AND 100000);
ALTER TABLE "AbsenceRebate" ADD CONSTRAINT rebate_date_bounds CHECK (
 "endDate">="startDate" AND "qualifyingDays" BETWEEN 1 AND 31
 AND "qualifyingDays"=("endDate"-"startDate"+1) AND "estimatedPaise" BETWEEN 0 AND 9300000);
ALTER TABLE "RebateLedger" ADD CONSTRAINT rebate_amount_bounds CHECK ("amountPaise" BETWEEN 0 AND 9300000);
ALTER TABLE "RebateAudit" ADD CONSTRAINT rebate_audit_sequence CHECK (sequence>0);
