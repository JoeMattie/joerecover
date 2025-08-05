# Bitcoin Address Recovery Tool

A Rust tool that takes BIP39 seed phrases as input and generates Bitcoin addresses using the three standard derivation paths.

## Features

- Processes BIP39 seed phrases from stdin (one phrase per line)
- Generates the first 10 Bitcoin addresses for each phrase
- Uses three standard derivation paths:
  - `m/44'/0'/0'/0` - BIP44 Legacy (P2PKH)
  - `m/49'/0'/0'/0` - BIP49 Segwit Compatibility (P2SH-P2WPKH)
  - `m/84'/0'/0'/0` - BIP84 Native Segwit (P2WPKH)
- **AddressDB support**: Optional filtering to only output addresses found in a btcrecover-style addressdb file
- **Progress reporting**: Shows processing rate every 100,000 lines with the current seed phrase
- **Multithreading**: Configurable worker threads for maximum performance (default: 8 threads)
- **Found seed phrase logging**: Automatically writes successful seed phrases to `found.txt`

## Usage

### Basic Usage
```bash
# Run the program and type seed phrases
cargo run

# Or use the built binary
./target/release/joerecover
```

### With Input File
```bash
# From a file containing seed phrases (one per line)
cargo run < seed_phrases.txt

# Or with the built binary
./target/release/joerecover < seed_phrases.txt
```

### With AddressDB Filtering
```bash
# Only output addresses found in the addressdb
cargo run -- --addressdb /path/to/btc-addresses.db < seed_phrases.txt

# Or with the built binary
./target/release/joerecover --addressdb /path/to/btc-addresses.db < seed_phrases.txt
```

### High-Performance Mode
```bash
# Use more threads for maximum speed
./target/release/joerecover --threads 16 --addressdb /path/to/btc-addresses.db < seed_phrases.txt

# Test with joegen word permutations (with percentage/ETA tracking)
../joegen/target/release/word-permutations 2>&1 | ./target/release/joerecover --addressdb ./addresses-BTC-2011-to-2021-03-31.db --threads 8
```

### Example Input
```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
legal winner thank year wave sausage worth useful legal winner thank yellow
```

## Example Output
The tool outputs addresses as a continuous stream, one per line:
```
1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA
1Ak8PffB2meyfYnbXZR9EGfLfFZVpzJvQP
1MNF5RSaabFwcbtJirJwKnDytsXXEsVsNb
...
37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf
3LtMnn87fqUeHBUG414p9CWwnoV6E2pNKT
3B4cvWGR8X6Xs8nvTxVUoMJV77E4f7oaia
...
bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu
bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g
bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z
...
```

The addresses are output in order: first 10 Legacy (P2PKH), then 10 Segwit Compatibility (P2SH-P2WPKH), then 10 Native Segwit (P2WPKH) addresses.

## AddressDB Integration

When used with the `--addressdb` option, the tool will:

1. Load a btcrecover-style addressdb file (created using `addressset.py`)
2. For each generated address, check if its hash160 exists in the database
3. Only output addresses that are found in the database

This is useful for:
- **Recovery scenarios**: Only showing addresses that have been used on the blockchain
- **Performance**: Filtering millions of generated addresses to only relevant ones
- **Privacy**: Not revealing all possible addresses from a seed phrase

### Creating AddressDB Files

AddressDB files are typically created using btcrecover's `addressset.py`. For example:
```bash
python addressset.py --datadir /path/to/bitcoin/blocks --dbfilename btc-addresses.db
```

The tool expects the same binary format used by btcrecover's AddressSet implementation.

## Progress Reporting

When processing large files, the tool will output progress information to stderr every 100,000 lines:

**Note**: To get percentage and ETA tracking with joegen, use `2>&1` to redirect stderr to stdout so the tool can read the total count:

```
[found: 2] processed: 100000 lines (10.0%) (~1250 lines/sec) ETA: 2.1h - Last: abandon abandon abandon...
[found: 5] processed: 200000 lines (20.0%) (~1300 lines/sec) ETA: 1.7h - Last: legal winner thank year...
```

This helps track progress and shows:
- Number of seed phrases found so far (when using `--addressdb`)
- Number of lines processed
- Completion percentage (when first line contains total count)
- Approximate processing rate (lines per second)
- Estimated time to completion (when total count is available)
- The actual seed phrase that was just processed

### Usage with joegen
```bash
# Basic usage (no percentage tracking)
../joegen/target/release/word-permutations | ./target/release/joerecover --addressdb addresses.db

# With percentage and ETA tracking
../joegen/target/release/word-permutations 2>&1 | ./target/release/joerecover --addressdb addresses.db
```

The progress messages go to stderr, so they won't interfere with the address output on stdout.

## Found Seed Phrase Logging

When using AddressDB filtering (`--addressdb`), any seed phrase that generates addresses found in the database will be automatically written to `found.txt` in the current directory. This file is appended to on each run, so previous results are preserved.

**Features:**
- Immediate writing and flushing to disk when found
- Append mode preserves previous discoveries
- Thread-safe writing from multiple worker threads
- One seed phrase per line format

**Example `found.txt` content:**
```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
legal winner thank year wave sausage worth useful legal winner thank yellow
```

## Performance

The multithreaded version achieves excellent performance:

- **~242,000 lines/sec** on modern hardware with 8 threads
- **Memory-efficient**: Constant memory footprint using bounded channels and streaming processing
- **Early validation**: Fast checksum verification to skip invalid phrases before expensive operations
- Each worker thread has its own secp256k1 context for optimal performance
- Pre-parsed derivation paths eliminate repeated parsing overhead
- Memory-mapped addressdb files for fast lookups
- Thread-safe progress reporting with backpressure control

### Performance Tips

1. **Adjust thread count**: Use `--threads` to match your CPU cores
2. **SSD storage**: Use SSD for addressdb files for faster I/O
3. **Memory**: Ensure sufficient RAM for large addressdb files
4. **CPU**: More cores = better performance for this workload

## Build Requirements

- Rust 1.41+
- Cargo

## Dependencies

- `bip39` - BIP39 mnemonic processing
- `bitcoin` - Bitcoin address generation
- `secp256k1` - Cryptographic operations
- `hex` - Hexadecimal encoding/decoding
- `clap` - Command-line argument parsing
- `memmap2` - Memory-mapped file I/O for addressdb
- `ripemd` & `sha2` - Hash functions for address generation

## Security Warning

**This tool is for educational and recovery purposes only. Never use it with real seed phrases on compromised systems.**