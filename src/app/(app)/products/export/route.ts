import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { csvBody, csvResponse, todayStamp } from "@/lib/csv-export";

function decStr(v: Prisma.Decimal | null): string {
  if (v == null) return "";
  return v.toString();
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = url.searchParams.get("mode"); // "products" | "recipes"

  if (mode === "recipes") {
    return exportRecipes(q);
  }
  return exportProducts(q);
}

async function exportProducts(q: string) {
  const where: Prisma.ProductWhereInput = q
    ? {
        OR: [
          { salesName: { contains: q, mode: "insensitive" } },
          { genericName: { contains: q, mode: "insensitive" } },
          { standardNo: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const products = await prisma.product.findMany({
    where,
    orderBy: { salesName: "asc" },
  });

  const headers = [
    "販売名",
    "一般名称",
    "基準番号",
    "容量",
    "容量単位",
    "管理区分",
    "使用期限",
    "ケース入数",
    "保管場所",
    "販売価格",
    "製品原価",
    "在庫数",
  ];

  const rows: (string | number | null | undefined)[][] = [headers];
  for (const p of products) {
    rows.push([
      p.salesName,
      p.genericName ?? "",
      p.standardNo ?? "",
      decStr(p.capacity),
      p.capacityUnit,
      p.controlDivision ?? "",
      p.expiryMonths ?? "",
      p.caseCount ?? "",
      p.storageLocation ?? "",
      decStr(p.salesPrice),
      decStr(p.productCost),
      decStr(p.stockQty),
    ]);
  }
  return csvResponse(csvBody(rows), `products_${todayStamp()}.csv`);
}

async function exportRecipes(q: string) {
  const where: Prisma.ProductRecipeWhereInput = q
    ? {
        product: {
          OR: [
            { salesName: { contains: q, mode: "insensitive" } },
            { genericName: { contains: q, mode: "insensitive" } },
            { standardNo: { contains: q, mode: "insensitive" } },
          ],
        },
      }
    : {};

  const recipes = await prisma.productRecipe.findMany({
    where,
    orderBy: [
      { product: { salesName: "asc" } },
      { sortOrder: "asc" },
      { id: "asc" },
    ],
    include: { product: true, material: true },
  });

  const headers = [
    "製品販売名",
    "材料名",
    "材料区分",
    "利用量",
    "利用単位",
    "順序",
  ];

  const divisionLabel = (d: string) =>
    d === "RAW" ? "原料" : d === "PACKAGING" ? "資材" : "製品";

  const rows: (string | number | null | undefined)[][] = [headers];
  for (const r of recipes) {
    rows.push([
      r.product.salesName,
      r.material.name,
      divisionLabel(r.material.division),
      decStr(r.usageQty),
      r.usageUnit,
      r.sortOrder,
    ]);
  }
  return csvResponse(csvBody(rows), `recipes_${todayStamp()}.csv`);
}
