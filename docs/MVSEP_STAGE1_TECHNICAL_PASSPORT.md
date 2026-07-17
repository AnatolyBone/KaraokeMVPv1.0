# Технический паспорт MVSEP stems — Этап 1

## Назначение

Этап 1 обеспечивает устойчивое получение, хранение и восстановление двух дорожек MVSEP: `vocal` и `instrumental`. Аудиоанализ и автоматическая коррекция таймингов в этот этап не входят.

## Конвейер

```text
клиент: SHA-256 исходного файла
→ private stem_inputs/{userId}/{uuid}.{ext}
→ song_stems: queued
→ MVSEP create/status
→ MVSEP done
→ song_stems: persisting
→ серверная загрузка и проверка двух outputs
→ private stem_results/{userId}/{jobId}/{kind}.{ext}
→ song_stems: completed
→ удаление stem input
→ signed URLs на 15 минут
→ IndexedDB как необязательный локальный кэш
```

`completed` означает, что оба объекта уже записаны в `stem_results`. Статус MVSEP `done` сам по себе больше не означает готовность результата для клиента.

## Статусы

- `queued` — ожидает свободного слота.
- `submitting` — строка атомарно захвачена pump-процессом.
- `waiting`, `processing`, `distributing`, `merging` — активные состояния провайдера.
- `persisting` — MVSEP закончил работу, но копирование/проверка обоих outputs ещё не завершены.
- `completed` — vocal и instrumental сохранены устойчиво.
- `failed`, `cancelled` — терминальные ошибки/отмена.

Зависший `submitting` без provider hash старше 10 минут плановый pump возвращает в `queued`.

## Идентичность исходного аудио

`source_fingerprint` — lowercase SHA-256 всех байтов файла. Хэш вычисляется браузером для восстановления и повторно Edge Function для проверки загруженного файла. Имя файла не используется как критерий соответствия stem.

Job дополнительно хранит `owner_id`, nullable `project_id`/`song_id`, имя, размер, MIME и переданную браузером длительность исходника. Несуществующий или чужой `project_id` не связывается с job.

## Серверные assets

Пути имеют вид:

```text
{ownerId}/{jobId}/vocal.<фактическое расширение>
{ownerId}/{jobId}/instrumental.<фактическое расширение>
```

Перед записью проверяются HTTP status, фактически прочитанный объём не более 32 MiB, нижняя граница 1 KiB и допустимый audio MIME. Чтение идёт ограниченными chunks, а vocal и instrumental обрабатываются последовательно. MIME и размер сохраняются отдельно. `result_files` остаётся необработанной диагностической копией ответа MVSEP и не считается стабильным API для клиента.

Повторное сохранение проверяет существование детерминированного объекта. Успешный объект не перезаписывается. Если один stem сохранён, а второй завершился ошибкой, повтор сохраняет только отсутствующий.

## API Edge Function

- `POST ?action=create` — premium-only создание job.
- `GET ?action=refresh&job_id=...` — ручное/клиентское обновление собственного job.
- `GET ?action=latest&source_fingerprint=...&project_id=...` — восстановление последнего собственного job без поиска по имени.
- `GET ?action=assets&job_id=...` — перевыпуск signed URLs после проверки владельца.
- `POST ?action=retry-persistence` — явный безопасный повтор сохранения существующих outputs без нового MVSEP job.
- `POST ?action=duration` — запись фактической длительности после успешного browser decode собственного asset.
- `GET ?action=scheduled` + `x-cron-secret` — плановый polling, backfill, cleanup и продвижение очереди.
- `GET ?action=pump` — тот же цикл для администратора.

Signed URL живёт 15 минут, не записывается в БД и удаляется из persisted Zustand state. Storage path остаётся долговечным идентификатором.

## Восстановление и локальный кэш

При открытии аудио клиент вычисляет fingerprint, ищет job текущего пользователя, восстанавливает статус и новые signed URLs. Незавершённый job опрашивается раз в 15 секунд; серверный cron делает это независимо от открытой вкладки.

Состояние отдельно хранит `sourceAudioFingerprint`, `activeAudioFingerprint` и `activeAudioKind`. После применения instrumental source fingerprint не меняется, повторное разделение активной минусовки блокируется, а оригинал можно восстановить из fingerprint-bound IndexedDB copy.

Ключи IndexedDB включают fingerprint:

```text
stem:{fingerprint}:{jobId}:{kind}
project:{projectId}:stem:{fingerprint}:{kind}
```

Vocal после завершения скачивается, декодируется и кэшируется. При отсутствии Blob клиент снова запрашивает signed URL. Кэш не является источником истины.

## Применение instrumental

Подстановка выполняется только после явного нажатия пользователя. Клиент:

1. повторно вычисляет fingerprint текущего исходника;
2. загружает Blob из fingerprint-bound IndexedDB cache либо с сервера;
3. декодирует файл через Web Audio API;
4. показывает длительность исходника, длительность instrumental и разницу;
5. отдельно предупреждает, если разница превышает одновременно 2 секунды и 1%;
6. заменяет аудио только после подтверждения.

Lyrics и line/word/syllable timings не изменяются.

## Безопасность

- `song_stems` читаются только владельцем или администратором; прямые browser INSERT/UPDATE/DELETE отозваны.
- Оба bucket private; прямые browser SELECT/INSERT/UPDATE/DELETE policies для stems отсутствуют.
- Создание signed URL выполняется service-role клиентом только после `owner_id = auth.uid()`.
- Клиент не передаёт произвольный storage path в endpoint.
- MVSEP token и signed URLs не выводятся в лог целиком.
- Queue claim RPC доступен только `service_role`.

## Lifecycle и cleanup

- Успешный input удаляется только после записи обоих outputs и фиксации `completed`.
- Inputs `failed`/`cancelled` удаляются через 7 дней.
- Незавершённое удаление input завершённого job повторяется следующим scheduled cycle.
- Raw `result_files` сохраняется для диагностики и backfill, затем очищается через 30 дней только у jobs с устойчиво сохранёнными outputs.
- Completed stem results по умолчанию хранятся бессрочно. Поле `retention_until` подготовлено для будущей политики; автоматическое удаление ценных результатов намеренно не включено.
- Удаление проекта разрывает FK через `ON DELETE SET NULL`, но не удаляет completed stems. Их удаление требует отдельной подтверждённой retention-функции.

## Старые jobs

`completed`-записи без storage paths получают backfill при обращении и во время scheduled cycle. Если внешние URL уже истекли, job остаётся в `persisting` с понятной ошибкой; UI сохраняет кнопку явного повторного разделения. Старые записи без fingerprint нельзя безопасно сопоставить новому локальному файлу автоматически.

## Развёртывание

1. Выполнить `supabase/mvsep_stems.sql`, если базовая MVSEP-миграция ещё не применена.
2. Выполнить `supabase/mvsep_stems_stage1.sql`.
3. Выполнить `supabase/mvsep_stems_stage1_5.sql`.
4. Развернуть `supabase/functions/mvsep-stems/index.ts` с `--no-verify-jwt`: user actions проверяют JWT внутри функции, scheduled action — отдельный `x-cron-secret`.
5. Задать `MVSEP_API_TOKEN` и случайный `MVSEP_CRON_SECRET` в secrets Edge Function.
6. Создать Vault secrets для URL и cron secret, затем cron по шаблону `supabase/mvsep_stems_cron.sql`; рекомендуемый интервал — 2 минуты.
7. Проверить, что `stem_inputs` и `stem_results` private.
8. Проверить scheduled endpoint и логи на тестовом job без публикации secret/URL.

## Ограничения

- Edge Function не декодирует аудио: duration stems остаётся nullable до первого успешного browser decode, после чего клиент записывает фактическое значение через owner-checked endpoint.
- Реальные варианты `result_files` MVSEP не имеют зафиксированной схемы в проекте; распознавание использует нормализованные поля `type/name/filename/label/path/url/download/link` и требует оба результата.
- При уже истёкших URL старый job получает `external_unavailable` и явный признак необходимости нового разделения; бесконечный retry не выполняется.
- SHA-256 всего файла и Web Audio decode требуют памяти пропорционально размеру аудио. Серверный предел входа и каждого output — 32 MiB из-за лимита памяти Edge runtime.
- Автоматическое удаление completed results не включено, чтобы не потерять ценные данные.
