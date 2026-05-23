import Link from "next/link";
import { prisma } from "@/lib/prisma";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export default async function QualityStandardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const products = await prisma.product.findMany({
    where: q ? { salesName: { contains: q, mode: "insensitive" } } : {},
    orderBy: { salesName: "asc" },
    include: { qualityStandard: true },
    take: 500,
  });

  const withQS = products.filter((p) => p.qualityStandard).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">品質標準書</h1>
          <p className="mt-1 text-sm text-slate-600">
            登録済み {withQS} / {products.length} 製品
          </p>
        </div>
        <Link
          href="/quality-standards/new"
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
          製品名で検索
          <input
            type="text"
            name="q"
            defaultValue={q}
            className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
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
            href="/quality-standards"
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
              <th className="px-3 py-2 font-medium">製品</th>
              <th className="px-3 py-2 font-medium">管理番号</th>
              <th className="px-3 py-2 font-medium">制定日</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  製品が見つかりません。
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link
                      href={
                        p.qualityStandard
                          ? `/quality-standards/${p.qualityStandard.id}`
                          : `/products/${p.id}`
                      }
                      className="font-medium text-slate-900 hover:text-slate-600 hover:underline"
                    >
                      {p.salesName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {p.qualityStandard?.controlNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {fmtDate(p.qualityStandard?.establishedAt ?? null)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {p.qualityStandard ? (
                      <Link
                        href={`/quality-standards/${p.qualityStandard.id}`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        編集
                      </Link>
                    ) : (
                      <Link
                        href={`/quality-standards/new?productId=${p.id}`}
                        className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                      >
                        作成
                      </Link>
                    )}
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
