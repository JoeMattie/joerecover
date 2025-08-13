#!/usr/bin/env bun

/**
 * Basic API Tests - Core endpoint accessibility
 */

import { join } from 'path';

console.log('Testing basic API endpoints...');

async function testBasicAPI() {
  let serverProcess = null;
  
  try {
    const serverPath = join(import.meta.dir, '..', 'server.js');
    
    // Start server
    serverProcess = Bun.spawn(['bun', serverPath], {
      stdout: 'inherit',
      stderr: 'inherit'
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test dashboard
    const dashboardResponse = await fetch('http://localhost:3000/');
    if (!dashboardResponse.ok) {
      throw new Error(`Dashboard not accessible: ${dashboardResponse.status}`);
    }
    console.log('✅ Dashboard accessible');

    // Test jobs endpoint
    const jobsResponse = await fetch('http://localhost:3000/jobs');
    if (!jobsResponse.ok) {
      throw new Error(`Jobs endpoint error: ${jobsResponse.status}`);
    }
    console.log('✅ Jobs endpoint accessible');

    // Test workers endpoint
    const workersResponse = await fetch('http://localhost:3000/workers');
    if (!workersResponse.ok) {
      throw new Error(`Workers endpoint error: ${workersResponse.status}`);
    }
    console.log('✅ Workers endpoint accessible');

    console.log('🎉 All basic API tests passed!');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

await testBasicAPI();
