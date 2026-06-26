import React, { useState, useEffect } from 'react';
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

  // Track highlighted DOM element bounds & scroll it into view
  useEffect(() => {
    if (!active) return;

    const updatePosition = () => {
      const currentStep = steps[currentStepIndex];
      if (!currentStep || !currentStep.targetId) {
        setTargetRect(null);
        return;
      }

      const el = document.getElementById(currentStep.targetId);
      if (el) {
        // Scroll target element into view smoothly if it's far
        const rect = el.getBoundingClientRect();
        const isOffscreen = rect.top < 0 || rect.bottom > window.innerHeight;
        
        if (isOffscreen) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        // Brief timeout for scroll transition to settle, then extract final bounds
        const timer = setTimeout(() => {
          setTargetRect(el.getBoundingClientRect());
        }, isOffscreen ? 300 : 50);

        return () => clearTimeout(timer);
      } else {
        setTargetRect(null);
      }
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
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
                  className="transition-all duration-300"
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
