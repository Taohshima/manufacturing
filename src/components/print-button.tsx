"use client";

export function PrintButton({
  label = "印刷",
  className = "rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`no-print ${className}`}
    >
      {label}
    </button>
  );
}
