import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type {
  ApprovalState,
  ExistenceState,
  ShipmentDecisionStatus,
  SuitabilityState,
} from "@prisma/client";
import { PrintButton } from "@/components/print-button";

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

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}

export default async function ShipmentDecisionPrintPage({
  params,
}: {
  params: Promise<{ id: string; sdId: string }>;
}) {
  const { id: idStr, sdId: sdIdStr } = await params;
  const orderId = Number(idStr);
  const sdId = Number(sdIdStr);
  if (!Number.isFinite(orderId) || !Number.isFinite(sdId)) notFound();

  const sd = await prisma.shipmentDecision.findUnique({
    where: { id: sdId },
    include: {
      manufacturingOrder: { include: { product: true } },
    },
  });
  if (!sd || sd.manufacturingOrderId !== orderId) notFound();

  const order = sd.manufacturingOrder;

  return (
    <div className="space-y-3">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: white; }
          .print-sheet { font-size: 10.5pt; }
          a { color: inherit; text-decoration: none; }
        }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td {
          border: 1px solid #555;
          padding: 6px 8px;
          font-size: 10.5pt;
          vertical-align: top;
        }
        .print-sheet th { background: #f1f5f9; font-weight: 600; text-align: left; }
        .print-sheet .label-cell {
          background: #f8fafc;
          font-weight: 600;
          width: 17em;
          white-space: nowrap;
        }
        .print-sheet .signbox { height: 48px; }
      `}</style>

      <div className="no-print flex items-center justify-between">
        <Link
          href={`/manufacturing-orders/${order.id}`}
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 指図に戻る
        </Link>
        <PrintButton label="印刷 / PDF保存" />
      </div>

      <div className="print-sheet space-y-3">
        <div className="text-right text-xs">様式1-1</div>
        <div className="border-b border-black pb-2">
          <h1 className="text-center text-xl font-bold">出荷可否決定通知</h1>
        </div>

        <table>
          <tbody>
            <tr>
              <td className="label-cell">販売名</td>
              <td>{order.product.salesName}</td>
            </tr>
            <tr>
              <td className="label-cell">ロット番号（製造番号）</td>
              <td>{order.lotNumber ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">製造数量</td>
              <td>
                {Number(order.plannedQty).toLocaleString("ja-JP", {
                  maximumFractionDigits: 4,
                })}
              </td>
            </tr>
            <tr>
              <td className="label-cell">指図年月日</td>
              <td>{fmtDate(order.instructedAt)}</td>
            </tr>
          </tbody>
        </table>

        <p className="text-sm">
          上記製品について、下記の事項を確認の上、出荷の可否を決定しましたのでお知らせします。
        </p>

        <h2 className="text-sm font-semibold">確認事項</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">① 製造所からの出荷可否の決定の記録</td>
              <td>
                {sd.check1ManufacturerDecisionRecord
                  ? APPROVAL_LABEL[sd.check1ManufacturerDecisionRecord]
                  : ""}
              </td>
            </tr>
            <tr>
              <td className="label-cell">② 当該製品の試験検査成績書</td>
              <td>
                {sd.check2TestReport ? SUITABILITY_LABEL[sd.check2TestReport] : ""}
              </td>
            </tr>
            <tr>
              <td className="label-cell">
                ③ 当該製品の品質及び安全性に関する情報
              </td>
              <td>
                {sd.check3ProductQualityInfo
                  ? EXISTENCE_LABEL[sd.check3ProductQualityInfo]
                  : ""}
              </td>
            </tr>
            <tr>
              <td className="label-cell">
                ④ 原材料等の品質及び安全性に関する情報
              </td>
              <td>
                {sd.check4MaterialQualityInfo
                  ? EXISTENCE_LABEL[sd.check4MaterialQualityInfo]
                  : ""}
              </td>
            </tr>
            <tr>
              <td className="label-cell">
                ⑤ 出荷判定基準逸脱等の有無と措置の確認
              </td>
              <td>
                {sd.check5DeviationCheck
                  ? APPROVAL_LABEL[sd.check5DeviationCheck]
                  : ""}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="text-sm font-semibold">特記事項</h2>
        <table>
          <tbody>
            <tr>
              <td style={{ minHeight: "4em", whiteSpace: "pre-wrap" }}>
                {sd.specialNotes ?? ""}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="text-sm font-semibold">決定</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">出荷の可否</td>
              <td>
                <span className="text-lg font-bold">
                  {DECISION_LABEL[sd.decision]}
                </span>
              </td>
            </tr>
            <tr>
              <td className="label-cell">決定年月日</td>
              <td>{fmtDate(sd.decidedAt)}</td>
            </tr>
            <tr>
              <td className="label-cell">決定者</td>
              <td>{sd.decidedBy ?? ""}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="text-sm font-semibold">検印</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "33%" }}>確認</th>
              <th style={{ width: "33%" }}>承認</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="signbox"></td>
              <td className="signbox"></td>
              <td className="signbox"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
