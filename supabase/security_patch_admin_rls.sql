-- Security patch: lock admin role escalation and private bot data.
-- Apply this to an existing Supabase database after reviewing super-admin IDs.

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
        IF OLD.role IS DISTINCT FROM NEW.role THEN
            RAISE EXCEPTION 'Changing role is allowed only for administrators!';
        END IF;
        IF OLD.telegram_id IS DISTINCT FROM NEW.telegram_id THEN
            RAISE EXCEPTION 'Changing Telegram ID is allowed only for administrators!';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_privileged_fields_trigger();

DROP POLICY IF EXISTS "Allow all read to settings" ON public.telegram_bot_settings;
DROP POLICY IF EXISTS "Allow public read safe settings" ON public.telegram_bot_settings;
CREATE POLICY "Allow public read safe settings" ON public.telegram_bot_settings FOR SELECT USING (
    key IN ('daily_publish_limit_free', 'daily_publish_limit_pro')
    OR public.is_admin()
);

DROP POLICY IF EXISTS "Allow all read to debug logs" ON public.telegram_bot_debug_logs;
DROP POLICY IF EXISTS "Allow admin read debug logs" ON public.telegram_bot_debug_logs;
CREATE POLICY "Allow admin read debug logs" ON public.telegram_bot_debug_logs FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Allow all insert to debug logs" ON public.telegram_bot_debug_logs;
DROP POLICY IF EXISTS "Allow admin insert debug logs" ON public.telegram_bot_debug_logs;
CREATE POLICY "Allow admin insert debug logs" ON public.telegram_bot_debug_logs FOR INSERT WITH CHECK (public.is_admin());
