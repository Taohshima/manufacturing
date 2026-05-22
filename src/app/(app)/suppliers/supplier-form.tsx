import Link from "next/link";
import type { Supplier } from "@prisma/client";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  supplier?: Supplier | null;
  submitLabel: string;
};

export function SupplierForm({ action, supplier, submitLabel }: Props) {
  const s = supplier ?? null;
  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {s ? <input type="hidden" name="id" value={s.id} /> : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">基本情報</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="取引先会社名" required>
            <input name="companyName" defaultValue={s?.companyName ?? ""} required className="input" />
          </Field>
          <Field label="事業所名">
            <input name="officeName" defaultValue={s?.officeName ?? ""} className="input" />
          </Field>
          <Field label="郵便番号">
            <input name="postalCode" defaultValue={s?.postalCode ?? ""} className="input" />
          </Field>
          <Field label="住所">
            <input name="address" defaultValue={s?.address ?? ""} className="input" />
          </Field>
          <Field label="電話番号">
            <input name="phone" defaultValue={s?.phone ?? ""} className="input" />
          </Field>
          <Field label="FAX番号">
            <input name="fax" defaultValue={s?.fax ?? ""} className="input" />
          </Field>
          <Field label="WebサイトURL">
            <input name="websiteUrl" type="url" defaultValue={s?.websiteUrl ?? ""} className="input" />
          </Field>
          <Field label="担当者">
            <input name="contactPerson" defaultValue={s?.contactPerson ?? ""} className="input" />
          </Field>
          <Field label="メールアドレス">
            <input name="email" type="email" defaultValue={s?.email ?? ""} className="input" />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">発注・支払</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="発注方法">
            <input name="orderMethod" defaultValue={s?.orderMethod ?? ""} className="input" />
          </Field>
          <Field label="支払方法">
            <input name="paymentMethod" defaultValue={s?.paymentMethod ?? ""} className="input" />
          </Field>
          <Field label="支払日">
            <input
              name="paymentDay"
              type="number"
              min={1}
              max={31}
              defaultValue={s?.paymentDay ?? ""}
              className="input"
            />
          </Field>
          <Field label="支払区分（現金/クレジット 等）">
            <input name="paymentDivision" defaultValue={s?.paymentDivision ?? ""} className="input" />
          </Field>
          <Field label="支払サイト（当月/翌月 等）">
            <input name="paymentSite" defaultValue={s?.paymentSite ?? ""} className="input" />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">検索補助</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="検索ラベル">
            <input name="searchLabel" defaultValue={s?.searchLabel ?? ""} className="input" />
          </Field>
          <Field label="呼称・別名">
            <input name="alias" defaultValue={s?.alias ?? ""} className="input" />
          </Field>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Link
          href={s ? `/suppliers/${s.id}` : "/suppliers"}
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
