import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createQualityStandard } from "../actions";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewQualityStandardPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const defaultProductId = sp.productId ? Number(sp.productId) : undefined;

  const products = await prisma.product.findMany({
    where: { qualityStandard: null },
    orderBy: { salesName: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/quality-standards"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">品質標準書の新規登録</h1>
        <p className="mt-1 text-sm text-slate-600">
          製品と管理番号を入力して作成すると、各サブセクションの編集ができる詳細ページへ進みます。
        </p>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          標準書を未作成の製品がありません。
        </div>
      ) : (
        <form
          action={createQualityStandard}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="製品" required>
              <select
                name="productId"
                defaultValue={defaultProductId ?? ""}
                required
                className="input"
              >
                <option value="" disabled>
                  製品を選択
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.salesName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="管理番号" required>
              <input name="controlNumber" required placeholder="例: 002-BC" className="input" />
            </Field>
            <Field label="制定日">
              <input name="establishedAt" type="date" defaultValue={today()} className="input" />
            </Field>
            <Field label="制定者">
              <input name="establishedBy" className="input" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Link
              href="/quality-standards"
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              作成
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
