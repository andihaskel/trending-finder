import { relations } from 'drizzle-orm';
import { jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  username: text('username'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
});

// Trends table (without results field)
export const trends = pgTable('trends', {
  id: uuid('id').primaryKey().defaultRandom(),
  keyword: text('keyword').notNull(),
  platforms: text('platforms').array().notNull(),
  timeframe: text('timeframe').notNull(),
  lang: text('lang'),
  region: text('region'),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Posts table with pgvector support
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),

  // ID único de la plataforma (tweet id, reddit id, video id)
  platformId: text('platform_id').notNull(), // ✅ Ahora es NOT NULL
  platform: text('platform').notNull(), // 'reddit' | 'youtube' | 'twitter'

  author: text('author').notNull(),
  content: text('content').notNull(),
  title: text('title'),
  metrics: jsonb('metrics').notNull(),
  link: text('link').notNull(),
  thumbnail: text('thumbnail'),

  // fechas
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(), // fecha real en la plataforma
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), // ingesta en tu sistema
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // score y embedding
  momentumScore: real('momentum_score').notNull(), // double/real para decimales
  // pgvector; usar custom type para vector
  embedding: text('embedding'), // <-- cambiar a vector(1536) cuando tengas pgvector
}, (table) => ({
  // Unique constraint: no puede haber dos posts con el mismo platform_id en la misma plataforma
  uniquePlatformPost: uniqueIndex('unique_platform_post').on(table.platformId, table.platform),
}));
// Relations
export const usersRelations = relations(users, ({ many }) => ({
  trends: many(trends),
}));

export const trendsRelations = relations(trends, ({ one }) => ({
  user: one(users, {
    fields: [trends.userId],
    references: [users.id],
  }),
}));
