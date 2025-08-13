use std::io::BufWriter;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::thread;
use clap::{Arg, Command as ClapCommand};
use serde::{Deserialize, Serialize};
use joerecover::run_joegen_with_content;

#[derive(Debug, Clone, Deserialize)]
struct WorkPacket {
    /// Unique identifier for this work unit
    id: String,
    /// Token content to be processed (instead of reading from file)
    token_content: String,
    /// Number of permutations to skip
    skip: u64,
    /// Number of permutations to generate (None = until done)
    stop_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
struct WorkStatus {
    /// Work packet ID
    work_id: String,
    /// Number of permutations processed so far
    processed: u64,
    /// Number of found matches
    found: u64,
    /// Processing rate (permutations per second)
    rate: f64,
    /// Whether work is complete
    completed: bool,
    /// Any error message
    error: Option<String>,
    /// Found results (seed phrases and addresses)
    found_results: Option<Vec<FoundResult>>,
}

#[derive(Debug, Clone, Serialize)]
struct FoundResult {
    /// The seed phrase that was found
    seed_phrase: String,
    /// The Bitcoin address that matched
    address: String,
}

#[derive(Debug, Serialize)]
struct GetWorkRequest {
    /// Worker identifier
    worker_id: String,
}

struct WorkerConfig {
    api_url: String,
    worker_id: String,
    joerecover_args: Vec<String>,
}

impl WorkerConfig {
    fn from_args() -> Result<Self, Box<dyn std::error::Error>> {
        let matches = ClapCommand::new("worker")
            .about("Distributed wallet recovery worker")
            .arg(Arg::new("api-url")
                .long("api-url")
                .value_name("URL")
                .help("API server URL (e.g., http://localhost:8080)")
                .required(true))
            .arg(Arg::new("worker-id")
                .long("worker-id")
                .value_name("ID")
                .help("Unique worker identifier")
                .required(true))
            .arg(Arg::new("addressdb")
                .long("addressdb")
                .value_name("FILE")
                .help("Path to addressdb file for joerecover")
                .required(false))
            .arg(Arg::new("threads")
                .long("threads")
                .short('t')
                .value_name("NUM")
                .help("Number of worker threads for joerecover")
                .default_value("8"))
            .arg(Arg::new("slack-webhook")
                .long("slack-webhook")
                .value_name("URL")
                .help("Slack webhook URL for found seed phrases")
                .required(false))
            .get_matches();

        let api_url = matches.get_one::<String>("api-url").unwrap().clone();
        let worker_id = matches.get_one::<String>("worker-id").unwrap().clone();
        
        let mut joerecover_args = vec![
            "--threads".to_string(),
            matches.get_one::<String>("threads").unwrap().clone(),
        ];
        
        if let Some(addressdb) = matches.get_one::<String>("addressdb") {
            joerecover_args.push("--addressdb".to_string());
            joerecover_args.push(addressdb.clone());
        }
        
        if let Some(slack_webhook) = matches.get_one::<String>("slack-webhook") {
            joerecover_args.push("--slack-webhook".to_string());
            joerecover_args.push(slack_webhook.clone());
        }

        Ok(WorkerConfig {
            api_url,
            worker_id,
            joerecover_args,
        })
    }
}

struct ApiClient {
    client: reqwest::Client,
    base_url: String,
}

impl ApiClient {
    fn new(base_url: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
        }
    }

    async fn get_work(&self, worker_id: &str) -> Result<Option<WorkPacket>, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/get_work", self.base_url);
        let request = GetWorkRequest {
            worker_id: worker_id.to_string(),
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await?;

        if response.status() == 204 {
            // No work available
            return Ok(None);
        }

        if !response.status().is_success() {
            return Err(format!("API error: {}", response.status()).into());
        }

        let work_packet: WorkPacket = response.json().await?;
        Ok(Some(work_packet))
    }

    async fn update_work_status(&self, status: &WorkStatus) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/work_status", self.base_url);
        
        let response = self.client
            .post(&url)
            .json(status)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(format!("Failed to update work status: {}", response.status()).into());
        }

        Ok(())
    }
}

async fn process_work_packet(
    work_packet: WorkPacket,
    config: &WorkerConfig,
    api_client: &ApiClient,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    eprintln!("🚀 Starting work packet: {}", work_packet.id);
    eprintln!("   Skip: {}, Stop at: {:?}", work_packet.skip, work_packet.stop_at);
    
    let start_time = Instant::now();
    let mut last_status_update = Instant::now();
    
    // Create pipes for joegen -> joerecover communication
    let mut joerecover_cmd = Command::new("./target/release/joerecover")
        .args(&config.joerecover_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let joerecover_stdin = joerecover_cmd.stdin.take().unwrap();
    let joegen_output = BufWriter::new(joerecover_stdin);

    // Generate permutations and feed them to joerecover
    let joegen_thread = thread::spawn({
        let work_packet = work_packet.clone();
        let mut joegen_output = joegen_output;
        move || -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
            run_joegen_with_content(
                &work_packet.token_content,
                work_packet.skip,
                work_packet.stop_at,
                &mut joegen_output,
            ).map_err(|e| format!("Joegen error: {}", e).into())
        }
    });

    // Monitor joerecover output and send status updates
    let mut processed_count = 0u64;
    let mut found_count = 0u64;
    let mut found_results: Vec<FoundResult> = Vec::new();
    
    // We need to read both stdout (for found addresses) and stderr (for progress)
    let stdout = joerecover_cmd.stdout.take();
    let stderr = joerecover_cmd.stderr.take();
    
    // Spawn thread to read stdout for found addresses as structured JSON lines
    let found_results_handle = if let Some(stdout) = stdout {
        Some(thread::spawn(move || -> Vec<FoundResult> {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            let mut found_results_local = Vec::new();
            
            for line in reader.lines() {
                if let Ok(line) = line {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    // Expect JSON line: {"seed_phrase": "...", "address": "..."}
                    match serde_json::from_str::<serde_json::Value>(trimmed) {
                        Ok(val) => {
                            let seed_phrase = val.get("seed_phrase").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let address = val.get("address").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if !seed_phrase.is_empty() && !address.is_empty() {
                                found_results_local.push(FoundResult { seed_phrase, address });
                            }
                        }
                        Err(_) => {
                            // Fallback: if it's not JSON, assume it's just an address
                            if trimmed.len() > 10 {
                                found_results_local.push(FoundResult {
                                    seed_phrase: "".to_string(),
                                    address: trimmed.to_string(),
                                });
                            }
                        }
                    }
                }
            }
            found_results_local
        }))
    } else {
        None
    };
    
    // Read joerecover stderr for progress updates
    if let Some(stderr) = stderr {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr);
        
        for line in reader.lines() {
            let line = line?;
            eprintln!("{}", line); // Forward to our stderr
            
            // Parse progress lines like "[found: 0] processed: 100000 lines (~300 lines/sec)"
            if line.contains("processed:") && line.contains("lines") {
                if let Some(processed_str) = extract_number_after(&line, "processed: ") {
                    if let Ok(processed) = processed_str.parse::<u64>() {
                        processed_count = processed;
                    }
                }
                
                if let Some(found_str) = extract_number_after(&line, "[found: ") {
                    if let Ok(found) = found_str.parse::<u64>() {
                        found_count = found;
                    }
                }
                
                // Send status update every 5 seconds or every 100k processed
                let now = Instant::now();
                if now.duration_since(last_status_update) >= Duration::from_secs(5) || 
                   processed_count % 100_000 == 0 {
                    
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let rate = if elapsed > 0.0 { processed_count as f64 / elapsed } else { 0.0 };
                    
                    let status = WorkStatus {
                        work_id: work_packet.id.clone(),
                        processed: processed_count,
                        found: found_count,
                        rate,
                        completed: false,
                        error: None,
                        found_results: None, // Don't send partial results in progress updates
                    };
                    
                    if let Err(e) = api_client.update_work_status(&status).await {
                        eprintln!("⚠️ Failed to update work status: {}", e);
                    }
                    
                    last_status_update = now;
                }
            }
        }
    }
    
    // Collect found results from stdout thread
    if let Some(handle) = found_results_handle {
        if let Ok(results) = handle.join() {
            found_results = results;
        }
    }

    // Wait for joegen thread to complete
    let joegen_result = joegen_thread.join().map_err(|e| format!("Joegen thread panicked: {:?}", e))?;
    
    // Wait for joerecover to finish
    let joerecover_status = joerecover_cmd.wait()?;
    
    // Send final status update
    let elapsed = start_time.elapsed().as_secs_f64();
    let final_rate = if elapsed > 0.0 { processed_count as f64 / elapsed } else { 0.0 };
    
    let final_status = WorkStatus {
        work_id: work_packet.id.clone(),
        processed: processed_count,
        found: found_count,
        rate: final_rate,
        completed: true,
        error: if joegen_result.is_err() || !joerecover_status.success() {
            Some(format!("Joegen result: {:?}, Joerecover exit: {}", joegen_result, joerecover_status))
        } else {
            None
        },
        found_results: if found_results.is_empty() { None } else { Some(found_results.clone()) },
    };
    
    api_client.update_work_status(&final_status).await?;
    
    eprintln!("✅ Work packet {} completed: {} processed, {} found", 
              work_packet.id, processed_count, found_count);
    
    Ok(())
}

fn extract_number_after(text: &str, pattern: &str) -> Option<String> {
    if let Some(start) = text.find(pattern) {
        let after_pattern = &text[start + pattern.len()..];
        // Find the end of the number (first non-digit, non-comma character)
        let end = after_pattern.find(|c: char| !c.is_ascii_digit() && c != ',')
                              .unwrap_or(after_pattern.len());
        Some(after_pattern[..end].replace(',', ""))
    } else {
        None
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = WorkerConfig::from_args()?;
    let api_client = ApiClient::new(config.api_url.clone());
    
    eprintln!("🔧 Worker started: {}", config.worker_id);
    eprintln!("📡 API URL: {}", config.api_url);
    eprintln!("🔧 Joerecover args: {:?}", config.joerecover_args);
    
    loop {
        match api_client.get_work(&config.worker_id).await {
            Ok(Some(work_packet)) => {
                if let Err(e) = process_work_packet(work_packet, &config, &api_client).await {
                    eprintln!("❌ Error processing work packet: {}", e);
                    // Continue to next work packet instead of crashing
                }
            }
            Ok(None) => {
                // No work available, wait and try again
                eprintln!("💤 No work available, waiting 1 second...");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(e) => {
                eprintln!("❌ Error getting work: {}", e);
                // Wait a bit before retrying to avoid hammering the server
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Mutex;

    // Mock API server for testing
    struct MockApiServer {
        work_packets: Arc<Mutex<Vec<WorkPacket>>>,
        status_updates: Arc<Mutex<Vec<WorkStatus>>>,
        request_count: Arc<AtomicUsize>,
    }

    impl MockApiServer {
        fn new() -> Self {
            Self {
                work_packets: Arc::new(Mutex::new(Vec::new())),
                status_updates: Arc::new(Mutex::new(Vec::new())),
                request_count: Arc::new(AtomicUsize::new(0)),
            }
        }

        async fn add_work_packet(&self, packet: WorkPacket) {
            self.work_packets.lock().await.push(packet);
        }

        async fn get_work(&self, _worker_id: &str) -> Result<Option<WorkPacket>, Box<dyn std::error::Error + Send + Sync>> {
            self.request_count.fetch_add(1, Ordering::SeqCst);
            let mut packets = self.work_packets.lock().await;
            Ok(packets.pop())
        }

        async fn update_work_status(&self, status: &WorkStatus) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            self.status_updates.lock().await.push(status.clone());
            Ok(())
        }

        async fn get_status_updates(&self) -> Vec<WorkStatus> {
            self.status_updates.lock().await.clone()
        }

        fn get_request_count(&self) -> usize {
            self.request_count.load(Ordering::SeqCst)
        }
    }

    #[tokio::test]
    async fn test_extract_number_after() {
        assert_eq!(
            extract_number_after("[found: 5] processed: 100000 lines", "processed: "),
            Some("100000".to_string())
        );
        
        assert_eq!(
            extract_number_after("[found: 42] processed: 1,234,567 lines", "processed: "),
            Some("1234567".to_string())
        );
        
        assert_eq!(
            extract_number_after("[found: 3] processed: 50000 lines", "[found: "),
            Some("3".to_string())
        );
        
        assert_eq!(
            extract_number_after("no match here", "processed: "),
            None
        );
    }

    #[tokio::test]
    async fn test_work_packet_parsing() {
        let json = r#"{
            "id": "work_123",
            "token_content": "word1 word2\nword3 word4",
            "skip": 1000,
            "stop_at": 5000
        }"#;
        
        let packet: WorkPacket = serde_json::from_str(json).unwrap();
        assert_eq!(packet.id, "work_123");
        assert_eq!(packet.skip, 1000);
        assert_eq!(packet.stop_at, Some(5000));
        assert!(packet.token_content.contains("word1"));
    }

    #[tokio::test]
    async fn test_work_status_serialization() {
        let status = WorkStatus {
            work_id: "test_work".to_string(),
            processed: 50000,
            found: 2,
            rate: 300.5,
            completed: false,
            error: None,
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("test_work"));
        assert!(json.contains("50000"));
        assert!(json.contains("300.5"));
    }

    #[tokio::test]
    async fn test_mock_api_server() {
        let mock_server = MockApiServer::new();
        
        // Test no work available initially
        let work = mock_server.get_work("worker_1").await.unwrap();
        assert!(work.is_none());
        assert_eq!(mock_server.get_request_count(), 1);
        
        // Add work packet
        let packet = WorkPacket {
            id: "test_work".to_string(),
            token_content: "test content".to_string(),
            skip: 0,
            stop_at: Some(100),
        };
        mock_server.add_work_packet(packet).await;
        
        // Test work is returned
        let work = mock_server.get_work("worker_1").await.unwrap();
        assert!(work.is_some());
        assert_eq!(work.unwrap().id, "test_work");
        assert_eq!(mock_server.get_request_count(), 2);
        
        // Test status update
        let status = WorkStatus {
            work_id: "test_work".to_string(),
            processed: 50,
            found: 1,
            rate: 100.0,
            completed: false,
            error: None,
        };
        mock_server.update_work_status(&status).await.unwrap();
        
        let updates = mock_server.get_status_updates().await;
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].work_id, "test_work");
        assert_eq!(updates[0].processed, 50);
    }
}
