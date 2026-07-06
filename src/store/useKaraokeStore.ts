import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppStep, LyricLine, WordTiming, VideoStyleOptions, UserProfile } from '../types';
import { splitWordIntoSyllables } from '../utils/hyphenation';
import { parseLRC } from '../utils/lrc';
import { supabase } from '../services/supabaseClient';
import { User } from '@supabase/supabase-js';
import { audioRef } from '../audioRef';

interface KaraokeState {
  step: AppStep;
  audioUrl: string | null;
  audioFileName: string | null;
  currentProjectTitle: string | null;
  rawText: string;
  lines: LyricLine[];
  currentIndex: number;
  currentWordIndex: number; // Track active word in line timing mode
  isPlaying: boolean;
  theme: 'dark' | 'light';
  timingMode: 'line' | 'word';
  
  // BPM & Beat Snapping
  bpm: number | null;
  beats: number[]; // Beat timestamps
  snapToBeat: boolean;

  // Custom Video Styles
  videoStyle: VideoStyleOptions;

  // Cover Art & Color Palette
  coverUrl: string | null;
  coverColors: {
    primary: string;
    secondary: string;
    glow: string;
  } | null;

  // Multi-language & Translation Settings
  language: 'ru' | 'en';
  
  // ID3 Metadata
  trackMetadata: {
    artist: string | null;
    title: string | null;
    album: string | null;
  } | null;
  setTrackMetadata: (metadata: { artist: string | null; title: string | null; album: string | null } | null) => void;

  // Recent Projects lists
  recentProjects: {
    id: string;
    title: string;
    rawText: string;
    lines: LyricLine[];
    audioFileName: string | null;
    coverColors: { primary: string; secondary: string; glow: string } | null;
    videoStyle?: VideoStyleOptions;
  }[];

  // Syllable Mode parameters
  syllableMode: boolean;
  currentSyllableIndex: number;

  // Undo/Redo stack
  history: LyricLine[][];
  historyIndex: number;

  // Basic Setters
  setStep: (step: AppStep) => void;
  setAudio: (url: string | null, name: string | null) => void;
  setCurrentProjectTitle: (title: string | null) => void;
  setRawText: (text: string) => void;
  setLines: (lines: LyricLine[]) => void;
  prepareLines: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentIndex: (index: number) => void;
  setTimingMode: (mode: 'line' | 'word') => void;
  setSyllableMode: (active: boolean) => void;
  setLanguage: (lang: 'ru' | 'en') => void;
  
  // BPM Methods
  setBpm: (bpm: number | null, beats?: number[]) => void;
  setSnapToBeat: (snap: boolean) => void;

  // Cover methods
  setCover: (url: string | null) => void;
  setCoverColors: (colors: { primary: string; secondary: string; glow: string } | null) => void;

  // Project switcher actions
  saveCurrentAsProject: (title: string) => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;

  // Translation actions
  updateLineTranslation: (id: string, translation: string) => void;

  // Video styling methods
  updateVideoStyle: (options: Partial<VideoStyleOptions>) => void;
  
  // Timing Methods
  timestampCurrent: (time: number) => void;
  timestampCurrentLine: (time: number) => void; // Legacy/compatibility alias
  undoLastTiming: () => void;
  resetTimings: () => void;
  shiftAllTimings: (offset: number) => void;
  
  // Edit Methods (Undoable)
  updateLineText: (id: string, text: string) => void;
  updateLineTime: (id: string, time: number | null) => void;
  shiftLineTime: (id: string, offset: number) => void;
  deleteLine: (id: string) => void;
  removeLineTiming: (id: string) => void;
  
  // Advanced edit actions (Undoable)
  splitLine: (id: string, wordIndex: number) => void;
  mergeLines: (id: string) => void;
  reorderLines: (sourceIndex: number, targetIndex: number) => void;
  updateWordTime: (lineId: string, wordId: string, time: number | null) => void;

  // History management
  pushHistory: (newLines: LyricLine[]) => void;
  undo: () => void;
  redo: () => void;

  currentProjectId: string | null;
  user: User | null;
  userProfile: UserProfile | null;
  syncing: boolean;
  setUser: (user: User | null) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  fetchUserProfile: (userId: string) => Promise<void>;
  setSyncing: (syncing: boolean) => void;
  syncProjects: () => Promise<void>;
  publishKaraokeTrack: (params: {
    artist: string;
    title: string;
    album?: string;
    lines: LyricLine[];
    videoStyle: VideoStyleOptions;
    audioFile?: File;
    coverFile?: File;
  }) => Promise<{ success: boolean; error?: string }>;
  cacheLrcLibTrack: (track: any) => Promise<void>;
  donationUrl: string;
  dailyPublishLimitFree: number;
  dailyPublishLimitPro: number;
  fetchAppSettings: () => Promise<void>;

  toggleTheme: () => void;
  clearAll: () => void;
  appMode: 'karaoke' | 'editor';
  setAppMode: (mode: 'karaoke' | 'editor') => void;
  subMode: 'sync' | 'tune';
  setSubMode: (subMode: 'sync' | 'tune') => void;
}

// Helper to split line text into initial WordTiming nodes
function textToWords(text: string): WordTiming[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => {
      const syllables = splitWordIntoSyllables(w).map((syl) => ({
        id: Math.random().toString(36).substring(2, 9),
        text: syl,
        time: null,
      }));

      return {
        id: Math.random().toString(36).substring(2, 9),
        text: w,
        time: null,
        syllables,
      };
    });
}

export const useKaraokeStore = create<KaraokeState>()(
  persist(
    (set, get) => ({
      step: 'input',
      audioUrl: null,
      audioFileName: null,
      currentProjectTitle: null,
      currentProjectId: null,
      rawText: '',
      lines: [],
      currentIndex: 0,
      currentWordIndex: 0,
      isPlaying: false,
      theme: 'dark',
      timingMode: 'line',
      user: null,
      userProfile: null,
      syncing: false,
      donationUrl: 'https://yoomoney.ru',
      dailyPublishLimitFree: 5,
      dailyPublishLimitPro: 100,
      
      bpm: null,
      beats: [],
      snapToBeat: false,

      coverUrl: null,
      coverColors: null,

      language: 'ru',
      trackMetadata: null,
      recentProjects: [],
      appMode: typeof window !== 'undefined' && window.innerWidth < 768 ? 'karaoke' : 'editor',
      subMode: 'sync',

      syllableMode: false,
      currentSyllableIndex: 0,

      videoStyle: {
        preset: 'apple-music',
        bgType: 'cover-blur',
        gradientPreset: 'purple-night',
        fontFamily: 'sans-serif',
        fontSize: 48,
        strokeColor: '#000000',
        strokeWidth: 0,
        glowColor: '#ffffff',
        glowSize: 0,
        activeWordColor: '#ffffff',
        inactiveWordColor: 'rgba(255,255,255,0.35)',
        
        // Cinema Engine 2.0/3.0
        aspectRatio: '16:9',
        animationStyle: 'split-screen',
        visualizerType: 'none',
        fxOverlay: 'fluid-gradient',
        customVideoUrl: null,
      },

      history: [],
      historyIndex: -1,

      setStep: (step) => set({ step }),
      setAppMode: (appMode) => set({ appMode }),
      setSubMode: (subMode) => set({ subMode }),

      setCover: (coverUrl) => set({ coverUrl }),

      setCoverColors: (coverColors) => set({ coverColors }),

      setLanguage: (language) => set({ language }),

      setTrackMetadata: (trackMetadata) => set({ trackMetadata }),

      setSyllableMode: (syllableMode) => set({ syllableMode, currentSyllableIndex: 0 }),

      setUser: (user) => {
        set({ user });
        if (user) {
          get().fetchUserProfile(user.id);
        } else {
          set({ userProfile: null });
        }
      },
      setUserProfile: (userProfile) => set({ userProfile }),
      fetchUserProfile: async (userId) => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();
          if (error) throw error;
          if (data) {
            set({ userProfile: data as UserProfile });
          }
        } catch (err) {
          console.error('Failed to fetch user profile:', err);
        }
      },
      fetchAppSettings: async () => {
        try {
          const { data, error } = await supabase
            .from('telegram_bot_settings')
            .select('*');
          if (error) throw error;
          if (data && data.length > 0) {
            const updates: any = {};
            data.forEach((setting: any) => {
              if (setting.key === 'donation_url') {
                updates.donationUrl = setting.value;
              } else if (setting.key === 'daily_publish_limit_free') {
                const parsed = parseInt(setting.value, 10);
                if (!isNaN(parsed)) updates.dailyPublishLimitFree = parsed;
              } else if (setting.key === 'daily_publish_limit_pro') {
                const parsed = parseInt(setting.value, 10);
                if (!isNaN(parsed)) updates.dailyPublishLimitPro = parsed;
              }
            });
            set(updates);
          }
        } catch (err) {
          console.error('Failed to fetch app settings:', err);
        }
      },
      setSyncing: (syncing) => set({ syncing }),

      saveCurrentAsProject: async (title) => {
        const { lines, rawText, audioFileName, coverColors, recentProjects, currentProjectId, user } = get();
        const cleanTitle = title.trim() || audioFileName?.replace(/\.[^/.]+$/, '') || 'Без названия';
        const id = currentProjectId || crypto.randomUUID();
        
        const newProject = {
          id,
          title: cleanTitle,
          rawText,
          lines,
          audioFileName,
          coverColors,
          videoStyle: get().videoStyle,
        };

        // Remove duplicate with same audioFileName if necessary
        const filtered = recentProjects.filter(p => p.audioFileName !== audioFileName);
        set({
          recentProjects: [newProject, ...filtered],
          currentProjectTitle: cleanTitle,
          currentProjectId: id
        });

        if (user) {
          try {
            const { error } = await supabase
              .from('projects')
              .upsert({
                id,
                user_id: user.id,
                title: cleanTitle,
                lines,
                video_style: get().videoStyle,
                audio_file_name: audioFileName,
                updated_at: new Date().toISOString(),
              });
            if (error) {
              console.error('Failed to sync saved project to Supabase:', error);
            }
          } catch (err) {
            console.error('Error syncing project to Supabase:', err);
          }
        }
      },

      loadProject: (id) => {
        const { recentProjects } = get();
        const project = recentProjects.find(p => p.id === id);
        if (project) {
          set({
            currentProjectId: project.id,
            rawText: project.rawText,
            lines: project.lines,
            audioFileName: project.audioFileName,
            currentProjectTitle: project.title,
            coverColors: project.coverColors,
            step: 'edit',
            currentIndex: project.lines.filter(l => l.time !== null).length,
            currentWordIndex: 0,
            history: [project.lines],
            historyIndex: 0,
            ...(project.videoStyle ? { videoStyle: project.videoStyle } : {})
          });
        }
      },

      deleteProject: async (id) => {
        const { recentProjects, currentProjectId, user } = get();
        set({
          recentProjects: recentProjects.filter(p => p.id !== id),
          ...(currentProjectId === id ? { currentProjectId: null } : {})
        });

        if (user) {
          try {
            const { error } = await supabase
              .from('projects')
              .delete()
              .eq('id', id)
              .eq('user_id', user.id);
            if (error) {
              console.error('Failed to delete project from Supabase:', error);
            }
          } catch (err) {
            console.error('Error deleting project from Supabase:', err);
          }
        }
      },

      updateLineTranslation: (id, translation) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => 
          line.id === id ? { ...line, translation } : line
        );
        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },

      updateVideoStyle: (options) => set((state) => {
        const updated = { ...state.videoStyle, ...options };
        
        // Если изменился пресет, накладываем кураторские настройки
        if (options.preset) {
          switch (options.preset) {
            case 'apple-music':
              Object.assign(updated, {
                bgType: 'cover-blur',
                animationStyle: 'split-screen',
                fxOverlay: 'fluid-gradient',
                glowSize: 0,
                visualizerType: 'none',
                activeWordColor: '#ffffff',
                inactiveWordColor: 'rgba(255,255,255,0.35)',
              });
              break;
            case 'spotify':
              Object.assign(updated, {
                bgType: 'cover-blur',
                animationStyle: 'apple-music',
                fxOverlay: 'fluid-gradient',
                glowSize: 0,
                visualizerType: 'none',
                activeWordColor: '#1db954',
                inactiveWordColor: 'rgba(255,255,255,0.3)',
              });
              break;
            case 'tiktok-neon':
              Object.assign(updated, {
                bgType: 'gradient',
                gradientPreset: 'purple-night',
                animationStyle: 'kinetic',
                fxOverlay: 'lens-dust',
                glowSize: 15,
                glowColor: '#ff007f',
                visualizerType: 'bars',
                activeWordColor: '#00f0ff',
                inactiveWordColor: 'rgba(255,255,255,0.4)',
              });
              break;
            case 'classic-karaoke':
              Object.assign(updated, {
                bgType: 'gradient',
                gradientPreset: 'ocean',
                animationStyle: 'classic-karaoke',
                fxOverlay: 'snow',
                glowSize: 4,
                visualizerType: 'none',
                activeWordColor: '#ffff00',
                inactiveWordColor: '#ffffff',
              });
              break;
            case 'minimal-cinema':
              Object.assign(updated, {
                bgType: 'split-dark',
                animationStyle: 'split-screen',
                fxOverlay: 'lens-dust',
                glowSize: 0,
                visualizerType: 'none',
                activeWordColor: '#ffffff',
                inactiveWordColor: 'rgba(255,255,255,0.2)',
              });
              break;
          }
        }
        
        return { videoStyle: updated };
      }),
      
      setAudio: (audioUrl, audioFileName) => {
        const titleFromAudio = audioFileName ? audioFileName.replace(/\.[^/.]+$/, '') : null;
        const previousAudioFileName = get().audioFileName;
        const isDifferentTrack = Boolean(audioFileName && previousAudioFileName && audioFileName !== previousAudioFileName);
        set({
          audioUrl,
          audioFileName,
          ...(isDifferentTrack ? { currentProjectId: null } : {}),
          currentProjectTitle: isDifferentTrack ? titleFromAudio : get().currentProjectTitle || titleFromAudio,
          ...(audioUrl === null ? { trackMetadata: null } : {})
        });
      },

      setCurrentProjectTitle: (currentProjectTitle) => set({ currentProjectTitle }),
      
      setRawText: (rawText) => {
        if (!rawText.trim()) {
          set({ rawText, lines: [], currentIndex: 0, currentWordIndex: 0 });
        } else {
          set({ rawText });
        }
      },
      
      setLines: (lines) => {
        const updatedLines = lines.map(l => ({
          ...l,
          words: l.words || textToWords(l.text)
        }));
        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      prepareLines: () => {
        const { rawText } = get();
        
        // Проверяем, содержит ли текст тайминги LRC
        const hasLrcTags = /\[\d+:\d+\.\d+\]|\[[a-zA-Z]+:/m.test(rawText);
        
        let processedLines: LyricLine[];

        if (hasLrcTags) {
          // Если это LRC текст, используем парсер
          const parsed = parseLRC(rawText);
          if (parsed && parsed.length > 0) {
            processedLines = parsed;
          } else {
            // Фолбэк если парсинг вернул пустой массив
            processedLines = [];
          }
        } else {
          // Обычный сырой текст
          processedLines = rawText
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => {
              if (!line) return false;
              const isHeader = /^(куплет|припев|интро|аутро|бридж|соло|intro|outro|bridge|chorus|verse|solo|instrumental|инструментал)/i.test(line)
                || (line.startsWith('[') && line.endsWith(']'))
                || (line.startsWith('(') && line.endsWith(')'));
              return !isHeader;
            })
            .map((lineText) => ({
              id: Math.random().toString(36).substring(2, 9),
              text: lineText,
              time: null,
              words: textToWords(lineText),
            }));
        }

        if (processedLines.length > 0) {
          set({
            currentProjectId: null,
            lines: processedLines,
            currentIndex: 0,
            currentWordIndex: 0,
            step: 'timing',
            history: [processedLines],
            historyIndex: 0,
          });
        }
      },
      
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      
      setCurrentIndex: (currentIndex) => set({ currentIndex, currentWordIndex: 0 }),
      
      setTimingMode: (timingMode) => set({ timingMode, currentWordIndex: 0 }),

      setBpm: (bpm, beats = []) => set({ bpm, beats }),

      setSnapToBeat: (snapToBeat) => set({ snapToBeat }),

      // History push helper
      pushHistory: (newLines) => {
        const { history, historyIndex } = get();
        const nextHistory = history.slice(0, historyIndex + 1);
        set({
          history: [...nextHistory, newLines],
          historyIndex: nextHistory.length,
        });
      },

      undo: () => {
        const { history, historyIndex } = get();
        if (historyIndex <= 0) return;
        const prevIndex = historyIndex - 1;
        set({
          lines: history[prevIndex],
          historyIndex: prevIndex,
        });
      },

      redo: () => {
        const { history, historyIndex } = get();
        if (historyIndex >= history.length - 1) return;
        const nextIndex = historyIndex + 1;
        set({
          lines: history[nextIndex],
          historyIndex: nextIndex,
        });
      },

      timestampCurrent: (time) => {
        const { lines, currentIndex, currentWordIndex, currentSyllableIndex, timingMode, syllableMode, snapToBeat, beats } = get();
        if (currentIndex >= lines.length) return;

        let timestamp = time;
        // Snap to nearest beat if snap mode is active and beats are available
        if (snapToBeat && beats.length > 0) {
          const nearestBeat = beats.reduce((prev, curr) => 
            Math.abs(curr - time) < Math.abs(prev - time) ? curr : prev
          );
          if (Math.abs(nearestBeat - time) < 0.25) {
            timestamp = nearestBeat;
          }
        }

        const finalTime = Number(timestamp.toFixed(2));
        const updatedLines = [...lines];
        const currentLine = { ...updatedLines[currentIndex] };

        if (timingMode === 'line') {
          // Complete line sync
          currentLine.time = finalTime;
          currentLine.words = currentLine.words.map((w, idx) => ({
            ...w,
            time: idx === 0 ? finalTime : null,
            syllables: w.syllables ? w.syllables.map((s, sIdx) => ({
              ...s,
              time: idx === 0 && sIdx === 0 ? finalTime : null,
            })) : undefined
          }));
          updatedLines[currentIndex] = currentLine;

          set({
            lines: updatedLines,
            currentIndex: Math.min(currentIndex + 1, lines.length),
            currentWordIndex: 0,
            currentSyllableIndex: 0,
          });
          get().pushHistory(updatedLines);
        } else if (syllableMode) {
          // Syllable Mode Sync (Tap-to-Syllable)
          const updatedWords = [...currentLine.words];
          const activeWord = { ...updatedWords[currentWordIndex] };
          
          if (activeWord.syllables && activeWord.syllables.length > 0) {
            const updatedSyllables = [...activeWord.syllables];
            if (currentSyllableIndex < updatedSyllables.length) {
              updatedSyllables[currentSyllableIndex] = {
                ...updatedSyllables[currentSyllableIndex],
                time: finalTime,
              };

              // First syllable timestamp sets word timestamp
              if (currentSyllableIndex === 0) {
                activeWord.time = finalTime;
              }

              // First word first syllable sets line timestamp
              if (currentWordIndex === 0 && currentSyllableIndex === 0) {
                currentLine.time = finalTime;
              }

              activeWord.syllables = updatedSyllables;
              updatedWords[currentWordIndex] = activeWord;
              currentLine.words = updatedWords;
              updatedLines[currentIndex] = currentLine;

              const isWordFinished = currentSyllableIndex + 1 >= updatedSyllables.length;
              const isLineFinished = isWordFinished && (currentWordIndex + 1 >= updatedWords.length);

              set({
                lines: updatedLines,
                currentIndex: isLineFinished ? Math.min(currentIndex + 1, lines.length) : currentIndex,
                currentWordIndex: isLineFinished ? 0 : (isWordFinished ? currentWordIndex + 1 : currentWordIndex),
                currentSyllableIndex: isLineFinished || isWordFinished ? 0 : currentSyllableIndex + 1,
              });
              get().pushHistory(updatedLines);
            }
          } else {
            // Fallback to word sync if no syllables
            const updatedWords = [...currentLine.words];
            if (currentWordIndex < updatedWords.length) {
              updatedWords[currentWordIndex] = {
                ...updatedWords[currentWordIndex],
                time: finalTime,
              };
              if (currentWordIndex === 0) {
                currentLine.time = finalTime;
              }
              currentLine.words = updatedWords;
              updatedLines[currentIndex] = currentLine;

              const isLineFinished = currentWordIndex + 1 >= updatedWords.length;
              set({
                lines: updatedLines,
                currentIndex: isLineFinished ? Math.min(currentIndex + 1, lines.length) : currentIndex,
                currentWordIndex: isLineFinished ? 0 : currentWordIndex + 1,
                currentSyllableIndex: 0,
              });
              get().pushHistory(updatedLines);
            }
          }
        } else {
          // Word by word sync
          const updatedWords = [...currentLine.words];
          if (currentWordIndex < updatedWords.length) {
            updatedWords[currentWordIndex] = {
              ...updatedWords[currentWordIndex],
              time: finalTime,
            };
            
            // Set line time to first word's time
            if (currentWordIndex === 0) {
              currentLine.time = finalTime;
            }
            
            currentLine.words = updatedWords;
            updatedLines[currentIndex] = currentLine;

            const isLineFinished = currentWordIndex + 1 >= updatedWords.length;
            set({
              lines: updatedLines,
              currentIndex: isLineFinished ? Math.min(currentIndex + 1, lines.length) : currentIndex,
              currentWordIndex: isLineFinished ? 0 : currentWordIndex + 1,
              currentSyllableIndex: 0,
            });
            get().pushHistory(updatedLines);
          }
        }
      },

      timestampCurrentLine: (time) => {
        get().timestampCurrent(time);
      },
      
      undoLastTiming: () => {
        const { lines, currentIndex, currentWordIndex, timingMode } = get();
        const updatedLines = [...lines];

        if (timingMode === 'line') {
          if (currentIndex === 0) return;
          const prevIndex = currentIndex - 1;
          updatedLines[prevIndex] = {
            ...updatedLines[prevIndex],
            time: null,
            words: updatedLines[prevIndex].words.map(w => ({ ...w, time: null })),
          };
          set({
            lines: updatedLines,
            currentIndex: prevIndex,
            currentWordIndex: 0,
          });
          get().pushHistory(updatedLines);
        } else {
          // Word by word timing undo
          if (currentWordIndex > 0) {
            const currentLine = { ...updatedLines[currentIndex] };
            const prevWordIdx = currentWordIndex - 1;
            currentLine.words = currentLine.words.map((w, idx) => 
              idx === prevWordIdx ? { ...w, time: null } : w
            );
            if (prevWordIdx === 0) {
              currentLine.time = null;
            }
            updatedLines[currentIndex] = currentLine;
            set({
              lines: updatedLines,
              currentWordIndex: prevWordIdx,
            });
            get().pushHistory(updatedLines);
          } else if (currentIndex > 0) {
            // Go back to previous line's last word
            const prevIndex = currentIndex - 1;
            const prevLine = { ...updatedLines[prevIndex] };
            const lastWordIdx = Math.max(0, prevLine.words.length - 1);
            
            prevLine.words = prevLine.words.map((w, idx) => 
              idx === lastWordIdx ? { ...w, time: null } : w
            );
            // Recalculate line time
            if (lastWordIdx === 0) {
              prevLine.time = null;
            }
            updatedLines[prevIndex] = prevLine;
            
            set({
              lines: updatedLines,
              currentIndex: prevIndex,
              currentWordIndex: lastWordIdx,
            });
            get().pushHistory(updatedLines);
          }
        }
      },
      
      resetTimings: () => {
        const { lines } = get();
        const updatedLines = lines.map((line) => ({
          ...line,
          time: null,
          words: line.words.map((w) => ({ ...w, time: null })),
        }));
        
        set({
          lines: updatedLines,
          currentIndex: 0,
          currentWordIndex: 0,
        });
        get().pushHistory(updatedLines);
      },
      
      shiftAllTimings: (offset) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => {
          const newWords = line.words.map((w) => {
            if (w.time === null) return w;
            return { ...w, time: Number(Math.max(0, w.time + offset).toFixed(2)) };
          });
          
          let newLineTime = line.time;
          if (line.time !== null) {
            newLineTime = Number(Math.max(0, line.time + offset).toFixed(2));
          }

          return {
            ...line,
            time: newLineTime,
            words: newWords,
          };
        });
        
        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      updateLineText: (id, text) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => {
          if (line.id !== id) return line;
          // Maintain existing words timings if word texts match or reconstruct
          const oldWords = line.words;
          const nextWords = textToWords(text);
          
          // Try to preserve some word times if possible
          const syncedWords = nextWords.map((w, idx) => {
            if (oldWords[idx] && oldWords[idx].text === w.text) {
              return { ...w, time: oldWords[idx].time };
            }
            return w;
          });

          return {
            ...line,
            text,
            words: syncedWords,
          };
        });

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      updateLineTime: (id, time) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => {
          if (line.id !== id) return line;
          const finalTime = time === null ? null : Math.max(0, time);
          const formattedTime = finalTime !== null ? Number(finalTime.toFixed(2)) : null;
          
          return {
            ...line,
            time: formattedTime,
            // Fallback sync first word timing to line time
            words: line.words.map((w, idx) => 
              idx === 0 ? { ...w, time: formattedTime } : w
            ),
          };
        });

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      shiftLineTime: (id, offset) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => {
          if (line.id !== id || line.time === null) return line;
          const newTime = Number(Math.max(0, line.time + offset).toFixed(2));
          
          return {
            ...line,
            time: newTime,
            words: line.words.map((w) => {
              if (w.time === null) return w;
              return { ...w, time: Number(Math.max(0, w.time + offset).toFixed(2)) };
            }),
          };
        });

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      deleteLine: (id) => {
        const { lines, currentIndex } = get();
        const targetIndex = lines.findIndex((line) => line.id === id);
        const updatedLines = lines.filter((line) => line.id !== id);
        
        let newCurrentIndex = currentIndex;
        if (targetIndex !== -1 && targetIndex < currentIndex) {
          newCurrentIndex = Math.max(0, currentIndex - 1);
        }
        newCurrentIndex = Math.min(newCurrentIndex, updatedLines.length);

        set({
          lines: updatedLines,
          currentIndex: newCurrentIndex,
          currentWordIndex: 0,
        });
        get().pushHistory(updatedLines);
      },
      
      removeLineTiming: (id) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => 
          line.id === id 
            ? { ...line, time: null, words: line.words.map(w => ({ ...w, time: null })) } 
            : line
        );

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },

      splitLine: (id, wordIndex) => {
        const { lines } = get();
        const lineIndex = lines.findIndex((l) => l.id === id);
        if (lineIndex === -1) return;

        const targetLine = lines[lineIndex];
        const words = targetLine.words;
        if (wordIndex <= 0 || wordIndex >= words.length) return;

        const firstPartWords = words.slice(0, wordIndex);
        const secondPartWords = words.slice(wordIndex);

        const firstPartText = firstPartWords.map((w) => w.text).join(' ');
        const secondPartText = secondPartWords.map((w) => w.text).join(' ');

        const line1: LyricLine = {
          id: Math.random().toString(36).substring(2, 9),
          text: firstPartText,
          time: targetLine.time,
          words: firstPartWords,
        };

        const line2: LyricLine = {
          id: Math.random().toString(36).substring(2, 9),
          text: secondPartText,
          time: secondPartWords[0]?.time || null,
          words: secondPartWords,
        };

        const updatedLines = [...lines];
        updatedLines.splice(lineIndex, 1, line1, line2);

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },

      mergeLines: (id) => {
        const { lines } = get();
        const lineIndex = lines.findIndex((l) => l.id === id);
        if (lineIndex === -1 || lineIndex === lines.length - 1) return;

        const currentLine = lines[lineIndex];
        const nextLine = lines[lineIndex + 1];

        const mergedWords = [...currentLine.words, ...nextLine.words];
        const mergedText = `${currentLine.text} ${nextLine.text}`;

        const mergedLine: LyricLine = {
          id: currentLine.id,
          text: mergedText,
          time: currentLine.time || nextLine.time,
          words: mergedWords,
        };

        const updatedLines = [...lines];
        updatedLines.splice(lineIndex, 2, mergedLine);

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },

      reorderLines: (sourceIndex, targetIndex) => {
        const { lines } = get();
        if (
          sourceIndex < 0 ||
          sourceIndex >= lines.length ||
          targetIndex < 0 ||
          targetIndex >= lines.length
        ) return;

        const updatedLines = [...lines];
        const [removed] = updatedLines.splice(sourceIndex, 1);
        updatedLines.splice(targetIndex, 0, removed);

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },

      updateWordTime: (lineId, wordId, time) => {
        const { lines } = get();
        const updatedLines = lines.map((line) => {
          if (line.id !== lineId) return line;
          
          const updatedWords = line.words.map((w) => 
            w.id === wordId 
              ? { ...w, time: time !== null ? Number(time.toFixed(2)) : null } 
              : w
          );

          // If first word timing changed, also update line level timing
          let nextLineTime = line.time;
          if (updatedWords[0] && updatedWords[0].id === wordId) {
            nextLineTime = time !== null ? Number(time.toFixed(2)) : null;
          }

          return {
            ...line,
            time: nextLineTime,
            words: updatedWords,
          };
        });

        set({ lines: updatedLines });
        get().pushHistory(updatedLines);
      },
      
      toggleTheme: () => {
        const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: nextTheme });
      },
      
      clearAll: () => {
        set({
          currentProjectId: null,
          step: 'input',
          audioUrl: null,
          audioFileName: null,
          currentProjectTitle: null,
          rawText: '',
          lines: [],
          currentIndex: 0,
          currentWordIndex: 0,
          isPlaying: false,
          timingMode: 'line',
          subMode: 'sync',
          bpm: null,
          beats: [],
          snapToBeat: false,
          coverUrl: null,
          coverColors: null,
          syllableMode: false,
          currentSyllableIndex: 0,
          history: [],
          historyIndex: -1,
          videoStyle: {
            preset: 'apple-music',
            bgType: 'cover-blur',
            gradientPreset: 'purple-night',
            fontFamily: 'sans-serif',
            fontSize: 48,
            strokeColor: '#000000',
            strokeWidth: 0,
            glowColor: '#ffffff',
            glowSize: 0,
            activeWordColor: '#ffffff',
            inactiveWordColor: 'rgba(255,255,255,0.35)',
            
            aspectRatio: '16:9',
            animationStyle: 'apple-music',
            visualizerType: 'none',
            fxOverlay: 'fluid-gradient',
            customVideoUrl: null,
          },
        });
      },

      syncProjects: async () => {
        const { user, recentProjects } = get();
        if (!user) return;
        set({ syncing: true });
        try {
          const { data: dbProjects, error } = await supabase
            .from('projects')
            .select('*')
            .eq('user_id', user.id);

          if (error) throw error;

          const localProjects = [...recentProjects];
          let updatedLocal = [...localProjects];
          let changed = false;

          // 1. Merge DB projects into local projects
          for (const dbProj of dbProjects || []) {
            const localMatchIdx = updatedLocal.findIndex((p: any) => p.id === dbProj.id);
            if (localMatchIdx === -1) {
              // Add project from DB to local list
              updatedLocal.push({
                id: dbProj.id,
                title: dbProj.title,
                rawText: '',
                lines: dbProj.lines as LyricLine[],
                audioFileName: dbProj.audio_file_name,
                coverColors: (dbProj.video_style as any)?.coverColors || null,
                videoStyle: dbProj.video_style as VideoStyleOptions,
              });
              changed = true;
            } else {
              // Compare and update local if DB is different
              const localProj = updatedLocal[localMatchIdx];
              if (
                JSON.stringify(localProj.lines) !== JSON.stringify(dbProj.lines) ||
                localProj.title !== dbProj.title
              ) {
                updatedLocal[localMatchIdx] = {
                  ...localProj,
                  title: dbProj.title,
                  lines: dbProj.lines as LyricLine[],
                  audioFileName: dbProj.audio_file_name,
                  videoStyle: dbProj.video_style as VideoStyleOptions,
                };
                changed = true;
              }
            }
          }

          // 2. Upload local projects not in DB
          for (const localProj of localProjects) {
            const dbMatch = dbProjects?.find((p: any) => p.id === localProj.id);
            if (!dbMatch) {
              let projId = localProj.id;
              const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projId);
              if (!isUuid) {
                projId = crypto.randomUUID();
                const idx = updatedLocal.findIndex((p: any) => p.id === localProj.id);
                if (idx !== -1) {
                  updatedLocal[idx].id = projId;
                  changed = true;
                }
              }

              const { error: insertError } = await supabase
                .from('projects')
                .insert({
                  id: projId,
                  user_id: user.id,
                  title: localProj.title,
                  lines: localProj.lines,
                  video_style: localProj.videoStyle || get().videoStyle,
                  audio_file_name: localProj.audioFileName,
                  updated_at: new Date().toISOString(),
                });

              if (insertError) {
                console.error('Failed to upload local project during sync:', insertError);
              }
            }
          }

          if (changed) {
            set({ recentProjects: updatedLocal });
          }
        } catch (err) {
          console.error('Error in syncProjects:', err);
        } finally {
          set({ syncing: false });
        }
      },

      publishKaraokeTrack: async (params) => {
        const { user } = get();
        if (!user) {
          return { success: false, error: 'Пожалуйста, авторизуйтесь перед публикацией' };
        }

        try {
          // 1. Поиск или создание песни
          let { data: song, error: songErr } = await supabase
            .from('songs')
            .select('id')
            .ilike('artist', params.artist)
            .ilike('title', params.title)
            .maybeSingle();

          if (songErr) throw songErr;

          if (!song) {
            const { data: newSong, error: insSongErr } = await supabase
              .from('songs')
              .insert({
                artist: params.artist,
                title: params.title,
                album: params.album || null,
                duration_seconds: audioRef.current?.duration || null,
                bpm: get().bpm,
                beats: get().beats,
              })
              .select('id')
              .single();

            if (insSongErr || !newSong) throw insSongErr || new Error('Не удалось создать карточку песни');
            song = newSong;
          }

          // 2. Загрузка аудио/обложки в хранилище Supabase
          let audioPath = null;
          if (params.audioFile) {
            const fileExt = params.audioFile.name.split('.').pop() || 'mp3';
            const fileName = `${crypto.randomUUID()}.${fileExt}`;
            const { data: uploadData, error: uploadErr } = await supabase.storage
              .from('published_audio')
              .upload(`${user.id}/${fileName}`, params.audioFile, {
                cacheControl: '3600',
                upsert: false
              });
            if (uploadErr) throw uploadErr;
            audioPath = uploadData.path;
          }

          let coverPath = null;
          if (params.coverFile) {
            const fileExt = params.coverFile.name.split('.').pop() || 'png';
            const fileName = `${crypto.randomUUID()}.${fileExt}`;
            const { data: uploadData, error: uploadErr } = await supabase.storage
              .from('published_covers')
              .upload(`${user.id}/${fileName}`, params.coverFile, {
                cacheControl: '3600',
                upsert: false
              });
            if (uploadErr) throw uploadErr;
            coverPath = uploadData.path;
          }

          // 3. Создание или обновление публикации
          const { data: existingPub } = await supabase
            .from('published_karaoke')
            .select('id, audio_storage_path, cover_storage_path')
            .eq('song_id', song.id)
            .eq('publisher_id', user.id)
            .maybeSingle();

          if (existingPub) {
            const { error: updErr } = await supabase
              .from('published_karaoke')
              .update({
                lines: params.lines,
                video_style: params.videoStyle,
                audio_storage_path: audioPath || existingPub.audio_storage_path,
                cover_storage_path: coverPath || existingPub.cover_storage_path,
                updated_at: new Date().toISOString()
              })
              .eq('id', existingPub.id);
            if (updErr) throw updErr;
          } else {
            const { error: insErr } = await supabase
              .from('published_karaoke')
              .insert({
                song_id: song.id,
                publisher_id: user.id,
                lines: params.lines,
                video_style: params.videoStyle,
                audio_storage_path: audioPath,
                cover_storage_path: coverPath,
              });
            if (insErr) throw insErr;
          }

          return { success: true };
        } catch (err: any) {
          console.error('Failed to publish karaoke track:', err);
          return { success: false, error: err.message || 'Ошибка публикации' };
        }
      },

      cacheLrcLibTrack: async (track) => {
        const { user } = get();
        if (!user) return; // Only cache if authenticated
        
        try {
          // 1. Проверяем, есть ли трек уже в нашей базе
          const { data: existingSong } = await supabase
            .from('songs')
            .select('id')
            .ilike('artist', track.artistName)
            .ilike('title', track.trackName)
            .maybeSingle();
            
          if (existingSong) {
            return; // Уже есть в нашей базе
          }
          
          // 2. Создаем песню в songs
          const { data: newSong, error: songErr } = await supabase
            .from('songs')
            .insert({
              artist: track.artistName,
              title: track.trackName,
              album: track.albumName || null,
              duration_seconds: track.duration || null,
              lrclib_id: typeof track.id === 'number' ? track.id : null,
            })
            .select('id')
            .single();
            
          if (songErr || !newSong) {
            console.error('Failed to create song for cache:', songErr);
            return;
          }
          
          // 3. Создаем запись в published_karaoke
          const lines = parseLRC(track.syncedLyrics || track.plainLyrics || '');
          const { error: pubErr } = await supabase
            .from('published_karaoke')
            .insert({
              song_id: newSong.id,
              publisher_id: user.id,
              lines: lines,
              video_style: get().videoStyle,
            });
            
          if (pubErr) {
            console.error('Failed to cache track in published_karaoke:', pubErr);
          }
        } catch (err) {
          console.error('Error in cacheLrcLibTrack:', err);
        }
      },
    }),
    {
      name: 'karaoke-lrc-maker-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        step: state.step,
        rawText: state.rawText,
        lines: state.lines,
        audioFileName: state.audioFileName,
        currentProjectTitle: state.currentProjectTitle,
        currentProjectId: state.currentProjectId,
        theme: state.theme,
        timingMode: state.timingMode,
        snapToBeat: state.snapToBeat,
        videoStyle: state.videoStyle,
        coverColors: state.coverColors,
        language: state.language,
        recentProjects: state.recentProjects,
        syllableMode: state.syllableMode,
        subMode: state.subMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.lines && state.lines.length > 0) {
          state.history = [state.lines];
          state.historyIndex = 0;
          
          const timedCount = state.lines.filter(l => l.time !== null).length;
          state.currentIndex = Math.min(timedCount, state.lines.length);
        }
      }
    }
  )
);

export function getDefaultProjectTitle(
  audioFileName: string | null,
  lines: LyricLine[],
  language: 'ru' | 'en'
): string {
  if (audioFileName) {
    const cleanName = audioFileName.replace(/\.[^/.]+$/, '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanName) || /^[0-9a-f-]{36}$/i.test(cleanName);
    if (!isUuid) {
      return cleanName;
    }
  }

  // If filename is missing or is a UUID, try to get the first line of lyrics
  const firstLine = lines.find(l => l.text.trim().length > 0);
  if (firstLine) {
    const cleanLyric = firstLine.text.trim().replace(/[\\/:*?"<>|]/g, '');
    if (cleanLyric.length > 0) {
      return cleanLyric.slice(0, 30);
    }
  }

  return language === 'ru' ? 'Караоке' : 'Karaoke';
}
