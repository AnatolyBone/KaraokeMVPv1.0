import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  Cloud,
  CloudOff,
  Edit3,
  FileAudio,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { loadProjectAudioFromDB } from '../utils/db';
import type { ProjectCloudSyncStatus, RecentProject } from '../types';

type AudioAvailability = 'checking' | 'available' | 'missing';

interface ProjectsLibraryProps {
  onBack: () => void;
  onProjectOpened: () => void;
  onPublishProject: () => void;
}

function formatProjectDate(project: RecentProject, language: 'ru' | 'en') {
  const value = project.updatedAt || project.createdAt;
  if (!value) return language === 'ru' ? 'Дата не сохранена' : 'Date unavailable';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return language === 'ru' ? 'Дата не сохранена' : 'Date unavailable';

  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getSyncPresentation(
  status: ProjectCloudSyncStatus | undefined,
  authenticated: boolean,
  syncing: boolean,
  language: 'ru' | 'en',
) {
  if (!authenticated) {
    return {
      label: language === 'ru' ? 'Только локально' : 'Local only',
      className: 'text-zinc-500 dark:text-zinc-400',
      icon: HardDrive,
    };
  }
  if (syncing || status === 'pending') {
    return {
      label: language === 'ru' ? 'Синхронизация…' : 'Syncing…',
      className: 'text-amber-600 dark:text-amber-400',
      icon: Loader2,
    };
  }
  if (status === 'synced') {
    return {
      label: language === 'ru' ? 'Синхронизирован' : 'Synced',
      className: 'text-emerald-600 dark:text-emerald-400',
      icon: CheckCircle2,
    };
  }
  if (status === 'error') {
    return {
      label: language === 'ru' ? 'Ошибка синхронизации' : 'Sync error',
      className: 'text-red-600 dark:text-red-400',
      icon: CloudOff,
    };
  }
  return {
    label: language === 'ru' ? 'Ожидает синхронизации' : 'Waiting to sync',
    className: 'text-amber-600 dark:text-amber-400',
    icon: Cloud,
  };
}

export const ProjectsLibrary: React.FC<ProjectsLibraryProps> = ({
  onBack,
  onProjectOpened,
  onPublishProject,
}) => {
  const {
    recentProjects,
    loadProject,
    renameProject,
    deleteProject,
    syncProjects,
    syncing,
    user,
    language,
    theme,
  } = useKaraokeStore();
  const [audioAvailability, setAudioAvailability] = useState<Record<string, AudioAvailability>>({});
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const projects = useMemo(
    () => recentProjects
      .map((project, index) => ({ project, index }))
      .sort((a, b) => {
        const aTime = Date.parse(a.project.updatedAt || a.project.createdAt || '') || 0;
        const bTime = Date.parse(b.project.updatedAt || b.project.createdAt || '') || 0;
        return bTime - aTime || a.index - b.index;
      })
      .map(({ project }) => project),
    [recentProjects],
  );

  useEffect(() => {
    let cancelled = false;
    const inspectAudio = async () => {
      const initial = Object.fromEntries(projects.map((project) => [project.id, 'checking' as const]));
      setAudioAvailability(initial);
      const checked = await Promise.all(projects.map(async (project) => {
        if (!project.audioFileName) return [project.id, 'missing'] as const;
        const audio = await loadProjectAudioFromDB(project.id).catch(() => null);
        return [project.id, audio ? 'available' : 'missing'] as const;
      }));
      if (!cancelled) setAudioAvailability(Object.fromEntries(checked));
    };
    inspectAudio();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const handleOpen = async (projectId: string, publish = false) => {
    setBusyProjectId(projectId);
    try {
      await loadProject(projectId);
      if (publish) onPublishProject();
      else onProjectOpened();
    } finally {
      setBusyProjectId(null);
    }
  };

  const startRename = (project: RecentProject) => {
    setRenamingProjectId(project.id);
    setRenameValue(project.title);
  };

  const cancelRename = () => {
    setRenamingProjectId(null);
    setRenameValue('');
  };

  const handleRename = async (project: RecentProject) => {
    if (!renameValue.trim()) return;
    if (renameValue.trim() === project.title) {
      cancelRename();
      return;
    }
    setBusyProjectId(project.id);
    try {
      await renameProject(project.id, renameValue);
      cancelRename();
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleDelete = async (project: RecentProject) => {
    const confirmed = window.confirm(
      language === 'ru'
        ? `Удалить проект «${project.title}»? Локальное аудио и сохранённые stems этого проекта также будут удалены.`
        : `Delete “${project.title}”? Its local audio and saved stems will also be deleted.`,
    );
    if (!confirmed) return;
    setBusyProjectId(project.id);
    try {
      await deleteProject(project.id);
    } finally {
      setBusyProjectId(null);
    }
  };

  const panelClass = theme === 'dark'
    ? 'border-zinc-800 bg-zinc-950/75 text-zinc-100'
    : 'border-zinc-200 bg-white/90 text-zinc-900';

  return (
    <section className="flex w-full flex-col gap-5" aria-labelledby="projects-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className={`flex w-fit items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all hover:scale-[1.02] ${panelClass}`}
        >
          <ChevronLeft size={14} />
          {language === 'ru' ? 'Назад к проекту' : 'Back to project'}
        </button>
        {user && (
          <button
            type="button"
            onClick={() => syncProjects()}
            disabled={syncing}
            className="flex w-fit items-center gap-2 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-extrabold text-white transition-all hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {language === 'ru' ? 'Синхронизировать' : 'Sync projects'}
          </button>
        )}
      </div>

      <div className={`rounded-3xl border p-5 shadow-xl sm:p-7 ${panelClass}`}>
        <div className="flex flex-col gap-3 border-b border-zinc-200/70 pb-5 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-violet-500">
              <FolderOpen size={22} />
              <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]">
                {language === 'ru' ? 'Черновики без тарифных ограничений' : 'Drafts without plan restrictions'}
              </span>
            </div>
            <h1 id="projects-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
              {language === 'ru' ? 'Мои проекты' : 'My projects'}
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {language === 'ru'
                ? 'Открывайте свои черновики из Лайт или Про. Pro-ограничения применяются только к функциям редактора, а не к сохранённым проектам.'
                : 'Open your drafts from Lite or Pro. Pro restrictions apply to editor features, not to your saved projects.'}
            </p>
          </div>
          <div className="text-xs font-bold text-zinc-500">
            {projects.length} {language === 'ru' ? (projects.length === 1 ? 'проект' : 'проектов') : (projects.length === 1 ? 'project' : 'projects')}
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center">
            <div className="mb-4 rounded-2xl bg-violet-500/10 p-4 text-violet-500">
              <FolderOpen size={32} />
            </div>
            <h2 className="text-base font-extrabold">
              {language === 'ru' ? 'Сохранённых проектов пока нет' : 'No saved projects yet'}
            </h2>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-zinc-500">
              {language === 'ru'
                ? 'Загрузите трек, добавьте текст и сохраните черновик. Он появится здесь и останется доступен в обоих режимах.'
                : 'Load a track, add lyrics, and save a draft. It will appear here and remain available in both modes.'}
            </p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {projects.map((project) => {
              const timedCount = project.lines.filter((line) => line.time !== null).length;
              const availability = audioAvailability[project.id] || 'checking';
              const sync = getSyncPresentation(project.cloudSyncStatus, Boolean(user), syncing, language);
              const SyncIcon = sync.icon;
              const busy = busyProjectId === project.id;

              return (
                <article
                  key={project.id}
                  className={`flex min-w-0 flex-col rounded-2xl border p-4 transition-all hover:border-violet-500/40 ${
                    theme === 'dark' ? 'border-zinc-800 bg-zinc-900/45' : 'border-zinc-200 bg-zinc-50/80'
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="shrink-0 rounded-xl bg-violet-500/10 p-2.5 text-violet-500">
                      <FileAudio size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      {renamingProjectId === project.id ? (
                        <form
                          className="flex min-w-0 items-center gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleRename(project);
                          }}
                        >
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            maxLength={160}
                            aria-label={language === 'ru' ? 'Новое название проекта' : 'New project name'}
                            className="min-w-0 flex-1 rounded-lg border border-violet-400 bg-transparent px-2 py-1.5 text-xs font-bold outline-none ring-violet-500/20 focus:ring-2"
                          />
                          <button
                            type="submit"
                            disabled={!renameValue.trim() || busyProjectId === project.id}
                            aria-label={language === 'ru' ? 'Сохранить название' : 'Save name'}
                            className="rounded-lg bg-emerald-600 p-1.5 text-white disabled:opacity-50"
                            title={language === 'ru' ? 'Сохранить название' : 'Save name'}
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            aria-label={language === 'ru' ? 'Отмена переименования' : 'Cancel rename'}
                            className="rounded-lg border border-zinc-300 p-1.5 text-zinc-500 dark:border-zinc-700"
                            title={language === 'ru' ? 'Отмена' : 'Cancel'}
                          >
                            <X size={13} />
                          </button>
                        </form>
                      ) : (
                        <h2 className="line-clamp-2 break-words text-sm font-extrabold leading-snug" title={project.title}>
                          {project.title || (language === 'ru' ? 'Без названия' : 'Untitled')}
                        </h2>
                      )}
                      <p className="mt-1 text-[10px] font-semibold text-zinc-500">
                        {language === 'ru' ? 'Изменён' : 'Modified'}: {formatProjectDate(project, language)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                    <div className="rounded-xl border border-zinc-200/70 px-3 py-2 dark:border-zinc-800">
                      <span className="block text-zinc-500">{language === 'ru' ? 'Разметка' : 'Timing'}</span>
                      <strong>{project.lines.length} / {timedCount}</strong>
                      <span className="ml-1 text-zinc-500">{language === 'ru' ? 'строк / размечено' : 'lines / timed'}</span>
                    </div>
                    <div className="rounded-xl border border-zinc-200/70 px-3 py-2 dark:border-zinc-800">
                      <span className="block text-zinc-500">{language === 'ru' ? 'Локальное аудио' : 'Local audio'}</span>
                      <strong className={`flex items-center gap-1.5 ${availability === 'available' ? 'text-emerald-600 dark:text-emerald-400' : availability === 'missing' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500'}`}>
                        {availability === 'checking' ? <Loader2 size={12} className="animate-spin" /> : availability === 'available' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {availability === 'checking'
                          ? (language === 'ru' ? 'Проверка…' : 'Checking…')
                          : availability === 'available'
                            ? (language === 'ru' ? 'Доступно' : 'Available')
                            : (language === 'ru' ? 'Недоступно' : 'Unavailable')}
                      </strong>
                    </div>
                    <div className="rounded-xl border border-zinc-200/70 px-3 py-2 dark:border-zinc-800">
                      <span className="block text-zinc-500">{language === 'ru' ? 'Облако' : 'Cloud'}</span>
                      <strong className={`flex items-center gap-1.5 ${sync.className}`}>
                        <SyncIcon size={12} className={syncing || project.cloudSyncStatus === 'pending' ? 'animate-spin' : ''} />
                        {sync.label}
                      </strong>
                    </div>
                  </div>

                  {availability === 'missing' && project.audioFileName && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {language === 'ru'
                        ? `Файл «${project.audioFileName}» не найден в этом браузере. Текст и тайминги можно открыть, но аудио потребуется загрузить заново.`
                        : `“${project.audioFileName}” is not stored in this browser. Lyrics and timings can still be opened, but the audio must be loaded again.`}
                    </p>
                  )}

                  <div className="mt-auto grid grid-cols-2 gap-2 pt-4 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => handleOpen(project.id)}
                      disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                      {language === 'ru' ? 'Открыть' : 'Open'}
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(project)}
                      disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-[11px] font-extrabold transition-colors hover:border-violet-400 hover:text-violet-500 disabled:opacity-60 dark:border-zinc-700"
                    >
                      <Edit3 size={13} />
                      {language === 'ru' ? 'Переименовать' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(project)}
                      disabled={busy}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 px-3 py-2 text-[11px] font-extrabold text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-60"
                    >
                      <Trash2 size={13} />
                      {language === 'ru' ? 'Удалить' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpen(project.id, true)}
                      disabled={busy || timedCount === 0}
                      title={timedCount === 0 ? (language === 'ru' ? 'Для публикации нужна хотя бы одна размеченная строка' : 'At least one timed line is required') : undefined}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-extrabold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800"
                    >
                      <UploadCloud size={13} />
                      {language === 'ru' ? 'Опубликовать' : 'Publish'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
