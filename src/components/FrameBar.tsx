"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { FRAMES } from "@/lib/period";

export function FrameBar({ verticals, showCompare = true, showUnit = true, exportHref }: { verticals?: { id: string; name: string }[]; showCompare?: boolean; showUnit?: boolean; exportHref?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    router.push(`${path}?${p.toString()}`, { scroll: false });
  };
  const frame = sp.get("frame") ?? "fy";
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-2 p-3 print:hidden">
      <div>
        <span className="label">Time frame</span>
        <select className="input w-44" value={frame} onChange={(e) => set("frame", e.target.value)}>
          {FRAMES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
        </select>
      </div>
      {frame === "custom" && (
        <>
          <div><span className="label">From</span><input type="date" className="input" defaultValue={sp.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} /></div>
          <div><span className="label">To</span><input type="date" className="input" defaultValue={sp.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} /></div>
        </>
      )}
      {showCompare && (
        <div>
          <span className="label">Compare</span>
          <select className="input w-44" value={sp.get("cmp") ?? "prev"} onChange={(e) => set("cmp", e.target.value)}>
            <option value="prev">vs previous period</option><option value="yoy">vs same period last year</option><option value="none">No comparison</option>
          </select>
        </div>
      )}
      {verticals && (
        <div>
          <span className="label">Business vertical</span>
          <select className="input w-48" value={sp.get("vertical") ?? ""} onChange={(e) => set("vertical", e.target.value)}>
            <option value="">All verticals</option>
            {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      )}
      {showUnit && (
        <div>
          <span className="label">Show in</span>
          <select className="input w-28" value={sp.get("unit") ?? "L"} onChange={(e) => set("unit", e.target.value)}>
            <option value="L">₹ Lakhs</option><option value="Cr">₹ Crores</option>
          </select>
        </div>
      )}
      <div className="ml-auto flex gap-2">
        {exportHref && <a className="btn-secondary" href={`${exportHref}?${sp.toString()}`}>Export Excel</a>}
        <button className="btn-secondary" onClick={() => window.print()}>PDF / Print</button>
      </div>
    </div>
  );
}
