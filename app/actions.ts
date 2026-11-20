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
  const returnUrl = String(formData.get("returnUrl") || "/");
  const user = await getCurrentUser();
  if (!user || user.role !== Role.STUDENT) {
    redirect(`${returnUrl}?error=NOT_STUDENT`);
  }

  const offeringId = String(formData.get("offeringId") ?? "");
  const count = Number(formData.get("count"));

  const result = await bookPlates(user.id, offeringId, count);

  revalidatePath("/");
  revalidatePath("/schedule");

  if (!result.ok) {
    redirect(`${returnUrl}?error=${result.reason}`);
  }

  redirect(`${returnUrl}?booked=1`);
}
