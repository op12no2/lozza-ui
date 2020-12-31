
// https://github.com/op12no2

if (!window.Worker) {
  document.write('<p><b>DUDE, YOUR BROWSER IS TOO OLD TO PLAY CHESS!<p>TRY <a href="http://www.google.co.uk/chrome/">GOOGLE CHROME</a></a><p>');
  exit;
}

var args       = lozGetURLArgs();
var board      = null;
var chess      = null;
var epds       = [];
var time       = 0;
var timeHandle = 0;
var goes       = 10;
var right      = 0;

function initRandom() {
  var d = new Date();
  var t = d.getTime();
  var m = t % 1000;
  var r = 0;
  for (var i=0; i<m; i++)
    r = r + Math.random();
}

function another () {

  var epd  = epds[Math.random() * epds.length | 0];
  var epda = epd.split(' ');

  epd = '';
  for (var i = 0; i < 4; i++)
    epd = epd + epda[i] + ' ';
  epd = epd + '0 1';

  chess.load(epd);
  board.position(epd);

  if (epda[1] == 'w')
    board.orientation('white');
  else
    board.orientation('black');

  //$('#info').html('<a target = "_blank" title="click to analyse in a new tab" href="fen.htm?act=ana&fen=' + epd + '">' + epd + '</a><br>');
  $('#info').html('<br>');
}

var onDrop = function(source, target, piece, newPos, oldPos, orientation) {

  if (target == 'offboard' || target == source)
    return;

  var move = chess.move({from: source, to: target, promotion: 'n'})
  if (!move) {
    $('#info').prepend('Illegal move, 10 second penalty.<br>');
    time -= 10000;
    return 'snapback';
  }

  if (!chess.in_checkmate()) {
    chess.undo();
    move = chess.move({from: source, to: target, promotion: 'b'})
  }
  if (!chess.in_checkmate()) {
    chess.undo();
    move = chess.move({from: source, to: target, promotion: 'r'})
  }
  if (!chess.in_checkmate()) {
    chess.undo();
    move = chess.move({from: source, to: target, promotion: 'q'})
  }

  if (chess.in_checkmate()) {
    board.position(chess.fen());
    right++;
    if (right == goes) {
      clearInterval(timeHandle);
      $('#stats').html('' + Math.round((Date.now()-time)/1000));
      $('#info').html('<b>Finished. Your score was ' + $('#stats').text() + '</b>');
      $('#start').html('Try again');
    }
    else {
      $('#board').find('.square-' + target).addClass('mate');
      $('#info').html('<span style="color: green; font-weight: bold;">RIGHT</span>');
      setTimeout(another,1000);
    }
    return 'trash';
  }
  else {
    $('#info').prepend('wrong move, 5 second penalty.<br>');
    time -= 5000;
    chess.undo();
    return 'snapback';
  }
};

function timer() {
  $('#stats').html('' + Math.round((Date.now()-time)/1000));
  $('#stats').append('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + right + '/' + goes);
  $('#stats').append('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="background: yellow; padding: 3px;">' + board.orientation().toUpperCase() + '&nbsp;to&nbsp;move</span>');
}

$(function() {

  initRandom();

  $('#stats').html('Loading EPD data from server...');
  $.get('matein1.txt', function(data) {
    data = data.trim();
    data = data.replace(/\r/g,'');
    epds = data.split('\n');
    $('#stats').html('');
  });

  $('#start').click(function() {
    $('#info').html('');
    time  = Date.now();
    right = 0;
    if (timeHandle)
      clearInterval(timeHandle);
    timeHandle = setInterval(timer, 90);
    another();
    return false;
  });

  chess = new Chess();
  board = new ChessBoard('board', {
    showNotation : true,
    draggable    : true,
    dropOffBoard : 'snapback',
    onDrop       : onDrop
  });

  $('#info').append('After you click Start you must solve<br>');
  $('#info').append(goes + ' mate-in-1 puzzles.  Your total time is<br>');
  $('#info').append('your final score, so lower scores are better.<br>');
  $('#info').append('There are time penalties for illegal and wrong moves.<br>');
  $('#info').append('Drag the piece to the mating square using the mouse.<br>');

});

