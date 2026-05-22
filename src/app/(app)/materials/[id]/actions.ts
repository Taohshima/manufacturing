"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StockTransactionReason } from "@prisma/client";

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

export async function updateMaterial(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));

  if (!name || !unit || !Number.isFinite(categoryId)) {
    redirect(
      `/materials/${id}?error=${encodeURIComponent("名称・カテゴリ・単位は必須です")}`,
    );
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    redirect(
      `/materials/${id}?error=${encodeURIComponent("カテゴリが見つかりません")}`,
    );
  }

  const supplierIdRaw = formData.get("supplierId");
  const supplierId =
    supplierIdRaw && String(supplierIdRaw).trim() !== ""
      ? Number(supplierIdRaw)
      : null;

  await prisma.material.update({
    where: { id },
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
    },
  });

  revalidatePath(`/materials/${id}`);
  revalidatePath("/materials");
  redirect(`/materials/${id}?saved=1`);
}

export async function adjustStock(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const newQtyStr = parseDecimal(formData.get("newQty"));
  if (newQtyStr == null) {
    redirect(
      `/materials/${id}?error=${encodeURIComponent("調整後の在庫数を正しく入力してください")}`,
    );
  }

  const occurredAtStr = String(formData.get("occurredAt") ?? "").trim();
  const occurredAt = occurredAtStr ? new Date(occurredAtStr) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    redirect(
      `/materials/${id}?error=${encodeURIComponent("日付が不正です")}`,
    );
  }

  const reason: StockTransactionReason =
    formData.get("reason") === "MANUAL" ? "MANUAL" : "INVENTORY_ADJUST";
  const notes = textOrNull(formData.get("notes"));

  await prisma.$transaction(async (tx) => {
    const m = await tx.material.findUnique({ where: { id } });
    if (!m) throw new Error("material not found");

    const delta = Number(newQtyStr) - Number(m.stockQty);
    if (delta === 0) return;

    await tx.stockTransaction.create({
      data: {
        materialId: id,
        occurredAt,
        qty: delta.toString(),
        reason,
        notes,
      },
    });

    await tx.material.update({
      where: { id },
      data: {
        stockQty: newQtyStr,
        ...(reason === "INVENTORY_ADJUST"
          ? { lastInventoryDate: occurredAt }
          : {}),
      },
    });
  });

  revalidatePath(`/materials/${id}`);
  revalidatePath("/materials");
  redirect(`/materials/${id}?adjusted=1`);
}
