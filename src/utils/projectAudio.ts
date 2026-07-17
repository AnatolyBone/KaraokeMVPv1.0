import type { RecentProject } from '../types';
import {
  listProjectAudioCandidatesFromDB,
  loadAudioFromDB,
  loadProjectAudioFromDB,
  saveProjectAudioToDB,
  type StoredProjectAudioCandidate,
} from './db.ts';

export type ProjectAudioResolutionSource =
  | 'project-key'
  | 'legacy-project-id'
  | 'matched-project-key'
  | 'legacy-current-audio'
  | 'none';

export interface ProjectAudioResolution {
  status: 'available' | 'missing' | 'ambiguous';
  audio: File | null;
  source: ProjectAudioResolutionSource;
  sourceProjectId: string | null;
  migrated: boolean;
  matchedProjectIds: string[];
  reason: string | null;
}

export interface ProjectAudioStorage {
  loadProjectAudio(projectId: string): Promise<File | null>;
  listProjectAudioCandidates(): Promise<StoredProjectAudioCandidate[]>;
  loadLegacyCurrentAudio(): Promise<File | null>;
  saveProjectAudio(projectId: string, audio: File): Promise<void>;
}

const indexedDbProjectAudioStorage: ProjectAudioStorage = {
  loadProjectAudio: loadProjectAudioFromDB,
  listProjectAudioCandidates: listProjectAudioCandidatesFromDB,
  loadLegacyCurrentAudio: loadAudioFromDB,
  saveProjectAudio: saveProjectAudioToDB,
};

function normalizeAudioFileName(value: string | null | undefined) {
  return (value || '')
    .normalize('NFKC')
    .replace(/^.*[\\/]/, '')
    .trim()
    .toLocaleLowerCase();
}

function audioFileName(audio: File | null) {
  return audio && typeof audio.name === 'string' ? normalizeAudioFileName(audio.name) : '';
}

function available(
  audio: File,
  source: ProjectAudioResolutionSource,
  sourceProjectId: string | null,
  migrated: boolean,
  reason: string | null = null,
): ProjectAudioResolution {
  return {
    status: 'available',
    audio,
    source,
    sourceProjectId,
    migrated,
    matchedProjectIds: sourceProjectId ? [sourceProjectId] : [],
    reason,
  };
}

async function migrateResolvedAudio(
  projectId: string,
  audio: File,
  storage: ProjectAudioStorage,
) {
  try {
    await storage.saveProjectAudio(projectId, audio);
    return { migrated: true, reason: null };
  } catch (error) {
    return {
      migrated: false,
      reason: error instanceof Error ? error.message : 'project-audio-migration-failed',
    };
  }
}

export async function resolveProjectAudio(
  project: Pick<RecentProject, 'id' | 'audioFileName' | 'legacyProjectIds'>,
  storage: ProjectAudioStorage = indexedDbProjectAudioStorage,
): Promise<ProjectAudioResolution> {
  const directAudio = await storage.loadProjectAudio(project.id);
  if (directAudio) return available(directAudio, 'project-key', project.id, false);

  const legacyIds = Array.from(new Set(project.legacyProjectIds || []))
    .filter((id) => id && id !== project.id);
  for (const legacyId of legacyIds) {
    const legacyAudio = await storage.loadProjectAudio(legacyId);
    if (legacyAudio) {
      const migration = await migrateResolvedAudio(project.id, legacyAudio, storage);
      return available(
        legacyAudio,
        'legacy-project-id',
        legacyId,
        migration.migrated,
        migration.reason,
      );
    }
  }

  const expectedName = normalizeAudioFileName(project.audioFileName);
  if (expectedName) {
    const candidates = await storage.listProjectAudioCandidates();
    const knownIds = new Set([project.id, ...legacyIds]);
    const matchingCandidates = candidates.filter((candidate) =>
      !knownIds.has(candidate.projectId) && audioFileName(candidate.audio) === expectedName
    );

    if (matchingCandidates.length === 1) {
      const candidate = matchingCandidates[0];
      const migration = await migrateResolvedAudio(project.id, candidate.audio, storage);
      return available(
        candidate.audio,
        'matched-project-key',
        candidate.projectId,
        migration.migrated,
        migration.reason,
      );
    }

    if (matchingCandidates.length > 1) {
      return {
        status: 'ambiguous',
        audio: null,
        source: 'none',
        sourceProjectId: null,
        migrated: false,
        matchedProjectIds: matchingCandidates.map((candidate) => candidate.projectId).sort(),
        reason: 'multiple-project-audio-keys-match-file-name',
      };
    }

    const currentAudio = await storage.loadLegacyCurrentAudio();
    if (currentAudio && audioFileName(currentAudio) === expectedName) {
      const migration = await migrateResolvedAudio(project.id, currentAudio, storage);
      return available(
        currentAudio,
        'legacy-current-audio',
        null,
        migration.migrated,
        migration.reason,
      );
    }
  }

  return {
    status: 'missing',
    audio: null,
    source: 'none',
    sourceProjectId: null,
    migrated: false,
    matchedProjectIds: [],
    reason: expectedName ? 'no-safe-audio-match' : 'project-has-no-audio-file-name',
  };
}
