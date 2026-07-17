import type { AudioIdentityState, StemJobState } from '../types';

export const INSTRUMENTAL_DURATION_WARNING_SECONDS = 2;
export const INSTRUMENTAL_DURATION_WARNING_RATIO = 0.01;

export function shouldWarnAboutInstrumentalDuration(originalDuration: number, instrumentalDuration: number) {
  if (!Number.isFinite(originalDuration) || originalDuration <= 0 || !Number.isFinite(instrumentalDuration)) return false;
  const difference = Math.abs(instrumentalDuration - originalDuration);
  return difference > INSTRUMENTAL_DURATION_WARNING_SECONDS
    && difference / originalDuration > INSTRUMENTAL_DURATION_WARNING_RATIO;
}

export function originalAudioIdentity(fingerprint: string): AudioIdentityState {
  return {
    sourceAudioFingerprint: fingerprint,
    activeAudioFingerprint: fingerprint,
    activeAudioKind: 'original',
  };
}

export function instrumentalAudioIdentity(sourceFingerprint: string, instrumentalFingerprint: string): AudioIdentityState {
  return {
    sourceAudioFingerprint: sourceFingerprint,
    activeAudioFingerprint: instrumentalFingerprint,
    activeAudioKind: 'instrumental',
  };
}

export function canCreateStemJob(identity: AudioIdentityState) {
  return identity.activeAudioKind === 'original'
    && (!identity.sourceAudioFingerprint || identity.sourceAudioFingerprint === identity.activeAudioFingerprint);
}

export function selectLatestJobByFingerprint(jobs: StemJobState[], fingerprint: string) {
  return jobs
    .filter((job) => job.sourceFingerprint === fingerprint)
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '') || right.id.localeCompare(left.id))[0] || null;
}

export function withoutPersistedSignedUrls(job: StemJobState | null): StemJobState | null {
  if (!job) return null;
  return {
    ...job,
    vocal: job.vocal ? { ...job.vocal, signedUrl: undefined, expiresAt: undefined } : null,
    instrumental: job.instrumental ? { ...job.instrumental, signedUrl: undefined, expiresAt: undefined } : null,
  };
}
