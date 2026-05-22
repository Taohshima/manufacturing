import Link from "next/link";
import type { Product } from "@prisma/client";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  product?: Product | null;
  submitLabel: string;
};

function num(v: { toString(): string } | null | undefined): string | number {
  return v != null ? Number(v) : "";
}

export function ProductForm({ action, product, submitLabel }: Props) {
  const p = product ?? null;
  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {p ? <input type="hidden" name="id" value={p.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="販売名" required>
          <input name="salesName" defaultValue={p?.salesName ?? ""} required className="input" />
        </Field>
        <Field label="一般名称">
          <input name="genericName" defaultValue={p?.genericName ?? ""} className="input" />
        </Field>
        <Field label="基準番号">
          <input name="standardNo" defaultValue={p?.standardNo ?? ""} className="input" />
        </Field>
        <Field label="管理区分">
          <input name="controlDivision" defaultValue={p?.controlDivision ?? ""} className="input" />
        </Field>
        <Field label="容量" required>
          <input
            name="capacity"
            type="number"
            step="0.0001"
            defaultValue={num(p?.capacity)}
            required
            className="input"
          />
        </Field>
        <Field label="容量単位" required>
          <input
            name="capacityUnit"
            defaultValue={p?.capacityUnit ?? ""}
            placeholder="例：mL, g, 個"
            required
            className="input"
          />
        </Field>
        <Field label="使用期限（月）">
          <input name="expiryMonths" type="number" defaultValue={p?.expiryMonths ?? ""} className="input" />
        </Field>
        <Field label="ケース入数">
          <input name="caseCount" type="number" defaultValue={p?.caseCount ?? ""} className="input" />
        </Field>
        <Field label="保管場所">
          <input name="storageLocation" defaultValue={p?.storageLocation ?? ""} className="input" />
        </Field>
        <Field label="販売価格">
          <input name="salesPrice" type="number" step="0.01" defaultValue={num(p?.salesPrice)} className="input" />
        </Field>
        <Field label="製品原価">
          <input name="productCost" type="number" step="0.01" defaultValue={num(p?.productCost)} className="input" />
        </Field>
        <Field label="在庫数">
          <input name="stockQty" type="number" step="0.0001" defaultValue={num(p?.stockQty)} className="input" />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Link
          href={p ? `/products/${p.id}` : "/products"}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          キャンセル
        </Link>
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {submitLabel}
        </button>
      </div>
    </form>
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
