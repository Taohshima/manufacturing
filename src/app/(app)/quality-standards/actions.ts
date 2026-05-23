"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

export async function createQualityStandard(formData: FormData) {
  const productId = Number(formData.get("productId"));
  const controlNumber = String(formData.get("controlNumber") ?? "").trim();
  if (!Number.isFinite(productId) || !controlNumber) {
    redirect(
      `/quality-standards/new?error=${encodeURIComponent("製品と管理番号は必須です")}`,
    );
  }
  try {
    const created = await prisma.qualityStandard.create({
      data: {
        productId,
        controlNumber,
        establishedAt: dateOrNull(formData.get("establishedAt")),
        establishedBy: textOrNull(formData.get("establishedBy")),
      },
    });
    revalidatePath("/quality-standards");
    redirect(`/quality-standards/${created.id}?created=1`);
  } catch (e) {
    const msg =
      e instanceof Error && e.message.includes("Unique")
        ? "管理番号またはこの製品の品質標準書は既に存在します"
        : "作成に失敗しました";
    redirect(`/quality-standards/new?error=${encodeURIComponent(msg)}`);
  }
}

export async function updateQualityStandardMain(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const controlNumber = String(formData.get("controlNumber") ?? "").trim();
  if (!controlNumber) {
    redirect(
      `/quality-standards/${id}?error=${encodeURIComponent("管理番号は必須です")}`,
    );
  }
  await prisma.qualityStandard.update({
    where: { id },
    data: {
      controlNumber,
      establishedAt: dateOrNull(formData.get("establishedAt")),
      establishedBy: textOrNull(formData.get("establishedBy")),
      productCategory: textOrNull(formData.get("productCategory")),
      manufacturer: textOrNull(formData.get("manufacturer")),
      manufacturerAddr: textOrNull(formData.get("manufacturerAddr")),
      permitDate: dateOrNull(formData.get("permitDate")),
      permitNumber: textOrNull(formData.get("permitNumber")),
      notificationType: textOrNull(formData.get("notificationType")),
      pkgCapacity: textOrNull(formData.get("pkgCapacity")),
      pkgColorCode: textOrNull(formData.get("pkgColorCode")),
      pkgManufacturerContact: textOrNull(formData.get("pkgManufacturerContact")),
      pkgDistributorContact: textOrNull(formData.get("pkgDistributorContact")),
      pkgAllIngredients: textOrNull(formData.get("pkgAllIngredients")),
      pkgUsageMethod: textOrNull(formData.get("pkgUsageMethod")),
      pkgUsageNotes: textOrNull(formData.get("pkgUsageNotes")),
      pkgIdentification: textOrNull(formData.get("pkgIdentification")),
      pkgOther: textOrNull(formData.get("pkgOther")),
      pkgNotes: textOrNull(formData.get("pkgNotes")),
      spFillVolume: textOrNull(formData.get("spFillVolume")),
      spLotPrinter: textOrNull(formData.get("spLotPrinter")),
      spLotText: textOrNull(formData.get("spLotText")),
      spCardboardSize: textOrNull(formData.get("spCardboardSize")),
      notes: textOrNull(formData.get("notes")),
    },
  });
  revalidatePath(`/quality-standards/${id}`);
  revalidatePath("/quality-standards");
  redirect(`/quality-standards/${id}?saved=1`);
}

export async function deleteQualityStandard(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.qualityStandard.delete({ where: { id } });
  revalidatePath("/quality-standards");
  redirect("/quality-standards");
}
