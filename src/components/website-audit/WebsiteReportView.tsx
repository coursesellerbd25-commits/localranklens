import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, ShieldQuestion, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScoreDial } from "@/components/audit/ScoreDial";
import { SITE_AUDIT_CATEGORIES, type Priority, type SiteCheckStatus } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const PRIORITY_STYLE: Record<Priority, string> = {
  critical: "bg-destructive text-destructive-foreground border-transparent",
  high: "text-warn border-warn/40",
  medium: "text-warn border-warn/25",
  low: "text-muted-foreground",
};

export interface WebsiteReportFinding {
  checkKey: string;
  category: string;
  label: string;
  status: SiteCheckStatus;
  weight: number;
  pointsEarned: number;
  priority: Priority;
  observed: string;
  evidence: Record<string, unknown>;
  explanation: string;
  recommendation: string;
  fixExample?: string | null;
  manualVerification: boolean;
}

export interface WebsiteReportData {
  url: string;
  finalUrl: string | null;
  overallScore: number;
  grade: string;
  createdAt: string;
  categoryScores: Array<{ category: string; earned: number; possible: number; score: number }>;
  findings: WebsiteReportFinding[];
  localReadiness: {
    score: number;
    earned: number;
    possible: number;
    findings: Array<{
      key: string;
      label: string;
      status: SiteCheckStatus;
      weight: number;
      pointsEarned: number;
      observed: string;
      explanation: string;
      recommendation?: string;
      manualVerification?: boolean;
    }>;
    disclaimer: string;
  };
  pagespeed: {
    available: boolean;
    error?: string;
    mobile?: { available: boolean; error?: string; performanceScore: number | null; metrics: Record<string, { value: number | null; display: string | null; unit: string }>; opportunities: Array<{ id: string; title: string; displayValue: string | null }> };
    desktop?: { available: boolean; error?: string; performanceScore: number | null; metrics: Record<string, { value: number | null; display: string | null; unit: string }> };
  };
  auditMeta: {
    redirectChain?: string[];
    pageBytes?: number | null;
    responseTimeMs?: number | null;
    robots?: { available: boolean; status: number | null; disallowsHome: boolean };
    sitemap?: { available: boolean; url: string; status: number | null };
  };
  notTestedCount: number;
}

const STATUS_META: Record<SiteCheckStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "text-pass" },
  warn: { label: "Needs work", icon: AlertTriangle, className: "text-warn" },
  fail: { label: "Fail", icon: XCircle, className: "text-fail" },
  not_tested: { label: "Not tested", icon: CircleHelp, className: "text-muted-foreground" },
};

function StatusIcon({ status }: { status: SiteCheckStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return <Icon className={cn("h-4 w-4 shrink-0", meta.className)} aria-hidden />;
}

const METRIC_LABELS: Array<{ key: string; label: string }> = [
  { key: "lcp", label: "Largest Contentful Paint (LCP)" },
  { key: "inp", label: "Interaction to Next Paint (INP)" },
  { key: "cls", label: "Cumulative Layout Shift (CLS)" },
  { key: "fcp", label: "First Contentful Paint (FCP)" },
  { key: "si", label: "Speed Index" },
];

export function WebsiteReportView({ data }: { data: WebsiteReportData }) {
  const counts = data.findings.reduce<Record<SiteCheckStatus, number>>(
    (acc, f) => {
      acc[f.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, not_tested: 0 },
  );

  const actions = [...data.findings]
    .filter((f) => f.status === "fail" || f.status === "warn")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      if (PRIORITY_ORDER[a.priority] !== PRIORITY_ORDER[b.priority]) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return b.weight - a.weight;
    })
    .slice(0, 8);

  const local = data.localReadiness;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-8 pt-6 md:flex-row md:items-start">
          <ScoreDial score={data.overallScore} grade={data.grade} label="Website SEO score" />
          <div className="min-w-0 flex-1">
            <h2 className="break-all font-display text-2xl font-semibold">{data.url}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Audited {new Date(data.createdAt).toLocaleString()}
              {data.auditMeta.responseTimeMs ? ` · server responded in ${(data.auditMeta.responseTimeMs / 1000).toFixed(2)} s` : ""}
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["pass", "warn", "fail", "not_tested"] as SiteCheckStatus[]).map((status) => (
                <div key={status} className="rounded-lg border border-border p-3">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusIcon status={status} />
                    {STATUS_META[status].label}
                  </dt>
                  <dd className="mt-1 font-display text-2xl font-semibold">{counts[status]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Checks marked “Not tested” could not run for this site and are left out of the score
              rather than counted as failures.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Do these first</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every automated check passed. Re-run the audit periodically to catch changes.
              </p>
            ) : (
              actions.map((finding, index) => (
                <div key={finding.checkKey} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{finding.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Found: {finding.observed}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{finding.recommendation}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("capitalize", PRIORITY_STYLE[finding.priority])}>
                        {finding.priority}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        +{finding.weight - finding.pointsEarned} points available
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score by area</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.categoryScores.map((category) => {
              const limit = { "Technical SEO": 25, "On-page SEO": 25, Performance: 25, "Mobile readiness": 15, "Basic accessibility": 10 }[category.category] ?? 25;
              return (
                <div key={category.category}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{category.category}</span>
                    <span className="text-muted-foreground">
                      {category.possible === 0 ? "not tested" : `${category.earned}/${limit} pts`}
                    </span>
                  </div>
                  <Progress value={category.possible === 0 ? 0 : category.score} className="mt-2 h-2" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance — measured by Google PageSpeed Insights</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.pagespeed.available ? (
            <p className="text-sm text-muted-foreground">
              {data.pagespeed.error
                ? `Google's PageSpeed data was unavailable for this run: ${data.pagespeed.error}`
                : "Google's PageSpeed data was unavailable for this run, so performance checks were left out of the score."}
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["mobile", "desktop"] as const).map((strategy) => {
                  const result = data.pagespeed[strategy];
                  const score = result?.available && result.performanceScore !== null ? Math.round(result.performanceScore * 100) : null;
                  return (
                    <div key={strategy} className="rounded-lg border border-border p-4">
                      <p className="text-sm font-medium capitalize">{strategy} performance</p>
                      {score === null ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {result?.error ?? "Not reported by Google for this run"}
                        </p>
                      ) : (
                        <p className="mt-1 font-display text-3xl font-semibold">
                          {score}
                          <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Metric</th>
                      <th className="pb-2 font-medium">Measured</th>
                      <th className="pb-2 font-medium">Google target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {METRIC_LABELS.map(({ key, label }) => {
                      const metric = data.pagespeed.mobile?.metrics?.[key] ?? data.pagespeed.desktop?.metrics?.[key];
                      return (
                        <tr key={key}>
                          <td className="py-2">{label}</td>
                          <td className="py-2">{metric?.display ?? "not reported"}</td>
                          <td className="py-2 text-muted-foreground">
                            {{ lcp: "≤ 2.5 s", inp: "≤ 200 ms", cls: "≤ 0.10", fcp: "≤ 1.8 s", si: "≤ 3.4 s" }[key]}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {data.pagespeed.mobile?.opportunities?.length ? (
                <div>
                  <p className="text-sm font-medium">Biggest opportunities Google found</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                    {data.pagespeed.mobile.opportunities.map((opportunity) => (
                      <li key={opportunity.id} className="flex justify-between gap-3">
                        <span>{opportunity.title}</span>
                        {opportunity.displayValue ? <span className="shrink-0 tabular-nums">{opportunity.displayValue}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        {SITE_AUDIT_CATEGORIES.map((category) => {
          const scoped = data.findings.filter((f) => f.category === category);
          if (scoped.length === 0) return null;
          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base">{category}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {scoped.map((finding) => (
                  <div key={finding.checkKey} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <StatusIcon status={finding.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{finding.label}</p>
                        <div className="flex items-center gap-2">
                          {finding.status !== "pass" && finding.status !== "not_tested" ? (
                            <Badge variant="outline" className={cn("text-xs capitalize", PRIORITY_STYLE[finding.priority])}>
                              {finding.priority}
                            </Badge>
                          ) : null}
                          <span className="text-xs text-muted-foreground">{finding.observed}</span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Why it matters: {finding.explanation}</p>
                      {finding.recommendation ? (
                        <p className="mt-1 text-sm text-muted-foreground">{finding.recommendation}</p>
                      ) : null}
                      {finding.fixExample ? (
                        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-subtle p-2 text-xs text-muted-foreground">
                          {finding.fixExample}
                        </pre>
                      ) : null}
                      {finding.manualVerification ? (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          Automated evidence is incomplete here — verify manually to be sure.
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {finding.status === "not_tested" ? "—" : `${finding.pointsEarned}/${finding.weight}`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <ShieldQuestion className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle className="text-base">Local Visibility Readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <ScoreDial score={local.score} size={130} label="Local readiness" />
            <div className="min-w-0 flex-1 space-y-3">
              {local.findings.map((finding) => (
                <div key={finding.key} className="flex gap-3">
                  <StatusIcon status={finding.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{finding.label}</p>
                    <p className="text-xs text-muted-foreground">{finding.observed}</p>
                    {finding.recommendation ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">{finding.recommendation}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {finding.status === "not_tested" ? "—" : `${finding.pointsEarned}/${finding.weight}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Alert>
            <AlertTitle>What this score does and does not mean</AlertTitle>
            <AlertDescription>{local.disclaimer}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {data.auditMeta.redirectChain && data.auditMeta.redirectChain.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redirect chain followed</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 text-sm text-muted-foreground">
              {[...data.auditMeta.redirectChain, data.finalUrl ?? data.url].map((url, index) => (
                <li key={url} className="flex items-center gap-2 break-all">
                  <span className="shrink-0 font-mono text-xs">{index + 1}.</span>
                  {url}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
