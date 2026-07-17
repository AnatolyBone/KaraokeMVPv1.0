-- MVSEP scheduled pump configuration.
-- Replace placeholders locally. Never commit real URL secrets or cron secrets.
-- Deploy mvsep-stems with --no-verify-jwt: the function validates user JWTs itself
-- and validates scheduled calls with x-cron-secret.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- Run once after replacing placeholders:
-- SELECT vault.create_secret(
--   'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mvsep-stems?action=scheduled',
--   'mvsep_stems_scheduled_url',
--   'Stage 1.5 MVSEP scheduled Edge Function URL'
-- );
-- SELECT vault.create_secret(
--   'YOUR_RANDOM_CRON_SECRET',
--   'mvsep_stems_cron_secret',
--   'Must equal the MVSEP_CRON_SECRET Edge Function secret'
-- );

-- Update an existing secret without creating duplicate names:
-- SELECT vault.update_secret(
--   (SELECT id FROM vault.decrypted_secrets WHERE name = 'mvsep_stems_scheduled_url'),
--   'https://YOUR_PROJECT_REF.supabase.co/functions/v1/mvsep-stems?action=scheduled',
--   'mvsep_stems_scheduled_url',
--   'Stage 1.5 MVSEP scheduled Edge Function URL'
-- );
-- SELECT vault.update_secret(
--   (SELECT id FROM vault.decrypted_secrets WHERE name = 'mvsep_stems_cron_secret'),
--   'YOUR_RANDOM_CRON_SECRET',
--   'mvsep_stems_cron_secret',
--   'Must equal the MVSEP_CRON_SECRET Edge Function secret'
-- );

-- Creating the same case-sensitive job name updates the existing job.
SELECT cron.schedule(
  'mvsep-stems-pump',
  '*/2 * * * *',
  $schedule$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'mvsep_stems_scheduled_url'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'mvsep_stems_cron_secret'
      )
    ),
    body := jsonb_build_object('invoked_at', now()),
    timeout_milliseconds := 45000
  ) AS request_id;
  $schedule$
);

-- Verify configuration and recent runs:
-- SELECT jobid, jobname, schedule, active, command
-- FROM cron.job
-- WHERE jobname = 'mvsep-stems-pump';
-- SELECT jobid, status, return_message, start_time, end_time
-- FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'mvsep-stems-pump')
-- ORDER BY start_time DESC
-- LIMIT 20;

-- Manual test call (returns an asynchronous pg_net request id):
-- SELECT net.http_post(
--   url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mvsep_stems_scheduled_url'),
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mvsep_stems_cron_secret')
--   ),
--   body := '{"manual_test":true}'::jsonb,
--   timeout_milliseconds := 45000
-- ) AS request_id;
-- Inspect the returned request id after transaction commit:
-- SELECT id, status_code, error_msg, content
-- FROM net._http_response
-- WHERE id = YOUR_REQUEST_ID;

-- Stop/remove before rollback or reconfiguration:
-- SELECT cron.unschedule('mvsep-stems-pump');
