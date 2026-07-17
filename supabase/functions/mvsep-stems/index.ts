// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import {
  buildStemStoragePath,
  classifyMvsepOutputs,
  extensionForStemContentType,
  getExternalFileUrl,
  isAcceptedStemMimeType,
  isSafeExternalHttpUrl,
  needsOutputPersistence,
} from './stemUtils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const MVSEP_CREATE_URL = 'https://mvsep.com/api/separation/create';
const MVSEP_GET_URL = 'https://mvsep.com/api/separation/get';
const ACTIVE_STATUSES = ['submitting', 'waiting', 'processing', 'distributing', 'merging'];
const POLL_BATCH_SIZE = 5;
const PERSIST_BATCH_SIZE = 1;
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_MULTIPART_REQUEST_BYTES = 33 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MIN_OUTPUT_BYTES = 1024;
const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;
const FAILED_INPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EXTERNAL_METADATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isPremiumProfile(profile: any) {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'pro') return true;
  return profile.plan === 'plus'
    && profile.plus_until
    && new Date(profile.plus_until).getTime() > Date.now();
}

function normalizeMvsepToken(rawToken: string) {
  return rawToken.trim().replace(/^[`"']+|[`"']+$/g, '').replace(/^\*+|\*+$/g, '').trim();
}

function stringifySafe(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseJsonSafe(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return extension && extension.length <= 5 ? extension : 'mp3';
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getAuthenticatedContext(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Missing authorization token');

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData?.user) throw new Error('Invalid authorization token');

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, plan, plus_until, telegram_id')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user: authData.user, profile, adminClient };
}

async function getConcurrencyLimit(adminClient: any) {
  const { data } = await adminClient
    .from('telegram_bot_settings')
    .select('value')
    .eq('key', 'mvsep_max_concurrent_jobs')
    .maybeSingle();
  const parsed = Number(data?.value || 1);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10) : 1;
}

async function countActiveJobs(adminClient: any) {
  const { count, error } = await adminClient
    .from('song_stems')
    .select('*', { count: 'exact', head: true })
    .eq('provider', 'mvsep')
    .in('status', ACTIVE_STATUSES);
  if (error) throw error;
  return count || 0;
}

function pickMvsepStatus(result: any) {
  const status = result?.status || result?.data?.status || null;
  return typeof status === 'string' ? status.toLowerCase() : null;
}

function pickResultFiles(result: any) {
  const files = result?.data?.files || result?.files || [];
  return Array.isArray(files) ? files : [];
}

class StemPersistenceError extends Error {
  code: string;
  permanent: boolean;

  constructor(message: string, code: string, permanent = false) {
    super(message);
    this.name = 'StemPersistenceError';
    this.code = code;
    this.permanent = permanent;
  }
}

async function storageObjectExists(adminClient: any, path: string) {
  const slash = path.lastIndexOf('/');
  const folder = slash >= 0 ? path.slice(0, slash) : '';
  const fileName = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await adminClient.storage.from('stem_results').list(folder, {
    limit: 10,
    search: fileName,
  });
  if (error) return false;
  return (data || []).some((entry: any) => entry.name === fileName);
}

async function findExistingOutputObject(adminClient: any, job: any, kind: 'vocal' | 'instrumental') {
  const folder = `${job.owner_id}/${job.id}`;
  const { data, error } = await adminClient.storage.from('stem_results').list(folder, {
    limit: 10,
    search: `${kind}.`,
  });
  if (error) return null;
  const matches = (data || []).filter((entry: any) => entry.name.startsWith(`${kind}.`));
  if (matches.length > 1) {
    throw new StemPersistenceError(`Multiple stored ${kind} objects found`, 'storage_conflict', true);
  }
  if (matches.length === 0) return null;
  const entry = matches[0];
  return {
    path: `${folder}/${entry.name}`,
    mimeType: entry.metadata?.mimetype || entry.metadata?.contentType || null,
    sizeBytes: Number(entry.metadata?.size || 0) || null,
  };
}

async function downloadExternalOutput(file: any) {
  const url = getExternalFileUrl(file);
  if (!url) throw new StemPersistenceError('MVSEP output URL is missing or unsafe', 'external_unavailable', true);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') throw new StemPersistenceError('MVSEP output download timed out', 'download_timeout');
    throw new StemPersistenceError('MVSEP output download failed', 'download_failed');
  }
  try {
    if (!isSafeExternalHttpUrl(response.url)) {
      throw new StemPersistenceError('MVSEP output redirected to an unsafe URL', 'external_unavailable', true);
    }
    if (!response.ok) {
      const permanent = [401, 403, 404, 410].includes(response.status);
      throw new StemPersistenceError(
        permanent ? 'MVSEP external result is no longer available' : `MVSEP output download failed (${response.status})`,
        permanent ? 'external_unavailable' : 'download_failed',
        permanent,
      );
    }

    const headerLength = Number(response.headers.get('content-length') || 0);
    if (headerLength > MAX_OUTPUT_BYTES) {
      throw new StemPersistenceError('MVSEP output exceeds the 32 MiB Edge limit', 'output_too_large', true);
    }

    const contentType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (!isAcceptedStemMimeType(contentType)) {
      throw new StemPersistenceError(`MVSEP returned a non-audio response (${contentType})`, 'invalid_mime', true);
    }

    if (!response.body) throw new StemPersistenceError('MVSEP output response has no body', 'download_failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        throw new StemPersistenceError('MVSEP output exceeds the 32 MiB Edge limit', 'output_too_large', true);
      }
      chunks.push(value);
    }
    if (sizeBytes < MIN_OUTPUT_BYTES) throw new StemPersistenceError('MVSEP output is unexpectedly small', 'invalid_output', true);
    const extension = extensionForStemContentType(contentType, response.url || url);
    if (extension === 'bin') {
      throw new StemPersistenceError('MVSEP output format could not be determined', 'invalid_mime', true);
    }
    return {
      blob: new Blob(chunks, { type: contentType }),
      mimeType: contentType,
      sizeBytes,
      extension,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new StemPersistenceError('MVSEP output download timed out', 'download_timeout');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistOutputKind(adminClient: any, job: any, kind: 'vocal' | 'instrumental', externalFile: any) {
  const pathColumn = kind === 'vocal' ? 'vocal_storage_path' : 'instrumental_storage_path';
  const mimeColumn = kind === 'vocal' ? 'vocal_mime_type' : 'instrumental_mime_type';
  const sizeColumn = kind === 'vocal' ? 'vocal_size_bytes' : 'instrumental_size_bytes';
  const existingPath = job[pathColumn];

  if (existingPath && await storageObjectExists(adminClient, existingPath)) {
    return { path: existingPath, mimeType: job[mimeColumn] || null, sizeBytes: job[sizeColumn] || null };
  }

  const recoveredObject = await findExistingOutputObject(adminClient, job, kind);
  if (recoveredObject) {
    const recoveredPayload = {
      [pathColumn]: recoveredObject.path,
      [mimeColumn]: job[mimeColumn] || recoveredObject.mimeType,
      [sizeColumn]: job[sizeColumn] || recoveredObject.sizeBytes,
      outputs_persist_error: null,
    };
    const { error } = await adminClient.from('song_stems').update(recoveredPayload).eq('id', job.id);
    if (error) throw error;
    Object.assign(job, recoveredPayload);
    return recoveredObject;
  }

  const downloaded = await downloadExternalOutput(externalFile);
  const path = buildStemStoragePath(job.owner_id, job.id, kind, downloaded.extension);
  const alreadyExists = await storageObjectExists(adminClient, path);
  if (!alreadyExists) {
    const { error: uploadError } = await adminClient.storage.from('stem_results').upload(path, downloaded.blob, {
      cacheControl: '31536000',
      upsert: false,
      contentType: downloaded.mimeType,
    });
    if (uploadError && !await storageObjectExists(adminClient, path)) throw uploadError;
  }

  const payload = {
    [pathColumn]: path,
    [mimeColumn]: downloaded.mimeType,
    [sizeColumn]: downloaded.sizeBytes,
    outputs_persist_error: null,
  };
  const { error: updateError } = await adminClient.from('song_stems').update(payload).eq('id', job.id);
  if (updateError) throw updateError;
  Object.assign(job, payload);
  return { path, mimeType: downloaded.mimeType, sizeBytes: downloaded.sizeBytes };
}

async function deleteInputAfterSuccess(adminClient: any, job: any) {
  if (!job.input_storage_path || job.input_deleted_at) return;
  const { error } = await adminClient.storage.from('stem_inputs').remove([job.input_storage_path]);
  if (error) {
    console.warn('MVSEP input cleanup failed', { jobId: job.id, message: error.message });
    return;
  }
  await adminClient.from('song_stems').update({ input_deleted_at: new Date().toISOString() }).eq('id', job.id);
}

async function persistCompletedOutputs(adminClient: any, job: any) {
  const { data: currentJob, error: loadError } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
  if (loadError) throw loadError;
  job = currentJob;
  if (!needsOutputPersistence(job)) return job;

  const { data: claimedJob, error: stateError } = await adminClient.from('song_stems').update({
    status: 'persisting',
    completed_at: null,
    outputs_persist_error: null,
    persistence_failure_code: null,
    requires_new_separation: false,
  }).eq('id', job.id).is('outputs_saved_at', null).select('*').maybeSingle();
  if (stateError) throw stateError;
  if (!claimedJob) {
    const { data: alreadyCompleted, error } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
    if (error) throw error;
    return alreadyCompleted;
  }
  job = claimedJob;

  try {
    const identified = classifyMvsepOutputs(Array.isArray(job.result_files) ? job.result_files : []);
    if (!identified.valid || !identified.vocal || !identified.instrumental) {
      throw new StemPersistenceError(
        `MVSEP outputs could not be classified unambiguously: ${identified.errors.join(', ')}`,
        'classification_ambiguous',
        true,
      );
    }

    await persistOutputKind(adminClient, job, 'vocal', identified.vocal);
    await persistOutputKind(adminClient, job, 'instrumental', identified.instrumental);

    const now = new Date().toISOString();
    const { data: completed, error } = await adminClient.from('song_stems').update({
      status: 'completed',
      completed_at: now,
      outputs_saved_at: now,
      outputs_persist_error: null,
      error_message: null,
      persistence_failure_code: null,
      next_persistence_retry_at: null,
      requires_new_separation: false,
    }).eq('id', job.id)
      .not('vocal_storage_path', 'is', null)
      .not('instrumental_storage_path', 'is', null)
      .is('outputs_saved_at', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!completed) {
      const { data: racedJob, error: racedError } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
      if (racedError) throw racedError;
      return racedJob;
    }
    await deleteInputAfterSuccess(adminClient, completed);
    return completed;
  } catch (error) {
    const message = error?.message || 'Could not persist MVSEP outputs';
    const attempts = Number(job.persistence_attempt_count || 0) + 1;
    const permanent = error instanceof StemPersistenceError && error.permanent;
    const failureCode = error instanceof StemPersistenceError ? error.code : 'storage_failed';
    const retryDelayMinutes = Math.min(2 ** Math.min(attempts, 6), 60);
    await adminClient.from('song_stems').update({
      status: permanent ? 'failed' : 'persisting',
      outputs_persist_error: message,
      error_message: message,
      persistence_attempt_count: attempts,
      persistence_failure_code: failureCode,
      next_persistence_retry_at: permanent ? null : new Date(Date.now() + retryDelayMinutes * 60 * 1000).toISOString(),
      requires_new_separation: permanent,
    }).eq('id', job.id).is('outputs_saved_at', null);
    throw error;
  }
}

async function submitJobToMvsep(adminClient: any, job: any, mvsepToken: string) {
  const { data: inputFile, error: downloadError } = await adminClient.storage.from('stem_inputs').download(job.input_storage_path);
  if (downloadError || !inputFile) throw downloadError || new Error('Input file is missing');

  const form = new FormData();
  form.append('api_token', mvsepToken);
  form.append('audiofile', inputFile, job.input_file_name || job.source_file_name || 'audio.mp3');
  form.append('sep_type', String(job.sep_type || 40));
  form.append('output_format', String(job.output_format ?? 0));
  form.append('is_demo', '0');

  const response = await fetch(MVSEP_CREATE_URL, { method: 'POST', body: form });
  const responseText = await response.text();
  const result = parseJsonSafe(responseText);
  console.log('MVSEP create response', {
    jobId: job.id,
    responseStatus: response.status,
    ok: response.ok,
    success: result?.success,
    message: result?.data?.message || result?.message || null,
  });

  if (!response.ok || !result?.success) {
    const message = result?.data?.message || result?.message || `MVSEP create failed (${response.status})`;
    throw new Error([
      message,
      `responseStatus=${response.status}`,
      `response=${stringifySafe(result || responseText).slice(0, 300)}`,
    ].join(' | '));
  }

  const hash = result?.data?.hash;
  if (!hash) throw new Error('MVSEP did not return a job hash');
  const { error } = await adminClient.from('song_stems').update({
    status: 'waiting',
    mvsep_status: 'waiting',
    provider_job_hash: hash,
    provider_job_url: result?.data?.link || null,
    submitted_at: new Date().toISOString(),
    error_message: null,
  }).eq('id', job.id);
  if (error) throw error;
}

async function claimQueuedJobs(adminClient: any, slots: number) {
  const { data, error } = await adminClient.rpc('claim_mvsep_queued_jobs', { p_limit: slots });
  if (!error) return data || [];

  // Compatibility fallback while the Stage 1 migration is being rolled out.
  console.warn('Atomic queue claim unavailable; using optimistic fallback', { message: error.message });
  const { data: queued, error: selectError } = await adminClient.from('song_stems').select('*')
    .eq('provider', 'mvsep').eq('status', 'queued').order('created_at', { ascending: true }).limit(slots);
  if (selectError) throw selectError;
  const claimed = [];
  for (const job of queued || []) {
    const { data: locked } = await adminClient.from('song_stems').update({ status: 'submitting', error_message: null })
      .eq('id', job.id).eq('status', 'queued').select('*').maybeSingle();
    if (locked) claimed.push(locked);
  }
  return claimed;
}

async function maybeStartQueuedJobs(adminClient: any, mvsepToken: string) {
  if (!mvsepToken) return { started: 0, skipped: 'MVSEP_API_TOKEN is not configured' };
  const limit = await getConcurrencyLimit(adminClient);
  const activeCount = await countActiveJobs(adminClient);
  const slots = Math.max(limit - activeCount, 0);
  if (slots <= 0) return { started: 0, limit, activeCount };

  const queuedJobs = await claimQueuedJobs(adminClient, slots);
  let started = 0;
  for (const job of queuedJobs) {
    try {
      await submitJobToMvsep(adminClient, job, mvsepToken);
      started += 1;
    } catch (error) {
      console.error('MVSEP submit failed', { jobId: job.id, message: error?.message });
      await adminClient.from('song_stems').update({
        status: 'failed',
        error_message: error?.message || 'MVSEP submit failed',
      }).eq('id', job.id);
    }
  }
  return { started, limit, activeCount };
}

async function refreshJob(adminClient: any, job: any) {
  if (needsOutputPersistence(job)) {
    return await persistCompletedOutputs(adminClient, job);
  }
  if (!job.provider_job_hash || ['failed', 'cancelled', 'completed'].includes(job.status)) return job;

  const url = new URL(MVSEP_GET_URL);
  url.searchParams.set('hash', job.provider_job_hash);
  const response = await fetch(url.toString());
  const responseText = await response.text();
  const result = parseJsonSafe(responseText);
  console.log('MVSEP refresh response', {
    jobId: job.id,
    responseStatus: response.status,
    ok: response.ok,
    success: result?.success,
    status: result?.status || result?.data?.status || null,
    filesCount: pickResultFiles(result).length,
  });

  if (!response.ok) {
    const message = result?.data?.message || result?.message || `MVSEP status request failed (${response.status})`;
    await adminClient.from('song_stems').update({ error_message: message }).eq('id', job.id);
    throw new Error(message);
  }

  const mvsepStatus = pickMvsepStatus(result) || job.mvsep_status || 'processing';
  const failed = mvsepStatus === 'failed' || result?.success === false;
  const done = mvsepStatus === 'done';
  const mappedStatus = failed ? 'failed' : done ? 'persisting' : ACTIVE_STATUSES.includes(mvsepStatus) ? mvsepStatus : 'processing';
  const resultFiles = pickResultFiles(result);
  const { data: updatedJob, error } = await adminClient.from('song_stems').update({
    status: mappedStatus,
    mvsep_status: mvsepStatus,
    result_files: resultFiles.length > 0 ? resultFiles : job.result_files,
    error_message: failed ? (result?.data?.message || result?.message || 'MVSEP failed') : null,
    completed_at: null,
  }).eq('id', job.id).select('*').single();
  if (error) throw error;
  return done ? await persistCompletedOutputs(adminClient, updatedJob) : updatedJob;
}

async function signAsset(adminClient: any, path: string | null, mimeType: string | null, sizeBytes: number | null, durationSeconds: number | null) {
  if (!path) return null;
  const { data, error } = await adminClient.storage.from('stem_results').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return {
    storagePath: path,
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    mimeType,
    sizeBytes,
    durationSeconds,
  };
}

async function serializeJob(adminClient: any, job: any) {
  const exposeAssets = job.status === 'completed'
    && Boolean(job.outputs_saved_at)
    && Boolean(job.vocal_storage_path)
    && Boolean(job.instrumental_storage_path);
  const [vocal, instrumental] = await Promise.all([
    exposeAssets
      ? signAsset(adminClient, job.vocal_storage_path, job.vocal_mime_type, job.vocal_size_bytes, job.vocal_duration_seconds)
      : null,
    exposeAssets
      ? signAsset(adminClient, job.instrumental_storage_path, job.instrumental_mime_type, job.instrumental_size_bytes, job.instrumental_duration_seconds)
      : null,
  ]);
  return {
    id: job.id,
    status: job.status,
    mvsepStatus: job.mvsep_status,
    providerJobUrl: job.provider_job_url,
    projectId: job.project_id,
    songId: job.song_id,
    sourceFileName: job.source_file_name || job.input_file_name,
    sourceSizeBytes: job.source_size_bytes,
    sourceDurationSeconds: job.source_duration_seconds,
    sourceFingerprint: job.source_fingerprint,
    sourceMimeType: job.source_mime_type,
    vocal,
    instrumental,
    errorMessage: job.error_message,
    outputsPersistError: job.outputs_persist_error,
    persistenceFailureCode: job.persistence_failure_code,
    requiresNewSeparation: Boolean(job.requires_new_separation),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    outputsSavedAt: job.outputs_saved_at,
  };
}

async function ensureDurableJob(adminClient: any, job: any) {
  if (needsOutputPersistence(job)) {
    try {
      return await persistCompletedOutputs(adminClient, job);
    } catch (error) {
      console.warn('MVSEP output backfill failed', { jobId: job.id, message: error?.message });
      const { data } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
      return data || job;
    }
  }
  return job;
}

async function processScheduledJobs(adminClient: any, mvsepToken: string) {
  const staleSubmittingBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await adminClient.from('song_stems').update({
    status: 'queued',
    error_message: 'Recovered a stale queue claim before MVSEP submission',
  }).eq('provider', 'mvsep').eq('status', 'submitting').is('provider_job_hash', null).lt('updated_at', staleSubmittingBefore);

  const { data: activeJobs, error: activeError } = await adminClient.from('song_stems').select('*')
    .eq('provider', 'mvsep').in('status', ACTIVE_STATUSES).order('updated_at', { ascending: true }).limit(POLL_BATCH_SIZE);
  if (activeError) throw activeError;

  let refreshed = 0;
  for (const job of activeJobs || []) {
    try {
      await refreshJob(adminClient, job);
      refreshed += 1;
    } catch (error) {
      console.warn('Scheduled MVSEP refresh failed', { jobId: job.id, message: error?.message });
    }
  }

  const { data: persistingJobs, error: persistError } = await adminClient.from('song_stems').select('*')
    .eq('provider', 'mvsep').eq('status', 'persisting').not('owner_id', 'is', null)
    .or(`next_persistence_retry_at.is.null,next_persistence_retry_at.lte.${new Date().toISOString()}`)
    .order('updated_at', { ascending: true }).limit(PERSIST_BATCH_SIZE);
  if (persistError) throw persistError;
  let persisted = 0;
  for (const job of persistingJobs || []) {
    try {
      await persistCompletedOutputs(adminClient, job);
      persisted += 1;
    } catch (error) {
      console.warn('Scheduled MVSEP persistence failed', { jobId: job.id, message: error?.message });
    }
  }

  // Backfill jobs created by the pre-Stage-1 function while their MVSEP URLs still work.
  const { data: legacyCompleted } = await adminClient.from('song_stems').select('*')
    .eq('provider', 'mvsep').eq('status', 'completed')
    .not('owner_id', 'is', null)
    .or('vocal_storage_path.is.null,instrumental_storage_path.is.null')
    .order('completed_at', { ascending: false }).limit(PERSIST_BATCH_SIZE);
  for (const job of legacyCompleted || []) {
    try {
      await persistCompletedOutputs(adminClient, job);
      persisted += 1;
    } catch (error) {
      console.warn('Legacy MVSEP output backfill failed', { jobId: job.id, message: error?.message });
    }
  }

  const cleanupBefore = new Date(Date.now() - FAILED_INPUT_RETENTION_MS).toISOString();
  const { data: staleInputs } = await adminClient.from('song_stems').select('id, input_storage_path')
    .eq('provider', 'mvsep').in('status', ['failed', 'cancelled']).is('input_deleted_at', null)
    .lt('updated_at', cleanupBefore).not('input_storage_path', 'is', null).limit(20);
  let cleanedInputs = 0;
  for (const item of staleInputs || []) {
    const { error } = await adminClient.storage.from('stem_inputs').remove([item.input_storage_path]);
    if (!error) {
      await adminClient.from('song_stems').update({ input_deleted_at: new Date().toISOString() }).eq('id', item.id);
      cleanedInputs += 1;
    }
  }


  const { data: completedInputs } = await adminClient.from('song_stems').select('id, input_storage_path')
    .eq('provider', 'mvsep').eq('status', 'completed').is('input_deleted_at', null)
    .not('input_storage_path', 'is', null).limit(20);
  for (const item of completedInputs || []) {
    const { error } = await adminClient.storage.from('stem_inputs').remove([item.input_storage_path]);
    if (!error) {
      await adminClient.from('song_stems').update({ input_deleted_at: new Date().toISOString() }).eq('id', item.id);
      cleanedInputs += 1;
    }
  }

  const metadataBefore = new Date(Date.now() - EXTERNAL_METADATA_RETENTION_MS).toISOString();
  const { data: cleanedMetadataRows } = await adminClient.from('song_stems').update({ result_files: [] })
    .eq('provider', 'mvsep').eq('status', 'completed').not('outputs_saved_at', 'is', null)
    .lt('outputs_saved_at', metadataBefore).neq('result_files', []).select('id');
  const cleanedMetadata = cleanedMetadataRows?.length || 0;

  const queue = await maybeStartQueuedJobs(adminClient, mvsepToken);
  return { refreshed, persisted, cleanedInputs, cleanedMetadata, queue };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const rawMvsepToken = Deno.env.get('MVSEP_API_TOKEN') || '';
  const mvsepToken = normalizeMvsepToken(rawMvsepToken);
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ success: false, error: 'Supabase function is not configured' }, 500);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'create';
    const adminClient = createClient(supabaseUrl, serviceKey);

    if (action === 'scheduled') {
      const configuredSecret = Deno.env.get('MVSEP_CRON_SECRET') || '';
      if (!configuredSecret || req.headers.get('x-cron-secret') !== configuredSecret) {
        return json({ success: false, error: 'Invalid cron secret' }, 401);
      }
      const result = await processScheduledJobs(adminClient, mvsepToken);
      return json({ success: true, ...result });
    }

    const context = await getAuthenticatedContext(req, supabaseUrl, anonKey, serviceKey);
    const { user, profile } = context;

    if (action === 'create') {
      if (req.method !== 'POST') return json({ success: false, error: 'POST required' }, 405);
      if (!isPremiumProfile(profile)) return json({ success: false, error: 'MVSEP separation is available for Plus/Pro users only' }, 403);
      if (!mvsepToken) return json({ success: false, error: 'MVSEP_API_TOKEN is not configured' }, 500);

      const requestLength = Number(req.headers.get('content-length') || 0);
      if (requestLength > MAX_MULTIPART_REQUEST_BYTES) {
        return json({ success: false, error: 'Multipart request exceeds the 33 MiB Edge limit' }, 413);
      }

      const form = await req.formData();
      const audioFile = form.get('audiofile');
      if (!(audioFile instanceof File)) return json({ success: false, error: 'audiofile is required' }, 400);
      if (audioFile.size <= 0 || audioFile.size > MAX_INPUT_BYTES) return json({ success: false, error: 'Audio file size is not supported' }, 400);

      const requestedProjectId = String(form.get('project_id') || '').trim() || null;
      let projectId: string | null = null;
      if (requestedProjectId) {
        const { data: project, error } = await adminClient.from('projects').select('id').eq('id', requestedProjectId).eq('user_id', user.id).maybeSingle();
        if (error) throw error;
        projectId = project?.id || null;
      }

      const computedFingerprint = await sha256Hex(audioFile);
      const claimedFingerprint = String(form.get('source_fingerprint') || '').trim().toLowerCase();
      if (claimedFingerprint && claimedFingerprint !== computedFingerprint) {
        return json({ success: false, error: 'Source fingerprint does not match uploaded audio' }, 400);
      }

      const outputFormat = profile.role === 'admin' ? Number(form.get('output_format') ?? 0) : 0;
      const sepType = Number(form.get('sep_type') ?? 40);
      const inputPath = `${user.id}/${crypto.randomUUID()}.${sanitizeExtension(audioFile.name)}`;
      const { error: uploadError } = await adminClient.storage.from('stem_inputs').upload(inputPath, audioFile, {
        cacheControl: '3600',
        upsert: false,
        contentType: audioFile.type || 'audio/mpeg',
      });
      if (uploadError) throw uploadError;

      const { data: job, error: insertError } = await adminClient.from('song_stems').insert({
        owner_id: user.id,
        project_id: projectId,
        provider: 'mvsep',
        status: 'queued',
        sep_type: Number.isFinite(sepType) ? sepType : 40,
        output_format: Number.isFinite(outputFormat) ? outputFormat : 0,
        input_storage_path: inputPath,
        input_file_name: audioFile.name,
        source_file_name: audioFile.name,
        source_size_bytes: audioFile.size,
        source_duration_seconds: parseOptionalNumber(form.get('source_duration_seconds')),
        source_fingerprint: computedFingerprint,
        source_mime_type: audioFile.type || 'audio/mpeg',
      }).select('*').single();
      if (insertError) {
        await adminClient.storage.from('stem_inputs').remove([inputPath]);
        throw insertError;
      }

      const queue = await maybeStartQueuedJobs(adminClient, mvsepToken);
      const { data: freshJob } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
      return json({ success: true, job: await serializeJob(adminClient, freshJob || job), queue });
    }

    if (action === 'refresh') {
      const jobId = url.searchParams.get('job_id');
      if (!jobId) return json({ success: false, error: 'job_id is required' }, 400);
      const { data: job, error } = await adminClient.from('song_stems').select('*').eq('id', jobId).eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!job) return json({ success: false, error: 'Job not found' }, 404);
      let refreshedJob = job;
      try {
        refreshedJob = await refreshJob(adminClient, job);
      } catch (error) {
        const { data } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
        refreshedJob = data || job;
      }
      const queue = await maybeStartQueuedJobs(adminClient, mvsepToken);
      return json({ success: true, job: await serializeJob(adminClient, refreshedJob), queue });
    }

    if (action === 'latest') {
      const fingerprint = (url.searchParams.get('source_fingerprint') || '').trim().toLowerCase();
      const projectId = (url.searchParams.get('project_id') || '').trim();
      if (!fingerprint && !projectId) return json({ success: false, error: 'source_fingerprint or project_id is required' }, 400);
      let query = adminClient.from('song_stems').select('*').eq('owner_id', user.id).eq('provider', 'mvsep');
      if (fingerprint) query = query.eq('source_fingerprint', fingerprint);
      if (projectId) query = query.eq('project_id', projectId);
      const { data: job, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!job) return json({ success: true, job: null });
      const durableJob = await ensureDurableJob(adminClient, job);
      return json({ success: true, job: await serializeJob(adminClient, durableJob) });
    }

    if (action === 'assets') {
      const jobId = url.searchParams.get('job_id');
      if (!jobId) return json({ success: false, error: 'job_id is required' }, 400);
      const { data: job, error } = await adminClient.from('song_stems').select('*').eq('id', jobId).eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!job) return json({ success: false, error: 'Job not found' }, 404);
      const durableJob = await ensureDurableJob(adminClient, job);
      return json({ success: true, job: await serializeJob(adminClient, durableJob) });
    }

    if (action === 'retry-persistence') {
      if (req.method !== 'POST') return json({ success: false, error: 'POST required' }, 405);
      const body = await req.json().catch(() => null);
      const jobId = String(body?.job_id || '');
      if (!jobId) return json({ success: false, error: 'job_id is required' }, 400);
      const { data: job, error } = await adminClient.from('song_stems').select('*')
        .eq('id', jobId).eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!job) return json({ success: false, error: 'Job not found' }, 404);
      if (job.outputs_saved_at && job.vocal_storage_path && job.instrumental_storage_path) {
        return json({ success: true, job: await serializeJob(adminClient, job) });
      }
      if (!Array.isArray(job.result_files) || job.result_files.length === 0) {
        return json({ success: false, error: 'External MVSEP outputs are unavailable; create a new separation job' }, 409);
      }
      await adminClient.from('song_stems').update({
        status: 'persisting',
        requires_new_separation: false,
        persistence_failure_code: null,
        next_persistence_retry_at: null,
      }).eq('id', job.id);
      let retriedJob = job;
      try {
        retriedJob = await persistCompletedOutputs(adminClient, { ...job, status: 'persisting' });
      } catch {
        const { data } = await adminClient.from('song_stems').select('*').eq('id', job.id).single();
        retriedJob = data || job;
      }
      return json({ success: true, job: await serializeJob(adminClient, retriedJob) });
    }

    if (action === 'duration') {
      if (req.method !== 'POST') return json({ success: false, error: 'POST required' }, 405);
      const body = await req.json().catch(() => null);
      const jobId = String(body?.job_id || '');
      const kind = body?.kind === 'vocal' || body?.kind === 'instrumental' ? body.kind : null;
      const durationSeconds = Number(body?.duration_seconds);
      if (!jobId || !kind || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60) {
        return json({ success: false, error: 'Valid job_id, kind and duration_seconds are required' }, 400);
      }
      const { data: ownedJob, error: ownershipError } = await adminClient.from('song_stems').select('id')
        .eq('id', jobId).eq('owner_id', user.id).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!ownedJob) return json({ success: false, error: 'Job not found' }, 404);
      const durationColumn = kind === 'vocal' ? 'vocal_duration_seconds' : 'instrumental_duration_seconds';
      const { data: updatedJob, error } = await adminClient.from('song_stems')
        .update({ [durationColumn]: durationSeconds }).eq('id', jobId).select('*').single();
      if (error) throw error;
      return json({ success: true, job: await serializeJob(adminClient, updatedJob) });
    }

    if (action === 'pump') {
      if (profile?.role !== 'admin') return json({ success: false, error: 'Admin only' }, 403);
      const result = await processScheduledJobs(adminClient, mvsepToken);
      return json({ success: true, ...result });
    }

    return json({ success: false, error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('mvsep-stems error', { message: error?.message || 'Unexpected error' });
    return json({ success: false, error: error?.message || 'Unexpected error' }, 500);
  }
});
