import type { LanguageRegistration } from 'shiki'
import { defineConfig } from 'vocs/config'
import vibeGrammar from './vibe.tmLanguage.json' with { type: 'json' }
import { sidebar } from './sidebar.ts'
import { specSidebar } from './spec-sidebar.ts'
import { vipsSidebar } from './vips-sidebar.ts'

// The JSON's inferred type is narrower than Shiki's grammar type, hence the cast.
const vibe: LanguageRegistration = {
  ...(vibeGrammar as unknown as LanguageRegistration),
  name: 'vibe',
  aliases: ['vibelang'],
}

export default defineConfig({
  accentColor: 'light-dark(#4f46e5, #a5a9ff)',
  baseUrl: 'https://vibelang.sh',
  banner:
    'VibeLang is in early alpha. The language will change in major, breaking ways. It is not suitable for production use.',
  checkDeadlinks: true,
  codeHighlight: {
    // ```vibe blocks use the grammar from VibeLang's editor extension
    // (editors/vscode/syntaxes/VibeLang.tmLanguage.json in the language repo).
    langs: [
      'bash',
      'json',
      'jsx',
      'lua',
      'markdown',
      'md',
      'mdx',
      'sh',
      'svelte',
      'ts',
      'tsx',
      'vue',
      'zsh',
      vibe,
    ],
  },
  colorScheme: 'light dark',
  description:
    'Write Effect programs in TypeScript syntax, with typed errors and services the compiler checks.',
  ogImageUrl: 'https://vibelang.sh/social-card.png',
  // Vocs renders its /404 route to the published dist/public/404.html.
  head: (path, { frontmatter }) => ({
    ...(path === '/404' ? {
      title: 'Page not found | VibeLang',
      canonical: false,
    } : {}),
    meta: {
      // Vocs gives og:title and twitter:title the bare page name ("Cheat sheet"); a shared
      // link names the site too, as the page's <title> does through titleTemplate.
      ...(frontmatter?.title && !frontmatter.title.includes('VibeLang') ? {
        ogTitle: `${frontmatter.title} | VibeLang`,
        twitterTitle: `${frontmatter.title} | VibeLang`,
      } : {}),
      ...(path === '/404' ? {
        robots: 'noindex',
        description:
          'The page you requested was not found. Return to the VibeLang documentation or specification.',
        ogUrl: false,
      } : {}),
      ogImageWidth: '1200',
      ogImageHeight: '630',
      ogImageAlt: 'VibeLang — Effect, as a language',
    },
  }),
  iconUrl: '/icon.svg',
  logoUrl: {
    light: '/logo-light.svg',
    dark: '/logo-dark.svg',
  },
  renderStrategy: 'full-static',
  search: {
    query: {
      // Vocs's default document boost (search priority over path depth), tripled for a
      // section of a page whose title starts with a query term. Without it, "install"
      // listed every section headed "Install" and left the Installation page out of the
      // first ten results, because "installation" matches only as a prefix. Vocs sends
      // this function to the browser, so it must not use anything from outside it.
      boostDocument: (_id, term, stored) => {
        const href = typeof stored?.href === 'string' ? stored.href : ''
        const priority = typeof stored?.searchPriority === 'number' ? stored.searchPriority : 1
        const depth = Math.max(href.split('/').filter(Boolean).length, 1)
        const titles = Array.isArray(stored?.titles) ? stored.titles : []
        const page = String(titles[0] ?? stored?.title ?? '').toLowerCase()
        const named = page.split(/[^\p{L}\p{N}]+/u).some((word) => word !== '' && word.startsWith(term))
        return (priority / depth) * (named ? 3 : 1)
      },
    },
  },
  sidebar: [...sidebar, ...specSidebar, ...vipsSidebar],
  socials: [{ icon: 'github', link: 'https://github.com/smithersai/vibelang' }],
  title: 'VibeLang',
  titleTemplate: '%s | VibeLang',
  topNav: [
    { text: 'Welcome', link: '/001-onboarding' },
    { text: 'Guides', link: '/013-getting-started' },
    { text: 'Cheat sheet', link: '/vibelang-features/115-cheat-sheet' },
    { text: 'Specification', link: '/spec/' },
    { text: 'VIPs', link: '/vips/' },
    { text: 'GitHub', link: 'https://github.com/smithersai/vibelang', external: true },
  ],
})
