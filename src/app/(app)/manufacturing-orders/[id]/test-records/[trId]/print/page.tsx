import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { TestJudgment, Prisma } from "@prisma/client";
import { PrintButton } from "@/components/print-button";

const JUDGMENT_LABEL: Record<TestJudgment, string> = { OK: "適", NG: "否" };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}
function fmtNum(v: Prisma.Decimal | null | undefined, digits = 2): string {
  if (v == null) return "";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

export default async function TestRecordPrintPage({
  params,
}: {
  params: Promise<{ id: string; trId: string }>;
}) {
  const { id: idStr, trId: trIdStr } = await params;
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
  const order = tr.manufacturingOrder;

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
          padding: 5px 7px;
          font-size: 10.5pt;
          vertical-align: top;
        }
        .print-sheet th { background: #f1f5f9; font-weight: 600; text-align: left; }
        .print-sheet .label-cell {
          background: #f8fafc;
          font-weight: 600;
          width: 11em;
          white-space: nowrap;
        }
        .print-sheet h2 { font-size: 11pt; font-weight: 600; margin-top: 0.5em; }
        .print-sheet .signbox { height: 44px; }
      `}</style>

      <div className="no-print flex items-center justify-between">
        <Link
          href={`/manufacturing-orders/${orderId}/test-records/${trId}`}
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 編集に戻る
        </Link>
        <PrintButton label="印刷 / PDF保存" />
      </div>

      <div className="print-sheet space-y-3">
        <div className="border-b border-black pb-2">
          <h1 className="text-center text-xl font-bold">
            試験検査記録{tr.isSimplified ? "（簡易版）" : ""}
          </h1>
        </div>

        <table>
          <tbody>
            <tr>
              <td className="label-cell">販売名</td>
              <td>{order.product.salesName}</td>
              <td className="label-cell">ロット番号</td>
              <td>{order.lotNumber ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">指図 No.</td>
              <td>#{order.id}</td>
              <td className="label-cell">指図年月日</td>
              <td>{fmtDate(order.instructedAt)}</td>
            </tr>
            <tr>
              <td className="label-cell">試験年月日</td>
              <td>{fmtDate(tr.testDate)}</td>
              <td className="label-cell">試験者</td>
              <td>{tr.testedBy ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">室温（℃）</td>
              <td>{fmtNum(tr.temperature)}</td>
              <td className="label-cell">湿度（%）</td>
              <td>{fmtNum(tr.humidity)}</td>
            </tr>
          </tbody>
        </table>

        {tr.isSimplified ? (
          <>
            <h2>試験結果</h2>
            <table>
              <tbody>
                <tr>
                  <td style={{ minHeight: "3em", whiteSpace: "pre-wrap" }}>
                    {tr.simplifiedNote ?? "製造メーカーの試験成績書に準ずる。"}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            <h2>試験項目</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "3em" }}>No</th>
                  <th>試験項目</th>
                  <th>規格</th>
                  <th>試験結果</th>
                  <th style={{ width: "4em" }}>判定</th>
                </tr>
              </thead>
              <tbody>
                {tr.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "#666" }}>
                      （試験項目なし）
                    </td>
                  </tr>
                ) : (
                  tr.items.map((it, i) => (
                    <tr key={it.id}>
                      <td style={{ textAlign: "right" }}>{i + 1}</td>
                      <td>{it.testItem}</td>
                      <td className="multiline">{it.spec ?? ""}</td>
                      <td className="multiline">{it.result ?? ""}</td>
                      <td style={{ textAlign: "center" }}>
                        {it.judgment ? JUDGMENT_LABEL[it.judgment] : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}

        <h2>総合判定</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">総合判定</td>
              <td>
                <span className="text-lg font-bold">
                  {tr.overallResult ? JUDGMENT_LABEL[tr.overallResult] : ""}
                </span>
              </td>
              <td className="label-cell">判定者</td>
              <td>{tr.judgedBy ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">責任技術者</td>
              <td>{tr.chiefTechnician ?? ""}</td>
              <td className="label-cell">品質保証責任者</td>
              <td>{tr.qaResponsible ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">確認年月日</td>
              <td colSpan={3}>{fmtDate(tr.confirmedAt)}</td>
            </tr>
          </tbody>
        </table>

        {tr.notes ? (
          <>
            <h2>備考</h2>
            <table>
              <tbody>
                <tr>
                  <td style={{ whiteSpace: "pre-wrap" }}>{tr.notes}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        <h2>検印</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "33%" }}>試験者</th>
              <th style={{ width: "33%" }}>判定者</th>
              <th>品質保証責任者</th>
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
