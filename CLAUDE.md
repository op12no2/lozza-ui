# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lozza UI is a browser-based chess interface suite for the [Lozza JavaScript chess engine](https://github.com/op12no2/lozza). It's a pure HTML/CSS/JavaScript static web application with no build system, package manager, or test framework.

**Live demo**: https://op12no2.github.io/lozza-ui

## Development

No build process required. Serve the files with any static web server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (if available)
npx serve
```

Open `index.htm` in a browser to access the landing page.

## Architecture

### Core Files

- **lozza.js** - The chess engine (compiled JS/WASM with weights)
- **lozuilib.js** - Shared utility library (FEN parsing, URL args, message handling)
- **openings.js** - Pre-loaded opening book database

### Interface Modules

Each UI has a paired `.htm` and `.js` file:

| Module | Purpose |
|--------|---------|
| play | Interactive game against engine (10 difficulty levels) |
| fen | Position analyzer - load FEN and analyze |
| console | Direct UCI engine console |
| mate | Mate training puzzles |
| perft | Engine performance testing |
| tune | Engine tuning/optimization |
| profile | Profiling tool |

### Key Patterns

- **Web Workers**: Engine runs in background thread via `postMessage()`
- **UCI Protocol**: Standard chess engine communication protocol
- **Message Receiver**: `lozuilib.js` provides `lozStdMessageReceiver()` for engine responses

### Naming Conventions

- Shared functions prefixed with `loz*` (e.g., `lozGetURLArgs`, `lozDecodeFEN`)
- Build versions in module globals: `PLAYBUILD`, `CONSOLEBUILD`, `FENBUILD`
- Global state stored in `lozData` object
- jQuery used for DOM manipulation (`$()`)

### Dependencies (vendored)

- jQuery + jQuery UI 1.8.24
- Bootstrap 3
- chess.js - Move validation
- chessboard-0.3.0.js - Visual board rendering
