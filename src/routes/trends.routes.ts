import { Router } from 'express';
import { TrendsController } from '../controllers/trends.controller';

const router = Router();
const trendsController = new TrendsController();

// Health check
router.get('/health', trendsController.healthCheck.bind(trendsController));

// Main trends search endpoint
router.get('/trends', trendsController.searchTrends.bind(trendsController));

// Get trending topics
router.get('/trending', trendsController.getTrendingTopics.bind(trendsController));

// Get platform status
router.get('/platforms/status', trendsController.getPlatformStatus.bind(trendsController));

// Get user search history
router.get('/users/:userId/history', trendsController.getUserSearchHistory.bind(trendsController));
router.get('/users/history', trendsController.getUserSearchHistory.bind(trendsController));

export default router;
