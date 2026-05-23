import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type {
  ApprovalState,
  ExistenceState,
  ManufacturingOrderStatus,
  Prisma,
  ShipmentDecisionStatus,
  SuitabilityState,
} from "@prisma/client";
import {
  updateManufacturingOrder,
  updateIngredient,
  completeOrder,
  cancelOrder,
  deleteOrder,
  setStatusInProgress,
  createShipmentDecision,
  updateShipmentDecision,
  deleteShipmentDecision,
  addShipment,
  updateShipment,
  deleteShipment,
} from "./actions";

const APPROVAL_LABEL: Record<ApprovalState, string> = {
  YES_OK: "有・可",
  YES_NG: "有・否",
  NO: "無",
};
const SUITABILITY_LABEL: Record<SuitabilityState, string> = {
  YES_FIT: "有・適",
  YES_UNFIT: "有・不適",
  NO: "無",
};
const EXISTENCE_LABEL: Record<ExistenceState, string> = {
  YES: "有",
  NO: "無",
};
const DECISION_LABEL: Record<ShipmentDecisionStatus, string> = {
  APPROVED: "可",
  REJECTED: "否",
};

const STATUS_LABEL: Record<ManufacturingOrderStatus, string> = {
  PLANNED: "予定",
  IN_PROGRESS: "進行中",
  COMPLETED: "完了",
  CANCELLED: "キャンセル",
};

const STATUS_STYLE: Record<ManufacturingOrderStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
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

export default async function ManufacturingOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    created?: string;
    completed?: string;
    error?: string;
  }>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const order = await prisma.manufacturingOrder.findUnique({
    where: { id },
    include: {
      product: true,
      ingredients: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { material: { include: { category: true } } },
      },
      shipmentDecisions: {
        orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
      },
      shipments: {
        orderBy: [{ shippedAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!order) notFound();

  const editable = order.status === "PLANNED" || order.status === "IN_PROGRESS";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/manufacturing-orders"
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 一覧へ戻る
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold">
            {order.product.salesName}
            <span
              className={`rounded px-2 py-0.5 text-sm font-medium ${STATUS_STYLE[order.status]}`}
            >
              {STATUS_LABEL[order.status]}
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            指図 #{order.id}
            {order.lotNumber ? ` ・ ロット ${order.lotNumber}` : ""} ・ 予定数量{" "}
            {Number(order.plannedQty).toLocaleString("ja-JP", {
              maximumFractionDigits: 4,
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/manufacturing-orders/${order.id}/print`}
            target="_blank"
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            指図書を印刷
          </Link>
          {order.status === "PLANNED" ? (
            <form action={setStatusInProgress}>
              <input type="hidden" name="id" value={order.id} />
              <button className="rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                進行中にする
              </button>
            </form>
          ) : null}
          {editable ? (
            <form action={completeOrder}>
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="occurredAt" value={today()} />
              <button className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600">
                完了（在庫消費・製品入庫）
              </button>
            </form>
          ) : null}
          {editable ? (
            <form action={cancelOrder}>
              <input type="hidden" name="id" value={order.id} />
              <button className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                キャンセル
              </button>
            </form>
          ) : null}
          {order.status === "PLANNED" ? (
            <form action={deleteOrder}>
              <input type="hidden" name="id" value={order.id} />
              <button className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                削除
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {sp.created ? (
        <Banner kind="ok">
          指図を作成しました。配合(BOM) をコピー済です。秤量実績を入力してから「完了」してください。
        </Banner>
      ) : null}
      {sp.completed ? (
        <Banner kind="ok">
          完了処理を実施しました。原料の在庫を消費し、製品の在庫を更新しました。
        </Banner>
      ) : null}
      {sp.saved ? <Banner kind="ok">保存しました。</Banner> : null}
      {sp.error ? <Banner kind="err">{sp.error}</Banner> : null}

      {/* 基本情報・工程情報の編集 */}
      <form
        action={updateManufacturingOrder}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={order.id} />

        <Section title="基本情報">
          <Field label="指図年月日" required>
            <input
              name="instructedAt"
              type="date"
              defaultValue={fmtDate(order.instructedAt)}
              required
              className="input"
            />
          </Field>
          <Field label="製造予定日">
            <input
              name="scheduledAt"
              type="date"
              defaultValue={fmtDate(order.scheduledAt)}
              className="input"
            />
          </Field>
          <Field label="受注日">
            <input
              name="orderedAt"
              type="date"
              defaultValue={fmtDate(order.orderedAt)}
              className="input"
            />
          </Field>
          <Field label="製造数量" required>
            <input
              name="plannedQty"
              type="number"
              step="0.0001"
              defaultValue={Number(order.plannedQty)}
              required
              className="input"
            />
          </Field>
          <Field label="ロット番号">
            <input
              name="lotNumber"
              defaultValue={order.lotNumber ?? ""}
              className="input"
            />
          </Field>
          <Field label="製品標準書No">
            <input
              name="standardNo"
              defaultValue={order.standardNo ?? ""}
              className="input"
            />
          </Field>
          <Field label="指図者">
            <input
              name="instructor"
              defaultValue={order.instructor ?? ""}
              className="input"
            />
          </Field>
        </Section>

        <Section title="秤量">
          <Field label="秤量年月日">
            <input
              name="weighingDate"
              type="date"
              defaultValue={fmtDate(order.weighingDate)}
              className="input"
            />
          </Field>
          <Field label="温度（℃）">
            <input
              name="temperature"
              type="number"
              step="0.01"
              defaultValue={num(order.temperature)}
              className="input"
            />
          </Field>
          <Field label="湿度（%）">
            <input
              name="humidity"
              type="number"
              step="0.01"
              defaultValue={num(order.humidity)}
              className="input"
            />
          </Field>
        </Section>

        <Section title="混合">
          <Field label="混合年月日">
            <input
              name="mixedAt"
              type="date"
              defaultValue={fmtDate(order.mixedAt)}
              className="input"
            />
          </Field>
          <Field label="作業開始時刻">
            <input
              name="mixStartTime"
              type="time"
              defaultValue={order.mixStartTime ?? ""}
              className="input"
            />
          </Field>
          <Field label="作業終了時刻">
            <input
              name="mixEndTime"
              type="time"
              defaultValue={order.mixEndTime ?? ""}
              className="input"
            />
          </Field>
          <Field label="作業者">
            <input
              name="mixWorker"
              defaultValue={order.mixWorker ?? ""}
              className="input"
            />
          </Field>
          <Field label="混合メモ" full>
            <input
              name="mixNotes"
              defaultValue={order.mixNotes ?? ""}
              className="input"
            />
          </Field>
        </Section>

        <Section title="充填">
          <Field label="充填年月日">
            <input
              name="filledAt"
              type="date"
              defaultValue={fmtDate(order.filledAt)}
              className="input"
            />
          </Field>
          <Field label="充填容量">
            <input
              name="fillUnitVolume"
              type="number"
              step="0.0001"
              defaultValue={num(order.fillUnitVolume)}
              className="input"
            />
          </Field>
          <Field label="単位（g/mL等）">
            <input
              name="fillUnit"
              defaultValue={order.fillUnit ?? ""}
              className="input"
            />
          </Field>
          <Field label="充填個数">
            <input
              name="fillCount"
              type="number"
              defaultValue={order.fillCount ?? ""}
              className="input"
            />
          </Field>
          <Field label="充填ミス数量">
            <input
              name="fillMissCount"
              type="number"
              defaultValue={order.fillMissCount ?? ""}
              className="input"
            />
          </Field>
          <Field label="容器表示の確認">
            <select
              name="containerCheck"
              defaultValue={order.containerCheck ?? ""}
              className="input"
            >
              <option value="">未確認</option>
              <option value="OK">適</option>
              <option value="NG">不適</option>
            </select>
          </Field>
          <Field label="充填作業者">
            <input
              name="fillWorker"
              defaultValue={order.fillWorker ?? ""}
              className="input"
            />
          </Field>
        </Section>

        <Section title="包装">
          <Field label="包装年月日">
            <input
              name="packagedAt"
              type="date"
              defaultValue={fmtDate(order.packagedAt)}
              className="input"
            />
          </Field>
          <Field label="段ボールサイズ">
            <input
              name="cardboardSize"
              defaultValue={order.cardboardSize ?? ""}
              className="input"
            />
          </Field>
          <Field label="包装作業者">
            <input
              name="packagingWorker"
              defaultValue={order.packagingWorker ?? ""}
              className="input"
            />
          </Field>
          <Field label="包装表示確認">
            <select
              name="packagingCheck"
              defaultValue={order.packagingCheck ?? ""}
              className="input"
            >
              <option value="">未確認</option>
              <option value="OK">適</option>
              <option value="NG">不適</option>
            </select>
          </Field>
          <Field label="ロット確認">
            <select
              name="lotCheck"
              defaultValue={order.lotCheck ?? ""}
              className="input"
            >
              <option value="">未確認</option>
              <option value="OK">適</option>
              <option value="NG">不適</option>
            </select>
          </Field>
          <Field label="完成数量">
            <input
              name="completedQty"
              type="number"
              step="0.0001"
              defaultValue={num(order.completedQty)}
              className="input"
            />
          </Field>
          <Field label="抜取り数量">
            <input
              name="sampleQty"
              type="number"
              step="0.0001"
              defaultValue={num(order.sampleQty)}
              className="input"
            />
          </Field>
        </Section>

        <Section title="備考">
          <Field label="備考" full>
            <textarea
              name="notes"
              rows={2}
              defaultValue={order.notes ?? ""}
              className="input"
            />
          </Field>
        </Section>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            保存
          </button>
        </div>
      </form>

      {/* 配合原料（秤量実績） */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">
          配合原料（{order.ingredients.length}品目）
        </h2>
        <p className="text-xs text-slate-500">
          指図量は配合(BOM) × 製造数量で自動計算。秤量実績を入力していない場合、完了時には指図量を消費します。
        </p>

        <div className="rounded-lg border border-slate-200 bg-white">
          {order.ingredients.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              配合原料がありません。製品の配合(BOM) を登録してから指図を作成してください。
            </p>
          ) : (
            order.ingredients.map((ing) => (
              <form
                key={ing.id}
                action={updateIngredient}
                className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3 last:border-b-0"
              >
                <input type="hidden" name="id" value={ing.id} />
                <input type="hidden" name="orderId" value={order.id} />
                <div className="min-w-[12rem] flex-1">
                  <Link
                    href={`/materials/${ing.materialId}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {ing.material.name}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {ing.material.category.name} ・ 1本{" "}
                    {Number(ing.perUnitQty).toLocaleString("ja-JP", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {ing.perUnitUnit} ／ 指図量{" "}
                    <span className="font-medium text-slate-700">
                      {Number(ing.plannedQty).toLocaleString("ja-JP", {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {ing.perUnitUnit}
                    </span>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  秤量実績
                  <input
                    name="actualQty"
                    type="number"
                    step="0.0001"
                    defaultValue={ing.actualQty != null ? Number(ing.actualQty) : ""}
                    disabled={!editable}
                    className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  原料ロット番号
                  <input
                    name="materialLotNumber"
                    defaultValue={ing.materialLotNumber ?? ""}
                    disabled={!editable}
                    className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  メモ
                  <input
                    name="notes"
                    defaultValue={ing.notes ?? ""}
                    disabled={!editable}
                    className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    name="checked"
                    defaultChecked={ing.checked}
                    disabled={!editable}
                  />
                  確認済
                </label>
                {editable ? (
                  <button
                    type="submit"
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    行を保存
                  </button>
                ) : null}
              </form>
            ))
          )}
        </div>
      </div>

      {/* 出荷可否決定通知（様式1-1） */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            出荷可否決定通知（{order.shipmentDecisions.length}件）
          </h2>
        </div>
        <div className="space-y-3">
          {order.shipmentDecisions.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              まだ判定がありません。下のフォームから作成してください。
            </p>
          ) : (
            order.shipmentDecisions.map((sd) => (
              <div
                key={sd.id}
                className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
              >
              <form
                action={updateShipmentDecision}
                className="space-y-3"
              >
                <input type="hidden" name="id" value={sd.id} />
                <input type="hidden" name="manufacturingOrderId" value={order.id} />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    判定 #{sd.id} ／{" "}
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${sd.decision === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                    >
                      {DECISION_LABEL[sd.decision]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/manufacturing-orders/${order.id}/shipment-decision/${sd.id}/print`}
                      target="_blank"
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      印刷
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <SelectField
                    name="check1ManufacturerDecisionRecord"
                    label="① 製造所からの出荷可否の決定の記録"
                    value={sd.check1ManufacturerDecisionRecord}
                    options={[
                      ["", "（未選択）"],
                      ["YES_OK", APPROVAL_LABEL.YES_OK],
                      ["YES_NG", APPROVAL_LABEL.YES_NG],
                      ["NO", APPROVAL_LABEL.NO],
                    ]}
                  />
                  <SelectField
                    name="check2TestReport"
                    label="② 試験検査成績書"
                    value={sd.check2TestReport}
                    options={[
                      ["", "（未選択）"],
                      ["YES_FIT", SUITABILITY_LABEL.YES_FIT],
                      ["YES_UNFIT", SUITABILITY_LABEL.YES_UNFIT],
                      ["NO", SUITABILITY_LABEL.NO],
                    ]}
                  />
                  <SelectField
                    name="check3ProductQualityInfo"
                    label="③ 製品の品質・安全性情報"
                    value={sd.check3ProductQualityInfo}
                    options={[
                      ["", "（未選択）"],
                      ["YES", EXISTENCE_LABEL.YES],
                      ["NO", EXISTENCE_LABEL.NO],
                    ]}
                  />
                  <SelectField
                    name="check4MaterialQualityInfo"
                    label="④ 原材料の品質・安全性情報"
                    value={sd.check4MaterialQualityInfo}
                    options={[
                      ["", "（未選択）"],
                      ["YES", EXISTENCE_LABEL.YES],
                      ["NO", EXISTENCE_LABEL.NO],
                    ]}
                  />
                  <SelectField
                    name="check5DeviationCheck"
                    label="⑤ 出荷判定基準逸脱と措置"
                    value={sd.check5DeviationCheck}
                    options={[
                      ["", "（未選択）"],
                      ["YES_OK", APPROVAL_LABEL.YES_OK],
                      ["YES_NG", APPROVAL_LABEL.YES_NG],
                      ["NO", APPROVAL_LABEL.NO],
                    ]}
                  />
                  <Field label="決定">
                    <select name="decision" defaultValue={sd.decision} className="input">
                      <option value="APPROVED">{DECISION_LABEL.APPROVED}</option>
                      <option value="REJECTED">{DECISION_LABEL.REJECTED}</option>
                    </select>
                  </Field>
                  <Field label="決定年月日">
                    <input
                      name="decidedAt"
                      type="date"
                      defaultValue={fmtDate(sd.decidedAt)}
                      className="input"
                    />
                  </Field>
                  <Field label="決定者" full>
                    <input
                      name="decidedBy"
                      defaultValue={sd.decidedBy ?? ""}
                      className="input"
                    />
                  </Field>
                </div>

                <Field label="特記事項" full>
                  <textarea
                    name="specialNotes"
                    rows={2}
                    defaultValue={sd.specialNotes ?? ""}
                    className="input"
                  />
                </Field>

                <div className="flex justify-end gap-2">
                  <button
                    type="submit"
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    更新
                  </button>
                </div>

              </form>
              <DeleteRowForm
                action={deleteShipmentDecision}
                id={sd.id}
                manufacturingOrderId={order.id}
                label="この判定を削除"
              />
              </div>
            ))
          )}

          {/* 追加フォーム */}
          <form
            action={createShipmentDecision}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <input type="hidden" name="manufacturingOrderId" value={order.id} />
            <h3 className="text-sm font-semibold">新しい判定を作成</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="決定">
                <select name="decision" defaultValue="APPROVED" className="input">
                  <option value="APPROVED">{DECISION_LABEL.APPROVED}</option>
                  <option value="REJECTED">{DECISION_LABEL.REJECTED}</option>
                </select>
              </Field>
              <Field label="決定年月日">
                <input
                  name="decidedAt"
                  type="date"
                  defaultValue={today()}
                  className="input"
                />
              </Field>
              <Field label="決定者">
                <input name="decidedBy" className="input" />
              </Field>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                判定を作成
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 市場出荷記録（様式1-2） */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            市場出荷記録（{order.shipments.length}件）
          </h2>
          <Link
            href={`/manufacturing-orders/${order.id}/shipments/print`}
            target="_blank"
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            出荷記録を印刷
          </Link>
        </div>
        <div className="space-y-3">
          {order.shipments.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
              まだ出荷記録がありません。下のフォームから追加してください。
            </p>
          ) : (
            order.shipments.map((sh) => (
              <div
                key={sh.id}
                className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
              >
              <form
                action={updateShipment}
                className="space-y-3"
              >
                <input type="hidden" name="id" value={sh.id} />
                <input type="hidden" name="manufacturingOrderId" value={order.id} />

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="出荷年月日">
                    <input
                      name="shippedAt"
                      type="date"
                      defaultValue={fmtDate(sh.shippedAt)}
                      className="input"
                    />
                  </Field>
                  <Field label="出荷先">
                    <input
                      name="destination"
                      defaultValue={sh.destination ?? ""}
                      className="input"
                    />
                  </Field>
                  <Field label="出荷数量">
                    <input
                      name="shippedQty"
                      type="number"
                      step="0.0001"
                      defaultValue={num(sh.shippedQty)}
                      className="input"
                    />
                  </Field>
                  <Field label="出荷可否決定年月日">
                    <input
                      name="decisionDate"
                      type="date"
                      defaultValue={fmtDate(sh.decisionDate)}
                      className="input"
                    />
                  </Field>
                  <Field label="出荷の可否">
                    <select name="decision" defaultValue={sh.decision ?? ""} className="input">
                      <option value="">（未設定）</option>
                      <option value="APPROVED">{DECISION_LABEL.APPROVED}</option>
                      <option value="REJECTED">{DECISION_LABEL.REJECTED}</option>
                    </select>
                  </Field>
                  <Field label="紐付ける判定">
                    <select
                      name="shipmentDecisionId"
                      defaultValue={sh.shipmentDecisionId ?? ""}
                      className="input"
                    >
                      <option value="">（未指定）</option>
                      {order.shipmentDecisions.map((sd) => (
                        <option key={sd.id} value={sd.id}>
                          判定 #{sd.id} ／ {DECISION_LABEL[sd.decision]} ／{" "}
                          {fmtDate(sd.decidedAt) || "—"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="在庫数量">
                    <input
                      name="remainingStock"
                      type="number"
                      step="0.0001"
                      defaultValue={num(sh.remainingStock)}
                      className="input"
                    />
                  </Field>
                  <Field label="確認年月日">
                    <input
                      name="confirmedAt"
                      type="date"
                      defaultValue={fmtDate(sh.confirmedAt)}
                      className="input"
                    />
                  </Field>
                  <Field label="品質保証責任者">
                    <input
                      name="confirmedBy"
                      defaultValue={sh.confirmedBy ?? ""}
                      className="input"
                    />
                  </Field>
                </div>
                <Field label="特記事項" full>
                  <input
                    name="specialNotes"
                    defaultValue={sh.specialNotes ?? ""}
                    className="input"
                  />
                </Field>
                <Field label="備考" full>
                  <input name="notes" defaultValue={sh.notes ?? ""} className="input" />
                </Field>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    更新
                  </button>
                </div>

              </form>
              <DeleteRowForm
                action={deleteShipment}
                id={sh.id}
                manufacturingOrderId={order.id}
                label="この出荷記録を削除"
              />
              </div>
            ))
          )}

          {/* 追加フォーム */}
          <form
            action={addShipment}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <input type="hidden" name="manufacturingOrderId" value={order.id} />
            <h3 className="text-sm font-semibold">新しい出荷記録を追加</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="出荷年月日">
                <input
                  name="shippedAt"
                  type="date"
                  defaultValue={today()}
                  className="input"
                />
              </Field>
              <Field label="出荷先">
                <input name="destination" className="input" />
              </Field>
              <Field label="出荷数量">
                <input name="shippedQty" type="number" step="0.0001" className="input" />
              </Field>
              <Field label="紐付ける判定">
                <select name="shipmentDecisionId" defaultValue="" className="input">
                  <option value="">（未指定）</option>
                  {order.shipmentDecisions.map((sd) => (
                    <option key={sd.id} value={sd.id}>
                      判定 #{sd.id} ／ {DECISION_LABEL[sd.decision]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="出荷の可否">
                <select name="decision" defaultValue="" className="input">
                  <option value="">（未設定）</option>
                  <option value="APPROVED">{DECISION_LABEL.APPROVED}</option>
                  <option value="REJECTED">{DECISION_LABEL.REJECTED}</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                出荷記録を追加
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | null;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeleteRowForm({
  action,
  id,
  manufacturingOrderId,
  label,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: number;
  manufacturingOrderId: number;
  label: string;
}) {
  return (
    <form action={action} className="flex justify-end">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="manufacturingOrderId" value={manufacturingOrderId} />
      <button
        type="submit"
        className="text-xs text-red-600 hover:text-red-800 hover:underline"
      >
        {label}
      </button>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-slate-100 pb-1 text-base font-semibold">
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
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
      className={`flex flex-col gap-1 text-xs text-slate-600 ${full ? "sm:col-span-2 lg:col-span-3" : ""}`}
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
