use std::io::{self, BufRead, Write};
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::time::Instant;
use std::sync::{Arc, Mutex};
use std::sync::mpsc::sync_channel;
use std::thread;
use bip39::{Mnemonic, Language};
use bitcoin::{
    Network,
    Address,
    PublicKey,
    secp256k1::Secp256k1,
    util::bip32::{ExtendedPrivKey, DerivationPath, ChildNumber},
    hashes::{Hash, hash160},
};
use std::str::FromStr;
use clap::{Arg, Command};
use memmap2::MmapOptions;


const HEADER_LEN: usize = 65536;

// Pre-parsed derivation paths for performance
struct DerivationPaths {
    legacy: DerivationPath,
    segwit_compat: DerivationPath,
    native_segwit: DerivationPath,
}

impl DerivationPaths {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(DerivationPaths {
            legacy: DerivationPath::from_str("m/44'/0'/0'/0")?,
            segwit_compat: DerivationPath::from_str("m/49'/0'/0'/0")?,
            native_segwit: DerivationPath::from_str("m/84'/0'/0'/0")?,
        })
    }
}

struct AddressDb {
    _data: memmap2::Mmap,
    table_len: usize,
    bytes_per_addr: usize,
    hash_bytes: usize,
    hash_mask: usize,
}

// Make AddressDb thread-safe
unsafe impl Send for AddressDb {}
unsafe impl Sync for AddressDb {}

impl AddressDb {
    fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let file = File::open(path)?;
        let mmap = unsafe { MmapOptions::new().map(&file)? };
        
        // Skip magic bytes and read header
        let magic = b"seedrecover address database\r\n";
        if &mmap[0..magic.len()] != magic {
            return Err("Invalid addressdb file format".into());
        }
        
        // Find the end of the header configuration
        let mut config_end = magic.len();
        while config_end < HEADER_LEN && mmap[config_end] != 0 {
            config_end += 1;
        }
        
        // Parse the header configuration
        let header_str = std::str::from_utf8(&mmap[magic.len()..config_end])
            .map_err(|_| "Invalid header encoding")?;
        
        // Parse the Python dict-like header (simplified parsing)
        // Expected format: {'_dbLength': 536870912, '_bytes_per_addr': 8, ...}
        let table_len = if let Some(start) = header_str.find("'_dbLength': ") {
            let start = start + "'_dbLength': ".len();
            let end = header_str[start..].find(',').unwrap_or(header_str.len() - start) + start;
            header_str[start..end].trim().parse::<usize>()
                .map_err(|_| "Invalid _dbLength in header")?
        } else {
            return Err("_dbLength not found in header".into());
        };
        
        let bytes_per_addr = if let Some(start) = header_str.find("'_bytes_per_addr': ") {
            let start = start + "'_bytes_per_addr': ".len();
            let end = header_str[start..].find(',').unwrap_or(header_str.len() - start) + start;
            header_str[start..end].trim().parse::<usize>()
                .map_err(|_| "Invalid _bytes_per_addr in header")?
        } else {
            8 // default value
        };
        
        let hash_bytes = (table_len.trailing_zeros() + 7) / 8;
        let hash_mask = table_len - 1;
        
        Ok(AddressDb {
            _data: mmap,
            table_len,
            bytes_per_addr,
            hash_bytes: hash_bytes as usize,
            hash_mask,
        })
    }
    
    fn contains(&self, hash160: &[u8]) -> bool {
        if hash160.len() != 20 {
            return false;
        }
        
        // Extract hash bytes for table lookup
        let hash_start = 20 - self.hash_bytes;
        let mut hash_val = 0usize;
        for &byte in &hash160[hash_start..] {
            hash_val = (hash_val << 8) | byte as usize;
        }
        hash_val &= self.hash_mask;
        
        // Calculate position in the data table (skip header)
        let mut pos = HEADER_LEN + hash_val * self.bytes_per_addr;
        let null_addr = vec![0u8; self.bytes_per_addr];
        
        // Linear probing
        loop {
            let stored_addr = &self._data[pos..pos + self.bytes_per_addr];
            if stored_addr == null_addr {
                return false; // Empty slot, address not found
            }
            
            // Compare the stored address bytes with our address
            let addr_bytes = &hash160[20 - self.bytes_per_addr - self.hash_bytes..20 - self.hash_bytes];
            if stored_addr == addr_bytes {
                return true; // Found!
            }
            
            // Linear probe to next position
            pos += self.bytes_per_addr;
            if pos >= HEADER_LEN + self.table_len * self.bytes_per_addr {
                pos = HEADER_LEN; // Wrap around
            }
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matches = Command::new("joerecover")
        .about("Generate Bitcoin addresses from BIP39 seed phrases and optionally check against addressdb")
        .arg(Arg::new("addressdb")
            .long("addressdb")
            .value_name("FILE")
            .help("Path to addressdb file for lookups")
            .required(false))
        .arg(Arg::new("threads")
            .long("threads")
            .short('t')
            .value_name("NUM")
            .help("Number of worker threads")
            .default_value("8"))

        .get_matches();

    let addressdb = if let Some(db_path) = matches.get_one::<String>("addressdb") {
        Some(Arc::new(AddressDb::load_from_file(db_path)?))
    } else {
        None
    };

    let num_threads: usize = matches.get_one::<String>("threads")
        .unwrap()
        .parse()
        .unwrap_or(8);
    


    // Pre-parse derivation paths
    let derivation_paths = Arc::new(DerivationPaths::new()?);

    // Create bounded channels for work distribution with backpressure
    let (phrase_sender, phrase_receiver) = sync_channel::<String>(num_threads * 2);
    let phrase_receiver = Arc::new(Mutex::new(phrase_receiver));
    let (result_sender, result_receiver) = sync_channel::<String>(1000);
    let (found_phrase_sender, found_phrase_receiver) = sync_channel::<String>(100);
    
    // Shared progress counter, found counter, and total count
    let processed_count = Arc::new(Mutex::new(0u64));
    let found_count = Arc::new(Mutex::new(0u64));
    let total_count = Arc::new(Mutex::new(None::<u64>));
    let start_time = Instant::now();



    // Spawn worker threads
    let mut workers = Vec::new();
    for _ in 0..num_threads {
        let receiver = phrase_receiver.clone();
        let sender = result_sender.clone();
        let found_sender = found_phrase_sender.clone();
        let db = addressdb.clone();
        let paths = derivation_paths.clone();
        let counter = processed_count.clone();
        let found_counter = found_count.clone();
        let total_counter = total_count.clone();
        
        let worker = thread::spawn(move || {
            // Each thread gets its own secp context for better performance
            let secp = Secp256k1::new();
            
            loop {
                let phrase = {
                    let rx = receiver.lock().unwrap();
                    rx.recv()
                };
                
                match phrase {
                    Ok(phrase) => {
                        let db_ref = db.as_ref().map(|arc| arc.as_ref());
                        let mut found_any = false;
                        
                        // Process directly without accumulating addresses in memory
                        if let Ok(()) = process_seed_phrase_streaming(&phrase, db_ref, &paths, &secp, &sender, &mut found_any) {
                            if found_any {
                                // Found addresses! Save the seed phrase and increment counter
                                if let Ok(()) = found_sender.try_send(phrase.clone()) {
                                    let mut found_count = found_counter.lock().unwrap();
                                    *found_count += 1;
                                } // If channel is full, skip saving this duplicate (memory pressure relief)
                            }
                        }
                        
                        // Update progress counter
                        let mut count = counter.lock().unwrap();
                        *count += 1;
                        if *count % 100_000 == 0 {
                            let elapsed = start_time.elapsed();
                            let rate = *count as f64 / elapsed.as_secs_f64();
                            let found = *found_counter.lock().unwrap();
                            let total = *total_counter.lock().unwrap();
                            
                            if let Some(total_count) = total {
                                let percentage = (*count as f64 / total_count as f64) * 100.0;
                                let eta_seconds = if rate > 0.0 {
                                    (total_count - *count) as f64 / rate
                                } else {
                                    0.0
                                };
                                let eta_hours = eta_seconds / 3600.0;
                                eprintln!("[found: {}] processed: {} lines ({:.1}%) (~{:.0} lines/sec) ETA: {:.1}h - Last: {}", 
                                    found, *count, percentage, rate, eta_hours, phrase.trim());
                            } else {
                                eprintln!("[found: {}] processed: {} lines (~{:.0} lines/sec) - Last: {}", 
                                    found, *count, rate, phrase.trim());
                            }
                            io::stderr().flush().unwrap();
                        }
                    }
                    Err(_) => break, // Channel closed
                }
            }
        });
        workers.push(worker);
    }

    // Keep references for cleanup
    drop(result_sender);
    drop(found_phrase_sender);

    // Spawn output thread
    let output_thread = thread::spawn(move || {
        while let Ok(address) = result_receiver.recv() {
            println!("{}", address);
        }
    });

    // Spawn thread to write found seed phrases to file
    let found_writer_thread = thread::spawn(move || {
        let mut found_file = match OpenOptions::new()
            .create(true)
            .append(true)
            .open("found.txt") {
            Ok(file) => file,
            Err(e) => {
                eprintln!("Error opening found.txt: {}", e);
                return;
            }
        };

        while let Ok(phrase) = found_phrase_receiver.recv() {
            if let Err(e) = writeln!(found_file, "{}", phrase) {
                eprintln!("Error writing to found.txt: {}", e);
            } else {
                if let Err(e) = found_file.flush() {
                    eprintln!("Error flushing found.txt: {}", e);
                }
            }
            // Explicit drop to free memory immediately
            drop(phrase);
        }
    });

    // Read input and distribute work
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    
    // Check first line for total count
    if let Some(Ok(first_line)) = lines.next() {
        if first_line.starts_with("Generating ") && first_line.contains(" permutations") {
            // Parse the number from "Generating 73610035200 permutations..."
            if let Some(start) = first_line.find("Generating ") {
                let after_generating = &first_line[start + 11..]; // "11" is length of "Generating "
                if let Some(end) = after_generating.find(" permutations") {
                    let number_str = &after_generating[..end];
                    if let Ok(total) = number_str.parse::<u64>() {
                        *total_count.lock().unwrap() = Some(total);
                        eprintln!("Detected {} total permutations to process", total);
                        io::stderr().flush().unwrap();
                    }
                }
            }
        } else {
            // First line is actually a phrase, process it
            if !first_line.trim().is_empty() {
                if phrase_sender.send(first_line).is_err() {
                    return Ok(()); // Workers have stopped
                }
            }
        }
    }

    // Process remaining lines
    for line in lines {
        match line {
            Ok(phrase) => {
                if !phrase.trim().is_empty() {
                    if phrase_sender.send(phrase).is_err() {
                        break; // Workers have stopped
                    }
                }
            }
            Err(_) => break,
        }
    }

    // Signal workers to stop
    drop(phrase_sender);

    // Wait for all workers to finish
    for worker in workers {
        let _ = worker.join();
    }

    // Wait for output thread to finish
    let _ = output_thread.join();

    // Wait for found writer thread to finish
    let _ = found_writer_thread.join();

    Ok(())
}

// Memory-efficient streaming version
fn process_seed_phrase_streaming(
    phrase: &str, 
    addressdb: Option<&AddressDb>, 
    paths: &DerivationPaths,
    secp: &Secp256k1<bitcoin::secp256k1::All>,
    sender: &std::sync::mpsc::SyncSender<String>,
    found_any: &mut bool
) -> Result<(), Box<dyn std::error::Error>> {
    // Quick word count check before expensive mnemonic parsing
    let word_count = phrase.trim().split_whitespace().count();
    if word_count != 12 && word_count != 15 && word_count != 18 && word_count != 21 && word_count != 24 {
        return Err("Invalid word count".into());
    }
    
    // Parse and validate mnemonic (includes checksum verification)
    let mnemonic = Mnemonic::parse_in_normalized(Language::English, phrase)?;
    let seed = mnemonic.to_seed("");
    let master_key = ExtendedPrivKey::new_master(Network::Bitcoin, &seed)?;
    
    let derivation_paths = [&paths.legacy, &paths.segwit_compat, &paths.native_segwit];
    
    // for i in 0..10 {
        for (path_idx, base_path) in derivation_paths.iter().enumerate() {
            // let child_path = base_path.child(ChildNumber::from_normal_idx(i)?);
            let child_path = base_path.child(ChildNumber::from_normal_idx(0)?);
            let derived_key = master_key.derive_priv(secp, &child_path)?;
            let public_key = PublicKey::from_private_key(secp, &derived_key.to_priv());
            
            let address = match path_idx {
                0 => Address::p2pkh(&public_key, Network::Bitcoin),
                1 => Address::p2shwpkh(&public_key, Network::Bitcoin)?,
                2 => Address::p2wpkh(&public_key, Network::Bitcoin)?,
                _ => return Err("Invalid derivation path index".into()),
            };
            
            if let Some(db) = addressdb {
                let found = match path_idx {
                    0 => {
                        // P2PKH: Check hash160 of public key
                        let hash160 = hash160::Hash::hash(&public_key.to_bytes()).as_ref().to_vec();
                        db.contains(&hash160)
                    },
                    1 => {
                        // P2SH-P2WPKH: Check hash160 of the redeem script
                        let pubkey_hash = hash160::Hash::hash(&public_key.to_bytes());
                        let redeem_script = [&[0x00, 0x14][..], pubkey_hash.as_ref()].concat();
                        let script_hash = hash160::Hash::hash(&redeem_script).as_ref().to_vec();
                        db.contains(&script_hash)
                    },
                    2 => {
                        // P2WPKH: Check hash160 of public key (same as P2PKH)
                        let hash160 = hash160::Hash::hash(&public_key.to_bytes()).as_ref().to_vec();
                        db.contains(&hash160)
                    },
                    _ => false,
                };
                
                if found {
                    *found_any = true;
                    // Send immediately without accumulating
                    let _ = sender.try_send(address.to_string());
                }
            } else {
                *found_any = true;
                // Send immediately without accumulating
                let _ = sender.try_send(address.to_string());
            }
        }
    // }
    Ok(())
}

