import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const grammar = fileURLToPath(new URL('..', import.meta.url));
const cli = join(grammar, 'node_modules/.bin/tree-sitter');

test('statement catches keep TypeScript annotations and reject repeated clauses', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'vibe-catch-grammar-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const parse = (name, source) => {
    const file = join(scratch, name + '.vibe');
    writeFileSync(file, source);
    const result = spawnSync(cli, ['parse', file], {
      cwd: grammar, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, XDG_CACHE_HOME: join(scratch, 'cache') },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  for (const annotation of ['any', 'unknown']) {
    const valid = parse(annotation, `function f(): number { try { throw 42 } catch (e: ${annotation}) { return 0 } }`);
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  }
  const repeated = parse('repeated', 'function f(): number { try { throw 1 } catch { return 0 } catch { return 1 } }');
  assert.notEqual(repeated.status, 0, 'Repeated catch clauses must be syntax errors.\n' + repeated.stdout + repeated.stderr);
  assert.match(repeated.stdout + repeated.stderr, /\b(?:ERROR|MISSING)\b/);
});
