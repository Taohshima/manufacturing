"use server";

import { prisma } from "@/lib/prisma";
import {
  parseDecimalString,
  parseIntSafe,
  type CommitResult,
  type DryRunResult,
  type DryRunRow,
} from "@/lib/csv";
import type { Division } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// 製品マスタの取込
// ─────────────────────────────────────────────────────────────

export type ProductField =
  | "salesName"
  | "genericName"
  | "standardNo"
  | "capacity"
  | "capacityUnit"
  | "controlDivision"
  | "expiryMonths"
  | "caseCount"
  | "storageLocation"
  | "salesPrice"
  | "productCost"
  | "stockQty";

type ProductInputRow = Partial<Record<ProductField, string | null>>;

type NormalizedProduct = {
  salesName: string;
  capacity: string;
  capacityUnit: string;
  genericName: string | null;
  standardNo: string | null;
  controlDivision: string | null;
  expiryMonths: number | null;
  caseCount: number | null;
  storageLocation: string | null;
  salesPrice: string | null;
  productCost: string | null;
  stockQty: string | null;
};

function normalizeProductRow(
  input: ProductInputRow,
): { ok: true; data: NormalizedProduct } | { ok: false; message: string } {
  const salesName = (input.salesName ?? "").trim();
  if (!salesName) return { ok: false, message: "販売名が空です" };
  const capacity = parseDecimalString(input.capacity ?? null);
  if (capacity == null) return { ok: false, message: "容量が空または数値でありません" };
  const capacityUnit = (input.capacityUnit ?? "").trim();
  if (!capacityUnit) return { ok: false, message: "容量単位が空です" };

  return {
    ok: true,
    data: {
      salesName,
      capacity,
      capacityUnit,
      genericName: (input.genericName ?? "").trim() || null,
      standardNo: (input.standardNo ?? "").trim() || null,
      controlDivision: (input.controlDivision ?? "").trim() || null,
      expiryMonths: parseIntSafe(input.expiryMonths ?? null),
      caseCount: parseIntSafe(input.caseCount ?? null),
      storageLocation: (input.storageLocation ?? "").trim() || null,
      salesPrice: parseDecimalString(input.salesPrice ?? null),
      productCost: parseDecimalString(input.productCost ?? null),
      stockQty: parseDecimalString(input.stockQty ?? null),
    },
  };
}

const PRODUCT_COMPARED_FIELDS: (keyof NormalizedProduct)[] = [
  "capacity",
  "capacityUnit",
  "genericName",
  "standardNo",
  "controlDivision",
  "expiryMonths",
  "caseCount",
  "storageLocation",
  "salesPrice",
  "productCost",
  "stockQty",
];

function productChanged(
  current: Record<string, unknown>,
  incoming: NormalizedProduct,
): boolean {
  for (const k of PRODUCT_COMPARED_FIELDS) {
    const a = current[k];
    const b = incoming[k];
    if (a == null && b == null) continue;
    if (a == null || b == null) return true;
    // Decimal は toString 比較、それ以外は厳密一致
    if (typeof a === "object" && a !== null && "toString" in a) {
      if (a.toString() !== String(b)) return true;
    } else if (String(a) !== String(b)) {
      return true;
    }
  }
  return false;
}

export async function dryRunProducts(
  rows: ProductInputRow[],
): Promise<DryRunResult> {
  const validated = rows.map(normalizeProductRow);
  const names = validated
    .filter((v): v is { ok: true; data: NormalizedProduct } => v.ok)
    .map((v) => v.data.salesName);
  const existing = await prisma.product.findMany({
    where: { salesName: { in: names } },
  });
  const map = new Map(existing.map((p) => [p.salesName, p]));

  const out: DryRunRow[] = [];
  let newCount = 0,
    updateCount = 0,
    unchangedCount = 0,
    errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      out.push({
        rowIndex,
        status: "error",
        key: (rows[i].salesName ?? "").trim(),
        message: v.message,
        incoming: rows[i] as Record<string, unknown>,
      });
      errorCount++;
      continue;
    }
    const incoming = v.data;
    const current = map.get(incoming.salesName);
    if (!current) {
      out.push({
        rowIndex,
        status: "new",
        key: incoming.salesName,
        incoming: incoming as unknown as Record<string, unknown>,
      });
      newCount++;
    } else {
      const changed = productChanged(
        current as unknown as Record<string, unknown>,
        incoming,
      );
      out.push({
        rowIndex,
        status: changed ? "update" : "unchanged",
        key: incoming.salesName,
        incoming: incoming as unknown as Record<string, unknown>,
        current: {
          capacity: current.capacity,
          capacityUnit: current.capacityUnit,
          salesPrice: current.salesPrice,
          stockQty: current.stockQty,
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
    rows: out,
  };
}

export async function commitProducts(
  rows: ProductInputRow[],
): Promise<CommitResult> {
  let created = 0,
    updated = 0,
    skipped = 0;
  const errors: { rowIndex: number; message: string }[] = [];

  const validated = rows.map(normalizeProductRow);
  const names = validated
    .filter((v): v is { ok: true; data: NormalizedProduct } => v.ok)
    .map((v) => v.data.salesName);
  const existing = await prisma.product.findMany({
    where: { salesName: { in: names } },
  });
  const map = new Map(existing.map((p) => [p.salesName, p]));

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      errors.push({ rowIndex, message: v.message });
      continue;
    }
    const incoming = v.data;
    try {
      const current = map.get(incoming.salesName);
      if (!current) {
        await prisma.product.create({ data: incoming });
        created++;
      } else if (
        productChanged(current as unknown as Record<string, unknown>, incoming)
      ) {
        await prisma.product.update({
          where: { id: current.id },
          data: {
            capacity: incoming.capacity,
            capacityUnit: incoming.capacityUnit,
            genericName: incoming.genericName,
            standardNo: incoming.standardNo,
            controlDivision: incoming.controlDivision,
            expiryMonths: incoming.expiryMonths,
            caseCount: incoming.caseCount,
            storageLocation: incoming.storageLocation,
            salesPrice: incoming.salesPrice,
            productCost: incoming.productCost,
            stockQty: incoming.stockQty,
          },
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

// ─────────────────────────────────────────────────────────────
// 配合(BOM) の取込
// ─────────────────────────────────────────────────────────────

export type RecipeField =
  | "productSalesName"
  | "materialName"
  | "materialDivision"
  | "usageQty"
  | "usageUnit"
  | "sortOrder";

type RecipeInputRow = Partial<Record<RecipeField, string | null>>;

type NormalizedRecipe = {
  productSalesName: string;
  productId: number;
  materialId: number;
  materialName: string;
  materialDivision: Division;
  materialUnit: string;
  usageQty: string;
  usageUnit: string;
  sortOrder: number;
};

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

function parseMaterialDivision(v: string | null | undefined): Division | null {
  if (v == null) return null;
  const s = v.trim();
  if (s === "RAW" || s === "原料" || s.toLowerCase() === "raw") return "RAW";
  if (s === "PACKAGING" || s === "資材" || s === "包装資材" || s.toLowerCase() === "packaging") return "PACKAGING";
  return null;
}

type RecipeLookup = {
  productMap: Map<string, number>; // salesName -> id
  materialMap: Map<string, { id: number; unit: string }>; // `${division}|${name}` -> id, unit
};

async function buildRecipeLookup(): Promise<RecipeLookup> {
  const [products, materials] = await Promise.all([
    prisma.product.findMany({ select: { id: true, salesName: true } }),
    prisma.material.findMany({
      where: { division: { in: ["RAW", "PACKAGING"] } },
      select: { id: true, name: true, division: true, unit: true },
    }),
  ]);
  const productMap = new Map<string, number>();
  for (const p of products) productMap.set(p.salesName, p.id);
  const materialMap = new Map<string, { id: number; unit: string }>();
  for (const m of materials) {
    materialMap.set(`${m.division}|${m.name}`, { id: m.id, unit: m.unit });
  }
  return { productMap, materialMap };
}

function normalizeRecipeRow(
  input: RecipeInputRow,
  lookup: RecipeLookup,
): { ok: true; data: NormalizedRecipe } | { ok: false; message: string } {
  const productSalesName = (input.productSalesName ?? "").trim();
  if (!productSalesName) return { ok: false, message: "製品販売名が空です" };
  const productId = lookup.productMap.get(productSalesName);
  if (productId == null) {
    return {
      ok: false,
      message: `製品「${productSalesName}」がマスタに存在しません`,
    };
  }

  const materialDivision = parseMaterialDivision(input.materialDivision ?? null);
  if (!materialDivision) {
    return {
      ok: false,
      message: `材料の区分「${input.materialDivision ?? ""}」を解釈できません（原料/資材）`,
    };
  }
  const materialName = (input.materialName ?? "").trim();
  if (!materialName) return { ok: false, message: "材料名が空です" };
  const mat = lookup.materialMap.get(`${materialDivision}|${materialName}`);
  if (!mat) {
    return {
      ok: false,
      message: `材料「${materialName}」が ${DIVISION_LABEL[materialDivision]} 区分のマスタに存在しません`,
    };
  }

  const usageQty = parseDecimalString(input.usageQty ?? null);
  if (usageQty == null) {
    return { ok: false, message: "利用量が空または数値でありません" };
  }
  const usageUnit = (input.usageUnit ?? "").trim() || mat.unit;
  const sortOrder = parseIntSafe(input.sortOrder ?? null) ?? 0;

  return {
    ok: true,
    data: {
      productSalesName,
      productId,
      materialId: mat.id,
      materialName,
      materialDivision,
      materialUnit: mat.unit,
      usageQty,
      usageUnit,
      sortOrder,
    },
  };
}

function recipeKey(r: NormalizedRecipe): string {
  return `${r.productSalesName} ← ${DIVISION_LABEL[r.materialDivision]}/${r.materialName}`;
}

export async function dryRunRecipes(
  rows: RecipeInputRow[],
): Promise<DryRunResult> {
  const lookup = await buildRecipeLookup();
  const validated = rows.map((r) => normalizeRecipeRow(r, lookup));

  const pairs = validated
    .filter((v): v is { ok: true; data: NormalizedRecipe } => v.ok)
    .map((v) => ({ productId: v.data.productId, materialId: v.data.materialId }));

  const existingMap = new Map<
    string,
    { id: number; usageQty: unknown; usageUnit: string; sortOrder: number }
  >();
  if (pairs.length > 0) {
    const existing = await prisma.productRecipe.findMany({
      where: {
        OR: pairs.map((p) => ({
          productId: p.productId,
          materialId: p.materialId,
        })),
      },
    });
    for (const r of existing) {
      existingMap.set(`${r.productId}|${r.materialId}`, r);
    }
  }

  const out: DryRunRow[] = [];
  let newCount = 0,
    updateCount = 0,
    unchangedCount = 0,
    errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      out.push({
        rowIndex,
        status: "error",
        key: `${(rows[i].productSalesName ?? "").trim()} ← ${(rows[i].materialName ?? "").trim()}`,
        message: v.message,
        incoming: rows[i] as Record<string, unknown>,
      });
      errorCount++;
      continue;
    }
    const incoming = v.data;
    const current = existingMap.get(`${incoming.productId}|${incoming.materialId}`);
    const key = recipeKey(incoming);
    if (!current) {
      out.push({
        rowIndex,
        status: "new",
        key,
        incoming: incoming as unknown as Record<string, unknown>,
      });
      newCount++;
    } else {
      const qtyChanged =
        String((current.usageQty as { toString(): string }).toString()) !==
        incoming.usageQty;
      const unitChanged = current.usageUnit !== incoming.usageUnit;
      const sortChanged = current.sortOrder !== incoming.sortOrder;
      const changed = qtyChanged || unitChanged || sortChanged;
      out.push({
        rowIndex,
        status: changed ? "update" : "unchanged",
        key,
        incoming: incoming as unknown as Record<string, unknown>,
        current: {
          usageQty: current.usageQty,
          usageUnit: current.usageUnit,
          sortOrder: current.sortOrder,
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
    rows: out,
  };
}

export async function commitRecipes(
  rows: RecipeInputRow[],
): Promise<CommitResult> {
  const lookup = await buildRecipeLookup();
  let created = 0,
    updated = 0,
    skipped = 0;
  const errors: { rowIndex: number; message: string }[] = [];

  const validated = rows.map((r) => normalizeRecipeRow(r, lookup));

  // 既存の (productId, materialId) を事前に取得
  const pairs = validated
    .filter((v): v is { ok: true; data: NormalizedRecipe } => v.ok)
    .map((v) => ({ productId: v.data.productId, materialId: v.data.materialId }));
  const existingMap = new Map<
    string,
    { usageQty: unknown; usageUnit: string; sortOrder: number }
  >();
  if (pairs.length > 0) {
    const existing = await prisma.productRecipe.findMany({
      where: {
        OR: pairs.map((p) => ({ productId: p.productId, materialId: p.materialId })),
      },
      select: {
        productId: true,
        materialId: true,
        usageQty: true,
        usageUnit: true,
        sortOrder: true,
      },
    });
    for (const e of existing) {
      existingMap.set(`${e.productId}|${e.materialId}`, {
        usageQty: e.usageQty,
        usageUnit: e.usageUnit,
        sortOrder: e.sortOrder,
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 1;
    const v = validated[i];
    if (!v.ok) {
      errors.push({ rowIndex, message: v.message });
      continue;
    }
    const incoming = v.data;
    const current = existingMap.get(`${incoming.productId}|${incoming.materialId}`);

    try {
      if (!current) {
        await prisma.productRecipe.create({
          data: {
            productId: incoming.productId,
            materialId: incoming.materialId,
            usageQty: incoming.usageQty,
            usageUnit: incoming.usageUnit,
            sortOrder: incoming.sortOrder,
          },
        });
        created++;
      } else {
        const changed =
          (current.usageQty as { toString(): string }).toString() !==
            incoming.usageQty ||
          current.usageUnit !== incoming.usageUnit ||
          current.sortOrder !== incoming.sortOrder;
        if (!changed) {
          skipped++;
          continue;
        }
        await prisma.productRecipe.update({
          where: {
            productId_materialId: {
              productId: incoming.productId,
              materialId: incoming.materialId,
            },
          },
          data: {
            usageQty: incoming.usageQty,
            usageUnit: incoming.usageUnit,
            sortOrder: incoming.sortOrder,
          },
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
