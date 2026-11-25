import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const metadata = { title: "Login" };
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const dev = (process.env.OTP_PROVIDER ?? "console") === "console" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true");
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[1.1fr_1fr] dark:bg-slate-950">
      <div className="hidden flex-col justify-between border-r border-slate-100 bg-white p-12 lg:flex dark:border-slate-800 dark:bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/enversys-logo.png" alt="Enversys — lets make it a greenverse!" width={220} height={43} className="h-auto w-56" />
        <div className="max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Clean water. Greener future.</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight">One system from enquiry to commissioning.</h1>
          <p className="mt-4 text-slate-600 dark:text-slate-300">Clients, leads and proposals, project codes, purchase and store, Markal manufacturing, dispatch, accounts, field service and people — for STP, ETP, WTP, ZLD and OWC projects.</p>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
            {["Every cost booked to a project code", "Proposals with cost sheet & revisions", "Field service with client OTP sign-off", "Directors dashboard, live"].map((t) => (
              <li key={t} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-slate-400">Enversys · Pune · info@enversys.com · +91 98506 00099</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/enversys-logo.png" alt="Enversys" width={180} height={35} className="mb-8 h-auto w-44 lg:hidden" />
          <h2 className="text-2xl font-bold">Sign in</h2>
          <p className="mb-6 mt-1 text-sm text-slate-500">Use the mobile number registered with HR.</p>
          <LoginForm />
          {dev && (
            <div className="mt-6 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <b className="text-navy-900 dark:text-slate-100">Demo:</b> the OTP is shown on screen. Try Director <code>9800000001</code>, Sales <code>9800000007</code>, Project Manager <code>9800000012</code>, Factory Manager <code>9800000015</code>, Storekeeper <code>9800000027</code>, Accounts <code>9800000022</code>, HR <code>9800000024</code>, Field engineer <code>9800000014</code>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
