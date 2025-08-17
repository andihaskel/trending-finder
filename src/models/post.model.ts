// types.ts

export type Platform = 'reddit' | 'youtube' | 'twitter';

export interface PostMetrics {
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
  upvotes?: number;
  comments?: number;
}

/**
 * Representa un post ya persistido (lectura/salida).
 * - `publishedAt`: fecha real en la plataforma de origen
 * - `createdAt`: fecha de ingestión en TU sistema
 * - `embedding`: lo genera el backend (pgvector), no se envía en creación
 */
export interface Post {
  id: string;                  // UUID interno (PK)
  platformId: string;          // ID único de la plataforma (tweet id, reddit id, video id)
  platform: Platform;
  author: string;
  content: string;
  title?: string;
  metrics: PostMetrics;
  link: string;
  thumbnail?: string;
  publishedAt: Date;           // fecha original del contenido
  createdAt: Date;             // fecha en tu sistema
  momentumScore: number;
  embedding?: number[];        // generado en backend
}

/**
 * Payload de creación (entrada).
 * - Requerimos `publishedAt` (fecha real del post).
 * - `createdAt` lo setea el backend (opcional en el payload).
 * - `momentumScore` puede venir calculado o lo calculamos nosotros si falta.
 * - No se acepta `embedding`; lo genera el backend.
 */
export interface PostCreate {
  platformId: string;          // ID único de la plataforma (requerido)
  platform: Platform;
  author: string;
  content: string;
  title?: string;
  metrics: PostMetrics;
  link: string;
  thumbnail?: string;
  publishedAt: Date;           // ✅ antes era createdAt; corregido
  createdAt?: Date;            // opcional: el servidor puede asignarlo (now)
  momentumScore?: number;      // opcional: el servidor puede calcularlo
  // embedding?: never
}

export interface SearchOptions {
  keyword: string;
  platforms: Platform[];
  timeframe: string;           // '1h' | '24h' | '7d' | '30d' | '1y' | 'all', etc.
  lang?: string;
  region?: string;
  limit?: number;
}

export interface SearchResult {
  keyword: string;
  platforms: Platform[];
  results: Post[];
  totalResults: number;
  searchTime: Date;
}
