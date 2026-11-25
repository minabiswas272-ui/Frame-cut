import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Type } from '@google/genai';
import { getGeminiClient } from './src/lib/gemini-server.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  createProjectWithTimeline,
  deleteUserProject,
  getOrCreateUser,
  listUserProjects,
  updateProjectWithTimeline,
} from './src/db/queries.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

// Serve local single-threaded @ffmpeg/core assets so ffmpeg.wasm works offline/in-iframe
const ffmpegCoreDir =
  process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, 'dist', 'ffmpeg-core')
    : path.resolve(__dirname, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
app.use('/ffmpeg-core', express.static(ffmpegCoreDir));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cloud SQL (PostgreSQL) Project Persistence Routes (Firebase Auth Verified)
// ---------------------------------------------------------------------------

app.get('/api/projects', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const name = typeof req.user!.name === 'string' ? req.user!.name : '';
    await getOrCreateUser(uid, email, name);
    const items = await listUserProjects(uid);
    res.json({ projects: items });
  } catch (error: unknown) {
    console.error('GET /api/projects failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to load projects';
    res.status(500).json({ error: message });
  }
});

app.post('/api/projects', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const name = typeof req.user!.name === 'string' ? req.user!.name : '';
    const dbUser = await getOrCreateUser(uid, email, name);

    const { title, fps, resolution, colorGrade, playheadSec, clips, markers } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Project title is required.' });
      return;
    }

    const project = await createProjectWithTimeline(dbUser.id, {
      title: title.trim(),
      fps: Number(fps) || 24,
      resolution: typeof resolution === 'string' ? resolution : '1920x1080',
      colorGrade: typeof colorGrade === 'string' ? colorGrade : 'standard',
      playheadSec: Number(playheadSec) || 0,
      clips: Array.isArray(clips) ? clips : [],
      markers: Array.isArray(markers) ? markers : [],
    });

    res.status(201).json({ project });
  } catch (error: unknown) {
    console.error('POST /api/projects failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to save project';
    res.status(500).json({ error: message });
  }
});

app.put('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const name = typeof req.user!.name === 'string' ? req.user!.name : '';
    const dbUser = await getOrCreateUser(uid, email, name);

    const { title, fps, resolution, colorGrade, playheadSec, clips, markers } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Project title is required.' });
      return;
    }

    const project = await updateProjectWithTimeline(dbUser.id, projectId, {
      title: title.trim(),
      fps: Number(fps) || 24,
      resolution: typeof resolution === 'string' ? resolution : '1920x1080',
      colorGrade: typeof colorGrade === 'string' ? colorGrade : 'standard',
      playheadSec: Number(playheadSec) || 0,
      clips: Array.isArray(clips) ? clips : [],
      markers: Array.isArray(markers) ? markers : [],
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    res.json({ project });
  } catch (error: unknown) {
    console.error('PUT /api/projects/:id failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to update project';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const uid = req.user!.uid;
    const email = req.user!.email ?? '';
    const name = typeof req.user!.name === 'string' ? req.user!.name : '';
    const dbUser = await getOrCreateUser(uid, email, name);

    const deleted = await deleteUserProject(dbUser.id, projectId);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    res.json({ deleted: true });
  } catch (error: unknown) {
    console.error('DELETE /api/projects/:id failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete project';
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Gemini Intelligence Routes (Server-Side @google/genai)
// ---------------------------------------------------------------------------

// Fast timeline assistant using gemini-3.1-flash-lite
app.post('/api/ai/quick-edit', async (req, res) => {
  try {
    const { task, clips, activeClip, playheadSec, totalDurationSec } = req.body ?? {};
    const ai = getGeminiClient();

    const prompt = [
      `You are a concise, practical non-linear video editor assistant.`,
      `User task: ${typeof task === 'string' && task.trim() ? task.trim() : 'Suggest tight trim points and chapter markers for pacing.'}`,
      `Total sequence duration: ${Number(totalDurationSec || 0).toFixed(2)}s. Current playhead: ${Number(playheadSec || 0).toFixed(2)}s.`,
      `Active clip: ${JSON.stringify(activeClip ?? null)}`,
      `Timeline clips: ${JSON.stringify(Array.isArray(clips) ? clips : [])}`,
      `Return actionable edit suggestions strictly matching the JSON schema. Keep timestamps strictly within clip duration bounds.`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'Concise 1-2 sentence overview of the edit suggestion.',
            },
            suggestedTitle: {
              type: Type.STRING,
              description: 'Clean editorial title for the sequence.',
            },
            trimSuggestion: {
              type: Type.OBJECT,
              properties: {
                trimStartSec: { type: Type.NUMBER },
                trimEndSec: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
              required: ['trimStartSec', 'trimEndSec', 'rationale'],
            },
            markers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  timeSec: { type: Type.NUMBER },
                  notes: { type: Type.STRING },
                },
                required: ['label', 'timeSec', 'notes'],
              },
            },
          },
          required: ['summary', 'suggestedTitle', 'trimSuggestion', 'markers'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ model: 'gemini-3.1-flash-lite', result: parsed });
  } catch (error: unknown) {
    console.error('POST /api/ai/quick-edit failed:', error);
    const message = error instanceof Error ? error.message : 'Gemini quick edit request failed';
    res.status(500).json({ error: message });
  }
});

// Multimodal frame & sequence director analysis using gemini-4-hydrogen
app.post('/api/ai/analyze-scene', async (req, res) => {
  try {
    const { frameBase64, mimeType, clipTitle, durationSec, trimStartSec, trimEndSec, promptNote } =
      req.body ?? {};
    const ai = getGeminiClient();

    const textPrompt = [
      `Analyze this video frame and timeline metadata as a senior film editor and colorist.`,
      `Clip title: ${clipTitle || 'Untitled Clip'}`,
      `Full duration: ${Number(durationSec || 12).toFixed(2)}s | Current Trim IN: ${Number(trimStartSec || 0).toFixed(2)}s | Current Trim OUT: ${Number(trimEndSec || 12).toFixed(2)}s`,
      promptNote ? `Editor focus: ${promptNote}` : 'Provide composition feedback, recommended color LUT preset (one of: standard, warm, mono, cinema), and a tight trim window.',
    ].join('\n');

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (typeof frameBase64 === 'string' && frameBase64.length > 32) {
      parts.push({
        inlineData: {
          mimeType: typeof mimeType === 'string' ? mimeType : 'image/jpeg',
          data: frameBase64,
        },
      });
    }
    parts.push({ text: textPrompt });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            visualAnalysis: { type: Type.STRING },
            pacingAdvice: { type: Type.STRING },
            recommendedColorGrade: {
              type: Type.STRING,
              description: 'Must be one of: standard, warm, mono, cinema',
            },
            recommendedTrimIn: { type: Type.NUMBER },
            recommendedTrimOut: { type: Type.NUMBER },
            captionIdea: { type: Type.STRING },
          },
          required: [
            'visualAnalysis',
            'pacingAdvice',
            'recommendedColorGrade',
            'recommendedTrimIn',
            'recommendedTrimOut',
            'captionIdea',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ model: 'gemini-4-hydrogen', result: parsed });
  } catch (error: unknown) {
    console.error('POST /api/ai/analyze-scene failed:', error);
    const message = error instanceof Error ? error.message : 'Gemini scene analysis failed';
    res.status(500).json({ error: message });
  }
});

// Live Google Search Grounding for production specs, broadcast standards & editorial research using gemini-4-hydrogen
app.post('/api/ai/research', async (req, res) => {
  try {
    const { query } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Answer concisely for a video editor working in post-production. Include exact specs, numbers, or up-to-date facts where relevant:\n\n${query.trim()}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = groundingChunks
      .map((chunk: { web?: { uri?: string; title?: string } }) => chunk.web)
      .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
      .map((w) => ({
        uri: w.uri,
        title: w.title || w.uri,
      }));

    res.json({
      model: 'gemini-4-hydrogen',
      answer: response.text ?? '',
      sources,
    });
  } catch (error: unknown) {
    console.error('POST /api/ai/research failed:', error);
    const message = error instanceof Error ? error.message : 'Search-grounded research failed';
    res.status(500).json({ error: message });
  }
});

// Transcribe extracted video audio via gemini-3.5-transcribe and generate timed caption cues via gemini-4-hydrogen
app.post('/api/ai/transcribe-captions', async (req, res) => {
  try {
    const { audioBase64, mimeType, durationSec, startOffsetSec, clipTitle } = req.body ?? {};
    if (typeof audioBase64 !== 'string' || audioBase64.length < 64) {
      res.status(400).json({ error: 'Extracted audio data is required for transcription.' });
      return;
    }

    const safeMime = typeof mimeType === 'string' && mimeType.startsWith('audio/')
      ? mimeType
      : 'audio/mp3';
    const clipDur = Math.max(0.5, Number(durationSec) || 12);
    const offset = Math.max(0, Number(startOffsetSec) || 0);
    const ai = getGeminiClient();

    const audioPart = {
      inlineData: {
        mimeType: safeMime,
        data: audioBase64,
      },
    };

    // Step 1: High-accuracy transcription using gemini-3.5-transcribe
    const transcribeResp = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          audioPart,
          { text: 'Transcribe this audio verbatim with accurate punctuation.' },
        ],
      },
    });
    const transcript = (transcribeResp.text ?? '').trim();

    // Step 2: Generate crisp timestamped subtitle cues synchronized to the audio
    const alignResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          audioPart,
          {
            text: [
              `Create accurate, tightly timed video caption cues for the audio clip "${clipTitle || 'Video Clip'}" (duration ${clipDur.toFixed(2)} seconds).`,
              `Verbatim transcript from audio transcription: "${transcript}"`,
              `Split into concise, readable subtitle lines (max 8-11 words per cue).`,
              `Return startSec and endSec relative to this clip (0 to ${clipDur.toFixed(2)}s) with non-overlapping chronological timestamps.`,
              `If the audio is instrumental or ambient with no speech, return descriptive audio captions (e.g. "[Ambient music playing]").`,
            ].join('\n'),
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            captions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                },
                required: ['startSec', 'endSec', 'text'],
              },
            },
          },
          required: ['captions'],
        },
      },
    });

    const parsed = JSON.parse((alignResp.text ?? '{"captions":[]}').trim()) as {
      captions?: Array<{ startSec: number; endSec: number; text: string }>;
    };

    const captions = (parsed.captions ?? [])
      .filter((c) => typeof c.text === 'string' && c.text.trim().length > 0)
      .map((c, idx) => {
        const relStart = Math.max(0, Math.min(clipDur - 0.2, Number(c.startSec) || 0));
        const relEnd = Math.min(clipDur, Math.max(relStart + 0.35, Number(c.endSec) || relStart + 2));
        return {
          id: `cap_${Date.now()}_${idx}`,
          startSec: Number((offset + relStart).toFixed(2)),
          endSec: Number((offset + relEnd).toFixed(2)),
          text: c.text.trim(),
        };
      });

    res.json({
      model: 'gemini-3.5-transcribe + gemini-4-hydrogen',
      transcript,
      captions,
    });
  } catch (error: unknown) {
    console.error('POST /api/ai/transcribe-captions failed:', error);
    const message = error instanceof Error ? error.message : 'Audio transcription failed';
    res.status(500).json({ error: message });
  }
});

// Generate timed documentary visual captions for silent video clips / starter reels
app.post('/api/ai/visual-captions', async (req, res) => {
  try {
    const { frameBase64, mimeType, clipTitle, startOffsetSec, trimStartSec, trimEndSec } =
      req.body ?? {};
    const ai = getGeminiClient();

    const offset = Math.max(0, Number(startOffsetSec) || 0);
    const tIn = Math.max(0, Number(trimStartSec) || 0);
    const tOut = Math.max(tIn + 1, Number(trimEndSec) || 10);

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (typeof frameBase64 === 'string' && frameBase64.length > 32) {
      parts.push({
        inlineData: {
          mimeType: typeof mimeType === 'string' ? mimeType : 'image/jpeg',
          data: frameBase64,
        },
      });
    }
    parts.push({
      text: [
        `Generate 2 to 4 concise, cinematic documentary caption cues describing this shot "${clipTitle || 'Clip'}".`,
        `Place timestamps strictly between ${tIn.toFixed(2)}s and ${tOut.toFixed(2)}s relative to the clip.`,
        `Keep each caption natural, evocative, and under 10 words.`,
      ].join('\n'),
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            captions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                },
                required: ['startSec', 'endSec', 'text'],
              },
            },
          },
          required: ['captions'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{"captions":[]}').trim()) as {
      captions?: Array<{ startSec: number; endSec: number; text: string }>;
    };

    const captions = (parsed.captions ?? [])
      .filter((c) => typeof c.text === 'string' && c.text.trim().length > 0)
      .map((c, idx) => {
        const relStart = Math.max(tIn, Math.min(tOut - 0.3, Number(c.startSec) || tIn));
        const relEnd = Math.min(tOut, Math.max(relStart + 0.5, Number(c.endSec) || relStart + 2.5));
        return {
          id: `vcap_${Date.now()}_${idx}`,
          startSec: Number((offset + relStart).toFixed(2)),
          endSec: Number((offset + relEnd).toFixed(2)),
          text: c.text.trim(),
        };
      });

    res.json({ model: 'gemini-4-hydrogen', captions });
  } catch (error: unknown) {
    console.error('POST /api/ai/visual-captions failed:', error);
    const message = error instanceof Error ? error.message : 'Visual caption generation failed';
    res.status(500).json({ error: message });
  }
});

async function withGeminiRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('overloaded');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastError;
}

// One-Click Auto Video Editor: analyzes sampled clip frames, timeline metadata & optional audio transcript
// and outputs a complete trim, Canvas FX, color grade, marker, and caption plan via gemini-4-hydrogen
app.post('/api/ai/auto-edit', async (req, res) => {
  try {
    const { clips, frames, style, transcript, options } = req.body ?? {};
    if (!Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: 'At least one timeline clip is required for Auto Edit.' });
      return;
    }

    const safeStyle =
      style === 'social' || style === 'editorial' || style === 'noir' ? style : 'cinematic';

    const styleBriefs: Record<string, string> = {
      cinematic:
        'Cinematic Documentary: measured emotional pacing, remove head/tail dead air (keep ~65-80% strongest middle moments), warm or cinema LUT, balanced contrast/saturation polish, subtle sharpen (12-25), clean bottom documentary captions.',
      social:
        'Fast Social Cut: punchy high-energy pacing, tight trims (keep ~45-65% peak action), optional 1.25x or 1.5x speed on slower establishing clips, crisp contrast & saturation boost, sharper clarity (20-38), bold uppercase high-impact captions.',
      editorial:
        'Editorial Highlight: clean commercial rhythm, precise trims (keep ~60-75%), natural or subtle warm grade, gentle contrast/brightness lift, crisp sharpen (15-28), refined chapter markers and concise editorial captions.',
      noir:
        'Moody Noir: atmospheric deliberate holds (keep ~60-75%), mono or cinema LUT, elevated contrast (112-128), restrained brightness, subtle sharpen (14-26), understated bottom captions.',
    };

    const normalizedClips = clips.map(
      (
        c: {
          id?: string;
          title?: string;
          durationSec?: number;
          trimStartSec?: number;
          trimEndSec?: number;
          startOffsetSec?: number;
        },
        idx: number
      ) => ({
        id: String(c.id || `clip_${idx}`),
        title: String(c.title || `Clip ${idx + 1}`),
        durationSec: Math.max(0.5, Number(c.durationSec) || 10),
        currentTrimStartSec: Math.max(0, Number(c.trimStartSec) || 0),
        currentTrimEndSec: Math.max(0.5, Number(c.trimEndSec) || Number(c.durationSec) || 10),
        startOffsetSec: Math.max(0, Number(c.startOffsetSec) || 0),
      })
    );

    const totalTimelineDur = normalizedClips.reduce(
      (max, c) => Math.max(max, c.startOffsetSec + c.durationSec),
      0
    );

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (Array.isArray(frames)) {
      for (const frame of frames.slice(0, 4)) {
        if (frame && typeof frame.base64 === 'string' && frame.base64.length > 64) {
          parts.push({
            inlineData: {
              mimeType: typeof frame.mimeType === 'string' ? frame.mimeType : 'image/jpeg',
              data: frame.base64,
            },
          });
        }
      }
    }

    const promptText = [
      `You are an expert One-Click Auto Video Editor directing a complete automated cut for a non-linear timeline.`,
      `Requested Edit Style: ${styleBriefs[safeStyle]}`,
      `Enabled steps: ${JSON.stringify(options ?? { autoTrim: true, autoEnhance: true, autoCaptions: true, autoMarkers: true })}`,
      `Timeline clips (with exact clipId, durationSec, and startOffsetSec on the global timeline):`,
      JSON.stringify(normalizedClips, null, 2),
      typeof transcript === 'string' && transcript.trim().length > 0
        ? `Transcribed spoken audio from the video: "${transcript.trim()}" — align captions to this actual spoken dialogue.`
        : `No spoken audio transcript provided — craft vivid, concise, non-generic captions matching the sampled visual frames and shot subjects.`,
      `Rules:`,
      `1. Return one clipEdit entry for EVERY clipId in the input. trimStartSec and trimEndSec MUST be local to that clip (0 <= trimStartSec < trimEndSec <= durationSec, with at least 1.5s kept unless clip is shorter).`,
      `2. playbackRate MUST be one of: 0.5, 1, 1.5, 2 (use 1 for cinematic/editorial/noir unless speed ramping makes sense for social).`,
      `3. colorGrade MUST be one of: standard, warm, mono, cinema.`,
      `4. videoAdjustments: brightness (88-116), contrast (94-130), saturation (75-134), sharpen (8-42). Choose tasteful values that genuinely enhance the sampled frames.`,
      `5. markers: 3 to 5 timeline markers placed on global timeline timestamps (0 to ${totalTimelineDur.toFixed(2)}s) inside the kept clip regions. color must be one of: amber, sky, emerald, rose.`,
      `6. captions: 3 to 6 concise, chronological subtitle cues placed on global timeline timestamps STRICTLY inside the kept [startOffsetSec + trimStartSec, startOffsetSec + trimEndSec] windows so captions appear during playback.`,
      `7. captionStyle: fontFamily (one of "DM Sans", "Plus Jakarta Sans", "JetBrains Mono", "Georgia"), fontSize (24-40), textColor (hex like "#FFFFFF" or "#FDE047"), bgOpacity (0.35-0.85), position ("bottom" | "middle" | "top"), bold (boolean), uppercase (boolean), outline (boolean).`,
    ].join('\n');

    parts.push({ text: promptText });

    const ai = getGeminiClient();
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              projectTitle: { type: Type.STRING },
              editSummary: { type: Type.STRING },
              colorGrade: {
                type: Type.STRING,
                description: 'One of: standard, warm, mono, cinema',
              },
              videoAdjustments: {
                type: Type.OBJECT,
                properties: {
                  brightness: { type: Type.NUMBER },
                  contrast: { type: Type.NUMBER },
                  saturation: { type: Type.NUMBER },
                  sharpen: { type: Type.NUMBER },
                },
                required: ['brightness', 'contrast', 'saturation', 'sharpen'],
              },
              clipEdits: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    clipId: { type: Type.STRING },
                    trimStartSec: { type: Type.NUMBER },
                    trimEndSec: { type: Type.NUMBER },
                    playbackRate: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                  required: ['clipId', 'trimStartSec', 'trimEndSec', 'playbackRate', 'reason'],
                },
              },
              markers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    timeSec: { type: Type.NUMBER },
                    color: { type: Type.STRING },
                    notes: { type: Type.STRING },
                  },
                  required: ['label', 'timeSec', 'color', 'notes'],
                },
              },
              captions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                  required: ['startSec', 'endSec', 'text'],
                },
              },
              captionStyle: {
                type: Type.OBJECT,
                properties: {
                  fontFamily: { type: Type.STRING },
                  fontSize: { type: Type.NUMBER },
                  textColor: { type: Type.STRING },
                  bgOpacity: { type: Type.NUMBER },
                  position: { type: Type.STRING },
                  bold: { type: Type.BOOLEAN },
                  uppercase: { type: Type.BOOLEAN },
                  outline: { type: Type.BOOLEAN },
                },
                required: [
                  'fontFamily',
                  'fontSize',
                  'textColor',
                  'bgOpacity',
                  'position',
                  'bold',
                  'uppercase',
                  'outline',
                ],
              },
            },
            required: [
              'projectTitle',
              'editSummary',
              'colorGrade',
              'videoAdjustments',
              'clipEdits',
              'markers',
              'captions',
              'captionStyle',
            ],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ model: 'gemini-4-hydrogen', plan: parsed });
  } catch (error: unknown) {
    console.error('POST /api/ai/auto-edit failed:', error);
    const message = error instanceof Error ? error.message : 'One-Click Auto Edit failed';
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Vite Dev Middleware / Production Static Assets
// ---------------------------------------------------------------------------

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`FrameCut Studio server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
