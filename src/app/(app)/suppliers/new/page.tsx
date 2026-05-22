import Link from "next/link";
import { SupplierForm } from "../supplier-form";
import { createSupplier } from "../actions";

export default async function NewSupplierPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/suppliers"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">取引先の新規登録</h1>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      <SupplierForm action={createSupplier} submitLabel="登録" />
    </div>
  );
}
