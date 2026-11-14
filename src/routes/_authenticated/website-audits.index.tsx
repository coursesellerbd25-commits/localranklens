import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Globe, Search } from "lucide-react";
import { toast } from "sonner";

import { AppShell, EmptyState } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteWebsiteAudit, listWebsiteAudits } from "@/lib/api/website-audits.functions";

export const Route = createFileRoute("/_authenticated/website-audits/")({
  head: () => ({
    meta: [{ title: "Website audits — LocalRankLens" }, { name: "robots", content: "noindex" }],
  }),
  component: WebsiteAuditsPage,
});

function WebsiteAuditsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["website-audits"],
    queryFn: () => listWebsiteAudits(),
  });

  const deleteMutation = useMutation({
    mutationFn: (auditId: string) => deleteWebsiteAudit({ data: { auditId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-audits"] });
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      toast.success("Audit deleted");
      setPendingDelete(null);
    },
    onError: () => {
      toast.error("The audit could not be deleted");
      setPendingDelete(null);
    },
  });

  const rows = (query.data ?? []).filter((row) =>
    search ? row.domain.toLowerCase().includes(search.toLowerCase()) || row.url.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <AppShell
      title="Website audits"
      description="Every website SEO audit you have run, newest first."
      actions={
        <Button asChild>
          <Link to="/website-audit/new">
            <Globe className="mr-2 h-4 w-4" />
            New website audit
          </Link>
        </Button>
      }
    >
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by domain"
          className="pl-9"
          aria-label="Search website audits"
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          {query.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : query.isError ? (
            <p className="text-sm text-destructive">We couldn't load your website audits. Refresh to try again.</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title={search ? "No matches" : "No website audits yet"}
              description={
                search
                  ? "No website audit matches that search."
                  : "Enter a website URL and we'll fetch it, measure it with Google PageSpeed and score it across 26 checks."
              }
              action={
                search ? undefined : (
                  <Button asChild>
                    <Link to="/website-audit/new">Run your first website audit</Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                  <Link
                    to="/website-audits/$auditId"
                    params={{ auditId: row.id }}
                    className="min-w-0 flex-1 transition-colors hover:text-primary"
                  >
                    <span className="block truncate font-medium">{row.domain}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString()} · {row.url}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant="secondary">
                      {row.overall_score} · {row.grade}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setPendingDelete(row.id)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this website audit?</AlertDialogTitle>
            <AlertDialogDescription>
              The report and all of its findings will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete audit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
