import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { clips, markers, projects, users } from './schema.ts';

export interface ClipInput {
  title: string;
  sourceType: string;
  sourceRef: string;
  posterUrl?: string;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  timelineOrder: number;
  playbackRate?: number;
  volume?: number;
}

export interface MarkerInput {
  label: string;
  timeSec: number;
  color?: string;
  notes?: string;
  source?: string;
}

export async function getOrCreateUser(uid: string, email: string, displayName = '') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to upsert user:', error);
    throw new Error('Unable to synchronize user account.', { cause: error });
  }
}

export async function listUserProjects(uid: string) {
  try {
    const userRows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (!userRows.length) {
      return [];
    }
    const userId = userRows[0].id;
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));

    const enriched = await Promise.all(
      projectRows.map(async (proj) => {
        const [projClips, projMarkers] = await Promise.all([
          db
            .select()
            .from(clips)
            .where(eq(clips.projectId, proj.id))
            .orderBy(asc(clips.timelineOrder)),
          db
            .select()
            .from(markers)
            .where(eq(markers.projectId, proj.id))
            .orderBy(asc(markers.timeSec)),
        ]);
        return {
          ...proj,
          clips: projClips,
          markers: projMarkers,
        };
      })
    );

    return enriched;
  } catch (error) {
    console.error('Failed to list user projects:', error);
    throw new Error('Unable to load saved projects. Please try again later.', { cause: error });
  }
}

export async function createProjectWithTimeline(
  userId: number,
  payload: {
    title: string;
    fps?: number;
    resolution?: string;
    colorGrade?: string;
    playheadSec?: number;
    clips: ClipInput[];
    markers: MarkerInput[];
  }
) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({
          userId,
          title: payload.title.slice(0, 120),
          fps: payload.fps ?? 24,
          resolution: payload.resolution ?? '1920x1080',
          colorGrade: payload.colorGrade ?? 'standard',
          playheadSec: payload.playheadSec ?? 0,
        })
        .returning();

      const insertedClips = payload.clips.length
        ? await tx
            .insert(clips)
            .values(
              payload.clips.map((c, idx) => ({
                projectId: created.id,
                title: c.title.slice(0, 160),
                sourceType: c.sourceType,
                sourceRef: c.sourceRef.slice(0, 512),
                posterUrl: (c.posterUrl ?? '').slice(0, 512),
                durationSec: Math.max(0.1, Number(c.durationSec) || 10),
                trimStartSec: Math.max(0, Number(c.trimStartSec) || 0),
                trimEndSec: Math.max(0.1, Number(c.trimEndSec) || Number(c.durationSec) || 10),
                timelineOrder: Number.isFinite(c.timelineOrder) ? c.timelineOrder : idx,
                playbackRate: Number(c.playbackRate) || 1,
                volume: Math.min(1, Math.max(0, Number(c.volume ?? 0.85))),
              }))
            )
            .returning()
        : [];

      const insertedMarkers = payload.markers.length
        ? await tx
            .insert(markers)
            .values(
              payload.markers.map((m) => ({
                projectId: created.id,
                label: m.label.slice(0, 120),
                timeSec: Math.max(0, Number(m.timeSec) || 0),
                color: (m.color ?? 'amber').slice(0, 32),
                notes: (m.notes ?? '').slice(0, 500),
                source: (m.source ?? 'user').slice(0, 32),
              }))
            )
            .returning()
        : [];

      return {
        ...created,
        clips: insertedClips,
        markers: insertedMarkers,
      };
    });
  } catch (error) {
    console.error('Failed to create project:', error);
    throw new Error('Unable to save project to database.', { cause: error });
  }
}

export async function updateProjectWithTimeline(
  userId: number,
  projectId: number,
  payload: {
    title: string;
    fps?: number;
    resolution?: string;
    colorGrade?: string;
    playheadSec?: number;
    clips: ClipInput[];
    markers: MarkerInput[];
  }
) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
        .limit(1);

      if (!existing.length) {
        return null;
      }

      const [updated] = await tx
        .update(projects)
        .set({
          title: payload.title.slice(0, 120),
          fps: payload.fps ?? existing[0].fps,
          resolution: payload.resolution ?? existing[0].resolution,
          colorGrade: payload.colorGrade ?? existing[0].colorGrade,
          playheadSec: payload.playheadSec ?? existing[0].playheadSec,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
        .returning();

      await tx.delete(clips).where(eq(clips.projectId, projectId));
      await tx.delete(markers).where(eq(markers.projectId, projectId));

      const insertedClips = payload.clips.length
        ? await tx
            .insert(clips)
            .values(
              payload.clips.map((c, idx) => ({
                projectId,
                title: c.title.slice(0, 160),
                sourceType: c.sourceType,
                sourceRef: c.sourceRef.slice(0, 512),
                posterUrl: (c.posterUrl ?? '').slice(0, 512),
                durationSec: Math.max(0.1, Number(c.durationSec) || 10),
                trimStartSec: Math.max(0, Number(c.trimStartSec) || 0),
                trimEndSec: Math.max(0.1, Number(c.trimEndSec) || Number(c.durationSec) || 10),
                timelineOrder: Number.isFinite(c.timelineOrder) ? c.timelineOrder : idx,
                playbackRate: Number(c.playbackRate) || 1,
                volume: Math.min(1, Math.max(0, Number(c.volume ?? 0.85))),
              }))
            )
            .returning()
        : [];

      const insertedMarkers = payload.markers.length
        ? await tx
            .insert(markers)
            .values(
              payload.markers.map((m) => ({
                projectId,
                label: m.label.slice(0, 120),
                timeSec: Math.max(0, Number(m.timeSec) || 0),
                color: (m.color ?? 'amber').slice(0, 32),
                notes: (m.notes ?? '').slice(0, 500),
                source: (m.source ?? 'user').slice(0, 32),
              }))
            )
            .returning()
        : [];

      return {
        ...updated,
        clips: insertedClips,
        markers: insertedMarkers,
      };
    });
  } catch (error) {
    console.error('Failed to update project:', error);
    throw new Error('Unable to update project in database.', { cause: error });
  }
}

export async function deleteUserProject(userId: number, projectId: number) {
  try {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw new Error('Unable to delete project from database.', { cause: error });
  }
}
