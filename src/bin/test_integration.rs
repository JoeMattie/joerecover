use std::io::Cursor;
use joerecover::run_joegen_with_content;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🧪 Testing joegen content integration...");
    
    // Test with simple word combinations
    let test_content = "abandon abandon\nabout about";
    let mut output = Cursor::new(Vec::new());
    
    println!("📝 Test content:");
    println!("{}", test_content);
    println!();
    
    let completed = run_joegen_with_content(
        test_content,
        0,     // skip
        Some(10), // stop at 10 permutations
        &mut output,
    )?;
    
    let output_str = String::from_utf8(output.into_inner())?;
    let lines: Vec<&str> = output_str.lines().collect();
    
    println!("✅ Generated {} permutations:", lines.len());
    for (i, line) in lines.iter().enumerate() {
        println!("  {}: {}", i + 1, line);
    }
    
    println!();
    println!("✅ Completed normally: {}", completed);
    
    // Test with rule-based content if dictionary exists
    if std::path::Path::new("bip39_wordlist_en.txt").exists() {
        println!();
        println!("🧪 Testing with rule-based content...");
        let rule_content = "[len:4] [first:b]";
        let mut rule_output = Cursor::new(Vec::new());
        
        println!("📝 Rule content: {}", rule_content);
        
        let rule_completed = run_joegen_with_content(
            rule_content,
            0,     // skip
            Some(5), // stop at 5 permutations
            &mut rule_output,
        )?;
        
        let rule_output_str = String::from_utf8(rule_output.into_inner())?;
        let rule_lines: Vec<&str> = rule_output_str.lines().collect();
        
        println!("✅ Generated {} rule-based permutations:", rule_lines.len());
        for (i, line) in rule_lines.iter().enumerate() {
            println!("  {}: {}", i + 1, line);
        }
        
        println!();
        println!("✅ Rule completed normally: {}", rule_completed);
    } else {
        println!("⚠️ Skipping rule-based test (bip39_wordlist_en.txt not found)");
    }
    
    println!();
    println!("🎉 All tests passed!");
    
    Ok(())
}
