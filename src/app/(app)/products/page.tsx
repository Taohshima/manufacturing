import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function fmtPrice(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return `¥${Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const where: Prisma.ProductWhereInput = q
    ? {
        OR: [
          { salesName: { contains: q, mode: "insensitive" } },
          { genericName: { contains: q, mode: "insensitive" } },
          { standardNo: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { salesName: "asc" },
      include: { _count: { select: { recipes: true } } },
      take: 500,
    }),
    prisma.product.count(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">製品マスタ</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録 {total} 件{q ? `／ 絞り込み結果 ${products.length} 件` : null}
          </p>
        </div>
        <Link
          href="/products/new"
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          新規登録
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          検索（販売名・一般名称・基準番号）
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="製品を検索"
            className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          絞り込み
        </button>
        {q ? (
          <Link
            href="/products"
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
              <th className="px-3 py-2 font-medium">販売名</th>
              <th className="px-3 py-2 font-medium">容量</th>
              <th className="px-3 py-2 text-right font-medium">販売価格</th>
              <th className="px-3 py-2 text-right font-medium">配合数</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  該当する製品がありません。
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/products/${p.id}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {p.salesName}
                    </Link>
                    {p.genericName ? (
                      <span className="ml-2 text-xs text-slate-400">{p.genericName}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {Number(p.capacity).toLocaleString("ja-JP", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {p.capacityUnit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmtPrice(p.salesPrice)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                    {p._count.recipes}
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
