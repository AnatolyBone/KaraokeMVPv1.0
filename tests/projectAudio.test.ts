import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveProjectAudio,
  type ProjectAudioStorage,
} from '../src/utils/projectAudio.ts';
import type { StoredProjectAudioCandidate } from '../src/utils/db.ts';

const audioFile = (name: string) => ({ name }) as File;

function createStorage(options: {
  projectAudio?: Record<string, File>;
  candidates?: StoredProjectAudioCandidate[];
  currentAudio?: File | null;
} = {}) {
  const projectAudio = new Map(Object.entries(options.projectAudio || {}));
  const writes: Array<{ projectId: string; audio: File }> = [];
  const storage: ProjectAudioStorage = {
    loadProjectAudio: async (projectId) => projectAudio.get(projectId) || null,
    listProjectAudioCandidates: async () => options.candidates || [],
    loadLegacyCurrentAudio: async () => options.currentAudio || null,
    saveProjectAudio: async (projectId, audio) => {
      writes.push({ projectId, audio });
      projectAudio.set(projectId, audio);
    },
  };
  return { storage, writes, projectAudio };
}

test('resolves the canonical project key without requiring audioFileName', async () => {
  const audio = audioFile('track.mp3');
  const { storage, writes } = createStorage({ projectAudio: { projectA: audio } });

  const resolution = await resolveProjectAudio({
    id: 'projectA',
    audioFileName: null,
  }, storage);

  assert.equal(resolution.status, 'available');
  assert.equal(resolution.source, 'project-key');
  assert.equal(resolution.audio, audio);
  assert.equal(writes.length, 0);
});

test('resolves a legacy project id and migrates it to the current id', async () => {
  const audio = audioFile('track.mp3');
  const { storage, writes } = createStorage({ projectAudio: { oldProject: audio } });

  const resolution = await resolveProjectAudio({
    id: 'newProject',
    audioFileName: 'track.mp3',
    legacyProjectIds: ['oldProject'],
  }, storage);

  assert.equal(resolution.status, 'available');
  assert.equal(resolution.source, 'legacy-project-id');
  assert.equal(resolution.sourceProjectId, 'oldProject');
  assert.equal(resolution.migrated, true);
  assert.deepEqual(writes, [{ projectId: 'newProject', audio }]);
});

test('recovers an already-remapped project by one unique matching project key', async () => {
  const audio = audioFile('Artist - Song.mp3');
  const candidate = {
    projectId: 'lostLegacyId',
    storageKey: 'project:lostLegacyId:audio',
    audio,
  };
  const { storage, writes } = createStorage({ candidates: [candidate] });

  const resolution = await resolveProjectAudio({
    id: 'cloudUuid',
    audioFileName: 'artist - song.MP3',
  }, storage);

  assert.equal(resolution.status, 'available');
  assert.equal(resolution.source, 'matched-project-key');
  assert.equal(resolution.sourceProjectId, 'lostLegacyId');
  assert.deepEqual(writes, [{ projectId: 'cloudUuid', audio }]);
});

test('does not guess when multiple project keys match the same file name', async () => {
  const first = audioFile('song.mp3');
  const second = audioFile('SONG.MP3');
  const { storage, writes } = createStorage({
    candidates: [
      { projectId: 'first', storageKey: 'project:first:audio', audio: first },
      { projectId: 'second', storageKey: 'project:second:audio', audio: second },
    ],
  });

  const resolution = await resolveProjectAudio({
    id: 'current',
    audioFileName: 'song.mp3',
  }, storage);

  assert.equal(resolution.status, 'ambiguous');
  assert.deepEqual(resolution.matchedProjectIds, ['first', 'second']);
  assert.equal(writes.length, 0);
});

test('supports old projects stored only under current_audio and migrates them', async () => {
  const audio = audioFile('legacy.mp3');
  const { storage, writes } = createStorage({ currentAudio: audio });

  const resolution = await resolveProjectAudio({
    id: 'legacyProject',
    audioFileName: 'legacy.mp3',
  }, storage);

  assert.equal(resolution.status, 'available');
  assert.equal(resolution.source, 'legacy-current-audio');
  assert.equal(resolution.migrated, true);
  assert.deepEqual(writes, [{ projectId: 'legacyProject', audio }]);
});

test('rejects a mismatched current_audio file', async () => {
  const { storage, writes } = createStorage({ currentAudio: audioFile('another-song.mp3') });

  const resolution = await resolveProjectAudio({
    id: 'project',
    audioFileName: 'expected-song.mp3',
  }, storage);

  assert.equal(resolution.status, 'missing');
  assert.equal(resolution.audio, null);
  assert.equal(writes.length, 0);
});
