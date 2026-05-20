import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { compare } from "bcryptjs";
import { signSessionToken } from "@/lib/session";
import { isLocked, registerFailure, registerSuccess } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function getClientKey(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

async function login(formData: FormData) {
  "use server";

  const next = String(formData.get("next") ?? "/") || "/";
  const password = String(formData.get("password") ?? "");

  const key = await getClientKey();
  if (isLocked(key)) {
    redirect(`/login?error=locked&next=${encodeURIComponent(next)}`);
  }

  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    redirect(`/login?error=config&next=${encodeURIComponent(next)}`);
  }

  const ok = await compare(password, hash);
  if (!ok) {
    const r = registerFailure(key);
    const code = r.locked ? "locked" : "invalid";
    redirect(`/login?error=${code}&remaining=${r.remaining}&next=${encodeURIComponent(next)}`);
  }

  registerSuccess(key);

  const maxAge =
    Math.max(1, Number(process.env.SESSION_MAX_AGE_DAYS ?? 7)) * 24 * 60 * 60;
  const token = await signSessionToken(maxAge);

  const store = await cookies();
  store.set("manufacturing_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(safeNext);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; remaining?: string; next?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = (() => {
    switch (params.error) {
      case "invalid":
        return `パスワードが一致しません${params.remaining ? `（残り試行回数: ${params.remaining}）` : ""}`;
      case "locked":
        return "連続失敗回数の上限を超えました。15分後に再度お試しください。";
      case "config":
        return "サーバー側の認証設定が未完了です。管理者にお問い合わせください。";
      default:
        return null;
    }
  })();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">製造管理ツール</h1>
          <p className="mt-1 text-sm text-slate-600">
            パスワード（またはPIN）を入力してください。
          </p>
        </div>

        <input type="hidden" name="next" value={params.next ?? "/"} />

        <label className="block">
          <span className="text-sm font-medium">パスワード</span>
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </label>

        {errorMessage ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          ログイン
        </button>
      </form>
    </div>
  );
}
