# AGENTS.md

## Project

Fuwari — Astro-based static blog template (Chinese-language personal blog deployed to GitHub Pages at `https://2297779320.github.io/cjh_fuwari/` via `.github/workflows/deploy-pages.yml`; formerly Vercel). Forked from [saicaca/fuwari](https://github.com/saicaca/fuwari).

## Commands

```bash
pnpm install          # Install dependencies (pnpm enforced via preinstall, Node >= 20)
pnpm dev              # Dev server at localhost:4321
pnpm build            # Production build (astro build → pagefind → friends JSON)
pnpm preview          # Preview production build
pnpm check            # Astro type/error checking
pnpm type-check       # tsc --noEmit --isolatedDeclarations
pnpm lint             # Biome lint + auto-fix on ./src
pnpm format           # Biome format on ./src
pnpm new-post <name>  # Scaffold new blog post in src/content/posts/
```

**Before submitting code:** `pnpm check && pnpm format`

No test framework is configured — verify changes with `pnpm check` and `pnpm build`.

## Architecture

- **Stack:** Astro (static site generator) + Svelte (interactive components) + TypeScript (strict) + Tailwind CSS + Stylus
- **Linting/formatting:** Biome (not ESLint/Prettier)
- **Config:** All site-wide settings in `src/config.ts` (`siteConfig`, `navBarConfig`, `profileConfig`, `licenseConfig`, `commentConfig` (Twikoo), `expressiveCodeConfig`) — types in `src/types/config.ts`
- **Content:** Markdown posts in `src/content/posts/`, validated by Zod schema in `src/content/config.ts`. Frontmatter fields: `title` (required), `published` (required date), `updated`, `draft`, `description`, `image`, `tags`, `category`, `lang`, `pinned`, plus internal `prev*`/`next*` fields
- **Layouts:** `Layout.astro` (root shell: head/meta, theme init, PhotoSwipe, Live2D, comments) → `MainGridLayout.astro` (sidebar + grid + banner + TOC + navbar)
- **Routing:** File-based in `src/pages/`. Key: `[...page].astro` (paginated home), `posts/[...slug].astro` (individual posts), `archive.astro`, `about.astro`, `time.astro`
- **Interactive components:** Svelte — `Search`, `ArchivePanel`, `LightDarkSwitch`, `DisplaySettings` in `src/components/`
- **Markdown pipeline:** configured in `astro.config.mjs` — remark plugins (math, reading time, excerpt, GitHub admonitions, directives, sectionize) + rehype plugins (KaTeX, slug/autolink headings, custom admonition & GitHub-card components from `src/plugins/`); custom Expressive Code plugins in `src/plugins/expressive-code/`
- **Page transitions:** Swup (`@swup/astro`), containers `main` and `#toc`
- **i18n:** Custom system in `src/i18n/`. Keys in `i18nKey.ts`, locales in `languages/`. Active language set via `siteConfig.lang`
- **Styling:** Tailwind (`class`-based dark mode) + Stylus for complex custom styles; PostCSS chain `postcss-import` → `tailwindcss/nesting` → `tailwindcss`; global styles in `src/styles/`
- **Path aliases:** `@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*`, `@/*` → `src/*`

## Code Style

- Tab indentation, double quotes
- Biome recommended rules + style rules (noParameterAssign, useSelfClosingElements, etc.)
- Relaxed rules for `.svelte`, `.astro`, `.vue` (unused vars/imports allowed)
- Conventional Commits for commit messages

## Gotchas

- `pnpm build` runs three steps: astro build → pagefind index → generate-friends-json.js
- Pagefind generates static search index post-build (config in `pagefind.yml`) — search doesn't work under `pnpm dev`
- Vite config suppresses dynamic/static import warnings for Swup
