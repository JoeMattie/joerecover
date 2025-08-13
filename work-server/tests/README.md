# Work Server Test Suite

## Quick Start

Run all tests:
```bash
bun run test
```

Run individual tests:
```bash
bun tests/test_basic_api.js
```

## Current Tests

### ✅ test_basic_api.js
Tests core API endpoint accessibility:
- Dashboard (/)
- Jobs list (/jobs)  
- Workers (/workers)

This test verifies the server can start and serve basic pages.

### Future Tests
Additional tests can be added for:
- Token expansion functionality
- Job creation and management
- Worker API interactions
- Found results storage

## Adding Tests

1. Create `test_[name].js` in the `tests/` directory
2. Use this pattern:
   ```javascript
   #!/usr/bin/env bun
   import { join } from 'path';
   
   async function test[Name]() {
     let serverProcess = null;
     try {
       const serverPath = join(import.meta.dir, '..', 'server.js');
       serverProcess = Bun.spawn(['bun', serverPath], {
         stdout: 'inherit',
         stderr: 'inherit'
       });
       await new Promise(resolve => setTimeout(resolve, 3000));
       
       // Your tests here
       
     } finally {
       if (serverProcess) {
         serverProcess.kill();
         await new Promise(resolve => setTimeout(resolve, 1000));
       }
     }
   }
   
   await test[Name]();
   ```

## Test Runner Commands

```bash
# All tests
bun run test

# Filter by pattern  
bun run-tests.js basic
bun run-tests.js api
bun run-tests.js token
```
