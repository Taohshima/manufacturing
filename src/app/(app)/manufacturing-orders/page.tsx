import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ManufacturingOrderStatus, Prisma } from "@prisma/client";

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  PLANNED: "予定",
  IN_PROGRESS: "進行中",
  COMPLETED: "完了",
  CANCELLED: "キャンセル",
};

const STATUS_STYLE: Record<ManufacturingOrderStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

const STATUSES: ManufacturingOrderStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

function parseStatus(v: string | undefined): ManufacturingOrderStatus | undefined {
  if (
    v === "PLANNED" ||
    v === "IN_PROGRESS" ||
    v === "COMPLETED" ||
    v === "CANCELLED"
  ) {
    return v;
  }
  return undefined;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export default async function ManufacturingOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const status = parseStatus(params.status);

  const where: Prisma.ManufacturingOrderWhereInput = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { lotNumber: { contains: q, mode: "insensitive" } },
      { product: { salesName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.manufacturingOrder.findMany({
      where,
      orderBy: [{ instructedAt: "desc" }, { id: "desc" }],
      include: { product: true },
      take: 500,
    }),
    prisma.manufacturingOrder.count(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">製造指示</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録 {total} 件
            {q || status ? `／ 絞り込み結果 ${orders.length} 件` : null}
          </p>
        </div>
        <Link
          href="/manufacturing-orders/new"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          新規指図
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          検索（販売名・ロット番号）
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="製品名やロット番号"
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
            href="/manufacturing-orders"
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
              <th className="px-3 py-2 font-medium">指図日</th>
              <th className="px-3 py-2 font-medium">予定日</th>
              <th className="px-3 py-2 font-medium">製品</th>
              <th className="px-3 py-2 font-medium">ロット</th>
              <th className="px-3 py-2 text-right font-medium">予定数量</th>
              <th className="px-3 py-2 font-medium">状態</th>
              <th className="px-3 py-2 font-medium">指図者</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  該当する指図がありません。
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(o.instructedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(o.scheduledAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/manufacturing-orders/${o.id}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {o.product.salesName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {o.lotNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {Number(o.plannedQty).toLocaleString("ja-JP", {
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status]}`}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {o.instructor ?? "—"}
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
