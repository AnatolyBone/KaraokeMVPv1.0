-- Lightweight product analytics for the admin bot/dashboard.
CREATE TABLE IF NOT EXISTS public.app_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    telegram_id BIGINT,
    anonymous_id TEXT,
    event_name VARCHAR(80) NOT NULL,
    route TEXT,
    app_mode VARCHAR(40),
    source VARCHAR(40) DEFAULT 'web',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON public.app_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_name_created ON public.app_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_user_id ON public.app_events(user_id);
CREATE INDEX IF NOT EXISTS idx_app_events_telegram_id ON public.app_events(telegram_id);
CREATE INDEX IF NOT EXISTS idx_app_events_anonymous_id ON public.app_events(anonymous_id);

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can write app analytics events" ON public.app_events;
CREATE POLICY "Anyone can write app analytics events"
    ON public.app_events
    FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read app analytics events" ON public.app_events;
CREATE POLICY "Admins can read app analytics events"
    ON public.app_events
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete app analytics events" ON public.app_events;
CREATE POLICY "Admins can delete app analytics events"
    ON public.app_events
    FOR DELETE
    USING (public.is_admin());
