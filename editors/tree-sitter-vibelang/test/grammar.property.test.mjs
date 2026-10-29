import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { checkProperty } from '../../../scripts/testing/property.mjs';
import { projectArbitrary, projectFiles } from '../../../scripts/testing/projects.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(here, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'vibe-grammar-property-'));
const binary = process.env.G1_PARSE_BINARY || join(scratch, 'parse');
const cli = join(here, 'node_modules/.bin/tree-sitter');
const regressions = new URL('./property-regressions/', import.meta.url);
const grammar = 'docs/design/history/src/900-appendices.md: Grammar (D419), Contextual words, Declarations, Statements, Expressions, Patterns';
const editor = 'docs/design/history/src/428-part4-ch28-tooling.md: The editor';
const command = 'node --test test/grammar.property.test.mjs';
const known = existsSync(regressions) ? readdirSync(regressions).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(new URL(f, regressions)))).filter(r => r.knownFailure) : [];
const gaps = new Set();
let diagnostics = '', failureDiagnostics = '';
after(() => {
  if (gaps.size) process.stderr.write(`G1 recorded disagreements exercised: ${[...gaps].join(', ')}\n`);
  rmSync(scratch, { recursive: true, force: true });
});

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: here, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20, ...options });
  assert.ifError(r.error);
  assert.equal(r.signal, null, `${command}: ${r.signal}`);
  return r;
}

if (!process.env.G1_PARSE_BINARY) {
  process.stderr.write('G1 setup: build parser-only probe\n');
  const r = run('go', ['build', '-o', binary, './internal/vibelangfuzz/testtools/parse'], {
    cwd: join(root, 'typescript/tsc'), timeout: 120000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

function probe(request) {
  const r = run(binary, [], { input: JSON.stringify(request) + '\n' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

function trees(sources) {
  const paths = sources.map((source, i) => {
    const file = join(scratch, `${i}.vibe`);
    writeFileSync(file, source);
    return file;
  });
  const r = run(cli, ['parse', '--timeout', '2000000', ...paths]);
  assert.ok(r.status === 0 || r.status === 1, r.stdout + r.stderr);
  const outputs = r.stdout.split(/^(?=\()/m).filter(tree => tree.startsWith('('));
  assert.equal(outputs.length, sources.length, r.stdout + r.stderr);
  return outputs.map((tree, i) => {
    const lines = sources[i].split('\n');
    const starts = [0];
    for (const line of lines.slice(0, -1)) starts.push(starts.at(-1) + Buffer.byteLength(line) + 1);
    const nodes = [], stack = [];
    for (const match of tree.matchAll(/^( *)(?:\w+: )?\((\w+) \[(\d+), (\d+)\] - \[(\d+), (\d+)\]/gm)) {
      const indent = match[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const node = { kind: match[2], start: starts[+match[3]] + +match[4], end: starts[+match[5]] + +match[6],
        indent, field: /\b(\w+): \(/.exec(match[0])?.[1], parent: stack.at(-1)?.kind, ancestors: stack.map(n => n.kind) };
      nodes.push(node);
      stack.push(node);
    }
    return { valid: !/\((?:ERROR|MISSING)\b/.test(tree), nodes, tree };
  });
}

const hasGap = id => known.some(r => r.id === id);
const textOf = (source, span) => Buffer.from(source).subarray(span.start, span.end).toString();

// Only the exact saved disagreement shapes qualify. Reparse with the offending
// identifier renamed / tail match parenthesized / string newline escaped, and
// check all remaining syntax and statement boundaries strictly. No feature or
// file is excluded.
function repairedKnownSyntax(compiler, tree) {
  if (!compiler.valid && tree.valid && hasGap('unescaped-string-newline')) {
    const edits = [];
    for (const node of tree.nodes.filter(n => n.kind === 'string')) {
      const literal = textOf(compiler.source, node);
      // Consume escapes first: an escaped LF is a valid line continuation.
      const newlines = [...literal.matchAll(/\\[\s\S]|(\n)/g)].filter(m => m[1])
        .map(m => node.start + Buffer.byteLength(literal.slice(0, m.index)));
      if (newlines.some(start => compiler.diagnostics.some(d => d.code === 1002 && d.start === start))) edits.push(...newlines);
    }
    if (edits.length) {
      let source = Buffer.from(compiler.source);
      for (const start of edits.sort((a, b) => b - a)) {
        source = Buffer.concat([source.subarray(0, start), Buffer.from('\\'), source.subarray(start)]);
      }
      gaps.add('unescaped-string-newline');
      return source.toString();
    }
  }
  if (compiler.valid && !tree.valid && hasGap('error-block-param')) {
    const source = Buffer.from(compiler.source);
    const node = tree.nodes.find(n => ['identifier', 'ERROR'].includes(n.kind) && textOf(compiler.source, n) === 'error' &&
      /^[ \t]*\{/.test(source.subarray(n.end).toString()) &&
      compiler.statements.some(s => s.kind === 'KindExpressionStatement' && s.start === n.start && s.end > n.end));
    if (node) {
      gaps.add('error-block-param');
      return Buffer.concat([source.subarray(0, node.start), Buffer.from('value'), source.subarray(node.end)]).toString();
    }
  }
  if (!compiler.valid && tree.valid && hasGap('anonymous-function-statement')) {
    const node = tree.nodes.find(n => n.kind === 'function_expression' && n.parent === 'expression_statement' &&
      compiler.diagnostics.some(d => d.code === 1003 && d.start >= n.start && d.end <= n.end));
    if (node) {
      gaps.add('anonymous-function-statement');
      const source = Buffer.from(compiler.source);
      return Buffer.concat([source.subarray(0, node.start), Buffer.from(`(${textOf(compiler.source, node)})`), source.subarray(node.end)]).toString();
    }
  }
  if (compiler.valid && !tree.valid && hasGap('empty-type-parameters')) {
    const node = tree.nodes.find(n => n.kind === 'type_parameters' && /^<\s*>$/.test(textOf(compiler.source, n)));
    if (node) {
      gaps.add('empty-type-parameters');
      const source = Buffer.from(compiler.source);
      return Buffer.concat([source.subarray(0, node.start), source.subarray(node.end)]).toString();
    }
  }
  if (compiler.valid && !tree.valid && hasGap('unnamed-module')) {
    const match = /\bmodule(?=\s*\{)/.exec(compiler.source);
    if (match && tree.nodes.some(n => n.kind === 'ERROR' && textOf(compiler.source, n) === 'module')) {
      gaps.add('unnamed-module');
      return compiler.source.slice(0, match.index) + 'module placeholder' + compiler.source.slice(match.index + 6);
    }
  }
  if (!compiler.valid && tree.valid && hasGap('object-statement')) {
    const node = tree.nodes.find(n => n.kind === 'object' && n.parent === 'expression_statement' &&
      compiler.diagnostics.some(d => d.start >= n.start && d.end <= n.end));
    if (node) {
      gaps.add('object-statement');
      const source = Buffer.from(compiler.source);
      return Buffer.concat([source.subarray(0, node.start), Buffer.from(`(${textOf(compiler.source, node)})`), source.subarray(node.end)]).toString();
    }
  }
  if (compiler.valid && !tree.valid && hasGap('await-identifier')) {
    const errors = tree.nodes.filter(n => n.kind === 'ERROR');
    if (errors.length === 1 && textOf(compiler.source, errors[0]) === 'await') {
      gaps.add('await-identifier');
      const source = Buffer.from(compiler.source), node = errors[0];
      return Buffer.concat([source.subarray(0, node.start), Buffer.from('value'), source.subarray(node.end)]).toString();
    }
  }
  if (compiler.valid && !tree.valid && hasGap('jsdoc-prefix-type')) {
    const errors = tree.nodes.filter(n => n.kind === 'ERROR');
    if (errors.length && errors.every(n => n.parent === 'type_annotation' && textOf(compiler.source, n) === '!')) {
      gaps.add('jsdoc-prefix-type');
      const source = Buffer.from(compiler.source);
      return Buffer.concat([source.subarray(0, errors[0].start), source.subarray(errors[0].end)]).toString();
    }
  }
  if (compiler.valid || !tree.valid) return;
  const edits = [];
  if (hasGap('catch-identifier')) {
    for (const node of tree.nodes.filter(n => ['identifier', 'type_identifier', 'statement_identifier'].includes(n.kind) && textOf(compiler.source, n) === 'catch')) {
      if (compiler.diagnostics.some(d => d.start === node.start)) {
        edits.push({ ...node, text: 'value' });
      }
    }
  }
  if (hasGap('do-tail-match')) {
    for (const node of tree.nodes.filter(n => n.kind === 'match_expression' && n.ancestors.includes('do_expression'))) {
      if (compiler.diagnostics.some(d => d.code === 1109 && d.start === node.start && d.end === node.end)) {
        edits.push({ ...node, text: `(${textOf(compiler.source, node)})` });
      }
    }
  }
  if (!edits.length) return;
  let source = Buffer.from(compiler.source);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = Buffer.concat([source.subarray(0, edit.start), Buffer.from(edit.text), source.subarray(edit.end)]);
  }
  gaps.add(edits.some(e => e.text === 'value') ? 'catch-identifier' : 'do-tail-match');
  return source.toString();
}

function category(kind) {
  if (kind.startsWith('vibe:')) return kind.replace('schema error', 'error').replace('schema alias', 'schema').replace('vibe:with', 'vibe:provide');
  if (/^(error|service|control|schema|data|layer|module)_declaration$/.test(kind)) return 'vibe:' + kind.split('_')[0];
  if (['KindVariableStatement', 'lexical_declaration', 'variable_declaration'].includes(kind)) return 'variable';
  if (['KindFunctionDeclaration', 'function_declaration', 'generator_function_declaration', 'function_signature'].includes(kind)) return 'function';
  if (['KindClassDeclaration', 'class_declaration', 'abstract_class_declaration'].includes(kind)) return 'class';
  if (['KindModuleDeclaration', 'internal_module', 'module'].includes(kind)) return 'namespace';
  if (['KindExportDeclaration', 'KindExportAssignment', 'export_statement'].includes(kind)) return 'export';
  if (kind === 'KindImportDeclaration') return 'import_statement';
  if (kind === 'KindImportEqualsDeclaration') return 'import_alias';
  if (kind === 'provide_statement') return 'vibe:provide';
  if (kind === 'KindBlock') return 'statement_block';
  if (['KindForInStatement', 'KindForOfStatement'].includes(kind)) return 'for_in_statement';
  return kind.replace(/^Kind/, '').replace(/[A-Z]/g, (letter, at) => (at ? '_' : '') + letter.toLowerCase());
}
function compare(results, strict = false) {
  const parsed = trees(results.map(r => r.source));
  results.forEach((compiler, i) => {
    const tree = parsed[i];
    diagnostics = JSON.stringify({ sourceIndex: i, valid: compiler.valid, syntaxDiagnostics: compiler.diagnostics,
      statements: compiler.statements, tree: tree.tree.slice(-8000) });
    if (tree.valid !== compiler.valid && !strict) {
      const repaired = repairedKnownSyntax(compiler, tree);
      if (repaired !== undefined) { compare(probe({ sources: [repaired] }), true); return; }
    }
    assert.equal(tree.valid, compiler.valid, 'syntax acceptance differs');
    if (compiler.valid) {
      const bounds = tree.nodes.filter(n => n.parent === 'program' && !['comment', 'hash_bang_line'].includes(n.kind))
        .map(node => {
          let declaration = node;
          while (['export_statement', 'ambient_declaration', 'expression_statement'].includes(declaration.kind)) {
            const child = tree.nodes.find(n => n.indent === declaration.indent + 2 && n.start >= declaration.start && n.end <= declaration.end &&
              (n.field === 'declaration' || declaration.kind === 'ambient_declaration' || n.kind === 'internal_module'));
            if (!child) break;
            declaration = child;
          }
          let kind = category(declaration.kind);
          // Masks use the grammar's generic block-param call node. Recover the
          // surface keyword from its function field, as the compiler records it.
          if (kind === 'expression_statement') {
            const head = tree.nodes.find(n => n.field === 'function' && n.kind === 'identifier' && n.start === node.start);
            const word = head && textOf(compiler.source, head);
            if (['restore', 'uninterruptible', 'interruptible'].includes(word) &&
                tree.nodes.some(n => n.field === 'block' && n.start > head.end && n.end === node.end)) kind = 'vibe:' + word;
          }
          return { start: node.start, end: node.end, kind };
        });
      assert.deepEqual(bounds, compiler.statements.map(s => ({ ...s, kind: category(s.kind) })), 'top-level structure differs');
    }
  });
}

function sourcesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'out', 'expected'].includes(entry.name) || entry.name.startsWith('.')) return [];
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourcesUnder(file) : entry.isFile() && file.endsWith('.vibe') ? [readFileSync(file, 'utf8')] : [];
  });
}

// Simple token deletion/replacement and same-category statement splicing are
// metamorphic input exploration; acceptance itself always comes from D419.
function mutate(source, mutation) {
  if (mutation.kind === 'none') return source;
  const tokens = [...source.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*|\d+|[^\s]/gu)];
  if (!tokens.length) return source;
  const token = tokens[mutation.at % tokens.length];
  return source.slice(0, token.index) + (mutation.kind === 'delete' ? '' : mutation.text) + source.slice(token.index + token[0].length);
}
const mutation = fc.record({ kind: fc.constantFrom('none', 'delete', 'replace'),
  at: fc.nat({ max: 10000 }), text: fc.constantFrom('(', '}', ';', 'catch', '\n') });

const common = { command, regressions, numRuns: 10, diagnostics: () => failureDiagnostics,
  artifacts: input => Object.fromEntries(inputSources(input).map((source, i) => [`${i}.vibe`, source])) };
function inputSources(input) {
  if (input.source !== undefined) return [input.source];
  const original = input.bytes ? probe({ generate: input.bytes }).map(r => r.source)
    : input.project ? Object.entries(projectFiles(input.project).files).filter(([file]) => file.endsWith('.vibe')).map(([, text]) => text)
    : [input.chunks.join('\n')];
  return original.flatMap(source => [source, mutate(source, input.mutation)]);
}
async function differential(input) {
  try { compare(probe({ sources: inputSources(input) }), input.strictKnownFailures); }
  catch (error) { failureDiagnostics = diagnostics; throw error; }
}

// docs/design/history/src/428-part4-ch28-tooling.md (The editor) and
// docs/design/history/src/900-appendices.md (Grammar): editor syntax must agree with
// the compiler parser, independent of semantic/checker rejection. The compiler
// suite's specgen supplies recursive forms, contracts and patterns (Ch 11/13).
test('G1 generated programs and mutations', async () => {
  await checkProperty(fc, { ...common, name: 'grammar-generated', rule: `${editor}; ${grammar}`,
    arbitrary: fc.record({ bytes: fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 80 }), mutation }),
    check: differential });
});

// docs/design/history/src/428-part4-ch28-tooling.md (The editor) and
// docs/design/history/src/900-appendices.md (Grammar, D419); metamorphic statement splicing.
test('G1 acceptance cases, splices and mutations', async () => {
  const cases = sourcesUnder(join(root, 'typescript/vibelang/cases'));
  // Compiler surface statements give category-preserving deletion/splicing and
  // fast-check can shrink the statement list before shrinking mutation details.
  const parsed = probe({ sources: cases });
  const chunks = parsed.flatMap(r => r.valid ? r.statements.map(s => Buffer.from(r.source).subarray(s.start, s.end).toString()) : [r.source]);
  await checkProperty(fc, { ...common, name: 'grammar-cases', rule: `${editor}; ${grammar}; metamorphic statement splicing`,
    arbitrary: fc.oneof(
      fc.record({ chunks: fc.constantFrom(...cases).map(source => [source]), mutation }),
      fc.record({ chunks: fc.array(fc.constantFrom(...chunks), { minLength: 1, maxLength: 4 }), mutation })),
    check: differential });
});

// docs/design/history/src/428-part4-ch28-tooling.md (The editor) and
// docs/design/history/src/900-appendices.md (Grammar, D419), including TypeScript strings.
test('G1 shared project syntax and Unicode', async () => {
  await checkProperty(fc, { ...common, name: 'grammar-projects', rule: `${editor}; ${grammar}`,
    arbitrary: fc.record({ project: projectArbitrary(fc), mutation }), check: differential });
});

// docs/design/history/src/900-appendices.md (Grammar, Precedence) and
// docs/design/history/src/213-part2-ch13-calls.md (expression rules).
// catch follows every binary operator, including ??, in the precedence table.
test('G1 expression precedence', async () => {
  await checkProperty(fc, { ...common, name: 'grammar-precedence',
    rule: `${grammar}, Precedence; docs/design/history/src/213-part2-ch13-calls.md: expression rules`,
    generatorVersion: 2, arbitrary: fc.record({ operator: fc.constantFrom('+', '*', '||', '??', '|>'),
      left: fc.constantFrom('a', 'café', '雪'), right: fc.constantFrom('b', 'value') }),
    artifacts: input => ({ 'main.vibe': input.source ?? `const x = ${input.left} ${input.operator} ${input.right} catch fallback;\n` }),
    check(input) {
      try {
        const source = input.source ?? `const x = ${input.left} ${input.operator} ${input.right} catch fallback;\n`;
        const [compiler] = probe({ sources: [source] });
        compare([compiler]);
        const [tree] = trees([source]);
        const caught = tree.nodes.find(n => n.kind === 'catch_expression');
        const form = compiler.forms.find(f => f.name === 'catch_expression');
        assert.ok(form, 'compiler omitted catch syntax');
        if (!input.source) assert.equal(form.left.start, Buffer.byteLength(input.operator === '|>'
          ? `const x = ${input.left} |> ` : 'const x = '), 'Appendix precedence: catch follows binary operators, inside pipe');
        diagnostics = JSON.stringify({ compiler, tree: tree.tree });
        const left = tree.nodes.find(n => n.parent === 'catch_expression');
        // The saved gap is specifically ?? grouping its right operand's catch.
        if (!input.strictKnownFailures && hasGap('nullish-catch') && input.operator === '??' &&
            caught?.start === form.left.start + Buffer.byteLength(input.left + ' ?? ') &&
            left?.end === form.left.end && caught?.end === form.range.end) {
          gaps.add('nullish-catch');
        } else {
          assert.deepEqual(caught && { start: caught.start, end: caught.end }, form.range, 'catch grouping differs');
          assert.deepEqual(left && { start: left.start, end: left.end }, form.left, 'catch operand differs');
        }
        for (const pipe of compiler.forms.filter(f => f.name === 'pipe_expression')) {
          assert.ok(tree.nodes.some(n => n.kind === pipe.name && n.start === pipe.range.start && n.end === pipe.range.end), 'pipe grouping differs');
        }
      } catch (error) { failureDiagnostics = diagnostics; throw error; }
    } });
});

// docs/design/history/src/111-part1-ch11-stdlib.md (Data types) and
// docs/design/history/src/900-appendices.md (Grammar, Patterns): recursively composed
// patterns retain the same syntax in the editor, independently of exhaustivity.
test('G1 recursive patterns', async () => {
  const patterns = fc.letrec(tie => ({
    pattern: fc.oneof({ depthSize: 'small', maxDepth: 3, depthIdentifier: 'patterns' },
      fc.constantFrom('0', 'null', 'let value', 'Option.None', 'D.V { let field }'),
      tie('pattern').map(p => `[${p}]`), tie('pattern').map(p => `({ field: ${p} })`),
      fc.tuple(tie('pattern'), tie('pattern')).map(([a, b]) => `(${a} and ${b})`)),
  })).pattern;
  await checkProperty(fc, { ...common, name: 'grammar-patterns', rule: `${editor}; ${grammar}; docs/design/history/src/111-part1-ch11-stdlib.md: Data types`,
    arbitrary: patterns.map(pattern => ({ source: `const x = match (value) { when ${pattern}: 1; default: 0; };\n` })),
    check: differential });
});
