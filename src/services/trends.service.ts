import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { posts, trends } from '../db/schema';
import {
  Platform,
  Post,
  PostCreate,
  PostMetrics,
  SearchOptions,
  SearchResult,
} from '../models/post.model';
import { Trend } from '../models/trend.model';
import { EmbeddingService } from './embedding.service';
import { PlatformFactory } from './platform.factory';

export class TrendsService {
  private platformFactory = new PlatformFactory();
  private embeddingService = new EmbeddingService();

  /**
   * Core: busca primero en DB (vector), si no hay buen match pega a plataformas externas,
   * calcula momentum, filtra por timeframe/plataformas y devuelve normalizado.
   */
  async searchTrends(options: SearchOptions): Promise<SearchResult> {
    try {
      const platforms = this.validatePlatforms(options.platforms);

      // 1) Intento vector search en DB
      const dbResult = await this.searchTrendsInDatabase({ ...options, platforms });
      if (dbResult) return dbResult;

      // 2) Fallback a APIs externas
      const platformResults = await this.platformFactory.searchTrendsAcrossPlatforms(
        options.keyword,
        platforms,
        options
      );

      const all: Post[] = [];
      for (const [, list] of platformResults) all.push(...list);

      // momentum + filtros + orden
      const enriched = all.map((p) =>
        typeof p.momentumScore === 'number' ? p : { ...p, momentumScore: this.calculateMomentumScore(p) }
      );
      const filtered = this.applyFiltersAndSort(enriched, { ...options, platforms });

      const result: SearchResult = {
        keyword: options.keyword,
        platforms,
        results: filtered,
        totalResults: filtered.length,
        searchTime: new Date(),
      };

      // guardar en background (no bloquear respuesta)
      this.saveSearchToDatabase(options, result).catch((e) =>
        console.error('Error saving search to DB:', e)
      );

      return result;
    } catch (e: any) {
      console.error('Error in searchTrends:', e);
      throw new Error(`Failed to search trends: ${e?.message ?? e}`);
    }
  }

  /**
   * DB vector search (pgvector) + filtros (timeframe/plataformas) + orden por momentum
   */
  private async searchTrendsInDatabase(options: SearchOptions): Promise<SearchResult | null> {
    try {
      const queryEmbedding = await this.generateEmbedding(options.keyword);

      if (!queryEmbedding) {
        // fallback a texto si no se pudo generar el embedding
        const textPosts = await this.searchPostsByText(options.keyword, options.limit ?? 50);
        const filtered = this.applyFiltersAndSort(textPosts, options);
        if (!filtered.length) return null;
        return this.toSearchResult(options, filtered);
      }

      // Traemos N candidatos por vector, luego filtramos por timeframe y plataformas
      const raw = await db.execute(sql`
        SELECT 
          id, platform, author, content, title, metrics, link, thumbnail,
          published_at, created_at, momentum_score
        FROM ${posts}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <-> ${queryEmbedding}
        LIMIT ${options.limit ?? 100}
      `);

      const rows: any[] = Array.isArray((raw as any)?.rows)
        ? (raw as any).rows
        : Array.isArray(raw)
          ? (raw as any)
          : [];

      const vecPosts: Post[] = rows.map((r) => ({
        id: r.id,
        platform: r.platform as Platform,
        author: r.author,
        content: r.content,
        title: r.title ?? undefined,
        metrics: (r.metrics ?? {}) as PostMetrics,
        link: r.link,
        thumbnail: r.thumbnail ?? undefined,
        publishedAt: new Date(r.published_at),
        createdAt: new Date(r.created_at),
        momentumScore:
          typeof r.momentum_score === 'number'
            ? r.momentum_score
            : this.calculateMomentumScore({
              id: r.id,
              platform: r.platform,
              author: r.author,
              content: r.content,
              title: r.title ?? undefined,
              metrics: (r.metrics ?? {}) as PostMetrics,
              link: r.link,
              thumbnail: r.thumbnail ?? undefined,
              publishedAt: new Date(r.published_at),
              createdAt: new Date(r.created_at),
              momentumScore: 0,
            }),
      }));

      const filtered = this.applyFiltersAndSort(vecPosts, options);
      if (!filtered.length) return null;

      return this.toSearchResult(options, filtered);
    } catch (e) {
      console.error('Error in vector search from DB:', e);
      return null;
    }
  }

  /**
   * Utilidad: vector search directo (solo posts)
   */
  async searchPostsByVector(queryEmbedding: number[], limit = 10): Promise<Post[]> {
    try {
      const raw = await db.execute(sql`
        SELECT 
          id, platform, author, content, title, metrics, link, thumbnail,
          published_at, created_at, momentum_score
        FROM ${posts}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <-> ${queryEmbedding}
        LIMIT ${limit}
      `);

      const rows: any[] = Array.isArray((raw as any)?.rows)
        ? (raw as any).rows
        : Array.isArray(raw)
          ? (raw as any)
          : [];

      return rows.map((r) => ({
        id: r.id,
        platform: r.platform as Platform,
        author: r.author,
        content: r.content,
        title: r.title ?? undefined,
        metrics: (r.metrics ?? {}) as PostMetrics,
        link: r.link,
        thumbnail: r.thumbnail ?? undefined,
        publishedAt: new Date(r.published_at),
        createdAt: new Date(r.created_at),
        momentumScore: typeof r.momentum_score === 'number' ? r.momentum_score : 0,
      }));
    } catch (e) {
      console.error('Error in searchPostsByVector:', e);
      return [];
    }
  }

  /**
   * Keyword → embedding → vector search, con fallback ILIKE
   */
  async searchPostsByKeyword(keyword: string, limit = 10): Promise<Post[]> {
    try {
      const emb = await this.generateEmbedding(keyword);
      if (!emb) return this.searchPostsByText(keyword, limit);
      return this.searchPostsByVector(emb, limit);
    } catch (e) {
      console.error('Error in searchPostsByKeyword:', e);
      return this.searchPostsByText(keyword, limit);
    }
  }

  /**
   * Búsqueda por texto (ILIKE), ordenando por momentum
   */
  private async searchPostsByText(keyword: string, limit = 10): Promise<Post[]> {
    try {
      const raw = await db.execute(sql`
        SELECT 
          id, platform, author, content, title, metrics, link, thumbnail,
          published_at, created_at, momentum_score
        FROM ${posts}
        WHERE content ILIKE ${'%' + keyword + '%'} OR title ILIKE ${'%' + keyword + '%'}
        ORDER BY momentum_score DESC
        LIMIT ${limit}
      `);

      const rows: any[] = Array.isArray((raw as any)?.rows)
        ? (raw as any).rows
        : Array.isArray(raw)
          ? (raw as any)
          : [];

      return rows.map((r) => ({
        id: r.id,
        platform: r.platform as Platform,
        author: r.author,
        content: r.content,
        title: r.title ?? undefined,
        metrics: (r.metrics ?? {}) as PostMetrics,
        link: r.link,
        thumbnail: r.thumbnail ?? undefined,
        publishedAt: new Date(r.published_at),
        createdAt: new Date(r.created_at),
        momentumScore: typeof r.momentum_score === 'number' ? r.momentum_score : 0,
      }));
    } catch (e) {
      console.error('Error in searchPostsByText:', e);
      return [];
    }
  }

  /**
   * Generar embedding con el EmbeddingService
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      return await this.embeddingService.generateEmbedding(text);
    } catch (e) {
      console.error('Error generating embedding:', e);
      return null;
    }
  }

  /**
   * Trending topics (keywords más consultadas en una ventana)
   */
  async getTrendingTopics(limit = 10, window: string = '7 days'): Promise<string[]> {
    try {
      const raw = await db.execute(sql`
        SELECT ${trends.keyword} AS keyword, COUNT(*) AS cnt
        FROM ${trends}
        WHERE ${trends.createdAt} >= NOW() - INTERVAL ${window}
        GROUP BY ${trends.keyword}
        ORDER BY cnt DESC
        LIMIT ${limit}
      `);

      const rows: any[] = Array.isArray((raw as any)?.rows)
        ? (raw as any).rows
        : Array.isArray(raw)
          ? (raw as any)
          : [];

      return rows.map((r) => r.keyword as string);
    } catch (e) {
      console.error('Error getting trending topics:', e);
      return [];
    }
  }

  /**
   * Historial de búsquedas por usuario
   */
  async getUserSearchHistory(userId: string, limit = 20): Promise<Trend[]> {
    try {
      const rows = await db
        .select()
        .from(trends)
        .where(eq(trends.userId, userId))
        .orderBy(desc(trends.createdAt))
        .limit(limit);

      return rows as unknown as Trend[];
    } catch (e) {
      console.error('Error getting user search history:', e);
      return [];
    }
  }

  // Estado y plataformas disponibles (passthrough a factory)
  getPlatformStatus() {
    return this.platformFactory.getPlatformStatus();
  }
  getAvailablePlatforms(): string[] {
    return this.platformFactory.getAvailablePlatforms();
  }

  /**
   * Normaliza plataformas (acepta 'x' como twitter, etc.)
   */
  private validatePlatforms(input: string[]): Platform[] {
    const available = this.platformFactory.getAvailablePlatforms();
    const map: Record<string, Platform> = {
      x: 'twitter',
      twitter: 'twitter',
      reddit: 'reddit',
      youtube: 'youtube',
    };
    const norm = input
      .map((p) => map[p.toLowerCase()])
      .filter((p): p is Platform => !!p);

    const unique = Array.from(new Set(norm)).filter((p) => available.includes(p));
    return unique.length ? unique : (available as Platform[]);
  }

  /**
   * Guarda el trend y los posts.
   * - Calcula momentum si faltaba
   * - Genera embedding (title + content)
   * - Inserta en batch
   */
  private async saveSearchToDatabase(options: SearchOptions, result: SearchResult): Promise<void> {
    try {
      // 1) Guardar trend (sin bloquear por userId si aún no lo tenés)
      await db.insert(trends).values({
        keyword: options.keyword,
        platforms: options.platforms,
        timeframe: options.timeframe,
        lang: options.lang,
        region: options.region,
      });

      // 2) Preparar posts para insertar
      const toInsert: PostCreate[] = result.results.map((p) => ({
        platform: p.platform,
        author: p.author,
        content: p.content,
        title: p.title,
        metrics: p.metrics,
        link: p.link,
        thumbnail: p.thumbnail,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt ?? new Date(),
        momentumScore: typeof p.momentumScore === 'number' ? p.momentumScore : this.calculateMomentumScore(p),
      }));

      // 3) Generar embeddings en paralelo (limitar si hace falta)
      const enriched = await Promise.all(
        toInsert.map(async (pc) => {
          const textForEmbedding = [pc.title, pc.content].filter(Boolean).join(' ');
          const emb = await this.generateEmbedding(textForEmbedding);
          return { pc, emb };
        })
      );

      // 4) Insert batch (embedding es vector(1536) en PG)
      await db.insert(posts).values(
        enriched.map(({ pc, emb }) => ({
          platform: pc.platform,
          author: pc.author,
          content: pc.content,
          title: pc.title ?? null,
          metrics: pc.metrics as any, // si definiste jsonb en schema, Drizzle lo mapea directo
          link: pc.link,
          thumbnail: pc.thumbnail ?? null,
          publishedAt: pc.publishedAt,
          createdAt: pc.createdAt ?? new Date(),
          momentumScore: pc.momentumScore ?? this.calculateMomentumScore({
            id: 'tmp',
            platform: pc.platform,
            author: pc.author,
            content: pc.content,
            title: pc.title,
            metrics: pc.metrics,
            link: pc.link,
            thumbnail: pc.thumbnail,
            publishedAt: pc.publishedAt,
            createdAt: pc.createdAt ?? new Date(),
            momentumScore: 0
          }),
          embedding: emb ? sql`ARRAY[${emb.join(',')}]::vector(1536)` : null,
        }))
      );
    } catch (e) {
      console.error('Error saving search to database:', e);
      // diseño no-bloqueante
    }
  }

  /**
   * Calcula momentum = engagement / horas desde publication (2 decimales)
   */
  private calculateMomentumScore(post: Post): number {
    const hours = Math.max(
      0.0001,
      (Date.now() - new Date(post.publishedAt).getTime()) / 36e5
    );
    const engagement = Object.values(post.metrics ?? {}).reduce(
      (acc, v) => acc + (v ?? 0),
      0
    );
    return Math.round((engagement / hours) * 100) / 100;
  }

  /**
   * Helpers: filtros y resultado
   */
  private applyFiltersAndSort(list: Post[], options: SearchOptions): Post[] {
    const cutoff = this.getTimeframeCutoff(options.timeframe);
    const byTime = cutoff ? list.filter((p) => p.publishedAt >= cutoff) : list;
    const byPlatform = byTime.filter((p) => options.platforms.includes(p.platform));
    const withMomentum = byPlatform.map((p) =>
      typeof p.momentumScore === 'number' ? p : { ...p, momentumScore: this.calculateMomentumScore(p) }
    );
    return withMomentum.sort((a, b) => b.momentumScore - a.momentumScore);
  }

  private toSearchResult(options: SearchOptions, posts: Post[]): SearchResult {
    return {
      keyword: options.keyword,
      platforms: options.platforms,
      results: posts,
      totalResults: posts.length,
      searchTime: new Date(),
    };
  }

  private getTimeframeCutoff(timeframe: string): Date | null {
    const now = new Date();
    switch (timeframe) {
      case '1h': return new Date(now.getTime() - 1 * 60 * 60 * 1000);
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '1y': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      case 'all':
      default: return null;
    }
  }
}
