# MVSEP Stage 1.5 — production deployment and integration testing

Этот документ не подтверждает production-готовность сам по себе. Готовность подтверждается только после выполнения SQL, Edge, RLS, Storage и MVSEP smoke-тестов в целевом Supabase-проекте.

## 1. Предварительные условия

- Supabase CLI с доступом к целевому project ref.
- Доступ к SQL Editor/Database и Edge Function logs.
- Два тестовых Auth-пользователя: A и B.
- У пользователя A активный Plus/Pro-доступ.
- Реальный `MVSEP_API_TOKEN`.
- Случайный `MVSEP_CRON_SECRET` высокой энтропии.
- Buckets `stem_inputs` и `stem_results` должны оставаться private.

Проверить расширения:

```sql
select extname, extversion
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;
```

При отсутствии включить через Dashboard или выполнить с административными правами:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
```

## 2. Порядок миграций

Применять строго по порядку:

1. `supabase/mvsep_stems.sql` — базовая очередь, если ещё не применена.
2. `supabase/mvsep_stems_stage1.sql` — durable assets/fingerprint/project linkage.
3. `supabase/mvsep_stems_stage1_5.sql` — production hardening/retry state/DB invariant.

Все три файла рассчитаны на существующую таблицу и повторный запуск. Перед применением проверить legacy-статусы:

```sql
select status, count(*)
from public.song_stems
group by status
order by status;
```

Допустимые значения после нормализации `pending → queued`:

```text
queued, submitting, waiting, processing, distributing, merging,
persisting, completed, failed, cancelled
```

После миграций:

```sql
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.song_stems'::regclass
order by conname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'song_stems'
order by indexname;
```

`song_stems_completed_assets_check` намеренно создаётся `NOT VALID`: он запрещает новые/обновляемые `completed` без двух paths и `outputs_saved_at`, но не блокирует миграцию старых строк. Найти legacy-нарушения:

```sql
select id, owner_id, status, completed_at, result_files
from public.song_stems
where status = 'completed'
  and (
    vocal_storage_path is null
    or instrumental_storage_path is null
    or outputs_saved_at is null
  )
order by completed_at desc nulls last;
```

После успешного backfill всех строк constraint можно валидировать отдельно:

```sql
alter table public.song_stems
validate constraint song_stems_completed_assets_check;
```

## 3. Проверка queue RPC

```sql
select
  p.proname,
  p.prosecdef,
  p.proconfig,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'claim_mvsep_queued_jobs';
```

Ожидается:

- `prosecdef = true`;
- `search_path=public` в `proconfig`;
- EXECUTE только у `service_role`/владельца функции;
- нет EXECUTE у `PUBLIC`, `anon`, `authenticated`.

Проверка grants:

```sql
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'claim_mvsep_queued_jobs'
order by grantee;
```

Функция использует `FOR UPDATE SKIP LOCKED`; два параллельных pump не должны получить один `queued` job.

## 4. Secrets и Edge Function

Задать secrets интерактивно или через защищённый CI. Не сохранять значения в shell history/репозитории:

```text
supabase secrets set MVSEP_API_TOKEN=<REAL_VALUE> --project-ref <PROJECT_REF>
supabase secrets set MVSEP_CRON_SECRET=<RANDOM_VALUE> --project-ref <PROJECT_REF>
```

Развёртывание:

```text
supabase functions deploy mvsep-stems --project-ref <PROJECT_REF> --no-verify-jwt
```

`--no-verify-jwt` выбран намеренно: функция сама проверяет пользовательский Bearer JWT через `auth.getUser`, а scheduled action — через отдельный `x-cron-secret`. Это позволяет cron не маскироваться под пользователя.

После deploy проверить OPTIONS:

```text
curl -i -X OPTIONS "https://<PROJECT_REF>.supabase.co/functions/v1/mvsep-stems?action=latest"
```

Проверить неавторизованный user action — ожидается ошибка авторизации, не данные job:

```text
curl -i "https://<PROJECT_REF>.supabase.co/functions/v1/mvsep-stems?action=assets&job_id=<JOB_ID>"
```

## 5. Vault и cron

Создать secrets один раз, подставив реальные значения только в SQL Editor:

```sql
select vault.create_secret(
  'https://<PROJECT_REF>.supabase.co/functions/v1/mvsep-stems?action=scheduled',
  'mvsep_stems_scheduled_url',
  'Stage 1.5 scheduled endpoint'
);

select vault.create_secret(
  '<SAME_RANDOM_VALUE_AS_MVSEP_CRON_SECRET>',
  'mvsep_stems_cron_secret',
  'Stage 1.5 cron secret'
);
```

Если имя уже существует, использовать `vault.update_secret`, как показано в `supabase/mvsep_stems_cron.sql`.

Затем выполнить `supabase/mvsep_stems_cron.sql`. Проверка:

```sql
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'mvsep-stems-pump';

select jobid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'mvsep-stems-pump')
order by start_time desc
limit 20;
```

Ручной `net.http_post` приведён в cron-файле. После commit проверить `net._http_response` по возвращённому request id. Интервал — 2 минуты, HTTP timeout — 45 секунд.

Перекрывающиеся executions безопасны за счёт атомарного queue claim, детерминированных object paths, `upsert=false` и условной фиксации `outputs_saved_at` только один раз.

## 6. RLS и Storage

Проверить buckets:

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('stem_inputs', 'stem_results');
```

Оба `public` должны быть `false`. Прямые browser CRUD policies для этих buckets не требуются. Проверить все policies таблицы, включая потенциально старые широкие правила:

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
```

Проверить `song_stems`:

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'song_stems'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'song_stems'
order by grantee, privilege_type;
```

`anon`/`authenticated` не должны иметь INSERT/UPDATE/DELETE. Пользователь получает signed URL только через endpoint, который выполняет `owner_id = auth.uid()`.

## 7. Очередь и диагностика

```sql
select status, count(*) as jobs, min(created_at) as oldest_created, min(updated_at) as oldest_update
from public.song_stems
where provider = 'mvsep'
group by status
order by status;

select id, owner_id, status, mvsep_status, provider_job_hash,
       persistence_attempt_count, persistence_failure_code,
       next_persistence_retry_at, requires_new_separation,
       error_message, updated_at
from public.song_stems
where provider = 'mvsep'
  and status not in ('completed', 'failed', 'cancelled')
order by updated_at;
```

Зависший claim:

```sql
select id, owner_id, updated_at
from public.song_stems
where status = 'submitting'
  and provider_job_hash is null
  and updated_at < now() - interval '10 minutes';
```

## 8. Orphaned objects

Inputs без job:

```sql
select o.bucket_id, o.name, o.created_at
from storage.objects o
where o.bucket_id = 'stem_inputs'
  and not exists (
    select 1
    from public.song_stems s
    where s.input_storage_path = o.name
  )
order by o.created_at;
```

Results без job/path prefix:

```sql
select o.bucket_id, o.name, o.created_at
from storage.objects o
where o.bucket_id = 'stem_results'
  and not exists (
    select 1
    from public.song_stems s
    where o.name like s.owner_id::text || '/' || s.id::text || '/%'
  )
order by o.created_at;
```

Не удалять найденные объекты автоматически: сначала сопоставить их с audit/logs и backup policy.

## 9. Интеграционные сценарии

### A. Успешный flow

Создать job реальным пользователем A и проверить последовательность `queued → submitting → provider status → persisting → completed`. Для `completed` проверить два объекта, paths, MIME, size, `outputs_saved_at`, удаление input, signed URLs и reload.

### B. Ошибка второго stem

В тестовом окружении сделать instrumental URL временно недоступным после успешного vocal. Проверить, что vocal object/path не изменяется, retry сохраняет только instrumental, `outputs_saved_at` ставится один раз, input удаляется после полного успеха.

### C. Повторный refresh

Несколько раз вызвать `refresh` и `pump` для completed job. Сравнить object id/path, `outputs_saved_at` и `source_fingerprint` до/после.

### D. Legacy backfill

На копии production-строки оставить `completed + result_files`, paths/`outputs_saved_at = null`. Scheduled/read должен выполнить backfill. Для 404/410 ожидаются `failed`, `persistence_failure_code=external_unavailable`, `requires_new_separation=true`.

### E. Reload

Закрыть вкладку на `queued`, `processing`, `persisting`, `completed`. После reload должен восстановиться тот же job по source fingerprint; повторный create не выполняется.

### F. Истёкший signed URL

После истечения вызвать `assets`. Должен вернуться новый URL для того же storage path/job без нового MVSEP request.

### G. Удалённый IndexedDB cache

Удалить stem Blob keys, оставить source audio. Vocal/instrumental должны загрузиться из private Storage через новые signed URLs.

### H. Два пользователя

JWT пользователя B должен получить 404 на `assets`, `refresh`, `retry-persistence` job пользователя A. Прямая Storage загрузка без signed token должна быть запрещена. Проверить, что B не может INSERT/UPDATE `song_stems` через PostgREST.

### I. Instrumental

Проверить совпадающую длительность, порог `>2 s AND >1%`, decode failure, fingerprint mismatch, отмену confirm, неизменность lyrics/timings, кнопку возврата к оригиналу и сохранение `sourceAudioFingerprint` при `activeAudioKind=instrumental`. Кнопка нового separation для активной минусовки не показывается.

## 10. Локальные автоматические проверки

```text
npm run test:stems
npm run typecheck
npm run build
```

Unit-тесты не имитируют успешный MVSEP API и не заменяют сценарии A–I.

## 11. Rollback

Остановить cron:

```sql
select cron.unschedule('mvsep-stems-pump');
```

Edge Function: развернуть предыдущий проверенный release artifact той же командой `supabase functions deploy ... --no-verify-jwt`. Не откатывать таблицу удалением новых колонок: безопаснее остановить cron, вернуть Edge и подготовить forward-fix migration.

Перед rollback Edge проверить, понимает ли предыдущая версия статус `persisting` и новые nullable-поля. Если нет — сначала остановить создание новых jobs и завершить/пометить активные задания вручную.
