import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma, PurchaseOrderStatus } from "@prisma/client";

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  PLANNED: "未発注",
  ORDERED: "発注済",
  ARRIVED: "到着済",
  CANCELLED: "キャンセル",
};

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  ORDERED: "bg-blue-100 text-blue-800",
  ARRIVED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

const STATUSES: PurchaseOrderStatus[] = ["PLANNED", "ORDERED", "ARRIVED", "CANCELLED"];

function parseStatus(v: string | undefined): PurchaseOrderStatus | undefined {
  if (v === "PLANNED" || v === "ORDERED" || v === "ARRIVED" || v === "CANCELLED") {
    return v;
  }
  return undefined;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtQty(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function fmtPrice(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return `¥${Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const status = parseStatus(params.status);

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { material: { name: { contains: q, mode: "insensitive" } } },
      { supplier: { companyName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [
        { expectedArrivalAt: { sort: "asc", nulls: "last" } },
        { id: "desc" },
      ],
      include: { material: true, supplier: true },
      take: 500,
    }),
    prisma.purchaseOrder.count(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">資材発注</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録 {total} 件
            {q || status ? `／ 絞り込み結果 ${orders.length} 件` : null}
          </p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          新規発注
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          検索（資材名・取引先名）
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="資材名や取引先名"
            className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          状態
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          絞り込み
        </button>
        {q || status ? (
          <Link
            href="/purchase-orders"
            className="px-2 py-2 text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            クリア
          </Link>
        ) : null}
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">到着予定</th>
              <th className="px-3 py-2 font-medium">状態</th>
              <th className="px-3 py-2 font-medium">資材</th>
              <th className="px-3 py-2 font-medium">取引先</th>
              <th className="px-3 py-2 text-right font-medium">発注数量</th>
              <th className="px-3 py-2 text-right font-medium">単価</th>
              <th className="px-3 py-2 font-medium">発注日</th>
              <th className="px-3 py-2 font-medium">到着日</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  該当する発注がありません。
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(o.expectedArrivalAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status]}`}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/purchase-orders/${o.id}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {o.material.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{o.supplier.companyName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtQty(o.orderedQty)} {o.material.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtPrice(o.unitPrice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(o.orderedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(o.arrivedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
