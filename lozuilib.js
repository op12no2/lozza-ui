
if (typeof console == "undefined") {
  this.console = {log: function() {}};
}

var lozData = {};

lozData.next     = 0; // next board id.
lozData.hashFull = 0;
lozData.mvNum    = 0;
lozData.mvStr    = '';
lozData.source   = 'lozza.js';

//{{{  Number.round

Number.prototype.round = function (places) {

  return +(Math.round(this + "e+" + places)  + "e-" + places);
}

//}}}
//{{{  lozGetURLArgs

function lozGetURLArgs() {

  var url = location.href;
  var qs  = url.substring(url.indexOf('?') + 1).split('&');

  for(var i = 0, result = {}; i < qs.length; i++) {
    qs[i]            = qs[i].split('=');
    result[qs[i][0]] = decodeURIComponent(qs[i][1]);
  }

  return result;
}

//}}}
//{{{  lozDecodeFEN

function lozDecodeFEN (fen) {

  fen = fen.replace(/\s+/g,' ');

  var a = fen.split(' ');

  var feno = {};

  feno.board  = (a[0] == undefined) ? ''     : a[0];
  feno.turn   = (a[1] == undefined) ? 'w'    : a[1];
  feno.rights = (a[2] == undefined) ? 'KQkq' : a[2];
  feno.ep     = (a[3] == undefined) ? '-'    : a[3];

  return feno;
}

//}}}
//{{{  lozEncodeFEN

function lozEncodeFEN(feno) {

  return feno.board + ' ' + feno.turn  + ' ' + feno.rights  + ' ' + feno.ep + ' 0 1';
}

//}}}
//{{{  lozMakeURL

function lozMakeURL(u) {

  var url = lozData.page;
  var sep = '?';

  for (var a in u) {
    if (typeof u[a] == 'undefined')
      continue;
    url += sep + a + '=' + u[a];
    sep = '&';
  }

  return url;
}

//}}}

//{{{  lozGetInt

function lozGetInt (key, def) {

  for (var i=0; i < lozData.tokens.length; i++)
    if (lozData.tokens[i] == key)
      return parseInt(lozData.tokens[i+1]);

  return def;
}

//}}}
//{{{  lozGetInt1

function lozGetInt1 (key, def) {

  for (var i=0; i < lozData.tokens.length; i++)
    if (lozData.tokens[i] == key)
      return parseInt(lozData.tokens[i+2]);

  return def;
}

//}}}
//{{{  lozGetStr

function lozGetStr (key, def) {

  for (var i=0; i < lozData.tokens.length; i++)
    if (lozData.tokens[i] == key)
      return lozData.tokens[i+1];

  return def;
}

//}}}
//{{{  lozGetStrToEnd

function lozGetStrToEnd (key, def) {

  for (var i=0; i < lozData.tokens.length; i++) {
    if (lozData.tokens[i] == key) {
      var val = '';
      for (var j=i+1; j < lozData.tokens.length; j++)
        val += lozData.tokens[j] + ' ';
      return val;
    }
  }

  return def;
}

//}}}
//{{{  lozStandardRx

function lozStandardRx (e) {

  //console.log(e.data);

  lozData.message = e.data;
  lozData.message = lozData.message.trim();
  lozData.message = lozData.message.replace(/\s+/g,' ');
  lozData.tokens  = lozData.message.split(' ');

  //{{{  bestmove
  
  if (lozData.tokens[0] == 'bestmove') {
  
    lozUpdateStats();
  
    //console.log(lozData);
  
    lozData.bm   = lozGetStr('bestmove','');
    lozData.bmFr = lozData.bm[0] + lozData.bm[1];
    lozData.bmTo = lozData.bm[2] + lozData.bm[3];
    if (lozData.bm.length > 4)
      lozData.bmPr = lozData.bm[4];
    else
      lozData.bmPr = '';
  
    lozUpdateBestMove();
  }
  
  //}}}
  //{{{  option
  
  else if (lozData.tokens[0] == 'option') {
    ;
  }
  
  //}}}
  //{{{  info string debug
  
  else if (lozData.tokens[0] == 'info' && lozData.tokens[1] == 'string' && lozData.tokens[2] == 'debug') {
  
    lozData.info = '<b>' + lozData.message.replace(/info string debug /,'') + '</b>';
  
    lozUpdateInfo();
  }
  
  //}}}
  //{{{  info string
  
  else if (lozData.tokens[0] == 'info' && lozData.tokens[1] == 'string') {
  
    lozData.info = lozData.message.replace(/info string /,'');
  
    lozUpdateInfo();
  }
  
  //}}}
  //{{{  info
  
  
  else if (lozData.tokens[0] == 'info') {
  
    var pv    = lozData.pv;
    var score = lozData.score;
    var units = lozData.units;
    var depth = lozData.depth;
  
    lozData.mvStr    = lozGetStr('currmove',lozData.mvStr);
    lozData.mvNum    = lozGetInt('currmovenumber',lozData.mvNum);
    lozData.depth    = lozGetInt('depth',lozData.depth);
    lozData.selDepth = lozGetInt('seldepth',lozData.seldepth);
    lozData.units    = lozGetStr('score',lozData.units);
    lozData.score    = lozGetInt1('score',lozData.score);
    lozData.pv       = lozGetStrToEnd('pv',lozData.pv);
    lozData.nodes    = lozGetInt('nodes',lozData.nodes);
    lozData.time     = lozGetInt('time',lozData.time);
    lozData.nps      = lozGetInt('nps',lozData.nps);
    lozData.hashFull = lozGetInt('hashfull',lozData.hashFull);
  
    lozData.seconds   = (lozData.time/1000).round(2);
    lozData.meganodes = (lozData.nodes/1000000).round(2);
    lozData.mnps      = (lozData.nps/1000000).round(2);
    lozData.kilonodes = (lozData.nodes/1000).round(2);
    lozData.knps      = (lozData.nps/1000).round(2);
  
    lozUpdateStats();
  
    if (pv != lozData.pv || score != lozData.score || units != lozData.units || depth != lozData.depth)
      lozUpdatePV();
  }
  
  //}}}
  //{{{  board
  
  else if (lozData.tokens[0] == 'board') {
  
    lozData.board = lozGetStr('board','');
  
    lozUpdateBoard();
  }
  
  //}}}
  //{{{  everything else
  
  else {
  
    lozData.info = lozData.message;
  
    lozUpdateInfo();
  }
  
  //}}}
}

//}}}
//{{{  lozUpdateBestMove

function lozUpdateBestMove () {

}

//}}}
//{{{  lozUpdateStats

function lozUpdateStats () {

  if (lozData.mvNum && lozData.mvStr)
    var move = ' | ' + lozData.mvNum + '/' + lozData.mvStr;
  else
    var move = '';

  if (lozData.hashFull)
    var hash = ' | ' + lozData.hashFull/10 + '%';
  else
    var hash = '';

  $(lozData.idStats).html(lozData.seconds + ' s | ' + lozData.kilonodes + ' kn | ' + lozData.knps + ' kn/s' + move + hash);
}

//}}}
//{{{  lozUpdatePV

function lozUpdatePV () {

  if (lozData.selDepth)
    var d = lozData.depth + '/' + lozData.selDepth;
  else
    var d = lozData.depth;

  $(lozData.idInfo).prepend(lozData.seconds + ' ' + d + ' (' + lozData.score + ' ' + lozData.units + ') ' + lozData.pv + '<br>');
}

//}}}
//{{{  lozUpdateInfo

function lozUpdateInfo () {

  $(lozData.idInfo).prepend(lozData.info + '<br>');
}

//}}}
//{{{  lozUpdateBoard

function lozUpdateBoard () {

  var id = 'board' + lozData.next++;

  $(lozData.idInfo).prepend('<div style="width: 250px;" id="' + id + '"><div>');

  var cb = new ChessBoard(id, {
    showNotation : true,
    draggable    : true,
    dropOffBoard : 'snapback',
    position     : lozData.tokens[1]
  });

}

//}}}

