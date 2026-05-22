"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseDecimal(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return s;
}

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function createMaterial(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));

  if (!name || !unit || !Number.isFinite(categoryId)) {
    redirect(
      `/materials/new?error=${encodeURIComponent("名称・カテゴリ・単位は必須です")}`,
    );
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    redirect(
      `/materials/new?error=${encodeURIComponent("カテゴリが見つかりません")}`,
    );
  }

  const supplierIdRaw = formData.get("supplierId");
  const supplierId =
    supplierIdRaw && String(supplierIdRaw).trim() !== ""
      ? Number(supplierIdRaw)
      : null;

  const initialQty = parseDecimal(formData.get("initialQty"));
  const occurredAtStr = String(formData.get("occurredAt") ?? "").trim();
  const occurredAt = occurredAtStr ? new Date(occurredAtStr) : new Date();

  const created = await prisma.$transaction(async (tx) => {
    const m = await tx.material.create({
      data: {
        name,
        categoryId,
        division: category.division,
        unit,
        purchasePrice: parseDecimal(formData.get("purchasePrice")),
        supplierId: supplierId && Number.isFinite(supplierId) ? supplierId : null,
        storageLocation: textOrNull(formData.get("storageLocation")),
        consignedQty: parseDecimal(formData.get("consignedQty")),
        consignedOwner: textOrNull(formData.get("consignedOwner")),
        docUrl: textOrNull(formData.get("docUrl")),
        notes: textOrNull(formData.get("notes")),
        stockQty: initialQty ?? "0",
        lastInventoryDate: initialQty != null ? occurredAt : null,
      },
    });

    if (initialQty != null && Number(initialQty) !== 0) {
      await tx.stockTransaction.create({
        data: {
          materialId: m.id,
          occurredAt,
          qty: initialQty,
          reason: "INVENTORY_ADJUST",
          notes: "新規登録による初期在庫",
        },
      });
    }

    return m;
  });

  revalidatePath("/materials");
  redirect(`/materials/${created.id}?saved=1`);
}
