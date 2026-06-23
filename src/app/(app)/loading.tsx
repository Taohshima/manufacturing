export default function Loading() {
  return (
    <div className="flex items-center gap-3 px-4 py-12 text-sm text-slate-500">
      <span
        aria-hidden
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      <span>読み込み中…</span>
    </div>
  );
}
