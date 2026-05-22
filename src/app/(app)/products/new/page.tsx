import Link from "next/link";
import { ProductForm } from "../product-form";
import { createProduct } from "../actions";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/products"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">製品の新規登録</h1>
        <p className="mt-1 text-sm text-slate-600">
          登録後、詳細ページで配合（BOM）を編集できます。
        </p>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      <ProductForm action={createProduct} submitLabel="登録" />
    </div>
  );
}
