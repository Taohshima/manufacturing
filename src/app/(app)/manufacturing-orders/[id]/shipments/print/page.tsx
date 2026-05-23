import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma, ShipmentDecisionStatus } from "@prisma/client";
import { PrintButton } from "@/components/print-button";

const DECISION_LABEL: Record<ShipmentDecisionStatus, string> = {
  APPROVED: "可",
  REJECTED: "否",
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}
function fmtQty(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

export default async function ShipmentsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const order = await prisma.manufacturingOrder.findUnique({
    where: { id },
    include: {
      product: true,
      shipments: {
        orderBy: [{ shippedAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!order) notFound();

  return (
    <div className="space-y-3">
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          html, body { background: white; }
          .print-sheet { font-size: 9.5pt; }
          a { color: inherit; text-decoration: none; }
        }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td {
          border: 1px solid #555;
          padding: 4px 6px;
          font-size: 9.5pt;
          vertical-align: top;
        }
        .print-sheet th { background: #f1f5f9; font-weight: 600; text-align: left; }
        .print-sheet .label-cell {
          background: #f8fafc;
          font-weight: 600;
          white-space: nowrap;
        }
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
        <div className="text-right text-xs">様式1-2</div>
        <div className="border-b border-black pb-2">
          <h1 className="text-center text-xl font-bold">市場への出荷記録</h1>
        </div>

        <table>
          <tbody>
            <tr>
              <td className="label-cell">販売名</td>
              <td>{order.product.salesName}</td>
              <td className="label-cell">ロット番号</td>
              <td>{order.lotNumber ?? ""}</td>
              <td className="label-cell">指図 No.</td>
              <td>#{order.id}</td>
            </tr>
            <tr>
              <td className="label-cell">製造数量</td>
              <td>{fmtQty(order.plannedQty)}</td>
              <td className="label-cell">指図年月日</td>
              <td>{fmtDate(order.instructedAt)}</td>
              <td className="label-cell">発行日</td>
              <td>{fmtDate(new Date())}</td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th style={{ width: "3em" }}>No</th>
              <th style={{ width: "7em" }}>出荷可否決定年月日</th>
              <th style={{ width: "5em" }}>出荷の可否</th>
              <th style={{ width: "7em" }}>出荷年月日</th>
              <th>出荷先</th>
              <th style={{ width: "7em" }}>出荷数量</th>
              <th style={{ width: "7em" }}>在庫数量</th>
              <th style={{ width: "7em" }}>確認年月日</th>
              <th style={{ width: "9em" }}>品質保証責任者</th>
              <th>特記事項</th>
            </tr>
          </thead>
          <tbody>
            {order.shipments.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "#666" }}>
                  （出荷記録なし）
                </td>
              </tr>
            ) : (
              order.shipments.map((sh, i) => (
                <tr key={sh.id}>
                  <td style={{ textAlign: "right" }}>{i + 1}</td>
                  <td>{fmtDate(sh.decisionDate)}</td>
                  <td style={{ textAlign: "center" }}>
                    {sh.decision ? DECISION_LABEL[sh.decision] : ""}
                  </td>
                  <td>{fmtDate(sh.shippedAt)}</td>
                  <td>{sh.destination ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtQty(sh.shippedQty)}</td>
                  <td style={{ textAlign: "right" }}>{fmtQty(sh.remainingStock)}</td>
                  <td>{fmtDate(sh.confirmedAt)}</td>
                  <td>{sh.confirmedBy ?? ""}</td>
                  <td>{sh.specialNotes ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
