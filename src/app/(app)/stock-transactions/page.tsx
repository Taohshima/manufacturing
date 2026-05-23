import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  StockTransactionReason,
  Division,
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

const REASONS: StockTransactionReason[] = [
  "PURCHASE_ARRIVAL",
  "MANUFACTURING_USE",
  "INVENTORY_ADJUST",
  "MANUAL",
];

function parseReason(v: string | undefined): StockTransactionReason | undefined {
  if (
    v === "PURCHASE_ARRIVAL" ||
    v === "MANUFACTURING_USE" ||
    v === "INVENTORY_ADJUST" ||
    v === "MANUAL"
  )
    return v;
  return undefined;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtSignedQty(v: Prisma.Decimal): string {
  const n = Number(v);
  const s = n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
  return n > 0 ? `+${s}` : s;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function StockTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    materialId?: string;
    reason?: string;
    direction?: string;
  }>;
}) {
  const params = await searchParams;
  const from = (params.from ?? "").trim();
  const to = (params.to ?? "").trim();
  const materialId = params.materialId ? Number(params.materialId) : undefined;
  const reason = parseReason(params.reason);
  const direction = params.direction === "in" ? "in" : params.direction === "out" ? "out" : "";

  // 既定：直近30日
  const effectiveFrom = from || daysAgoISO(30);
  const effectiveTo = to || todayISO();
  const fromDate = new Date(effectiveFrom);
  const toDate = new Date(effectiveTo);
  // toDate は終日含めるため翌日の0時未満で評価
  const toExclusive = new Date(toDate);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const where: Prisma.StockTransactionWhereInput = {
    occurredAt: { gte: fromDate, lt: toExclusive },
  };
  if (reason) where.reason = reason;
  if (materialId && Number.isFinite(materialId)) where.materialId = materialId;
  if (direction === "in") where.qty = { gt: 0 };
  if (direction === "out") where.qty = { lt: 0 };

  const [transactions, total, materials] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: {
        material: { include: { category: true } },
        purchaseOrder: { include: { supplier: true } },
        manufacturingOrder: { include: { product: true } },
      },
      take: 500,
    }),
    prisma.stockTransaction.count({ where }),
    prisma.material.findMany({
      where: { division: { in: ["RAW", "PACKAGING"] } },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      include: { category: true },
    }),
  ]);

  // 表示中の合計（500件まで）
  let inTotal = 0;
  let outTotal = 0;
  for (const t of transactions) {
    const n = Number(t.qty);
    if (n > 0) inTotal += n;
    else outTotal += n;
  }

  // 現在の検索条件を維持してエクスポートURLを組み立てる
  const exportParams = new URLSearchParams();
  if (from) exportParams.set("from", from);
  else exportParams.set("from", effectiveFrom);
  if (to) exportParams.set("to", to);
  else exportParams.set("to", effectiveTo);
  if (materialId) exportParams.set("materialId", String(materialId));
  if (reason) exportParams.set("reason", reason);
  if (direction) exportParams.set("direction", direction);
  const exportUrl = `/stock-transactions/export?${exportParams.toString()}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">入出庫履歴</h1>
          <p className="mt-1 text-sm text-slate-600">
            全 {total} 件{transactions.length < total ? `（表示 ${transactions.length} 件）` : ""}
          </p>
        </div>
        <a
          href={exportUrl}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          CSVエクスポート
        </a>
      </div>

      {/* 検索フォーム */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          開始日
          <input
            type="date"
            name="from"
            defaultValue={effectiveFrom}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          終了日
          <input
            type="date"
            name="to"
            defaultValue={effectiveTo}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          資材
          <select
            name="materialId"
            defaultValue={materialId ? String(materialId) : ""}
            className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {DIVISION_LABEL[m.division]} / {m.category.name} / {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          理由
          <select
            name="reason"
            defaultValue={reason ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          方向
          <select
            name="direction"
            defaultValue={direction}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">入出庫</option>
            <option value="in">入庫のみ</option>
            <option value="out">出庫のみ</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          絞り込み
        </button>
        <Link
          href="/stock-transactions"
          className="px-2 py-2 text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          クリア
        </Link>
      </form>

      {/* サマリ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile
          label={`入庫合計${transactions.length < total ? "（表示中）" : ""}`}
          value={inTotal}
          tone="in"
        />
        <Tile
          label={`出庫合計${transactions.length < total ? "（表示中）" : ""}`}
          value={outTotal}
          tone="out"
        />
        <Tile
          label={`純増減${transactions.length < total ? "（表示中）" : ""}`}
          value={inTotal + outTotal}
        />
      </div>

      {/* 結果テーブル */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">発生日</th>
              <th className="px-3 py-2 font-medium">資材</th>
              <th className="px-3 py-2 text-right font-medium">増減</th>
              <th className="px-3 py-2 font-medium">理由</th>
              <th className="px-3 py-2 font-medium">起源</th>
              <th className="px-3 py-2 font-medium">メモ</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  該当する履歴がありません。
                </td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(t.occurredAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/materials/${t.materialId}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {t.material.name}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {DIVISION_LABEL[t.material.division]} / {t.material.category.name}
                    </div>
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      Number(t.qty) < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {fmtSignedQty(t.qty)} {t.material.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {REASON_LABEL[t.reason]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {t.purchaseOrder ? (
                      <Link
                        href={`/purchase-orders/${t.purchaseOrder.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        発注#{t.purchaseOrder.id}（{t.purchaseOrder.supplier.companyName}）
                      </Link>
                    ) : t.manufacturingOrder ? (
                      <Link
                        href={`/manufacturing-orders/${t.manufacturingOrder.id}`}
                        className="text-slate-700 hover:underline"
                      >
                        指図#{t.manufacturingOrder.id}（{t.manufacturingOrder.product.salesName}）
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{t.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {transactions.length < total ? (
        <p className="text-xs text-slate-500">
          表示は先頭500件まで。期間や理由で絞り込んでください。
        </p>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "in" | "out";
}) {
  const display = value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
  const color =
    tone === "in"
      ? "text-emerald-700"
      : tone === "out"
        ? "text-red-600"
        : value < 0
          ? "text-red-600"
          : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {value > 0 ? "+" : ""}
        {display}
      </div>
    </div>
  );
}
