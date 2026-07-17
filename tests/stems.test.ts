import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStemStoragePath,
  classifyMvsepOutputs,
  extensionForStemContentType,
  isAcceptedStemMimeType,
  isSafeExternalHttpUrl,
  needsOutputPersistence,
} from '../supabase/functions/mvsep-stems/stemUtils.ts';
import {
  canCreateStemJob,
  instrumentalAudioIdentity,
  originalAudioIdentity,
  selectLatestJobByFingerprint,
  shouldWarnAboutInstrumentalDuration,
  withoutPersistedSignedUrls,
} from '../src/utils/stemRuntime.ts';
import type { StemJobState } from '../src/types.ts';

const result = (type: string, name: string, url: string) => ({ type, name, url });

test('classifies vocal/instrumental variants deterministically', () => {
  for (const vocalType of ['vocal', 'vocals', 'VOCALS']) {
    const classified = classifyMvsepOutputs([
      result('preview', 'preview.mp3', 'https://cdn.mvsep.com/preview.mp3'),
      result('other', 'other.mp3', 'https://cdn.mvsep.com/other.mp3'),
      result(vocalType, 'voice.mp3', 'https://cdn.mvsep.com/vocal.mp3'),
    ]);
    assert.equal(classified.valid, true);
    assert.equal((classified.vocal as { url: string }).url, 'https://cdn.mvsep.com/vocal.mp3');
    assert.equal((classified.instrumental as { url: string }).url, 'https://cdn.mvsep.com/other.mp3');
  }
});

test('uses names when type is absent and ignores extra files', () => {
  const classified = classifyMvsepOutputs([
    { name: 'track_vocals.mp3', download: 'https://cdn.mvsep.com/v.mp3' },
    { filename: 'track_instrumental.mp3', link: 'https://cdn.mvsep.com/i.mp3' },
    result('preview', 'preview.mp3', 'https://cdn.mvsep.com/p.mp3'),
  ]);
  assert.equal(classified.valid, true);
});

test('supports accompaniment/no-vocals and prefers stronger deterministic candidates', () => {
  const classified = classifyMvsepOutputs([
    result('voice', 'voice.mp3', 'https://cdn.mvsep.com/voice.mp3'),
    result('VOCALS', 'vocals.mp3', 'https://cdn.mvsep.com/vocals.mp3'),
    result('', 'track_without_vocals.mp3', 'https://cdn.mvsep.com/no-vocals.mp3'),
    result('instrumental', 'instrumental.mp3', 'https://cdn.mvsep.com/instrumental.mp3'),
  ]);
  assert.equal(classified.valid, true);
  assert.equal((classified.vocal as { url: string }).url, 'https://cdn.mvsep.com/vocals.mp3');
  assert.equal((classified.instrumental as { url: string }).url, 'https://cdn.mvsep.com/instrumental.mp3');
});

test('rejects missing and equally ranked ambiguous outputs', () => {
  assert.deepEqual(classifyMvsepOutputs([result('vocals', 'v.mp3', 'https://cdn.mvsep.com/v.mp3')]).errors, ['missing_instrumental']);
  const ambiguous = classifyMvsepOutputs([
    result('vocals', 'v1.mp3', 'https://cdn.mvsep.com/v1.mp3'),
    result('vocals', 'v2.mp3', 'https://cdn.mvsep.com/v2.mp3'),
    result('instrumental', 'i.mp3', 'https://cdn.mvsep.com/i.mp3'),
  ]);
  assert.equal(ambiguous.valid, false);
  assert.ok(ambiguous.errors.includes('ambiguous_vocal'));
});

test('builds stable paths and maps MIME/extension', () => {
  assert.equal(buildStemStoragePath('user', 'job', 'vocal', '.MP3'), 'user/job/vocal.mp3');
  assert.equal(extensionForStemContentType('audio/x-wav', 'https://cdn.mvsep.com/file'), 'wav');
  assert.equal(extensionForStemContentType('application/octet-stream', 'https://cdn.mvsep.com/file.flac'), 'flac');
  assert.equal(isAcceptedStemMimeType('text/html'), false);
  assert.equal(isAcceptedStemMimeType('audio/mpeg'), true);
});

test('blocks local and insecure output URLs', () => {
  assert.equal(isSafeExternalHttpUrl('http://mvsep.com/file.mp3'), false);
  assert.equal(isSafeExternalHttpUrl('https://127.0.0.1/file.mp3'), false);
  assert.equal(isSafeExternalHttpUrl('https://169.254.169.254/file.mp3'), false);
  assert.equal(isSafeExternalHttpUrl('https://cdn.mvsep.com/file.mp3'), true);
});

test('detects new and legacy jobs that need persistence', () => {
  assert.equal(needsOutputPersistence({ status: 'persisting' }), true);
  assert.equal(needsOutputPersistence({ status: 'completed', vocal_storage_path: null, instrumental_storage_path: null }), true);
  assert.equal(needsOutputPersistence({
    status: 'completed',
    vocal_storage_path: 'u/j/vocal.mp3',
    instrumental_storage_path: 'u/j/instrumental.mp3',
    outputs_saved_at: '2026-01-01T00:00:00Z',
  }), false);
});

test('separates original and active instrumental identity', () => {
  const original = originalAudioIdentity('source-hash');
  assert.equal(canCreateStemJob(original), true);
  const instrumental = instrumentalAudioIdentity('source-hash', 'instrumental-hash');
  assert.equal(instrumental.sourceAudioFingerprint, 'source-hash');
  assert.equal(instrumental.activeAudioFingerprint, 'instrumental-hash');
  assert.equal(canCreateStemJob(instrumental), false);
});

test('applies the two-second and one-percent duration warning together', () => {
  assert.equal(shouldWarnAboutInstrumentalDuration(200, 202.1), true);
  assert.equal(shouldWarnAboutInstrumentalDuration(400, 402.1), false);
  assert.equal(shouldWarnAboutInstrumentalDuration(200, 201.9), false);
});

test('selects by fingerprint and strips signed URLs from persistence', () => {
  const makeJob = (id: string, fingerprint: string, createdAt: string): StemJobState => ({
    id,
    status: 'completed',
    mvsepStatus: 'done',
    providerJobUrl: null,
    projectId: null,
    songId: null,
    sourceFileName: 'song.mp3',
    sourceSizeBytes: 1,
    sourceDurationSeconds: 1,
    sourceFingerprint: fingerprint,
    sourceMimeType: 'audio/mpeg',
    vocal: { storagePath: 'v', signedUrl: 'secret', expiresAt: 'soon', mimeType: 'audio/mpeg', sizeBytes: 1, durationSeconds: 1 },
    instrumental: null,
    errorMessage: null,
    outputsPersistError: null,
    persistenceFailureCode: null,
    requiresNewSeparation: false,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    outputsSavedAt: createdAt,
  });
  const older = makeJob('a', 'target', '2026-01-01T00:00:00Z');
  const newer = makeJob('b', 'target', '2026-02-01T00:00:00Z');
  assert.equal(selectLatestJobByFingerprint([older, makeJob('c', 'other', '2026-03-01T00:00:00Z'), newer], 'target')?.id, 'b');
  const persisted = withoutPersistedSignedUrls(newer);
  assert.equal(persisted?.vocal?.storagePath, 'v');
  assert.equal(persisted?.vocal?.signedUrl, undefined);
  assert.equal(persisted?.vocal?.expiresAt, undefined);
});
