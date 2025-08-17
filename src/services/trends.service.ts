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
      console.log(`🚀 [TrendsService] Iniciando búsqueda para: "${options.keyword}"`);
      console.log(`📊 [TrendsService] Opciones:`, options);

      const platforms = this.validatePlatforms(options.platforms);

      // 1) Intento vector search en DB
      console.log(`🔍 [TrendsService] Intentando búsqueda en DB...`);
      const dbResult = await this.searchTrendsInDatabase({ ...options, platforms });
      if (dbResult) {
        console.log(`✅ [TrendsService] Resultados encontrados en DB: ${dbResult.totalResults} posts`);
        return dbResult;
      }
      console.log(`❌ [TrendsService] No se encontraron resultados en DB, buscando en APIs externas...`);

      // 2) Fallback a APIs externas
      console.log(`🌐 [TrendsService] Llamando a APIs externas...`);
      const platformResults = await this.platformFactory.searchTrendsAcrossPlatforms(
        options.keyword,
        platforms,
        options
      );

      const all: Post[] = [];
      for (const [, list] of platformResults) all.push(...list);
      console.log(`📈 [TrendsService] Total posts de APIs: ${all.length}`);

      // momentum + filtros + orden
      console.log(`🔧 [TrendsService] Aplicando filtros y ordenamiento...`);
      const enriched = all.map((p) =>
        typeof p.momentumScore === 'number' ? p : { ...p, momentumScore: this.calculateMomentumScore(p) }
      );
      const filtered = this.applyFiltersAndSort(enriched, { ...options, platforms });
      console.log(`✅ [TrendsService] Posts después de filtros: ${filtered.length}`);

      // Usar toSearchResult para normalizar y truncar posts de APIs externas también
      const result = this.toSearchResult(options, filtered);

      // guardar en background (no bloquear respuesta)
      console.log(`💾 [TrendsService] Guardando resultados en DB...`);
      this.saveSearchToDatabase(options, result).catch((e) =>
        console.error('❌ [TrendsService] Error saving search to DB:', e)
      );

      console.log(`🎉 [TrendsService] Búsqueda completada exitosamente`);
      return result;
    } catch (e: any) {
      console.error('Error in searchTrends:', e);
      throw new Error(`Failed to search trends: ${e?.message ?? e}`);
    }
  }

  private toVectorLiteral(vec: number[]) {
    // Construye '[v1,v2,...]'::vector(1536)
    return sql.raw(`'[${vec.join(',')}]'::vector(1536)`);
  }


  /**
   * DB vector search (pgvector) + filtros (timeframe/plataformas) + orden por momentum
   */
  private async searchTrendsInDatabase(options: SearchOptions): Promise<SearchResult | null> {
    try {
      console.log(`  🔍 [TrendsService] Generando embedding para: "${options.keyword}"`);
      const queryEmbedding = await this.generateEmbedding(options.keyword);

      if (!queryEmbedding) {
        console.log(`  ⚠️ [TrendsService] Fallback a búsqueda por texto`);
        // fallback a texto si no se pudo generar el embedding
        const textPosts = await this.searchPostsByText(options.keyword, options.limit ?? 50);
        const filtered = this.applyFiltersAndSort(textPosts, options);
        if (!filtered.length) return null;
        return this.toSearchResult(options, filtered);
      }

      const vecLiteral = this.toVectorLiteral(queryEmbedding);
      console.log(`  ✅ [TrendsService] Embedding generado, buscando en DB...`);
      // Traemos N candidatos por vector, luego filtramos por timeframe y plataformas
      const raw = await db.execute(sql`
        SELECT 
          id, platform, author, content, title, metrics, link, thumbnail,
          published_at, created_at, momentum_score
        FROM ${posts}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <-> ${vecLiteral}
        LIMIT ${options.limit ?? 100}
      `);

      const rows: any[] = Array.isArray((raw as any)?.rows)
        ? (raw as any).rows
        : Array.isArray(raw)
          ? (raw as any)
          : [];

      console.log(`  📊 [TrendsService] Posts encontrados en DB: ${rows.length}`);
      const vecPosts: Post[] = rows.map((r) => ({
        id: r.id,
        platformId: r.platform_id || `temp_${r.id}`,
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
              platformId: r.platform_id || `temp_${r.id}`,
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
      console.error('❌ [TrendsService] Error in vector search from DB:', e);
      return null;
    }
  }

  /**
   * Utilidad: vector search directo (solo posts)
   */
  async searchPostsByVector(queryEmbedding: number[], limit = 10): Promise<Post[]> {
    try {
      console.log(`    🔍 [TrendsService] Búsqueda vectorial: ${queryEmbedding.length} dimensiones (limit: ${limit})`);

      const raw = await db.execute(sql`
        SELECT 
          id, platform_id, platform, author, content, title, metrics, link, thumbnail,
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

      console.log(`    📊 [TrendsService] Posts encontrados por vector: ${rows.length}`);

      return rows.map((r) => ({
        id: r.id,
        platformId: r.platform_id || `temp_${r.id}`,
        platform: r.platform as Platform,
        author: r.author,
        content: this.truncateText(r.content, 600) || '',
        title: this.truncateText(r.title, 200) || undefined,
        metrics: (r.metrics ?? {}) as PostMetrics,
        link: r.link,
        thumbnail: r.thumbnail ?? undefined,
        publishedAt: new Date(r.published_at),
        createdAt: new Date(r.created_at),
        momentumScore: typeof r.momentum_score === 'number' ? r.momentum_score : 0,
      }));
    } catch (e) {
      console.error('❌ [TrendsService] Error in searchPostsByVector:', e);
      return [];
    }
  }

  /**
   * Keyword → embedding → vector search, con fallback ILIKE
   */
  async searchPostsByKeyword(keyword: string, limit = 10): Promise<Post[]> {
    try {
      console.log(`    🔍 [TrendsService] Búsqueda por keyword: "${keyword}" (limit: ${limit})`);

      const emb = await this.generateEmbedding(keyword);
      if (!emb) {
        console.log(`    ⚠️ [TrendsService] Fallback a búsqueda por texto`);
        return this.searchPostsByText(keyword, limit);
      }

      console.log(`    ✅ [TrendsService] Usando búsqueda vectorial`);
      return this.searchPostsByVector(emb, limit);
    } catch (e) {
      console.error('❌ [TrendsService] Error in searchPostsByKeyword:', e);
      return this.searchPostsByText(keyword, limit);
    }
  }

  /**
   * Búsqueda por texto (ILIKE), ordenando por momentum
   */
  private async searchPostsByText(keyword: string, limit = 10): Promise<Post[]> {
    try {
      console.log(`    🔍 [TrendsService] Búsqueda por texto: "${keyword}" (limit: ${limit})`);

      const raw = await db.execute(sql`
        SELECT 
          id, platform_id, platform, author, content, title, metrics, link, thumbnail,
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

      console.log(`    📊 [TrendsService] Posts encontrados por texto: ${rows.length}`);

      return rows.map((r) => ({
        id: r.id,
        platformId: r.platform_id || `temp_${r.id}`,
        platform: r.platform as Platform,
        author: r.author,
        content: this.truncateText(r.content, 600) || '',
        title: this.truncateText(r.title, 200) || undefined,
        metrics: (r.metrics ?? {}) as PostMetrics,
        link: r.link,
        thumbnail: r.thumbnail ?? undefined,
        publishedAt: new Date(r.published_at),
        createdAt: new Date(r.created_at),
        momentumScore: typeof r.momentum_score === 'number' ? r.momentum_score : 0,
      }));
    } catch (e) {
      console.error('❌ [TrendsService] Error in searchPostsByText:', e);
      return [];
    }
  }

  /**
   * Truncar texto a un límite específico agregando "..." si es necesario
   */
  private truncateText(text: string | null | undefined, maxLength: number): string | null {
    if (!text) return null;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Normalizar y truncar un post completo para consistencia
   */
  private normalizeAndTruncatePost(post: Post): Post {
    const originalContentLength = post.content?.length || 0;
    const originalTitleLength = post.title?.length || 0;

    const normalized = {
      ...post,
      content: this.truncateText(post.content, 600) || '',
      title: this.truncateText(post.title, 200) || undefined,
    };

    const newContentLength = normalized.content?.length || 0;
    const newTitleLength = normalized.title?.length || 0;

    if (originalContentLength > 600 || originalTitleLength > 200) {
      console.log(`    ✂️ [TrendsService] Post ${post.platform}:${post.platformId} TRUNCADO:`);
      console.log(`       📝 Content: ${originalContentLength} → ${newContentLength} chars`);
      console.log(`       📋 Title: ${originalTitleLength} → ${newTitleLength} chars`);
    }

    return normalized;
  }

  /**
   * Verificar si un post ya existe en la base de datos
   */
  private async checkPostExists(platformId: string, platform: Platform): Promise<boolean> {
    try {
      const existing = await db
        .select({ id: posts.id })
        .from(posts)
        .where(sql`${posts.platformId} = ${platformId} AND ${posts.platform} = ${platform}`)
        .limit(1);

      return existing.length > 0;
    } catch (error) {
      console.error('❌ [TrendsService] Error checking post existence:', error);
      return false; // En caso de error, asumir que no existe
    }
  }

  /**
   * Generar embedding con el EmbeddingService
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      console.log(`    🧠 [TrendsService] Generando embedding para: "${text.substring(0, 50)}..."`);
      const result = await this.embeddingService.generateEmbedding(text);
      console.log(`    ✅ [TrendsService] Embedding generado: ${result ? result.length : 0} dimensiones`);
      return result;
    } catch (e) {
      console.error('❌ [TrendsService] Error generating embedding:', e);
      return null;
    }
  }

  /**
   * Trending topics (keywords más consultadas en una ventana)
   */
  async getTrendingTopics(limit = 10, window: string = '7 days'): Promise<string[]> {
    try {
      console.log(`📊 [TrendsService] Obteniendo trending topics (limit: ${limit}, window: ${window})`);

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

      const topics = rows.map((r) => r.keyword as string);
      console.log(`✅ [TrendsService] Trending topics encontrados: ${topics.length}`);

      return topics;
    } catch (e) {
      console.error('❌ [TrendsService] Error getting trending topics:', e);
      return [];
    }
  }

  /**
   * Historial de búsquedas por usuario
   */
  async getUserSearchHistory(userId: string, limit = 20): Promise<Trend[]> {
    try {
      console.log(`📚 [TrendsService] Obteniendo historial para usuario: ${userId} (limit: ${limit})`);

      const rows = await db
        .select()
        .from(trends)
        .where(eq(trends.userId, userId))
        .orderBy(desc(trends.createdAt))
        .limit(limit);

      const userTrends = rows as unknown as Trend[];
      console.log(`✅ [TrendsService] Historial encontrado: ${userTrends.length} búsquedas`);

      return userTrends;
    } catch (e) {
      console.error('❌ [TrendsService] Error getting user search history:', e);
      return [];
    }
  }

  // Estado y plataformas disponibles (passthrough a factory)
  getPlatformStatus() {
    console.log(`🔧 [TrendsService] Obteniendo estado de plataformas...`);
    const status = this.platformFactory.getPlatformStatus();
    console.log(`✅ [TrendsService] Estado de plataformas obtenido`);
    return status;
  }
  getAvailablePlatforms(): string[] {
    console.log(`🔧 [TrendsService] Obteniendo plataformas disponibles...`);
    const platforms = this.platformFactory.getAvailablePlatforms();
    console.log(`✅ [TrendsService] Plataformas disponibles: ${platforms.join(', ')}`);
    return platforms;
  }

  /**
   * Normaliza plataformas (acepta 'x' como twitter, etc.)
   */
  private validatePlatforms(input: string[]): Platform[] {
    console.log(`🔧 [TrendsService] Validando plataformas:`, input);

    const available = this.platformFactory.getAvailablePlatforms();
    console.log(`🔧 [TrendsService] Plataformas disponibles:`, available);

    const map: Record<string, Platform> = {
      x: 'twitter',
      twitter: 'twitter',
      reddit: 'reddit',
      youtube: 'youtube',
    };

    const norm = input
      .map((p) => map[p.toLowerCase()])
      .filter((p): p is Platform => !!p);
    console.log(`🔧 [TrendsService] Plataformas normalizadas:`, norm);

    const unique = Array.from(new Set(norm)).filter((p) => available.includes(p));
    console.log(`🔧 [TrendsService] Plataformas finales:`, unique);

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
      console.log(`  💾 [TrendsService] Guardando trend en DB...`);
      // 1) Guardar trend (sin bloquear por userId si aún no lo tenés)
      await db.insert(trends).values({
        keyword: options.keyword,
        platforms: options.platforms,
        timeframe: options.timeframe,
        lang: options.lang,
        region: options.region,
      });
      console.log(`  ✅ [TrendsService] Trend guardado en DB`);

      // 2) Preparar posts para insertar (con validación de duplicados)
      console.log(`  📝 [TrendsService] Preparando ${result.results.length} posts para insertar...`);

      // Filtrar posts que ya existen en esta sesión
      const seenPlatformIds = new Set<string>();
      const toInsert: PostCreate[] = result.results
        .filter((p) => {
          const key = `${p.platform}:${p.platformId}`;
          if (seenPlatformIds.has(key)) {
            console.log(`    ⚠️ [TrendsService] Post duplicado en sesión: ${key}`);
            return false;
          }
          seenPlatformIds.add(key);
          return true;
        })
        .map((p) => {
          const normalized = this.normalizeAndTruncatePost(p);
          return {
            platformId: normalized.platformId,
            platform: normalized.platform,
            author: normalized.author,
            content: normalized.content,
            title: normalized.title,
            metrics: normalized.metrics,
            link: normalized.link,
            thumbnail: normalized.thumbnail,
            publishedAt: normalized.publishedAt,
            createdAt: normalized.createdAt ?? new Date(),
            momentumScore: typeof normalized.momentumScore === 'number' ? normalized.momentumScore : this.calculateMomentumScore(normalized),
          };
        });

      console.log(`  📊 [TrendsService] Posts únicos en sesión: ${toInsert.length} de ${result.results.length}`);

      // 3) Verificar duplicados y generar embeddings en paralelo
      console.log(`  🔍 [TrendsService] Verificando duplicados y generando embeddings...`);

      const enriched = await Promise.all(
        toInsert.map(async (pc) => {
          // Verificar si ya existe en DB
          const existing = await this.checkPostExists(pc.platformId, pc.platform);
          if (existing) {
            console.log(`    ⚠️ [TrendsService] Post ${pc.platform}:${pc.platformId} ya existe, saltando...`);
            return null; // Saltar este post
          }

          const textForEmbedding = [pc.title, pc.content].filter(Boolean).join(' ');
          const emb = await this.generateEmbedding(textForEmbedding);
          return { pc, emb };
        })
      );

      // Filtrar posts que ya existen
      const newPosts = enriched.filter(item => item !== null);
      console.log(`  📊 [TrendsService] Posts nuevos a procesar: ${newPosts.length} de ${toInsert.length}`);

      // 4) Upsert batch (insertar o actualizar si existe)
      console.log(`  💾 [TrendsService] Upsertando ${newPosts.length} posts en DB...`);

      const postsToUpsert = newPosts.map(({ pc, emb }) => {
        let finalMomentumScore: number;
        if (typeof pc.momentumScore === 'number') {
          finalMomentumScore = pc.momentumScore;
        } else {
          // Calcular momentum directamente con los datos disponibles
          finalMomentumScore = this.calculateMomentumScore({
            id: 'temp',
            platformId: pc.platformId,
            platform: pc.platform,
            author: pc.author,
            content: pc.content,
            title: pc.title,
            metrics: pc.metrics,
            link: pc.link,
            thumbnail: pc.thumbnail,
            publishedAt: pc.publishedAt,
            createdAt: pc.createdAt ?? new Date(),
            momentumScore: 0 // Se ignora, se recalcula
          });
        }

        // Normalizar y truncar contenido para optimizar DB
        const normalizedPost = this.normalizeAndTruncatePost({
          id: 'temp',
          platformId: pc.platformId,
          platform: pc.platform,
          author: pc.author,
          content: pc.content,
          title: pc.title,
          metrics: pc.metrics,
          link: pc.link,
          thumbnail: pc.thumbnail,
          publishedAt: pc.publishedAt,
          createdAt: pc.createdAt ?? new Date(),
          momentumScore: finalMomentumScore,
        });

        console.log(`    📊 [TrendsService] Post ${pc.platform}: momentumScore=${finalMomentumScore}, normalizado para DB`);

        return {
          platformId: pc.platformId,
          platform: pc.platform,
          author: pc.author,
          content: normalizedPost.content,
          title: normalizedPost.title,
          metrics: pc.metrics as any, // si definiste jsonb en schema, Drizzle lo mapea directo
          link: pc.link,
          thumbnail: pc.thumbnail ?? null,
          publishedAt: pc.publishedAt,
          createdAt: pc.createdAt ?? new Date(),
          momentumScore: finalMomentumScore,
          embedding: emb ? sql`${JSON.stringify(emb)}::vector(1536)` : null,
        };
      });

      // Usar upsert para evitar duplicados
      for (const post of postsToUpsert) {
        try {
          await db.insert(posts).values(post)
            .onConflictDoUpdate({
              target: [posts.platformId, posts.platform],
              set: {
                // Actualizar solo campos que pueden cambiar
                metrics: post.metrics,
                momentumScore: post.momentumScore,
                embedding: post.embedding,
                updatedAt: new Date(),
              }
            });
          console.log(`    ✅ [TrendsService] Post ${post.platform}:${post.platformId} upsertado`);
        } catch (error) {
          console.log(`    ⚠️ [TrendsService] Error upsertando post ${post.platform}:${post.platformId}:`, error);
        }
      }
      console.log(`  ✅ [TrendsService] Posts insertados exitosamente en DB`);
    } catch (e) {
      console.error('❌ [TrendsService] Error saving search to database:', e);
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
    const score = Math.round((engagement / hours) * 100) / 100;

    console.log(`      📊 [TrendsService] Momentum: ${engagement} engagement / ${hours.toFixed(4)}h = ${score}`);

    return score;
  }

  /**
   * Helpers: filtros y resultado
   */
  private applyFiltersAndSort(list: Post[], options: SearchOptions): Post[] {
    console.log(`    🔧 [TrendsService] Aplicando filtros a ${list.length} posts...`);

    const cutoff = this.getTimeframeCutoff(options.timeframe);
    console.log(`    ⏰ [TrendsService] Cutoff temporal: ${cutoff ? cutoff.toISOString() : 'ninguno'}`);

    const byTime = cutoff ? list.filter((p) => p.publishedAt >= cutoff) : list;
    console.log(`    📅 [TrendsService] Posts después de filtro temporal: ${byTime.length}`);

    const byPlatform = byTime.filter((p) => options.platforms.includes(p.platform));
    console.log(`    📱 [TrendsService] Posts después de filtro de plataforma: ${byPlatform.length}`);

    const withMomentum = byPlatform.map((p) =>
      typeof p.momentumScore === 'number' ? p : { ...p, momentumScore: this.calculateMomentumScore(p) }
    );

    const sorted = withMomentum.sort((a, b) => b.momentumScore - a.momentumScore);
    console.log(`    📊 [TrendsService] Posts ordenados por momentum: ${sorted.length}`);

    return sorted;
  }

  private toSearchResult(options: SearchOptions, posts: Post[]): SearchResult {
    // Normalizar y truncar todos los posts para consistencia con DB
    const normalizedPosts = posts.map(post => this.normalizeAndTruncatePost(post));

    const result = {
      keyword: options.keyword,
      platforms: options.platforms,
      results: normalizedPosts,
      totalResults: normalizedPosts.length,
      searchTime: new Date(),
    };

    console.log(`    📋 [TrendsService] Resultado final: ${result.totalResults} posts para "${result.keyword}" (normalizados y truncados)`);

    return result;
  }

  private getTimeframeCutoff(timeframe: string): Date | null {
    const now = new Date();
    let cutoff: Date | null = null;

    switch (timeframe) {
      case '1h': cutoff = new Date(now.getTime() - 1 * 60 * 60 * 1000); break;
      case '24h': cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case '7d': cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '1y': cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      case 'all':
      default: cutoff = null; break;
    }

    console.log(`      ⏰ [TrendsService] Timeframe "${timeframe}" → cutoff: ${cutoff ? cutoff.toISOString() : 'ninguno'}`);
    return cutoff;
  }
}


