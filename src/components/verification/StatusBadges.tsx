import { AlertTriangle, BadgeCheck, CircleDashed, CircleHelp, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Confidence, FieldStatus } from "@/lib/verification/assess";

const FIELD_STATUS: Record<FieldStatus, { label: string; className: string; icon: typeof BadgeCheck }> = {
  verified: { label: "Verified", className: "border-pass/30 bg-pass/10 text-pass", icon: BadgeCheck },
  partial: { label: "Partially verified", className: "border-primary/30 bg-primary/10 text-primary", icon: CircleDashed },
  unverified: { label: "Unverified", className: "border-warn/30 bg-warn/10 text-warn", icon: CircleHelp },
  conflicting: { label: "Conflicting information", className: "border-fail/30 bg-fail/10 text-fail", icon: AlertTriangle },
  unavailable: { label: "Unavailable", className: "border-border bg-muted text-muted-foreground", icon: CircleDashed },
};

export function FieldStatusBadge({ status, className }: { status: FieldStatus; className?: string }) {
  const meta = FIELD_STATUS[status] ?? FIELD_STATUS.unavailable;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", meta.className, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

const CONFIDENCE: Record<Confidence, { label: string; className: string; icon: typeof ShieldCheck }> = {
  high: { label: "High confidence", className: "border-pass/30 bg-pass/10 text-pass", icon: ShieldCheck },
  medium: { label: "Medium confidence", className: "border-warn/30 bg-warn/10 text-warn", icon: ShieldQuestion },
  low: { label: "Low confidence", className: "border-fail/30 bg-fail/10 text-fail", icon: ShieldAlert },
};

export function ConfidenceBadge({ confidence, className }: { confidence: Confidence; className?: string }) {
  const meta = CONFIDENCE[confidence] ?? CONFIDENCE.low;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", meta.className, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}

export const RETRIEVAL_LABELS: Record<string, string> = {
  retrieved: "Read directly",
  url_checked: "Link checked only",
  unreachable: "Could not be opened",
  blocked: "Not allowed",
};

export const METHOD_LABELS: Record<string, string> = {
  public_website_fetch: "Public website page",
  url_pattern: "Link format check",
  redirect_resolution: "Short link expanded",
  structured_data: "Website structured data",
  meta_tag: "Website page tags",
  page_link: "Link on the website",
  page_markup: "Website page text",
};

export const OWNERSHIP_LABELS: Record<string, string> = {
  confirmed: "Linked from the official website",
  mismatch: "Website links to a different page",
  not_found: "Not linked from the website",
  not_checked: "Not cross-checked",
};
