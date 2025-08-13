#!/usr/bin/env bun

/**
 * Worker Flow Tests - Worker API and found results
 */

import { join } from 'path';

console.log('Testing worker flow...');

async function testWorkerFlow() {
  let serverProcess = null;
  
  try {
    const serverPath = join(import.meta.dir, '..', 'server.js');
    
    // Start server
    serverProcess = Bun.spawn(['bun', serverPath], {
      stdout: 'inherit',
      stderr: 'inherit'
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create a job first
    console.log('Creating test job...');
    const jobData = new FormData();
    jobData.append('name', 'Worker Test Job');
    jobData.append('tokenfile_content', 'test1 test2\ntest3 test4');
    jobData.append('chunk_size', '2');
    jobData.append('priority', '0');

    const jobResponse = await fetch('http://localhost:3000/api/jobs', {
      method: 'POST',
      body: jobData
    });

    if (!jobResponse.ok) {
      throw new Error(`Job creation failed: ${jobResponse.status}`);
    }

    const jobResult = await jobResponse.json();
    console.log(`✅ Job created: ${jobResult.id}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test get work
    console.log('Testing worker get work...');
    const workRequest = {
      worker_id: 'test-worker',
      capabilities: {}
    };

    const workResponse = await fetch('http://localhost:3000/get_work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workRequest)
    });

    if (workResponse.status === 204) {
      console.log('⚠️ No work available (may be expected)');
    } else if (workResponse.ok) {
      const workPacket = await workResponse.json();
      console.log(`✅ Work assigned: ${workPacket.id}`);

      // Test status update with found results
      console.log('Testing found results storage...');
      const statusUpdate = {
        work_id: workPacket.id,
        processed: 2,
        found: 1,
        rate: 100.0,
        completed: true,
        error: null,
        found_results: [
          {
            seed_phrase: 'test1 test3',
            address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
          }
        ]
      };

      const statusResponse = await fetch('http://localhost:3000/work_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusUpdate)
      });

      if (statusResponse.ok) {
        console.log('✅ Found results submitted successfully');
      } else {
        throw new Error(`Status update failed: ${statusResponse.status}`);
      }

    } else {
      throw new Error(`Get work failed: ${workResponse.status}`);
    }

    console.log('🎉 Worker flow tests passed!');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

await testWorkerFlow();
