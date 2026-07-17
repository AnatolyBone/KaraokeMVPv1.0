-- Stage 1.5 production hardening. Apply after mvsep_stems_stage1.sql.

ALTER TABLE public.song_stems
  ADD COLUMN IF NOT EXISTS persistence_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS persistence_failure_code TEXT,
  ADD COLUMN IF NOT EXISTS next_persistence_retry_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS requires_new_separation BOOLEAN NOT NULL DEFAULT false;

-- Durable stems survive deletion of an optional catalog song link.
ALTER TABLE public.song_stems
  DROP CONSTRAINT IF EXISTS song_stems_song_id_fkey;
ALTER TABLE public.song_stems
  ADD CONSTRAINT song_stems_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE SET NULL;

UPDATE public.song_stems
SET status = 'queued'
WHERE status = 'pending';

ALTER TABLE public.song_stems
  DROP CONSTRAINT IF EXISTS song_stems_status_check;

ALTER TABLE public.song_stems
  ADD CONSTRAINT song_stems_status_check
  CHECK (status IN (
    'queued', 'submitting', 'waiting', 'processing', 'distributing', 'merging',
    'persisting', 'completed', 'failed', 'cancelled'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.song_stems'::regclass
      AND conname = 'song_stems_completed_assets_check'
  ) THEN
    ALTER TABLE public.song_stems
      ADD CONSTRAINT song_stems_completed_assets_check
      CHECK (
        status <> 'completed'
        OR (
          vocal_storage_path IS NOT NULL
          AND instrumental_storage_path IS NOT NULL
          AND outputs_saved_at IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_song_stems_persistence_retry
  ON public.song_stems(next_persistence_retry_at, updated_at)
  WHERE provider = 'mvsep' AND status = 'persisting';

DROP POLICY IF EXISTS "Users can create their own MVSEP jobs" ON public.song_stems;
REVOKE INSERT, UPDATE, DELETE ON public.song_stems FROM anon, authenticated;

-- Signed URLs are issued only by the Edge Function after checking owner_id.
-- No direct browser CRUD policy is needed for either private bucket.
DROP POLICY IF EXISTS "Users can read their own stem results" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own stem inputs" ON storage.objects;

COMMENT ON COLUMN public.song_stems.persistence_failure_code IS
  'Machine-readable persistence failure; external_unavailable and classification_ambiguous require a new separation.';
COMMENT ON COLUMN public.song_stems.requires_new_separation IS
  'True only when existing external outputs cannot be safely persisted and retrying the same URLs is not useful.';
