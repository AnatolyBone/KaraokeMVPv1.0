import React, { useState, useEffect, useRef } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { audioRef } from '../../audioRef';
import { formatTime } from '../../utils/time';
import { localization } from '../../utils/localization';
import { Play, Pause, Music, Maximize, Minimize, Globe } from 'lucide-react';

export const KaraokePreview: React.FC = () => {
  const { lines, theme, language } = useKaraokeStore();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const dict = localization[language];

  // Connect to audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    setCurrentTime(audio.currentTime);
    setIsPlaying(!audio.paused);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [audioRef.current]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Сортируем и фильтруем только тайминговые строки
  const timedLines = lines
    .map((line, originalIndex) => ({ ...line, originalIndex }))
    .filter((line) => line.time !== null)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  // Вычисляем индекс активной строки
  let activeIdxInTimed = -1;
  for (let i = 0; i < timedLines.length; i++) {
    if (timedLines[i].time! <= currentTime) {
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

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickPercent = clickX / rect.width;
    audio.currentTime = clickPercent * audio.duration;
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (!document.fullscreenElement) {
      stageRef.current.requestFullscreen().catch((err) => console.warn('Fullscreen request failed:', err));
    } else {
      document.exitFullscreen();
    }
  };

  const duration = audioRef.current ? audioRef.current.duration || 0 : 0;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const hasWordSync = currentLine?.words && currentLine.words.some(w => w.time !== null);

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Karaoke Main Stage */}
      <div
        ref={stageRef}
        className={`relative overflow-hidden rounded-2xl border p-8 flex flex-col justify-between min-h-[340px] transition-all shadow-lg select-none ${
          theme === 'dark' || isFullscreen
            ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        {/* Gradient Masks to fade out top/bottom lines */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-zinc-950 to-transparent pointer-events-none z-25" />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none z-25" />

        {/* Header info */}
        <div className="flex justify-between items-center text-xs font-medium text-zinc-400 dark:text-zinc-500 z-20">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-ping" />
            {dict.livePlayerLabel}
          </span>
          
          <div className="flex items-center gap-3">
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-zinc-500/10 text-zinc-400 hover:text-zinc-250 transition-all text-[10px] font-bold uppercase tracking-wider"
              title={dict.fullscreenLabel}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
              <span className="hidden sm:inline">{dict.fullscreenLabel}</span>
            </button>
            
            <span className="font-mono text-xs">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Аппаратно-ускоренная «барабанная» прокрутка субтитров */}
        <div className="relative h-48 overflow-hidden flex items-center justify-center w-full z-10 my-auto">
          
          <div 
            className="absolute flex flex-col items-center w-full transition-transform duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]"
            style={{ 
              transform: `translateY(-${activeIdxInTimed * 72}px)`,
              top: 'calc(50% - 36px)' // Центрирует активную строку
            }}
          >
            {timedLines.map((line, idx) => {
              const isActive = idx === activeIdxInTimed;
              const isPrev = idx === activeIdxInTimed - 1;
              const isNext = idx === activeIdxInTimed + 1;
              const isNextNext = idx === activeIdxInTimed + 2;

              // Назначаем стили в зависимости от близости к центру
              let lineClass = "opacity-0 scale-75 pointer-events-none";
              if (isActive) {
                lineClass = "opacity-100 scale-105 z-20";
              } else if (isPrev) {
                lineClass = "opacity-25 scale-90 z-10 text-zinc-450";
              } else if (isNext) {
                lineClass = "opacity-55 scale-95 z-10 text-zinc-300";
              } else if (isNextNext) {
                lineClass = "opacity-15 scale-85 z-0 text-zinc-500";
              }

              return (
                <div
                  key={line.id}
                  className={`h-[72px] flex flex-col items-center justify-center text-center px-4 w-full transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)] ${lineClass}`}
                >
                  {isActive && hasWordSync ? (
                    /* Пословный прогрессивный закрас в реальном времени */
                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 max-w-2xl">
                      {line.words.map((w, wIdx) => {
                        const wordStart = w.time || line.time || 0;
                        const nextW = line.words[wIdx + 1];
                        const wordEnd = nextW?.time || (timedLines[idx + 1]?.time || wordStart + 1);
                        
                        const isFullyReached = currentTime >= wordEnd;
                        const isActiveNow = currentTime >= wordStart && currentTime < wordEnd;

                        let wordStyle = 'text-zinc-400/30 dark:text-zinc-650/35';
                        if (isFullyReached) {
                          wordStyle = 'text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 dark:from-violet-400 dark:via-fuchsia-400 dark:to-pink-400 font-extrabold drop-shadow-[0_1px_8px_rgba(168,85,247,0.3)]';
                        } else if (isActiveNow) {
                          wordStyle = 'text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-rose-500 dark:from-pink-400 dark:to-rose-400 font-extrabold scale-110';
                        }

                        return (
                          <span key={w.id} className={`text-xl sm:text-3xl transition-all duration-200 ${wordStyle}`}>
                            {w.text}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    /* Обычная строчка субтитров */
                    <p className={`text-xl sm:text-3xl font-extrabold leading-tight ${
                      isActive 
                        ? 'text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 dark:from-violet-400 dark:via-fuchsia-400 dark:to-pink-400 drop-shadow-sm' 
                        : ''
                    }`}>
                      {line.text}
                    </p>
                  )}
                  
                  {/* Перевод строки (отображается только у активной строки) */}
                  {isActive && line.translation && (
                    <p className="text-xs sm:text-base font-semibold italic text-violet-500/85 dark:text-violet-400/85 flex items-center gap-1 justify-center mt-1 leading-tight">
                      <Globe size={12} className="shrink-0" />
                      {line.translation}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Player Bar overlay */}
        <div className="z-20 pt-4 flex items-center gap-4">
          <button
            onClick={togglePlay}
            className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 active:scale-95 transition-all flex items-center justify-center shrink-0 shadow-md shadow-violet-600/15"
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <div
            onClick={handleProgressClick}
            className="h-3 flex-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/20 dark:border-zinc-800/20 rounded-full cursor-pointer overflow-hidden relative group"
          >
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-75"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

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
