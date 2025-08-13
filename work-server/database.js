import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';

class WorkDatabase {
  constructor(dbPath = 'work.db') {
    this.db = new Database(dbPath);
    this.initTables();
  }

  initTables() {
    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    // Jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tokenfile_content TEXT NOT NULL,
        total_permutations BIGINT,
        chunk_size BIGINT NOT NULL,
        priority INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        created_by TEXT,
        notes TEXT,
        total_processed BIGINT DEFAULT 0,
        total_found BIGINT DEFAULT 0,
        active_chunks INTEGER DEFAULT 0,
        completed_chunks INTEGER DEFAULT 0,
        failed_chunks INTEGER DEFAULT 0
      )
    `);

    // Work chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_chunks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        chunk_number INTEGER NOT NULL,
        skip_count BIGINT NOT NULL,
        stop_at BIGINT NOT NULL,
        status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        assigned_at DATETIME,
        started_at DATETIME,
        completed_at DATETIME,
        processed_count BIGINT DEFAULT 0,
        found_count BIGINT DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_error TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `);

    // Workers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'idle',
        current_chunk_id TEXT,
        capabilities TEXT,
        total_processed BIGINT DEFAULT 0,
        total_found BIGINT DEFAULT 0,
        average_rate FLOAT DEFAULT 0,
        reliability_score FLOAT DEFAULT 1.0,
        last_performance_update DATETIME,
        FOREIGN KEY (current_chunk_id) REFERENCES work_chunks(id)
      )
    `);

    // Chunk failures table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        error_message TEXT,
        failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_time_seconds INTEGER,
        FOREIGN KEY (chunk_id) REFERENCES work_chunks(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )
    `);

    // Permanent errors table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permanent_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        original_chunk_number INTEGER NOT NULL,
        skip_count BIGINT NOT NULL,
        stop_at BIGINT NOT NULL,
        total_attempts INTEGER NOT NULL,
        last_error TEXT NOT NULL,
        first_failed_at DATETIME NOT NULL,
        marked_permanent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `);

    // Work progress table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        processed_count BIGINT NOT NULL,
        found_count BIGINT NOT NULL,
        rate FLOAT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES work_chunks(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
      )
    `);

    // Found results table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS found_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        original_chunk_id TEXT,
        worker_id TEXT NOT NULL,
        seed_phrase TEXT NOT NULL,
        address TEXT NOT NULL,
        found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        chunk_skip_count BIGINT,
        chunk_stop_at BIGINT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `);

    // Job summaries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        completed_chunks INTEGER NOT NULL,
        failed_chunks INTEGER NOT NULL,
        total_processing_time_seconds BIGINT NOT NULL,
        average_rate FLOAT NOT NULL,
        total_worker_hours FLOAT NOT NULL,
        fastest_worker_id TEXT,
        slowest_worker_id TEXT,
        most_reliable_worker_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_chunks_job_status ON work_chunks(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_work_chunks_status ON work_chunks(status);
      CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
      CREATE INDEX IF NOT EXISTS idx_work_progress_chunk ON work_progress(chunk_id);
      CREATE INDEX IF NOT EXISTS idx_found_results_job ON found_results(job_id);
    `);

    console.log('📚 Database tables initialized');
  }

  // Job management
  createJob(name, tokenfileContent, chunkSize = 1000000, priority = 0, createdBy = null, notes = '') {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, name, tokenfile_content, chunk_size, priority, created_by, notes)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `);
    stmt.run(id, name, tokenfileContent, chunkSize, priority, createdBy, notes);
    return id;
  }

  getJob(jobId) {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(jobId);
  }

  getAllJobs() {
    // First, update job statuses based on chunk activity
    this.updateJobStatuses();
    
    const stmt = this.db.prepare(`
      SELECT 
        j.*,
        -- Calculate proper progress: completed chunks + partial progress from active chunks
        COALESCE(
          SUM(CASE WHEN wc.status = 'completed' THEN (wc.stop_at - wc.skip_count) ELSE 0 END) +
          SUM(CASE WHEN wc.status IN ('processing', 'assigned') THEN MIN(wc.processed_count, wc.stop_at - wc.skip_count) ELSE 0 END),
          0
        ) as total_processed,
        COALESCE(SUM(wc.found_count), 0) as total_found,
        CASE 
          WHEN j.status = 'completed' THEN '✅'
          WHEN j.status = 'running' THEN '🏃'
          WHEN j.status = 'paused' THEN '⏸️'
          WHEN j.status = 'failed' THEN '❌'
          ELSE '📄'
        END as status_icon
      FROM jobs j
      LEFT JOIN work_chunks wc ON j.id = wc.job_id
      GROUP BY j.id
      ORDER BY j.priority DESC, j.created_at DESC
    `);
    return stmt.all();
  }

  // Update job statuses based on chunk activity
  updateJobStatuses() {
    // Mark jobs as running if they have processing chunks
    this.db.prepare(`
      UPDATE jobs 
      SET status = 'running' 
      WHERE status = 'pending' 
      AND id IN (
        SELECT DISTINCT job_id 
        FROM work_chunks 
        WHERE status IN ('assigned', 'processing')
      )
    `).run();

    // Mark jobs as completed if all chunks are done
    this.db.prepare(`
      UPDATE jobs 
      SET status = 'completed', completed_at = datetime('now')
      WHERE status IN ('running', 'pending') 
      AND id NOT IN (
        SELECT DISTINCT job_id 
        FROM work_chunks 
        WHERE status NOT IN ('completed', 'failed')
      )
      AND id IN (
        SELECT job_id 
        FROM work_chunks 
        GROUP BY job_id 
        HAVING COUNT(*) > 0
      )
    `).run();

    // Mark jobs as pending if they have no active chunks but have pending chunks
    this.db.prepare(`
      UPDATE jobs 
      SET status = 'pending' 
      WHERE status = 'running' 
      AND id NOT IN (
        SELECT DISTINCT job_id 
        FROM work_chunks 
        WHERE status IN ('assigned', 'processing')
      )
      AND id IN (
        SELECT DISTINCT job_id 
        FROM work_chunks 
        WHERE status = 'pending'
      )
    `).run();
  }

  updateJobStatus(jobId, status, additionalFields = {}) {
    const fields = Object.keys(additionalFields);
    const values = Object.values(additionalFields);
    
    let sql = 'UPDATE jobs SET status = ?';
    const params = [status];
    
    if (fields.length > 0) {
      sql += ', ' + fields.map(field => `${field} = ?`).join(', ');
      params.push(...values);
    }
    
    sql += ' WHERE id = ?';
    params.push(jobId);
    
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  // Work chunk management
  createWorkChunks(jobId, totalPermutations, chunkSize) {
    return this.createWorkChunksWithSkip(jobId, totalPermutations, chunkSize, 0);
  }

  createWorkChunksWithSkip(jobId, totalPermutations, chunkSize, skipFirst = 0) {
    const chunks = [];
    let chunkNumber = 0;
    
    for (let skip = 0; skip < totalPermutations; skip += chunkSize) {
      const stopAt = Math.min(skip + chunkSize, totalPermutations);
      const chunkId = randomUUID();
      
      // Determine initial status and processed count based on skipFirst
      let status = 'pending';
      let processedCount = 0;
      let foundCount = 0;
      let completedAt = null;
      
      if (skip + chunkSize <= skipFirst) {
        // This entire chunk is within the skip range - mark as completed
        status = 'completed';
        processedCount = stopAt - skip;
        completedAt = new Date().toISOString();
      } else if (skip < skipFirst && stopAt > skipFirst) {
        // This chunk is partially skipped
        processedCount = skipFirst - skip;
        // Keep status as 'pending' since there's still work to do
      }
      
      chunks.push({
        id: chunkId,
        job_id: jobId,
        chunk_number: chunkNumber++,
        skip_count: skip,
        stop_at: stopAt,
        status: status,
        processed_count: processedCount,
        found_count: foundCount,
        completed_at: completedAt
      });
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO work_chunks (id, job_id, chunk_number, skip_count, stop_at, status, processed_count, found_count, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = this.db.transaction(() => {
      chunks.forEach(chunk => {
        stmt.run(
          chunk.id, 
          chunk.job_id, 
          chunk.chunk_number, 
          chunk.skip_count, 
          chunk.stop_at,
          chunk.status,
          chunk.processed_count,
          chunk.found_count,
          chunk.completed_at
        );
      });
    });
    
    transaction();
    return chunks.length;
  }

  getNextWorkChunk() {
    const stmt = this.db.prepare(`
      SELECT wc.* 
      FROM work_chunks wc
      JOIN jobs j ON wc.job_id = j.id
      WHERE wc.status = 'pending' AND j.status IN ('pending', 'running')
      ORDER BY 
        j.priority DESC,
        j.created_at ASC,
        wc.chunk_number ASC
      LIMIT 1
    `);
    return stmt.get();
  }

  assignChunkToWorker(chunkId, workerId) {
    const stmt = this.db.prepare(`
      UPDATE work_chunks 
      SET status = 'assigned', assigned_to = ?, assigned_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(workerId, chunkId);
    
    if (result.changes > 0) {
      // Update job status since a chunk was just assigned
      const chunk = this.db.prepare('SELECT job_id FROM work_chunks WHERE id = ?').get(chunkId);
      if (chunk) {
        this.updateJobStatus(chunk.job_id, 'running');
      }
    }
    
    return result.changes > 0;
  }

  updateChunkProgress(chunkId, processed, found, status = null) {
    // Get chunk info to validate progress
    const chunk = this.db.prepare('SELECT skip_count, stop_at FROM work_chunks WHERE id = ?').get(chunkId);
    if (!chunk) return;
    
    const chunkSize = chunk.stop_at - chunk.skip_count;
    
    // Ensure processed count doesn't exceed chunk size and isn't negative
    const validProcessed = Math.max(0, Math.min(processed, chunkSize));
    
    let sql = 'UPDATE work_chunks SET processed_count = ?, found_count = ?';
    const params = [validProcessed, found];
    
    if (status) {
      sql += ', status = ?';
      params.push(status);
      
      if (status === 'completed') {
        sql += ', completed_at = CURRENT_TIMESTAMP';
        // For completed chunks, set processed to full chunk size
        params[0] = chunkSize;
      } else if (status === 'processing' && !sql.includes('started_at')) {
        sql += ', started_at = CURRENT_TIMESTAMP';
      }
    }
    
    sql += ' WHERE id = ?';
    params.push(chunkId);
    
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
    
    // Trigger job status update if chunk status changed
    if (status) {
      const jobChunk = this.db.prepare('SELECT job_id FROM work_chunks WHERE id = ?').get(chunkId);
      if (jobChunk) {
        // Update job statuses automatically
        this.updateJobStatuses();
      }
    }
  }

  // Worker management
  registerWorker(workerId, capabilities = '{}') {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workers (id, capabilities, last_heartbeat)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(workerId, capabilities);
  }

  updateWorkerHeartbeat(workerId) {
    const stmt = this.db.prepare(`
      UPDATE workers SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(workerId);
  }

  getActiveWorkers() {
    const stmt = this.db.prepare(`
      SELECT *, 
        CASE WHEN datetime('now', '-30 seconds') > last_heartbeat THEN 'offline' ELSE status END as actual_status
      FROM workers
      ORDER BY last_heartbeat DESC
    `);
    return stmt.all();
  }

  // Progress tracking
  addProgressUpdate(chunkId, workerId, processed, found, rate) {
    const stmt = this.db.prepare(`
      INSERT INTO work_progress (chunk_id, worker_id, processed_count, found_count, rate)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(chunkId, workerId, processed, found, rate);
  }

  addFoundResult(jobId, chunkId, workerId, seedPhrase, address, chunkSkipCount, chunkStopAt) {
    const stmt = this.db.prepare(`
      INSERT INTO found_results (
        job_id, original_chunk_id, worker_id, seed_phrase, address, 
        found_at, chunk_skip_count, chunk_stop_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `);
    
    stmt.run(
      jobId,
      chunkId,
      workerId,
      seedPhrase,
      address,
      chunkSkipCount,
      chunkStopAt
    );
  }

  // Dashboard queries
  getJobProgress(jobId) {
    // Update job statuses first
    this.updateJobStatuses();
    
    const stmt = this.db.prepare(`
      SELECT 
        j.*,
        COUNT(wc.id) as total_chunks,
        SUM(CASE WHEN wc.status = 'completed' THEN 1 ELSE 0 END) as completed_chunks,
        SUM(CASE WHEN wc.status = 'processing' OR wc.status = 'assigned' THEN 1 ELSE 0 END) as active_chunks,
        SUM(CASE WHEN wc.status = 'failed' THEN 1 ELSE 0 END) as failed_chunks,
        -- Calculate proper progress: completed chunks + partial progress from active chunks
        COALESCE(
          SUM(CASE WHEN wc.status = 'completed' THEN (wc.stop_at - wc.skip_count) ELSE 0 END) +
          SUM(CASE WHEN wc.status IN ('processing', 'assigned') THEN MIN(wc.processed_count, wc.stop_at - wc.skip_count) ELSE 0 END),
          0
        ) as total_processed,
        COALESCE(SUM(wc.found_count), 0) as total_found,
        COALESCE(AVG(wp.rate), 0) as current_rate
      FROM jobs j
      LEFT JOIN work_chunks wc ON j.id = wc.job_id
      LEFT JOIN work_progress wp ON wc.id = wp.chunk_id 
        AND wp.timestamp > datetime('now', '-1 minute')
      WHERE j.id = ?
      GROUP BY j.id
    `);
    return stmt.get(jobId);
  }

  getOverallStats() {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(DISTINCT j.id) as total_jobs,
        COUNT(DISTINCT CASE WHEN j.status = 'running' THEN j.id END) as active_jobs,
        COUNT(DISTINCT CASE WHEN j.status = 'completed' THEN j.id END) as completed_jobs,
        COUNT(DISTINCT w.id) as total_workers,
        COUNT(DISTINCT CASE WHEN w.last_heartbeat > datetime('now', '-30 seconds') THEN w.id END) as online_workers,
        SUM(j.total_processed) as total_processed,
        SUM(j.total_found) as total_found
      FROM jobs j
      CROSS JOIN workers w
    `);
    return stmt.get();
  }

  close() {
    this.db.close();
  }
}

export default WorkDatabase;
