# Distributed Wallet Recovery Worker

This document describes the new distributed worker system for `joerecover`. The worker system allows multiple machines to collaborate on wallet recovery by communicating with a central API server.

## Architecture Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Worker 1   │    │   Worker 2   │    │   Worker N   │
│              │    │              │    │              │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ joegen   │ │    │ │ joegen   │ │    │ │ joegen   │ │
│ │    ↓     │ │    │ │    ↓     │ │    │ │    ↓     │ │
│ │joerecover│ │    │ │joerecover│ │    │ │joerecover│ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       │ HTTP API          │ HTTP API          │ HTTP API
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │ API Server  │
                    │             │
                    │ Work Queue  │
                    │ Status Log  │
                    └─────────────┘
```

## Components

### 1. Worker Binary (`worker`)

The worker binary is responsible for:
- Requesting work from the API server
- Running `joegen` with the provided token content
- Piping `joegen` output to `joerecover`
- Monitoring progress and sending status updates
- Handling errors and retries

### 2. Modified `joegen`

Enhanced to accept token content directly instead of requiring files:
- `Config::from_content()` - Create config with direct content
- `run_joegen_with_content()` - Process tokens without file I/O

### 3. API Server (to be implemented)

The API server provides these endpoints:
- `POST /get_work` - Returns work packets or 204 if none available
- `POST /work_status` - Receives status updates from workers

## API Protocol

### Work Packet Format

```json
{
  "id": "work_12345",
  "token_content": "word1 word2\nword3 word4\n[len:4] [first:b]",
  "skip": 1000,
  "stop_at": 5000
}
```

### Status Update Format

```json
{
  "work_id": "work_12345",
  "processed": 50000,
  "found": 2,
  "rate": 300.5,
  "completed": false,
  "error": null
}
```

## Usage

### Building

```bash
# Build all binaries
cargo build --release

# Build just the worker
cargo build --bin worker --release
```

### Running a Worker

```bash
./target/release/worker \
  --api-url http://localhost:8080 \
  --worker-id worker_001 \
  --addressdb addresses-BTC-2011-to-2021-03-31.db \
  --threads 8 \
  --slack-webhook https://hooks.slack.com/services/...
```

### Worker Arguments

- `--api-url <URL>` - API server URL (required)
- `--worker-id <ID>` - Unique worker identifier (required)
- `--addressdb <FILE>` - Address database for `joerecover` (optional)
- `--threads <NUM>` - Worker threads for `joerecover` (default: 8)
- `--slack-webhook <URL>` - Slack webhook for found seeds (optional)

## Testing

### Demo Server

A demo API server is provided for testing:

```bash
# Install Flask
pip3 install flask

# Run demo server
python3 demo_server.py

# In another terminal, run worker
./target/release/worker --api-url http://localhost:8080 --worker-id test_worker
```

### Integration Tests

```bash
# Run worker unit tests
cargo test --bin worker

# Run integration test
cargo run --bin test_integration
```

## Worker Behavior

### Work Loop

1. **Request Work**: POST to `/get_work` with worker ID
2. **Process Work**: If work received, start processing
3. **Status Updates**: Send progress every 5 seconds or 100k processed
4. **Complete Work**: Send final status when done
5. **Repeat**: Go back to step 1

### No Work Available

- Worker receives 204 No Content
- Waits 1 second and tries again
- Continues indefinitely

### Error Handling

- API communication errors: Wait 5 seconds, retry
- Processing errors: Report in status, continue to next work
- Network failures: Automatic retry with backoff

### Status Updates

Status updates are sent:
- Every 5 seconds during processing
- Every 100,000 permutations processed
- When work is completed (success or failure)

## Token Content Format

Token content follows the same format as token files:

```
# Simple word combinations
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong

# Rule-based tokens
[len:4] [first:b] [last:y]
[len:5] abandon abandon
```

## Performance Considerations

### Memory Usage

- Workers stream permutations directly to `joerecover`
- No large intermediate files created
- Memory usage scales with thread count, not work size

### Network Traffic

- Work packets are small (typically < 1KB)
- Status updates sent sparingly (every 5 seconds)
- No large data transfers during processing

### CPU Distribution

- Each worker processes independently
- Work can be split by skip/stop_at parameters
- Natural load balancing through work queue

## Future Enhancements

### Server Features

- Work queue persistence
- Worker health monitoring
- Progress aggregation
- Result collection
- Web dashboard

### Worker Features

- Configuration files
- Automatic CPU detection
- Dynamic thread adjustment
- Local result caching

### Security Features

- Worker authentication
- API rate limiting
- Encrypted communication
- Access control

## Example Scenarios

### Single Machine, Multiple Processes

```bash
# Terminal 1
./target/release/worker --api-url http://server:8080 --worker-id machine1_worker1 --threads 4

# Terminal 2  
./target/release/worker --api-url http://server:8080 --worker-id machine1_worker2 --threads 4
```

### Multiple Machines

```bash
# Machine 1
./target/release/worker --api-url http://server:8080 --worker-id machine1 --threads 16

# Machine 2
./target/release/worker --api-url http://server:8080 --worker-id machine2 --threads 8

# Machine 3
./target/release/worker --api-url http://server:8080 --worker-id machine3 --threads 12
```

### Cloud Deployment

```bash
# Auto-scaling worker nodes
for i in {1..10}; do
  nohup ./target/release/worker \
    --api-url http://control-server:8080 \
    --worker-id "cloud_worker_$i" \
    --threads $(nproc) &
done
```

## Monitoring

### Server Status

```bash
curl http://localhost:8080/status
```

### Work Debug

```bash
curl http://localhost:8080/debug/work_status/work_12345
```

### Worker Logs

Workers log to stderr:
- Work assignments
- Progress updates
- Completion status
- Error messages

Example output:
```
🔧 Worker started: test_worker
📡 API URL: http://localhost:8080
🚀 Starting work packet: work_12345
📊 Work work_12345: 100000 processed, 0 found, 298/sec
✅ Work packet work_12345 completed: 150000 processed, 2 found
```
