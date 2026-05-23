import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma, PurchaseOrderStatus } from "@prisma/client";
import {
  updatePurchaseOrder,
  markOrdered,
  arrivePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
} from "./actions";

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  PLANNED: "未発注",
  ORDERED: "発注済",
  ARRIVED: "到着済",
  CANCELLED: "キャンセル",
};

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  ORDERED: "bg-blue-100 text-blue-800",
  ARRIVED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

function fmtDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function num(v: Prisma.Decimal | null | undefined): string | number {
  return v != null ? Number(v) : "";
}

const today = () => new Date().toISOString().slice(0, 10);

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    arrived?: string;
    error?: string;
  }>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const [order, suppliers] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: { material: { include: { category: true } }, supplier: true },
    }),
    prisma.supplier.findMany({ orderBy: { companyName: "asc" } }),
  ]);
  if (!order) notFound();

  const editable = order.status === "PLANNED" || order.status === "ORDERED";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/purchase-orders"
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 一覧へ戻る
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold">
            {order.material.name}
            <span
              className={`rounded px-2 py-0.5 text-sm font-medium ${STATUS_STYLE[order.status]}`}
            >
              {STATUS_LABEL[order.status]}
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            発注 #{order.id} ・ {order.supplier.companyName} ・ 発注数量{" "}
            {Number(order.orderedQty).toLocaleString("ja-JP", {
              maximumFractionDigits: 4,
            })}{" "}
            {order.material.unit}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {order.status === "PLANNED" ? (
            <form action={markOrdered}>
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="orderedAt" value={today()} />
              <button className="rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                発注済にする
              </button>
            </form>
          ) : null}
          {editable ? (
            <form action={cancelPurchaseOrder}>
              <input type="hidden" name="id" value={order.id} />
              <button className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                キャンセル
              </button>
            </form>
          ) : null}
          {order.status === "PLANNED" ? (
            <form action={deletePurchaseOrder}>
              <input type="hidden" name="id" value={order.id} />
              <button className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                削除
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {sp.created ? <Banner kind="ok">発注を作成しました。</Banner> : null}
      {sp.arrived ? (
        <Banner kind="ok">
          到着処理を実施しました。資材の在庫を更新し、入出庫履歴に記録しました。
        </Banner>
      ) : null}
      {sp.saved ? <Banner kind="ok">保存しました。</Banner> : null}
      {sp.error ? <Banner kind="err">{sp.error}</Banner> : null}

      {/* 到着登録 */}
      {editable ? (
        <form
          action={arrivePurchaseOrder}
          className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
        >
          <input type="hidden" name="id" value={order.id} />
          <h2 className="text-base font-semibold text-emerald-900">到着登録</h2>
          <p className="text-xs text-emerald-800">
            到着数量を入力すると、資材在庫に加算され、入出庫履歴に
            <span className="font-mono">PURCHASE_ARRIVAL</span> として記録されます。
            入力を省略すると発注数量と同じ値で処理します。
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="到着日" required>
              <input
                name="arrivedAt"
                type="date"
                defaultValue={today()}
                required
                className="input"
              />
            </Field>
            <Field label={`到着数量（${order.material.unit}）`}>
              <input
                name="arrivedQty"
                type="number"
                step="0.0001"
                defaultValue={Number(order.orderedQty)}
                className="input"
              />
            </Field>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
              >
                到着を登録（在庫加算）
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {/* 編集フォーム */}
      <form
        action={updatePurchaseOrder}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={order.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="資材">
            <Link
              href={`/materials/${order.materialId}`}
              className="block rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-900 hover:underline"
            >
              {order.material.name}（{order.material.unit}）
            </Link>
          </Field>
          <Field label="取引先" required>
            <select
              name="supplierId"
              defaultValue={order.supplierId}
              required
              className="input"
            >
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
              defaultValue={Number(order.orderedQty)}
              required
              className="input"
            />
          </Field>
          <Field label="単価">
            <input
              name="unitPrice"
              type="number"
              step="0.0001"
              defaultValue={num(order.unitPrice)}
              className="input"
            />
          </Field>
          <Field label="発注日">
            <input
              name="orderedAt"
              type="date"
              defaultValue={fmtDate(order.orderedAt)}
              className="input"
            />
          </Field>
          <Field label="到着予定日">
            <input
              name="expectedArrivalAt"
              type="date"
              defaultValue={fmtDate(order.expectedArrivalAt)}
              className="input"
            />
          </Field>
        </div>

        <Field label="備考" full>
          <textarea
            name="notes"
            rows={2}
            defaultValue={order.notes ?? ""}
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

      {/* 到着済の場合のサマリ */}
      {order.status === "ARRIVED" ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold">到着情報</h2>
          <p className="mt-2 text-sm text-slate-700">
            到着日：{fmtDate(order.arrivedAt) || "—"} ／ 到着数量：
            {order.arrivedQty != null
              ? `${Number(order.arrivedQty).toLocaleString("ja-JP", {
                  maximumFractionDigits: 4,
                })} ${order.material.unit}`
              : "—"}
          </p>
        </div>
      ) : null}
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
