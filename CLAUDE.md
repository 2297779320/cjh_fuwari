# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fuwari — a static blog built with Astro, forked from [saicaca/fuwari](https://github.com/saicaca/fuwari). Chinese-language personal blog deployed to Vercel.

## Common Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server at localhost:4321 |
| `pnpm build` | Production build (astro build → pagefind index → friends JSON) |
| `pnpm preview` | Preview production build |
| `pnpm check` | Astro type/error checking |
| `pnpm type-check` | TypeScript strict check (`tsc --noEmit`) |
| `pnpm lint` | Biome lint + auto-fix on `./src` |
| `pnpm format` | Biome format on `./src` |
| `pnpm new-post <filename>` | Scaffold a new blog post |

Package manager is **pnpm** (enforced). Node >= 20 required. No test framework is configured.

## Architecture

### Stack

Astro (static site generator) + Svelte (interactive components) + TypeScript (strict). Styling: Tailwind CSS + Stylus. Linting/formatting: Biome (not ESLint/Prettier).

### Layout Hierarchy

`Layout.astro` → root HTML shell (head, meta, theme init, PhotoSwipe, music player, Live2D, comments). `MainGridLayout.astro` extends it with sidebar + main content grid + banner + TOC + navbar.

### Configuration

All site-wide settings live in `src/config.ts` — exports typed config objects: `siteConfig`, `navBarConfig`, `profileConfig`, `licenseConfig`, `commentConfig`, `expressiveCodeConfig`. Types are in `src/types/config.ts`.

### Content Collections

Posts are Markdown files in `src/content/posts/` validated by a Zod schema in `src/content/config.ts`. Frontmatter fields: title, published, updated, draft, description, image, tags, category, lang, pinned, plus internal prev/next fields.

### i18n

Custom translation system in `src/i18n/`. Enum of keys in `i18nKey.ts`, locale files in `languages/`. Active language set via `siteConfig.lang`.

### Routing

Astro file-based routing in `src/pages/`. Key routes: `[...page].astro` (paginated home), `archive.astro`, `about.astro`, `time.astro`, `posts/[...slug].astro` (individual posts).

### Interactive Components

Svelte is used for client-side interactivity: `Search`, `ArchivePanel`, `LightDarkSwitch`, `DisplaySettings`. These live alongside Astro components in `src/components/`.

### Markdown Pipeline

Remark plugins (math/KaTeX, reading time, excerpt, admonitions, directives, sectionize) + rehype plugins (KaTeX, slug headings, autolink headings, custom admonition/GitHub-card components). Expressive Code for enhanced code blocks.

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*`, `@/*` → `src/*`

### Styling

Tailwind CSS (utility-first, `class`-based dark mode) + Stylus for complex custom styles. PostCSS chain: `postcss-import` → `tailwindcss/nesting` → `tailwindcss`. Global styles in `src/styles/`.

### Post-build

Pagefind generates a static search index after build (config in `pagefind.yml`). `scripts/generate-friends-json.js` generates friend-links data.

## Code Style

- Biome: tab indentation, double quotes, recommended lint rules
- Relaxed Biome rules for `.svelte`, `.astro`, `.vue` files
- Use Conventional Commits for commit messages
- Run `pnpm check` and `pnpm format` before submitting
