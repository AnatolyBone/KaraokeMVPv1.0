import React from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { Keyboard, BarChart2, ListPlus, Clock, SquarePlay, AlertCircle, Heart, MessageCircle } from 'lucide-react';
import { RecentProjects } from './RecentProjects';
import { AuthSection } from './AuthSection';
import { localization } from '../utils/localization';

export const SidePanel: React.FC = () => {
  const { lines, step, theme, language } = useKaraokeStore();

  const totalLines = lines.length;
  const timedLines = lines.filter((l) => l.time !== null).length;
  const untimedLines = totalLines - timedLines;
  const progressPercent = totalLines > 0 ? Math.round((timedLines / totalLines) * 100) : 0;

  const dict = localization[language];

  return (
    <div className="flex flex-col gap-6 w-full lg:max-w-xs shrink-0">
      {/* Auth Cabinet V2 */}
      <AuthSection />

      {/* Statistics widget */}
      <div
        className={`rounded-2xl p-5 border shadow-sm transition-all ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-zinc-900 pb-3">
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
        className={`rounded-2xl p-5 border shadow-sm transition-all ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        <div className="flex items-center gap-2 mb-4 border-b border-zinc-100 dark:border-zinc-900 pb-3">
          <Keyboard className="text-violet-500" size={18} />
          <h4 className="font-bold text-sm uppercase tracking-wider">{dict.hotkeysTitle}</h4>
        </div>

        <div className="flex flex-col gap-3.5">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
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

      {/* Support and Feedback widget */}
      <div
        className={`rounded-2xl p-5 border shadow-sm transition-all ${
          theme === 'dark'
            ? 'bg-zinc-950/80 border-zinc-800/80 text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        <div className="flex items-center gap-2 mb-3 border-b border-zinc-150 dark:border-zinc-900 pb-3">
          <Heart className="text-pink-500 fill-pink-500/15 animate-pulse" size={18} />
          <h4 className="font-bold text-sm uppercase tracking-wider">{dict.supportTitle}</h4>
        </div>
        
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed mb-4">
          {dict.supportDesc}
        </p>

        <div className="flex flex-col gap-2">
          {/* Telegram Support Chat/Contact */}
          <a
            href="https://t.me/anatoly_bone"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-sky-500/5 hover:border-sky-500/30 text-xs font-semibold transition-all hover:scale-[1.01] text-zinc-700 dark:text-zinc-300"
          >
            <MessageCircle size={14} className="text-sky-500" />
            <span>{dict.supportTelegram}</span>
          </a>

          {/* GitHub Issues Link */}
          <a
            href="https://github.com/AnatolyBone/KaraokeMVPv1.0/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:border-zinc-350 dark:hover:border-zinc-700 text-xs font-semibold transition-all hover:scale-[1.01] text-zinc-700 dark:text-zinc-300"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-zinc-500 dark:text-zinc-400"
            >
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
            <span>{dict.supportGithub}</span>
          </a>

          {/* Donation / Support Button */}
          <a
            href="https://yoomoney.ru"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gradient-to-r from-pink-500/10 to-violet-500/10 border border-pink-500/20 hover:border-pink-500/40 text-xs font-bold text-pink-600 dark:text-pink-400 transition-all hover:scale-[1.01]"
          >
            <Heart size={14} className="text-pink-500" />
            <span>{dict.supportDonate}</span>
          </a>
        </div>
      </div>
    </div>
  );
};
