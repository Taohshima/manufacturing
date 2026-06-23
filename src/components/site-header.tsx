"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type MouseEvent } from "react";

type NavItem = { href: string; label: string };

const navItems: NavItem[] = [
  { href: "/", label: "ダッシュボード" },
  { href: "/manufacturing-orders", label: "製造指示" },
  { href: "/purchase-orders", label: "資材発注" },
  { href: "/materials", label: "資材・原料" },
  { href: "/stock-transactions", label: "入出庫履歴" },
  { href: "/trace", label: "ロットトレース" },
  { href: "/reports", label: "月次レポート" },
  { href: "/products", label: "製品" },
  { href: "/quality-standards", label: "品質標準書" },
  { href: "/suppliers", label: "取引先" },
  { href: "/import", label: "CSVインポート" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // ナビゲーション中はマウスカーソルを「処理中」表示にする。
  useEffect(() => {
    if (isPending) {
      document.body.style.cursor = "progress";
    } else {
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.cursor = "";
    };
  }, [isPending]);

  function handleNav(e: MouseEvent<HTMLAnchorElement>, href: string) {
    // 修飾キー付きクリックや新規タブ等は通常動作に任せる
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (pathname === href) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      {/* 遷移中に上端を流れる進捗バー */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden ${
          isPending ? "opacity-100" : "opacity-0"
        } transition-opacity duration-150`}
      >
        <div className="h-full w-1/3 animate-[progress_1s_ease-in-out_infinite] bg-slate-700" />
      </div>

      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-4">
        <Link
          href="/"
          onClick={(e) => handleNav(e, "/")}
          className="text-base font-semibold sm:text-lg"
        >
          製造管理ツール
        </Link>

        <nav className="hidden flex-wrap gap-x-4 gap-y-1 text-sm lg:flex">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href);
            const pending = pendingHref === item.href;
            const baseClass = active
              ? "font-medium text-slate-900 underline underline-offset-4"
              : "text-slate-700 hover:text-slate-900 hover:underline";
            const pendingClass = pending ? "opacity-50" : "";
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => handleNav(e, item.href)}
                aria-busy={pending || undefined}
                className={`${baseClass} ${pendingClass}`.trim()}
              >
                {item.label}
              </Link>
            );
          })}
          <form action="/logout" method="post" className="contents">
            <button
              type="submit"
              className="text-slate-500 hover:text-slate-900 hover:underline"
            >
              ログアウト
            </button>
          </form>
        </nav>

        <button
          type="button"
          aria-label={open ? "メニューを閉じる" : "メニューを開く"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded border border-slate-300 text-slate-700 hover:bg-slate-50 lg:hidden"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-[57px] z-20 bg-slate-900/20 lg:hidden"
          />
          <nav
            id="mobile-nav"
            className="absolute right-2 top-full z-30 mt-1 w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg lg:hidden"
          >
            <ul className="divide-y divide-slate-100">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                const pending = pendingHref === item.href;
                const baseClass = active
                  ? "block bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900"
                  : "block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50";
                const pendingClass = pending ? "opacity-50" : "";
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={(e) => handleNav(e, item.href)}
                      aria-busy={pending || undefined}
                      className={`${baseClass} ${pendingClass}`.trim()}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              <li>
                <form action="/logout" method="post">
                  <button
                    type="submit"
                    className="block w-full px-4 py-3 text-left text-sm text-slate-500 hover:bg-slate-50"
                  >
                    ログアウト
                  </button>
                </form>
              </li>
            </ul>
          </nav>
        </>
      ) : null}
    </header>
  );
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
