'use client'

import { useEffect, useRef, useState } from 'react'

const prompt = `Read https://vibelang.sh/llms-full.txt, then help me build my first VibeLang project.`

export function CopyPromptButton() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  async function copyPrompt() {
    window.clearTimeout(resetTimer.current)

    try {
      await navigator.clipboard.writeText(prompt)
      setStatus('copied')
    } catch {
      setStatus('error')
    }

    resetTimer.current = window.setTimeout(() => setStatus('idle'), 2_000)
  }

  return (
    <div className="vibelang-copy-prompt-wrap" data-status={status}>
      <button
        className="vibelang-copy-prompt"
        onClick={copyPrompt}
        type="button"
      >
        <svg className="vibelang-copy-prompt__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.5 5.5V4.25A1.75 1.75 0 0 1 8.25 2.5h7.5a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75H14.5" />
          <rect x="2.5" y="6.5" width="11" height="11" rx="1.75" />
        </svg>
        <span>Copy Prompt</span>
      </button>
      <span className="vibelang-copy-prompt__preview" role="status" aria-live="polite">
        <span className="vibelang-copy-prompt__prompt">“Read vibelang.sh/llms-full.txt, then help me build...”</span>
        <span className="vibelang-copy-prompt__feedback vibelang-copy-prompt__feedback--success">
          <strong>✓</strong> Copied — paste it into your coding agent to get started.
        </span>
        <span className="vibelang-copy-prompt__feedback vibelang-copy-prompt__feedback--error">
          <strong>!</strong> Could not copy prompt
        </span>
      </span>
    </div>
  )
}
