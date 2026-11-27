'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  compileVibe,
  initWasmCompiler,
  type CompileResult,
  type CompilerDiagnostic,
  type WasmEngineStatus,
} from './PlaygroundCompiler'
import {
  countLines,
  estimateTokens,
  formatVibeSource,
  highlightCode,
} from './PlaygroundHighlight'
import {
  PLAYGROUND_PRESETS,
  getPresetById,
  type PlaygroundPreset,
} from './PlaygroundPresets'
import { buildSandboxSrcDoc } from './PlaygroundSandbox'
import './Playground.css'

type RightTab = 'preview' | 'compiled' | 'diagnostics'
type CompiledView = 'ts' | 'js' | 'dts'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((input.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function encodeShareHash(presetId: string, source: string): Promise<string> {
  const raw = new TextEncoder().encode(source)
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
      return `#preset=${encodeURIComponent(presetId)}&code=z:${toBase64Url(compressed)}`
    } catch {
      // Fall back to plain UTF-8 base64url when deflate-raw is unavailable.
    }
  }
  return `#preset=${encodeURIComponent(presetId)}&code=u:${toBase64Url(raw)}`
}

async function decodeShareHash(hash: string): Promise<{ presetId?: string; source?: string }> {
  const clean = hash.replace(/^#/, '')
  if (!clean) return {}
  const params = new URLSearchParams(clean)
  const presetId = params.get('preset') ?? undefined
  const encoded = params.get('code')
  if (!encoded) return { presetId }
  try {
    if (encoded.startsWith('z:') && typeof DecompressionStream === 'function') {
      const bytes = fromBase64Url(encoded.slice(2))
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      const text = await new Response(stream).text()
      return { presetId, source: text }
    }
    const payload = encoded.startsWith('u:') ? encoded.slice(2) : encoded
    const text = new TextDecoder().decode(fromBase64Url(payload))
    return { presetId, source: text }
  } catch {
    return { presetId }
  }
}

function detectTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const root = document.documentElement
  const inlineScheme = root.style.colorScheme
  if (inlineScheme.includes('dark') && !inlineScheme.includes('light')) return 'dark'
  if (inlineScheme.includes('light') && !inlineScheme.includes('dark')) return 'light'
  if (root.classList.contains('dark')) return 'dark'
  if (root.classList.contains('light')) return 'light'
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function Playground() {
  const [preset, setPreset] = useState<PlaygroundPreset>(PLAYGROUND_PRESETS[0])
  const [source, setSource] = useState<string>(PLAYGROUND_PRESETS[0].source)
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  const [compiledView, setCompiledView] = useState<CompiledView>('ts')
  const [wasmStatus, setWasmStatus] = useState<WasmEngineStatus>('loading')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [runId, setRunId] = useState<number>(1)
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [compiled, setCompiled] = useState<CompileResult>(() =>
    compileVibe(PLAYGROUND_PRESETS[0].filename, PLAYGROUND_PRESETS[0].source, PLAYGROUND_PRESETS[0])
  )

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const shareTimerRef = useRef<number | undefined>(undefined)
  const copyTimerRef = useRef<number | undefined>(undefined)

  // Observe Vocs color-scheme changes so the sandboxed preview matches light & dark themes.
  useEffect(() => {
    const sync = () => setTheme(detectTheme())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      mq?.removeEventListener('change', sync)
    }
  }, [])

  // Restore shared URL state (#preset=...&code=...) on initial load.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) return
    let cancelled = false
    void decodeShareHash(window.location.hash).then((decoded) => {
      if (cancelled) return
      const nextPreset = decoded.presetId ? getPresetById(decoded.presetId) : PLAYGROUND_PRESETS[0]
      if (decoded.presetId) setPreset(nextPreset)
      if (decoded.source !== undefined) {
        setSource(decoded.source)
      } else if (decoded.presetId) {
        setSource(nextPreset.source)
      }
      if (nextPreset.id === 'diagnostics-lab') {
        setRightTab('diagnostics')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Lazily boot the Go WASM compiler in the background while Instant Preview is already live.
  useEffect(() => {
    let cancelled = false
    void initWasmCompiler().then((ok) => {
      if (cancelled) return
      setWasmStatus(ok ? 'ready' : 'fallback')
    })
    return () => {
      cancelled = true
      window.clearTimeout(shareTimerRef.current)
      window.clearTimeout(copyTimerRef.current)
    }
  }, [])

  // Debounced live compile on source, preset, or WASM engine readiness change.
  useEffect(() => {
    const delay = wasmStatus === 'ready' ? 140 : 40
    const timer = window.setTimeout(() => {
      const next = compileVibe(preset.filename, source, preset)
      setCompiled(next)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [source, preset, wasmStatus])

  const selectPreset = useCallback((nextId: string) => {
    const next = getPresetById(nextId)
    setPreset(next)
    setSource(next.source)
    setActiveLine(null)
    setRunId((n) => n + 1)
    setRightTab(next.id === 'diagnostics-lab' ? 'diagnostics' : 'preview')
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const handleFormat = useCallback(() => {
    setSource((prev) => formatVibeSource(prev))
  }, [])

  const handleReset = useCallback(() => {
    setSource(preset.source)
    setActiveLine(null)
    setRunId((n) => n + 1)
  }, [preset])

  const handleRun = useCallback(() => {
    const next = compileVibe(preset.filename, source, preset)
    setCompiled(next)
    setRunId((n) => n + 1)
    if (rightTab !== 'preview') {
      setRightTab('preview')
    }
  }, [preset, source, rightTab])

  const handleShare = useCallback(async () => {
    window.clearTimeout(shareTimerRef.current)
    try {
      const hash = await encodeShareHash(preset.id, source)
      const url = `${window.location.origin}${window.location.pathname}${hash}`
      window.history.replaceState(null, '', hash)
      await navigator.clipboard.writeText(url)
      setShareState('copied')
    } catch {
      setShareState('error')
    }
    shareTimerRef.current = window.setTimeout(() => setShareState('idle'), 2_200)
  }, [preset.id, source])

  const compiledDisplayText = useMemo(() => {
    if (compiledView === 'js') return compiled.js || '// No JavaScript emitted.'
    if (compiledView === 'dts') return compiled.dts || '// No declaration file emitted.'
    return compiled.tsProjection || preset.fallbackTs
  }, [compiledView, compiled.js, compiled.dts, compiled.tsProjection, preset.fallbackTs])

  const handleCopyCompiled = useCallback(async () => {
    window.clearTimeout(copyTimerRef.current)
    try {
      await navigator.clipboard.writeText(compiledDisplayText)
      setCopyState('copied')
      copyTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1_800)
    } catch {
      // Ignore clipboard failure silently in restricted contexts.
    }
  }, [compiledDisplayText])

  const jumpToDiagnostic = useCallback(
    (diag: CompilerDiagnostic) => {
      setActiveLine(diag.line)
      const el = textareaRef.current
      if (!el) return
      const lines = source.split('\n')
      let offset = 0
      const targetLine = Math.max(1, Math.min(diag.line, lines.length))
      for (let i = 0; i < targetLine - 1; i++) {
        offset += lines[i].length + 1
      }
      const lineLen = lines[targetLine - 1]?.length ?? 0
      const start = offset + Math.max(0, Math.min(diag.col - 1, lineLen))
      const end = offset + lineLen
      el.focus()
      el.setSelectionRange(start, Math.max(start, end))
      const approxScrollTop = Math.max(0, (targetLine - 5) * 21)
      el.scrollTop = approxScrollTop
      if (highlightRef.current) highlightRef.current.scrollTop = approxScrollTop
      if (gutterRef.current) gutterRef.current.scrollTop = approxScrollTop
    },
    [source]
  )

  const handleEditorScroll = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    if (highlightRef.current) {
      highlightRef.current.scrollTop = el.scrollTop
      highlightRef.current.scrollLeft = el.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = el.scrollTop
    }
  }, [])

  const handleEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleRun()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const el = event.currentTarget
        const start = el.selectionStart
        const end = el.selectionEnd
        const next = `${source.slice(0, start)}  ${source.slice(end)}`
        setSource(next)
        window.requestAnimationFrame(() => {
          el.setSelectionRange(start + 2, start + 2)
        })
      }
    },
    [handleRun, source]
  )

  const diagByLine = useMemo(() => {
    const map = new Map<number, CompilerDiagnostic[]>()
    for (const d of compiled.diagnostics) {
      const list = map.get(d.line) ?? []
      list.push(d)
      map.set(d.line, list)
    }
    return map
  }, [compiled.diagnostics])

  const errorCount = useMemo(
    () => compiled.diagnostics.filter((d) => d.severity === 'error').length,
    [compiled.diagnostics]
  )
  const warningCount = useMemo(
    () => compiled.diagnostics.filter((d) => d.severity === 'warning').length,
    [compiled.diagnostics]
  )

  const highlightedSource = useMemo(() => highlightCode(source), [source])
  const highlightedCompiled = useMemo(() => highlightCode(compiledDisplayText), [compiledDisplayText])

  const lines = useMemo(() => source.split('\n'), [source])
  const vibeLines = useMemo(() => countLines(source), [source])
  const vibeTokens = useMemo(() => estimateTokens(source), [source])
  const tsLines = useMemo(() => countLines(compiled.tsProjection || preset.fallbackTs), [compiled.tsProjection, preset.fallbackTs])
  const tsTokens = useMemo(() => estimateTokens(compiled.tsProjection || preset.fallbackTs), [compiled.tsProjection, preset.fallbackTs])
  const tokenSavingsPct = tsTokens > 0 ? Math.round(((tsTokens - vibeTokens) / tsTokens) * 100) : 0

  const sandboxDoc = useMemo(
    () =>
      buildSandboxSrcDoc({
        js: compiled.js || preset.fallbackJs,
        previewMode: preset.previewMode,
        theme,
        runId,
      }),
    [compiled.js, preset.fallbackJs, preset.previewMode, theme, runId]
  )

  const engineBadge =
    wasmStatus === 'ready'
      ? { label: `WASM 0.0.14 · ${compiled.elapsedMs.toFixed(1)}ms`, tone: 'ok' }
      : wasmStatus === 'loading'
        ? { label: `Instant Preview · ${compiled.elapsedMs.toFixed(1)}ms`, tone: 'accent' }
        : { label: `Instant Preview · ${compiled.elapsedMs.toFixed(1)}ms`, tone: 'neutral' }

  return (
    <div className="vibe-playground">
      <div className="vp-header">
        <div className="vp-header__title">
          <div className="vp-header__eyebrow">Interactive Browser Compiler</div>
          <h1>
            <span className="vibe-gradient">Vibe Playground</span>
          </h1>
          <p className="vp-header__sub">{preset.summary}</p>
        </div>

        <div className="vp-header__status">
          <span
            className={`vp-pill vp-pill--${engineBadge.tone}`}
            title={
              wasmStatus === 'ready'
                ? 'Compiled in-browser with the Go WebAssembly VibeLang compiler.'
                : 'Running in Instant Zero-Wait Preview mode. Build site/public/playground/vibelang.wasm via scripts/build-playground-wasm.sh for full WASM checking.'
            }
          >
            <span className="vp-dot" aria-hidden="true" />
            {engineBadge.label}
          </span>
        </div>
      </div>

      <div className="vp-toolbar" role="region" aria-label="Playground controls">
        <div className="vp-presets" role="tablist" aria-label="Curated presets">
          {PLAYGROUND_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === preset.id}
              className={`vp-preset-pill${item.id === preset.id ? ' is-active' : ''}`}
              onClick={() => selectPreset(item.id)}
            >
              <span className="vp-preset-pill__cat">{item.category}</span>
              <span>{item.shortTitle}</span>
            </button>
          ))}
        </div>

        <label className="vp-preset-select-wrap">
          <span className="vp-sr-only">Choose preset</span>
          <select
            className="vp-preset-select"
            value={preset.id}
            onChange={(e) => selectPreset(e.target.value)}
            aria-label="Choose playground preset"
          >
            {PLAYGROUND_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <div className="vp-actions">
          <button
            type="button"
            className="vp-btn vp-btn--primary"
            onClick={handleRun}
            title="Compile and run preview (Ctrl/Cmd + Enter)"
          >
            Run
          </button>
          <button type="button" className="vp-btn" onClick={handleFormat}>
            Format
          </button>
          <button type="button" className="vp-btn" onClick={handleReset}>
            Reset
          </button>
          <button
            type="button"
            className="vp-btn"
            onClick={handleShare}
            aria-live="polite"
          >
            {shareState === 'copied'
              ? 'Link Copied'
              : shareState === 'error'
                ? 'Copy Failed'
                : 'Share URL'}
          </button>
        </div>
      </div>

      <div className="vp-workbench">
        <section className="vp-pane vp-pane--editor" aria-label="Vibe code editor">
          <div className="vp-pane__bar">
            <div className="vp-pane__meta">
              <span className="vp-file-tab">{preset.filename}</span>
              <span className="vp-meta-text">
                {vibeLines} lines · ~{vibeTokens} tokens
              </span>
            </div>
            <div className="vp-pane__meta">
              {errorCount > 0 ? (
                <button
                  type="button"
                  className="vp-pill vp-pill--err"
                  onClick={() => setRightTab('diagnostics')}
                >
                  {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                </button>
              ) : (
                <span className="vp-pill vp-pill--ok">0 errors</span>
              )}
              {warningCount > 0 && (
                <button
                  type="button"
                  className="vp-pill vp-pill--warn"
                  onClick={() => setRightTab('diagnostics')}
                >
                  {warningCount} warn
                </button>
              )}
            </div>
          </div>

          <div className="vp-editor-shell">
            <div className="vp-gutter" ref={gutterRef} aria-hidden="true">
              {lines.map((_line, idx) => {
                const lineNum = idx + 1
                const lineDiags = diagByLine.get(lineNum)
                const hasError = lineDiags?.some((d) => d.severity === 'error')
                const hasWarn = !hasError && Boolean(lineDiags?.length)
                return (
                  <button
                    key={lineNum}
                    type="button"
                    tabIndex={-1}
                    className={`vp-gutter__line${activeLine === lineNum ? ' is-focused' : ''}${
                      hasError ? ' has-error' : hasWarn ? ' has-warn' : ''
                    }`}
                    title={lineDiags ? lineDiags.map((d) => `${d.code}: ${d.message}`).join('\n') : undefined}
                    onClick={() => {
                      if (lineDiags?.[0]) jumpToDiagnostic(lineDiags[0])
                    }}
                  >
                    <span className="vp-gutter__marker" />
                    <span>{lineNum}</span>
                  </button>
                )
              })}
            </div>

            <div className="vp-editor-canvas">
              <pre
                ref={highlightRef}
                className="vp-editor-highlight"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: highlightedSource }}
              />
              <textarea
                ref={textareaRef}
                className="vp-editor-input"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onScroll={handleEditorScroll}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                aria-label={`Vibe source editor for ${preset.filename}`}
              />
            </div>
          </div>

          {compiled.diagnostics.length > 0 && (
            <div className="vp-inline-diag" role="status" aria-live="polite">
              {compiled.diagnostics.slice(0, 3).map((d, idx) => (
                <button
                  key={`${d.code}-${d.line}-${idx}`}
                  type="button"
                  className="vp-inline-diag__row"
                  onClick={() => jumpToDiagnostic(d)}
                >
                  <span className={`vp-code-chip vp-code-chip--${d.severity}`}>{d.code}</span>
                  <span className="vp-inline-diag__msg">{d.message.split('\n')[0]}</span>
                  <span className="vp-inline-diag__loc">
                    Ln {d.line}:{d.col}
                  </span>
                </button>
              ))}
              {compiled.diagnostics.length > 3 && (
                <button
                  type="button"
                  className="vp-inline-diag__more"
                  onClick={() => setRightTab('diagnostics')}
                >
                  View all {compiled.diagnostics.length} diagnostics →
                </button>
              )}
            </div>
          )}
        </section>

        <section className="vp-pane vp-pane--output" aria-label="Playground output">
          <div className="vp-pane__bar">
            <div className="vp-tabs" role="tablist" aria-label="Output views">
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'preview'}
                className={`vp-tab${rightTab === 'preview' ? ' is-active' : ''}`}
                onClick={() => setRightTab('preview')}
              >
                {preset.previewMode === 'console' ? 'Live Output' : 'Live Preview'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'compiled'}
                className={`vp-tab${rightTab === 'compiled' ? ' is-active' : ''}`}
                onClick={() => setRightTab('compiled')}
              >
                Compiled Effect TS
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'diagnostics'}
                className={`vp-tab${rightTab === 'diagnostics' ? ' is-active' : ''}`}
                onClick={() => setRightTab('diagnostics')}
              >
                Diagnostics
                <span className={`vp-tab__count${errorCount > 0 ? ' is-err' : ''}`}>
                  {compiled.diagnostics.length}
                </span>
              </button>
            </div>

            {rightTab === 'preview' && (
              <button
                type="button"
                className="vp-btn vp-btn--sm"
                onClick={() => setRunId((n) => n + 1)}
              >
                Re-run
              </button>
            )}
            {rightTab === 'compiled' && (
              <button type="button" className="vp-btn vp-btn--sm" onClick={handleCopyCompiled}>
                {copyState === 'copied' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {rightTab === 'preview' && (
            <div className="vp-preview-wrap">
              <iframe
                key={`${preset.id}-${runId}-${theme}`}
                className="vp-preview-frame"
                title={`Sandboxed live preview for ${preset.title}`}
                sandbox="allow-scripts"
                srcDoc={sandboxDoc}
              />
            </div>
          )}

          {rightTab === 'compiled' && (
            <div className="vp-compiled-wrap">
              <div className="vp-compiled-bar">
                <div className="vp-subtabs" role="tablist" aria-label="Compiled output format">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={compiledView === 'ts'}
                    className={`vp-subtab${compiledView === 'ts' ? ' is-active' : ''}`}
                    onClick={() => setCompiledView('ts')}
                  >
                    Effect TS
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={compiledView === 'js'}
                    className={`vp-subtab${compiledView === 'js' ? ' is-active' : ''}`}
                    onClick={() => setCompiledView('js')}
                  >
                    JavaScript
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={compiledView === 'dts'}
                    className={`vp-subtab${compiledView === 'dts' ? ' is-active' : ''}`}
                    onClick={() => setCompiledView('dts')}
                  >
                    .d.ts
                  </button>
                </div>

                <div className="vp-delta-badge" title="Estimated comparison between Vibe input and lowered Effect TypeScript">
                  <span>
                    Vibe {vibeLines}L (~{vibeTokens}t) vs TS {tsLines}L (~{tsTokens}t)
                  </span>
                  {tokenSavingsPct > 0 && (
                    <strong className="vp-delta-badge__save">−{tokenSavingsPct}% tokens</strong>
                  )}
                </div>
              </div>

              <pre
                className="vp-compiled-code"
                dangerouslySetInnerHTML={{ __html: highlightedCompiled }}
              />
            </div>
          )}

          {rightTab === 'diagnostics' && (
            <div className="vp-diag-panel">
              <div className="vp-diag-panel__head">
                <span>
                  {compiled.diagnostics.length === 0
                    ? 'All checks passed with zero diagnostics.'
                    : `${compiled.diagnostics.length} diagnostic${compiled.diagnostics.length === 1 ? '' : 's'} reported`}
                </span>
                <a className="vp-doc-link" href="/vibelang-features/diagnostic-code-map">
                  Diagnostic code reference →
                </a>
              </div>

              {compiled.diagnostics.length === 0 ? (
                <div className="vp-diag-empty">
                  <strong>Clean compile</strong>
                  <p>
                    Try introducing a Vibe rule violation (such as <code>service class Foo</code> or{' '}
                    <code>try</code> outside an <code>effect</code> function), or load the{' '}
                    <button
                      type="button"
                      className="vp-link-btn"
                      onClick={() => selectPreset('diagnostics-lab')}
                    >
                      Diagnostics Lab
                    </button>{' '}
                    preset.
                  </p>
                </div>
              ) : (
                <ul className="vp-diag-list">
                  {compiled.diagnostics.map((d, idx) => (
                    <li key={`${d.code}-${d.line}-${d.col}-${idx}`} className="vp-diag-card">
                      <div className="vp-diag-card__top">
                        <div className="vp-diag-card__badges">
                          <span className={`vp-code-chip vp-code-chip--${d.severity}`}>{d.code}</span>
                          <span className="vp-diag-card__sev">{d.severity}</span>
                        </div>
                        <div className="vp-diag-card__actions">
                          <button
                            type="button"
                            className="vp-btn vp-btn--sm"
                            onClick={() => jumpToDiagnostic(d)}
                          >
                            Ln {d.line}, Col {d.col}
                          </button>
                          <a className="vp-doc-link" href="/vibelang-features/diagnostic-code-map">
                            Docs
                          </a>
                        </div>
                      </div>
                      <p className="vp-diag-card__msg">{d.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
