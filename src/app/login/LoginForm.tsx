"use client";
import { useState, useTransition } from "react";
import { sendOtpAction, verifyOtpAction, pinLoginAction } from "@/app/actions/auth";

export default function LoginForm() {
  const [mode, setMode] = useState<"otp" | "pin">("otp");
  const [step, setStep] = useState<"mobile" | "code">("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const send = () => start(async () => {
    const r = await sendOtpAction(mobile);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { setStep("code"); setDevCode(r.devCode); }
  });
  const verify = () => start(async () => {
    const r = mode === "otp" ? await verifyOtpAction(mobile, code) : await pinLoginAction(mobile, code);
    if (r.ok) { window.location.href = "/"; return; }
    setMsg({ ok: false, text: r.message });
  });

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {(["otp", "pin"] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setStep(m === "pin" ? "code" : "mobile"); setCode(""); setMsg(null); }}
            className={`rounded-md py-1.5 ${mode === m ? "bg-white font-medium shadow dark:bg-slate-900" : "text-slate-500"}`}>{m === "otp" ? "Mobile OTP" : "Quick PIN"}</button>
        ))}
      </div>
      <label className="label" htmlFor="mobile">Mobile number</label>
      <div className="flex">
        <span className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">+91</span>
        <input id="mobile" inputMode="numeric" autoComplete="tel" maxLength={10} value={mobile} disabled={mode === "otp" && step === "code"}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && mode === "otp" && send()}
          className="input rounded-l-none" placeholder="98XXXXXXXX" />
      </div>
      {(step === "code" || mode === "pin") && (
        <div className="mt-4">
          <label className="label" htmlFor="code">{mode === "otp" ? "6-digit OTP" : "4-digit PIN"}</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={mode === "otp" ? 6 : 4} value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && verify()}
            className="input text-center text-lg tracking-[0.5em]" type={mode === "pin" ? "password" : "text"} />
          {devCode && mode === "otp" && <p className="mt-1 text-xs text-amber-600">Demo OTP: <b>{devCode}</b></p>}
        </div>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
      <div className="mt-5 flex gap-2">
        {mode === "otp" && step === "mobile" ? (
          <button onClick={send} disabled={pending || mobile.length !== 10} className="btn-primary w-full">{pending ? "Sending…" : "Send OTP"}</button>
        ) : (
          <>
            {mode === "otp" && <button onClick={() => { setStep("mobile"); setCode(""); setMsg(null); }} className="btn-secondary">Change</button>}
            <button onClick={verify} disabled={pending || code.length < (mode === "otp" ? 6 : 4) || mobile.length !== 10} className="btn-primary flex-1">{pending ? "Verifying…" : "Sign in"}</button>
          </>
        )}
      </div>
      {mode === "otp" && step === "code" && <button onClick={send} disabled={pending} className="mt-3 text-xs text-brand-600 hover:underline">Resend OTP</button>}
    </div>
  );
}
