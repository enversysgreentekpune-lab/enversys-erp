import { requireUser } from "@/lib/auth";
import { loadProposal } from "@/lib/access";
import { quoteMergeData } from "@/lib/quote";
import { PrintButton } from "@/components/PrintButton";

export default async function PrintQuote({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  await loadProposal(u, id);
  const d = await quoteMergeData(id);
  const T: [string, string][] = [["Price basis", "price_basis"], ["Validity", "validity"], ["Payment terms", "payment"], ["Delivery", "delivery"], ["Warranty", "warranty"], ["LD clause", "ld"], ["Exclusions", "exclusions"], ["Deviations", "deviations"]];
  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-slate-900 print:p-0">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="flex items-end justify-between border-b-4 border-brand-600 pb-2">
        <div><div className="text-3xl font-bold tracking-wide text-brand-600">ENVERSYS</div><div className="text-xs text-slate-500">{d.company.address} · {d.company.phone} · GSTIN {d.company.gstin}</div></div>
        <div className="text-right text-sm"><b>{d.proposal.no} {d.proposal.rev}</b><br />{d.proposal.date}</div>
      </div>
      <h1 className="my-4 text-center text-xl font-semibold text-brand-600">TECHNO-COMMERCIAL OFFER</h1>
      <p className="text-sm">To: <b>{d.customer.name}</b><br />Kind attn.: {d.contact.name} {d.contact.designation}<br />Your enquiry: {d.lead.enquiry_no} dated {d.lead.date}<br />Subject: <b>{d.proposal.title}</b></p>
      <table className="mt-4 w-full border-collapse text-xs">
        <thead><tr className="bg-brand-600 text-white">{["Sl", "Description", "Specification", "Qty", "UOM", "Unit price ₹", "Amount ₹"].map((h) => <th key={h} className="border border-slate-300 p-1.5 text-left">{h}</th>)}</tr></thead>
        <tbody>{d.lines.map((l: any) => <tr key={l.sl}><td className="border p-1.5">{l.sl}</td><td className="border p-1.5">{l.description}</td><td className="border p-1.5">{[l.specification, l.make, l.moc, l.size_rating, l.standard].filter(Boolean).join(" · ")}</td><td className="border p-1.5 text-right">{l.qty}</td><td className="border p-1.5">{l.uom}</td><td className="border p-1.5 text-right">{l.unit_price}</td><td className="border p-1.5 text-right">{l.amount}</td></tr>)}</tbody>
        <tfoot className="font-semibold"><tr><td colSpan={6} className="border p-1.5 text-right">Total (excl. GST)</td><td className="border p-1.5 text-right">{d.totals.net}</td></tr><tr><td colSpan={6} className="border p-1.5 text-right">GST ({d.totals.gst_mode})</td><td className="border p-1.5 text-right">{d.totals.gst}</td></tr><tr><td colSpan={6} className="border p-1.5 text-right">Grand total</td><td className="border p-1.5 text-right">{d.totals.grand}</td></tr></tfoot>
      </table>
      <p className="mt-1 text-xs italic">{d.totals.words}</p>
      <h2 className="mt-6 font-semibold text-brand-600">Commercial terms</h2>
      <table className="mt-2 w-full text-sm">{<tbody>{T.map(([l, k]) => <tr key={k}><td className="w-40 border-b py-1 font-medium">{l}</td><td className="border-b py-1">{d.terms[k]}</td></tr>)}</tbody>}</table>
      <p className="mt-8 text-sm">For <b>ENVERSYS</b><br />{d.owner?.name}<br />{d.owner?.mobile} · {d.owner?.email}</p>
    </div>
  );
}
