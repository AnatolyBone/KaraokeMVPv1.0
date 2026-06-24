import React, { useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { localization } from '../utils/localization';
import { FolderOpen, Trash2, Save, Music } from 'lucide-react';

export const RecentProjects: React.FC = () => {
  const {
    recentProjects,
    saveCurrentAsProject,
    loadProject,
    deleteProject,
    lines,
    language,
    theme,
  } = useKaraokeStore();

  const [title, setTitle] = useState('');
  const dict = localization[language];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines.length) {
      alert(language === 'ru' ? 'Сначала введите текст!' : 'Please input lyrics first!');
      return;
    }
    saveCurrentAsProject(title);
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
        <h4 className="font-bold text-sm uppercase tracking-wider">{dict.recentProjectsTitle}</h4>
      </div>

      {/* Save Form */}
      <form onSubmit={handleSave} className="mb-5 flex items-center gap-2">
        <input
          type="text"
          placeholder={dict.enterProjectTitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`flex-1 px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 ${
            theme === 'dark' ? 'bg-zinc-900 border-zinc-800 text-zinc-100' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
          }`}
        />
        <button
          type="submit"
          disabled={!lines.length}
          className={`p-2.5 rounded-xl text-white flex items-center justify-center transition-all ${
            !lines.length
              ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-700 hover:scale-105'
          }`}
          title={dict.saveProject}
        >
          <Save size={14} />
        </button>
      </form>

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
