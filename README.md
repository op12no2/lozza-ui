# Lozza UI

Examples of using the [Lozza](https://github.com/op12no2/lozza) chess engine in a web page. Lozza runs as a Web Worker: load one of the engine files with `new Worker()`, post UCI commands to it and read the replies in `onmessage`. The commands are listed in [COMMANDS.md](COMMANDS.md).

The engine files here are the current development builds, so they change from time to time.

| File | Evaluation | ~Elo | Size | |
|---|---|---|---|---|
| lozzaNNUE.js | [Neural network](https://chessprogramming.org/NNUE)                                | 3100 | 370 kb | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaNNUE) |
| lozzaMini.js | Mini [neural network](https://chessprogramming.org/NNUE) as readable boards        | 2800 | 195 kb | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaMini) |
| lozzaHCE.js  | [Hand coded evaluation](https://chessprogramming.org/Evaluation)                   | 2750 | 97 kb  | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaHCE)  |
| lozzaMat.js  | [Material only](https://www.danheisman.com/evaluation-of-material-imbalances.html) | 2050 | 62 kb  | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaMat)  |
| lozzaBeal.js | [Random (Beal effect)](https://chessprogramming.org/Search_with_Random_Leaf_Values)| 1200 | 58 kb  | [Try it](https://op12no2.github.io/lozza-ui/index.html?engine=lozzaBeal) |


[Compare search speed](https://op12no2.github.io/lozza-ui/examples/nps.html) searches one position with every build and tabulates depth, nodes and nodes per second.

To run them locally, serve this directory (a worker script does not load from a `file://` page), e.g. `python3 -m http.server 8000`, and open [examples/local.html](examples/local.html).

Lozza and these examples are MIT licensed.
