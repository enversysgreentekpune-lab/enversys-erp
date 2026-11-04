"use client";
import { useState } from "react";
import { ActionForm } from "./ActionForm";
import { changeStageAction } from "@/app/actions/leads";

export function StageForm({ id, stage, stages, reasons }: { id: string; stage: string; stages: { code: string; label: string }[]; reasons: string[] }) {
  const [st, setSt] = useState(stage);
  return (
    <ActionForm action={changeStageAction} submitLabel="Update stage" className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <select name="stage" className="input" value={st} onChange={(e) => setSt(e.target.value)}>
        {stages.filter((s) => s.code !== "WON").map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
      </select>
      {st === "LOST" && (
        <div className="grid gap-2 rounded-lg bg-rose-50 p-2 dark:bg-rose-900/20">
          <select name="lost_reason" required className="input"><option value="">Lost reason *</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>
          <input name="competitor" placeholder="Competitor name" className="input" />
          <input name="competitor_price" placeholder="Competitor price (₹)" inputMode="numeric" className="input" />
        </div>
      )}
      <textarea name="remark" required placeholder="Remark (mandatory)" className="input" />
    </ActionForm>
  );
}
