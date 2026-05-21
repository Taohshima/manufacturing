import { CsvImporter } from "@/components/csv-importer";
import type { ColumnDefinition } from "@/lib/csv";
import { commitMaterials, dryRunMaterials } from "./actions";

type MaterialField =
  | "name"
  | "division"
  | "categoryName"
  | "unit"
  | "purchasePrice"
  | "stockQty"
  | "lastInventoryDate"
  | "supplierCompanyName"
  | "consignedQty"
  | "consignedOwner"
  | "storageLocation"
  | "notes"
  | "docUrl";

const COLUMNS: ColumnDefinition<MaterialField>[] = [
  {
    field: "name",
    jpHeaders: ["名称", "資材名", "原料名", "製品名", "アイテム名"],
    required: true,
  },
  { field: "division", jpHeaders: ["区分"], required: true },
  {
    field: "categoryName",
    jpHeaders: ["カテゴリ", "カテゴリー", "種別"],
    required: true,
  },
  { field: "unit", jpHeaders: ["単位"], required: true },
  { field: "purchasePrice", jpHeaders: ["購入単価", "単価"], type: "number" },
  {
    field: "stockQty",
    jpHeaders: ["在庫数量", "在庫数", "在庫"],
    type: "number",
  },
  {
    field: "lastInventoryDate",
    jpHeaders: ["最終棚卸日", "棚卸日"],
    type: "date",
  },
  {
    field: "supplierCompanyName",
    jpHeaders: ["発注先", "取引先", "取引先会社名", "仕入先"],
  },
  {
    field: "consignedQty",
    jpHeaders: ["預かり在庫数量", "預かり数量", "預かり"],
    type: "number",
  },
  { field: "consignedOwner", jpHeaders: ["預かり元"] },
  { field: "storageLocation", jpHeaders: ["保管場所"] },
  { field: "notes", jpHeaders: ["注文詳細", "備考", "メモ"] },
  { field: "docUrl", jpHeaders: ["資料URL", "資料"] },
];

export default function ImportMaterialsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">資材・原料マスタの取込</h1>
        <p className="mt-1 text-sm text-slate-600">
          スプレッドシート「資材・原料在庫マスタ」シートをCSVエクスポートして取り込みます。「名称＋区分」で既存レコードと突合します。
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">前提</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5 text-xs">
          <li>
            「区分」列は <span className="font-mono">原料 / 資材 / 製品</span>{" "}
            のいずれかを指定。
          </li>
          <li>
            「カテゴリ」は事前に <em>カテゴリマスタ</em>{" "}
            に存在する必要があります（既にシード投入済み）。
          </li>
          <li>
            「発注先」列を入れる場合は、先に <em>取引先マスタ</em>{" "}
            の取込を完了させてください（取引先会社名で突合）。
          </li>
          <li>
            「在庫数量」を指定すると、新規作成時は{" "}
            <span className="font-mono">StockTransaction(INVENTORY_ADJUST)</span>{" "}
            を1件作成して反映します。
          </li>
        </ul>
      </div>

      <details className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          受け入れる列ヘッダ（クリックして展開）
        </summary>
        <ul className="mt-2 space-y-1 text-xs">
          {COLUMNS.map((c) => (
            <li key={c.field}>
              <span className="font-mono text-emerald-700">{c.field}</span>
              {c.required ? (
                <span className="ml-1 text-red-700">*</span>
              ) : null}
              <span className="ml-2 text-slate-600">
                ← {c.jpHeaders.join(" / ")}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <CsvImporter
        defs={COLUMNS}
        dryRunAction={dryRunMaterials}
        commitAction={commitMaterials}
      />
    </div>
  );
}
