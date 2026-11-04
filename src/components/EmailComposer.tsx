"use client";
import { useState } from "react";
import { ActionForm } from "./ActionForm";
import { sendLeadEmailAction } from "@/app/actions/leads";

export function EmailComposer({ leadId, proposalId, contacts, templates, attachments, defaultTemplate, markSubmitted, preselect = [] }: {
  leadId: string; proposalId?: string; contacts: { name: string; email: string }[]; templates: { code: string; name: string; subject: string; body: string }[];
  attachments: { id: string; file_name: string; version: number }[]; defaultTemplate?: string; markSubmitted?: boolean; preselect?: string[];
}) {
  const init = templates.find((t) => t.code === defaultTemplate);
  const [subject, setSubject] = useState(init?.subject ?? "");
  const [body, setBody] = useState(init?.body?.replace(/<\/p>/g, "\n").replace(/<br\/?>/g, "\n").replace(/<[^>]+>/g, "").trim() ?? "");
  return (
    <ActionForm action={sendLeadEmailAction} submitLabel="Send email" className="space-y-2">
      <input type="hidden" name="lead_id" value={leadId} />
      {proposalId && <input type="hidden" name="proposal_id" value={proposalId} />}
      {markSubmitted && <input type="hidden" name="mark_submitted" value="1" />}
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input" defaultValue={defaultTemplate ?? ""} onChange={(e) => {
          const t = templates.find((x) => x.code === e.target.value);
          if (t) { setSubject(t.subject); setBody(t.body.replace(/<\/p>/g, "\n").replace(/<br\/?>/g, "\n").replace(/<[^>]+>/g, "").trim()); }
        }}>
          <option value="">— Template —</option>
          {templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        <input name="to" className="input" list={`contacts-${leadId}`} defaultValue={contacts[0]?.email ?? ""} placeholder="To (comma-separated)" required />
        <datalist id={`contacts-${leadId}`}>{contacts.map((c) => <option key={c.email} value={c.email}>{c.name}</option>)}</datalist>
      </div>
      <input name="cc" className="input" placeholder="Cc" />
      <input name="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" required />
      <textarea name="body" className="input min-h-36" value={body} onChange={(e) => setBody(e.target.value)} />
      {attachments.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <div className="label">Attach existing documents</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {attachments.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="att" value={a.id} defaultChecked={preselect.includes(a.id)} /> <span className="truncate">{a.file_name}</span> <span className="text-xs text-slate-400">v{a.version}</span></label>)}
          </div>
        </div>
      )}
      <div><span className="label">Add files (Word, Excel, PDF, drawings…)</span><input type="file" name="files" multiple className="text-sm" /></div>
    </ActionForm>
  );
}
