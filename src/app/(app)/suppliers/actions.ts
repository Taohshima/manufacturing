"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function intOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function readForm(formData: FormData) {
  return {
    companyName: String(formData.get("companyName") ?? "").trim(),
    officeName: textOrNull(formData.get("officeName")),
    postalCode: textOrNull(formData.get("postalCode")),
    address: textOrNull(formData.get("address")),
    phone: textOrNull(formData.get("phone")),
    fax: textOrNull(formData.get("fax")),
    websiteUrl: textOrNull(formData.get("websiteUrl")),
    contactPerson: textOrNull(formData.get("contactPerson")),
    email: textOrNull(formData.get("email")),
    orderMethod: textOrNull(formData.get("orderMethod")),
    paymentMethod: textOrNull(formData.get("paymentMethod")),
    paymentDay: intOrNull(formData.get("paymentDay")),
    paymentDivision: textOrNull(formData.get("paymentDivision")),
    paymentSite: textOrNull(formData.get("paymentSite")),
    searchLabel: textOrNull(formData.get("searchLabel")),
    alias: textOrNull(formData.get("alias")),
  } satisfies Prisma.SupplierUncheckedCreateInput;
}

export async function createSupplier(formData: FormData) {
  const data = readForm(formData);
  if (!data.companyName) {
    redirect(
      `/suppliers/new?error=${encodeURIComponent("取引先会社名は必須です")}`,
    );
  }
  const created = await prisma.supplier.create({ data });
  revalidatePath("/suppliers");
  redirect(`/suppliers/${created.id}?saved=1`);
}

export async function updateSupplier(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const data = readForm(formData);
  if (!data.companyName) {
    redirect(
      `/suppliers/${id}?error=${encodeURIComponent("取引先会社名は必須です")}`,
    );
  }

  await prisma.supplier.update({ where: { id }, data });
  revalidatePath(`/suppliers/${id}`);
  revalidatePath("/suppliers");
  redirect(`/suppliers/${id}?saved=1`);
}
