
// https://github.com/op12no2

const lozza = new Worker('lozza.js');
const dump = document.getElementById('ucioutput');

lozza.onmessage = function(e) {
  ucioutput.textContent += e.data + '\n'; // Lozza reponds with text as per UCI 
};

lozza.postMessage('uci');
lozza.postMessage('ucinewgame');
lozza.postMessage('position startpos');
lozza.postMessage('go depth 10');


