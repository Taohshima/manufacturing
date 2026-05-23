// CSVを書き出すための小さなヘルパ群。

export function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvBody(rows: (string | number | null | undefined)[][]): string {
  // BOM 付きで返してExcelでの日本語文字化けを防ぐ
  return (
    "﻿" +
    rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") +
    "\r\n"
  );
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
