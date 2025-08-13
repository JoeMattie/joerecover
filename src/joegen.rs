use std::fs;
use std::io::{self, BufWriter, Write};
use std::collections::HashSet;
use joerecover::{Config, generate_permutations, load_bip39_dictionary, process_line, validate_word};

fn format_with_commas(value: u64) -> String {
    let s = value.to_string();
    let mut with_commas = String::new();
    for (i, ch) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            with_commas.push(',');
        }
        with_commas.push(ch);
    }
    with_commas.chars().rev().collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Parse command line arguments
    let args: Vec<String> = std::env::args().collect();
    
    let config = Config::from_args(args.clone()).unwrap_or_else(|err| {
        eprintln!("{}", err);
        std::process::exit(1);
    });
    
        if config.show_help {
        Config::print_help(&args[0]);
        return Ok(());
    }
    
    // Load BIP39 dictionary
    let dictionary = load_bip39_dictionary("bip39_wordlist_en.txt").unwrap_or_else(|e| {
        eprintln!("Warning: Could not load BIP39 dictionary: {}", e);
        eprintln!("Dictionary validation will be skipped.");
        HashSet::new()
    });
    let show_warnings = !config.no_warnings && !dictionary.is_empty();
    
    // Read the token file or use provided content
    let content = if let Some(ref token_content) = config.token_content {
        token_content.clone()
    } else {
        fs::read_to_string(&config.token_file).map_err(|e| {
            format!("Failed to read file '{}': {}", config.token_file, e)
        })?
    };
    let lines: Vec<&str> = content.lines().collect();
 
    // Process each line, expanding rule-based words and validating against dictionary
    let mut word_sets: Vec<Vec<String>> = Vec::new();
    
    for (line_num, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue; // Skip empty lines
        }
        
        // Process the line to expand any rule-based words
        let expanded_words = process_line(line, &dictionary).map_err(|e| {
            format!("Error processing line {}: {}", line_num + 1, e)
        })?;
        
        if expanded_words.is_empty() {
            eprintln!("Warning: Line {} produced no words after processing", line_num + 1);
            continue;
        }
        
        // Validate words against dictionary if enabled
        if show_warnings {
            for word in &expanded_words {
                validate_word(word, &dictionary, true);
            }
        }
        
        word_sets.push(expanded_words);
    }
    
    if word_sets.is_empty() {
        eprintln!("Error: No valid word sets found in '{}'", config.token_file);
        std::process::exit(1);
    }
    
    // If expand-only mode, output the expanded tokens and exit
    if config.expand_only {
        // Project total permutations
        let total_permutations: u64 = word_sets.iter().map(|w| w.len() as u64).product();
        let rate_per_sec: u64 = 300_000; // 300k lines/s
        let total_seconds: u64 = if total_permutations == 0 { 0 } else { (total_permutations + rate_per_sec - 1) / rate_per_sec };
        let days: u64 = total_seconds / 86_400;
        let hours: u64 = (total_seconds % 86_400) / 3_600;

        println!(
            "Projected permutations: {}",
            format_with_commas(total_permutations)
        );
        println!(
            "Estimated processing time @300k lines/s: {} days {} hours",
            days, hours
        );

        for (line_num, words) in word_sets.iter().enumerate() {
            println!("Line {}: {}", line_num + 1, words.join(" "));
        }
        return Ok(());
    }
    
    // Convert to string references for the permutation generator
    let word_sets_refs: Vec<Vec<&str>> = word_sets
        .iter()
        .map(|words| words.iter().map(|s| s.as_str()).collect())
        .collect();
    
    // Calculate total permutations for user info
    let total_permutations: u64 = word_sets_refs.iter().map(|words| words.len() as u64).product();
    
    if config.skip_count > 0 {
        eprintln!("Generating {} permutations (skipping first {})...", total_permutations, config.skip_count);
    } else {
        eprintln!("Generating {} permutations...", total_permutations);
    }
    
    if config.skip_count >= total_permutations {
        eprintln!("Warning: Skip count ({}) is greater than or equal to total permutations ({}). No output will be generated.", config.skip_count, total_permutations);
        return Ok(());
    }
    
    if config.output_to_file {
        // Output to file for better performance with large datasets
        let file = fs::File::create("permutations.txt")?;
        let mut buf_writer = BufWriter::new(file);
        eprintln!("Writing to permutations.txt...");
        let completed_normally = generate_permutations(&word_sets_refs, &mut Vec::new(), &mut buf_writer, config.skip_count, config.stop_at)?;
        buf_writer.flush()?;
        let actual_output = if config.skip_count > 0 { total_permutations - config.skip_count } else { total_permutations };
        eprintln!("Done! {} permutations written to permutations.txt", actual_output);
        if !completed_normally {
            println!("***DONE***");
        }
    } else {
        // Use buffered output to stdout
        let stdout = io::stdout();
        let mut buf_writer = BufWriter::new(stdout.lock());
        let completed_normally = generate_permutations(&word_sets_refs, &mut Vec::new(), &mut buf_writer, config.skip_count, config.stop_at)?;
        buf_writer.flush()?;
        if !completed_normally {
            println!("***DONE***");
        }
    }
    
    Ok(())
}
