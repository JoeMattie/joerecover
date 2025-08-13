// Re-export all functions from joegen_lib for easy access
pub use self::joegen_lib::*;

// Include the joegen_lib module
pub mod joegen_lib {
    use std::io::Write;
    use std::collections::HashSet;
    use std::fs;

    /// Load BIP39 dictionary from file
    pub fn load_bip39_dictionary(dict_path: &str) -> Result<HashSet<String>, Box<dyn std::error::Error>> {
        let content = fs::read_to_string(dict_path)?;
        let words: HashSet<String> = content
            .lines()
            .map(|line| line.trim().to_lowercase())
            .filter(|line| !line.is_empty())
            .collect();
        Ok(words)
    }

    /// Check if word is in dictionary and show warning if not
    pub fn validate_word(word: &str, dictionary: &HashSet<String>, show_warnings: bool) -> bool {
        let is_valid = dictionary.contains(&word.to_lowercase());
        if !is_valid && show_warnings {
            eprintln!("Warning: '{}' is not in the BIP39 dictionary", word);
        }
        is_valid
    }

    /// Parse rules from bracketed expressions like [len:4 first:b last:y]
    #[derive(Debug, Clone)]
    pub struct WordRule {
        pub min_length: Option<usize>,
        pub max_length: Option<usize>,
        pub not_min_length: Option<usize>,
        pub not_max_length: Option<usize>,
        pub first_char: Option<String>,
        pub last_char: Option<String>,
        pub last_substring: Option<String>,
        pub not_first_chars: Vec<String>,
        pub not_last_chars: Vec<String>,
        pub not_last_substrings: Vec<String>,
        pub has_substrings: Vec<String>,
        pub not_has_substrings: Vec<String>,
    }

    impl WordRule {
        pub fn new() -> Self {
            Self {
                min_length: None,
                max_length: None,
                not_min_length: None,
                not_max_length: None,
                first_char: None,
                last_char: None,
                last_substring: None,
                not_first_chars: Vec::new(),
                not_last_chars: Vec::new(),
                not_last_substrings: Vec::new(),
                has_substrings: Vec::new(),
                not_has_substrings: Vec::new(),
            }
        }

        pub fn matches(&self, word: &str) -> bool {
            let word_lower = word.to_lowercase();
            
            // Check positive length constraints
            if let Some(min_len) = self.min_length {
                if word.len() < min_len {
                    return false;
                }
            }
            if let Some(max_len) = self.max_length {
                if word.len() > max_len {
                    return false;
                }
            }
            
            // Check negative length constraints
            // For !len:4, both not_min_length and not_max_length are set to 4
            // We want to exclude words that are exactly 4 characters
            if let (Some(not_min_len), Some(not_max_len)) = (self.not_min_length, self.not_max_length) {
                if not_min_len == not_max_len {
                    // Single length negation like !len:4 - exclude exact length
                    if word.len() == not_min_len {
                        return false;
                    }
                } else {
                    // Range negation like !len:4-6 - exclude words in this range
                    if word.len() >= not_min_len && word.len() <= not_max_len {
                        return false;
                    }
                }
            }
            
            // Check positive first character
            if let Some(ref first) = self.first_char {
                if !word_lower.starts_with(first) {
                    return false;
                }
            }
            
            // Check negative first characters
            for not_first in &self.not_first_chars {
                if word_lower.starts_with(not_first) {
                    return false;
                }
            }
            
            // Check positive last character
            if let Some(ref last) = self.last_char {
                if !word_lower.ends_with(last) {
                    return false;
                }
            }
            
            // Check negative last characters
            for not_last in &self.not_last_chars {
                if word_lower.ends_with(not_last) {
                    return false;
                }
            }
            
            // Check positive last substring (for things like "at")
            if let Some(ref last_sub) = self.last_substring {
                if !word_lower.ends_with(last_sub) {
                    return false;
                }
            }
            
            // Check negative last substrings
            for not_last_sub in &self.not_last_substrings {
                if word_lower.ends_with(not_last_sub) {
                    return false;
                }
            }
            
            // Check has substrings
            for has_sub in &self.has_substrings {
                if !word_lower.contains(has_sub) {
                    return false;
                }
            }
            
            // Check not has substrings
            for not_has_sub in &self.not_has_substrings {
                if word_lower.contains(not_has_sub) {
                    return false;
                }
            }
            
            true
        }
    }

    pub fn parse_rule(rule_text: &str) -> Result<WordRule, String> {
        let mut rule = WordRule::new();
        
        // Remove brackets and split by spaces
        let rule_text = rule_text.trim_start_matches('[').trim_end_matches(']');
        let parts: Vec<&str> = rule_text.split_whitespace().collect();
        
        for part in parts {
            if part.starts_with("!len:") {
                let len_spec = &part[5..];
                if len_spec.contains(',') {
                    // Handle comma-separated lengths like "!len:4,6"
                    let lengths: Result<Vec<usize>, _> = len_spec.split(',').map(|s| s.parse()).collect();
                    match lengths {
                        Ok(lens) if lens.len() == 2 => {
                            rule.not_min_length = Some(lens[0].min(lens[1]));
                            rule.not_max_length = Some(lens[0].max(lens[1]));
                        }
                        _ => return Err(format!("Invalid length specification: {}", len_spec)),
                    }
                } else if len_spec.contains('-') {
                    // Handle range like "!len:4-6" or "!len:6-4"
                    let range_parts: Vec<&str> = len_spec.split('-').collect();
                    if range_parts.len() == 2 {
                        let start: usize = range_parts[0].parse().map_err(|_| format!("Invalid length: {}", range_parts[0]))?;
                        let end: usize = range_parts[1].parse().map_err(|_| format!("Invalid length: {}", range_parts[1]))?;
                        rule.not_min_length = Some(start.min(end));
                        rule.not_max_length = Some(start.max(end));
                    } else {
                        return Err(format!("Invalid length range: {}", len_spec));
                    }
                } else {
                    // Single length like "!len:4"
                    let length: usize = len_spec.parse().map_err(|_| format!("Invalid length: {}", len_spec))?;
                    rule.not_min_length = Some(length);
                    rule.not_max_length = Some(length);
                }
            } else if part.starts_with("len:") {
                let len_spec = &part[4..];
                if len_spec.contains(',') {
                    // Handle comma-separated lengths like "len:4,6"
                    let lengths: Result<Vec<usize>, _> = len_spec.split(',').map(|s| s.parse()).collect();
                    match lengths {
                        Ok(lens) if lens.len() == 2 => {
                            rule.min_length = Some(lens[0].min(lens[1]));
                            rule.max_length = Some(lens[0].max(lens[1]));
                        }
                        _ => return Err(format!("Invalid length specification: {}", len_spec)),
                    }
                } else if len_spec.contains('-') {
                    // Handle range like "len:4-6" or "len:6-4"
                    let range_parts: Vec<&str> = len_spec.split('-').collect();
                    if range_parts.len() == 2 {
                        let start: usize = range_parts[0].parse().map_err(|_| format!("Invalid length: {}", range_parts[0]))?;
                        let end: usize = range_parts[1].parse().map_err(|_| format!("Invalid length: {}", range_parts[1]))?;
                        rule.min_length = Some(start.min(end));
                        rule.max_length = Some(start.max(end));
                    } else {
                        return Err(format!("Invalid length range: {}", len_spec));
                    }
                } else {
                    // Single length like "len:4"
                    let length: usize = len_spec.parse().map_err(|_| format!("Invalid length: {}", len_spec))?;
                    rule.min_length = Some(length);
                    rule.max_length = Some(length);
                }
            } else if part.starts_with("!first:") {
                rule.not_first_chars.push(part[7..].to_lowercase());
            } else if part.starts_with("first:") {
                rule.first_char = Some(part[6..].to_lowercase());
            } else if part.starts_with("!last:") {
                let last_spec = &part[6..];
                if last_spec.len() == 1 {
                    rule.not_last_chars.push(last_spec.to_lowercase());
                } else {
                    rule.not_last_substrings.push(last_spec.to_lowercase());
                }
            } else if part.starts_with("last:") {
                let last_spec = &part[5..];
                if last_spec.len() == 1 {
                    rule.last_char = Some(last_spec.to_lowercase());
                } else {
                    rule.last_substring = Some(last_spec.to_lowercase());
                }
            } else if part.starts_with("has:") {
                rule.has_substrings.push(part[4..].to_lowercase());
            } else if part.starts_with("!has:") {
                rule.not_has_substrings.push(part[5..].to_lowercase());
            } else if part == "all" {
                // [all] rule - no additional constraints, matches all words
                // This is handled by having no constraints set
            } else {
                return Err(format!("Unknown rule: {}", part));
            }
        }
        
        Ok(rule)
    }

    /// Apply rule to dictionary and return matching words
    pub fn apply_rule_to_dictionary(rule: &WordRule, dictionary: &HashSet<String>, reverse_order: bool) -> Vec<String> {
        let mut matching_words: Vec<String> = dictionary
            .iter()
            .filter(|word| rule.matches(word))
            .cloned()
            .collect();
        
        // Sort by length then alphabetically
        matching_words.sort_by(|a, b| {
            let len_cmp = a.len().cmp(&b.len());
            if len_cmp == std::cmp::Ordering::Equal {
                a.cmp(b)
            } else if reverse_order {
                len_cmp.reverse()
            } else {
                len_cmp
            }
        });
        
        matching_words
    }

    /// Generate all permutations of words from the given word sets
    pub fn generate_permutations<'a>(
        word_sets: &[Vec<&'a str>],
        current_permutation: &mut Vec<&'a str>,
        output: &mut dyn Write,
        skip_count: u64,
        stop_at: Option<u64>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        if skip_count == 0 && stop_at.is_none() {
            // No skipping or stopping needed, use the simple recursive approach
            let mut counter = 0u64;
            generate_permutations_impl(word_sets, current_permutation, output, skip_count, &mut counter, stop_at)
        } else {
            // Use optimized approach when skipping or stopping
            generate_permutations_with_skip_and_stop(word_sets, output, skip_count, stop_at)
        }
    }

    fn generate_permutations_impl<'a>(
        word_sets: &[Vec<&'a str>],
        current_permutation: &mut Vec<&'a str>,
        output: &mut dyn Write,
        skip_count: u64,
        counter: &mut u64,
        stop_at: Option<u64>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        if current_permutation.len() == word_sets.len() {
            // We have a complete permutation
            if *counter >= skip_count {
                // Check if we should stop before outputting
                if let Some(stop_limit) = stop_at {
                    if *counter - skip_count >= stop_limit {
                        return Ok(false); // Signal to stop
                    }
                }
                
                // Output it efficiently if we're past the skip count
                let mut line = String::with_capacity(200); // Estimate average line length
                for (i, word) in current_permutation.iter().enumerate() {
                    if i > 0 {
                        line.push(' ');
                    }
                    line.push_str(word);
                }
                writeln!(output, "{}", line)?;
            }
            *counter += 1;
            return Ok(true);
        }
        
        let current_index = current_permutation.len();
        let current_word_set = &word_sets[current_index];
        
        // Try each word from the current set
        for &word in current_word_set {
            current_permutation.push(word);
            let should_continue = generate_permutations_impl(word_sets, current_permutation, output, skip_count, counter, stop_at)?;
            current_permutation.pop();
            
            if !should_continue {
                return Ok(false); // Stop processing
            }
        }
        
        Ok(true)
    }

    /// Generate permutations starting from a specific skip position using mathematical approach
    fn generate_permutations_with_skip_and_stop<'a>(
        word_sets: &[Vec<&'a str>],
        output: &mut dyn Write,
        skip_count: u64,
        stop_at: Option<u64>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        if word_sets.is_empty() {
            return Ok(true);
        }
        
        // Calculate the sizes for each position for mathematical indexing
        let set_sizes: Vec<u64> = word_sets.iter().map(|set| set.len() as u64).collect();
        
        // Calculate total permutations
        let total_permutations: u64 = set_sizes.iter().product();
        
        // Calculate the end index based on stop_at
        let end_index = match stop_at {
            Some(stop_limit) => std::cmp::min(skip_count + stop_limit, total_permutations),
            None => total_permutations,
        };
        
        // Generate permutations starting from skip_count
        for permutation_index in skip_count..end_index {
            let permutation = index_to_permutation(permutation_index, &set_sizes, word_sets);
            
            let mut line = String::with_capacity(200);
            for (i, word) in permutation.iter().enumerate() {
                if i > 0 {
                    line.push(' ');
                }
                line.push_str(word);
            }
            writeln!(output, "{}", line)?;
        }
        
        // Return false if we stopped early due to stop_at limit
        Ok(stop_at.is_none() || skip_count + stop_at.unwrap() >= total_permutations)
    }

    /// Convert a permutation index to the actual permutation
    fn index_to_permutation<'a>(
        mut index: u64,
        set_sizes: &[u64],
        word_sets: &[Vec<&'a str>],
    ) -> Vec<&'a str> {
        let mut result = Vec::with_capacity(set_sizes.len());
        
        // Calculate the "radix" for each position (how many permutations each choice represents)
        let mut radixes = vec![1u64; set_sizes.len()];
        for i in (0..set_sizes.len().saturating_sub(1)).rev() {
            radixes[i] = radixes[i + 1] * set_sizes[i + 1];
        }
        
        // Convert index to permutation using mixed-radix number system
        for i in 0..set_sizes.len() {
            let choice_index = (index / radixes[i]) as usize;
            result.push(word_sets[i][choice_index]);
            index %= radixes[i];
        }
        
        result
    }

    /// Process a line and expand any rule-based words
    pub fn process_line(line: &str, dictionary: &HashSet<String>) -> Result<Vec<String>, String> {
        let mut result = Vec::new();
        let mut current_token = String::new();
        let mut in_brackets = false;
        
        for ch in line.chars() {
            if ch == '[' {
                // Start of a rule
                if !current_token.trim().is_empty() {
                    result.push(current_token.trim().to_string());
                }
                current_token = "[".to_string();
                in_brackets = true;
            } else if ch == ']' && in_brackets {
                // End of a rule
                current_token.push(ch);
                let rule = parse_rule(&current_token)?;
                let reverse_order = detect_reverse_order(&current_token);
                let matching_words = apply_rule_to_dictionary(&rule, dictionary, reverse_order);
                result.extend(matching_words);
                current_token.clear();
                in_brackets = false;
            } else if ch.is_whitespace() && !in_brackets {
                // Space outside brackets - end current token
                if !current_token.trim().is_empty() {
                    result.push(current_token.trim().to_string());
                }
                current_token.clear();
            } else {
                // Regular character or space inside brackets
                current_token.push(ch);
            }
        }
        
        // Handle final token
        if !current_token.trim().is_empty() {
            if in_brackets {
                return Err("Unclosed bracket in rule".to_string());
            }
            result.push(current_token.trim().to_string());
        }
        
        // Deduplicate words while preserving order of first occurrence
        let mut seen = HashSet::new();
        let mut deduplicated = Vec::new();
        for word in result {
            if seen.insert(word.clone()) {
                deduplicated.push(word);
            }
        }
        
        Ok(deduplicated)
    }

    /// Detect if order should be reversed based on rule format
    pub fn detect_reverse_order(rule_text: &str) -> bool {
        // Look for patterns like "len:6-4" where the larger number comes first
        // Don't apply to negated rules
        // Remove brackets first to handle input like "[len:6-4]"
        let clean_rule = rule_text.trim_start_matches('[').trim_end_matches(']');
        
        if let Some(len_part) = clean_rule.split_whitespace().find(|s| s.starts_with("len:") && !s.starts_with("!len:")) {
            let len_spec = &len_part[4..];
            if len_spec.contains('-') {
                let range_parts: Vec<&str> = len_spec.split('-').collect();
                if range_parts.len() == 2 {
                    if let (Ok(start), Ok(end)) = (range_parts[0].parse::<usize>(), range_parts[1].parse::<usize>()) {
                        return start > end;
                    }
                }
            }
        }
        false
    }

    /// Parse command line arguments and return configuration
    pub struct Config {
        pub token_file: String,
        pub token_content: Option<String>, // Direct token content instead of file
        pub output_to_file: bool,
        pub skip_count: u64,
        pub stop_at: Option<u64>,
        pub show_help: bool,
        pub no_warnings: bool,
        pub expand_only: bool,
    }

            impl Config {
        pub fn from_args(args: Vec<String>) -> Result<Config, String> {
            let mut token_file = "tokens.txt".to_string();
            let token_content: Option<String> = None;
            let mut output_to_file = false;
            let mut skip_count: u64 = 0;
            let mut stop_at: Option<u64> = None;
            let mut show_help = false;
            let mut no_warnings = false;
            let mut expand_only = false;
            
            // Parse arguments
            let mut i = 1;
            while i < args.len() {
                let arg = &args[i];
                if arg == "--file" {
                    output_to_file = true;
                } else if arg == "--no-warnings" {
                    no_warnings = true;
                } else if arg == "--expand" {
                    expand_only = true;
                } else if arg == "--skip" {
                    if i + 1 >= args.len() {
                        return Err("Error: --skip requires a number argument".to_string());
                    }
                    skip_count = args[i + 1].parse().map_err(|_| {
                        "Error: --skip argument must be a valid number".to_string()
                    })?;
                    i += 1; // Skip the next argument since we consumed it
                } else if arg == "--stop-at" {
                    if i + 1 >= args.len() {
                        return Err("Error: --stop-at requires a number argument".to_string());
                    }
                    stop_at = Some(args[i + 1].parse().map_err(|_| {
                        "Error: --stop-at argument must be a valid number".to_string()
                    })?);
                    i += 1; // Skip the next argument since we consumed it
                } else if arg == "--help" || arg == "-h" {
                    show_help = true;
                } else if !arg.starts_with('-') && token_file == "tokens.txt" {
                    // First non-flag argument is the token file (only if we haven't set it yet)
                    token_file = arg.clone();
                }
                i += 1;
            }
            
            Ok(Config {
                token_file,
                token_content,
                output_to_file,
                skip_count,
                stop_at,
                show_help,
                no_warnings,
                expand_only,
            })
        }
        
        /// Create a Config with direct token content instead of reading from file
        pub fn from_content(
            token_content: String,
            skip_count: u64,
            stop_at: Option<u64>,
        ) -> Config {
            Config {
                token_file: String::new(),
                token_content: Some(token_content),
                output_to_file: false,
                skip_count,
                stop_at,
                show_help: false,
                no_warnings: true, // Suppress warnings when using directly
                expand_only: false,
            }
        }
        
        pub fn print_help(program_name: &str) {
            println!("Usage: {} [token_file] [--file] [--skip N] [--stop-at N] [--no-warnings] [--expand]", program_name);
            println!();
            println!("Arguments:");
            println!("  token_file    : Path to the file containing the words to be permuted (default: tokens.txt)");
            println!("  --file        : Output to permutations.txt instead of stdout");
            println!("  --skip N      : Skip the first N permutations");
            println!("  --stop-at N   : Stop after generating N permutations");
            println!("  --no-warnings : Suppress dictionary validation warnings");
            println!("  --expand      : Parse rules and output expanded tokens only (no permutations)");
            println!("  --help, -h    : Show this help message");
            println!();
            println!("Rule-based words (in [] brackets):");
            println!("  [all]         : All BIP39 dictionary words");
            println!("  [len:4]       : All 4-character words");
            println!("  [!len:4]      : All words NOT 4 characters");
            println!("  [len:4-6]     : All 4-6 character words (shortest to longest)");
            println!("  [len:6-4]     : All 4-6 character words (longest to shortest)");
            println!("  [len:4,6]     : All 4 and 6 character words");
            println!("  [first:b]     : All words starting with 'b'");
            println!("  [!first:b]    : All words NOT starting with 'b'");
            println!("  [last:y]      : All words ending with 'y'");
            println!("  [!last:y]     : All words NOT ending with 'y'");
            println!("  [last:at]     : All words ending with 'at'");
            println!("  [!last:at]    : All words NOT ending with 'at'");
            println!("  [has:qt]      : All words containing 'qt'");
            println!("  [!has:t]      : All words not containing 't'");
            println!("  [len:7 first:b !last:y] : Complex combinations");
            println!();
            println!("Examples:");
            println!("  {}                       # Use tokens.txt, output to stdout", program_name);
            println!("  {} my_words.txt          # Use my_words.txt, output to stdout", program_name);
            println!("  {} --file                # Use tokens.txt, output to file", program_name);
            println!("  {} --skip 1000           # Skip first 1000 permutations", program_name);
            println!("  {} --stop-at 5000        # Stop after generating 5000 permutations", program_name);
            println!("  {} --no-warnings         # Suppress BIP39 dictionary warnings", program_name);
            println!("  {} my_words.txt --skip 5000 --file # Custom file, skip 5000, output to file", program_name);
        }
    }

    /// Run joegen with direct token content and output to a writer
    pub fn run_joegen_with_content<W: Write>(
        token_content: &str,
        skip_count: u64,
        stop_at: Option<u64>,
        output: &mut W,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        // Load BIP39 dictionary
        let dictionary = load_bip39_dictionary("bip39_wordlist_en.txt").unwrap_or_else(|e| {
            eprintln!("Warning: Could not load BIP39 dictionary: {}", e);
            eprintln!("Dictionary validation will be skipped.");
            HashSet::new()
        });
        
        let lines: Vec<&str> = token_content.lines().collect();
        
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
            
            word_sets.push(expanded_words);
        }
        
        if word_sets.is_empty() {
            return Err("No valid word sets found in token content".into());
        }
        
        // Convert to string references for the permutation generator
        let word_sets_refs: Vec<Vec<&str>> = word_sets
            .iter()
            .map(|words| words.iter().map(|s| s.as_str()).collect())
            .collect();
        
        // Calculate total permutations for user info
        let total_permutations: u64 = word_sets_refs.iter().map(|words| words.len() as u64).product();
        
        if skip_count >= total_permutations {
            eprintln!("Warning: Skip count ({}) is greater than or equal to total permutations ({}). No output will be generated.", skip_count, total_permutations);
            return Ok(true);
        }
        
        // Generate permutations
        let completed_normally = generate_permutations(&word_sets_refs, &mut Vec::new(), output, skip_count, stop_at)?;
        
        Ok(completed_normally)
    }
}
