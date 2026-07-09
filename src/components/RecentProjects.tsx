import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { localization } from '../utils/localization';
import { Cloud, FolderOpen, HardDrive, Trash2, Save, Music, UploadCloud } from 'lucide-react';

export const RecentProjects: React.FC = () => {
  const {
    recentProjects,
    saveCurrentAsProject,
    loadProject,
    deleteProject,
    lines,
    audioFileName,
    currentProjectTitle,
    user,
    syncing,
    setStep,
    language,
    theme,
  } = useKaraokeStore();

  const [title, setTitle] = useState(currentProjectTitle || audioFileName?.replace(/\.[^/.]+$/, '') || '');
  const dict = localization[language];
  const canSave = lines.length > 0;
  const canPublish = lines.some((line) => line.time !== null);
  const storageLabel = user
    ? (language === 'ru' ? 'Локально + облако' : 'Local + cloud')
    : (language === 'ru' ? 'Только в этом браузере' : 'This browser only');

  useEffect(() => {
    setTitle(currentProjectTitle || audioFileName?.replace(/\.[^/.]+$/, '') || '');
  }, [currentProjectTitle, audioFileName]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) {
      alert(language === 'ru' ? 'Сначала введите текст!' : 'Please input lyrics first!');
      return;
    }
    await saveCurrentAsProject(title);
    setTitle('');
    alert(dict.projectSaved);
  };

  return (
    <div
      className={`rounded-2xl p-5 border shadow-sm transition-all ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      {/* Title */}
      <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-zinc-900 pb-3">
        <FolderOpen className="text-violet-500" size={18} />
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-sm uppercase tracking-wider">
            {language === 'ru' ? 'Мои проекты' : 'My projects'}
          </h4>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
            {user ? <Cloud size={12} className="text-emerald-500" /> : <HardDrive size={12} />}
            {syncing ? (language === 'ru' ? 'Синхронизация...' : 'Syncing...') : storageLabel}
          </p>
        </div>
      </div>

      {/* Save Form */}
      <form onSubmit={handleSave} className="mb-5 flex flex-col gap-2">
        <input
          type="text"
          placeholder={language === 'ru' ? 'Название проекта' : 'Project name'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`flex-1 px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 ${
            theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
          }`}
        />
        <button
          type="submit"
          disabled={!canSave}
          className={`w-full px-3 py-2.5 rounded-xl text-white flex items-center justify-center gap-2 text-xs font-extrabold transition-all ${
            !canSave
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-700 hover:scale-105'
          }`}
          title={dict.saveProject}
        >
          <Save size={14} />
          {language === 'ru' ? 'Сохранить проект' : 'Save project'}
        </button>
      </form>

      <div className="mb-3 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">
        <span>{language === 'ru' ? 'Сохранённые' : 'Saved'}</span>
        <span>{recentProjects.length}</span>
      </div>

      <div className={`mb-4 rounded-xl border p-3 text-[11px] leading-relaxed ${
        theme === 'dark'
          ? 'border-violet-500/15 bg-violet-500/5 text-zinc-400'
          : 'border-violet-200/70 bg-violet-50/70 text-zinc-600'
      }`}>
        <p>
          {language === 'ru'
            ? 'Сохранение создаёт черновик в “Моих проектах”. Чтобы трек появился в каталоге, его нужно опубликовать.'
            : 'Saving creates a draft in My projects. To show a track in the catalog, publish it.'}
        </p>
        <button
          type="button"
          disabled={!canPublish}
          onClick={() => setStep('edit')}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold transition-all ${
            canPublish
              ? 'bg-violet-600 text-white shadow-md shadow-violet-600/10 hover:bg-violet-700 hover:scale-[1.01]'
              : 'bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600'
          }`}
        >
          <UploadCloud size={14} />
          {language === 'ru' ? 'Опубликовать в каталог' : 'Publish to catalog'}
        </button>
      </div>

      {/* Projects list */}
      <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
        {recentProjects.map((project) => (
          <div
            key={project.id}
            className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
              theme === 'dark'
                ? 'bg-zinc-900/40 hover:bg-zinc-900 border-zinc-800/80'
                : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200'
            }`}
          >
            <div
              onClick={() => loadProject(project.id)}
              className="flex-1 min-w-0 cursor-pointer flex items-center gap-2"
            >
              <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500 shrink-0">
                <Music size={12} />
              </div>
              <div className="min-w-0">
                <p className="font-bold truncate text-[11px]" title={project.title}>
                  {project.title}
                </p>
                <p className="text-[9px] text-zinc-455 truncate">
                  {project.lines.length} {language === 'ru' ? 'строк' : 'lines'} • {project.lines.filter(l => l.time !== null).length} {language === 'ru' ? 'с тайм.' : 'timed'}
                </p>
              </div>
            </div>

            <button
              onClick={() => deleteProject(project.id)}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
              title="Удалить"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}

        {recentProjects.length === 0 && (
          <div className="text-center py-4 text-zinc-500 text-xs italic">
            {dict.noProjects}
          </div>
        )}
      </div>
    </div>
  );
};
