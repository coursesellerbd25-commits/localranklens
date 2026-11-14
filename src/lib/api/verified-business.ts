import type { Database } from "@/integrations/supabase/types";

type StoredField = { value: unknown; status: string } | undefined;

/** Business details for an audit come only from the user's verification record — never typed in. */
export async function verifiedBusinessFor(
  supabase: NonNullable<unknown>,
  userId: string,
  verificationId: string,
) {
  const client = supabase as import("@supabase/supabase-js").SupabaseClient<Database>;
  const { data: verification } = await client
    .from("business_verifications")
    .select("id, fields, confidence, business_sources(source_type, retrieval_status, final_url, normalized_url)")
    .eq("id", verificationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!verification) throw new Error("Verify the business with at least one official link before running an audit.");
  const sources = (verification.business_sources ?? []) as Array<{ source_type: string; retrieval_status: string; final_url: string | null; normalized_url: string }>;
  if (!sources.some((s) => s.retrieval_status === "retrieved" || s.retrieval_status === "url_checked")) {
    throw new Error("This verification has no valid official source. Add a working link and verify again.");
  }
  const fields = (verification.fields ?? {}) as Record<string, StoredField>;
  const text = (key: string): string | null => {
    const f = fields[key];
    if (!f || f.status === "unavailable" || f.status === "conflicting" || typeof f.value !== "string") return null;
    return f.value;
  };
  const website = sources.find((s) => s.source_type === "website" && s.retrieval_status === "retrieved");
  return {
    verificationId: verification.id,
    confidence: verification.confidence,
    businessName: text("name"),
    primaryCategory: text("category"),
    city: text("city"),
    phone: text("phone"),
    websiteUrl: website ? (website.final_url ?? website.normalized_url) : null,
    nameStatus: fields["name"]?.status ?? "unavailable",
  };
}

