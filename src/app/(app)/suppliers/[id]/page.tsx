import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Division } from "@prisma/client";
import { SupplierForm } from "../supplier-form";
import { updateSupplier } from "../actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      materials: {
        orderBy: [{ division: "asc" }, { name: "asc" }],
        include: { category: true },
      },
    },
  });

  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/suppliers"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{supplier.companyName}</h1>
        {supplier.officeName ? (
          <p className="mt-1 text-sm text-slate-600">{supplier.officeName}</p>
        ) : null}
      </div>

      {sp.saved ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          保存しました。
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      <SupplierForm action={updateSupplier} supplier={supplier} submitLabel="保存" />

      <div className="space-y-2">
        <h2 className="text-base font-semibold">
          取扱品（{supplier.materials.length}件）
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">区分</th>
                <th className="px-3 py-2 font-medium">カテゴリ</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 text-right font-medium">在庫数</th>
              </tr>
            </thead>
            <tbody>
              {supplier.materials.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    紐付く資材・原料がありません。
                  </td>
                </tr>
              ) : (
                supplier.materials.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2">
                      {DIVISION_LABEL[m.division]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {m.category.name}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/materials/${m.id}`}
                        className="text-slate-900 hover:text-slate-600 hover:underline"
                      >
                        {m.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                      {Number(m.stockQty).toLocaleString("ja-JP", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {m.unit}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
