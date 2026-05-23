import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const where: Prisma.SupplierWhereInput = q
    ? {
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { alias: { contains: q, mode: "insensitive" } },
          { searchLabel: { contains: q, mode: "insensitive" } },
          { officeName: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { companyName: "asc" },
      include: { _count: { select: { materials: true } } },
      take: 500,
    }),
    prisma.supplier.count(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">取引先マスタ</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録 {total} 件{q ? `／ 絞り込み結果 ${suppliers.length} 件` : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/suppliers/new"
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            新規登録
          </Link>
          <Link
            href="/import/suppliers"
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            CSVで取込
          </Link>
          <a
            href={`/suppliers/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            CSVで出力
          </a>
        </div>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          検索（会社名・別名・検索ラベル・事業所名）
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="取引先を検索"
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
            href="/suppliers"
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
              <th className="px-3 py-2 font-medium">取引先会社名</th>
              <th className="px-3 py-2 font-medium">事業所</th>
              <th className="px-3 py-2 font-medium">電話</th>
              <th className="px-3 py-2 font-medium">担当者</th>
              <th className="px-3 py-2 text-right font-medium">取扱品数</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  該当する取引先がありません。
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {s.companyName}
                    </Link>
                    {s.alias ? (
                      <span className="ml-2 text-xs text-slate-400">{s.alias}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {s.officeName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {s.phone ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {s.contactPerson ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                    {s._count.materials}
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
