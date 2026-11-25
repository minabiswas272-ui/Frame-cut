import React, { useRef } from 'react';
import {
  AudioLines,
  Download,
  Loader2,
  Plus,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  buildSrtContent,
  formatShortSec,
  type CaptionCue,
  type CaptionStyle,
  type TimelineClip,
} from '../types/editor';

export interface ExtractedAudioPreview {
  clipTitle: string;
  blobUrl: string;
  sizeBytes: number;
  transcript: string;
}

interface CaptionsPanelProps {
  activeClip: TimelineClip | null;
  playheadSec: number;
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  isTranscribing: boolean;
  transcribeStage: string;
  transcribeProgress: number;
  transcribeError: string | null;
  extractedAudio: ExtractedAudioPreview | null;
  onExtractAndTranscribeActiveClip: () => void;
  onUploadAndTranscribeFile: (file: File) => void;
  onGenerateVisualCaptions: () => void;
  onUpdateCaptionStyle: (patch: Partial<CaptionStyle>) => void;
  onAddCaptionAtPlayhead: () => void;
  onUpdateCaption: (id: string, patch: Partial<CaptionCue>) => void;
  onDeleteCaption: (id: string) => void;
  onSeek: (sec: number) => void;
}

const COLOR_SWATCHES = ['#FFFFFF', '#FDE047', '#F59E0B', '#38BDF8', '#A7F3D0'];
const FONT_OPTIONS: CaptionStyle['fontFamily'][] = [
  'DM Sans',
  'Plus Jakarta Sans',
  'JetBrains Mono',
  'Georgia',
];

export const CaptionsPanel: React.FC<CaptionsPanelProps> = ({
  activeClip,
  playheadSec,
  captions,
  captionStyle,
  isTranscribing,
  transcribeStage,
  transcribeProgress,
  transcribeError,
  extractedAudio,
  onExtractAndTranscribeActiveClip,
  onUploadAndTranscribeFile,
  onGenerateVisualCaptions,
  onUpdateCaptionStyle,
  onAddCaptionAtPlayhead,
  onUpdateCaption,
  onDeleteCaption,
  onSeek,
}) => {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownloadSrt = () => {
    if (!captions.length) return;
    const content = buildSrtContent(captions);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captions.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasNativeVideo = Boolean(activeClip?.videoUrl);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-5">
      {/* 1. Audio Extraction & Gemini Transcription */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">
            Audio &amp; Captions
          </h2>
          {captions.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadSrt}
              className="text-[11px] font-medium text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              .SRT
            </button>
          )}
        </div>

        <p className="text-xs text-[#8E99AD] leading-relaxed">
          Extract audio with ffmpeg.wasm and transcribe timestamped captions using Gemini, then style them directly on the video canvas.
        </p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onExtractAndTranscribeActiveClip}
            disabled={isTranscribing || !hasNativeVideo}
            title={
              hasNativeVideo
                ? 'Extract MP3 audio from the active video clip and transcribe timestamps with Gemini'
                : 'Select an imported video clip (local or Google Drive) to extract its audio track'
            }
            className="w-full h-9 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45"
          >
            {isTranscribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AudioLines className="w-3.5 h-3.5" />
            )}
            {isTranscribing ? 'Transcribing...' : 'Extract Audio & Transcribe Clip'}
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <input
              ref={mediaInputRef}
              type="file"
              accept="video/*,audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadAndTranscribeFile(file);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={isTranscribing}
              className="h-8 px-2.5 rounded-md bg-[#181E2B] hover:bg-[#222A3C] border border-[#2A3347] text-[11px] font-medium text-[#E5E9F0] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45"
            >
              <Upload className="w-3 h-3 text-amber-400" />
              Upload Audio/Video
            </button>

            <button
              type="button"
              onClick={onGenerateVisualCaptions}
              disabled={isTranscribing || !activeClip}
              className="h-8 px-2.5 rounded-md bg-[#181E2B] hover:bg-[#222A3C] border border-[#2A3347] text-[11px] font-medium text-[#E5E9F0] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45"
            >
              <Sparkles className="w-3 h-3 text-sky-400" />
              Caption Silent Clip
            </button>
          </div>
        </div>

        {/* Live Progress Indicator */}
        {isTranscribing && (
          <div className="p-2.5 rounded-lg bg-[#151A24] border border-[#262F42] space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#C8D0DF] truncate">{transcribeStage || 'Working...'}</span>
              <span className="font-mono-tc text-amber-400">{transcribeProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#222938] overflow-hidden">
              <div
                style={{ width: `${transcribeProgress}%` }}
                className="h-full bg-amber-400 transition-all duration-200"
              />
            </div>
          </div>
        )}

        {transcribeError && (
          <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 leading-relaxed">
            {transcribeError}
          </div>
        )}

        {/* Extracted Audio Player & Transcript */}
        {extractedAudio && (
          <div className="p-2.5 rounded-lg bg-[#141923] border border-[#242D3E] space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-[#E5E9F0] truncate">
                Extracted MP3 · {(extractedAudio.sizeBytes / 1024).toFixed(0)} KB
              </span>
              <a
                href={extractedAudio.blobUrl}
                download={`${extractedAudio.clipTitle.replace(/[^a-zA-Z0-9._-]/g, '_')}.mp3`}
                className="text-amber-400 hover:text-amber-300 shrink-0"
              >
                Download
              </a>
            </div>
            <audio controls src={extractedAudio.blobUrl} className="w-full h-8" />
            {extractedAudio.transcript && (
              <p className="text-[11px] text-[#9BA5B7] line-clamp-3 leading-relaxed">
                &ldquo;{extractedAudio.transcript}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>

      {/* 2. Canvas Caption Style Customizer */}
      <div className="pt-4 border-t border-[#1E2430] space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold font-display text-[#C8D0DF]">Canvas Caption Style</p>
          <button
            type="button"
            onClick={() => onUpdateCaptionStyle({ enabled: !captionStyle.enabled })}
            className={`h-6 px-2 rounded text-[11px] font-medium border transition-colors ${
              captionStyle.enabled
                ? 'bg-amber-500/15 border-amber-500/45 text-amber-300'
                : 'bg-[#161B25] border-[#262E3F] text-[#8E99AD]'
            }`}
          >
            {captionStyle.enabled ? 'Visible' : 'Hidden'}
          </button>
        </div>

        {/* Font Family & Position */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="cap-font" className="text-[11px] text-[#8E99AD] block">
              Font
            </label>
            <select
              id="cap-font"
              value={captionStyle.fontFamily}
              onChange={(e) =>
                onUpdateCaptionStyle({
                  fontFamily: e.target.value as CaptionStyle['fontFamily'],
                })
              }
              className="w-full h-7 px-2 rounded bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8]"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] text-[#8E99AD] block">Position</span>
            <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded bg-[#151A24] border border-[#262E3F]">
              {(['top', 'middle', 'bottom'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onUpdateCaptionStyle({ position: pos })}
                  className={`h-6 rounded text-[10px] capitalize transition-colors ${
                    captionStyle.position === pos
                      ? 'bg-[#262F42] text-amber-300 font-medium'
                      : 'text-[#8994A7] hover:text-white'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Size & Background Opacity */}
        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9BA5B7]">Font Size</span>
              <span className="font-mono-tc text-[#F3F5F8]">{captionStyle.fontSize}px</span>
            </div>
            <input
              type="range"
              min={20}
              max={54}
              step={1}
              value={captionStyle.fontSize}
              onChange={(e) => onUpdateCaptionStyle({ fontSize: Number(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9BA5B7]">Box Opacity</span>
              <span className="font-mono-tc text-[#F3F5F8]">
                {Math.round(captionStyle.bgOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={captionStyle.bgOpacity}
              onChange={(e) => onUpdateCaptionStyle({ bgOpacity: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Text Color & Style Toggles */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {COLOR_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onUpdateCaptionStyle({ textColor: hex })}
                style={{ backgroundColor: hex }}
                aria-label={`Set caption text color ${hex}`}
                className={`w-5 h-5 rounded-full border transition-transform ${
                  captionStyle.textColor.toLowerCase() === hex.toLowerCase()
                    ? 'border-amber-400 scale-110 ring-1 ring-amber-400'
                    : 'border-white/25'
                }`}
              />
            ))}
            <input
              type="color"
              value={captionStyle.textColor}
              onChange={(e) => onUpdateCaptionStyle({ textColor: e.target.value })}
              aria-label="Custom caption color"
              className="w-5 h-5 bg-transparent border-0 cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onUpdateCaptionStyle({ bold: !captionStyle.bold })}
              className={`h-6 px-2 rounded text-[11px] font-bold border ${
                captionStyle.bold
                  ? 'bg-[#252E40] border-amber-500/45 text-amber-300'
                  : 'bg-[#151A24] border-[#252D3D] text-[#8E99AD]'
              }`}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => onUpdateCaptionStyle({ uppercase: !captionStyle.uppercase })}
              className={`h-6 px-2 rounded text-[11px] border ${
                captionStyle.uppercase
                  ? 'bg-[#252E40] border-amber-500/45 text-amber-300'
                  : 'bg-[#151A24] border-[#252D3D] text-[#8E99AD]'
              }`}
            >
              AA
            </button>
            <button
              type="button"
              onClick={() => onUpdateCaptionStyle({ outline: !captionStyle.outline })}
              className={`h-6 px-2 rounded text-[11px] border ${
                captionStyle.outline
                  ? 'bg-[#252E40] border-amber-500/45 text-amber-300'
                  : 'bg-[#151A24] border-[#252D3D] text-[#8E99AD]'
              }`}
            >
              Stroke
            </button>
          </div>
        </div>
      </div>

      {/* 3. Timestamped Caption Cues */}
      <div className="pt-4 border-t border-[#1E2430] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold font-display text-[#C8D0DF]">
            Caption Cues ({captions.length})
          </span>
          <button
            type="button"
            onClick={onAddCaptionAtPlayhead}
            className="h-6 px-2 rounded bg-[#1A2130] hover:bg-[#232D40] border border-[#2B354A] text-[11px] font-medium text-[#E5E9F0] inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3 text-amber-400" />
            Add @ {formatShortSec(playheadSec)}
          </button>
        </div>

        {captions.length === 0 ? (
          <div className="py-5 text-center space-y-1.5">
            <Subtitles className="w-5 h-5 text-[#667085] mx-auto" />
            <p className="text-xs text-[#8E99AD]">
              No captions yet. Extract audio to transcribe or add a cue manually.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {captions.map((cue) => {
              const isCurrent = playheadSec >= cue.startSec && playheadSec <= cue.endSec;
              return (
                <div
                  key={cue.id}
                  className={`p-2.5 rounded-lg border space-y-1.5 transition-colors ${
                    isCurrent
                      ? 'bg-[#19202E] border-amber-500/50'
                      : 'bg-[#141821] border-[#212836]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1 font-mono-tc text-[11px]">
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={cue.startSec}
                        onChange={(e) =>
                          onUpdateCaption(cue.id, {
                            startSec: Math.max(0, parseFloat(e.target.value) || 0),
                          })
                        }
                        aria-label="Caption start seconds"
                        className="w-14 h-6 px-1.5 rounded bg-[#0E1118] border border-[#252D3D] text-[#F3F5F8]"
                      />
                      <span className="text-[#6F7A8E]">→</span>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={cue.endSec}
                        onChange={(e) =>
                          onUpdateCaption(cue.id, {
                            endSec: Math.max(
                              cue.startSec + 0.2,
                              parseFloat(e.target.value) || cue.startSec + 1
                            ),
                          })
                        }
                        aria-label="Caption end seconds"
                        className="w-14 h-6 px-1.5 rounded bg-[#0E1118] border border-[#252D3D] text-[#F3F5F8]"
                      />
                      <button
                        type="button"
                        onClick={() => onSeek(cue.startSec)}
                        className="ml-1 text-[10px] font-sans text-amber-400 hover:text-amber-300"
                      >
                        Jump
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCaption(cue.id)}
                      className="text-[#7D889C] hover:text-rose-300"
                      aria-label="Delete caption cue"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <textarea
                    rows={2}
                    value={cue.text}
                    onChange={(e) => onUpdateCaption(cue.id, { text: e.target.value })}
                    className="w-full p-1.5 rounded bg-[#0E1118] border border-[#222A3A] text-xs text-[#E5E9F0] focus:outline-none focus:border-amber-500/60 resize-none"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
