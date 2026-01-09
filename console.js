
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

  $(lozData.idInfo).append(lozData.message + '<br>');
  $(lozData.idInfo)[0].scrollTop = $(lozData.idInfo)[0].scrollHeight;
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
    //tx('ucinewgame');
    //tx('position startpos');
    //tx('board');
    return;
  }
  if (!engine) {
    $('#info').append('engine not running<br>');
    $('#info')[0].scrollTop = $('#info')[0].scrollHeight;
    return;
  }
  $('#info').append('<b>> '+m+'</b><br>');
  $('#info')[0].scrollTop = $('#info')[0].scrollHeight;
  if (m == 'quit' || m == 'q' || m == 'stop' || m == 's') {
    engine.terminate();
    engine = null;
    $('#info').append('engine stopped - use start to restart it<br>');
    $('#info')[0].scrollTop = $('#info')[0].scrollHeight;
    return;
  }
  if (m == 'clear' || m == 'c') {
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

  //{{{  run commands from URL params

  if (args.cmd) {
    var cmds = args.cmd.split(';');
    for (var i = 0; i < cmds.length; i++) {
      var cmd = cmds[i].trim();
      if (cmd)
        tx(cmd);
    }
  }

  //}}}

  $('#stdin').val('').focus();
});

