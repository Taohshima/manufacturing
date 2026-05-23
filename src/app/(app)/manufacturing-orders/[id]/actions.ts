"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CheckResult } from "@prisma/client";

function decOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function checkOrNull(v: FormDataEntryValue | null): CheckResult | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "OK") return "OK";
  if (s === "NG") return "NG";
  return null;
}

export async function updateManufacturingOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const plannedQty = decOrNull(formData.get("plannedQty"));
  const instructedAt = dateOrNull(formData.get("instructedAt"));
  if (plannedQty == null || instructedAt == null) {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("製造数量と指図年月日は必須です")}`,
    );
  }

  await prisma.manufacturingOrder.update({
    where: { id },
    data: {
      instructedAt,
      scheduledAt: dateOrNull(formData.get("scheduledAt")),
      orderedAt: dateOrNull(formData.get("orderedAt")),
      plannedQty,
      lotNumber: textOrNull(formData.get("lotNumber")),
      standardNo: textOrNull(formData.get("standardNo")),
      instructor: textOrNull(formData.get("instructor")),
      notes: textOrNull(formData.get("notes")),

      // 秤量
      weighingDate: dateOrNull(formData.get("weighingDate")),
      temperature: decOrNull(formData.get("temperature")),
      humidity: decOrNull(formData.get("humidity")),

      // 混合
      mixedAt: dateOrNull(formData.get("mixedAt")),
      mixStartTime: textOrNull(formData.get("mixStartTime")),
      mixEndTime: textOrNull(formData.get("mixEndTime")),
      mixWorker: textOrNull(formData.get("mixWorker")),
      mixNotes: textOrNull(formData.get("mixNotes")),

      // 充填
      filledAt: dateOrNull(formData.get("filledAt")),
      fillUnitVolume: decOrNull(formData.get("fillUnitVolume")),
      fillUnit: textOrNull(formData.get("fillUnit")),
      fillCount: intOrNull(formData.get("fillCount")),
      fillMissCount: intOrNull(formData.get("fillMissCount")),
      containerCheck: checkOrNull(formData.get("containerCheck")),
      fillWorker: textOrNull(formData.get("fillWorker")),

      // 包装
      packagedAt: dateOrNull(formData.get("packagedAt")),
      cardboardSize: textOrNull(formData.get("cardboardSize")),
      packagingWorker: textOrNull(formData.get("packagingWorker")),
      packagingCheck: checkOrNull(formData.get("packagingCheck")),
      lotCheck: checkOrNull(formData.get("lotCheck")),
      completedQty: decOrNull(formData.get("completedQty")),
      sampleQty: decOrNull(formData.get("sampleQty")),
    },
  });

  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function setStatusInProgress(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.manufacturingOrder.update({
    where: { id },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function updateIngredient(formData: FormData) {
  const id = Number(formData.get("id"));
  const orderId = Number(formData.get("orderId"));
  if (!Number.isFinite(id) || !Number.isFinite(orderId)) {
    throw new Error("invalid id");
  }
  await prisma.manufacturingOrderIngredient.update({
    where: { id },
    data: {
      actualQty: decOrNull(formData.get("actualQty")),
      materialLotNumber: textOrNull(formData.get("materialLotNumber")),
      checked: formData.get("checked") === "on",
      notes: textOrNull(formData.get("notes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${orderId}`);
  redirect(`/manufacturing-orders/${orderId}?saved=1`);
}

export async function completeOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const occurredAt = dateOrNull(formData.get("occurredAt")) ?? new Date();

  await prisma.$transaction(async (tx) => {
    const order = await tx.manufacturingOrder.findUnique({
      where: { id },
      include: { ingredients: true },
    });
    if (!order) throw new Error("not found");
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new Error(
        `この指図は ${order.status === "COMPLETED" ? "完了" : "キャンセル"} 済のため、完了処理できません`,
      );
    }

    // 各原料を消費（actualQty 優先、なければ plannedQty）
    for (const ing of order.ingredients) {
      const consumedStr = ing.actualQty != null ? ing.actualQty : ing.plannedQty;
      const consumed = Number(consumedStr);
      if (consumed === 0) continue;
      await tx.stockTransaction.create({
        data: {
          materialId: ing.materialId,
          occurredAt,
          qty: (-consumed).toString(),
          reason: "MANUFACTURING_USE",
          manufacturingOrderId: id,
          notes: `製造指図#${id} で消費`,
        },
      });
      const m = await tx.material.findUnique({ where: { id: ing.materialId } });
      if (!m) continue;
      const newQty = Number(m.stockQty) - consumed;
      await tx.material.update({
        where: { id: ing.materialId },
        data: { stockQty: newQty.toString() },
      });
    }

    // 製品在庫を増やす（完成数量 優先、なければ予定数量）
    const producedStr =
      order.completedQty != null ? order.completedQty : order.plannedQty;
    const produced = Number(producedStr);
    if (produced > 0) {
      const product = await tx.product.findUnique({ where: { id: order.productId } });
      if (product) {
        const currentStock = product.stockQty != null ? Number(product.stockQty) : 0;
        await tx.product.update({
          where: { id: product.id },
          data: { stockQty: (currentStock + produced).toString() },
        });
      }
    }

    await tx.manufacturingOrder.update({
      where: { id },
      data: { status: "COMPLETED" },
    });
  });

  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  revalidatePath("/materials");
  revalidatePath("/products");
  redirect(`/manufacturing-orders/${id}?completed=1`);
}

export async function cancelOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.manufacturingOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function deleteOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const order = await prisma.manufacturingOrder.findUnique({ where: { id } });
  if (!order) redirect("/manufacturing-orders");
  if (order!.status !== "PLANNED") {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("進行中・完了・キャンセルの指図は削除できません")}`,
    );
  }
  try {
    await prisma.manufacturingOrder.delete({ where: { id } });
  } catch {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("関連データのため削除できません")}`,
    );
  }
  revalidatePath("/manufacturing-orders");
  redirect("/manufacturing-orders");
}
