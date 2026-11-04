"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { setStatusAction } from "@/app/actions/proposals";

export function StatusForm({ id, options, reasons }: { id: string; options: { code: string; label: string }[]; reasons: string[] }) {
  const [st, setSt] = useState(options[0]?.code ?? "");
  return (
    <ActionForm action={setStatusAction} submitLabel="Update status" className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <select name="status" className="input" value={st} onChange={(e) => setSt(e.target.value)}>{options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
      {st === "LOST" && (
        <div className="grid gap-2 rounded-lg bg-rose-50 p-2 dark:bg-rose-900/20">
          <select name="lost_reason" required className="input"><option value="">Lost reason *</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select>
          <input name="competitor" placeholder="Competitor" className="input" /><input name="competitor_price" placeholder="Competitor price (₹)" className="input" />
        </div>
      )}
      <textarea name="remark" required placeholder="Remark" className="input" />
    </ActionForm>
  );
}
