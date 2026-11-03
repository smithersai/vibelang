import type { Factory } from './target.vibe'
import { greet } from './consumer.vibe'

export { greeting } from './target.vibe'

export const twice = (fn: Factory): string => fn() + fn()

export const hello = (): string => greet()
