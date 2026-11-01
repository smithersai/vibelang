import { build } from 'rolldown'
import { fileURLToPath } from 'node:url'
await build({ input: fileURLToPath(new URL('./entry.ts', import.meta.url)), platform: 'node', output: { file: fileURLToPath(new URL('./bundle.js', import.meta.url)), format: 'esm' } })
const { answer } = await import('./bundle.js')
if (answer() !== 42) throw new Error('wrong product result')
