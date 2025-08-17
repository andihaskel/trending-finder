import axios, { AxiosInstance } from 'axios';
import { Post, SearchOptions } from '../models/post.model';
import { PlatformConfig, PlatformService } from './interfaces/platform.service';

export class YouTubeService implements PlatformService {
  private client: AxiosInstance;

  constructor(private config: PlatformConfig) {
    this.client = axios.create({
      baseURL: 'https://www.googleapis.com/youtube/v3',
      params: {
        key: config.apiKey,
      },
    });
  }

  getPlatformName(): string {
    return 'youtube';
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  async searchTrends(keyword: string, options: SearchOptions): Promise<Post[]> {
    if (!this.isAvailable()) {
      throw new Error('YouTube service is not configured');
    }

    try {
      const publishedAfter = this.calculatePublishedAfter(options.timeframe);

      const response = await this.client.get('/search', {
        params: {
          part: 'snippet',
          q: keyword,
          type: 'video',
          order: 'viewCount',
          publishedAfter,
          maxResults: options.limit || 50,
          relevanceLanguage: options.lang || 'en',
          regionCode: options.region || 'US',
        },
      });

      const videoIds = response.data.items.map((item: any) => item.id.videoId);

      if (videoIds.length === 0) {
        return [];
      }

      // Get detailed video statistics
      const statsResponse = await this.client.get('/videos', {
        params: {
          part: 'statistics,snippet,contentDetails',
          id: videoIds.join(','),
        },
      });

      return statsResponse.data.items
        .map((video: any) => this.normalizeYouTubeVideo(video))
        .filter((post: Post) => post !== null)
        .sort((a: Post, b: Post) => b.momentumScore - a.momentumScore);
    } catch (error) {
      console.error('Error searching YouTube trends:', error);
      return [];
    }
  }

  private calculatePublishedAfter(timeframe: string): string {
    const now = new Date();
    let publishedAfter: Date;

    switch (timeframe) {
      case '1h':
        publishedAfter = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        publishedAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        publishedAfter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        publishedAfter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        publishedAfter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        publishedAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return publishedAfter.toISOString();
  }

  private normalizeYouTubeVideo(video: any): Post | null {
    try {
      const createdAt = new Date(video.snippet.publishedAt);
      const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

      const stats = video.statistics;
      const views = parseInt(stats.viewCount || '0', 10);
      const likes = parseInt(stats.likeCount || '0', 10);
      const comments = parseInt(stats.commentCount || '0', 10);

      // Calculate momentum score (views + likes + comments) / hours
      const engagement = views + likes + comments;
      const momentumScore = hoursSinceCreation > 0 ? engagement / hoursSinceCreation : engagement;

      return {
        id: `youtube_${video.id}`,
        platformId: video.id, // ID único de YouTube
        platform: 'youtube',
        author: video.snippet.channelTitle,
        content: video.snippet.description || 'No description',
        title: video.snippet.title,
        metrics: {
          views,
          likes,
          comments,
        },
        link: `https://www.youtube.com/watch?v=${video.id}`,
        thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.medium?.url,
        publishedAt: createdAt,
        createdAt,
        momentumScore: Math.round(momentumScore * 100) / 100,
      };
    } catch (error) {
      console.error('Error normalizing YouTube video:', error);
      return null;
    }
  }
}
