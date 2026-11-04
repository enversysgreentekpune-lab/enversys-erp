"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkAction } from "@/app/actions/me";
import { MapPin } from "lucide-react";

export function CheckIn({ checkedIn, checkedOut, inTime, outTime, loc }: { checkedIn: boolean; checkedOut: boolean; inTime?: string; outTime?: string; loc?: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (kind: "IN" | "OUT") => {
    if (!navigator.geolocation) return setMsg({ ok: false, t: "Geolocation not supported on this device" });
    setMsg({ ok: true, t: "Getting your location…" });
    navigator.geolocation.getCurrentPosition(
      (p) => start(async () => {
        const r = await checkAction(kind, p.coords.latitude, p.coords.longitude);
        setMsg({ ok: !!r?.ok, t: (r?.ok ? r.message : r?.error) ?? "" });
        router.refresh();
      }),
      (e) => setMsg({ ok: false, t: `Location error: ${e.message}. Allow location access and retry.` }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className={`grid h-12 w-12 place-items-center rounded-full ${checkedIn ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><MapPin /></div>
        <div className="text-sm">
          {checkedIn ? <>In: <b>{inTime}</b>{loc && <> at {loc}</>}{checkedOut && <> · Out: <b>{outTime}</b></>}</> : <>Not checked in today</>}
          <div className="text-xs text-slate-500">Geo-fenced: HO, Markal Factory & project sites</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {!checkedIn && <button className="btn-primary flex-1" disabled={pending} onClick={() => go("IN")}>Check in</button>}
        {checkedIn && !checkedOut && <button className="btn-secondary flex-1" disabled={pending} onClick={() => go("OUT")}>Check out</button>}
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-slate-600" : "text-rose-600"}`}>{msg.t}</p>}
    </div>
  );
}
