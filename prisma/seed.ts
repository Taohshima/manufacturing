import { PrismaClient, Division } from "@prisma/client";

const prisma = new PrismaClient();

// 化粧品の効能の範囲（56項目）
// 参考: 厚生労働省「化粧品の効能の範囲の改正について」
const EFFICACY_CLAIMS: string[] = [
  "頭皮、毛髪を清浄にする。",
  "香りにより毛髪、頭皮の不快臭を抑える。",
  "頭皮、毛髪をすこやかに保つ。",
  "毛髪にはり、こしを与える。",
  "頭皮、毛髪にうるおいを与える。",
  "頭皮、毛髪のうるおいを保つ。",
  "毛髪をしなやかにする。",
  "クシどおりをよくする。",
  "毛髪のつやを保つ。",
  "毛髪につやを与える。",
  "フケ、カユミがとれる。",
  "フケ、カユミを抑える。",
  "毛髪の水分、油分を補い保つ。",
  "裂毛、切毛、枝毛を防ぐ。",
  "髪型を整え、保持する。",
  "毛髪の帯電を防止する。",
  "（汚れをおとすことにより）皮膚を清浄にする。",
  "（洗浄により）ニキビ、アセモを防ぐ（洗顔料）。",
  "肌を整える。",
  "肌のキメを整える。",
  "皮膚をすこやかに保つ。",
  "肌荒れを防ぐ。",
  "肌をひきしめる。",
  "皮膚にうるおいを与える。",
  "皮膚の水分、油分を補い保つ。",
  "皮膚の柔軟性を保つ。",
  "皮膚を保護する。",
  "皮膚の乾燥を防ぐ。",
  "肌を柔らげる。",
  "肌にはりを与える。",
  "肌にツヤを与える。",
  "肌を滑らかにする。",
  "ひげを剃りやすくする。",
  "ひげそり後の肌を整える。",
  "あせもを防ぐ（打粉）。",
  "日やけを防ぐ。",
  "日やけによるシミ、ソバカスを防ぐ。",
  "芳香を与える。",
  "爪を保護する。",
  "爪をすこやかに保つ。",
  "爪にうるおいを与える。",
  "口唇の荒れを防ぐ。",
  "口唇のキメを整える。",
  "口唇にうるおいを与える。",
  "口唇をすこやかにする。",
  "口唇を保護する。口唇の乾燥を防ぐ。",
  "口唇の乾燥によるカサツキを防ぐ。",
  "口唇を滑らかにする。",
  "ムシ歯を防ぐ（使用時にブラッシングを行う歯みがき類）。",
  "歯を白くする（使用時にブラッシングを行う歯みがき類）。",
  "歯垢を除去する（使用時にブラッシングを行う歯みがき類）。",
  "口中を浄化する（歯みがき類）。",
  "口臭を防ぐ（歯みがき類）。",
  "歯のやにを取る（使用時にブラッシングを行う歯みがき類）。",
  "歯石の沈着を防ぐ（使用時にブラッシングを行う歯みがき類）。",
  "乾燥による小ジワを目立たなくする。",
];

// 既存スプレッドシートのカテゴリマスタ
const CATEGORIES: { division: Division; name: string }[] = [
  { division: Division.RAW, name: "半製品" },
  { division: Division.RAW, name: "エキス" },
  { division: Division.RAW, name: "アルコール類" },
  { division: Division.RAW, name: "界面活性剤" },
  { division: Division.RAW, name: "精油" },
  { division: Division.RAW, name: "ジェル・ゲル" },
  { division: Division.RAW, name: "固体" },
  { division: Division.RAW, name: "粉体" },
  { division: Division.RAW, name: "液体(冷蔵)" },
  { division: Division.RAW, name: "液体(常温)" },
  { division: Division.PACKAGING, name: "中栓" },
  { division: Division.PACKAGING, name: "その他" },
  { division: Division.PACKAGING, name: "紙類" },
  { division: Division.PACKAGING, name: "化粧箱" },
  { division: Division.PACKAGING, name: "表示ラベル" },
  { division: Division.PACKAGING, name: "段ボール" },
  { division: Division.PACKAGING, name: "シュリンク" },
  { division: Division.PACKAGING, name: "ポンプ・スプレー" },
  { division: Division.PACKAGING, name: "キャップ" },
  { division: Division.PACKAGING, name: "容器" },
  { division: Division.PRODUCT, name: "在庫" },
];

// 自社製造所マスタ（参考: 品質標準書ファイル「製造所」シート）
const MANUFACTURING_SITES = [
  {
    name: "株式会社すはだみらい研究所",
    address: "長崎県長崎市古川町6-35",
    permitDate: new Date("2023-06-21"),
    permitNumber: "42CZ200015",
  },
];

async function main() {
  console.log("Seeding EfficacyClaim...");
  for (let i = 0; i < EFFICACY_CLAIMS.length; i++) {
    const no = i + 1;
    await prisma.efficacyClaim.upsert({
      where: { no },
      update: { text: EFFICACY_CLAIMS[i] },
      create: { no, text: EFFICACY_CLAIMS[i] },
    });
  }
  console.log(`  -> ${EFFICACY_CLAIMS.length} 件`);

  console.log("Seeding Category...");
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { division_name: { division: c.division, name: c.name } },
      update: {},
      create: c,
    });
  }
  console.log(`  -> ${CATEGORIES.length} 件`);

  console.log("Seeding ManufacturingSite...");
  for (const s of MANUFACTURING_SITES) {
    const existing = await prisma.manufacturingSite.findFirst({
      where: { name: s.name },
    });
    if (!existing) {
      await prisma.manufacturingSite.create({ data: s });
    }
  }
  console.log(`  -> ${MANUFACTURING_SITES.length} 件確認`);

  console.log("Seed completed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
