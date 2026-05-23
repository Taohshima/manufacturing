"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function decOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
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

export async function updatePurchaseOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const orderedQty = decOrNull(formData.get("orderedQty"));
  const supplierId = Number(formData.get("supplierId"));
  if (orderedQty == null || !Number.isFinite(supplierId)) {
    redirect(
      `/purchase-orders/${id}?error=${encodeURIComponent("取引先と発注数量は必須です")}`,
    );
  }

  await prisma.purchaseOrder.update({
    where: { id },
    data: {
      supplierId,
      orderedQty,
      orderedAt: dateOrNull(formData.get("orderedAt")),
      unitPrice: decOrNull(formData.get("unitPrice")),
      expectedArrivalAt: dateOrNull(formData.get("expectedArrivalAt")),
      notes: textOrNull(formData.get("notes")),
    },
  });

  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${id}?saved=1`);
}

export async function markOrdered(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "ORDERED",
      orderedAt: dateOrNull(formData.get("orderedAt")) ?? new Date(),
    },
  });
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${id}?saved=1`);
}

export async function arrivePurchaseOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const arrivedAt = dateOrNull(formData.get("arrivedAt")) ?? new Date();
  const arrivedQtyInput = decOrNull(formData.get("arrivedQty"));

  await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new Error("not found");
    if (order.status === "ARRIVED" || order.status === "CANCELLED") {
      throw new Error(
        `この発注は ${order.status === "ARRIVED" ? "到着済" : "キャンセル"} のため到着処理できません`,
      );
    }

    const arrivedQty = arrivedQtyInput ?? order.orderedQty.toString();
    const arrivedQtyN = Number(arrivedQty);

    if (arrivedQtyN > 0) {
      await tx.stockTransaction.create({
        data: {
          materialId: order.materialId,
          occurredAt: arrivedAt,
          qty: arrivedQty,
          reason: "PURCHASE_ARRIVAL",
          purchaseOrderId: id,
          notes: `発注#${id} 到着`,
        },
      });
      const m = await tx.material.findUnique({ where: { id: order.materialId } });
      if (m) {
        const newQty = Number(m.stockQty) + arrivedQtyN;
        await tx.material.update({
          where: { id: order.materialId },
          data: { stockQty: newQty.toString() },
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "ARRIVED",
        arrivedAt,
        arrivedQty,
      },
    });
  });

  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/materials");
  redirect(`/purchase-orders/${id}?arrived=1`);
}

export async function cancelPurchaseOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) redirect("/purchase-orders");
  if (order!.status === "ARRIVED") {
    redirect(
      `/purchase-orders/${id}?error=${encodeURIComponent("到着済の発注はキャンセルできません")}`,
    );
  }
  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${id}?saved=1`);
}

export async function deletePurchaseOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const order = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!order) redirect("/purchase-orders");
  if (order!.status !== "PLANNED") {
    redirect(
      `/purchase-orders/${id}?error=${encodeURIComponent("予定状態の発注のみ削除できます")}`,
    );
  }
  try {
    await prisma.purchaseOrder.delete({ where: { id } });
  } catch {
    redirect(
      `/purchase-orders/${id}?error=${encodeURIComponent("関連データのため削除できません")}`,
    );
  }
  revalidatePath("/purchase-orders");
  redirect("/purchase-orders");
}
