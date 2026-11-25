import {
  buildCanvasFilterString,
  type CaptionCue,
  type CaptionStyle,
  type ColorGrade,
  type VideoAdjustments,
} from '../types/editor';

/**
 * Applies a fast 3x3 unsharp/sharpen convolution kernel directly to HTML5 Canvas pixel data.
 */
export function applyCanvasSharpen(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sharpenAmount: number
): void {
  if (sharpenAmount <= 0) return;
  const amount = (sharpenAmount / 100) * 1.15;
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);

  const rowStride = width * 4;
  const centerWeight = 1 + 4 * amount;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * rowStride;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x * 4;
      const top = idx - rowStride;
      const bottom = idx + rowStride;
      const left = idx - 4;
      const right = idx + 4;

      out[idx] =
        src[idx] * centerWeight -
        (src[top] + src[bottom] + src[left] + src[right]) * amount;
      out[idx + 1] =
        src[idx + 1] * centerWeight -
        (src[top + 1] + src[bottom + 1] + src[left + 1] + src[right + 1]) * amount;
      out[idx + 2] =
        src[idx + 2] * centerWeight -
        (src[top + 2] + src[bottom + 2] + src[left + 2] + src[right + 2]) * amount;
      out[idx + 3] = src[idx + 3];
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return `rgba(9, 11, 16, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function wrapCaptionLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines.slice(0, 3);
}

/**
 * Renders customizable styled captions directly onto the HTML5 Canvas frame.
 */
export function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: CaptionStyle
): void {
  if (!style.enabled || !text.trim()) return;

  const scaleFactor = width / 960;
  const fontSizePx = Math.max(14, Math.round(style.fontSize * scaleFactor));
  const weight = style.bold ? '700' : '500';
  const displayText = style.uppercase ? text.toUpperCase() : text;

  ctx.save();
  ctx.filter = 'none';
  ctx.font = `${weight} ${fontSizePx}px "${style.fontFamily}", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = width * 0.82;
  const lines = wrapCaptionLines(ctx, displayText, maxTextWidth);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const lineHeight = Math.round(fontSizePx * 1.28);
  const padX = Math.round(fontSizePx * 0.55);
  const padY = Math.round(fontSizePx * 0.34);
  const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.min(width * 0.9, maxLineW + padX * 2);
  const boxH = lines.length * lineHeight + padY * 2;
  const boxX = (width - boxW) / 2;

  let boxY: number;
  if (style.position === 'top') {
    boxY = Math.round(height * 0.08);
  } else if (style.position === 'middle') {
    boxY = Math.round((height - boxH) / 2);
  } else {
    boxY = Math.round(height * 0.84 - boxH);
  }

  // Rounded backdrop box when opacity > 0
  if (style.bgOpacity > 0.02) {
    const radius = Math.round(8 * scaleFactor);
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.bgOpacity);
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();
  }

  // Draw each line with optional stroke outline for crisp legibility
  lines.forEach((line, index) => {
    const textY = boxY + padY + lineHeight * (index + 0.5);
    if (style.outline) {
      ctx.lineWidth = Math.max(2, Math.round(fontSizePx * 0.12));
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.strokeText(line, width / 2, textY);
    }
    ctx.fillStyle = style.textColor;
    ctx.fillText(line, width / 2, textY);
  });

  ctx.restore();
}

export function findActiveCaptionText(
  captions: CaptionCue[],
  timeSec: number
): string {
  const found = captions.find((c) => timeSec >= c.startSec && timeSec <= c.endSec);
  return found?.text ?? '';
}

export interface CompositeFrameOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  source:
    | { kind: 'video'; video: HTMLVideoElement }
    | { kind: 'image'; img: HTMLImageElement | null; clipLocalTime: number; durationSec: number };
  colorGrade: ColorGrade;
  videoAdjustments: VideoAdjustments;
  bypassFilters: boolean;
  captionText: string;
  captionStyle: CaptionStyle;
  includeVignette?: boolean;
}

export function renderCompositeFrame(options: CompositeFrameOptions): void {
  const {
    ctx,
    width,
    height,
    source,
    colorGrade,
    videoAdjustments,
    bypassFilters,
    captionText,
    captionStyle,
    includeVignette = false,
  } = options;

  const canvasFilter = buildCanvasFilterString(colorGrade, videoAdjustments, bypassFilters);

  ctx.save();
  ctx.filter = 'none';
  ctx.fillStyle = '#07090D';
  ctx.fillRect(0, 0, width, height);

  ctx.filter = canvasFilter;

  if (source.kind === 'video') {
    const { video } = source;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = width / height;
      let drawW = width;
      let drawH = height;
      let dx = 0;
      let dy = 0;

      if (videoAspect > canvasAspect) {
        drawH = width / videoAspect;
        dy = (height - drawH) / 2;
      } else {
        drawW = height * videoAspect;
        dx = (width - drawW) / 2;
      }
      ctx.drawImage(video, dx, dy, drawW, drawH);
    }
  } else {
    const { img, clipLocalTime, durationSec } = source;
    if (img && img.complete && img.naturalWidth > 0) {
      const progress = durationSec > 0 ? clipLocalTime / durationSec : 0;
      const scale = 1.02 + progress * 0.09;
      const panX = (progress - 0.5) * (34 * (width / 960));
      const panY = Math.sin(progress * Math.PI) * (-10 * (height / 540));

      const drawW = width * scale;
      const drawH = height * scale;
      const dx = (width - drawW) / 2 + panX;
      const dy = (height - drawH) / 2 + panY;
      ctx.drawImage(img, dx, dy, drawW, drawH);
    } else {
      ctx.filter = 'none';
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#141923');
      grad.addColorStop(1, '#0C0F16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }
  ctx.restore();

  if (!bypassFilters && videoAdjustments.sharpen > 0) {
    try {
      applyCanvasSharpen(ctx, width, height, videoAdjustments.sharpen);
    } catch {
      // Ignore if canvas is cross-origin tainted
    }
  }

  if (includeVignette) {
    const vig = ctx.createRadialGradient(
      width / 2,
      height / 2,
      width * 0.34,
      width / 2,
      height / 2,
      width * 0.7
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  }

  // Burn customizable styled caption onto the canvas
  if (captionText && captionStyle.enabled) {
    drawCaptionOverlay(ctx, width, height, captionText, captionStyle);
  }
}
