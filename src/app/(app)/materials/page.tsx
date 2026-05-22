import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Division, Prisma } from "@prisma/client";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

const DIVISIONS: Division[] = ["RAW", "PACKAGING", "PRODUCT"];

function parseDivision(v: string | undefined): Division | undefined {
  if (v === "RAW" || v === "PACKAGING" || v === "PRODUCT") return v;
  return undefined;
}

function fmtQty(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function fmtPrice(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; division?: string; categoryId?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const division = parseDivision(params.division);
  const categoryId = params.categoryId ? Number(params.categoryId) : undefined;

  const where: Prisma.MaterialWhereInput = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (division) where.division = division;
  if (categoryId && Number.isFinite(categoryId)) where.categoryId = categoryId;

  const [materials, categories, total] = await Promise.all([
    prisma.material.findMany({
      where,
      include: { category: true, supplier: true },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      take: 500,
    }),
    prisma.category.findMany({ orderBy: [{ division: "asc" }, { name: "asc" }] }),
    prisma.material.count(),
  ]);

  const filteredCategories = division
    ? categories.filter((c) => c.division === division)
    : categories;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">資材・原料マスタ</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録 {total} 件{" "}
            {q || division || categoryId
              ? `／ 絞り込み結果 ${materials.length} 件`
              : null}
          </p>
        </div>
        <Link
          href="/import/materials"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          CSVで取込
        </Link>
      </div>

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
            href="/materials"
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
              <th className="px-3 py-2 font-medium">区分</th>
              <th className="px-3 py-2 font-medium">カテゴリ</th>
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 text-right font-medium">在庫数</th>
              <th className="px-3 py-2 font-medium">単位</th>
              <th className="px-3 py-2 text-right font-medium">仕入単価</th>
              <th className="px-3 py-2 font-medium">発注先</th>
              <th className="px-3 py-2 font-medium">保管場所</th>
              <th className="px-3 py-2 font-medium">棚卸日</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                  該当する資材・原料がありません。
                </td>
              </tr>
            ) : (
              materials.map((m) => (
                <tr
                  key={m.id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    {DIVISION_LABEL[m.division]}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {m.category.name}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/materials/${m.id}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtQty(m.stockQty)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {m.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtPrice(m.purchasePrice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {m.supplier ? (
                      m.supplier.companyName
                    ) : (
                      <span className="text-amber-600">未紐付け</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {m.storageLocation ?? "—"}
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

      {materials.length >= 500 ? (
        <p className="text-xs text-slate-500">
          表示は先頭500件までです。絞り込みで件数を減らしてください。
        </p>
      ) : null}
    </div>
  );
}
