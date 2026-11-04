import "server-only";
import { one, q } from "./db";
import { renderDocx, renderXlsx, loadTemplate, inWords } from "./docgen";
import { saveAttachment } from "./attachments";
import { dt } from "./format";

const fmt = (n: number) => Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function quoteMergeData(proposalId: string, revNo?: number) {
  const p = await one(`select * from proposal where id=$1`, [proposalId]);
  const rev = await one(`select * from proposal_revision where proposal_id=$1 and rev_no=$2`, [proposalId, revNo ?? p.current_rev]);
  const [lead, cust, company, owner, spec] = await Promise.all([
    one(`select * from lead where id=$1`, [p.lead_id]), one(`select * from customer where id=$1`, [p.customer_id]), one(`select * from company limit 1`),
    one(`select name, mobile, email from employee where id=$1`, [p.owner_id]), q(`select * from spec_line where revision_id=$1 order by sl`, [rev.id]),
  ]);
  const contact = lead.contact_id ? await one(`select * from contact where id=$1`, [lead.contact_id]) : null;
  const t = rev.totals ?? {};
  const priced = new Map<number, any>((t.lines ?? []).map((l: any) => [l.sl, l]));
  return {
    company, customer: cust, contact: contact ?? { name: "Sir / Madam", designation: "" }, owner,
    lead: { ...lead, date: dt(lead.enquiry_date) },
    proposal: { no: p.proposal_no, rev: `R${rev.rev_no}`, date: dt(rev.created_at), title: p.title },
    terms: rev.terms ?? {},
    lines: spec.map((s) => ({ ...s, qty: Number(s.qty), unit_price: fmt(priced.get(s.sl)?.unitPrice ?? 0), amount: fmt(priced.get(s.sl)?.amount ?? 0),
      specification: s.specification ?? "", make: s.make ? `Make: ${s.make}` : "", moc: s.moc ? `MOC: ${s.moc}` : "", size_rating: s.size_rating ?? "", standard: s.standard ?? "" })),
    totals: { net: fmt(t.netSelling), gst: fmt(t.gst), grand: fmt(t.grandTotal), gst_mode: rev.params?.gst_mode === "INTER" ? "IGST" : "CGST + SGST", words: inWords(Number(t.grandTotal ?? 0)) },
    _p: p, _rev: rev,
  };
}

/** Generates Word offer + Excel price schedule from the active templates and stores them on the proposal */
export async function generateQuoteDocs(proposalId: string, userId: string, kinds: ("docx" | "xlsx")[] = ["docx", "xlsx"]) {
  const data = await quoteMergeData(proposalId);
  const base = `${data.proposal.no.replace(/\//g, "-")}-${data.proposal.rev}`;
  const out = [];
  if (kinds.includes("docx")) {
    const buf = renderDocx(await loadTemplate("QUOTE_DOCX"), data);
    const a = await saveAttachment({ entity: "proposal", entityId: proposalId, fileName: `${base} Techno-Commercial Offer.docx`, buf, folder: "02 Proposal & Revisions", docType: "QUOTE_DOCX", userId });
    await one(`insert into generated_document(entity, entity_id, template_code, attachment_id, created_by) values ('proposal',$1,'QUOTE_DOCX',$2,$3) returning id`, [proposalId, a.id, userId]);
    out.push(a);
  }
  if (kinds.includes("xlsx")) {
    const buf = await renderXlsx(await loadTemplate("QUOTE_XLSX"), data);
    const a = await saveAttachment({ entity: "proposal", entityId: proposalId, fileName: `${base} Price Schedule.xlsx`, buf, folder: "02 Proposal & Revisions", docType: "QUOTE_XLSX", userId });
    await one(`insert into generated_document(entity, entity_id, template_code, attachment_id, created_by) values ('proposal',$1,'QUOTE_XLSX',$2,$3) returning id`, [proposalId, a.id, userId]);
    out.push(a);
  }
  return out;
}
