import { CsvImporter } from "@/components/csv-importer";
import type { ColumnDefinition } from "@/lib/csv";
import { commitSuppliers, dryRunSuppliers } from "./actions";

type SupplierField =
  | "companyName"
  | "officeName"
  | "postalCode"
  | "address"
  | "phone"
  | "fax"
  | "websiteUrl"
  | "contactPerson"
  | "email"
  | "orderMethod"
  | "paymentMethod"
  | "paymentDay"
  | "paymentDivision"
  | "paymentSite"
  | "searchLabel"
  | "alias";

const COLUMNS: ColumnDefinition<SupplierField>[] = [
  {
    field: "companyName",
    jpHeaders: ["取引先会社名", "会社名", "取引先名"],
    required: true,
  },
  { field: "officeName", jpHeaders: ["取引先事業所名", "事業所名"] },
  { field: "postalCode", jpHeaders: ["郵便番号", "〒"] },
  { field: "address", jpHeaders: ["住所", "所在地"] },
  { field: "phone", jpHeaders: ["電話", "電話番号", "TEL"] },
  { field: "fax", jpHeaders: ["FAX", "FAX番号", "ファックス", "ファクス"] },
  {
    field: "websiteUrl",
    jpHeaders: ["URL", "会社URL", "WebサイトURL", "ホームページ"],
  },
  { field: "contactPerson", jpHeaders: ["発注先担当者", "担当者"] },
  {
    field: "email",
    jpHeaders: ["メール", "メールアドレス", "発注先メールアドレス", "Email"],
  },
  { field: "orderMethod", jpHeaders: ["発注方法"] },
  { field: "paymentMethod", jpHeaders: ["支払方法"] },
  { field: "paymentDay", jpHeaders: ["支払日"], type: "number" },
  {
    field: "paymentDivision",
    jpHeaders: ["支払区分", "現金/クレジット", "現金クレジット"],
  },
  { field: "paymentSite", jpHeaders: ["支払サイト", "当月/翌月"] },
  {
    field: "searchLabel",
    jpHeaders: ["検索ラベル", "発注先検索ラベル"],
  },
  { field: "alias", jpHeaders: ["呼称", "別名"] },
];

export default function ImportSuppliersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">取引先マスタの取込</h1>
        <p className="mt-1 text-sm text-slate-600">
          スプレッドシート「取引先マスタ」シートをCSVエクスポートして取り込みます。「取引先会社名」で既存レコードと突合し、無ければ新規作成、有れば差分があれば更新します。
        </p>
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
        dryRunAction={dryRunSuppliers}
        commitAction={commitSuppliers}
      />
    </div>
  );
}
