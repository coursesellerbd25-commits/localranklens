import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { VerifiedBusinessPicker, useVerifications } from "@/components/verification/VerifiedBusinessPicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getUsage } from "@/lib/api/audits.functions";
import { createWebsiteAudit } from "@/lib/api/website-audits.functions";

export const Route = createFileRoute("/_authenticated/website-audit/new")({
  validateSearch: z.object({ verification: z.string().uuid().optional() }),
  head: () => ({
    meta: [{ title: "New website audit — LocalRankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: NewWebsiteAuditPage,
});

function NewWebsiteAuditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { verification } = Route.useSearch();
  const verifications = useVerifications();
  const [verificationId, setVerificationId] = useState<string | null>(verification ?? null);
  useEffect(() => {
    if (verificationId || !verifications.data) return;
    const first = verifications.data.find((v) =>
      (v.business_sources ?? []).some((s) => s.source_type === "website" && s.retrieval_status === "retrieved"),
    );
    if (first) setVerificationId(first.id);
  }, [verificationId, verifications.data]);
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });

  const mutation = useMutation({
    mutationFn: (id: string) => createWebsiteAudit({ data: { verificationId: id } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["website-audits"] });
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      toast.success(`Website audit complete — SEO score ${result.score}, local readiness ${result.localScore}`);
      navigate({ to: "/website-audits/$auditId", params: { auditId: result.auditId } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The website could not be analyzed");
    },
  });

  const quotaReached = usage.data && usage.data.limit !== null && usage.data.used >= usage.data.limit;

  return (
    <AppShell
      title="New website audit"
      description="We fetch the real page, measure it with Google PageSpeed and score 26 checks across technical SEO, on-page, performance, mobile and accessibility."
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {usage.isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : quotaReached ? (
          <Alert variant="destructive">
            <AlertTitle>You've used this month's audits</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                Your {usage.data?.plan} plan includes {usage.data?.limit} audits per month — profile
                and website audits share the allowance. Your quota resets on the 1st.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to="/billing">See plans</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            {usage.data?.limit === null
              ? "Unlimited audits on your plan."
              : `${usage.data?.remaining ?? 0} of ${usage.data?.limit} audits left this month (profile and website audits combined).`}
          </p>
        )}

        {mutation.isPending ? (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <AlertTitle>Analyzing your website</AlertTitle>
            <AlertDescription>
              Validating the URL, fetching the page, robots.txt and sitemap, then requesting mobile
              and desktop measurements from Google PageSpeed Insights. This can take up to a minute —
              please keep this page open.
            </AlertDescription>
          </Alert>
        ) : null}

        <VerifiedBusinessPicker value={verificationId} onChange={setVerificationId} requireWebsite />

        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={mutation.isPending || !verificationId}
          onClick={() => {
            if (quotaReached) {
              toast.error("You've reached this month's audit limit.");
              return;
            }
            if (verificationId) mutation.mutate(verificationId);
          }}
        >
          {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {mutation.isPending ? "Analyzing…" : "Analyze Website"}
        </Button>
      </div>
    </AppShell>
  );
}
