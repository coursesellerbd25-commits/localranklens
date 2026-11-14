<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Website audit network access goes only through `src/lib/site-audit/fetcher.server.ts` (`guardedFetch`), which re-validates scheme, host and DNS on every redirect hop — keeps the analyzer SSRF-safe.
- A check that cannot run returns `not_tested` and is excluded from scoring; a `warn` never earns a check's full weight — scores must never be fabricated or inflated.
- PageSpeed Insights is called only server-side with `PAGESPEED_API_KEY`; without the key performance checks are `not_tested` with a configuration message — keyless calls are rate-limited and unreliable.
- `profiles.plan` cannot be changed by the signed-in user (database trigger); plan changes go through server functions using the admin client — prevents self-upgrades.
- Parent route files must render `<Outlet />`; list pages that have detail children use `*.index.tsx` — otherwise detail URLs render the list.
- Engine and fetcher rules are covered by vitest tests in `src/lib/site-audit/*.test.ts`; run `bunx vitest run` after changing scoring or URL rules.
- Schema history lives in drizzle/migrations (0000-0002 carried over from the original project); add changes as new migrations, never edit or reset old ones — preserves the original data model for imports.
- Audits require a business verification (`src/lib/verification/*`, `src/lib/api/verification.functions.ts`); business name/category/city/website/phone for audits are read server-side from the verification record via `verifiedBusinessFor`, never from client input — prevents score manipulation.
- Verification records, sources and audit results are inserted only by server functions with the admin client after auth (authenticated has no INSERT on audits/findings; verifications are SELECT-only) — users cannot forge evidence or scores.
- Facebook, LinkedIn and Google pages are never scraped; only public website pages are fetched and short links expanded via `resolveShortLink` in fetcher.server.ts — respects platform terms; richer Google data needs the Places API.
- Verification confidence comes from retrieved evidence and cross-source corroboration, never from link count; "verified" needs two independent sources; conflicts force Low. Covered by `src/lib/verification/verification.test.ts`.
