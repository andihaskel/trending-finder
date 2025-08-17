import axios, { AxiosInstance } from 'axios';
import { Post, SearchOptions } from '../models/post.model';
import { PlatformConfig, PlatformService } from './interfaces/platform.service';

export class XService implements PlatformService {
  private client: AxiosInstance;
  private useMockData: boolean = false;

  constructor(private config: PlatformConfig) {
    this.client = axios.create({
      baseURL: 'https://api.twitter.com/2',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    // Check if we have valid credentials, otherwise use mock data
    this.useMockData = !this.config.apiKey;
  }

  getPlatformName(): string {
    return 'twitter';
  }

  isAvailable(): boolean {
    return true; // Always available (falls back to mock data)
  }

  async searchTrends(keyword: string, options: SearchOptions): Promise<Post[]> {
    if (this.useMockData) {
      return this.getMockData(keyword, options);
    }

    try {
      const response = await this.client.get('/tweets/search/recent', {
        params: {
          query: keyword,
          max_results: options.limit || 50,
          'tweet.fields': 'created_at,public_metrics,author_id',
          'user.fields': 'username,name',
          'expansions': 'author_id',
          'start_time': this.calculateStartTime(options.timeframe),
        },
      });

      if (!response.data.data) {
        return [];
      }

      // Get user information for author mapping
      const users = response.data.includes?.users || [];
      const userMap = new Map<string, any>(users.map((user: any) => [user.id, user]));

      return response.data.data
        .map((tweet: any) => this.normalizeTweet(tweet, userMap))
        .filter((post: Post) => post !== null)
        .sort((a: Post, b: Post) => b.momentumScore - a.momentumScore);
    } catch (error) {
      console.error('Error searching Twitter trends:', error);
      // Fallback to mock data on error
      return this.getMockData(keyword, options);
    }
  }

  private calculateStartTime(timeframe: string): string {
    const now = new Date();
    let startTime: Date;

    switch (timeframe) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startTime = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return startTime.toISOString();
  }

  private normalizeTweet(tweet: any, userMap: Map<string, any>): Post | null {
    try {
      const createdAt = new Date(tweet.created_at);
      const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

      const metrics = tweet.public_metrics || {};
      const likes = metrics.like_count || 0;
      const retweets = metrics.retweet_count || 0;
      const replies = metrics.reply_count || 0;

      // Calculate momentum score (likes + retweets + replies) / hours
      const engagement = likes + retweets + replies;
      const momentumScore = hoursSinceCreation > 0 ? engagement / hoursSinceCreation : engagement;

      const user = userMap.get(tweet.author_id);
      const author = user ? user.username : 'Unknown';

      return {
        id: `twitter_${tweet.id}`,
        platformId: tweet.id, // ID único de Twitter
        platform: 'twitter',
        author,
        content: tweet.text,
        metrics: {
          likes,
          retweets,
          replies,
        },
        link: `https://twitter.com/${author}/status/${tweet.id}`,
        publishedAt: createdAt,
        createdAt,
        momentumScore: Math.round(momentumScore * 100) / 100,
      };
    } catch (error) {
      console.error('Error normalizing tweet:', error);
      return null;
    }
  }

  private getMockData(keyword: string, options: SearchOptions): Post[] {
    const mockTweets = [
      {
        id: `mock_1_${Date.now()}`,
        platformId: '123456789',
        platform: 'twitter' as const,
        author: 'tech_enthusiast',
        content: `Just discovered amazing ${keyword} trends! The momentum is incredible right now. #${keyword.replace(/\s+/g, '')} #trending`,
        metrics: { likes: 1250, retweets: 89, replies: 45 },
        link: 'https://twitter.com/tech_enthusiast/status/123456789',
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        momentumScore: 692,
      },
      {
        id: `mock_2_${Date.now()}`,
        platformId: '123456790',
        platform: 'twitter' as const,
        author: 'innovation_hub',
        content: `${keyword} is revolutionizing the industry. Here's why you should pay attention to this trend.`,
        metrics: { likes: 890, retweets: 67, replies: 23 },
        link: 'https://twitter.com/innovation_hub/status/123456790',
        publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        momentumScore: 245,
      },
      {
        id: `mock_3_${Date.now()}`,
        platformId: '123456791',
        platform: 'twitter' as const,
        author: 'future_insights',
        content: `Breaking: ${keyword} has reached critical mass. This is the perfect time to get involved!`,
        metrics: { likes: 2100, retweets: 156, replies: 78 },
        link: 'https://twitter.com/future_insights/status/123456791',
        publishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        momentumScore: 1167,
      },
      {
        id: `mock_4_${Date.now()}`,
        platformId: '123456792',
        platform: 'twitter' as const,
        author: 'trend_analyst',
        content: `Analysis: ${keyword} shows 300% growth in the last 24 hours. The data doesn't lie! 📊`,
        metrics: { likes: 567, retweets: 34, replies: 12 },
        link: 'https://twitter.com/trend_analyst/status/123456792',
        publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        momentumScore: 102,
      },
      {
        id: `mock_5_${Date.now()}`,
        platformId: '123456793',
        platform: 'twitter' as const,
        author: 'digital_nomad',
        content: `Just tried the new ${keyword} approach and WOW! Game changer for content creators.`,
        metrics: { likes: 432, retweets: 28, replies: 19 },
        link: 'https://twitter.com/digital_nomad/status/123456793',
        publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        momentumScore: 160,
      },
    ];

    // Filter by timeframe if specified
    const filteredTweets = mockTweets.filter(tweet => {
      const hoursSinceCreation = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60 * 60);

      switch (options.timeframe) {
        case '1h':
          return hoursSinceCreation <= 1;
        case '24h':
          return hoursSinceCreation <= 24;
        case '7d':
          return hoursSinceCreation <= 24 * 7;
        case '30d':
          return hoursSinceCreation <= 24 * 30;
        default:
          return true;
      }
    });

    return filteredTweets.slice(0, options.limit || 50);
  }
}
