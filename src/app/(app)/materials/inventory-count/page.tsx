import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Division, Prisma } from "@prisma/client";
import { commitInventoryCount } from "./actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

const DIVISIONS: Division[] = ["RAW", "PACKAGING"];

function parseDivision(v: string | undefined): Division | undefined {
  if (v === "RAW" || v === "PACKAGING") return v;
  return undefined;
}

function fmtQty(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export default async function InventoryCountPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    division?: string;
    categoryId?: string;
    committed?: string;
    zero?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const division = parseDivision(params.division);
  const categoryId = params.categoryId ? Number(params.categoryId) : undefined;

  const where: Prisma.MaterialWhereInput = {
    division: { in: ["RAW", "PACKAGING"] },
  };
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (division) where.division = division;
  if (categoryId && Number.isFinite(categoryId)) where.categoryId = categoryId;

  const [materials, categories] = await Promise.all([
    prisma.material.findMany({
      where,
      include: { category: true },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      take: 500,
    }),
    prisma.category.findMany({
      where: { division: { in: ["RAW", "PACKAGING"] } },
      orderBy: [{ division: "asc" }, { name: "asc" }],
    }),
  ]);

  const filteredCategories = division
    ? categories.filter((c) => c.division === division)
    : categories;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/materials"
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 資材一覧へ戻る
          </Link>
          <h1 className="mt-1 text-2xl font-bold">棚卸モード</h1>
          <p className="mt-1 text-sm text-slate-600">
            実棚数を入力した行だけが反映されます。空欄は対象外（一気に全部やる必要はありません）。
          </p>
        </div>
      </div>

      {params.committed != null ? (
        <Banner kind="ok">
          一括反映完了：在庫調整 {params.committed} 件、差分なし {params.zero ?? "0"} 件。
          差分があった資材は入出庫履歴に「棚卸」として記録しました。
        </Banner>
      ) : null}
      {params.error ? <Banner kind="err">{params.error}</Banner> : null}

      {/* 絞り込み（GETフォーム） */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          名称検索
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="名称で検索"
            className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          区分
          <select
            name="division"
            defaultValue={division ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {DIVISION_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          カテゴリ
          <select
            name="categoryId"
            defaultValue={categoryId ? String(categoryId) : ""}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">すべて</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {DIVISION_LABEL[c.division]} / {c.name}
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
        {q || division || categoryId ? (
          <Link
            href="/materials/inventory-count"
            className="px-2 py-2 text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            クリア
          </Link>
        ) : null}
      </form>

      {/* 棚卸フォーム（POST） */}
      <form action={commitInventoryCount} className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <label className="flex flex-col gap-1 text-xs text-emerald-900">
            棚卸日
            <input
              name="occurredAt"
              type="date"
              defaultValue={today()}
              required
              className="rounded border border-emerald-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-emerald-900">
            メモ（入出庫履歴に記録されます）
            <input
              name="notes"
              defaultValue={`棚卸 ${today()}`}
              className="rounded border border-emerald-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            一括反映
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">区分</th>
                <th className="px-3 py-2 font-medium">カテゴリ</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">単位</th>
                <th className="px-3 py-2 text-right font-medium">現在庫</th>
                <th className="px-3 py-2 text-right font-medium">実棚数</th>
                <th className="px-3 py-2 font-medium">前回棚卸日</th>
              </tr>
            </thead>
            <tbody>
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    該当する資材・原料がありません。
                  </td>
                </tr>
              ) : (
                materials.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {DIVISION_LABEL[m.division]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {m.category.name}
                    </td>
                    <td className="px-3 py-2">{m.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {m.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtQty(m.stockQty)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.0001"
                        name={`actual_${m.id}`}
                        className="w-28 rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {fmtDate(m.lastInventoryDate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {materials.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
            >
              入力済みの行をまとめて反映
            </button>
          </div>
        ) : null}
      </form>

      {materials.length >= 500 ? (
        <p className="text-xs text-slate-500">
          表示は先頭500件まで。絞り込みで件数を減らしてください。
        </p>
      ) : null}
    </div>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        kind === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {children}
    </div>
  );
}
