import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import {
  findActiveCaptionText,
  renderCompositeFrame,
} from './canvasRenderer';
import type {
  CaptionCue,
  CaptionStyle,
  ColorGrade,
  TimelineClip,
  VideoAdjustments,
} from '../types/editor';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const baseURL = `${window.location.origin}/ffmpeg-core`;
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((err) => {
      ffmpegLoadPromise = null;
      throw err;
    });
  }
  return ffmpegLoadPromise;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export interface ExtractedAudioResult {
  blob: Blob;
  blobUrl: string;
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Extracts a compact mono 16kHz MP3 audio track from a video URL or File using ffmpeg.wasm.
 */
export async function extractAudioWithFfmpeg(
  source: string | File,
  onProgress?: (stage: string, pct: number) => void
): Promise<ExtractedAudioResult> {
  onProgress?.('Loading ffmpeg.wasm engine...', 12);
  const ffmpeg = await getFfmpeg();

  const inputName = `extract_in_${Date.now()}.bin`;
  const outputName = `extract_out_${Date.now()}.mp3`;

  const onProgressEvent = ({ progress }: { progress: number }) => {
    const pct = Math.min(88, 30 + Math.round(Math.max(0, Math.min(1, progress)) * 58));
    onProgress?.('Extracting audio track with ffmpeg.wasm...', pct);
  };

  ffmpeg.on('progress', onProgressEvent);

  try {
    onProgress?.('Reading media bytes...', 24);
    const data = await fetchFile(source);
    await ffmpeg.writeFile(inputName, data);

    onProgress?.('Extracting mono 16kHz MP3 audio...', 35);
    const exitCode = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '48k',
      '-f',
      'mp3',
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error(
        'No extractable audio stream was found in this media file.'
      );
    }

    onProgress?.('Preparing audio for Gemini transcription...', 92);
    const outData = await ffmpeg.readFile(outputName);
    const bytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(String(outData));

    if (bytes.byteLength < 128) {
      throw new Error('Extracted audio file is empty. Ensure the video contains an audio track.');
    }

    const blob = new Blob([bytes], { type: 'audio/mp3' });
    const blobUrl = URL.createObjectURL(blob);
    const base64 = uint8ToBase64(bytes);

    onProgress?.('Audio extracted', 100);
    return {
      blob,
      blobUrl,
      base64,
      mimeType: 'audio/mp3',
      sizeBytes: bytes.byteLength,
    };
  } finally {
    ffmpeg.off('progress', onProgressEvent);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function loadVideoElement(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = src;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('Unable to load video clip for export.'));
  });
}

function seekVideoTo(video: HTMLVideoElement, targetSec: number): Promise<void> {
  return new Promise((resolve) => {
    const clamped = Math.max(0, Math.min(video.duration || targetSec, targetSec));
    if (Math.abs(video.currentTime - clamped) < 0.01) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = clamped;
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 500);
  });
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.84): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode canvas frame.'));
          return;
        }
        const buf = await blob.arrayBuffer();
        resolve(new Uint8Array(buf));
      },
      'image/jpeg',
      quality
    );
  });
}

export interface FfmpegExportOptions {
  clips: TimelineClip[];
  exportFps: 12 | 15 | 24;
  width: number;
  height: number;
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  onProgress?: (stage: string, pct: number) => void;
}

export interface FfmpegExportResult {
  blob: Blob;
  blobUrl: string;
  sizeBytes: number;
  frameCount: number;
  durationSec: number;
}

/**
 * Renders trimmed clips through the HTML5 Canvas pipeline (brightness, contrast, saturation,
 * sharpen, color grade, and customizable captions), extracts & trims native video audio if present,
 * and encodes a standard H.264 MP4 in the browser using ffmpeg.wasm.
 */
export async function exportTimelineWithFfmpeg(
  options: FfmpegExportOptions
): Promise<FfmpegExportResult> {
  const {
    clips,
    exportFps,
    width,
    height,
    colorGrade,
    videoAdjustments,
    bypassFilters,
    captions,
    captionStyle,
    onProgress,
  } = options;

  if (!clips.length) {
    throw new Error('Add at least one clip to the timeline before exporting.');
  }

  onProgress?.('Loading ffmpeg.wasm encoder...', 5);
  const ffmpeg = await getFfmpeg();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('2D Canvas context unavailable for rendering.');
  }

  // Preload clip media elements
  onProgress?.('Preparing timeline media...', 12);
  const loadedMedia = await Promise.all(
    clips.map(async (clip) => {
      if (clip.videoUrl) {
        const video = await loadVideoElement(clip.videoUrl);
        return { clip, kind: 'video' as const, video };
      }
      const img = await loadImageElement(clip.sourceRef);
      return { clip, kind: 'image' as const, img };
    })
  );

  // Compute clip offsets (matching timeline global coordinates for captions)
  let sourceCursor = 0;
  const timelineMeta = loadedMedia.map((entry) => {
    const startOffsetSec = sourceCursor;
    sourceCursor += entry.clip.durationSec;
    const keptSec = Math.max(0.1, entry.clip.trimEndSec - entry.clip.trimStartSec);
    return { ...entry, startOffsetSec, keptSec };
  });

  const totalKeptDuration = timelineMeta.reduce((acc, item) => acc + item.keptSec, 0);
  const totalFrames = Math.max(1, Math.round(totalKeptDuration * exportFps));
  const writtenFiles: string[] = [];

  const sessionTag = Date.now().toString(36);
  const framePattern = `f_${sessionTag}_%05d.jpg`;
  const outputMp4 = `out_${sessionTag}.mp4`;
  let audioTrackFile: string | null = null;

  try {
    // Render trimmed frames through Canvas (with filters + sharpen + captions)
    let frameIndex = 0;
    for (const item of timelineMeta) {
      const clipFrameCount = Math.max(1, Math.round(item.keptSec * exportFps));
      for (let i = 0; i < clipFrameCount; i++) {
        frameIndex += 1;
        const tWithinKept = i / exportFps;
        const clipLocalTime = Math.min(
          item.clip.trimEndSec,
          item.clip.trimStartSec + tWithinKept
        );
        const globalTimelineTime = item.startOffsetSec + clipLocalTime;
        const captionText = findActiveCaptionText(captions, globalTimelineTime);

        if (item.kind === 'video') {
          await seekVideoTo(item.video, clipLocalTime);
          renderCompositeFrame({
            ctx,
            width,
            height,
            source: { kind: 'video', video: item.video },
            colorGrade,
            videoAdjustments,
            bypassFilters,
            captionText,
            captionStyle,
            includeVignette: false,
          });
        } else {
          renderCompositeFrame({
            ctx,
            width,
            height,
            source: {
              kind: 'image',
              img: item.img,
              clipLocalTime,
              durationSec: item.clip.durationSec,
            },
            colorGrade,
            videoAdjustments,
            bypassFilters,
            captionText,
            captionStyle,
            includeVignette: true,
          });
        }

        const jpegBytes = await canvasToJpegBytes(canvas, 0.84);
        const fileName = `f_${sessionTag}_${String(frameIndex).padStart(5, '0')}.jpg`;
        await ffmpeg.writeFile(fileName, jpegBytes);
        writtenFiles.push(fileName);

        if (frameIndex % 4 === 0 || frameIndex === totalFrames) {
          const pct = 15 + Math.round((frameIndex / totalFrames) * 52);
          onProgress?.(
            `Rendering Canvas frame ${frameIndex} / ${totalFrames}...`,
            Math.min(68, pct)
          );
        }
      }
    }

    // If a single imported video clip has audio, trim & mux its audio track cleanly
    const firstVideoClip = timelineMeta.find((m) => m.kind === 'video');
    if (firstVideoClip && firstVideoClip.clip.videoUrl) {
      onProgress?.('Trimming & muxing audio track...', 72);
      const rawIn = `aud_in_${sessionTag}.bin`;
      const trimmedAudio = `aud_${sessionTag}.m4a`;
      try {
        await ffmpeg.writeFile(rawIn, await fetchFile(firstVideoClip.clip.videoUrl));
        writtenFiles.push(rawIn);
        const code = await ffmpeg.exec([
          '-ss',
          firstVideoClip.clip.trimStartSec.toFixed(2),
          '-t',
          firstVideoClip.keptSec.toFixed(2),
          '-i',
          rawIn,
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          trimmedAudio,
        ]);
        if (code === 0) {
          audioTrackFile = trimmedAudio;
          writtenFiles.push(trimmedAudio);
        }
      } catch {
        // Proceed as video-only MP4 if source has no audio track
      }
    }

    onProgress?.('Encoding H.264 MP4 via ffmpeg.wasm...', 78);

    const onEncodeProgress = ({ progress }: { progress: number }) => {
      const pct = 78 + Math.round(Math.max(0, Math.min(1, progress)) * 18);
      onProgress?.('Encoding H.264 MP4 via ffmpeg.wasm...', Math.min(96, pct));
    };
    ffmpeg.on('progress', onEncodeProgress);

    try {
      const args = [
        '-framerate',
        String(exportFps),
        '-i',
        framePattern,
        ...(audioTrackFile ? ['-i', audioTrackFile] : []),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        ...(audioTrackFile ? ['-c:a', 'copy', '-shortest'] : []),
        '-movflags',
        '+faststart',
        outputMp4,
      ];

      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error('ffmpeg.wasm failed to encode MP4 video.');
      }
    } finally {
      ffmpeg.off('progress', onEncodeProgress);
    }

    onProgress?.('Finalizing MP4 export...', 98);
    const outData = await ffmpeg.readFile(outputMp4);
    const bytes =
      outData instanceof Uint8Array
        ? new Uint8Array(outData)
        : new TextEncoder().encode(String(outData));

    const blob = new Blob([bytes], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);

    onProgress?.('Export ready', 100);
    return {
      blob,
      blobUrl,
      sizeBytes: bytes.byteLength,
      frameCount: frameIndex,
      durationSec: Number(totalKeptDuration.toFixed(2)),
    };
  } finally {
    await ffmpeg.deleteFile(outputMp4).catch(() => {});
    for (const f of writtenFiles) {
      await ffmpeg.deleteFile(f).catch(() => {});
    }
  }
}
