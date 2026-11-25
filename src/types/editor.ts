export type ColorGrade = 'standard' | 'warm' | 'mono' | 'cinema';

export type ClipSourceType = 'sample' | 'local' | 'drive';

export interface TimelineClip {
  id: string;
  title: string;
  sourceType: ClipSourceType;
  /** Video blob/object URL for local/drive clips, or image URL for starter sample reels */
  sourceRef: string;
  /** Playable HTMLVideoElement src if local/drive video */
  videoUrl?: string;
  posterUrl: string;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  playbackRate: number;
  volume: number;
  waveform: number[];
  resolutionLabel: string;
}

export interface TimelineMarker {
  id: string;
  label: string;
  timeSec: number;
  color: 'amber' | 'sky' | 'emerald' | 'rose';
  notes: string;
  source: 'user' | 'gemini';
}

export interface SavedProject {
  id: number;
  title: string;
  fps: number;
  resolution: string;
  colorGrade: ColorGrade;
  playheadSec: number;
  updatedAt: string;
  clips: Array<{
    id: number;
    title: string;
    sourceType: ClipSourceType;
    sourceRef: string;
    posterUrl: string;
    durationSec: number;
    trimStartSec: number;
    trimEndSec: number;
    timelineOrder: number;
    playbackRate: number;
    volume: number;
  }>;
  markers: Array<{
    id: number;
    label: string;
    timeSec: number;
    color: string;
    notes: string;
    source: string;
  }>;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
}

export interface WorkspacePrefs {
  ownerId: string;
  displayName: string;
  defaultFps: 24 | 30 | 60;
  snapEnabled: boolean;
  loopTrim: boolean;
  safeGuides: boolean;
  activeProjectTitle: string;
}

export interface EditNoteDoc {
  id: string;
  ownerId: string;
  projectTitle: string;
  timecodeSec: number;
  content: string;
  category: 'cut' | 'color' | 'audio' | 'research';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GeminiQuickEditResult {
  summary: string;
  suggestedTitle: string;
  trimSuggestion: {
    trimStartSec: number;
    trimEndSec: number;
    rationale: string;
  };
  markers: Array<{
    label: string;
    timeSec: number;
    notes: string;
  }>;
}

export interface GeminiSceneAnalysis {
  visualAnalysis: string;
  pacingAdvice: string;
  recommendedColorGrade: ColorGrade;
  recommendedTrimIn: number;
  recommendedTrimOut: number;
  captionIdea: string;
}

export interface GeminiResearchResult {
  answer: string;
  sources: Array<{
    uri: string;
    title: string;
  }>;
}

export type AutoEditStyle = 'cinematic' | 'social' | 'editorial' | 'noir';

export interface AutoEditOptions {
  style: AutoEditStyle;
  autoTrim: boolean;
  autoEnhance: boolean;
  autoCaptions: boolean;
  autoMarkers: boolean;
}

export interface AutoEditClipPlan {
  clipId: string;
  trimStartSec: number;
  trimEndSec: number;
  playbackRate: number;
  reason: string;
}

export interface AutoEditPlan {
  projectTitle: string;
  editSummary: string;
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  clipEdits: AutoEditClipPlan[];
  markers: Array<{
    label: string;
    timeSec: number;
    color: 'amber' | 'sky' | 'emerald' | 'rose';
    notes: string;
  }>;
  captions: Array<{
    startSec: number;
    endSec: number;
    text: string;
  }>;
  captionStyle: Partial<CaptionStyle>;
}

export interface AutoEditReport {
  style: AutoEditStyle;
  projectTitle: string;
  editSummary: string;
  beforeDurationSec: number;
  afterDurationSec: number;
  clipsTrimmed: number;
  markersAdded: number;
  captionsGenerated: number;
  usedAudioTranscript: boolean;
  appliedGrade: ColorGrade;
  appliedAdjustments: VideoAdjustments;
  clipChanges: Array<{
    clipId: string;
    title: string;
    startOffsetSec: number;
    trimStartSec: number;
    trimEndSec: number;
    playbackRate: number;
    reason: string;
  }>;
}

export interface AutoEditSnapshot {
  projectTitle: string;
  clips: TimelineClip[];
  markers: TimelineMarker[];
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  playheadSec: number;
}

export function generateDeterministicWaveform(seedStr: string, bars = 48): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const values: number[] = [];
  for (let i = 0; i < bars; i++) {
    hash = Math.imul(hash ^ (i + 17), 16777619);
    const normalized = ((hash >>> 0) % 1000) / 1000;
    const envelope = Math.sin(((i + 0.5) / bars) * Math.PI);
    values.push(Math.max(0.14, Math.min(0.98, 0.22 + normalized * 0.65 * (0.55 + envelope * 0.45))));
  }
  return values;
}

export function formatTimecode(seconds: number, fps = 24): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.floor(safe * fps + 0.0001);
  const frames = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const secs = totalSec % 60;
  const mins = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function formatShortSec(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins > 0) {
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${secs.toFixed(2)}s`;
}

export interface VideoAdjustments {
  brightness: number; // 0 to 200 (100 = neutral)
  contrast: number;   // 0 to 200 (100 = neutral)
  saturation: number; // 0 to 200 (100 = neutral)
  sharpen: number;    // 0 to 100 (0 = off)
}

export const DEFAULT_VIDEO_ADJUSTMENTS: VideoAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sharpen: 0,
};

export const COLOR_GRADE_CSS: Record<ColorGrade, string> = {
  standard: 'none',
  warm: 'contrast(1.06) saturate(1.18) sepia(0.16) brightness(1.02)',
  mono: 'grayscale(1) contrast(1.22) brightness(0.98)',
  cinema: 'contrast(1.14) saturate(0.92) hue-rotate(-6deg) brightness(0.96)',
};

export function buildCanvasFilterString(
  colorGrade: ColorGrade,
  adjustments: VideoAdjustments,
  bypass = false
): string {
  if (bypass) return 'none';
  const parts: string[] = [];
  if (COLOR_GRADE_CSS[colorGrade] !== 'none') {
    parts.push(COLOR_GRADE_CSS[colorGrade]);
  }
  if (adjustments.brightness !== 100) {
    parts.push(`brightness(${adjustments.brightness}%)`);
  }
  if (adjustments.contrast !== 100) {
    parts.push(`contrast(${adjustments.contrast}%)`);
  }
  if (adjustments.saturation !== 100) {
    parts.push(`saturate(${adjustments.saturation}%)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

export interface CaptionCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface CaptionStyle {
  enabled: boolean;
  fontFamily: 'DM Sans' | 'Plus Jakarta Sans' | 'JetBrains Mono' | 'Georgia';
  fontSize: number; // 20 to 56 (base on 960px canvas)
  textColor: string;
  backgroundColor: string;
  bgOpacity: number; // 0 to 1
  position: 'bottom' | 'middle' | 'top';
  bold: boolean;
  uppercase: boolean;
  outline: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  enabled: true,
  fontFamily: 'DM Sans',
  fontSize: 32,
  textColor: '#FFFFFF',
  backgroundColor: '#090B10',
  bgOpacity: 0.72,
  position: 'bottom',
  bold: true,
  uppercase: false,
  outline: true,
};

function formatSrtTimestamp(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000) % 1000;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)},${pad3(ms)}`;
}

export function buildSrtContent(cues: CaptionCue[]): string {
  return [...cues]
    .sort((a, b) => a.startSec - b.startSec)
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatSrtTimestamp(cue.startSec)} --> ${formatSrtTimestamp(cue.endSec)}\n${cue.text.trim()}`
    )
    .join('\n\n');
}

export const STARTER_CAPTIONS: CaptionCue[] = [
  {
    id: 'cap-1',
    startSec: 1.4,
    endSec: 5.2,
    text: 'Golden hour breaks along the Pacific coastal cliffs.',
  },
  {
    id: 'cap-2',
    startSec: 5.5,
    endSec: 9.8,
    text: 'Highway One curves past the arch bridge toward the horizon.',
  },
  {
    id: 'cap-3',
    startSec: 13.0,
    endSec: 17.8,
    text: 'Rain settles over a quiet Tokyo alleyway at dusk.',
  },
];

export const STARTER_CLIPS: TimelineClip[] = [
  {
    id: 'clip-coastal-01',
    title: 'A001_Coastal_Aerial_GoldenHr.mov',
    sourceType: 'sample',
    sourceRef: '/src/assets/images/clip_coastal_aerial_1795486567420.jpg',
    posterUrl: '/src/assets/images/clip_coastal_aerial_1795486567420.jpg',
    durationSec: 12.0,
    trimStartSec: 1.2,
    trimEndSec: 10.4,
    playbackRate: 1,
    volume: 0.85,
    waveform: generateDeterministicWaveform('coastal-aerial-01', 56),
    resolutionLabel: '3840x2160 · 24fps',
  },
  {
    id: 'clip-tokyo-02',
    title: 'B014_Tokyo_Rain_Anamorphic.mov',
    sourceType: 'sample',
    sourceRef: '/src/assets/images/clip_tokyo_rain_1795486568533.jpg',
    posterUrl: '/src/assets/images/clip_tokyo_rain_1795486568533.jpg',
    durationSec: 10.5,
    trimStartSec: 0.8,
    trimEndSec: 9.2,
    playbackRate: 1,
    volume: 0.8,
    waveform: generateDeterministicWaveform('tokyo-rain-02', 56),
    resolutionLabel: '3840x2160 · 24fps',
  },
  {
    id: 'clip-alpine-03',
    title: 'C007_Dolomites_FirstLight.mov',
    sourceType: 'sample',
    sourceRef: '/src/assets/images/clip_alpine_sunrise_1795486568438.jpg',
    posterUrl: '/src/assets/images/clip_alpine_sunrise_1795486568438.jpg',
    durationSec: 14.0,
    trimStartSec: 2.0,
    trimEndSec: 12.5,
    playbackRate: 1,
    volume: 0.75,
    waveform: generateDeterministicWaveform('alpine-sunrise-03', 56),
    resolutionLabel: '3840x2160 · 24fps',
  },
  {
    id: 'clip-craft-04',
    title: 'D022_Watchmaker_Macro_35mm.mov',
    sourceType: 'sample',
    sourceRef: '/src/assets/images/clip_studio_craft_1795486570774.jpg',
    posterUrl: '/src/assets/images/clip_studio_craft_1795486570774.jpg',
    durationSec: 11.0,
    trimStartSec: 0.5,
    trimEndSec: 10.0,
    playbackRate: 1,
    volume: 0.9,
    waveform: generateDeterministicWaveform('studio-craft-04', 56),
    resolutionLabel: '3840x2160 · 24fps',
  },
];

export const STARTER_MARKERS: TimelineMarker[] = [
  {
    id: 'mk-1',
    label: 'Opening Establisher',
    timeSec: 1.5,
    color: 'amber',
    notes: 'Hold wide cliff line before bridge reveal',
    source: 'user',
  },
  {
    id: 'mk-2',
    label: 'Rain Cut Transition',
    timeSec: 9.8,
    color: 'sky',
    notes: 'Match ambient surf audio tail into alley rain',
    source: 'user',
  },
  {
    id: 'mk-3',
    label: 'Sunrise Peak',
    timeSec: 21.4,
    color: 'emerald',
    notes: 'Key music swell on Dolomite ridge light',
    source: 'user',
  },
];
