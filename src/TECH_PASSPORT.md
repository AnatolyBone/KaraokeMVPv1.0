# 🛠 ТЕХНИЧЕСКИЙ ПАСПОРТ ПРОЕКТА: “Karaoke LRC Maker”

## 1. Стек технологий
* **Фреймворк:** React 19 (TypeScript 5)
* **Сборщик проекта:** Vite 8
* **Стилизация интерфейса:** Tailwind CSS 4
* **Управление состоянием (Global State):** Zustand 5 (с использованием middleware `persist` для сохранения в `localStorage`)
* **Работа с файловой системой:** JSZip 3 (архивирование проектов во временный буфер, утилиты реализованы в `sharing.ts`, но не выведены в UI)
* **Хранилище медиаданных:** IndexedDB API (локальный кэш текущего тяжелого аудиофайла и обложки трека в обход ограничений `localStorage`)
* **Аудиоконтекст:** Web Audio API (PCM декодирование трека, расчет локальных пиков энергии для BPM)
* **Рендеринг и кодирование:** Canvas 2D API (все эффекты частиц и градиентов отрисованы через контекст 2D холста), WebCodecs API (`VideoEncoder`/`AudioEncoder` для быстрого оффлайн-кодирования), библиотеки `mp4-muxer` и `webm-muxer` для создания контейнеров, Web MediaRecorder API (fallback-режим реалтайм захвата).

---

## 2. Архитектура приложения

Проект спроектирован по модульному принципу в соответствии со следующей структурой:

```
src/
├── main.tsx                          # Точка входа
├── App.tsx                           # Layout, глобальные клавиатурные прерывания и роутинг шагов
├── types.ts                          # Базовые типы данных и модели субтитров
├── index.css                         # Стилизация Tailwind 4
├── audioRef.ts                       # Модульная глобальная ссылка на HTMLAudioElement плеер
│
├── store/
│   └── useKaraokeStore.ts            # Zustand: глобальное состояние, методы истории (Undo/Redo)
│
├── services/
│   ├── lyricsProvider.ts             # Интерфейсы провайдеров поиска текстов и координатор запросов
│   └── lrclibService.ts              # Клиент-провайдер базы данных LRCLIB API с таймаутами AbortController и CORS-прокси
│
├── components/
│   ├── Waveform.tsx                  # Интерактивная масштабируемая аудиоволна, эмуляция спектрограммы и BPM-детектор
│   ├── TimelineEditor.tsx            # Горизонтальный таймлайн-редактор с магнитной привязкой фраз
│   ├── RecentProjects.tsx            # Переключатель и сохранение lyrics-проектов в сайдбаре
│   ├── SidePanel.tsx                 # Общая статистика проекта, список проектов и cheatsheet горячих клавиш
│   └── LyricsSearchModal.tsx         # Модальное окно поиска текстов и синхронизированных LRC
│
├── features/
│   ├── audio/
│   │   └── AudioLoader.tsx           # Загрузчик аудиофайлов, чтение ID3-обложек, метаданных и автопоиск LRC
│   ├── lyrics/
│   │   ├── LyricsInput.tsx           # Ввод сырого текста и импорт LRC/SRT/VTT/ASS файлов
│   │   └── LyricsTable.tsx           # Таблица точной правки с переводами, сплитом и мержем строк
│   ├── timing/
│   │   └── TimingPanel.tsx           # Панель записи таймингов Space (Line, Word, Syllable) и мобильная Tap-зона
│   ├── preview/
│   │   └── KaraokePreview.tsx        # Живой плеер субтитров с плавной прокруткой и пословным закрашиванием
│   └── export-video/
│       └── ExportVideoPanel.tsx      # Панель Cinema Engine с профайлером кадров и настройками рендеринга
│
└── utils/
    ├── time.ts                       # Преобразование mm:ss.xx ↔ секунды
    ├── lrc.ts                        # LRC парсеры и скачивание файлов
    ├── db.ts                         # Сохранение и чтение медиафайлов в IndexedDB
    ├── cover.ts                      # Извлечение обложек (APIC ID3 / brute-force поиск) из MP3
    ├── metadata.ts                   # Нативный парсер ID3-тегов (Artist, Title, Album) с исправлением кириллицы
    ├── colors.ts                     # Анализ HSL-палитры обложки (первичный, вторичный цвета и свечение)
    ├── video.ts                      # Логика Cinema Engine (WebCodecs оффлайн кодирование или MediaRecorder 30/60 FPS)
    ├── subtitleFormats.ts            # Парсинг и генерация SRT/ASS/VTT
    ├── localization.ts               # Двуязычный словарь локализации (RU/EN)
    ├── hyphenation.ts                # Алгоритм деления слов на слоги (RU/EN)
    ├── cn.ts                         # [Не используется] Утилита слияния классов Tailwind CSS
    └── renderer/                     # Модульная система отрисовки Cinema Engine
        ├── renderBackground.ts       # Отрисовка фонов (градиенты, пульсации, видео) с кэшированием оффскрин-холстов
        ├── renderParticles.ts        # Система частиц (снег, пыльца, анимированный fluid-gradient)
        ├── renderVisualizer.ts       # Отрисовка спектральных визуализаторов (круговой, бары)
        ├── renderLyrics.ts           # Рендеринг и анимации текста на Canvas
        ├── textCache.ts              # Кэш ширины текста и пред-рендеринг Canvas для плавной отрисовки
        └── strategies/               # Паттерны анимаций текста караоке
            ├── apple.ts              # Apple Music Style (закрашивание + сдвиг вверх)
            ├── classic.ts            # Classic Karaoke Style (пословное закрашивание слева направо)
            ├── kinetic.ts            # Kinetic Typography Style (динамическое центрирование и скейл)
            ├── split.ts              # Split-Screen Style (верхняя панель с обложкой, нижний барабан прокрутки)
            └── index.ts              # Селектор стратегий анимации
```

*Примечание: Документированный ранее файл `features/export-lrc/SharingPanel.tsx` отсутствует в проекте. Утилиты архивирования проектов в `.zip` и генерации Embed-кода реализованы в `utils/sharing.ts`, но не задействованы в UI.*

---

## 3. Модели данных

### 3.1 Структура таймингов субтитров

Модель данных описывает иерархию «Строка ➔ Слово ➔ Слог»:

```typescript
export type SyllableTiming = {
  id: string;
  text: string;
  time: number | null; // Время начала слога в секундах
};

export type WordTiming = {
  id: string;
  text: string;
  time: number | null; // Время начала слова в секундах
  syllables?: SyllableTiming[]; // Массив слогов для режима послоговой синхронизации
};

export type LyricLine = {
  id: string;
  text: string;
  time: number | null; // Время начала строки в секундах
  words: WordTiming[]; // Массив пословного тайминга
  translation?: string; // Текст параллельного перевода песни
};
```

### 3.2 `VideoStyleOptions` (Настройки визуального рендеринга видео)

```typescript
export type VideoBgType = 'gradient' | 'cover-blur' | 'particles' | 'minimal-dark' | 'custom-video' | 'split-dark';
export type AspectRatioType = '16:9' | '9:16' | '1:1';
export type SubtitleAnimationStyle = 'apple-music' | 'classic-karaoke' | 'kinetic' | 'split-screen';
export type VisualizerType = 'bars' | 'circle' | 'none';
export type FxOverlayType = 'snow' | 'lens-dust' | 'fluid-gradient' | 'none';
export type VideoPresetType = 'apple-music' | 'spotify' | 'tiktok-neon' | 'classic-karaoke' | 'minimal-cinema';

export interface VideoStyleOptions {
  preset: VideoPresetType;                 // Название выбранного кураторского пресета
  bgType: VideoBgType;                     // Тип фона
  gradientPreset: string;                  // Название цветового градиента
  fontFamily: string;                      // Семейство шрифтов
  fontSize: number;                        // Высота шрифта в пикселях
  strokeColor: string;                     // Цвет обводки
  strokeWidth: number;                     // Толщина обводки
  glowColor: string;                       // Цвет неонового свечения
  glowSize: number;                        // Радиус свечения
  activeWordColor: string;                 // Цвет закрашенных (активных) слов
  inactiveWordColor: string;               // Цвет неактивного текста
  aspectRatio: AspectRatioType;            // Соотношение сторон видео ('16:9', '9:16', '1:1')
  animationStyle: SubtitleAnimationStyle;  // Стиль анимации текста караоке
  visualizerType: VisualizerType;          // Тип аудио-визуализатора
  fxOverlay: FxOverlayType;                // Спецэффекты (частицы, пыльца, жидкий градиент)
  customVideoUrl: string | null;           // URL загруженного фонового видео (.mp4)
}
```

---

## 4. Жизненный цикл и Взаимодействие компонентов

### 4.1 Загрузка аудио и Метаданных
1. Пользователь загружает аудиофайл через `AudioLoader`.
2. Ссылка на файл регистрируется в глобальном объекте `audioRef.current`.
3. Аудиофайл дублируется в IndexedDB (ключ `current_audio`) с помощью утилиты `saveAudioToDB`.
4. `extractMetadataFromAudio` считывает бинарный заголовок файла (первые 5 МБ) для разбора тегов ID3v2. В случае сбоя кодировки кириллицы (Windows-1251) данные автоматически перекодируются через `TextDecoder`.
5. `extractCoverFromAudio` считывает обложку из фреймов APIC/PIC или выполняет поиск по сигнатурам JPEG/PNG в файле. Картинка сохраняется в IndexedDB (ключ `current_cover`).
6. `extractDominantColors` сжимает обложку до 16x16 пикселей для извлечения доминантных цветов, рассчитывая затемненные оттенки HSL для фонового градиента и свечения.
7. При успешном получении ID3-тегов инициализируется автоматический поиск точного совпадения по базе LRCLIB. При обнаружении LRC-субтитров они автоматически импортируются.

### 4.2 Рабочее пространство редактора (Step 2 Workspace)
Пользователь может переключаться между двумя подрежимами в рабочей области шага 2:
1. **Подрежим Записи (Timing Sync):**
   * Панель `TimingPanel` отображает активную и грядущие строки.
   * Воспроизводится аудио, пользователь нажимает `Space` (или кликает по Tap-зоне).
   * В зависимости от выбранного режима стора (`timingMode` и `syllableMode`) фиксируются тайминги:
     * *Построчно:* Фиксируется `line.time`.
     * *Пословно:* Последовательно проставляются тайминги для каждого слова `word.time` (время первой записи дублируется в `line.time`).
     * *Послогово:* Слово автоматически разбивается на слоги с помощью `splitWordIntoSyllables`, и при нажатии Space записывается время каждого слога `syllable.time`.
   * При активации `snapToBeat` время клика Space принудительно корректируется к ближайшему BPM-биту (если он в пределах 250 мс от клика).
2. **Подрежим Коррекции (Fine-Tuning):**
   * `TimelineEditor` строит горизонтальную полосу времени. Блоки строк можно перетаскивать мышью.
   * При перетаскивании применяется **магнитное притягивание (Magnetic Snapping)** с радиусом 220 мс: координаты блока автоматически привязываются к битам BPM трека или к началу соседних фраз. При захвате выводится плашка `МАГНИТ ✓`.
   * В таблице `LyricsTable` пользователь может вручную сдвигать время строки (с шагом `±0.1` сек), корректировать текст, делить одну строку на две (`splitLine` с автоматическим переносом структуры слов) и склеивать строки (`mergeLines`).
   * В сторе Zustand ведется стек Undo/Redo (`history`, `historyIndex`), позволяющий отменять/повторять любые действия на таймлайне и в таблице.

### 4.3 Рендеринг и Экспорт (Cinema Engine)
Экспорт видео инициируется на шаге 3 и обрабатывается утилитой `video.ts`:

#### Аппаратный экспорт (WebCodecs - Режим А):
1. Выполняется декодирование аудио в буфер PCM.
2. Инициализируется `VideoEncoder` с аппаратным ускорением (`hardwareAcceleration: 'prefer-hardware'`) и режимом сверхнизкой задержки (`latencyMode: 'realtime'`). Задается битрейт 2-3 Mbps. Инициализируется `AudioEncoder` (битрейт 192 kbps).
3. Создается оффлайн `Mp4Muxer` (контейнер MP4 с кодеками avc/aac) или `WebmMuxer` (контейнер WebM с кодеками VP9/Opus).
4. Запускается детерминированный цикл рендеринга на частоте **30 FPS**:
   * Отрисовывается фон `renderBackground` (для типа `cover-blur` и эффекта `fluid-gradient` отрисовка идет на вспомогательный offscreen-canvas размером 0.25x для минимизации нагрузки на CPU).
   * Отрисовываются частицы `renderParticles` и спектральный визуализатор `renderVisualizer` (для визуализаторов частотный спектр эмулируется по амплитуде звуковой волны в данной точке).
   * Макетный движок `calculateSubtitlesLayout` рассчитывает плавную прокрутку строк с O(log N) поиском активного элемента и окном перехода в 0.7 сек (сглаживание `easeInOutCubic`).
   * Отрисовываются субтитры `renderLyrics` с использованием пре-рендеринг кэша символов и строк `textCache.ts` для борьбы с джиттером (дрожанием) шрифтов. В стилях *Apple Music*, *Spotify*, *TikTok Neon* и *Classic* под основной строкой дополнительно рисуется параллельный перевод.
   * Сформированный кадр Canvas передается в `VideoFrame` и кодируется в видеопоток. Одновременно из буфера PCM нарезаются аудио-пакеты и отправляются в `AudioEncoder`.
5. По завершении кодирования муксер финализирует файл и генерирует Blob.

#### Программный экспорт (MediaRecorder - Режим Б):
1. Используется в браузерах без поддержки WebCodecs.
2. Создается AudioContext, захватывающий медиа-элемент трека через `createMediaElementSource` и перенаправляющий его на `createMediaStreamDestination`.
3. С канваса захватывается видеопоток `captureStream(60)` (частота **60 FPS**). Потоки видео и аудио объединяются в один `MediaStream`.
4. Запускается `MediaRecorder` с битрейтом 2.5-4.5 Mbps.
5. Рендеринг кадров выполняется по тикам таймера, вынесенного в фоновый поток **Web Worker**. Это позволяет предотвратить засыпание и троттлинг рендеринга при переключении вкладки браузера.
6. По окончании воспроизведения запись останавливается, и рекордер возвращает Blob.
