"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  ApprovalState,
  CheckResult,
  ExistenceState,
  ShipmentDecisionStatus,
  SuitabilityState,
} from "@prisma/client";

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

function dateOrNull(v: FormDataEntryValue | null): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function checkOrNull(v: FormDataEntryValue | null): CheckResult | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "OK") return "OK";
  if (s === "NG") return "NG";
  return null;
}

export async function updateManufacturingOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const plannedQty = decOrNull(formData.get("plannedQty"));
  const instructedAt = dateOrNull(formData.get("instructedAt"));
  if (plannedQty == null || instructedAt == null) {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("製造数量と指図年月日は必須です")}`,
    );
  }

  await prisma.manufacturingOrder.update({
    where: { id },
    data: {
      instructedAt,
      scheduledAt: dateOrNull(formData.get("scheduledAt")),
      orderedAt: dateOrNull(formData.get("orderedAt")),
      plannedQty,
      lotNumber: textOrNull(formData.get("lotNumber")),
      standardNo: textOrNull(formData.get("standardNo")),
      instructor: textOrNull(formData.get("instructor")),
      notes: textOrNull(formData.get("notes")),

      // 秤量
      weighingDate: dateOrNull(formData.get("weighingDate")),
      temperature: decOrNull(formData.get("temperature")),
      humidity: decOrNull(formData.get("humidity")),

      // 混合
      mixedAt: dateOrNull(formData.get("mixedAt")),
      mixStartTime: textOrNull(formData.get("mixStartTime")),
      mixEndTime: textOrNull(formData.get("mixEndTime")),
      mixWorker: textOrNull(formData.get("mixWorker")),
      mixNotes: textOrNull(formData.get("mixNotes")),

      // 充填
      filledAt: dateOrNull(formData.get("filledAt")),
      fillUnitVolume: decOrNull(formData.get("fillUnitVolume")),
      fillUnit: textOrNull(formData.get("fillUnit")),
      fillCount: intOrNull(formData.get("fillCount")),
      fillMissCount: intOrNull(formData.get("fillMissCount")),
      containerCheck: checkOrNull(formData.get("containerCheck")),
      fillWorker: textOrNull(formData.get("fillWorker")),

      // 包装
      packagedAt: dateOrNull(formData.get("packagedAt")),
      cardboardSize: textOrNull(formData.get("cardboardSize")),
      packagingWorker: textOrNull(formData.get("packagingWorker")),
      packagingCheck: checkOrNull(formData.get("packagingCheck")),
      lotCheck: checkOrNull(formData.get("lotCheck")),
      completedQty: decOrNull(formData.get("completedQty")),
      sampleQty: decOrNull(formData.get("sampleQty")),
    },
  });

  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function setStatusInProgress(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.manufacturingOrder.update({
    where: { id },
    data: { status: "IN_PROGRESS" },
  });
  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function updateIngredient(formData: FormData) {
  const id = Number(formData.get("id"));
  const orderId = Number(formData.get("orderId"));
  if (!Number.isFinite(id) || !Number.isFinite(orderId)) {
    throw new Error("invalid id");
  }
  await prisma.manufacturingOrderIngredient.update({
    where: { id },
    data: {
      actualQty: decOrNull(formData.get("actualQty")),
      materialLotNumber: textOrNull(formData.get("materialLotNumber")),
      checked: formData.get("checked") === "on",
      notes: textOrNull(formData.get("notes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${orderId}`);
  redirect(`/manufacturing-orders/${orderId}?saved=1`);
}

export async function completeOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const occurredAt = dateOrNull(formData.get("occurredAt")) ?? new Date();

  await prisma.$transaction(async (tx) => {
    const order = await tx.manufacturingOrder.findUnique({
      where: { id },
      include: { ingredients: true },
    });
    if (!order) throw new Error("not found");
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new Error(
        `この指図は ${order.status === "COMPLETED" ? "完了" : "キャンセル"} 済のため、完了処理できません`,
      );
    }

    // 各原料を消費（actualQty 優先、なければ plannedQty）
    for (const ing of order.ingredients) {
      const consumedStr = ing.actualQty != null ? ing.actualQty : ing.plannedQty;
      const consumed = Number(consumedStr);
      if (consumed === 0) continue;
      await tx.stockTransaction.create({
        data: {
          materialId: ing.materialId,
          occurredAt,
          qty: (-consumed).toString(),
          reason: "MANUFACTURING_USE",
          manufacturingOrderId: id,
          notes: `製造指図#${id} で消費`,
        },
      });
      const m = await tx.material.findUnique({ where: { id: ing.materialId } });
      if (!m) continue;
      const newQty = Number(m.stockQty) - consumed;
      await tx.material.update({
        where: { id: ing.materialId },
        data: { stockQty: newQty.toString() },
      });
    }

    // 製品在庫を増やす（完成数量 優先、なければ予定数量）
    const producedStr =
      order.completedQty != null ? order.completedQty : order.plannedQty;
    const produced = Number(producedStr);
    if (produced > 0) {
      const product = await tx.product.findUnique({ where: { id: order.productId } });
      if (product) {
        const currentStock = product.stockQty != null ? Number(product.stockQty) : 0;
        await tx.product.update({
          where: { id: product.id },
          data: { stockQty: (currentStock + produced).toString() },
        });
      }
    }

    await tx.manufacturingOrder.update({
      where: { id },
      data: { status: "COMPLETED" },
    });
  });

  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  revalidatePath("/materials");
  revalidatePath("/products");
  redirect(`/manufacturing-orders/${id}?completed=1`);
}

export async function cancelOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  await prisma.manufacturingOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  revalidatePath(`/manufacturing-orders/${id}`);
  revalidatePath("/manufacturing-orders");
  redirect(`/manufacturing-orders/${id}?saved=1`);
}

export async function deleteOrder(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");
  const order = await prisma.manufacturingOrder.findUnique({ where: { id } });
  if (!order) redirect("/manufacturing-orders");
  if (order!.status !== "PLANNED") {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("進行中・完了・キャンセルの指図は削除できません")}`,
    );
  }
  try {
    await prisma.manufacturingOrder.delete({ where: { id } });
  } catch {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("関連データのため削除できません")}`,
    );
  }
  revalidatePath("/manufacturing-orders");
  redirect("/manufacturing-orders");
}

// ─────────────────────────────────────────────────────────────
// 出荷可否決定通知（様式1-1）
// ─────────────────────────────────────────────────────────────

function parseApproval(v: FormDataEntryValue | null): ApprovalState | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "YES_OK" || s === "YES_NG" || s === "NO") return s;
  return null;
}
function parseSuitability(v: FormDataEntryValue | null): SuitabilityState | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "YES_FIT" || s === "YES_UNFIT" || s === "NO") return s;
  return null;
}
function parseExistence(v: FormDataEntryValue | null): ExistenceState | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "YES" || s === "NO") return s;
  return null;
}
function parseDecision(v: FormDataEntryValue | null): ShipmentDecisionStatus {
  const s = v == null ? "" : String(v).trim();
  return s === "REJECTED" ? "REJECTED" : "APPROVED";
}

export async function createShipmentDecision(formData: FormData) {
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(manufacturingOrderId)) throw new Error("invalid order id");
  await prisma.shipmentDecision.create({
    data: {
      manufacturingOrderId,
      decision: parseDecision(formData.get("decision")),
      decidedAt: dateOrNull(formData.get("decidedAt")),
      decidedBy: textOrNull(formData.get("decidedBy")),
      check1ManufacturerDecisionRecord: parseApproval(
        formData.get("check1ManufacturerDecisionRecord"),
      ),
      check2TestReport: parseSuitability(formData.get("check2TestReport")),
      check3ProductQualityInfo: parseExistence(
        formData.get("check3ProductQualityInfo"),
      ),
      check4MaterialQualityInfo: parseExistence(
        formData.get("check4MaterialQualityInfo"),
      ),
      check5DeviationCheck: parseApproval(formData.get("check5DeviationCheck")),
      specialNotes: textOrNull(formData.get("specialNotes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

export async function updateShipmentDecision(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.shipmentDecision.update({
    where: { id },
    data: {
      decision: parseDecision(formData.get("decision")),
      decidedAt: dateOrNull(formData.get("decidedAt")),
      decidedBy: textOrNull(formData.get("decidedBy")),
      check1ManufacturerDecisionRecord: parseApproval(
        formData.get("check1ManufacturerDecisionRecord"),
      ),
      check2TestReport: parseSuitability(formData.get("check2TestReport")),
      check3ProductQualityInfo: parseExistence(
        formData.get("check3ProductQualityInfo"),
      ),
      check4MaterialQualityInfo: parseExistence(
        formData.get("check4MaterialQualityInfo"),
      ),
      check5DeviationCheck: parseApproval(formData.get("check5DeviationCheck")),
      specialNotes: textOrNull(formData.get("specialNotes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

export async function deleteShipmentDecision(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.shipmentDecision.delete({ where: { id } });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

// ─────────────────────────────────────────────────────────────
// 市場出荷記録（様式1-2）
// ─────────────────────────────────────────────────────────────

function parseDecisionOptional(
  v: FormDataEntryValue | null,
): ShipmentDecisionStatus | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "APPROVED" || s === "REJECTED") return s;
  return null;
}

export async function addShipment(formData: FormData) {
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(manufacturingOrderId)) throw new Error("invalid order id");
  const sdIdRaw = formData.get("shipmentDecisionId");
  const shipmentDecisionId =
    sdIdRaw && String(sdIdRaw).trim() !== "" ? Number(sdIdRaw) : null;
  await prisma.shipment.create({
    data: {
      manufacturingOrderId,
      shipmentDecisionId:
        shipmentDecisionId && Number.isFinite(shipmentDecisionId)
          ? shipmentDecisionId
          : null,
      decisionDate: dateOrNull(formData.get("decisionDate")),
      decision: parseDecisionOptional(formData.get("decision")),
      shippedAt: dateOrNull(formData.get("shippedAt")),
      destination: textOrNull(formData.get("destination")),
      shippedQty: decOrNull(formData.get("shippedQty")),
      remainingStock: decOrNull(formData.get("remainingStock")),
      notes: textOrNull(formData.get("notes")),
      confirmedAt: dateOrNull(formData.get("confirmedAt")),
      confirmedBy: textOrNull(formData.get("confirmedBy")),
      specialNotes: textOrNull(formData.get("specialNotes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

export async function updateShipment(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  const sdIdRaw = formData.get("shipmentDecisionId");
  const shipmentDecisionId =
    sdIdRaw && String(sdIdRaw).trim() !== "" ? Number(sdIdRaw) : null;
  await prisma.shipment.update({
    where: { id },
    data: {
      shipmentDecisionId:
        shipmentDecisionId && Number.isFinite(shipmentDecisionId)
          ? shipmentDecisionId
          : null,
      decisionDate: dateOrNull(formData.get("decisionDate")),
      decision: parseDecisionOptional(formData.get("decision")),
      shippedAt: dateOrNull(formData.get("shippedAt")),
      destination: textOrNull(formData.get("destination")),
      shippedQty: decOrNull(formData.get("shippedQty")),
      remainingStock: decOrNull(formData.get("remainingStock")),
      notes: textOrNull(formData.get("notes")),
      confirmedAt: dateOrNull(formData.get("confirmedAt")),
      confirmedBy: textOrNull(formData.get("confirmedBy")),
      specialNotes: textOrNull(formData.get("specialNotes")),
    },
  });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

export async function deleteShipment(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.shipment.delete({ where: { id } });
  revalidatePath(`/manufacturing-orders/${manufacturingOrderId}`);
  redirect(`/manufacturing-orders/${manufacturingOrderId}?saved=1`);
}

// ─────────────────────────────────────────────────────────────
// 包装表示行（ManufacturingOrderPackaging）
// ─────────────────────────────────────────────────────────────

function packagingDone(orderId: number) {
  revalidatePath(`/manufacturing-orders/${orderId}`);
  redirect(`/manufacturing-orders/${orderId}?saved=1`);
}

export async function addPackaging(formData: FormData) {
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(manufacturingOrderId)) throw new Error("invalid order id");
  const materialIdRaw = formData.get("materialId");
  const materialId =
    materialIdRaw && String(materialIdRaw).trim() !== "" ? Number(materialIdRaw) : null;
  await prisma.manufacturingOrderPackaging.create({
    data: {
      manufacturingOrderId,
      materialId: materialId && Number.isFinite(materialId) ? materialId : null,
      materialName: String(formData.get("materialName") ?? "").trim(),
      materialCode: textOrNull(formData.get("materialCode")),
      usedQty: decOrNull(formData.get("usedQty")),
      remainingQty: decOrNull(formData.get("remainingQty")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
      notes: textOrNull(formData.get("notes")),
    },
  });
  packagingDone(manufacturingOrderId);
}

export async function updatePackaging(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  const materialIdRaw = formData.get("materialId");
  const materialId =
    materialIdRaw && String(materialIdRaw).trim() !== "" ? Number(materialIdRaw) : null;
  await prisma.manufacturingOrderPackaging.update({
    where: { id },
    data: {
      materialId: materialId && Number.isFinite(materialId) ? materialId : null,
      materialName: String(formData.get("materialName") ?? "").trim(),
      materialCode: textOrNull(formData.get("materialCode")),
      usedQty: decOrNull(formData.get("usedQty")),
      remainingQty: decOrNull(formData.get("remainingQty")),
      sortOrder: intOrNull(formData.get("sortOrder")) ?? 0,
      notes: textOrNull(formData.get("notes")),
    },
  });
  packagingDone(manufacturingOrderId);
}

export async function deletePackaging(formData: FormData) {
  const id = Number(formData.get("id"));
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(id) || !Number.isFinite(manufacturingOrderId)) {
    throw new Error("invalid id");
  }
  await prisma.manufacturingOrderPackaging.delete({ where: { id } });
  packagingDone(manufacturingOrderId);
}

// 配合(BOM)の包装資材 (Material.division=PACKAGING) を ManufacturingOrderPackaging へコピー
// 既に登録済みの materialId はスキップする。
export async function populatePackagingFromBom(formData: FormData) {
  const manufacturingOrderId = Number(formData.get("manufacturingOrderId"));
  if (!Number.isFinite(manufacturingOrderId)) throw new Error("invalid order id");

  const order = await prisma.manufacturingOrder.findUnique({
    where: { id: manufacturingOrderId },
    include: {
      ingredients: { include: { material: true } },
      packagingItems: true,
    },
  });
  if (!order) {
    redirect(`/manufacturing-orders/${manufacturingOrderId}?error=not_found`);
  }

  const existingMaterialIds = new Set(
    order!.packagingItems
      .map((p) => p.materialId)
      .filter((v): v is number => v != null),
  );
  const targets = order!.ingredients.filter(
    (ing) =>
      ing.material.division === "PACKAGING" &&
      !existingMaterialIds.has(ing.materialId),
  );

  if (targets.length === 0) {
    redirect(
      `/manufacturing-orders/${manufacturingOrderId}?error=${encodeURIComponent("BOMに未取込の包装資材がありません")}`,
    );
  }

  await prisma.manufacturingOrderPackaging.createMany({
    data: targets.map((ing, i) => ({
      manufacturingOrderId,
      materialId: ing.materialId,
      materialName: ing.material.name,
      sortOrder: ing.sortOrder ?? i,
    })),
  });
  packagingDone(manufacturingOrderId);
}

// ─────────────────────────────────────────────────────────────
// 指図の配合(BOM)を製品マスタの最新BOMから再同期
// PLANNED/IN_PROGRESSの指図のみ可。秤量実績(actualQty)や原料ロットがある行は
// 削除対象になっても保持する（実績データ保護）。
// ─────────────────────────────────────────────────────────────
export async function syncBomFromProduct(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) throw new Error("invalid id");

  const order = await prisma.manufacturingOrder.findUnique({
    where: { id },
    include: {
      product: {
        include: {
          recipes: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            include: { material: true },
          },
        },
      },
      ingredients: true,
    },
  });
  if (!order) {
    redirect("/manufacturing-orders");
  }

  if (order!.status !== "PLANNED" && order!.status !== "IN_PROGRESS") {
    redirect(
      `/manufacturing-orders/${id}?error=${encodeURIComponent("完了・キャンセル済の指図は再同期できません")}`,
    );
  }

  const plannedQtyN = Number(order!.plannedQty);
  const recipeMap = new Map(order!.product.recipes.map((r) => [r.materialId, r]));
  const ingredientMap = new Map(order!.ingredients.map((ing) => [ing.materialId, ing]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;
  let skippedDelete = 0;

  await prisma.$transaction(async (tx) => {
    // 追加 or 更新
    for (const r of order!.product.recipes) {
      const ing = ingredientMap.get(r.materialId);
      const newPlannedQty = (Number(r.usageQty) * plannedQtyN).toString();
      if (!ing) {
        await tx.manufacturingOrderIngredient.create({
          data: {
            manufacturingOrderId: id,
            materialId: r.materialId,
            perUnitQty: r.usageQty,
            perUnitUnit: r.usageUnit,
            plannedQty: newPlannedQty,
            sortOrder: r.sortOrder,
          },
        });
        added++;
      } else {
        const changed =
          Number(ing.perUnitQty) !== Number(r.usageQty) ||
          ing.perUnitUnit !== r.usageUnit ||
          ing.sortOrder !== r.sortOrder ||
          Number(ing.plannedQty) !== Number(newPlannedQty);
        if (changed) {
          await tx.manufacturingOrderIngredient.update({
            where: { id: ing.id },
            data: {
              perUnitQty: r.usageQty,
              perUnitUnit: r.usageUnit,
              plannedQty: newPlannedQty,
              sortOrder: r.sortOrder,
            },
          });
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    // 削除（BOMから消えた材料）。実績があるものは保持
    for (const ing of order!.ingredients) {
      if (recipeMap.has(ing.materialId)) continue;
      const hasActual =
        ing.actualQty != null || ing.materialLotNumber || ing.notes || ing.checked;
      if (hasActual) {
        skippedDelete++;
      } else {
        await tx.manufacturingOrderIngredient.delete({ where: { id: ing.id } });
        removed++;
      }
    }
  });

  revalidatePath(`/manufacturing-orders/${id}`);
  const msg = `BOM同期：追加 ${added} ／ 更新 ${updated} ／ 変更なし ${unchanged} ／ 削除 ${removed}${skippedDelete > 0 ? ` ／ 実績ありのため保持 ${skippedDelete}` : ""}`;
  redirect(
    `/manufacturing-orders/${id}?bomSyncMessage=${encodeURIComponent(msg)}`,
  );
}
