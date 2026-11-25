import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Grid,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import {
  findActiveCaptionText,
  renderCompositeFrame,
} from '../lib/canvasRenderer';
import {
  formatShortSec,
  formatTimecode,
  type CaptionCue,
  type CaptionStyle,
  type ColorGrade,
  type TimelineClip,
  type VideoAdjustments,
} from '../types/editor';

export interface VideoPreviewHandle {
  captureFrameBase64: () => string | null;
}

interface VideoPreviewPlayerProps {
  activeClip: TimelineClip | null;
  clipLocalTime: number;
  playheadSec: number;
  sequenceTime: number;
  totalTrimmedDuration: number;
  fps: 24 | 30 | 60;
  isPlaying: boolean;
  loopTrim: boolean;
  safeGuides: boolean;
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  muted: boolean;
  volume: number;
  onTogglePlay: () => void;
  onStepFrame: (deltaFrames: number) => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onJumpToTrimIn: () => void;
  onJumpToTrimOut: () => void;
  onToggleLoopTrim: () => void;
  onToggleSafeGuides: () => void;
  onToggleBypassFilters: () => void;
  onChangeColorGrade: (grade: ColorGrade) => void;
  onToggleMute: () => void;
  onChangeVolume: (vol: number) => void;
  onChangePlaybackRate: (rate: number) => void;
  onSetTrimInAtPlayhead: () => void;
  onSetTrimOutAtPlayhead: () => void;
  onUpdateTrimRange: (trimStart: number, trimEnd: number) => void;
  onResetTrim: () => void;
  onSplitAtPlayhead: () => void;
  isAutoEditing: boolean;
  canUndoAutoEdit: boolean;
  onRunAutoEdit: () => void;
  onUndoAutoEdit: () => void;
}

const RATES = [0.5, 1, 1.5, 2];
const GRADES: Array<{ id: ColorGrade; label: string }> = [
  { id: 'standard', label: 'Natural' },
  { id: 'warm', label: 'Warm 35mm' },
  { id: 'cinema', label: 'Cool Cinema' },
  { id: 'mono', label: 'Noir Mono' },
];

export const VideoPreviewPlayer = forwardRef<VideoPreviewHandle, VideoPreviewPlayerProps>(
  function VideoPreviewPlayer(props, ref) {
    const {
      activeClip,
      clipLocalTime,
      playheadSec,
      sequenceTime,
      totalTrimmedDuration,
      fps,
      isPlaying,
      loopTrim,
      safeGuides,
      colorGrade,
      videoAdjustments,
      bypassFilters,
      captions,
      captionStyle,
      muted,
      volume,
      onTogglePlay,
      onStepFrame,
      onJumpToStart,
      onJumpToEnd,
      onJumpToTrimIn,
      onJumpToTrimOut,
      onToggleLoopTrim,
      onToggleSafeGuides,
      onToggleBypassFilters,
      onChangeColorGrade,
      onToggleMute,
      onChangeVolume,
      onChangePlaybackRate,
      onSetTrimInAtPlayhead,
      onSetTrimOutAtPlayhead,
      onUpdateTrimRange,
      onResetTrim,
      onSplitAtPlayhead,
      isAutoEditing,
      canUndoAutoEdit,
      onRunAutoEdit,
      onUndoAutoEdit,
    } = props;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const loadedImageRef = useRef<{ src: string; img: HTMLImageElement } | null>(null);
    const [imageVersion, setImageVersion] = useState(0);
    const [videoReadyTick, setVideoReadyTick] = useState(0);

    const isNativeVideo = Boolean(activeClip?.videoUrl);

    const hasCustomAdjustments =
      videoAdjustments.brightness !== 100 ||
      videoAdjustments.contrast !== 100 ||
      videoAdjustments.saturation !== 100 ||
      videoAdjustments.sharpen > 0 ||
      colorGrade !== 'standard';

    // Sync hidden HTML5 <video> element time, playback state, rate, and audio
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !isNativeVideo || !activeClip) return;

      video.playbackRate = activeClip.playbackRate || 1;
      video.muted = muted;
      video.volume = Math.max(0, Math.min(1, volume * activeClip.volume));

      const drift = Math.abs(video.currentTime - clipLocalTime);
      if (drift > 0.14 || !isPlaying) {
        try {
          video.currentTime = Math.max(0, Math.min(activeClip.durationSec, clipLocalTime));
        } catch {
          // Ignore seek errors before metadata is ready
        }
      }

      if (isPlaying && video.paused) {
        video.play().catch(() => {});
      } else if (!isPlaying && !video.paused) {
        video.pause();
      }
    }, [isNativeVideo, activeClip, clipLocalTime, isPlaying, muted, volume]);

    // Load sample still image into memory for HTML5 Canvas cinema rendering
    useEffect(() => {
      if (!activeClip || isNativeVideo) return;
      const src = activeClip.sourceRef;
      if (loadedImageRef.current?.src === src) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedImageRef.current = { src, img };
        setImageVersion((v) => v + 1);
      };
      img.onerror = () => {
        setImageVersion((v) => v + 1);
      };
      img.src = src;
    }, [activeClip, isNativeVideo]);

    // Unified HTML5 Canvas Renderer: applies ctx.filter (brightness, contrast, saturate + LUT),
    // 3x3 pixel sharpen convolution, and live customizable caption overlay
    useEffect(() => {
      if (!activeClip) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      let rafId = 0;

      const renderFrame = () => {
        const w = canvas.width;
        const h = canvas.height;
        const activeCaptionText = findActiveCaptionText(captions, playheadSec);

        if (isNativeVideo && videoRef.current) {
          renderCompositeFrame({
            ctx,
            width: w,
            height: h,
            source: { kind: 'video', video: videoRef.current },
            colorGrade,
            videoAdjustments,
            bypassFilters,
            captionText: activeCaptionText,
            captionStyle,
            includeVignette: false,
          });
        } else {
          const loaded = loadedImageRef.current;
          const img = loaded && loaded.src === activeClip.sourceRef ? loaded.img : null;
          renderCompositeFrame({
            ctx,
            width: w,
            height: h,
            source: {
              kind: 'image',
              img,
              clipLocalTime,
              durationSec: activeClip.durationSec,
            },
            colorGrade,
            videoAdjustments,
            bypassFilters,
            captionText: activeCaptionText,
            captionStyle,
            includeVignette: true,
          });
        }

        if (isNativeVideo && isPlaying) {
          rafId = requestAnimationFrame(renderFrame);
        }
      };

      rafId = requestAnimationFrame(renderFrame);
      return () => cancelAnimationFrame(rafId);
    }, [
      activeClip,
      isNativeVideo,
      isPlaying,
      clipLocalTime,
      playheadSec,
      colorGrade,
      videoAdjustments,
      bypassFilters,
      captions,
      captionStyle,
      imageVersion,
      videoReadyTick,
    ]);

    useImperativeHandle(ref, () => ({
      captureFrameBase64: () => {
        try {
          if (canvasRef.current) {
            return canvasRef.current.toDataURL('image/jpeg', 0.78).split(',')[1] ?? null;
          }
        } catch (err) {
          console.error('Failed to capture video frame:', err);
        }
        return null;
      },
    }));

    const trimDuration = activeClip
      ? Math.max(0.1, activeClip.trimEndSec - activeClip.trimStartSec)
      : 0;

    const isInsideTrim = activeClip
      ? clipLocalTime >= activeClip.trimStartSec - 0.02 &&
        clipLocalTime <= activeClip.trimEndSec + 0.02
      : true;

    const handleNudgeIn = (delta: number) => {
      if (!activeClip) return;
      const next = Math.max(
        0,
        Math.min(activeClip.trimEndSec - 0.2, Number((activeClip.trimStartSec + delta).toFixed(2)))
      );
      onUpdateTrimRange(next, activeClip.trimEndSec);
    };

    const handleNudgeOut = (delta: number) => {
      if (!activeClip) return;
      const next = Math.min(
        activeClip.durationSec,
        Math.max(activeClip.trimStartSec + 0.2, Number((activeClip.trimEndSec + delta).toFixed(2)))
      );
      onUpdateTrimRange(activeClip.trimStartSec, next);
    };

    return (
      <section className="flex-1 min-w-0 flex flex-col bg-[#0B0D11] overflow-hidden">
        {/* Monitor Header Strip */}
        <div className="h-10 px-4 border-b border-[#1E2430] bg-[#10131A] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 text-xs text-[#9BA5B7]">
            <span className="font-medium text-[#E5E9F0] truncate">
              {activeClip ? activeClip.title : 'No Active Clip'}
            </span>
            {activeClip && (
              <>
                <span aria-hidden="true" className="text-[#454E61]">·</span>
                <span className="whitespace-nowrap shrink-0">{activeClip.resolutionLabel}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-[#161B25] rounded-md p-0.5 border border-[#242B3A]">
              {GRADES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChangeColorGrade(g.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    colorGrade === g.id
                      ? 'bg-[#262E3F] text-[#F3F5F8]'
                      : 'text-[#8994A7] hover:text-[#D5DCE8]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {hasCustomAdjustments && (
              <button
                type="button"
                onClick={onToggleBypassFilters}
                title="Compare original vs filtered Canvas output"
                className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                  bypassFilters
                    ? 'bg-sky-500/15 border-sky-500/45 text-sky-300'
                    : 'bg-[#161B25] border-[#242B3A] text-[#9BA5B7] hover:text-[#F3F5F8]'
                }`}
              >
                {bypassFilters ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {bypassFilters ? 'Original' : 'FX On'}
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSafeGuides}
              title="Toggle Broadcast Safe Guides"
              className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                safeGuides
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-[#161B25] border-[#242B3A] text-[#9BA5B7] hover:text-[#F3F5F8]'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              Guides
            </button>
          </div>
        </div>

        {/* Cinema Preview Canvas Viewport */}
        <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-[#080A0E] relative overflow-hidden">
          {activeClip ? (
            <div className="relative w-full h-full max-w-[920px] max-h-full aspect-video bg-black rounded-lg overflow-hidden border border-[#232936] shadow-[0_18px_48px_rgba(0,0,0,0.65)] flex items-center justify-center">
              {/* Hidden native video source decoded directly into the HTML5 Canvas filter pipeline */}
              {isNativeVideo && (
                <video
                  ref={videoRef}
                  src={activeClip.videoUrl}
                  playsInline
                  preload="auto"
                  crossOrigin="anonymous"
                  onLoadedData={() => setVideoReadyTick((t) => t + 1)}
                  onSeeked={() => setVideoReadyTick((t) => t + 1)}
                  className="hidden"
                />
              )}

              {/* Unified HTML5 Canvas Filter Viewport (960x540 for crisp 60fps sharpen + filter rendering) */}
              <canvas
                ref={canvasRef}
                width={960}
                height={540}
                className="w-full h-full object-contain bg-black"
              />

              {/* Broadcast Action/Title Safe Guides */}
              {safeGuides && (
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-[5%] border border-dashed border-amber-400/45" />
                  <div className="absolute inset-[10%] border border-dashed border-sky-300/45" />
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/40" />
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-white/40" />
                  </div>
                </div>
              )}

              {/* Subtle bottom scrim with timecode + active filter / trim indicators */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 via-black/30 to-transparent flex items-end justify-between px-3.5 pb-2.5">
                <div className="flex items-center gap-2.5 text-xs font-mono-tc text-[#F3F5F8]">
                  <span>{formatTimecode(sequenceTime, fps)}</span>
                  <span className="text-white/40">/</span>
                  <span className="text-[#B8C1D1]">{formatTimecode(totalTrimmedDuration, fps)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {bypassFilters && hasCustomAdjustments && (
                    <span className="text-[11px] font-medium text-sky-300 bg-black/70 px-2 py-0.5 rounded border border-sky-500/40">
                      Bypassed (Original)
                    </span>
                  )}
                  {!isInsideTrim && (
                    <span className="text-[11px] font-medium text-amber-300 bg-black/70 px-2 py-0.5 rounded border border-amber-500/40">
                      Outside Trim Range
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-2 max-w-sm">
              <p className="text-sm font-medium text-[#D5DCE8]">No clips on timeline</p>
              <p className="text-xs text-[#7E899D]">
                Upload a local video file, import a clip from Google Drive, or add footage from the Media Bin.
              </p>
            </div>
          )}
        </div>

        {/* Transport & Precision Trim Control Deck */}
        <div className="border-t border-[#1E2430] bg-[#11151D] px-4 py-2.5 space-y-2.5 shrink-0">
          {/* Row 1: Primary Transport Controls */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Timecode Readout */}
            <div className="flex items-baseline gap-2 min-w-[165px]">
              <span className="text-base font-semibold font-mono-tc text-amber-400 tracking-tight">
                {formatTimecode(sequenceTime, fps)}
              </span>
              <span className="text-[11px] font-mono-tc text-[#7D889C]">
                {fps} fps
              </span>
            </div>

            {/* Playback Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onJumpToStart}
                title="Jump to Start (Home)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#B2BCCB] hover:text-white hover:bg-[#1C2230] transition-colors"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onStepFrame(-1)}
                title="Step Back 1 Frame (Left Arrow)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#B2BCCB] hover:text-white hover:bg-[#1C2230] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                title="Play / Pause (Space)"
                className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => onStepFrame(1)}
                title="Step Forward 1 Frame (Right Arrow)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#B2BCCB] hover:text-white hover:bg-[#1C2230] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onJumpToEnd}
                title="Jump to End (End)"
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#B2BCCB] hover:text-white hover:bg-[#1C2230] transition-colors"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <div className="w-px h-5 bg-[#262D3B] mx-1.5" />

              <button
                type="button"
                onClick={onToggleLoopTrim}
                title="Loop Active Trim Range (L)"
                className={`h-8 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                  loopTrim
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : 'bg-[#171C26] border-[#262D3B] text-[#9BA5B7] hover:text-white'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                Loop Trim
              </button>
            </div>

            {/* Playback Rate & Audio */}
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-[#161B25] rounded-md p-0.5 border border-[#242B3A]">
                {RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onChangePlaybackRate(rate)}
                    className={`px-2 py-1 text-[11px] font-mono-tc rounded transition-colors ${
                      (activeClip?.playbackRate ?? 1) === rate
                        ? 'bg-[#262E3F] text-amber-300 font-medium'
                        : 'text-[#8994A7] hover:text-[#E5E9F0]'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-[#9BA5B7] hover:text-white hover:bg-[#1C2230] transition-colors"
                  aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                >
                  {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                  aria-label="Master Volume"
                  className="w-16 accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Dedicated Precision Trim Controls */}
          <div className="pt-2 border-t border-[#1D2330] flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={onSetTrimInAtPlayhead}
                disabled={!activeClip}
                className="h-8 px-3 rounded-md bg-[#181E2A] hover:bg-[#222A3A] border border-[#2B3447] text-xs font-medium text-[#E8EDF5] transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Set In (I)
              </button>
              <button
                type="button"
                onClick={onSetTrimOutAtPlayhead}
                disabled={!activeClip}
                className="h-8 px-3 rounded-md bg-[#181E2A] hover:bg-[#222A3A] border border-[#2B3447] text-xs font-medium text-[#E8EDF5] transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Set Out (O)
              </button>
              <button
                type="button"
                onClick={onSplitAtPlayhead}
                disabled={!activeClip}
                className="h-8 px-3 rounded-md bg-[#181E2A] hover:bg-[#222A3A] border border-[#2B3447] text-xs font-medium text-[#E8EDF5] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                <Scissors className="w-3.5 h-3.5 text-amber-400" />
                Split Clip (S)
              </button>
              <button
                type="button"
                onClick={onResetTrim}
                disabled={!activeClip}
                className="h-8 px-2.5 rounded-md text-xs font-medium text-[#9BA5B7] hover:text-white hover:bg-[#1B212E] inline-flex items-center gap-1 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Trim
              </button>

              <div className="w-px h-5 bg-[#262D3B] mx-1" />

              <button
                type="button"
                onClick={onRunAutoEdit}
                disabled={!activeClip || isAutoEditing}
                title="Automatically trim, color-enhance, mark, and caption your sequence in one click"
                className="h-8 px-3 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/45 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5 transition-colors disabled:opacity-45 whitespace-nowrap"
              >
                {isAutoEditing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isAutoEditing ? 'Auto Editing...' : 'Auto Edit'}
              </button>

              {canUndoAutoEdit && !isAutoEditing && (
                <button
                  type="button"
                  onClick={onUndoAutoEdit}
                  title="Revert sequence to before One-Click Auto Edit"
                  className="h-8 px-2.5 rounded-md bg-[#181E2A] hover:bg-[#222A3A] border border-[#2B3447] text-xs font-medium text-[#C5CDDB] hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Undo Auto
                </button>
              )}
            </div>

            {/* Numeric Trim IN / OUT Fine Nudgers */}
            {activeClip && (
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1 bg-[#151A24] border border-[#252D3D] rounded-md px-2 py-1">
                  <button
                    type="button"
                    onClick={onJumpToTrimIn}
                    className="text-[#8E99AD] hover:text-amber-300 font-medium mr-1"
                    title="Jump to Trim In"
                  >
                    In
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeIn(-0.1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#232B3B] text-[#C5CDDB]"
                    aria-label="Decrease Trim In by 0.1s"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-mono-tc text-[#F3F5F8] min-w-[48px] text-center">
                    {formatShortSec(activeClip.trimStartSec)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleNudgeIn(0.1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#232B3B] text-[#C5CDDB]"
                    aria-label="Increase Trim In by 0.1s"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-[#151A24] border border-[#252D3D] rounded-md px-2 py-1">
                  <button
                    type="button"
                    onClick={onJumpToTrimOut}
                    className="text-[#8E99AD] hover:text-amber-300 font-medium mr-1"
                    title="Jump to Trim Out"
                  >
                    Out
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeOut(-0.1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#232B3B] text-[#C5CDDB]"
                    aria-label="Decrease Trim Out by 0.1s"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-mono-tc text-[#F3F5F8] min-w-[48px] text-center">
                    {formatShortSec(activeClip.trimEndSec)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleNudgeOut(0.1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-[#232B3B] text-[#C5CDDB]"
                    aria-label="Increase Trim Out by 0.1s"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="text-[#9BA5B7] font-mono-tc whitespace-nowrap">
                  Kept <span className="text-amber-400 font-semibold">{formatShortSec(trimDuration)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }
);
