"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TestJudgment } from "@prisma/client";

function textOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
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
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseJudgment(v: FormDataEntryValue | null): TestJudgment | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "OK" || s === "NG") return s;
  return null;
}

export async function createTestRecord(formData: FormData) {
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(manufacturingOrderId)) throw new Error("invalid order id");

  const copyFromQs = formData.get("copyFromQs") === "on";
  const isSimplified = formData.get("isSimplified") === "on";

  // 必要に応じて QS の testSpecs を取得して試験項目をコピー
  let itemsCreate:
    | { testItem: string; spec: string | null; sortOrder: number }[]
    | undefined;
  if (copyFromQs && !isSimplified) {
    const order = await prisma.manufacturingOrder.findUnique({
      where: { id: manufacturingOrderId },
      include: {
        product: {
          include: {
            qualityStandard: {
              include: {
                testSpecs: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
              },
            },
          },
        },
      },
    });
    const specs = order?.product.qualityStandard?.testSpecs ?? [];
    if (specs.length > 0) {
      itemsCreate = specs.map((s) => ({
        testItem: s.testItem,
        spec: s.spec,
        sortOrder: s.sortOrder,
      }));
    }
  }

  const created = await prisma.testInspectionRecord.create({
    data: {
      manufacturingOrderId,
      testDate: dateOrNull(formData.get("testDate")),
      testedBy: textOrNull(formData.get("testedBy")),
      temperature: decOrNull(formData.get("temperature")),
      humidity: decOrNull(formData.get("humidity")),
      isSimplified,
      simplifiedNote: textOrNull(formData.get("simplifiedNote")),
      ...(itemsCreate ? { items: { create: itemsCreate } } : {}),
    },
  });

  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(
    `/manufacturing-orders/${manufacturingOrderId}/test-records/${created.id}?created=1`,
  );
}

export async function updateTestRecord(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.testInspectionRecord.update({
    where: { id },
    data: {
      testDate: dateOrNull(formData.get("testDate")),
      testedBy: textOrNull(formData.get("testedBy")),
      temperature: decOrNull(formData.get("temperature")),
      humidity: decOrNull(formData.get("humidity")),
      overallResult: parseJudgment(formData.get("overallResult")),
      judgedBy: textOrNull(formData.get("judgedBy")),
      chiefTechnician: textOrNull(formData.get("chiefTechnician")),
      qaResponsible: textOrNull(formData.get("qaResponsible")),
      confirmedAt: dateOrNull(formData.get("confirmedAt")),
      isSimplified: formData.get("isSimplified") === "on",
      simplifiedNote: textOrNull(formData.get("simplifiedNote")),
      notes: textOrNull(formData.get("notes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}/test-records/${id}`);
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(
    `/manufacturing-orders/${manufacturingOrderId}/test-records/${id}?saved=1`,
  );
}

export async function deleteTestRecord(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.testInspectionRecord.delete({ where: { id } });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

// 試験項目 ----------------------------------------------------------------

function ids(formData: FormData) {
  const trId = Number(formData.get("trId"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : undefined;
  if (!Number.isFinite(trId) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid ids");
  }
  return { trId, manufacturingOrderId, id };
}

function doneItem(orderId: number, trId: number) {
  revalidatePath(`/manufacturing-orders/${orderId}/test-records/${trId}`);
  redirect(`/manufacturing-orders/${orderId}/test-records/${trId}?saved=1`);
}

export async function addTestItem(formData: FormData) {
  const { trId, manufacturingOrderId } = ids(formData);
  await prisma.testInspectionItem.create({
    data: {
      testInspectionRecordId: trId,
      testItem: String(formData.get("testItem") ?? "").trim(),
      spec: textOrNull(formData.get("spec")),
      result: textOrNull(formData.get("result")),
      judgment: parseJudgment(formData.get("judgment")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  doneItem(manufacturingOrderId, trId);
}

export async function updateTestItem(formData: FormData) {
  const { trId, manufacturingOrderId, id } = ids(formData);
  await prisma.testInspectionItem.update({
    where: { id: id! },
    data: {
      testItem: String(formData.get("testItem") ?? "").trim(),
      spec: textOrNull(formData.get("spec")),
      result: textOrNull(formData.get("result")),
      judgment: parseJudgment(formData.get("judgment")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  doneItem(manufacturingOrderId, trId);
}

export async function deleteTestItem(formData: FormData) {
  const { trId, manufacturingOrderId, id } = ids(formData);
  await prisma.testInspectionItem.delete({ where: { id: id! } });
  doneItem(manufacturingOrderId, trId);
}
