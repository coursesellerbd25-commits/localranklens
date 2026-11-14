import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { AuditForm } from "@/components/audit/AuditForm";
import { VerifiedBusinessPicker, useVerifications } from "@/components/verification/VerifiedBusinessPicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createAudit, getUsage } from "@/lib/api/audits.functions";
import { listLocations } from "@/lib/api/locations.functions";

export const Route = createFileRoute("/_authenticated/audit/new")({
  validateSearch: z.object({ verification: z.string().uuid().optional() }),
  head: () => ({
    meta: [{ title: "New audit — LocalRankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: NewAuditPage,
});

function NewAuditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { verification } = Route.useSearch();
  const verifications = useVerifications();
  const [verificationId, setVerificationId] = useState<string | null>(verification ?? null);
  useEffect(() => {
    if (!verificationId && verifications.data?.[0]) setVerificationId(verifications.data[0].id);
  }, [verificationId, verifications.data]);
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => getUsage() });
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => listLocations() });

  const mutation = useMutation({
    mutationFn: (values: Parameters<typeof createAudit>[0] extends never ? never : object) =>
      createAudit({ data: { ...(values as object), verificationId } as never }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      toast.success(`Audit complete — score ${result.score} (grade ${result.grade})`);
      navigate({ to: "/audits/$auditId", params: { auditId: result.auditId } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The audit could not be saved");
    },
  });

  const quotaReached =
    usage.data && usage.data.limit !== null && usage.data.used >= usage.data.limit;

  return (
    <AppShell
      title="New audit"
      description="Choose a verified business, then record what you can see on its Google Business Profile — we score it against 26 ranking checks."
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {usage.isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : quotaReached ? (
          <Alert variant="destructive">
            <AlertTitle>You've used this month's audits</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                Your {usage.data?.plan} plan includes {usage.data?.limit} audits per month. Your
                quota resets on the 1st.
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
              : `${usage.data?.remaining ?? 0} of ${usage.data?.limit} audits left this month.`}
          </p>
        )}

        <VerifiedBusinessPicker value={verificationId} onChange={setVerificationId} />

        <Alert>
          <AlertTitle>Profile answers are self-reported in this version</AlertTitle>
          <AlertDescription>
            The business name, category, town and website are locked to your verified links. The
            profile answers below (reviews, photos, posts…) can't be read automatically yet without
            Google's permission, so they are recorded as reported by you.
          </AlertDescription>
        </Alert>

        <AuditForm
          disabled={!verificationId}
          locations={locations.data ?? []}
          submitting={mutation.isPending}
          submitLabel={mutation.isPending ? "Scoring…" : "Run audit"}
          onSubmit={async (values) => {
            if (quotaReached) {
              toast.error("You've reached this month's audit limit.");
              return;
            }
            if (!verificationId) {
              toast.error("Verify the business with at least one official link first.");
              return;
            }
            await mutation.mutateAsync(values as never);
          }}
        />
      </div>
    </AppShell>
  );
}
