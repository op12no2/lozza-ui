
// https://github.com/op12no2

var CONSOLEBUILD = 'c1.13';

var args   = lozGetURLArgs();
var engine = null;

lozData.page    = 'console.htm';
lozData.idInfo  = '#info';
lozData.idStats = '#stats';

//{{{  lozStandardRx

function lozStandardRx (e) {

  lozData.message = e.data;
  lozData.message = lozData.message.trim();
  lozData.message = lozData.message.replace(/\n/g,'<br>');
  lozData.message = lozData.message.replace(/\r/g,'');
  lozData.message = lozData.message.replace(/\s+/g,' ');
  lozData.tokens  = lozData.message.split(' ');

  if (lozData.tokens[0] == 'board') {
    lozUpdateBoard();
  }

  $(lozData.idInfo).prepend(lozData.message + '<br>');
}

//}}}
//{{{  tx

function tx (m) {
  if (m == 'start') {
    if (engine)
      engine.terminate();
    engine           = new Worker(lozData.source);
    engine.onmessage = lozStandardRx;
    //tx('uci');
    tx('ucinewgame');
    tx('position startpos');
    tx('board');
    return;
  }
  if (!engine) {
    $('#info').prepend('engine not running<br>');
    return;
  }
  $('#info').prepend('<b>> '+m+'</b><br>');
  if (m == 'quit') {
    engine.terminate();
    engine = null;
    $('#info').prepend('engine stopped<br>');
    return;
  }
  if (m == 'clear') {
    $(lozData.idInfo).html('');
    return;
  }
  engine.postMessage(m);
}

//}}}

$(function() {

  //{{{  handlers
  
  $('#stdin').on("keypress", function(e) {
    if (e.keyCode != 13)
      return;
    var m = $('#stdin').val().trim();
    tx(m);
    $('#stdin').val('').focus();
    return false;
  });
  
  //}}}

  //$(lozData.idInfo).prepend('Version ' + BUILD + ' ' + CONSOLEBUILD + '<br>');

  tx('start');

  $('#stdin').val('').focus();
});

