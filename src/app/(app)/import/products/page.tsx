import { CsvImporter } from "@/components/csv-importer";
import type { ColumnDefinition } from "@/lib/csv";
import {
  commitProducts,
  commitRecipes,
  dryRunProducts,
  dryRunRecipes,
  type ProductField,
  type RecipeField,
} from "./actions";

const PRODUCT_COLUMNS: ColumnDefinition<ProductField>[] = [
  {
    field: "salesName",
    jpHeaders: ["販売名", "製品販売名", "製品名"],
    required: true,
  },
  { field: "genericName", jpHeaders: ["一般名称", "一般名"] },
  { field: "standardNo", jpHeaders: ["基準番号", "製品番号", "規格番号"] },
  { field: "capacity", jpHeaders: ["容量", "内容量"], required: true, type: "number" },
  { field: "capacityUnit", jpHeaders: ["容量単位", "単位"], required: true },
  { field: "controlDivision", jpHeaders: ["管理区分"] },
  { field: "expiryMonths", jpHeaders: ["使用期限", "使用期限月"], type: "number" },
  { field: "caseCount", jpHeaders: ["ケース入数", "入数"], type: "number" },
  { field: "storageLocation", jpHeaders: ["保管場所"] },
  { field: "salesPrice", jpHeaders: ["販売価格", "売価"], type: "number" },
  { field: "productCost", jpHeaders: ["製品原価", "原価"], type: "number" },
  { field: "stockQty", jpHeaders: ["在庫数", "在庫数量"], type: "number" },
];

const RECIPE_COLUMNS: ColumnDefinition<RecipeField>[] = [
  {
    field: "productSalesName",
    jpHeaders: ["製品販売名", "販売名", "製品名"],
    required: true,
  },
  {
    field: "materialName",
    jpHeaders: ["材料名", "資材名", "原料名", "名称"],
    required: true,
  },
  {
    field: "materialDivision",
    jpHeaders: ["材料区分", "区分"],
    required: true,
  },
  {
    field: "usageQty",
    jpHeaders: ["利用量", "使用量", "配合量", "1本あたり利用量", "１本あたり利用量"],
    required: true,
    type: "number",
  },
  { field: "usageUnit", jpHeaders: ["利用単位", "単位"] },
  { field: "sortOrder", jpHeaders: ["順序", "並び順", "ソート"], type: "number" },
];

export default function ImportProductsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">製品マスタ＋配合(BOM) の取込</h1>
        <p className="mt-1 text-sm text-slate-600">
          製品本体と配合(BOM) を別々のCSVで取り込みます。先に「製品マスタ」を取り込んでから「配合(BOM)」を取り込んでください。
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">前提</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5 text-xs">
          <li>
            製品は「販売名」で既存と突合します。重複名がある場合は事前に名寄せしてください。
          </li>
          <li>
            配合(BOM) は「製品販売名」と「材料名＋区分（原料/資材）」で材料を解決します。先に資材・原料マスタの取込を完了させてください。
          </li>
          <li>
            利用単位を空にすると、材料マスタの単位を自動採用します。
          </li>
        </ul>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">① 製品マスタ</h2>

        <details className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            受け入れる列ヘッダ
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {PRODUCT_COLUMNS.map((c) => (
              <li key={c.field}>
                <span className="font-mono text-emerald-700">{c.field}</span>
                {c.required ? <span className="ml-1 text-red-700">*</span> : null}
                <span className="ml-2 text-slate-600">
                  ← {c.jpHeaders.join(" / ")}
                </span>
              </li>
            ))}
          </ul>
        </details>

        <CsvImporter
          defs={PRODUCT_COLUMNS}
          dryRunAction={dryRunProducts}
          commitAction={commitProducts}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">② 配合(BOM)</h2>

        <details className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            受け入れる列ヘッダ
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {RECIPE_COLUMNS.map((c) => (
              <li key={c.field}>
                <span className="font-mono text-emerald-700">{c.field}</span>
                {c.required ? <span className="ml-1 text-red-700">*</span> : null}
                <span className="ml-2 text-slate-600">
                  ← {c.jpHeaders.join(" / ")}
                </span>
              </li>
            ))}
          </ul>
        </details>

        <CsvImporter
          defs={RECIPE_COLUMNS}
          dryRunAction={dryRunRecipes}
          commitAction={commitRecipes}
        />
      </section>
    </div>
  );
}
