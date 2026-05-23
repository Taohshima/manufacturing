import Link from "next/link";

type Importer = {
  href: string;
  title: string;
  description: string;
  status: "ready" | "wip";
};

const IMPORTERS: Importer[] = [
  {
    href: "/import/suppliers",
    title: "取引先マスタ",
    description: "取引先会社名で突合。新規作成・差分更新。",
    status: "ready",
  },
  {
    href: "/import/materials",
    title: "資材・原料在庫マスタ",
    description: "名称＋区分で突合。カテゴリ・発注先を紐付け。初期在庫はStockTransactionで反映。",
    status: "ready",
  },
  {
    href: "/import/products",
    title: "製品マスタ＋配合（BOM）",
    description: "販売名で突合。製品本体と配合(BOM) を別CSVで取込。",
    status: "ready",
  },
  {
    href: "/import/manufacturing-orders",
    title: "製造記録",
    description: "ロット番号で突合。過去実績の一括取込。",
    status: "wip",
  },
];

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CSVインポート</h1>
        <p className="mt-1 text-sm text-slate-600">
          既存のスプレッドシートからCSVをエクスポートし、各テーブルに取り込みます。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {IMPORTERS.map((it) =>
          it.status === "ready" ? (
            <Link
              key={it.href}
              href={it.href}
              className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400 hover:shadow"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">{it.title}</h2>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  利用可能
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{it.description}</p>
            </Link>
          ) : (
            <div
              key={it.href}
              className="block rounded-lg border border-slate-200 bg-slate-50 p-4 opacity-70"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-700">
                  {it.title}
                </h2>
                <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  準備中
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{it.description}</p>
            </div>
          ),
        )}
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <p className="font-medium">取込の前提</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5 text-xs">
          <li>
            CSVは UTF-8 形式で保存してください（Excelの「CSV
            UTF-8」、Googleスプレッドシートのデフォルトのダウンロードは UTF-8）。
          </li>
          <li>
            1行目は列ヘッダ。日本語または Prisma フィールド名のいずれでも認識します。
          </li>
          <li>各取込画面で「差分を確認（dry-run）」してから「確定」を押します。</li>
        </ul>
      </div>
    </div>
  );
}
