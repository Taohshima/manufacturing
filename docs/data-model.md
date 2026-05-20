# データモデル設計

参考:
- 既存スプレッドシート（在庫・BOM・カテゴリ・取引先・製造記録の5シート）
- 製造記録の印刷フォーマット（製品標準書 ロット記録用紙）

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
                       │
                       ├─→ ManufacturingOrderIngredient（配合原料の実績）
                       └─→ ManufacturingOrderPackaging  （包装資材の実績）

       Material ─→ PurchaseOrder（資材発注）─→ Supplier

       Material ─→ StockTransaction（在庫増減履歴）
                       ↑
                       ├─ PurchaseOrder（到着時）
                       └─ ManufacturingOrder（製造消費時）
```

## テーブル定義

### Category（カテゴリマスタ）

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK, auto) | |
| division | Enum(`RAW`, `PACKAGING`, `PRODUCT`) | 原料/資材/製品 |
| name | String | 例: 「キャップ」「液体(常温)」「精油」 |

unique制約: `(division, name)`

### Supplier（取引先マスタ）

スプレッドシート「取引先マスタ」17列を保持。電話番号・FAX等は文字列。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| companyName | String | 取引先会社名 |
| officeName | String? | 取引先事業所名 |
| postalCode / address / phone / fax | String? | |
| websiteUrl | String? | |
| contactPerson | String? | 発注先担当者 |
| email | String? | |
| orderMethod | String? | 発注方法（FAX/メール/オンライン/電話） |
| paymentMethod | String? | 前払い/後払い |
| paymentDay | Int? | 支払日（月末は31） |
| paymentDivision | String? | 現金/クレジット |
| paymentSite | String? | 当月/翌月 |
| searchLabel | String? | 検索ラベル |
| alias | String? | 呼称 |
| createdAt / updatedAt | DateTime | |

### Material（資材・原料マスタ）

スプレッドシート「資材・原料在庫マスタ」を簡略化。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK, auto) | |
| name | String | 製品名（資材名/原料名） |
| categoryId | Int (FK→Category) | |
| unit | String | 個/枚/g/kg/mL/L 等 |
| purchasePrice | Decimal? | 購入単価 |
| **stockQty** | Decimal | **在庫数量。`StockTransaction` の集計から自動更新するキャッシュ値（直接更新禁止）** |
| lastInventoryDate | Date? | 最終棚卸日 |
| supplierId | Int? (FK→Supplier) | 発注先 |
| consignedQty | Decimal? | 預かり在庫数量 |
| consignedOwner | String? | 預かり元（てんまん／アロマ協会 等） |
| notes | String? | 注文詳細 |
| storageLocation | String? | 保管場所（古川町/出島町 等） |
| division | Enum(同上) | 区分（原料/資材/製品） |
| docUrl | String? | 資料詳細URL |
| createdAt / updatedAt | DateTime | |

スプレッドシートからの変更点:
- 「在庫数量（理論値）」→「在庫数量（`stockQty`）」（理論値の表現を削除）
- 「関連資材[アロマ協会/てんまん]」列を削除
- 預かり在庫の3列（てんまん/アロマ協会/その他）を `consignedQty` + `consignedOwner` の2列に統合

### Product（製品マスタ）

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| salesName | String | 販売名 |
| genericName | String? | 一般的名称 |
| standardNo | String? | 標準書No |
| capacity | Decimal | 容量 |
| capacityUnit | String | mL/g 等 |
| controlDivision | String? | 化粧品/雑貨/医薬部外品 |
| expiryMonths | Int? | 使用期限月数 |
| caseCount | Int? | ケース入り数 |
| storageLocation | String? | |
| salesPrice | Decimal? | 販売価格（税別） |
| productCost | Decimal? | 製品原価（税別） |
| stockQty | Decimal? | 在庫 |
| lastInventoryDate | Date? | |

### ProductRecipe（製品配合・BOM）

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| productId | Int (FK→Product) | |
| materialId | Int (FK→Material) | 原料・資材どちらでも参照 |
| usageQty | Decimal | １本あたりの利用量 |
| usageUnit | String | g/mL/個 等 |
| sortOrder | Int | 表示順 |

### PurchaseOrder（資材発注）

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| materialId | Int (FK→Material) | |
| supplierId | Int (FK→Supplier) | |
| orderedAt | Date? | 発注日 |
| orderedQty | Decimal | 発注数量 |
| unitPrice | Decimal? | この発注時の単価 |
| status | Enum | `PLANNED` / `ORDERED` / `ARRIVED` / `CANCELLED` |
| expectedArrivalAt | Date? | 到着見込み |
| arrivedAt | Date? | 実到着日 |
| arrivedQty | Decimal? | 実到着数量 |
| notes | String? | |

`ARRIVED` に遷移したタイミングで `StockTransaction(reason=PURCHASE_ARRIVAL, qty=+arrivedQty)` を1件作成する。

### ManufacturingOrder（製造指示・記録）

印刷フォーマット（製品標準書 ロット記録用紙）の主要ヘッダ・本体情報を全て保持する。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| productId | Int (FK→Product) | 販売名 |
| orderedAt | Date? | 受注日 |
| instructedAt | Date | 指図年月日 |
| scheduledAt | Date? | 製造予定日 |
| plannedQty | Decimal | 製造数量（本/個） |
| lotNumber | String? | 製造番号・ロット番号（例: `2027.5`） |
| standardNo | String? | 製品標準書No |
| instructor | String? | 指図者 |
| status | Enum | `PLANNED` / `IN_PROGRESS` / `COMPLETED` / `CANCELLED` |
| notes | String? | |
| **秤量** | | |
| weighingDate | Date? | 秤量年月日 |
| temperature | Decimal? | 温度（℃） |
| humidity | Decimal? | 湿度（%） |
| **混合** | | |
| mixedAt | Date? | 混合年月日 |
| mixStartTime / mixEndTime | String? | HH:mm |
| mixWorker | String? | 作業者 |
| mixNotes | String? | |
| **充填** | | |
| filledAt | Date? | |
| fillUnitVolume | Decimal? | 充填容量（例: 100） |
| fillUnit | String? | g/ml 等 |
| fillCount | Int? | 個数 |
| fillMissCount | Int? | 充填ミス数量 |
| containerCheck | Enum(`OK`/`NG`) | 容器表示の確認（適・不適） |
| fillWorker | String? | |
| **包装** | | |
| packagedAt | Date? | |
| cardboardSize | String? | 段ボールサイズ |
| packagingWorker | String? | |
| packagingCheck | Enum(`OK`/`NG`) | 包装表示確認 |
| lotCheck | Enum(`OK`/`NG`) | ロット確認 |
| completedQty | Decimal? | 完成数量 |
| sampleQty | Decimal? | 抜取り数量 |

`COMPLETED` に遷移したタイミングで、`ingredients` の `actualQty` 合計に基づき `StockTransaction(reason=MANUFACTURING_USE, qty=-actualQty)` を各原料・資材について1件ずつ作成する。

### ManufacturingOrderIngredient（製造指示の配合原料行）

印刷帳票の「配合原料名」セクションに対応する。指図時に `ProductRecipe` をコピーして作成し、実際の秤量結果・ロット番号を後から記録する。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| manufacturingOrderId | Int (FK) | |
| materialId | Int (FK→Material) | |
| perUnitQty | Decimal | １本あたりの容量（BOMコピー） |
| perUnitUnit | String | |
| plannedQty | Decimal | 指図量 = perUnitQty × ManufacturingOrder.plannedQty |
| actualQty | Decimal? | 実際の秤量 |
| materialLotNumber | String? | 原料ロット番号 |
| checked | Boolean | チェック欄 |
| sortOrder | Int | |
| notes | String? | |

### ManufacturingOrderPackaging（製造指示の包装資材行）

印刷帳票の「包装表示」セクションに対応。資材マスタにない自由記述の資材名にも対応するため `materialId` は任意、`materialName` は必須。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| manufacturingOrderId | Int (FK) | |
| materialId | Int? (FK→Material) | 任意 |
| materialName | String | 資材名（自由記述可） |
| materialCode | String? | 資材品番 |
| usedQty | Decimal? | 使用数量 |
| remainingQty | Decimal? | 残数量 |
| sortOrder | Int | |
| notes | String? | |

### StockTransaction（在庫増減履歴）

`Material.stockQty` は本テーブルの集計から導出されるキャッシュ値で、本テーブルが在庫の **Source of Truth**。

| 列 | 型 | 備考 |
|----|----|------|
| id | Int (PK) | |
| materialId | Int (FK→Material) | |
| occurredAt | Date | 発生日 |
| qty | Decimal | 増減量。入庫=正、出庫=負 |
| reason | Enum | `PURCHASE_ARRIVAL` / `MANUFACTURING_USE` / `INVENTORY_ADJUST` / `MANUAL` |
| notes | String? | |
| purchaseOrderId | Int? (FK) | 由来する発注（任意） |
| manufacturingOrderId | Int? (FK) | 由来する製造指示（任意） |
| createdAt | DateTime | |

#### 更新ルール（実装時の制約）

```ts
// 必ず prisma.$transaction でまとめる
await prisma.$transaction([
  prisma.stockTransaction.create({ data: { ... } }),
  prisma.material.update({
    where: { id: materialId },
    data: { stockQty: { increment: qty } },  // qty は符号付き
  }),
]);
```

棚卸時は次のように差分でレコードを作る:

```
adjust = 棚卸の実数 - 現在の stockQty
StockTransaction(reason=INVENTORY_ADJUST, qty=adjust)
```

## 設計上の判断ポイント（解消済み）

- ✅ 関連資材[アロマ協会/てんまん] → **削除**
- ✅ Product と Material の分離 → **分離する**
- ✅ 半製品（バルク）の扱い → **Material側で保持**
- ✅ 在庫整合性 → **`StockTransaction` を追加し、Material.stockQty は自動更新**
- ✅ 預かり在庫の3列 → **`consignedQty` + `consignedOwner` の2列に統合**
- ✅ 在庫数量（理論値）の「理論値」表記 → **削除**
- ✅ 製造記録の印刷フォーマット対応 → **ManufacturingOrder に印刷項目追加 + 2つの子テーブル**
