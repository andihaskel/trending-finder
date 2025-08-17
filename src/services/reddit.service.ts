import axios, { AxiosInstance } from 'axios';
import { Post, SearchOptions } from '../models/post.model';
import { PlatformConfig, PlatformService } from './interfaces/platform.service';

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
  }

  getPlatformName(): string {
    return 'reddit';
  }

  isAvailable(): boolean {
    return !!(this.config.clientId && this.config.clientSecret);
  }

  async searchTrends(keyword: string, options: SearchOptions): Promise<Post[]> {
    if (!this.isAvailable()) {
      throw new Error('Reddit service is not configured');
    }

    try {
      await this.ensureAccessToken();

      const subreddits = this.getRelevantSubreddits(keyword);
      const allPosts: Post[] = [];

      for (const subreddit of subreddits) {
        const posts = await this.searchSubreddit(keyword, subreddit, options);
        allPosts.push(...posts);
      }

      // Sort by momentum score and limit results
      return allPosts
        .sort((a, b) => b.momentumScore - a.momentumScore)
        .slice(0, options.limit || 50);
    } catch (error) {
      console.error('Error searching Reddit trends:', error);
      return [];
    }
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    try {
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
    } catch (error) {
      console.error('Error getting Reddit access token:', error);
      throw new Error('Failed to authenticate with Reddit');
    }
  }

  private getRelevantSubreddits(keyword: string): string[] {
    // Default subreddits for general topics
    const defaultSubreddits = ['all', 'popular', 'trending'];

    // Keyword-specific subreddits
    const keywordSubreddits: Record<string, string[]> = {
      'ai': ['artificial', 'MachineLearning', 'OpenAI', 'ChatGPT'],
      'coffee': ['Coffee', 'barista', 'espresso'],
      'tech': ['technology', 'programming', 'gadgets', 'Futurology'],
      'gaming': ['gaming', 'PCGaming', 'PS5', 'XboxSeriesX'],
      'crypto': ['CryptoCurrency', 'Bitcoin', 'ethereum'],
    };

    // Find matching subreddits
    const matchingSubreddits: string[] = [];
    for (const [key, subreddits] of Object.entries(keywordSubreddits)) {
      if (keyword.toLowerCase().includes(key)) {
        matchingSubreddits.push(...subreddits);
      }
    }

    return [...new Set([...matchingSubreddits, ...defaultSubreddits])];
  }

  private async searchSubreddit(keyword: string, subreddit: string, options: SearchOptions): Promise<Post[]> {
    try {
      const timeFilter = this.mapTimeframeToReddit(options.timeframe);

      const response = await this.client.get(`/r/${subreddit}/search`, {
        params: {
          q: keyword,
          t: timeFilter,
          sort: 'hot',
          limit: 25,
        },
      });

      return response.data.data.children
        .map((child: any) => this.normalizeRedditPost(child.data))
        .filter((post: Post) => post !== null);
    } catch (error) {
      console.error(`Error searching subreddit ${subreddit}:`, error);
      return [];
    }
  }

  private normalizeRedditPost(data: any): Post | null {
    try {
      const createdAt = new Date(data.created_utc * 1000);
      const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

      // Calculate momentum score (upvotes + comments) / hours
      const engagement = (data.ups || 0) + (data.num_comments || 0);
      const momentumScore = hoursSinceCreation > 0 ? engagement / hoursSinceCreation : engagement;

      return {
        id: `reddit_${data.id}`,
        platform: 'reddit',
        author: data.author || 'Unknown',
        content: data.title || data.selftext || 'No content',
        title: data.title,
        metrics: {
          upvotes: data.ups || 0,
          comments: data.num_comments || 0,
        },
        link: `https://reddit.com${data.permalink}`,
        publishedAt: createdAt,
        createdAt,
        momentumScore: Math.round(momentumScore * 100) / 100,
      };
    } catch (error) {
      console.error('Error normalizing Reddit post:', error);
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

    return mapping[timeframe] || 'day';
  }
}
