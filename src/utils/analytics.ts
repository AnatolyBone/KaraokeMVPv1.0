import { supabase } from '../services/supabaseClient';

const ANONYMOUS_ID_KEY = 'karaoke_analytics_anonymous_id';

export function getAnonymousId() {
  if (typeof window === 'undefined') return null;

  let id = localStorage.getItem(ANONYMOUS_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ANONYMOUS_ID_KEY, id);
  }

  return id;
}

export async function trackAppEvent(params: {
  eventName: string;
  userId?: string | null;
  telegramId?: number | null;
  appMode?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (typeof window === 'undefined') return;

  try {
    await supabase.from('app_events').insert({
      event_name: params.eventName,
      user_id: params.userId || null,
      telegram_id: params.telegramId || null,
      anonymous_id: getAnonymousId(),
      route: `${window.location.pathname}${window.location.search}`,
      app_mode: params.appMode || null,
      source: 'web',
      metadata: params.metadata || {},
    });
  } catch (err) {
    console.warn('Failed to track app event:', err);
  }
}
