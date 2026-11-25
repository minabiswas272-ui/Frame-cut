import React, { useRef } from 'react';
import {
  Check,
  Loader2,
  Play,
  RotateCcw,
  Share2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  formatShortSec,
  type AutoEditOptions,
  type AutoEditReport,
  type AutoEditStyle,
} from '../types/editor';

interface AutoEditPanelProps {
  clipCount: number;
  options: AutoEditOptions;
  isRunning: boolean;
  stage: string;
  progress: number;
  error: string | null;
  report: AutoEditReport | null;
  canUndo: boolean;
  onChangeOptions: (patch: Partial<AutoEditOptions>) => void;
  onRunAutoEdit: () => void;
  onImportAndAutoEdit: (file: File) => void;
  onUndoAutoEdit: () => void;
  onReplayCut: () => void;
  onOpenExport: () => void;
  onSeek: (sec: number) => void;
}

const STYLE_PRESETS: Array<{
  id: AutoEditStyle;
  label: string;
  summary: string;
}> = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    summary: 'Balanced pacing, filmic grade, clean documentary captions',
  },
  {
    id: 'social',
    label: 'Fast Social',
    summary: 'Punchy trims, crisp vivid contrast, bold uppercase captions',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    summary: 'Refined rhythm, subtle polish, structured chapter markers',
  },
  {
    id: 'noir',
    label: 'Moody Noir',
    summary: 'High-contrast mono/cinema look, atmospheric pacing',
  },
];

const AUTOMATION_STEPS: Array<{
  key: 'autoTrim' | 'autoEnhance' | 'autoCaptions' | 'autoMarkers';
  label: string;
}> = [
  { key: 'autoTrim', label: 'Smart Trim IN/OUT' },
  { key: 'autoEnhance', label: 'Color & Canvas FX' },
  { key: 'autoCaptions', label: 'Timed Captions' },
  { key: 'autoMarkers', label: 'Scene Markers' },
];

export const AutoEditPanel: React.FC<AutoEditPanelProps> = ({
  clipCount,
  options,
  isRunning,
  stage,
  progress,
  error,
  report,
  canUndo,
  onChangeOptions,
  onRunAutoEdit,
  onImportAndAutoEdit,
  onUndoAutoEdit,
  onReplayCut,
  onOpenExport,
  onSeek,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activePreset =
    STYLE_PRESETS.find((p) => p.id === options.style) ?? STYLE_PRESETS[0];

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImportAndAutoEdit(file);
    e.target.value = '';
  };

  const savedSec = report
    ? Math.max(0, report.beforeDurationSec - report.afterDurationSec)
    : 0;

  return (
    <div className="space-y-5">
      {/* Header & Single-Click Primary Action */}
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">
            One-Click Auto Video Editor
          </h2>
          <p className="text-xs text-[#8E99AD] leading-relaxed">
            Automatically trims clips, grades color and Canvas filters, places beat markers, and syncs captions in one pass.
          </p>
        </div>

        {/* Style Preset Grid */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-[#9BA5B7]">Edit Style</span>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLE_PRESETS.map((preset) => {
              const selected = options.style === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onChangeOptions({ style: preset.id })}
                  className={`h-8 px-2.5 rounded-md border text-xs font-medium text-left transition-colors whitespace-nowrap truncate disabled:opacity-50 ${
                    selected
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                      : 'bg-[#151A24] border-[#252D3D] text-[#C5CDDB] hover:border-[#344058] hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#7D889C] leading-snug">{activePreset.summary}</p>
        </div>

        {/* Included Automated Passes */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-[#9BA5B7]">Include in Auto Pass</span>
          <div className="grid grid-cols-2 gap-1.5">
            {AUTOMATION_STEPS.map((step) => {
              const checked = options[step.key];
              return (
                <button
                  key={step.key}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onChangeOptions({ [step.key]: !checked })}
                  className={`h-7 px-2 rounded-md border text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-50 ${
                    checked
                      ? 'bg-[#1A2130] border-[#34415A] text-[#E8EDF5]'
                      : 'bg-[#12161F] border-[#202736] text-[#727D91] hover:text-[#A8B2C5]'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${
                      checked
                        ? 'bg-amber-500 border-amber-400 text-neutral-950'
                        : 'border-[#39445A] bg-transparent'
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span className="truncate">{step.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary One-Click Trigger */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={isRunning || clipCount === 0}
            onClick={onRunAutoEdit}
            className="w-full h-10 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            {isRunning ? 'Auto Editing Sequence...' : 'Auto Edit Video'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            type="button"
            disabled={isRunning}
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-8 px-3 rounded-lg bg-[#161B25] hover:bg-[#1E2534] border border-[#2B3447] text-xs font-medium text-[#DCE2EC] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-amber-400" />
            Import Video & Auto Edit
          </button>
        </div>

        {/* Live Progress Readout */}
        {isRunning && (
          <div className="p-3 rounded-lg bg-[#151A24] border border-[#252E40] space-y-2">
            <div className="flex items-center justify-between text-[11px] gap-2">
              <span className="text-[#DCE2EC] truncate">{stage || 'Analyzing timeline...'}</span>
              <span className="font-mono-tc text-amber-300 shrink-0">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#0E1118] overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-200"
                style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/35 text-xs text-rose-200 leading-relaxed">
            {error}
          </div>
        )}
      </div>

      {/* Post-Edit Summary & Controls */}
      {report && !isRunning && (
        <div className="pt-4 border-t border-[#1E2430] space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#F3F5F8] truncate">
                {report.projectTitle}
              </h3>
              <span className="text-[11px] text-emerald-400 font-medium shrink-0">
                Applied
              </span>
            </div>
            <p className="text-xs text-[#9BA5B7] leading-relaxed">{report.editSummary}</p>
          </div>

          {/* Quantitative Before/After Summary */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 py-2.5 border-y border-[#1E2430] text-[11px]">
            <div>
              <p className="text-[#7D889C]">Kept Duration</p>
              <p className="font-mono-tc text-xs font-semibold text-[#F3F5F8] mt-0.5">
                {formatShortSec(report.afterDurationSec)}
                {savedSec > 0.1 && (
                  <span className="text-amber-400 font-normal">
                    {' '}
                    (-{formatShortSec(savedSec)})
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-[#7D889C]">Auto Elements</p>
              <p className="font-mono-tc text-xs font-semibold text-[#F3F5F8] mt-0.5">
                {report.clipsTrimmed} cuts · {report.captionsGenerated} caps
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-[#7D889C]">Grade & Canvas Filters</p>
              <p className="font-mono-tc text-[11px] text-[#DCE2EC] mt-0.5">
                LUT {report.appliedGrade} · B {report.appliedAdjustments.brightness}% · C{' '}
                {report.appliedAdjustments.contrast}% · S {report.appliedAdjustments.saturation}% ·
                Sharp {report.appliedAdjustments.sharpen}%
              </p>
            </div>
          </div>

          {/* Action Row: Replay / Export / Undo */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onReplayCut}
              className="h-8 px-2.5 rounded-md bg-[#1A2130] hover:bg-[#232C40] border border-[#2E384E] text-xs font-medium text-[#F3F5F8] inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 text-amber-400 fill-current" />
              Replay Cut
            </button>
            <button
              type="button"
              onClick={onOpenExport}
              className="h-8 px-2.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-medium text-amber-300 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" />
              Export MP4
            </button>
            {canUndo && (
              <button
                type="button"
                onClick={onUndoAutoEdit}
                className="col-span-2 h-8 px-2.5 rounded-md bg-[#151A24] hover:bg-[#1E2534] border border-[#262E3F] text-xs font-medium text-[#C5CDDB] hover:text-white inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo Auto Edit & Restore Original
              </button>
            )}
          </div>

          {/* Per-Clip Cut Breakdown */}
          {report.clipChanges.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-[#9BA5B7]">
                Automated Clip Cuts ({report.clipChanges.length})
              </p>
              <div className="space-y-1.5">
                {report.clipChanges.map((item) => (
                  <button
                    key={item.clipId}
                    type="button"
                    onClick={() => onSeek(item.startOffsetSec + item.trimStartSec)}
                    className="w-full text-left p-2 rounded-md bg-[#141821] hover:bg-[#1B212E] border border-[#212836] transition-colors space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-[#E8EDF5] truncate">
                        {item.title}
                      </span>
                      <span className="text-[11px] font-mono-tc text-amber-300 shrink-0">
                        {formatShortSec(item.trimStartSec)}–{formatShortSec(item.trimEndSec)}
                        {item.playbackRate !== 1 ? ` · ${item.playbackRate}x` : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#7D889C] leading-snug line-clamp-2">
                      {item.reason}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
