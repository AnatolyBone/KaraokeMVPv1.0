-- Включение расширения для генерации UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ТАБЛИЦА ПРОФИЛЕЙ ПОЛЬЗОВАТЕЛЕЙ (Публичная схема, связь с auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    avatar_url TEXT,
    telegram_id BIGINT UNIQUE NOT NULL,
    role VARCHAR(20) DEFAULT 'free' CHECK (role IN ('free', 'pro', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Включение RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Политики доступа
DROP POLICY IF EXISTS "Профили видны всем" ON public.profiles;
CREATE POLICY "Профили видны всем" ON public.profiles FOR SELECT USING (true);

-- Хелпер для проверки, является ли текущий пользователь администратором
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Пользователь может менять только свой профиль" ON public.profiles;
DROP POLICY IF EXISTS "Пользователь может менять свой профиль, а админы — любые профили" ON public.profiles;
CREATE POLICY "Пользователь может менять свой профиль, а админы — любые профили" ON public.profiles 
    FOR UPDATE USING (auth.uid() = id OR public.is_admin());

-- Функция триггера для защиты супер-администратора от удаления и изменения роли через API
CREATE OR REPLACE FUNCTION public.protect_super_admin_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Внимание: 11111111 - это плейсхолдер. Замените на реальный telegram_id владельца.
    -- Роль супер-админа нельзя изменить, а профиль нельзя удалить.
    IF (OLD.telegram_id = 11111111 OR OLD.telegram_id = 8668851942) THEN
        IF (TG_OP = 'DELETE') THEN
            RAISE EXCEPTION 'Удаление супер-администратора запрещено!';
        ELSIF (TG_OP = 'UPDATE' AND NEW.role <> 'admin') THEN
            RAISE EXCEPTION 'Понижение роли супер-администратора запрещено!';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_super_admin ON public.profiles;
CREATE TRIGGER protect_super_admin
    BEFORE UPDATE OR DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_super_admin_trigger();

-- 2. ТАБЛИЦА ПЕСЕН / ТРЕКОВ (Общий индекс)
CREATE TABLE IF NOT EXISTS public.songs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    artist VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    duration_seconds DOUBLE PRECISION,
    bpm INT,
    beats DOUBLE PRECISION[] DEFAULT '{}', -- Массив временных меток долей битов
    lrclib_id BIGINT,                      -- Ссылка на оригинал из LRCLIB (если импортировано)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Создаем уникальный индекс по артисту и названию для предотвращения дублирования песен
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_artist_title ON public.songs (LOWER(artist), LOWER(title));

-- Включение RLS для public.songs
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Песни видны всем" ON public.songs;
CREATE POLICY "Песни видны всем" ON public.songs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Авторизованные могут добавлять песни" ON public.songs;
CREATE POLICY "Авторизованные могут добавлять песни" ON public.songs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Администраторы могут удалять/изменять песни" ON public.songs;
CREATE POLICY "Администраторы могут удалять/изменять песни" ON public.songs FOR ALL USING (public.is_admin());

-- 3. ТАБЛИЦА ЛИЧНЫХ ПРОЕКТОВ (Черновики пользователей)
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    song_id UUID REFERENCES public.songs(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    lines JSONB NOT NULL,                 -- Массив LyricLine[] (хранит слова, слоги, тайминги и переводы)
    video_style JSONB NOT NULL,           -- Объект VideoStyleOptions
    audio_file_name VARCHAR(255),         -- Имя локального аудиофайла
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Политики доступа для проектов
DROP POLICY IF EXISTS "Пользователь видит только свои проекты" ON public.projects;
CREATE POLICY "Пользователь видит только свои проекты" ON public.projects 
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Пользователь может создавать свои проекты" ON public.projects;
CREATE POLICY "Пользователь может создавать свои проекты" ON public.projects 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Пользователь может обновлять свои проекты" ON public.projects;
CREATE POLICY "Пользователь может обновлять свои проекты" ON public.projects 
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Пользователь может удалять свои проекты" ON public.projects;
CREATE POLICY "Пользователь может удалять свои проекты" ON public.projects 
    FOR DELETE USING (auth.uid() = user_id);

-- 4. ТАБЛИЦА ПУБЛИЧНЫХ ПУБЛИКАЦИЙ (Библиотека готового караоке)
CREATE TABLE IF NOT EXISTS public.published_karaoke (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE NOT NULL,
    publisher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
    lines JSONB NOT NULL,                 -- Массив LyricLine[] (доработанный пословный/послоговой тайминг)
    video_style JSONB NOT NULL,           -- Рекомендованный стиль видео
    audio_storage_path TEXT,              -- Ссылка на сжатый MP3 в Supabase Storage
    cover_storage_path TEXT,              -- Ссылка на WebP обложку в Supabase Storage
    likes_count INT DEFAULT 0,
    plays_count INT DEFAULT 0,
    parent_project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

ALTER TABLE public.published_karaoke ENABLE ROW LEVEL SECURITY;

-- Политики доступа для публичных треков
DROP POLICY IF EXISTS "Публичная библиотека доступна всем" ON public.published_karaoke;
CREATE POLICY "Публичная библиотека доступна всем" ON public.published_karaoke 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Зарегистрированные могут публиковать работы" ON public.published_karaoke;
CREATE POLICY "Зарегистрированные могут публиковать работы" ON public.published_karaoke 
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Владелец публикации может её обновлять/удалять" ON public.published_karaoke;
DROP POLICY IF EXISTS "Владелец или админ может изменять/удалять публикации" ON public.published_karaoke;
CREATE POLICY "Владелец или админ может изменять/удалять публикации" ON public.published_karaoke 
    FOR ALL USING (auth.uid() = publisher_id OR public.is_admin());

-- 5. ТАБЛИЦА ДЛЯ ИИ-СТЕМОРАЗДЕЛЕНИЯ (Вспомогательная, под PRO подписку)
CREATE TABLE IF NOT EXISTS public.song_stems (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    song_id UUID REFERENCES public.songs(id) ON DELETE CASCADE NOT NULL,
    vocal_storage_path TEXT NOT NULL,       -- Путь к извлеченному вокалу (Supabase Storage)
    instrumental_storage_path TEXT NOT NULL, -- Путь к чистой фонограмме (Supabase Storage)
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- RLS для stems (доступно только владельцам Pro/Admin или авторам песни)
ALTER TABLE public.song_stems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Просмотр степлитов доступен авторизованным" ON public.song_stems;
CREATE POLICY "Просмотр степлитов доступен авторизованным" ON public.song_stems
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Создавать задачи на разделение могут пользователи с pro/admin" ON public.song_stems;
CREATE POLICY "Создавать задачи на разделение могут пользователи с pro/admin" ON public.song_stems
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() AND (profiles.role = 'pro' OR profiles.role = 'admin')
        )
    );

DROP POLICY IF EXISTS "Администраторы могут управлять стемами" ON public.song_stems;
CREATE POLICY "Администраторы могут управлять стемами" ON public.song_stems
    FOR ALL USING (public.is_admin());

-- 6. ТАБЛИЦА СЕССИЙ АВТОРИЗАЦИИ ЧЕРЕЗ TELEGRAM BOT DEEP LINK
CREATE TABLE IF NOT EXISTS public.telegram_auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'expired')),
    telegram_id BIGINT,
    auth_email VARCHAR(255),
    auth_password TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Включение RLS
ALTER TABLE public.telegram_auth_sessions ENABLE ROW LEVEL SECURITY;

-- Разрешаем чтение и удаление сессии любому клиенту, знающему UUID
DROP POLICY IF EXISTS "Allow select auth session by ID" ON public.telegram_auth_sessions;
CREATE POLICY "Allow select auth session by ID" ON public.telegram_auth_sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow delete auth session by ID" ON public.telegram_auth_sessions;
CREATE POLICY "Allow delete auth session by ID" ON public.telegram_auth_sessions FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow insert auth session" ON public.telegram_auth_sessions;
CREATE POLICY "Allow insert auth session" ON public.telegram_auth_sessions FOR INSERT WITH CHECK (true);

-- 7. ТАБЛИЦА ОБЩИХ ТРЕКОВ ИЗ TELEGRAM BOT
CREATE TABLE IF NOT EXISTS public.telegram_audio_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT NOT NULL,
    file_id TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT,
    duration INT,
    artist VARCHAR(255),
    title VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Включение RLS
ALTER TABLE public.telegram_audio_shares ENABLE ROW LEVEL SECURITY;

-- Разрешаем чтение и удаление треков только владельцу (по связи profiles.telegram_id = telegram_id)
DROP POLICY IF EXISTS "Users can see their own shared tracks" ON public.telegram_audio_shares;
CREATE POLICY "Users can see their own shared tracks" ON public.telegram_audio_shares
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.telegram_id = telegram_audio_shares.telegram_id
        )
    );

DROP POLICY IF EXISTS "Users can delete their own shared tracks" ON public.telegram_audio_shares;
CREATE POLICY "Users can delete their own shared tracks" ON public.telegram_audio_shares
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.telegram_id = telegram_audio_shares.telegram_id
        )
    );

-- 8. ТАБЛИЦА НАСТРОЕК БОТА (Включая ID канала-хранилища)
CREATE TABLE IF NOT EXISTS public.telegram_bot_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

-- Включение RLS
ALTER TABLE public.telegram_bot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all read to settings" ON public.telegram_bot_settings;
CREATE POLICY "Allow all read to settings" ON public.telegram_bot_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow admin modify settings" ON public.telegram_bot_settings;
CREATE POLICY "Allow admin modify settings" ON public.telegram_bot_settings FOR ALL USING (public.is_admin());

-- 9. ТАБЛИЦА ДЛЯ ОТЛАДКИ ВЕБХУКОВ ТЕЛЕГРАМА
CREATE TABLE IF NOT EXISTS public.telegram_bot_debug_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

ALTER TABLE public.telegram_bot_debug_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all read to debug logs" ON public.telegram_bot_debug_logs;
CREATE POLICY "Allow all read to debug logs" ON public.telegram_bot_debug_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all insert to debug logs" ON public.telegram_bot_debug_logs;
CREATE POLICY "Allow all insert to debug logs" ON public.telegram_bot_debug_logs FOR INSERT WITH CHECK (true);





