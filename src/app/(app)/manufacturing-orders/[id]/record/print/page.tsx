import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { CSSProperties } from "react";
import type { CheckResult, Prisma } from "@prisma/client";
import { PrintButton } from "@/components/print-button";

// 「製造記録-様式３ 製造記録表」を原本（【MT】製造記録表フォーマット）と同じ罫線構成で出力する。
// 原本は 33 列（A〜AG）のグリッドにセル結合で組まれているため、同じ列幅・結合で再現している。
// アプリに値が入っている項目は印字し、未入力の項目は手書き用の空欄のまま出す。

// 原本の列幅（A〜AG）。合計に対する比率で幅を決める。
const COL_WIDTHS = [
  4.71, 4.71, 2.14, 5.86, 1.14, 3.29, 3.29, 7.86, 3.14, 4.71, 1.14, 1.14, 3.29,
  2.14, 6.86, 5.0, 3.29, 1.14, 1.14, 2.14, 4.71, 2.14, 1.14, 4.71, 2.14, 1.14,
  1.14, 2.14, 3.29, 2.14, 5.86, 1.14, 5.0,
];
const COL_TOTAL = COL_WIDTHS.reduce((a, b) => a + b, 0);

const MIN_INGREDIENT_ROWS = 8;
const MIN_PACKAGING_ROWS = 6;

function fmtQty(v: Prisma.Decimal | number | null | undefined, digits = 4): string {
  if (v == null) return "";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function normalizeUnit(u: string): string {
  return u.normalize("NFKC").trim().toLowerCase();
}

// 値があれば「2026年11月5日」、なければ手書き用の「年　月　日」。
function DateCell({ value }: { value: Date | null | undefined }) {
  if (!value) {
    return (
      <span className="ymd-blank">
        <span>年</span>
        <span>月</span>
        <span>日</span>
      </span>
    );
  }
  return (
    <span>
      {value.getUTCFullYear()}年{value.getUTCMonth() + 1}月{value.getUTCDate()}日
    </span>
  );
}

// 縦書きの見出し。writing-mode は表セル内・印刷時の寸法計算が不安定なため、1文字ずつ縦に積む。
function VerticalLabel({ text }: { text: string }) {
  return (
    <span className="vstack">
      {[...text].map((ch, i) => (
        <span key={i}>{ch}</span>
      ))}
    </span>
  );
}

// 「適・不適」。判定済みなら該当する側を丸で囲む。
function FitChoice({ value }: { value: CheckResult | null }) {
  return (
    <span className="choice">
      <span className={value === "OK" ? "circled" : undefined}>適</span>
      <span>・</span>
      <span className={value === "NG" ? "circled" : undefined}>不適</span>
    </span>
  );
}

export default async function ManufacturingRecordPrintPage({
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

  // 配合原料欄には原料のみを出す（容器・キャップ等の包装資材は「包装表示」欄の対象）。
  const ingredients = order.ingredients.filter(
    (ing) => ing.material.division !== "PACKAGING",
  );
  const ingredientBlankRows = Math.max(0, MIN_INGREDIENT_ROWS - ingredients.length);
  const ingredientRowCount = ingredients.length + ingredientBlankRows;

  const packagingItems = order.packagingItems;
  const packagingBlankRows = Math.max(0, MIN_PACKAGING_ROWS - packagingItems.length);
  const packagingRowCount = packagingItems.length + packagingBlankRows;

  // 総量(合計)は全行の単位が揃っているときだけ算出する（混在時は空欄）。
  const units = new Set(ingredients.map((ing) => normalizeUnit(ing.perUnitUnit)));
  const totalUnit =
    ingredients.length > 0 && units.size === 1 ? ingredients[0].perUnitUnit : null;
  const perUnitTotal = totalUnit
    ? ingredients.reduce((sum, ing) => sum + Number(ing.perUnitQty), 0)
    : null;
  const plannedTotal = totalUnit
    ? ingredients.reduce((sum, ing) => sum + Number(ing.plannedQty), 0)
    : null;

  const standardNo = order.standardNo ?? order.product.standardNo ?? "";

  // 原本は原料8行・包装6行で計29行。行が増えた製品でもA4 1枚に収まるよう、
  // 標準の行高さ(7.6mm)で入りきらない分だけ行を詰める（下限5.5mm）。
  const totalRows = 3 + (ingredientRowCount + 4) + 2 + 2 + (packagingRowCount + 4);
  const rowHeightMm = Math.max(5.5, Math.min(7.6, 246 / totalRows));

  return (
    <div className="space-y-3">
      <style>{`
        @page { size: A4 portrait; margin: 14mm 12mm; }
        @media print {
          html, body { background: white; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          a { color: inherit; text-decoration: none; }
          .record-sheet { box-shadow: none !important; padding: 0 !important; margin: 0 !important; }
        }
        .record-sheet {
          width: 186mm;
          max-width: 100%;
          margin: 0 auto;
          background: white;
          color: #000;
          padding: 6mm;
          box-shadow: 0 0 0 1px #e2e8f0;
          box-sizing: content-box;
        }
        .record-sheet .form-no { font-size: 10pt; }
        .record-sheet .form-title {
          font-size: 18pt;
          text-align: center;
          line-height: 1.2;
          margin: 3mm 0 2mm;
        }
        .record-sheet table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
          border: 1.5pt solid #000;
        }
        .record-sheet td {
          border: 0.5pt solid #000;
          height: var(--row-h, 7.6mm);
          padding: 0 1mm;
          font-size: 10pt;
          line-height: 1.15;
          text-align: center;
          vertical-align: middle;
          overflow: hidden;
          overflow-wrap: anywhere;
        }
        .record-sheet tr.sec-end > td,
        .record-sheet td.sec-end { border-bottom: 1.5pt solid #000; }
        .record-sheet td.side {
          font-size: 9.5pt;
          padding: 0;
        }
        .record-sheet .vstack {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          line-height: 1.3;
        }
        .record-sheet td.small { font-size: 9pt; }
        .record-sheet td.left { text-align: left; }
        .record-sheet td.right { text-align: right; }
        .record-sheet td.tall { height: calc(var(--row-h, 7.6mm) * 1.5); }
        .record-sheet tr { break-inside: avoid; page-break-inside: avoid; }
        .record-sheet .with-unit {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1mm;
        }
        .record-sheet .with-unit > .val { flex: 1; text-align: center; }
        .record-sheet .with-unit > .unit { font-size: 9pt; white-space: nowrap; }
        .record-sheet .ymd-blank {
          display: flex;
          justify-content: flex-end;
          gap: 6mm;
          padding-right: 0.5mm;
        }
        .record-sheet .choice { white-space: nowrap; }
        .record-sheet .circled {
          display: inline-block;
          border: 0.8pt solid #000;
          border-radius: 999px;
          padding: 0 1.2mm;
        }
        .record-sheet .confirm-lines {
          display: flex;
          flex-direction: column;
          gap: 2.5mm;
          font-size: 9pt;
          white-space: nowrap;
        }
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

      <div className="record-sheet">
        <div className="form-no">製造記録-様式３</div>
        <h1 className="form-title">製造記録表</h1>

        <table style={{ "--row-h": `${rowHeightMm}mm` } as CSSProperties}>
          <colgroup>
            {COL_WIDTHS.map((w, i) => (
              <col key={i} style={{ width: `${(w / COL_TOTAL) * 100}%` }} />
            ))}
          </colgroup>
          <tbody>
            {/* 3行目：販売名／製品標準書 No. */}
            <tr>
              <td colSpan={6}>販売名</td>
              <td colSpan={14}>{order.product.salesName}</td>
              <td colSpan={7} className="small">
                製品標準書 No.
              </td>
              <td colSpan={6}>{standardNo}</td>
            </tr>
            {/* 4行目：製造番号・ロット番号／指図者 */}
            <tr>
              <td colSpan={6} className="small">
                製造番号・ロット番号
              </td>
              <td colSpan={10}>{order.lotNumber ?? ""}</td>
              <td colSpan={7}>指図者</td>
              <td colSpan={10}>{order.instructor ?? ""}</td>
            </tr>
            {/* 5行目：製造数量／指図年月日 */}
            <tr className="sec-end">
              <td colSpan={6}>製造数量</td>
              <td colSpan={10}>
                <div className="with-unit">
                  <span className="val">{fmtQty(order.plannedQty)}</span>
                  <span className="unit" style={{ paddingRight: "8mm" }}>
                    本
                  </span>
                </div>
              </td>
              <td colSpan={7}>指図年月日</td>
              <td colSpan={10}>
                {order.instructedAt ? <DateCell value={order.instructedAt} /> : ""}
              </td>
            </tr>

            {/* 6行目〜：原料名及び配合量 */}
            <tr>
              <td rowSpan={ingredientRowCount + 4} className="side sec-end">
                <VerticalLabel text="原料名及び配合量" />
              </td>
              <td colSpan={5}>秤量年月日</td>
              <td colSpan={6}>
                <DateCell value={order.weighingDate} />
              </td>
              <td colSpan={11}>
                <div className="with-unit">
                  <span>温度</span>
                  <span className="val">{fmtQty(order.temperature, 1)}</span>
                  <span className="unit">℃</span>
                </div>
              </td>
              <td colSpan={10}>
                <div className="with-unit">
                  <span>湿度</span>
                  <span className="val">{fmtQty(order.humidity, 1)}</span>
                  <span className="unit">％</span>
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={5}>配合原料名</td>
              <td colSpan={6}>原料ロット番号</td>
              <td colSpan={4} className="small">
                １本あたりの容量
              </td>
              <td colSpan={7}>指図量</td>
              <td colSpan={6}>秤量</td>
              <td colSpan={4} className="small">
                チェック
              </td>
            </tr>
            {ingredients.map((ing) => (
              <tr key={ing.id}>
                <td colSpan={5} className="small">
                  {ing.material.name}
                </td>
                <td colSpan={6} className="small">
                  {ing.materialLotNumber ?? ""}
                </td>
                <td colSpan={4}>
                  <div className="with-unit">
                    <span className="val">{fmtQty(ing.perUnitQty)}</span>
                    <span className="unit">{ing.perUnitUnit}</span>
                  </div>
                </td>
                <td colSpan={7} className="right">
                  {fmtQty(ing.plannedQty)}
                </td>
                <td colSpan={6} className="right">
                  {fmtQty(ing.actualQty)}
                </td>
                <td colSpan={4}>{ing.checked ? "✓" : ""}</td>
              </tr>
            ))}
            {Array.from({ length: ingredientBlankRows }).map((_, i) => (
              <tr key={`ing-blank-${i}`}>
                <td colSpan={5}></td>
                <td colSpan={6}></td>
                <td colSpan={4}></td>
                <td colSpan={7}></td>
                <td colSpan={6}></td>
                <td colSpan={4}></td>
              </tr>
            ))}
            <tr>
              <td colSpan={11}>総量(合計)</td>
              <td colSpan={4}>
                <div className="with-unit">
                  <span className="val">{fmtQty(perUnitTotal)}</span>
                  <span className="unit">{totalUnit ?? ""}</span>
                </div>
              </td>
              <td colSpan={7} className="right">
                {fmtQty(plannedTotal)}
              </td>
              <td colSpan={10}></td>
            </tr>
            <tr className="sec-end">
              <td colSpan={6}>備考</td>
              <td colSpan={26} className="left small">
                {order.notes ?? ""}
              </td>
            </tr>

            {/* 混合 */}
            <tr>
              <td rowSpan={2} className="side sec-end">
                <span>混合</span>
              </td>
              <td colSpan={6}>混合年月日</td>
              <td colSpan={6}>作業開始時刻</td>
              <td colSpan={6}>作業終了時刻</td>
              <td colSpan={6}>作業者</td>
              <td colSpan={8}>備考</td>
            </tr>
            <tr className="sec-end">
              <td colSpan={6}>
                <DateCell value={order.mixedAt} />
              </td>
              <td colSpan={6}>{order.mixStartTime ?? ""}</td>
              <td colSpan={6}>{order.mixEndTime ?? ""}</td>
              <td colSpan={6}>{order.mixWorker ?? ""}</td>
              <td colSpan={8} className="small">
                {order.mixNotes ?? ""}
              </td>
            </tr>

            {/* 充填 */}
            <tr>
              <td rowSpan={2} className="side sec-end">
                <VerticalLabel text="充填" />
              </td>
              <td colSpan={6}>充填年月日</td>
              <td colSpan={6}>充填容量×数量</td>
              <td colSpan={6}>充填ミス数量</td>
              <td colSpan={6} className="small">
                容器表示の確認
              </td>
              <td colSpan={8}>作業者</td>
            </tr>
            <tr className="sec-end">
              <td colSpan={6}>
                <DateCell value={order.filledAt} />
              </td>
              <td colSpan={6}>
                <div className="with-unit">
                  <span className="val">{fmtQty(order.fillUnitVolume)}</span>
                  <span className="unit">{order.fillUnit ?? "g"}×</span>
                  <span className="val">{order.fillCount ?? ""}</span>
                </div>
              </td>
              <td colSpan={6}>
                <div className="with-unit">
                  <span className="val">{order.fillMissCount ?? ""}</span>
                  <span>個</span>
                </div>
              </td>
              <td colSpan={6}>
                <FitChoice value={order.containerCheck} />
              </td>
              <td colSpan={8}>{order.fillWorker ?? ""}</td>
            </tr>

            {/* 包装表示 */}
            <tr>
              <td rowSpan={packagingRowCount + 4} className="side">
                <span>
                  包装
                  <br />
                  表示
                </span>
              </td>
              <td colSpan={3}>資材名</td>
              <td colSpan={9}>資材品番</td>
              <td colSpan={6}>使用数量</td>
              <td colSpan={6}>残数量</td>
              <td colSpan={8} className="small">
                備考
              </td>
            </tr>
            {packagingItems.map((p) => (
              <tr key={p.id}>
                <td colSpan={3} className="small">
                  {p.materialName}
                </td>
                <td colSpan={9} className="small">
                  {p.materialCode ?? ""}
                </td>
                <td colSpan={6}>{fmtQty(p.usedQty)}</td>
                <td colSpan={6}>{fmtQty(p.remainingQty)}</td>
                <td colSpan={8} className="small">
                  {p.notes ?? ""}
                </td>
              </tr>
            ))}
            {Array.from({ length: packagingBlankRows }).map((_, i) => (
              <tr key={`pkg-blank-${i}`}>
                <td colSpan={3}></td>
                <td colSpan={9}></td>
                <td colSpan={6}></td>
                <td colSpan={6}></td>
                <td colSpan={8}></td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="small">
                段ボール
              </td>
              <td colSpan={9}>
                <div className="with-unit">
                  <span className="val">{order.cardboardSize ?? ""}</span>
                  <span className="unit">サイズ</span>
                </div>
              </td>
              <td colSpan={6}>-</td>
              <td colSpan={6}>-</td>
              <td colSpan={8}>-</td>
            </tr>
            <tr>
              <td colSpan={6}>包装年月日</td>
              <td colSpan={6}>
                <DateCell value={order.packagedAt} />
              </td>
              <td colSpan={6}>作業者</td>
              <td colSpan={6}>{order.packagingWorker ?? ""}</td>
              <td colSpan={8} rowSpan={2}>
                <div className="confirm-lines">
                  <span>
                    包装表示： <FitChoice value={order.packagingCheck} />
                  </span>
                  <span>
                    ロット確認： <FitChoice value={order.lotCheck} />
                  </span>
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={6} className="tall">
                完成数量
              </td>
              <td colSpan={6} className="tall">
                {fmtQty(order.completedQty)}
              </td>
              <td colSpan={6} className="tall">
                抜取り数量
              </td>
              <td colSpan={6} className="tall">
                {fmtQty(order.sampleQty)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
