# 製造管理ツール (manufacturing)

化粧品・アロマ製品の製造に関する以下を一元管理するWebアプリです。

- 資材・原料の在庫マスタ
- 製品マスタと配合（BOM）
- 取引先（発注先）マスタ
- 資材発注管理（発注状況・到着見込み）
- 製造指示・製造記録

## 現状

設計フェーズ。`docs/` 配下の設計ドキュメントと `prisma/schema.prisma` のレビュー中。実装は未着手。

## ドキュメント

- [docs/architecture.md](docs/architecture.md) — 技術構成・画面構成・実装フェーズ
- [docs/data-model.md](docs/data-model.md) — データモデルとPrismaスキーマの設計意図
- [prisma/schema.prisma](prisma/schema.prisma) — Prismaスキーマ（ドラフト）

## 技術スタック（予定）

- Next.js (App Router, TypeScript)
- Prisma + PostgreSQL (Vercel Postgres)
- Tailwind CSS
- Vercel デプロイ
- 認証なし（社内のみ運用）
