import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function fmtQty(v: Prisma.Decimal | null): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  let matchedOrders: Array<
    Awaited<ReturnType<typeof prisma.manufacturingOrder.findMany>>[number] & {
      product: Awaited<ReturnType<typeof prisma.product.findFirst>>;
      ingredients: Array<
        Awaited<
          ReturnType<typeof prisma.manufacturingOrderIngredient.findMany>
        >[number] & {
          material: Awaited<ReturnType<typeof prisma.material.findFirst>>;
        }
      >;
    }
  > = [];

  const latestArrival = new Map<
    number,
    {
      occurredAt: Date;
      qty: Prisma.Decimal;
      purchaseOrder: {
        id: number;
        supplier: { id: number; companyName: string };
      } | null;
    }
  >();

  if (q) {
    matchedOrders = (await prisma.manufacturingOrder.findMany({
      where: {
        OR: [
          { lotNumber: q },
          { ingredients: { some: { materialLotNumber: q } } },
        ],
      },
      orderBy: [{ instructedAt: "desc" }, { id: "desc" }],
      include: {
        product: true,
        ingredients: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { material: true },
        },
      },
      take: 50,
    })) as unknown as typeof matchedOrders;

    const materialIds = [
      ...new Set(
        matchedOrders.flatMap((o) =>
          o.ingredients.map((i) => i.materialId),
        ),
      ),
    ];
    if (materialIds.length > 0) {
      const arrivals = await prisma.stockTransaction.findMany({
        where: {
          materialId: { in: materialIds },
          reason: "PURCHASE_ARRIVAL",
          purchaseOrderId: { not: null },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        include: { purchaseOrder: { include: { supplier: true } } },
      });
      for (const a of arrivals) {
        if (!latestArrival.has(a.materialId)) {
          latestArrival.set(a.materialId, {
            occurredAt: a.occurredAt,
            qty: a.qty,
            purchaseOrder: a.purchaseOrder
              ? {
                  id: a.purchaseOrder.id,
                  supplier: {
                    id: a.purchaseOrder.supplier.id,
                    companyName: a.purchaseOrder.supplier.companyName,
                  },
                }
              : null,
          });
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ロットトレース</h1>
        <p className="mt-1 text-sm text-slate-600">
          製品ロット番号、または原料ロット番号で検索すると、該当する製造指図と
          使用材料・直近の入荷経路を一覧します。
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-1 flex-col gap-1 text-xs text-slate-600">
          ロット番号
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="製品ロット または 原料ロット"
            className="w-80 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          検索
        </button>
        {q ? (
          <Link
            href="/trace"
            className="px-2 py-2 text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            クリア
          </Link>
        ) : null}
      </form>

      {!q ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          ロット番号を入力して検索してください。
        </div>
      ) : matchedOrders.length === 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-800">
          「{q}」に一致する製造指図が見つかりませんでした。製品ロット番号
          （ManufacturingOrder.lotNumber）または原料ロット番号
          （ManufacturingOrderIngredient.materialLotNumber）で検索します。
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            該当：{matchedOrders.length} 件
          </p>
          {matchedOrders.map((o) => (
            <div
              key={o.id}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                <div>
                  <Link
                    href={`/manufacturing-orders/${o.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    指図 #{o.id} ／ {o.product?.salesName}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">
                    {o.lotNumber === q ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                        製品ロット一致
                      </span>
                    ) : null}
                    {o.lotNumber && o.lotNumber !== q
                      ? ` ロット ${o.lotNumber}`
                      : ""}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  指図日 {fmtDate(o.instructedAt)} ／ 予定日{" "}
                  {fmtDate(o.scheduledAt)}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">原料</th>
                      <th className="px-3 py-2 text-right font-medium">
                        指図量
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        秤量実績
                      </th>
                      <th className="px-3 py-2 font-medium">原料ロット番号</th>
                      <th className="px-3 py-2 font-medium">直近の入荷</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.ingredients.map((ing) => {
                      const matchLot =
                        ing.materialLotNumber && ing.materialLotNumber === q;
                      const arrival = latestArrival.get(ing.materialId);
                      return (
                        <tr
                          key={ing.id}
                          className={`border-t border-slate-100 ${matchLot ? "bg-emerald-50" : ""}`}
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/materials/${ing.materialId}`}
                              className="font-medium text-slate-900 hover:underline"
                            >
                              {ing.material?.name}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
                            {fmtQty(ing.plannedQty)} {ing.perUnitUnit}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {fmtQty(ing.actualQty)}{" "}
                            {ing.actualQty != null ? ing.perUnitUnit : ""}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {ing.materialLotNumber ?? (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                            {matchLot ? (
                              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                                一致
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {arrival ? (
                              <span>
                                {fmtDate(arrival.occurredAt)}{" "}
                                {arrival.purchaseOrder ? (
                                  <>
                                    →{" "}
                                    <Link
                                      href={`/purchase-orders/${arrival.purchaseOrder.id}`}
                                      className="text-slate-700 hover:underline"
                                    >
                                      発注#{arrival.purchaseOrder.id}
                                    </Link>{" "}
                                    （{arrival.purchaseOrder.supplier.companyName}）
                                  </>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">
                                入荷記録なし
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
