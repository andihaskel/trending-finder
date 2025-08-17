import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { errorLogger, requestLogger } from './middleware/logging.middleware';
import { generalRateLimiter, searchRateLimiter } from './middleware/rate-limit.middleware';
import trendsRoutes from './routes/trends.routes';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(generalRateLimiter);

// Health check endpoint (no rate limiting)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Trending Finder API',
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

// API routes
app.use('/api/v1', trendsRoutes);

// Apply search rate limiting to search endpoints
app.use('/api/v1/trends', searchRateLimiter);

// 404 handler
app.use(notFoundHandler);

// Error logging
app.use(errorLogger);

// Global error handler
app.use(errorHandler);

export default app;
