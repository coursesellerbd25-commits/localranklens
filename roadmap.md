# Roadmap — Website SEO audit engine (extends LocalRankLens)

1. [x] Inspect codebase, schema, auth, engine, plans
2. [x] Database: website_audits, website_audit_findings, psi_cache (+RLS, grants, usage function) — applied on this project's backend
3. [x] Core engine: URL guard (SSRF), fetcher, HTML parser, checks, weighted scoring, recommendations
4. [x] PageSpeed Insights: key configured, real mobile+desktop results verified end to end
5. [x] Local Visibility Readiness section (separate score + disclaimers)
6. [x] Server functions + shared monthly quota
7. [x] UI: form, report, history, nav, dashboard (fixed report page showing the list)
8. [x] Tests: 25 vitest cases (scoring, partial credit, URL rule, SSRF guard); browser E2E (signup, login, logout, persistence, cross-user isolation, GBP audit, PDF)
9. [x] Google Business Profile audit verified end to end (score 33 saved to history)
10. [x] Code moved to the new Lovable account; fresh database built from the same migrations; 25 tests pass; website audit verified end to end
11. [x] Import existing users/audits — skipped (user: old data not needed)
12. [x] PageSpeed key saved securely and tested with Google (200 OK)
13. Business Verification Upgrade
    - [x] 13a Mandatory official links (1–5), URL validation, source-type detection
    - [x] 13b Retrieval from the public website (+contact page), short-link expansion; FB/LinkedIn/Google not scraped
    - [x] 13c Read-only verified record: per-field status, evidence, conflicts, High/Medium/Low confidence, verification score, history on re-verify
    - [x] 13d Audits require a verification; business identity locked; audit results written server-side only (forgery blocked)
    - [ ] 13e Google Places data to auto-fill and lock profile answers (blocked: needs Google Places API key from the user)
    - [ ] 13f Evidence shown on each audit finding + source type labels in reports
    - [ ] 13g Share links (copy/native/email/WhatsApp), public/private, revoke, secure tokens
    - [ ] 13h Public report page with branding + disclaimers; real PDF download
