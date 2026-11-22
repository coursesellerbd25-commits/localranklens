import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldPlus } from "lucide-react";

import { AppShell, EmptyState } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceBadge } from "@/components/verification/StatusBadges";
import { useVerifications } from "@/components/verification/VerifiedBusinessPicker";
import type { Confidence } from "@/lib/verification/assess";
import { SOURCE_LABELS, type SourceType } from "@/lib/verification/sources";

export const Route = createFileRoute("/_authenticated/verify/")({
  head: () => ({
    meta: [{ title: "Verified businesses — RankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: VerificationsPage,
});

function VerificationsPage() {
  const query = useVerifications();
  const action = (
    <Button asChild>
      <Link to="/verify/new">
        <ShieldPlus className="mr-2 h-4 w-4" aria-hidden />
        Verify a business
      </Link>
    </Button>
  );

  return (
    <AppShell title="Verified businesses" description="Every verification is kept, so you can see how the evidence changed over time." actions={action}>
      <div className="mx-auto max-w-5xl">
        {query.isLoading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState
            title="No businesses verified yet"
            description="Start by adding the business's official links — at least one is required before any audit can run."
            action={action}
          />
        ) : (
          <Card className="divide-y divide-border">
            {(query.data ?? []).map((v) => (
              <Link
                key={v.id}
                to="/verify/$verificationId"
                params={{ verificationId: v.id }}
                className="flex flex-col gap-2 px-5 py-4 hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.business_name ?? v.website_domain ?? "Unnamed business"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(v.created_at).toLocaleString()} ·{" "}
                    {(v.business_sources ?? []).map((s) => SOURCE_LABELS[s.source_type as SourceType] ?? s.source_type).join(", ")}
                    {v.previous_verification_id ? " · re-verified" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <ConfidenceBadge confidence={v.confidence as Confidence} />
                  <span className="text-sm text-muted-foreground">
                    {v.verification_score}/100{v.is_provisional ? " · provisional" : ""}
                  </span>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
