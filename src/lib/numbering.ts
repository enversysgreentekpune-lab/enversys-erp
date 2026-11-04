import type { Db } from "./db";
import { fyCode } from "./period";

export const SERIES: Record<string, string> = {
  CUSTOMER: "ENV/CU", LEAD: "ENV/ENQ", PROPOSAL: "ENV/QT", WORK_ORDER: "ENV/WO", PR: "ENV/PR",
  PO: "ENV/PO", JOB: "MKL/JO", INVOICE: "ENV/INV", CUSTOMER_PO: "ENV/CPO",
};

export function formatDocNo(prefix: string, fy: string, n: number) {
  return `${prefix}/${fy}/${String(n).padStart(4, "0")}`;
}

/** Atomically allocates the next number in a series for the current FY. Use inside a transaction. */
export async function nextNo(db: Db, docType: keyof typeof SERIES | string, date = new Date()): Promise<string> {
  const fy = fyCode(date);
  const prefix = SERIES[docType] ?? `ENV/${docType}`;
  const r = await db.query(
    `insert into number_series(doc_type, fy, prefix, next_no) values ($1,$2,$3,2)
     on conflict (doc_type, fy) do update set next_no = number_series.next_no + 1
     returning prefix, next_no - 1 as n`,
    [docType, fy, prefix],
  );
  return formatDocNo(r.rows[0].prefix, fy, Number(r.rows[0].n));
}
