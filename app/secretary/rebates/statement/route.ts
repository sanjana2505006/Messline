import { getCurrentUser } from "@/lib/auth";
import { getRebateStatement, RebateError } from "@/lib/rebates";
import { csvCell } from "@/lib/rebate-policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (user.role !== "SECRETARY")
    return new Response("Forbidden", { status: 403 });
  try {
    const statement = await getRebateStatement(
      user.id,
      new URL(request.url).searchParams.get("month") ?? undefined,
    );
    const rows = [
      [
        "Ledger ID",
        "Student",
        "Absence start",
        "Absence end",
        "Credit INR",
        "Posted at UTC",
        "Audit hash",
      ],
      ...statement.entries.map((e) => [
        e.id,
        e.student.name,
        e.rebate.startDate.toISOString().slice(0, 10),
        e.rebate.endDate.toISOString().slice(0, 10),
        (e.amountPaise / 100).toFixed(2),
        e.createdAt.toISOString(),
        e.auditHash,
      ]),
      [
        "TOTAL",
        "Single mess",
        "",
        "",
        (statement.totalPaise / 100).toFixed(2),
        "",
        "",
      ],
    ];
    return new Response(
      "\ufeff" +
        rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
        "\r\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rebates-${statement.month}.csv"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return new Response(
      error instanceof RebateError ? error.message : "Statement unavailable",
      { status: error instanceof RebateError ? 400 : 503 },
    );
  }
}
