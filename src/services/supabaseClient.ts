import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http'));

// Инициализируем клиент Supabase, если переменные окружения заданы.
// В противном случае мы создаем Proxy-объект, который заглушает все вызовы API (noop/mock),
// предотвращая сбои приложения до того, как пользователь настроит .env.local.
export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (new Proxy({}, {
      get(_, prop) {
        if (prop === 'auth') {
          return new Proxy({}, {
            get(_, authProp) {
              if (authProp === 'onAuthStateChange') {
                return () => ({
                  data: {
                    subscription: {
                      unsubscribe: () => {},
                    },
                  },
                });
              }
              // Для остальных методов auth (signInWithPassword, signOut и др.) возвращаем noop промис
              return async () => ({
                data: { user: null, session: null },
                error: new Error('Supabase is not configured. Please define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.'),
              });
            },
          });
        }
        if (prop === 'from') {
          return () => {
            const chain = {
              select: () => chain,
              insert: () => Promise.resolve({ data: null, error: null }),
              upsert: () => Promise.resolve({ data: null, error: null }),
              delete: () => chain,
              eq: () => chain,
            };
            // Позволяет вызывать цепочки методов типа supabase.from('...').select('*').eq(...)
            // и возвращать noop промис в конце
            return Object.assign(Promise.resolve({ data: [], error: null }), chain);
          };
        }
        return undefined;
      },
    }) as any);
