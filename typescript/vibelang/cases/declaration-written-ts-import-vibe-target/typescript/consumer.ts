import { type Factory } from './target.js'
import { greeting } from './target.js'

export type { Factory as Maker } from './target.js'

export const invoke: {
    /** @throws {never} */
    (fn: Factory): string;
} = (fn: Factory): string => fn()

export const greet: {
    /** @throws {never} */
    (): string;
} = (): string => invoke(greeting)
