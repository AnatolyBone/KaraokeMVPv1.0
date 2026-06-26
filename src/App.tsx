import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from './store/useKaraokeStore';
import { audioRef, seekAudio, toggleAudioPlay } from './audioRef';
import { AudioLoader } from './features/audio/AudioLoader';
import { LyricsInput } from './features/lyrics/LyricsInput';
import { TimingPanel } from './features/timing/TimingPanel';
import { KaraokePreview } from './features/preview/KaraokePreview';
import { LyricsTable } from './features/lyrics/LyricsTable';
import { ExportPanel } from './features/export-lrc/ExportPanel';
import { ExportVideoPanel } from './features/export-video/ExportVideoPanel';
import { SidePanel } from './components/SidePanel';
import { TimelineEditor } from './components/TimelineEditor';
import { localization } from './utils/localization';
import { Sun, Moon, Trash2, Type, Clock, Sparkles, Edit3, Zap, Settings, Shield } from 'lucide-react';
import { clearAudioFromDB, clearCoverFromDB } from './utils/db';
import { supabase } from './services/supabaseClient';
import { AdminPanelModal } from './components/AdminPanelModal';

const App: React.FC = () => {
  const {
    step,
    setStep,
    theme,
    toggleTheme,
    clearAll,
    lines,
    audioUrl,
    language,
    setLanguage,
    userProfile,
    appMode,
    setAppMode,
  } = useKaraokeStore();

  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Локальное переключение режима внутри Шага 2 ('sync' | 'tune')
  const [subMode, setSubMode] = useState<'sync' | 'tune'>('sync');

  const dict = localization[language];

  // Manage dark theme on <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [theme]);

  // Listen to Supabase Auth Changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      useKaraokeStore.getState().setUser(session?.user || null);
      if (session?.user) {
        useKaraokeStore.getState().syncProjects();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const rawText = useKaraokeStore((state) => state.rawText);

  // Синхронизация: если текстовое поле пустое, сбрасываем скомпилированные строки, индексы и сбрасываем шаг на ввод текста
  useEffect(() => {
    if (!rawText.trim()) {
      if (lines.length > 0) {
        useKaraokeStore.setState({ lines: [], currentIndex: 0, currentWordIndex: 0 });
      }
      if (step !== 'input') {
        setStep('input');
      }
    }
  }, [rawText, lines, step, setStep]);

  // Register Global Hotkeys Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isContentEditable = activeEl.hasAttribute('contenteditable') || (activeEl as any).contentEditable === 'true';
        if (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          isContentEditable
        ) {
          return;
        }
      }

      const currentStoreState = useKaraokeStore.getState();
      const activeStep = currentStoreState.step;

      // 1. Space → Timestamp active line (Step 2 Workspace only)
      if (e.code === 'Space' && activeStep === 'timing') {
        e.preventDefault();
        e.stopPropagation();
        if (audioRef.current) {
          currentStoreState.timestampCurrent(audioRef.current.currentTime);
        }
      }

      // 2. Backspace → Undo last timing (Step 2 Workspace only)
      if (e.code === 'Backspace' && activeStep === 'timing') {
        e.preventDefault();
        e.stopPropagation();
        currentStoreState.undoLastTiming();
      }

      // 3. Left/Right Arrow → Seek -2s / +2s (Step 2 Workspace)
      if (activeStep === 'timing' && e.code === 'ArrowLeft') {
        e.preventDefault();
        seekAudio(-2);
      }
      if (activeStep === 'timing' && e.code === 'ArrowRight') {
        e.preventDefault();
        seekAudio(2);
      }

      // 4. Key 'P' → Play/Pause (Step 2 Workspace)
      if (activeStep === 'timing' && e.code === 'KeyP') {
        e.preventDefault();
        toggleAudioPlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const isReadyForTiming = lines.length > 0;

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased transition-colors duration-355 ${
      theme === 'dark' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-50 text-zinc-900'
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors ${
        theme === 'dark' ? 'bg-zinc-900/80 border-zinc-800/80' : 'bg-white/80 border-zinc-200/80'
      }`}>
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight sm:text-lg">
                Karaoke <span className="text-violet-500 dark:text-violet-400">LRC Maker</span>
              </h1>
              <span className="text-[9.5px] text-zinc-400 dark:text-zinc-500 font-bold tracking-wider uppercase">
                {dict.appName}
              </span>
            </div>
          </div>

          {/* Navigation Step Tabs */}
          {appMode === 'editor' && (
            <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-955 border border-zinc-200/30 dark:border-zinc-800/30">
              <button
                onClick={() => setStep('input')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  step === 'input'
                    ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-955 dark:hover:text-zinc-100'
                }`}
              >
                <Type size={14} />
                {dict.inputStep}
              </button>

              <button
                onClick={() => {
                  if (!isReadyForTiming) {
                    alert(dict.exportWarning);
                    return;
                  }
                  setStep('timing');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  step === 'timing'
                    ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-955 dark:hover:text-zinc-100'
                }`}
              >
                <Clock size={14} />
                {dict.timingStep}
              </button>

              <button
                onClick={() => {
                  if (!isReadyForTiming) {
                    alert(dict.exportWarning);
                    return;
                  }
                  setStep('edit');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  step === 'edit'
                    ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-400 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-955 dark:hover:text-zinc-100'
                }`}
              >
                <Edit3 size={14} />
                {dict.editStep}
              </button>
            </nav>
          )}

          {/* Utilities and localization toggler */}
          <div className="flex items-center gap-2">
            {/* Mode Switcher */}
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/30 dark:border-zinc-800/30 p-1 rounded-xl">
              <button
                onClick={() => setAppMode('karaoke')}
                className={`px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer ${
                  appMode === 'karaoke'
                    ? 'bg-white dark:bg-zinc-900 text-violet-500 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                title={dict.appModeKaraoke}
              >
                <span>{dict.appModeKaraoke}</span>
              </button>
              <button
                onClick={() => setAppMode('editor')}
                className={`px-2.5 py-1.5 rounded-lg font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer ${
                  appMode === 'editor'
                    ? 'bg-white dark:bg-zinc-900 text-violet-500 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                title={dict.appModeEditor}
              >
                <span>{dict.appModeEditor}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-955 border border-zinc-200/30 dark:border-zinc-800/30 p-1 rounded-xl">
              <button
                onClick={() => setLanguage('ru')}
                className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${
                  language === 'ru'
                    ? 'bg-white dark:bg-zinc-900 text-violet-500'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                RU
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${
                  language === 'en'
                    ? 'bg-white dark:bg-zinc-900 text-violet-500'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                EN
              </button>
            </div>

            {userProfile?.role === 'admin' && (
              <button
                onClick={() => setIsAdminOpen(true)}
                className={`p-2 rounded-xl border hover:scale-105 transition-all bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-500`}
                title={dict.adminButton}
              >
                <Shield size={18} />
              </button>
            )}

            <button
              onClick={toggleTheme}
              className={`p-2 rounded-xl border hover:scale-105 transition-all ${
                theme === 'dark'
                  ? 'bg-zinc-955 border-zinc-800 hover:bg-zinc-900 text-yellow-500'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-600'
              }`}
              title={theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button
              onClick={handleClearAll}
              className={`p-2 rounded-xl border hover:bg-red-500/10 text-red-500 hover:scale-105 transition-all ${
                theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
              }`}
              title="Очистить всё"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Steps */}
      {appMode === 'editor' && (
        <div className="md:hidden w-full border-b border-zinc-200/30 dark:border-zinc-800/30 bg-zinc-100/50 dark:bg-zinc-950/50 p-2 flex gap-1 justify-around">
          <button
            onClick={() => setStep('input')}
            className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex flex-col items-center gap-1 transition-all ${
              step === 'input'
                ? 'bg-white dark:bg-zinc-900 text-violet-500 dark:text-violet-400 shadow-sm'
                : 'text-zinc-400'
            }`}
          >
            <Type size={14} />
            {language === 'ru' ? 'Текст' : 'Lyrics'}
          </button>

          <button
            onClick={() => {
              if (!isReadyForTiming) {
                alert(dict.exportWarning);
                return;
              }
              setStep('timing');
            }}
            className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex flex-col items-center gap-1 transition-all ${
              step === 'timing'
                ? 'bg-white dark:bg-zinc-900 text-violet-500 dark:text-violet-400 shadow-sm'
                : 'text-zinc-400'
            }`}
          >
            <Clock size={14} />
            {language === 'ru' ? 'Синхр.' : 'Sync'}
          </button>

          <button
            onClick={() => {
              if (!isReadyForTiming) {
                alert(dict.exportWarning);
                return;
              }
              setStep('edit');
            }}
            className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex flex-col items-center gap-1 transition-all ${
              step === 'edit'
                ? 'bg-white dark:bg-zinc-900 text-violet-500 dark:text-violet-400 shadow-sm'
                : 'text-zinc-400'
            }`}
          >
            <Edit3 size={14} />
            {language === 'ru' ? 'Экспорт' : 'Export'}
          </button>
        </div>
      )}

      {/* Main Content Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 w-full flex flex-col gap-6">
          
          {/* Audio Loader is shown on all steps */}
          <AudioLoader />

          {appMode === 'karaoke' ? (
            <KaraokePreview />
          ) : (
            <>
              {/* Step 1 Content: Lyrics Input */}
              {step === 'input' && <LyricsInput />}

              {/* Step 2 Content: Unified Workspace (Spacious sub-mode switcher) */}
              {step === 'timing' && (
                <div className="flex flex-col gap-6">
                  
                  {/* Sub-mode switcher */}
                  <div className="flex items-center justify-between p-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-955 border border-zinc-250/10 max-w-md mx-auto w-full">
                    <button
                      onClick={() => setSubMode('sync')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        subMode === 'sync'
                          ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-450 shadow-md scale-[1.02]'
                          : 'text-zinc-500 hover:text-zinc-350'
                      }`}
                    >
                      <Zap size={14} />
                      {language === 'ru' ? '1. Запись таймингов' : '1. Timing Sync'}
                    </button>
                    
                    <button
                      onClick={() => setSubMode('tune')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        subMode === 'tune'
                          ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-455 shadow-md scale-[1.02]'
                          : 'text-zinc-500 hover:text-zinc-350'
                      }`}
                    >
                      <Settings size={14} />
                      {language === 'ru' ? '2. Точная подгонка' : '2. Fine-Tuning'}
                    </button>
                  </div>

                  {/* Mode A: Timing Sync focuses strictly on recording and listening */}
                  {subMode === 'sync' ? (
                    <div className="flex flex-col gap-6 animate-fade-in">
                      <TimingPanel />
                      <KaraokePreview />
                    </div>
                  ) : (
                    /* Mode B: Fine Tuning focuses strictly on visual scaling and adjustments */
                    <div className="flex flex-col gap-6 animate-fade-in">
                      <TimelineEditor />
                      <LyricsTable />
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 Content: Export & Encoding Panel */}
              {step === 'edit' && (
                <div className="flex flex-col gap-6">
                  <div className="grid grid-cols-1 gap-6 items-stretch">
                    <div className="md:col-span-1">
                      <ExportPanel />
                    </div>
                    {audioUrl && <div className="md:col-span-1"><ExportVideoPanel /></div>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Column Sidebar */}
        <SidePanel />
      </main>

      {/* Footer */}
      <footer className={`py-4 text-center text-[11px] border-t transition-colors ${
        theme === 'dark' ? 'bg-zinc-955 border-zinc-800 text-zinc-500' : 'bg-zinc-100 border-zinc-200 text-zinc-400'
      }`}>
        <div className="max-w-6xl mx-auto px-4">
          <span>© {new Date().getFullYear()} Karaoke LRC Maker • {language === 'ru' ? 'Работает локально в вашем браузере без серверов' : 'Works locally in your browser without servers'}</span>
        </div>
      </footer>

      <AdminPanelModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
    </div>
  );
};

export default App;
