-- Tester feedback inbox
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    telegram_id BIGINT,
    type VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (type IN ('bug', 'idea', 'other')),
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'ignored')),
    message TEXT NOT NULL,
    contact TEXT,
    screenshots JSONB DEFAULT '[]'::jsonb,
    admin_note TEXT,
    technical_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.feedback
    ADD COLUMN IF NOT EXISTS screenshots JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.feedback
    ADD COLUMN IF NOT EXISTS admin_note TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON public.feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_telegram_id ON public.feedback(telegram_id);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create feedback" ON public.feedback;
CREATE POLICY "Users can create feedback"
    ON public.feedback
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can read feedback" ON public.feedback;
CREATE POLICY "Admins can read feedback"
    ON public.feedback
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update feedback" ON public.feedback;
CREATE POLICY "Admins can update feedback"
    ON public.feedback
    FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete feedback" ON public.feedback;
CREATE POLICY "Admins can delete feedback"
    ON public.feedback
    FOR DELETE
    USING (public.is_admin());
