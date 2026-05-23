import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Division } from "@prisma/client";
import { createPurchaseOrder } from "./actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; materialId?: string }>;
}) {
  const sp = await searchParams;
  const defaultMaterialId = sp.materialId ? Number(sp.materialId) : undefined;

  const [materials, suppliers] = await Promise.all([
    prisma.material.findMany({
      where: { division: { in: ["RAW", "PACKAGING"] } },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      include: { category: true, supplier: true },
    }),
    prisma.supplier.findMany({ orderBy: { companyName: "asc" } }),
  ]);

  // 既定の発注先・単価：?materialId= で指定された資材があればその値
  const preset = defaultMaterialId
    ? materials.find((m) => m.id === defaultMaterialId)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/purchase-orders"
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 一覧へ戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">発注の新規作成</h1>
        <p className="mt-1 text-sm text-slate-600">
          単価を空にすると資材マスタの仕入単価を採用します。発注先を空にできるよう、ここでは選択が必要です。
        </p>
      </div>

      {sp.error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      ) : null}

      {materials.length === 0 || suppliers.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          資材または取引先が未登録です。先に登録してください。
        </div>
      ) : (
        <form
          action={createPurchaseOrder}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="資材" required>
              <select
                name="materialId"
                defaultValue={preset?.id ?? ""}
                required
                className="input"
              >
                <option value="" disabled>
                  資材を選択
                </option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {DIVISION_LABEL[m.division]} / {m.category.name} / {m.name}（{m.unit}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="取引先" required>
              <select
                name="supplierId"
                defaultValue={preset?.supplierId ?? ""}
                required
                className="input"
              >
                <option value="" disabled>
                  取引先を選択
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                    {s.officeName ? `（${s.officeName}）` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="発注数量" required>
              <input
                name="orderedQty"
                type="number"
                step="0.0001"
                required
                className="input"
              />
            </Field>
            <Field label="単価">
              <input
                name="unitPrice"
                type="number"
                step="0.0001"
                defaultValue={
                  preset?.purchasePrice != null
                    ? Number(preset.purchasePrice)
                    : ""
                }
                className="input"
              />
            </Field>
            <Field label="発注日">
              <input name="orderedAt" type="date" className="input" />
            </Field>
            <Field label="到着予定日">
              <input name="expectedArrivalAt" type="date" className="input" />
            </Field>
          </div>
          <Field label="備考" full>
            <textarea name="notes" rows={2} className="input" />
          </Field>
          <div className="flex justify-end gap-2">
            <Link
              href="/purchase-orders"
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              発注を作成
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
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex flex-col gap-1 text-xs text-slate-600 ${full ? "sm:col-span-2" : ""}`}
    >
      <span>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
