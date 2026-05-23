import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Division, Prisma } from "@prisma/client";
import { csvBody, csvResponse, todayStamp } from "@/lib/csv-export";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

function parseDivision(v: string | null): Division | undefined {
  if (v === "RAW" || v === "PACKAGING" || v === "PRODUCT") return v;
  return undefined;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function decStr(v: Prisma.Decimal | null): string {
  if (v == null) return "";
  return v.toString();
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const division = parseDivision(url.searchParams.get("division"));
  const categoryIdRaw = url.searchParams.get("categoryId");
  const categoryId =
    categoryIdRaw && categoryIdRaw !== "" ? Number(categoryIdRaw) : undefined;

  const where: Prisma.MaterialWhereInput = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (division) where.division = division;
  if (categoryId && Number.isFinite(categoryId)) where.categoryId = categoryId;

  const materials = await prisma.material.findMany({
    where,
    include: { category: true, supplier: true },
    orderBy: [{ division: "asc" }, { name: "asc" }],
  });

  const headers = [
    "名称",
    "区分",
    "カテゴリ",
    "単位",
    "購入単価",
    "在庫数量",
    "最終棚卸日",
    "発注先",
    "預かり在庫数量",
    "預かり元",
    "保管場所",
    "備考",
    "資料URL",
  ];

  const rows: (string | number | null | undefined)[][] = [headers];
  for (const m of materials) {
    rows.push([
      m.name,
      DIVISION_LABEL[m.division],
      m.category.name,
      m.unit,
      decStr(m.purchasePrice),
      decStr(m.stockQty),
      fmtDate(m.lastInventoryDate),
      m.supplier?.companyName ?? "",
      decStr(m.consignedQty),
      m.consignedOwner ?? "",
      m.storageLocation ?? "",
      m.notes ?? "",
      m.docUrl ?? "",
    ]);
  }

  return csvResponse(csvBody(rows), `materials_${todayStamp()}.csv`);
}
