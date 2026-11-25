import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Film,
  FolderUp,
  Loader2,
  Subtitles,
  X,
} from 'lucide-react';
import {
  exportTimelineWithFfmpeg,
  type FfmpegExportResult,
} from '../lib/ffmpegClient';
import {
  buildSrtContent,
  formatShortSec,
  formatTimecode,
  type CaptionCue,
  type CaptionStyle,
  type ColorGrade,
  type TimelineClip,
  type TimelineMarker,
  type VideoAdjustments,
} from '../types/editor';

interface ExportModalProps {
  open: boolean;
  projectTitle: string;
  fps: 24 | 30 | 60;
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  clips: TimelineClip[];
  markers: TimelineMarker[];
  hasDriveToken: boolean;
  onClose: () => void;
  onRequestDriveUpload: () => void;
  onRequestDriveVideoUpload: (fileName: string, blob: Blob) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  projectTitle,
  fps,
  colorGrade,
  videoAdjustments,
  bypassFilters,
  captions,
  captionStyle,
  clips,
  markers,
  hasDriveToken,
  onClose,
  onRequestDriveUpload,
  onRequestDriveVideoUpload,
}) => {
  const [copied, setCopied] = useState(false);
  const [exportRes, setExportRes] = useState<'640x360' | '960x540'>('640x360');
  const [exportFps, setExportFps] = useState<12 | 15 | 24>(15);
  const [rendering, setRendering] = useState(false);
  const [renderStage, setRenderStage] = useState('');
  const [renderPct, setRenderPct] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedVideo, setRenderedVideo] = useState<FfmpegExportResult | null>(null);

  useEffect(() => {
    return () => {
      if (renderedVideo?.blobUrl) {
        URL.revokeObjectURL(renderedVideo.blobUrl);
      }
    };
  }, [renderedVideo]);

  if (!open) return null;

  const totalTrimmed = clips.reduce(
    (acc, c) => acc + Math.max(0.1, c.trimEndSec - c.trimStartSec),
    0
  );

  const safeSlug =
    projectTitle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '_')
      .slice(0, 60) || 'sequence';

  const vfParts: string[] = [];
  if (
    !bypassFilters &&
    (videoAdjustments.brightness !== 100 ||
      videoAdjustments.contrast !== 100 ||
      videoAdjustments.saturation !== 100)
  ) {
    const b = ((videoAdjustments.brightness - 100) / 100).toFixed(2);
    const c = (videoAdjustments.contrast / 100).toFixed(2);
    const s = (videoAdjustments.saturation / 100).toFixed(2);
    vfParts.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}`);
  }
  if (!bypassFilters && videoAdjustments.sharpen > 0) {
    const amount = ((videoAdjustments.sharpen / 100) * 1.5).toFixed(2);
    vfParts.push(`unsharp=3:3:${amount}:3:3:0.0`);
  }
  const vfFlag = vfParts.length > 0 ? ` -vf "${vfParts.join(',')}"` : '';

  const ffmpegScript = clips
    .map((clip, i) => {
      const safeFile = clip.title.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dur = Math.max(0.1, clip.trimEndSec - clip.trimStartSec).toFixed(2);
      return `ffmpeg -ss ${clip.trimStartSec.toFixed(2)} -t ${dur} -i "${safeFile}"${vfFlag} -c:v libx264 -r ${fps} -c:a aac "part_${i + 1}.mp4"`;
    })
    .join('\n');

  const handleRenderMp4 = async () => {
    setRendering(true);
    setRenderError(null);
    setRenderStage('Initializing ffmpeg.wasm...');
    setRenderPct(4);
    if (renderedVideo?.blobUrl) {
      URL.revokeObjectURL(renderedVideo.blobUrl);
      setRenderedVideo(null);
    }

    const [width, height] = exportRes === '960x540' ? [960, 540] : [640, 360];
    try {
      const result = await exportTimelineWithFfmpeg({
        clips,
        exportFps,
        width,
        height,
        colorGrade,
        videoAdjustments,
        bypassFilters,
        captions,
        captionStyle,
        onProgress: (stage, pct) => {
          setRenderStage(stage);
          setRenderPct(pct);
        },
      });
      setRenderedVideo(result);
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'Unable to encode MP4 with ffmpeg.wasm.'
      );
    } finally {
      setRendering(false);
    }
  };

  const handleDownloadRenderedMp4 = () => {
    if (!renderedVideo) return;
    const link = document.createElement('a');
    link.href = renderedVideo.blobUrl;
    link.download = `${safeSlug}.mp4`;
    link.click();
  };

  const handleDownloadSrt = () => {
    if (!captions.length) return;
    const blob = new Blob([buildSrtContent(captions)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeSlug}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadEdl = () => {
    const payload = {
      schema: 'framecut-edl-v1',
      exportedAt: new Date().toISOString(),
      projectTitle,
      fps,
      colorGrade,
      videoAdjustments,
      captionStyle,
      captions,
      totalTrimmedDurationSec: Number(totalTrimmed.toFixed(3)),
      clips: clips.map((c, index) => ({
        order: index,
        title: c.title,
        sourceType: c.sourceType,
        durationSec: c.durationSec,
        trimStartSec: c.trimStartSec,
        trimEndSec: c.trimEndSec,
        keptDurationSec: Number((c.trimEndSec - c.trimStartSec).toFixed(3)),
        playbackRate: c.playbackRate,
        volume: c.volume,
      })),
      markers,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeSlug}.framecut.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCommands = async () => {
    try {
      await navigator.clipboard.writeText(ffmpegScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-2xl bg-[#12151C] border border-[#2A3242] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222836]">
          <div>
            <h3
              id="export-modal-title"
              className="text-base font-semibold font-display text-[#F3F5F8]"
            >
              Export Video &amp; Sequence
            </h3>
            <p className="text-xs text-[#8E99AD] mt-0.5">
              {projectTitle} · {clips.length} clips · {formatTimecode(totalTrimmed, fps)} ·{' '}
              {captions.length} captions
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={rendering}
            className="p-1.5 text-[#8E98AB] hover:text-white rounded-md transition-colors disabled:opacity-40"
            aria-label="Close export modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto">
          {/* Real In-Browser ffmpeg.wasm MP4 Render Section */}
          <div className="p-4 rounded-xl bg-[#0E1118] border border-[#242C3D] space-y-3.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold font-display text-[#F3F5F8]">
                  Render MP4 in Browser (ffmpeg.wasm)
                </p>
                <p className="text-xs text-[#8E99AD] mt-0.5">
                  Bakes trim cuts, Canvas color/sharpen filters, and styled captions into an H.264 MP4.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={exportRes}
                  disabled={rendering}
                  onChange={(e) => setExportRes(e.target.value as '640x360' | '960x540')}
                  aria-label="Export resolution"
                  className="h-8 px-2.5 rounded-md bg-[#161B26] border border-[#2B3447] text-xs font-mono-tc text-[#E5E9F0]"
                >
                  <option value="640x360">360p (Fast)</option>
                  <option value="960x540">540p (HD)</option>
                </select>
                <select
                  value={exportFps}
                  disabled={rendering}
                  onChange={(e) => setExportFps(Number(e.target.value) as 12 | 15 | 24)}
                  aria-label="Export framerate"
                  className="h-8 px-2.5 rounded-md bg-[#161B26] border border-[#2B3447] text-xs font-mono-tc text-[#E5E9F0]"
                >
                  <option value={12}>12 fps</option>
                  <option value={15}>15 fps</option>
                  <option value={24}>24 fps</option>
                </select>
              </div>
            </div>

            {rendering && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#C8D0DF]">{renderStage}</span>
                  <span className="font-mono-tc text-amber-400">{renderPct}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#1C2332] overflow-hidden">
                  <div
                    style={{ width: `${renderPct}%` }}
                    className="h-full bg-amber-500 transition-all duration-150"
                  />
                </div>
              </div>
            )}

            {renderError && (
              <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2.5">
                {renderError}
              </p>
            )}

            {renderedVideo && (
              <div className="space-y-3 pt-2 border-t border-[#1E2534]">
                <video
                  controls
                  src={renderedVideo.blobUrl}
                  className="w-full max-h-56 rounded-lg bg-black border border-[#262F42]"
                />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs font-mono-tc text-[#9BA5B7]">
                    {renderedVideo.durationSec}s · {renderedVideo.frameCount} frames ·{' '}
                    {(renderedVideo.sizeBytes / (1024 * 1024)).toFixed(2)} MB MP4
                  </span>
                  <div className="flex items-center gap-2">
                    {hasDriveToken && (
                      <button
                        type="button"
                        onClick={() =>
                          onRequestDriveVideoUpload(`${safeSlug}.mp4`, renderedVideo.blob)
                        }
                        className="h-8 px-3 rounded-md bg-[#1A2130] hover:bg-[#242E42] border border-[#2C364B] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5"
                      >
                        <FolderUp className="w-3.5 h-3.5 text-amber-400" />
                        Save MP4 to Drive
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadRenderedMp4}
                      className="h-8 px-3.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .MP4
                    </button>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleRenderMp4()}
              disabled={rendering || clips.length === 0}
              className="w-full h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-45"
            >
              {rendering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Film className="w-4 h-4" />
              )}
              {rendering
                ? 'Rendering Video...'
                : renderedVideo
                ? 'Re-Render MP4 with ffmpeg.wasm'
                : 'Render MP4 with ffmpeg.wasm'}
            </button>
          </div>

          {/* Trimmed Cut List */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#C8D0DF]">Trimmed Cut Summary</p>
            <div className="border border-[#222937] rounded-lg divide-y divide-[#1E2430] bg-[#0E1118]">
              {clips.map((clip, index) => (
                <div
                  key={clip.id}
                  className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-[#E5E9F0] truncate">
                    {index + 1}. {clip.title}
                  </span>
                  <span className="font-mono-tc text-[#9BA5B7] shrink-0">
                    {formatShortSec(clip.trimStartSec)} → {formatShortSec(clip.trimEndSec)} (
                    <span className="text-amber-400">
                      {formatShortSec(clip.trimEndSec - clip.trimStartSec)}
                    </span>
                    )
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* FFmpeg Command Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[#C8D0DF]">CLI FFmpeg Commands</p>
              <button
                type="button"
                onClick={() => void handleCopyCommands()}
                className="text-xs text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-[#0A0D12] border border-[#222937] text-[11px] font-mono-tc text-[#B7C1D4] overflow-x-auto leading-relaxed">
              {ffmpegScript || '# Add at least one clip to generate trim commands'}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#0E1117] border-t border-[#222836] flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRequestDriveUpload}
              disabled={!hasDriveToken || clips.length === 0 || rendering}
              className="h-8 px-3 rounded-lg bg-[#1A202D] hover:bg-[#232B3C] border border-[#2C3548] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <FolderUp className="w-3.5 h-3.5 text-amber-400" />
              Save EDL to Drive
            </button>

            <button
              type="button"
              onClick={handleDownloadSrt}
              disabled={captions.length === 0}
              className="h-8 px-3 rounded-lg bg-[#1A202D] hover:bg-[#232B3C] border border-[#2C3548] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Subtitles className="w-3.5 h-3.5 text-sky-400" />
              Download .SRT
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadEdl}
              disabled={clips.length === 0}
              className="h-8 px-3 rounded-lg bg-[#1A202D] hover:bg-[#232B3C] border border-[#2C3548] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              EDL (.json)
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={rendering}
              className="h-8 px-3 rounded-lg text-xs font-medium text-[#B8C1D1] hover:text-white transition-colors disabled:opacity-40"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
