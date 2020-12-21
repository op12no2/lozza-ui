
var args      = lozGetURLArgs();
var board     = null;
var bmData    = [];
var bmFile    = '';
var bmTime    = 10000;
var bmLimit   = 0;
var numBMs    = 0;
var thisBM    = -1;
var thisFEN   = '';
var right     = 0;
var wrong     = 0;
var wrongNums = '';
var wrongFens = '';

//{{{  isBM

var FIL = ['a','b','c','d','e','f','g','h'];

function isBM (bm,fuzzy) {

  if (thisFEN.indexOf('; dm ') != -1 && lozData.units == 'mate')
    return true;

  var safebm = 'am ' + bm + '';  if (thisFEN.indexOf(safebm) != -1) return false;
  var safebm = ' '   + bm + ' '; if (thisFEN.indexOf(safebm) != -1) return true;
  var safebm = ' '   + bm + ';'; if (thisFEN.indexOf(safebm) != -1) return true;
  var safebm = ' '   + bm + '+'; if (thisFEN.indexOf(safebm) != -1) return true;
  var safebm = ' '   + bm + '#'; if (thisFEN.indexOf(safebm) != -1) return true;
  var safebm = ' '   + bm + '='; if (thisFEN.indexOf(safebm) != -1) return true;

  if (!fuzzy)
    return false;

  if (bm[2] == 'x' && bm.length == 5)
    return isBM ('' + bm[0] + 'x' + bm[3] + bm[4],0);

  if (bm[2] == 'x' && bm.length == 7)
    return isBM ('' + bm[0] + 'x' + bm[3] + bm[4] + bm[5] + bm[6],0);

  var bm2 = '';
  for (var i=1; i < bm.length; i++)
    bm2 += bm[i];

  for (var i=0; i < FIL.length; i++) {
    var bm3 = bm[0] + FIL[i] + bm2;
    var is = isBM(bm3,0);
    if (is)
      return is;
  }

  return false;
}

//}}}
//{{{  lozUpdateBestMove

function lozUpdateBestMove () {

  if (thisBM % 310 == 0)
    $('#info').html('');

  if (thisBM >= 0) {
    var bm = lozData.pv.split(' ')[0];
    if (isBM(bm,1)) {
      right++;
      $('#info').prepend('<span style="color:blue; font-weight: bold;">' + thisFEN + ' | ' + bm + ' RIGHT</span><br>');
    }
    else {
      wrong++;
      wrongNums += (thisBM+1) + ' ';
      wrongFens += thisFEN + '<br>';
      $('#info').prepend('<span style="color:red; font-weight: bold;">' + thisFEN + ' | ' + bm + ' WRONG</span><br>');
    }
    var percent = Math.round((right/(right+wrong)) * 100);

    $('#score').html  ('<span style="color:blue; font-weight: bold;">' + right + '/' + numBMs + ' (' + percent + '%)</span><br>');
    $('#score').append('<span style="color:red;  font-weight: bold;">' + wrong + '/' + numBMs + '</span><br>');
    //$('#score').append('<span style="color:red;  font-weight: bold;">' + wrongNums + '</span>');
    $('#score').append('<div  style="color:red;  font-weight: bold;">' + wrongFens + '</div>');
  }

  thisBM++;
  if (thisBM >= numBMs || (bmLimit && thisBM > bmLimit)) {
    engine.terminate();
    return;
  }

  thisFEN = bmData[thisBM];

  board.position(thisFEN);

  $('#fen').html(thisFEN);

  engine.postMessage('ucinewgame\ndebug off')
  engine.postMessage('position fen ' + thisFEN);
  engine.postMessage('go movetime ' + bmTime);
}

//}}}

lozData.idInfo  = '#info';
lozData.idStats = '#stats';

var engine       = new Worker('lozza.js');
engine.onmessage = lozStandardRx;

if (args.t)
  bmTime = parseInt(args.t);

if (args.f)
  bmFile = args.f;
else
  bmFile = '';

if (args.l)
  bmLimit = parseInt(args.l);
else
  bmLimit = 0;

$(function() {

  $('#stop').click(function() {
    engine.terminate();
    engine = null;
    return false;
  });

  if (bmFile) {
    $('#comment').append('Use <b>&amp;t=<i>n</i></b> (<i>n</i> in ms) in the URL to change the time per position from the current value.');
    $('#stats').html('Loading EPD data from server...');
    $.get('epd/'+args.f, function(data) {
      data    = data.trim();
      data    = data.replace(/\r/g,'');
      bmData  = data.split('\n');
      numBMs  = bmData.length;
      board = new ChessBoard('board', {
        showNotation : true,
        draggable    : false,
        position     : 'start'
      });
      engine.postMessage('ping');
      lozUpdateBestMove();
    });
  }
  else {
    $.get('epd/epd.txt', function(data) {
      data         = data.trim();
      data         = data.replace(/\r/g,'');
      var epdFiles = data.split('\n');
      for (var i=0; i < epdFiles.length; i++) {
        var epdFile  = epdFiles[i].trim();
        if (!epdFile)
           continue;
        var line = epdFile.split('|');
        var fil   = line[0];
        var nam   = line[1];
        var tim   = line[2];
        var url   = line[3];
        $('#comment').append('<b>' + nam + '</b> <a href="epd/' + fil + '?t=' + tim + '">view</a> | <a href="bm.htm?f=' + fil + '&t=' + tim + '">run</a> | <a href="' + url + '">info</a> | ' + tim + 'ms<br>');
      }
      $('#comment').append('<br>Adjust the default time per position (in ms) by editing t=<i>n</i> in the URL and clicking enter to reload the page.<br>');
      $('#comment').append('<br>Only mate positions are terminated early.<br>');
    });
  }
});

