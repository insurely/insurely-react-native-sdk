// Copyright © 2026 Insurely AB. All rights reserved.

import { z } from 'zod';

export const LANGUAGES = [
  'da',
  'de',
  'en',
  'et',
  'fr',
  'it',
  'lt',
  'lv',
  'no',
  'ru',
  'sv',
] as const;
export type InsurelyLanguage = (typeof LANGUAGES)[number];

const legalDocuments = z.strictObject({
  termsAndConditions: z.string().optional(),
  privacyPolicy: z.string().optional(),
  cookiePolicy: z.string().optional(),
});

const dataAggregationConfig = z.strictObject({
  hideResultsView: z.boolean().optional(),
  sstSessionId: z.string().optional(),
  legalDocuments: legalDocuments.optional(),
  multiSelect: z.boolean().optional(),
  referenceId: z.string().optional(),
  advisorHandle: z.string().optional(),
  additionalLinks: z
    .strictObject({ MEDIATION_TERMS: z.string().optional() })
    .optional(),
});

const compareConfig = z.strictObject({
  skipCompareUrl: z.string().optional(),
  showCompanyLogo: z.boolean().optional(),
  insuranceComparisonLink: z.string().optional(),
});

const customization = z.strictObject({
  theme: z.record(z.string(), z.unknown()).optional(),
  fonts: z.record(z.string(), z.unknown()).optional(),
  logosVariant: z.enum(['default', 'deBranded', 'noLogos']).optional(),
});

export const insurelyConfigSchema = z.strictObject({
  customerId: z.string().optional(),
  configName: z.string().optional(),
  language: z.enum(LANGUAGES).optional(),
  apiVersion: z.string().optional(),
  customization: customization.optional(),
  sessionId: z.string().optional(),
  resumeCode: z.string().optional(),
  showResumeInput: z.boolean().optional(),
  sendPostMessages: z.boolean().optional(),
  showCloseButton: z.boolean().optional(),
  showBackButton: z.boolean().optional(),
  showYearlyPremium: z.boolean().optional(),
  authToken: z.string().optional(),
  dataAggregation: dataAggregationConfig.optional(),
  compare: compareConfig.optional(),
  showExperimentalFeatures: z.boolean().optional(),
  disableAutomaticScrolling: z.boolean().optional(),
  scrollToTopOffset: z.number().optional(),
  // The Blocks contract types this as z.string().optional(), but we narrow
  // deliberately because Blocks' own internal typing and both iOS and Android
  // SDKs use exactly these three values. If Blocks adds a mode, this must be
  // widened by hand — the contract-drift check will not catch it.
  themeMode: z.enum(['light', 'dark', 'system']).optional(),
});

const lockablePrefill = z.union([
  z.string(),
  z.strictObject({
    value: z.string(),
    inputField: z.enum(['normal', 'disabled']),
  }),
]);

export const insurelyPrefillSchema = z.strictObject({
  user: z
    .strictObject({
      estonianPersonalNumber: lockablePrefill.optional(),
      estonianPhoneNumber: lockablePrefill.optional(),
      norwegianPersonalNumber: z.string().optional(),
      norwegianPhoneNumber: z.string().optional(),
      swedishPersonalNumber: z.string().optional(),
      username: lockablePrefill.optional(),
      email: z.string().optional(),
    })
    .optional(),
  customer: z
    .strictObject({
      phoneNumber: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  dataAggregation: z
    .strictObject({
      company: z.string().optional(),
      companies: z.array(z.string()).optional(),
      filter: z
        .strictObject({
          rules: z.tuple([
            z.strictObject({
              field: z.literal('registrationNo'),
              value: z.string(),
            }),
          ]),
        })
        .optional(),
    })
    .optional(),
  investmentTransfer: z
    .strictObject({
      targetAccounts: z
        .array(
          z.strictObject({
            type: z.string(),
            accountNumber: z.string(),
            accountName: z.string().optional(),
            blocked: z.boolean().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export type InsurelyConfig = z.infer<typeof insurelyConfigSchema>;
export type InsurelyPrefill = z.infer<typeof insurelyPrefillSchema>;

/**
 * Blocks silently strips keys it does not recognise, which makes a typo in a
 * config look like a Blocks bug. Fail loudly in development instead.
 */
export function validateSettings(
  config: InsurelyConfig,
  prefill?: InsurelyPrefill
): void {
  if (!__DEV__) return;

  const configResult = insurelyConfigSchema.safeParse(config);
  if (!configResult.success) {
    throw new Error(
      `[Insurely] Invalid config: ${formatIssues(configResult.error)}`
    );
  }

  if (prefill !== undefined) {
    const prefillResult = insurelyPrefillSchema.safeParse(prefill);
    if (!prefillResult.success) {
      throw new Error(
        `[Insurely] Invalid prefill: ${formatIssues(prefillResult.error)}`
      );
    }
  }
}

/**
 * `sendPostMessages: false` tells Blocks to suppress its result messages —
 * RESULTS, RESULTS_SELECTED_ITEM and WEALTH_RESULT_SELECTED_ITEMS. Every other
 * message still arrives, so events and errors keep working, but `onResults` can
 * never fire. Nothing about that is visible to the integrator — the collection
 * appears to run and then simply produce nothing. Warn instead of throwing: the
 * combination is a misconfiguration, not an impossibility (an integrator may be
 * collecting results server-side and still have a stale handler attached).
 */
export function warnOnUnreachableResults(
  sendPostMessages: boolean | undefined,
  hasResultsHandler: boolean
): void {
  if (sendPostMessages !== false || !hasResultsHandler) return;

  console.warn(
    '[Insurely] `config.sendPostMessages` is false, so Blocks will not post ' +
      'RESULTS and your `onResults` handler will never be called. Remove ' +
      '`sendPostMessages: false` or drop the handler.'
  );
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
