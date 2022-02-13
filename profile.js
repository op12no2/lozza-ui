
// https://github.com/op12no2

lozza.onmessage = function (e) {
  $('#dump').append(e.data + '<br>');
};

onmessage({data: 'uci'});             // get build etc
onmessage({data: 'ucinewgame'});      // reset TT
onmessage({data: 'position startpos'});
onmessage({data: 'go depth 16'});     //

