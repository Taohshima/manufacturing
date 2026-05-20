# Vercelへのデプロイ手順

Creative管理と同じスタック（Next.js + Prisma + Vercel Postgres）でデプロイします。

## 1. Vercel Postgres を作成

1. https://vercel.com/dashboard を開く
2. **Storage** タブ → **Create Database** → **Postgres** を選択
3. プロジェクト名は任意（例: `manufacturing-db`）
4. 作成後、自動で `DATABASE_URL` 等の環境変数が発行される

## 2. GitHubリポジトリをVercelにインポート

1. Vercel ダッシュボード → **Add New** → **Project**
2. `Taohshima/manufacturing` を選択 → **Import**
3. **Framework Preset**: Next.js（自動検出）
4. **Branch**: `claude/manufacturing-management-tool-NW4nB` を選択（プレビュー用）または `main` にマージ後

## 3. 環境変数を設定

Project Settings → **Environment Variables** で以下を追加:

| 変数 | 値の生成方法 |
|------|-------------|
| `DATABASE_URL` | Vercel Postgres作成時に自動セット（手動で再設定不要） |
| `APP_PASSWORD_HASH` | ローカルで `npm run auth:hash -- "好きなパスワード"` を実行し、出力されたハッシュ値を貼り付け |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` の出力を貼り付け |
| `SESSION_MAX_AGE_DAYS` | 任意（省略時 7） |

すべて **Production / Preview / Development** すべてにチェックを入れる。

## 4. デプロイ

Vercelが自動でビルド・デプロイを開始する。

## 5. 初回のDBマイグレーション

デプロイ完了後、**1回だけ**マイグレーションを実行する必要がある。

```bash
# ローカルでVercelの DATABASE_URL を取得
vercel env pull .env.production.local

# その値を使ってマイグレーション
DATABASE_URL="$(grep DATABASE_URL .env.production.local | cut -d= -f2- | tr -d '"')" \
  npx prisma migrate deploy

# シードデータ投入（カテゴリ・効能効果56項目・製造所）
DATABASE_URL="$(grep DATABASE_URL .env.production.local | cut -d= -f2- | tr -d '"')" \
  npm run prisma:seed
```

または Vercel Postgres のクエリエディタから手動でSQLを実行することも可能。

## 6. アクセス

- Production URL: Vercelが発行（例: `manufacturing-xxxx.vercel.app`）
- 上記URLにアクセス → ログイン画面 → 設定したパスワードでログイン
