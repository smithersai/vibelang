// Validate built page and fragment targets, retaining the former renderer's checks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

type Page = {
  ids: Set<string>
  links: string[]
  images: string[]
  meta: Map<string, string>
  hasTopNavGitHub: boolean
}

async function readPage(file: string): Promise<Page> {
  const page: Page = { ids: new Set<string>(), links: [] as string[], images: [] as string[], meta: new Map<string, string>(), hasTopNavGitHub: false }
  await new HTMLRewriter()
    .on("meta", { element(e) {
      const key = e.getAttribute("property") ?? e.getAttribute("name")
      if (key) page.meta.set(key, e.getAttribute("content") ?? "")
    } })
    .on("[id]", { element(e) { page.ids.add(e.getAttribute("id")!) } })
    .on("a[href]", { element(e) { page.links.push(e.getAttribute("href")!) } })
    .on('[data-v-gutter-top] a[href="https://github.com/smithersai/vibelang"]', {
      element() { page.hasTopNavGitHub = true },
    })
    .on("img[src]", { element(e) { page.images.push(e.getAttribute("src")!) } })
    .transform(new Response(readFileSync(file, "utf8"))).text()
  return page
}

export async function checkSite(root: string) {
  root = resolve(root)
  const pages = new Map<string, Page>()
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [])
  }
  for (const file of files(root)) {
    pages.set(file, await readPage(file))
  }
  const errors: string[] = []
  // Vocs emits a standalone 404 and empty declaration routes without a layout.
  const withoutTopNav = new Set(["404.html", "404.d/index.html", "_root.d/index.html"])
  const external = (href: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)
  for (const [file, page] of pages) {
    const route = "/" + relative(root, file).replace(/index\.html$/, "")
    if (!withoutTopNav.has(relative(root, file)) && !page.hasTopNavGitHub)
      errors.push(relative(root, file) + ": missing top-nav GitHub link (https://github.com/smithersai/vibelang)")
    for (const key of ["og:image", "twitter:image"]) {
      const value = page.meta.get(key) ?? ""
      try {
        const url = new URL(value)
        if (url.protocol !== "https:") throw new Error("must be an absolute https URL")
        const target = resolve(root, "." + decodeURIComponent(url.pathname))
        if (!target.startsWith(root + "/") || !existsSync(target) || !statSync(target).isFile())
          throw new Error("missing image in build output")
      } catch (error) { errors.push(relative(root, file) + ": " + key + " (" + (error as Error).message + ")") }
    }
    for (const key of ["og:image:width", "og:image:height", "og:image:alt"]) {
      const value = page.meta.get(key)?.trim()
      if (!value || (key !== "og:image:alt" && !/^[1-9]\d*$/.test(value)))
        errors.push(relative(root, file) + ": missing or invalid " + key)
    }
    for (const href of page.links) {
      if (!href || external(href)) continue
      try {
        const url = new URL(href, "https://vibelang.sh" + route)
        let target = resolve(root, "." + decodeURIComponent(url.pathname))
        if (target !== root && !target.startsWith(root + "/")) throw new Error("target outside site")
        if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html")
        else if (!existsSync(target) && existsSync(target + "/index.html")) target += "/index.html"
        if (!existsSync(target)) throw new Error("missing page")
        const id = decodeURIComponent(url.hash.slice(1))
        if (id && pages.has(target) && !pages.get(target)!.ids.has(id)) throw new Error("missing heading")
      } catch (error) { errors.push(relative(root, file) + ": " + href + " (" + (error as Error).message + ")") }
    }
    for (const src of page.images) {
      if (src.startsWith("data:")) continue
      if (external(src)) { errors.push(relative(root, file) + ": external image " + src); continue }
      const url = new URL(src, "https://vibelang.sh" + route)
      if (!existsSync(join(root, decodeURIComponent(url.pathname)))) errors.push(relative(root, file) + ": missing image " + src)
    }
  }
  if (errors.length) throw new Error([...new Set(errors)].join("\n"))
  console.log("check-site: " + pages.size + " pages and their local link targets checked")
}
if (import.meta.main) await checkSite(process.argv[2] ?? "site/dist/public")
