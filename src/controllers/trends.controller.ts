import { Request, Response } from 'express';
import { z } from 'zod';
import { SearchOptions } from '../models/post.model';
import { TrendsService } from '../services/trends.service';

// Validation schemas
const searchTrendSchema = z.object({
  q: z.string().min(1, 'Trend parameter is required'),
  platforms: z.string().optional().transform(val => {
    if (!val) return ['reddit', 'youtube', 'twitter'] as const;
    return val.split(',').map(p => p.trim().toLowerCase()) as any;
  }),
  timeframe: z.enum(['1h', '24h', '7d', '30d', '1y', 'all']).default('24h'),
  lang: z.string().length(2).optional(),
  region: z.string().length(2).optional(),
  limit: z.string().optional().transform(val => {
    if (!val) return 50;
    const num = parseInt(val, 10);
    return isNaN(num) ? 50 : Math.min(Math.max(num, 1), 100);
  }),
});

export class TrendsController {
  private trendsService: TrendsService;

  constructor() {
    this.trendsService = new TrendsService();
  }

  /**
   * Search for trends across platforms
   */
  async searchTrends(req: Request, res: Response): Promise<void> {
    try {
      // Validate query parameters
      const validationResult = searchTrendSchema.safeParse(req.query);

      if (!validationResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid Trend parameters',
          details: validationResult.error.errors,
        });
        return;
      }

      const { q, platforms, timeframe, lang, region, limit } = validationResult.data;

      const searchOptions: SearchOptions = {
        keyword: q,
        platforms,
        timeframe,
        lang,
        region,
        limit,
      };

      // Search for trends
      const result = await this.trendsService.searchTrends(searchOptions);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error in searchTrends controller:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to search trends',
      });
    }
  }

  /**
   * Get trending topics
   */
  async getTrendingTopics(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const topics = await this.trendsService.getTrendingTopics(limit);

      res.json({
        success: true,
        data: {
          topics,
          count: topics.length,
        },
      });
    } catch (error) {
      console.error('Error in getTrendingTopics controller:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to get trending topics',
      });
    }
  }

  /**
   * Get platform status
   */
  async getPlatformStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = this.trendsService.getPlatformStatus();
      const availablePlatforms = this.trendsService.getAvailablePlatforms();

      res.json({
        success: true,
        data: {
          platforms: status,
          available: availablePlatforms,
        },
      });
    } catch (error) {
      console.error('Error in getPlatformStatus controller:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to get platform status',
      });
    }
  }

  /**
   * Get user search history
   */
  async getUserSearchHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.userId || req.query.userId as string;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID is required',
        });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const history = await this.trendsService.getUserSearchHistory(userId, limit);

      res.json({
        success: true,
        data: {
          userId,
          searches: history,
          count: history.length,
        },
      });
    } catch (error) {
      console.error('Error in getUserSearchHistory controller:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to get user search history',
      });
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const platformStatus = this.trendsService.getPlatformStatus();
      const availablePlatforms = this.trendsService.getAvailablePlatforms();

      res.json({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          platforms: platformStatus,
          available: availablePlatforms,
        },
      });
    } catch (error) {
      console.error('Error in healthCheck controller:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Health check failed',
      });
    }
  }
}
