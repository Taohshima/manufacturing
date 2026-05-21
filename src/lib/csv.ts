import Papa from "papaparse";

export type ColumnDefinition<T extends string = string> = {
  field: T;
  jpHeaders: string[]; // 受け入れる日本語ヘッダ候補
  required?: boolean;
  type?: "string" | "number" | "date";
};

export type ColumnMapping<T extends string> = {
  recognized: { field: T; sourceHeader: string }[];
  missing: T[]; // requiredなのに見つからなかった
  ignored: string[]; // 認識されなかったCSVヘッダ
};

export type ParsedCsv<T extends string> = {
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping<T>;
};

export type DryRunRowStatus = "new" | "update" | "unchanged" | "error";

export type DryRunRow = {
  rowIndex: number; // 1-based, ヘッダを除いた行番号
  status: DryRunRowStatus;
  key: string; // 識別用（例: companyName）
  message?: string; // エラー時のメッセージ
  incoming: Record<string, unknown>;
  current?: Record<string, unknown>;
};

export type DryRunResult = {
  total: number;
  newCount: number;
  updateCount: number;
  unchangedCount: number;
  errorCount: number;
  rows: DryRunRow[];
};

export type CommitResult = {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: { rowIndex: number; message: string }[];
};

const normalizeHeader = (s: string): string =>
  s
    .replace(/[（(][^）)]*[）)]/g, "") // 括弧書きの注釈を丸ごと除去
    .replace(/\s+/g, "")
    .toLowerCase();

export function detectMapping<T extends string>(
  headers: string[],
  defs: ColumnDefinition<T>[],
): ColumnMapping<T> {
  const recognized: { field: T; sourceHeader: string }[] = [];
  const usedHeaders = new Set<string>();

  for (const def of defs) {
    const candidates = [def.field, ...def.jpHeaders].map(normalizeHeader);
    const match = headers.find((h) => candidates.includes(normalizeHeader(h)));
    if (match) {
      recognized.push({ field: def.field, sourceHeader: match });
      usedHeaders.add(match);
    }
  }

  const recognizedFields = new Set(recognized.map((r) => r.field));
  const missing = defs
    .filter((d) => d.required && !recognizedFields.has(d.field))
    .map((d) => d.field);
  const ignored = headers.filter((h) => !usedHeaders.has(h));

  return { recognized, missing, ignored };
}

export function parseCsvText<T extends string>(
  text: string,
  defs: ColumnDefinition<T>[],
): ParsedCsv<T> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const rows = (parsed.data ?? []).filter(
    (r) => r && Object.values(r).some((v) => v !== ""),
  );
  const mapping = detectMapping(headers, defs);
  return { headers, rows, mapping };
}

/**
 * CSVの1行を、認識した列マッピングに基づいてフィールド名キーのレコードに変換する。
 * 値はトリム済み。空文字は null に変換。
 */
export function mapRow<T extends string>(
  row: Record<string, string>,
  mapping: ColumnMapping<T>,
): Partial<Record<T, string | null>> {
  const out: Partial<Record<T, string | null>> = {};
  for (const { field, sourceHeader } of mapping.recognized) {
    const raw = (row[sourceHeader] ?? "").trim();
    out[field] = raw === "" ? null : raw;
  }
  return out;
}

export function parseIntSafe(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,_\s]/g, ""));
  return Number.isFinite(n) && Math.trunc(n) === n ? n : null;
}

export function parseDecimalString(
  v: string | null | undefined,
): string | null {
  if (v == null || v === "") return null;
  const s = String(v).replace(/[,_\s]/g, "");
  return Number.isFinite(Number(s)) ? s : null;
}

export function parseDateSafe(v: string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  // 2024-01-31, 2024/01/31, 2024.01.31 などを許容
  const s = String(v).trim().replace(/[./]/g, "-");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
