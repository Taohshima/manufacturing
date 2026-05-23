import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { csvBody, csvResponse } from "@/lib/csv-export";

function startOfMonth(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1));
}
function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const ymRaw = url.searchParams.get("ym") ?? "";
  const ym = /^\d{4}-\d{2}$/.test(ymRaw)
    ? ymRaw
    : (() => {
        const d = new Date();
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      })();
  const monthStart = startOfMonth(ym);
  const monthEnd = startOfNextMonth(monthStart);

  const [completedOrders, purchaseOrders, consumptions] = await Promise.all([
    prisma.manufacturingOrder.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { packagedAt: { gte: monthStart, lt: monthEnd } },
          { packagedAt: null, updatedAt: { gte: monthStart, lt: monthEnd } },
        ],
      },
      include: { product: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { orderedAt: { gte: monthStart, lt: monthEnd } },
          {
            orderedAt: null,
            createdAt: { gte: monthStart, lt: monthEnd },
          },
        ],
      },
      include: { supplier: true, material: true },
    }),
    prisma.stockTransaction.findMany({
      where: {
        reason: "MANUFACTURING_USE",
        occurredAt: { gte: monthStart, lt: monthEnd },
      },
      include: { material: true },
    }),
  ]);

  const rows: (string | number | null)[][] = [];

  rows.push(["月次レポート", ym]);
  rows.push([]);

  // 製品別 製造完了
  rows.push(["[製品別 製造完了サマリ]"]);
  rows.push(["製品", "件数", "完了数量"]);
  const productMap = new Map<
    number,
    { salesName: string; count: number; qty: number }
  >();
  for (const o of completedOrders) {
    const cur = productMap.get(o.productId) ?? {
      salesName: o.product.salesName,
      count: 0,
      qty: 0,
    };
    cur.count += 1;
    cur.qty += Number(o.completedQty != null ? o.completedQty : o.plannedQty);
    productMap.set(o.productId, cur);
  }
  for (const r of [...productMap.values()].sort((a, b) => b.qty - a.qty)) {
    rows.push([r.salesName, r.count, r.qty]);
  }
  rows.push([]);

  // 取引先別 発注額
  rows.push(["[取引先別 発注額]"]);
  rows.push(["取引先", "件数", "発注額"]);
  const supplierMap = new Map<
    number,
    { name: string; count: number; amount: number }
  >();
  for (const p of purchaseOrders) {
    const cur = supplierMap.get(p.supplierId) ?? {
      name: p.supplier.companyName,
      count: 0,
      amount: 0,
    };
    cur.count += 1;
    if (p.unitPrice != null) {
      cur.amount += Number(p.unitPrice) * Number(p.orderedQty);
    }
    supplierMap.set(p.supplierId, cur);
  }
  for (const r of [...supplierMap.values()].sort(
    (a, b) => b.amount - a.amount,
  )) {
    rows.push([r.name, r.count, r.amount]);
  }
  rows.push([]);

  // 原料消費
  rows.push(["[原料消費トップ]"]);
  rows.push(["資材・原料", "消費量", "単位", "消費金額"]);
  const consumptionMap = new Map<
    number,
    { name: string; unit: string; qty: number; amount: number }
  >();
  for (const c of consumptions) {
    const cur = consumptionMap.get(c.materialId) ?? {
      name: c.material.name,
      unit: c.material.unit,
      qty: 0,
      amount: 0,
    };
    const consumed = -Number(c.qty);
    cur.qty += consumed;
    if (c.material.purchasePrice != null) {
      cur.amount += consumed * Number(c.material.purchasePrice);
    }
    consumptionMap.set(c.materialId, cur);
  }
  for (const r of [...consumptionMap.values()].sort(
    (a, b) => b.amount - a.amount,
  )) {
    rows.push([r.name, r.qty, r.unit, r.amount]);
  }

  return csvResponse(csvBody(rows), `report_${ym}.csv`);
}
