import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Division, StockTransactionReason, Prisma } from "@prisma/client";
import { updateMaterial, adjustStock } from "./actions";

const DIVISION_LABEL: Record<Division, string> = {
  RAW: "原料",
  PACKAGING: "資材",
  PRODUCT: "製品",
};

const REASON_LABEL: Record<StockTransactionReason, string> = {
  PURCHASE_ARRIVAL: "発注到着",
  MANUFACTURING_USE: "製造消費",
  INVENTORY_ADJUST: "棚卸調整",
  MANUAL: "手動補正",
};

function fmtQty(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function fmtSignedQty(v: Prisma.Decimal): string {
  const n = Number(v);
  const s = n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
  return n > 0 ? `+${s}` : s;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export default async function MaterialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; adjusted?: string; error?: string }>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const [material, categories, suppliers, transactions] = await Promise.all([
    prisma.material.findUnique({
      where: { id },
      include: { category: true, supplier: true },
    }),
    prisma.category.findMany({ orderBy: [{ division: "asc" }, { name: "asc" }] }),
    prisma.supplier.findMany({ orderBy: { companyName: "asc" } }),
    prisma.stockTransaction.findMany({
      where: { materialId: id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  if (!material) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/materials"
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 一覧へ戻る
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{material.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {DIVISION_LABEL[material.division]} / {material.category.name} ・ 現在庫{" "}
            <span className="font-semibold text-slate-900">
              {fmtQty(material.stockQty)} {material.unit}
            </span>
          </p>
        </div>
      </div>

      {sp.saved ? (
        <Banner kind="ok">基本情報を保存しました。</Banner>
      ) : null}
      {sp.adjusted ? (
        <Banner kind="ok">在庫を調整しました。</Banner>
      ) : null}
      {sp.error ? <Banner kind="err">{sp.error}</Banner> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 基本情報の編集 */}
        <form
          action={updateMaterial}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2"
        >
          <input type="hidden" name="id" value={material.id} />
          <h2 className="text-base font-semibold">基本情報</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名称" required>
              <input
                name="name"
                defaultValue={material.name}
                required
                className="input"
              />
            </Field>
            <Field label="カテゴリ（区分）" required>
              <select
                name="categoryId"
                defaultValue={material.categoryId}
                className="input"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {DIVISION_LABEL[c.division]} / {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="単位" required>
              <input
                name="unit"
                defaultValue={material.unit}
                required
                className="input"
              />
            </Field>
            <Field label="仕入単価">
              <input
                name="purchasePrice"
                type="number"
                step="0.0001"
                defaultValue={
                  material.purchasePrice != null
                    ? Number(material.purchasePrice)
                    : ""
                }
                className="input"
              />
            </Field>
            <Field label="発注先">
              <select
                name="supplierId"
                defaultValue={material.supplierId ?? ""}
                className="input"
              >
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
              <input
                name="storageLocation"
                defaultValue={material.storageLocation ?? ""}
                className="input"
              />
            </Field>
            <Field label="預かり在庫数量">
              <input
                name="consignedQty"
                type="number"
                step="0.0001"
                defaultValue={
                  material.consignedQty != null
                    ? Number(material.consignedQty)
                    : ""
                }
                className="input"
              />
            </Field>
            <Field label="預かり元">
              <input
                name="consignedOwner"
                defaultValue={material.consignedOwner ?? ""}
                className="input"
              />
            </Field>
            <Field label="関連ドキュメントURL">
              <input
                name="docUrl"
                type="url"
                defaultValue={material.docUrl ?? ""}
                className="input"
              />
            </Field>
          </div>

          <Field label="備考">
            <textarea
              name="notes"
              defaultValue={material.notes ?? ""}
              rows={2}
              className="input"
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              保存
            </button>
          </div>
        </form>

        {/* 在庫調整 */}
        <form
          action={adjustStock}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="id" value={material.id} />
          <h2 className="text-base font-semibold">在庫調整</h2>
          <p className="text-xs text-slate-500">
            現在の在庫数：
            <span className="font-medium text-slate-700">
              {fmtQty(material.stockQty)} {material.unit}
            </span>
            。調整後の実数を入力すると、差分が入出庫履歴に記録されます。
          </p>

          <Field label={`調整後の在庫数（${material.unit}）`} required>
            <input
              name="newQty"
              type="number"
              step="0.0001"
              defaultValue={Number(material.stockQty)}
              required
              className="input"
            />
          </Field>
          <Field label="日付" required>
            <input
              name="occurredAt"
              type="date"
              defaultValue={today()}
              required
              className="input"
            />
          </Field>
          <Field label="理由" required>
            <select name="reason" defaultValue="INVENTORY_ADJUST" className="input">
              <option value="INVENTORY_ADJUST">棚卸調整</option>
              <option value="MANUAL">手動補正</option>
            </select>
          </Field>
          <Field label="メモ">
            <input name="notes" className="input" />
          </Field>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
            >
              在庫を更新
            </button>
          </div>
        </form>
      </div>

      {/* 入出庫履歴 */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">入出庫履歴（直近50件）</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">日付</th>
                <th className="px-3 py-2 font-medium">理由</th>
                <th className="px-3 py-2 text-right font-medium">増減</th>
                <th className="px-3 py-2 font-medium">メモ</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    履歴がありません。
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">
                      {fmtDate(t.occurredAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {REASON_LABEL[t.reason]}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                        Number(t.qty) < 0 ? "text-red-600" : "text-emerald-700"
                      }`}
                    >
                      {fmtSignedQty(t.qty)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{t.notes ?? "—"}</td>
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

function Banner({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        kind === "ok"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {children}
    </div>
  );
}
