// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

// CORS headers to allow requests from client
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Хелпер для вычисления HMAC-SHA256 подписи данных Telegram
async function verifyTelegramHash(authData: Record<string, any>, botToken: string): Promise<boolean> {
  const encoder = new TextEncoder();

  // 1. Если это авторизация из Telegram WebApp (передана строка initData)
  if (authData.initData) {
    const params = new URLSearchParams(authData.initData);
    const hash = params.get('hash');
    if (!hash) return false;

    // Удаляем hash для создания data-check-string
    params.delete('hash');

    // Сортируем параметры по алфавиту и собираем в строку key=value с разделителем \n
    const sortedParams = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = sortedParams.map(([key, value]) => `${key}=${value}`).join('\n');

    // Вычисляем HMAC-SHA256("WebAppData", botToken)
    const webAppDataKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const secretKeyBuffer = await crypto.subtle.sign("HMAC", webAppDataKey, encoder.encode(botToken));

    // Вычисляем HMAC-SHA256(secretKeyBuffer, dataCheckString)
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      secretKeyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const calculatedSignature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));

    const calculatedHash = Array.from(new Uint8Array(calculatedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return calculatedHash === hash;
  }

  // 2. Иначе это авторизация из Telegram Login Widget
  const { hash, ...data } = authData;
  if (!hash) return false;

  // Сортируем ключи и собираем строку key=value
  const dataCheckString = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('\n');

  // Для виджета: ключ это SHA256 от токена бота в бинарном формате
  const sha256Buffer = await crypto.subtle.digest("SHA-256", encoder.encode(botToken));

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    sha256Buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const calculatedSignature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(dataCheckString));

  const calculatedHash = Array.from(new Uint8Array(calculatedSignature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return calculatedHash === hash;
}

// Вычисление детерминированного пароля на основе telegram_id и bot_token
async function generateDeterministicPassword(telegramId: string, botToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(botToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`telegram_user_${telegramId}`));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { authData } = await req.json();
    if (!authData || !authData.id) {
      return new Response(JSON.stringify({ error: 'Missing authData' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'Server configuration error: TELEGRAM_BOT_TOKEN is missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Проверяем валидность подписи Telegram
    const isValid = await verifyTelegramHash(authData, botToken);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid Telegram signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Инициализируем Supabase Admin клиент
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const email = `${authData.id}@telegram.lrcmaker`;
    const password = await generateDeterministicPassword(authData.id.toString(), botToken);
    const username = authData.username || authData.first_name || `tg_${authData.id}`;
    const avatarUrl = authData.photo_url || null;

    let userId: string;

    // 3. Пытаемся создать пользователя в Supabase Auth
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: password,
      user_metadata: { telegram_id: authData.id, username }
    });

    if (createError) {
      // Если пользователь уже существует, ищем его профиль или ID
      // Сообщение об ошибке обычно содержит "Email already in use" или аналогичные коды
      const { data: existingProfiles, error: selectError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('telegram_id', authData.id);

      if (selectError || !existingProfiles || existingProfiles.length === 0) {
        // Если профиля нет, нам нужно найти пользователя в auth.users.
        // Поскольку в Supabase REST API нет прямого доступа к auth.users,
        // мы можем попытаться выполнить сброс пароля (пользователь все равно существует)
        // или пересоздать/найти его. В нормальном сценарии профиль создается при первом входе.
        // Мы можем перестраховаться и сделать запрос к списку пользователей:
        const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        const foundUser = userList?.users?.find(u => u.email === email);
        if (foundUser) {
          userId = foundUser.id;
        } else {
          throw new Error('User already exists in auth but could not find user ID');
        }
      } else {
        userId = existingProfiles[0].id;
      }
    } else {
      userId = createData.user.id;
    }

    // 4. Синхронизируем/создаем профиль пользователя в public.profiles
    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        username: username,
        avatar_url: avatarUrl,
        telegram_id: Number(authData.id),
        updated_at: new Date().toISOString(),
      });

    if (upsertError) {
      console.error('Failed to upsert profile:', upsertError);
      // Не бросаем ошибку, так как пользователь в auth все равно был успешно создан/найден
    }

    // 5. Возвращаем email и пароль клиенту для безопасного входа
    return new Response(JSON.stringify({ email, password }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
