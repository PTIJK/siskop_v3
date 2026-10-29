import { Prisma } from "@prisma/client";
import { z } from "zod";
import { quoteRequestSchema } from "../pricing/schema.js";

/** Largest value a Decimal(15, 2) column holds. Anything above it must be a 422, not a database error. */
const MAX_AMOUNT = 9_999_999_999_999.99;

/** Money arrives as a string or a number and is stored as a Decimal; never a float in the database. */
const money = z
  .union([
    z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Must be a non-negative amount below 10 trillion with at most 2 decimals"),
    z.number().min(0).max(MAX_AMOUNT, "Amount is too large")
  ])
  .transform((v) => new Prisma.Decimal(v));

const limit = z.number().int().min(0).nullable();
const limits = z.object({ members: limit, users: limit, savingTypes: limit, loanTypes: limit }).strict();

/** `code` and `isCustom` are deliberately not editable: they are the package's identity. */
export const updatePackageSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    isPublic: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    priceMonthly: money.nullable().optional(),
    priceYearly: money.nullable().optional(),
    limits: limits.optional()
  })
  .strict();

export const upsertFeatureSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    parentKey: z.string().min(1).nullable().optional(),
    requires: z.array(z.string().min(1)).optional(),
    customPrice: money.optional(),
    priceGroup: z.string().min(1).max(50).nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional()
  })
  .strict();

export const matrixSchema = z.record(z.string().min(1), z.array(z.string().min(1)));

export const addonsSchema = z
  .array(
    z
      .object({
        itemKey: z.enum(["MEMBERS", "USERS", "SAVING_TYPES", "LOAN_TYPES"]),
        stepQty: z.number().int().min(1),
        price: money,
        period: z.enum(["MONTHLY", "YEARLY"])
      })
      .strict()
  )
  .superRefine((rows, ctx) => {
    const keys = rows.map((r) => r.itemKey);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate add-on itemKey" });
  });

export const supportPlansSchema = z
  .array(
    z
      .object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(50),
        yearlyCost: money,
        remote: z.boolean(),
        onsite: z.boolean(),
        visitsPerYear: z.number().int().min(0),
        slaHours: z.number().int().min(0).nullable(),
        aiSupport: z.boolean()
      })
      .strict()
  )
  .superRefine((rows, ctx) => {
    const codes = rows.map((r) => r.code);
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate support plan code" });
  });

export const updateSettingsSchema = z
  .object({
    yearlyMultiplier: z.number().int().min(1).optional(),
    enabledCycles: z.array(z.enum(["MONTHLY", "YEARLY"])).min(1, "Enable at least one billing cycle").optional(),
    defaultPackageCode: z.string().min(1).optional(),
    customEnabled: z.boolean().optional(),
    customBaseLimits: limits.optional(),
    addonsOnFixedPackages: z.boolean().optional(),
    paymentGraceDays: z.number().int().min(0).optional(),
    unpaidRegistrationPurgeDays: z.number().int().min(0).optional(),
    // VAT rate as a fraction, 0 to 1 (0.11 = 11%). Owner input; null clears it.
    taxRate: z
      .union([z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, "taxRate must be between 0 and 1"), z.number().min(0).max(1)])
      .transform((v) => new Prisma.Decimal(v))
      .nullable()
      .optional(),
    invoiceNumberFormat: z.string().min(1).max(50).optional(),
    paymentProvider: z.string().min(1).max(50).optional(),
    paymentInstructions: z.string().max(2000).nullable().optional(),
    oneFreeTenantPerRegistrationNo: z.boolean().optional()
  })
  .strict();

/** The simulator quotes the draft by default so the owner can preview before publishing. */
export const simulatorQuoteSchema = quoteRequestSchema.extend({ source: z.enum(["draft", "published"]).default("draft") }).strict();

export const publishSchema = z.object({ note: z.string().max(500).optional() }).strict();
export const rollbackSchema = z.object({ version: z.number().int().min(1) }).strict();

export const tenantSubscriptionSchema = quoteRequestSchema
  .extend({
    limitOverrides: limits.partial().optional(),
    nextBillingDate: z.coerce.date().nullable().optional(),
    status: z.enum(["ACTIVE", "PAST_DUE", "CANCELLED"]).optional()
  })
  .strict();
