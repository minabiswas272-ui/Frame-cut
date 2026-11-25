import React, { useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Copy,
  Magnet,
  Scissors,
  Share2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  formatShortSec,
  formatTimecode,
  type TimelineClip,
  type TimelineMarker,
} from '../types/editor';

interface TimelinePanelProps {
  clips: TimelineClip[];
  markers: TimelineMarker[];
  selectedClipId: string | null;
  playheadSec: number;
  fps: 24 | 30 | 60;
  snapEnabled: boolean;
  onSelectClip: (clipId: string) => void;
  onSeek: (sec: number) => void;
  onUpdateClipTrim: (clipId: string, trimStartSec: number, trimEndSec: number) => void;
  onSplitAtPlayhead: () => void;
  onDuplicateSelectedClip: () => void;
  onDeleteSelectedClip: () => void;
  onAddMarkerAtPlayhead: () => void;
  onDeleteMarker: (markerId: string) => void;
  onToggleSnap: () => void;
  onOpenExport: () => void;
}

const TRACK_HEADER_WIDTH = 96;

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  clips,
  markers,
  selectedClipId,
  playheadSec,
  fps,
  snapEnabled,
  onSelectClip,
  onSeek,
  onUpdateClipTrim,
  onSplitAtPlayhead,
  onDuplicateSelectedClip,
  onDeleteSelectedClip,
  onAddMarkerAtPlayhead,
  onDeleteMarker,
  onToggleSnap,
  onOpenExport,
}) => {
  const [pixelsPerSec, setPixelsPerSec] = useState<number>(36);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const trackLaneRef = useRef<HTMLDivElement | null>(null);
  const [trimDragReadout, setTrimDragReadout] = useState<{
    clipId: string;
    edge: 'in' | 'out';
    valueSec: number;
  } | null>(null);

  // Compute sequential layout using full clip durations so trim handles sit visibly inside each clip block
  const clipLayouts = useMemo(() => {
    let cursor = 0;
    return clips.map((clip) => {
      const startOffsetSec = cursor;
      const endOffsetSec = cursor + clip.durationSec;
      cursor = endOffsetSec;
      return {
        clip,
        startOffsetSec,
        endOffsetSec,
      };
    });
  }, [clips]);

  const totalSourceDuration = useMemo(
    () => clips.reduce((acc, c) => acc + c.durationSec, 0),
    [clips]
  );

  const totalTrimmedDuration = useMemo(
    () => clips.reduce((acc, c) => acc + Math.max(0.1, c.trimEndSec - c.trimStartSec), 0),
    [clips]
  );

  const timelineWidthPx = Math.max(920, Math.ceil((totalSourceDuration + 4) * pixelsPerSec));

  const rulerTicks = useMemo(() => {
    const step = pixelsPerSec >= 64 ? 1 : pixelsPerSec >= 34 ? 2 : 5;
    const maxSec = Math.ceil(totalSourceDuration + 4);
    const ticks: number[] = [];
    for (let t = 0; t <= maxSec; t += step) {
      ticks.push(t);
    }
    return { step, ticks };
  }, [pixelsPerSec, totalSourceDuration]);

  const snapValue = (sec: number) => {
    if (!snapEnabled) return Number(sec.toFixed(2));
    return Math.round(sec * 4) / 4; // snap to 0.25s grid
  };

  const clientXToTimelineSec = (clientX: number) => {
    const lane = trackLaneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left);
    const raw = x / pixelsPerSec;
    return Math.max(0, Math.min(totalSourceDuration, raw));
  };

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const sec = clientXToTimelineSec(e.clientX);
    onSeek(snapEnabled ? snapValue(sec) : sec);
  };

  const handleRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const sec = clientXToTimelineSec(e.clientX);
    onSeek(snapEnabled ? snapValue(sec) : sec);
  };

  const startTrimDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    clip: TimelineClip,
    clipStartOffsetSec: number,
    edge: 'in' | 'out'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clip.id);

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const initialTrimStart = clip.trimStartSec;
    const initialTrimEnd = clip.trimEndSec;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pixelsPerSec;
      if (edge === 'in') {
        const raw = initialTrimStart + deltaSec;
        const clamped = Math.max(0, Math.min(initialTrimEnd - 0.25, snapValue(raw)));
        onUpdateClipTrim(clip.id, clamped, initialTrimEnd);
        onSeek(clipStartOffsetSec + clamped);
        setTrimDragReadout({ clipId: clip.id, edge: 'in', valueSec: clamped });
      } else {
        const raw = initialTrimEnd + deltaSec;
        const clamped = Math.min(
          clip.durationSec,
          Math.max(initialTrimStart + 0.25, snapValue(raw))
        );
        onUpdateClipTrim(clip.id, initialTrimStart, clamped);
        onSeek(clipStartOffsetSec + clamped);
        setTrimDragReadout({ clipId: clip.id, edge: 'out', valueSec: clamped });
      }
    };

    const onUp = () => {
      setTrimDragReadout(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleFitTimeline = () => {
    const scroller = scrollContainerRef.current;
    if (!scroller || totalSourceDuration <= 0) return;
    const usableWidth = Math.max(480, scroller.clientWidth - TRACK_HEADER_WIDTH - 32);
    const nextZoom = Math.max(18, Math.min(120, Math.floor(usableWidth / (totalSourceDuration + 1))));
    setPixelsPerSec(nextZoom);
  };

  const markerColorClasses: Record<TimelineMarker['color'], string> = {
    amber: 'bg-amber-400 text-neutral-950 border-amber-300',
    sky: 'bg-sky-400 text-neutral-950 border-sky-300',
    emerald: 'bg-emerald-400 text-neutral-950 border-emerald-300',
    rose: 'bg-rose-400 text-white border-rose-300',
  };

  return (
    <section
      aria-label="Multi-track video timeline"
      className="h-[268px] shrink-0 border-t border-[#222836] bg-[#0E1117] flex flex-col select-none"
    >
      {/* Timeline Toolbar */}
      <div className="h-10 px-4 border-b border-[#1E2430] bg-[#121620] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={!selectedClipId}
            className="h-7 px-2.5 rounded-md bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            Split
          </button>

          <button
            type="button"
            onClick={onAddMarkerAtPlayhead}
            className="h-7 px-2.5 rounded-md bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-xs font-medium text-[#E5E9F0] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-sky-400" />
            Marker (M)
          </button>

          <button
            type="button"
            onClick={onDuplicateSelectedClip}
            disabled={!selectedClipId}
            className="h-7 px-2.5 rounded-md bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-xs font-medium text-[#C5CDDB] inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </button>

          <button
            type="button"
            onClick={onDeleteSelectedClip}
            disabled={!selectedClipId}
            className="h-7 px-2.5 rounded-md bg-[#1A202D] hover:bg-rose-950/60 border border-[#2B3345] hover:border-rose-500/40 text-xs font-medium text-[#C5CDDB] hover:text-rose-300 inline-flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>

          <div className="w-px h-4 bg-[#262D3B] mx-1" />

          <button
            type="button"
            onClick={onToggleSnap}
            className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
              snapEnabled
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-[#171C26] border-[#262D3B] text-[#8E99AD] hover:text-white'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            Snap
          </button>
        </div>

        {/* Summary & Zoom Controls */}
        <div className="flex items-center gap-4 text-xs text-[#9BA5B7]">
          <div className="hidden lg:flex items-center gap-2 font-mono-tc whitespace-nowrap">
            <span>{clips.length} {clips.length === 1 ? 'clip' : 'clips'}</span>
            <span aria-hidden="true" className="text-[#454E61]">·</span>
            <span>Kept {formatShortSec(totalTrimmedDuration)}</span>
            <span aria-hidden="true" className="text-[#454E61]">·</span>
            <span>Source {formatShortSec(totalSourceDuration)}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPixelsPerSec((z) => Math.max(16, z - 8))}
              className="p-1 text-[#9BA5B7] hover:text-white rounded"
              aria-label="Zoom out timeline"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={16}
              max={120}
              step={2}
              value={pixelsPerSec}
              onChange={(e) => setPixelsPerSec(Number(e.target.value))}
              aria-label="Timeline zoom"
              className="w-24 accent-amber-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setPixelsPerSec((z) => Math.min(120, z + 8))}
              className="p-1 text-[#9BA5B7] hover:text-white rounded"
              aria-label="Zoom in timeline"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitTimeline}
              className="h-6 px-2 rounded bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-[11px] font-medium text-[#D5DCE8]"
            >
              Fit
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenExport}
            className="h-7 px-2.5 rounded-md bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-xs font-medium text-amber-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Share2 className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Scrollable Multi-Track Grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-x-auto overflow-y-hidden flex relative">
        {/* Sticky Left Track Labels */}
        <div
          style={{ width: TRACK_HEADER_WIDTH }}
          className="shrink-0 sticky left-0 z-30 bg-[#10141D] border-r border-[#222836] flex flex-col"
        >
          <div className="h-7 border-b border-[#1E2430] px-3 flex items-center text-[11px] font-mono-tc text-[#7D889C]">
            TC
          </div>
          <div className="h-8 border-b border-[#1E2430] px-3 flex items-center justify-between text-xs text-[#9BA5B7]">
            <span className="font-medium text-[#C8D0DF]">M1</span>
            <span className="text-[11px] text-[#6F7A8E]">Markers</span>
          </div>
          <div className="h-[88px] border-b border-[#1E2430] px-3 flex flex-col justify-center">
            <span className="text-xs font-semibold text-[#F3F5F8]">V1</span>
            <span className="text-[11px] text-[#7D889C]">Video / Trim</span>
          </div>
          <div className="flex-1 px-3 flex flex-col justify-center">
            <span className="text-xs font-semibold text-[#C8D0DF]">A1</span>
            <span className="text-[11px] text-[#7D889C]">Audio</span>
          </div>
        </div>

        {/* Right Scrollable Track Lanes */}
        <div
          ref={trackLaneRef}
          style={{ width: timelineWidthPx }}
          className="relative flex flex-col shrink-0 bg-[#0B0E14]"
        >
          {/* Time Ruler (Click & Drag to Scrub) */}
          <div
            onPointerDown={handleRulerPointerDown}
            onPointerMove={handleRulerPointerMove}
            className="h-7 border-b border-[#1E2430] bg-[#11151E] relative cursor-ew-resize"
          >
            {rulerTicks.ticks.map((sec) => (
              <div
                key={sec}
                style={{ left: sec * pixelsPerSec }}
                className="absolute top-0 bottom-0 border-l border-[#2B3345] pl-1.5 flex items-center pointer-events-none"
              >
                <span className="text-[10px] font-mono-tc text-[#7E899E]">
                  {formatTimecode(sec, fps).slice(3, 8)}
                </span>
              </div>
            ))}
          </div>

          {/* M1 Markers Track */}
          <div
            onPointerDown={handleRulerPointerDown}
            className="h-8 border-b border-[#1A202C] bg-[#0D1017] relative"
          >
            {markers.map((marker) => (
              <div
                key={marker.id}
                style={{ left: marker.timeSec * pixelsPerSec }}
                className="absolute top-1.5 -translate-x-1/2 z-20 group flex items-center"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(marker.timeSec);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onDeleteMarker(marker.id);
                  }}
                  title={`${marker.label} (${formatShortSec(marker.timeSec)}) — Double-click to remove`}
                  className={`h-5 px-1.5 rounded text-[10px] font-medium border shadow-sm whitespace-nowrap max-w-[140px] truncate transition-transform hover:scale-105 ${
                    markerColorClasses[marker.color]
                  }`}
                >
                  {marker.label}
                </button>
              </div>
            ))}
          </div>

          {/* V1 Video & Precision Trim Track */}
          <div className="h-[88px] border-b border-[#1A202C] relative bg-[#0B0E14]">
            {clipLayouts.map(({ clip, startOffsetSec }) => {
              const widthPx = Math.max(44, clip.durationSec * pixelsPerSec);
              const leftPx = startOffsetSec * pixelsPerSec;
              const isSelected = clip.id === selectedClipId;
              const trimLeftPx = clip.trimStartSec * pixelsPerSec;
              const trimRightPx = Math.max(0, (clip.durationSec - clip.trimEndSec) * pixelsPerSec);
              const activeTrimWidthPx = Math.max(12, widthPx - trimLeftPx - trimRightPx);

              return (
                <div
                  key={clip.id}
                  style={{ left: leftPx, width: widthPx }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                    const clickedSec = clientXToTimelineSec(e.clientX);
                    onSeek(clickedSec);
                  }}
                  className={`absolute top-2 bottom-2 rounded-md overflow-hidden border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-amber-400/70 bg-[#171C28] z-10'
                      : 'border-[#273042] bg-[#131822] hover:border-[#39455D]'
                  }`}
                >
                  {/* Filmstrip Thumbnail Background */}
                  <div
                    className="absolute inset-0 opacity-45 bg-repeat-x bg-center"
                    style={{
                      backgroundImage: `url(${clip.posterUrl})`,
                      backgroundSize: 'auto 100%',
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/60" />

                  {/* Trimmed-Out Left Region (Hatched) */}
                  {trimLeftPx > 1 && (
                    <div
                      style={{ width: trimLeftPx }}
                      className="absolute left-0 top-0 bottom-0 trim-excluded-hatch border-r border-amber-500/30 pointer-events-none"
                    />
                  )}

                  {/* Trimmed-Out Right Region (Hatched) */}
                  {trimRightPx > 1 && (
                    <div
                      style={{ width: trimRightPx }}
                      className="absolute right-0 top-0 bottom-0 trim-excluded-hatch border-l border-amber-500/30 pointer-events-none"
                    />
                  )}

                  {/* Active Kept Trim Bracket */}
                  <div
                    style={{ left: trimLeftPx, width: activeTrimWidthPx }}
                    className={`absolute top-0 bottom-0 pointer-events-none border-y-2 ${
                      isSelected ? 'border-amber-400' : 'border-amber-500/45'
                    }`}
                  />

                  {/* Clip Title & Trimmed Length */}
                  <div
                    style={{ left: Math.max(8, trimLeftPx + 12), right: Math.max(8, trimRightPx + 12) }}
                    className="absolute top-1.5 flex items-center justify-between gap-2 pointer-events-none"
                  >
                    <span className="text-[11px] font-medium text-[#F3F5F8] truncate drop-shadow">
                      {clip.title}
                    </span>
                    <span className="text-[10px] font-mono-tc text-amber-300 shrink-0 drop-shadow">
                      {formatShortSec(clip.trimEndSec - clip.trimStartSec)}
                    </span>
                  </div>

                  {/* Draggable Left Trim IN Handle */}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`Trim In handle for ${clip.title}`}
                    aria-valuemin={0}
                    aria-valuemax={clip.trimEndSec}
                    aria-valuenow={clip.trimStartSec}
                    style={{ left: Math.max(0, trimLeftPx - 5) }}
                    onPointerDown={(e) => startTrimDrag(e, clip, startOffsetSec, 'in')}
                    className={`absolute top-0 bottom-0 w-3 z-20 cursor-ew-resize flex items-center justify-center group ${
                      isSelected ? 'bg-amber-400 hover:bg-amber-300' : 'bg-amber-500/75 hover:bg-amber-400'
                    }`}
                  >
                    <div className="w-0.5 h-5 rounded-full bg-neutral-950/75" />
                    {trimDragReadout?.clipId === clip.id && trimDragReadout.edge === 'in' && (
                      <div className="absolute -top-7 left-0 px-1.5 py-0.5 rounded bg-neutral-950 border border-amber-400 text-[10px] font-mono-tc text-amber-300 whitespace-nowrap shadow-lg">
                        IN {formatShortSec(trimDragReadout.valueSec)}
                      </div>
                    )}
                  </div>

                  {/* Draggable Right Trim OUT Handle */}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={`Trim Out handle for ${clip.title}`}
                    aria-valuemin={clip.trimStartSec}
                    aria-valuemax={clip.durationSec}
                    aria-valuenow={clip.trimEndSec}
                    style={{ right: Math.max(0, trimRightPx - 5) }}
                    onPointerDown={(e) => startTrimDrag(e, clip, startOffsetSec, 'out')}
                    className={`absolute top-0 bottom-0 w-3 z-20 cursor-ew-resize flex items-center justify-center group ${
                      isSelected ? 'bg-amber-400 hover:bg-amber-300' : 'bg-amber-500/75 hover:bg-amber-400'
                    }`}
                  >
                    <div className="w-0.5 h-5 rounded-full bg-neutral-950/75" />
                    {trimDragReadout?.clipId === clip.id && trimDragReadout.edge === 'out' && (
                      <div className="absolute -top-7 right-0 px-1.5 py-0.5 rounded bg-neutral-950 border border-amber-400 text-[10px] font-mono-tc text-amber-300 whitespace-nowrap shadow-lg">
                        OUT {formatShortSec(trimDragReadout.valueSec)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* A1 Synchronized Audio Waveform Track */}
          <div className="flex-1 relative bg-[#0A0D12]">
            {clipLayouts.map(({ clip, startOffsetSec }) => {
              const widthPx = Math.max(44, clip.durationSec * pixelsPerSec);
              const leftPx = startOffsetSec * pixelsPerSec;
              const trimStartRatio = clip.durationSec > 0 ? clip.trimStartSec / clip.durationSec : 0;
              const trimEndRatio = clip.durationSec > 0 ? clip.trimEndSec / clip.durationSec : 1;

              return (
                <div
                  key={`audio-${clip.id}`}
                  style={{ left: leftPx, width: widthPx }}
                  onClick={() => onSelectClip(clip.id)}
                  className="absolute top-1.5 bottom-1.5 rounded bg-[#121822] border border-[#202939] px-1 flex items-center gap-[2px] overflow-hidden cursor-pointer"
                >
                  {clip.waveform.map((amp, idx) => {
                    const ratio = (idx + 0.5) / clip.waveform.length;
                    const inside = ratio >= trimStartRatio && ratio <= trimEndRatio;
                    const heightPct = Math.max(12, Math.round(amp * clip.volume * 88));
                    return (
                      <div
                        key={idx}
                        style={{ height: `${heightPct}%` }}
                        className={`flex-1 rounded-full transition-colors ${
                          inside ? 'bg-sky-400/75' : 'bg-[#2C3547]/55'
                        }`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Playhead Needle Spanning All Lanes */}
          <div
            style={{ transform: `translateX(${playheadSec * pixelsPerSec}px)` }}
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-30 will-change-transform"
          >
            <div className="w-3 h-3 -ml-[5.5px] bg-amber-400 rotate-45 -mt-1.5 shadow" />
            <div className="w-[1.5px] h-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.55)]" />
          </div>
        </div>
      </div>
    </section>
  );
};
