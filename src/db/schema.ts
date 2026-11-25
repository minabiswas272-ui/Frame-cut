import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  fps: integer('fps').notNull().default(24),
  resolution: text('resolution').notNull().default('1920x1080'),
  colorGrade: text('color_grade').notNull().default('standard'),
  playheadSec: doublePrecision('playhead_sec').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clips = pgTable('clips', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  sourceType: text('source_type').notNull().default('sample'),
  sourceRef: text('source_ref').notNull(),
  posterUrl: text('poster_url').notNull().default(''),
  durationSec: doublePrecision('duration_sec').notNull(),
  trimStartSec: doublePrecision('trim_start_sec').notNull().default(0),
  trimEndSec: doublePrecision('trim_end_sec').notNull(),
  timelineOrder: integer('timeline_order').notNull().default(0),
  playbackRate: doublePrecision('playback_rate').notNull().default(1),
  volume: doublePrecision('volume').notNull().default(0.85),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const markers = pgTable('markers', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  label: text('label').notNull(),
  timeSec: doublePrecision('time_sec').notNull(),
  color: text('color').notNull().default('amber'),
  notes: text('notes').notNull().default(''),
  source: text('source').notNull().default('user'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  clips: many(clips),
  markers: many(markers),
}));

export const clipsRelations = relations(clips, ({ one }) => ({
  project: one(projects, {
    fields: [clips.projectId],
    references: [projects.id],
  }),
}));

export const markersRelations = relations(markers, ({ one }) => ({
  project: one(projects, {
    fields: [markers.projectId],
    references: [projects.id],
  }),
}));
