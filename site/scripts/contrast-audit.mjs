import assert from 'node:assert/strict'
import AxeBuilder from '@axe-core/playwright'

export async function auditPageContrast(page) {
  // The built pages have one document. The partial-results adapter opens a
  // second renderer and transfers a serialized copy of the audit there.
  // Post-merge diagnostics caught renderer OOM kills while finishing audits.
  // axe.run checks the same rules in place, including shadow DOM, without that
  // redundant allocation.
  // Refuse future frames rather than silently losing cross-origin coverage.
  assert.equal(page.frames().length, 1, 'Single document contrast audits require no child frames; add frame-aware coverage before introducing frames.')
  return new AxeBuilder({ page }).setLegacyMode().withRules(['color-contrast']).analyze()
}
