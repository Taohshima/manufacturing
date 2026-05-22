import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Division } from "@prisma/client";
import { createMaterial } from "./actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewMaterialPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ division: "asc" }, { name: "asc" }] }),
    prisma.supplier.findMany({ orderBy: { companyName: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/materials"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">資材・原料の新規登録</h1>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      {categories.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          カテゴリが未登録です。先にカテゴリを登録するか、CSVインポートで取り込んでください。
        </div>
      ) : (
        <form
          action={createMaterial}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名称" required>
              <input name="name" required className="input" />
            </Field>
            <Field label="カテゴリ（区分）" required>
              <select name="categoryId" className="input" defaultValue="">
                <option value="" disabled>
                  選択してください
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {DIVISION_LABEL[c.division]} / {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="単位" required>
              <input name="unit" required placeholder="例：kg, 個, L" className="input" />
            </Field>
            <Field label="仕入単価">
              <input name="purchasePrice" type="number" step="0.0001" className="input" />
            </Field>
            <Field label="発注先">
              <select name="supplierId" className="input" defaultValue="">
                <option value="">（未設定）</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                    {s.officeName ? `（${s.officeName}）` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="保管場所">
              <input name="storageLocation" className="input" />
            </Field>
            <Field label="預かり在庫数量">
              <input name="consignedQty" type="number" step="0.0001" className="input" />
            </Field>
            <Field label="預かり元">
              <input name="consignedOwner" className="input" />
            </Field>
            <Field label="関連ドキュメントURL">
              <input name="docUrl" type="url" className="input" />
            </Field>
          </div>

          <Field label="備考">
            <textarea name="notes" rows={2} className="input" />
          </Field>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-600">初期在庫（任意）</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <Field label="初期在庫数">
                <input name="initialQty" type="number" step="0.0001" className="input" />
              </Field>
              <Field label="計上日">
                <input name="occurredAt" type="date" defaultValue={today()} className="input" />
              </Field>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              初期在庫を入力すると、入出庫履歴に棚卸調整として記録されます。
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Link
              href="/materials"
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              登録
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
