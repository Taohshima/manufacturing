import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createManufacturingOrder } from "./actions";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewManufacturingOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; productId?: string }>;
}) {
  const sp = await searchParams;
  const defaultProductId = sp.productId ? Number(sp.productId) : undefined;

  const products = await prisma.product.findMany({
    orderBy: { salesName: "asc" },
    include: { _count: { select: { recipes: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/manufacturing-orders"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">製造指図の新規作成</h1>
        <p className="mt-1 text-sm text-slate-600">
          製品を選んで指図を作成すると、配合(BOM) を指図時点のスナップショットとしてコピーします。
        </p>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          製品が未登録です。先に製品マスタを登録してください。
        </div>
      ) : (
        <form
          action={createManufacturingOrder}
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
                    {p.salesName}（配合 {p._count.recipes} 品）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="製造数量（本/個）" required>
              <input name="plannedQty" type="number" step="0.0001" required className="input" />
            </Field>
            <Field label="指図年月日" required>
              <input
                name="instructedAt"
                type="date"
                defaultValue={today()}
                required
                className="input"
              />
            </Field>
            <Field label="製造予定日">
              <input name="scheduledAt" type="date" className="input" />
            </Field>
            <Field label="受注日">
              <input name="orderedAt" type="date" className="input" />
            </Field>
            <Field label="ロット番号">
              <input name="lotNumber" className="input" />
            </Field>
            <Field label="指図者">
              <input name="instructor" className="input" />
            </Field>
          </div>
          <Field label="備考">
            <textarea name="notes" rows={2} className="input" />
          </Field>
          <div className="flex justify-end gap-2">
            <Link
              href="/manufacturing-orders"
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              指図を作成
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
