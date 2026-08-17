-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('MIN', 'MAX');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CompatibilityType" AS ENUM ('GOOD', 'BAD', 'NG');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'DISPATCH');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('GROUP', 'PREFERRED', 'GENERAL');

-- CreateEnum
CREATE TYPE "EquipmentCategory" AS ENUM ('RADIO', 'LIGHT', 'SAFETY', 'SIGN', 'UNIFORM', 'VEHICLE_EQUIP', 'OFFICE', 'SIGNAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssigneeType" AS ENUM ('GUARD', 'SITE');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'CLOCKED_IN', 'COMPLETED', 'ABSENT', 'LATE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DailyPayStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'DEDUCTED');

-- CreateEnum
CREATE TYPE "EContractStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DAY_BEFORE_CONFIRM', 'SHIFT_CHANGE', 'EMERGENCY', 'ANNOUNCEMENT', 'DAILY_PAY');

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('FAX', 'EMAIL', 'LINE_WORKS');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'SUGGESTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONFIRMED', 'PAID');

-- CreateEnum
CREATE TYPE "SubPaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('GOVERNMENT', 'PRIVATE', 'CONSTRUCTION', 'COMMERCIAL', 'INDIVIDUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('STARTER', 'STANDARD', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "BillingLogType" AS ENUM ('PAYMENT_LINK_SENT', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_CANCELLED', 'MANUAL_SUSPEND', 'MANUAL_REACTIVATE', 'AUTO_SUSPEND', 'REMINDER_SENT');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'MIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "planType" "PlanType" NOT NULL DEFAULT 'STARTER',
    "trialEndsAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "billingEmail" TEXT,
    "lastPaymentAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "companyId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "companyId" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guard" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" "Gender",
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "certifications" TEXT[],
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PART_TIME',
    "bankAccount" JSONB,
    "dailyPayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyPayLimit" INTEGER,
    "dailyPayMonthlyLimit" INTEGER,
    "dailyPayFeeRate" DOUBLE PRECISION DEFAULT 0.03,
    "lineWorksId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postalCode" TEXT,
    "prefecture" TEXT,
    "city" TEXT,
    "addressDetail" TEXT,
    "buildingName" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "nearestStation1" TEXT,
    "line1" TEXT,
    "nearestStation2" TEXT,
    "line2" TEXT,
    "birthplace" TEXT,
    "medicalHistory" TEXT,
    "financialIssues" BOOLEAN NOT NULL DEFAULT false,
    "mbti" TEXT,
    "dormitory" TEXT,
    "guardClass" TEXT,
    "skills" TEXT[],
    "nationality" TEXT,
    "notes" TEXT,
    "ngGuardIds" JSONB,
    "ngCompanies" JSONB,
    "ngConditions" TEXT,
    "overallRating" INTEGER,
    "ratingComment" TEXT,
    "chartRatings" JSONB,
    "workConditions" JSONB,
    "payType" TEXT DEFAULT 'DAY',
    "monthlyBase" INTEGER,
    "hourlyBase" INTEGER,
    "dayShiftRate" INTEGER,
    "nightShiftRate" INTEGER,
    "holidayDayRate" INTEGER,
    "holidayNightRate" INTEGER,
    "dayOvertimeRate" INTEGER,
    "nightOvertimeRate" INTEGER,
    "holidayDayOtRate" INTEGER,
    "holidayNightOtRate" INTEGER,
    "positionAllowance" INTEGER DEFAULT 0,
    "qualificationAllowance" INTEGER DEFAULT 0,
    "leaderAllowance" INTEGER DEFAULT 0,
    "joiningAllowance" INTEGER DEFAULT 0,
    "otherAllowance1" INTEGER DEFAULT 0,
    "otherAllowance2" INTEGER DEFAULT 0,
    "otherAllowanceName1" TEXT,
    "otherAllowanceName2" TEXT,
    "employmentInsurance" BOOLEAN NOT NULL DEFAULT false,
    "healthInsurance" BOOLEAN NOT NULL DEFAULT false,
    "healthInsuranceGrade" INTEGER,
    "pensionInsurance" BOOLEAN NOT NULL DEFAULT false,
    "pensionInsuranceGrade" INTEGER,
    "nursingInsurance" BOOLEAN NOT NULL DEFAULT false,
    "spouse" BOOLEAN NOT NULL DEFAULT false,
    "spouseDeduction" BOOLEAN NOT NULL DEFAULT false,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "emergencyName" TEXT,
    "emergencyKana" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPostal" TEXT,
    "emergencyPrefecture" TEXT,
    "emergencyCity" TEXT,
    "emergencyAddressDetail" TEXT,
    "residenceStatus" TEXT,
    "residenceCardNumber" TEXT,
    "residenceExpiry" TIMESTAMP(3),
    "workPermitType" TEXT,
    "workPermitExpiry" TIMESTAMP(3),
    "weeklyHoursLimit" INTEGER DEFAULT 28,
    "schoolName" TEXT,
    "schoolVacationStart" TIMESTAMP(3),
    "schoolVacationEnd" TIMESTAMP(3),
    "docMyNumber" BOOLEAN NOT NULL DEFAULT false,
    "docIdCard" BOOLEAN NOT NULL DEFAULT false,
    "docIdentityCert" BOOLEAN NOT NULL DEFAULT false,
    "docResidenceCard" BOOLEAN NOT NULL DEFAULT false,
    "docResume" BOOLEAN NOT NULL DEFAULT false,
    "docPledge" BOOLEAN NOT NULL DEFAULT false,
    "docPhoto" BOOLEAN NOT NULL DEFAULT false,
    "docOther" BOOLEAN NOT NULL DEFAULT false,
    "docWorkPermit" BOOLEAN NOT NULL DEFAULT false,
    "myNumber" TEXT,
    "myNumberUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Guard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardCompatibility" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "targetGuardId" TEXT NOT NULL,
    "type" "CompatibilityType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardCompatibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientCode" TEXT,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "category" "ClientCategory" NOT NULL DEFAULT 'OTHER',
    "positionTitle" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "relationship" TEXT,
    "accountingContactName" TEXT,
    "accountingPhone" TEXT,
    "accountingEmail" TEXT,
    "notes" TEXT,
    "subContacts" JSONB,
    "postalCode" TEXT,
    "prefecture" TEXT,
    "city" TEXT,
    "addressDetail" TEXT,
    "buildingName" TEXT,
    "addressee" TEXT,
    "billingSameAsCompany" BOOLEAN NOT NULL DEFAULT true,
    "billingPostalCode" TEXT,
    "billingPrefecture" TEXT,
    "billingCity" TEXT,
    "billingAddressDetail" TEXT,
    "billingBuildingName" TEXT,
    "billingAddressee" TEXT,
    "documents" JSONB,
    "bankName" TEXT,
    "bankBranch" TEXT,
    "bankAccountType" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountHolder" TEXT,
    "contractDate" TIMESTAMP(3),
    "unitPriceDay" INTEGER,
    "unitPriceNight" INTEGER,
    "unitPriceHolidayDay" INTEGER,
    "unitPriceHolidayNight" INTEGER,
    "overtimeDayRate" INTEGER,
    "overtimeNightRate" INTEGER,
    "overtimeHolidayDayRate" INTEGER,
    "overtimeHolidayNightRate" INTEGER,
    "qualificationAllowance" INTEGER,
    "radioAllowance" INTEGER,
    "otherAllowance1" INTEGER,
    "otherAllowance2" INTEGER,
    "address" TEXT,
    "invoiceRegistrationNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "logType" TEXT NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "clientName" TEXT,
    "clientPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "siteCode" TEXT,
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "requiredQualifiedA" INTEGER NOT NULL DEFAULT 0,
    "requiredQualifiedB" INTEGER NOT NULL DEFAULT 0,
    "assemblyTime" TEXT,
    "defaultStartTime" TEXT,
    "defaultEndTime" TEXT,
    "assemblyPlace" TEXT,
    "cautions" TEXT,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "unitPriceDay" INTEGER,
    "unitPriceNight" INTEGER,
    "unitPriceHolidayDay" INTEGER,
    "unitPriceHolidayNight" INTEGER,
    "unitPrice" INTEGER NOT NULL,
    "guardCount" INTEGER NOT NULL DEFAULT 1,
    "shiftPattern" JSONB,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL DEFAULT 'GENERAL',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "model" TEXT,
    "year" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "EquipmentCategory" NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "manufacturer" TEXT,
    "modelNumber" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "assigneeType" "AssigneeType" NOT NULL,
    "guardId" TEXT,
    "siteId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ASSIGNED',
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shiftType" TEXT NOT NULL DEFAULT 'DAY',
    "assemblyTime" TEXT,
    "sentAt" TIMESTAMP(3),
    "contractId" TEXT,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isHoliday" BOOLEAN NOT NULL DEFAULT false,
    "earlyOvertimeMin" INTEGER NOT NULL DEFAULT 0,
    "lateOvertimeMin" INTEGER NOT NULL DEFAULT 0,
    "transportAmount" INTEGER NOT NULL DEFAULT 0,
    "otherAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "clientId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "taxAmount" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "contractId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" DATE,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPayRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "feeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "feeAmount" INTEGER NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "status" "DailyPayStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "deductedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPayRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectronicContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pdfPath" TEXT,
    "status" "EContractStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3),
    "timestampToken" TEXT,
    "timestampAt" TIMESTAMP(3),
    "auditLog" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectronicContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EContractSignature" (
    "id" TEXT NOT NULL,
    "eContractId" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "userId" TEXT,
    "token" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EContractSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "approvalToken" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineWorksSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "botSecret" TEXT,
    "channelId" TEXT NOT NULL,
    "accessToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineWorksSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'LINE_WORKS',
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "rawContent" TEXT NOT NULL,
    "parsedData" JSONB,
    "suggestion" JSONB,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSurvey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shiftTypes" JSONB NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "answerStartAt" TIMESTAMP(3) NOT NULL,
    "answerEndAt" TIMESTAMP(3) NOT NULL,
    "isExported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "workDays" INTEGER NOT NULL DEFAULT 0,
    "holidayWorkDays" INTEGER NOT NULL DEFAULT 0,
    "totalWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "regularMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyOtMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateOtMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidLeaveDays" INTEGER NOT NULL DEFAULT 0,
    "absentDays" INTEGER NOT NULL DEFAULT 0,
    "basicPay" INTEGER NOT NULL DEFAULT 0,
    "overtimePay" INTEGER NOT NULL DEFAULT 0,
    "holidayPay" INTEGER NOT NULL DEFAULT 0,
    "positionAllowance" INTEGER NOT NULL DEFAULT 0,
    "qualificationAllowance" INTEGER NOT NULL DEFAULT 0,
    "leaderAllowance" INTEGER NOT NULL DEFAULT 0,
    "commuteAllowance" INTEGER NOT NULL DEFAULT 0,
    "travelExpense" INTEGER NOT NULL DEFAULT 0,
    "otherAllowance" INTEGER NOT NULL DEFAULT 0,
    "taxableTotal" INTEGER NOT NULL DEFAULT 0,
    "nonTaxableTotal" INTEGER NOT NULL DEFAULT 0,
    "grossPay" INTEGER NOT NULL DEFAULT 0,
    "healthInsurance" INTEGER NOT NULL DEFAULT 0,
    "pension" INTEGER NOT NULL DEFAULT 0,
    "employmentIns" INTEGER NOT NULL DEFAULT 0,
    "incomeTax" INTEGER NOT NULL DEFAULT 0,
    "residentTax" INTEGER NOT NULL DEFAULT 0,
    "otherDeduction" INTEGER NOT NULL DEFAULT 0,
    "totalDeduction" INTEGER NOT NULL DEFAULT 0,
    "yearEndAdj" INTEGER NOT NULL DEFAULT 0,
    "netPay" INTEGER NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "payDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "partnerName" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "SubPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "clientName" TEXT,
    "siteNames" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "items" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripePaymentIntentId" TEXT,
    "type" "BillingLogType" NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'jpy',
    "description" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthInsGradeTable" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "prefecture" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "standardMonthly" INTEGER NOT NULL,
    "employeeShare" INTEGER NOT NULL,
    "employerShare" INTEGER NOT NULL,
    "nursingEmployee" INTEGER NOT NULL DEFAULT 0,
    "nursingEmployer" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HealthInsGradeTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PensionGradeTable" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "grade" INTEGER NOT NULL,
    "standardMonthly" INTEGER NOT NULL,
    "employeeShare" INTEGER NOT NULL,
    "employerShare" INTEGER NOT NULL,

    CONSTRAINT "PensionGradeTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentInsRate" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "businessType" TEXT NOT NULL,
    "employeeRate" DOUBLE PRECISION NOT NULL,
    "employerRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "EmploymentInsRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTaxTable" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "salaryFrom" INTEGER NOT NULL,
    "salaryTo" INTEGER NOT NULL,
    "dep0" INTEGER NOT NULL,
    "dep1" INTEGER NOT NULL,
    "dep2" INTEGER NOT NULL,
    "dep3" INTEGER NOT NULL,
    "dep4" INTEGER NOT NULL,
    "dep5" INTEGER NOT NULL,
    "dep6" INTEGER NOT NULL,
    "dep7" INTEGER NOT NULL,

    CONSTRAINT "IncomeTaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentTax" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "municipality" TEXT NOT NULL,

    CONSTRAINT "ResidentTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidLeave" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "grantDate" DATE NOT NULL,
    "grantDays" DOUBLE PRECISION NOT NULL,
    "usedDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expiryDate" DATE NOT NULL,

    CONSTRAINT "PaidLeave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusPayroll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "bonusType" TEXT NOT NULL,
    "grossAmount" INTEGER NOT NULL,
    "healthInsurance" INTEGER NOT NULL DEFAULT 0,
    "pension" INTEGER NOT NULL DEFAULT 0,
    "employmentIns" INTEGER NOT NULL DEFAULT 0,
    "incomeTax" INTEGER NOT NULL DEFAULT 0,
    "otherDeduction" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusPayroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModulePermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ModulePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyNumberAuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MyNumberAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignWorkerAlert" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "limitHours" INTEGER NOT NULL,
    "isVacation" BOOLEAN NOT NULL,
    "alertType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignWorkerAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Company_stripeCustomerId_key" ON "Company"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_companyId_idx" ON "Invitation"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Guard_companyId_idx" ON "Guard"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Guard_companyId_employeeNumber_key" ON "Guard"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "GuardCompatibility_companyId_idx" ON "GuardCompatibility"("companyId");

-- CreateIndex
CREATE INDEX "GuardCompatibility_guardId_idx" ON "GuardCompatibility"("guardId");

-- CreateIndex
CREATE INDEX "GuardCompatibility_targetGuardId_idx" ON "GuardCompatibility"("targetGuardId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardCompatibility_guardId_targetGuardId_key" ON "GuardCompatibility"("guardId", "targetGuardId");

-- CreateIndex
CREATE INDEX "GuardDocument_companyId_idx" ON "GuardDocument"("companyId");

-- CreateIndex
CREATE INDEX "GuardDocument_guardId_idx" ON "GuardDocument"("guardId");

-- CreateIndex
CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");

-- CreateIndex
CREATE INDEX "ClientLog_clientId_idx" ON "ClientLog"("clientId");

-- CreateIndex
CREATE INDEX "ClientLog_companyId_idx" ON "ClientLog"("companyId");

-- CreateIndex
CREATE INDEX "Site_companyId_idx" ON "Site"("companyId");

-- CreateIndex
CREATE INDEX "Site_clientId_idx" ON "Site"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "Contract_companyId_idx" ON "Contract"("companyId");

-- CreateIndex
CREATE INDEX "Contract_siteId_idx" ON "Contract"("siteId");

-- CreateIndex
CREATE INDEX "Partner_companyId_idx" ON "Partner"("companyId");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_idx" ON "Vehicle"("companyId");

-- CreateIndex
CREATE INDEX "Equipment_companyId_idx" ON "Equipment"("companyId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_companyId_idx" ON "EquipmentAssignment"("companyId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_equipmentId_idx" ON "EquipmentAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_guardId_idx" ON "EquipmentAssignment"("guardId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_siteId_idx" ON "EquipmentAssignment"("siteId");

-- CreateIndex
CREATE INDEX "Schedule_companyId_date_idx" ON "Schedule"("companyId", "date");

-- CreateIndex
CREATE INDEX "Schedule_guardId_date_idx" ON "Schedule"("guardId", "date");

-- CreateIndex
CREATE INDEX "Schedule_contractId_idx" ON "Schedule"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_scheduleId_key" ON "Attendance"("scheduleId");

-- CreateIndex
CREATE INDEX "Attendance_companyId_idx" ON "Attendance"("companyId");

-- CreateIndex
CREATE INDEX "Attendance_guardId_idx" ON "Attendance"("guardId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_companyId_idx" ON "Invoice"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "DailyPayRequest_companyId_idx" ON "DailyPayRequest"("companyId");

-- CreateIndex
CREATE INDEX "DailyPayRequest_guardId_idx" ON "DailyPayRequest"("guardId");

-- CreateIndex
CREATE INDEX "DailyPayRequest_status_idx" ON "DailyPayRequest"("status");

-- CreateIndex
CREATE INDEX "ElectronicContract_companyId_idx" ON "ElectronicContract"("companyId");

-- CreateIndex
CREATE INDEX "ElectronicContract_contractId_idx" ON "ElectronicContract"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "EContractSignature_token_key" ON "EContractSignature"("token");

-- CreateIndex
CREATE INDEX "EContractSignature_eContractId_idx" ON "EContractSignature"("eContractId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityReport_approvalToken_key" ON "SecurityReport"("approvalToken");

-- CreateIndex
CREATE UNIQUE INDEX "LineWorksSettings_companyId_key" ON "LineWorksSettings"("companyId");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "AutoReceipt_companyId_idx" ON "AutoReceipt"("companyId");

-- CreateIndex
CREATE INDEX "AutoReceipt_status_idx" ON "AutoReceipt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftSurveyResponse_surveyId_guardId_key" ON "ShiftSurveyResponse"("surveyId", "guardId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_companyId_guardId_year_month_key" ON "Payroll"("companyId", "guardId", "year", "month");

-- CreateIndex
CREATE INDEX "SubcontractorPayment_companyId_idx" ON "SubcontractorPayment"("companyId");

-- CreateIndex
CREATE INDEX "SubcontractorPayment_partnerId_idx" ON "SubcontractorPayment"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_stripeSubscriptionId_key" ON "BillingSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_companyId_idx" ON "BillingSubscription"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingLog_stripeInvoiceId_key" ON "BillingLog"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "BillingLog_companyId_idx" ON "BillingLog"("companyId");

-- CreateIndex
CREATE INDEX "BillingLog_occurredAt_idx" ON "BillingLog"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "HealthInsGradeTable_fiscalYear_prefecture_idx" ON "HealthInsGradeTable"("fiscalYear", "prefecture");

-- CreateIndex
CREATE UNIQUE INDEX "HealthInsGradeTable_fiscalYear_prefecture_grade_key" ON "HealthInsGradeTable"("fiscalYear", "prefecture", "grade");

-- CreateIndex
CREATE INDEX "PensionGradeTable_fiscalYear_idx" ON "PensionGradeTable"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "PensionGradeTable_fiscalYear_grade_key" ON "PensionGradeTable"("fiscalYear", "grade");

-- CreateIndex
CREATE INDEX "EmploymentInsRate_fiscalYear_idx" ON "EmploymentInsRate"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentInsRate_fiscalYear_businessType_key" ON "EmploymentInsRate"("fiscalYear", "businessType");

-- CreateIndex
CREATE INDEX "IncomeTaxTable_fiscalYear_salaryFrom_idx" ON "IncomeTaxTable"("fiscalYear", "salaryFrom");

-- CreateIndex
CREATE INDEX "ResidentTax_companyId_idx" ON "ResidentTax"("companyId");

-- CreateIndex
CREATE INDEX "ResidentTax_guardId_idx" ON "ResidentTax"("guardId");

-- CreateIndex
CREATE UNIQUE INDEX "ResidentTax_guardId_fiscalYear_month_key" ON "ResidentTax"("guardId", "fiscalYear", "month");

-- CreateIndex
CREATE INDEX "PaidLeave_companyId_idx" ON "PaidLeave"("companyId");

-- CreateIndex
CREATE INDEX "PaidLeave_guardId_idx" ON "PaidLeave"("guardId");

-- CreateIndex
CREATE INDEX "BonusPayroll_companyId_idx" ON "BonusPayroll"("companyId");

-- CreateIndex
CREATE INDEX "BonusPayroll_guardId_idx" ON "BonusPayroll"("guardId");

-- CreateIndex
CREATE INDEX "ModulePermission_userId_idx" ON "ModulePermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ModulePermission_userId_module_key" ON "ModulePermission"("userId", "module");

-- CreateIndex
CREATE INDEX "MyNumberAuditLog_companyId_idx" ON "MyNumberAuditLog"("companyId");

-- CreateIndex
CREATE INDEX "MyNumberAuditLog_guardId_idx" ON "MyNumberAuditLog"("guardId");

-- CreateIndex
CREATE INDEX "MyNumberAuditLog_userId_idx" ON "MyNumberAuditLog"("userId");

-- CreateIndex
CREATE INDEX "ForeignWorkerAlert_companyId_idx" ON "ForeignWorkerAlert"("companyId");

-- CreateIndex
CREATE INDEX "ForeignWorkerAlert_guardId_idx" ON "ForeignWorkerAlert"("guardId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guard" ADD CONSTRAINT "Guard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardCompatibility" ADD CONSTRAINT "GuardCompatibility_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardCompatibility" ADD CONSTRAINT "GuardCompatibility_targetGuardId_fkey" FOREIGN KEY ("targetGuardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardDocument" ADD CONSTRAINT "GuardDocument_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLog" ADD CONSTRAINT "ClientLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAssignment" ADD CONSTRAINT "EquipmentAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPayRequest" ADD CONSTRAINT "DailyPayRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPayRequest" ADD CONSTRAINT "DailyPayRequest_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPayRequest" ADD CONSTRAINT "DailyPayRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectronicContract" ADD CONSTRAINT "ElectronicContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectronicContract" ADD CONSTRAINT "ElectronicContract_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EContractSignature" ADD CONSTRAINT "EContractSignature_eContractId_fkey" FOREIGN KEY ("eContractId") REFERENCES "ElectronicContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EContractSignature" ADD CONSTRAINT "EContractSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReport" ADD CONSTRAINT "SecurityReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReport" ADD CONSTRAINT "SecurityReport_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityReport" ADD CONSTRAINT "SecurityReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineWorksSettings" ADD CONSTRAINT "LineWorksSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoReceipt" ADD CONSTRAINT "AutoReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSurvey" ADD CONSTRAINT "ShiftSurvey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSurveyResponse" ADD CONSTRAINT "ShiftSurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "ShiftSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSurveyResponse" ADD CONSTRAINT "ShiftSurveyResponse_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "Guard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorPayment" ADD CONSTRAINT "SubcontractorPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorPayment" ADD CONSTRAINT "SubcontractorPayment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLog" ADD CONSTRAINT "BillingLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

