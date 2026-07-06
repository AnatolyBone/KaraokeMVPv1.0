import React, { useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { Keyboard, BarChart2, ListPlus, Clock, SquarePlay, AlertCircle, Heart, MessageCircle, Trash2, Send } from 'lucide-react';
import { RecentProjects } from './RecentProjects';
import { AuthSection } from './AuthSection';
import { localization } from '../utils/localization';
import { clearAudioFromDB, clearCoverFromDB } from '../utils/db';
import { FeedbackModal } from './FeedbackModal';

export const SidePanel: React.FC = () => {
  const { lines, step, theme, language, appMode, user, donationUrl, audioUrl, clearAll } = useKaraokeStore();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  const totalLines = lines.length;
  const timedLines = lines.filter((l) => l.time !== null).length;
  const untimedLines = totalLines - timedLines;
  const progressPercent = totalLines > 0 ? Math.round((timedLines / totalLines) * 100) : 0;

  const dict = localization[language];
  const hasProjectContent = totalLines > 0 || !!audioUrl;
  const panelClass = theme === 'dark'
    ? 'bg-zinc-900/75 backdrop-blur-xl border-white/10 hover:border-violet-500/25 text-zinc-100 shadow-black/20'
    : 'bg-white/82 backdrop-blur-xl border-white/70 text-zinc-900 shadow-violet-200/35';

  const handleClearAll = async () => {
    if (confirm(dict.clearConfirm)) {
      clearAll();
      try {
        await clearAudioFromDB();
        await clearCoverFromDB();
      } catch (err) {
        console.error('Failed to clear IndexedDB:', err);
      }
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full lg:max-w-xs shrink-0">
      {/* Auth Cabinet V2 (скрыт здесь в режиме караоке для неавторизованных, так как отрендерен в центре страницы) */}
      {!(appMode === 'karaoke' && !user) && <AuthSection />}

      {hasProjectContent && (
        <div
          className={`rounded-2xl p-4 border shadow-sm transition-all duration-300 ${
            theme === 'dark'
              ? 'bg-zinc-900/75 border-red-500/20 text-zinc-100 shadow-black/20'
              : 'bg-white/82 backdrop-blur-xl border-red-100/80 text-zinc-900 shadow-rose-200/35'
          }`}
        >
          <div className="mb-3">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-red-500">
              {language === 'ru' ? 'Текущий проект' : 'Current project'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {language === 'ru' ? 'Очистить аудио, текст и тайминги' : 'Clear audio, lyrics and timings'}
            </p>
          </div>
          <button
            onClick={handleClearAll}
            className={`w-full px-4 py-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-extrabold transition-all active:scale-95 ${
              theme === 'dark'
                ? 'border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/15'
                : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            }`}
            title={language === 'ru' ? 'Сбросить текущий проект' : 'Reset current project'}
          >
            <Trash2 size={15} />
            {language === 'ru' ? 'Сбросить проект' : 'Reset project'}
          </button>
        </div>
      )}

      {appMode === 'editor' && (
        <>
          {/* Statistics widget */}
          <div
            className={`rounded-2xl p-6 border shadow-sm transition-all duration-300 ${
              panelClass
            }`}
          >
            <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-white/10 pb-3">
              <BarChart2 className="text-violet-500" size={18} />
              <h4 className="font-bold text-sm uppercase tracking-wider">{dict.statsTitle}</h4>
            </div>

            <div className="flex flex-col gap-3">
              {/* Total Lines */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <ListPlus size={14} />
                  {dict.statsTotal}
                </span>
                <span className="font-bold font-mono">{totalLines}</span>
              </div>

              {/* Timed Lines */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Clock size={14} className="text-green-500" />
                  {dict.statsTimed}
                </span>
                <span className="font-bold font-mono text-green-500">{timedLines}</span>
              </div>

              {/* Untimed Lines */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-yellow-500" />
                  {dict.statsUntimed}
                </span>
                <span className="font-bold font-mono text-yellow-500">{untimedLines}</span>
              </div>

              {/* circular progress */}
              <div className="mt-2 pt-3 border-t border-zinc-100 dark:border-zinc-900">
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-zinc-400">{dict.statsReady}</span>
                  <span className="text-violet-500 dark:text-violet-400">{progressPercent}%</span>
                </div>
                <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts widget */}
          <div
            className={`rounded-2xl p-6 border shadow-sm transition-all duration-300 ${
              panelClass
            }`}
          >
            <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-white/10 pb-3">
              <Keyboard className="text-violet-500" size={18} />
              <h4 className="font-bold text-sm uppercase tracking-wider">{dict.hotkeysTitle}</h4>
            </div>

            <div className="flex flex-col gap-3.5">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {dict.hotkeysCheatsheet}
              </p>

              {/* Shortcut item */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{dict.hotkeysSpace}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono font-bold text-[10px] shadow-sm text-zinc-700 dark:text-zinc-300">
                  Space
                </kbd>
              </div>

              {/* Shortcut item */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{dict.hotkeysBksp}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono font-bold text-[10px] shadow-sm text-zinc-700 dark:text-zinc-300">
                  Backspace
                </kbd>
              </div>

              {/* Shortcut item */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{dict.hotkeysRewind}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono font-bold text-[10px] shadow-sm text-zinc-700 dark:text-zinc-300">
                  ← Arrow
                </kbd>
              </div>

              {/* Shortcut item */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{dict.hotkeysForward}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono font-bold text-[10px] shadow-sm text-zinc-700 dark:text-zinc-300">
                  → Arrow
                </kbd>
              </div>

              {/* Shortcut item */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{dict.hotkeysPlay}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 font-mono font-bold text-[10px] shadow-sm text-zinc-700 dark:text-zinc-300">
                  P
                </kbd>
              </div>
            </div>

            {/* Active indicator warning */}
            {step === 'input' && (
              <div className="mt-4 p-2.5 rounded-xl bg-yellow-500/5 border border-yellow-500/10 text-yellow-600 dark:text-yellow-500/80 text-[10px] flex gap-1.5 items-start">
                <SquarePlay size={14} className="shrink-0 mt-0.5" />
                <span>{dict.hotkeysWarning}</span>
              </div>
            )}
          </div>

          {/* Recent Projects Swapper */}
          <RecentProjects />
        </>
      )}

      {/* Support and Feedback widget */}
      <div
        className={`rounded-2xl p-6 border shadow-sm transition-all duration-300 ${
          panelClass
        }`}
      >
        <div className="flex items-center gap-2 mb-3 border-b border-zinc-200 dark:border-white/10 pb-3">
          <Heart className="text-pink-500 fill-pink-500/15 animate-pulse" size={18} />
          <h4 className="font-bold text-sm uppercase tracking-wider">{dict.supportTitle}</h4>
        </div>
        
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">
          {dict.supportDesc}
        </p>

        <div className="flex flex-col gap-2">
          {/* Telegram Support Chat/Contact */}
          <button
            type="button"
            onClick={() => setIsFeedbackOpen(true)}
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-violet-500/20 bg-violet-500/10 hover:bg-violet-500/15 text-xs font-extrabold transition-all hover:scale-[1.015] active:scale-[0.98] text-violet-700 dark:text-violet-300"
          >
            <Send size={14} className="text-violet-500" />
            <span>{language === 'ru' ? 'Отправить фидбэк' : 'Send feedback'}</span>
          </button>

          <a
            href="https://t.me/anatoly_bone"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-white/5 hover:bg-sky-500/5 hover:border-sky-500/20 dark:hover:border-sky-500/20 text-xs font-bold transition-all hover:scale-[1.015] active:scale-[0.98] text-zinc-700 dark:text-zinc-300"
          >
            <MessageCircle size={14} className="text-sky-500" />
            <span>{dict.supportTelegram}</span>
          </a>


          <a
            href={donationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gradient-to-r from-pink-500/10 to-violet-500/10 dark:from-pink-500/15 dark:to-violet-500/15 border border-pink-500/20 hover:border-pink-500/40 hover:from-pink-500/20 hover:to-violet-500/20 text-xs font-extrabold text-pink-600 dark:text-pink-400 transition-all hover:scale-[1.015] active:scale-[0.98] shadow-sm hover:shadow-pink-500/5 cursor-pointer"
          >
            <Heart size={14} className="text-pink-500" />
            <span>{dict.supportDonate}</span>
          </a>
        </div>
      </div>

      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
    </div>
  );
};
