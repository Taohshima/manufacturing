"use server";

import { prisma } from "@/lib/prisma";
import type {
  CommitResult,
  DryRunResult,
  DryRunRow,
} from "@/lib/csv";
import { parseIntSafe } from "@/lib/csv";

type SupplierField =
  | "companyName"
  | "officeName"
  | "postalCode"
  | "address"
  | "phone"
  | "fax"
  | "websiteUrl"
  | "contactPerson"
  | "email"
  | "orderMethod"
  | "paymentMethod"
  | "paymentDay"
  | "paymentDivision"
  | "paymentSite"
  | "searchLabel"
  | "alias";

export type SupplierInputRow = Partial<Record<SupplierField, string | null>>;

const STRING_FIELDS: SupplierField[] = [
  "companyName",
  "officeName",
  "postalCode",
  "address",
  "phone",
  "fax",
  "websiteUrl",
  "contactPerson",
  "email",
  "orderMethod",
  "paymentMethod",
  "paymentDivision",
  "paymentSite",
  "searchLabel",
  "alias",
];

type SupplierData = {
  companyName: string;
  officeName: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  websiteUrl: string | null;
  contactPerson: string | null;
  email: string | null;
  orderMethod: string | null;
  paymentMethod: string | null;
  paymentDay: number | null;
  paymentDivision: string | null;
  paymentSite: string | null;
  searchLabel: string | null;
  alias: string | null;
};

function normalizeRow(input: SupplierInputRow): SupplierData {
  const data: Record<string, string | number | null> = {};
  for (const f of STRING_FIELDS) {
    const v = input[f];
    data[f] = v == null || v === "" ? null : v;
  }
  data.paymentDay = parseIntSafe(input.paymentDay ?? null);
  data.companyName = (input.companyName ?? "").trim();
  return data as SupplierData;
}

function pickSupplierData(
  row: Record<string, unknown> & { companyName: string },
): SupplierData {
  const out: Record<string, string | number | null> = {};
  for (const f of STRING_FIELDS) {
    const v = row[f];
    out[f] =
      v == null || v === "" ? null : typeof v === "string" ? v : String(v);
  }
  const pd = row.paymentDay;
  out.paymentDay =
    typeof pd === "number" ? pd : pd == null ? null : parseIntSafe(String(pd));
  return out as SupplierData;
}

function diffChanged(current: SupplierData, incoming: SupplierData): boolean {
  for (const f of STRING_FIELDS) {
    const a = current[f] ?? null;
    const b = incoming[f] ?? null;
    if (a !== b) return true;
  }
  if ((current.paymentDay ?? null) !== (incoming.paymentDay ?? null)) {
    return true;
  }
  return false;
}

export async function dryRunSuppliers(
  rows: SupplierInputRow[],
): Promise<DryRunResult> {
  const result: DryRunRow[] = [];
  let newCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let errorCount = 0;

  // 既存レコードを companyName 順に一括取得しておく
  const incomingNames = Array.from(
    new Set(
      rows
        .map((r) => (r.companyName ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  );
  const existingRecords = await prisma.supplier.findMany({
    where: { companyName: { in: incomingNames } },
  });
  const existingMap = new Map<string, SupplierData>();
  for (const e of existingRecords) {
    existingMap.set(
      e.companyName,
      pickSupplierData(e as unknown as Record<string, unknown> & {
        companyName: string;
      }),
    );
  }

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const incoming = normalizeRow(rows[i]);
    const companyName = incoming.companyName;

    if (!companyName) {
      result.push({
        rowIndex,
        status: "error",
        key: "",
        message: "取引先会社名が空です",
        incoming: incoming as unknown as Record<string, unknown>,
      });
      errorCount++;
      continue;
    }

    const current = existingMap.get(companyName);
    if (!current) {
      result.push({
        rowIndex,
        status: "new",
        key: companyName,
        incoming: incoming as unknown as Record<string, unknown>,
      });
      newCount++;
    } else {
      const changed = diffChanged(current, incoming);
      result.push({
        rowIndex,
        status: changed ? "update" : "unchanged",
        key: companyName,
        incoming: incoming as unknown as Record<string, unknown>,
        current: current as unknown as Record<string, unknown>,
      });
      if (changed) updateCount++;
      else unchangedCount++;
    }
  }

  return {
    total: rows.length,
    newCount,
    updateCount,
    unchangedCount,
    errorCount,
    rows: result,
  };
}

export async function commitSuppliers(
  rows: SupplierInputRow[],
): Promise<CommitResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { rowIndex: number; message: string }[] = [];

  // 既存レコードを一括取得
  const incomingNames = Array.from(
    new Set(
      rows
        .map((r) => (r.companyName ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  );
  const existingRecords = await prisma.supplier.findMany({
    where: { companyName: { in: incomingNames } },
  });
  const existingMap = new Map<
    string,
    { id: number; data: SupplierData }
  >();
  for (const e of existingRecords) {
    existingMap.set(e.companyName, {
      id: e.id,
      data: pickSupplierData(
        e as unknown as Record<string, unknown> & { companyName: string },
      ),
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const incoming = normalizeRow(rows[i]);
    const companyName = incoming.companyName;
    if (!companyName) {
      errors.push({ rowIndex, message: "取引先会社名が空です" });
      continue;
    }

    try {
      const existing = existingMap.get(companyName);
      if (!existing) {
        await prisma.supplier.create({ data: incoming });
        created++;
      } else if (diffChanged(existing.data, incoming)) {
        const { companyName: _omit, ...rest } = incoming;
        void _omit;
        await prisma.supplier.update({
          where: { id: existing.id },
          data: rest,
        });
        updated++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push({
        rowIndex,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { ok: errors.length === 0, created, updated, skipped, errors };
}
