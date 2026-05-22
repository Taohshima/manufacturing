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

function readProductForm(formData: FormData) {
  const salesName = String(formData.get("salesName") ?? "").trim();
  const capacity = decOrNull(formData.get("capacity"));
  const capacityUnit = String(formData.get("capacityUnit") ?? "").trim();
  return {
    salesName,
    capacity,
    capacityUnit,
    genericName: textOrNull(formData.get("genericName")),
    standardNo: textOrNull(formData.get("standardNo")),
    controlDivision: textOrNull(formData.get("controlDivision")),
    expiryMonths: intOrNull(formData.get("expiryMonths")),
    caseCount: intOrNull(formData.get("caseCount")),
    storageLocation: textOrNull(formData.get("storageLocation")),
    salesPrice: decOrNull(formData.get("salesPrice")),
    productCost: decOrNull(formData.get("productCost")),
    stockQty: decOrNull(formData.get("stockQty")),
  };
}

export async function createProduct(formData: FormData) {
  const f = readProductForm(formData);
  if (!f.salesName || f.capacity == null || !f.capacityUnit) {
    redirect(
      `/products/new?error=${encodeURIComponent("販売名・容量・容量単位は必須です")}`,
    );
  }
  const created = await prisma.product.create({
    data: {
      salesName: f.salesName,
      capacity: f.capacity,
      capacityUnit: f.capacityUnit,
      genericName: f.genericName,
      standardNo: f.standardNo,
      controlDivision: f.controlDivision,
      expiryMonths: f.expiryMonths,
      caseCount: f.caseCount,
      storageLocation: f.storageLocation,
      salesPrice: f.salesPrice,
      productCost: f.productCost,
      stockQty: f.stockQty,
    },
  });
  revalidatePath("/products");
  redirect(`/products/${created.id}?saved=1`);
}

export async function updateProduct(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const f = readProductForm(formData);
  if (!f.salesName || f.capacity == null || !f.capacityUnit) {
    redirect(
      `/products/${id}?error=${encodeURIComponent("販売名・容量・容量単位は必須です")}`,
    );
  }
  await prisma.product.update({
    where: { id },
    data: {
      salesName: f.salesName,
      capacity: f.capacity,
      capacityUnit: f.capacityUnit,
      genericName: f.genericName,
      standardNo: f.standardNo,
      controlDivision: f.controlDivision,
      expiryMonths: f.expiryMonths,
      caseCount: f.caseCount,
      storageLocation: f.storageLocation,
      salesPrice: f.salesPrice,
      productCost: f.productCost,
      stockQty: f.stockQty,
    },
  });
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  redirect(`/products/${id}?saved=1`);
}

export async function deleteProduct(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  // ProductRecipe は onDelete: Cascade。製造実績がある製品は外部キー制約で削除不可。
  try {
    await prisma.product.delete({ where: { id } });
  } catch {
    redirect(
      `/products/${id}?error=${encodeURIComponent("製造実績などに紐付くため削除できません")}`,
    );
  }
  revalidatePath("/products");
  redirect("/products");
}

export async function addRecipe(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const materialId = Number(formData.get("materialId"));
  const usageQty = decOrNull(formData.get("usageQty"));
  if (!Number.isFinite(productId)) throw new Error("invalid productId");

  if (!Number.isFinite(materialId) || usageQty == null) {
    redirect(
      `/products/${productId}?error=${encodeURIComponent("材料と利用量を入力してください")}`,
    );
  }

  let usageUnit = textOrNull(formData.get("usageUnit"));
  if (!usageUnit) {
    const material = await prisma.material.findUnique({ where: { id: materialId } });
    usageUnit = material?.unit ?? "";
  }

  const sortOrder = intOrNull(formData.get("sortOrder")) ?? 0;

  try {
    await prisma.productRecipe.create({
      data: { productId, materialId, usageQty, usageUnit, sortOrder },
    });
  } catch {
    redirect(
      `/products/${productId}?error=${encodeURIComponent("その材料は既に配合に登録されています")}`,
    );
  }

  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?saved=1`);
}

export async function updateRecipe(formData: FormData) {
  const id = Number(formData.get("id"));
  const productId = Number(formData.get("productId"));
  const usageQty = decOrNull(formData.get("usageQty"));
  if (!Number.isFinite(id) || !Number.isFinite(productId)) {
    throw new Error("invalid id");
  }
  if (usageQty == null) {
    redirect(
      `/products/${productId}?error=${encodeURIComponent("利用量を正しく入力してください")}`,
    );
  }
  await prisma.productRecipe.update({
    where: { id },
    data: {
      usageQty,
      usageUnit: String(formData.get("usageUnit") ?? "").trim() || undefined,
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?saved=1`);
}

export async function deleteRecipe(formData: FormData) {
  const id = Number(formData.get("id"));
  const productId = Number(formData.get("productId"));
  if (!Number.isFinite(id) || !Number.isFinite(productId)) {
    throw new Error("invalid id");
  }
  await prisma.productRecipe.delete({ where: { id } });
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}?saved=1`);
}
