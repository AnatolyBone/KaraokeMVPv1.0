export type StemOutputKind = 'vocal' | 'instrumental';

export interface ClassifiedStemOutputs {
  vocal: unknown | null;
  instrumental: unknown | null;
  valid: boolean;
  errors: string[];
}

function candidateUrl(file: any) {
  const value = file?.url || file?.download || file?.link || file?.download_url || file?.path;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isSafeExternalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((part) => part < 0 || part > 255)) return false;
      if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return false;
      if (octets[0] === 169 && octets[1] === 254) return false;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
      if (octets[0] === 192 && octets[1] === 168) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getExternalFileUrl(file: unknown) {
  const value = candidateUrl(file);
  return value && isSafeExternalHttpUrl(value) ? value : null;
}

function normalizedFields(file: any) {
  const type = String(file?.type || '').trim().toLowerCase();
  const name = [file?.name, file?.filename, file?.label, file?.path]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return { type, name };
}

function scoreCandidate(file: unknown, kind: StemOutputKind) {
  const { type, name } = normalizedFields(file);
  const all = `${type} ${name}`;
  const negativeVocal = /no[_\s-]?vocals|without[_\s-]?vocals|instrumental|accompaniment/.test(all);
  if (kind === 'vocal') {
    if (negativeVocal) return 0;
    if (type === 'vocal' || type === 'vocals') return 100;
    if (/(?:^|[^a-z])vocals?(?:[^a-z]|$)/.test(name)) return 80;
    if (type === 'voice' || /(?:^|[^a-z])voice(?:[^a-z]|$)/.test(name)) return 60;
    return 0;
  }

  if (type === 'instrumental') return 100;
  if (type === 'other') return 90;
  if (/(?:^|[^a-z])instrumental(?:[^a-z]|$)/.test(name)) return 80;
  if (/no[_\s-]?vocals|without[_\s-]?vocals/.test(all)) return 75;
  if (/(?:^|[^a-z])accompaniment(?:[^a-z]|$)/.test(all)) return 70;
  if (/(?:^|[^a-z])other(?:[^a-z]|$)/.test(name)) return 50;
  return 0;
}

function selectUniqueCandidate(files: unknown[], kind: StemOutputKind) {
  const byUrl = new Map<string, { file: unknown; score: number; url: string }>();
  files.forEach((file) => {
    const url = getExternalFileUrl(file);
    const score = scoreCandidate(file, kind);
    if (!url || score <= 0) return;
    const existing = byUrl.get(url);
    if (!existing || score > existing.score) byUrl.set(url, { file, score, url });
  });
  const ranked = [...byUrl.values()].sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  if (ranked.length === 0) return { file: null, error: `missing_${kind}` };
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return { file: null, error: `ambiguous_${kind}` };
  }
  return { file: ranked[0].file, error: null };
}

export function classifyMvsepOutputs(files: unknown[]): ClassifiedStemOutputs {
  const source = Array.isArray(files) ? files : [];
  const vocal = selectUniqueCandidate(source, 'vocal');
  const instrumental = selectUniqueCandidate(source, 'instrumental');
  const errors = [vocal.error, instrumental.error].filter((value): value is string => Boolean(value));
  const vocalUrl = vocal.file ? getExternalFileUrl(vocal.file) : null;
  const instrumentalUrl = instrumental.file ? getExternalFileUrl(instrumental.file) : null;
  if (vocalUrl && vocalUrl === instrumentalUrl) errors.push('same_file_for_both_stems');
  return {
    vocal: errors.length === 0 ? vocal.file : null,
    instrumental: errors.length === 0 ? instrumental.file : null,
    valid: errors.length === 0,
    errors,
  };
}

export function extensionForStemContentType(contentType: string, sourceUrl: string) {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  const known: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'application/ogg': 'ogg',
  };
  if (known[normalized]) return known[normalized];
  try {
    const ext = new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase();
    if (ext && ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return ext;
  } catch {
    // The caller reports an invalid URL separately.
  }
  return 'bin';
}

export function isAcceptedStemMimeType(contentType: string) {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized.startsWith('audio/') || normalized === 'application/ogg' || normalized === 'application/octet-stream';
}

export function buildStemStoragePath(ownerId: string, jobId: string, kind: StemOutputKind, extension: string) {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ownerId || !jobId || !safeExtension) throw new Error('Invalid stem storage path components');
  return `${ownerId}/${jobId}/${kind}.${safeExtension}`;
}

export function needsOutputPersistence(job: {
  status?: string | null;
  vocal_storage_path?: string | null;
  instrumental_storage_path?: string | null;
  outputs_saved_at?: string | null;
}) {
  if (job.status === 'persisting') return true;
  return job.status === 'completed'
    && (!job.vocal_storage_path || !job.instrumental_storage_path || !job.outputs_saved_at);
}
