import app from './app';
import { logger } from './middleware/logging.middleware';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Graceful shutdown function
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  process.exit(0);
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Trending Finder API server started`, {
    port: PORT,
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
  
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║                    🚀 Trending Finder API                   ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  Environment: ${NODE_ENV.padEnd(47)} ║
  ║  Port: ${PORT.toString().padEnd(55)} ║
  ║  URL: http://localhost:${PORT.toString().padEnd(44)} ║
  ║  Health Check: http://localhost:${PORT}/health${' '.repeat(35)} ║
  ║  API Base: http://localhost:${PORT}/api/v1${' '.repeat(40)} ║
  ╚══════════════════════════════════════════════════════════════╝
  `);
});

// Handle server errors
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  switch (error.code) {
    case 'EACCES':
      logger.error(`Port ${PORT} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.error(`Port ${PORT} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

export default server;
