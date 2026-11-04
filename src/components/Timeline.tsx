import { dtm } from "@/lib/format";
import { Badge } from "./ui";
import { Mail, MailOpen, Phone, Users, ArrowRight, StickyNote, FileText, Bell, Info } from "lucide-react";

const ICON: Record<string, any> = { EMAIL_OUT: Mail, EMAIL_IN: MailOpen, CALL: Phone, MEETING: Users, STAGE: ArrowRight, NOTE: StickyNote, DOC: FileText, FOLLOWUP: Bell, STATUS: Info, SYSTEM: Info };

export function Timeline({ items, showRef }: { items: any[]; showRef?: boolean }) {
  if (!items.length) return <div className="text-sm text-slate-500">No activity yet.</div>;
  return (
    <ol className="relative ml-3 border-l border-slate-200 dark:border-slate-700">
      {items.map((a) => {
        const Icon = ICON[a.kind] ?? Info;
        return (
          <li key={a.id} className="mb-4 ml-5">
            <span className="absolute -left-3 grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-brand-600 ring-4 ring-white dark:bg-slate-800 dark:ring-slate-900"><Icon size={13} /></span>
            <div className="flex flex-wrap items-center gap-2 text-sm"><b className="font-medium">{a.subject ?? a.kind}</b><Badge>{a.kind.replace("_", " ").toLowerCase()}</Badge>{showRef && a.enquiry_no && <span className="text-xs text-slate-500">{a.enquiry_no}</span>}</div>
            {a.body && <div className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{a.body}</div>}
            <div className="mt-0.5 text-[11px] text-slate-400">{dtm(a.created_at)}{a.by_name && ` · ${a.by_name}`}{a.lat && ` · 📍 ${Number(a.lat).toFixed(4)}, ${Number(a.lng).toFixed(4)}`}</div>
          </li>
        );
      })}
    </ol>
  );
}
