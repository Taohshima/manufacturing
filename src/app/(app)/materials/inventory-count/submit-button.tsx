"use client";

import { useFormStatus } from "react-dom";

// 一括反映の送信ボタン。送信中は「反映中…」表示にして二重押しを防ぐ。
export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? "反映中…" : label}
    </button>
  );
}
