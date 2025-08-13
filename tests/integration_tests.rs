use std::io::Cursor;
use std::collections::HashSet;
use joerecover::{generate_permutations, parse_rule, apply_rule_to_dictionary, process_line, WordRule, detect_reverse_order, Config};

#[test]
fn test_generate_permutations_simple() {
    let word_sets = vec![
        vec!["a", "b"],
        vec!["1", "2"],
    ];
    
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    
    generate_permutations(&word_sets, &mut Vec::new(), &mut cursor, 0, None).unwrap();
    
    let result = String::from_utf8(output).unwrap();
    let lines: Vec<&str> = result.trim().split('\n').collect();
    
    assert_eq!(lines.len(), 4);
    assert!(lines.contains(&"a 1"));
    assert!(lines.contains(&"a 2"));
    assert!(lines.contains(&"b 1"));
    assert!(lines.contains(&"b 2"));
}

#[test]
fn test_generate_permutations_single_word_per_line() {
    let word_sets = vec![
        vec!["hello"],
        vec!["world"],
    ];
    
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    
    generate_permutations(&word_sets, &mut Vec::new(), &mut cursor, 0, None).unwrap();
    
    let result = String::from_utf8(output).unwrap();
    let lines: Vec<&str> = result.trim().split('\n').collect();
    
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0], "hello world");
}

#[test]
fn test_generate_permutations_with_skip() {
    let word_sets = vec![
        vec!["a", "b"],
        vec!["1", "2"],
    ];
    
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    
    // Skip first 2 permutations
    generate_permutations(&word_sets, &mut Vec::new(), &mut cursor, 2, None).unwrap();
    
    let result = String::from_utf8(output).unwrap();
    let lines: Vec<&str> = result.trim().split('\n').collect();
    
    // Should only get the last 2 permutations
    assert_eq!(lines.len(), 2);
    assert!(lines.contains(&"b 1"));
    assert!(lines.contains(&"b 2"));
}

#[test]
fn test_generate_permutations_skip_all() {
    let word_sets = vec![
        vec!["a", "b"],
        vec!["1", "2"],
    ];
    
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    
    // Skip all permutations
    generate_permutations(&word_sets, &mut Vec::new(), &mut cursor, 4, None).unwrap();
    
    let result = String::from_utf8(output).unwrap();
    let lines: Vec<&str> = result.trim().split('\n').filter(|s| !s.is_empty()).collect();
    
    // Should get no permutations
    assert_eq!(lines.len(), 0);
}

#[test] 
fn test_generate_permutations_three_levels() {
    let word_sets = vec![
        vec!["x"],
        vec!["y", "z"],
        vec!["1", "2"],
    ];
    
    let mut output = Vec::new();
    let mut cursor = Cursor::new(&mut output);
    
    generate_permutations(&word_sets, &mut Vec::new(), &mut cursor, 0, None).unwrap();
    
    let result = String::from_utf8(output).unwrap();
    let lines: Vec<&str> = result.trim().split('\n').collect();
    
    assert_eq!(lines.len(), 4);
    assert!(lines.contains(&"x y 1"));
    assert!(lines.contains(&"x y 2"));
    assert!(lines.contains(&"x z 1"));
    assert!(lines.contains(&"x z 2"));
}

// Tests for new dictionary and rule functionality

#[test]
fn test_parse_length_rule() {
    let rule = parse_rule("[len:4]").unwrap();
    assert_eq!(rule.min_length, Some(4));
    assert_eq!(rule.max_length, Some(4));
    
    let rule = parse_rule("[len:4-6]").unwrap();
    assert_eq!(rule.min_length, Some(4));
    assert_eq!(rule.max_length, Some(6));
    
    let rule = parse_rule("[len:6-4]").unwrap();
    assert_eq!(rule.min_length, Some(4));
    assert_eq!(rule.max_length, Some(6));
    
    let rule = parse_rule("[len:4,6]").unwrap();
    assert_eq!(rule.min_length, Some(4));
    assert_eq!(rule.max_length, Some(6));
}

#[test]
fn test_parse_first_last_rules() {
    let rule = parse_rule("[first:a]").unwrap();
    assert_eq!(rule.first_char, Some("a".to_string()));
    
    let rule = parse_rule("[last:y]").unwrap();
    assert_eq!(rule.last_char, Some("y".to_string()));
    
    let rule = parse_rule("[last:at]").unwrap();
    assert_eq!(rule.last_substring, Some("at".to_string()));
}

#[test]
fn test_parse_has_rules() {
    let rule = parse_rule("[has:qt]").unwrap();
    assert_eq!(rule.has_substrings, vec!["qt".to_string()]);
    
    let rule = parse_rule("[!has:t]").unwrap();
    assert_eq!(rule.not_has_substrings, vec!["t".to_string()]);
    
    let rule = parse_rule("[has:qt has:i]").unwrap();
    assert_eq!(rule.has_substrings, vec!["qt".to_string(), "i".to_string()]);
}

#[test]
fn test_parse_complex_rule() {
    let rule = parse_rule("[len:7 first:b last:y has:a !has:t]").unwrap();
    assert_eq!(rule.min_length, Some(7));
    assert_eq!(rule.max_length, Some(7));
    assert_eq!(rule.first_char, Some("b".to_string()));
    assert_eq!(rule.last_char, Some("y".to_string()));
    assert_eq!(rule.has_substrings, vec!["a".to_string()]);
    assert_eq!(rule.not_has_substrings, vec!["t".to_string()]);
}

#[test]
fn test_word_rule_matching() {
    let mut rule = WordRule::new();
    rule.min_length = Some(4);
    rule.max_length = Some(4);
    
    assert!(rule.matches("test"));
    assert!(!rule.matches("hi"));
    assert!(!rule.matches("longer"));
    
    rule.first_char = Some("t".to_string());
    assert!(rule.matches("test"));
    assert!(!rule.matches("best"));
    
    rule.last_char = Some("t".to_string());
    assert!(rule.matches("test"));
    assert!(!rule.matches("temp"));
    
    rule.has_substrings = vec!["es".to_string()];
    assert!(rule.matches("test"));
    assert!(!rule.matches("talk"));
    
    rule.not_has_substrings = vec!["a".to_string()];
    assert!(rule.matches("test"));
    assert!(!rule.matches("fast"));
}

#[test]
fn test_apply_rule_to_dictionary() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("bat".to_string());
    dictionary.insert("rat".to_string());
    dictionary.insert("dog".to_string());
    dictionary.insert("big".to_string());
    dictionary.insert("small".to_string());
    
    let rule = parse_rule("[len:3]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false);
    assert_eq!(matches.len(), 5); // cat, bat, rat, dog, big
    assert!(matches.contains(&"cat".to_string()));
    assert!(matches.contains(&"bat".to_string()));
    assert!(matches.contains(&"rat".to_string()));
    assert!(matches.contains(&"dog".to_string()));
    assert!(matches.contains(&"big".to_string()));
    assert!(!matches.contains(&"small".to_string()));
    
    let rule = parse_rule("[last:at]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false);
    assert_eq!(matches.len(), 3); // cat, bat, rat
    assert!(matches.contains(&"cat".to_string()));
    assert!(matches.contains(&"bat".to_string()));
    assert!(matches.contains(&"rat".to_string()));
    assert!(!matches.contains(&"dog".to_string()));
}

#[test]
fn test_process_line_with_rules() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("bat".to_string());
    dictionary.insert("rat".to_string());
    dictionary.insert("dog".to_string());
    
    // Test simple rule
    let result = process_line("word [len:3]", &dictionary).unwrap();
    assert_eq!(result[0], "word");
    assert!(result.len() > 1);
    assert!(result.contains(&"cat".to_string()));
    assert!(result.contains(&"bat".to_string()));
    assert!(result.contains(&"rat".to_string()));
    assert!(result.contains(&"dog".to_string()));
    
    // Test multiple words with rules
    let result = process_line("start [len:3] end", &dictionary).unwrap();
    assert_eq!(result[0], "start");
    assert_eq!(result[result.len()-1], "end");
    assert!(result.len() > 2);
}

#[test]
fn test_process_line_with_complex_rule() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("bat".to_string());
    dictionary.insert("rat".to_string());
    dictionary.insert("dog".to_string());
    dictionary.insert("bog".to_string());
    
    let result = process_line("[len:3 first:b]", &dictionary).unwrap();
    assert_eq!(result.len(), 2); // bat, bog
    assert!(result.contains(&"bat".to_string()));
    assert!(result.contains(&"bog".to_string()));
    assert!(!result.contains(&"cat".to_string()));
    assert!(!result.contains(&"rat".to_string()));
    assert!(!result.contains(&"dog".to_string()));
}

#[test]
fn test_all_rule() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("dog".to_string());
    dictionary.insert("bird".to_string());
    dictionary.insert("fish".to_string());
    
    let rule = parse_rule("[all]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false);
    
    // [all] should return all words in the dictionary
    assert_eq!(matches.len(), 4);
    assert!(matches.contains(&"cat".to_string()));
    assert!(matches.contains(&"dog".to_string()));
    assert!(matches.contains(&"bird".to_string()));
    assert!(matches.contains(&"fish".to_string()));
}

#[test]
fn test_process_line_with_all_rule() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("dog".to_string());
    dictionary.insert("bird".to_string());
    
    let result = process_line("start [all] end", &dictionary).unwrap();
    assert_eq!(result[0], "start");
    assert_eq!(result[result.len()-1], "end");
    assert_eq!(result.len(), 5); // start + 3 words + end
    assert!(result.contains(&"cat".to_string()));
    assert!(result.contains(&"dog".to_string()));
    assert!(result.contains(&"bird".to_string()));
}

// Tests for negated rules

#[test]
fn test_parse_negated_length_rule() {
    let rule = parse_rule("[!len:4]").unwrap();
    assert_eq!(rule.not_min_length, Some(4));
    assert_eq!(rule.not_max_length, Some(4));
    assert_eq!(rule.min_length, None);
    assert_eq!(rule.max_length, None);
    
    let rule = parse_rule("[!len:4-6]").unwrap();
    assert_eq!(rule.not_min_length, Some(4));
    assert_eq!(rule.not_max_length, Some(6));
}

#[test]
fn test_parse_negated_first_last_rules() {
    let rule = parse_rule("[!first:a]").unwrap();
    assert_eq!(rule.not_first_chars, vec!["a".to_string()]);
    assert_eq!(rule.first_char, None);
    
    let rule = parse_rule("[!last:y]").unwrap();
    assert_eq!(rule.not_last_chars, vec!["y".to_string()]);
    assert_eq!(rule.last_char, None);
    
    let rule = parse_rule("[!last:at]").unwrap();
    assert_eq!(rule.not_last_substrings, vec!["at".to_string()]);
    assert_eq!(rule.last_substring, None);
}

#[test]
fn test_negated_length_rule_matching() {
    let rule = parse_rule("[!len:4]").unwrap();
    
    // Should match words that are NOT 4 characters
    assert!(rule.matches("cat")); // 3 chars
    assert!(rule.matches("hello")); // 5 chars
    assert!(rule.matches("hi")); // 2 chars
    assert!(!rule.matches("test")); // 4 chars - should NOT match
    assert!(!rule.matches("word")); // 4 chars - should NOT match
}

#[test]
fn test_negated_first_rule_matching() {
    let rule = parse_rule("[!first:b]").unwrap();
    
    // Should match words that do NOT start with 'b'
    assert!(rule.matches("cat"));
    assert!(rule.matches("dog"));
    assert!(rule.matches("apple"));
    assert!(!rule.matches("bat")); // starts with 'b' - should NOT match
    assert!(!rule.matches("big")); // starts with 'b' - should NOT match
}

#[test]
fn test_negated_last_rule_matching() {
    let rule = parse_rule("[!last:y]").unwrap();
    
    // Should match words that do NOT end with 'y'
    assert!(rule.matches("cat"));
    assert!(rule.matches("dog"));
    assert!(rule.matches("test"));
    assert!(!rule.matches("happy")); // ends with 'y' - should NOT match
    assert!(!rule.matches("any")); // ends with 'y' - should NOT match
}

#[test]
fn test_negated_last_substring_rule_matching() {
    let rule = parse_rule("[!last:at]").unwrap();
    
    // Should match words that do NOT end with 'at'
    assert!(rule.matches("dog"));
    assert!(rule.matches("test"));
    assert!(rule.matches("hello"));
    assert!(!rule.matches("cat")); // ends with 'at' - should NOT match
    assert!(!rule.matches("bat")); // ends with 'at' - should NOT match
    assert!(!rule.matches("that")); // ends with 'at' - should NOT match
}

#[test]
fn test_combined_positive_and_negative_rules() {
    let rule = parse_rule("[len:4 !first:b]").unwrap();
    
    // Should match 4-letter words that do NOT start with 'b'
    assert!(rule.matches("test")); // 4 chars, doesn't start with 'b'
    assert!(rule.matches("word")); // 4 chars, doesn't start with 'b'
    assert!(rule.matches("cats")); // 4 chars, doesn't start with 'b'
    assert!(!rule.matches("best")); // 4 chars but starts with 'b' - should NOT match
    assert!(!rule.matches("big")); // 3 chars - should NOT match
    assert!(!rule.matches("hello")); // 5 chars - should NOT match
}

#[test]
fn test_apply_negated_rule_to_dictionary() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string()); // 3 chars
    dictionary.insert("test".to_string()); // 4 chars
    dictionary.insert("hello".to_string()); // 5 chars
    dictionary.insert("bat".to_string()); // 3 chars, starts with 'b'
    dictionary.insert("big".to_string()); // 3 chars, starts with 'b'
    
    // Test !len:4 (not 4 characters)
    let rule = parse_rule("[!len:4]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false);
    assert_eq!(matches.len(), 4); // cat, hello, bat, big (all except 'test')
    assert!(matches.contains(&"cat".to_string()));
    assert!(matches.contains(&"hello".to_string()));
    assert!(matches.contains(&"bat".to_string()));
    assert!(matches.contains(&"big".to_string()));
    assert!(!matches.contains(&"test".to_string()));
    
    // Test !first:b (not starting with 'b')
    let rule = parse_rule("[!first:b]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false);
    assert_eq!(matches.len(), 3); // cat, test, hello (all except 'bat', 'big')
    assert!(matches.contains(&"cat".to_string()));
    assert!(matches.contains(&"test".to_string()));
    assert!(matches.contains(&"hello".to_string()));
    assert!(!matches.contains(&"bat".to_string()));
    assert!(!matches.contains(&"big".to_string()));
}

#[test]
fn test_reverse_order_detection_and_sorting() {
    use joerecover::apply_rule_to_dictionary;
    
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());    // 3 chars
    dictionary.insert("test".to_string());   // 4 chars
    dictionary.insert("hello".to_string());  // 5 chars
    dictionary.insert("longer".to_string()); // 6 chars
    
    // Test len:6-4 (should be reverse order: longest first)
    let rule = parse_rule("[len:6-4]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, true); // Force reverse order
    
    // Should have 4, 5, and 6 letter words in reverse order (longest first)
    assert_eq!(matches.len(), 3);
    assert_eq!(matches[0], "longer"); // 6 chars should come first
    assert_eq!(matches[1], "hello");  // 5 chars should come second  
    assert_eq!(matches[2], "test");   // 4 chars should come last
    
    // Test len:4-6 (should be normal order: shortest first)
    let rule = parse_rule("[len:4-6]").unwrap();
    let matches = apply_rule_to_dictionary(&rule, &dictionary, false); // Force normal order
    
    // Should have 4, 5, and 6 letter words in normal order (shortest first)
    assert_eq!(matches.len(), 3);
    assert_eq!(matches[0], "test");   // 4 chars should come first
    assert_eq!(matches[1], "hello");  // 5 chars should come second
    assert_eq!(matches[2], "longer"); // 6 chars should come last
}

#[test]
fn test_len_6_4_actual_behavior() {
    // Test what actually happens with [len:6-4] in process_line
    let mut dictionary = HashSet::new();
    dictionary.insert("test".to_string());   // 4 chars
    dictionary.insert("hello".to_string());  // 5 chars
    dictionary.insert("longer".to_string()); // 6 chars
    
    let result = process_line("[len:6-4]", &dictionary).unwrap();
    
    // Check if the first word is 6 characters (indicating reverse order worked)
    assert_eq!(result.len(), 3);
    
    // If reverse order is working, "longer" (6 chars) should come first
    if result[0] == "longer" {
        // Reverse order is working correctly
        assert_eq!(result[0], "longer"); // 6 chars
        assert_eq!(result[1], "hello");  // 5 chars
        assert_eq!(result[2], "test");   // 4 chars
    } else {
        // If reverse order is not working, fail the test with diagnostic info
        panic!("Reverse order is not working. Got order: {:?}", result);
    }
}

#[test]
fn test_detect_reverse_order_function() {
    // Test the detect_reverse_order function directly
    
    // Test cases that should return true (reverse order)
    assert!(detect_reverse_order("[len:6-4]"));
    assert!(detect_reverse_order("[len:10-3]"));
    assert!(detect_reverse_order("[len:5-2]"));
    
    // Test cases that should return false (normal order)
    assert!(!detect_reverse_order("[len:4-6]"));
    assert!(!detect_reverse_order("[len:3-10]"));
    assert!(!detect_reverse_order("[len:2-5]"));
    assert!(!detect_reverse_order("[len:4]")); // single length
    assert!(!detect_reverse_order("[first:a]")); // not length rule
    assert!(!detect_reverse_order("[!len:6-4]")); // negated rule
    
    println!("Direct test results:");
    println!("detect_reverse_order('[len:6-4]') = {}", detect_reverse_order("[len:6-4]"));
    println!("detect_reverse_order('[len:4-6]') = {}", detect_reverse_order("[len:4-6]"));
}

#[test]
fn test_config_expand_flag() {
    // Test that --expand flag is parsed correctly
    let args = vec!["program".to_string(), "test.txt".to_string(), "--expand".to_string()];
    let config = Config::from_args(args).unwrap();
    
    assert_eq!(config.token_file, "test.txt");
    assert!(config.expand_only);
    assert!(!config.output_to_file);
    assert!(!config.show_help);
    assert!(!config.no_warnings);
    assert_eq!(config.skip_count, 0);
}

#[test]
fn test_config_expand_with_other_flags() {
    // Test --expand flag combined with other flags
    let args = vec![
        "program".to_string(), 
        "test.txt".to_string(), 
        "--expand".to_string(),
        "--no-warnings".to_string()
    ];
    let config = Config::from_args(args).unwrap();
    
    assert_eq!(config.token_file, "test.txt");
    assert!(config.expand_only);
    assert!(config.no_warnings);
    assert!(!config.output_to_file);
    assert!(!config.show_help);
    assert_eq!(config.skip_count, 0);
}

#[test]
fn test_process_line_deduplication() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());
    dictionary.insert("dog".to_string());
    dictionary.insert("bird".to_string());
    
    // Test line with duplicate literal words
    let result = process_line("cat dog cat bird dog", &dictionary).unwrap();
    assert_eq!(result.len(), 3);
    assert_eq!(result, vec!["cat", "dog", "bird"]);
}

#[test]
fn test_process_line_deduplication_with_rules() {
    let mut dictionary = HashSet::new();
    dictionary.insert("cat".to_string());    // 3 chars
    dictionary.insert("dog".to_string());    // 3 chars
    dictionary.insert("bird".to_string());   // 4 chars
    dictionary.insert("fish".to_string());   // 4 chars
    
    // Test line where rule expansion creates duplicates with literal words
    let result = process_line("cat dog [len:3] bird", &dictionary).unwrap();
    
    // Should have: cat, dog, bird (no duplicates from [len:3] since cat and dog are already there)
    assert_eq!(result.len(), 3);
    assert!(result.contains(&"cat".to_string()));
    assert!(result.contains(&"dog".to_string()));
    assert!(result.contains(&"bird".to_string()));
    
    // cat and dog should appear only once even though they're in both literal and [len:3]
    let cat_count = result.iter().filter(|&word| word == "cat").count();
    let dog_count = result.iter().filter(|&word| word == "dog").count();
    assert_eq!(cat_count, 1);
    assert_eq!(dog_count, 1);
}

#[test]
fn test_process_line_deduplication_preserves_order() {
    let mut dictionary = HashSet::new();
    dictionary.insert("apple".to_string());
    dictionary.insert("banana".to_string());
    dictionary.insert("cherry".to_string());
    
    // Test that first occurrence order is preserved
    let result = process_line("banana apple cherry apple banana", &dictionary).unwrap();
    assert_eq!(result.len(), 3);
    assert_eq!(result, vec!["banana", "apple", "cherry"]);
}

#[test]
fn test_process_line_deduplication_empty_after_duplicates() {
    let dictionary = HashSet::new();
    
    // Test line with only duplicate words
    let result = process_line("word word word", &dictionary).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result, vec!["word"]);
}

#[test]
fn test_multiple_negative_last_rules() {
    let mut dictionary = HashSet::new();
    dictionary.insert("book".to_string());  // 4 chars, has 'oo', ends with 'k'
    dictionary.insert("cook".to_string());  // 4 chars, has 'oo', ends with 'k'
    dictionary.insert("door".to_string());  // 4 chars, has 'oo', ends with 'r'
    dictionary.insert("food".to_string());  // 4 chars, has 'oo', ends with 'd'
    dictionary.insert("good".to_string());  // 4 chars, has 'oo', ends with 'd'
    dictionary.insert("moon".to_string());  // 4 chars, has 'oo', ends with 'n'
    dictionary.insert("pool".to_string());  // 4 chars, has 'oo', ends with 'l'
    dictionary.insert("poor".to_string());  // 4 chars, has 'oo', ends with 'r'
    dictionary.insert("room".to_string());  // 4 chars, has 'oo', ends with 'm'
    dictionary.insert("soon".to_string());  // 4 chars, has 'oo', ends with 'n'
    dictionary.insert("tool".to_string());  // 4 chars, has 'oo', ends with 'l'
    dictionary.insert("wood".to_string());  // 4 chars, has 'oo', ends with 'd'
    dictionary.insert("wool".to_string());  // 4 chars, has 'oo', ends with 'l'
    dictionary.insert("zoom".to_string());  // 4 chars, has 'oo', ends with 'm'
    
    // Test the exact rule from the user's complaint
    let result = process_line("[has:oo len:4 !last:k !last:d !last:p !last:l]", &dictionary).unwrap();
    
    // Should exclude: book, cook (end with 'k'), food, good, wood (end with 'd'), pool, tool, wool (end with 'l')
    // Should include: door, poor (end with 'r'), moon, soon (end with 'n'), room, zoom (end with 'm')
    let expected_words = vec!["door", "moon", "poor", "room", "soon", "zoom"];
    
    println!("Expected: {:?}", expected_words);
    println!("Actual: {:?}", result);
    
    for word in &expected_words {
        assert!(result.contains(&word.to_string()), "Expected word '{}' not found in result", word);
    }
    
    // Check that excluded words are NOT present
    let excluded_words = vec!["book", "cook", "food", "good", "wood", "pool", "tool", "wool"];
    for word in &excluded_words {
        assert!(!result.contains(&word.to_string()), "Excluded word '{}' found in result", word);
    }
    
    assert_eq!(result.len(), expected_words.len());
}

#[test]
fn test_not_has_rule_comprehensive() {
    let mut dictionary = HashSet::new();
    dictionary.insert("test".to_string());    // contains 't'
    dictionary.insert("help".to_string());    // no 't'
    dictionary.insert("time".to_string());    // contains 't' at start
    dictionary.insert("chat".to_string());    // contains 't' at end
    dictionary.insert("butter".to_string());  // contains 't' in middle
    dictionary.insert("safe".to_string());    // no 't'
    dictionary.insert("word".to_string());    // no 't'
    
    let result = process_line("[!has:t]", &dictionary).unwrap();
    
    // Should include words WITHOUT 't'
    let expected_words = vec!["help", "safe", "word"];
    assert_eq!(result.len(), expected_words.len());
    
    for word in &expected_words {
        assert!(result.contains(&word.to_string()), "Expected word '{}' not found", word);
    }
    
    // Should exclude words WITH 't' (anywhere in the word)
    let excluded_words = vec!["test", "time", "chat", "butter"];
    for word in &excluded_words {
        assert!(!result.contains(&word.to_string()), "Excluded word '{}' found in result", word);
    }
}
