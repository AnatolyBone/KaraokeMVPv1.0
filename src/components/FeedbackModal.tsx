import React, { useMemo, useState } from 'react';
import { X, Send, Bug, Lightbulb, MessageSquare, CheckCircle2, AlertCircle, ImagePlus } from 'lucide-react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FeedbackType = 'bug' | 'idea' | 'other';

interface FeedbackScreenshot {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_WIDTH = 1280;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const compressScreenshot = async (file: File): Promise<FeedbackScreenshot> => {
  const sourceUrl = await readFileAsDataUrl(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / image.width);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Canvas context is not available'));
        return;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(image, 0, 0, width, height);

      resolve({
        name: file.name,
        type: 'image/jpeg',
        size: file.size,
        dataUrl: canvas.toDataURL('image/jpeg', 0.78),
      });
    };
    image.onerror = () => reject(new Error('Could not read image'));
    image.src = sourceUrl;
  });
};

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const {
    language,
    theme,
    appMode,
    step,
    subMode,
    user,
    userProfile,
    audioFileName,
    lines,
    timingMode,
    videoStyle,
  } = useKaraokeStore();

  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [screenshots, setScreenshots] = useState<FeedbackScreenshot[]>([]);
  const [includeTechData, setIncludeTechData] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const labels = useMemo(() => ({
    title: language === 'ru' ? 'Обратная связь' : 'Feedback',
    desc: language === 'ru'
      ? 'Опишите баг, неудобство или идею. Тех. данные помогут быстрее понять контекст.'
      : 'Describe a bug, rough edge, or idea. Technical data helps reproduce the context faster.',
    bug: language === 'ru' ? 'Баг' : 'Bug',
    idea: language === 'ru' ? 'Идея' : 'Idea',
    other: language === 'ru' ? 'Другое' : 'Other',
    message: language === 'ru' ? 'Что случилось или что улучшить?' : 'What happened or what should be improved?',
    contact: language === 'ru' ? 'Telegram или email, если нужен ответ' : 'Telegram or email if you want a reply',
    screenshots: language === 'ru' ? 'Прикрепить скриншоты' : 'Attach screenshots',
    screenshotsHint: language === 'ru' ? 'До 3 изображений, они сожмутся автоматически' : 'Up to 3 images, compressed automatically',
    tech: language === 'ru' ? 'Приложить тех. данные проекта' : 'Attach project technical data',
    send: language === 'ru' ? 'Отправить' : 'Send',
    sent: language === 'ru' ? 'Спасибо! Фидбэк отправлен.' : 'Thanks! Feedback sent.',
    error: language === 'ru' ? 'Не удалось отправить. Попробуйте позже.' : 'Could not send. Please try again later.',
  }), [language]);

  if (!isOpen) return null;

  const handleScreenshotSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    const freeSlots = MAX_SCREENSHOTS - screenshots.length;

    if (files.length === 0 || freeSlots <= 0) {
      event.target.value = '';
      return;
    }

    try {
      const compressed = await Promise.all(files.slice(0, freeSlots).map(compressScreenshot));
      setScreenshots((current) => [...current, ...compressed].slice(0, MAX_SCREENSHOTS));
    } catch (err) {
      console.warn('Screenshot processing failed:', err);
      setStatus('error');
    } finally {
      event.target.value = '';
    }
  };

  const removeScreenshot = (index: number) => {
    setScreenshots((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);
    setStatus('idle');

    const timedLines = lines.filter((line) => line.time !== null).length;
    const technicalData = includeTechData ? {
      language,
      theme,
      appMode,
      step,
      subMode,
      audioFileName,
      linesCount: lines.length,
      timedLines,
      timingMode,
      videoStyle,
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    } : null;

    try {
      const { error } = await supabase
        .from('feedback')
        .insert({
          type,
          message: message.trim(),
          contact: contact.trim() || null,
          screenshots,
          technical_data: technicalData,
          user_id: user?.id || null,
          telegram_id: userProfile?.telegram_id || null,
          status: 'new',
        });

      if (error) throw error;
      setStatus('sent');
      setMessage('');
      setContact('');
      setScreenshots([]);
      setTimeout(onClose, 900);
    } catch (err) {
      console.warn('Feedback submit failed:', err);
      setStatus('error');
    } finally {
      setSubmitting(false);
    }
  };

  const typeOptions: Array<{ value: FeedbackType; label: string; icon: React.ReactNode }> = [
    { value: 'bug', label: labels.bug, icon: <Bug size={14} /> },
    { value: 'idea', label: labels.idea, icon: <Lightbulb size={14} /> },
    { value: 'other', label: labels.other, icon: <MessageSquare size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className={`relative w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${
          theme === 'dark'
            ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
            : 'bg-white border-zinc-200 text-zinc-900'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-extrabold">{labels.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{labels.desc}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-200 p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {typeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                type === option.value
                  ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-300'
                  : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={labels.message}
          rows={6}
          className={`mt-4 w-full resize-none rounded-xl border p-3 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${
            theme === 'dark'
              ? 'bg-zinc-900 border-zinc-800 text-zinc-100 placeholder-zinc-600'
              : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400'
          }`}
        />

        <input
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder={labels.contact}
          className={`mt-3 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${
            theme === 'dark'
              ? 'bg-zinc-900 border-zinc-800 text-zinc-100 placeholder-zinc-600'
              : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400'
          }`}
        />

        <div className="mt-3 rounded-xl border border-dashed border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{labels.screenshots}</p>
              <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-500">{labels.screenshotsHint}</p>
            </div>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
              screenshots.length >= MAX_SCREENSHOTS
                ? 'pointer-events-none opacity-50'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
            } ${
              theme === 'dark'
                ? 'border-zinc-800 text-violet-300'
                : 'border-zinc-200 text-violet-600'
            }`}>
              <ImagePlus size={14} />
              {screenshots.length}/{MAX_SCREENSHOTS}
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleScreenshotSelect}
                className="hidden"
              />
            </label>
          </div>

          {screenshots.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {screenshots.map((screenshot, index) => (
                <div key={`${screenshot.name}-${index}`} className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <img
                    src={screenshot.dataUrl}
                    alt={screenshot.name}
                    className="h-20 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(index)}
                    className="absolute right-1 top-1 rounded-lg bg-black/65 p-1 text-white opacity-90 transition-opacity group-hover:opacity-100"
                    aria-label={language === 'ru' ? 'Удалить скриншот' : 'Remove screenshot'}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={includeTechData}
            onChange={(event) => setIncludeTechData(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-violet-600"
          />
          {labels.tech}
        </label>

        {status !== 'idle' && (
          <div className={`mt-3 flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
            status === 'sent'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
          }`}>
            {status === 'sent' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {status === 'sent' ? labels.sent : labels.error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-violet-600/15 transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} />
          {submitting ? (language === 'ru' ? 'Отправляем...' : 'Sending...') : labels.send}
        </button>
      </form>
    </div>
  );
};
