import { StemAsset, StemJobState, StemKind } from '../types';
import { supabase } from './supabaseClient';

const FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mvsep-stems`;
const SIGNED_URL_EXPIRY_MARGIN_MS = 30_000;

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication is required');
  return token;
}

async function requestStemApi(path: string, init?: RequestInit) {
  const token = await accessToken();
  const response = await fetch(`${FUNCTION_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || `Stem service request failed (${response.status})`);
  }
  return result;
}

export async function computeSourceFingerprint(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createStemJob(params: {
  file: File;
  projectId?: string | null;
  durationSeconds?: number | null;
  fingerprint: string;
}) {
  const form = new FormData();
  form.append('audiofile', params.file);
  form.append('sep_type', '40');
  form.append('output_format', '0');
  form.append('source_fingerprint', params.fingerprint);
  if (params.projectId) form.append('project_id', params.projectId);
  if (params.durationSeconds && params.durationSeconds > 0) {
    form.append('source_duration_seconds', String(params.durationSeconds));
  }
  const result = await requestStemApi('?action=create', { method: 'POST', body: form });
  return result.job as StemJobState;
}

export async function refreshStemJob(jobId: string) {
  const result = await requestStemApi(`?action=refresh&job_id=${encodeURIComponent(jobId)}`);
  return result.job as StemJobState;
}

export async function restoreLatestStemJob(params: { fingerprint: string; projectId?: string | null }) {
  const query = new URLSearchParams({ action: 'latest', source_fingerprint: params.fingerprint });
  if (params.projectId) query.set('project_id', params.projectId);
  const result = await requestStemApi(`?${query.toString()}`);
  return (result.job || null) as StemJobState | null;
}

export async function refreshStemAssets(jobId: string) {
  const result = await requestStemApi(`?action=assets&job_id=${encodeURIComponent(jobId)}`);
  return result.job as StemJobState;
}

export async function retryStemPersistence(jobId: string) {
  const result = await requestStemApi('?action=retry-persistence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId }),
  });
  return result.job as StemJobState;
}

export async function reportStemDuration(jobId: string, kind: StemKind, durationSeconds: number) {
  const result = await requestStemApi('?action=duration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, kind, duration_seconds: durationSeconds }),
  });
  return result.job as StemJobState;
}

function signedUrlIsFresh(asset: StemAsset | null) {
  if (!asset?.signedUrl || !asset.expiresAt) return false;
  return new Date(asset.expiresAt).getTime() - SIGNED_URL_EXPIRY_MARGIN_MS > Date.now();
}

async function fetchAssetUrl(asset: StemAsset) {
  if (!asset.signedUrl) throw new Error('Stem asset URL is unavailable');
  const response = await fetch(asset.signedUrl);
  if (!response.ok) throw new Error(`Stem download failed (${response.status})`);
  const blob = await response.blob();
  if (blob.size < 1024) throw new Error('Downloaded stem is unexpectedly small');
  if (blob.type.startsWith('text/') || blob.type.includes('html') || blob.type.includes('json')) {
    throw new Error('Downloaded stem is not audio');
  }
  return blob;
}

export async function downloadStemAsset(job: StemJobState, kind: StemKind) {
  let currentJob = job;
  let asset = currentJob[kind];
  if (!asset || !signedUrlIsFresh(asset)) {
    currentJob = await refreshStemAssets(job.id);
    asset = currentJob[kind];
  }
  if (!asset) throw new Error(`${kind} stem is unavailable`);

  try {
    return { blob: await fetchAssetUrl(asset), job: currentJob };
  } catch (error) {
    currentJob = await refreshStemAssets(job.id);
    asset = currentJob[kind];
    if (!asset) throw error;
    return { blob: await fetchAssetUrl(asset), job: currentJob };
  }
}

export async function decodeAudioDuration(blob: Blob) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio decoding is unavailable in this browser');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('Decoded audio duration is invalid');
    return decoded.duration;
  } finally {
    await context.close().catch(() => undefined);
  }
}
