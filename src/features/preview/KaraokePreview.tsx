import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { audioRef } from '../../audioRef';
import { formatTime } from '../../utils/time';
import { localization } from '../../utils/localization';
import { Play, Pause, Music, Maximize, Minimize, Globe } from 'lucide-react';
import { TimingOffsetPanel } from '../../components/TimingOffsetPanel';
import { useAudioTransport } from '../../hooks/useAudioTransport';
import { createEffectiveTimingLines } from '../../utils/timingOffset';

interface KaraokePreviewProps {
  showQuickShift?: boolean;
}

export const KaraokePreview: React.FC<KaraokePreviewProps> = ({ showQuickShift = true }) => {
  const { lines, globalTimingOffset, timingComparisonMode, theme, language, coverColors } = useKaraokeStore();
  const { currentTime, duration, isPlaying } = useAudioTransport();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSimulatedFullscreen, setIsSimulatedFullscreen] = useState(false);
  
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isScrubbingRef = useRef(false);

  const dict = localization[language];
  const PREVIEW_TEXT_LEAD_SECONDS = 0.095;

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Listen for simulated fullscreen Escape exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSimulatedFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset simulated fullscreen when native fullscreen starts
  useEffect(() => {
    if (isFullscreen) {
      setIsSimulatedFullscreen(false);
    }
  }, [isFullscreen]);

  // Сортируем и фильтруем только тайминговые строки
  const effectiveLines = useMemo(
    () => createEffectiveTimingLines(lines, globalTimingOffset, timingComparisonMode),
    [lines, globalTimingOffset, timingComparisonMode],
  );
  const timedLines = effectiveLines
    .map((line, originalIndex) => ({ ...line, originalIndex }))
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));
  const timedLinesCount = timedLines.length;

  const lyricTime = currentTime + PREVIEW_TEXT_LEAD_SECONDS;

  // Вычисляем индекс активной строки
  let activeIdxInTimed = -1;
  for (let i = 0; i < timedLines.length; i++) {
    if (timedLines[i].time! <= lyricTime) {
      activeIdxInTimed = i;
    } else {
      break;
    }
  }

  const currentLine = activeIdxInTimed !== -1 ? timedLines[activeIdxInTimed] : null;

  // Auto-scroll active item inside the sidebar list container
  useEffect(() => {
    if (currentLine && listRef.current) {
      const activeElement = document.getElementById(`preview-item-${currentLine.id}`);
      if (activeElement) {
        const container = listRef.current;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        
        const elemTop = activeElement.offsetTop;
        const elemBottom = elemTop + activeElement.clientHeight;
        
        if (elemTop < containerTop) {
          container.scrollTo({ top: elemTop - 10, behavior: 'smooth' });
        } else if (elemBottom > containerBottom) {
          container.scrollTo({ top: elemBottom - container.clientHeight + 10, behavior: 'smooth' });
        }
      }
    }
  }, [currentLine?.id]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      } else {
        audioRef.current.pause();
      }
    }
  };

  const seekFromClientX = (clientX: number, target: HTMLDivElement) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;

    const rect = target.getBoundingClientRect();
    const clickX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const clickPercent = rect.width > 0 ? clickX / rect.width : 0;
    const nextTime = clickPercent * audio.duration;
    audio.currentTime = nextTime;
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isScrubbingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekFromClientX(e.clientX, e.currentTarget);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    seekFromClientX(e.clientX, e.currentTarget);
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    seekFromClientX(e.clientX, e.currentTarget);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    
    // Check for native Fullscreen support (absent on iPhone Safari for divs)
    const hasNativeFullscreen = !!stageRef.current.requestFullscreen || 
                                !!(stageRef.current as any).webkitRequestFullscreen ||
                                !!(stageRef.current as any).mozRequestFullScreen ||
                                !!(stageRef.current as any).msRequestFullscreen;

    if (hasNativeFullscreen) {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const req = stageRef.current.requestFullscreen || 
                    (stageRef.current as any).webkitRequestFullscreen ||
                    (stageRef.current as any).mozRequestFullScreen ||
                    (stageRef.current as any).msRequestFullscreen;
        req.call(stageRef.current).catch((err) => {
          console.warn('Native fullscreen request failed, falling back to simulated:', err);
          setIsSimulatedFullscreen(true);
        });
      } else {
        const exit = document.exitFullscreen || 
                     (document as any).webkitExitFullscreen ||
                     (document as any).mozCancelFullScreen ||
                     (document as any).msExitFullscreen;
        exit.call(document);
        setIsSimulatedFullscreen(false);
      }
    } else {
      // simulated fullscreen fallback for iOS Safari/iPhone
      setIsSimulatedFullscreen(!isSimulatedFullscreen);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasWordSync = currentLine?.words && currentLine.words.some(w => w.time !== null);
  const isPlayerFullscreen = isFullscreen || isSimulatedFullscreen;
  const gradientColorClass = theme === 'dark' || isPlayerFullscreen ? 'from-zinc-950' : 'from-white';

  return (
    <div id="karaoke-preview-section" className="w-full flex flex-col gap-6">
      {/* Karaoke Main Stage */}
      <div
        ref={stageRef}
        className={isPlayerFullscreen
          ? "fixed inset-0 z-50 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))] px-4 sm:px-6 flex flex-col justify-between bg-zinc-950 text-zinc-100 select-none"
          : `relative overflow-hidden rounded-2xl border p-5 sm:p-8 flex flex-col justify-between min-h-[300px] sm:min-h-[340px] transition-all shadow-lg select-none ${
              theme === 'dark'
                ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
                : 'bg-white border-zinc-200 text-zinc-900'
            }`
        }
        style={isPlayerFullscreen && coverColors ? {
          background: `radial-gradient(circle at 50% 30%, ${coverColors.primary} 0%, #09090b 80%)`
        } : undefined}
      >
        {/* Gradient Masks to fade out top/bottom lines */}
        <div className={`absolute top-0 left-0 right-0 ${isPlayerFullscreen ? 'h-32' : 'h-16'} bg-gradient-to-b ${gradientColorClass} to-transparent pointer-events-none z-25`} />
        <div className={`absolute bottom-0 left-0 right-0 ${isPlayerFullscreen ? 'h-32' : 'h-16'} bg-gradient-to-t ${gradientColorClass} to-transparent pointer-events-none z-25`} />

        {/* Header info */}
        <div className={`flex justify-between items-center gap-2 text-xs font-medium z-20 ${
          isPlayerFullscreen ? 'text-white/75' : 'text-zinc-400'
        }`}>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-ping" />
            {dict.livePlayerLabel}
          </span>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggleFullscreen}
              className={`flex items-center gap-1 p-2 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wider cursor-pointer ${
                isPlayerFullscreen
                  ? 'bg-white/10 text-white/85 hover:bg-white/15 hover:text-white'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-500/10 dark:hover:text-zinc-200'
              }`}
              title={dict.fullscreenLabel}
            >
              {isPlayerFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
              <span className="hidden sm:inline">{dict.fullscreenLabel}</span>
            </button>
            
            <span className={`font-mono text-[11px] sm:text-xs tabular-nums ${
              isPlayerFullscreen ? 'text-white/80' : ''
            }`}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Lyrics Display Arena (Unified Smooth Scrolling Drum) */}
        {timedLinesCount === 0 ? (
          <div className="flex-1 flex flex-col justify-center items-center text-center my-auto w-full z-10 select-none">
            <p className="text-xl sm:text-2xl text-zinc-500 italic">🎤 ...</p>
          </div>
        ) : (
          <div 
            className="relative overflow-hidden flex items-center justify-center w-full z-10 my-auto transition-all"
            style={{ height: `${(isPlayerFullscreen ? 112 : 72) * 3}px` }}
          >
            <div 
              className="absolute flex flex-col items-center w-full transition-transform duration-[220ms] ease-out"
              style={{ 
                transform: `translateY(-${activeIdxInTimed * (isPlayerFullscreen ? 112 : 72)}px)`,
                top: `calc(50% - ${(isPlayerFullscreen ? 112 : 72) / 2}px)`
              }}
            >
              {timedLines.map((line, idx) => {
                const isActive = idx === activeIdxInTimed;
                const isPrev = idx === activeIdxInTimed - 1;
                const isNext = idx === activeIdxInTimed + 1;
                const isNextNext = idx === activeIdxInTimed + 2;

                // Назначаем стили в зависимости от близости к центру и режима экрана
                let lineClass = "opacity-0 scale-75 pointer-events-none";
                if (isActive) {
                  lineClass = "opacity-100 scale-100 z-20";
                } else if (isPrev) {
                  lineClass = isPlayerFullscreen 
                    ? "opacity-25 scale-85 z-10 text-zinc-500" 
                    : "opacity-25 scale-90 z-10 text-zinc-500";
                } else if (isNext) {
                  lineClass = isPlayerFullscreen 
                    ? "opacity-45 scale-90 z-10 text-zinc-400" 
                    : "opacity-55 scale-95 z-10 text-zinc-300";
                } else if (isNextNext) {
                  lineClass = isPlayerFullscreen 
                    ? "opacity-0 scale-75 pointer-events-none" 
                    : "opacity-15 scale-85 z-0 text-zinc-500";
                }

                const currentLineHeight = isPlayerFullscreen ? 112 : 72;

                return (
                  <div
                    key={line.id}
                    style={{ height: `${currentLineHeight}px` }}
                    className={`flex flex-col items-center justify-center text-center px-4 w-full transition-all duration-[180ms] ease-out ${lineClass}`}
                  >
                    {isActive && hasWordSync ? (
                      /* Пословный прогрессивный закрас в реальном времени */
                      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 max-w-4xl">
                        {line.words.map((w, wIdx) => {
                          const wordStart = w.time || line.time || 0;
                          const nextW = line.words[wIdx + 1];
                          const wordEnd = nextW?.time || (timedLines[idx + 1]?.time || wordStart + 1);
                          
                          const isFullyReached = lyricTime >= wordEnd;
                          const isActiveNow = lyricTime >= wordStart && lyricTime < wordEnd;

                          let wordStyle = isPlayerFullscreen
                            ? 'text-zinc-700 dark:text-zinc-600'
                            : 'text-zinc-400/30 dark:text-zinc-700/35';

                          if (isFullyReached) {
                            wordStyle = isPlayerFullscreen
                              ? 'text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 font-extrabold drop-shadow-[0_2px_12px_rgba(168,85,247,0.45)]'
                              : 'text-violet-600 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-violet-400 dark:via-fuchsia-400 dark:to-pink-400 font-extrabold dark:drop-shadow-[0_1px_8px_rgba(168,85,247,0.3)]';
                          } else if (isActiveNow) {
                            wordStyle = 'text-violet-600 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-pink-400 dark:to-rose-400 font-extrabold scale-110';
                          }

                          const wordSizeClass = isPlayerFullscreen
                            ? "text-2xl sm:text-4xl md:text-5xl"
                            : "text-xl sm:text-3xl";

                          return (
                            <span key={w.id} className={`${wordSizeClass} transition-all duration-75`}>
                              <span className={wordStyle}>{w.text}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      /* Обычная строчка субтитров */
                      <p className={`font-extrabold leading-tight ${
                        isPlayerFullscreen
                          ? 'text-2xl sm:text-4xl md:text-5xl'
                          : 'text-xl sm:text-3xl'
                      } ${
                        isActive 
                          ? (isPlayerFullscreen
                              ? 'text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 drop-shadow-[0_2px_12px_rgba(168,85,247,0.3)]'
                              : 'text-violet-600 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-violet-400 dark:via-fuchsia-400 dark:to-pink-400 dark:drop-shadow-sm'
                            )
                          : ''
                      }`}>
                        {line.text}
                      </p>
                    )}
                    
                    {/* Перевод строки (отображается только у активной строки) */}
                    {isActive && line.translation && (
                      <p className={`font-semibold italic text-violet-500/85 dark:text-violet-400/85 flex items-center gap-1.5 justify-center leading-tight ${
                        isPlayerFullscreen
                          ? 'text-sm sm:text-xl md:text-2xl mt-3.5'
                          : 'text-xs sm:text-base mt-1'
                      }`}>
                        <Globe size={isPlayerFullscreen ? 18 : 12} className="shrink-0" />
                        {line.translation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Player Bar overlay */}
        <div className="z-20 pt-4 flex items-center gap-3 sm:gap-4">
          <button
            onClick={togglePlay}
            className={`rounded-xl text-white active:scale-95 transition-all flex items-center justify-center shrink-0 cursor-pointer ${
              isPlayerFullscreen
                ? 'p-3 bg-white/15 hover:bg-white/20 shadow-lg shadow-black/20'
                : 'p-2.5 bg-violet-600 hover:bg-violet-700 shadow-md shadow-violet-600/15'
            }`}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <div
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerUp}
            className={`h-6 sm:h-5 flex-1 rounded-full cursor-pointer overflow-hidden relative group touch-none flex items-center ${
              isPlayerFullscreen
                ? 'bg-white/18 border border-white/20'
                : 'bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/20 dark:border-zinc-800/20'
            }`}
          >
            <div
              className="h-3 sm:h-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full transition-all ${
                isPlayerFullscreen
                  ? 'bg-white shadow-lg shadow-black/25'
                  : 'bg-white shadow-md shadow-violet-500/25 ring-1 ring-violet-200'
              }`}
              style={{ left: `calc(${progressPercent}% - 8px)` }}
            />
          </div>
        </div>
      </div>

      {showQuickShift && timedLinesCount > 0 && (
        <TimingOffsetPanel />
      )}

      {/* Compact sidebar/list view */}
      <div
        className={`rounded-2xl p-5 border shadow-sm transition-all ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
        }`}
      >
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3 flex items-center gap-1">
          <Music size={15} /> {dict.timelineTrackLabel} ({timedLines.length} {language === 'ru' ? 'строк с таймингами' : 'lines with timing'})
        </h3>

        <div
          ref={listRef}
          className="max-h-60 overflow-y-auto pr-1 flex flex-col gap-1 scrollbar-thin scrollbar-thumb-zinc-800"
        >
          {timedLines.map((line, index) => {
            const isActive = currentLine?.id === line.id;
            return (
              <div
                key={line.id}
                id={`preview-item-${line.id}`}
                onClick={() => {
                  if (audioRef.current && line.time !== null) {
                    audioRef.current.currentTime = line.time;
                  }
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer text-xs transition-all ${
                  isActive
                    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-bold'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-500/5 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 shrink-0">
                    {index + 1}
                  </span>
                  <span className="truncate">{line.text}</span>
                </div>
                <span className="font-mono text-[10px] shrink-0 font-bold pl-2">
                  {formatTime(line.time)}
                </span>
              </div>
            );
          })}

          {timedLines.length === 0 && (
            <div className="py-6 text-center text-zinc-500 text-xs">
              {dict.timelineNoLines}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
