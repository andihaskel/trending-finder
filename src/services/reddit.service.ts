import axios, { AxiosInstance } from 'axios';
import { Post, SearchOptions } from '../models/post.model';
import { PlatformConfig, PlatformService } from './interfaces/platform.service';

const MAX_SUBREDDITS_PER_QUERY = 6;   // cota de subreddits por búsqueda
const MAX_GLOBAL_ITEMS = 100;         // cota de items procesados antes de cortar
const MAX_PAGES_PER_SUB = 2;          // páginas por subreddit (si paginás)

export class RedditService implements PlatformService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private config: PlatformConfig) {
    this.client = axios.create({
      baseURL: 'https://oauth.reddit.com',
      headers: {
        'User-Agent': config.userAgent || 'TrendingFinder/1.0',
      },
    });

    this.client.interceptors.response.use(
      r => r,
      async (err) => {
        if (err.response?.status === 401) {
          await this.ensureAccessToken();
          err.config.headers.Authorization = `Bearer ${this.accessToken}`;
          return this.client.request(err.config);
        }
        return Promise.reject(err);
      }
    );
  }

  getPlatformName(): string {
    console.log(`🔧 [Reddit] Nombre de plataforma: reddit`);
    return 'reddit';
  }

  isAvailable(): boolean {
    const hasClientId = !!this.config.clientId;
    const hasClientSecret = !!this.config.clientSecret;
    const isAvailable = hasClientId && hasClientSecret;

    console.log(`🔧 [Reddit] Configuración: clientId=${hasClientId ? '✅' : '❌'}, clientSecret=${hasClientSecret ? '✅' : '❌'}`);
    console.log(`🔧 [Reddit] Servicio disponible: ${isAvailable ? '✅' : '❌'}`);

    return isAvailable;
  }

  async searchTrends(keyword: string, options: SearchOptions): Promise<Post[]> {
    if (!this.isAvailable()) throw new Error('Reddit service is not configured');

    try {
      console.log(`🔍 [Reddit] Buscando trends para: "${keyword}"`);
      console.log(`📊 [Reddit] Opciones:`, { timeframe: options.timeframe, limit: options.limit });

      await this.ensureAccessToken();
      console.log(`🔑 [Reddit] Token de acceso obtenido/validado`);

      // 1) Limitar subreddits
      const subreddits = this.getRelevantSubreddits(keyword)
        .slice(0, MAX_SUBREDDITS_PER_QUERY);
      console.log(`📱 [Reddit] Subreddits seleccionados:`, subreddits);

      const all: Post[] = [];
      const seen = new Set<string>(); // dedup por id interno
      const seenPlatformIds = new Set<string>(); // dedup por platform_id

      for (const subreddit of subreddits) {
        console.log(`🔎 [Reddit] Buscando en r/${subreddit}...`);

        // 2) Traer con cota por subreddit
        const chunk = await this.searchSubreddit(keyword, subreddit, options);
        console.log(`📈 [Reddit] r/${subreddit}: ${chunk.length} posts encontrados`);

        // 3) Dedup por id interno Y por platform_id
        for (const p of chunk) {
          const platformKey = `${p.platform}:${p.platformId}`;
          if (!seen.has(p.id) && !seenPlatformIds.has(platformKey)) {
            seen.add(p.id);
            seenPlatformIds.add(platformKey);
            all.push(p);
          } else {
            console.log(`    ⚠️ [Reddit] Post duplicado saltado: ${platformKey}`);
          }
        }

        // 4) Cota global de items procesados
        if (all.length >= MAX_GLOBAL_ITEMS) {
          console.log(`⚠️ [Reddit] Límite global alcanzado (${MAX_GLOBAL_ITEMS})`);
          break;
        }
      }

      // 5) Orden final + cota de salida (options.limit)
      const limitOut = options.limit ?? 10;
      const final = all
        .sort((a, b) => b.momentumScore - a.momentumScore)
        .slice(0, limitOut);

      console.log(`✅ [Reddit] Búsqueda completada: ${final.length} posts finales de ${all.length} totales`);
      return final;

    } catch (error) {
      console.error('Error searching Reddit trends:', error);
      return [];
    }
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      console.log(`🔑 [Reddit] Token válido, expira en ${Math.round((this.tokenExpiry - Date.now()) / 1000)}s`);
      return;
    }

    try {
      console.log(`🔑 [Reddit] Obteniendo nuevo token de acceso...`);
      const response = await axios.post('https://www.reddit.com/api/v1/access_token',
        'grant_type=client_credentials',
        {
          auth: {
            username: this.config.clientId!,
            password: this.config.clientSecret!,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.config.userAgent || 'TrendingFinder/1.0',
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
      console.log(`🔑 [Reddit] Token obtenido, expira en ${response.data.expires_in}s`);
    } catch (error) {
      console.error('❌ [Reddit] Error obteniendo token de acceso:', error);
      throw new Error('Failed to authenticate with Reddit');
    }
  }

  private getRelevantSubreddits(keyword: string): string[] {
    const defaults = ['all', 'popular'];
    const map: Record<string, string[]> = {
      ai: ['artificial', 'MachineLearning', 'OpenAI', 'ChatGPT'],
      coffee: ['Coffee', 'barista', 'espresso'],
      tech: ['technology', 'programming', 'gadgets', 'Futurology'],
      gaming: ['gaming', 'PCGaming', 'PS5', 'XboxSeriesX'],
      crypto: ['CryptoCurrency', 'Bitcoin', 'ethereum'],
    };

    const k = keyword.toLowerCase();
    const hits = Object.entries(map)
      .filter(([key]) => k.includes(key))
      .flatMap(([, subs]) => subs);

    const result = Array.from(new Set([...hits, ...defaults]));
    console.log(`  🎯 [Reddit] Keywords detectadas: ${Object.keys(map).filter(key => k.includes(key)).join(', ') || 'ninguna'}`);
    console.log(`  📱 [Reddit] Subreddits específicos: ${hits.join(', ') || 'ninguno'}`);
    console.log(`  📱 [Reddit] Subreddits por defecto: ${defaults.join(', ')}`);

    return result;
  }

  private async searchSubreddit(
    keyword: string,
    subreddit: string,
    options: SearchOptions
  ): Promise<Post[]> {
    try {
      const timeFilter = this.mapTimeframeToReddit(options.timeframe);
      console.log(`  📅 [Reddit] Filtro temporal: ${timeFilter}`);

      // per-page no mayor a 50 y no mayor al limit pedido
      const perPage = Math.min(options.limit ?? 25, 50);
      console.log(`  📄 [Reddit] Posts por página: ${perPage}`);

      const out: Post[] = [];
      let after: string | undefined;

      for (let page = 0; page < MAX_PAGES_PER_SUB; page++) {
        console.log(`    📖 [Reddit] Página ${page + 1}/${MAX_PAGES_PER_SUB}`);

        const params: Record<string, any> = {
          q: keyword,
          sort: timeFilter === 'all' ? 'new' : 'top', // top respeta t, new para all
          limit: perPage,
          restrict_sr: 'on',
          t: timeFilter === 'all' ? undefined : timeFilter, // t solo si no es 'all'
          after,
          include_over_18: false,
        };

        const url = `/r/${subreddit}/search`;

        const response = await this.client.get(url, { params });
        const children = response.data?.data?.children ?? [];
        console.log(`    📊 [Reddit] Respuesta: ${children.length} posts raw`);

        for (const child of children) {
          const post = this.normalizeRedditPost(child.data);
          if (post) out.push(post);
        }

        after = response.data?.data?.after || undefined;

        // corta si alcanzaste lo pedido
        if (out.length >= (options.limit ?? 25)) {
          console.log(`    ✅ [Reddit] Límite alcanzado: ${out.length} posts`);
          break;
        }

        // si no hay más páginas, corta
        if (!after) {
          console.log(`    🔚 [Reddit] No hay más páginas`);
          break;
        }
      }

      console.log(`  📈 [Reddit] Total posts válidos: ${out.length}`);
      return out;

    } catch (error) {
      console.error(`Error searching subreddit ${subreddit}:`, error);
      return [];
    }
  }

  private normalizeRedditPost(data: any): Post | null {
    try {
      if (data.stickied || data.is_meta || data.over_18 || data.is_ad) {
        console.log(`      ❌ [Reddit] Post filtrado: ${data.stickied ? 'stickied' : ''} ${data.is_meta ? 'meta' : ''} ${data.over_18 ? 'nsfw' : ''} ${data.is_ad ? 'ad' : ''}`);
        return null;
      }

      const createdAt = new Date((data.created_utc ?? data.created) * 1000);
      const hours = Math.max(0.25, (Date.now() - createdAt.getTime()) / 36e5);

      const upvotes = data.ups ?? 0;
      const comments = data.num_comments ?? 0;
      const engagement = upvotes + comments * 2; // pondera comments
      const momentumScore = Math.round((engagement / hours) * 100) / 100;

      const title = data.title ?? '';
      const selftext = (data.selftext ?? '').trim();
      const content = selftext || title;
      if (!content) {
        console.log(`      ❌ [Reddit] Post sin contenido: ${data.id}`);
        return null;
      }

      const thumbnail =
        typeof data.thumbnail === 'string' && data.thumbnail.startsWith('http')
          ? data.thumbnail
          : data.preview?.images?.[0]?.source?.url?.replaceAll('&amp;', '&');

      console.log(`      ✅ [Reddit] Post normalizado: "${title.substring(0, 50)}..." | ${upvotes}↑ ${comments}💬 | momentum: ${momentumScore}`);

      return {
        id: `reddit_${data.id}`,
        platformId: data.id, // ID único de Reddit
        platform: 'reddit',
        author: data.author || 'Unknown',
        content,
        title: title || undefined,
        metrics: { upvotes, comments },
        link: `https://reddit.com${data.permalink}`,
        thumbnail,
        publishedAt: createdAt,
        createdAt,
        momentumScore,
      };
    } catch (error) {
      console.log(`      ❌ [Reddit] Error normalizando post:`, error);
      return null;
    }
  }

  private mapTimeframeToReddit(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1h': 'hour',
      '24h': 'day',
      '7d': 'week',
      '30d': 'month',
      '1y': 'year',
      'all': 'all',
    };

    const result = mapping[timeframe] || 'day';
    console.log(`  ⏰ [Reddit] Timeframe "${timeframe}" mapeado a "${result}"`);
    return result;
  }
}
