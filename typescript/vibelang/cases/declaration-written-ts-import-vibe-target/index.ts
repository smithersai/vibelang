import type { Factory } from './target.ts'
import { greet } from './consumer.ts'

export { greeting } from './target.ts'

export const twice = (fn: Factory): string => fn() + fn()

export const hello = (): string => greet()
