"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { dwrAction } from "@/app/actions/me";

export function DwrForm({ wos, today, existing }: { wos: { id: string; wo_no: string; title: string }[]; today: string; existing?: { summary: string; issues: string; lines: { wo_id: string | null; hours: number; description: string }[] } }) {
  const [lines, setLines] = useState(existing?.lines?.length ? existing.lines : [{ wo_id: wos[0]?.id ?? null, hours: 8, description: "" }]);
  return (
    <ActionForm action={dwrAction} submitLabel={existing ? "Update DWR" : "Submit DWR"}>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <input type="date" name="date" defaultValue={today} max={today} className="input" />
        <input name="summary" required defaultValue={existing?.summary} placeholder="Summary of work done today" className="input" />
      </div>
      <div className="mt-2 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px] gap-2 sm:grid-cols-[220px_70px_1fr_auto]">
            <select name="wo" defaultValue={l.wo_id ?? ""} className="input">
              <option value="">Non-WO / internal</option>
              {wos.map((w) => <option key={w.id} value={w.id}>{w.wo_no} – {w.title.slice(0, 30)}</option>)}
            </select>
            <input name="hours" type="number" step="0.5" min="0" max="16" defaultValue={l.hours} className="input" aria-label="Hours" />
            <input name="desc" defaultValue={l.description} placeholder="Activity" className="input col-span-2 sm:col-span-1" />
            <button type="button" className="btn-ghost btn-sm hidden sm:inline-flex" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-ghost btn-sm mt-1" onClick={() => setLines([...lines, { wo_id: null, hours: 1, description: "" }])}>+ Add line</button>
      <input name="issues" defaultValue={existing?.issues} placeholder="Issues / hindrances (optional)" className="input mt-2" />
    </ActionForm>
  );
}
