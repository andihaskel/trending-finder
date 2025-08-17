import { PlatformService, PlatformConfig } from './interfaces/platform.service';
import { RedditService } from './reddit.service';
import { YouTubeService } from './youtube.service';
import { XService } from './x.service';
import { SearchOptions } from '../models/post.model';

export class PlatformFactory {
  private services: Map<string, PlatformService> = new Map();

  constructor() {
    this.initializeServices();
  }

  private initializeServices(): void {
    // Initialize Reddit service
    const redditConfig: PlatformConfig = {
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      userAgent: process.env.REDDIT_USER_AGENT || 'TrendingFinder/1.0',
    };
    this.services.set('reddit', new RedditService(redditConfig));

    // Initialize YouTube service
    const youtubeConfig: PlatformConfig = {
      apiKey: process.env.YOUTUBE_API_KEY,
    };
    this.services.set('youtube', new YouTubeService(youtubeConfig));

    // Initialize Twitter/X service
    const twitterConfig: PlatformConfig = {
      apiKey: process.env.TWITTER_BEARER_TOKEN,
    };
    this.services.set('twitter', new XService(twitterConfig));
    this.services.set('x', new XService(twitterConfig)); // Alias for 'x'
  }

  /**
   * Get a specific platform service
   */
  getService(platform: string): PlatformService | null {
    return this.services.get(platform) || null;
  }

  /**
   * Get all available platform services
   */
  getAllServices(): PlatformService[] {
    return Array.from(this.services.values());
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
    const results = new Map<string, any[]>();
    const searchPromises: Promise<[string, any[]]>[] = [];

    for (const platform of platforms) {
      const service = this.services.get(platform);
      if (service && service.isAvailable()) {
        const searchPromise = service
          .searchTrends(keyword, options)
          .then(posts => [platform, posts] as [string, any[]])
          .catch(error => {
            console.error(`Error searching ${platform}:`, error);
            return [platform, []] as [string, any[]];
          });
        
        searchPromises.push(searchPromise);
      } else {
        results.set(platform, []);
      }
    }

    // Wait for all searches to complete
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
    const status: Record<string, { available: boolean; configured: boolean }> = {};
    
    for (const [platform, service] of this.services) {
      status[platform] = {
        available: service.isAvailable(),
        configured: service.isAvailable(),
      };
    }
    
    return status;
  }
}
