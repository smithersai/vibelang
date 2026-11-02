// TypeScript sees every .vibe function as an Effect, a plain one too.
import { double } from "./services.js"

export const doubled = double(2)
