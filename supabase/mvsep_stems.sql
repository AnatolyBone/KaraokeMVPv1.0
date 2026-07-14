-- MVSEP stem separation queue.
-- Run this in the Karaoke Supabase project before deploying/using mvsep-stems.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.song_stems
  ALTER COLUMN song_id DROP NOT NULL,
  ALTER COLUMN vocal_storage_path DROP NOT NULL,
  ALTER COLUMN instrumental_storage_path DROP NOT NULL;

ALTER TABLE public.song_stems
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'mvsep',
  ADD COLUMN IF NOT EXISTS provider_job_hash TEXT,
  ADD COLUMN IF NOT EXISTS provider_job_url TEXT,
  ADD COLUMN IF NOT EXISTS sep_type INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS output_format INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS input_file_name TEXT,
  ADD COLUMN IF NOT EXISTS result_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS mvsep_status TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname
  INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.song_stems'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.song_stems DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE public.song_stems
SET status = 'queued'
WHERE status = 'pending';

ALTER TABLE public.song_stems
  ADD CONSTRAINT song_stems_status_check
  CHECK (status IN ('queued', 'submitting', 'waiting', 'processing', 'distributing', 'merging', 'completed', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_song_stems_owner_id ON public.song_stems(owner_id);
CREATE INDEX IF NOT EXISTS idx_song_stems_provider_status ON public.song_stems(provider, status, created_at);
CREATE INDEX IF NOT EXISTS idx_song_stems_provider_hash ON public.song_stems(provider_job_hash);

CREATE OR REPLACE FUNCTION public.touch_song_stems_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_song_stems_updated_at ON public.song_stems;
CREATE TRIGGER touch_song_stems_updated_at
  BEFORE UPDATE ON public.song_stems
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_song_stems_updated_at();

DROP POLICY IF EXISTS "Просмотр степлитов доступен авторизованным" ON public.song_stems;
DROP POLICY IF EXISTS "Создавать задачи на разделение могут пользователи с pro/admin" ON public.song_stems;
DROP POLICY IF EXISTS "Администраторы могут управлять стемами" ON public.song_stems;
DROP POLICY IF EXISTS "Users can read their own MVSEP jobs" ON public.song_stems;
DROP POLICY IF EXISTS "Users can create their own MVSEP jobs" ON public.song_stems;
DROP POLICY IF EXISTS "Admins can manage MVSEP jobs" ON public.song_stems;

CREATE POLICY "Users can read their own MVSEP jobs" ON public.song_stems
  FOR SELECT USING (auth.uid() = owner_id OR public.is_admin());

CREATE POLICY "Users can create their own MVSEP jobs" ON public.song_stems
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role IN ('pro', 'admin')
          OR (
            profiles.plan = 'plus'
            AND profiles.plus_until IS NOT NULL
            AND profiles.plus_until > NOW()
          )
        )
    )
  );

CREATE POLICY "Admins can manage MVSEP jobs" ON public.song_stems
  FOR ALL USING (public.is_admin());

INSERT INTO storage.buckets (id, name, public)
VALUES ('stem_inputs', 'stem_inputs', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('stem_results', 'stem_results', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.telegram_bot_settings (key, value)
VALUES ('mvsep_max_concurrent_jobs', '1')
ON CONFLICT (key) DO NOTHING;
