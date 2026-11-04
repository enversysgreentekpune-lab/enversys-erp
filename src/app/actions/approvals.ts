"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { safe, s } from "@/lib/action";
import { decideApproval } from "@/lib/workflow";

export async function decideApprovalAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    await decideApproval(s(fd, "id"), s(fd, "decision") === "APPROVE", s(fd, "remarks"), { id: u.id, roleCode: u.roleCode });
    revalidatePath("/approvals"); revalidatePath("/proposals"); revalidatePath("/purchase");
    return { ok: true, message: s(fd, "decision") === "APPROVE" ? "Approved" : "Rejected" };
  });
}
