# データモデル設計

参考: 既存スプレッドシート（5シート）
- 資材・原料在庫マスタ（約157件）
- 製品マスタ＋配合（約106件）
- カテゴリマスタ（22件）
- 取引先マスタ（44件以上）
- 製造記録（276件以上）

## エンティティ関係図（概念）

```
Category ─────┐
              │
Supplier ─────┤
              │
              ↓
       Material（資材・原料）─────┐
                                   │
       Product（製品）              │
              │                    │
              ├─→ ProductRecipe ←──┤  ※BOM（中間テーブル）
              │
              └─→ ManufacturingOrder（製造指示）

       Material ─→ PurchaseOrder（資材発注）─→ Supplier
```

## テーブル定義

### Category（カテゴリマスタ）

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK, auto) | |
| division | Enum(`RAW`, `PACKAGING`, `PRODUCT`) | スプレッドシートの「区分」（原料/資材/製品） |
| name | String | 例: 「キャップ」「液体(常温)」「精油」 |

unique制約: `(division, name)`

### Supplier（取引先マスタ）

スプレッドシート「取引先マスタ」17列を保持。電話番号・FAX等は文字列。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | スプレッドシートの「レコード番号」を踏襲可 |
| companyName | String | 取引先会社名 |
| officeName | String? | 取引先事業所名 |
| postalCode | String? | |
| address | String? | |
| phone | String? | |
| fax | String? | |
| websiteUrl | String? | 会社URL |
| contactPerson | String? | 発注先担当者 |
| email | String? | 発注先メールアドレス |
| orderMethod | String? | 発注方法（FAX/メール/オンライン/電話） |
| paymentMethod | String? | 支払方法（前払い/後払い） |
| paymentDay | Int? | 支払日（月末は31） |
| paymentDivision | String? | 現金/クレジット |
| paymentSite | String? | 当月/翌月 |
| searchLabel | String? | 発注先検索ラベル（自動生成可） |
| alias | String? | 呼称 |
| createdAt / updatedAt | DateTime | |

### Material（資材・原料マスタ）

スプレッドシート「資材・原料在庫マスタ」16列に対応。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK, auto) | |
| name | String | 製品名（資材名/原料名） |
| categoryId | Int (FK→Category) | |
| unit | String | 個/枚/g/kg/mL/L 等 |
| purchasePrice | Decimal? | 購入単価 |
| stockQty | Decimal | 在庫数量（理論値） |
| lastInventoryDate | Date? | 最終棚卸日 |
| supplierId | Int? (FK→Supplier) | 発注先 |
| relatedAromaKyokai | Boolean | 関連資材[アロマ協会] |
| relatedTenman | Boolean | 関連資材[てんまん] |
| consignedTenman | Decimal? | 預かり在庫[てんまん] |
| consignedAroma | Decimal? | 預かり在庫[アロマ協会] |
| consignedOther | Decimal? | 預かり在庫[その他] |
| notes | String? | 注文詳細 |
| storageLocation | String? | 保管場所（古川町/出島町 等） |
| division | Enum(同上) | 区分（原料/資材/製品） |
| docUrl | String? | 資料詳細URL |
| createdAt / updatedAt | DateTime | |

### Product（製品マスタ）

スプレッドシート「製品マスタ＋配合」のうち、製品単位の情報。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | レコード番号 |
| salesName | String | 販売名 |
| genericName | String? | 一般的名称 |
| standardNo | String? | 標準書No |
| capacity | Decimal | 容量 |
| capacityUnit | String | mL/g 等 |
| controlDivision | String? | 管理区分（化粧品/雑貨/医薬部外品） |
| expiryMonths | Int? | 使用期限月数 |
| caseCount | Int? | ケース入り数 |
| storageLocation | String? | |
| salesPrice | Decimal? | 販売価格（税別） |
| productCost | Decimal? | 製品原価（税別） |
| stockQty | Decimal? | 在庫（理論値） |
| lastInventoryDate | Date? | |

### ProductRecipe（製品配合・BOM）

`Product` と `Material` の中間表。1つの製品レコードに対し原料行と資材行の両方が並ぶ。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| productId | Int (FK→Product) | |
| materialId | Int (FK→Material) | 原料・資材どちらでも参照 |
| usageQty | Decimal | 利用量 |
| usageUnit | String | g/mL/個 等 |
| sortOrder | Int | 表示順 |

### PurchaseOrder（資材発注）

最初のご要望のうち「資材の発注状況・到着見込み」を扱う。スプレッドシートには明示的には存在しないが、業務上必要なので新設。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| materialId | Int (FK→Material) | 発注対象の資材・原料 |
| supplierId | Int (FK→Supplier) | |
| orderedAt | Date? | 発注日 |
| orderedQty | Decimal | 発注数量 |
| unitPrice | Decimal? | この発注時の単価（履歴として保持） |
| status | Enum(`PLANNED`, `ORDERED`, `ARRIVED`, `CANCELLED`) | 未発注/発注済/到着済/キャンセル |
| expectedArrivalAt | Date? | 到着見込み |
| arrivedAt | Date? | 実到着日 |
| arrivedQty | Decimal? | 実到着数量 |
| notes | String? | |
| createdAt / updatedAt | DateTime | |

到着済になったタイミングで `Material.stockQty` を増やす（手動 or 自動化どちらかは要決定）。

### ManufacturingOrder（製造指示・記録）

スプレッドシート「製造記録」9列に対応。最初のご要望のうち「製品名・数量・受注日・製造予定日」を扱う。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| productId | Int (FK→Product) | 販売名 |
| orderedAt | Date? | 受注日（最初のご要望） |
| instructedAt | Date | 指示年月日 |
| scheduledAt | Date? | 製造予定日（最初のご要望） |
| plannedQty | Decimal | 製造数量 |
| mixedAt | Date? | 混合年月日 |
| filledAt | Date? | 充填年月日 |
| packagedAt | Date? | 包装年月日 |
| lotNumber | String? | 製造番号・ロット番号 |
| completedQty | Decimal? | 完成数量 |
| standardNo | String? | 製品標準書No |
| status | Enum(`PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) | |
| notes | String? | |
| createdAt / updatedAt | DateTime | |

## 設計上の判断ポイント（要レビュー）

1. **「関連資材[アロマ協会/てんまん]」をMaterialの列にするか、別テーブル（タグ）にするか**
   - 現状: スプレッドシート通り、Materialに2つのboolean列で保持
   - 将来事業所が増える場合はタグテーブル化が望ましい

2. **「製品（Product）」と「資材・原料（Material）」のテーブル分離**
   - スプレッドシートでは「区分=製品」も同じ在庫マスタに混在
   - 設計上は分離した方がBOMの参照が綺麗
   - ただし「半製品（バルク）」は資材としても扱われるため、`Material` で保持し `Product` は販売名ベースで別管理

3. **在庫の整合性**
   - 製造完了で原料・資材の在庫が減る、発注到着で増える
   - トランザクション処理が必要。実装フェーズで `StockTransaction` テーブルを追加検討

4. **金額型**
   - Prismaは `Decimal` 推奨。表示は文字列で扱う

5. **受注日（orderedAt）の扱い**
   - 最初のご要望には含まれていたが、既存スプレッドシートには「受注日」列がない
   - 「指示年月日」と別軸として保持できるようにオプショナル列で追加
