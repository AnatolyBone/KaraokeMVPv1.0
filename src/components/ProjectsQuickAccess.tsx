import React, { useMemo, useState } from 'react';
import { FolderOpen, Loader2, Play, Save } from 'lucide-react';
import { useKaraokeStore } from '../store/useKaraokeStore';

interface ProjectsQuickAccessProps {
  onOpenProjects: () => void;
}

export const ProjectsQuickAccess: React.FC<ProjectsQuickAccessProps> = ({ onOpenProjects }) => {
  const {
    recentProjects,
    loadProject,
    saveCurrentAsProject,
    lines,
    currentProjectTitle,
    audioFileName,
    language,
    theme,
  } = useKaraokeStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const latestProjects = useMemo(
    () => recentProjects
      .map((project, index) => ({ project, index }))
      .sort((a, b) => {
        const aTime = Date.parse(a.project.updatedAt || a.project.createdAt || '') || 0;
        const bTime = Date.parse(b.project.updatedAt || b.project.createdAt || '') || 0;
        return bTime - aTime || a.index - b.index;
      })
      .slice(0, 3)
      .map(({ project }) => project),
    [recentProjects],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCurrentAsProject(
        currentProjectTitle || audioFileName?.replace(/\.[^/.]+$/, '') || (language === 'ru' ? 'Без названия' : 'Untitled'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = async (id: string) => {
    setBusyId(id);
    try {
      await loadProject(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={`rounded-2xl border p-4 shadow-sm ${
      theme === 'dark' ? 'border-zinc-800 bg-zinc-950/70 text-zinc-100' : 'border-zinc-200 bg-white/85 text-zinc-900'
    }`} aria-label={language === 'ru' ? 'Последние проекты' : 'Recent projects'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-xl bg-violet-500/10 p-2 text-violet-500">
            <FolderOpen size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold">{language === 'ru' ? 'Мои проекты' : 'My projects'}</h2>
            <p className="text-[10px] text-zinc-500">
              {language === 'ru' ? 'Черновики доступны в Лайт и Про' : 'Drafts are available in Lite and Pro'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl border border-violet-500/30 px-3 py-2 text-[10px] font-extrabold text-violet-500 transition-colors hover:bg-violet-500/10 disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {language === 'ru' ? 'Сохранить' : 'Save'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenProjects}
            className="rounded-xl bg-violet-600 px-3 py-2 text-[10px] font-extrabold text-white transition-colors hover:bg-violet-700"
          >
            {language === 'ru' ? 'Открыть мои проекты' : 'Open my projects'}
          </button>
        </div>
      </div>

      {latestProjects.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {latestProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => handleOpen(project.id)}
              disabled={busyId === project.id}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-200/80 px-3 py-2 text-left transition-colors hover:border-violet-400 dark:border-zinc-800"
            >
              {busyId === project.id ? <Loader2 size={12} className="shrink-0 animate-spin text-violet-500" /> : <Play size={12} className="shrink-0 text-violet-500" />}
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-bold" title={project.title}>{project.title}</span>
                <span className="block text-[9px] text-zinc-500">
                  {project.lines.length} {language === 'ru' ? 'строк' : 'lines'} · {project.lines.filter((line) => line.time !== null).length} {language === 'ru' ? 'размечено' : 'timed'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
