import { defineConfig } from 'vocs/config'

export default defineConfig({
  accentColor: 'light-dark(#646cff, #a5a9ff)',
  checkDeadlinks: true,
  colorScheme: 'light dark',
  description:
    'VibeLang is TypeScript with typed failures, capability-based dependencies, comptime, and durable execution compiled in.',
  editLink: {
    link: 'https://github.com/smithersai/vibelang/edit/main/docs/src/pages/:path',
  },
  iconUrl: '/icon.svg',
  logoUrl: {
    light: '/logo-light.svg',
    dark: '/logo-dark.svg',
  },
  renderStrategy: 'full-static',
  sidebar: [
    {
      text: 'Introduction',
      collapsed: false,
      items: [
        { text: 'Getting Started', link: '/introduction/getting-started' },
        { text: 'Philosophy', link: '/introduction/philosophy' },
        { text: 'Why VibeLang', link: '/introduction/why-vibelang' },
      ],
    },
    {
      text: 'Guide',
      collapsed: false,
      items: [
        { text: 'Features', link: '/guide/features' },
        { text: 'Typed Failures', link: '/guide/typed-failures' },
        { text: 'Capabilities & Layers', link: '/guide/capabilities-and-layers' },
        { text: 'Optionals', link: '/guide/optionals' },
        { text: 'Control Flow', link: '/guide/control-flow' },
        { text: 'Comptime', link: '/guide/comptime' },
        { text: 'Runtime Validation', link: '/guide/runtime-validation' },
        { text: 'Asset Imports', link: '/guide/asset-imports' },
        { text: 'Platforms & Targets', link: '/guide/platforms-and-targets' },
        { text: 'Concurrency', link: '/guide/concurrency' },
        { text: 'Durable Execution', link: '/guide/durable-execution' },
        { text: 'TypeScript Interop', link: '/guide/typescript-interop' },
        { text: 'Agent Library', link: '/guide/agent-library' },
      ],
    },
    {
      text: 'Reference',
      collapsed: false,
      items: [
        { text: 'Language Syntax', link: '/reference/language-syntax' },
        { text: 'Function Channels', link: '/reference/function-channels' },
        { text: 'Errors', link: '/reference/errors' },
        { text: 'Capabilities', link: '/reference/capabilities' },
        { text: 'Comptime', link: '/reference/comptime' },
        { text: 'Actions & Flows', link: '/reference/actions-and-flows' },
        { text: 'CLI', link: '/reference/cli' },
        { text: 'Standard Library', link: '/reference/standard-library' },
      ],
    },
    {
      text: 'Specification',
      collapsed: false,
      items: [
        { text: 'Status & Conventions', link: '/specification/' },
        { text: 'Compatibility', link: '/specification/compatibility' },
        { text: 'Type System', link: '/specification/type-system' },
        { text: 'Failure Semantics', link: '/specification/failures' },
        { text: 'Requirements', link: '/specification/requirements' },
        { text: 'Control Flow', link: '/specification/control-flow' },
        { text: 'Comptime', link: '/specification/comptime' },
        { text: 'Durable Execution', link: '/specification/durable-execution' },
      ],
    },
  ],
  socials: [
    { icon: 'github', link: 'https://github.com/smithersai/vibelang' },
  ],
  title: 'VibeLang',
  titleTemplate: '%s | VibeLang',
  topNav: [
    {
      text: 'Guide',
      link: '/introduction/getting-started',
      match: (path) =>
        Boolean(path?.startsWith('/introduction') || path?.startsWith('/guide')),
    },
    {
      text: 'Reference',
      link: '/reference/language-syntax',
      match: '/reference',
    },
    {
      text: 'Specification',
      link: '/specification/',
      match: '/specification',
    },
    {
      text: 'Design draft',
      items: [
        {
          text: 'Decision ledger',
          link: 'https://github.com/smithersai/vibelang/blob/main/docs/DECISIONS.md',
        },
        {
          text: 'Roadmap',
          link: '/introduction/getting-started#project-status',
        },
      ],
    },
  ],
})
