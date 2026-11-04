import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const metadata = { title: "Login" };
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const dev = (process.env.OTP_PROVIDER ?? "console") === "console" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true");
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-600 p-10 text-white lg:flex">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-lg font-bold">E</span><span className="text-xl font-semibold tracking-wide">ENVERSYS</span></div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">One system from enquiry to O&amp;M.</h1>
          <p className="mt-3 max-w-md text-brand-100">Leads, proposals, work orders, Markal Factory, inspection, dispatch, field services, HR and finance — every rupee booked to its work order.</p>
        </div>
        <div className="text-xs text-brand-100">www.enversys.com</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden"><span className="text-2xl font-bold tracking-wide text-brand-600">ENVERSYS</span></div>
          <h2 className="text-xl font-semibold">Sign in</h2>
          <p className="mb-6 text-sm text-slate-500">Use your registered mobile number.</p>
          <LoginForm />
          {dev && (
            <div className="mt-6 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              <b>Demo mode:</b> OTP is shown on screen. Try MD <code>9800000001</code>, Sales Engineer <code>9800000007</code>, Project Manager <code>9800000012</code>, Factory Worker <code>9800000017</code>, HR <code>9800000024</code>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
