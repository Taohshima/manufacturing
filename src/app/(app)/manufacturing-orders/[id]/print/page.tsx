import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { CheckResult, Prisma } from "@prisma/client";
import { PrintButton } from "@/components/print-button";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}

function fmtQty(v: Prisma.Decimal | null | undefined, digits = 4): string {
  if (v == null) return "";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function checkText(v: CheckResult | null): string {
  if (v === "OK") return "適";
  if (v === "NG") return "不適";
  return "";
}

export default async function ManufacturingOrderPrintPage({
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
      ingredients: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { material: true },
      },
      packagingItems: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!order) notFound();

  return (
    <div className="space-y-3">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          html, body { background: white; }
          .print-sheet { font-size: 10pt; }
          a { color: inherit; text-decoration: none; }
        }
        .print-sheet table { width: 100%; border-collapse: collapse; }
        .print-sheet th, .print-sheet td {
          border: 1px solid #555;
          padding: 4px 6px;
          font-size: 10pt;
          vertical-align: top;
        }
        .print-sheet th {
          background: #f1f5f9;
          font-weight: 600;
          text-align: left;
        }
        .print-sheet .label-cell {
          background: #f8fafc;
          font-weight: 600;
          width: 9rem;
          white-space: nowrap;
        }
        .print-sheet .signbox { height: 36px; }
      `}</style>

      {/* 画面用ツールバー */}
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
        {/* ヘッダ */}
        <div className="flex items-end justify-between border-b border-black pb-2">
          <div>
            <h1 className="text-xl font-bold">製造指図書</h1>
            <div className="mt-1 text-xs">
              指図 No. {order.id}
              {order.lotNumber ? ` ／ ロット番号 ${order.lotNumber}` : ""}
            </div>
          </div>
          <div className="text-right text-xs">
            <div>発行日：{fmtDate(new Date())}</div>
            {order.standardNo ? <div>製品標準書 No. {order.standardNo}</div> : null}
          </div>
        </div>

        {/* 基本情報 */}
        <table>
          <tbody>
            <tr>
              <td className="label-cell">販売名</td>
              <td colSpan={3}>{order.product.salesName}</td>
            </tr>
            <tr>
              <td className="label-cell">一般名称</td>
              <td>{order.product.genericName ?? ""}</td>
              <td className="label-cell">容量</td>
              <td>
                {fmtQty(order.product.capacity)} {order.product.capacityUnit}
              </td>
            </tr>
            <tr>
              <td className="label-cell">受注日</td>
              <td>{fmtDate(order.orderedAt)}</td>
              <td className="label-cell">指図年月日</td>
              <td>{fmtDate(order.instructedAt)}</td>
            </tr>
            <tr>
              <td className="label-cell">製造予定日</td>
              <td>{fmtDate(order.scheduledAt)}</td>
              <td className="label-cell">指図者</td>
              <td>{order.instructor ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">製造数量</td>
              <td>{fmtQty(order.plannedQty)}</td>
              <td className="label-cell">完成数量</td>
              <td>{fmtQty(order.completedQty)}</td>
            </tr>
          </tbody>
        </table>

        {/* 秤量条件 */}
        <h2 className="text-sm font-semibold">秤量条件</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">秤量年月日</td>
              <td>{fmtDate(order.weighingDate)}</td>
              <td className="label-cell">温度（℃）</td>
              <td>{fmtQty(order.temperature, 2)}</td>
              <td className="label-cell">湿度（%）</td>
              <td>{fmtQty(order.humidity, 2)}</td>
            </tr>
          </tbody>
        </table>

        {/* 配合原料 */}
        <h2 className="text-sm font-semibold">配合原料</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "3em" }}>No</th>
              <th>原料名</th>
              <th style={{ width: "7em" }}>１本あたり</th>
              <th style={{ width: "8em" }}>指図量</th>
              <th style={{ width: "8em" }}>秤量実績</th>
              <th style={{ width: "9em" }}>原料ロット番号</th>
              <th style={{ width: "4em" }}>確認</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {order.ingredients.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#666" }}>
                  配合原料が登録されていません
                </td>
              </tr>
            ) : (
              order.ingredients.map((ing, i) => (
                <tr key={ing.id}>
                  <td style={{ textAlign: "right" }}>{i + 1}</td>
                  <td>{ing.material.name}</td>
                  <td style={{ textAlign: "right" }}>
                    {fmtQty(ing.perUnitQty)} {ing.perUnitUnit}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmtQty(ing.plannedQty)} {ing.perUnitUnit}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmtQty(ing.actualQty)}{" "}
                    {ing.actualQty != null ? ing.perUnitUnit : ""}
                  </td>
                  <td>{ing.materialLotNumber ?? ""}</td>
                  <td style={{ textAlign: "center" }}>
                    {ing.checked ? "✓" : ""}
                  </td>
                  <td>{ing.notes ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* 混合 */}
        <h2 className="text-sm font-semibold">混合</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">混合年月日</td>
              <td>{fmtDate(order.mixedAt)}</td>
              <td className="label-cell">作業開始</td>
              <td>{order.mixStartTime ?? ""}</td>
              <td className="label-cell">作業終了</td>
              <td>{order.mixEndTime ?? ""}</td>
              <td className="label-cell">作業者</td>
              <td>{order.mixWorker ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">メモ</td>
              <td colSpan={7}>{order.mixNotes ?? ""}</td>
            </tr>
          </tbody>
        </table>

        {/* 充填 */}
        <h2 className="text-sm font-semibold">充填</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">充填年月日</td>
              <td>{fmtDate(order.filledAt)}</td>
              <td className="label-cell">充填容量</td>
              <td>
                {fmtQty(order.fillUnitVolume)} {order.fillUnit ?? ""}
              </td>
              <td className="label-cell">充填個数</td>
              <td>{order.fillCount ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">充填ミス数量</td>
              <td>{order.fillMissCount ?? ""}</td>
              <td className="label-cell">容器表示の確認</td>
              <td>{checkText(order.containerCheck)}</td>
              <td className="label-cell">作業者</td>
              <td>{order.fillWorker ?? ""}</td>
            </tr>
          </tbody>
        </table>

        {/* 包装 */}
        <h2 className="text-sm font-semibold">包装</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">包装年月日</td>
              <td>{fmtDate(order.packagedAt)}</td>
              <td className="label-cell">段ボールサイズ</td>
              <td>{order.cardboardSize ?? ""}</td>
              <td className="label-cell">作業者</td>
              <td>{order.packagingWorker ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">包装表示確認</td>
              <td>{checkText(order.packagingCheck)}</td>
              <td className="label-cell">ロット確認</td>
              <td>{checkText(order.lotCheck)}</td>
              <td className="label-cell">抜取り数量</td>
              <td>{fmtQty(order.sampleQty)}</td>
            </tr>
          </tbody>
        </table>

        {/* 包装表示 */}
        {order.packagingItems.length > 0 ? (
          <>
            <h2 className="text-sm font-semibold">包装表示</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "3em" }}>No</th>
                  <th>資材名</th>
                  <th style={{ width: "7em" }}>資材品番</th>
                  <th style={{ width: "6em" }}>使用数量</th>
                  <th style={{ width: "6em" }}>残数量</th>
                  <th>備考</th>
                </tr>
              </thead>
              <tbody>
                {order.packagingItems.map((p, i) => (
                  <tr key={p.id}>
                    <td style={{ textAlign: "right" }}>{i + 1}</td>
                    <td>{p.materialName}</td>
                    <td>{p.materialCode ?? ""}</td>
                    <td style={{ textAlign: "right" }}>{fmtQty(p.usedQty)}</td>
                    <td style={{ textAlign: "right" }}>{fmtQty(p.remainingQty)}</td>
                    <td>{p.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 備考 */}
        {order.notes ? (
          <>
            <h2 className="text-sm font-semibold">備考</h2>
            <table>
              <tbody>
                <tr>
                  <td>{order.notes}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}

        {/* 検印欄 */}
        <h2 className="text-sm font-semibold">検印</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "25%" }}>担当者</th>
              <th style={{ width: "25%" }}>確認者</th>
              <th style={{ width: "25%" }}>責任者</th>
              <th>承認</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="signbox"></td>
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
