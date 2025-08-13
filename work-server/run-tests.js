#!/usr/bin/env bun

/**
 * Simple Test Runner for Work Server
 * 
 * Usage:
 *   bun run-tests.js           # Run all tests
 *   bun run-tests.js pattern   # Run tests matching pattern
 */

import { readdir } from 'fs/promises';
import { join } from 'path';

console.log('🚀 Work Server Test Suite');
console.log('═'.repeat(50));

const testDir = join(import.meta.dir, 'tests');
const pattern = process.argv[2]; // Optional filter pattern

try {
  // Clean up any existing processes
  console.log('🧹 Cleaning up existing processes...');
  try {
    await Bun.spawn(['pkill', '-f', 'bun.*server'], { stdout: 'pipe' }).exited;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    // Ignore cleanup errors
  }

  // Find test files
  const files = await readdir(testDir);
  let testFiles = files
    .filter(f => f.startsWith('test_') && f.endsWith('.js'))
    .filter(f => f !== 'test-runner.js') // Skip old runner
    .sort();

  if (pattern) {
    testFiles = testFiles.filter(f => f.includes(pattern));
    console.log(`🔍 Filtering by pattern: "${pattern}"`);
  }

  if (testFiles.length === 0) {
    console.log('❌ No test files found!');
    process.exit(1);
  }

  console.log(`📋 Found ${testFiles.length} test files:`);
  testFiles.forEach(f => console.log(`   📝 ${f}`));
  console.log('');

  let passed = 0;
  let failed = 0;

  // Run tests sequentially
  for (const testFile of testFiles) {
    const testName = testFile.replace('.js', '').replace('test_', '');
    const testPath = join(testDir, testFile);
    
    console.log(`🧪 Running ${testName}...`);
    console.log('━'.repeat(40));
    
    try {
      const startTime = Date.now();
      
      // Run test as separate process
      const testProcess = Bun.spawn(['bun', testPath], {
        stdout: 'inherit',
        stderr: 'inherit'
      });
      
      const exitCode = await testProcess.exited;
      const duration = Date.now() - startTime;
      
      if (exitCode === 0) {
        passed++;
        console.log(`✅ ${testName} PASSED (${duration}ms)\n`);
      } else {
        failed++;
        console.log(`❌ ${testName} FAILED (exit code: ${exitCode})\n`);
      }
      
    } catch (error) {
      failed++;
      console.log(`❌ ${testName} FAILED: ${error.message}\n`);
    }

    // Clean up between tests
    try {
      await Bun.spawn(['pkill', '-f', 'bun.*server'], { stdout: 'pipe' }).exited;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Print summary
  console.log('═'.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  const successRate = passed / (passed + failed) * 100;
  console.log(`📈 Success Rate: ${successRate.toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed`);
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Test runner error:', error);
  process.exit(1);
}