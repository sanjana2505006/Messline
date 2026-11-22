"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  applyForRebate,
  decideRebate,
  settleRebate,
  updateRebatePolicy,
  RebateError,
} from "@/lib/rebates";
function refresh() {
  revalidatePath("/student/rebates");
  revalidatePath("/secretary/rebates");
}
function message(error: unknown) {
  return error instanceof RebateError
    ? error.message
    : error instanceof z.ZodError
      ? "Check the entered values."
      : "The operation could not be completed. Please retry.";
}
export async function submitRebate(form: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "STUDENT") redirect("/login");
  let error = "";
  try {
    await applyForRebate(user.id, {
      start: form.get("start"),
      end: form.get("end"),
      reason: form.get("reason"),
    });
  } catch (e) {
    error = message(e);
  }
  refresh();
  redirect(
    `/student/rebates?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`,
  );
}
export async function decideRebates(form: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECRETARY") redirect("/login");
  const ids = Array.from(
    new Set(
      form
        .getAll("ids")
        .filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length < 200,
        ),
    ),
  );
  const decision = form.get("decision");
  let completed = 0;
  const errors: string[] = [];
  if (
    ids.length < 1 ||
    ids.length > 50 ||
    !["APPROVED", "REJECTED", "SETTLED"].includes(String(decision))
  )
    errors.push("Select 1–50 applications and a valid action.");
  else
    for (const id of ids) {
      try {
        if (decision === "SETTLED") await settleRebate(user.id, id);
        else
          await decideRebate(
            user.id,
            id,
            decision as "APPROVED" | "REJECTED",
            String(form.get("reason") ?? ""),
          );
        completed++;
      } catch (e) {
        errors.push(message(e));
      }
    }
  refresh();
  redirect(
    `/secretary/rebates?completed=${completed}&failed=${errors.length}${errors.length ? `&error=${encodeURIComponent(errors[0])}` : ""}`,
  );
}
export async function saveRebatePolicy(form: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECRETARY") redirect("/login");
  let error = "";
  try {
    await updateRebatePolicy(
      user.id,
      Object.fromEntries(
        [
          "version",
          "minimumDays",
          "noticeHours",
          "breakfastPaise",
          "lunchPaise",
          "dinnerPaise",
        ].map((k) => [k, Number(form.get(k))]),
      ),
    );
  } catch (e) {
    error = message(e);
  }
  refresh();
  redirect(
    `/secretary/rebates?${error ? `error=${encodeURIComponent(error)}` : "policySaved=1"}`,
  );
}
