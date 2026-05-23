"use server";

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

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function commitInventoryCount(formData: FormData) {
  const occurredAt = dateOrToday(formData.get("occurredAt"));
  const notesPrefix = textOrNull(formData.get("notes")) ?? "棚卸";

  // actual_{materialId} の入力があった行だけを集める
  const entries: { materialId: number; newQty: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("actual_")) continue;
    const idStr = key.slice("actual_".length);
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    const s = String(value).trim();
    if (s === "") continue;
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    entries.push({ materialId: id, newQty: n });
  }

  if (entries.length === 0) {
    redirect(
      `/materials/inventory-count?error=${encodeURIComponent("実棚数の入力が1件もありません")}`,
    );
  }

  // 対象資材の現在庫を一括取得
  const materials = await prisma.material.findMany({
    where: { id: { in: entries.map((e) => e.materialId) } },
    select: { id: true, stockQty: true, name: true },
  });
  const map = new Map(materials.map((m) => [m.id, m]));

  let countedZeroDiff = 0;
  let adjusted = 0;

  // 1件ずつ独立したトランザクションで処理（資材数が多いと長時間ロックになるため）
  for (const e of entries) {
    const m = map.get(e.materialId);
    if (!m) continue;
    const current = Number(m.stockQty);
    const delta = e.newQty - current;

    await prisma.$transaction(async (tx) => {
      if (delta !== 0) {
        await tx.stockTransaction.create({
          data: {
            materialId: e.materialId,
            occurredAt,
            qty: delta.toString(),
            reason: "INVENTORY_ADJUST",
            notes: notesPrefix,
          },
        });
      }
      await tx.material.update({
        where: { id: e.materialId },
        data: {
          stockQty: e.newQty.toString(),
          lastInventoryDate: occurredAt,
        },
      });
    });

    if (delta === 0) countedZeroDiff++;
    else adjusted++;
  }

  revalidatePath("/materials");
  revalidatePath("/materials/inventory-count");
  redirect(
    `/materials/inventory-count?committed=${adjusted}&zero=${countedZeroDiff}`,
  );
}
