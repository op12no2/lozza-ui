
// https://github.com/op12no2

var PLAYBUILD = 'p1.10';

if (!window.Worker) {
  document.write('<p><b>DUDE, YOUR BROWSER IS TOO OLD TO PLAY CHESS!<p>TRY <a href="http://www.google.co.uk/chrome/">GOOGLE CHROME</a></a><p>');
  exit;
}

var args        = lozGetURLArgs();
var board       = null;
var chess       = null;
var drag        = true;
var engine      = null;
var startFrom   = 'startpos';
var startFromUI = 'start';
var level       = 1;

lozData.page    = 'play.htm';
lozData.idInfo  = '#info';
lozData.idStats = '#stats';

//{{{  lozUpdateBestMove

function lozUpdateBestMove () {

  var move = {};

  move.from = lozData.bmFr;
  move.to   = lozData.bmTo;

  if (lozData.bmPr) {
    move.promotion = lozData.bmPr;
  }

  chess.move(move);
  board.position(chess.fen());
  $('#moves').html(chess.pgn({newline_char: '<br>'}));

  if (!chess.game_over())
    drag = true;
  else
    showEnd();
}

//}}}
//{{{  lozUpdatePV

//function lozUpdatePV () {

  //if (lozData.units == 'cp')
    //$(lozData.idInfo).prepend('depth ' + lozData.depth + ' (' + lozData.score + ') ' + lozData.pv + '<br>');
  //if (lozData.score > 0 && lozData.units != 'cp')
    //$(lozData.idInfo).prepend('depth ' + lozData.depth + ' (<b>mate in ' + lozData.score + '</b>) ' + lozData.pv + '<br>');
  //else if (lozData.units != 'cp')
    //$(lozData.idInfo).prepend('depth ' + lozData.depth + ' (<b>checkmate</b>) ' + lozData.pv + '<br>');

//}

//}}}
//{{{  onDrop

var onDrop = function(source, target, piece, newPos, oldPos, orientation) {

  if (target == 'offboard' || target == source) {
    //console.log('offboard');
    return;
  }

  var move = chess.move({from: source, to: target, promotion: 'q'})
  if (!move) {
    //console.log('invalid');
    return 'snapback';
  }

  if (move.flags == 'e' || move.flags == 'p' || move.flags == 'k' || move.flags == 'q')
    board.position(chess.fen());

  var pgn = chess.pgn({newline_char: '<br>'});
  $('#moves').html(pgn);

  drag = false;

  if (!chess.game_over()) {
    $(lozData.idInfo).html('');
    engine.postMessage('position ' + startFrom + ' moves ' + strMoves());
    postGo();
  }
  else
    showEnd();
};

//}}}
//{{{  onDragStart

var onDragStart = function(source, piece, position, orientation) {

  if ((!drag || orientation === 'white' && piece.search(/^w/) === -1) || (orientation === 'black' && piece.search(/^b/) === -1)) {
    return false;
  }

  return true;
};

//}}}
//{{{  strMoves

function strMoves() {

  var movesStr = '';
  var moves    = chess.history({verbose: true});

  for (var i=0; i < moves.length; i++) {
    if (i)
      movesStr += ' ';
    var move = moves[i];
    movesStr += move.from + move.to;
    if (move.promotion)
      movesStr += move.promotion;
  }

  return movesStr;
}

//}}}
//{{{  showEnd

function showEnd () {

  if (chess.in_checkmate())
    $(lozData.idInfo).html('Checkmate');
  else if (chess.insufficient_material())
    $(lozData.idInfo).html('Draw due to insufficient material');
  else if (chess.in_draw())
    $(lozData.idInfo).html('Draw by 50 move rule');
  else if (chess.in_stalemate())
    $(lozData.idInfo).html('Draw by stalemate');
  else if (chess.in_threefold_repetition())
    $(lozData.idInfo).html('Draw by threefold repetition');
  else
    $(lozData.idInfo).html('Game over but not sure why!');
}

//}}}
//{{{  getLevel

function getLevel () {

  level = parseInt(args.l);
  if (level <= 0)
    level = 1;
  if (level > 10)
    level = 10;
}

//}}}
//{{{  postGo

function postGo () {

  var go = '';

  if (level < 1)
    level = 1;

  if (args.m)
    go = args.m;

  else if (level <= 8) {
    go = 'go depth ' + level;
  }
  else if (level == 9)
      go = 'go movetime 2000';

  else if (level >= 10)
      go = 'go movetime 10000';

  $('#strength').html('Strength (' + level + ')'); //jic
  engine.postMessage('debug off')
  engine.postMessage(go);
}

//}}}

$(function() {

  //{{{  init DOM
  
  if (args.l) {
    getLevel();
  }
  
  //}}}
  //{{{  handlers
  
  $('#playw').click(function() {
  
    window.location = lozMakeURL ({
      l : level
    });
  
    return true;
  });
  
  $('#playb').click(function() {
  
    window.location = lozMakeURL ({
      l : level,
      c : 'b'
    });
  
    return true;
  });
  
  $('#level1').click(function() {
    level=1;
    $('#strength').html('Strength (1)');
    return true;
  });
  $('#level2').click(function() {
    level=2;
    $('#strength').html('Strength (2)');
    return true;
  });
  
  $('#level3').click(function() {
    level=3;
    $('#strength').html('Strength (3)');
    return true;
  });
  
  $('#level4').click(function() {
    level=4;
    $('#strength').html('Strength (4)');
    return true;
  });
  
  $('#level5').click(function() {
    level=5;
    $('#strength').html('Strength (5)');
    return true;
  });
  
  $('#level6').click(function() {
    level=6;
    $('#strength').html('Strength (6)');
    return true;
  });
  
  $('#level7').click(function() {
    level=7;
    $('#strength').html('Strength (7)');
    return true;
  });
  
  $('#level8').click(function() {
    level=8;
    $('#strength').html('Strength (8)');
    return true;
  });
  
  $('#level9').click(function() {
    level=9;
    $('#strength').html('Strength (9)');
    return true;
  });
  
  $('#level10').click(function() {
    level=10;
    $('#strength').html('Strength (10)');
    return true;
  });
  
  $('#analyse').click(function() {
  
    window.open("fen.htm?fen=" + chess.fen(),"_blank");
  
    return false;
  });
  
  
  //}}}

  engine           = new Worker(lozData.source);
  engine.onmessage = lozStandardRx;

  if (args.fen) {
    startFrom   = 'fen ' + args.fen;
    startFromUI = args.fen;
    chess = new Chess(args.fen);
    $("#playw").hide();
    $("#playb").hide();
  }
  else
    chess = new Chess();

  board = new ChessBoard('board', {
    showNotation : true,
    draggable    : true,
    dropOffBoard : 'snapback',
    onDrop       : onDrop,
    onDragStart  : onDragStart,
    position     : startFromUI
  });

  //$(lozData.idInfo).prepend('Version ' + BUILD + ' ' + PLAYBUILD + '<br>');
  engine.postMessage('uci')
  engine.postMessage('ucinewgame')
  engine.postMessage('debug off')

  if (!args.fen && args.c == 'b' || args.fen && args.fen.search(' w') !== -1 && args.c == 'b') {
    board.orientation('black');
    engine.postMessage('position ' + startFrom);
    postGo();
    $(lozData.idInfo).prepend('You are black' + '<br>');
  }
  else if (!args.fen && args.c != 'b' || args.fen && args.fen.search(' w') !== -1 && args.c != 'b') {
    board.orientation('white');
    $(lozData.idInfo).prepend('Your move with white pieces' + '<br>');
  }
  else if (args.fen && args.fen.search(' b') !== -1 && args.c == 'b') {
    board.orientation('black');
    $(lozData.idInfo).prepend('Your move with black pieces' + '<br>');
  }
  else if (args.fen && args.fen.search(' b') !== -1 && args.c != 'b') {
    board.orientation('white');
    engine.postMessage('position ' + startFrom);
    postGo();
    $(lozData.idInfo).prepend('You are white' + '<br>');
  }
  else {
    $(lozData.idInfo).prepend('INCONSISTENT ARGS' + '<br>');
  }
  //$(lozData.idInfo).prepend('Level ' + level + '<br>');
  $('#strength').html('Strength (' + level + ')');

  //console.log(args);

});

