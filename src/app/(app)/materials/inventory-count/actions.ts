"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function dateOrToday(v: FormDataEntryValue | null): Date {
  if (v == null) return new Date();
  const s = String(v).trim();
  if (s === "") return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Material.stockQty は Decimal(14, 4)。整数部は10桁まで。
const MAX_QTY = 1e10;

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function commitInventoryCount(formData: FormData) {
  const occurredAt = dateOrToday(formData.get("occurredAt"));
  const notesPrefix = textOrNull(formData.get("notes")) ?? "棚卸";

  // actual_{materialId} の入力があった行だけを集める
  const entries = new Map<number, number>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("actual_")) continue;
    const idStr = key.slice("actual_".length);
    const id = Number(idStr);
    if (!Number.isInteger(id)) continue;
    const s = String(value).trim();
    if (s === "") continue;
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    if (Math.abs(n) >= MAX_QTY) {
      redirect(
        `/materials/inventory-count?error=${encodeURIComponent("実棚数が大きすぎる行があります（上限 9,999,999,999）")}`,
      );
    }
    entries.set(id, n);
  }

  if (entries.size === 0) {
    redirect(
      `/materials/inventory-count?error=${encodeURIComponent("実棚数の入力が1件もありません")}`,
    );
  }

  // 全行を1つのSQLで反映する。
  // 以前は1資材ごとに個別トランザクション（DBとの往復が1件あたり3〜4回）で、
  // 件数に比例して遅くなっていた。1文にまとめることで往復は件数によらず1回になり、
  // 現在庫の読み取り〜差分の記録〜在庫の更新が同一スナップショットで行われる。
  const values = Prisma.join(
    [...entries].map(
      ([id, qty]) => Prisma.sql`(${id}::int, ${qty.toString()}::numeric)`,
    ),
  );
  const occurredOn = occurredAt.toISOString().slice(0, 10);

  const rows = await prisma.$queryRaw<{ adjusted: bigint; zero: bigint }[]>`
    WITH input(id, qty) AS (VALUES ${values}),
    locked AS (
      SELECT m."id", m."stockQty" AS old_qty, round(i.qty, 4) AS new_qty
      FROM "Material" m
      JOIN input i ON i.id = m."id"
      FOR UPDATE OF m
    ),
    ins AS (
      INSERT INTO "StockTransaction"
        ("materialId", "occurredAt", "qty", "reason", "notes", "createdAt")
      SELECT
        l."id",
        ${occurredOn}::date,
        l.new_qty - l.old_qty,
        'INVENTORY_ADJUST'::"StockTransactionReason",
        ${notesPrefix},
        now() AT TIME ZONE 'UTC'
      FROM locked l
      WHERE l.new_qty <> l.old_qty
      RETURNING 1
    ),
    upd AS (
      UPDATE "Material" m
      SET "stockQty" = l.new_qty,
          "lastInventoryDate" = ${occurredOn}::date,
          "updatedAt" = now() AT TIME ZONE 'UTC'
      FROM locked l
      WHERE m."id" = l."id"
      RETURNING (l.new_qty <> l.old_qty) AS changed
    )
    SELECT
      count(*) FILTER (WHERE changed) AS adjusted,
      count(*) FILTER (WHERE NOT changed) AS zero
    FROM upd
  `;

  const adjusted = Number(rows[0]?.adjusted ?? 0);
  const countedZeroDiff = Number(rows[0]?.zero ?? 0);

  revalidatePath("/materials");
  revalidatePath("/materials/inventory-count");
  redirect(
    `/materials/inventory-count?committed=${adjusted}&zero=${countedZeroDiff}`,
  );
}
