import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { AppShell, EmptyState } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WebsiteReportView, type WebsiteReportData, type WebsiteReportFinding } from "@/components/website-audit/WebsiteReportView";
import { getWebsiteAudit } from "@/lib/api/website-audits.functions";
import type { Priority, SiteCheckStatus } from "@/lib/site-audit/types";

export const Route = createFileRoute("/_authenticated/website-audits/$auditId")({
  head: () => ({
    meta: [{ title: "Website audit report — RankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: WebsiteAuditDetailPage,
});

function WebsiteAuditDetailPage() {
  const { auditId } = Route.useParams();
  const query = useQuery({
    queryKey: ["website-audit", auditId],
    queryFn: () => getWebsiteAudit({ data: { auditId } }),
  });

  const report: WebsiteReportData | null = query.data
    ? {
        url: query.data.audit.url,
        finalUrl: query.data.audit.final_url,
        overallScore: query.data.audit.overall_score ?? 0,
        grade: query.data.audit.grade ?? "",
        createdAt: query.data.audit.created_at,
        categoryScores:
          (query.data.audit.category_scores as unknown as WebsiteReportData["categoryScores"]) ?? [],
        localReadiness:
          (query.data.audit.local_readiness as unknown as WebsiteReportData["localReadiness"]) ?? {
            score: 0,
            earned: 0,
            possible: 0,
            findings: [],
            disclaimer: "",
          },
        pagespeed:
          (query.data.audit.pagespeed as unknown as WebsiteReportData["pagespeed"]) ?? { available: false },
        auditMeta:
          (query.data.audit.audit_meta as unknown as WebsiteReportData["auditMeta"]) ?? {},
        notTestedCount: query.data.findings.filter((f) => f.status === "not_tested").length,
        findings: query.data.findings.map<WebsiteReportFinding>((f) => ({
          checkKey: f.check_key,
          category: f.category,
          label: f.label,
          status: f.status as SiteCheckStatus,
          weight: f.weight,
          pointsEarned: f.points_earned,
          priority: (f.priority as Priority) ?? "medium",
          observed: f.observed,
          evidence: (f.evidence as unknown as Record<string, unknown>) ?? {},
          explanation: f.explanation,
          recommendation: f.recommendation,
          fixExample: f.fix_example,
          manualVerification: f.manual_verification,
        })),
      }
    : null;

  return (
    <AppShell
      title={report ? `Website audit — ${report.url}` : "Website audit report"}
      description={report ? `SEO score ${report.overallScore} · grade ${report.grade}` : undefined}
      actions={
        report ? (
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print / PDF
          </Button>
        ) : null
      }
    >
      {query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">We couldn't load this report.</p>
      ) : !report ? (
        <EmptyState
          title="Report not found"
          description="This website audit no longer exists, or it belongs to another account."
          action={
            <Button asChild>
              <Link to="/website-audits">Back to website audits</Link>
            </Button>
          }
        />
      ) : (
        <WebsiteReportView data={report} />
      )}
    </AppShell>
  );
}
