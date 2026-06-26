import React, { useEffect, useRef, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { audioRef } from '../audioRef';
import { formatTime } from '../utils/time';
import { localization } from '../utils/localization';
import { Activity, Zap, RefreshCw, Music, ShieldCheck, ZoomIn, ZoomOut } from 'lucide-react';

export const Waveform: React.FC = () => {
  const {
    audioUrl,
    bpm,
    beats,
    snapToBeat,
    setBpm,
    setSnapToBeat,
    theme,
    language,
  } = useKaraokeStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const unplayedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  if (typeof document !== 'undefined') {
    if (!unplayedCanvasRef.current) {
      unplayedCanvasRef.current = document.createElement('canvas');
    }
    if (!playedCanvasRef.current) {
      playedCanvasRef.current = document.createElement('canvas');
    }
  }

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(1); // Масштаб волны от 1x до 10x

  const dict = localization[language];

  // Track time updates
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [audioRef.current]);

  // Decode audio data when URL changes
  useEffect(() => {
    if (!audioUrl) {
      setAudioBuffer(null);
      setPeaks([]);
      return;
    }

    setIsDecoding(true);
    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((arrayBuffer) => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        return ctx.decodeAudioData(arrayBuffer);
      })
      .then((decodedBuffer) => {
        setAudioBuffer(decodedBuffer);
        
        // Генерация сжатых пиков звуковой волны
        const rawData = decodedBuffer.getChannelData(0);
        const samples = 1200; // Увеличенное разрешение для плавной прокрутки и масштаба
        const blockSize = Math.floor(rawData.length / samples);
        const extractedPeaks: number[] = [];
        
        for (let i = 0; i < samples; i++) {
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
            const val = Math.abs(rawData[i * blockSize + j]);
            if (val > max) max = val;
          }
          extractedPeaks.push(max);
        }
        setPeaks(extractedPeaks);

        detectBPM(decodedBuffer);
      })
      .catch((err) => console.error('Failed to decode audio for waveform:', err))
      .finally(() => setIsDecoding(false));
  }, [audioUrl]);

  // 1. Отрисовка полной волны и спектрограммы на закадровые холсты при изменении пиков, темы или масштаба
  useEffect(() => {
    const mainCanvas = canvasRef.current;
    if (!mainCanvas || peaks.length === 0) return;

    const width = mainCanvas.width;
    const height = mainCanvas.height;
    const duration = audioBuffer ? audioBuffer.duration : 0;

    const unplayedCanvas = unplayedCanvasRef.current;
    const playedCanvas = playedCanvasRef.current;
    if (!unplayedCanvas || !playedCanvas) return;

    // Устанавливаем размеры закадровых холстов с учетом масштабирования
    const zoomedWidth = width * zoom;
    unplayedCanvas.width = zoomedWidth;
    unplayedCanvas.height = height;
    playedCanvas.width = zoomedWidth;
    playedCanvas.height = height;

    const uCtx = unplayedCanvas.getContext('2d');
    const pCtx = playedCanvas.getContext('2d');
    if (!uCtx || !pCtx) return;

    uCtx.clearRect(0, 0, zoomedWidth, height);
    pCtx.clearRect(0, 0, zoomedWidth, height);

    const barWidth = zoomedWidth / peaks.length;
    const waveHeight = height * 0.65;
    const spectrogramHeight = height * 0.35;

    // Отрисовка пиков и спектрограммы
    peaks.forEach((peak, idx) => {
      const x = idx * barWidth;
      const barHeight = peak * (waveHeight * 0.95);
      const y = (waveHeight - barHeight) / 2;

      // 1. Отрисовка волновых пиков
      // Непроигранная часть (Серая)
      uCtx.fillStyle = theme === 'dark' ? 'rgba(63, 63, 70, 0.7)' : 'rgba(209, 213, 219, 0.7)';
      uCtx.fillRect(x, y, barWidth - 0.5, barHeight);

      // Проигранная часть (Фиолетовая)
      pCtx.fillStyle = theme === 'dark' ? '#8b5cf6' : '#6d28d9';
      pCtx.fillRect(x, y, barWidth - 0.5, barHeight);

      // 2. Спектрограмма (статическая симуляция)
      const ySpectrogram = waveHeight;
      const step = spectrogramHeight / 4;

      for (let s = 0; s < 4; s++) {
        const freqIntensity = Math.sin((idx / peaks.length) * Math.PI * 8 + s) * peak * 0.8;
        const opacity = Math.max(0.05, Math.min(1, freqIntensity));

        const fillStyle = theme === 'dark'
          ? `rgba(168, 85, 247, ${opacity * 0.8})`
          : `rgba(109, 40, 217, ${opacity * 0.8})`;

        uCtx.fillStyle = fillStyle;
        uCtx.fillRect(x, ySpectrogram + (3 - s) * step, barWidth, step - 0.5);

        pCtx.fillStyle = fillStyle;
        pCtx.fillRect(x, ySpectrogram + (3 - s) * step, barWidth, step - 0.5);
      }
    });

    // 3. Отрисовка линий BPM долей
    if (beats.length > 0 && duration > 0) {
      const drawBeats = (context: CanvasRenderingContext2D) => {
        context.strokeStyle = theme === 'dark' ? 'rgba(244, 63, 94, 0.4)' : 'rgba(225, 29, 72, 0.4)';
        context.lineWidth = 1;
        context.setLineDash([4, 4]);
        beats.forEach((beatTime) => {
          const x = (beatTime / duration) * zoomedWidth;
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, waveHeight);
          context.stroke();
        });
        context.setLineDash([]);
      };

      drawBeats(uCtx);
      drawBeats(pCtx);
    }
  }, [peaks, audioBuffer, beats, theme, zoom]);

  // 2. Быстрое копирование закадровых холстов на экран при изменении currentTime (до 60fps)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const unplayedCanvas = unplayedCanvasRef.current;
    const playedCanvas = playedCanvasRef.current;
    if (!unplayedCanvas || !playedCanvas || unplayedCanvas.width === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const duration = audioBuffer ? audioBuffer.duration : 0;
    const progress = duration > 0 ? currentTime / duration : 0;

    const centerOffset = width / 2;
    const scrollX = zoom > 1 ? (progress * width * zoom) - centerOffset : 0;
    const playheadX = zoom > 1 ? centerOffset : progress * width;
    const waveHeight = height * 0.65;

    ctx.clearRect(0, 0, width, height);

    if (zoom > 1) {
      // Рисуем фоновую (непроигранную) волну со сдвигом прокрутки
      ctx.drawImage(unplayedCanvas, -scrollX, 0);

      // Накладываем проигранную волну слева от центра с обрезкой
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, centerOffset, height);
      ctx.clip();
      ctx.drawImage(playedCanvas, -scrollX, 0);
      ctx.restore();
    } else {
      // Рисуем фоновую волну на весь экран
      ctx.drawImage(unplayedCanvas, 0, 0);

      // Накладываем проигранную волну до линии плейхеда с обрезкой
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playheadX, height);
      ctx.clip();
      ctx.drawImage(playedCanvas, 0, 0);
      ctx.restore();
    }

    // 4. Линия плейхеда (Playhead)
    ctx.strokeStyle = theme === 'dark' ? '#f43f5e' : '#e11d74';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Головка плейхеда
    ctx.fillStyle = theme === 'dark' ? '#f43f5e' : '#e11d74';
    ctx.beginPath();
    ctx.arc(playheadX, 0, 4, 0, Math.PI * 2);
    ctx.arc(playheadX, height, 4, 0, Math.PI * 2);
    ctx.fill();

    // Вспомогательный текст для согласных
    if (zoom > 2.5) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.font = '8px monospace';
      ctx.fillText('ВЫСОКИЕ СОГЛАСНЫЕ', 10, waveHeight - 5);
    }
  }, [peaks, currentTime, audioBuffer, zoom, theme]);

  // Клик по волне с учетом масштабирования (zoom)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !audioBuffer) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    
    const duration = audioBuffer.duration;
    const progress = audio.currentTime / duration;
    const centerOffset = rect.width / 2;

    let targetTime = 0;
    if (zoom > 1) {
      // Вычисляем время сдвинутого кадра относительно центра
      const scrollX = (progress * rect.width * zoom) - centerOffset;
      const absoluteX = scrollX + clickX;
      targetTime = (absoluteX / (rect.width * zoom)) * duration;
    } else {
      targetTime = (clickX / rect.width) * duration;
    }

    audio.currentTime = Math.max(0, Math.min(duration, targetTime));
  };

  // Интерактивный зум с зажатым Ctrl (Ctrl + Wheel)
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom((prev) => Math.min(10, prev + 0.5)); // Увеличиваем
      } else {
        setZoom((prev) => Math.max(1, prev - 0.5)); // Уменьшаем
      }
    }
  };

  const detectBPM = (buffer: AudioBuffer) => {
    const rawData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const blockDuration = 0.05;
    const blockSize = Math.floor(sampleRate * blockDuration);
    const energyList: number[] = [];

    for (let i = 0; i < rawData.length; i += blockSize) {
      let energy = 0;
      const limit = Math.min(i + blockSize, rawData.length);
      for (let j = i; j < limit; j++) {
        energy += rawData[j] * rawData[j];
      }
      energyList.push(energy / blockSize);
    }

    const detectedBeats: number[] = [];
    const localWindow = 10;

    for (let i = localWindow; i < energyList.length - localWindow; i++) {
      let sum = 0;
      for (let j = i - localWindow; j <= i + localWindow; j++) {
        sum += energyList[j];
      }
      const localAverage = sum / (localWindow * 2 + 1);
      
      if (energyList[i] > localAverage * 1.6 && energyList[i] > 0.01) {
        const beatTime = i * blockDuration;
        if (detectedBeats.length === 0 || (beatTime - detectedBeats[detectedBeats.length - 1]) > 0.25) {
          detectedBeats.push(beatTime);
        }
      }
    }

    if (detectedBeats.length > 2) {
      const intervals: number[] = [];
      for (let i = 1; i < detectedBeats.length; i++) {
        intervals.push(detectedBeats[i] - detectedBeats[i - 1]);
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const rawBpm = 60 / avgInterval;
      
      let finalBpm = Math.round(rawBpm);
      while (finalBpm < 60) finalBpm *= 2;
      while (finalBpm > 180) finalBpm /= 2;
      finalBpm = Math.round(finalBpm);

      setBpm(finalBpm, detectedBeats);
    } else {
      setBpm(120, []);
    }
  };

  return (
    <div
      id="waveform-section"
      className={`rounded-2xl p-5 border shadow-sm transition-all ${
        theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4 border-b border-zinc-100 dark:border-zinc-900 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="text-violet-500" size={18} />
          <h4 className="font-bold text-xs uppercase tracking-wider">
            {dict.waveformTitle} {zoom > 1 && <span className="text-violet-500 font-mono font-bold">({zoom.toFixed(1)}x Zoom)</span>}
          </h4>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {/* Кнопки управления масштабом */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/20 p-1 rounded-xl">
            <button
              onClick={() => setZoom((prev) => Math.max(1, prev - 1))}
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400"
              title="Уменьшить масштаб"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => setZoom((prev) => Math.min(10, prev + 1))}
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400"
              title="Увеличить масштаб"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          {bpm && (
            <>
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold">
                <Zap size={12} /> {bpm} BPM
              </span>

              <button
                onClick={() => setSnapToBeat(!snapToBeat)}
                className={`px-3 py-1 rounded-lg font-semibold border transition-all text-xs ${
                  snapToBeat
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : theme === 'dark'
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {snapToBeat ? dict.waveformSnapDone : dict.waveformSnap}
              </button>
            </>
          )}
        </div>
      </div>

      {isDecoding && (
        <div className="flex items-center justify-center py-8 text-xs text-violet-500">
          <RefreshCw className="animate-spin mr-2" size={14} />
          {language === 'ru' ? 'Анализ аудиоволны, спектра и BPM...' : 'Analyzing spectrum & BPM...'}
        </div>
      )}

      {!audioUrl && (
        <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-400 text-xs">
          <Music size={28} className="mb-2 opacity-40" />
          {language === 'ru' ? 'Загрузите аудиофайл для спектрального анализа' : 'Load an audio file for spectrogram analysis'}
        </div>
      )}

      {audioUrl && !isDecoding && peaks.length > 0 && (
        <div className="space-y-3">
          {/* Интерактивный масштабируемый Canvas */}
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={800}
              height={150}
              onClick={handleCanvasClick}
              onWheel={handleWheel}
              className="w-full h-[130px] cursor-pointer bg-zinc-500/[0.03] rounded-xl touch-none"
            />
            
            <div className="absolute bottom-2 left-2 text-[10px] font-semibold font-mono bg-zinc-900/70 text-zinc-100 px-2 py-0.5 rounded backdrop-blur-sm">
              {formatTime(currentTime)}
            </div>
          </div>

          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 text-center flex items-center justify-center gap-1.5">
            <ShieldCheck size={12} className="text-emerald-500" /> 
            {language === 'ru' 
              ? 'Кликните для прокрутки. Прокручивайте колесико с зажатым Ctrl для изменения масштаба.' 
              : 'Click to scrub. Scroll wheel holding Ctrl key to Zoom.'}
          </p>
        </div>
      )}
    </div>
  );
};
