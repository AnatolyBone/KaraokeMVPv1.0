// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

// CORS headers to allow requests from client
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function sendTelegramMessage(chatId: number, text: string, botToken: string) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      console.error('Failed to send Telegram message:', await response.text());
    }
  } catch (err) {
    console.error('Error sending Telegram message:', err);
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const urlObj = new URL(req.url);
    const urlAction = urlObj.searchParams.get('action');

    let body = {};
    const contentType = req.headers.get('content-type') || '';
    if (req.method === 'POST' && contentType.includes('application/json')) {
      try {
        body = await req.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const action = body.action || urlAction;

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'Server configuration error: TELEGRAM_BOT_TOKEN is missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Логируем запрос в таблицу для отладки
    try {
      await supabaseAdmin.from('telegram_bot_debug_logs').insert({
        payload: {
          method: req.method,
          url: req.url,
          headers: Object.fromEntries(req.headers.entries()),
          body: body,
        }
      });
    } catch (e) {
      console.error('Failed to write debug log:', e);
    }

    // 1. Настройка канала-хранилища (пересланное сообщение из канала)
    const message = body?.message;
    let channelId = null;
    let channelTitle = null;

    if (message) {
      if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
        channelId = message.forward_from_chat.id;
        channelTitle = message.forward_from_chat.title;
      } else if (message.forward_origin && message.forward_origin.type === 'channel') {
        channelId = message.forward_origin.chat?.id;
        channelTitle = message.forward_origin.chat?.title;
      }
    }

    if (channelId) {
      const fromUser = message.from;
      const chatId = message.chat.id;

      if (fromUser) {
        try {
          // Проверяем роль пользователя (должен быть админом)
          const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('telegram_id', fromUser.id)
            .maybeSingle();

          if (profileError) {
            console.error('Failed to query profiles:', profileError);
          }

          if ((profile && profile.role === 'admin') || fromUser.id === 2018254756) {
            const { error: upsertError } = await supabaseAdmin
              .from('telegram_bot_settings')
              .upsert({ key: 'storage_channel_id', value: channelId.toString() });

            if (upsertError) {
              console.error('Failed to save channel ID:', upsertError);
              await sendTelegramMessage(chatId, '⚠️ Не удалось привязать канал-хранилище в БД (убедитесь, что таблица настроек создана).', botToken);
            } else {
              await sendTelegramMessage(
                chatId,
                `✅ Канал «${channelTitle || 'наш канал'}» (ID: ${channelId}) успешно зарегистрирован как хранилище аудио!\n\nВсе присылаемые треки будут автоматически пересылаться туда для кэширования.`,
                botToken
              );
            }
          } else {
            await sendTelegramMessage(chatId, '⚠️ Изменять настройки бота могут только администраторы.', botToken);
            return new Response('Unauthorized config attempt', { status: 200 });
          }
        } catch (err) {
          console.error('Exception during channel settings registration:', err);
          await sendTelegramMessage(chatId, '⚠️ Произошла ошибка при обращении к БД при регистрации настроек.', botToken);
        }
      }

      if (!message.audio) {
        return new Response('Channel configured', { status: 200 });
      }
    }

    // 2. Проверка на входящий вебхук Telegram (Аудио)
    if (body && body.message && body.message.audio) {
      const audio = body.message.audio;
      const chatId = body.message.chat.id;
      const messageId = body.message.message_id;
      const fromUser = body.message.from;

      if (fromUser) {
        if (audio.file_size && audio.file_size > 20 * 1024 * 1024) {
          await sendTelegramMessage(
            chatId,
            '⚠️ Файл слишком большой. Telegram Bot API разрешает скачивание файлов только до 20 МБ.',
            botToken
          );
          return new Response('File size exceeds limit', { status: 200 });
        }

        let finalFileId = audio.file_id;

        // Ищем в БД, задан ли канал-хранилище
        let setting = null;
        try {
          const { data, error } = await supabaseAdmin
            .from('telegram_bot_settings')
            .select('value')
            .eq('key', 'storage_channel_id')
            .maybeSingle();
          if (!error) {
            setting = data;
          } else {
            console.warn('Query settings error (table might not exist):', error);
          }
        } catch (err) {
          console.error('Failed to query settings table:', err);
        }

        if (setting && setting.value) {
          try {
            // Пересылаем сообщение в канал-хранилище
            const forwardUrl = `https://api.telegram.org/bot${botToken}/forwardMessage`;
            const forwardRes = await fetch(forwardUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: setting.value,
                from_chat_id: chatId,
                message_id: messageId,
              }),
            });

            if (forwardRes.ok) {
              const forwardData = await forwardRes.json();
              if (forwardData.ok && forwardData.result && forwardData.result.audio) {
                // Извлекаем постоянный file_id, созданный в канале
                finalFileId = forwardData.result.audio.file_id;
              }
            } else {
              console.error('Failed to forward audio to channel:', await forwardRes.text());
            }
          } catch (err) {
            console.error('Error forwarding audio to channel:', err);
          }
        }

        const fileName = audio.file_name || `${audio.title || 'track'}.mp3`;
        const artist = audio.performer || null;
        const title = audio.title || null;
        const duration = audio.duration || null;
        const fileSize = audio.file_size || null;

        // Проверяем, нет ли уже этой записи у пользователя в БД (предотвращаем дублирование от ретраев вебхука)
        try {
          const { data: existingShare, error: checkError } = await supabaseAdmin
            .from('telegram_audio_shares')
            .select('id')
            .eq('telegram_id', fromUser.id)
            .eq('file_id', finalFileId)
            .maybeSingle();

            await sendTelegramMessage(
              chatId,
              `🎵 *Этот трек уже был импортирован ранее!*\n*Название*: ${trackLabel}\n\nОн готов к работе и ждет вас в списке импорта из Telegram на сайте.\n🔗 https://karaoke-mv-pv1-0.vercel.app`,
              botToken
            );
            return new Response('Audio already shared', { status: 200 });
          }
        } catch (err) {
          console.error('Check existing shared audio error:', err);
        }

        const { error: insertError } = await supabaseAdmin.from('telegram_audio_shares').insert({
          telegram_id: fromUser.id,
          file_id: finalFileId,
          file_name: fileName,
          file_size: fileSize,
          duration: duration,
          artist: artist,
          title: title,
        });

        if (insertError) {
          console.error('Insert shared audio error:', insertError);
          await sendTelegramMessage(chatId, '⚠️ Ошибка сохранения метаданных аудио на сервере.', botToken);
          return new Response('Insert audio failed', { status: 200 });
        }

        const trackLabel = artist && title ? `«${artist} — ${title}»` : `«${fileName}»`;
        await sendTelegramMessage(
          chatId,
          `🎵 *Трек успешно получен!*\n*Название*: ${trackLabel}\n\nТеперь вы можете загрузить его на сайте:\n1️⃣ Откройте [сайт](https://karaoke-mv-pv1-0.vercel.app).\n2️⃣ В разделе выбора музыки нажмите *«Импортировать из Telegram»*.\n3️⃣ Выберите этот трек в списке для мгновенной загрузки! 🚀`,
          botToken
        );
      }
      return new Response('Audio webhook processed successfully', { status: 200 });
    }

    // 1.2 Проверка на входящий вебхук Telegram (Текст)
    if (body && body.message && body.message.text) {
      const text = body.message.text;
      const chatId = body.message.chat.id;

      if (text.startsWith('/start auth_')) {
        const sessionId = text.replace('/start auth_', '').trim();
        const fromUser = body.message.from;

        if (fromUser && sessionId) {
          // Ищем сессию в БД
          const { data: sessionData, error: sessionError } = await supabaseAdmin
            .from('telegram_auth_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

          if (sessionError || !sessionData) {
            // Если сессия не найдена, возможно она уже удалена/авторизована.
            // Чтобы избежать спама при повторных запросах Telegram, просто возвращаем 200 OK.
            return new Response('Session already processed or missing', { status: 200 });
          }

          const email = `${fromUser.id}@telegram.lrcmaker`;
          const password = await generateDeterministicPassword(fromUser.id.toString(), botToken);
          const username = fromUser.username || fromUser.first_name || `tg_${fromUser.id}`;
          const avatarUrl = null;

          let userId: string;

          // Создаем или получаем пользователя в Supabase Auth
          const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            password: password,
            user_metadata: { telegram_id: fromUser.id, username }
          });

          if (createError) {
            // Если пользователь уже существует
            const { data: existingProfiles } = await supabaseAdmin
              .from('profiles')
              .select('id')
              .eq('telegram_id', fromUser.id);

            if (existingProfiles && existingProfiles.length > 0) {
              userId = existingProfiles[0].id;
            } else {
              const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
              const foundUser = userList?.users?.find((u) => u.email === email);
              if (foundUser) {
                userId = foundUser.id;
              } else {
                await sendTelegramMessage(chatId, '⚠️ Ошибка авторизации: не удалось связать аккаунт.', botToken);
                return new Response('User auth linking failed', { status: 200 });
              }
            }
          } else {
            userId = createData.user.id;
          }

          // Синхронизируем профиль
          await supabaseAdmin.from('profiles').upsert({
            id: userId,
            username: username,
            avatar_url: avatarUrl,
            telegram_id: Number(fromUser.id),
            updated_at: new Date().toISOString(),
          });

          // Обновляем сессию для фронтенда
          const { error: updateError } = await supabaseAdmin
            .from('telegram_auth_sessions')
            .update({
              status: 'authorized',
              telegram_id: fromUser.id,
              auth_email: email,
              auth_password: password,
            })
            .eq('id', sessionId);

          if (updateError) {
            await sendTelegramMessage(chatId, '⚠️ Ошибка обновления сессии на сервере.', botToken);
            return new Response('Session update failed', { status: 200 });
          }

          // Отправляем успешный статус пользователю в Telegram со ссылкой на сайт
          await sendTelegramMessage(
            chatId,
            `🎉 *Авторизация успешна!*\n\nВы вошли в систему:\n👤 *Имя*: ${username}\n🆔 *ID*: ${fromUser.id}\n\n👉 Возвращайтесь на вкладку браузера или откройте сайт по ссылке ниже:\n🔗 https://karaoke-mv-pv1-0.vercel.app`,
            botToken
          );
        }
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 *Привет! Добро пожаловать в Karaoke LRC Maker!* 🎤\n\nЭтот бот помогает быстро авторизоваться на сайте и загружать треки напрямую из Telegram.\n\n⚡️ *Что умеет бот:*\n1️⃣ **Вход в 1 клик**: Нажмите кнопку авторизации на сайте, и бот мгновенно свяжет ваш аккаунт.\n2️⃣ **Импорт музыки**: Просто отправьте мне любой аудиофайл (до 20 МБ), и он сразу появится в вашем личном кабинете на сайте без скачивания на телефон!\n\n🔗 *Открыть сайт*: https://karaoke-mv-pv1-0.vercel.app`,
          botToken
        );
      }

      return new Response('Webhook processed successfully', { status: 200 });
    }

    // 2. Дополнительные действия: поиск текстов в качестве CORS прокси
    if (action === 'search-lyrics') {
      const { query } = body;
      try {
        const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'get-exact-lyrics') {
      const { trackName, artistName, albumName, duration } = body;
      try {
        const url = new URL('https://lrclib.net/api/get');
        url.searchParams.append('track_name', trackName);
        url.searchParams.append('artist_name', artistName);
        if (albumName) url.searchParams.append('album_name', albumName);
        if (duration) url.searchParams.append('duration', duration.toString());

        const response = await fetch(url.toString());
        if (response.status === 404) {
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (action === 'download-audio') {
      const urlObj = new URL(req.url);
      const fileId = body.fileId || urlObj.searchParams.get('file_id');
      if (!fileId) {
        return new Response(JSON.stringify({ error: 'Missing file_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
        const getFileRes = await fetch(getFileUrl);
        if (!getFileRes.ok) {
          throw new Error(`Telegram getFile HTTP error: ${getFileRes.status}`);
        }
        const getFileData = await getFileRes.json();
        if (!getFileData.ok || !getFileData.result || !getFileData.result.file_path) {
          throw new Error(`Telegram getFile error: ${getFileData.description || 'Unknown error'}`);
        }

        const filePath = getFileData.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

        const startTime = Date.now();
        const audioRes = await fetch(downloadUrl);
        if (!audioRes.ok) {
          throw new Error(`Failed to download audio from Telegram: ${audioRes.status}`);
        }

        const arrayBuffer = await audioRes.arrayBuffer();
        const downloadDuration = (Date.now() - startTime) / 1000;

        try {
          await supabaseAdmin.from('telegram_bot_debug_logs').insert({
            payload: {
              event: 'download_telemetry',
              file_id: fileId,
              size: arrayBuffer.byteLength,
              duration_seconds: downloadDuration,
              success: true
            }
          });
        } catch (e) {
          console.error('Failed to log telemetry:', e);
        }

        // Принудительно задаем правильный MIME-тип аудио вместо generic application/octet-stream,
        // чтобы предотвратить ложные блокировки DPI (ТСПУ) у провайдеров,
        // а также добавляем Cache-Control: no-transform для исключения сжатия/модификации потока.
        let contentType = 'audio/mpeg';
        const lowerPath = filePath.toLowerCase();
        if (lowerPath.endsWith('.wav')) {
          contentType = 'audio/wav';
        } else if (lowerPath.endsWith('.ogg')) {
          contentType = 'audio/ogg';
        } else if (lowerPath.endsWith('.m4a')) {
          contentType = 'audio/x-m4a';
        }

        return new Response(arrayBuffer, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': contentType,
            'Content-Length': arrayBuffer.byteLength.toString(),
            'Content-Disposition': `attachment; filename="${filePath.split('/').pop() || 'track.mp3'}"`,
            'Cache-Control': 'no-transform, no-cache, must-revalidate',
          },
        });
      } catch (err: any) {
        console.error('Audio download proxy failed:', err);
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Если это входящий вебхук от Telegram (есть update_id), но он не подошел ни под одно из условий выше
    if (body && body.update_id) {
      return new Response('Telegram webhook update ignored (unsupported type)', { status: 200 });
    }

    // 3. Стандартный флоу авторизации (Виджет или WebApp)
    const { authData } = body;
    if (!authData || !authData.id) {
      return new Response(JSON.stringify({ error: 'Missing authData' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Проверяем валидность подписи Telegram
    const isValid = await verifyTelegramHash(authData, botToken);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid Telegram signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const email = `${authData.id}@telegram.lrcmaker`;
    const password = await generateDeterministicPassword(authData.id.toString(), botToken);
    const username = authData.username || authData.first_name || `tg_${authData.id}`;
    const avatarUrl = authData.photo_url || null;

    let userId: string;

    // Пытаемся создать пользователя в Supabase Auth
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: password,
      user_metadata: { telegram_id: authData.id, username }
    });

    if (createError) {
      const { data: existingProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('telegram_id', authData.id);

      if (existingProfiles && existingProfiles.length > 0) {
        userId = existingProfiles[0].id;
      } else {
        const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
        const foundUser = userList?.users?.find(u => u.email === email);
        if (foundUser) {
          userId = foundUser.id;
        } else {
          throw new Error('User already exists in auth but could not find user ID');
        }
      }
    } else {
      userId = createData.user.id;
    }

    // Синхронизируем/создаем профиль пользователя в public.profiles
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        username: username,
        avatar_url: avatarUrl,
        telegram_id: Number(authData.id),
        updated_at: new Date().toISOString(),
      });

    // Возвращаем email и пароль клиенту для безопасного входа
    return new Response(JSON.stringify({ email, password }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Global webhook handler error:', error);
    // Для Telegram вебхуков возвращаем 200 OK, чтобы избежать блокировки очереди сообщений
    return new Response(JSON.stringify({ error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
