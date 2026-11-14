-- ============ Business Verification (stage 1) ============
CREATE TYPE public.verification_confidence AS ENUM ('high', 'medium', 'low');

CREATE TABLE public.business_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  previous_verification_id uuid REFERENCES public.business_verifications(id) ON DELETE SET NULL,
  business_name text,
  website_domain text,
  confidence public.verification_confidence NOT NULL DEFAULT 'low',
  verification_score integer NOT NULL DEFAULT 0 CHECK (verification_score BETWEEN 0 AND 100),
  is_provisional boolean NOT NULL DEFAULT true,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_version text NOT NULL DEFAULT 'bv1',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_verifications_user_created_idx ON public.business_verifications (user_id, created_at DESC);
CREATE INDEX business_verifications_previous_idx ON public.business_verifications (previous_verification_id);
-- Read-only for signed-in users: verification evidence is written only by the server.
GRANT SELECT ON public.business_verifications TO authenticated;
GRANT ALL ON public.business_verifications TO service_role;
ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own verifications" ON public.business_verifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.business_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES public.business_verifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('website', 'google_business_profile', 'google_maps', 'facebook', 'linkedin')),
  submitted_url text NOT NULL,
  normalized_url text NOT NULL,
  final_url text,
  retrieval_status text NOT NULL CHECK (retrieval_status IN ('retrieved', 'url_checked', 'unreachable', 'blocked')),
  retrieval_method text NOT NULL,
  http_status integer,
  ownership_link text NOT NULL DEFAULT 'not_checked' CHECK (ownership_link IN ('confirmed', 'mismatch', 'not_found', 'not_checked')),
  extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  sort_order integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_sources_verification_idx ON public.business_sources (verification_id, sort_order);
CREATE INDEX business_sources_user_idx ON public.business_sources (user_id);
GRANT SELECT ON public.business_sources TO authenticated;
GRANT ALL ON public.business_sources TO service_role;
ALTER TABLE public.business_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own sources" ON public.business_sources FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ============ Link audits to the verification they were based on ============
ALTER TABLE public.audits ADD COLUMN verification_id uuid REFERENCES public.business_verifications(id) ON DELETE SET NULL;
ALTER TABLE public.website_audits ADD COLUMN verification_id uuid REFERENCES public.business_verifications(id) ON DELETE SET NULL;
CREATE INDEX audits_verification_idx ON public.audits (verification_id);
CREATE INDEX website_audits_verification_idx ON public.website_audits (verification_id);

-- ============ Anti-manipulation: audit results are written only by the server ============
REVOKE INSERT ON public.audits FROM authenticated;
REVOKE INSERT ON public.audit_findings FROM authenticated;
REVOKE INSERT ON public.website_audits FROM authenticated;
REVOKE INSERT ON public.website_audit_findings FROM authenticated;