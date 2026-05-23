import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createTestRecord } from "../actions";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewTestRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const orderId = Number(idStr);
  if (!Number.isFinite(orderId)) notFound();

  const order = await prisma.manufacturingOrder.findUnique({
    where: { id: orderId },
    include: {
      product: {
        include: {
          qualityStandard: { include: { testSpecs: true } },
        },
      },
    },
  });
  if (!order) notFound();

  const specsCount = order.product.qualityStandard?.testSpecs.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/manufacturing-orders/${order.id}`}
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 指図に戻る
        </Link>
        <h1 className="mt-1 text-2xl font-bold">試験検査記録の新規作成</h1>
        <p className="mt-1 text-sm text-slate-600">
          {order.product.salesName}
          {order.lotNumber ? ` ／ ロット ${order.lotNumber}` : ""}
        </p>
      </div>

      <form
        action={createTestRecord}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="manufacturingOrderId" value={order.id} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="試験年月日">
            <input name="testDate" type="date" defaultValue={today()} className="input" />
          </Field>
          <Field label="試験者">
            <input name="testedBy" className="input" />
          </Field>
          <Field label="室温（℃）">
            <input name="temperature" type="number" step="0.01" className="input" />
          </Field>
          <Field label="湿度（%）">
            <input name="humidity" type="number" step="0.01" className="input" />
          </Field>
        </div>

        <label className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <input type="checkbox" name="isSimplified" className="mt-0.5" />
          <span>
            簡易版（試験項目を持たず「製造メーカーの試験成績書に準ずる」のみ記載）として作成
          </span>
        </label>

        <Field label="簡易版メモ（簡易版の場合のみ印刷に出力）" full>
          <input
            name="simplifiedNote"
            defaultValue="製造メーカーの試験成績書に準ずる"
            className="input"
          />
        </Field>

        <label className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <input
            type="checkbox"
            name="copyFromQs"
            defaultChecked={specsCount > 0}
            disabled={specsCount === 0}
            className="mt-0.5"
          />
          <span>
            品質標準書の「規格及び試験方法」（{specsCount}件）から試験項目をコピーする
            {specsCount === 0 ? "（未登録のため利用不可）" : ""}
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Link
            href={`/manufacturing-orders/${order.id}`}
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
