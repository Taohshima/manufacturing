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

export async function createPurchaseOrder(formData: FormData) {
  const materialId = Number(formData.get("materialId"));
  const supplierId = Number(formData.get("supplierId"));
  const orderedQty = decOrNull(formData.get("orderedQty"));

  if (!Number.isFinite(materialId) || !Number.isFinite(supplierId) || orderedQty == null) {
    redirect(
      `/purchase-orders/new?error=${encodeURIComponent("資材・取引先・発注数量は必須です")}`,
    );
  }

  // 単価未入力なら資材マスタの仕入単価を採用
  let unitPrice = decOrNull(formData.get("unitPrice"));
  if (unitPrice == null) {
    const m = await prisma.material.findUnique({
      where: { id: materialId },
      select: { purchasePrice: true },
    });
    if (m?.purchasePrice != null) unitPrice = m.purchasePrice.toString();
  }

  const created = await prisma.purchaseOrder.create({
    data: {
      materialId,
      supplierId,
      orderedAt: dateOrNull(formData.get("orderedAt")),
      orderedQty,
      unitPrice,
      expectedArrivalAt: dateOrNull(formData.get("expectedArrivalAt")),
      notes: textOrNull(formData.get("notes")),
    },
  });

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${created.id}?created=1`);
}
