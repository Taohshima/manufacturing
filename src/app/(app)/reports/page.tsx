import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function startOfMonth(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1));
}
function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
function currentMonthYM(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 0; i < n; i++) {
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function fmtPrice(n: number): string {
  return `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
}
function fmtQty(n: number): string {
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const sp = await searchParams;
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : currentMonthYM();
  const monthStart = startOfMonth(ym);
  const monthEnd = startOfNextMonth(monthStart);

  // 製造関連
  const [
    completedOrders,
    instructedCount,
    cancelledCount,
    purchaseOrders,
    arrivals,
    consumptions,
  ] = await Promise.all([
    prisma.manufacturingOrder.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { packagedAt: { gte: monthStart, lt: monthEnd } },
          {
            packagedAt: null,
            updatedAt: { gte: monthStart, lt: monthEnd },
          },
        ],
      },
      include: { product: true },
    }),
    prisma.manufacturingOrder.count({
      where: { instructedAt: { gte: monthStart, lt: monthEnd } },
    }),
    prisma.manufacturingOrder.count({
      where: {
        status: "CANCELLED",
        updatedAt: { gte: monthStart, lt: monthEnd },
      },
    }),
    // 当月の発注（orderedAt があればそれ、なければ createdAt で判定）
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
    prisma.purchaseOrder.findMany({
      where: {
        status: "ARRIVED",
        arrivedAt: { gte: monthStart, lt: monthEnd },
      },
      include: { supplier: true, material: true },
    }),
    // 原料消費（MANUFACTURING_USE のstockTransaction）
    prisma.stockTransaction.findMany({
      where: {
        reason: "MANUFACTURING_USE",
        occurredAt: { gte: monthStart, lt: monthEnd },
      },
      include: { material: { include: { category: true } } },
    }),
  ]);

  // KPI
  const completedCount = completedOrders.length;
  const completedQtyTotal = completedOrders.reduce(
    (sum, o) =>
      sum + Number(o.completedQty != null ? o.completedQty : o.plannedQty),
    0,
  );
  const orderTotalAmount = purchaseOrders.reduce((sum, p) => {
    if (p.unitPrice == null) return sum;
    return sum + Number(p.unitPrice) * Number(p.orderedQty);
  }, 0);
  const arrivalTotalAmount = arrivals.reduce((sum, p) => {
    const qty = p.arrivedQty != null ? Number(p.arrivedQty) : Number(p.orderedQty);
    if (p.unitPrice == null) return sum;
    return sum + Number(p.unitPrice) * qty;
  }, 0);

  // 製品別の完了サマリ
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
  const productRanking = [...productMap.values()].sort((a, b) => b.qty - a.qty);

  // 取引先別の発注額
  const supplierMap = new Map<
    number,
    { companyName: string; count: number; amount: number }
  >();
  for (const p of purchaseOrders) {
    const cur = supplierMap.get(p.supplierId) ?? {
      companyName: p.supplier.companyName,
      count: 0,
      amount: 0,
    };
    cur.count += 1;
    if (p.unitPrice != null) {
      cur.amount += Number(p.unitPrice) * Number(p.orderedQty);
    }
    supplierMap.set(p.supplierId, cur);
  }
  const supplierRanking = [...supplierMap.values()].sort(
    (a, b) => b.amount - a.amount,
  );

  // 材料消費トップ（消費量・金額）
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
    const consumed = -Number(c.qty); // 出庫は負なので反転
    cur.qty += consumed;
    if (c.material.purchasePrice != null) {
      cur.amount += consumed * Number(c.material.purchasePrice);
    }
    consumptionMap.set(c.materialId, cur);
  }
  const consumptionRanking = [...consumptionMap.values()].sort(
    (a, b) => b.amount - a.amount,
  );

  const months = recentMonths(12);

  // CSV出力URLは現在の対象月を引き継ぐ
  const csvUrl = `/reports/export?ym=${ym}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">月次レポート</h1>
          <p className="mt-1 text-sm text-slate-600">対象月：{ym}</p>
        </div>
        <div className="flex items-end gap-2">
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              対象月
              <select
                name="ym"
                defaultValue={ym}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600"
            >
              切替
            </button>
          </form>
          <a
            href={csvUrl}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            CSVで出力
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="指図件数" value={instructedCount.toString()} />
        <Tile
          label="製造完了"
          value={`${completedCount} 件 / ${fmtQty(completedQtyTotal)}`}
        />
        <Tile label="発注金額" value={fmtPrice(orderTotalAmount)} />
        <Tile label="到着金額" value={fmtPrice(arrivalTotalAmount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="製品別 製造完了サマリ" hint="完了数量降順">
          {productRanking.length === 0 ? (
            <Empty>該当なし</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">製品</th>
                  <th className="px-3 py-2 text-right font-medium">件数</th>
                  <th className="px-3 py-2 text-right font-medium">完了数量</th>
                </tr>
              </thead>
              <tbody>
                {productRanking.slice(0, 15).map((r) => (
                  <tr key={r.salesName} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.salesName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.count}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtQty(r.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="取引先別 発注額" hint="金額降順（単価未設定の発注は除外）">
          {supplierRanking.length === 0 ? (
            <Empty>該当なし</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">取引先</th>
                  <th className="px-3 py-2 text-right font-medium">件数</th>
                  <th className="px-3 py-2 text-right font-medium">発注額</th>
                </tr>
              </thead>
              <tbody>
                {supplierRanking.slice(0, 15).map((r) => (
                  <tr key={r.companyName} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.companyName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.count}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtPrice(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="原料消費トップ" hint="製造で消費した原料・資材（金額降順）">
        {consumptionRanking.length === 0 ? (
          <Empty>該当なし</Empty>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">資材・原料</th>
                <th className="px-3 py-2 text-right font-medium">消費量</th>
                <th className="px-3 py-2 text-right font-medium">消費金額</th>
              </tr>
            </thead>
            <tbody>
              {consumptionRanking.slice(0, 30).map((r) => (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtQty(r.qty)} {r.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtPrice(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        集計の前提：製造完了は <code>packagedAt</code> がない場合
        <code>updatedAt</code> をフォールバック。発注は <code>orderedAt</code> が
        ない場合 <code>createdAt</code> をフォールバック。発注額・消費金額は単価が
        設定されている分のみ合算。
      </div>

      <p className="text-xs text-slate-500">
        その他のキャンセル指図件数：{cancelledCount} 件
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-sm text-slate-500">{children}</div>;
}
