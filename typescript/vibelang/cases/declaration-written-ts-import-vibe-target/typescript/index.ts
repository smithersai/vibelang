import type { Factory } from './target.js'
import { greet } from './consumer.js'

export { greeting } from './target.js'

export const twice = (fn: Factory): string => fn() + fn()

export const hello = (): string => greet()
