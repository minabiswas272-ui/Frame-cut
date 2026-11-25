import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
} from 'lucide-react';
import {
  formatShortSec,
  formatTimecode,
  type EditNoteDoc,
  type SavedProject,
  type TimelineClip,
  type VideoAdjustments,
} from '../types/editor';
import { GoogleSignInButton } from './GoogleSignInButton';

type InspectorTab = 'clip' | 'projects' | 'notes';

interface RightInspectorPanelProps {
  selectedClip: TimelineClip | null;
  projectTitle: string;
  activeProjectId: number | null;
  fps: 24 | 30 | 60;
  playheadSec: number;
  isSignedIn: boolean;
  isSigningIn: boolean;
  savedProjects: SavedProject[];
  projectsLoading: boolean;
  projectsSaving: boolean;
  projectsError: string | null;
  notes: EditNoteDoc[];
  notesError: string | null;
  onChangeProjectTitle: (title: string) => void;
  onChangeFps: (fps: 24 | 30 | 60) => void;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  onChangeAdjustments: (patch: Partial<VideoAdjustments>) => void;
  onResetAdjustments: () => void;
  onToggleBypassFilters: () => void;
  onUpdateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  onSignIn: () => void;
  onSaveProject: (asNew?: boolean) => void;
  onLoadProject: (project: SavedProject) => void;
  onRequestDeleteProject: (project: SavedProject) => void;
  onAddNote: (content: string, category: EditNoteDoc['category']) => Promise<void>;
  onDeleteNote: (noteId: string) => void;
  onSeek: (sec: number) => void;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  selectedClip,
  projectTitle,
  activeProjectId,
  fps,
  playheadSec,
  isSignedIn,
  isSigningIn,
  savedProjects,
  projectsLoading,
  projectsSaving,
  projectsError,
  notes,
  notesError,
  onChangeProjectTitle,
  onChangeFps,
  videoAdjustments,
  bypassFilters,
  onChangeAdjustments,
  onResetAdjustments,
  onToggleBypassFilters,
  onUpdateClip,
  onSignIn,
  onSaveProject,
  onLoadProject,
  onRequestDeleteProject,
  onAddNote,
  onDeleteNote,
  onSeek,
}) => {
  const [tab, setTab] = useState<InspectorTab>('clip');
  const [noteInput, setNoteInput] = useState('');
  const [noteCategory, setNoteCategory] = useState<EditNoteDoc['category']>('cut');
  const [addingNote, setAddingNote] = useState(false);

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    setAddingNote(true);
    try {
      await onAddNote(noteInput.trim(), noteCategory);
      setNoteInput('');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <aside className="w-[280px] shrink-0 border-l border-[#1E2430] bg-[#10131A] flex flex-col overflow-hidden">
      {/* Segmented Sub-Tab Switcher */}
      <div className="p-2.5 border-b border-[#1E2430] shrink-0">
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#161B25]">
          {(
            [
              { id: 'clip', label: 'Inspector' },
              { id: 'projects', label: 'Projects' },
              { id: 'notes', label: 'Notes' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === item.id
                  ? 'bg-[#252D3E] text-[#F3F5F8] shadow-sm'
                  : 'text-[#8994A7] hover:text-[#D5DCE8]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* CLIP & SEQUENCE INSPECTOR */}
      {tab === 'clip' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Sequence Settings */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#C8D0DF] font-display">Sequence</p>
            <div className="space-y-1.5">
              <label htmlFor="seq-title" className="text-[11px] text-[#8E99AD] block">
                Title
              </label>
              <input
                id="seq-title"
                type="text"
                maxLength={120}
                value={projectTitle}
                onChange={(e) => onChangeProjectTitle(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8] focus:outline-none focus:border-amber-500/60"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-[#8E99AD] block">Framerate</span>
              <div className="grid grid-cols-3 gap-1.5">
                {([24, 30, 60] as const).map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onChangeFps(rate)}
                    className={`h-7 rounded-md text-xs font-mono-tc border transition-colors ${
                      fps === rate
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-medium'
                        : 'bg-[#151A24] border-[#252D3D] text-[#9BA5B7] hover:text-white'
                    }`}
                  >
                    {rate} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Video Enhancements (HTML5 Canvas Filters + 3x3 Sharpen) */}
          <div className="pt-4 border-t border-[#1E2430] space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#C8D0DF] font-display">
                Color &amp; Sharpen
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleBypassFilters}
                  title="Toggle original vs filtered preview"
                  className={`h-6 px-2 rounded text-[11px] font-medium inline-flex items-center gap-1 border transition-colors ${
                    bypassFilters
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'bg-[#161B25] border-[#252D3D] text-[#8E99AD] hover:text-white'
                  }`}
                >
                  {bypassFilters ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {bypassFilters ? 'Raw' : 'FX'}
                </button>
                <button
                  type="button"
                  onClick={onResetAdjustments}
                  disabled={
                    videoAdjustments.brightness === 100 &&
                    videoAdjustments.contrast === 100 &&
                    videoAdjustments.saturation === 100 &&
                    videoAdjustments.sharpen === 0
                  }
                  title="Reset brightness, contrast, saturation, and sharpen"
                  className="h-6 px-2 rounded text-[11px] font-medium text-[#8E99AD] hover:text-white hover:bg-[#1B2230] inline-flex items-center gap-1 transition-colors disabled:opacity-35"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            </div>

            {/* Brightness */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-brightness" className="text-[#9BA5B7]">
                  Brightness
                </label>
                <span className="font-mono-tc text-[#F3F5F8]">
                  {videoAdjustments.brightness}%
                </span>
              </div>
              <input
                id="slider-brightness"
                type="range"
                min={0}
                max={200}
                step={1}
                value={videoAdjustments.brightness}
                onDoubleClick={() => onChangeAdjustments({ brightness: 100 })}
                onChange={(e) => onChangeAdjustments({ brightness: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Contrast */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-contrast" className="text-[#9BA5B7]">
                  Contrast
                </label>
                <span className="font-mono-tc text-[#F3F5F8]">
                  {videoAdjustments.contrast}%
                </span>
              </div>
              <input
                id="slider-contrast"
                type="range"
                min={0}
                max={200}
                step={1}
                value={videoAdjustments.contrast}
                onDoubleClick={() => onChangeAdjustments({ contrast: 100 })}
                onChange={(e) => onChangeAdjustments({ contrast: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Saturation */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-saturation" className="text-[#9BA5B7]">
                  Saturation
                </label>
                <span className="font-mono-tc text-[#F3F5F8]">
                  {videoAdjustments.saturation}%
                </span>
              </div>
              <input
                id="slider-saturation"
                type="range"
                min={0}
                max={200}
                step={1}
                value={videoAdjustments.saturation}
                onDoubleClick={() => onChangeAdjustments({ saturation: 100 })}
                onChange={(e) => onChangeAdjustments({ saturation: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Sharpen */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-sharpen" className="text-[#9BA5B7]">
                  Sharpen
                </label>
                <span className="font-mono-tc text-[#F3F5F8]">
                  {videoAdjustments.sharpen}%
                </span>
              </div>
              <input
                id="slider-sharpen"
                type="range"
                min={0}
                max={100}
                step={1}
                value={videoAdjustments.sharpen}
                onDoubleClick={() => onChangeAdjustments({ sharpen: 0 })}
                onChange={(e) => onChangeAdjustments({ sharpen: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Selected Clip Properties */}
          <div className="pt-4 border-t border-[#1E2430] space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#C8D0DF] font-display">Selected Clip</p>
              <Sliders className="w-3.5 h-3.5 text-[#6F7A8E]" />
            </div>

            {!selectedClip ? (
              <p className="text-xs text-[#7D889C]">
                Select any clip on the V1 timeline to inspect trim boundaries, speed, and audio gain.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[#F3F5F8] break-all">{selectedClip.title}</p>
                  <p className="text-[11px] text-[#7D889C]">
                    {selectedClip.sourceType === 'drive'
                      ? 'Google Drive'
                      : selectedClip.sourceType === 'local'
                      ? 'Local Upload'
                      : 'Studio Reel'}{' '}
                    · {selectedClip.resolutionLabel}
                  </p>
                </div>

                {/* Trim IN Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9BA5B7]">Trim In</span>
                    <span className="font-mono-tc text-[#F3F5F8]">
                      {formatShortSec(selectedClip.trimStartSec)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, Number((selectedClip.trimEndSec - 0.2).toFixed(2)))}
                    step={0.05}
                    value={selectedClip.trimStartSec}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { trimStartSec: parseFloat(e.target.value) })
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                {/* Trim OUT Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9BA5B7]">Trim Out</span>
                    <span className="font-mono-tc text-[#F3F5F8]">
                      {formatShortSec(selectedClip.trimEndSec)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={Math.min(selectedClip.durationSec, Number((selectedClip.trimStartSec + 0.2).toFixed(2)))}
                    max={selectedClip.durationSec}
                    step={0.05}
                    value={selectedClip.trimEndSec}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { trimEndSec: parseFloat(e.target.value) })
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                {/* Audio Gain Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9BA5B7]">Clip Gain</span>
                    <span className="font-mono-tc text-[#F3F5F8]">
                      {Math.round(selectedClip.volume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedClip.volume}
                    onChange={(e) =>
                      onUpdateClip(selectedClip.id, { volume: parseFloat(e.target.value) })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                {/* Trim Summary Grid */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1E2430] text-[11px]">
                  <div>
                    <span className="text-[#7D889C] block">Source Length</span>
                    <span className="font-mono-tc text-[#E5E9F0]">
                      {formatShortSec(selectedClip.durationSec)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#7D889C] block">Kept Duration</span>
                    <span className="font-mono-tc text-amber-300 font-medium">
                      {formatShortSec(selectedClip.trimEndSec - selectedClip.trimStartSec)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CLOUD PROJECTS (PostgreSQL) */}
      {tab === 'projects' && (
        <div className="flex-1 flex flex-col min-h-0 p-4 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold font-display text-[#F3F5F8]">Saved Projects</h3>
            <p className="text-xs text-[#8E99AD] leading-relaxed">
              Store sequences, trim cuts, and timeline markers to your account.
            </p>
          </div>

          {!isSignedIn ? (
            <GoogleSignInButton
              onClick={onSignIn}
              disabled={isSigningIn}
              label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
              className="w-full"
            />
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSaveProject(false)}
                  disabled={projectsSaving}
                  className="flex-1 h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {projectsSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {activeProjectId ? 'Update Project' : 'Save Project'}
                </button>
                {activeProjectId && (
                  <button
                    type="button"
                    onClick={() => onSaveProject(true)}
                    disabled={projectsSaving}
                    className="h-8 px-2.5 rounded-lg bg-[#1A202D] hover:bg-[#232B3C] border border-[#2B3345] text-xs font-medium text-[#D5DCE8] whitespace-nowrap"
                  >
                    Save Copy
                  </button>
                )}
              </div>

              {projectsError && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200">
                  {projectsError}
                </div>
              )}

              {projectsLoading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#8E99AD]">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  Loading projects...
                </div>
              ) : savedProjects.length === 0 ? (
                <div className="py-8 text-center space-y-1.5">
                  <FolderOpen className="w-5 h-5 text-[#667085] mx-auto" />
                  <p className="text-xs text-[#9BA5B7]">No saved projects yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {savedProjects.map((proj) => {
                    const isCurrent = proj.id === activeProjectId;
                    return (
                      <div
                        key={proj.id}
                        className={`p-3 rounded-lg border space-y-2 ${
                          isCurrent
                            ? 'bg-[#19202D] border-amber-500/45'
                            : 'bg-[#141821] border-[#212836]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#F3F5F8] truncate">
                              {proj.title}
                            </p>
                            <p className="text-[11px] font-mono-tc text-[#7D889C] mt-0.5">
                              {proj.clips.length} clips · {proj.markers.length} markers · {proj.fps}fps
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onLoadProject(proj)}
                            className="flex-1 h-7 rounded bg-[#1E2636] hover:bg-[#283247] text-[11px] font-medium text-[#E5E9F0] transition-colors"
                          >
                            {isCurrent ? 'Loaded' : 'Open Sequence'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRequestDeleteProject(proj)}
                            className="w-7 h-7 rounded bg-[#1A202D] hover:bg-rose-950/60 text-[#9BA5B7] hover:text-rose-300 flex items-center justify-center transition-colors"
                            aria-label={`Delete ${proj.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* REAL-TIME DIRECTOR NOTES (Firestore) */}
      {tab === 'notes' && (
        <div className="flex-1 flex flex-col min-h-0 p-4 space-y-4 overflow-y-auto">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold font-display text-[#F3F5F8]">Director Notes</h3>
            <p className="text-xs text-[#8E99AD]">
              Timecode-linked edit notes synced across sessions.
            </p>
          </div>

          {!isSignedIn ? (
            <GoogleSignInButton
              onClick={onSignIn}
              disabled={isSigningIn}
              label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
              className="w-full"
            />
          ) : (
            <>
              <form onSubmit={handleNoteSubmit} className="space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono-tc text-amber-400">
                    @ {formatTimecode(playheadSec, fps)}
                  </span>
                  <select
                    value={noteCategory}
                    onChange={(e) => setNoteCategory(e.target.value as EditNoteDoc['category'])}
                    className="bg-[#151A24] border border-[#262E3F] rounded px-1.5 py-0.5 text-[11px] text-[#DCE2EC]"
                  >
                    <option value="cut">Cut</option>
                    <option value="color">Color</option>
                    <option value="audio">Audio</option>
                    <option value="research">Research</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Log a trim note at the current playhead..."
                  className="w-full p-2 rounded-md bg-[#151A24] border border-[#262E3F] text-xs text-[#F3F5F8] placeholder:text-[#6E788C] focus:outline-none focus:border-amber-500/60 resize-none"
                />
                <button
                  type="submit"
                  disabled={addingNote || !noteInput.trim()}
                  className="w-full h-8 rounded-md bg-[#1C2332] hover:bg-[#252E42] border border-[#2D374C] text-xs font-medium text-[#F3F5F8] inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5 text-amber-400" />
                  {addingNote ? 'Saving...' : 'Add Timecode Note'}
                </button>
              </form>

              {notesError && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 break-words">
                  {notesError}
                </div>
              )}

              {notes.length === 0 ? (
                <p className="text-xs text-[#7D889C] py-6 text-center">
                  No notes logged yet. Park the playhead and add your first cut note.
                </p>
              ) : (
                <div className="space-y-2">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="p-2.5 rounded-lg bg-[#141821] border border-[#212836] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSeek(note.timecodeSec)}
                          className="text-[11px] font-mono-tc text-amber-400 hover:text-amber-300"
                        >
                          {formatTimecode(note.timecodeSec, fps)} · {note.category}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteNote(note.id)}
                          className="text-[#7D889C] hover:text-rose-300"
                          aria-label="Delete note"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-xs text-[#D4DCE9] leading-relaxed break-words">
                        {note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
};
