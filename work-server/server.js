import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import WorkDatabase from './database.js';
import { createSSE } from './lib/sse.js';
import { registerRoutes } from './lib/routes.js';

const app = new Hono();
const db = new WorkDatabase();

// Serve static assets
app.use('/static/*', serveStatic({ root: './public' }));

// Create SSE broadcaster and register all routes
const sse = createSSE();
registerRoutes(app, db, sse);

// Broadcast refresh events every second
      setInterval(() => {
  sse.broadcast({ type: 'refresh', ts: Date.now() });
}, 1000);

// Start server (Hono fetch export)
const port = process.env.PORT || 3000;
console.log(`🚀 Starting Wallet Recovery Server on port ${port}`);
console.log(`📡 Worker API: http://localhost:${port}/get_work`);
console.log(`🌐 Dashboard: http://localhost:${port}/`);

export default { port, fetch: app.fetch };
