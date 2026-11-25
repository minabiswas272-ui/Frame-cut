import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { LogOut, Share2 } from 'lucide-react';
import { ConfirmModal } from './components/ConfirmModal';
import { ExportModal } from './components/ExportModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { LeftDockPanel, type LeftDockTab } from './components/LeftDockPanel';
import { RightInspectorPanel } from './components/RightInspectorPanel';
import { TimelinePanel } from './components/TimelinePanel';
import {
  VideoPreviewPlayer,
  type VideoPreviewHandle,
} from './components/VideoPreviewPlayer';
import {
  deleteDriveFile,
  fetchDriveVideoBlobUrl,
  listDriveMediaFiles,
  uploadBlobToDrive,
  uploadProjectEdlToDrive,
} from './lib/driveApi';
import { extractAudioWithFfmpeg } from './lib/ffmpegClient';
import type { ExtractedAudioPreview } from './components/CaptionsPanel';
import {
  createEditNote,
  deleteEditNote,
  ensureUserWorkspace,
  getFirebaseIdToken,
  googleSignIn,
  initAuth,
  logout,
  subscribeUserNotes,
  updateUserWorkspacePrefs,
} from './lib/firebase';
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_VIDEO_ADJUSTMENTS,
  generateDeterministicWaveform,
  STARTER_CAPTIONS,
  STARTER_CLIPS,
  STARTER_MARKERS,
  type AutoEditOptions,
  type AutoEditPlan,
  type AutoEditReport,
  type AutoEditSnapshot,
  type CaptionCue,
  type CaptionStyle,
  type ColorGrade,
  type DriveFileItem,
  type EditNoteDoc,
  type GeminiQuickEditResult,
  type GeminiResearchResult,
  type GeminiSceneAnalysis,
  type SavedProject,
  type TimelineClip,
  type TimelineMarker,
  type VideoAdjustments,
} from './types/editor';

async function extractVideoMetadata(
  videoUrl: string,
  fallbackTitle: string
): Promise<{ durationSec: number; posterUrl: string; resolutionLabel: string }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    const fallback = {
      durationSec: 12,
      posterUrl: STARTER_CLIPS[0].posterUrl,
      resolutionLabel: '1920x1080',
    };

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
    };

    video.onerror = () => {
      cleanup();
      resolve(fallback);
    };

    video.onloadedmetadata = () => {
      const durationSec =
        Number.isFinite(video.duration) && video.duration > 0.2 ? video.duration : 12;
      const resolutionLabel =
        video.videoWidth && video.videoHeight
          ? `${video.videoWidth}x${video.videoHeight}`
          : '1920x1080';

      try {
        video.currentTime = Math.min(0.5, durationSec * 0.15);
      } catch {
        cleanup();
        resolve({ durationSec, posterUrl: STARTER_CLIPS[0].posterUrl, resolutionLabel });
      }

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const posterUrl = canvas.toDataURL('image/jpeg', 0.72);
            cleanup();
            resolve({ durationSec, posterUrl, resolutionLabel });
            return;
          }
        } catch {
          console.warn('Could not extract poster thumbnail for', fallbackTitle);
        }
        cleanup();
        resolve({ durationSec, posterUrl: STARTER_CLIPS[0].posterUrl, resolutionLabel });
      };
    };
  });
}

async function captureImageUrlBase64(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 270;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(dataUrl.split(',')[1] ?? null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<void>;
}

export default function App() {
  // Core Editor State
  const [leftTab, setLeftTab] = useState<LeftDockTab>('ai');
  const [projectTitle, setProjectTitle] = useState('Coastal Documentary Cut');
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [fps, setFps] = useState<24 | 30 | 60>(24);
  const [colorGrade, setColorGrade] = useState<ColorGrade>('standard');
  const [videoAdjustments, setVideoAdjustments] = useState<VideoAdjustments>(
    DEFAULT_VIDEO_ADJUSTMENTS
  );
  const [bypassFilters, setBypassFilters] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [loopTrim, setLoopTrim] = useState(true);
  const [safeGuides, setSafeGuides] = useState(false);

  const [clips, setClips] = useState<TimelineClip[]>(STARTER_CLIPS);
  const [markers, setMarkers] = useState<TimelineMarker[]>(STARTER_MARKERS);
  const [captions, setCaptions] = useState<CaptionCue[]>(STARTER_CAPTIONS);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState('');
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [extractedAudio, setExtractedAudio] = useState<ExtractedAudioPreview | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(STARTER_CLIPS[0].id);
  const [playheadSec, setPlayheadSec] = useState<number>(STARTER_CLIPS[0].trimStartSec);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // One-Click Auto Video Editor State
  const [autoEditOptions, setAutoEditOptions] = useState<AutoEditOptions>({
    style: 'cinematic',
    autoTrim: true,
    autoEnhance: true,
    autoCaptions: true,
    autoMarkers: true,
  });
  const [isAutoEditing, setIsAutoEditing] = useState(false);
  const [autoEditStage, setAutoEditStage] = useState('');
  const [autoEditProgress, setAutoEditProgress] = useState(0);
  const [autoEditError, setAutoEditError] = useState<string | null>(null);
  const [autoEditReport, setAutoEditReport] = useState<AutoEditReport | null>(null);
  const [autoEditSnapshot, setAutoEditSnapshot] = useState<AutoEditSnapshot | null>(null);

  // Firebase Auth & Google Drive State
  const [user, setUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [importingDriveId, setImportingDriveId] = useState<string | null>(null);

  // Cloud SQL PostgreSQL Projects State
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsSaving, setProjectsSaving] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Firestore Real-time Director Notes State
  const [notes, setNotes] = useState<EditNoteDoc[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Custom Confirmation Modal (mandatory for destructive/mutating Drive & DB operations)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const previewRef = useRef<VideoPreviewHandle | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Compute clip timeline offsets
  const clipLayouts = useMemo(() => {
    let cursor = 0;
    return clips.map((clip) => {
      const startOffsetSec = cursor;
      const endOffsetSec = cursor + clip.durationSec;
      cursor = endOffsetSec;
      return { clip, startOffsetSec, endOffsetSec };
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

  // Locate active clip under current playhead
  const activePlacement = useMemo(() => {
    if (!clipLayouts.length) return null;
    const found =
      clipLayouts.find(
        (item) => playheadSec >= item.startOffsetSec && playheadSec <= item.endOffsetSec
      ) ?? clipLayouts[clipLayouts.length - 1];
    return found;
  }, [clipLayouts, playheadSec]);

  const selectedPlacement = useMemo(() => {
    if (!clipLayouts.length) return null;
    return (
      clipLayouts.find((item) => item.clip.id === selectedClipId) ??
      activePlacement ??
      clipLayouts[0]
    );
  }, [clipLayouts, selectedClipId, activePlacement]);

  const selectedClip = selectedPlacement?.clip ?? null;
  const activeClip = activePlacement?.clip ?? null;
  const activeClipLocalTime = activePlacement
    ? Math.max(0, Math.min(activePlacement.clip.durationSec, playheadSec - activePlacement.startOffsetSec))
    : 0;

  // Compute kept sequence timecode across trimmed regions
  const trimmedSequenceTime = useMemo(() => {
    let kept = 0;
    for (const item of clipLayouts) {
      const { clip, startOffsetSec } = item;
      const trimInGlobal = startOffsetSec + clip.trimStartSec;
      const trimOutGlobal = startOffsetSec + clip.trimEndSec;
      if (playheadSec >= trimOutGlobal) {
        kept += Math.max(0, clip.trimEndSec - clip.trimStartSec);
      } else if (playheadSec > trimInGlobal) {
        kept += playheadSec - trimInGlobal;
        break;
      } else {
        break;
      }
    }
    return kept;
  }, [clipLayouts, playheadSec]);

  // ---------------------------------------------------------------------------
  // 60fps Playback Loop Respecting Clip Trim IN/OUT Boundaries
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isPlaying || clipLayouts.length === 0) return;

    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      setPlayheadSec((prev) => {
        // Locate current clip index
        let idx = clipLayouts.findIndex(
          (item) => prev >= item.startOffsetSec - 0.001 && prev <= item.endOffsetSec + 0.001
        );
        if (idx === -1) idx = 0;

        const current = clipLayouts[idx];
        const trimInGlobal = current.startOffsetSec + current.clip.trimStartSec;
        const trimOutGlobal = current.startOffsetSec + current.clip.trimEndSec;

        let next = prev;
        if (next < trimInGlobal) {
          next = trimInGlobal;
        }
        next += dt * (current.clip.playbackRate || 1);

        if (next >= trimOutGlobal) {
          if (loopTrim && selectedClipId === current.clip.id) {
            return trimInGlobal;
          }
          // Advance to next clip's Trim IN point
          if (idx + 1 < clipLayouts.length) {
            const nextLayout = clipLayouts[idx + 1];
            setSelectedClipId(nextLayout.clip.id);
            return nextLayout.startOffsetSec + nextLayout.clip.trimStartSec;
          }
          // End of sequence
          if (loopTrim) {
            const first = clipLayouts[0];
            setSelectedClipId(first.clip.id);
            return first.startOffsetSec + first.clip.trimStartSec;
          }
          setIsPlaying(false);
          return trimOutGlobal;
        }

        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, clipLayouts, loopTrim, selectedClipId]);

  // ---------------------------------------------------------------------------
  // Firebase Auth, Firestore Preferences/Notes & Cloud SQL Projects Lifecycle
  // ---------------------------------------------------------------------------
  const fetchProjectsFromSql = useCallback(async () => {
    const idToken = await getFirebaseIdToken();
    if (!idToken) return;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const res = await fetch('/api/projects', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load saved projects.');
      }
      setSavedProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Unable to fetch projects.');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const refreshDriveFiles = useCallback(
    async (search = '', tokenOverride?: string | null) => {
      const token = tokenOverride ?? driveAccessToken;
      if (!token) return;
      setDriveLoading(true);
      setDriveError(null);
      try {
        const files = await listDriveMediaFiles(token, search);
        setDriveFiles(files);
      } catch (err) {
        setDriveError(
          err instanceof Error ? err.message : 'Unable to browse Google Drive files.'
        );
      } finally {
        setDriveLoading(false);
      }
    },
    [driveAccessToken]
  );

  useEffect(() => {
    const unsubscribe = initAuth((authUser, cachedToken) => {
      setUser(authUser);
      setDriveAccessToken(cachedToken);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setSavedProjects([]);
      setDriveFiles([]);
      return;
    }

    let unsubNotes: (() => void) | null = null;
    let cancelled = false;

    const bootstrapUserData = async () => {
      try {
        const prefs = await ensureUserWorkspace(user, {
          defaultFps: 24,
          snapEnabled: true,
          loopTrim: true,
          safeGuides: false,
          activeProjectTitle: 'Coastal Documentary Cut',
        });
        if (!cancelled) {
          setFps(prefs.defaultFps);
          setSnapEnabled(prefs.snapEnabled);
          setLoopTrim(prefs.loopTrim);
          setSafeGuides(prefs.safeGuides);
        }
      } catch (err) {
        console.error('Failed to sync Firestore workspace preferences:', err);
      }

      if (!cancelled) {
        unsubNotes = subscribeUserNotes(
          user.uid,
          (incoming) => {
            setNotes(incoming);
            setNotesError(null);
          },
          (err) => {
            setNotesError(err.message);
          }
        );
        void fetchProjectsFromSql();
      }
    };

    void bootstrapUserData();

    return () => {
      cancelled = true;
      if (unsubNotes) unsubNotes();
    };
  }, [user, fetchProjectsFromSql]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const { user: signedInUser, accessToken } = await googleSignIn();
      setUser(signedInUser);
      setDriveAccessToken(accessToken || null);
      if (accessToken) {
        void refreshDriveFiles('', accessToken);
      }
      showNotice(`Signed in as ${signedInUser.displayName || signedInUser.email}`);
    } catch (err) {
      console.error('Google sign-in failed:', err);
      showNotice('Sign-in was canceled or blocked by popup settings.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setDriveAccessToken(null);
    setActiveProjectId(null);
    showNotice('Signed out');
  };

  // Persist workspace toggles to Firestore when authenticated
  const syncPrefToFirestore = useCallback(
    (patch: Parameters<typeof updateUserWorkspacePrefs>[1]) => {
      if (!user) return;
      void updateUserWorkspacePrefs(user.uid, patch).catch((err) => {
        console.error('Workspace pref sync failed:', err);
      });
    },
    [user]
  );

  // ---------------------------------------------------------------------------
  // Clip Editing, Trim, Split & Marker Actions
  // ---------------------------------------------------------------------------
  const handleUpdateClip = useCallback((clipId: string, patch: Partial<TimelineClip>) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const nextStart = patch.trimStartSec !== undefined ? patch.trimStartSec : c.trimStartSec;
        const nextEnd = patch.trimEndSec !== undefined ? patch.trimEndSec : c.trimEndSec;
        const safeStart = Math.max(0, Math.min(nextStart, nextEnd - 0.15));
        const safeEnd = Math.min(c.durationSec, Math.max(nextEnd, safeStart + 0.15));
        return {
          ...c,
          ...patch,
          trimStartSec: Number(safeStart.toFixed(2)),
          trimEndSec: Number(safeEnd.toFixed(2)),
        };
      })
    );
  }, []);

  const handleUpdateClipTrim = useCallback(
    (clipId: string, trimStartSec: number, trimEndSec: number) => {
      handleUpdateClip(clipId, { trimStartSec, trimEndSec });
    },
    [handleUpdateClip]
  );

  const handleSetTrimInAtPlayhead = useCallback(() => {
    if (!activePlacement) return;
    const local = Math.max(
      0,
      Math.min(activePlacement.clip.trimEndSec - 0.2, activeClipLocalTime)
    );
    handleUpdateClipTrim(activePlacement.clip.id, local, activePlacement.clip.trimEndSec);
    setSelectedClipId(activePlacement.clip.id);
    showNotice(`Trim In set to ${local.toFixed(2)}s`);
  }, [activePlacement, activeClipLocalTime, handleUpdateClipTrim, showNotice]);

  const handleSetTrimOutAtPlayhead = useCallback(() => {
    if (!activePlacement) return;
    const local = Math.min(
      activePlacement.clip.durationSec,
      Math.max(activePlacement.clip.trimStartSec + 0.2, activeClipLocalTime)
    );
    handleUpdateClipTrim(activePlacement.clip.id, activePlacement.clip.trimStartSec, local);
    setSelectedClipId(activePlacement.clip.id);
    showNotice(`Trim Out set to ${local.toFixed(2)}s`);
  }, [activePlacement, activeClipLocalTime, handleUpdateClipTrim, showNotice]);

  const handleResetTrim = useCallback(() => {
    if (!activeClip) return;
    handleUpdateClipTrim(activeClip.id, 0, activeClip.durationSec);
    showNotice('Clip trim reset to full source length');
  }, [activeClip, handleUpdateClipTrim, showNotice]);

  const handleSplitAtPlayhead = useCallback(() => {
    if (!activePlacement) return;
    const { clip } = activePlacement;
    const splitPoint = activeClipLocalTime;
    if (splitPoint <= 0.25 || splitPoint >= clip.durationSec - 0.25) {
      showNotice('Move the playhead inside the clip to split it.');
      return;
    }

    const partA: TimelineClip = {
      ...clip,
      id: `${clip.id}_a_${Date.now().toString(36)}`,
      title: `${clip.title.replace(/ \(Part [AB]\)$/, '')} (Part A)`,
      trimStartSec: Math.min(clip.trimStartSec, Number((splitPoint - 0.2).toFixed(2))),
      trimEndSec: Number(splitPoint.toFixed(2)),
    };
    const partB: TimelineClip = {
      ...clip,
      id: `${clip.id}_b_${Date.now().toString(36)}`,
      title: `${clip.title.replace(/ \(Part [AB]\)$/, '')} (Part B)`,
      trimStartSec: Number(splitPoint.toFixed(2)),
      trimEndSec: Math.max(clip.trimEndSec, Number((splitPoint + 0.2).toFixed(2))),
    };

    setClips((prev) => {
      const idx = prev.findIndex((c) => c.id === clip.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy.splice(idx, 1, partA, partB);
      return copy;
    });
    setSelectedClipId(partB.id);
    showNotice(`Split clip at ${splitPoint.toFixed(2)}s`);
  }, [activePlacement, activeClipLocalTime, showNotice]);

  const handleDuplicateSelectedClip = useCallback(() => {
    if (!selectedClip) return;
    const dup: TimelineClip = {
      ...selectedClip,
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `${selectedClip.title} (Copy)`,
    };
    setClips((prev) => {
      const idx = prev.findIndex((c) => c.id === selectedClip.id);
      if (idx === -1) return [...prev, dup];
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
    setSelectedClipId(dup.id);
  }, [selectedClip]);

  const handleDeleteSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    setClips((prev) => {
      const remaining = prev.filter((c) => c.id !== selectedClipId);
      setSelectedClipId(remaining[0]?.id ?? null);
      if (remaining.length === 0) {
        setIsPlaying(false);
        setPlayheadSec(0);
      }
      return remaining;
    });
  }, [selectedClipId]);

  const handleAddMarkerAtPlayhead = useCallback(() => {
    const nextMarker: TimelineMarker = {
      id: `mk_${Date.now()}`,
      label: `Cue ${markers.length + 1}`,
      timeSec: Number(playheadSec.toFixed(2)),
      color: 'amber',
      notes: '',
      source: 'user',
    };
    setMarkers((prev) => [...prev, nextMarker].sort((a, b) => a.timeSec - b.timeSec));
    showNotice(`Added marker at ${playheadSec.toFixed(2)}s`);
  }, [markers.length, playheadSec, showNotice]);

  const handleUploadLocalFile = useCallback(
    async (file: File) => {
      const objectUrl = URL.createObjectURL(file);
      const meta = await extractVideoMetadata(objectUrl, file.name);
      const newClip: TimelineClip = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: file.name,
        sourceType: 'local',
        sourceRef: file.name,
        videoUrl: objectUrl,
        posterUrl: meta.posterUrl,
        durationSec: Number(meta.durationSec.toFixed(2)),
        trimStartSec: 0,
        trimEndSec: Number(meta.durationSec.toFixed(2)),
        playbackRate: 1,
        volume: 0.9,
        waveform: generateDeterministicWaveform(file.name + file.size, 56),
        resolutionLabel: meta.resolutionLabel,
      };

      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
      showNotice(`Imported ${file.name}`);
    },
    [showNotice]
  );

  const handleAddStarterClip = useCallback(
    (template: TimelineClip) => {
      const clone: TimelineClip = {
        ...template,
        id: `reel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      };
      setClips((prev) => [...prev, clone]);
      setSelectedClipId(clone.id);
      showNotice(`Added ${template.title} to timeline`);
    },
    [showNotice]
  );

  // ---------------------------------------------------------------------------
  // Google Drive Actions (Mandatory Confirmation Before Mutations / Deletions)
  // ---------------------------------------------------------------------------
  const handleImportDriveVideo = async (file: DriveFileItem) => {
    if (!driveAccessToken) return;
    setImportingDriveId(file.id);
    setDriveError(null);
    try {
      const blobUrl = await fetchDriveVideoBlobUrl(driveAccessToken, file.id);
      const meta = await extractVideoMetadata(blobUrl, file.name);
      const driveClip: TimelineClip = {
        id: `drive_${file.id}_${Date.now().toString(36)}`,
        title: file.name,
        sourceType: 'drive',
        sourceRef: file.id,
        videoUrl: blobUrl,
        posterUrl: meta.posterUrl,
        durationSec: Number(meta.durationSec.toFixed(2)),
        trimStartSec: 0,
        trimEndSec: Number(meta.durationSec.toFixed(2)),
        playbackRate: 1,
        volume: 0.9,
        waveform: generateDeterministicWaveform(file.id, 56),
        resolutionLabel: `${meta.resolutionLabel} · Drive`,
      };
      setClips((prev) => [...prev, driveClip]);
      setSelectedClipId(driveClip.id);
      showNotice(`Imported ${file.name} from Google Drive`);
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to import video from Drive.');
    } finally {
      setImportingDriveId(null);
    }
  };

  const requestUploadProjectToDrive = () => {
    if (!driveAccessToken) {
      showNotice('Sign in with Google Drive first to export projects.');
      return;
    }
    setPendingConfirm({
      title: 'Save Sequence EDL to Google Drive?',
      description: `This will create "${projectTitle}.framecut.json" in your Google Drive containing ${clips.length} clips, trim IN/OUT timestamps, and ${markers.length} markers.`,
      confirmLabel: 'Save to Google Drive',
      action: async () => {
        const uploaded = await uploadProjectEdlToDrive(driveAccessToken, projectTitle, {
          schema: 'framecut-edl-v1',
          exportedAt: new Date().toISOString(),
          projectTitle,
          fps,
          colorGrade,
          clips: clips.map((c, idx) => ({
            order: idx,
            title: c.title,
            sourceType: c.sourceType,
            sourceRef: c.sourceRef,
            durationSec: c.durationSec,
            trimStartSec: c.trimStartSec,
            trimEndSec: c.trimEndSec,
            playbackRate: c.playbackRate,
            volume: c.volume,
          })),
          markers,
        });
        showNotice(`Saved "${uploaded.name}" to Google Drive`);
        setExportOpen(false);
        void refreshDriveFiles('');
      },
    });
  };

  const requestUploadVideoToDrive = (fileName: string, blob: Blob) => {
    if (!driveAccessToken) {
      showNotice('Sign in with Google Drive first to save videos.');
      return;
    }
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
    setPendingConfirm({
      title: 'Upload Rendered Video to Google Drive?',
      description: `This will upload "${fileName}" (${sizeMb} MB) rendered by ffmpeg.wasm directly into your Google Drive.`,
      confirmLabel: 'Upload Video',
      action: async () => {
        const uploaded = await uploadBlobToDrive(driveAccessToken, fileName, blob);
        showNotice(`Uploaded "${uploaded.name}" to Google Drive`);
        void refreshDriveFiles('');
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Audio Extraction (ffmpeg.wasm) + Gemini Timestamped Captions
  // ---------------------------------------------------------------------------
  const runAudioTranscriptionPipeline = async (
    source: string | File,
    clipTitle: string,
    durationSec: number,
    startOffsetSec: number
  ) => {
    setIsTranscribing(true);
    setTranscribeError(null);
    setTranscribeStage('Starting ffmpeg.wasm audio extraction...');
    setTranscribeProgress(8);

    try {
      const extracted = await extractAudioWithFfmpeg(source, (stage, pct) => {
        setTranscribeStage(stage);
        setTranscribeProgress(Math.round(pct * 0.65));
      });

      setTranscribeStage('Transcribing audio & aligning timestamps with Gemini...');
      setTranscribeProgress(76);

      const res = await fetch('/api/ai/transcribe-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: extracted.base64,
          mimeType: extracted.mimeType,
          durationSec,
          startOffsetSec,
          clipTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gemini audio transcription failed.');
      }

      const generated: CaptionCue[] = Array.isArray(data.captions) ? data.captions : [];
      setExtractedAudio((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return {
          clipTitle,
          blobUrl: extracted.blobUrl,
          sizeBytes: extracted.sizeBytes,
          transcript: String(data.transcript ?? ''),
        };
      });

      if (generated.length > 0) {
        setCaptions((prev) =>
          [...prev, ...generated].sort((a, b) => a.startSec - b.startSec)
        );
        setCaptionStyle((s) => ({ ...s, enabled: true }));
        setPlayheadSec(generated[0].startSec);
        showNotice(`Generated ${generated.length} timestamped captions`);
      } else {
        showNotice('Audio extracted, but no spoken captions were detected.');
      }
      setTranscribeProgress(100);
    } catch (err) {
      setTranscribeError(
        err instanceof Error ? err.message : 'Unable to extract audio and generate captions.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleExtractAndTranscribeActiveClip = async () => {
    const placement = selectedPlacement ?? activePlacement;
    if (!placement || !placement.clip.videoUrl) {
      setTranscribeError(
        'Select an imported video clip (local or Google Drive) to extract its audio track.'
      );
      return;
    }
    await runAudioTranscriptionPipeline(
      placement.clip.videoUrl,
      placement.clip.title,
      placement.clip.durationSec,
      placement.startOffsetSec
    );
  };

  const handleUploadAndTranscribeFile = async (file: File) => {
    if (file.type.startsWith('video/')) {
      const objectUrl = URL.createObjectURL(file);
      const meta = await extractVideoMetadata(objectUrl, file.name);
      const newClip: TimelineClip = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: file.name,
        sourceType: 'local',
        sourceRef: file.name,
        videoUrl: objectUrl,
        posterUrl: meta.posterUrl,
        durationSec: Number(meta.durationSec.toFixed(2)),
        trimStartSec: 0,
        trimEndSec: Number(meta.durationSec.toFixed(2)),
        playbackRate: 1,
        volume: 0.9,
        waveform: generateDeterministicWaveform(file.name + file.size, 56),
        resolutionLabel: meta.resolutionLabel,
      };
      const nextOffset = totalSourceDuration;
      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
      setPlayheadSec(nextOffset);
      await runAudioTranscriptionPipeline(file, file.name, meta.durationSec, nextOffset);
      return;
    }

    const activeDur = activeClip?.durationSec ?? 12;
    const offset = activePlacement?.startOffsetSec ?? 0;
    await runAudioTranscriptionPipeline(file, file.name, activeDur, offset);
  };

  const handleGenerateVisualCaptions = async () => {
    const placement = selectedPlacement ?? activePlacement;
    if (!placement) return;
    setIsTranscribing(true);
    setTranscribeError(null);
    setTranscribeStage('Analyzing active frame with Gemini...');
    setTranscribeProgress(45);

    try {
      const frameBase64 = previewRef.current?.captureFrameBase64() ?? '';
      const res = await fetch('/api/ai/visual-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameBase64,
          mimeType: 'image/jpeg',
          clipTitle: placement.clip.title,
          startOffsetSec: placement.startOffsetSec,
          trimStartSec: placement.clip.trimStartSec,
          trimEndSec: placement.clip.trimEndSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not generate visual captions.');
      }
      const generated: CaptionCue[] = Array.isArray(data.captions) ? data.captions : [];
      if (generated.length > 0) {
        setCaptions((prev) =>
          [...prev, ...generated].sort((a, b) => a.startSec - b.startSec)
        );
        setCaptionStyle((s) => ({ ...s, enabled: true }));
        setPlayheadSec(generated[0].startSec);
        showNotice(`Added ${generated.length} timed captions`);
      }
      setTranscribeProgress(100);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Caption generation failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleAddCaptionAtPlayhead = () => {
    const start = Number(playheadSec.toFixed(2));
    const end = Number(Math.min(totalSourceDuration || start + 3, start + 3).toFixed(2));
    const cue: CaptionCue = {
      id: `cap_${Date.now()}`,
      startSec: start,
      endSec: Math.max(start + 0.5, end),
      text: 'New caption line',
    };
    setCaptions((prev) => [...prev, cue].sort((a, b) => a.startSec - b.startSec));
    setCaptionStyle((s) => ({ ...s, enabled: true }));
  };

  const handleUpdateCaption = (id: string, patch: Partial<CaptionCue>) => {
    setCaptions((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, ...patch } : c))
        .sort((a, b) => a.startSec - b.startSec)
    );
  };

  const handleDeleteCaption = (id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  };

  const requestDeleteDriveFile = (file: DriveFileItem) => {
    if (!driveAccessToken) return;
    setPendingConfirm({
      title: 'Delete file from Google Drive?',
      description: `Are you sure you want to permanently delete "${file.name}" from your Google Drive? This action cannot be undone.`,
      confirmLabel: 'Delete File',
      destructive: true,
      action: async () => {
        await deleteDriveFile(driveAccessToken, file.id);
        setDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
        showNotice(`Deleted "${file.name}" from Google Drive`);
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Cloud SQL PostgreSQL Save / Load / Delete Project
  // ---------------------------------------------------------------------------
  const handleSaveProjectToSql = async (asNew = false) => {
    const idToken = await getFirebaseIdToken();
    if (!idToken) {
      showNotice('Sign in with Google to save projects.');
      return;
    }

    setProjectsSaving(true);
    setProjectsError(null);
    try {
      const payload = {
        title: projectTitle.trim() || 'Untitled Sequence',
        fps,
        resolution: '1920x1080',
        colorGrade,
        playheadSec,
        clips: clips.map((c, idx) => ({
          title: c.title,
          sourceType: c.sourceType,
          sourceRef: c.sourceRef,
          posterUrl: c.sourceType === 'sample' ? c.posterUrl : STARTER_CLIPS[0].posterUrl,
          durationSec: c.durationSec,
          trimStartSec: c.trimStartSec,
          trimEndSec: c.trimEndSec,
          timelineOrder: idx,
          playbackRate: c.playbackRate,
          volume: c.volume,
        })),
        markers: markers.map((m) => ({
          label: m.label,
          timeSec: m.timeSec,
          color: m.color,
          notes: m.notes,
          source: m.source,
        })),
      };

      const isUpdate = Boolean(activeProjectId && !asNew);
      const res = await fetch(isUpdate ? `/api/projects/${activeProjectId}` : '/api/projects', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not save project.');
      }

      const saved = data.project as SavedProject;
      setActiveProjectId(saved.id);
      syncPrefToFirestore({ activeProjectTitle: saved.title });
      await fetchProjectsFromSql();
      showNotice(isUpdate ? `Updated "${saved.title}"` : `Saved "${saved.title}"`);
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setProjectsSaving(false);
    }
  };

  const handleLoadProjectFromSql = (project: SavedProject) => {
    setIsPlaying(false);
    setActiveProjectId(project.id);
    setProjectTitle(project.title);
    setFps(project.fps === 30 || project.fps === 60 ? project.fps : 24);
    setColorGrade(
      project.colorGrade === 'warm' ||
        project.colorGrade === 'mono' ||
        project.colorGrade === 'cinema'
        ? project.colorGrade
        : 'standard'
    );

    const hydratedClips: TimelineClip[] = project.clips.map((c) => ({
      id: `sql_${c.id}_${Date.now().toString(36)}`,
      title: c.title,
      sourceType: c.sourceType,
      sourceRef: c.sourceRef,
      posterUrl: c.posterUrl || STARTER_CLIPS[0].posterUrl,
      durationSec: c.durationSec,
      trimStartSec: c.trimStartSec,
      trimEndSec: c.trimEndSec,
      playbackRate: c.playbackRate,
      volume: c.volume,
      waveform: generateDeterministicWaveform(`${c.id}-${c.title}`, 56),
      resolutionLabel: project.resolution,
    }));

    const hydratedMarkers: TimelineMarker[] = project.markers.map((m) => ({
      id: `sql_mk_${m.id}`,
      label: m.label,
      timeSec: m.timeSec,
      color:
        m.color === 'sky' || m.color === 'emerald' || m.color === 'rose' ? m.color : 'amber',
      notes: m.notes,
      source: m.source === 'gemini' ? 'gemini' : 'user',
    }));

    setClips(hydratedClips.length ? hydratedClips : STARTER_CLIPS);
    setMarkers(hydratedMarkers);
    setSelectedClipId(hydratedClips[0]?.id ?? null);
    setPlayheadSec(project.playheadSec || 0);
    showNotice(`Loaded "${project.title}"`);
  };

  const requestDeleteProject = (project: SavedProject) => {
    setPendingConfirm({
      title: 'Delete Saved Project?',
      description: `Permanently delete "${project.title}" and all ${project.clips.length} saved clip trims from your project library?`,
      confirmLabel: 'Delete Project',
      destructive: true,
      action: async () => {
        const idToken = await getFirebaseIdToken();
        if (!idToken) return;
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not delete project.');
        }
        if (activeProjectId === project.id) setActiveProjectId(null);
        setSavedProjects((prev) => prev.filter((p) => p.id !== project.id));
        showNotice(`Deleted "${project.title}"`);
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Server-Side Gemini Intelligence & Search Grounding
  // ---------------------------------------------------------------------------
  const handleRunQuickEdit = async (task: string): Promise<GeminiQuickEditResult | null> => {
    const res = await fetch('/api/ai/quick-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        playheadSec,
        totalDurationSec: totalSourceDuration,
        activeClip: activeClip
          ? {
              title: activeClip.title,
              durationSec: activeClip.durationSec,
              trimStartSec: activeClip.trimStartSec,
              trimEndSec: activeClip.trimEndSec,
            }
          : null,
        clips: clips.map((c) => ({
          title: c.title,
          durationSec: c.durationSec,
          trimStartSec: c.trimStartSec,
          trimEndSec: c.trimEndSec,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Quick edit request failed.');
    }
    return data.result as GeminiQuickEditResult;
  };

  const handleRunSceneAnalysis = async (
    focusNote: string
  ): Promise<GeminiSceneAnalysis | null> => {
    if (!activeClip) return null;
    const frameBase64 = previewRef.current?.captureFrameBase64() ?? '';
    const res = await fetch('/api/ai/analyze-scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frameBase64,
        mimeType: 'image/jpeg',
        clipTitle: activeClip.title,
        durationSec: activeClip.durationSec,
        trimStartSec: activeClip.trimStartSec,
        trimEndSec: activeClip.trimEndSec,
        promptNote: focusNote,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Scene analysis request failed.');
    }
    return data.result as GeminiSceneAnalysis;
  };

  const handleRunResearch = async (query: string): Promise<GeminiResearchResult | null> => {
    const res = await fetch('/api/ai/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Search research request failed.');
    }
    return {
      answer: data.answer || '',
      sources: Array.isArray(data.sources) ? data.sources : [],
    };
  };

  const handleApplySuggestedTrim = (trimIn: number, trimOut: number) => {
    const target = selectedClip ?? activeClip;
    if (!target) return;
    const safeIn = Math.max(0, Math.min(target.durationSec - 0.3, Number(trimIn) || 0));
    const safeOut = Math.min(
      target.durationSec,
      Math.max(safeIn + 0.3, Number(trimOut) || target.durationSec)
    );
    handleUpdateClipTrim(target.id, safeIn, safeOut);
    showNotice(`Applied suggested trim (${safeIn.toFixed(1)}s – ${safeOut.toFixed(1)}s)`);
  };

  const handleApplySuggestedGrade = (grade: ColorGrade) => {
    const normalized: ColorGrade =
      grade === 'warm' || grade === 'mono' || grade === 'cinema' ? grade : 'standard';
    setColorGrade(normalized);
    showNotice(`Applied ${normalized} color preset`);
  };

  const handleApplySuggestedMarkers = (
    suggested: Array<{ label: string; timeSec: number; notes: string }>
  ) => {
    const mapped: TimelineMarker[] = suggested.map((m, i) => ({
      id: `ai_mk_${Date.now()}_${i}`,
      label: m.label.slice(0, 60),
      timeSec: Math.max(0, Math.min(totalSourceDuration, Number(m.timeSec) || 0)),
      color: 'sky',
      notes: m.notes || '',
      source: 'gemini',
    }));
    setMarkers((prev) => [...prev, ...mapped].sort((a, b) => a.timeSec - b.timeSec));
    showNotice(`Added ${mapped.length} markers to timeline`);
  };

  // ---------------------------------------------------------------------------
  // One-Click Auto Video Editor Pipeline
  // ---------------------------------------------------------------------------
  const runAutoEditPipeline = async (
    workingClips: TimelineClip[],
    optionsOverride?: AutoEditOptions
  ) => {
    if (workingClips.length === 0) {
      setAutoEditError('Add at least one clip to the timeline before running Auto Edit.');
      return;
    }

    const opts = optionsOverride ?? autoEditOptions;
    setIsPlaying(false);
    setLeftTab('ai');
    setIsAutoEditing(true);
    setAutoEditError(null);
    setAutoEditStage('Saving undo snapshot & sampling sequence frames...');
    setAutoEditProgress(12);

    // Save complete undo snapshot before mutating state
    setAutoEditSnapshot({
      projectTitle,
      clips: clips.map((c) => ({ ...c })),
      markers: markers.map((m) => ({ ...m })),
      captions: captions.map((c) => ({ ...c })),
      captionStyle: { ...captionStyle },
      colorGrade,
      videoAdjustments: { ...videoAdjustments },
      bypassFilters,
      playheadSec,
    });

    try {
      const beforeDurationSec = workingClips.reduce(
        (acc, c) => acc + Math.max(0.1, c.trimEndSec - c.trimStartSec),
        0
      );

      // Compute timeline offsets for workingClips
      let cursor = 0;
      const layouts = workingClips.map((clip) => {
        const startOffsetSec = cursor;
        cursor += clip.durationSec;
        return { clip, startOffsetSec };
      });

      // Step 1: Sample up to 4 visual frames across the sequence
      const frames: Array<{ base64: string; mimeType: string }> = [];
      for (const item of layouts.slice(0, 4)) {
        const b64 = await captureImageUrlBase64(item.clip.posterUrl || item.clip.sourceRef);
        if (b64) {
          frames.push({ base64: b64, mimeType: 'image/jpeg' });
        }
      }
      if (frames.length === 0) {
        const previewFrame = previewRef.current?.captureFrameBase64();
        if (previewFrame) {
          frames.push({ base64: previewFrame, mimeType: 'image/jpeg' });
        }
      }

      // Step 2: If captions are enabled and there's a native video with audio, extract & transcribe speech
      let transcript = '';
      let usedAudioTranscript = false;
      const firstNative = layouts.find((item) => Boolean(item.clip.videoUrl));
      if (opts.autoCaptions && firstNative?.clip.videoUrl) {
        setAutoEditStage('Extracting audio track with ffmpeg.wasm...');
        setAutoEditProgress(30);
        try {
          const extracted = await extractAudioWithFfmpeg(
            firstNative.clip.videoUrl,
            (stageText, pct) => {
              setAutoEditStage(stageText);
              setAutoEditProgress(28 + Math.round(pct * 0.2));
            }
          );
          setAutoEditStage('Transcribing speech with Gemini...');
          setAutoEditProgress(54);
          const trRes = await fetch('/api/ai/transcribe-captions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: extracted.base64,
              mimeType: extracted.mimeType,
              durationSec: firstNative.clip.durationSec,
              startOffsetSec: firstNative.startOffsetSec,
              clipTitle: firstNative.clip.title,
            }),
          });
          if (trRes.ok) {
            const trData = await trRes.json();
            if (typeof trData.transcript === 'string' && trData.transcript.trim()) {
              transcript = trData.transcript.trim();
              usedAudioTranscript = true;
            }
            setExtractedAudio((prev) => {
              if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
              return {
                clipTitle: firstNative.clip.title,
                blobUrl: extracted.blobUrl,
                sizeBytes: extracted.sizeBytes,
                transcript,
              };
            });
          } else {
            URL.revokeObjectURL(extracted.blobUrl);
          }
        } catch {
          // Graceful fallback when clip is silent or has no audio track
          setAutoEditStage('No speech track detected — switching to visual frame analysis...');
        }
      }

      // Step 3: Request complete director cut from Gemini
      setAutoEditStage('Generating One-Click Director Cut with Gemini...');
      setAutoEditProgress(72);

      const res = await fetch('/api/ai/auto-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style: opts.style,
          options: opts,
          transcript,
          frames,
          clips: layouts.map(({ clip, startOffsetSec }) => ({
            id: clip.id,
            title: clip.title,
            durationSec: clip.durationSec,
            trimStartSec: clip.trimStartSec,
            trimEndSec: clip.trimEndSec,
            startOffsetSec,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'One-Click Auto Edit failed.');
      }

      const plan = data.plan as AutoEditPlan;
      setAutoEditStage('Applying trims, Canvas filters, markers, and captions...');
      setAutoEditProgress(92);

      const clamp = (val: number, min: number, max: number) =>
        Math.max(min, Math.min(max, Number.isFinite(val) ? val : min));

      // Apply clip trims & playback rates
      const editById = new Map(
        (Array.isArray(plan.clipEdits) ? plan.clipEdits : []).map((ce) => [ce.clipId, ce])
      );
      const validRates = [0.5, 1, 1.5, 2];

      const clipChanges: AutoEditReport['clipChanges'] = [];
      const nextClips: TimelineClip[] = layouts.map(({ clip, startOffsetSec }) => {
        const edit = editById.get(clip.id);
        if (!opts.autoTrim || !edit) {
          return clip;
        }
        const safeStart = Number(
          clamp(Number(edit.trimStartSec), 0, Math.max(0, clip.durationSec - 0.6)).toFixed(2)
        );
        const safeEnd = Number(
          clamp(
            Number(edit.trimEndSec),
            Math.min(clip.durationSec, safeStart + 0.5),
            clip.durationSec
          ).toFixed(2)
        );
        const nearestRate = validRates.reduce((best, candidate) =>
          Math.abs(candidate - Number(edit.playbackRate || 1)) <
          Math.abs(best - Number(edit.playbackRate || 1))
            ? candidate
            : best
        );

        clipChanges.push({
          clipId: clip.id,
          title: clip.title,
          startOffsetSec,
          trimStartSec: safeStart,
          trimEndSec: safeEnd,
          playbackRate: nearestRate,
          reason: edit.reason || 'Trimmed for pacing',
        });

        return {
          ...clip,
          trimStartSec: safeStart,
          trimEndSec: safeEnd,
          playbackRate: nearestRate,
        };
      });

      setClips(nextClips);

      // Apply color grade & HTML5 Canvas filters
      let nextGrade: ColorGrade = colorGrade;
      let nextAdjustments: VideoAdjustments = videoAdjustments;
      if (opts.autoEnhance) {
        nextGrade =
          plan.colorGrade === 'warm' ||
          plan.colorGrade === 'mono' ||
          plan.colorGrade === 'cinema'
            ? plan.colorGrade
            : 'standard';
        const rawAdj = plan.videoAdjustments ?? DEFAULT_VIDEO_ADJUSTMENTS;
        nextAdjustments = {
          brightness: Math.round(clamp(Number(rawAdj.brightness), 85, 120)),
          contrast: Math.round(clamp(Number(rawAdj.contrast), 90, 135)),
          saturation: Math.round(clamp(Number(rawAdj.saturation), 60, 140)),
          sharpen: Math.round(clamp(Number(rawAdj.sharpen), 0, 50)),
        };
        setColorGrade(nextGrade);
        setVideoAdjustments(nextAdjustments);
        setBypassFilters(false);
      }

      // Apply scene/beat markers
      const totalDur = nextClips.reduce((acc, c) => acc + c.durationSec, 0);
      let markersAdded = 0;
      if (opts.autoMarkers && Array.isArray(plan.markers) && plan.markers.length > 0) {
        const nextMarkers: TimelineMarker[] = plan.markers.map((m, idx) => ({
          id: `auto_mk_${Date.now()}_${idx}`,
          label: String(m.label || `Beat ${idx + 1}`).slice(0, 52),
          timeSec: Number(clamp(Number(m.timeSec), 0, totalDur).toFixed(2)),
          color:
            m.color === 'sky' || m.color === 'emerald' || m.color === 'rose' ? m.color : 'amber',
          notes: String(m.notes || ''),
          source: 'gemini',
        }));
        nextMarkers.sort((a, b) => a.timeSec - b.timeSec);
        setMarkers(nextMarkers);
        markersAdded = nextMarkers.length;
      }

      // Apply synced captions & Canvas caption style
      let captionsGenerated = 0;
      if (opts.autoCaptions && Array.isArray(plan.captions) && plan.captions.length > 0) {
        const nextCaptions: CaptionCue[] = plan.captions
          .filter((c) => typeof c.text === 'string' && c.text.trim().length > 0)
          .map((c, idx) => {
            const start = Number(clamp(Number(c.startSec), 0, Math.max(0, totalDur - 0.3)).toFixed(2));
            const end = Number(clamp(Number(c.endSec), start + 0.5, totalDur).toFixed(2));
            return {
              id: `auto_cap_${Date.now()}_${idx}`,
              startSec: start,
              endSec: end,
              text: c.text.trim(),
            };
          })
          .sort((a, b) => a.startSec - b.startSec);

        setCaptions(nextCaptions);
        captionsGenerated = nextCaptions.length;

        const st = plan.captionStyle ?? {};
        const safeFont =
          st.fontFamily === 'Plus Jakarta Sans' ||
          st.fontFamily === 'JetBrains Mono' ||
          st.fontFamily === 'Georgia'
            ? st.fontFamily
            : 'DM Sans';
        const safePos =
          st.position === 'top' || st.position === 'middle' ? st.position : 'bottom';
        setCaptionStyle((prev) => ({
          ...prev,
          enabled: true,
          fontFamily: safeFont,
          fontSize: Math.round(clamp(Number(st.fontSize ?? prev.fontSize), 22, 44)),
          textColor:
            typeof st.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(st.textColor)
              ? st.textColor
              : prev.textColor,
          bgOpacity: Number(clamp(Number(st.bgOpacity ?? prev.bgOpacity), 0.2, 0.9).toFixed(2)),
          position: safePos,
          bold: typeof st.bold === 'boolean' ? st.bold : prev.bold,
          uppercase: typeof st.uppercase === 'boolean' ? st.uppercase : prev.uppercase,
          outline: typeof st.outline === 'boolean' ? st.outline : prev.outline,
        }));
      }

      const nextTitle =
        typeof plan.projectTitle === 'string' && plan.projectTitle.trim()
          ? plan.projectTitle.trim()
          : projectTitle;
      setProjectTitle(nextTitle);
      syncPrefToFirestore({ activeProjectTitle: nextTitle });

      const afterDurationSec = nextClips.reduce(
        (acc, c) => acc + Math.max(0.1, c.trimEndSec - c.trimStartSec),
        0
      );

      setAutoEditReport({
        style: opts.style,
        projectTitle: nextTitle,
        editSummary: plan.editSummary || 'Automated trim, color polish, markers, and captions applied.',
        beforeDurationSec,
        afterDurationSec,
        clipsTrimmed: clipChanges.length,
        markersAdded,
        captionsGenerated,
        usedAudioTranscript,
        appliedGrade: nextGrade,
        appliedAdjustments: nextAdjustments,
        clipChanges,
      });

      // Jump to start of the newly edited cut and play immediately
      const firstClip = nextClips[0];
      if (firstClip) {
        setSelectedClipId(firstClip.id);
        setPlayheadSec(firstClip.trimStartSec);
      }
      setAutoEditProgress(100);
      setIsPlaying(true);
      showNotice(`One-Click Auto Edit applied (${afterDurationSec.toFixed(1)}s cut)`);
    } catch (err) {
      setAutoEditError(
        err instanceof Error ? err.message : 'Unable to complete One-Click Auto Edit.'
      );
    } finally {
      setIsAutoEditing(false);
    }
  };

  const handleRunAutoEdit = () => {
    void runAutoEditPipeline(clips);
  };

  const handleImportAndAutoEdit = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const meta = await extractVideoMetadata(objectUrl, file.name);
    const newClip: TimelineClip = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: file.name,
      sourceType: 'local',
      sourceRef: file.name,
      videoUrl: objectUrl,
      posterUrl: meta.posterUrl,
      durationSec: Number(meta.durationSec.toFixed(2)),
      trimStartSec: 0,
      trimEndSec: Number(meta.durationSec.toFixed(2)),
      playbackRate: 1,
      volume: 0.9,
      waveform: generateDeterministicWaveform(file.name + file.size, 56),
      resolutionLabel: meta.resolutionLabel,
    };

    const nextClips = [newClip];
    setClips(nextClips);
    setSelectedClipId(newClip.id);
    setPlayheadSec(0);
    await runAutoEditPipeline(nextClips);
  };

  const handleUndoAutoEdit = () => {
    if (!autoEditSnapshot) return;
    setIsPlaying(false);
    setProjectTitle(autoEditSnapshot.projectTitle);
    setClips(autoEditSnapshot.clips);
    setMarkers(autoEditSnapshot.markers);
    setCaptions(autoEditSnapshot.captions);
    setCaptionStyle(autoEditSnapshot.captionStyle);
    setColorGrade(autoEditSnapshot.colorGrade);
    setVideoAdjustments(autoEditSnapshot.videoAdjustments);
    setBypassFilters(autoEditSnapshot.bypassFilters);
    setPlayheadSec(autoEditSnapshot.playheadSec);
    setSelectedClipId(autoEditSnapshot.clips[0]?.id ?? null);
    setAutoEditSnapshot(null);
    setAutoEditReport(null);
    showNotice('Reverted sequence to before One-Click Auto Edit');
  };

  const handleReplayAutoCut = () => {
    const first = clipLayouts[0];
    if (!first) return;
    setSelectedClipId(first.clip.id);
    setPlayheadSec(first.startOffsetSec + first.clip.trimStartSec);
    setIsPlaying(true);
  };

  // ---------------------------------------------------------------------------
  // Firestore Director Notes
  // ---------------------------------------------------------------------------
  const handleAddNote = async (content: string, category: EditNoteDoc['category']) => {
    if (!user) {
      showNotice('Sign in with Google to save director notes.');
      return;
    }
    await createEditNote(user.uid, {
      projectTitle,
      timecodeSec: playheadSec,
      content,
      category,
    });
    showNotice('Note saved');
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!user) return;
    await deleteEditNote(user.uid, noteId);
  };

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (NLE Standard)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        handleSetTrimInAtPlayhead();
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        handleSetTrimOutAtPlayhead();
      } else if (e.key === 's' || e.key === 'S') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          handleSplitAtPlayhead();
        }
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleAddMarkerAtPlayhead();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setLoopTrim((prev) => {
          syncPrefToFirestore({ loopTrim: !prev });
          return !prev;
        });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setPlayheadSec((p) => Math.max(0, Number((p - 1 / fps).toFixed(3))));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setPlayheadSec((p) => Math.min(totalSourceDuration, Number((p + 1 / fps).toFixed(3))));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setIsPlaying(false);
        setPlayheadSec(clipLayouts[0]?.clip.trimStartSec ?? 0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setIsPlaying(false);
        const last = clipLayouts[clipLayouts.length - 1];
        setPlayheadSec(last ? last.startOffsetSec + last.clip.trimEndSec : 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    fps,
    totalSourceDuration,
    clipLayouts,
    handleSetTrimInAtPlayhead,
    handleSetTrimOutAtPlayhead,
    handleSplitAtPlayhead,
    handleAddMarkerAtPlayhead,
    syncPrefToFirestore,
  ]);

  const handleConfirmExecute = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.action();
      setPendingConfirm(null);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#0B0D11] text-[#F3F5F8] flex flex-col overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="h-14 px-6 border-b border-[#1E2430] bg-[#0F1219] flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold font-display tracking-tight text-[#F3F5F8] whitespace-nowrap shrink-0">
          FrameCut Studio
        </span>

        {/* Zone 2: 5 Clean Single-Line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'ai', label: 'Auto Edit' },
              { id: 'media', label: 'Media Bin' },
              { id: 'captions', label: 'Captions' },
              { id: 'drive', label: 'Google Drive' },
              { id: 'research', label: 'Research' },
            ] as const
          ).map((item) => {
            const active = leftTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setLeftTab(item.id);
                  if (item.id === 'drive' && driveAccessToken && driveFiles.length === 0) {
                    void refreshDriveFiles('');
                  }
                }}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  active
                    ? 'text-[#F3F5F8] border-amber-400'
                    : 'text-[#8F9AAF] hover:text-[#E5E9F0] border-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action / Account Control */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                title={`Sign out (${user.email || user.displayName || 'Account'})`}
                className="text-xs text-[#9BA5B7] hover:text-[#F3F5F8] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <span className="max-w-[120px] truncate hidden xl:inline">
                  {user.displayName || user.email}
                </span>
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Share2 className="w-3.5 h-3.5" />
                Export Cut
              </button>
            </>
          ) : (
            <GoogleSignInButton
              onClick={() => void handleGoogleSignIn()}
              disabled={isSigningIn}
              label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
            />
          )}
        </div>
      </header>

      {/* Main Upper Workspace: Left Dock + Video Preview Player + Right Inspector */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <LeftDockPanel
          activeTab={leftTab}
          clips={clips}
          selectedClip={selectedClip}
          playheadSec={playheadSec}
          captions={captions}
          captionStyle={captionStyle}
          isTranscribing={isTranscribing}
          transcribeStage={transcribeStage}
          transcribeProgress={transcribeProgress}
          transcribeError={transcribeError}
          extractedAudio={extractedAudio}
          onExtractAndTranscribeActiveClip={() => void handleExtractAndTranscribeActiveClip()}
          onUploadAndTranscribeFile={(f) => void handleUploadAndTranscribeFile(f)}
          onGenerateVisualCaptions={() => void handleGenerateVisualCaptions()}
          onUpdateCaptionStyle={(patch) => setCaptionStyle((prev) => ({ ...prev, ...patch }))}
          onAddCaptionAtPlayhead={handleAddCaptionAtPlayhead}
          onUpdateCaption={handleUpdateCaption}
          onDeleteCaption={handleDeleteCaption}
          onSeek={(sec) => {
            setIsPlaying(false);
            setPlayheadSec(Math.max(0, Math.min(totalSourceDuration, sec)));
          }}
          isSignedIn={Boolean(user)}
          hasDriveToken={Boolean(driveAccessToken)}
          isSigningIn={isSigningIn}
          driveFiles={driveFiles}
          driveLoading={driveLoading}
          driveError={driveError}
          importingDriveId={importingDriveId}
          onSignIn={() => void handleGoogleSignIn()}
          onUploadLocalFile={(file) => void handleUploadLocalFile(file)}
          onAddStarterClip={handleAddStarterClip}
          onSelectClip={(id) => {
            setSelectedClipId(id);
            const found = clipLayouts.find((l) => l.clip.id === id);
            if (found) {
              setPlayheadSec(found.startOffsetSec + found.clip.trimStartSec);
            }
          }}
          onRefreshDrive={(q) => void refreshDriveFiles(q)}
          onImportDriveVideo={(file) => void handleImportDriveVideo(file)}
          onRequestUploadProjectToDrive={requestUploadProjectToDrive}
          onRequestDeleteDriveFile={requestDeleteDriveFile}
          onRunQuickEdit={handleRunQuickEdit}
          onRunSceneAnalysis={handleRunSceneAnalysis}
          onRunResearch={handleRunResearch}
          onApplySuggestedTrim={handleApplySuggestedTrim}
          onApplySuggestedGrade={handleApplySuggestedGrade}
          onApplySuggestedMarkers={handleApplySuggestedMarkers}
          onSaveResearchNote={(content) => void handleAddNote(content, 'research')}
          autoEditOptions={autoEditOptions}
          isAutoEditing={isAutoEditing}
          autoEditStage={autoEditStage}
          autoEditProgress={autoEditProgress}
          autoEditError={autoEditError}
          autoEditReport={autoEditReport}
          canUndoAutoEdit={Boolean(autoEditSnapshot)}
          onChangeAutoEditOptions={(patch) =>
            setAutoEditOptions((prev) => ({ ...prev, ...patch }))
          }
          onRunAutoEdit={handleRunAutoEdit}
          onImportAndAutoEdit={(file) => void handleImportAndAutoEdit(file)}
          onUndoAutoEdit={handleUndoAutoEdit}
          onReplayAutoCut={handleReplayAutoCut}
          onOpenExport={() => setExportOpen(true)}
        />

        <VideoPreviewPlayer
          ref={previewRef}
          activeClip={activeClip}
          clipLocalTime={activeClipLocalTime}
          playheadSec={playheadSec}
          sequenceTime={trimmedSequenceTime}
          totalTrimmedDuration={totalTrimmedDuration}
          fps={fps}
          isPlaying={isPlaying}
          loopTrim={loopTrim}
          safeGuides={safeGuides}
          colorGrade={colorGrade}
          videoAdjustments={videoAdjustments}
          bypassFilters={bypassFilters}
          captions={captions}
          captionStyle={captionStyle}
          muted={muted}
          volume={volume}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onStepFrame={(delta) => {
            setIsPlaying(false);
            setPlayheadSec((prev) =>
              Math.max(0, Math.min(totalSourceDuration, Number((prev + delta / fps).toFixed(3))))
            );
          }}
          onJumpToStart={() => {
            setIsPlaying(false);
            setPlayheadSec(clipLayouts[0]?.clip.trimStartSec ?? 0);
          }}
          onJumpToEnd={() => {
            setIsPlaying(false);
            const last = clipLayouts[clipLayouts.length - 1];
            setPlayheadSec(last ? last.startOffsetSec + last.clip.trimEndSec : 0);
          }}
          onJumpToTrimIn={() => {
            if (!activePlacement) return;
            setIsPlaying(false);
            setPlayheadSec(activePlacement.startOffsetSec + activePlacement.clip.trimStartSec);
          }}
          onJumpToTrimOut={() => {
            if (!activePlacement) return;
            setIsPlaying(false);
            setPlayheadSec(activePlacement.startOffsetSec + activePlacement.clip.trimEndSec);
          }}
          onToggleLoopTrim={() => {
            setLoopTrim((prev) => {
              syncPrefToFirestore({ loopTrim: !prev });
              return !prev;
            });
          }}
          onToggleSafeGuides={() => {
            setSafeGuides((prev) => {
              syncPrefToFirestore({ safeGuides: !prev });
              return !prev;
            });
          }}
          onToggleBypassFilters={() => setBypassFilters((b) => !b)}
          onChangeColorGrade={setColorGrade}
          onToggleMute={() => setMuted((m) => !m)}
          onChangeVolume={(v) => {
            setVolume(v);
            if (v > 0 && muted) setMuted(false);
          }}
          onChangePlaybackRate={(rate) => {
            if (!activeClip) return;
            handleUpdateClip(activeClip.id, { playbackRate: rate });
          }}
          onSetTrimInAtPlayhead={handleSetTrimInAtPlayhead}
          onSetTrimOutAtPlayhead={handleSetTrimOutAtPlayhead}
          onUpdateTrimRange={(trimStart, trimEnd) => {
            if (!activeClip) return;
            handleUpdateClipTrim(activeClip.id, trimStart, trimEnd);
          }}
          onResetTrim={handleResetTrim}
          onSplitAtPlayhead={handleSplitAtPlayhead}
          isAutoEditing={isAutoEditing}
          canUndoAutoEdit={Boolean(autoEditSnapshot)}
          onRunAutoEdit={handleRunAutoEdit}
          onUndoAutoEdit={handleUndoAutoEdit}
        />

        <RightInspectorPanel
          selectedClip={selectedClip}
          projectTitle={projectTitle}
          activeProjectId={activeProjectId}
          fps={fps}
          playheadSec={playheadSec}
          isSignedIn={Boolean(user)}
          isSigningIn={isSigningIn}
          savedProjects={savedProjects}
          projectsLoading={projectsLoading}
          projectsSaving={projectsSaving}
          projectsError={projectsError}
          notes={notes}
          notesError={notesError}
          onChangeProjectTitle={(title) => {
            setProjectTitle(title);
            syncPrefToFirestore({ activeProjectTitle: title });
          }}
          onChangeFps={(nextFps) => {
            setFps(nextFps);
            syncPrefToFirestore({ defaultFps: nextFps });
          }}
          videoAdjustments={videoAdjustments}
          bypassFilters={bypassFilters}
          onChangeAdjustments={(patch) => {
            setBypassFilters(false);
            setVideoAdjustments((prev) => ({ ...prev, ...patch }));
          }}
          onResetAdjustments={() => {
            setVideoAdjustments(DEFAULT_VIDEO_ADJUSTMENTS);
            setBypassFilters(false);
            showNotice('Reset video enhancement filters');
          }}
          onToggleBypassFilters={() => setBypassFilters((b) => !b)}
          onUpdateClip={handleUpdateClip}
          onSignIn={() => void handleGoogleSignIn()}
          onSaveProject={(asNew) => void handleSaveProjectToSql(asNew)}
          onLoadProject={handleLoadProjectFromSql}
          onRequestDeleteProject={requestDeleteProject}
          onAddNote={handleAddNote}
          onDeleteNote={(id) => void handleDeleteNote(id)}
          onSeek={(sec) => {
            setIsPlaying(false);
            setPlayheadSec(Math.max(0, Math.min(totalSourceDuration, sec)));
          }}
        />
      </div>

      {/* Bottom Multi-Track Interactive Timeline */}
      <TimelinePanel
        clips={clips}
        markers={markers}
        selectedClipId={selectedClipId}
        playheadSec={playheadSec}
        fps={fps}
        snapEnabled={snapEnabled}
        onSelectClip={setSelectedClipId}
        onSeek={(sec) => {
          setIsPlaying(false);
          setPlayheadSec(Math.max(0, Math.min(totalSourceDuration, sec)));
        }}
        onUpdateClipTrim={handleUpdateClipTrim}
        onSplitAtPlayhead={handleSplitAtPlayhead}
        onDuplicateSelectedClip={handleDuplicateSelectedClip}
        onDeleteSelectedClip={handleDeleteSelectedClip}
        onAddMarkerAtPlayhead={handleAddMarkerAtPlayhead}
        onDeleteMarker={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
        onToggleSnap={() => {
          setSnapEnabled((prev) => {
            syncPrefToFirestore({ snapEnabled: !prev });
            return !prev;
          });
        }}
        onOpenExport={() => setExportOpen(true)}
      />

      {/* Transient Non-Intrusive Studio Action Notice */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-40 px-4 py-2.5 rounded-lg bg-[#181E2B] border border-amber-500/40 text-xs font-medium text-[#F3F5F8] shadow-xl"
        >
          {notice}
        </div>
      )}

      {/* Export Cut Modal */}
      <ExportModal
        open={exportOpen}
        projectTitle={projectTitle}
        fps={fps}
        colorGrade={colorGrade}
        videoAdjustments={videoAdjustments}
        bypassFilters={bypassFilters}
        captions={captions}
        captionStyle={captionStyle}
        clips={clips}
        markers={markers}
        hasDriveToken={Boolean(driveAccessToken)}
        onClose={() => setExportOpen(false)}
        onRequestDriveUpload={requestUploadProjectToDrive}
        onRequestDriveVideoUpload={requestUploadVideoToDrive}
      />

      {/* Mandatory User Confirmation Dialog for Destructive / Mutating Operations */}
      <ConfirmModal
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel ?? 'Confirm'}
        destructive={pendingConfirm?.destructive}
        busy={confirmBusy}
        onConfirm={() => void handleConfirmExecute()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
