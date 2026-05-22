"use client";

import { useMemo, useState } from "react";
import {
  parseCsvText,
  mapRow,
  type ColumnDefinition,
  type DryRunResult,
  type CommitResult,
} from "@/lib/csv";

type Props<T extends string> = {
  defs: ColumnDefinition<T>[];
  dryRunAction: (rows: Partial<Record<T, string | null>>[]) => Promise<DryRunResult>;
  commitAction: (rows: Partial<Record<T, string | null>>[]) => Promise<CommitResult>;
  templateUrl?: string;
};

type Step = "upload" | "preview" | "dryrun" | "committed";

export function CsvImporter<T extends string>({
  defs,
  dryRunAction,
  commitAction,
  templateUrl,
}: Props<T>) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ReturnType<
    typeof parseCsvText<T>
  >["mapping"] | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [parseError, setParseError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);

  const mappedRows = useMemo(() => {
    if (!mapping) return [];
    return rawRows.map((r) => mapRow(r, mapping));
  }, [rawRows, mapping]);

  async function handleFile(file: File) {
    setParseError(null);
    setDryRun(null);
    setCommit(null);
    try {
      const text = await file.text();
      const parsed = parseCsvText(text, defs);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setMapping(parsed.mapping);
      setStep("preview");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDryRun() {
    setBusy(true);
    try {
      const result = await dryRunAction(mappedRows);
      setDryRun(result);
      setStep("dryrun");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true);
    try {
      const result = await commitAction(mappedRows);
      setCommit(result);
      setStep("committed");
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFileName(null);
    setRawRows([]);
    setHeaders([]);
    setMapping(null);
    setDryRun(null);
    setCommit(null);
    setParseError(null);
    setStep("upload");
  }

  const canDryRun =
    mapping !== null && mapping.missing.length === 0 && rawRows.length > 0;

  return (
    <div className="space-y-6">
      {/* Step 1: File upload */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">1. CSVファイルを選択</h2>
          {templateUrl ? (
            <a
              href={templateUrl}
              className="text-sm text-blue-600 hover:underline"
              download
            >
              テンプレートをダウンロード
            </a>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-slate-800"
          />
          {fileName ? (
            <button
              type="button"
              onClick={reset}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              リセット
            </button>
          ) : null}
        </div>
        {parseError ? (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </p>
        ) : null}
      </section>

      {/* Step 2: Preview + mapping */}
      {step !== "upload" && mapping ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold">
            2. 列マッピング・プレビュー（{rawRows.length} 行）
          </h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">
                認識した列（{mapping.recognized.length}）
              </p>
              <ul className="space-y-0.5 text-xs">
                {mapping.recognized.map((m) => (
                  <li key={m.field}>
                    <span className="font-mono text-slate-500">
                      {m.sourceHeader}
                    </span>{" "}
                    →{" "}
                    <span className="font-mono text-emerald-700">{m.field}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              {mapping.missing.length > 0 ? (
                <>
                  <p className="mb-1 text-xs font-semibold text-red-700">
                    必須なのに見つからない列（{mapping.missing.length}）
                  </p>
                  <ul className="space-y-0.5 text-xs">
                    {mapping.missing.map((f) => (
                      <li key={f} className="font-mono text-red-700">
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {mapping.ignored.length > 0 ? (
                <>
                  <p className="mb-1 mt-2 text-xs font-semibold text-slate-500">
                    無視した列（{mapping.ignored.length}）
                  </p>
                  <ul className="space-y-0.5 text-xs">
                    {mapping.ignored.map((h) => (
                      <li key={h} className="font-mono text-slate-500">
                        {h}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border border-slate-200 px-2 py-1 text-left">
                    #
                  </th>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border border-slate-200 px-2 py-1 text-left font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-200 px-2 py-1 text-slate-400">
                      {i + 1}
                    </td>
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="border border-slate-200 px-2 py-1"
                      >
                        {r[h] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rawRows.length > 10 ? (
              <p className="mt-1 text-xs text-slate-500">
                先頭10行のみ表示（全 {rawRows.length} 行）
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleDryRun}
              disabled={!canDryRun || busy}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "確認中…" : "差分を確認（dry-run）"}
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 3: Dry-run result */}
      {(step === "dryrun" || step === "committed") && dryRun ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold">3. 差分の確認</h2>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Stat label="合計" value={dryRun.total} color="slate" />
            <Stat label="新規" value={dryRun.newCount} color="emerald" />
            <Stat label="更新" value={dryRun.updateCount} color="amber" />
            <Stat label="変更なし" value={dryRun.unchangedCount} color="slate" />
            {dryRun.warningCount ? (
              <Stat label="警告" value={dryRun.warningCount} color="amber" />
            ) : null}
            <Stat label="エラー" value={dryRun.errorCount} color="red" />
          </div>

          <div className="mt-4 max-h-96 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-2 py-1 text-left">
                    行
                  </th>
                  <th className="border-b border-slate-200 px-2 py-1 text-left">
                    状態
                  </th>
                  <th className="border-b border-slate-200 px-2 py-1 text-left">
                    キー
                  </th>
                  <th className="border-b border-slate-200 px-2 py-1 text-left">
                    メッセージ
                  </th>
                </tr>
              </thead>
              <tbody>
                {dryRun.rows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-400">
                      {r.rowIndex}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1">
                      {r.key}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1">
                      {r.message ? (
                        <span className="text-red-700">{r.message}</span>
                      ) : r.warning ? (
                        <span className="text-amber-700">{r.warning}</span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {step === "dryrun" ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={handleCommit}
                disabled={busy || dryRun.newCount + dryRun.updateCount === 0}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy
                  ? "適用中…"
                  : `${dryRun.newCount + dryRun.updateCount} 件を確定`}
              </button>
              {dryRun.errorCount > 0 ? (
                <p className="mt-2 text-xs text-amber-700">
                  エラー {dryRun.errorCount}{" "}
                  件はスキップして取込みます（CSVを修正して再アップロードすれば後から追加できます）。
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Step 4: Commit result */}
      {step === "committed" && commit ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-sm font-semibold text-emerald-900">4. 取込結果</h2>
          <ul className="mt-2 text-sm text-emerald-900">
            <li>新規作成: {commit.created} 件</li>
            <li>更新: {commit.updated} 件</li>
            <li>変更なしスキップ: {commit.skipped} 件</li>
            {commit.errors.length > 0 ? (
              <li className="text-red-700">エラー: {commit.errors.length} 件</li>
            ) : null}
          </ul>
          {commit.errors.length > 0 ? (
            <div className="mt-3 max-h-48 overflow-auto rounded border border-red-200 bg-white p-2 text-xs">
              {commit.errors.map((e, i) => (
                <div key={i} className="text-red-700">
                  行 {e.rowIndex}: {e.message}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3">
            <button
              type="button"
              onClick={reset}
              className="rounded border border-emerald-700 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
            >
              続けて別のCSVを取込む
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "slate" | "emerald" | "amber" | "red";
}) {
  const styles: Record<typeof color, string> = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  };
  return (
    <div className={`rounded px-3 py-1.5 ${styles[color]}`}>
      <span className="text-xs">{label}</span>{" "}
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    new: "bg-emerald-100 text-emerald-800",
    update: "bg-amber-100 text-amber-800",
    unchanged: "bg-slate-100 text-slate-600",
    error: "bg-red-100 text-red-800",
  };
  const labelMap: Record<string, string> = {
    new: "新規",
    update: "更新",
    unchanged: "変更なし",
    error: "エラー",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        map[status] ?? "bg-slate-100"
      }`}
    >
      {labelMap[status] ?? status}
    </span>
  );
}
