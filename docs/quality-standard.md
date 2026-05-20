# 製品標準書 兼 品質標準書

参考: `19d00bc3-___________.xlsx`

製品ごとに1つの **品質標準書（QualityStandard）** を持ち、これを11セクションの帳票として印刷できるようにします。

## データモデル概要

```
Product ─1:1→ QualityStandard ─┬─→ QualityStandardRevision    (改訂履歴)
                               ├─→ QualityStandardIngredient (成分及び配合量)
                               ├─→ QualityStandardMethodStep (製造方法)
                               ├─→ QualityStandardProcess   (製造所の情報及び製造工程)
                               │     └→ ManufacturingSite (自社製造所マスタ)
                               ├─→ QualityStandardTestSpec  (規格及び試験方法)
                               ├─→ QualityStandardWorkNote  (作業上の注意点)
                               └─→ QualityStandardEfficacy  ─→ EfficacyClaim (効能効果56項目マスタ)
```

包装及び表示内容・製品化規格はサイズが小さいので `QualityStandard` モデルに `pkg*` / `sp*` の列として直接持ちます。

## 印刷ルート

`/products/[id]/quality-standard/print` で全11セクションをまとめてA4縦・複数ページに出力。
セクション単位の印刷も可能にする:
- `/products/[id]/quality-standard/print?section=cover`
- `/products/[id]/quality-standard/print?section=revisions`
- `/products/[id]/quality-standard/print?section=ingredients`
- 等

## セクション構成

### 1. 表紙（品質標準書）

`QualityStandard` の各 1-to-1 フィールド。

| 項目 | フィールド |
|------|------------|
| タイトル | 固定: 「製品標準書 兼 品質標準書」 |
| 管理番号 | `controlNumber`（例: `002-BC`） |
| 制定日 | `establishedAt` |
| 制定者 | `establishedBy` |
| 販売名 | `product.salesName` |
| 製品の種類 | `productCategory` |
| 製造販売業者 | `manufacturer` |
| 住所 | `manufacturerAddr` |
| 許可年月日 | `permitDate` |
| 許可番号 | `permitNumber` |
| 届出 | `notificationType` |
| 備考 | `notes` |
| 各セクション参照リンク | 固定文言 |

### 2. 改訂履歴

`QualityStandardRevision[]` を時系列で列挙。

| 列 | フィールド |
|----|------------|
| 改訂番号 | `revisionNumber` |
| 改訂年月日 | `revisedAt` |
| 改訂理由 | `reason` |
| 改訂事項 | `changes` |
| 改訂者 | `revisedBy` |

### 3. 仕様一覧

製品仕様の集計表示。`QualityStandard.pkgCapacity` + `Product` 関連の資材から自動生成、または手入力フィールド（v1では手入力でOK）。

### 4. 包装及び表示内容

`QualityStandard` の `pkg*` フィールド群を整形して表示。

| 帳票項目 | フィールド |
|----------|------------|
| 販売名 | `product.salesName` |
| 内容量 | `pkgCapacity` |
| 色番・記号等 | `pkgColorCode` |
| 製造販売業者問合せ先 | `pkgManufacturerContact` |
| 発売元 | `pkgDistributorContact` |
| 全成分 | `pkgAllIngredients` |
| 用法及び容量 | `pkgUsageMethod` |
| 使用上の注意 | `pkgUsageNotes` |
| 識別表示 | `pkgIdentification` |
| その他 | `pkgOther` |
| 備考 | `pkgNotes` |

### 5. 成分及び配合量

`QualityStandardIngredient[]` を `no` 順で表示。最終行に合計（`amountPercent` の SUM, `portion` の SUM）を出す。

| 列 | フィールド |
|----|------------|
| No | `no` |
| 原料名 | `rawMaterialName` |
| 配合量(%) | `amountPercent` |
| 成分名 | `componentName` |
| 複合原料配合(%) | `complexPercent` |
| 規格 | `spec` |
| 分量(%) | `portion` |
| 配合量順位 | `rank` |

### 6. 製造方法

`QualityStandardMethodStep[]` を `stepNo` 順で番号付きリスト表示。

### 7. 製造所の情報及び製造工程

`QualityStandardProcess[]` を `sortOrder` 順で列挙。各行で `ManufacturingSite` を VLOOKUP 的に展開する。

| 列 | フィールド |
|----|------------|
| 製造所 | `manufacturingSite.name` |
| 所在地 | `manufacturingSite.address` |
| 許可年月日 | `manufacturingSite.permitDate` |
| 許可番号 | `manufacturingSite.permitNumber` |
| 製造工程 | `process` |

### 8. 規格及び試験方法

`QualityStandardTestSpec[]` を表示。本テーブルは `TestInspectionRecord` 作成時の初期値元になる。

| 列 | フィールド |
|----|------------|
| 試験項目 | `testItem` |
| 規格 | `spec` |
| 試験法 | `method` |
| 試験頻度 | `frequency` |

### 9. 製品化規格

| 項目 | フィールド |
|------|------------|
| 充填量 | `spFillVolume` |
| ロット印字機 | `spLotPrinter` |
| 印字文字 | `spLotText` |
| 段ボール | `spCardboardSize` |
| 原料リスト | `QualityStandardIngredient[]` から原料部分を抽出表示 |
| 資材リスト | （対応する Product の `recipes` から `Material.division=PACKAGING` を抽出） |

### 10. 作業上の注意点

`QualityStandardWorkNote[]` を `sortOrder` 順で表示。

| 列 | フィールド |
|----|------------|
| 作業名 | `workName` |
| 内容 | `content` |
| 写真等 | `photoUrl`（あれば画像を表示。なければ空欄） |

### 11. 効能効果（参考資料）

`EfficacyClaim` マスタ（化粧品の効能の範囲56項目）から、本製品で標榜する項目を `QualityStandardEfficacy` で紐づけ。

## マスタの初期投入

### `EfficacyClaim`（効能効果マスタ）

シード時に化粧品の効能の範囲56項目を全件投入する（`prisma/seed.ts`）。

### `ManufacturingSite`（自社製造所マスタ）

スプレッドシートの「製造所」シートを参考に、以下7件相当を初期投入候補とする:

- 株式会社すはだみらい研究所（長崎県長崎市古川町6-35）
- 株式会社ホウリン
- 香椎化学工業株式会社 カシーテクニカルセンター
- 大興化成株式会社
- 有限会社カンダ技工 松江八雲工場
- 美容薬理株式会社
- （その他随時追加）

CSVインポートも対応するが、件数は限定的なので手入力で十分。

## 制定者・改訂者・品質保証責任者などの「固定氏名」

`QualityStandard.establishedBy`、`QualityStandardRevision.revisedBy` などは自由文字列で保持。
組織内のメンバーは将来 `User` テーブルに移行できるが、v1では文字列で良い。

## 印刷時の注意

- A4縦。セクションごとにページブレーク（CSS `@page` + `page-break-before: always`）
- 各セクションヘッダに 管理番号（`controlNumber`）と 制定日 を表示
- フッターに ページ番号 / 全ページ数

## 製品リスト（品質標準書 一覧）

`/quality-standards` に、`一覧` シート相当の管理ビューを置く:

| 列 | 内容 |
|----|------|
| 販売名 | `Product.salesName` |
| 管理番号 | `controlNumber` |
| 制定日 | `establishedAt` |
| 改訂数 | `revisions.length` |
| 各セクション充足率 | 入力済みセクション数 / 11 |

未作成の製品には「新規作成」ボタンを出す。
