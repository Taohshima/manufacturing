import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  Division,
  Prisma,
  StockTransactionReason,
} from "@prisma/client";

const REASON_LABEL: Record<StockTransactionReason, string> = {
  PURCHASE_ARRIVAL: "発注到着",
  MANUFACTURING_USE: "製造消費",
  INVENTORY_ADJUST: "棚卸調整",
  MANUAL: "手動補正",
};

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

function parseReason(v: string | null): StockTransactionReason | undefined {
  if (
    v === "PURCHASE_ARRIVAL" ||
    v === "MANUFACTURING_USE" ||
    v === "INVENTORY_ADJUST" ||
    v === "MANUAL"
  )
    return v;
  return undefined;
}

function escapeCsv(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const materialIdRaw = url.searchParams.get("materialId");
  const materialId =
    materialIdRaw && materialIdRaw !== "" ? Number(materialIdRaw) : undefined;
  const reason = parseReason(url.searchParams.get("reason"));
  const direction = url.searchParams.get("direction");

  const occurredAt: Prisma.DateTimeFilter = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) occurredAt.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      const toExclusive = new Date(d);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
      occurredAt.lt = toExclusive;
    }
  }
  const where: Prisma.StockTransactionWhereInput = {};
  if (Object.keys(occurredAt).length > 0) where.occurredAt = occurredAt;
  if (reason) where.reason = reason;
  if (materialId && Number.isFinite(materialId)) where.materialId = materialId;
  if (direction === "in") where.qty = { gt: 0 };
  if (direction === "out") where.qty = { lt: 0 };

  const transactions = await prisma.stockTransaction.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    include: {
      material: { include: { category: true } },
      purchaseOrder: { include: { supplier: true } },
      manufacturingOrder: { include: { product: true } },
    },
  });

  const headers = [
    "発生日",
    "区分",
    "カテゴリ",
    "資材名",
    "単位",
    "増減",
    "理由",
    "起源種別",
    "起源ID",
    "取引先または製品",
    "ロット番号",
    "メモ",
  ];

  const rows: string[] = [headers.join(",")];
  for (const t of transactions) {
    const sourceType = t.purchaseOrder
      ? "発注"
      : t.manufacturingOrder
        ? "指図"
        : "";
    const sourceId = t.purchaseOrder
      ? t.purchaseOrder.id
      : t.manufacturingOrder
        ? t.manufacturingOrder.id
        : "";
    const sourceName = t.purchaseOrder
      ? t.purchaseOrder.supplier.companyName
      : t.manufacturingOrder
        ? t.manufacturingOrder.product.salesName
        : "";
    const lot = t.manufacturingOrder?.lotNumber ?? "";

    rows.push(
      [
        escapeCsv(fmtDate(t.occurredAt)),
        escapeCsv(DIVISION_LABEL[t.material.division]),
        escapeCsv(t.material.category.name),
        escapeCsv(t.material.name),
        escapeCsv(t.material.unit),
        escapeCsv(Number(t.qty)),
        escapeCsv(REASON_LABEL[t.reason]),
        escapeCsv(sourceType),
        escapeCsv(sourceId),
        escapeCsv(sourceName),
        escapeCsv(lot),
        escapeCsv(t.notes ?? ""),
      ].join(","),
    );
  }

  // BOM 付きで返す（Excelで開いたときの日本語文字化けを防止）
  const body = "﻿" + rows.join("\r\n") + "\r\n";

  const fromName = from || "all";
  const toName = to || "all";
  const filename = `stock-transactions_${fromName}_${toName}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
