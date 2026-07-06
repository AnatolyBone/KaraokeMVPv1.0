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
import { Sun, Moon, Type, Clock, Edit3, Zap, Settings, Shield, HelpCircle, ChevronLeft } from 'lucide-react';
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
  const [showIntro, setShowIntro] = useState(false);

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

    localStorage.removeItem('karaoke_saved_credentials');
  }, []);

  // Автоматический запуск обучения при первом посещении
  useEffect(() => {
    const hasSeen = localStorage.getItem('hasSeenTour');
    if (!hasSeen && !showIntro) {
      const timer = setTimeout(() => {
        setTourActive(true);
        localStorage.setItem('hasSeenTour', 'true');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [showIntro]);

  // Soft brand intro: shown rarely and skipped for reduced-motion users.
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const introKey = 'karaoke_spectral_intro_seen_at';
    const lastSeen = Number(localStorage.getItem(introKey) || 0);
    const twelveHours = 12 * 60 * 60 * 1000;

    if (Date.now() - lastSeen > twelveHours) {
      setShowIntro(true);
      localStorage.setItem(introKey, String(Date.now()));
    }
  }, []);

  useEffect(() => {
    if (!showIntro) return;

    const timer = window.setTimeout(() => setShowIntro(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showIntro]);

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

  const isReadyForTiming = lines.length > 0;
  const headerSegmentClass = theme === 'dark'
    ? 'bg-black/35 border-white/15 shadow-black/30'
    : 'bg-zinc-100/50 border-zinc-200/30 shadow-zinc-200/50';
  const headerSegmentActiveClass = theme === 'dark'
    ? 'bg-white text-violet-700 shadow-md shadow-black/15'
    : 'bg-white text-violet-600 shadow-md shadow-violet-500/5';
  const headerSegmentInactiveClass = theme === 'dark'
    ? 'text-white/78 hover:text-white'
    : 'text-zinc-500 hover:text-zinc-900';

  return (
    <div className={`min-h-screen flex flex-col font-sans antialiased relative overflow-hidden ${
      theme === 'dark'
        ? 'bg-[radial-gradient(circle_at_18%_8%,rgba(124,58,237,0.24),transparent_32%),radial-gradient(circle_at_82%_14%,rgba(236,72,153,0.18),transparent_34%),linear-gradient(180deg,#0d0818_0%,#080912_58%,#05070d_100%)] text-zinc-50'
        : 'bg-[radial-gradient(circle_at_18%_8%,rgba(125,92,255,0.18),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(255,92,178,0.13),transparent_31%),radial-gradient(circle_at_32%_55%,rgba(56,189,248,0.12),transparent_38%),linear-gradient(180deg,#fffaff_0%,#f5f0ff_44%,#f7fbff_100%)] text-zinc-900'
    }`}>
      {showIntro && (
        <div
          className={`fixed inset-0 z-[100] pointer-events-none flex items-center justify-center overflow-hidden spectral-intro ${
            theme === 'dark' ? 'bg-[#07070d]' : 'bg-[#fbfaff]'
          }`}
        >
          <div className="spectral-intro-wave" />
          <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
            <div className="h-12 w-12 rounded-2xl border border-white/25 bg-white/10 backdrop-blur-xl shadow-2xl shadow-violet-500/20 flex items-center justify-center">
              <Zap size={22} className="text-violet-300" />
            </div>
            <div>
              <p className="text-sm font-extrabold tracking-tight text-white drop-shadow">
                Karaoke LRC Maker
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-white/55">
                {language === 'ru' ? 'готовим сцену' : 'warming the stage'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ambient spectral waves */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 spectral-ambient">
        <div className="spectral-wave-field" />
        <div className="spectral-ribbon spectral-ribbon-a" />
        <div className="spectral-ribbon spectral-ribbon-b" />
        <div className="spectral-ribbon spectral-ribbon-c" />
        <div
          className={`absolute inset-0 ${
            theme === 'dark'
              ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.055),transparent_34%)]'
              : 'bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.34),transparent_40%)]'
          }`}
        />
      </div>

      <div
        className={`absolute inset-0 pointer-events-none z-0 ${
          theme === 'dark'
            ? 'bg-[linear-gradient(180deg,rgba(5,7,13,0.05)_0%,rgba(5,7,13,0.32)_58%,rgba(5,7,13,0.72)_100%)]'
            : 'bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(253,252,255,0.18)_54%,rgba(248,250,252,0.72)_100%)]'
        }`}
      />

      {/* Header */}
      <header className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-all duration-300 relative ${
        theme === 'dark' 
          ? 'bg-[#090913]/88 border-white/12 shadow-lg shadow-black/35' 
          : 'bg-white/82 border-zinc-200/80 shadow-sm shadow-zinc-200/60'
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

            </div>
          </div>

          {/* Navigation Step Tabs (Desktop Only) */}
          {appMode === 'editor' && (
            <nav id="editor-step-tabs" className={`hidden lg:flex items-center gap-0.5 p-1 rounded-xl border backdrop-blur-md shrink-0 shadow-sm ${headerSegmentClass}`}>
              <button
                onClick={() => setStep('input')}
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 whitespace-nowrap transition-all duration-300 ${
                  step === 'input' ? headerSegmentActiveClass : headerSegmentInactiveClass
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
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 whitespace-nowrap transition-all duration-300 ${
                  step === 'timing' ? headerSegmentActiveClass : headerSegmentInactiveClass
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
                className={`px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg text-[11px] xl:text-xs font-bold flex items-center gap-1 xl:gap-1.5 whitespace-nowrap transition-all duration-300 ${
                  step === 'edit' ? headerSegmentActiveClass : headerSegmentInactiveClass
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
            <div id="app-mode-switcher" className={`flex-1 lg:flex-none flex items-center gap-1 border p-1 rounded-xl backdrop-blur-md shadow-sm ${headerSegmentClass}`}>
              <button
                onClick={() => setAppMode('karaoke')}
                className={`flex-1 lg:flex-none px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                  appMode === 'karaoke' ? headerSegmentActiveClass : headerSegmentInactiveClass
                }`}
                title={dict.appModeKaraoke}
              >
                <span>{dict.appModeKaraoke}</span>
              </button>
              <button
                onClick={() => setAppMode('editor')}
                className={`flex-1 lg:flex-none px-2 py-1.5 xl:px-4 xl:py-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer ${
                  appMode === 'editor' ? headerSegmentActiveClass : headerSegmentInactiveClass
                }`}
                title={dict.appModeEditor}
              >
                <span>{dict.appModeEditor}</span>
              </button>
            </div>

            {/* Language Switcher */}
            <div className={`flex items-center gap-1 border p-1 rounded-xl shrink-0 backdrop-blur-md shadow-sm ${headerSegmentClass}`}>
              <button
                onClick={() => setLanguage('ru')}
                className={`px-2 py-1 xl:px-3 xl:py-1.5 rounded-lg font-bold text-[10px] transition-all duration-300 cursor-pointer ${
                  language === 'ru' ? headerSegmentActiveClass : headerSegmentInactiveClass
                }`}
              >
                RU
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 xl:px-3 xl:py-1.5 rounded-lg font-bold text-[10px] transition-all duration-300 cursor-pointer ${
                  language === 'en' ? headerSegmentActiveClass : headerSegmentInactiveClass
                }`}
              >
                EN
              </button>
            </div>

            {/* Desktop Actions: Theme & Admin (Hidden on mobile) */}
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
                    : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-800'
                }`}
                title={dict.tourStartBtn}
              >
                <HelpCircle size={16} />
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
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6 items-start">
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
                          rawText: '',
                          lines: [],
                          currentIndex: 0,
                          currentWordIndex: 0,
                          coverUrl: null,
                          coverColors: null,
                          currentProjectTitle: null,
                        });
                      }}
                      className={`px-3.5 py-2 rounded-xl border flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] ${
                        theme === 'dark'
                          ? 'bg-zinc-950/60 border-zinc-800 text-zinc-300 hover:bg-zinc-950 hover:text-zinc-100 hover:border-zinc-700'
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
                  <div className="flex items-center justify-between p-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200/10 max-w-md mx-auto w-full">
                    <button
                      onClick={() => setSubMode('sync')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        subMode === 'sync'
                          ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-400 shadow-md scale-[1.02]'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <Zap size={14} />
                      {language === 'ru' ? '1. Запись таймингов' : '1. Timing Sync'}
                    </button>
                    
                    <button
                      onClick={() => setSubMode('tune')}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        subMode === 'tune'
                          ? 'bg-white dark:bg-zinc-900 text-violet-600 dark:text-violet-400 shadow-md scale-[1.02]'
                          : 'text-zinc-500 hover:text-zinc-300'
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
                      <KaraokePreview showQuickShift={false} />
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
      <footer className={`relative z-10 py-4 text-center text-[11px] border-t transition-colors ${
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
