import { requireUser, can } from "@/lib/auth";
import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { inr } from "@/lib/format";
import { PageHeader, Card, Table, Tabs } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addMasterAction } from "@/app/actions/admin";

export const metadata = { title: "Masters" };
const KINDS: Record<string, { label: string; sql: string; cols: [string, string][]; form: [string, string, string?][] }> = {
  vertical: { label: "Business verticals", sql: "select * from vertical order by sort", cols: [["code", "Code"], ["name", "Name"]], form: [["code", "Code"], ["name", "Name"]] },
  department: { label: "Departments", sql: "select * from department order by name", cols: [["code", "Code"], ["name", "Name"]], form: [["code", "Code"], ["name", "Name"]] },
  designation: { label: "Designations", sql: "select * from designation order by level", cols: [["name", "Name"], ["level", "Level"]], form: [["name", "Name"], ["level", "Level"]] },
  location: { label: "Locations & geofences", sql: "select * from location order by kind, name", cols: [["code", "Code"], ["name", "Name"], ["kind", "Type"], ["lat", "Lat"], ["lng", "Lng"], ["geofence_m", "Geofence m"], ["shift_start", "Shift"]], form: [["code", "Code"], ["name", "Name"], ["kind", "HO / FACTORY / SITE / BRANCH"], ["address", "Address"], ["lat", "Latitude"], ["lng", "Longitude"], ["geofence_m", "Geofence radius (m)"], ["shift_start", "Shift start HH:MM"], ["shift_end", "Shift end HH:MM"]] },
  item: { label: "Item / material master", sql: "select * from item order by code", cols: [["code", "Code"], ["description", "Description"], ["make", "Make"], ["uom", "UOM"], ["hsn", "HSN"], ["gst_pct", "GST%"], ["category", "Category"], ["last_purchase_rate", "Last PO rate"]], form: [["code", "Item code"], ["description", "Description"], ["specification", "Specification"], ["make", "Make"], ["moc", "MOC"], ["uom", "UOM"], ["hsn", "HSN"], ["gst_pct", "GST %"], ["category", "BOUGHT_OUT / RAW_MATERIAL / FABRICATED / CONSUMABLE / SERVICE"], ["last_purchase_rate", "Last purchase rate"], ["standard_rate", "Standard rate"]] },
  vendor: { label: "Vendors", sql: "select * from vendor order by name", cols: [["code", "Code"], ["name", "Name"], ["gstin", "GSTIN"], ["contact_name", "Contact"], ["email", "Email"], ["mobile", "Mobile"], ["rating", "Rating"]], form: [["code", "Vendor code"], ["name", "Name"], ["gstin", "GSTIN"], ["contact_name", "Contact"], ["email", "Email"], ["mobile", "Mobile"], ["address", "Address"], ["payment_terms", "Payment terms"]] },
};
export default async function Masters({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  if (!can(u, "settings", "view") && !can(u, "purchase", "view")) redirect("/forbidden");
  const tab = (await searchParams).tab ?? "item";
  const k = KINDS[tab] ?? KINDS.item;
  const rows = await q(k.sql);
  const canAdd = (tab === "item" || tab === "vendor") ? !!(can(u, "purchase", "create") || can(u, "settings", "create")) : !!can(u, "settings", "create");
  return (
    <div>
      <PageHeader back={{ href: "/admin", label: "Admin" }} title="Master data" />
      <Tabs tabs={Object.entries(KINDS).map(([key, v]) => ({ key, label: v.label }))} active={tab} base="/admin/masters" />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card bodyClass="p-0"><Table head={k.cols.map((c) => c[1])}>{rows.map((r) => <tr key={r.id}>{k.cols.map(([c]) => <td key={c} className={typeof r[c] === "number" ? "num" : ""}>{c.includes("rate") && r[c] ? inr(r[c]) : String(r[c] ?? "")}</td>)}</tr>)}</Table></Card>
        {canAdd && <Card title={`Add ${k.label.toLowerCase()}`}><ActionForm action={addMasterAction} reset submitLabel="Add" className="space-y-2"><input type="hidden" name="kind" value={tab} />{k.form.map(([c, l]) => <input key={c} name={c} placeholder={l} className="input" />)}</ActionForm></Card>}
      </div>
    </div>
  );
}
