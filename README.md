# Lozza UI

Examples of using the [Lozza](https://github.com/op12no2/lozza) chess engine in a web page. Lozza runs as a Web Worker: load one of the engine files with `new Worker()`, post UCI commands to it and read the replies in `onmessage`. The commands are listed in [COMMANDS.md](COMMANDS.md).

The engine files here are the current development builds, so they change from time to time.

| File | Evaluation | |
|---|---|---|
| lozzaNNUE.js | Neural network | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaNNUE) |
| lozzaHCE.js | Hand coded evaluation | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaHCE) |
| lozzaPST.js | Material + piece square tables | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaPST) |
| lozzaBeal.js | Random (Beal effect) | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaBeal) |

[index.html](https://op12no2.github.io/lozza-ui/index.html) lists the examples (hello world, stop, a promise wrapper, multi PV analysis and a game against Lozza) for the engine given by `?engine=`, default lozzaHCE.

To run them locally, serve this directory (a worker script does not load from a `file://` page), e.g. `python3 -m http.server 8000`, and open [examples/local.html](examples/local.html).

Lozza and these examples are MIT licensed.
