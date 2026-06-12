# MCP quick start

TidGi currently has two MCP-related workflows:

- Chrome DevTools MCP for inspecting the Electron renderer UI.
- Ghost KB / Knowledge Graph MCP for agent-facing knowledge graph operations.

For the knowledge graph MCP architecture, tool semantics, current read/write storage model, and future cache route, see [internal/KnowledgeGraphMCP.md](./internal/KnowledgeGraphMCP.md).

Current Ghost KB storage model in one sentence: reads build a temporary in-memory graph from TiddlyWiki on demand; writes go through the operation policy and then directly update TiddlyWiki. There is no long-lived in-memory RDF database as source of truth.

## Chrome DevTools MCP

This repo ships a ready-to-use [chrome-devtools-mcp](https://github.com/ChromeDevTools/mcp) config at `.vscode/mcp.json` that points to `http://localhost:9222`.

## Prerequisites

- Install deps: `pnpm install`
- Ensure no other Chrome is occupying `9222` (close Chrome if needed)

## Start Electron with DevTools port

- Run `pnpm run start:dev:mcp` (check active terminal see if it is already running)
- Ports: `9222` for Chrome DevTools (renderer), `9229` for Node Inspector (main process)

## Connect from VS Code MCP

- Open Command Palette → `MCP: Start Servers` (uses `.vscode/mcp.json`)
- The Chrome MCP server will attach to `http://localhost:9222`
- Use `list_pages` to see all open windows/pages (including main app and preference windows)
- Use `select_page` with page index to switch between different windows
- Use `take_snapshot` to inspect the current page's UI elements
- Use `close_page` to close a specific window

## Troubleshooting

- If browser pages do not show, app main window react part is shown, but wiki browser view is white or not shown: Seems it is not working with browser view. ~~close other Chrome instances or change the port in `.vscode/mcp.json` and rerun `start:dev:mcp`~~
- If you see `Debugger listening on ws://127.0.0.1:9229/...`, that is the main-process Node inspector; keep using `9222` for renderer DevTools
- Multiple windows (e.g., preferences dialog) appear as separate pages in `list_pages` — use `select_page` to switch context
