import { test } from 'node:test'
import { checkSiteContrast } from './contrast.mjs'

// Run "bun run build" and "bunx playwright install chromium" in site/ first.
test('built home, onboarding and cheat sheet have zero contrast violations in both themes', { timeout: 600_000 }, checkSiteContrast)
