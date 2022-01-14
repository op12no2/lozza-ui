
// https://github.com/op12no2

var FENBUILD = 'a1.10';

var args    = lozGetURLArgs();
var uiBoard = null;
var engine  = null;

lozData.page    = 'fen.htm';
lozData.idInfo  = '#info';
lozData.idStats = '#stats';

//{{{  updateBoardFromFen

function updateBoardFromFen () {
  var fen = $('#fen').val().trim();
  uiBoard.position(fen);
};

//}}}
//{{{  updateFenFromBoard

function updateFenFromBoard () {
  var turn = lozDecodeFEN($('#fen').val()).turn;
  var fen = uiBoard.fen();
  var pos = uiBoard.position();
  var rights = '';
  if (pos.e1 == 'wK' && pos.h1 == 'wR')
    rights += 'K';
  if (pos.e1 == 'wK' && pos.a1 == 'wR')
    rights += 'Q';
  if (pos.e8 == 'bK' && pos.h8 == 'bR')
    rights += 'k';
  if (pos.e8 == 'bK' && pos.h8 == 'bR')
    rights += 'q';
  if (!rights)
    rights = '-';
  $('#fen').val(fen + ' ' + turn + ' ' + rights + ' - 0 1');
};

//}}}
//{{{  onDrop

var onDrop = function(source, target, piece, newPos, oldPos, orientation) {
  uiBoard.position(newPos);
  updateFenFromBoard();
};

//}}}
//{{{  eval

function eval() {
  if (engine)
    engine.terminate();
  engine           = new Worker(lozData.source);
  engine.onmessage = lozStandardRx;
  $(lozData.idInfo).html('');
  var fen = $('#fen').val().trim();
  engine.postMessage('ucinewgame');
  if (fen)
    engine.postMessage('position fen ' + fen);
  else
    engine.postMessage('position startpos');
  engine.postMessage('eval');
}

//}}}
//{{{  anal

function anal() {
  if (engine)
    engine.terminate();
  engine           = new Worker(lozData.source);
  engine.onmessage = lozStandardRx;
  $(lozData.idInfo).html('');
  var fen = $('#fen').val().trim();
  engine.postMessage('ucinewgame');
  if (fen)
    engine.postMessage('position fen ' + fen);
  else
    engine.postMessage('position startpos');
  engine.postMessage('go depth 99');
}

//}}}

$(function() {

  //{{{  init DOM
  
  $('button').tooltip({delay: {"show": 1000, "hide": 100}});
  
  //}}}
  //{{{  handlers
  
  $('#aswhite').click(function() {
    window.open('play.htm?c=w&fen=' + $('#fen').val().trim(),'_blank');
    return true;
  });
  
  $('#asblack').click(function() {
    window.open('play.htm?c=b&fen=' + $('#fen').val().trim(),'_blank');
    return true;
  });
  
  $('#startpos').click(function() {
    $(lozData.idInfo).html('');
    uiBoard.start();
    updateFenFromBoard();
    return false;
  });
  
  $('#clearpos').click(function() {
    $(lozData.idInfo).html('');
    uiBoard.position('4k3/8/8/8/8/8/8/4K3');
    updateFenFromBoard();
    return false;
  });
  
  $('#flippos').click(function() {
    uiBoard.orientation('flip');
    return false;
  });
  
  $('#flipturn').click(function() {
    var feno = lozDecodeFEN($('#fen').val());
    if (feno.turn == 'w')
      feno.turn = 'b';
    else
      feno.turn = 'w';
    $('#fen').val(lozEncodeFEN(feno));
    return false;
  });
  
  $('#fen').blur(function() {
    updateBoardFromFen();
    return false;
  });
  
  $('#start').click(function() {
    anal();
    return false;
  });
  
  $('#stop').click(function() {
    engine.terminate();
    engine = null;
    return false;
  });
  
  $('#eval').click(function() {
    eval();
    return false;
  });
  
  //}}}

  uiBoard = new ChessBoard('board', {
    showNotation : true,
    draggable    : true,
    dropOffBoard : 'trash',
    sparePieces  : true,
    onDrop       : onDrop,
    position     : 'start'

  });

  if (args.fen) {
    $('#fen').val(args.fen)
    updateBoardFromFen();
  }
  else
    updateFenFromBoard();


  if (args.act == 'eva')
    eval();
  else if (args.act == 'ana')
    anal();
  else {
    if (engine)
      engine.terminate();
    engine           = new Worker(lozData.source);
    engine.onmessage = lozStandardRx;
    $(lozData.idInfo).html('');
    //$(lozData.idInfo).prepend('Version ' + BUILD + ' ' + FENBUILD + '<br>');
    //engine.postMessage('uci');
  }

});

