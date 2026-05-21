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

function normalizeRow(input: SupplierInputRow) {
  const data: Record<string, string | number | null> = {};
  for (const f of STRING_FIELDS) {
    const v = input[f];
    data[f] = v == null || v === "" ? null : v;
  }
  data.paymentDay = parseIntSafe(input.paymentDay ?? null);
  return data;
}

function diffChanged(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(incoming)) {
    const a = current[key];
    const b = incoming[key];
    if (a == null && b == null) continue;
    if (String(a ?? "") !== String(b ?? "")) return true;
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

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const r = rows[i];
    const companyName = (r.companyName ?? "").trim();

    if (!companyName) {
      result.push({
        rowIndex,
        status: "error",
        key: "",
        message: "取引先会社名が空です",
        incoming: r,
      });
      errorCount++;
      continue;
    }

    const incoming = normalizeRow(r);
    const current = await prisma.supplier.findFirst({
      where: { companyName },
    });

    if (!current) {
      result.push({
        rowIndex,
        status: "new",
        key: companyName,
        incoming,
      });
      newCount++;
    } else {
      const changed = diffChanged(
        current as unknown as Record<string, unknown>,
        incoming,
      );
      result.push({
        rowIndex,
        status: changed ? "update" : "unchanged",
        key: companyName,
        incoming,
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

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const r = rows[i];
    const companyName = (r.companyName ?? "").trim();
    if (!companyName) {
      errors.push({ rowIndex, message: "取引先会社名が空です" });
      continue;
    }

    try {
      const incoming = normalizeRow(r);
      const existing = await prisma.supplier.findFirst({
        where: { companyName },
      });
      if (!existing) {
        await prisma.supplier.create({
          data: { ...incoming, companyName } as never,
        });
        created++;
      } else {
        const changed = diffChanged(
          existing as unknown as Record<string, unknown>,
          incoming,
        );
        if (changed) {
          await prisma.supplier.update({
            where: { id: existing.id },
            data: incoming as never,
          });
          updated++;
        } else {
          skipped++;
        }
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
