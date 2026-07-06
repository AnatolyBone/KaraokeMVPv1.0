import React, { useState, useEffect, useRef } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { audioRef } from '../audioRef';
import { formatTime } from '../utils/time';
import { localization } from '../utils/localization';
import { Sliders, Play, Pause, HelpCircle, Clock, Anchor } from 'lucide-react';

export const TimelineEditor: React.FC = () => {
  const { lines, updateLineTime, theme, language, beats, snapToBeat } = useKaraokeStore();
  
  const timelineRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [draggingLineId, setDraggingLineId] = useState<string | null>(null);
  const [isSnapped, setIsSnapped] = useState(false); // Индикатор активации магнита

  const dict = localization[language];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);
    setIsPlaying(!audio.paused);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [audioRef.current]);

  // Filter lines that are timed
  const timedLines = lines.filter((l) => l.time !== null);

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!timelineRef.current || !audio || duration === 0 || draggingLineId) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = percent * duration;
  };

  const handleLineDragStart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDraggingLineId(id);
  };

  // Drag and drop logic with Magnetic Snapping (Привязка к битам и соседним фразам)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingLineId || !timelineRef.current || duration === 0) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const dragX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, dragX / rect.width));
      let targetTime = percent * duration;

      let snapped = false;
      const snapThreshold = 0.22; // 220 мс зона захвата магнита

      // 1. Магнитная привязка к долям BPM (beats)
      if (snapToBeat && beats.length > 0) {
        const nearestBeat = beats.reduce((prev, curr) => 
          Math.abs(curr - targetTime) < Math.abs(prev - targetTime) ? curr : prev
        );
        if (Math.abs(nearestBeat - targetTime) < snapThreshold) {
          targetTime = nearestBeat;
          snapped = true;
        }
      }

      // 2. Магнитная привязка к таймингу начала соседних фраз
      if (!snapped) {
        const adjacentLines = timedLines.filter((l) => l.id !== draggingLineId);
        for (const adjLine of adjacentLines) {
          const adjTime = adjLine.time || 0;
          if (Math.abs(adjTime - targetTime) < snapThreshold) {
            targetTime = adjTime;
            snapped = true;
            break;
          }
        }
      }

      setIsSnapped(snapped);
      updateLineTime(draggingLineId, targetTime);
    };

    const handleMouseUp = () => {
      setDraggingLineId(null);
      setIsSnapped(false);
    };

    if (draggingLineId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingLineId, duration, updateLineTime, beats, snapToBeat, timedLines]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      } else {
        audioRef.current.pause();
      }
    }
  };

  return (
    <div
      className={`rounded-2xl p-5 border shadow-sm transition-all ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-zinc-900 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="text-violet-500" size={18} />
          <h4 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2">
            {dict.timelineTitle}
            {isSnapped && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[9px] font-bold animate-pulse">
                <Anchor size={10} /> МАГНИТ ✓
              </span>
            )}
          </h4>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <span className="text-xs font-mono font-bold text-zinc-500">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {duration === 0 ? (
        <div className="py-8 text-center text-zinc-400 text-xs flex flex-col items-center justify-center gap-2">
          <Clock size={26} className="opacity-40" />
          {language === 'ru' ? 'Загрузите аудиофайл для отображения таймлайна' : 'Load audio file to visualize the timeline'}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500 flex items-center gap-1">
            <HelpCircle size={12} /> 
            <strong>{language === 'ru' ? 'Совет' : 'Tip'}:</strong> {dict.timelineTip}
            {snapToBeat && (
              <span className="text-emerald-500 font-semibold ml-1">
                ({language === 'ru' ? 'Магнитная привязка активна' : 'Magnetic snapping active'})
              </span>
            )}
          </p>

          {/* Timeline Track Area */}
          <div 
            ref={timelineRef}
            onClick={handleScrub}
            className="h-14 w-full bg-zinc-100 dark:bg-zinc-900 rounded-xl relative cursor-ew-resize overflow-hidden border border-zinc-200/10"
          >
            {/* Playhead Line */}
            <div 
              className="absolute top-0 bottom-0 w-[2px] bg-rose-500 z-20 pointer-events-none"
              style={{ left: `${(currentTime / duration) * 100}%` }}
            >
              <div className="w-2 h-2 rounded-full bg-rose-500 -translate-x-[3px]" />
            </div>

            {/* Visual Lyric Line Blocks */}
            {timedLines.map((line) => {
              const percentLeft = ((line.time || 0) / duration) * 100;
              
              return (
                <div
                  key={line.id}
                  onMouseDown={(e) => handleLineDragStart(e, line.id)}
                  className={`absolute top-2 bottom-2 px-2 py-1 rounded-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-[9px] font-extrabold truncate border transition-all shadow-sm z-10 ${
                    draggingLineId === line.id
                      ? 'bg-violet-600 border-violet-500 text-white scale-105 shadow-violet-500/30'
                      : theme === 'dark'
                      ? 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200'
                      : 'bg-zinc-200 hover:bg-zinc-300 border-zinc-300 text-zinc-700'
                  }`}
                  style={{ 
                    left: `${percentLeft}%`, 
                    maxWidth: '140px',
                    minWidth: '45px',
                    transform: 'translateX(-50%)'
                  }}
                  title={`[${formatTime(line.time)}] ${line.text}`}
                >
                  {line.text}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
