-- Stage 1: durable MVSEP stems and reload-safe job recovery.
-- Apply after schema.sql and mvsep_stems.sql.

ALTER TABLE public.song_stems
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS source_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS source_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS source_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS vocal_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS vocal_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS vocal_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS instrumental_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS instrumental_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS instrumental_duration_seconds DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS outputs_saved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS outputs_persist_error TEXT,
  ADD COLUMN IF NOT EXISTS input_deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP WITH TIME ZONE;

-- Preserve the legacy name while ensuring new rows have the canonical source name.
UPDATE public.song_stems
SET source_file_name = input_file_name
WHERE source_file_name IS NULL AND input_file_name IS NOT NULL;

ALTER TABLE public.song_stems
  DROP CONSTRAINT IF EXISTS song_stems_status_check;

UPDATE public.song_stems
SET status = 'queued'
WHERE status = 'pending';

ALTER TABLE public.song_stems
  ADD CONSTRAINT song_stems_status_check
  CHECK (status IN (
    'queued', 'submitting', 'waiting', 'processing', 'distributing', 'merging',
    'persisting', 'completed', 'failed', 'cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_song_stems_project_id
  ON public.song_stems(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_song_stems_owner_fingerprint
  ON public.song_stems(owner_id, source_fingerprint, created_at DESC)
  WHERE source_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_song_stems_persisting
  ON public.song_stems(updated_at)
  WHERE provider = 'mvsep' AND status = 'persisting';

-- Claims queue rows atomically across concurrent scheduled/manual pumps.
CREATE OR REPLACE FUNCTION public.claim_mvsep_queued_jobs(p_limit INTEGER)
RETURNS SETOF public.song_stems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_limit, 0) <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.song_stems
    WHERE provider = 'mvsep' AND status = 'queued'
    ORDER BY created_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(p_limit, 10)
  )
  UPDATE public.song_stems AS jobs
  SET status = 'submitting', error_message = NULL
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mvsep_queued_jobs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_mvsep_queued_jobs(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_mvsep_queued_jobs(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mvsep_queued_jobs(INTEGER) TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('stem_results', 'stem_results', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('stem_inputs', 'stem_inputs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- The browser receives assets only through owner-checked signed URLs.
DROP POLICY IF EXISTS "Users can read their own stem results" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own stem inputs" ON storage.objects;

DROP POLICY IF EXISTS "Users can create their own MVSEP jobs" ON public.song_stems;
REVOKE INSERT, UPDATE, DELETE ON public.song_stems FROM anon, authenticated;

COMMENT ON COLUMN public.song_stems.result_files IS
  'Raw MVSEP result metadata retained for diagnostics/backfill; never a stable client asset URL.';
COMMENT ON COLUMN public.song_stems.source_fingerprint IS
  'Lowercase SHA-256 of the complete source file bytes.';
COMMENT ON COLUMN public.song_stems.outputs_saved_at IS
  'Set only after both vocal and instrumental objects exist in private stem_results storage.';
