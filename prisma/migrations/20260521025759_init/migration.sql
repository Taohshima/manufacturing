-- CreateEnum
CREATE TYPE "Division" AS ENUM ('RAW', 'PACKAGING', 'PRODUCT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PLANNED', 'ORDERED', 'ARRIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManufacturingOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockTransactionReason" AS ENUM ('PURCHASE_ARRIVAL', 'MANUFACTURING_USE', 'INVENTORY_ADJUST', 'MANUAL');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('OK', 'NG');

-- CreateEnum
CREATE TYPE "ShipmentDecisionStatus" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('YES_OK', 'YES_NG', 'NO');

-- CreateEnum
CREATE TYPE "SuitabilityState" AS ENUM ('YES_FIT', 'YES_UNFIT', 'NO');

-- CreateEnum
CREATE TYPE "ExistenceState" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "TestJudgment" AS ENUM ('OK', 'NG');

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "division" "Division" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "companyName" TEXT NOT NULL,
    "officeName" TEXT,
    "postalCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "websiteUrl" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "orderMethod" TEXT,
    "paymentMethod" TEXT,
    "paymentDay" INTEGER,
    "paymentDivision" TEXT,
    "paymentSite" TEXT,
    "searchLabel" TEXT,
    "alias" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "purchasePrice" DECIMAL(14,4),
    "stockQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lastInventoryDate" DATE,
    "supplierId" INTEGER,
    "consignedQty" DECIMAL(14,4),
    "consignedOwner" TEXT,
    "notes" TEXT,
    "storageLocation" TEXT,
    "division" "Division" NOT NULL,
    "docUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "salesName" TEXT NOT NULL,
    "genericName" TEXT,
    "standardNo" TEXT,
    "capacity" DECIMAL(14,4) NOT NULL,
    "capacityUnit" TEXT NOT NULL,
    "controlDivision" TEXT,
    "expiryMonths" INTEGER,
    "caseCount" INTEGER,
    "storageLocation" TEXT,
    "salesPrice" DECIMAL(14,2),
    "productCost" DECIMAL(14,2),
    "stockQty" DECIMAL(14,4),
    "lastInventoryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipe" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "usageQty" DECIMAL(14,4) NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "orderedAt" DATE,
    "orderedQty" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "expectedArrivalAt" DATE,
    "arrivedAt" DATE,
    "arrivedQty" DECIMAL(14,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingOrder" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderedAt" DATE,
    "instructedAt" DATE NOT NULL,
    "scheduledAt" DATE,
    "plannedQty" DECIMAL(14,4) NOT NULL,
    "lotNumber" TEXT,
    "standardNo" TEXT,
    "instructor" TEXT,
    "status" "ManufacturingOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "weighingDate" DATE,
    "temperature" DECIMAL(5,2),
    "humidity" DECIMAL(5,2),
    "mixedAt" DATE,
    "mixStartTime" TEXT,
    "mixEndTime" TEXT,
    "mixWorker" TEXT,
    "mixNotes" TEXT,
    "filledAt" DATE,
    "fillUnitVolume" DECIMAL(14,4),
    "fillUnit" TEXT,
    "fillCount" INTEGER,
    "fillMissCount" INTEGER,
    "containerCheck" "CheckResult",
    "fillWorker" TEXT,
    "packagedAt" DATE,
    "cardboardSize" TEXT,
    "packagingWorker" TEXT,
    "packagingCheck" "CheckResult",
    "lotCheck" "CheckResult",
    "completedQty" DECIMAL(14,4),
    "sampleQty" DECIMAL(14,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingOrderIngredient" (
    "id" SERIAL NOT NULL,
    "manufacturingOrderId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "perUnitQty" DECIMAL(14,4) NOT NULL,
    "perUnitUnit" TEXT NOT NULL,
    "plannedQty" DECIMAL(14,4) NOT NULL,
    "actualQty" DECIMAL(14,4),
    "materialLotNumber" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingOrderIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingOrderPackaging" (
    "id" SERIAL NOT NULL,
    "manufacturingOrderId" INTEGER NOT NULL,
    "materialId" INTEGER,
    "materialName" TEXT NOT NULL,
    "materialCode" TEXT,
    "usedQty" DECIMAL(14,4),
    "remainingQty" DECIMAL(14,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingOrderPackaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" SERIAL NOT NULL,
    "materialId" INTEGER NOT NULL,
    "occurredAt" DATE NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "reason" "StockTransactionReason" NOT NULL,
    "notes" TEXT,
    "purchaseOrderId" INTEGER,
    "manufacturingOrderId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingSite" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "permitDate" DATE,
    "permitNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EfficacyClaim" (
    "id" SERIAL NOT NULL,
    "no" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "EfficacyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandard" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "controlNumber" TEXT NOT NULL,
    "establishedAt" DATE,
    "establishedBy" TEXT,
    "productCategory" TEXT,
    "manufacturer" TEXT,
    "manufacturerAddr" TEXT,
    "permitDate" DATE,
    "permitNumber" TEXT,
    "notificationType" TEXT,
    "pkgCapacity" TEXT,
    "pkgColorCode" TEXT,
    "pkgManufacturerContact" TEXT,
    "pkgDistributorContact" TEXT,
    "pkgAllIngredients" TEXT,
    "pkgUsageMethod" TEXT,
    "pkgUsageNotes" TEXT,
    "pkgIdentification" TEXT,
    "pkgOther" TEXT,
    "pkgNotes" TEXT,
    "spFillVolume" TEXT,
    "spLotPrinter" TEXT,
    "spLotText" TEXT,
    "spCardboardSize" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardRevision" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "revisionNumber" TEXT NOT NULL,
    "revisedAt" DATE,
    "reason" TEXT,
    "changes" TEXT,
    "revisedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityStandardRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardIngredient" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "no" INTEGER NOT NULL,
    "rawMaterialName" TEXT,
    "amountPercent" DECIMAL(8,4),
    "componentName" TEXT,
    "complexPercent" DECIMAL(8,4),
    "spec" TEXT,
    "portion" DECIMAL(8,4),
    "rank" INTEGER,

    CONSTRAINT "QualityStandardIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardMethodStep" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "QualityStandardMethodStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardProcess" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "manufacturingSiteId" INTEGER,
    "process" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityStandardProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardTestSpec" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "testItem" TEXT NOT NULL,
    "spec" TEXT,
    "method" TEXT,
    "frequency" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityStandardTestSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardWorkNote" (
    "id" SERIAL NOT NULL,
    "qualityStandardId" INTEGER NOT NULL,
    "workName" TEXT NOT NULL,
    "content" TEXT,
    "photoUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityStandardWorkNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityStandardEfficacy" (
    "qualityStandardId" INTEGER NOT NULL,
    "efficacyClaimId" INTEGER NOT NULL,

    CONSTRAINT "QualityStandardEfficacy_pkey" PRIMARY KEY ("qualityStandardId","efficacyClaimId")
);

-- CreateTable
CREATE TABLE "ShipmentDecision" (
    "id" SERIAL NOT NULL,
    "manufacturingOrderId" INTEGER NOT NULL,
    "check1ManufacturerDecisionRecord" "ApprovalState",
    "check2TestReport" "SuitabilityState",
    "check3ProductQualityInfo" "ExistenceState",
    "check4MaterialQualityInfo" "ExistenceState",
    "check5DeviationCheck" "ApprovalState",
    "specialNotes" TEXT,
    "decision" "ShipmentDecisionStatus" NOT NULL,
    "decidedAt" DATE,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "manufacturingOrderId" INTEGER NOT NULL,
    "shipmentDecisionId" INTEGER,
    "decisionDate" DATE,
    "decision" "ShipmentDecisionStatus",
    "shippedAt" DATE,
    "destination" TEXT,
    "shippedQty" DECIMAL(14,4),
    "remainingStock" DECIMAL(14,4),
    "notes" TEXT,
    "confirmedAt" DATE,
    "confirmedBy" TEXT,
    "specialNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestInspectionRecord" (
    "id" SERIAL NOT NULL,
    "manufacturingOrderId" INTEGER NOT NULL,
    "testDate" DATE,
    "testedBy" TEXT,
    "temperature" DECIMAL(5,2),
    "humidity" DECIMAL(5,2),
    "overallResult" "TestJudgment",
    "judgedBy" TEXT,
    "chiefTechnician" TEXT,
    "qaResponsible" TEXT,
    "confirmedAt" DATE,
    "isSimplified" BOOLEAN NOT NULL DEFAULT false,
    "simplifiedNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestInspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestInspectionItem" (
    "id" SERIAL NOT NULL,
    "testInspectionRecordId" INTEGER NOT NULL,
    "testItem" TEXT NOT NULL,
    "spec" TEXT,
    "result" TEXT,
    "judgment" "TestJudgment",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestInspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_division_name_key" ON "Category"("division", "name");

-- CreateIndex
CREATE INDEX "Material_name_idx" ON "Material"("name");

-- CreateIndex
CREATE INDEX "Material_categoryId_idx" ON "Material"("categoryId");

-- CreateIndex
CREATE INDEX "Product_salesName_idx" ON "Product"("salesName");

-- CreateIndex
CREATE INDEX "ProductRecipe_productId_idx" ON "ProductRecipe"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_productId_materialId_key" ON "ProductRecipe"("productId", "materialId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_materialId_idx" ON "PurchaseOrder"("materialId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_expectedArrivalAt_idx" ON "PurchaseOrder"("status", "expectedArrivalAt");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_productId_idx" ON "ManufacturingOrder"("productId");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_status_scheduledAt_idx" ON "ManufacturingOrder"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ManufacturingOrder_instructedAt_idx" ON "ManufacturingOrder"("instructedAt");

-- CreateIndex
CREATE INDEX "ManufacturingOrderIngredient_manufacturingOrderId_idx" ON "ManufacturingOrderIngredient"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "ManufacturingOrderPackaging_manufacturingOrderId_idx" ON "ManufacturingOrderPackaging"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "StockTransaction_materialId_occurredAt_idx" ON "StockTransaction"("materialId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockTransaction_reason_idx" ON "StockTransaction"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "EfficacyClaim_no_key" ON "EfficacyClaim"("no");

-- CreateIndex
CREATE UNIQUE INDEX "QualityStandard_productId_key" ON "QualityStandard"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityStandard_controlNumber_key" ON "QualityStandard"("controlNumber");

-- CreateIndex
CREATE INDEX "QualityStandardRevision_qualityStandardId_idx" ON "QualityStandardRevision"("qualityStandardId");

-- CreateIndex
CREATE INDEX "QualityStandardIngredient_qualityStandardId_idx" ON "QualityStandardIngredient"("qualityStandardId");

-- CreateIndex
CREATE INDEX "QualityStandardMethodStep_qualityStandardId_idx" ON "QualityStandardMethodStep"("qualityStandardId");

-- CreateIndex
CREATE INDEX "QualityStandardProcess_qualityStandardId_idx" ON "QualityStandardProcess"("qualityStandardId");

-- CreateIndex
CREATE INDEX "QualityStandardTestSpec_qualityStandardId_idx" ON "QualityStandardTestSpec"("qualityStandardId");

-- CreateIndex
CREATE INDEX "QualityStandardWorkNote_qualityStandardId_idx" ON "QualityStandardWorkNote"("qualityStandardId");

-- CreateIndex
CREATE INDEX "ShipmentDecision_manufacturingOrderId_idx" ON "ShipmentDecision"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "ShipmentDecision_decidedAt_idx" ON "ShipmentDecision"("decidedAt");

-- CreateIndex
CREATE INDEX "Shipment_manufacturingOrderId_idx" ON "Shipment"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "Shipment_shippedAt_idx" ON "Shipment"("shippedAt");

-- CreateIndex
CREATE INDEX "TestInspectionRecord_manufacturingOrderId_idx" ON "TestInspectionRecord"("manufacturingOrderId");

-- CreateIndex
CREATE INDEX "TestInspectionItem_testInspectionRecordId_idx" ON "TestInspectionItem"("testInspectionRecordId");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrderIngredient" ADD CONSTRAINT "ManufacturingOrderIngredient_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrderIngredient" ADD CONSTRAINT "ManufacturingOrderIngredient_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrderPackaging" ADD CONSTRAINT "ManufacturingOrderPackaging_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingOrderPackaging" ADD CONSTRAINT "ManufacturingOrderPackaging_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandard" ADD CONSTRAINT "QualityStandard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardRevision" ADD CONSTRAINT "QualityStandardRevision_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardIngredient" ADD CONSTRAINT "QualityStandardIngredient_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardMethodStep" ADD CONSTRAINT "QualityStandardMethodStep_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardProcess" ADD CONSTRAINT "QualityStandardProcess_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardProcess" ADD CONSTRAINT "QualityStandardProcess_manufacturingSiteId_fkey" FOREIGN KEY ("manufacturingSiteId") REFERENCES "ManufacturingSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardTestSpec" ADD CONSTRAINT "QualityStandardTestSpec_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardWorkNote" ADD CONSTRAINT "QualityStandardWorkNote_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardEfficacy" ADD CONSTRAINT "QualityStandardEfficacy_qualityStandardId_fkey" FOREIGN KEY ("qualityStandardId") REFERENCES "QualityStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityStandardEfficacy" ADD CONSTRAINT "QualityStandardEfficacy_efficacyClaimId_fkey" FOREIGN KEY ("efficacyClaimId") REFERENCES "EfficacyClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDecision" ADD CONSTRAINT "ShipmentDecision_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_shipmentDecisionId_fkey" FOREIGN KEY ("shipmentDecisionId") REFERENCES "ShipmentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestInspectionRecord" ADD CONSTRAINT "TestInspectionRecord_manufacturingOrderId_fkey" FOREIGN KEY ("manufacturingOrderId") REFERENCES "ManufacturingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestInspectionItem" ADD CONSTRAINT "TestInspectionItem_testInspectionRecordId_fkey" FOREIGN KEY ("testInspectionRecordId") REFERENCES "TestInspectionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
