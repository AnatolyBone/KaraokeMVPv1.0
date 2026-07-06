import React, { useState, useEffect } from 'react';
import { useKaraokeStore } from '../../store/useKaraokeStore';
import { audioRef, seekAudio, toggleAudioPlay } from '../../audioRef';
import { formatTime } from '../../utils/time';
import { Waveform } from '../../components/Waveform';
import { localization } from '../../utils/localization';
import { Play, Pause, RotateCcw, Undo2, Check, ArrowRight, SkipBack, SkipForward, HelpCircle, RotateCw, Touchpad } from 'lucide-react';

export const TimingPanel: React.FC = () => {
  const {
    lines,
    currentIndex,
    currentWordIndex,
    currentSyllableIndex,
    isPlaying,
    timingMode,
    syllableMode,
    timestampCurrent,
    undoLastTiming,
    resetTimings,
    setTimingMode,
    setSyllableMode,
    setStep,
    theme,
    history,
    historyIndex,
    undo,
    redo,
    language,
  } = useKaraokeStore();

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const dict = localization[language];

  // Sync time updates for UI
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleDurationChange = () => {
      setDuration(audio.duration || 0);
    };

    // Initial values
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || 0);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
    };
  }, [audioRef.current]);

  const handleSpaceClick = () => {
    if (audioRef.current) {
      timestampCurrent(audioRef.current.currentTime);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const timingProgress = lines.length > 0 ? (currentIndex / lines.length) * 100 : 0;

  // Active line indices
  const prevLine = currentIndex > 0 ? lines[currentIndex - 1] : null;
  const activeLine = currentIndex < lines.length ? lines[currentIndex] : null;
  const nextLine = currentIndex + 1 < lines.length ? lines[currentIndex + 1] : null;
  const subsequentLine = currentIndex + 2 < lines.length ? lines[currentIndex + 2] : null;

  return (
    <div id="timing-panel-section" className="w-full flex flex-col gap-6">
      {/* Waveform Navigation Display */}
      <Waveform />

      {/* Timing Screen Showcase */}
      <div
        className={`relative overflow-hidden rounded-2xl p-6 sm:p-8 border shadow-md transition-all min-h-[300px] flex flex-col justify-between ${
          theme === 'dark'
            ? 'bg-gradient-to-b from-zinc-950 to-zinc-900 border-zinc-800 text-zinc-100'
            : 'bg-gradient-to-b from-white to-zinc-50 border-zinc-200 text-zinc-900'
        }`}
      >
        {/* Top Metadata & Timing Mode selector */}
        <div className="flex justify-between items-center text-xs font-semibold text-zinc-400 dark:text-zinc-500 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span>{language === 'ru' ? 'РАССТАНОВКА ТАЙМИНГОВ' : 'TIMING SYNCHRONIZATION'}</span>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="p-1 rounded hover:bg-zinc-800/50 text-zinc-400 transition-all"
              title="Справка по режимам"
            >
              <HelpCircle size={14} />
            </button>
          </div>

          {/* Line vs Word vs Syllable Sync toggles */}
          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200/30 dark:border-zinc-800 p-1 rounded-xl">
            <button
              onClick={() => {
                setTimingMode('line');
                setSyllableMode(false);
              }}
              className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${
                timingMode === 'line' && !syllableMode
                  ? 'bg-white dark:bg-zinc-800 text-violet-500 dark:text-violet-400 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {language === 'ru' ? 'Построчно' : 'Line'}
            </button>
            <button
              onClick={() => {
                setTimingMode('word');
                setSyllableMode(false);
              }}
              className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${
                timingMode === 'word' && !syllableMode
                  ? 'bg-white dark:bg-zinc-800 text-violet-500 dark:text-violet-400 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {language === 'ru' ? 'Пословно' : 'Word'}
            </button>
            <button
              onClick={() => {
                setTimingMode('word');
                setSyllableMode(true);
              }}
              className={`px-2 py-1 rounded-lg font-bold text-[10px] transition-all ${
                syllableMode
                  ? 'bg-white dark:bg-zinc-800 text-violet-500 dark:text-violet-400 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {language === 'ru' ? 'Послогово' : 'Syllable'}
            </button>
          </div>

          <span>
            {language === 'ru' ? 'Строка' : 'Line'} {Math.min(currentIndex + 1, lines.length)} {language === 'ru' ? 'из' : 'of'} {lines.length}
          </span>
        </div>

        {/* Dynamic Help box */}
        {showHelp && (
          <div className="mt-3 p-3 rounded-xl text-xs bg-violet-500/5 border border-violet-500/10 text-violet-600 dark:text-violet-400 leading-relaxed">
            <strong>{dict.helpModeTitle}</strong>
            <ul className="list-disc pl-4 mt-1 space-y-1">
              <li>{dict.helpModeLine}</li>
              <li>{dict.helpModeWord}</li>
              <li>
                <strong>{language === 'ru' ? 'Послогово' : 'Syllable'}:</strong>{' '}
                {language === 'ru' 
                  ? 'Нажмите Space на каждый слог слова. Слоги формируются автоматически по правилам языка.' 
                  : 'Press Space at the start of each syllable. Syllables are formatted automatically.'}
              </li>
            </ul>
          </div>
        )}

        {/* Active Lyrics Display Area */}
        <div className="my-6 flex flex-col items-center justify-center gap-3 text-center py-4">
          {/* Previous line */}
          <p className="text-xs sm:text-sm text-zinc-400 dark:text-zinc-600 select-none line-clamp-1 font-medium opacity-60">
            {prevLine ? `${prevLine.text} (${formatTime(prevLine.time)})` : '• • •'}
          </p>

          {/* Current Active Line */}
          {activeLine ? (
            <div className="my-2 transform transition-all scale-105 flex flex-col items-center">
              {timingMode === 'line' ? (
                <p className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 tracking-tight px-2 text-center leading-tight">
                  {activeLine.text}
                </p>
              ) : syllableMode ? (
                /* Syllable Mode Render */
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 max-w-xl text-center">
                  {activeLine.words.map((word, wIdx) => {
                    const isWordTimed = word.time !== null;
                    const isWordActive = wIdx === currentWordIndex;

                    return (
                      <div key={word.id} className="flex items-center gap-0.5">
                        {word.syllables && word.syllables.length > 0 ? (
                          word.syllables.map((syl, sIdx) => {
                            const isSylTimed = syl.time !== null;
                            const isSylActive = isWordActive && sIdx === currentSyllableIndex;

                            let sylStyle = 'text-zinc-500 dark:text-zinc-600 font-medium text-lg sm:text-xl';
                            if (isSylTimed) {
                              sylStyle = 'text-violet-600 dark:text-violet-400 font-bold text-xl sm:text-2xl line-through decoration-violet-500/20';
                            } else if (isSylActive) {
                              sylStyle = 'text-transparent bg-clip-text bg-gradient-to-r from-pink-600 to-rose-600 dark:from-pink-400 dark:to-rose-400 font-extrabold text-2xl sm:text-3xl tracking-tight scale-110 drop-shadow-sm transition-all animate-pulse';
                            }

                            return (
                              <span key={syl.id} className={`inline-block ${sylStyle}`}>
                                {syl.text}
                                {sIdx < word.syllables!.length - 1 ? '-' : ''}
                              </span>
                            );
                          })
                        ) : (
                          <span className={`text-xl sm:text-2xl ${isWordTimed ? 'text-violet-400 line-through' : isWordActive ? 'text-pink-500 scale-110' : 'text-zinc-500'}`}>
                            {word.text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Standard Word Mode Render */
                <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-4 max-w-xl text-center">
                  {activeLine.words.map((w, idx) => {
                    const isWordTimed = w.time !== null;
                    const isWordActive = idx === currentWordIndex;
                    
                    let wordStyle = 'text-zinc-500 dark:text-zinc-600 font-medium text-lg sm:text-xl';
                    if (isWordTimed) {
                      wordStyle = 'text-violet-600 dark:text-violet-400 font-bold text-xl sm:text-2xl line-through decoration-violet-500/20';
                    } else if (isWordActive) {
                      wordStyle = 'text-transparent bg-clip-text bg-gradient-to-r from-pink-600 to-rose-600 dark:from-pink-400 dark:to-rose-400 font-extrabold text-2xl sm:text-3xl tracking-tight scale-110 drop-shadow-sm transition-all animate-pulse';
                    }

                    return (
                      <span
                        key={w.id}
                        className={`inline-block px-1 py-0.5 rounded-md transition-all ${wordStyle}`}
                      >
                        {w.text}
                      </span>
                    );
                  })}
                </div>
              )}

              <span className="inline-block text-[10px] mt-3 px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-500 dark:text-violet-400 font-bold animate-pulse uppercase tracking-wider">
                {timingMode === 'line' 
                  ? dict.timingSpaceLabel
                  : syllableMode
                  ? `${dict.timingWordLabel} (${language === 'ru' ? 'слог' : 'syllable'}): "${activeLine.words[currentWordIndex]?.syllables?.[currentSyllableIndex]?.text || ''}"`
                  : `${dict.timingWordLabel}: "${activeLine.words[currentWordIndex]?.text || ''}"`}
              </span>
            </div>
          ) : (
            <div className="my-2 flex flex-col items-center">
              <p className="text-xl font-bold text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                <Check size={24} /> {dict.allDone}
              </p>
              <button
                onClick={() => setStep('edit')}
                className="mt-3 px-4 py-1.5 rounded-lg text-xs bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors"
              >
                {dict.goToEdit}
              </button>
            </div>
          )}

          {/* Next lines */}
          <p className="text-xs sm:text-sm text-zinc-400 dark:text-zinc-500 select-none line-clamp-1 font-medium mt-1">
            {nextLine ? nextLine.text : '• • •'}
          </p>
          {subsequentLine && (
            <p className="text-[11px] text-zinc-300 dark:text-zinc-600 select-none line-clamp-1 font-normal">
              {subsequentLine.text}
            </p>
          )}
        </div>

        {/* Custom progress bar */}
        <div className="w-full mt-auto">
          <div className="flex justify-between text-[10px] font-bold text-zinc-400 dark:text-zinc-500 mb-1">
            <span>{dict.timingProgress}</span>
            <span>{Math.round(timingProgress)}%</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-300"
              style={{ width: `${timingProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Interactive Playback Control Center */}
      <div
        className={`rounded-2xl p-6 border shadow-sm flex flex-col gap-5 ${
          theme === 'dark' ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
        }`}
      >
        {/* Audio Scrubbing Bar */}
        <div>
          <div className="flex justify-between items-center text-xs text-zinc-500 mb-1 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const clickPercent = clickX / rect.width;
              if (audioRef.current && duration > 0) {
                audioRef.current.currentTime = clickPercent * duration;
              }
            }}
            className="h-2.5 w-full bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden cursor-pointer relative group border border-zinc-200/10"
          >
            <div
              className="h-full bg-violet-500 group-hover:bg-violet-600 transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Rewind / Fast forward */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => seekAudio(-2)}
              className={`p-2.5 rounded-xl border transition-all ${
                theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Перемотка -2 сек"
            >
              <SkipBack size={16} />
            </button>
            
            <button
              onClick={() => seekAudio(2)}
              className={`p-2.5 rounded-xl border transition-all ${
                theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Перемотка +2 сек"
            >
              <SkipForward size={16} />
            </button>
          </div>

          {/* Main Trigger Timing & Play/Pause */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleAudioPlay}
              className="p-4 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-all duration-200"
              title={isPlaying ? 'Пауза (P)' : 'Воспроизведение (P)'}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>

            <button
              onClick={handleSpaceClick}
              disabled={!activeLine}
              className={`px-6 py-3.5 rounded-xl font-bold shadow-md transition-all duration-200 select-none active:scale-95 ${
                !activeLine
                  ? 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-600/25 hover:shadow-violet-600/35'
              }`}
            >
              Тайминг [Space]
            </button>
          </div>

          {/* Reset & Undo / Redo stack */}
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className={`p-2.5 rounded-xl border transition-all ${
                historyIndex <= 0
                  ? 'opacity-40 cursor-not-allowed'
                  : theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Отменить действие"
            >
              <Undo2 size={15} />
            </button>

            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className={`p-2.5 rounded-xl border transition-all ${
                historyIndex >= history.length - 1
                  ? 'opacity-40 cursor-not-allowed'
                  : theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Повторить действие"
            >
              <RotateCw size={15} />
            </button>

            <div className="h-5 w-[1px] bg-zinc-200 dark:bg-zinc-800 mx-1" />

            <button
              onClick={undoLastTiming}
              disabled={currentIndex === 0 && currentWordIndex === 0 && currentSyllableIndex === 0}
              className={`p-2.5 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-medium ${
                currentIndex === 0 && currentWordIndex === 0 && currentSyllableIndex === 0
                  ? 'opacity-50 cursor-not-allowed'
                  : theme === 'dark'
                  ? 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  : 'bg-zinc-50 hover:bg-zinc-100 border-zinc-200 text-zinc-700'
              }`}
              title="Отменить метку (Backspace)"
            >
              {language === 'ru' ? 'Отмена' : 'Undo'} [Bksp]
            </button>

            <button
              onClick={() => {
                if (confirm('Сбросить все проставленные тайминги?')) {
                  resetTimings();
                }
              }}
              className={`p-2.5 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 ${
                theme === 'dark' ? 'border-zinc-800' : 'border-zinc-200'
              }`}
              title="Сбросить разметку"
            >
              <RotateCcw size={15} />
              {language === 'ru' ? 'Сброс' : 'Reset'}
            </button>
          </div>
        </div>

        {/* Highly intuitive big touch/tap target area */}
        <div 
          onClick={handleSpaceClick}
          className="md:hidden w-full h-24 rounded-xl border-2 border-dashed border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10 active:scale-95 transition-all flex flex-col items-center justify-center text-center cursor-pointer mt-2 select-none"
        >
          <Touchpad className="text-violet-500/75 mb-1" size={22} />
          <span className="text-xs font-extrabold text-violet-600 dark:text-violet-400 tracking-wider uppercase">
            {dict.mobileTapArea}
          </span>
        </div>

        {/* Direct transition button */}
        <div className="border-t border-zinc-100 dark:border-zinc-900 pt-4 flex justify-between items-center">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {language === 'ru' ? 'Вам необязательно размечать все строки сразу.' : 'You do not have to sync all lines at once.'}
          </span>
          <button
            onClick={() => setStep('edit')}
            className={`px-4 py-2 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors ${
              theme === 'dark'
                ? 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                : 'bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200'
            }`}
          >
            {dict.goToEdit}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
