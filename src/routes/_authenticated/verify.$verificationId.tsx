import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, FilePlus2, Globe, History, Info, RefreshCw } from "lucide-react";

import { AppShell, EmptyState } from "@/components/app/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceBadge, FieldStatusBadge, METHOD_LABELS, OWNERSHIP_LABELS, RETRIEVAL_LABELS } from "@/components/verification/StatusBadges";
import { getVerification, type SourceRow } from "@/lib/api/verification.functions";
import { FIELD_LABELS, type Conflict, type Confidence, type VerifiedField, type VerifiedFields } from "@/lib/verification/assess";
import { SOURCE_LABELS, type SourceType } from "@/lib/verification/sources";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/verify/$verificationId")({
  head: () => ({
    meta: [{ title: "Business verification — RankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: VerificationDetailPage,
});

const FIELD_ORDER: Array<keyof VerifiedFields> = [
  "name", "website", "category", "address", "city", "phone", "email", "hours", "services", "serviceAreas", "description", "socialProfiles",
];

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "string") return value;
  return "";
}

function sourceChanges(current: SourceRow[], previous: SourceRow[] | null) {
  if (!previous) return null;
  const key = (s: SourceRow) => `${s.source_type}|${s.normalized_url}`;
  const prevKeys = new Map(previous.map((s) => [key(s), s]));
  const curKeys = new Map(current.map((s) => [key(s), s]));
  const added = current.filter((s) => !prevKeys.has(key(s)));
  const removed = previous.filter((s) => !curKeys.has(key(s)));
  return { added, removed };
}

function VerificationDetailPage() {
  const { verificationId } = Route.useParams();
  const query = useQuery({
    queryKey: ["verification", verificationId],
    queryFn: () => getVerification({ data: { verificationId } }),
  });

  if (query.isLoading) {
    return (
      <AppShell title="Business verification">
        <Skeleton className="h-96 rounded-xl" />
      </AppShell>
    );
  }
  if (!query.data) {
    return (
      <AppShell title="Business verification">
        <EmptyState
          title="Verification not found"
          description="It may belong to another account or it was removed."
          action={<Button asChild><Link to="/verify">Back to verifications</Link></Button>}
        />
      </AppShell>
    );
  }

  const { verification, sources, history, previousSources } = query.data;
  const fields = (verification.fields ?? {}) as unknown as VerifiedFields;
  const conflicts = (verification.conflicts ?? []) as unknown as Conflict[];
  const limitations = (verification.limitations ?? {}) as { notes?: string[]; confidenceReasons?: string[] };
  const changes = sourceChanges(sources, previousSources);
  const hasWebsite = sources.some((s) => s.source_type === "website" && s.retrieval_status === "retrieved");
  const seriousConflicts = conflicts.filter((c) => c.severity !== "low");

  return (
    <AppShell
      title={verification.business_name ?? verification.website_domain ?? "Unnamed business"}
      description={`Verified ${new Date(verification.created_at).toLocaleString()} from ${sources.length} official link${sources.length === 1 ? "" : "s"}`}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/audit/new" search={{ verification: verification.id }}>
              <FilePlus2 className="mr-2 h-4 w-4" aria-hidden />
              Run profile audit
            </Link>
          </Button>
          {hasWebsite ? (
            <Button asChild variant="outline">
              <Link to="/website-audit/new" search={{ verification: verification.id }}>
                <Globe className="mr-2 h-4 w-4" aria-hidden />
                Run website audit
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/verify/new" search={{ from: verification.id }}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Replace links & verify again
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Source confidence</CardDescription>
              <div className="pt-1"><ConfidenceBadge confidence={verification.confidence as Confidence} /></div>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {(limitations.confidenceReasons ?? []).map((r) => <li key={r}>{r}</li>)}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Confidence reflects how well the links back each other up — not how well the business performs in search. Adding more links doesn't raise it unless they confirm each other.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Business Information Verification score</CardDescription>
              <CardTitle className="font-display text-4xl">
                {verification.verification_score}
                <span className="text-lg font-normal text-muted-foreground">/100</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {verification.is_provisional ? (
                <p className="font-medium text-warn">Provisional — there isn't enough confirmed evidence yet.</p>
              ) : null}
              <p>
                Counts only details backed by evidence: a detail confirmed by two sources earns full points, a detail found on one source earns half, and unverified, conflicting or missing details earn nothing.
              </p>
              <p className="text-xs">This score is separate from the Website SEO, Google Business Profile and Local Visibility Readiness scores.</p>
            </CardContent>
          </Card>
        </div>

        {seriousConflicts.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>Conflicting information</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {seriousConflicts.map((c) => <li key={c.message}>{c.message}</li>)}
              </ul>
              <p className="mt-2">Replace any link that doesn't belong to this business and verify again.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business details</CardTitle>
            <CardDescription>Read-only. Each detail shows where it came from and how sure we are.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {FIELD_ORDER.map((key) => {
              const field = (fields[key] ?? { value: null, status: "unavailable", evidence: [], note: "" }) as VerifiedField<unknown>;
              return (
                <div key={key} className="grid gap-2 px-6 py-4 md:grid-cols-[180px_1fr_auto] md:items-start">
                  <p className="text-sm font-medium">{FIELD_LABELS[key]}</p>
                  <div className="min-w-0 space-y-1">
                    <p className={cn("break-words text-sm", field.status === "unavailable" && "text-muted-foreground")}>
                      {field.status === "unavailable" || !valueText(field.value) ? "Unavailable" : valueText(field.value)}
                    </p>
                    {field.note ? <p className="text-xs text-muted-foreground">{field.note}</p> : null}
                    {field.evidence?.length ? (
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {field.evidence.map((e, i) => (
                          <li key={i}>
                            Evidence: {METHOD_LABELS[e.method] ?? e.method} — {e.detail}
                            {e.pageUrl ? (
                              <>
                                {" "}on{" "}
                                <a href={e.pageUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                                  {e.pageUrl.replace(/^https?:\/\//, "")}
                                </a>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <FieldStatusBadge status={field.status} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sources checked</CardTitle>
            <CardDescription>What was inspected for each link, and how.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.map((s) => {
              const extracted = (s.extracted ?? {}) as { pagesRead?: string[]; placeName?: string | null; identifier?: string | null };
              return (
                <div key={s.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{SOURCE_LABELS[s.source_type as SourceType] ?? s.source_type}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        s.retrieval_status === "retrieved" ? "bg-pass/10 text-pass" : s.retrieval_status === "url_checked" ? "bg-secondary text-secondary-foreground" : "bg-fail/10 text-fail",
                      )}
                    >
                      {RETRIEVAL_LABELS[s.retrieval_status] ?? s.retrieval_status}
                    </span>
                  </div>
                  <a href={s.final_url ?? s.normalized_url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm text-primary underline-offset-4 hover:underline">
                    {s.submitted_url}
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div><dt className="inline font-medium text-foreground">Method: </dt><dd className="inline">{METHOD_LABELS[s.retrieval_method] ?? s.retrieval_method}</dd></div>
                    <div><dt className="inline font-medium text-foreground">Cross-check: </dt><dd className="inline">{s.source_type === "website" ? "Main source — other links are checked against it" : (OWNERSHIP_LABELS[s.ownership_link] ?? s.ownership_link)}</dd></div>
                    {s.http_status ? <div><dt className="inline font-medium text-foreground">Response: </dt><dd className="inline">HTTP {s.http_status}</dd></div> : null}
                    {extracted.placeName ? <div><dt className="inline font-medium text-foreground">Place name in link: </dt><dd className="inline">{extracted.placeName}</dd></div> : null}
                    {extracted.pagesRead?.length ? <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Pages read: </dt><dd className="inline break-all">{extracted.pagesRead.join(", ")}</dd></div> : null}
                    <div><dt className="inline font-medium text-foreground">Checked: </dt><dd className="inline">{new Date(s.fetched_at).toLocaleString()}</dd></div>
                  </dl>
                  {s.error_message ? <p className="mt-2 text-sm text-destructive">{s.error_message}</p> : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {(limitations.notes?.length ?? 0) > 0 || conflicts.some((c) => c.severity === "low") ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Info className="h-4 w-4" aria-hidden />Limitations and notes</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {(limitations.notes ?? []).map((n) => <li key={n}>{n}</li>)}
                {conflicts.filter((c) => c.severity === "low").map((c) => <li key={c.message}>{c.message}</li>)}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {history.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" aria-hidden />Earlier verifications</CardTitle>
              {changes ? (
                <CardDescription>
                  Since the previous one: {changes.added.length} link{changes.added.length === 1 ? "" : "s"} added or replaced, {changes.removed.length} removed.
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {changes && (changes.added.length > 0 || changes.removed.length > 0) ? (
                <ul className="space-y-1 text-sm">
                  {changes.added.map((s) => <li key={`a-${s.id}`} className="break-all"><span className="font-medium text-pass">Added</span> {SOURCE_LABELS[s.source_type as SourceType]}: {s.submitted_url}</li>)}
                  {changes.removed.map((s) => <li key={`r-${s.id}`} className="break-all"><span className="font-medium text-fail">Removed</span> {SOURCE_LABELS[s.source_type as SourceType]}: {s.submitted_url}</li>)}
                </ul>
              ) : null}
              <ul className="divide-y divide-border rounded-lg border border-border">
                {history.map((h) => (
                  <li key={h.id}>
                    <Link to="/verify/$verificationId" params={{ verificationId: h.id }} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-muted">
                      <span>{new Date(h.created_at).toLocaleString()} — {h.business_name ?? "Unnamed"}</span>
                      <span className="flex items-center gap-2">
                        <ConfidenceBadge confidence={h.confidence as Confidence} />
                        <span className="text-muted-foreground">{h.verification_score}/100</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
