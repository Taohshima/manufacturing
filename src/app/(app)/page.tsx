export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>
      <p className="text-sm text-slate-600">
        実装フェーズ1A（基盤）完了。今後ここに製造予定・発注予定・在庫不足アラートを表示します。
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile title="製造指示" description="ロット記録・進捗管理" />
        <Tile title="資材発注" description="発注状況・到着見込み" />
        <Tile title="品質標準書" description="製品標準書 兼 品質標準書の作成" />
      </div>
    </div>
  );
}

function Tile({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-lg font-semibold">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{description}</div>
    </div>
  );
}
