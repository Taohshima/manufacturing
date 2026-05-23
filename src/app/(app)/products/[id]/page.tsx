import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Division } from "@prisma/client";
import { ProductForm } from "../product-form";
import {
  updateProduct,
  deleteProduct,
  addRecipe,
  updateRecipe,
  deleteRecipe,
} from "../actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

export default async function ProductDetailPage({
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

  const [product, materials] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        recipes: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { material: { include: { category: true } } },
        },
      },
    }),
    prisma.material.findMany({
      where: { division: { in: ["RAW", "PACKAGING"] } },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      include: { category: true },
    }),
  ]);

  if (!product) notFound();

  const usedMaterialIds = new Set(product.recipes.map((r) => r.materialId));
  const selectableMaterials = materials.filter((m) => !usedMaterialIds.has(m.id));
  const nextSort = product.recipes.length
    ? Math.max(...product.recipes.map((r) => r.sortOrder)) + 1
    : 0;

  // 配合原価の自動計算（材料の仕入単価 × 利用量の合計）。
  // 単価未設定の材料がある場合は概算である旨を示す。
  let autoCost = 0;
  let hasMissingPrice = false;
  for (const r of product.recipes) {
    if (r.material.purchasePrice == null) {
      hasMissingPrice = true;
      continue;
    }
    autoCost += Number(r.material.purchasePrice) * Number(r.usageQty);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/products"
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 一覧へ戻る
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{product.salesName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {Number(product.capacity).toLocaleString("ja-JP", {
              maximumFractionDigits: 4,
            })}{" "}
            {product.capacityUnit}
            {product.standardNo ? ` ・ 基準番号 ${product.standardNo}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/manufacturing-orders/new?productId=${product.id}`}
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600"
          >
            この製品で指図作成
          </Link>
          <form action={deleteProduct}>
            <input type="hidden" name="id" value={product.id} />
            <button
              type="submit"
              className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              削除
            </button>
          </form>
        </div>
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

      <ProductForm action={updateProduct} product={product} submitLabel="保存" />

      {/* 配合（BOM） */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            配合（BOM）／ {product.recipes.length} 品目
          </h2>
          <div className="text-sm text-slate-600">
            配合原価（自動計算）：
            <span className="font-semibold text-slate-900">
              ¥{autoCost.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}
            </span>
            {hasMissingPrice ? (
              <span className="ml-1 text-xs text-amber-600">
                ※単価未設定の材料を除く概算
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          {product.recipes.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              配合がまだ登録されていません。下のフォームから材料を追加してください。
            </p>
          ) : (
            product.recipes.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3 last:border-b-0"
              >
                <div className="min-w-[12rem] flex-1">
                  <Link
                    href={`/materials/${r.materialId}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {r.material.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {DIVISION_LABEL[r.material.division]} / {r.material.category.name}
                    {r.material.purchasePrice != null
                      ? ` ・ 単価 ¥${Number(r.material.purchasePrice).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}`
                      : " ・ 単価未設定"}
                  </div>
                </div>
                <form action={updateRecipe} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="productId" value={product.id} />
                  <label className="flex flex-col gap-1 text-xs text-slate-600">
                    利用量
                    <input
                      name="usageQty"
                      type="number"
                      step="0.0001"
                      defaultValue={Number(r.usageQty)}
                      className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-600">
                    単位
                    <input
                      name="usageUnit"
                      defaultValue={r.usageUnit}
                      className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-600">
                    順序
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={r.sortOrder}
                      className="w-16 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    更新
                  </button>
                </form>
                <form action={deleteRecipe}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="productId" value={product.id} />
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    削除
                  </button>
                </form>
              </div>
            ))
          )}
        </div>

        {/* 配合の追加 */}
        <form
          action={addRecipe}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <input type="hidden" name="productId" value={product.id} />
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-slate-600">
            材料
            <select
              name="materialId"
              defaultValue=""
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="" disabled>
                材料を選択
              </option>
              {selectableMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {DIVISION_LABEL[m.division]} / {m.category.name} / {m.name}（{m.unit}）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            利用量
            <input
              name="usageQty"
              type="number"
              step="0.0001"
              className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            単位
            <input
              name="usageUnit"
              placeholder="材料の単位"
              className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            順序
            <input
              name="sortOrder"
              type="number"
              defaultValue={nextSort}
              className="w-16 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            配合に追加
          </button>
        </form>
      </div>
    </div>
  );
}
