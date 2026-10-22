# Lozza commands

Lozza speaks UCI. Most commands also have a one-letter shorthand for typing at a console.

Lozza runs as a Web Worker: `new Worker('lozza.js')`, then `postMessage` each command and read the replies in `onmessage`, one line per message (see the examples). It has no stdin or stdout of its own; a host for any other environment has to supply the worker globals `postMessage` and `close` and deliver commands to `onmessage`.

Commands sent during a search are queued: `stop` ends the search at the next pause between iterations, `isready` is answered there, and everything else runs after `bestmove`.

## UCI

| command | short | what it does |
|---|---|---|
| `uci` | | identifies the engine and lists its options, then `uciok` |
| `isready` | | `readyok`, also while searching |
| `setoption name Hash value <mb>` | `o` | transposition table size, 1 to 1024 MB (default 16) |
| `setoption name Contempt value <cp>` | `o` | draw score: a draw counts -cp for the side Lozza plays, -200 to 200 (default 0) |
| `ucinewgame` | `u` | clears the transposition table |
| `position startpos [moves ...]` | `p` | the start position, then any moves in UCI notation; `p` alone is the start position |
| `position fen <fen> [moves ...]` | `p fen ...` | a position from a FEN, then any moves |
| `go [options]` | `g` | searches and prints `bestmove` (see below) |
| `stop` | | stops the search; `bestmove` follows at once |
| `quit` | `q` | exits |

`go` takes any of `depth <n>` (or `d <n>`), `nodes <n>`, `movetime <ms>`, `wtime <ms>`, `btime <ms>`, `winc <ms>`, `binc <ms>`, `movestogo <n>` and `infinite`. With `infinite`, `bestmove` waits for `stop`.

When the position has no legal moves there is no search. `go` prints `info depth 0 score mate 0` if the side to move is checkmated, or `info depth 0 score cp 0` if it is stalemate, followed by `bestmove 0000`. This is the same as Lozza 11.

## Extras

| command | short | what it does |
|---|---|---|
| `moves` | `m` | the legal moves in the current position, one per line in UCI notation, nothing when there are none (as in Lozza 11) |
| `board` | `b` | prints the board, side to move, castling rights and so on |
| `eval` | `e` | the static evaluation of the current position, in centipawns from the side to move's point of view |
| `perft <depth>` | `f` | counts the leaf nodes of the legal move tree to that depth |
| `bench [depth]` | `h` | searches a fixed set of positions (depth 10 by default) and prints the total node count and speed |
