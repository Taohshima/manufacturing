import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { TestJudgment } from "@prisma/client";
import {
  updateTestRecord,
  deleteTestRecord,
  addTestItem,
  updateTestItem,
  deleteTestItem,
} from "../actions";

const JUDGMENT_LABEL: Record<TestJudgment, string> = { OK: "適", NG: "否" };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}
function num(v: { toString(): string } | null | undefined): string | number {
  return v != null ? Number(v as unknown as number) : "";
}

export default async function TestRecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; trId: string }>;
  searchParams: Promise<{ saved?: string; created?: string; error?: string }>;
}) {
  const { id: idStr, trId: trIdStr } = await params;
  const sp = await searchParams;
  const orderId = Number(idStr);
  const trId = Number(trIdStr);
  if (!Number.isFinite(orderId) || !Number.isFinite(trId)) notFound();

  const tr = await prisma.testInspectionRecord.findUnique({
    where: { id: trId },
    include: {
      manufacturingOrder: { include: { product: true } },
      items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!tr || tr.manufacturingOrderId !== orderId) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/manufacturing-orders/${orderId}`}
            className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            ← 指図に戻る
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            試験検査記録 #{tr.id}
            {tr.isSimplified ? (
              <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                簡易版
              </span>
            ) : null}
            {tr.overallResult ? (
              <span
                className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${tr.overallResult === "OK" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
              >
                総合判定：{JUDGMENT_LABEL[tr.overallResult]}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {tr.manufacturingOrder.product.salesName}
            {tr.manufacturingOrder.lotNumber
              ? ` ／ ロット ${tr.manufacturingOrder.lotNumber}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/manufacturing-orders/${orderId}/test-records/${tr.id}/print`}
            target="_blank"
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            印刷
          </Link>
          <form action={deleteTestRecord}>
            <input type="hidden" name="id" value={tr.id} />
            <input type="hidden" name="manufacturingOrderId" value={orderId} />
            <button className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
              削除
            </button>
          </form>
        </div>
      </div>

      {sp.created ? <Banner kind="ok">作成しました。</Banner> : null}
      {sp.saved ? <Banner kind="ok">保存しました。</Banner> : null}
      {sp.error ? <Banner kind="err">{sp.error}</Banner> : null}

      {/* 基本情報 */}
      <form
        action={updateTestRecord}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={tr.id} />
        <input type="hidden" name="manufacturingOrderId" value={orderId} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="試験年月日">
            <input
              name="testDate"
              type="date"
              defaultValue={fmtDate(tr.testDate)}
              className="input"
            />
          </Field>
          <Field label="試験者">
            <input name="testedBy" defaultValue={tr.testedBy ?? ""} className="input" />
          </Field>
          <Field label="室温（℃）">
            <input
              name="temperature"
              type="number"
              step="0.01"
              defaultValue={num(tr.temperature)}
              className="input"
            />
          </Field>
          <Field label="湿度（%）">
            <input
              name="humidity"
              type="number"
              step="0.01"
              defaultValue={num(tr.humidity)}
              className="input"
            />
          </Field>
          <Field label="総合判定">
            <select name="overallResult" defaultValue={tr.overallResult ?? ""} className="input">
              <option value="">未判定</option>
              <option value="OK">適</option>
              <option value="NG">否</option>
            </select>
          </Field>
          <Field label="判定者">
            <input name="judgedBy" defaultValue={tr.judgedBy ?? ""} className="input" />
          </Field>
          <Field label="責任技術者">
            <input
              name="chiefTechnician"
              defaultValue={tr.chiefTechnician ?? ""}
              className="input"
            />
          </Field>
          <Field label="品質保証責任者">
            <input
              name="qaResponsible"
              defaultValue={tr.qaResponsible ?? ""}
              className="input"
            />
          </Field>
          <Field label="確認年月日">
            <input
              name="confirmedAt"
              type="date"
              defaultValue={fmtDate(tr.confirmedAt)}
              className="input"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <input
            type="checkbox"
            name="isSimplified"
            defaultChecked={tr.isSimplified}
            className="mt-0.5"
          />
          <span>
            簡易版（試験項目を持たず、下のメモのみを印刷に出力）
          </span>
        </label>
        <Field label="簡易版メモ" full>
          <input
            name="simplifiedNote"
            defaultValue={tr.simplifiedNote ?? ""}
            className="input"
          />
        </Field>
        <Field label="備考" full>
          <textarea
            name="notes"
            rows={2}
            defaultValue={tr.notes ?? ""}
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

      {/* 試験項目 */}
      {tr.isSimplified ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          簡易版として作成されています。試験項目は記録しません。
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">試験項目（{tr.items.length}件）</h2>
          <div className="rounded-lg border border-slate-200 bg-white">
            {tr.items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                まだ試験項目がありません。下のフォームから追加してください。
              </p>
            ) : (
              tr.items.map((it) => (
                <div
                  key={it.id}
                  className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3 last:border-b-0"
                >
                  <form
                    action={updateTestItem}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="trId" value={tr.id} />
                    <input
                      type="hidden"
                      name="manufacturingOrderId"
                      value={orderId}
                    />
                    <Small label="順" w="w-16">
                      <input
                        name="sortOrder"
                        type="number"
                        defaultValue={it.sortOrder}
                        className="input"
                      />
                    </Small>
                    <Small label="試験項目" w="w-48">
                      <input
                        name="testItem"
                        defaultValue={it.testItem}
                        required
                        className="input"
                      />
                    </Small>
                    <Small label="規格" w="flex-1 min-w-[10rem]">
                      <input name="spec" defaultValue={it.spec ?? ""} className="input" />
                    </Small>
                    <Small label="試験結果" w="flex-1 min-w-[10rem]">
                      <input
                        name="result"
                        defaultValue={it.result ?? ""}
                        className="input"
                      />
                    </Small>
                    <Small label="判定" w="w-24">
                      <select
                        name="judgment"
                        defaultValue={it.judgment ?? ""}
                        className="input"
                      >
                        <option value="">—</option>
                        <option value="OK">適</option>
                        <option value="NG">否</option>
                      </select>
                    </Small>
                    <button className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      更新
                    </button>
                  </form>
                  <form action={deleteTestItem}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="trId" value={tr.id} />
                    <input
                      type="hidden"
                      name="manufacturingOrderId"
                      value={orderId}
                    />
                    <button className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
                      削除
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>

          <form
            action={addTestItem}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <input type="hidden" name="trId" value={tr.id} />
            <input type="hidden" name="manufacturingOrderId" value={orderId} />
            <Small label="順" w="w-16">
              <input name="sortOrder" type="number" className="input" />
            </Small>
            <Small label="試験項目" w="w-48">
              <input name="testItem" required className="input" />
            </Small>
            <Small label="規格" w="flex-1 min-w-[10rem]">
              <input name="spec" className="input" />
            </Small>
            <Small label="試験結果" w="flex-1 min-w-[10rem]">
              <input name="result" className="input" />
            </Small>
            <Small label="判定" w="w-24">
              <select name="judgment" defaultValue="" className="input">
                <option value="">—</option>
                <option value="OK">適</option>
                <option value="NG">否</option>
              </select>
            </Small>
            <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              追加
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex flex-col gap-1 text-xs text-slate-600 ${full ? "sm:col-span-2 lg:col-span-3" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function Small({
  label,
  w,
  children,
}: {
  label: string;
  w: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-slate-600 ${w}`}>
      <span>{label}</span>
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
