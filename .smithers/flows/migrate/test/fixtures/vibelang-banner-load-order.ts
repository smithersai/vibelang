import { readFileSync } from "node:fs"
import { settings } from "./settings.js"

settings.root = "/etc/app"

export const banner = readFileSync(settings.root + "/banner.txt", "utf8")

export const title = (name: string): string => banner + name
