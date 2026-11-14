import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getVerification, verifyBusiness } from "@/lib/api/verification.functions";
import { classifySourceUrl, MAX_SOURCES, SOURCE_LABELS, SOURCE_TYPES, validateSubmittedLinks } from "@/lib/verification/sources";

export const Route = createFileRoute("/_authenticated/verify/new")({
  validateSearch: z.object({ from: z.string().uuid().optional() }),
  head: () => ({
    meta: [{ title: "Verify a business — LocalRankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: VerifyNewPage,
});

function VerifyNewPage() {
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [links, setLinks] = useState<string[]>(["", ""]);
  const [serverErrors, setServerErrors] = useState<Array<{ index: number; message: string }>>([]);
  const [touched, setTouched] = useState(false);

  const previous = useQuery({
    queryKey: ["verification", from],
    queryFn: () => getVerification({ data: { verificationId: from! } }),
    enabled: Boolean(from),
  });

  useEffect(() => {
    if (previous.data?.sources?.length) {
      setLinks(previous.data.sources.map((s) => s.submitted_url).slice(0, MAX_SOURCES));
    }
  }, [previous.data]);

  const checks = useMemo(() => links.map((l) => (l.trim() ? classifySourceUrl(l) : null)), [links]);
  const validation = useMemo(() => validateSubmittedLinks(links), [links]);

  const mutation = useMutation({
    mutationFn: () => verifyBusiness({ data: { links: links.filter((l) => l.trim()), previousVerificationId: from ?? null } }),
    onSuccess: (result) => {
      if (!result.ok) {
        // Map server error indexes (over filled links) back to rows.
        const filledIdx = links.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
        setServerErrors(result.errors.map((e) => ({ index: e.index >= 0 ? (filledIdx[e.index] ?? -1) : -1, message: e.message })));
        toast.error("None of the links could be used. Check the messages below.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["verifications"] });
      toast.success("Business details retrieved");
      navigate({ to: "/verify/$verificationId", params: { verificationId: result.verificationId } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Verification failed"),
  });

  const rowError = (index: number): string | null => {
    const server = serverErrors.find((e) => e.index === index);
    if (server) return server.message;
    if (!touched) return null;
    return validation.errors.find((e) => e.index === index)?.message ?? null;
  };
  const generalError = touched ? validation.errors.find((e) => e.index === -1)?.message : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setServerErrors([]);
    if (validation.errors.length > 0 || validation.sources.length === 0) return;
    mutation.mutate();
  };

  return (
    <AppShell
      title={from ? "Replace links and verify again" : "Verify a business"}
      description="Add the business's official links. We read the details from them — you don't type them in."
    >
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6" noValidate>
        {from ? (
          <Alert>
            <ShieldCheck className="h-4 w-4" aria-hidden />
            <AlertTitle>Your earlier verification is kept</AlertTitle>
            <AlertDescription>
              Change or replace any link below. A new verification is saved and linked to the earlier one, so the history of what changed is preserved.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Official links</CardTitle>
            <CardDescription>
              At least one is required, up to {MAX_SOURCES}. Accepted: {SOURCE_TYPES.map((t) => SOURCE_LABELS[t]).join(", ")}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {links.map((link, index) => {
              const check = checks[index];
              const error = rowError(index);
              return (
                <div key={index} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`link-${index}`}>Link {index + 1}</Label>
                    {check?.ok ? (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {SOURCE_LABELS[check.type]}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id={`link-${index}`}
                      inputMode="url"
                      autoComplete="off"
                      placeholder={index === 0 ? "https://yourbusiness.com" : "https://maps.app.goo.gl/… or facebook.com/yourpage"}
                      value={link}
                      disabled={mutation.isPending}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => {
                        const next = [...links];
                        next[index] = e.target.value;
                        setLinks(next);
                        setServerErrors([]);
                      }}
                      onBlur={() => link.trim() && setTouched(true)}
                    />
                    {links.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove link ${index + 1}`}
                        disabled={mutation.isPending}
                        onClick={() => setLinks(links.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  {error ? (
                    <p className="text-sm text-destructive" role="alert">{error}</p>
                  ) : null}
                </div>
              );
            })}
            {links.length < MAX_SOURCES ? (
              <Button type="button" variant="outline" size="sm" disabled={mutation.isPending} onClick={() => setLinks([...links, ""])}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                Add another link
              </Button>
            ) : null}
            {generalError ? <p className="text-sm text-destructive" role="alert">{generalError}</p> : null}
          </CardContent>
        </Card>

        {mutation.isPending ? (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <AlertTitle>Reading your links</AlertTitle>
            <AlertDescription>
              Opening the website and its contact page, expanding short links and cross-checking the details. This can take up to 30 seconds.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
            {mutation.isPending ? "Verifying…" : "Retrieve business details"}
          </Button>
          <p className="text-xs text-muted-foreground">
            We only read public website pages. Google, Facebook and LinkedIn pages are not scraped — their links are checked and cross-matched with the website.
          </p>
        </div>
      </form>
    </AppShell>
  );
}
