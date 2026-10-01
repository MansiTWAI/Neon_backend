-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('CUSTOMER', 'STAFF', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('TEXT_NEON', 'LOGO_NEON', 'READYMADE', 'BUSINESS');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('INSTANT', 'QUOTE');

-- CreateEnum
CREATE TYPE "DesignMode" AS ENUM ('TEXT', 'LOGO');

-- CreateEnum
CREATE TYPE "AddonPricingType" AS ENUM ('FLAT', 'PER_SQFT', 'PERCENT');

-- CreateEnum
CREATE TYPE "InstallChargeType" AS ENUM ('FLAT', 'PER_SQFT');

-- CreateEnum
CREATE TYPE "RateCardStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('WEB', 'KIOSK', 'FRANCHISE_PORTAL', 'ADMIN', 'QUOTE');

-- CreateEnum
CREATE TYPE "AttributionSource" AS ENUM ('SELF_SOURCED', 'ASSIGNED', 'NONE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'EXPIRED', 'CONFIRMED', 'PROOF_PENDING', 'PROOF_APPROVED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'READY_TO_DISPATCH', 'SHIPPED', 'DELIVERED', 'INSTALLED', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('FULL', 'ADVANCE');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('FULL', 'ADVANCE', 'BALANCE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'PAYMENT_LINK', 'UPI_QR', 'OFFLINE_CASH', 'OFFLINE_UPI', 'OFFLINE_BANK');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('REQUESTED', 'IN_REVIEW', 'SENT', 'CHANGES_REQUESTED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TAX_INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "FranchiseStatus" AS ENUM ('PENDING_KYC', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('DEFAULT', 'TIER', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "CommissionRuleSource" AS ENUM ('SELF_SOURCED', 'ASSIGNED', 'ANY');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('ORDER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'APPROVED', 'PAID', 'REVERSED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('UNASSIGNED', 'SCHEDULED', 'ON_THE_WAY', 'REACHED', 'WORK_STARTED', 'COMPLETED', 'RESCHEDULED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobPhotoStage" AS ENUM ('BEFORE', 'DURING', 'AFTER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('LOGO', 'WALL', 'PROOF', 'JOB_PHOTO', 'KYC', 'PRODUCT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "type" "UserType" NOT NULL,
    "phone" VARCHAR(15),
    "email" VARCHAR(120),
    "name" VARCHAR(80),
    "passwordHash" TEXT,
    "totpSecret" BYTEA,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "franchiseId" UUID,
    "lastLoginAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(30),
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "line1" VARCHAR(160) NOT NULL,
    "line2" VARCHAR(160),
    "landmark" VARCHAR(160),
    "city" VARCHAR(80) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "gstin" VARCHAR(15),
    "businessName" VARCHAR(120),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshHash" CHAR(64) NOT NULL,
    "familyId" UUID NOT NULL,
    "userAgent" TEXT,
    "ip" VARCHAR(45),
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_devices" (
    "id" UUID NOT NULL,
    "franchiseId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "imageKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seo" JSONB,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "type" "ProductType" NOT NULL,
    "pricingMode" "PricingMode" NOT NULL DEFAULT 'INSTANT',
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "specs" JSONB,
    "defaultDesign" JSONB,
    "images" JSONB,
    "minWidthIn" DECIMAL(6,2) NOT NULL DEFAULT 12,
    "maxWidthIn" DECIMAL(6,2) NOT NULL DEFAULT 96,
    "minHeightIn" DECIMAL(6,2) NOT NULL DEFAULT 4,
    "maxHeightIn" DECIMAL(6,2) NOT NULL DEFAULT 60,
    "rateOverride" DECIMAL(12,2),
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "seo" JSONB,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fonts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "family" VARCHAR(80) NOT NULL,
    "fileKey" TEXT,
    "styleTag" VARCHAR(20) NOT NULL,
    "supportedChars" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fonts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neon_colors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "tubeHex" CHAR(7) NOT NULL,
    "glowHex" CHAR(7) NOT NULL,
    "isRgb" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neon_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backboards" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "material" VARCHAR(40) NOT NULL,
    "shape" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "imageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backgrounds" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "imageKey" TEXT,
    "pxPerInch" DECIMAL(6,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backgrounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "guestToken" VARCHAR(64),
    "productId" UUID NOT NULL,
    "mode" "DesignMode" NOT NULL,
    "config" JSONB NOT NULL,
    "widthIn" DECIMAL(6,2) NOT NULL,
    "heightIn" DECIMAL(6,2) NOT NULL,
    "areaSqft" DECIMAL(10,2) NOT NULL,
    "previewKey" TEXT,
    "tracedSvgKey" TEXT,
    "complexityScore" DECIMAL(10,2),
    "shareSlug" VARCHAR(20),
    "isSaved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID,
    "kind" "UploadKind" NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mime" VARCHAR(80) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_card_versions" (
    "id" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "RateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "notes" TEXT,
    "publishedBy" UUID,
    "publishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_card_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_card_entries" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "productType" "ProductType" NOT NULL,
    "backboardId" UUID NOT NULL,
    "ratePerSqft" DECIMAL(12,2) NOT NULL,
    "minBillableSqft" DECIMAL(6,2) NOT NULL DEFAULT 1,

    CONSTRAINT "rate_card_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "pricingType" "AddonPricingType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "appliesTo" "ProductType"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_zones" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "deliveryChargePaise" BIGINT NOT NULL DEFAULT 0,
    "freeDeliveryAbovePaise" BIGINT,
    "installAvailable" BOOLEAN NOT NULL DEFAULT false,
    "installType" "InstallChargeType" NOT NULL DEFAULT 'PER_SQFT',
    "installValuePaise" BIGINT NOT NULL DEFAULT 0,
    "deliveryDaysMin" INTEGER NOT NULL DEFAULT 5,
    "deliveryDaysMax" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_pincodes" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "pincode" CHAR(6) NOT NULL,

    CONSTRAINT "zone_pincodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pincodes" (
    "pincode" CHAR(6) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,

    CONSTRAINT "pincodes_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "maxDiscountPaise" BIGINT,
    "minOrderPaise" BIGINT,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ,
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER,
    "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false,
    "categoryIds" UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "discountPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" UUID,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "guestToken" VARCHAR(64),
    "couponId" UUID,
    "referralFranchiseId" UUID,
    "pricedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPricePaise" BIGINT NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "quoteNo" VARCHAR(20) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "customerId" UUID NOT NULL,
    "franchiseId" UUID,
    "leadId" UUID,
    "designId" UUID,
    "status" "QuotationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestDetails" JSONB,
    "subtotalPaise" BIGINT NOT NULL DEFAULT 0,
    "discountPaise" BIGINT NOT NULL DEFAULT 0,
    "taxablePaise" BIGINT NOT NULL DEFAULT 0,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMPTZ,
    "terms" TEXT,
    "notes" TEXT,
    "pdfKey" TEXT,
    "sentAt" TIMESTAMPTZ,
    "respondedAt" TIMESTAMPTZ,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "widthIn" DECIMAL(6,2),
    "heightIn" DECIMAL(6,2),
    "areaSqft" DECIMAL(10,2),
    "ratePerSqft" DECIMAL(12,2),
    "qty" INTEGER NOT NULL DEFAULT 1,
    "amountPaise" BIGINT NOT NULL,
    "overrideReason" TEXT,
    "meta" JSONB,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(20) NOT NULL,
    "customerId" UUID NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "franchiseId" UUID,
    "attributionSource" "AttributionSource" NOT NULL DEFAULT 'NONE',
    "kioskDeviceId" UUID,
    "quotationId" UUID,
    "createdBy" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'FULL',
    "subtotalPaise" BIGINT NOT NULL,
    "discountPaise" BIGINT NOT NULL DEFAULT 0,
    "installationPaise" BIGINT NOT NULL DEFAULT 0,
    "deliveryPaise" BIGINT NOT NULL DEFAULT 0,
    "taxablePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,
    "roundOffPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL,
    "amountPaidPaise" BIGINT NOT NULL DEFAULT 0,
    "amountDuePaise" BIGINT NOT NULL,
    "advanceRequiredPaise" BIGINT NOT NULL DEFAULT 0,
    "shippingAddress" JSONB NOT NULL,
    "billingAddress" JSONB NOT NULL,
    "placeOfSupplyState" VARCHAR(2) NOT NULL,
    "customerGstin" VARCHAR(15),
    "couponId" UUID,
    "pricingSnapshot" JSONB NOT NULL,
    "installationRequired" BOOLEAN NOT NULL DEFAULT false,
    "courierName" VARCHAR(60),
    "awbNo" VARCHAR(40),
    "trackingUrl" TEXT,
    "expiresAt" TIMESTAMPTZ,
    "confirmedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "designId" UUID,
    "productId" UUID,
    "categoryId" UUID,
    "description" TEXT NOT NULL,
    "widthIn" DECIMAL(6,2) NOT NULL,
    "heightIn" DECIMAL(6,2) NOT NULL,
    "areaSqft" DECIMAL(10,2) NOT NULL,
    "billableSqft" DECIMAL(10,2) NOT NULL,
    "ratePerSqft" DECIMAL(12,2) NOT NULL,
    "addons" JSONB,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPricePaise" BIGINT NOT NULL,
    "lineTaxablePaise" BIGINT NOT NULL,
    "lineInstallationPaise" BIGINT NOT NULL DEFAULT 0,
    "proofStatus" "ProofStatus" NOT NULL DEFAULT 'PENDING',
    "revisionsUsed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorId" UUID,
    "actorType" VARCHAR(20) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_proofs" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "fileKey" TEXT NOT NULL,
    "designerNote" TEXT,
    "status" "ProofStatus" NOT NULL DEFAULT 'PENDING',
    "customerComment" TEXT,
    "uploadedBy" UUID,
    "respondedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "description" TEXT NOT NULL,
    "photoKeys" TEXT[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "photoKeys" TEXT[],
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reply" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(120),
    "pincode" CHAR(6),
    "message" TEXT,
    "source" VARCHAR(30) NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "franchiseId" UUID,
    "assignedTo" UUID,
    "followUpAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "PaymentTxnStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayOrderId" VARCHAR(40),
    "gatewayPaymentId" VARCHAR(40),
    "gatewayMethod" VARCHAR(20),
    "reference" VARCHAR(60),
    "proofKey" TEXT,
    "recordedBy" UUID,
    "raw" JSONB,
    "capturedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "gatewayRefundId" VARCHAR(40),
    "initiatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoiceNo" VARCHAR(30) NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'TAX_INVOICE',
    "orderId" UUID NOT NULL,
    "refInvoiceId" UUID,
    "financialYear" VARCHAR(7) NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "hsn" VARCHAR(8) NOT NULL,
    "pdfKey" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "financialYear" VARCHAR(7) NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "lastNo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("financialYear","type")
);

-- CreateTable
CREATE TABLE "franchise_tiers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "franchise_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchises" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ownerUserId" UUID,
    "tierId" UUID,
    "status" "FranchiseStatus" NOT NULL DEFAULT 'PENDING_KYC',
    "address" JSONB,
    "city" VARCHAR(80) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "phone" VARCHAR(15),
    "email" VARCHAR(120),
    "gstin" VARCHAR(15),
    "panEnc" BYTEA,
    "bankAccountEnc" BYTEA,
    "ifsc" VARCHAR(11),
    "bankName" VARCHAR(80),
    "kycVerifiedAt" TIMESTAMPTZ,
    "maxQuoteDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "showFullCustomerContact" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "franchises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_territories" (
    "id" UUID NOT NULL,
    "franchiseId" UUID NOT NULL,
    "pincode" CHAR(6) NOT NULL,

    CONSTRAINT "franchise_territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "tierId" UUID,
    "franchiseId" UUID,
    "categoryId" UUID,
    "source" "CommissionRuleSource" NOT NULL DEFAULT 'ANY',
    "type" "CommissionType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "maxPerOrderPaise" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "effectiveTo" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "franchiseId" UUID NOT NULL,
    "kind" "CommissionKind" NOT NULL DEFAULT 'ORDER',
    "seq" INTEGER NOT NULL DEFAULT 0,
    "source" "AttributionSource" NOT NULL,
    "basePaise" BIGINT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "eligibleAt" TIMESTAMPTZ,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ,
    "payoutId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "franchiseId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "grossPaise" BIGINT NOT NULL,
    "tdsPaise" BIGINT NOT NULL DEFAULT 0,
    "netPaise" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" VARCHAR(20),
    "utr" VARCHAR(40),
    "paidAt" TIMESTAMPTZ,
    "statementKey" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technicians" (
    "id" UUID NOT NULL,
    "franchiseId" UUID,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "photoKey" TEXT,
    "skills" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_jobs" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "franchiseId" UUID,
    "technicianId" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "scheduledStart" TIMESTAMPTZ,
    "scheduledEnd" TIMESTAMPTZ,
    "completionOtpHash" CHAR(64),
    "completedAt" TIMESTAMPTZ,
    "failReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "installation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_photos" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "stage" "JobPhotoStage" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "providerTemplateId" VARCHAR(60),
    "variables" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "recipient" VARCHAR(120) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMsgId" VARCHAR(80),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate" VARCHAR(40) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(60) NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(40),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_franchiseId_idx" ON "users"("franchiseId");

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshHash_key" ON "sessions"("refreshHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_devices_tokenHash_key" ON "kiosk_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "kiosk_devices_franchiseId_idx" ON "kiosk_devices"("franchiseId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_tags_idx" ON "products" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "backboards_code_key" ON "backboards"("code");

-- CreateIndex
CREATE UNIQUE INDEX "backgrounds_code_key" ON "backgrounds"("code");

-- CreateIndex
CREATE UNIQUE INDEX "designs_shareSlug_key" ON "designs"("shareSlug");

-- CreateIndex
CREATE INDEX "designs_userId_idx" ON "designs"("userId");

-- CreateIndex
CREATE INDEX "designs_guestToken_idx" ON "designs"("guestToken");

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_versions_versionNo_key" ON "rate_card_versions"("versionNo");

-- CreateIndex
CREATE INDEX "rate_card_versions_status_effectiveFrom_idx" ON "rate_card_versions"("status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_entries_versionId_productType_backboardId_key" ON "rate_card_entries"("versionId", "productType", "backboardId");

-- CreateIndex
CREATE UNIQUE INDEX "addons_code_key" ON "addons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_zones_code_key" ON "service_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "zone_pincodes_pincode_key" ON "zone_pincodes"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_orderId_key" ON "coupon_redemptions"("couponId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guestToken_key" ON "carts"("guestToken");

-- CreateIndex
CREATE INDEX "carts_userId_idx" ON "carts"("userId");

-- CreateIndex
CREATE INDEX "quotations_customerId_idx" ON "quotations"("customerId");

-- CreateIndex
CREATE INDEX "quotations_franchiseId_idx" ON "quotations"("franchiseId");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quoteNo_version_key" ON "quotations"("quoteNo", "version");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_franchiseId_createdAt_idx" ON "orders"("franchiseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "design_proofs_orderItemId_version_key" ON "design_proofs"("orderItemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- CreateIndex
CREATE INDEX "leads_franchiseId_status_idx" ON "leads"("franchiseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_gatewayOrderId_idx" ON "payments"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gatewayRefundId_key" ON "refunds"("gatewayRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNo_key" ON "invoices"("invoiceNo");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_tiers_name_key" ON "franchise_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "franchises_code_key" ON "franchises"("code");

-- CreateIndex
CREATE UNIQUE INDEX "franchise_territories_pincode_key" ON "franchise_territories"("pincode");

-- CreateIndex
CREATE INDEX "franchise_territories_franchiseId_idx" ON "franchise_territories"("franchiseId");

-- CreateIndex
CREATE INDEX "commission_rules_isActive_effectiveFrom_idx" ON "commission_rules"("isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "commissions_franchiseId_status_idx" ON "commissions"("franchiseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_orderId_kind_seq_key" ON "commissions"("orderId", "kind", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_utr_key" ON "payouts"("utr");

-- CreateIndex
CREATE INDEX "payouts_franchiseId_idx" ON "payouts"("franchiseId");

-- CreateIndex
CREATE INDEX "installation_jobs_technicianId_idx" ON "installation_jobs"("technicianId");

-- CreateIndex
CREATE INDEX "installation_jobs_franchiseId_scheduledStart_idx" ON "installation_jobs"("franchiseId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_channel_key" ON "notification_templates"("key", "channel");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_idx" ON "outbox_events"("publishedAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designs" ADD CONSTRAINT "designs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designs" ADD CONSTRAINT "designs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_card_entries" ADD CONSTRAINT "rate_card_entries_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "rate_card_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_card_entries" ADD CONSTRAINT "rate_card_entries_backboardId_fkey" FOREIGN KEY ("backboardId") REFERENCES "backboards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_pincodes" ADD CONSTRAINT "zone_pincodes_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "service_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_referralFranchiseId_fkey" FOREIGN KEY ("referralFranchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_designId_fkey" FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_designId_fkey" FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_kioskDeviceId_fkey" FOREIGN KEY ("kioskDeviceId") REFERENCES "kiosk_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_designId_fkey" FOREIGN KEY ("designId") REFERENCES "designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_proofs" ADD CONSTRAINT "design_proofs_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refInvoiceId_fkey" FOREIGN KEY ("refInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "franchise_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_territories" ADD CONSTRAINT "franchise_territories_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "franchise_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_jobs" ADD CONSTRAINT "installation_jobs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_jobs" ADD CONSTRAINT "installation_jobs_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_jobs" ADD CONSTRAINT "installation_jobs_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "installation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
