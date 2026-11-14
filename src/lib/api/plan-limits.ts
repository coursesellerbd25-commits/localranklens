/**
 * Plan limits shared by the Google Business Profile audit and the website
 * SEO audit. Both audit types draw from the same monthly allowance so the
 * existing Free/Pro/Agency quotas keep working unchanged.
 */

export const PLAN_AUDIT_LIMITS: Record<string, number | null> = {
  free: 3,
  pro: 50,
  agency: null,
};

export function quotaMessage(plan: string, limit: number): string {
  return `Monthly audit limit reached for the ${plan} plan (${limit} audits, profile and website audits combined). Upgrade to run more this month.`;
}
