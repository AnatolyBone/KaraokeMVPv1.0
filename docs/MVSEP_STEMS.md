# MVSEP stems integration

This document describes the first MVP of server-side MVSEP integration for creating an instrumental/karaoke backing track from the current audio file.

## Product Scope

The first version is intentionally narrow:

- Visible only for Plus/Pro/Admin users.
- Uses MVSEP `BS Roformer (vocals, instrumental)` with `sep_type=40`.
- Uses `output_format=0`, which is MP3 320 kbps.
- WAV/FLAC are reserved for a future higher tier and admin testing.
- The client never sees the MVSEP API token.

## Why There Is A Queue

MVSEP free accounts allow only 1 concurrent job. Premium MVSEP accounts allow up to 10 concurrent jobs.

The app therefore stores all requests in `public.song_stems` and starts only as many active MVSEP jobs as allowed by:

```text
telegram_bot_settings.key = mvsep_max_concurrent_jobs
```

Current default:

```text
mvsep_max_concurrent_jobs = 1
```

When upgrading MVSEP to Premium, this value can be raised up to `10`.

## Database Migration

Run:

```sql
-- supabase/mvsep_stems.sql
```

The migration:

- extends `public.song_stems` for MVSEP queue metadata;
- makes legacy `song_id`, `vocal_storage_path`, and `instrumental_storage_path` nullable;
- adds owner tracking via `owner_id`;
- adds MVSEP provider fields such as `provider_job_hash`, `sep_type`, `output_format`, `result_files`;
- creates private storage buckets:
  - `stem_inputs`
  - `stem_results`
- creates/keeps `mvsep_max_concurrent_jobs`.

## Supabase Secrets

Set this secret before deploying the function:

```bash
npx supabase secrets set MVSEP_API_TOKEN=YOUR_NEW_MVSEP_TOKEN --project-ref cpjhpvdnjmyppdlgcbdr
```

Important: if the token was pasted into chat, screenshots, or a repo, rotate it in MVSEP first.

## Edge Function

Function:

```text
supabase/functions/mvsep-stems
```

Deploy:

```bash
npx supabase functions deploy mvsep-stems --project-ref cpjhpvdnjmyppdlgcbdr
```

Actions:

- `POST /functions/v1/mvsep-stems?action=create`
  - Requires authenticated user.
  - Requires Plus/Pro/Admin profile.
  - Accepts `multipart/form-data` with `audiofile`.
  - Stores input audio in `stem_inputs`.
  - Creates a queued job in `song_stems`.
  - Starts a MVSEP job immediately if a concurrency slot is free.

- `GET /functions/v1/mvsep-stems?action=refresh&job_id=...`
  - Requires authenticated user.
  - Refreshes MVSEP status for the user's own job.
  - Also pumps the queue if a slot is available.

- `GET /functions/v1/mvsep-stems?action=pump`
  - Admin only.
  - Starts queued jobs up to the concurrency limit.

## Statuses

Internal statuses:

- `queued`
- `submitting`
- `waiting`
- `processing`
- `distributing`
- `merging`
- `completed`
- `failed`
- `cancelled`

MVSEP statuses are stored separately in `mvsep_status`.

## Current UI

The audio card shows a compact MVSEP block for eligible users:

- "Create instrumental" button.
- Current job status.
- Refresh button while the job is not terminal.
- Link to the MVSEP job page if MVSEP returns one.

The first MVP does not automatically replace the project audio with the instrumental result yet.

## Next Steps

Recommended next iteration:

1. Parse `result_files` and detect the instrumental file.
2. Download the result through the server and store it in `stem_results`.
3. Add a "Use instrumental in this project" button.
4. Add admin controls for `mvsep_max_concurrent_jobs`.
5. Add daily per-user MVSEP limits for Plus/Pro tiers.
