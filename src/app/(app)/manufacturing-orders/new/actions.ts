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

function dateOrToday(v: FormDataEntryValue | null): Date {
  if (v == null) return new Date();
  const s = String(v).trim();
  if (s === "") return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createManufacturingOrder(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const plannedQty = decOrNull(formData.get("plannedQty"));
  if (!Number.isFinite(productId) || plannedQty == null) {
    redirect(
      `/manufacturing-orders/new?error=${encodeURIComponent("製品と製造数量は必須です")}`,
    );
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      recipes: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { material: true },
      },
    },
  });
  if (!product) {
    redirect(
      `/manufacturing-orders/new?error=${encodeURIComponent("製品が見つかりません")}`,
    );
  }

  const instructedAt = dateOrToday(formData.get("instructedAt"));
  const scheduledAt = dateOrNull(formData.get("scheduledAt"));
  const orderedAt = dateOrNull(formData.get("orderedAt"));
  const lotNumber = textOrNull(formData.get("lotNumber"));
  const instructor = textOrNull(formData.get("instructor"));
  const notes = textOrNull(formData.get("notes"));

  const plannedQtyN = Number(plannedQty);

  const created = await prisma.manufacturingOrder.create({
    data: {
      productId,
      orderedAt,
      instructedAt,
      scheduledAt,
      plannedQty,
      lotNumber,
      standardNo: product.standardNo,
      instructor,
      notes,
      ingredients: {
        create: product.recipes.map((r) => ({
          materialId: r.materialId,
          perUnitQty: r.usageQty,
          perUnitUnit: r.usageUnit,
          plannedQty: (Number(r.usageQty) * plannedQtyN).toString(),
          sortOrder: r.sortOrder,
        })),
      },
    },
  });

  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${created.id}?created=1`);
}
