export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CSVインポート</h1>
        <p className="mt-1 text-sm text-slate-600">
          既存のスプレッドシートからCSVをエクスポートし、各テーブルに取り込みます。
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        この画面はフェーズ1Bで実装予定です。各シートに対応するインポーターは以下の順に用意します:
        <ol className="mt-2 ml-5 list-decimal space-y-1">
          <li>カテゴリマスタ</li>
          <li>取引先マスタ</li>
          <li>資材・原料在庫マスタ</li>
          <li>製品マスタ＋配合（BOM）</li>
          <li>製造記録</li>
        </ol>
      </div>
    </div>
  );
}
