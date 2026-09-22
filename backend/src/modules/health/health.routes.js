import { Router } from 'express';
import * as healthRepository from './health.repository.js';

export const healthRoutes = Router();

// Liveness: is the API process running?
healthRoutes.get('/', (_req, res) => {
  res.json({ success: true, message: 'API is running' });
});

// Readiness: can the API reach the database?
healthRoutes.get('/db', async (_req, res) => {
  try {
    await healthRepository.checkConnection();
    res.json({ success: true, message: 'Database connection is healthy' });
  } catch {
    // Never include the database error text: it can contain the connection string.
    res.status(503).json({ success: false, message: 'Database connection failed' });
  }
});
