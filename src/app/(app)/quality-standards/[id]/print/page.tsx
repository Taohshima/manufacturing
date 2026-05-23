import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { PrintButton } from "@/components/print-button";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}
function fmtPercent(v: Prisma.Decimal | null | undefined): string {
  if (v == null) return "";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

export default async function QualityStandardPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const qs = await prisma.qualityStandard.findUnique({
    where: { id },
    include: {
      product: true,
      revisions: { orderBy: [{ revisionNumber: "asc" }] },
      ingredients: { orderBy: [{ no: "asc" }, { id: "asc" }] },
      methodSteps: { orderBy: [{ stepNo: "asc" }, { id: "asc" }] },
      processes: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { manufacturingSite: true },
      },
      testSpecs: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      workNotes: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      efficacies: {
        include: { efficacyClaim: true },
      },
    },
  });
  if (!qs) notFound();

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
        .print-sheet th { background: #f1f5f9; font-weight: 600; text-align: left; }
        .print-sheet .label-cell {
          background: #f8fafc;
          font-weight: 600;
          width: 11rem;
          white-space: nowrap;
        }
        .print-sheet h2 { font-size: 11pt; font-weight: 600; margin-top: 0.5em; }
        .print-sheet .multiline { white-space: pre-wrap; }
      `}</style>

      {/* 画面用ツールバー */}
      <div className="no-print flex items-center justify-between">
        <Link
          href={`/quality-standards/${qs.id}`}
          className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
        >
          ← 編集に戻る
        </Link>
        <PrintButton label="印刷 / PDF保存" />
      </div>

      <div className="print-sheet space-y-3">
        {/* ヘッダ */}
        <div className="flex items-end justify-between border-b border-black pb-2">
          <div>
            <h1 className="text-xl font-bold">製品標準書 兼 品質標準書</h1>
            <div className="mt-1 text-xs">
              管理番号 {qs.controlNumber}
            </div>
          </div>
          <div className="text-right text-xs">
            <div>制定日：{fmtDate(qs.establishedAt)}</div>
            <div>制定者：{qs.establishedBy ?? ""}</div>
          </div>
        </div>

        {/* 基本情報 */}
        <table>
          <tbody>
            <tr>
              <td className="label-cell">販売名</td>
              <td colSpan={3}>{qs.product.salesName}</td>
            </tr>
            <tr>
              <td className="label-cell">一般名称</td>
              <td>{qs.product.genericName ?? ""}</td>
              <td className="label-cell">製品の種類</td>
              <td>{qs.productCategory ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">製造販売業者</td>
              <td colSpan={3}>{qs.manufacturer ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">製造販売業者住所</td>
              <td colSpan={3}>{qs.manufacturerAddr ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">許可年月日</td>
              <td>{fmtDate(qs.permitDate)}</td>
              <td className="label-cell">許可番号</td>
              <td>{qs.permitNumber ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">届出</td>
              <td colSpan={3}>{qs.notificationType ?? ""}</td>
            </tr>
          </tbody>
        </table>

        {/* 改訂履歴 */}
        {qs.revisions.length > 0 ? (
          <>
            <h2>改訂履歴</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "5em" }}>No</th>
                  <th style={{ width: "8em" }}>改訂年月日</th>
                  <th style={{ width: "30%" }}>改訂理由</th>
                  <th>改訂事項</th>
                  <th style={{ width: "10em" }}>改訂者</th>
                </tr>
              </thead>
              <tbody>
                {qs.revisions.map((r) => (
                  <tr key={r.id}>
                    <td>{r.revisionNumber}</td>
                    <td>{fmtDate(r.revisedAt)}</td>
                    <td className="multiline">{r.reason ?? ""}</td>
                    <td className="multiline">{r.changes ?? ""}</td>
                    <td>{r.revisedBy ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 成分及び配合量 */}
        <h2>成分及び配合量</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "3em" }}>No</th>
              <th>原料名</th>
              <th style={{ width: "5em" }}>配合量(%)</th>
              <th>成分名</th>
              <th style={{ width: "5em" }}>複合(%)</th>
              <th style={{ width: "6em" }}>規格</th>
              <th style={{ width: "5em" }}>分量(%)</th>
              <th style={{ width: "3em" }}>順位</th>
            </tr>
          </thead>
          <tbody>
            {qs.ingredients.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#666" }}>
                  （未登録）
                </td>
              </tr>
            ) : (
              qs.ingredients.map((r) => (
                <tr key={r.id}>
                  <td style={{ textAlign: "right" }}>{r.no}</td>
                  <td>{r.rawMaterialName ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtPercent(r.amountPercent)}</td>
                  <td>{r.componentName ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtPercent(r.complexPercent)}</td>
                  <td>{r.spec ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{fmtPercent(r.portion)}</td>
                  <td style={{ textAlign: "right" }}>{r.rank ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* 製造方法 */}
        {qs.methodSteps.length > 0 ? (
          <>
            <h2>製造方法</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "5em" }}>ステップ</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {qs.methodSteps.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "right" }}>{s.stepNo}</td>
                    <td className="multiline">{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 製造工程 */}
        {qs.processes.length > 0 ? (
          <>
            <h2>製造所の情報及び製造工程</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "3em" }}>順</th>
                  <th>製造工程</th>
                  <th>製造所</th>
                </tr>
              </thead>
              <tbody>
                {qs.processes.map((p) => (
                  <tr key={p.id}>
                    <td style={{ textAlign: "right" }}>{p.sortOrder}</td>
                    <td>{p.process ?? ""}</td>
                    <td>{p.manufacturingSite?.name ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 規格及び試験方法 */}
        {qs.testSpecs.length > 0 ? (
          <>
            <h2>規格及び試験方法</h2>
            <table>
              <thead>
                <tr>
                  <th>試験項目</th>
                  <th>規格</th>
                  <th>試験法</th>
                  <th style={{ width: "10em" }}>頻度</th>
                </tr>
              </thead>
              <tbody>
                {qs.testSpecs.map((t) => (
                  <tr key={t.id}>
                    <td>{t.testItem}</td>
                    <td className="multiline">{t.spec ?? ""}</td>
                    <td className="multiline">{t.method ?? ""}</td>
                    <td>{t.frequency ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 包装及び表示内容 */}
        <h2>包装及び表示内容</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">内容量</td>
              <td>{qs.pkgCapacity ?? ""}</td>
              <td className="label-cell">色番・記号</td>
              <td>{qs.pkgColorCode ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">製造販売業者問合せ先</td>
              <td colSpan={3}>{qs.pkgManufacturerContact ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">発売元</td>
              <td colSpan={3}>{qs.pkgDistributorContact ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">全成分</td>
              <td colSpan={3} className="multiline">{qs.pkgAllIngredients ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">用法及び容量</td>
              <td colSpan={3} className="multiline">{qs.pkgUsageMethod ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">使用上の注意</td>
              <td colSpan={3} className="multiline">{qs.pkgUsageNotes ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">識別表示</td>
              <td>{qs.pkgIdentification ?? ""}</td>
              <td className="label-cell">その他</td>
              <td>{qs.pkgOther ?? ""}</td>
            </tr>
            {qs.pkgNotes ? (
              <tr>
                <td className="label-cell">備考</td>
                <td colSpan={3} className="multiline">{qs.pkgNotes}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* 製品化規格 */}
        <h2>製品化規格</h2>
        <table>
          <tbody>
            <tr>
              <td className="label-cell">充填量</td>
              <td>{qs.spFillVolume ?? ""}</td>
              <td className="label-cell">ロット印字機</td>
              <td>{qs.spLotPrinter ?? ""}</td>
            </tr>
            <tr>
              <td className="label-cell">印字文字</td>
              <td>{qs.spLotText ?? ""}</td>
              <td className="label-cell">段ボール</td>
              <td>{qs.spCardboardSize ?? ""}</td>
            </tr>
          </tbody>
        </table>

        {/* 作業上の注意点 */}
        {qs.workNotes.length > 0 ? (
          <>
            <h2>作業上の注意点</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "12em" }}>作業名</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {qs.workNotes.map((w) => (
                  <tr key={w.id}>
                    <td>{w.workName}</td>
                    <td className="multiline">{w.content ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* 効能効果 */}
        {qs.efficacies.length > 0 ? (
          <>
            <h2>効能効果</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "4em" }}>No</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {qs.efficacies
                  .sort((a, b) => a.efficacyClaim.no - b.efficacyClaim.no)
                  .map((e) => (
                    <tr key={e.efficacyClaimId}>
                      <td style={{ textAlign: "right" }}>{e.efficacyClaim.no}</td>
                      <td>{e.efficacyClaim.text}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : null}

        {qs.notes ? (
          <>
            <h2>備考</h2>
            <table>
              <tbody>
                <tr>
                  <td className="multiline">{qs.notes}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </div>
  );
}
