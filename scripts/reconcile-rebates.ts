import { prisma } from "../lib/db";
import { settleRebate } from "../lib/rebates";
async function main() {
  const actor = process.env.REBATE_SECRETARY_ID;
  if (!actor)
    throw new Error(
      "Set REBATE_SECRETARY_ID to an existing secretary account.",
    );
  const ready = await prisma.absenceRebate.findMany({
    where: { status: "APPROVED" },
    orderBy: { id: "asc" },
    take: 1000,
  });
  let posted = 0,
    waiting = 0;
  for (const request of ready) {
    try {
      await settleRebate(actor, request.id);
      posted++;
    } catch (error) {
      waiting++;
      console.error(
        request.id,
        error instanceof Error ? error.message : "Settlement failed",
      );
    }
  }
  console.log({ posted, waiting });
  if (waiting) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
