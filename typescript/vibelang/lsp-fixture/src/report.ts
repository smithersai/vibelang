// TypeScript calls a plain .vibe function as the JavaScript it is (VIP-1).
import { double } from "./services.js"

export const doubled = double(2)
