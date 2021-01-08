//
// https://github.com/op12no2
//
// needs lozza.js (e1) and good.js (e2)
// results are e1 based: e1 wins - e2 wins - draws - e1 points %
// e2 is sent the options.
//

var verbose   = 0;   // display games
var moveTime  = 25;  // ms
var selOption = 0;   // so sendOption func can see it

var optionV = [315,320,325];

function sendOption () {
  //var c = 'pstsquare piece 5 sq 113 mid ' + optionV[selOption];
  var c = 'pvalue knight ' + optionV[selOption];
  //console.log(selOption,c);
  return c;
}

///////////////////////////////

if (!window.Worker) {
  document.write('<p><b>DUDE, YOUR BROWSER IS TOO OLD TO PLAY CHESS!<p>TRY <a href="http://www.google.co.uk/chrome/">GOOGLE CHROME</a></a><p>');
  exit;
}

var numOptions  = optionV.length;
var optionR     = [];
var optionC     = [];
var args        = lozGetURLArgs();
var board       = null;
var chess       = null;
var e1          = null;
var e2          = null;
var numOpenings = OPENINGS.length;
var numGames    = 0;
var numMoves    = 0;
var e1Wins      = 0;
var e2Wins      = 0;
var numDraws    = 0;
var first       = 1;
var id          = 0;
var timeThen    = Date.now();
var stopping    = 0;

for (var i=0; i < numOptions; i++) {
  optionR[i] = 0.0;
  optionC[i] = 0.0;
}

function pickOption () {
  selOption = Math.random() * numOptions | 0;
  if (selOption < 0 || selOption >= numOptions)
    console.log(selOption,'option out of bounds');
  else
    console.log('trying value',optionV[selOption],'...');
  return selOption;
}

function randMoveTime () {
  var r = moveTime + ((moveTime/5) * Math.random()) - (moveTime/10) | 0;
  //console.log(r);
  return r;
}

function randomise () {

  var t = Date.now();
  var m = t % 10000;
  var r = 0;
  for (var i=0; i<m; i++)
    r = r + Math.random();
  console.log(r);
  return r;
}

//console.log('numOpenings',numOpenings);

lozData.page    = 'tune.htm';
lozData.idInfo  = '#info';
lozData.idStats = '#stats';

function e1Message (e) {
  eMessage(e,e1,e2,1);
}

function e2Message (e) {
  eMessage(e,e2,e1,2);
}

function eMessage (e,me,tx,n) {

  lozData.message = e.data;
  lozData.message = lozData.message.trim();
  lozData.message = lozData.message.replace(/\s+/g,' ');
  lozData.tokens  = lozData.message.split(' ');

  if (lozData.tokens[0] == 'bestmove') {

    var move = {};

    lozData.bm   = lozGetStr('bestmove','');
    lozData.bmFr = lozData.bm[0] + lozData.bm[1];
    lozData.bmTo = lozData.bm[2] + lozData.bm[3];
    if (lozData.bm.length > 4) {
      lozData.bmPr   = lozData.bm[4];
      move.promotion = lozData.bmPr;
    }
    else
      lozData.bmPr = '';

    move.from = lozData.bmFr;
    move.to   = lozData.bmTo;

    if (!chess.move(move))
      console.log('e',n,'invalid move',move,lozData.bm);

    if (verbose)
      board.position(chess.fen());

    if (!chess.game_over()) {
      tx.postMessage('position startpos moves ' + strMoves());
      tx.postMessage('go movetime ' + randMoveTime());
    }
    else {
      board.position(chess.fen());
      showEnd(n);
    }
  }

  else if (lozData.tokens[0] == 'info') {
    var depth    = lozGetInt('depth',0);
    var seldepth = lozGetInt('seldepth',0);
    if (depth && seldepth)
      $(lozData.idStats).html('' + depth + '/' + seldepth + ' ' + numMoves);
  }
  else if (id < 2 && lozData.tokens[1] == 'name') {
    $(lozData.idInfo).append(lozGetStr('Lozza','?')+'<br>');
    id++;
  }
}

function strMoves() {

  var movesStr = '';
  var moves    = chess.history({verbose: true});

  numMoves = moves.length / 2 | 0;

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

function showEnd (n) {

  if (n) {

    e1.terminate();
    e2.terminate();

    if (chess.in_checkmate()) {
      if (n == 1) {
        e1Wins += 1;
        //optionR[selOption] = optionR[selOption] - 1.0;
      }
      else if (n == 2) {
        e2Wins += 1;
        optionR[selOption] = optionR[selOption] + 1.0;
      }
      else
        console.log('showEnd bad n value',n);
    }
    else {
      numDraws += 1;
      optionR[selOption] = optionR[selOption] + 0.5;
    }

    numGames++;

    if (numGames != numDraws + e1Wins + e2Wins)
      console.log('scoring error',numGames,numDraws,e1Wins,e2Wins);

    var e1Points  = e1Wins + 0.5 * numDraws;
    var e2Points  = e2Wins + 0.5 * numDraws;
    var e1Percent = 0.5 + e1Points / (e1Points+e2Points) * 100 | 0;

    $(lozData.idInfo).html('' + numGames + ': ' + e1Wins + '-' + e2Wins + '-' + numDraws + ' ' + e1Percent + '%<br>');

    console.log(optionC,optionR,optionV);

    var timeNow = Date.now();
    if (numGames % 100 == 0)
      console.log('games per hour',((numGames/(timeNow-timeThen))*1000*60*60)|0);
  }

  if (stopping)
    return;

  var choose    = Math.random() * numOpenings | 0;
  var opening   = OPENINGS[choose];
  //console.log(choose);
  var openMoves = opening.split(' ');

  chess.reset();

  for (var i=0; i < openMoves.length; i++) {
    var move = openMoves[i];
    if (!chess.move({from: move[0]+move[1], to: move[2]+move[3]}))
      console.log('invalid opening move',i,move);
  }

  if (verbose)
    board.position(chess.fen());

  e1           = new Worker('lozza.js');
  e1.onmessage = e1Message;

  e2           = new Worker('good.js');
  e2.onmessage = e2Message;

  e1.postMessage('uci')
  e1.postMessage('ucinewgame')
  e1.postMessage('debug off')

  selOption = pickOption();
  optionC[selOption] = optionC[selOption] + 1;

  e2.postMessage('uci')
  e2.postMessage('ucinewgame')
  e2.postMessage('debug off')
  e2.postMessage(''+sendOption())

  if (first == 1) {
    e1.postMessage('position startpos moves ' + strMoves());
    e1.postMessage('go movetime ' + randMoveTime());
    first = 2;
  }
  else if (first == 2){
    e2.postMessage('position startpos moves ' + strMoves());
    e2.postMessage('go movetime ' + randMoveTime());
    first = 1;
  }
  else
    console.log('showEnd bad first value',first);
}

$(function() {

  $('#stop').click(function() {
    stopping = 1;
    console.log('stopping after this game...');
    return true;
  });

  $('#restart').click(function() {
    stopping = 0;
    showEnd(0);
    return true;
  });

  randomise();

  chess = new Chess();

  board = new ChessBoard('board', {
    showNotation : true,
    draggable    : false,
    position     : 'start'
  });

  showEnd(0);
});

