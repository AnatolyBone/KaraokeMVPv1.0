import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';
import { localization } from '../utils/localization';
import { User, LogOut, Cloud, RefreshCw, Key, ShieldCheck } from 'lucide-react';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
        };
      };
    };
    onTelegramAuth?: (user: any) => void;
  }
}

export const AuthSection: React.FC = () => {
  const {
    user,
    setUser,
    syncing,
    syncProjects,
    language,
    theme,
  } = useKaraokeStore();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [waitingForTelegram, setWaitingForTelegram] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const dict = localization[language];

  // Проверка, запущены ли мы внутри Telegram WebApp
  const isTelegramWebApp = !!window.Telegram?.WebApp?.initData;



  // Вход внутри Telegram WebApp (использует WebApp initData)
  const handleTelegramWebAppAuth = async () => {
    setErrorMsg(null);
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.initDataUnsafe?.user) {
      setErrorMsg('Telegram WebApp context not found');
      return;
    }

    try {
      // Собираем данные пользователя WebApp аналогично виджету
      const authData = {
        id: tg.initDataUnsafe.user.id,
        first_name: tg.initDataUnsafe.user.first_name,
        last_name: tg.initDataUnsafe.user.last_name,
        username: tg.initDataUnsafe.user.username,
        photo_url: tg.initDataUnsafe.user.photo_url,
        // Для WebApp подпись проверяется через полную строку initData на бэкенде.
        // Передаем весь initData
        initData: tg.initData,
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ authData }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to authenticate');
      }

      const { email, password } = await response.json();

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (data.user) {
        setUser(data.user);
        useKaraokeStore.getState().syncProjects();
      }
    } catch (err: any) {
      console.error('WebApp Auth Error:', err);
      setErrorMsg(err.message || 'Ошибка авторизации Telegram WebApp');
    }
  };

  const handleTelegramAppLinkAuth = async () => {
    setErrorMsg(null);
    setWaitingForTelegram(true);
    
    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);

    try {
      const { error } = await supabase
        .from('telegram_auth_sessions')
        .insert({ id: newSessionId, status: 'pending' });

      if (error) throw error;

      const botName = 'lrckaraoke_bot';
      const tgLink = `https://t.me/${botName}?start=auth_${newSessionId}`;
      window.open(tgLink, '_blank');

      let isSubscribed = true;

      const channel = supabase
        .channel(`auth_session_${newSessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'telegram_auth_sessions',
            filter: `id=eq.${newSessionId}`,
          },
          async (payload: any) => {
            if (!isSubscribed) return;
            const updated = payload.new;
            if (updated && updated.status === 'authorized') {
              isSubscribed = false;
              clearInterval(pollingInterval);
              channel.unsubscribe();
              await loginWithSessionCredentials(updated.auth_email, updated.auth_password, newSessionId);
            }
          }
        )
        .subscribe();

      const pollingInterval = setInterval(async () => {
        if (!isSubscribed) return;
        
        try {
          const { data, error: fetchError } = await supabase
            .from('telegram_auth_sessions')
            .select('*')
            .eq('id', newSessionId)
            .single();

          if (fetchError) {
            console.error('Error polling auth session:', fetchError);
            return;
          }

          if (data && data.status === 'authorized') {
            isSubscribed = false;
            clearInterval(pollingInterval);
            channel.unsubscribe();
            await loginWithSessionCredentials(data.auth_email, data.auth_password, newSessionId);
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
      }, 2000);

      setTimeout(async () => {
        if (isSubscribed) {
          isSubscribed = false;
          clearInterval(pollingInterval);
          channel.unsubscribe();
          setWaitingForTelegram(false);
          setErrorMsg(dict.authSessionExpired);
          await supabase.from('telegram_auth_sessions').delete().eq('id', newSessionId);
        }
      }, 300000);

    } catch (err: any) {
      console.error('Failed to initiate App Telegram Auth:', err);
      setErrorMsg(err.message || dict.authSessionError);
      setWaitingForTelegram(false);
    }
  };

  const loginWithSessionCredentials = async (email: string, pass: string, sessId: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      });

      if (error) throw error;

      if (data.user) {
        setUser(data.user);
        useKaraokeStore.getState().syncProjects();
      }
    } catch (err: any) {
      console.error('Sign in using session credentials failed:', err);
      setErrorMsg(err.message || dict.authSessionError);
    } finally {
      setWaitingForTelegram(false);
      setSessionId(null);
      await supabase.from('telegram_auth_sessions').delete().eq('id', sessId);
    }
  };

  // Тестовый локальный вход (Mock-режим)
  const handleMockLogin = async () => {
    setErrorMsg(null);
    try {
      // Попробуем анонимный вход в Supabase, если клиент настроен
      if (import.meta.env.VITE_SUPABASE_URL) {
        try {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (!error && data.user) {
            setUser(data.user);
            useKaraokeStore.getState().syncProjects();
            return;
          }
        } catch (supabaseErr) {
          console.warn('Supabase anonymous sign-in failed, falling back to local mock user:', supabaseErr);
        }
      }

      // Фолбэк на локальный mock-профиль (если Supabase не настроен вовсе или не доступен)
      const mockUser = {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'mock_local_user@example.com',
        user_metadata: {
          username: language === 'ru' ? 'Тестовый Пользователь' : 'Mock Developer',
          avatar_url: '',
        },
      };

      setUser(mockUser as any);
      // Имитируем синхронизацию
      useKaraokeStore.setState({ syncing: true });
      setTimeout(() => {
        useKaraokeStore.setState({ syncing: false });
      }, 800);

    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка тестового входа');
    }
  };

  const handleLogout = async () => {
    try {
      if (import.meta.env.VITE_SUPABASE_URL) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.error('Supabase signout failed, clearing state locally:', err);
    }
    setUser(null);
    useKaraokeStore.setState({ currentProjectId: null });
  };

  return (
    <div
      className={`rounded-2xl p-5 border shadow-sm transition-all mb-4 ${
        theme === 'dark'
          ? 'bg-zinc-950/80 border-zinc-800/80 text-zinc-100'
          : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center gap-2 mb-4 border-b border-zinc-150 dark:border-zinc-900 pb-3 justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-violet-500" size={18} />
          <h4 className="font-bold text-sm uppercase tracking-wider">{dict.authTitle}</h4>
        </div>
        
        {user && (
          <div className="flex items-center gap-1.5">
            {syncing ? (
              <span title={dict.authSyncing}>
                <RefreshCw size={13} className="text-violet-400 animate-spin" />
              </span>
            ) : (
              <span title={dict.authSynced}>
                <Cloud size={13} className="text-emerald-500" />
              </span>
            )}
          </div>
        )}
      </div>

      {user ? (
        <div className="flex flex-col gap-3.5">
          {/* User Profile Card */}
          <div className="flex items-center gap-3 p-2 rounded-xl bg-zinc-100/30 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-900">
            {user.user_metadata?.avatar_url || user.user_metadata?.photo_url ? (
              <img
                src={user.user_metadata.avatar_url || user.user_metadata.photo_url}
                alt="Avatar"
                className="w-8 h-8 rounded-full border border-violet-500/20"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-violet-600/10 text-violet-500 flex items-center justify-center font-bold text-xs uppercase border border-violet-500/20">
                {user.user_metadata?.username?.charAt(0) || user.email?.charAt(0) || <User size={14} />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[11px] truncate text-zinc-800 dark:text-zinc-200">
                {user.user_metadata?.username || user.email?.split('@')[0]}
              </p>
              <p className="text-[9px] text-zinc-450 dark:text-zinc-500 truncate">
                {user.email}
              </p>
            </div>
          </div>

          {/* Sync Stats/Feedback */}
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500 dark:text-zinc-450">
              {syncing ? dict.authSyncing : dict.authSynced}
            </span>
            <button
              onClick={() => syncProjects()}
              disabled={syncing}
              className="text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-350 font-semibold flex items-center gap-1 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
              {language === 'ru' ? 'Обновить' : 'Sync'}
            </button>
          </div>

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="w-full py-2.5 rounded-xl border border-red-500/20 text-red-500 hover:bg-red-500/10 font-bold text-[11px] flex items-center justify-center gap-2 transition-all"
          >
            <LogOut size={13} />
            {dict.authLogout}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[11px] text-zinc-450 dark:text-zinc-400 leading-relaxed">
            {dict.authGuest}
          </p>

          <div className="flex flex-col gap-2">
            {isTelegramWebApp ? (
              /* Если открыто внутри Telegram */
              <button
                onClick={handleTelegramWebAppAuth}
                className="w-full py-2.5 rounded-xl bg-sky-550 hover:bg-sky-600 text-white font-bold text-[11px] flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-95 shadow-md shadow-sky-500/15 cursor-pointer"
              >
                <Key size={13} />
                {language === 'ru' ? 'Войти как WebApp' : 'Login as WebApp'}
              </button>
            ) : (
              /* Вход через Telegram-приложение (Deep Link) */
              <button
                onClick={handleTelegramAppLinkAuth}
                disabled={waitingForTelegram}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-white font-bold text-xs flex items-center justify-center gap-2.5 transition-all hover:scale-[1.02] active:scale-95 shadow-md shadow-sky-500/15 cursor-pointer"
              >
                {waitingForTelegram ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Key size={14} />
                )}
                {waitingForTelegram ? dict.authWaitingForTelegram : dict.authTelegramLogin}
              </button>
            )}

            {/* Кнопка Mock-входа для локальной отладки */}
            <button
              onClick={handleMockLogin}
              className="w-full py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-55 dark:border-zinc-800 dark:hover:bg-zinc-900 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 font-semibold text-[11px] flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ShieldCheck size={13} />
              {dict.authMockLogin}
            </button>
          </div>

          {errorMsg && (
            <p className="text-[10px] text-red-500 bg-red-500/5 border border-red-500/10 p-2 rounded-lg text-center font-semibold leading-normal">
              {errorMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
