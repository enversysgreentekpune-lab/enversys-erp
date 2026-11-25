"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { createTaskAction } from "@/app/actions/tasks";

const DAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["7", "Sun"]];

export function NewTaskForm({ people, me, wos, customers, canDaily }: { people: { id: string; name: string }[]; me: string; wos: { id: string; wo_no: string; title: string }[]; customers: { id: string; name: string }[]; canDaily: boolean }) {
  const [kind, setKind] = useState<"GENERAL" | "FIELD_SERVICE" | "DAILY">("GENERAL");
  return (
    <ActionForm action={createTaskAction} reset submitLabel={kind === "DAILY" ? "Schedule daily task" : "Assign task"} className="space-y-2">
      <div className="grid grid-cols-3 rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
        {([["GENERAL", "Task"], ["FIELD_SERVICE", "Field service"], ...(canDaily ? [["DAILY", "Daily"]] : [])] as [typeof kind, string][]).map(([k, l]) => (
          <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-md py-1.5 ${kind === k ? "bg-brand-50 font-medium text-brand-700" : "text-slate-500"}`}>{l}</button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind === "FIELD_SERVICE" ? "FIELD_SERVICE" : "GENERAL"} />
      {kind === "DAILY" && <input type="hidden" name="repeat" value="daily" />}
      <input name="title" required placeholder={kind === "FIELD_SERVICE" ? "e.g. Quarterly service of STP blowers" : kind === "DAILY" ? "e.g. Update shop-floor job cards" : "Task title"} className="input" />
      <textarea name="description" placeholder="Details / instructions" className="input" />
      <select name="assigned_to" defaultValue={me} className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `${p.name} (me)` : p.name}</option>)}</select>
      {kind === "DAILY" ? (
        <div className="flex flex-wrap gap-2 text-xs">{DAYS.map(([v, l]) => <label key={v} className="flex items-center gap-1"><input type="checkbox" name="weekday" value={v} defaultChecked={v !== "7"} />{l}</label>)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2"><input type="datetime-local" name="due" className="input" aria-label="Due" /><select name="priority" defaultValue="MEDIUM" className="input">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select></div>
      )}
      {kind === "FIELD_SERVICE" && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <div className="text-xs font-medium text-slate-500">Client details (report and completion OTP go here)</div>
          <select name="customer_id" className="input"><option value="">Client company…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input name="client_name" placeholder="Client contact name" className="input" />
          <div className="grid grid-cols-2 gap-2"><input name="client_email" type="email" required placeholder="Client email" className="input" /><input name="client_mobile" required inputMode="numeric" placeholder="Client mobile" className="input" /></div>
          <input name="site_address" placeholder="Site address" className="input" />
          <select name="wo_id" className="input"><option value="">Project / SO (optional)</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.wo_no} · {w.title.slice(0, 30)}</option>)}</select>
        </div>
      )}
    </ActionForm>
  );
}
