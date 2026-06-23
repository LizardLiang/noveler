# Noveler

**AI 互動小說生成器** — An AI-assisted interactive novel writing desktop app built with Electron, React and TypeScript.

Noveler lets you co-write long-form fiction with an LLM. You write or paste an opening, then drive the story forward turn by turn with author directives. A built-in "Director" plans plot beats ahead, a persistent World Memory tracks characters, relationships and events, and editor passes refine dialogue and narration as you go. The UI is in Traditional Chinese (繁體中文).

> Built on the [electron-vite-react](https://github.com/electron-vite/electron-vite-react) template.

## Features

- **Turn-based story generation** — stream story continuations from your chosen model; chat input is framed as an author directive rather than completed narration.
- **World Memory** — characters, relationships and events persisted per project, auto-updated as the story advances and editable by hand. Import from JSON files or pasted text.
- **Director / plot planning** — maintains a rolling roadmap of upcoming plot beats and injects scene-continuity directives so the narrative stays coherent.
- **Editor passes** — dialogue editor, narration editor, writing-style and plot-compliance configuration to shape tone and quality.
- **Branching & versions** — timeline tree with branch create/switch/rename, paragraph regeneration, version switching and rollback.
- **Multiple AI providers** — any OpenAI-compatible endpoint, OpenRouter (with credit display), and local [Ollama](https://ollama.com/). OpenAI/ChatGPT sign-in via OAuth device flow is also supported.
- **Context budgeting** — token accounting with `js-tiktoken`, a context-budget indicator, and story compaction ("前情提要") to stay within the model's context window.
- **Search** — full-text search plus character/event lookup across the project.
- **Autosave & crash recovery** — periodic snapshots with recovery prompts on restart.
- **Project templates**, story stats, onboarding wizard, dark/light/system themes, and adjustable font size.
- **Import existing novels** from `.txt` / `.md` into a project.

## Quick Start

```sh
# clone the project
git clone https://github.com/LizardLiang/noveler.git
cd noveler

# install dependencies
pnpm install

# start development
pnpm dev
```

Requires Node.js `>= 20.19.0 || >= 22.12.0`.

## Available Scripts

- `pnpm dev` — start the Vite dev server with Electron.
- `pnpm build` — build the renderer and package the app with electron-builder.
- `pnpm release` — build and package without publishing (`release:win` / `release:mac` / `release:dir` for targeted builds).
- `pnpm preview` — preview the production web build locally.
- `pnpm test` — run Vitest unit tests.
- `pnpm test:e2e` — build the test bundle and run Playwright tests.
- `pnpm typecheck` — run the TypeScript type checker.

## Tech Stack

- **Electron** + **Vite** + **React 19** + **TypeScript**
- **TailwindCSS v4** for styling
- **Zustand** for renderer state
- **sql.js** for per-project SQLite storage (characters, events, paragraphs, branches)
- **openai** SDK for streaming completions; native transports for Ollama and OAuth/curl
- **zod** for schema validation, **react-router-dom** (hash router), **react-markdown**

## Project Structure

```tree
├── electron/             Main-process and preload source
│   ├── main/
│   │   └── services/     AI, World Memory, Director, editors, storage, OAuth, search…
│   ├── ipc/              IPC channel handlers
│   ├── preload/
│   └── shared/           Types shared between main and renderer
├── src/                  Renderer source code
│   ├── components/       UI: story, worldMemory, settings, sidebar, search, stats…
│   ├── pages/            ProjectList, Story, Settings
│   ├── stores/           Zustand stores
│   ├── hooks/
│   ├── layouts/
│   └── i18n/             zh-TW strings
├── build/                Packaging assets
├── dist-electron/        Compiled Electron output
└── test/                 Unit and end-to-end tests
    └── e2e/
```

Files under `electron/` are compiled into `dist-electron/`.

## Configuration

AI providers are configured in the in-app **Settings** page — add an OpenAI-compatible base URL and API key, connect OpenRouter, point at a local Ollama instance, or sign in via OAuth. API keys are stored encrypted on disk. Writing style, dialogue/narration editing, plot compliance and the system prompt are all editable from Settings as well.

## License

MIT © LizardLiang
