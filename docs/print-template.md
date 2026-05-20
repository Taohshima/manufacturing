# 製造記録 印刷帳票

参考URL: https://docs.google.com/spreadsheets/d/1UtgWwmGX7cwc1Hka_GMv5vfyuTRg4Eu_SdFTgUU1550

## 概要

`ManufacturingOrder` を「製品標準書 ロット記録用紙」の様式で印刷できるようにする。製造現場での記録用紙としてA4 1枚に収める。

実装:
- ルート: `/manufacturing-orders/[id]/print`
- ブラウザの印刷ダイアログ（PDF保存可）で出力
- Tailwindの印刷スタイル（`print:` バリアント）で画面表示と印刷表示を切り分け

## 帳票レイアウト（A4縦・1製造記録あたり1ページ）

```
┌─────────────────────────────────────────────────────────────┐
│ 販売名:        養生あろま ピローミスト  │ 製品標準書 No.:    │
│ 製造番号・ロット番号: 2027.5            │ 指図者:             │
│ 製造数量:      20 本                    │ 指図年月日:         │
│ 原料名及び配合量 │ 秤量年月日: ___ │ 温度: __℃ │ 湿度: __%    │
├──────────────────┬─────────────┬───────┬──────┬───────┬──────┤
│ 配合原料名       │ 原料ロット番号│ 1本あたり│指図量│ 秤量 │ チェック│
├──────────────────┼─────────────┼───────┼──────┼───────┼──────┤
│ 精製水           │             │ 30.0 ml │ 600  │      │       │
│ ノニオンE-2055   │             │ 0.045   │ 0.9  │      │       │
│ ...              │             │         │      │      │       │
├──────────────────┴─────────────┴───────┼──────┼───────┴──────┤
│ 総量(合計)                              │      │              │
│ 備考                                    │                     │
├─────────┬────────┬────────┬────────┬────────────────────────┤
│ 混合   │混合年月日│開始時刻 │終了時刻 │ 作業者    │ 備考       │
├─────────┼────────┼────────┼────────┼────────┼─────────────┤
│ 充填   │充填年月日│充填容量×数量│充填ミス数量│ 容器表示確認 │ 作業者 │
├─────────┴────────┴────────┴────────┴────────┴─────────────┤
│ 包装表示                                                     │
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐         │
│ │ 資材名  │ 資材品番│ 使用数量│ 残数量  │ 備考    │         │
│ ├─────────┼─────────┼─────────┼─────────┼─────────┤         │
│ │ ...     │         │         │         │         │         │
│ └─────────┴─────────┴─────────┴─────────┴─────────┘         │
│ 段ボール: __サイズ                                           │
│ 包装年月日: __ │ 作業者: __ │ 包装表示: 適/不適 │ ロット: 適/不適│
│ 完成数量: __  │ 抜取り数量: __                               │
└─────────────────────────────────────────────────────────────┘
```

## データソース対応

| 帳票項目 | データソース |
|----------|--------------|
| 販売名 | `Product.salesName` |
| 製品標準書 No. | `ManufacturingOrder.standardNo`（無ければ `Product.standardNo`） |
| 製造番号・ロット番号 | `ManufacturingOrder.lotNumber` |
| 指図者 | `ManufacturingOrder.instructor` |
| 製造数量・単位 | `ManufacturingOrder.plannedQty` + `Product.capacityUnit`（または「本」） |
| 指図年月日 | `ManufacturingOrder.instructedAt` |
| 秤量年月日 / 温度 / 湿度 | `ManufacturingOrder.weighingDate` / `.temperature` / `.humidity` |
| 配合原料 行 | `ManufacturingOrderIngredient[]`（指図時に `ProductRecipe` をコピー） |
| ├ 配合原料名 | `Material.name` |
| ├ 原料ロット番号 | `MOIngredient.materialLotNumber` |
| ├ 1本あたりの容量 | `MOIngredient.perUnitQty` + `.perUnitUnit` |
| ├ 指図量 | `MOIngredient.plannedQty`（自動算出） |
| ├ 秤量 | `MOIngredient.actualQty`（手入力） |
| └ チェック | `MOIngredient.checked` |
| 総量(合計) | 指図量の合計（自動算出） |
| 備考 | `ManufacturingOrder.notes` |
| 混合 行 | `mixedAt` / `mixStartTime` / `mixEndTime` / `mixWorker` / `mixNotes` |
| 充填 行 | `filledAt` / `fillUnitVolume` × `fillCount` / `fillMissCount` / `containerCheck` / `fillWorker` |
| 包装表示 行 | `ManufacturingOrderPackaging[]` |
| ├ 資材名 / 資材品番 | `materialName` / `materialCode` |
| └ 使用数量 / 残数量 | `usedQty` / `remainingQty` |
| 段ボール サイズ | `ManufacturingOrder.cardboardSize` |
| 包装年月日 | `packagedAt` |
| 包装作業者 | `packagingWorker` |
| 包装表示確認 | `packagingCheck` |
| ロット確認 | `lotCheck` |
| 完成数量 / 抜取り数量 | `completedQty` / `sampleQty` |

## 印刷時の挙動

- 未入力の項目は空欄で印刷（現場で手書きできる）
- 配合原料の行数が少なくても、最低8行は罫線を出す
- 包装表示の行数が少なくても、最低6行は罫線を出す
- A4縦 / マージン狭め / フォント12pt 程度

## 実装メモ

- React コンポーネントとして `src/app/manufacturing-orders/[id]/print/page.tsx` を作成
- `@media print` で操作ボタンを非表示
- 配合原料・包装表示は固定行数のテーブルを描画し、データ無しのセルは空のままにする
