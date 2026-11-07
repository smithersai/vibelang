import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as ts from 'typescript'

const sha = value => createHash('sha256').update(value).digest('hex')

// Review source and compiled artifacts together, before writing any of them.
export function patchVocsModule(root, spec) {
  const vendor = join(realpathSync(root), 'node_modules/vocs')
  if (realpathSync(vendor) !== vendor) throw new Error('Refusing to patch borrowed Vocs dependencies.')
  const version = JSON.parse(readFileSync(join(vendor, 'package.json'), 'utf8')).version
  if (version !== '2.8.5') throw new Error('Unsupported Vocs ' + version + '; review the accessibility patch before upgrading.')
  const files = [
    join(vendor, 'src/react/internal', spec.name + '.tsx'),
    join(vendor, 'dist/react/internal', spec.name + '.js'),
    join(vendor, 'dist/react/internal', spec.name + '.js.map'),
  ]
  for (const file of files) if (realpathSync(file) !== file) throw new Error('Refusing to patch borrowed Vocs file: ' + basename(file))
  let source = readFileSync(files[0], 'utf8')
  const hash = sha(source)
  if (hash === spec.hashes.source) {
    if (source.split(spec.before).length !== 2) throw new Error('Vocs ' + spec.name + ' source patch does not match exactly once.')
    source = source.replace(spec.before, spec.after)
  } else if (hash !== spec.hashes.patched) throw new Error('Vocs ' + spec.name + ' source hash changed; review the patch.')
  if (sha(source) !== spec.hashes.patched) throw new Error('Patched Vocs source hash did not match the reviewed patch.')
  const output = ts.transpileModule(source, {
    fileName: spec.name + '.tsx', reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX, sourceMap: true, inlineSources: true,
      sourceRoot: '../../../src/react/internal', newLine: ts.NewLineKind.LineFeed,
    },
  })
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Patched Vocs module did not compile.')
  const values = [source, output.outputText, output.sourceMapText]
  const original = [spec.hashes.source, spec.hashes.javascript, spec.hashes.map]
  for (let i = 0; i < files.length; i++) {
    if (typeof values[i] !== 'string') throw new Error('Patched Vocs module output is incomplete.')
    const current = sha(readFileSync(files[i]))
    if (current !== original[i] && current !== sha(values[i])) throw new Error('Vocs ' + basename(files[i]) + ' has unexpected changes; refusing to overwrite it.')
  }
  let changed = false
  for (let i = 0; i < files.length; i++) {
    if (sha(readFileSync(files[i])) === sha(values[i])) continue
    const staged = files[i] + '.vibelang-' + process.pid
    try { writeFileSync(staged, values[i]); renameSync(staged, files[i]) }
    finally { rmSync(staged, { force: true }) }
    changed = true
  }
  return { changed, version }
}

