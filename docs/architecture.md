# アーキテクチャ・画面構成

## 技術スタック

| 項目 | 採用 | 備考 |
|------|------|------|
| フレームワーク | Next.js (App Router) + TypeScript | Creative管理と同じ構成 |
| DB | PostgreSQL (Vercel Postgres) | 本番。ローカルはdocker-composeまたはSupabase想定 |
| ORM | Prisma | マイグレーション・型安全クエリ |
| スタイル | Tailwind CSS | |
| UI | shadcn/ui + lucide-react | テーブル多めなので軽量UIで |
| 入出力 | CSVインポート/エクスポート | `papaparse` 等を利用 |
| デプロイ | Vercel | プレビュー環境＋本番 |
| 認証 | 共有パスワード/PIN | 詳細は[認証セクション](#認証パスワードpin)参照 |

## ディレクトリ構成（予定）

```
.
├── prisma/
│   ├── schema.prisma         # データモデル
│   ├── migrations/           # マイグレーション履歴
│   └── seed.ts               # シードスクリプト（カテゴリマスタ等）
├── src/
│   ├── middleware.ts                      # 認証チェック（未認証は /login へ）
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                       # ダッシュボード
│   │   ├── login/                         # ログイン画面（パスワード/PIN）
│   │   ├── logout/                        # ログアウト
│   │   ├── manufacturing-orders/          # 製造指示
│   │   ├── purchase-orders/               # 資材発注
│   │   ├── materials/                     # 資材・原料マスタ
│   │   ├── products/                      # 製品マスタ＋BOM
│   │   ├── suppliers/                     # 取引先マスタ
│   │   ├── categories/                    # カテゴリマスタ
│   │   └── import/                        # CSVインポート画面
│   ├── lib/
│   │   ├── prisma.ts                      # PrismaClientシングルトン
│   │   ├── auth.ts                        # パスワード検証・セッションCookie
│   │   ├── csv.ts                         # CSVパース/出力
│   │   └── bom.ts                         # 配合から必要資材を計算
│   └── components/
│       ├── ui/                            # shadcn/ui
│       └── data-table/                    # 共通テーブル
├── docs/
└── README.md
```

## 画面構成（フェーズ別）

### フェーズ1 — 最初のご要望にフォーカス

最初に頂いた8項目（製品名、数量、受注日、資材名、資材在庫数、資材の発注状況、資材到着見込み、製造予定日）を中心に、業務の動線が回るところまで。

| ページ | 機能 |
|--------|------|
| `/manufacturing-orders` | 製造指示一覧・新規作成・編集・削除 |
| `/manufacturing-orders/[id]` | 詳細。BOMから必要資材一覧を自動算出し、在庫との差分を表示 |
| `/manufacturing-orders/[id]/print` | 製造記録（ロット記録用紙） → [docs/print-template.md](print-template.md) |
| `/manufacturing-orders/[id]/shipment-decisions/[sid]/print` | 出荷可否決定通知（様式1-1） |
| `/manufacturing-orders/[id]/shipments/print` | 市場への出荷記録（様式1-2） |
| `/manufacturing-orders/[id]/test-inspections/[tid]/print` | 試験検査記録 |
| `/purchase-orders` | 資材発注一覧 |
| `/` | ダッシュボード。製造予定・発注予定・在庫不足アラート |

出荷関連3帳票の詳細は [docs/shipping-forms.md](shipping-forms.md)。

### フェーズ2 — マスタ管理

| ページ | 機能 |
|--------|------|
| `/materials` | 資材・原料マスタ。在庫数量、棚卸日入力 |
| `/products` | 製品マスタ。配合（BOM）の編集 |
| `/products/[id]/recipe` | 配合エディタ。原料・資材と利用量の組み合わせ |
| `/products/[id]/quality-standard` | 製品標準書 兼 品質標準書の編集 → [docs/quality-standard.md](quality-standard.md) |
| `/products/[id]/quality-standard/print` | 品質標準書11セクションの印刷ビュー |
| `/quality-standards` | 品質標準書の一覧（管理番号・制定日・改訂数・充足率） |
| `/manufacturing-sites` | 自社製造所マスタ |
| `/suppliers` | 取引先マスタ |
| `/categories` | カテゴリマスタ |
| `/efficacy-claims` | 効能効果マスタ（56項目、参照のみ。シードで投入） |
| `/import` | スプレッドシートのCSVを各テーブルに取り込む |

### フェーズ3 — 実績・分析

| 機能 | 内容 |
|------|------|
| 製造実績ダッシュボード | 月次製造量、ロット別 |
| 在庫推移 | 棚卸履歴のグラフ |
| 原価分析 | 製品ごとの原料費＋資材費の集計 |

## 認証（パスワード/PIN）

会社の最重要情報を扱うため、サイト全体に認証を必須とする。
ユーザー単位の管理ではなく、**1つの共有パスワード/PIN** で運用する。

### 方式

| 項目 | 内容 |
|------|------|
| 認証情報 | 環境変数 `APP_PASSWORD`（または `APP_PIN`）に **bcrypt等でハッシュ化した値** を保存 |
| ログイン画面 | `/login`。パスワード/PINを入力するシンプルなフォーム |
| セッション | サーバー側で署名（HMAC-SHA256）したCookieを発行。`HttpOnly`, `Secure`, `SameSite=Lax`, 有効期限7日（環境変数で変更可） |
| アクセス制御 | Next.js Middleware (`src/middleware.ts`) で `/login` と静的アセット以外を全て保護 |
| ログアウト | ヘッダーのフォームから `POST /logout` を呼び、Cookieを削除して `/login` へリダイレクト（GETにするとプリフェッチで誤ってログアウトされるため不可） |
| レート制限 | 同一IPからの連続失敗を5回でロック（メモリベース、シンプル実装） |

### ファイル構成（予定）

```
src/
├── middleware.ts                # Cookie検証、未認証は /login へ
├── lib/
│   └── auth.ts                  # bcrypt verify、署名Cookie発行/検証
└── app/
    ├── login/
    │   ├── page.tsx             # ログインフォーム
    │   └── actions.ts           # Server Action: verify password → Cookie発行
    └── logout/
        └── route.ts             # POST /logout → Cookie削除
```

### 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `APP_PASSWORD_HASH` | ✓ | bcryptハッシュ。生成例: `node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"` |
| `SESSION_SECRET` | ✓ | Cookie署名キー（32文字以上の乱数） |
| `SESSION_MAX_AGE_DAYS` | | デフォルト 7 |

ローカル開発用に `.env.example` を用意し、平文の `APP_PASSWORD` から起動時にハッシュ生成するヘルパースクリプトも添える。

### Vercel運用時の注意

- パスワードは**プロジェクト設定の Environment Variables** にハッシュ値を保存（平文を絶対にコミットしない）
- ロックアウト状態はインスタンスメモリベース。Vercelはサーバーレスでインスタンスが分散するため厳密な防御にはならない → 必要なら後日 Redis ベースに置き換え

### 将来拡張

- ユーザー単位の認証が必要になったら `User` テーブルを追加して NextAuth.js 等に切り替え
- 操作ログ（誰がいつ何を変更したか）は v1では取らない。将来 `AuditLog` を追加可能

## CSVインポート設計

製造管理スプレッドシートの5シートに対応する5つのインポーターを用意します。

| シート | 取り込み先テーブル | 備考 |
|--------|---------------------|------|
| 資材・原料在庫マスタ | `Material` | `カテゴリ` を `Category` にマッピング、`発注先` を `Supplier` にマッピング |
| 製品マスタ＋配合 | `Product` + `ProductRecipe` | レコード番号でグルーピング |
| カテゴリマスタ | `Category` | seed相当。最初に投入 |
| 取引先マスタ | `Supplier` | |
| 製造記録 | `ManufacturingOrder` | 過去実績も取り込み可能 |

各インポーターは以下の動作を想定：

1. CSVをプレビュー表示（列マッピング確認）
2. 既存レコードとの突合（`name` または `recordNumber` ベース）
3. dry-runで差分を表示してから確定

## 在庫不足アラートのロジック

```
ある製造指示 (Product=P, Quantity=N) について：
  必要資材 = ProductRecipe[P] の各行について
    必要量 = 利用量 × N
  各資材について：
    不足量 = 必要量 - Material.stockQty
    if 不足量 > 0:
      未到着発注を差し引いてさらに不足する場合 → アラート
```

## 在庫の自動更新（StockTransaction）

`Material.stockQty` は `StockTransaction` の集計から自動更新するキャッシュ値。
直接更新はせず、必ず `StockTransaction` の作成と同一トランザクションで `increment`/`decrement` を行う。

| 発生イベント | StockTransaction | Material.stockQty |
|-------------|-------------------|--------------------|
| PurchaseOrder → ARRIVED | `reason=PURCHASE_ARRIVAL, qty=+arrivedQty` | `+= arrivedQty` |
| ManufacturingOrder → COMPLETED | 各原料・資材ごとに `reason=MANUFACTURING_USE, qty=-actualQty` | `-= actualQty` |
| 棚卸時の差分調整 | `reason=INVENTORY_ADJUST, qty=実数-現在値` | 実数になる |
| 手動補正 | `reason=MANUAL, qty=±N` | `±= N` |

## 実装フェーズ

1. **フェーズ0（このPR）**: 設計ドキュメント + Prismaスキーマのレビュー
2. **フェーズ1A**: Next.js雛形、Prismaマイグレーション、CSVインポーター
3. **フェーズ1B**: 製造指示・資材発注の画面
4. **フェーズ2**: マスタ管理画面
5. **フェーズ3**: 実績・分析
