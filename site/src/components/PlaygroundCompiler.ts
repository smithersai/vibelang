import type { PlaygroundPreset } from './PlaygroundPresets'

export interface CompilerDiagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'suggestion' | 'message'
  readonly message: string
  readonly line: number
  readonly col: number
  readonly endLine: number
  readonly endCol: number
}

export interface CompileResult {
  readonly js: string
  readonly dts: string
  readonly tsProjection: string
  readonly diagnostics: ReadonlyArray<CompilerDiagnostic>
  readonly elapsedMs: number
  readonly engine: 'wasm' | 'instant'
}

export type WasmEngineStatus = 'loading' | 'ready' | 'fallback'

interface GoRuntimeInstance {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}

interface GoConstructor {
  new (): GoRuntimeInstance
}

declare global {
  interface Window {
    Go?: GoConstructor
    vibelangCompile?: (req: { filename: string; source: string }) => {
      js: string
      dts: string
      tsProjection: string
      diagnostics: ReadonlyArray<CompilerDiagnostic>
      elapsedMs: number
    }
    __vibelangWasmReady?: boolean
  }
}

let wasmLoadPromise: Promise<boolean> | null = null
let wasmReady = false

export function isWasmCompilerReady(): boolean {
  return wasmReady && typeof window !== 'undefined' && typeof window.vibelangCompile === 'function'
}

async function loadScript(src: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  if (typeof window.Go === 'function') return true
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(typeof window.Go === 'function'), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve(typeof window.Go === 'function')
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })
}

export function initWasmCompiler(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (isWasmCompilerReady()) return Promise.resolve(true)
  if (wasmLoadPromise) return wasmLoadPromise

  wasmLoadPromise = (async () => {
    try {
      let wasmUrl = '/playground/vibelang.wasm'
      let isGzipped = false
      const rawProbe = await fetch(wasmUrl, { method: 'HEAD' })
      if (!rawProbe.ok) {
        if (typeof DecompressionStream !== 'function') return false
        const gzProbe = await fetch('/playground/vibelang.wasm.gz', { method: 'HEAD' })
        if (!gzProbe.ok) return false
        wasmUrl = '/playground/vibelang.wasm.gz'
        isGzipped = true
      }

      const hasRuntime = await loadScript('/playground/wasm_exec.js')
      if (!hasRuntime || typeof window.Go !== 'function') return false

      const go = new window.Go()
      const response = await fetch(wasmUrl)
      if (!response.ok) return false

      let instantiated: WebAssembly.WebAssemblyInstantiatedSource
      if (isGzipped) {
        if (!response.body) return false
        const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'))
        const bytes = await new Response(decompressed).arrayBuffer()
        instantiated = await WebAssembly.instantiate(bytes, go.importObject)
      } else if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          instantiated = await WebAssembly.instantiateStreaming(response.clone(), go.importObject)
        } catch {
          const bytes = await response.arrayBuffer()
          instantiated = await WebAssembly.instantiate(bytes, go.importObject)
        }
      } else {
        const bytes = await response.arrayBuffer()
        instantiated = await WebAssembly.instantiate(bytes, go.importObject)
      }

      void go.run(instantiated.instance)

      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        if (typeof window.vibelangCompile === 'function') {
          wasmReady = true
          return true
        }
        await new Promise((r) => setTimeout(r, 25))
      }
      return false
    } catch {
      return false
    }
  })()

  return wasmLoadPromise
}

export function compileVibe(
  filename: string,
  source: string,
  preset: PlaygroundPreset
): CompileResult {
  if (isWasmCompilerReady() && window.vibelangCompile) {
    const raw = window.vibelangCompile({ filename, source })
    return {
      js: raw.js,
      dts: raw.dts,
      tsProjection: raw.tsProjection,
      diagnostics: raw.diagnostics ?? [],
      elapsedMs: raw.elapsedMs,
      engine: 'wasm',
    }
  }
  return compileInstantFallback(source, preset)
}

function compileInstantFallback(source: string, preset: PlaygroundPreset): CompileResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const diagnostics = analyzeFallbackDiagnostics(source)
  const untouched = source.trim() === preset.source.trim()

  const tsProjection = untouched ? preset.fallbackTs : transformVibeToEffectTs(source)
  const js = untouched ? preset.fallbackJs : transformVibeToRunnableJs(source)
  const dts = untouched ? preset.fallbackDts : extractFallbackDts(source)

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    js,
    dts,
    tsProjection,
    diagnostics,
    elapsedMs: Math.max(0.1, Number((ended - started).toFixed(2))),
    engine: 'instant',
  }
}

function analyzeFallbackDiagnostics(source: string): CompilerDiagnostic[] {
  const diags: CompilerDiagnostic[] = []
  const lines = source.split('\n')
  const serviceNames = new Set<string>()
  let inEffectDepth = 0
  let braceDepth = 0
  const effectExitDepths: number[] = []

  lines.forEach((line, index) => {
    const lineNo = index + 1
    const trimmed = line.trim()
    if (trimmed.startsWith('//')) return

    const svcClassMatch = /\bservice\s+class\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (svcClassMatch) {
      serviceNames.add(svcClassMatch[1])
      diags.push({
        code: 'EK0909',
        severity: 'error',
        message: 'A service declaration writes `service Name`, not `service class Name`. Remove `class`.',
        line: lineNo,
        col: svcClassMatch.index + 1,
        endLine: lineNo,
        endCol: svcClassMatch.index + svcClassMatch[0].length + 1,
      })
    }

    const svcMatch = /\bservice\s+([A-Za-z_$][\w$]*)\b/.exec(line)
    if (svcMatch && svcMatch[1] !== 'class') {
      serviceNames.add(svcMatch[1])
    }

    const missingFn = /^\s*(?:export\s+)?effect\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line)
    if (missingFn && missingFn[1] !== 'function') {
      diags.push({
        code: 'EK0101',
        severity: 'error',
        message: `Insert \`function\` after \`effect\`: write \`effect function ${missingFn[1]}(...)\`.`,
        line: lineNo,
        col: (missingFn.index ?? 0) + 1,
        endLine: lineNo,
        endCol: line.length + 1,
      })
    }

    const layerDecl = /^\s*(?:export\s+)?layer\s+[A-Za-z_$][\w$]*\s*:/.exec(line)
    if (layerDecl) {
      diags.push({
        code: 'EK2121',
        severity: 'error',
        message: 'Retired `layer Name: Service` declaration. Write `Layer.succeed(...)` or `Layer.effect(...)`.',
        line: lineNo,
        col: 1,
        endLine: lineNo,
        endCol: line.length + 1,
      })
    }

    for (const svc of serviceNames) {
      const newSvc = new RegExp(`\\bnew\\s+${svc}\\b`).exec(line)
      if (newSvc) {
        diags.push({
          code: 'EK3003',
          severity: 'error',
          message: `\`${svc}\` is a service key, not a class to construct. Provide an implementation with \`Layer.succeed(${svc}, ...)\`.`,
          line: lineNo,
          col: newSvc.index + 1,
          endLine: lineNo,
          endCol: newSvc.index + newSvc[0].length + 1,
        })
      }
    }

    const tryCatchPair = /\btry\s+[^;\n]+\bcatch\b/.exec(line)
    if (tryCatchPair) {
      diags.push({
        code: 'EK0505',
        severity: 'error',
        message: 'Write either `try expr` or `expr catch handler`, never both.',
        line: lineNo,
        col: tryCatchPair.index + 1,
        endLine: lineNo,
        endCol: tryCatchPair.index + tryCatchPair[0].length + 1,
      })
    }

    if (/\beffect\s+(?:function\b|\([^)]*\)\s*=>|\{)/.test(line)) {
      effectExitDepths.push(braceDepth)
      inEffectDepth++
    }

    if (inEffectDepth === 0) {
      const strayTry = /\btry(?:\.(?:all|race|any|allSettled))?\s+/.exec(line)
      if (strayTry && !/\btry\s*\{/.test(line)) {
        diags.push({
          code: 'EK0502',
          severity: 'error',
          message: '`try` runs an Effect only inside an `effect` function or `effect { }` block.',
          line: lineNo,
          col: strayTry.index + 1,
          endLine: lineNo,
          endCol: strayTry.index + strayTry[0].length + 1,
        })
      }
    }

    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    braceDepth = Math.max(0, braceDepth + opens - closes)
    while (effectExitDepths.length > 0 && braceDepth <= effectExitDepths[effectExitDepths.length - 1]) {
      effectExitDepths.pop()
      inEffectDepth = Math.max(0, inEffectDepth - 1)
    }
  })

  return diags
}

function transformVibeToEffectTs(source: string): string {
  let out = source
  out = out.replace(
    /\berror\s+([A-Za-z_$][\w$]*)\s*\{([^}]*)\}/g,
    'class $1 extends Data.TaggedError("$1")<{$2}> {}'
  )
  out = out.replace(
    /\bschema\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]+)/g,
    'const $1 = Schema.Literals([$2])\ntype $1 = typeof $1.Type'
  )
  out = out.replace(
    /\bdata\s+([A-Za-z_$][\w$]*)\s*\{([^}]*)\}/g,
    'type $1 = Data.TaggedEnum<{$2}>\nconst $1 = Data.taggedEnum<$1>()'
  )
  out = out.replace(
    /\bservice\s+([A-Za-z_$][\w$]*)\s*\{([^}]*)\}/g,
    'class $1 extends Context.Service<$1, {$2}>()("playground#$1") {}'
  )
  out = out.replace(/\beffect\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g, 'function $1($2) {\n  return Effect.gen(function* () {')
  out = out.replace(/\btry\.all\s+\[/g, 'yield* Effect.all([')
  out = out.replace(/\btry\.race\s+\[/g, 'yield* Effect.raceAllFirst([')
  out = out.replace(/\btry\s+/g, 'yield* ')
  out = out.replace(/\bfork\s+/g, 'yield* Effect.forkChild(')
  out = out.replace(/\bjoin\s+/g, 'yield* Fiber.join(')
  return `// Instant Effect TypeScript Preview (live WASM compiler loads automatically when built)\nimport * as Console from "effect/Console"\nimport * as Context from "effect/Context"\nimport * as Data from "effect/Data"\nimport * as Effect from "effect/Effect"\nimport * as Fiber from "effect/Fiber"\nimport * as Layer from "effect/Layer"\nimport * as Schema from "effect/Schema"\n\n${out}`
}

function transformVibeToRunnableJs(source: string): string {
  // Lightweight runnable transform used only when the user edits code while WASM is absent.
  const lines = source.split('\n')
  const kept = lines.filter((l) => !/^\s*(?:interface|type)\s+/.test(l))
  let js = kept.join('\n')
  js = js.replace(/\bschema\s+[A-Za-z_$][\w$]*\s*=\s*[^\n]+/g, '')
  js = js.replace(/\bschema\s+[A-Za-z_$][\w$]*\s*\{[^}]*\}/g, '')
  js = js.replace(/\berror\s+([A-Za-z_$][\w$]*)\s*\{[^}]*\}/g, 'class $1 extends runtime.TaggedError("$1") {}')
  js = js.replace(/\bdata\s+([A-Za-z_$][\w$]*)\s*\{[^}]*\}/g, 'const $1 = Data.taggedEnum();')
  js = js.replace(/\bservice\s+([A-Za-z_$][\w$]*)\s*\{[^}]*\}/g, 'class $1 extends runtime.$service("playground#$1") {}')
  return js
}

function extractFallbackDts(source: string): string {
  const exports: string[] = ['import type * as Effect from "effect/Effect";']
  for (const m of source.matchAll(/export\s+(effect\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    const isEffect = Boolean(m[1])
    exports.push(
      `export declare function ${m[2]}(${m[3]}): ${isEffect ? 'Effect.Effect<unknown, unknown, unknown>' : 'unknown'};`
    )
  }
  for (const m of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) {
    exports.push(`export declare const ${m[1]}: unknown;`)
  }
  return exports.join('\n') + '\n'
}
