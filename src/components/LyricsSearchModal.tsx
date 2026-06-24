import React, { useState, useEffect } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { searchAllLyrics, LyricsProviderResult } from '../services/lyricsProvider';
import { parseLRC } from '../utils/lrc';
import { localization } from '../utils/localization';
import { X, Search, RefreshCw, AlertCircle, FileText, Music } from 'lucide-react';

interface LyricsSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LyricsSearchModal: React.FC<LyricsSearchModalProps> = ({ isOpen, onClose }) => {
  const {
    trackMetadata,
    audioFileName,
    language,
    setLines,
    setRawText,
    setStep
  } = useKaraokeStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LyricsProviderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dict = localization[language];

  // Автозаполнение запроса при открытии модального окна
  useEffect(() => {
    if (isOpen) {
      if (trackMetadata && (trackMetadata.artist || trackMetadata.title)) {
        setQuery(
          trackMetadata.artist
            ? `${trackMetadata.artist} - ${trackMetadata.title}`
            : trackMetadata.title || ''
        );
      } else if (audioFileName) {
        const cleanName = audioFileName.replace(/\.[^/.]+$/, '');
        setQuery(cleanName);
      } else {
        setQuery('');
      }
      setResults([]);
      setError(null);
    }
  }, [isOpen, trackMetadata, audioFileName]);

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const data = await searchAllLyrics(query.trim());
      setResults(data);
      if (data.length === 0) {
        setError(dict.searchNoResults);
      }
    } catch (err: any) {
      setError(dict.searchError);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTrack = (track: LyricsProviderResult) => {
    // Импортируем тайминги
    if (track.syncedLyrics) {
      const parsed = parseLRC(track.syncedLyrics);
      setLines(parsed);
      setRawText(track.syncedLyrics);
      alert(dict.searchImportSuccess);
      onClose();
    } else if (track.plainLyrics) {
      const parsed = parseLRC(track.plainLyrics);
      setLines(parsed);
      setRawText(track.plainLyrics);
      
      const confirmSync = window.confirm(dict.searchImportNoSync);
      if (confirmSync) {
        setStep('timing'); // переводим пользователя на шаг синхронизации
      }
      onClose();
    } else {
      alert(language === 'ru' ? 'Выбранный трек не содержит текста' : 'The selected track has no lyrics');
    }
  };

  const formatDuration = (sec: number | null) => {
    if (sec === null || sec === undefined) return '--:--';
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div 
        className="bg-zinc-950/95 border border-zinc-800/80 rounded-2xl w-full max-w-2xl p-6 shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800/60 mb-5">
          <div className="flex items-center gap-2">
            <Music className="text-violet-500" size={20} />
            <h3 className="font-bold text-lg text-zinc-100">{dict.searchModalTitle}</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="flex gap-2.5 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dict.searchQueryPlaceholder}
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all placeholder-zinc-500"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-violet-600/10 cursor-pointer"
          >
            {loading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
            <span>{dict.searchBtn}</span>
          </button>
        </form>

        {/* Search Hint */}
        <div className="text-[11px] text-zinc-400/70 mb-4 flex items-center gap-1.5 px-1 leading-normal">
          <span className="text-violet-400">💡</span>
          <span>
            {language === 'ru' 
              ? 'Совет: вводите имя исполнителя и название песни вместе (например, "дора loverboy" или "feduk хлопья"), чтобы поиск работал мгновенно.'
              : 'Tip: enter both artist and song name (e.g. "dora loverboy" or "feduk flakes") to get instant results.'}
          </span>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto min-h-[250px] max-h-[450px] border border-zinc-800/50 rounded-xl bg-zinc-900/10 p-1">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center gap-3 py-16">
              <RefreshCw className="animate-spin text-violet-500 h-8 w-8" />
              <span className="text-sm text-zinc-400 font-medium">{dict.searching}</span>
            </div>
          )}

          {error && !loading && (
            <div className="h-full flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
              <AlertCircle className="text-zinc-500 h-8 w-8" />
              <span className="text-sm text-zinc-400 font-medium">{error}</span>
            </div>
          )}

          {!loading && !error && results.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center py-16 text-zinc-500 gap-2">
              <FileText size={32} className="stroke-[1.5]" />
              <span className="text-xs">{language === 'ru' ? 'Введите поисковый запрос выше' : 'Enter a search query above'}</span>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="divide-y divide-zinc-800/40">
              {results.map((track) => (
                <div
                  key={track.id}
                  onClick={() => handleSelectTrack(track)}
                  className="p-3.5 hover:bg-zinc-800/35 active:bg-zinc-800/60 rounded-lg transition-colors cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-zinc-200 truncate">{track.trackName}</span>
                      {track.syncedLyrics ? (
                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 uppercase tracking-wide">
                          {dict.searchSyncedBadge}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/20 uppercase tracking-wide">
                          Plain
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1 truncate">
                      <span className="font-medium">{track.artistName}</span>
                      {track.albumName && (
                        <>
                          <span className="text-zinc-600">•</span>
                          <span className="truncate italic">{track.albumName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono tabular-nums shrink-0">
                    {formatDuration(track.duration)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
