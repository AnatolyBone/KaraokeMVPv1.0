import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Copy, Disc3, Heart, Loader2, Music, PencilLine, Play, Share2 } from 'lucide-react';
import { audioRef } from '../audioRef';
import { KaraokePreview } from '../features/preview/KaraokePreview';
import { useKaraokeStore } from '../store/useKaraokeStore';
import {
  fetchPublishedKaraokeById,
  getPublishedKaraokeCoverUrl,
  loadPublishedKaraokeIntoPlayer,
  PublishedKaraokeTrack,
  trackPublishedKaraokeOpen,
} from '../utils/publishedKaraoke';

interface PublicKaraokePageProps {
  karaokeId: string;
  onBackToApp: () => void;
}

export const PublicKaraokePage: React.FC<PublicKaraokePageProps> = ({ karaokeId, onBackToApp }) => {
  const { theme, language, audioUrl, setAppMode } = useKaraokeStore();
  const [track, setTrack] = useState<PublishedKaraokeTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const labels = useMemo(() => ({
    loading: language === 'ru' ? 'Загружаем караоке...' : 'Loading karaoke...',
    notFound: language === 'ru' ? 'Публикация не найдена' : 'Karaoke not found',
    back: language === 'ru' ? 'В каталог' : 'Catalog',
    openEditor: language === 'ru' ? 'Открыть в редакторе' : 'Open in editor',
    share: language === 'ru' ? 'Поделиться' : 'Share',
    copied: language === 'ru' ? 'Ссылка скопирована' : 'Link copied',
    publishedBy: language === 'ru' ? 'Опубликовал' : 'Published by',
    ready: language === 'ru' ? 'Готовое караоке' : 'Ready karaoke',
    lyrics: language === 'ru' ? 'Текст и тайминги' : 'Lyrics and timings',
  }), [language]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const data = await fetchPublishedKaraokeById(karaokeId);
      if (cancelled) return;

      setTrack(data);
      if (data) {
        await loadPublishedKaraokeIntoPlayer(data);
        trackPublishedKaraokeOpen(data);
        setTrack((current) => current ? { ...current, plays_count: (current.plays_count || 0) + 1 } : current);
      }
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [karaokeId]);

  useEffect(() => {
    if (!track) return;
    document.title = `${track.songs.artist} - ${track.songs.title} | Karaoke LRC Maker`;
    return () => {
      document.title = 'Karaoke LRC Maker';
    };
  }, [track]);

  const coverUrl = track ? getPublishedKaraokeCoverUrl(track) : null;
  const shareUrl = `${window.location.origin}/karaoke/${karaokeId}`;
  const timedLinesCount = track?.lines?.filter((line: any) => line.time !== null).length || 0;

  const handleShare = async () => {
    try {
      if (navigator.share && track) {
        await navigator.share({
          title: `${track.songs.artist} - ${track.songs.title}`,
          text: language === 'ru' ? 'Готовое караоке в Karaoke LRC Maker' : 'Ready karaoke in Karaoke LRC Maker',
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch (err) {
        console.warn('Share failed:', err);
      }
    }
  };

  const handleOpenEditor = () => {
    setAppMode('editor');
    useKaraokeStore.setState({ step: 'timing', subMode: 'sync' });
    onBackToApp();
  };

  return (
    <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBackToApp}
          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all hover:scale-[1.02] ${
            theme === 'dark'
              ? 'border-white/10 bg-zinc-950/45 text-zinc-200 hover:bg-zinc-950'
              : 'border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white'
          }`}
        >
          <ChevronLeft size={14} />
          {labels.back}
        </button>

        {track && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3.5 py-2 text-xs font-extrabold text-violet-500 transition-all hover:bg-violet-500/15"
            >
              {copied ? <Copy size={14} /> : <Share2 size={14} />}
              {copied ? labels.copied : labels.share}
            </button>
            <button
              onClick={handleOpenEditor}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-lg shadow-violet-600/15 transition-all hover:bg-violet-700"
            >
              <PencilLine size={14} />
              {labels.openEditor}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-3xl border border-white/10 bg-white/50 text-zinc-500 shadow-xl shadow-violet-500/5 backdrop-blur-xl dark:bg-zinc-950/35">
          <Loader2 className="animate-spin text-violet-500" size={30} />
          <span className="text-xs font-bold">{labels.loading}</span>
        </div>
      ) : !track ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-zinc-300 bg-white/50 text-zinc-500 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/35">
          <Disc3 size={40} className="text-zinc-400" />
          <span className="text-sm font-extrabold">{labels.notFound}</span>
        </div>
      ) : (
        <>
          <section className={`overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-xl ${
            theme === 'dark'
              ? 'border-white/10 bg-zinc-950/45 shadow-black/25'
              : 'border-white/80 bg-white/64 shadow-violet-500/10'
          }`}>
            <div className="grid gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="relative min-h-[320px] overflow-hidden bg-zinc-950">
                {coverUrl ? (
                  <>
                    <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-65" />
                    <img src={coverUrl} alt={`${track.songs.title} cover`} className="relative z-10 h-full min-h-[320px] w-full object-cover" />
                  </>
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center bg-gradient-to-br from-violet-950 via-zinc-950 to-fuchsia-950">
                    <Music size={76} className="text-white/22" />
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-between gap-8 p-6 sm:p-8">
                <div>
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-emerald-500">
                    <Play size={12} className="fill-current" />
                    {labels.ready}
                  </div>
                  <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
                    {track.songs.title}
                  </h1>
                  <p className="mt-2 text-lg font-bold text-zinc-500 dark:text-zinc-400">
                    {track.songs.artist}
                  </p>
                  {track.songs.album && (
                    <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">{track.songs.album}</p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-200/60 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-[10px] font-extrabold uppercase text-zinc-400">{labels.lyrics}</p>
                    <p className="mt-1 text-lg font-black">{timedLinesCount}/{track.lines?.length || 0}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/60 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-[10px] font-extrabold uppercase text-zinc-400">Likes</p>
                    <p className="mt-1 flex items-center gap-1.5 text-lg font-black">
                      <Heart size={16} className="fill-pink-500/20 text-pink-500" />
                      {track.likes_count || 0}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/60 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5">
                    <p className="text-[10px] font-extrabold uppercase text-zinc-400">{labels.publishedBy}</p>
                    <p className="mt-1 truncate text-sm font-black">{track.profiles?.username || 'Karaoke user'}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {audioUrl && (
            <audio
              ref={(el) => {
                audioRef.current = el;
              }}
              src={audioUrl}
              preload="metadata"
              className="hidden"
            />
          )}

          <KaraokePreview />
        </>
      )}
    </main>
  );
};
