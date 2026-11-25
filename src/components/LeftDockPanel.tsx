import React, { useRef, useState } from 'react';
import {
  BookmarkPlus,
  Download,
  ExternalLink,
  Film,
  FolderUp,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  formatShortSec,
  STARTER_CLIPS,
  type AutoEditOptions,
  type AutoEditReport,
  type CaptionCue,
  type CaptionStyle,
  type ColorGrade,
  type DriveFileItem,
  type GeminiQuickEditResult,
  type GeminiResearchResult,
  type GeminiSceneAnalysis,
  type TimelineClip,
} from '../types/editor';
import { AutoEditPanel } from './AutoEditPanel';
import { CaptionsPanel, type ExtractedAudioPreview } from './CaptionsPanel';
import { GoogleSignInButton } from './GoogleSignInButton';

export type LeftDockTab = 'media' | 'drive' | 'captions' | 'ai' | 'research';

interface LeftDockPanelProps {
  activeTab: LeftDockTab;
  clips: TimelineClip[];
  selectedClip: TimelineClip | null;
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
  isSignedIn: boolean;
  hasDriveToken: boolean;
  isSigningIn: boolean;
  driveFiles: DriveFileItem[];
  driveLoading: boolean;
  driveError: string | null;
  importingDriveId: string | null;
  onSignIn: () => void;
  onUploadLocalFile: (file: File) => void;
  onAddStarterClip: (clip: TimelineClip) => void;
  onSelectClip: (clipId: string) => void;
  onRefreshDrive: (query?: string) => void;
  onImportDriveVideo: (file: DriveFileItem) => void;
  onRequestUploadProjectToDrive: () => void;
  onRequestDeleteDriveFile: (file: DriveFileItem) => void;
  onRunQuickEdit: (task: string) => Promise<GeminiQuickEditResult | null>;
  onRunSceneAnalysis: (focusNote: string) => Promise<GeminiSceneAnalysis | null>;
  onRunResearch: (query: string) => Promise<GeminiResearchResult | null>;
  onApplySuggestedTrim: (trimIn: number, trimOut: number) => void;
  onApplySuggestedGrade: (grade: ColorGrade) => void;
  onApplySuggestedMarkers: (markers: Array<{ label: string; timeSec: number; notes: string }>) => void;
  onSaveResearchNote: (content: string) => void;
  autoEditOptions: AutoEditOptions;
  isAutoEditing: boolean;
  autoEditStage: string;
  autoEditProgress: number;
  autoEditError: string | null;
  autoEditReport: AutoEditReport | null;
  canUndoAutoEdit: boolean;
  onChangeAutoEditOptions: (patch: Partial<AutoEditOptions>) => void;
  onRunAutoEdit: () => void;
  onImportAndAutoEdit: (file: File) => void;
  onUndoAutoEdit: () => void;
  onReplayAutoCut: () => void;
  onOpenExport: () => void;
}

const RESEARCH_PRESETS = [
  'YouTube 4K 24fps H.264 recommended upload bitrate & audio LUFS',
  'Instagram Reels & YouTube Shorts 9:16 title safe zone margins',
  'Broadcast documentary stereo loudness standard EBU R128 vs ATSC A/85',
];

export const LeftDockPanel: React.FC<LeftDockPanelProps> = ({
  activeTab,
  clips,
  selectedClip,
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
  isSignedIn,
  hasDriveToken,
  isSigningIn,
  driveFiles,
  driveLoading,
  driveError,
  importingDriveId,
  onSignIn,
  onUploadLocalFile,
  onAddStarterClip,
  onSelectClip,
  onRefreshDrive,
  onImportDriveVideo,
  onRequestUploadProjectToDrive,
  onRequestDeleteDriveFile,
  onRunQuickEdit,
  onRunSceneAnalysis,
  onRunResearch,
  onApplySuggestedTrim,
  onApplySuggestedGrade,
  onApplySuggestedMarkers,
  onSaveResearchNote,
  autoEditOptions,
  isAutoEditing,
  autoEditStage,
  autoEditProgress,
  autoEditError,
  autoEditReport,
  canUndoAutoEdit,
  onChangeAutoEditOptions,
  onRunAutoEdit,
  onImportAndAutoEdit,
  onUndoAutoEdit,
  onReplayAutoCut,
  onOpenExport,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [driveSearch, setDriveSearch] = useState('');
  const [aiSubTab, setAiSubTab] = useState<'auto' | 'manual'>('auto');

  // Gemini AI state
  const [quickTask, setQuickTask] = useState('Tighten intro pacing and add chapter markers');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickResult, setQuickResult] = useState<GeminiQuickEditResult | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  const [sceneFocus, setSceneFocus] = useState('');
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneResult, setSceneResult] = useState<GeminiSceneAnalysis | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // Google Search Grounding Research state
  const [researchQuery, setResearchQuery] = useState('');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResult, setResearchResult] = useState<GeminiResearchResult | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    Array.from(files).forEach((file) => onUploadLocalFile(file));
    e.target.value = '';
  };

  const handleQuickEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickLoading(true);
    setQuickError(null);
    try {
      const res = await onRunQuickEdit(quickTask);
      if (res) setQuickResult(res);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Unable to generate edit suggestions.');
    } finally {
      setQuickLoading(false);
    }
  };

  const handleSceneAnalyze = async () => {
    setSceneLoading(true);
    setSceneError(null);
    try {
      const res = await onRunSceneAnalysis(sceneFocus);
      if (res) setSceneResult(res);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : 'Unable to analyze active frame.');
    } finally {
      setSceneLoading(false);
    }
  };

  const handleResearchSubmit = async (queryText: string) => {
    const clean = queryText.trim();
    if (!clean) return;
    setResearchQuery(clean);
    setResearchLoading(true);
    setResearchError(null);
    try {
      const res = await onRunResearch(clean);
      if (res) setResearchResult(res);
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : 'Search research failed.');
    } finally {
      setResearchLoading(false);
    }
  };

  return (
    <aside className="w-[316px] shrink-0 border-r border-[#1E2430] bg-[#10131A] flex flex-col overflow-hidden">
      {/* MEDIA BIN */}
      {activeTab === 'media' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-[#1E2430] space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">Media Bin</h2>
              <span className="text-xs font-mono-tc text-[#7D889C]">{clips.length} in sequence</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-3 rounded-lg border border-dashed border-[#343E52] hover:border-amber-500/60 bg-[#141923] hover:bg-[#19202D] text-xs font-medium text-[#E5E9F0] flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4 text-amber-400" />
              Import Local Video (.mp4, .mov, .webm)
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Active Sequence Clips */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#9BA5B7]">Sequence Clips</p>
              {clips.length === 0 ? (
                <p className="text-xs text-[#6E788B] py-3">
                  Timeline is empty. Import a video file or add footage below.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {clips.map((clip) => {
                    const active = selectedClip?.id === clip.id;
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => onSelectClip(clip.id)}
                        className={`w-full text-left p-2 rounded-lg border flex items-center gap-2.5 transition-colors ${
                          active
                            ? 'bg-[#1A202D] border-amber-500/50'
                            : 'bg-[#141821] border-[#212836] hover:border-[#323C50]'
                        }`}
                      >
                        <div className="w-14 h-9 rounded overflow-hidden bg-black shrink-0 border border-[#262E3E]">
                          <img
                            src={clip.posterUrl}
                            alt={clip.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[#F3F5F8] truncate">{clip.title}</p>
                          <p className="text-[11px] font-mono-tc text-[#8590A5] mt-0.5">
                            {formatShortSec(clip.trimEndSec - clip.trimStartSec)} kept /{' '}
                            {formatShortSec(clip.durationSec)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Studio B-Roll Library */}
            <div className="space-y-2 pt-3 border-t border-[#1D2330]">
              <p className="text-xs font-medium text-[#9BA5B7]">Studio Footage Library</p>
              <div className="grid grid-cols-1 gap-2">
                {STARTER_CLIPS.map((reel) => (
                  <div
                    key={reel.id}
                    className="p-2 rounded-lg bg-[#141821] border border-[#202735] flex items-center gap-2.5"
                  >
                    <div className="w-14 h-9 rounded overflow-hidden bg-black shrink-0 border border-[#262E3E]">
                      <img
                        src={reel.posterUrl}
                        alt={reel.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[#DCE2EC] truncate">{reel.title}</p>
                      <p className="text-[11px] font-mono-tc text-[#7B869B]">
                        {formatShortSec(reel.durationSec)} · 4K
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddStarterClip(reel)}
                      title="Append to Timeline"
                      className="w-7 h-7 rounded-md bg-[#1C2332] hover:bg-amber-500 text-[#C9D1E0] hover:text-neutral-950 flex items-center justify-center transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE DRIVE */}
      {activeTab === 'drive' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-[#1E2430] space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">Google Drive</h2>
              {hasDriveToken && (
                <button
                  type="button"
                  onClick={() => onRefreshDrive(driveSearch)}
                  disabled={driveLoading}
                  className="p-1.5 rounded-md text-[#9BA5B7] hover:text-white hover:bg-[#1C2230] transition-colors"
                  title="Refresh Google Drive files"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${driveLoading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            {!isSignedIn || !hasDriveToken ? (
              <div className="space-y-3 py-2">
                <p className="text-xs text-[#9BA5B7] leading-relaxed">
                  Connect your Google account to browse video footage in Google Drive, import clips directly onto the timeline, and back up sequence edits.
                </p>
                <GoogleSignInButton
                  onClick={onSignIn}
                  disabled={isSigningIn}
                  label={isSigningIn ? 'Connecting...' : 'Sign in with Google'}
                  className="w-full"
                />
              </div>
            ) : (
              <div className="space-y-2.5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRefreshDrive(driveSearch);
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={driveSearch}
                    onChange={(e) => setDriveSearch(e.target.value)}
                    placeholder="Search Drive videos..."
                    className="flex-1 min-w-0 h-8 px-2.5 rounded-md bg-[#161B25] border border-[#262E3F] text-xs text-[#F3F5F8] placeholder:text-[#6E788C] focus:outline-none focus:border-amber-500/60"
                  />
                  <button
                    type="submit"
                    className="h-8 px-2.5 rounded-md bg-[#1D2433] hover:bg-[#262F42] text-xs text-[#E5E9F0] flex items-center justify-center"
                    aria-label="Search Drive"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                </form>

                <button
                  type="button"
                  onClick={onRequestUploadProjectToDrive}
                  className="w-full h-8 px-3 rounded-md bg-[#19202E] hover:bg-[#232C3F] border border-[#2B3549] text-xs font-medium text-[#E8EDF5] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FolderUp className="w-3.5 h-3.5 text-amber-400" />
                  Save Sequence EDL to Drive
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {driveError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 leading-relaxed">
                {driveError}
              </div>
            )}

            {hasDriveToken && driveLoading && (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-[#8D98AC]">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                Loading Google Drive media...
              </div>
            )}

            {hasDriveToken && !driveLoading && driveFiles.length === 0 && !driveError && (
              <div className="py-8 text-center space-y-2">
                <HardDrive className="w-5 h-5 text-[#667085] mx-auto" />
                <p className="text-xs text-[#9BA5B7]">
                  No video clips or FrameCut EDL files found in Google Drive.
                </p>
              </div>
            )}

            {hasDriveToken &&
              !driveLoading &&
              driveFiles.map((file) => {
                const isVideo = file.mimeType.startsWith('video/');
                const isImporting = importingDriveId === file.id;
                const sizeMb = file.size ? `${(Number(file.size) / (1024 * 1024)).toFixed(1)} MB` : '';

                return (
                  <div
                    key={file.id}
                    className="p-2.5 rounded-lg bg-[#141821] border border-[#212836] space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[#F3F5F8] truncate">{file.name}</p>
                        <p className="text-[11px] text-[#7D889C] mt-0.5 truncate">
                          {isVideo ? 'Video' : 'FrameCut EDL'}
                          {sizeMb ? ` · ${sizeMb}` : ''}
                        </p>
                      </div>
                      <Film className="w-3.5 h-3.5 text-[#6E788C] shrink-0 mt-0.5" />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isVideo && (
                        <button
                          type="button"
                          onClick={() => onImportDriveVideo(file)}
                          disabled={Boolean(importingDriveId)}
                          className="flex-1 h-7 px-2.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-[11px] font-medium text-amber-300 inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {isImporting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          {isImporting ? 'Importing...' : 'Add to Timeline'}
                        </button>
                      )}

                      {!isVideo && (
                        <button
                          type="button"
                          onClick={() => onRequestDeleteDriveFile(file)}
                          className="h-7 px-2.5 rounded bg-[#1A202D] hover:bg-rose-950/60 border border-[#2A3244] hover:border-rose-500/40 text-[11px] font-medium text-[#B8C1D1] hover:text-rose-300 inline-flex items-center gap-1 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* CAPTIONS & AUDIO EXTRACTION */}
      {activeTab === 'captions' && (
        <CaptionsPanel
          activeClip={selectedClip}
          playheadSec={playheadSec}
          captions={captions}
          captionStyle={captionStyle}
          isTranscribing={isTranscribing}
          transcribeStage={transcribeStage}
          transcribeProgress={transcribeProgress}
          transcribeError={transcribeError}
          extractedAudio={extractedAudio}
          onExtractAndTranscribeActiveClip={onExtractAndTranscribeActiveClip}
          onUploadAndTranscribeFile={onUploadAndTranscribeFile}
          onGenerateVisualCaptions={onGenerateVisualCaptions}
          onUpdateCaptionStyle={onUpdateCaptionStyle}
          onAddCaptionAtPlayhead={onAddCaptionAtPlayhead}
          onUpdateCaption={onUpdateCaption}
          onDeleteCaption={onDeleteCaption}
          onSeek={onSeek}
        />
      )}

      {/* ONE-CLICK AUTO EDITOR & MANUAL AI TOOLS */}
      {activeTab === 'ai' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 border-b border-[#1E2430] shrink-0">
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#151A24] border border-[#242C3D]">
              <button
                type="button"
                onClick={() => setAiSubTab('auto')}
                className={`h-7 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  aiSubTab === 'auto'
                    ? 'bg-[#262E3F] text-[#F3F5F8]'
                    : 'text-[#8994A7] hover:text-[#DCE2EC]'
                }`}
              >
                One-Click Auto
              </button>
              <button
                type="button"
                onClick={() => setAiSubTab('manual')}
                className={`h-7 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  aiSubTab === 'manual'
                    ? 'bg-[#262E3F] text-[#F3F5F8]'
                    : 'text-[#8994A7] hover:text-[#DCE2EC]'
                }`}
              >
                Manual AI Tools
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            {aiSubTab === 'auto' ? (
              <AutoEditPanel
                clipCount={clips.length}
                options={autoEditOptions}
                isRunning={isAutoEditing}
                stage={autoEditStage}
                progress={autoEditProgress}
                error={autoEditError}
                report={autoEditReport}
                canUndo={canUndoAutoEdit}
                onChangeOptions={onChangeAutoEditOptions}
                onRunAutoEdit={onRunAutoEdit}
                onImportAndAutoEdit={onImportAndAutoEdit}
                onUndoAutoEdit={onUndoAutoEdit}
                onReplayCut={onReplayAutoCut}
                onOpenExport={onOpenExport}
                onSeek={onSeek}
              />
            ) : (
              <>
                {/* Fast Timeline Pass (gemini-3.1-flash-lite) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">Quick Trim & Markers</h2>
                    <span className="text-[11px] text-[#7D889C]">Fast Pass</span>
                  </div>

            <form onSubmit={handleQuickEditSubmit} className="space-y-2">
              <textarea
                rows={2}
                value={quickTask}
                onChange={(e) => setQuickTask(e.target.value)}
                placeholder="Describe your pacing goal or cut style..."
                className="w-full p-2.5 rounded-lg bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8] placeholder:text-[#6E788C] focus:outline-none focus:border-amber-500/60 resize-none"
              />
              <button
                type="submit"
                disabled={quickLoading || clips.length === 0}
                className="w-full h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {quickLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {quickLoading ? 'Generating Plan...' : 'Suggest Trims & Markers'}
              </button>
            </form>

            {quickError && (
              <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2.5">
                {quickError}
              </p>
            )}

            {quickResult && (
              <div className="p-3 rounded-lg bg-[#151A24] border border-[#252E40] space-y-2.5 text-xs">
                <p className="font-medium text-[#F3F5F8]">{quickResult.suggestedTitle}</p>
                <p className="text-[#A8B2C5] leading-relaxed">{quickResult.summary}</p>

                <div className="pt-2 border-t border-[#222A3A] space-y-1.5">
                  <div className="flex items-center justify-between font-mono-tc text-[11px] text-amber-300">
                    <span>
                      In {formatShortSec(quickResult.trimSuggestion.trimStartSec)} → Out{' '}
                      {formatShortSec(quickResult.trimSuggestion.trimEndSec)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onApplySuggestedTrim(
                          quickResult.trimSuggestion.trimStartSec,
                          quickResult.trimSuggestion.trimEndSec
                        )
                      }
                      className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-sans font-medium"
                    >
                      Apply Trim
                    </button>
                  </div>
                  <p className="text-[11px] text-[#8E99AD]">
                    {quickResult.trimSuggestion.rationale}
                  </p>
                </div>

                {quickResult.markers.length > 0 && (
                  <div className="pt-2 border-t border-[#222A3A] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#9BA5B7]">
                        {quickResult.markers.length} suggested markers
                      </span>
                      <button
                        type="button"
                        onClick={() => onApplySuggestedMarkers(quickResult.markers)}
                        className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 text-[11px] font-medium"
                      >
                        Add to Timeline
                      </button>
                    </div>
                    <ul className="space-y-1">
                      {quickResult.markers.map((m, idx) => (
                        <li key={idx} className="text-[11px] text-[#C5CDDB] flex justify-between gap-2">
                          <span className="truncate">{m.label}</span>
                          <span className="font-mono-tc text-[#7D889C] shrink-0">
                            {formatShortSec(m.timeSec)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Multimodal Frame Analysis (gemini-4-hydrogen) */}
          <div className="pt-4 border-t border-[#1E2430] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold font-display text-[#F3F5F8]">Frame & Color Critique</h3>
              <span className="text-[11px] text-[#7D889C]">Vision</span>
            </div>

            <input
              type="text"
              value={sceneFocus}
              onChange={(e) => setSceneFocus(e.target.value)}
              placeholder="Optional focus (e.g. documentary tone, shadow contrast)"
              className="w-full h-8 px-2.5 rounded-md bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8] placeholder:text-[#6E788C] focus:outline-none focus:border-amber-500/60"
            />

            <button
              type="button"
              onClick={handleSceneAnalyze}
              disabled={sceneLoading || !selectedClip}
              className="w-full h-8 px-3 rounded-lg bg-[#1A2130] hover:bg-[#232C40] border border-[#2E384E] text-xs font-medium text-[#F3F5F8] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {sceneLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              )}
              {sceneLoading ? 'Inspecting Active Frame...' : 'Analyze Current Preview Frame'}
            </button>

            {sceneError && (
              <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2.5">
                {sceneError}
              </p>
            )}

            {sceneResult && (
              <div className="p-3 rounded-lg bg-[#151A24] border border-[#252E40] space-y-2.5 text-xs">
                <p className="text-[#DCE2EC] leading-relaxed">{sceneResult.visualAnalysis}</p>
                <p className="text-[11px] text-[#9BA5B7] leading-relaxed">{sceneResult.pacingAdvice}</p>

                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#222A3A]">
                  <button
                    type="button"
                    onClick={() => onApplySuggestedGrade(sceneResult.recommendedColorGrade)}
                    className="px-2.5 py-1 rounded bg-[#21293A] hover:bg-[#2B364C] text-[11px] font-medium text-amber-300"
                  >
                    Apply {sceneResult.recommendedColorGrade} Grade
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onApplySuggestedTrim(
                        sceneResult.recommendedTrimIn,
                        sceneResult.recommendedTrimOut
                      )
                    }
                    className="px-2.5 py-1 rounded bg-[#21293A] hover:bg-[#2B364C] text-[11px] font-medium text-sky-300"
                  >
                    Trim {formatShortSec(sceneResult.recommendedTrimIn)}–
                    {formatShortSec(sceneResult.recommendedTrimOut)}
                  </button>
                </div>

                <p className="text-[11px] text-[#8E99AD] italic">
                  Caption: &ldquo;{sceneResult.captionIdea}&rdquo;
                </p>
              </div>
            )}
          </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* LIVE GOOGLE SEARCH GROUNDING RESEARCH */}
      {activeTab === 'research' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold font-display text-[#F3F5F8]">Production Research</h2>
            <p className="text-xs text-[#8E99AD]">
              Search-grounded delivery specs, loudness rules, and editorial references.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleResearchSubmit(researchQuery);
            }}
            className="space-y-2"
          >
            <div className="flex gap-1.5">
              <input
                type="text"
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                placeholder="Ask about codecs, specs, licensing..."
                className="flex-1 min-w-0 h-8 px-2.5 rounded-md bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8] placeholder:text-[#6E788C] focus:outline-none focus:border-amber-500/60"
              />
              <button
                type="submit"
                disabled={researchLoading || !researchQuery.trim()}
                className="h-8 px-3 rounded-md bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold disabled:opacity-50"
              >
                {researchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
              </button>
            </div>
          </form>

          <div className="space-y-1.5">
            <p className="text-[11px] text-[#7D889C]">Quick Lookups</p>
            {RESEARCH_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void handleResearchSubmit(preset)}
                className="w-full text-left px-2.5 py-2 rounded-md bg-[#141923] hover:bg-[#1B2230] border border-[#212836] text-[11px] text-[#C5CDDB] leading-snug transition-colors"
              >
                {preset}
              </button>
            ))}
          </div>

          {researchError && (
            <p className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2.5">
              {researchError}
            </p>
          )}

          {researchResult && (
            <div className="p-3 rounded-lg bg-[#151A24] border border-[#252E40] space-y-3 text-xs">
              <div className="text-[#DCE2EC] leading-relaxed whitespace-pre-wrap">
                {researchResult.answer}
              </div>

              {researchResult.sources.length > 0 && (
                <div className="pt-2.5 border-t border-[#222A3A] space-y-1.5">
                  <p className="text-[11px] font-medium text-[#9BA5B7]">Sources</p>
                  <ul className="space-y-1">
                    {researchResult.sources.slice(0, 5).map((src, idx) => (
                      <li key={idx}>
                        <a
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 hover:text-amber-200 hover:underline max-w-full"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{src.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  onSaveResearchNote(
                    `${researchQuery}: ${researchResult.answer.slice(0, 320)}`
                  )
                }
                className="w-full h-7 px-2.5 rounded bg-[#1E2534] hover:bg-[#273145] text-[11px] font-medium text-[#E5E9F0] inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-amber-400" />
                Save to Director Notes
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
