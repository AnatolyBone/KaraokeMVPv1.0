import React, { useState, useEffect, useRef } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { localization } from '../utils/localization';
import { ArrowLeft, ArrowRight, X, HelpCircle, CheckCircle } from 'lucide-react';

interface InteractiveTourProps {
  active: boolean;
  onClose: () => void;
}

interface TourStep {
  targetId: string | null; // null means welcome card (centered)
  titleKey: string;
  descKey: string;
  autoNav?: {
    mode?: 'karaoke' | 'editor';
    editorStep?: 'input' | 'timing' | 'edit';
    editorSubMode?: 'sync' | 'tune';
  };
}

export const InteractiveTour: React.FC<InteractiveTourProps> = ({ active, onClose }) => {
  const { appMode, setAppMode, step, setStep, language, theme, setSubMode } = useKaraokeStore();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isChangingStep, setIsChangingStep] = useState(false);

  const backupRef = useRef<{
    rawText: string;
    lines: any[];
    step: any;
    subMode: any;
    audioUrl: string | null;
    audioFileName: string | null;
    appMode: any;
  } | null>(null);

  // Backup current state and inject mock data when the tour starts
  useEffect(() => {
    if (active) {
      const state = useKaraokeStore.getState();
      backupRef.current = {
        rawText: state.rawText,
        lines: state.lines,
        step: state.step,
        subMode: state.subMode,
        audioUrl: state.audioUrl,
        audioFileName: state.audioFileName,
        appMode: state.appMode,
      };

      // If the current project is empty, inject beautiful mock data for the duration of the tour
      if (state.rawText.trim() === '' && state.lines.length === 0) {
        const mockRawText = `Куплет 1\nПривет, это караоке!\nМы учимся размечать текст.\nВсе очень просто и быстро!`;
        const mockLines = [
          {
            id: 'mock-l1',
            text: 'Привет, это караоке!',
            time: 2.0,
            words: [
              { id: 'mock-w1', text: 'Привет,', time: 2.0 },
              { id: 'mock-w2', text: 'это', time: 2.5 },
              { id: 'mock-w3', text: 'караоке!', time: 3.0 },
            ],
          },
          {
            id: 'mock-l2',
            text: 'Мы учимся размечать текст.',
            time: 5.0,
            words: [
              { id: 'mock-w4', text: 'Мы', time: 5.0 },
              { id: 'mock-w5', text: 'учимся', time: 5.5 },
              { id: 'mock-w6', text: 'размечать', time: 6.0 },
              { id: 'mock-w7', text: 'текст.', time: 6.5 },
            ],
          },
          {
            id: 'mock-l3',
            text: 'Все очень просто и быстро!',
            time: 8.0,
            words: [
              { id: 'mock-w8', text: 'Все', time: 8.0 },
              { id: 'mock-w9', text: 'очень', time: 8.5 },
              { id: 'mock-w10', text: 'просто', time: 9.0 },
              { id: 'mock-w11', text: 'и', time: 9.3 },
              { id: 'mock-w12', text: 'быстро!', time: 9.6 },
            ],
          },
        ];
        useKaraokeStore.setState({
          rawText: mockRawText,
          lines: mockLines,
        });
      }
    }

    return () => {
      // Restore original user state when the tour is deactivated or unmounted
      if (backupRef.current) {
        useKaraokeStore.setState({
          rawText: backupRef.current.rawText,
          lines: backupRef.current.lines,
          step: backupRef.current.step,
          subMode: backupRef.current.subMode,
          audioUrl: backupRef.current.audioUrl,
          audioFileName: backupRef.current.audioFileName,
          appMode: backupRef.current.appMode,
        });
        backupRef.current = null;
      }
    };
  }, [active]);

  const dict = localization[language];

  // Define steps dynamically based on current appMode when the tour starts/runs
  const steps: TourStep[] = appMode === 'karaoke' 
    ? [
        {
          targetId: null,
          titleKey: 'tourWelcomeTitle',
          descKey: 'tourWelcomeDesc'
        },
        {
          targetId: 'audio-loader-section',
          titleKey: 'tourLiteAudioTitle',
          descKey: 'tourLiteAudioDesc'
        },
        {
          targetId: 'auth-section',
          titleKey: 'tourLiteAuthTitle',
          descKey: 'tourLiteAuthDesc'
        },
        {
          targetId: 'karaoke-preview-section',
          titleKey: 'tourLitePlayerTitle',
          descKey: 'tourLitePlayerDesc'
        },
        {
          targetId: 'app-mode-switcher',
          titleKey: 'tourLiteModeTitle',
          descKey: 'tourLiteModeDesc'
        }
      ]
    : [
        {
          targetId: null,
          titleKey: 'tourWelcomeTitle',
          descKey: 'tourWelcomeDesc'
        },
        {
          targetId: 'lyrics-input-section',
          titleKey: 'tourProInputTitle',
          descKey: 'tourProInputDesc',
          autoNav: { mode: 'editor', editorStep: 'input' }
        },
        {
          targetId: 'timing-panel-section',
          titleKey: 'tourProSyncTitle',
          descKey: 'tourProSyncDesc',
          autoNav: { mode: 'editor', editorStep: 'timing', editorSubMode: 'sync' }
        },
        {
          targetId: 'waveform-section',
          titleKey: 'tourProWaveformTitle',
          descKey: 'tourProWaveformDesc',
          autoNav: { mode: 'editor', editorStep: 'timing', editorSubMode: 'sync' }
        },
        {
          targetId: 'lyrics-table-section',
          titleKey: 'tourProTableTitle',
          descKey: 'tourProTableDesc',
          autoNav: { mode: 'editor', editorStep: 'timing', editorSubMode: 'tune' }
        },
        {
          targetId: 'export-section',
          titleKey: 'tourProExportTitle',
          descKey: 'tourProExportDesc',
          autoNav: { mode: 'editor', editorStep: 'edit' }
        }
      ];

  // Auto-navigate between tabs and steps on index change
  useEffect(() => {
    if (!active) return;

    const currentStep = steps[currentStepIndex];
    if (!currentStep) return;

    if (currentStep.autoNav) {
      const { mode, editorStep, editorSubMode } = currentStep.autoNav;
      if (mode && appMode !== mode) {
        setAppMode(mode);
      }
      if (editorStep && step !== editorStep) {
        setStep(editorStep);
      }
      if (editorSubMode) {
        setSubMode(editorSubMode);
      }
    }
  }, [currentStepIndex, active]);

  // Trigger morphing transition state on step index change
  useEffect(() => {
    setIsChangingStep(true);
    const timer = setTimeout(() => {
      setIsChangingStep(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [currentStepIndex]);

  // 1. Scroll target element into view ONLY when currentStepIndex or active changes
  useEffect(() => {
    if (!active) return;
    const currentStep = steps[currentStepIndex];
    if (!currentStep || !currentStep.targetId) return;

    // Small delay to ensure any store-triggered tab navigation has completed rendering
    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(currentStep.targetId!);
      if (el) {
        const rect = el.getBoundingClientRect();
        const isOffscreen = rect.top < 0 || rect.bottom > window.innerHeight;
        if (isOffscreen) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 100);

    return () => clearTimeout(scrollTimer);
  }, [currentStepIndex, active]);

  // 2. Track highlighted DOM element bounds efficiently
  useEffect(() => {
    if (!active) return;

    let animFrameId: number;

    const updateBounds = () => {
      const currentStep = steps[currentStepIndex];
      if (!currentStep || !currentStep.targetId) {
        setTargetRect(null);
        return;
      }

      const el = document.getElementById(currentStep.targetId);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    // Use requestAnimationFrame for scroll update to prevent layout thrashing
    let scheduled = false;
    const handleScrollOrResize = () => {
      if (!scheduled) {
        scheduled = true;
        animFrameId = requestAnimationFrame(() => {
          updateBounds();
          scheduled = false;
        });
      }
    };

    // Delay initial capture slightly to let any scrollIntoView animations start/complete
    const captureTimer = setTimeout(() => {
      updateBounds();
    }, 150);

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, { passive: true });

    return () => {
      clearTimeout(captureTimer);
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize);
    };
  }, [currentStepIndex, active, appMode, step]);

  if (!active) return null;

  const currentStep = steps[currentStepIndex];
  if (!currentStep) return null;

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleClose = () => {
    setCurrentStepIndex(0);
    onClose();
  };

  // Determine dynamic placement of the tooltip to avoid overlapping the target highlight area
  let tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 50,
  };

  if (targetRect) {
    const isTargetInBottomHalf = targetRect.top + targetRect.height / 2 > window.innerHeight / 2;
    if (isTargetInBottomHalf) {
      // Target is in the bottom part, place card at the top
      tooltipStyle.top = 'calc(env(safe-area-inset-top) + 80px)';
    } else {
      // Target is in the top part, place card at the bottom
      tooltipStyle.bottom = 'calc(env(safe-area-inset-bottom) + 30px)';
    }
  } else {
    // Welcome step: centered on screen
    tooltipStyle.top = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  // Get translations
  const title = (dict as any)[currentStep.titleKey] || (currentStepIndex === 0 ? (language === 'ru' ? 'Добро пожаловать!' : 'Welcome!') : '');
  const desc = (dict as any)[currentStep.descKey] || '';

  return (
    <>
      {/* 1. Backdrop overlay with rounded transparent cutout mask */}
      <div className="fixed inset-0 w-full h-full pointer-events-none z-45 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="tour-cutout-mask">
              {/* White blocks light (opaque backdrop) */}
              <rect width="100%" height="100%" fill="white" />
              {/* Black lets light pass through (transparent cutout window) */}
              {targetRect && (
                <rect
                  x={targetRect.left - 10}
                  y={targetRect.top - 10}
                  width={targetRect.width + 20}
                  height={targetRect.height + 20}
                  rx={16}
                  fill="black"
                  className={isChangingStep ? 'transition-all duration-300 ease-out' : ''}
                />
              )}
            </mask>
          </defs>
          {/* Backdrop color masked with cutout */}
          <rect
            width="100%"
            height="100%"
            fill={theme === 'dark' ? 'rgba(9, 9, 11, 0.75)' : 'rgba(15, 23, 42, 0.65)'}
            mask="url(#tour-cutout-mask)"
            className="pointer-events-auto"
          />
        </svg>
      </div>

      {/* 2. Floating Info Card Tooltip with glassmorphism styling */}
      <div
        style={tooltipStyle}
        className={`w-[calc(100%-2rem)] max-w-md p-6 rounded-2xl border shadow-2xl transition-all duration-300 backdrop-blur-md z-50 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200 ${
          theme === 'dark'
            ? 'bg-zinc-950/90 border-zinc-800 text-zinc-150 shadow-zinc-950/80'
            : 'bg-white/95 border-zinc-200 text-zinc-800 shadow-zinc-300/60'
        }`}
      >
        {/* Header inside card */}
        <div className="flex justify-between items-start gap-2">
          <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-violet-500">
            <HelpCircle size={14} />
            {currentStepIndex === 0 
              ? (language === 'ru' ? 'Быстрый старт' : 'Quick Start')
              : `${language === 'ru' ? 'Шаг' : 'Step'} ${currentStepIndex} / ${steps.length - 1}`}
          </span>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-zinc-450 hover:text-red-500 hover:bg-zinc-500/10 transition-colors cursor-pointer"
            title={dict.tourSkip}
          >
            <X size={16} />
          </button>
        </div>

        {/* Card Body */}
        <div className="space-y-1.5">
          <h4 className="text-base font-bold tracking-tight">
            {title}
          </h4>
          <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {desc}
          </p>
        </div>

        {/* Footer actions inside card */}
        <div className="flex justify-between items-center border-t border-zinc-200/10 pt-4 mt-2">
          <button
            onClick={handleClose}
            className={`text-xs font-semibold hover:underline cursor-pointer ${
              theme === 'dark' ? 'text-zinc-500 hover:text-zinc-350' : 'text-zinc-450 hover:text-zinc-650'
            }`}
          >
            {dict.tourSkip}
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                onClick={handlePrev}
                className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-all active:scale-95 cursor-pointer ${
                  theme === 'dark'
                    ? 'border-zinc-800 hover:bg-zinc-900 text-zinc-300'
                    : 'border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                }`}
              >
                <ArrowLeft size={14} />
                {dict.tourPrev}
              </button>
            )}

            <button
              onClick={handleNext}
              className="p-2 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold flex items-center gap-1 transition-all active:scale-95 shadow-md shadow-violet-600/10 hover:shadow-violet-600/20 cursor-pointer"
            >
              {currentStepIndex === steps.length - 1 ? (
                <>
                  <CheckCircle size={14} />
                  {dict.tourFinish}
                </>
              ) : (
                <>
                  {dict.tourNext}
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
