import { Post, SearchOptions } from '../../models/post.model';

export interface PlatformService {
  /**
   * Search for trends/posts on the platform
   * @param keyword - The search keyword
   * @param options - Search options including timeframe, language, etc.
   * @returns Promise<Post[]> - Array of normalized posts
   */
  searchTrends(keyword: string, options: SearchOptions): Promise<Post[]>;
  
  /**
   * Get the platform name
   * @returns string - Platform identifier
   */
  getPlatformName(): string;
  
  /**
   * Check if the service is available/configured
   * @returns boolean - True if service is available
   */
  isAvailable(): boolean;
}

export interface PlatformConfig {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  baseUrl?: string;
}
