import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { csvBody, csvResponse, todayStamp } from "@/lib/csv-export";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const where: Prisma.SupplierWhereInput = q
    ? {
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { alias: { contains: q, mode: "insensitive" } },
          { searchLabel: { contains: q, mode: "insensitive" } },
          { officeName: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: { companyName: "asc" },
  });

  const headers = [
    "取引先会社名",
    "取引先事業所名",
    "郵便番号",
    "住所",
    "電話",
    "FAX",
    "URL",
    "発注先担当者",
    "メール",
    "発注方法",
    "支払方法",
    "支払日",
    "支払区分",
    "支払サイト",
    "検索ラベル",
    "呼称",
  ];

  const rows: (string | number | null | undefined)[][] = [headers];
  for (const s of suppliers) {
    rows.push([
      s.companyName,
      s.officeName ?? "",
      s.postalCode ?? "",
      s.address ?? "",
      s.phone ?? "",
      s.fax ?? "",
      s.websiteUrl ?? "",
      s.contactPerson ?? "",
      s.email ?? "",
      s.orderMethod ?? "",
      s.paymentMethod ?? "",
      s.paymentDay ?? "",
      s.paymentDivision ?? "",
      s.paymentSite ?? "",
      s.searchLabel ?? "",
      s.alias ?? "",
    ]);
  }

  return csvResponse(csvBody(rows), `suppliers_${todayStamp()}.csv`);
}
