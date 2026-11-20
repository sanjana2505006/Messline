"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { clearSession, getCurrentUser } from "@/lib/auth";
import { bookPlates } from "@/lib/booking";

export async function signOut() {
  clearSession();
  redirect("/");
}

export async function bookPlatesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.STUDENT) {
    redirect("/?error=NOT_STUDENT");
  }

  const offeringId = String(formData.get("offeringId") ?? "");
  const count = Number(formData.get("count"));
  const redirectTo = String(formData.get("redirectTo") ?? "/");

  const isUpdate = formData.get("isUpdate") === "1";

  const result = await bookPlates(user.id, offeringId, count);

  revalidatePath("/");
  revalidatePath("/bookings");

  const targetPath = redirectTo.startsWith("/bookings") ? "/bookings" : "/";

  if (!result.ok) {
    redirect(`${targetPath}?error=${result.reason}`);
  }

  const successParam = isUpdate ? "updated=1" : "booked=1";
  redirect(`${targetPath}?${successParam}`);
}
