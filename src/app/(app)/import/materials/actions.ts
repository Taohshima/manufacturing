"use server";

import { prisma } from "@/lib/prisma";
import type { Division } from "@prisma/client";
import type {
  CommitResult,
  DryRunResult,
  DryRunRow,
} from "@/lib/csv";
import { parseDateSafe, parseDecimalString } from "@/lib/csv";

type MaterialField =
  | "name"
  | "division"
  | "categoryName"
  | "unit"
  | "purchasePrice"
  | "stockQty"
  | "lastInventoryDate"
  | "supplierCompanyName"
  | "consignedQty"
  | "consignedOwner"
  | "storageLocation"
  | "notes"
  | "docUrl";

export type MaterialInputRow = Partial<Record<MaterialField, string | null>>;

const DIVISION_MAP: Record<string, Division> = {
  原料: "RAW",
  資材: "PACKAGING",
  包装資材: "PACKAGING",
  製品: "PRODUCT",
  raw: "RAW",
  packaging: "PACKAGING",
  product: "PRODUCT",
};

function parseDivision(v: string | null | undefined): Division | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  return DIVISION_MAP[v.trim()] ?? DIVISION_MAP[k] ?? null;
}

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

type NormalizedMaterial = {
  name: string;
  division: Division;
  categoryId: number;
  categoryName: string; // 表示用
  unit: string;
  purchasePrice: string | null; // Decimal を文字列で保持
  stockQty: string | null;
  lastInventoryDate: Date | null;
  supplierId: number | null;
  supplierName: string | null; // 表示用
  consignedQty: string | null;
  consignedOwner: string | null;
  storageLocation: string | null;
  notes: string | null;
  docUrl: string | null;
};

type LookupContext = {
  categoryMap: Map<string, { id: number }>; // key: `${division}|${name}`
  supplierMap: Map<string, { id: number }>; // key: companyName
};

async function buildContext(): Promise<LookupContext> {
  const [cats, sups] = await Promise.all([
    prisma.category.findMany(),
    prisma.supplier.findMany({ select: { id: true, companyName: true } }),
  ]);
  const categoryMap = new Map<string, { id: number }>();
  for (const c of cats) {
    categoryMap.set(`${c.division}|${c.name}`, { id: c.id });
  }
  const supplierMap = new Map<string, { id: number }>();
  for (const s of sups) {
    supplierMap.set(s.companyName, { id: s.id });
  }
  return { categoryMap, supplierMap };
}

function normalizeRow(
  input: MaterialInputRow,
  ctx: LookupContext,
): { ok: true; data: NormalizedMaterial } | { ok: false; message: string } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, message: "名称が空です" };

  const division = parseDivision(input.division);
  if (!division) {
    return {
      ok: false,
      message: `区分「${input.division ?? ""}」を解釈できません（原料/資材/製品 のいずれか）`,
    };
  }

  const categoryName = (input.categoryName ?? "").trim();
  if (!categoryName) return { ok: false, message: "カテゴリが空です" };
  const cat = ctx.categoryMap.get(`${division}|${categoryName}`);
  if (!cat) {
    return {
      ok: false,
      message: `カテゴリ「${categoryName}」が ${DIVISION_LABEL[division]} 区分のマスタに存在しません`,
    };
  }

  const unit = (input.unit ?? "").trim();
  if (!unit) return { ok: false, message: "単位が空です" };

  let supplierId: number | null = null;
  let supplierName: string | null = null;
  const sup = (input.supplierCompanyName ?? "").trim();
  if (sup) {
    const found = ctx.supplierMap.get(sup);
    if (!found) {
      return {
        ok: false,
        message: `発注先「${sup}」が取引先マスタに存在しません（先に取引先を取込してください）`,
      };
    }
    supplierId = found.id;
    supplierName = sup;
  }

  return {
    ok: true,
    data: {
      name,
      division,
      categoryId: cat.id,
      categoryName,
      unit,
      purchasePrice: parseDecimalString(input.purchasePrice ?? null),
      stockQty: parseDecimalString(input.stockQty ?? null),
      lastInventoryDate: parseDateSafe(input.lastInventoryDate ?? null),
      supplierId,
      supplierName,
      consignedQty: parseDecimalString(input.consignedQty ?? null),
      consignedOwner: (input.consignedOwner ?? "").trim() || null,
      storageLocation: (input.storageLocation ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
      docUrl: (input.docUrl ?? "").trim() || null,
    },
  };
}

type ExistingMaterial = {
  id: number;
  name: string;
  division: Division;
  categoryId: number;
  unit: string;
  purchasePrice: string | null;
  stockQty: string;
  lastInventoryDate: Date | null;
  supplierId: number | null;
  consignedQty: string | null;
  consignedOwner: string | null;
  storageLocation: string | null;
  notes: string | null;
  docUrl: string | null;
};

async function fetchExistingByNameDivision(
  keys: { name: string; division: Division }[],
): Promise<Map<string, ExistingMaterial>> {
  if (keys.length === 0) return new Map();
  const names = Array.from(new Set(keys.map((k) => k.name)));
  const records = await prisma.material.findMany({
    where: { name: { in: names } },
  });
  const map = new Map<string, ExistingMaterial>();
  for (const r of records) {
    const e: ExistingMaterial = {
      id: r.id,
      name: r.name,
      division: r.division,
      categoryId: r.categoryId,
      unit: r.unit,
      purchasePrice: r.purchasePrice == null ? null : r.purchasePrice.toString(),
      stockQty: r.stockQty.toString(),
      lastInventoryDate: r.lastInventoryDate,
      supplierId: r.supplierId,
      consignedQty: r.consignedQty == null ? null : r.consignedQty.toString(),
      consignedOwner: r.consignedOwner,
      storageLocation: r.storageLocation,
      notes: r.notes,
      docUrl: r.docUrl,
    };
    map.set(`${r.division}|${r.name}`, e);
  }
  return map;
}

function dateToISO(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function diffChangedExceptStock(
  current: ExistingMaterial,
  incoming: NormalizedMaterial,
): boolean {
  if (current.categoryId !== incoming.categoryId) return true;
  if (current.unit !== incoming.unit) return true;
  if ((current.purchasePrice ?? null) !== (incoming.purchasePrice ?? null))
    return true;
  if (
    dateToISO(current.lastInventoryDate) !==
    dateToISO(incoming.lastInventoryDate)
  )
    return true;
  if ((current.supplierId ?? null) !== (incoming.supplierId ?? null))
    return true;
  if ((current.consignedQty ?? null) !== (incoming.consignedQty ?? null))
    return true;
  if ((current.consignedOwner ?? null) !== (incoming.consignedOwner ?? null))
    return true;
  if ((current.storageLocation ?? null) !== (incoming.storageLocation ?? null))
    return true;
  if ((current.notes ?? null) !== (incoming.notes ?? null)) return true;
  if ((current.docUrl ?? null) !== (incoming.docUrl ?? null)) return true;
  return false;
}

export async function dryRunMaterials(
  rows: MaterialInputRow[],
): Promise<DryRunResult> {
  const ctx = await buildContext();
  const result: DryRunRow[] = [];
  let newCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let errorCount = 0;

  const validated = rows.map((r) => normalizeRow(r, ctx));
  const keys = validated
    .map((v) => (v.ok ? { name: v.data.name, division: v.data.division } : null))
    .filter((k): k is { name: string; division: Division } => k !== null);
  const existingMap = await fetchExistingByNameDivision(keys);

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      result.push({
        rowIndex,
        status: "error",
        key: (rows[i].name ?? "").trim(),
        message: v.message,
        incoming: rows[i] as Record<string, unknown>,
      });
      errorCount++;
      continue;
    }
    const incoming = v.data;
    const k = `${incoming.division}|${incoming.name}`;
    const current = existingMap.get(k);
    const key = `${incoming.name}（${DIVISION_LABEL[incoming.division]}）`;
    if (!current) {
      result.push({
        rowIndex,
        status: "new",
        key,
        incoming: incoming as unknown as Record<string, unknown>,
      });
      newCount++;
    } else {
      const stockDiff =
        incoming.stockQty != null &&
        Number(incoming.stockQty) !== Number(current.stockQty);
      const otherChanged = diffChangedExceptStock(current, incoming);
      const changed = stockDiff || otherChanged;
      result.push({
        rowIndex,
        status: changed ? "update" : "unchanged",
        key,
        incoming: incoming as unknown as Record<string, unknown>,
        current: {
          stockQty: current.stockQty,
          purchasePrice: current.purchasePrice,
          unit: current.unit,
        },
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

export async function commitMaterials(
  rows: MaterialInputRow[],
): Promise<CommitResult> {
  const ctx = await buildContext();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { rowIndex: number; message: string }[] = [];

  const validated = rows.map((r) => normalizeRow(r, ctx));
  const keys = validated
    .map((v) => (v.ok ? { name: v.data.name, division: v.data.division } : null))
    .filter((k): k is { name: string; division: Division } => k !== null);
  const existingMap = await fetchExistingByNameDivision(keys);

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      errors.push({ rowIndex, message: v.message });
      continue;
    }
    const incoming = v.data;
    const k = `${incoming.division}|${incoming.name}`;
    const current = existingMap.get(k);

    try {
      if (!current) {
        // 新規作成。stockQty が指定されていれば、StockTransaction(INVENTORY_ADJUST) と同時に反映。
        await prisma.$transaction(async (tx) => {
          const stockQty = incoming.stockQty != null ? incoming.stockQty : "0";
          const m = await tx.material.create({
            data: {
              name: incoming.name,
              division: incoming.division,
              categoryId: incoming.categoryId,
              unit: incoming.unit,
              purchasePrice: incoming.purchasePrice,
              stockQty,
              lastInventoryDate: incoming.lastInventoryDate,
              supplierId: incoming.supplierId,
              consignedQty: incoming.consignedQty,
              consignedOwner: incoming.consignedOwner,
              storageLocation: incoming.storageLocation,
              notes: incoming.notes,
              docUrl: incoming.docUrl,
            },
          });
          if (incoming.stockQty != null && Number(incoming.stockQty) !== 0) {
            await tx.stockTransaction.create({
              data: {
                materialId: m.id,
                occurredAt: incoming.lastInventoryDate ?? new Date(),
                qty: incoming.stockQty,
                reason: "INVENTORY_ADJUST",
                notes: "CSVインポートによる初期在庫登録",
              },
            });
          }
        });
        created++;
      } else {
        const stockDiff =
          incoming.stockQty != null &&
          Number(incoming.stockQty) !== Number(current.stockQty);
        const otherChanged = diffChangedExceptStock(current, incoming);
        if (!stockDiff && !otherChanged) {
          skipped++;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          // 在庫以外の更新
          await tx.material.update({
            where: { id: current.id },
            data: {
              categoryId: incoming.categoryId,
              unit: incoming.unit,
              purchasePrice: incoming.purchasePrice,
              lastInventoryDate: incoming.lastInventoryDate,
              supplierId: incoming.supplierId,
              consignedQty: incoming.consignedQty,
              consignedOwner: incoming.consignedOwner,
              storageLocation: incoming.storageLocation,
              notes: incoming.notes,
              docUrl: incoming.docUrl,
            },
          });
          // 在庫差分があれば StockTransaction で反映
          if (stockDiff && incoming.stockQty != null) {
            const delta = (
              Number(incoming.stockQty) - Number(current.stockQty)
            ).toString();
            await tx.stockTransaction.create({
              data: {
                materialId: current.id,
                occurredAt: incoming.lastInventoryDate ?? new Date(),
                qty: delta,
                reason: "INVENTORY_ADJUST",
                notes: "CSVインポートによる棚卸調整",
              },
            });
            await tx.material.update({
              where: { id: current.id },
              data: { stockQty: incoming.stockQty },
            });
          }
        });
        updated++;
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
