# Lozza UI

Examples of using the [Lozza](https://github.com/op12no2/lozza) chess engine in a web page. Lozza runs as a Web Worker: load `lozza.js` with `new Worker()`, post UCI commands to it and read the replies in `onmessage`. The commands are listed in [COMMANDS.md](COMMANDS.md).

The `lozza.js` here is the current development build, so it changes from time to time.

- [Hello world](https://op12no2.github.io/lozza-ui/examples/hello.html) - load Lozza, send a few commands, show the replies
- [Stop command](https://op12no2.github.io/lozza-ui/examples/stop.html) - `go infinite` then `stop` a second later
- [Promise wrapper](https://op12no2.github.io/lozza-ui/examples/promise.html) - a promise based interface to the worker
- [Multi PV analysis](https://op12no2.github.io/lozza-ui/examples/analysis.html) - analyse a position with several lines
- [Play Lozza](https://op12no2.github.io/lozza-ui/examples/play.html) - a game against Lozza with clocks

To run them locally, serve this directory (a worker script does not load from a `file://` page), e.g. `python3 -m http.server 8000`, and open [examples/local.html](examples/local.html).

Lozza and these examples are MIT licensed.
