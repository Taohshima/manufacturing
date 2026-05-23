import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Division, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtQty(v: Prisma.Decimal | number | null): string {
  if (v == null) return "—";
  const n = typeof v === "number" ? v : Number(v);
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function startOfMonthUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextMonthUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
function startOfTodayUTC(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export default async function DashboardPage() {
  const monthStart = startOfMonthUTC();
  const nextMonthStart = startOfNextMonthUTC();
  const today = startOfTodayUTC();

  const [
    activeIngredients,
    upcomingManufacturing,
    upcomingArrivals,
    overdueArrivals,
    monthlyInstructed,
    monthlyCompleted,
    monthlyOrdered,
    monthlyArrived,
    pendingManufacturingCount,
    pendingPurchaseCount,
  ] = await Promise.all([
    // 在庫不足アラート用：未完了の指図に紐づく原料の需要
    prisma.manufacturingOrderIngredient.findMany({
      where: {
        manufacturingOrder: { status: { in: ["PLANNED", "IN_PROGRESS"] } },
      },
      select: { materialId: true, plannedQty: true, actualQty: true },
    }),
    // 直近の製造予定
    prisma.manufacturingOrder.findMany({
      where: { status: { in: ["PLANNED", "IN_PROGRESS"] } },
      orderBy: [
        { scheduledAt: { sort: "asc", nulls: "last" } },
        { instructedAt: "asc" },
      ],
      include: { product: true },
      take: 10,
    }),
    // 直近の到着予定
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["PLANNED", "ORDERED"] } },
      orderBy: [
        { expectedArrivalAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ],
      include: { material: true, supplier: true },
      take: 10,
    }),
    // 到着遅延
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: ["PLANNED", "ORDERED"] },
        expectedArrivalAt: { lt: today },
      },
      orderBy: [{ expectedArrivalAt: "asc" }],
      include: { material: true, supplier: true },
      take: 10,
    }),
    // 月次サマリ
    prisma.manufacturingOrder.count({
      where: { instructedAt: { gte: monthStart, lt: nextMonthStart } },
    }),
    prisma.manufacturingOrder.count({
      where: {
        status: "COMPLETED",
        instructedAt: { gte: monthStart, lt: nextMonthStart },
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        OR: [
          { orderedAt: { gte: monthStart, lt: nextMonthStart } },
          {
            createdAt: { gte: monthStart, lt: nextMonthStart },
            orderedAt: null,
          },
        ],
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        status: "ARRIVED",
        arrivedAt: { gte: monthStart, lt: nextMonthStart },
      },
    }),
    prisma.manufacturingOrder.count({
      where: { status: { in: ["PLANNED", "IN_PROGRESS"] } },
    }),
    prisma.purchaseOrder.count({
      where: { status: { in: ["PLANNED", "ORDERED"] } },
    }),
  ]);

  // 在庫不足アラートの計算
  const demand = new Map<number, number>();
  for (const ing of activeIngredients) {
    const q =
      ing.actualQty != null ? Number(ing.actualQty) : Number(ing.plannedQty);
    demand.set(ing.materialId, (demand.get(ing.materialId) ?? 0) + q);
  }
  const materialIds = [...demand.keys()];
  const demandedMaterials =
    materialIds.length > 0
      ? await prisma.material.findMany({
          where: { id: { in: materialIds } },
          include: { category: true },
        })
      : [];
  const shortfalls = demandedMaterials
    .map((m) => {
      const d = demand.get(m.id) ?? 0;
      const stock = Number(m.stockQty);
      return { m, demand: d, stock, deficit: d - stock };
    })
    .filter((x) => x.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-600">
          製造予定・発注・在庫の状況を一覧します。
        </p>
      </div>

      {/* KPIタイル */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="未完了の指図"
          value={pendingManufacturingCount}
          href="/manufacturing-orders?status=PLANNED"
        />
        <KpiTile
          label="未到着の発注"
          value={pendingPurchaseCount}
          href="/purchase-orders?status=PLANNED"
        />
        <KpiTile label="在庫不足アラート" value={shortfalls.length} tone="warn" />
        <KpiTile label="到着遅延" value={overdueArrivals.length} tone="warn" />
      </div>

      {/* アラート2列 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="在庫不足アラート" hint="未完了の指図に必要な量 vs 現在庫">
          {shortfalls.length === 0 ? (
            <Empty>不足はありません。</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">資材</th>
                  <th className="px-3 py-2 text-right font-medium">需要</th>
                  <th className="px-3 py-2 text-right font-medium">在庫</th>
                  <th className="px-3 py-2 text-right font-medium">不足</th>
                  <th className="px-3 py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {shortfalls.map((s) => (
                  <tr key={s.m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        href={`/materials/${s.m.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {s.m.name}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {DIVISION_LABEL[s.m.division]} / {s.m.category.name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {fmtQty(s.demand)} {s.m.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {fmtQty(s.stock)} {s.m.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-red-600">
                      {fmtQty(s.deficit)} {s.m.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link
                        href={`/purchase-orders/new?materialId=${s.m.id}`}
                        className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        発注
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="到着遅延" hint="到着予定日を過ぎた未到着の発注">
          {overdueArrivals.length === 0 ? (
            <Empty>遅延はありません。</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">到着予定</th>
                  <th className="px-3 py-2 font-medium">資材</th>
                  <th className="px-3 py-2 font-medium">取引先</th>
                  <th className="px-3 py-2 text-right font-medium">発注数</th>
                </tr>
              </thead>
              <tbody>
                {overdueArrivals.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-red-700">
                      {fmtDate(o.expectedArrivalAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/purchase-orders/${o.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {o.material.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {o.supplier.companyName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {fmtQty(o.orderedQty)} {o.material.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* 直近の予定 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="直近の製造予定" hint="予定・進行中の指図 上位10件">
          {upcomingManufacturing.length === 0 ? (
            <Empty>予定はありません。</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">予定日</th>
                  <th className="px-3 py-2 font-medium">製品</th>
                  <th className="px-3 py-2 font-medium">ロット</th>
                  <th className="px-3 py-2 text-right font-medium">予定数</th>
                </tr>
              </thead>
              <tbody>
                {upcomingManufacturing.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {fmtDate(o.scheduledAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/manufacturing-orders/${o.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {o.product.salesName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {o.lotNumber ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtQty(o.plannedQty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="直近の到着予定" hint="未発注・発注済の入荷予定 上位10件">
          {upcomingArrivals.length === 0 ? (
            <Empty>予定はありません。</Empty>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">到着予定</th>
                  <th className="px-3 py-2 font-medium">資材</th>
                  <th className="px-3 py-2 font-medium">取引先</th>
                  <th className="px-3 py-2 text-right font-medium">発注数</th>
                </tr>
              </thead>
              <tbody>
                {upcomingArrivals.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {fmtDate(o.expectedArrivalAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/purchase-orders/${o.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {o.material.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {o.supplier.companyName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {fmtQty(o.orderedQty)} {o.material.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* 今月のサマリ */}
      <Card title="今月のサマリ" hint={`${monthStart.toISOString().slice(0, 7)} 集計`}>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
          <StatBlock label="指図件数" value={monthlyInstructed} />
          <StatBlock label="製造完了" value={monthlyCompleted} />
          <StatBlock label="発注件数" value={monthlyOrdered} />
          <StatBlock label="到着件数" value={monthlyArrived} />
        </div>
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "warn";
}) {
  const inner = (
    <div
      className={`rounded-lg border p-4 ${
        tone === "warn" && value > 0
          ? "border-amber-300 bg-amber-50"
          : "border-slate-200 bg-white"
      } ${href ? "transition hover:border-slate-400" : ""}`}
    >
      <div className="text-xs text-slate-600">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === "warn" && value > 0 ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
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

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-sm text-slate-500">{children}</div>;
}
