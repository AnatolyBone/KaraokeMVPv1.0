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
import { AuthSection } from './components/AuthSection';
import { localization } from './utils/localization';
import { Sun, Moon, Trash2, Type, Clock, Edit3, Zap, Settings, Shield, HelpCircle, ChevronLeft } from 'lucide-react';
import { clearAudioFromDB, clearCoverFromDB } from './utils/db';
import { supabase } from './services/supabaseClient';
import { AdminPanelModal } from './components/AdminPanelModal';
import { InteractiveTour } from './components/InteractiveTour';
import { KaraokeCatalog } from './components/KaraokeCatalog';

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
    user,
    subMode,
    setSubMode,
  } = useKaraokeStore();

  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);

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

  // Попытка автоматического входа при наличии сохраненных кредов в localStorage
  useEffect(() => {
    // Загружаем настройки приложения
    useKaraokeStore.getState().fetchAppSettings();

    const attemptAutoLogin = async () => {
      if (!import.meta.env.VITE_SUPABASE_URL) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const saved = localStorage.getItem('karaoke_saved_credentials');
          if (saved) {
            const { email, password } = JSON.parse(saved);
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
              console.warn('Auto login failed (invalid credentials):', error.message);
              localStorage.removeItem('karaoke_saved_credentials');
            }
          }
        }
      } catch (err) {
        console.error('Error during auto login restore:', err);
        localStorage.removeItem('karaoke_saved_credentials');
      }
    };
    attemptAutoLogin();
  }, []);

  // Автоматический запуск обучения при первом посещении
  useEffect(() => {
    const hasSeen = localStorage.getItem('hasSeenTour');
    if (!hasSeen) {
      const timer = setTimeout(() => {
        setTourActive(true);
        localStorage.setItem('hasSeenTour', 'true');
      }, 1500);
      return () => clearTimeout(timer);
    }
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
    <div className={`min-h-screen flex flex-col font-sans antialiased relative overflow-hidden transition-colors duration-355 ${
      theme === 'dark' ? 'bg-zinc-950 text-zinc-50' : 'bg-zinc-50 text-zinc-900'
    }`}>
      {/* Ambient background glows for dark mode */}
      {theme === 'dark' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/10 blur-[120px] animate-blob" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-pink-600/10 blur-[120px] animate-blob animation-delay-2000" />
          <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full bg-fuchsia-600/5 blur-[100px] animate-blob animation-delay-4000" />
        </div>
      )}

      {/* Header */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-all duration-300 relative ${
        theme === 'dark' 
          ? 'bg-zinc-950/70 border-white/5 shadow-lg shadow-black/25' 
          : 'bg-white/70 border-zinc-200/80 shadow-sm shadow-zinc-100/50'
      }`}>
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          
          {/* Top Row on Mobile: Logo and Mobile Controls */}
          <div className="flex items-center justify-between w-full lg:w-auto">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-white/10 shadow-md dark:shadow-black/30 flex items-center justify-center shrink-0 hover:scale-105 transition-all duration-300 relative group overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-violet-600/15 via-fuchsia-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
                  {/* Outer vinyl rings */}
                  <circle cx="11" cy="13" r="9" stroke="url(#melodic-grad)" strokeWidth="1.5" className="opacity-45" />
                  <circle cx="11" cy="13" r="6.2" stroke="url(#melodic-grad)" strokeWidth="1" strokeDasharray="3 2" className="opacity-60" />
                  <circle cx="11" cy="13" r="2.5" stroke="url(#melodic-grad)" strokeWidth="1.2" className="opacity-80" />

                  {/* Tonearm to note connection */}
                  <path d="M18 4l-4 2" stroke="url(#melodic-grad)" strokeWidth="1.8" strokeLinecap="round" />
                  {/* Stem and flag */}
                  <path d="M14 6v7.5" stroke="url(#melodic-grad)" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M14 6c2-0.5 3 0.5 4.5 1.5" stroke="url(#melodic-grad)" strokeWidth="1.8" strokeLinecap="round" />
                  {/* Note head (tilted ellipse for note style) */}
                  <ellipse cx="11.5" cy="13.5" rx="2.5" ry="1.8" transform="rotate(-25 11.5 13.5)" fill="url(#melodic-grad)" />
                  {/* Tiny needle tip pointing to record center */}
                  <path d="M9.5 13.5l1.5-0.5" stroke="url(#melodic-grad)" strokeWidth="1" strokeLinecap="round" className="opacity-80" />

                  <defs>
                    <linearGradient id="melodic-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#a78bfa" />
                      <stop offset="0.5" stopColor="#e879f9" />
                      <stop offset="1" stopColor="#f43f5e" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-extrabold tracking-tight sm:text-lg truncate">
                  Karaoke <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">LRC Maker</span>
                </h1>
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-bold tracking-wider uppercase hidden xs:inline sm:block truncate">
                  {dict.appName}
                </span>
              </div>
            </div>

            {/* Mobile Actions: Theme, Clear & Admin */}
            <div className="flex lg:hidden items-center gap-1.5 shrink-0">
              {userProfile?.role === 'admin' && (
                <button
                  onClick={() => setIsAdminOpen(true)}
                  className="p-2 rounded-xl border bg-red-500/10 border-red-500/20 text-red-500 active:scale-95 transition-all"
                  title={dict.adminButton}
                >
                  <Shield size={16} />
                </button>
              )}

              <button
                onClick={toggleTheme}
                className={`p-2 rounded-xl border active:scale-95 transition-all ${
                  theme === 'dark'
                    ? 'bg-zinc-950 border-zinc-800 text-yellow-500'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
                title={theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              <button
                onClick={() => setTourActive(true)}
                className={`p-2 rounded-xl border active:scale-95 transition-all ${
                  theme === 'dark'
                    ? 'bg-zinc-950 border-zinc-800 text-zinc-400'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
                title={dict.tourStartBtn}
              >
                <HelpCircle size={16} />
              </button>

              <button
                onClick={handleClearAll}
                className={`p-2 rounded-xl border text-red-500 active:scale-95 transition-all ${
                  theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                }`}
                title="Очистить всё"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          {/* Navigation Step Tabs (Desktop Only) */}
          {appMode === 'editor' && (
            <nav id="editor-step-tabs" className="hidden lg:flex items-center gap-0.5 p-1 rounded-xl bg-zinc-150/50 dark:bg-zinc-900/40 border border-zinc-200/30 dark:border-white/5 backdrop-blur-md shrink-0">
              <button
                onClick={() => setStep('input')}
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 transition-all duration-300 ${
                  step === 'input'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-600 dark:text-violet-450 shadow-md shadow-violet-500/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Type size={13} />
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
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 transition-all duration-300 ${
                  step === 'timing'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-600 dark:text-violet-455 shadow-md shadow-violet-500/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Clock size={13} />
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
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 transition-all duration-300 ${
                  step === 'edit'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-600 dark:text-violet-450 shadow-md shadow-violet-500/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Edit3 size={13} />
                {dict.editStep}
              </button>
            </nav>
          )}

          {/* Bottom Row on Mobile (Desktop Right Column): Switchers & Desktop-only Controls */}
          <div className="flex items-center justify-between lg:justify-end gap-2 w-full lg:w-auto mt-0.5 lg:mt-0 shrink-0">
            {/* Mode Switcher */}
            <div id="app-mode-switcher" className="flex-1 lg:flex-none flex items-center gap-1 bg-zinc-150/50 dark:bg-zinc-900/40 border border-zinc-200/30 dark:border-white/5 p-1 rounded-xl backdrop-blur-md">
              <button
                onClick={() => setAppMode('karaoke')}
                className={`flex-1 lg:flex-none px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                  appMode === 'karaoke'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-500 dark:text-violet-400 shadow-md shadow-violet-500/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                title={dict.appModeKaraoke}
              >
                <span>{dict.appModeKaraoke}</span>
              </button>
              <button
                onClick={() => setAppMode('editor')}
                className={`flex-1 lg:flex-none px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                  appMode === 'editor'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-500 dark:text-violet-450 shadow-md shadow-violet-500/5'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
                title={dict.appModeEditor}
              >
                <span>{dict.appModeEditor}</span>
              </button>
            </div>

            {/* Language Switcher */}
            <div className="flex items-center gap-1 bg-zinc-150/50 dark:bg-zinc-900/40 border border-zinc-200/30 dark:border-white/5 p-1 rounded-xl shrink-0 backdrop-blur-md">
              <button
                onClick={() => setLanguage('ru')}
                className={`px-2 py-1 xl:px-3 xl:py-1.5 rounded-lg font-bold text-[10px] transition-all duration-300 cursor-pointer ${
                  language === 'ru'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-500 dark:text-violet-400 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                RU
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 xl:px-3 xl:py-1.5 rounded-lg font-bold text-[10px] transition-all duration-300 cursor-pointer ${
                  language === 'en'
                    ? 'bg-white dark:bg-zinc-800/80 text-violet-500 dark:text-violet-400 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                EN
              </button>
            </div>

            {/* Desktop Actions: Theme, Clear & Admin (Hidden on mobile) */}
            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
              {userProfile?.role === 'admin' && (
                <button
                  onClick={() => setIsAdminOpen(true)}
                  className={`p-1.5 xl:p-2 rounded-xl border hover:scale-105 transition-all bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-500`}
                  title={dict.adminButton}
                >
                  <Shield size={16} />
                </button>
              )}

              <button
                onClick={toggleTheme}
                className={`p-1.5 xl:p-2 rounded-xl border hover:scale-105 transition-all ${
                  theme === 'dark'
                    ? 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 text-yellow-500'
                    : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-600'
                }`}
                title={theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              <button
                onClick={() => setTourActive(true)}
                className={`p-1.5 xl:p-2 rounded-xl border hover:scale-105 transition-all ${
                  theme === 'dark'
                    ? 'bg-zinc-950 border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-650 hover:text-zinc-800'
                }`}
                title={dict.tourStartBtn}
              >
                <HelpCircle size={16} />
              </button>

              <button
                onClick={handleClearAll}
                className={`p-1.5 xl:p-2 rounded-xl border hover:bg-red-500/10 text-red-500 hover:scale-105 transition-all ${
                  theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
                }`}
                title="Очистить всё"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

        </div>
      </header>

      {/* Mobile Navigation Steps */}
      {appMode === 'editor' && (
        <div className="lg:hidden w-full border-b border-zinc-200/30 dark:border-zinc-800/30 bg-zinc-100/50 dark:bg-zinc-950/50 p-2 flex gap-1 justify-around">
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
            <div className="flex flex-col gap-6">
              {!user && <AuthSection />}
              {audioUrl ? (
                <div className="flex flex-col gap-4">
                  <div className="flex justify-start">
                    <button
                      onClick={() => {
                        useKaraokeStore.getState().setAudio(null, null);
                        useKaraokeStore.setState({
                          lines: [],
                          coverUrl: null,
                          coverColors: null,
                          currentProjectTitle: null,
                        });
                      }}
                      className={`px-3.5 py-2 rounded-xl border flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all hover:scale-[1.02] active:scale-98 ${
                        theme === 'dark'
                          ? 'bg-zinc-950/60 border-zinc-800 text-zinc-350 hover:bg-zinc-950 hover:text-zinc-100 hover:border-zinc-700'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-300'
                      }`}
                    >
                      <ChevronLeft size={14} />
                      {language === 'ru' ? 'Назад в каталог' : 'Back to Catalog'}
                    </button>
                  </div>
                  <KaraokePreview />
                </div>
              ) : (
                <KaraokeCatalog />
              )}
            </div>
          ) : (
            <>
              {/* Step 1 Content: Lyrics Input */}
              {step === 'input' && <LyricsInput />}

              {/* Step 2 Content: Unified Workspace (Spacious sub-mode switcher) */}
              {step === 'timing' && (
                <div className="flex flex-col gap-6">
                  
                  {/* Sub-mode switcher */}
                  <div className="flex items-center justify-between p-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-250/10 max-w-md mx-auto w-full">
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
                <div id="export-section" className="flex flex-col gap-6">
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
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-500' : 'bg-zinc-100 border-zinc-200 text-zinc-400'
      }`}>
        <div className="max-w-6xl mx-auto px-4">
          <span>© {new Date().getFullYear()} Karaoke LRC Maker • {language === 'ru' ? 'Работает локально в вашем браузере без серверов' : 'Works locally in your browser without servers'}</span>
        </div>
      </footer>

      <AdminPanelModal isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />

      <InteractiveTour active={tourActive} onClose={() => setTourActive(false)} />
    </div>
  );
};

export default App;
