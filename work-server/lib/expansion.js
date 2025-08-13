import { randomUUID } from 'crypto';

// Use joegen to expand the token content and get exact permutation count
export async function expandTokenContent(tokenContent) {
  try {
    const tempFile = `/tmp/joegen_temp_${Date.now()}_${randomUUID()}.txt`;
    await Bun.write(tempFile, tokenContent);

    const proc = Bun.spawn(['./target/release/joegen', tempFile, '--expand'], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: '..',
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Best-effort cleanup
    try { await Bun.write(tempFile, ''); } catch {}

    if (proc.exitCode !== 0) {
      throw new Error(`joegen failed: ${stderr}`);
    }

    const lines = output.trim().split('\n');
    let totalPermutations = 0;
    let expandedContent = '';
    let projectedTime = '';

    for (const line of lines) {
      if (line.startsWith('Projected permutations:')) {
        const match = line.match(/Projected permutations: ([\d,]+)/);
        if (match) totalPermutations = parseInt(match[1].replace(/,/g, ''));
      } else if (line.startsWith('Estimated processing time')) {
        projectedTime = line.replace('Estimated processing time @300k lines/s: ', '');
      } else if (line.startsWith('Line ')) {
        expandedContent += line + '\n';
      }
    }

    return { success: true, totalPermutations, expandedContent: expandedContent.trim(), projectedTime, originalLines: tokenContent.trim().split('\n').length };
  } catch (error) {
    return { success: false, error: error.message, totalPermutations: 0, expandedContent: '', projectedTime: '', originalLines: 0 };
  }
}

// Fallback calculation if joegen expansion fails
export function calculatePermutations(tokenContent) {
  const lines = tokenContent.trim().split('\n').filter(line => line.trim());
  let total = 1;
  for (const line of lines) {
    const words = line.trim().split(/\s+/);
    total *= Math.max(2, words.length);
  }
  return Math.min(total, 1000000000);
}


