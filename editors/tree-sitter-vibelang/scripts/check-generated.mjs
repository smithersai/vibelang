// Fails when src/ differs from what tree-sitter generate writes for grammar.js,
// so the committed parser is the grammar's.
//
//   node scripts/check-generated.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const grammarDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'vibe-generate-'));
try {
  for (const variant of ['', 'vibex']) {
    const output = join(scratch, variant || 'vibe');
    execFileSync(join(grammarDir, 'node_modules', '.bin', 'tree-sitter'), ['generate', '--abi', '14', '--output', output], {
      cwd: join(grammarDir, variant),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const stale = [];
    const compare = (relative) => {
      const generated = join(output, relative);
      const committed = join(grammarDir, variant, 'src', relative);
      let text;
      try {
        text = readFileSync(committed);
      } catch {
        stale.push(relative);
        return;
      }
      if (!text.equals(readFileSync(generated))) stale.push(relative);
    };
    for (const entry of readdirSync(output, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const child of readdirSync(join(output, entry.name))) compare(join(entry.name, child));
      } else {
        compare(entry.name);
      }
    }
    if (stale.length) {
      console.error(`src/ is not what grammar.js generates: ${stale.join(', ')}. Run npm run generate.`);
      process.exit(1);
    }
    console.log((variant || 'vibe') + ' src/ is what grammar.js generates');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
