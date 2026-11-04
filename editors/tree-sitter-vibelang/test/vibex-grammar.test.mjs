import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import fc from 'fast-check';
import { checkProperty } from '../../../scripts/testing/property.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'node_modules/.bin/tree-sitter');
// The CLI validates and reuses its compiled parser cache. Isolating that
// cache per fixture repeats large C builds and can exhaust a short timeout.
const parseTimeout = 180_000;
const jsxRule = "Renaming `x.tsx` to `x.vibex` changes nothing in its JSX;";
const containerRule = "`{…}` holds a VibeLang expression.";
test('VIP-39: the JSX oracle quotes the accepted rules', () => {
  const spec = readFileSync(new URL('../../../docs/design/vips/0039-vibex.md', import.meta.url), 'utf8');
  for (const quote of [jsxRule, containerRule]) assert.ok(spec.includes(quote), quote);
});
const metadata = JSON.parse(readFileSync(join(root, 'tree-sitter.json')));

test('VIP-39: .vibex selects the JSX grammar', () => {
  const grammar = metadata.grammars.find(g => g.scope === 'source.vibex');
  assert.ok(grammar, 'source.vibex is registered');
  assert.deepEqual(grammar['file-types'], ['vibex']);
});

test('VIP-39: generated JSX trees keep VibeLang in containers and words in text', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'vibex-grammar-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  await checkProperty(fc, {
    name: 'vibex-containers', rule: 'VIP-39: ' + jsxRule + ' ' + containerRule,
    command: 'node --test test/vibex-grammar.test.mjs', numRuns: 50,
    arbitrary: fc.record({ tag: fc.constantFrom('p', 'Box', 'UI.Box', 'svg:path', 'catch', 'catch.Box', 'Box.catch', 'catch.Box.Leaf', 'catch:Box'),
      text: fc.constantFrom('effect try match fork join', '% ! |&gt; &amp;', '// text', 'hello 世界'),
      expr: fc.constantFrom('value |> f(%)', 'do { 42; }', 'value catch (e) => <b/>', 'try load()', 'effect () => 1'),
      fragment: fc.boolean(), spread: fc.boolean() }),
    check({ tag, text, expr, fragment, spread }) {
      const element = '<' + tag + ' title="effect try % !" ' + (spread ? '{...props}' : 'value={value}') + '>' + text + '{' + expr + '}</' + tag + '>';
      const file = join(scratch, 'view.vibex');
      writeFileSync(file, 'const view = ' + (fragment ? '<>' + element + '</>' : element) + ';\n');
      const result = spawnSync(cli, ['parse', file], {
        cwd: join(root, 'vibex'), encoding: 'utf8', timeout: parseTimeout,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /\(jsx_element/);
      assert.match(result.stdout, /\(jsx_expression/);
      assert.match(result.stdout, /\(jsx_text/);
      const expected = {
        'value |> f(%)': 'pipe_expression',
        'do { 42; }': 'do_expression',
        'value catch (e) => <b/>': 'catch_expression',
        'try load()': 'try_expression',
        'effect () => 1': 'arrow_function',
      }[expr];
      assert.ok(result.stdout.includes('(' + expected), result.stdout);
      // Compare JSX structure with the pinned upstream TSX parser. Replacing
      // only the VibeLang expression preserves its width and nested JSX.
      const control = join(scratch, 'view.tsx');
      const replacement = expr.includes('<b/>') ? '<b/>' : 'null';
      writeFileSync(control, readFileSync(file, 'utf8').replace('{' + expr + '}',
        '{' + (expr.includes('<b/>') ? replacement.padStart(expr.length) : replacement.padEnd(expr.length)) + '}'));
      const twin = spawnSync(cli, ['parse', control], {
        cwd: join(root, 'node_modules/tree-sitter-typescript/tsx'),
        encoding: 'utf8', timeout: parseTimeout,
      });
      assert.ifError(twin.error);
      assert.equal(twin.status, 0, twin.stdout + twin.stderr);
      const jsx = output => [...output.matchAll(/\((jsx_\w+) \[\d+, \d+\] - \[\d+, \d+\]/g)].map(m => m[0]);
      assert.deepEqual(jsx(result.stdout), jsx(twin.stdout));

      assert.doesNotMatch(result.stdout, /\((?:ERROR|MISSING)\b/);
    },
  });
});

test('VIP-39: bare attribute forms and declarations cannot escape JSX containers', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'vibex-boundaries-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  for (const [name, source] of [
    ['r32-effect', 'const v = <Box task=effect { return 1; }/>;'],
    ['r32-do', 'const v = <Box value=do { 1; }/>;'],
    ['r35-service', 'const v = <p>{service S {}}</p>;'],
    ['r35-error', 'const v = <p>{error E}</p>;'],
    ['r35-provide', 'const v = <p>{provide Live {}}</p>;'],
    ['reserved-binding', 'const catch = 1; const v = <p/>;'],
  ]) {
    const file = join(scratch, name + '.vibex');
    writeFileSync(file, source);
    const result = spawnSync(cli, ['parse', file], {
      cwd: join(root, 'vibex'), encoding: 'utf8', timeout: parseTimeout,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, name + ': ' + result.stdout + result.stderr);
    assert.match(result.stdout, /\((?:ERROR|MISSING)\b/, name);
  }
});

test('VIP-39: reserved JSX member names remain IdentifierNames', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'vibex-member-names-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  for (const tag of ['catch.Box', 'Box.catch', 'catch.Box.Leaf']) {
    const file = join(scratch, 'view.vibex');
    writeFileSync(file, 'const v = <' + tag + '/>;');
    const result = spawnSync(cli, ['parse', file], {
      cwd: join(root, 'vibex'), encoding: 'utf8', timeout: parseTimeout,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, tag + ': ' + result.stdout + result.stderr);
    assert.match(result.stdout, /name: \(member_expression/);
  }
});
