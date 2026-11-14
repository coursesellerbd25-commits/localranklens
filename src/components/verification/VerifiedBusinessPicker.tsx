import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, ShieldPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listVerifications } from "@/lib/api/verification.functions";
import { FIELD_LABELS, type Confidence, type FieldStatus, type VerifiedFields } from "@/lib/verification/assess";
import { ConfidenceBadge, FieldStatusBadge } from "./StatusBadges";

type StoredField = { value: unknown; status: FieldStatus };

export function useVerifications() {
  return useQuery({ queryKey: ["verifications"], queryFn: () => listVerifications() });
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.slice(0, 3).join(", ") + (value.length > 3 ? ` +${value.length - 3}` : "") : "Unavailable";
  if (typeof value === "string" && value) return value;
  return "Unavailable";
}

/** Read-only verified business details shown on the audit forms. */
export function VerifiedFieldsGrid({ fields, keys }: { fields: Record<string, StoredField>; keys: Array<keyof VerifiedFields> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {keys.map((key) => {
        const field = fields[key] ?? { value: null, status: "unavailable" as const };
        return (
          <div key={key} className="rounded-lg border border-border bg-surface-subtle p-3">
            <dt className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" aria-hidden />
                {FIELD_LABELS[key]}
              </span>
              <FieldStatusBadge status={field.status} />
            </dt>
            <dd className="mt-1.5 break-words text-sm font-medium">{field.status === "unavailable" ? "Unavailable" : display(field.value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function VerifiedBusinessPicker({
  value,
  onChange,
  requireWebsite = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  requireWebsite?: boolean;
}) {
  const verifications = useVerifications();

  if (verifications.isLoading) return <Skeleton className="h-40 rounded-xl" />;

  const rows = (verifications.data ?? []).filter((v) =>
    requireWebsite
      ? (v.business_sources ?? []).some((s) => s.source_type === "website" && s.retrieval_status === "retrieved")
      : (v.business_sources ?? []).some((s) => s.retrieval_status === "retrieved" || s.retrieval_status === "url_checked"),
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verify the business first</CardTitle>
          <CardDescription>
            {requireWebsite
              ? "Website audits run on a website you've verified. Submit the official website link (plus any other official links) and we'll read the details for you."
              : "Audits run only on businesses verified with at least one official link — the website, Google Business Profile, Google Maps, Facebook or LinkedIn page."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/verify/new">
              <ShieldPlus className="mr-2 h-4 w-4" aria-hidden />
              Verify a business
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selected = rows.find((r) => r.id === value) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Verified business</CardTitle>
        <CardDescription>
          Details below come from your official links and can't be edited here. If something is wrong,
          replace the link and verify again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="verification-pick">Business</Label>
            <Select value={value ?? ""} onValueChange={onChange}>
              <SelectTrigger id="verification-pick" className="mt-2">
                <SelectValue placeholder="Choose a verified business" />
              </SelectTrigger>
              <SelectContent>
                {rows.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {(row.business_name ?? row.website_domain ?? "Unnamed business") +
                      " — " +
                      new Date(row.created_at).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button asChild variant="outline">
            <Link to="/verify/new">Verify another</Link>
          </Button>
        </div>
        {selected ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ConfidenceBadge confidence={selected.confidence as Confidence} />
            <span className="text-muted-foreground">
              Business information verification {selected.verification_score}/100
              {selected.is_provisional ? " (provisional)" : ""}
            </span>
            <Link to="/verify/$verificationId" params={{ verificationId: selected.id }} className="text-primary underline-offset-4 hover:underline">
              See evidence
            </Link>
          </div>
        ) : null}
        {selected ? (
          <VerifiedFieldsGrid fields={(selected.fields ?? {}) as Record<string, StoredField>} keys={requireWebsite ? ["website", "name", "phone", "city"] : ["name", "category", "city", "website"]} />
        ) : null}
      </CardContent>
    </Card>
  );
}
