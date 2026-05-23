"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
function done(qsId: number) {
  revalidatePath(`/quality-standards/${qsId}`);
  redirect(`/quality-standards/${qsId}?saved=1`);
}
function ids(formData: FormData): { qsId: number; id?: number } {
  const qsId = Number(formData.get("qsId"));
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : undefined;
  if (!Number.isFinite(qsId)) throw new Error("invalid qsId");
  return { qsId, id };
}

// ─── 改訂 ───
export async function addRevision(formData: FormData) {
  const { qsId } = ids(formData);
  await prisma.qualityStandardRevision.create({
    data: {
      qualityStandardId: qsId,
      revisionNumber: String(formData.get("revisionNumber") ?? "").trim() || "—",
      revisedAt: dateOrNull(formData.get("revisedAt")),
      reason: textOrNull(formData.get("reason")),
      changes: textOrNull(formData.get("changes")),
      revisedBy: textOrNull(formData.get("revisedBy")),
    },
  });
  done(qsId);
}
export async function updateRevision(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardRevision.update({
    where: { id: id! },
    data: {
      revisionNumber: String(formData.get("revisionNumber") ?? "").trim() || "—",
      revisedAt: dateOrNull(formData.get("revisedAt")),
      reason: textOrNull(formData.get("reason")),
      changes: textOrNull(formData.get("changes")),
      revisedBy: textOrNull(formData.get("revisedBy")),
    },
  });
  done(qsId);
}
export async function deleteRevision(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardRevision.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 成分及び配合量 ───
export async function addIngredient(formData: FormData) {
  const { qsId } = ids(formData);
  await prisma.qualityStandardIngredient.create({
    data: {
      qualityStandardId: qsId,
      no: intOrNull(formData.get("no")) ?? 0,
      rawMaterialName: textOrNull(formData.get("rawMaterialName")),
      amountPercent: decOrNull(formData.get("amountPercent")),
      componentName: textOrNull(formData.get("componentName")),
      complexPercent: decOrNull(formData.get("complexPercent")),
      spec: textOrNull(formData.get("spec")),
      portion: decOrNull(formData.get("portion")),
      rank: intOrNull(formData.get("rank")),
    },
  });
  done(qsId);
}
export async function updateIngredient(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardIngredient.update({
    where: { id: id! },
    data: {
      no: intOrNull(formData.get("no")) ?? 0,
      rawMaterialName: textOrNull(formData.get("rawMaterialName")),
      amountPercent: decOrNull(formData.get("amountPercent")),
      componentName: textOrNull(formData.get("componentName")),
      complexPercent: decOrNull(formData.get("complexPercent")),
      spec: textOrNull(formData.get("spec")),
      portion: decOrNull(formData.get("portion")),
      rank: intOrNull(formData.get("rank")),
    },
  });
  done(qsId);
}
export async function deleteIngredient(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardIngredient.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 製造方法 ───
export async function addMethodStep(formData: FormData) {
  const { qsId } = ids(formData);
  await prisma.qualityStandardMethodStep.create({
    data: {
      qualityStandardId: qsId,
      stepNo: intOrNull(formData.get("stepNo")) ?? 0,
      description: String(formData.get("description") ?? "").trim(),
    },
  });
  done(qsId);
}
export async function updateMethodStep(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardMethodStep.update({
    where: { id: id! },
    data: {
      stepNo: intOrNull(formData.get("stepNo")) ?? 0,
      description: String(formData.get("description") ?? "").trim(),
    },
  });
  done(qsId);
}
export async function deleteMethodStep(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardMethodStep.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 製造工程 ───
export async function addProcess(formData: FormData) {
  const { qsId } = ids(formData);
  const siteIdRaw = formData.get("manufacturingSiteId");
  const siteId =
    siteIdRaw && String(siteIdRaw).trim() !== "" ? Number(siteIdRaw) : null;
  await prisma.qualityStandardProcess.create({
    data: {
      qualityStandardId: qsId,
      manufacturingSiteId: siteId && Number.isFinite(siteId) ? siteId : null,
      process: textOrNull(formData.get("process")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function updateProcess(formData: FormData) {
  const { qsId, id } = ids(formData);
  const siteIdRaw = formData.get("manufacturingSiteId");
  const siteId =
    siteIdRaw && String(siteIdRaw).trim() !== "" ? Number(siteIdRaw) : null;
  await prisma.qualityStandardProcess.update({
    where: { id: id! },
    data: {
      manufacturingSiteId: siteId && Number.isFinite(siteId) ? siteId : null,
      process: textOrNull(formData.get("process")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function deleteProcess(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardProcess.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 試験規格 ───
export async function addTestSpec(formData: FormData) {
  const { qsId } = ids(formData);
  await prisma.qualityStandardTestSpec.create({
    data: {
      qualityStandardId: qsId,
      testItem: String(formData.get("testItem") ?? "").trim(),
      spec: textOrNull(formData.get("spec")),
      method: textOrNull(formData.get("method")),
      frequency: textOrNull(formData.get("frequency")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function updateTestSpec(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardTestSpec.update({
    where: { id: id! },
    data: {
      testItem: String(formData.get("testItem") ?? "").trim(),
      spec: textOrNull(formData.get("spec")),
      method: textOrNull(formData.get("method")),
      frequency: textOrNull(formData.get("frequency")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function deleteTestSpec(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardTestSpec.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 作業注意 ───
export async function addWorkNote(formData: FormData) {
  const { qsId } = ids(formData);
  await prisma.qualityStandardWorkNote.create({
    data: {
      qualityStandardId: qsId,
      workName: String(formData.get("workName") ?? "").trim(),
      content: textOrNull(formData.get("content")),
      photoUrl: textOrNull(formData.get("photoUrl")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function updateWorkNote(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardWorkNote.update({
    where: { id: id! },
    data: {
      workName: String(formData.get("workName") ?? "").trim(),
      content: textOrNull(formData.get("content")),
      photoUrl: textOrNull(formData.get("photoUrl")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
    },
  });
  done(qsId);
}
export async function deleteWorkNote(formData: FormData) {
  const { qsId, id } = ids(formData);
  await prisma.qualityStandardWorkNote.delete({ where: { id: id! } });
  done(qsId);
}

// ─── 効能効果 ───
export async function addEfficacy(formData: FormData) {
  const { qsId } = ids(formData);
  const efficacyClaimId = Number(formData.get("efficacyClaimId"));
  if (!Number.isFinite(efficacyClaimId)) done(qsId);
  try {
    await prisma.qualityStandardEfficacy.create({
      data: { qualityStandardId: qsId, efficacyClaimId },
    });
  } catch {
    // 重複は無視
  }
  done(qsId);
}
export async function deleteEfficacy(formData: FormData) {
  const { qsId } = ids(formData);
  const efficacyClaimId = Number(formData.get("efficacyClaimId"));
  if (!Number.isFinite(efficacyClaimId)) done(qsId);
  await prisma.qualityStandardEfficacy.delete({
    where: {
      qualityStandardId_efficacyClaimId: {
        qualityStandardId: qsId,
        efficacyClaimId,
      },
    },
  });
  done(qsId);
}

