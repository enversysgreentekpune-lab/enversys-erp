import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
export default async function Home() {
  const u = await requireUser();
  redirect(u.roleCode === "MD" || (can(u, "dashboard_md", "view") && u.roleCode === "BUSINESS_HEAD") ? "/md" : "/me");
}
