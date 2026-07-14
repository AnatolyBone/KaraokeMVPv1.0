// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const MVSEP_CREATE_URL = 'https://mvsep.com/api/separation/create';
const MVSEP_GET_URL = 'https://mvsep.com/api/separation/get';
const ACTIVE_STATUSES = ['submitting', 'waiting', 'processing', 'distributing', 'merging'];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isPremiumProfile(profile: any) {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'pro') return true;
  if (profile.plan === 'plus' && profile.plus_until && new Date(profile.plus_until).getTime() > Date.now()) return true;
  return false;
}

function normalizeMvsepToken(rawToken: string) {
  return rawToken
    .trim()
    .replace(/^[`"']+|[`"']+$/g, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
}

function getTokenDebugInfo(rawToken: string, token: string) {
  return {
    rawLength: rawToken.length,
    tokenLength: token.length,
    hadWhitespace: rawToken !== rawToken.trim(),
    hadMarkdownStars: rawToken.trim().startsWith('*') || rawToken.trim().endsWith('*'),
    hadQuotes: /^[`"']|[`"']$/.test(rawToken.trim()),
    isAlnum: /^[a-z0-9]+$/i.test(token),
  };
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

async function getAuthedUser(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string) {
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
  if (!isPremiumProfile(profile)) throw new Error('MVSEP separation is available for Plus/Pro users only');

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

async function submitJobToMvsep(adminClient: any, job: any, mvsepToken: string, tokenDebug: any) {
  const { data: inputFile, error: downloadError } = await adminClient.storage
    .from('stem_inputs')
    .download(job.input_storage_path);

  if (downloadError || !inputFile) throw downloadError || new Error('Input file is missing');

  const form = new FormData();
  form.append('api_token', mvsepToken);
  form.append('audiofile', inputFile, job.input_file_name || 'audio.mp3');
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
    tokenDebug,
  });

  if (!response.ok || !result?.success) {
    const message = result?.data?.message || result?.message || `MVSEP create failed (${response.status})`;
    const debugMessage = [
      message,
      `responseStatus=${response.status}`,
      `tokenLength=${tokenDebug.tokenLength}`,
      `rawLength=${tokenDebug.rawLength}`,
      `hadWhitespace=${tokenDebug.hadWhitespace}`,
      `hadMarkdownStars=${tokenDebug.hadMarkdownStars}`,
      `hadQuotes=${tokenDebug.hadQuotes}`,
      `isAlnum=${tokenDebug.isAlnum}`,
      `response=${stringifySafe(result || responseText).slice(0, 500)}`,
    ].join(' | ');
    throw new Error(debugMessage);
  }

  const hash = result?.data?.hash;
  if (!hash) throw new Error('MVSEP did not return a job hash');

  const { error } = await adminClient
    .from('song_stems')
    .update({
      status: 'waiting',
      mvsep_status: 'waiting',
      provider_job_hash: hash,
      provider_job_url: result?.data?.link || null,
      submitted_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', job.id);

  if (error) throw error;
  return { hash, link: result?.data?.link || null };
}

async function maybeStartQueuedJobs(adminClient: any, mvsepToken: string, tokenDebug: any) {
  const limit = await getConcurrencyLimit(adminClient);
  const activeCount = await countActiveJobs(adminClient);
  const slots = Math.max(limit - activeCount, 0);
  if (slots <= 0) return { started: 0, limit, activeCount };

  const { data: queuedJobs, error } = await adminClient
    .from('song_stems')
    .select('*')
    .eq('provider', 'mvsep')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(slots);

  if (error) throw error;

  let started = 0;
  for (const job of queuedJobs || []) {
    const { data: lockedJob, error: lockError } = await adminClient
      .from('song_stems')
      .update({ status: 'submitting', error_message: null })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (lockError || !lockedJob) continue;

    try {
      await submitJobToMvsep(adminClient, lockedJob, mvsepToken, tokenDebug);
      started += 1;
    } catch (err) {
      console.error('MVSEP submit failed:', err);
      await adminClient
        .from('song_stems')
        .update({
          status: 'failed',
          error_message: err?.message || 'MVSEP submit failed',
        })
        .eq('id', lockedJob.id);
    }
  }

  return { started, limit, activeCount };
}

async function refreshJob(adminClient: any, job: any, mvsepToken: string) {
  if (!job.provider_job_hash) return job;

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

  if (!response.ok || result?.success === false) {
    const message = result?.data?.message || result?.message || `MVSEP status failed (${response.status})`;
    await adminClient
      .from('song_stems')
      .update({ status: 'failed', mvsep_status: 'failed', error_message: message })
      .eq('id', job.id);
    return { ...job, status: 'failed', error_message: message };
  }

  const mvsepStatus = pickMvsepStatus(result) || job.mvsep_status || 'processing';
  const mappedStatus = mvsepStatus === 'done'
    ? 'completed'
    : mvsepStatus === 'failed'
      ? 'failed'
      : ACTIVE_STATUSES.includes(mvsepStatus)
        ? mvsepStatus
        : 'processing';

  const updatePayload: Record<string, unknown> = {
    status: mappedStatus,
    mvsep_status: mvsepStatus,
    result_files: pickResultFiles(result),
    error_message: mappedStatus === 'failed' ? (result?.data?.message || 'MVSEP failed') : null,
  };

  if (mappedStatus === 'completed') {
    updatePayload.completed_at = new Date().toISOString();
  }

  const { data: updatedJob, error } = await adminClient
    .from('song_stems')
    .update(updatePayload)
    .eq('id', job.id)
    .select('*')
    .single();

  if (error) throw error;
  return updatedJob;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const rawMvsepToken = Deno.env.get('MVSEP_API_TOKEN') || '';
  const mvsepToken = normalizeMvsepToken(rawMvsepToken);
  const tokenDebug = getTokenDebugInfo(rawMvsepToken, mvsepToken);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ success: false, error: 'Supabase function is not configured' }, 500);
  }
  if (!mvsepToken) {
    return json({ success: false, error: 'MVSEP_API_TOKEN is not configured' }, 500);
  }

  try {
    const { user, profile, adminClient } = await getAuthedUser(req, supabaseUrl, anonKey, serviceKey);
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'create';

    if (action === 'create') {
      if (req.method !== 'POST') return json({ success: false, error: 'POST required' }, 405);
      const form = await req.formData();
      const audioFile = form.get('audiofile');
      if (!(audioFile instanceof File)) {
        return json({ success: false, error: 'audiofile is required' }, 400);
      }

      const outputFormat = profile.role === 'admin'
        ? Number(form.get('output_format') ?? 0)
        : 0;
      const sepType = Number(form.get('sep_type') ?? 40);
      const fileExt = audioFile.name.split('.').pop() || 'mp3';
      const inputPath = `${user.id}/${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await adminClient.storage
        .from('stem_inputs')
        .upload(inputPath, audioFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: audioFile.type || 'audio/mpeg',
        });

      if (uploadError) throw uploadError;

      const { data: job, error: insertError } = await adminClient
        .from('song_stems')
        .insert({
          owner_id: user.id,
          provider: 'mvsep',
          status: 'queued',
          sep_type: Number.isFinite(sepType) ? sepType : 40,
          output_format: Number.isFinite(outputFormat) ? outputFormat : 0,
          input_storage_path: inputPath,
          input_file_name: audioFile.name,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      const queue = await maybeStartQueuedJobs(adminClient, mvsepToken, tokenDebug);
      const { data: freshJob } = await adminClient
        .from('song_stems')
        .select('*')
        .eq('id', job.id)
        .single();

      return json({ success: true, job: freshJob || job, queue });
    }

    if (action === 'refresh') {
      const jobId = url.searchParams.get('job_id');
      if (!jobId) return json({ success: false, error: 'job_id is required' }, 400);

      const { data: job, error } = await adminClient
        .from('song_stems')
        .select('*')
        .eq('id', jobId)
        .eq('owner_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (!job) return json({ success: false, error: 'Job not found' }, 404);

      const refreshedJob = await refreshJob(adminClient, job, mvsepToken);
      const queue = await maybeStartQueuedJobs(adminClient, mvsepToken, tokenDebug);
      return json({ success: true, job: refreshedJob, queue });
    }

    if (action === 'pump') {
      if (profile.role !== 'admin') return json({ success: false, error: 'Admin only' }, 403);
      const queue = await maybeStartQueuedJobs(adminClient, mvsepToken, tokenDebug);
      return json({ success: true, queue });
    }

    return json({ success: false, error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('mvsep-stems error:', err);
    return json({ success: false, error: err?.message || 'Unexpected error' }, 500);
  }
});
