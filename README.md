# Lozza examples

Example web pages for [Lozza](https://github.com/op12no2/lozza).

In every case all you need is `lozza.js` from one of the [releases](https://github.com/op12no2/lozza/wiki/Release-overview).

## Hello world

```
const lozza = new Worker('lozza.js');
const ucioutput = document.getElementById('ucioutput');

lozza.onmessage = function(e) {
  ucioutput.textContent += e.data + '\n'; // lozza responds with text as per UCI
};

lozza.postMessage('uci');
lozza.postMessage('ucinewgame');
lozza.postMessage('position startpos');
lozza.postMessage('board');
lozza.postMessage('eval');
lozza.postMessage('go depth 8');
lozza.postMessage('go movetime 1000')
```

Try this example here: https://op12no2.github.io/lozza-ui/hello_world.html

## More examples

- [mates](https://op12no2.github.io/lozza-ui/mates.html) - finds mates and checks the reported mate distance.
- [console](https://op12no2.github.io/lozza-ui/console.html) - a console, type UCI commands and see the replies.
- [play](https://op12no2.github.io/lozza-ui/play.html) - play against Lozza at five strength levels, or watch Lozza play itself.
- [endgames](https://op12no2.github.io/lozza-ui/endgames.html) - plays out random K+Q v K and K+R v K positions and checks white mates.
- [analysis](https://op12no2.github.io/lozza-ui/analysis.html) - set up a position by dragging pieces, presets or FEN, then analyse it.
- [openings](https://op12no2.github.io/lozza-ui/openings.html) - twenty workers search each first move deeper and deeper, then rank them.
- [perft](https://op12no2.github.io/lozza-ui/perft.html) - move generator node counts against the known values, plus your own.
- [bk](https://op12no2.github.io/lozza-ui/bk.html) - the Bratko-Kopec test at a search time of your choice.
- [symmetry](https://op12no2.github.io/lozza-ui/symmetry.html) - eight workers play random games and check every position evals the same when colour flipped.

## UCI protocol

Lozza implements the following [UCI](https://backscattering.de/chess/uci/) commands: `uci`, `uciok`, `isready`, `readyok`, `ucinewgame|u`, `setoption|o` (`Hash` and `MultiPV`), `position|p`, `go|g`, `stop` and `quit|q`.

A search yields between iterations so `stop` is picked up, and `bestmove` follows once the current iteration ends. To abandon a search immediately, kill the worker and create a new one.

```
lozza.terminate();
lozza = new Worker('lozza.js');
```

## UCI extensions

- `board|b` - the current position as a FEN.
- `moves|m` - list the legal moves on one line, or `checkmate` or `stalemate` if there are none.
- `eval|e` - static eval of the current position from the side to move's perspective.
- `perft depth <n> [to <m>]` - leaf node count.
- `bench` - search the bench positions, report nodes and nps.
