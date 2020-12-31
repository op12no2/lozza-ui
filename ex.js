
// https://github.com/op12no2

var lozza = new Worker('lozza.js');

lozza.onmessage = function (e) {
  $('#dump').append(e.data + '<br>');
};

lozza.postMessage('uci');             // get build etc
lozza.postMessage('ucinewgame');      // reset TT
lozza.postMessage('position startpos');
lozza.postMessage('go depth 10');     // 10 ply search

