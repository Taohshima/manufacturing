import Link from "next/link";

const navItems = [
  { href: "/", label: "ダッシュボード" },
  { href: "/manufacturing-orders", label: "製造指示" },
  { href: "/purchase-orders", label: "資材発注" },
  { href: "/materials", label: "資材・原料" },
  { href: "/products", label: "製品" },
  { href: "/quality-standards", label: "品質標準書" },
  { href: "/suppliers", label: "取引先" },
  { href: "/import", label: "CSVインポート" },
];

export function SiteHeader() {
  return (
    <header className="no-print border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          製造管理ツール
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-slate-700 hover:text-slate-900 hover:underline"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/logout"
            className="text-slate-500 hover:text-slate-900 hover:underline"
          >
            ログアウト
          </Link>
        </nav>
      </div>
    </header>
  );
}
