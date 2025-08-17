import { SearchOptions } from '../models/post.model';
import { PlatformConfig, PlatformService } from './interfaces/platform.service';
import { RedditService } from './reddit.service';
import { XService } from './x.service';
import { YouTubeService } from './youtube.service';

export class PlatformFactory {
  private services: Map<string, PlatformService> = new Map();

  constructor() {
    this.initializeServices();
  }

  private initializeServices(): void {
    console.log(`🏭 [PlatformFactory] Inicializando servicios de plataformas...`);

    // Initialize Reddit service
    const redditConfig: PlatformConfig = {
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      userAgent: process.env.REDDIT_USER_AGENT || 'TrendingFinder/1.0',
    };
    this.services.set('reddit', new RedditService(redditConfig));
    console.log(`  📱 [PlatformFactory] Reddit: ${redditConfig.clientId ? '✅' : '❌'} clientId, ${redditConfig.clientSecret ? '✅' : '❌'} clientSecret`);

    // Initialize YouTube service
    const youtubeConfig: PlatformConfig = {
      apiKey: process.env.YOUTUBE_API_KEY,
    };
    this.services.set('youtube', new YouTubeService(youtubeConfig));
    console.log(`  📱 [PlatformFactory] YouTube: ${youtubeConfig.apiKey ? '✅' : '❌'} apiKey`);

    // Initialize Twitter/X service
    const twitterConfig: PlatformConfig = {
      apiKey: process.env.TWITTER_BEARER_TOKEN,
    };
    this.services.set('twitter', new XService(twitterConfig));
    this.services.set('x', new XService(twitterConfig)); // Alias for 'x'
    console.log(`  📱 [PlatformFactory] Twitter/X: ${twitterConfig.apiKey ? '✅' : '❌'} apiKey`);

    console.log(`✅ [PlatformFactory] Servicios inicializados: ${Array.from(this.services.keys()).join(', ')}`);
  }

  /**
   * Get a specific platform service
   */
  getService(platform: string): PlatformService | null {
    const service = this.services.get(platform);
    console.log(`🔍 [PlatformFactory] Obteniendo servicio para ${platform}: ${service ? '✅' : '❌'}`);
    return service || null;
  }

  /**
   * Get all available platform services
   */
  getAllServices(): PlatformService[] {
    const services = Array.from(this.services.values());
    console.log(`🔍 [PlatformFactory] Obteniendo todos los servicios: ${services.length} servicios`);
    return services;
  }

  /**
   * Get available platform names
   */
  getAvailablePlatforms(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Check if a platform is available
   */
  isPlatformAvailable(platform: string): boolean {
    const service = this.services.get(platform);
    return service ? service.isAvailable() : false;
  }

  /**
   * Search trends across multiple platforms
   */
  async searchTrendsAcrossPlatforms(
    keyword: string,
    platforms: string[],
    options: SearchOptions
  ): Promise<Map<string, any[]>> {
    console.log(`🏭 [PlatformFactory] Iniciando búsqueda en ${platforms.length} plataformas: ${platforms.join(', ')}`);

    const results = new Map<string, any[]>();
    const searchPromises: Promise<[string, any[]]>[] = [];

    for (const platform of platforms) {
      console.log(`🔍 [PlatformFactory] Verificando plataforma: ${platform}`);
      const service = this.services.get(platform);
      if (service && service.isAvailable()) {
        console.log(`✅ [PlatformFactory] Plataforma ${platform} disponible, iniciando búsqueda...`);
        const searchPromise = service
          .searchTrends(keyword, options)
          .then(posts => {
            console.log(`✅ [PlatformFactory] ${platform}: ${posts.length} posts encontrados`);
            return [platform, posts] as [string, any[]];
          })
          .catch(error => {
            console.error(`❌ [PlatformFactory] Error searching ${platform}:`, error);
            return [platform, []] as [string, any[]];
          });

        searchPromises.push(searchPromise);
      } else {
        console.log(`❌ [PlatformFactory] Plataforma ${platform} no disponible`);
        results.set(platform, []);
      }
    }

    // Wait for all searches to complete
    console.log(`⏳ [PlatformFactory] Esperando que completen ${searchPromises.length} búsquedas...`);
    const searchResults = await Promise.all(searchPromises);

    for (const [platform, posts] of searchResults) {
      results.set(platform, posts);
    }

    return results;
  }

  /**
   * Get platform service status
   */
  getPlatformStatus(): Record<string, { available: boolean; configured: boolean }> {
    console.log(`🏭 [PlatformFactory] Obteniendo estado de todas las plataformas...`);

    const status: Record<string, { available: boolean; configured: boolean }> = {};

    for (const [platform, service] of this.services) {
      const isAvailable = service.isAvailable();
      status[platform] = {
        available: isAvailable,
        configured: isAvailable,
      };

      console.log(`  📱 [PlatformFactory] ${platform}: ${isAvailable ? '✅' : '❌'}`);
    }

    console.log(`✅ [PlatformFactory] Estado de plataformas obtenido`);
    return status;
  }
}
