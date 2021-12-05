//
// https://github.com/op12no2/lozza
//
// A hand-coded Javascript chess engine inspired by Fabien Letouzey's Fruit 2.1.
//

var BUILD       = "2.1";
var USEPAWNHASH = 1;
var USEHCE      = 1;
var USENET      = 0;
var DEBUG       = 0;      // turn on if using board.hashCheck()

//{{{  history
/*

2.1 01/12/21 Add penalty when no moves.
2.1 01/12/21 Optimise Q a bit.
2.1 01/12/21 Move node count to Q so go nodes means something.
2.1 13/11/21 Change futility margin from 120 to 100.
2.1 13/11/21 Don't do EG tempo.
2.1 11/11/21 Add a primitive little network.
2.1 27/09/21 Set mob offsets to 0 while buggy.

2.0 19/02/21 Add imbalance terms when no pawns.
2.0 17/02/21 Tune all eval params.
2.0 16/02/21 Swap mate and draw testing order in search.
2.0 12/02/21 Do LMR earlier.
2.0 11/02/21 Add draft bench command.
2.0 10/02/21 Use pre generated random numbers using https://github.com/davidbau/seedrandom.
2.0 10/02/21 Use depth^3 (>=beta), depth^2 (>=alpha) and -depth  (< alpha) for history.
2.0 09/02/21 Add -ve history scores for moves < alpha.
2.0 08/02/21 Don't do LMP in a pvNode. We need a move!
2.0 07/02/21 Don't try and reduce when in check (optimisation).
2.0 06/02/21 Remove support for jsUCI.
2.0 23/01/21 Tune piece values and PSTs.
2.0 10/01/21 Rearrange eval params so they can be tuned.
2.0 03/01/21 Simplify phase and eval calc.

1.18 Don't pseudo-move king adjacent to king.
1.18 Fix black king endgame PST.
1.18 Fix tapered eval calc.
1.18 Fix alpha/beta mate predicates.
1.18 Fix trapped knights bug (thanks Tamas).
1.18 Fix hash table put bug.
1.18 Add depth element to LMR.
1.18 Increase pruning.
1.18 Remove alpha TT saves in move loop.
1.18 Better tempo.
1.18 Better king safety.
1.18 Better passed pawn eval.
1.18 Fix TC.

1.17 Min move time of 10ms.
1.17 Change futility to depth <= 4 (from 5).
1.17 Use TT at root.
1.17 Increase LMR a bit.
1.17 Add eval tempo back in.
1.17 Remove phase from extend expression.
1.17 R=3 always in NMP.

1.16 Rearrange eval to be based on parts of the Toga User Manual (i.e. Fruit 2.1).
1.16 Send node count back when PV is updated.
1.16 Include non capture promotions in QS.
1.16 Fix unstoppable passer WRT hash (using king squares and turn).
1.16 Fix unstoppable passer values.
1.16 Improve pawn eval.
1.16 Fix bug with futility/LMR else/if.
1.16 Remove tempo from eval.
1.16 Only score knight outputs if isolated from enemy pawns.
1.16 Use fail soft in QS.
1.16 Don't return from QSearch root if in check.
1.16 Reduce futility severity.
1.16 Add king attacks and knight outposts to eval and tidy eval up a bit..
1.16 Don't prune killers!
1.16 Use bits for pawn eval.

1.15 Fix move rank overflow.
1.15 add SQ* constants.
1.15 change futility to 50.
1.15 increase history range.
1.15 Add R|Q on 7th bonus.
1.15 Change futility to 60.
1.15 Change queen to 1000.
1.15 Jiggle what is and isn't predicated on mate scores.
1.15 Add # to PV if mate score.
1.15 Fix queening SAN format.
1.15 Dump arbitrary passed bonuses.
1.15 Dump Connectivity PSTs. They were making passed pawns stop.
1.15 Use a passed pawn PST based on Fruit curve.
1.15 Change PVS condition to !bestMove from numLegalMoves == 1.
1.15 Use Fruit 2.1 piece PSTs.
1.15 Add && !betaMate to futility condition.
1.15 Don't do root Q futility.
1.15 Change double time from 5 to 3 moves after opening.
1.15 Fix +inc time control.
1.15 Add some typed arrays to help V8.
1.15 Tweaks to stop some V8 deoptimising.
1.15 Don't call eval if in check in alphabeta().
1.15 Speed up Q move gen.
1.15 Speed up move gen.
1.15 Speed up mobility;
1.15 Speed up isAttacked();

1.14 Add massive bonus for pawn-supported pawn on 7th rank.
1.14 Don't futility away pawn pushes to 6th rank.
1.14 Fix how PV is displayed WRT hash loops.
1.14 Send node info with PV for ChessGUI, fix hashUsed info.
1.14 Redo how host is detected.
1.14 Add time when fail low at root.
1.14 Add time for first 5 moves after opening.
1.14 Be less confident about time left as number of moves increases.
1.14 Fix time control for increments.
1.14 Reset the stats on the go command.
1.14 Get synchronous PV working with node.js on Windows.
1.14 Check for draws before anything else.
1.14 Don't assume hash move is legal.
1.14 Use |0 as needed and don't use Math.floor() or Math.round() in critical places.
1.14 Remove alphaMate stuff.
1.14 Don't make beta pruning and null move dependent on betaMate.
1.13 Add support for node.js allowing Lozza to run on any platform that supports node.js.
1.13 Send stats back to host early to reset counters.
1.13 Use O not 0 for castling to avoid potential expression confusion.

1.12 Add untuned mobility to eval.
1.12 Tweak King safety.
1.12 Enable LMP now we're using history for move ordering.
1.12 Remove ugly castling running eval in makeMove.
1.12 Increase LMR because of history based move ordering.
1.12 Use history (and PSTs if no history) for move ordering.

1.11 No null move if lone king.
1.11 Change to always write TT, no exceptions.
1.11 Make a micro adjustment to the way Zobrist randoms are generated.
1.11 Implement UCI info hashfull.

1.10 Fix occasional null PVs.
1.10 Fix promotion not being allowed by the web UI.
1.10 Add board, stop, start, clear, id, ping & eval to UCI console.
1.10 Add verbose option to evaluate.

1.9 Add late move pruning.
1.9 Rearrange things a bit.

1.8 Untuned isolated pawns.
1.8 Add pawn hash.
1.8 Use ply (not whole moves) for UCI mate scores.
1.8 Fix bug with best move sometimes being the wrong one because of a timeout.

1.7 Fix LMR condition in root search.
1.7 Untuned beta pruning.
1.7 Untuned passed/doubled pawns.
1.7 Untuned king safety.

1.6 Use end game PSTs for move ordering.
1.6 Only do futility if depth <= 5.
1.6 Check for illegal position by detecting 0 moves at root.
1.6 Fix UCI "mate" score.
1.6 More traditional extension/reduction arrangement.

1.5 Tweak LMR constants.

1.4 Better castling rights update.
1.4 Change futility thresholds.

1.3 Never futility away all moves; do at least one.
1.3 Tweak time controls.

1.2 Point nodes at board so global lookup not needed.
1.2 Add piece lists.

1.1 50 move draw rule.
1.1 Add K+B|N v K+B|N as insufficient material in eval.

1.0 Only reset TT on UCINEWGAME command.  Seems to work OK at last.

0.9 Encode mate scores for UI.
0.9 Use separate PSTs for move ordering.

0.8 use simple arrays for piece counts and add colour counts.
0.8 Split runningEval into runningEvalS and runningEval E and combine in evaluate();
0.8 Inline various functions.

0.7 Fix repetition detection at last.

0.6 Base LMR on the move base.
0.6 Just use > alpha for LMR research.
0.6 Fix hash update bugs.
0.6 move mate distance and rep check tests to pre horizon.
0.6 Only extend at root and if depth below horizon.
0.6 Remove lone king stuff.

0.5 Mate distance pruning.
0.5 No LMR if lone king.

0.4 No null move if a lone king on the board.
0.4 Add detection of insufficient material draws.
0.4 Add very primitive king safety to eval.
0.4 Change pCounts into wCount and bCount.
0.4 Set contempt to 0.
0.4 Fix fail soft QS bug on beta cut.

0.3 Facilitate N messages in one UCI message string.
0.3 Fix bug where search() and alphabeta() returned -INFINITY instead of oAlpha.
0.3 Adjust MATE score in TT etc.

0.2 Allow futility to filter all moves and return oAlpha in that case.
0.2 Fix infinite loops when showing PV.
0.2 Fix mate killer addition condition.
0.2 Generalise bishop counting using board.pCounts.
0.2 Don't allow a killer to be the (current) hash.
0.2 Don't research ALL node LMR fails unless R is set!
0.2 Arrange things so that QS doesn't use or affect node killers/hashes etc.  In tests it's less nodes.
0.2 Increase asp window and add time on ID research.
0.2 Add crude bishop pair bonus imp.  NB: updating a piece count array using a[i]++ and a[i]-- was too slow!!
0.2 Use tapered PSTs.

0.1 Fix bug in QS.  It *must not* fail soft.

*/

//}}}
//{{{  detect host

var HOST_WEB     = 0;
var HOST_NODEJS  = 1;
var HOST_CONSOLE = 2;
var HOSTS        = ['Web','Node','Console'];

var lozzaHost = HOST_WEB;

if ((typeof process) != 'undefined')

  lozzaHost = HOST_NODEJS;

else if ((typeof WorkerGlobalScope) == 'undefined')

  lozzaHost = HOST_CONSOLE;

//}}}
//{{{  funcs

//{{{  myround

function myround(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

//}}}
//{{{  wbmap

function wbmap (sq) {
  var m = (143-sq)/12|0;
  return 12*m + sq%12;
}

//}}}

//}}}

//{{{  constants

//{{{  ev indexes

var iMOB_NS               = 0;
var iMOB_NE               = 1;
var iMOB_BS               = 2;
var iMOB_BE               = 3;
var iMOB_RS               = 4;
var iMOB_RE               = 5;
var iMOB_QS               = 6;
var iMOB_QE               = 7;
var iATT_N                = 8;
var iATT_B                = 9;
var iATT_R                = 10;
var iATT_Q                = 11;
var iATT_M                = 12;
var iPAWN_DOUBLED_S       = 13;
var iPAWN_DOUBLED_E       = 14;
var iPAWN_ISOLATED_S      = 15;
var iPAWN_ISOLATED_E      = 16;
var iPAWN_BACKWARD_S      = 17;
var iPAWN_BACKWARD_E      = 18;
var iPAWN_PASSED_OFFSET_S = 19;
var iPAWN_PASSED_OFFSET_E = 20;
var iPAWN_PASSED_MULT_S   = 21;
var iPAWN_PASSED_MULT_E   = 22;
var iTWOBISHOPS_S         = 23;
var iROOK7TH_S            = 24;
var iROOK7TH_E            = 25;
var iROOKOPEN_S           = 26;
var iROOKOPEN_E           = 27;
var iQUEEN7TH_S           = 28;
var iQUEEN7TH_E           = 29;
var iTRAPPED              = 30;
var iKING_PENALTY         = 31;
var iPAWN_OFFSET_S        = 32;
var iPAWN_OFFSET_E        = 33;
var iPAWN_MULT_S          = 34;
var iPAWN_MULT_E          = 35;
var iPAWN_PASS_FREE       = 36;
var iPAWN_PASS_UNSTOP     = 37;
var iPAWN_PASS_KING1      = 38;
var iPAWN_PASS_KING2      = 39;
var iMOBOFF_NS            = 40;
var iMOBOFF_NE            = 41;
var iMOBOFF_BS            = 42;
var iMOBOFF_BE            = 43;
var iMOBOFF_RS            = 44;
var iMOBOFF_RE            = 45;
var iTWOBISHOPS_E         = 46;
var iSHELTERM             = 47;
var iMOBOFF_QS            = 48;
var iMOBOFF_QE            = 49;

//}}}

var MAX_PLY         = 100;                // limited by lozza.board.ttDepth bits.
var MAX_MOVES       = 250;
var INFINITY        = 30000;              // limited by lozza.board.ttScore bits.
var MATE            = 20000;
var MINMATE         = MATE - 2*MAX_PLY;
var CONTEMPT        = 0;
var NULL_Y          = 1;
var NULL_N          = 0;
var INCHECK_UNKNOWN = MATE + 1;
var TTSCORE_UNKNOWN = MATE + 2;
var ASP_MAX         = 75;
var ASP_DELTA       = 3;
var ASP_MIN         = 10;
var EMPTY           = 0;
var UCI_FMT         = 0;
var SAN_FMT         = 1;

var WHITE   = 0x0;                // toggle with: ~turn & COLOR_MASK
var BLACK   = 0x8;
var I_WHITE = 0;                  // 0/1 colour index, compute with: turn >>> 3
var I_BLACK = 1;
var M_WHITE = 1;
var M_BLACK = -1;                 // +1/-1 colour multiplier, compute with: (-turn >> 31) | 1

var PIECE_MASK = 0x7;
var COLOR_MASK = 0x8;

var VALUE_PAWN = 100;             // safe - tuning root

var NETH1SIZE = 8;
var NETINSIZE = 768;
var NETINOFF  = 384;

const TTSIZE = 1 << 22;
const TTMASK = TTSIZE - 1;

const PTTSIZE = 1 << 14;
const PTTMASK = PTTSIZE - 1;

var TT_EMPTY  = 0;
var TT_EXACT  = 1;
var TT_BETA   = 2;
var TT_ALPHA  = 3;

var PTT_EXACT = 1;
var PTT_WHOME = 2;
var PTT_BHOME = 4;
var PTT_WPASS = 8;
var PTT_BPASS = 16;

//                                 Killer?
// max            9007199254740992
//

var BASE_HASH       =  40000012000;  // no
var BASE_PROMOTES   =  40000011000;  // no
var BASE_GOODTAKES  =  40000010000;  // no
var BASE_EVENTAKES  =  40000009000;  // no
var BASE_EPTAKES    =  40000008000;  // no
var BASE_MATEKILLER =  40000007000;
var BASE_MYKILLERS  =  40000006000;
var BASE_GPKILLERS  =  40000005000;
var BASE_CASTLING   =  40000004000;  // yes
var BASE_BADTAKES   =  40000003000;  // yes
var BASE_HISSLIDE   =  20000002000;  // yes
var BASE_PSTSLIDE   =         1000;  // yes

var BASE_LMR        = BASE_BADTAKES;

var MOVE_TO_BITS      = 0;
var MOVE_FR_BITS      = 8;
var MOVE_TOOBJ_BITS   = 16;
var MOVE_FROBJ_BITS   = 20;
var MOVE_PROMAS_BITS  = 29;

var MOVE_TO_MASK       = 0x000000FF;
var MOVE_FR_MASK       = 0x0000FF00;
var MOVE_TOOBJ_MASK    = 0x000F0000;
var MOVE_FROBJ_MASK    = 0x00F00000;
var MOVE_PAWN_MASK     = 0x01000000;
var MOVE_EPTAKE_MASK   = 0x02000000;
var MOVE_EPMAKE_MASK   = 0x04000000;
var MOVE_CASTLE_MASK   = 0x08000000;
var MOVE_PROMOTE_MASK  = 0x10000000;
var MOVE_PROMAS_MASK   = 0x60000000;  // NBRQ.
var MOVE_SPARE2_MASK   = 0x80000000;

var MOVE_SPECIAL_MASK  = MOVE_CASTLE_MASK | MOVE_PROMOTE_MASK | MOVE_EPTAKE_MASK | MOVE_EPMAKE_MASK; // need extra work in make move.
var KEEPER_MASK        = MOVE_CASTLE_MASK | MOVE_PROMOTE_MASK | MOVE_EPTAKE_MASK | MOVE_TOOBJ_MASK;  // futility etc.

var NULL   = 0;
var PAWN   = 1;
var KNIGHT = 2;
var BISHOP = 3;
var ROOK   = 4;
var QUEEN  = 5;
var KING   = 6;
var EDGE   = 7;
var NO_Z   = 8;

var W_PAWN   = PAWN;
var W_KNIGHT = KNIGHT;
var W_BISHOP = BISHOP;
var W_ROOK   = ROOK;
var W_QUEEN  = QUEEN;
var W_KING   = KING;

var B_PAWN   = PAWN   | BLACK;
var B_KNIGHT = KNIGHT | BLACK;
var B_BISHOP = BISHOP | BLACK;
var B_ROOK   = ROOK   | BLACK;
var B_QUEEN  = QUEEN  | BLACK;
var B_KING   = KING   | BLACK;

//
// E == EMPTY, X = OFF BOARD, - == CANNOT HAPPEN
//
//               0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15
//               E  W  W  W  W  W  W  X  -  B  B  B  B  B  B  -
//               E  P  N  B  R  Q  K  X  -  P  N  B  R  Q  K  -
//

var IS_O      = [0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0];
var IS_E      = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_OE     = [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0];
var IS_KN     = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
var IS_K      = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0];
var IS_N      = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
var IS_P      = [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];

var IS_NBRQKE = [1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0]
var IS_RQKE   = [1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0]
var IS_QKE    = [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0]

var IS_W      = [0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WE     = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WP     = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WN     = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WB     = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WBQ    = [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var IS_WRQ    = [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var IS_B      = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0];
var IS_BE     = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0];
var IS_BP     = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
var IS_BN     = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
var IS_BB     = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
var IS_BBQ    = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0];
var IS_BRQ    = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0];

var PPHASE = 0;
var NPHASE = 1;
var BPHASE = 1;
var RPHASE = 2;
var QPHASE = 4;
var VPHASE = [0,PPHASE,NPHASE,BPHASE,RPHASE,QPHASE,0];
var TPHASE = PPHASE*16 + NPHASE*4 + BPHASE*4 + RPHASE*4 + QPHASE*2;
var EPHASE = 16;  //  Don't do Q futility after this.

var W_PROMOTE_SQ = [0,26, 27, 28, 29, 30, 31, 32, 33];
var B_PROMOTE_SQ = [0,110,111,112,113,114,115,116,117];

var A1 = 110, B1 = 111, C1 = 112, D1 = 113, E1 = 114, F1 = 115, G1 = 116, H1 = 117;
var A8 = 26,  B8 = 27,  C8 = 28,  D8 = 29,  E8 = 30,  F8 = 31,  G8 = 32,  H8 = 33;

var SQA1 = 110, SQB1 = 111, SQC1 = 112, SQD1 = 113, SQE1 = 114, SQF1 = 115, SQG1 = 116, SQH1 = 117;
var SQA2 = 98,  SQB2 = 99,  SQC2 = 100, SQD2 = 101, SQE2 = 102, SQF2 = 103, SQG2 = 104, SQH2 = 105;
var SQA3 = 86,  SQB3 = 87,  SQC3 = 88,  SQD3 = 89,  SQE3 = 90,  SQF3 = 91,  SQG3 = 92,  SQH3 = 93;
var SQA4 = 74,  SQB4 = 75,  SQC4 = 76,  SQD4 = 77,  SQE4 = 78,  SQF4 = 79,  SQG4 = 80,  SQH4 = 81;
var SQA5 = 62,  SQB5 = 63,  SQC5 = 64,  SQD5 = 65,  SQE5 = 66,  SQF5 = 67,  SQG5 = 68,  SQH5 = 69;
var SQA6 = 50,  SQB6 = 51,  SQC6 = 52,  SQD6 = 53,  SQE6 = 54,  SQF6 = 55,  SQG6 = 56,  SQH6 = 57;
var SQA7 = 38,  SQB7 = 39,  SQC7 = 40,  SQD7 = 41,  SQE7 = 42,  SQF7 = 43,  SQG7 = 44,  SQH7 = 45;
var SQA8 = 26,  SQB8 = 27,  SQC8 = 28,  SQD8 = 29,  SQE8 = 30,  SQF8 = 31,  SQG8 = 32,  SQH8 = 33;

var MOVE_E1G1 = MOVE_CASTLE_MASK | (W_KING << MOVE_FROBJ_BITS) | (E1 << MOVE_FR_BITS) | G1;
var MOVE_E1C1 = MOVE_CASTLE_MASK | (W_KING << MOVE_FROBJ_BITS) | (E1 << MOVE_FR_BITS) | C1;
var MOVE_E8G8 = MOVE_CASTLE_MASK | (B_KING << MOVE_FROBJ_BITS) | (E8 << MOVE_FR_BITS) | G8;
var MOVE_E8C8 = MOVE_CASTLE_MASK | (B_KING << MOVE_FROBJ_BITS) | (E8 << MOVE_FR_BITS) | C8;

var QPRO = (QUEEN-2)  << MOVE_PROMAS_BITS | MOVE_PROMOTE_MASK;
var RPRO = (ROOK-2)   << MOVE_PROMAS_BITS | MOVE_PROMOTE_MASK;
var BPRO = (BISHOP-2) << MOVE_PROMAS_BITS | MOVE_PROMOTE_MASK;
var NPRO = (KNIGHT-2) << MOVE_PROMAS_BITS | MOVE_PROMOTE_MASK;

var WHITE_RIGHTS_KING  = 0x00000001;
var WHITE_RIGHTS_QUEEN = 0x00000002;
var BLACK_RIGHTS_KING  = 0x00000004;
var BLACK_RIGHTS_QUEEN = 0x00000008;
var WHITE_RIGHTS       = WHITE_RIGHTS_QUEEN | WHITE_RIGHTS_KING;
var BLACK_RIGHTS       = BLACK_RIGHTS_QUEEN | BLACK_RIGHTS_KING;

var  MASK_RIGHTS =  [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, ~8, 15, 15, 15, ~12,15, 15, ~4, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, ~2, 15, 15, 15, ~3, 15, 15, ~1, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
                     15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15];

var WP_OFFSET_ORTH  = -12;
var WP_OFFSET_DIAG1 = -13;
var WP_OFFSET_DIAG2 = -11;

var BP_OFFSET_ORTH  = 12;
var BP_OFFSET_DIAG1 = 13;
var BP_OFFSET_DIAG2 = 11;

var KNIGHT_OFFSETS  = [25,-25,23,-23,14,-14,10,-10];
var BISHOP_OFFSETS  = [11,-11,13,-13];
var ROOK_OFFSETS    =               [1,-1,12,-12];
var QUEEN_OFFSETS   = [11,-11,13,-13,1,-1,12,-12];
var KING_OFFSETS    = [11,-11,13,-13,1,-1,12,-12];

var OFFSETS = [0,0,KNIGHT_OFFSETS,BISHOP_OFFSETS,ROOK_OFFSETS,QUEEN_OFFSETS,KING_OFFSETS];
var LIMITS  = [0,1,1,             8,             8,           8,            1];

var RANK_VECTOR  = [0,1,2,2,4,5,6];  // for move sorting.

var  B88 =  [26, 27, 28, 29, 30, 31, 32, 33,
             38, 39, 40, 41, 42, 43, 44, 45,
             50, 51, 52, 53, 54, 55, 56, 57,
             62, 63, 64, 65, 66, 67, 68, 69,
             74, 75, 76, 77, 78, 79, 80, 81,
             86, 87, 88, 89, 90, 91, 92, 93,
             98, 99, 100,101,102,103,104,105,
             110,111,112,113,114,115,116,117];

var COORDS =   ['??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??',
                '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??',
                '??', '??', 'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8', '??', '??',
                '??', '??', 'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', '??', '??',
                '??', '??', 'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6', '??', '??',
                '??', '??', 'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5', '??', '??',
                '??', '??', 'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4', '??', '??',
                '??', '??', 'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3', '??', '??',
                '??', '??', 'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', '??', '??',
                '??', '??', 'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', '??', '??',
                '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??',
                '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??', '??'];

var NAMES    = ['-','P','N','B','R','Q','K','-'];
var PROMOTES = ['n','b','r','q'];                  // 0-3 encoded in move.

var  RANK =  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 8, 8, 8, 8, 8, 8, 8, 8, 0, 0,
              0, 0, 7, 7, 7, 7, 7, 7, 7, 7, 0, 0,
              0, 0, 6, 6, 6, 6, 6, 6, 6, 6, 0, 0,
              0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0,
              0, 0, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0,
              0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0,
              0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0,
              0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var  FILE =  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var  CORNERS=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var  WSQUARE=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var  BSQUARE=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0,
              0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

var NULL_PST =        [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0];

var NETMAP =          [0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   1,   2,   3,   4,   5,   6,   7,   0,   0,
                       0,   0,   8,   9,   10,  11,  12,  13,  14,  15,  0,   0,
                       0,   0,   16,  17,  18,  19,  20,  21,  22,  23,  0,   0,
                       0,   0,   24,  25,  26,  27,  28,  29,  30,  31,  0,   0,
                       0,   0,   32,  33,  34,  35,  36,  37,  38,  39,  0,   0,
                       0,   0,   40,  41,  42,  43,  44,  45,  46,  47,  0,   0,
                       0,   0,   48,  49,  50,  51,  52,  53,  54,  55,  0,   0,
                       0,   0,   56,  57,  58,  59,  60,  61,  62,  63,  0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                       0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0];

var MAP = [];

MAP['p'] = B_PAWN;
MAP['n'] = B_KNIGHT;
MAP['b'] = B_BISHOP;
MAP['r'] = B_ROOK;
MAP['q'] = B_QUEEN;
MAP['k'] = B_KING;
MAP['P'] = W_PAWN;
MAP['N'] = W_KNIGHT;
MAP['B'] = W_BISHOP;
MAP['R'] = W_ROOK;
MAP['Q'] = W_QUEEN;
MAP['K'] = W_KING;

var UMAP = [];

UMAP[B_PAWN]   = 'p';
UMAP[B_KNIGHT] = 'n';
UMAP[B_BISHOP] = 'b';
UMAP[B_ROOK]   = 'r';
UMAP[B_QUEEN]  = 'q';
UMAP[B_KING]   = 'k';
UMAP[W_PAWN]   = 'P';
UMAP[W_KNIGHT] = 'N';
UMAP[W_BISHOP] = 'B';
UMAP[W_ROOK]   = 'R';
UMAP[W_QUEEN]  = 'Q';
UMAP[W_KING]   = 'K';

var STARRAY = Array(144);
var WKZONES = Array(144);
var BKZONES = Array(144);
var DIST    = Array(144);

//}}}
//{{{  random numbers

var nextRandom = 0;

var randoms = [
756905668, -1084175557, 1878823061, -625318968, -621181864, -570058847, -133173404, -505062315, 521670451, 771225885,
1849313641, 1186661906, -799682966, -225168994, 1939521286, 1659516860, 1390348927, 2015136119, -998381781, 1293648901,
1928880860, 424858752, -1586845067, 2029930516, 2143349043, 725089750, -1358272902, 1638516675, -1689963160, 816003714,
1443211549, -761390243, -372483284, 1849475807, -549469512, -1499092593, -1626271955, 381449936, 1472823989, -103393358,
1231499563, -176858263, -406123480, -932284021, 1691312185, -440588990, 468255306, -1051789162, 1574032471, -624995753,
2030632239, 12933870, 864193266, 307820063, 1688254820, 1824441426, -1435979763, 2107489219, -1095825268, 1593917697,
-1630231776, 48932339, -1109314566, 2097540161, 780490436, -165819431, -918416079, -634721135, -129518473, 1103327088,
-2088846517, -1936284658, 1799783089, -987654177, -71212207, -1620871340, 1426769203, -199569623, 1433482329, -520847795,
-741846705, 1760540845, 291834684, -1070308343, -378916939, 1311641286, 586763452, 445005983, -567208549, -1371828879,
-69665658, -1692629780, 2030367353, -409959721, -652897851, 802441367, 1342228466, 292240617, -1044420383, 405198417,
113961528, 1073557049, -543704439, 1814102103, 1968731819, -17372755, 2117807781, -534131900, 370523349, -771595952,
-2064285760, 1382415537, -534960463, 1104973414, 1371539555, 1264456512, 1487152833, -1455201654, 2091998741, -119363633,
-1017344530, 1732951305, 252587560, 1240182429, 1984495873, -1909317807, 812367925, 2123075279, -1078828331, -656138431,
1659457768, -856546583, 2134809042, 395009456, 15438238, 488587339, -4196101, 1167207259, 183774893, 966140228,
-1707123088, 383778612, -1400094809, 1959931730, -1986744199, 1679663832, -1000587684, -249909268, 1938808625, 1526357844,
-1801708763, -1716290204, -865108123, 1544323846, 280168140, 2046082411, 1516199517, -365673549, 1973396222, 845849274,
516786069, 112309472, -1454966330, -1964099301, 1169813737, 1979212614, -2022578571, 2052328863, -1890575484, 1625256554,
1242601718, -1242499525, -2011848011, -1173838658, 2072885177, 395400810, 605109126, -2022743837, 1635692173, -1023372475,
-306871878, 2013488942, 2146189444, -80305195, 353483291, 971897898, -1958080929, 1294210040, -950976956, -194669749,
546121667, 480886466, -1889547106, 1436547759, 936329723, -1068922488, 780408538, 18189673, -1358545317, -1544367796,
1218678364, -868301110, 1879768657, 460749040, -1794453192, -1547256353, -584354225, -902691927, -1996011397, 433069421,
-1060648588, 497454408, -953425096, 1764269557, 2097353230, -268221657, -2123309067, 1095297278, -1563971, -420614236,
2033299527, 532600140, -257232296, -970924489, -721189830, -1924972946, -180877239, 1022254420, -1006351284, 1144736356,
-586294206, -1766679954, 1673785257, 264224160, 1939276819, 717772815, 1461891206, 514077258, -1289365307, 1802245083,
-1747274550, 480074525, -333149291, 818194191, 1431432741, -1004401642, -1313377973, -1834730853, 851593951, 1587274419,
-724556478, -1113383997, -445179291, 631145192, -2135938758, 1914305411, 1172896003, -924994044, -427054213, 1038225551,
1961585703, -722626474, -1430844438, -1065666345, 1369260393, 140782027, -1042965800, -1298196927, -1067087217, -2106231630,
1423894796, -290441837, -644067520, -1437065047, -1145144175, -337106721, -1801690281, -79488804, -1056006637, 1097642565,
-1049097169, 1520969753, -972228282, -337992858, -1692563813, -577136450, 1857556211, 1387599169, 946034272, -1485412380,
298000023, -1775660336, -622428665, 413995950, -1101308291, -1626343888, -1015170209, 1686710649, 1740927694, -875327099,
-2088575477, 1220475083, -1874271392, 56803762, -627646490, 1066743456, 1364778585, -1315695698, 1175386892, -687339236,
-1620751832, 397743063, 863689372, 758030653, 50792047, -663186943, 1243276702, 2108096499, -2009878900, 1758692940,
1202722178, 919372813, -1925904578, 1393074385, 1446937177, -17717131, 1222281557, -660421085, 1087334168, -1367625768,
-2062161328, -1303147639, 2142100194, -534421238, -1823566723, 546324117, 1526141087, 1600545883, -1567913840, -532494697,
1274508888, 823527502, 672420800, 280664373, -800052128, 1983746417, -1355951857, 1495695143, 1609457126, 788041141,
1572415560, 1880110073, -1530224109, 1850029911, -1945269681, 2040733729, 1922494178, -995038908, 1679657621, 2072541194,
-1598776693, -736851086, 1874303889, -2118400233, -668692305, -35361388, -258322845, 2127756429, -2100612725, 1287585313,
-1349606077, -328760327, 1018844196, 722792207, 892717065, -1922745953, 534746079, -979542090, -1200022621, -619409740,
948376781, -163069564, -1477928412, -1046256959, 531931234, -2084596348, -1227715156, -175916569, 624155627, 228408448,
-970566386, 673636659, -98156747, -195712515, 860271287, -236941488, 46353087, -231972762, 411650519, 1490511692,
-955433918, -2006618858, -895509238, -2002249182, 547340724, 82770194, -1887024400, 838019807, 646648105, -1776581570,
-79178078, -1317584958, 310648348, -216749838, 921731221, 1949719761, 1020870575, 253102998, 592348740, 1508326690,
886100840, -988970, -1372457698, 1904599527, -1010754752, 820265357, 297770342, -1511765966, 2113978939, -588346764,
1004132676, -501004812, -1126623778, -858213528, -83942698, -1851593060, 1442260053, -1767006165, -1782155828, -624910398,
1138703219, -721578872, 981612394, -637526652, 1157219637, -1953142554, 917498477, 600830756, 328618634, 1594562790,
1666665374, -120628581, 568646876, -403505002, -1444646146, -124685049, 1361001792, -836335533, -1067113378, 1670748206,
-211840504, -324770027, 1365448357, 1653872299, 346089333, -71299104, -1425512333, -693446698, 1550846453, 67371333,
190746067, -966405260, 1029661946, 1487867790, -1581438200, -1553417323, 146437714, -1543367487, -2120851147, -737315900,
-307852934, 1460339074, 1864749053, 761394783, -999943645, -180098315, 1813248512, -1361507414, -339394707, -1364917923,
-526658958, -1214093223, -1059219719, 2022063764, 1337854247, 206206094, 1333516956, -2041630037, 1386466709, -1955749321,
821312212, -1529717884, -1559025292, 1583162037, -447145142, 1919448246, -770073053, 445259992, 2140203743, -1688997354,
-392282446, 569518657, -231181482, 971454830, -786591871, -2128187319, -916074883, 2116662870, -2017357334, 2004255079,
556675813, 832218982, 1530531741, 199386015, 1986121103, -209154294, -811091256, -168595515, -643220116, -2041281055,
1905121682, 863173562, -2072073736, 1081784209, -136845123, -1783716676, 1446433582, -358434388, 685061964, 1758789024,
-1431815002, -323860084, 1388447141, -1788270873, 1419882800, -1758893042, -622342832, 836704090, -44041968, 888827764,
1287697653, 133443146, -320398411, 234740251, 263785082, 1970587716, -845314893, 1370580761, 1757451046, 2100896750,
-89284714, 161594702, -508892162, -2070324930, 1073190650, -278071215, 1579202543, 1835401495, 1303168679, -539831445,
-38563537, -987284314, -1054997876, 2000350924, -1223794475, -1562792325, 2001642723, 1705266671, 945310718, 436746991,
-960076339, -1322015419, 167964337, 424200940, -1614423864, -1243206260, -1655193454, -1246349624, 1427064518, -115092789,
1189942539, -422304216, 1185350311, -2105086942, -223538582, 1344686275, -351200531, -789104611, -1694221111, -599852253,
-1381785609, 159265460, -521226282, -1042751576, 989843282, 467201678, 205128516, -742527861, 741501598, -1944096152,
1580780607, -1397564834, 699640738, -816613361, -1918935761, -327119231, -1809683366, -1165950952, 868976629, 1620007250,
1778737349, 1417562819, 1447282050, 1900728438, 958011531, -1483506590, -268395792, 1368551733, -1830556651, 1234281355,
-1283501569, 1612232304, -150581548, -1326058980, 507333456, 1553263210, 924940995, -474970063, -1125241286, -1465557022,
1290587172, 2047628553, 1769607762, 1826029911, 239574509, -722171699, 269407619, -283169299, -1770606287, -1961000988,
284878797, -78903091, 536646389, 1206705189, 1258490015, -926566659, 1565704043, 2108431611, 253865505, -1357930446,
1010396518, -1029545000, -457148518, 235974771, 1092745423, 290079798, -2080231306, -618093506, -1559291661, 2071270321,
-183628504, -2105926703, -1846447577, -770015760, 865654889, -355770962, -602746297, -1987845764, -1189090732, -380423754,
566080434, -1907789050, -123345939, -1306937519, -42385437, -1817163611, 105535024, -1552096552, -1532148314, -454570999,
1331445243, 1634430068, -1424650866, 832040989, -1696921183, -991538301, 711890248, -1905216694, 68825873, -408396209,
-1151083132, 1097199630, -1355526575, -479103375, 787355538, -558654811, 2131960091, -1840774143, -523844881, -888813217,
-562937580, -2125444827, -1415744158, -1724590234, -265350748, 2042548986, -72888312, -1628326116, 1361152559, 1735191457,
-851866528, 1541706714, -1378546404, -1830824926, 863092785, 492649896, 1911625369, 875541249, 1593833053, -724693898,
-1338974590, 344506246, 1918442319, 270650972, -1216717018, 947992317, 399411904, 804593394, 1093901451, 145633571,
-1579317041, 2120300012, 1437240332, -1790567072, -1557903331, -162371716, 680532551, -1280909911, -1706907308, 690269787,
2145164637, 1647117787, -125117749, -693453048, -1948858090, 1419008780, 1513690506, 1317384910, -1395082508, -1445119314,
828391606, 1837180016, 941001037, 951380757, -560814390, 1243050200, 1699700165, 2051753539, 1178241917, -826986520,
513448328, 2065168887, -1779648515, -429791252, 1785727753, -37272118, -1532226512, -1742723468, 1072307045, -1035604503,
-1893960904, -1169015908, 735210842, 765788954, -141003523, -593307640, 2009194589, -395219444, -506798991, 14190731,
-1421775253, -202738536, 1141075901, 1578338583, 1229365426, 1436587816, -1617735324, -148962304, 1017068801, 2059797845,
-1968350113, -1596275477, -884114990, -146610990, 1845052933, 997288554, 1571755345, 334742063, -1747598252, -704382282,
254116846, -158835984, -243583714, -1543324725, 1737247005, 1934349703, -1044462053, 910371263, 1512728593, -2019100951,
474683685, -400947055, 1270665590, -1985016907, 1095764580, 868633549, 408993884, -1050035436, 1340294615, -761011494,
-557656563, 1691451668, 602606991, -1519473638, -198425538, -633529079, 705477778, 767120233, 715018572, 788662017,
-1171217890, -1762211852, -1331559686, 1256084652, 1071746050, 697366175, -1411125546, -1045090705, -549384944, 290164447,
-2030473768, -205390440, 950215084, 1790946161, -847801821, 1068962517, -222609375, -113966370, -1282285884, 1849185587,
1405302879, -1300973537, -504060757, 1417360433, -191429140, 1170038225, 754814130, 680368242, -508271268, -2017895263,
857846654, 1930568959, 1261445337, -85757395, -555716881, -1244161622, 993255993, 1470666446, 1995653254, 1848778813,
-1706802230, -1637478756, -210964765, -1866010534, 544929819, -1563663512, -1436625282, 1196303214, -1583067792, 290486843,
-1115456002, 1638503209, 1687340314, -2053183047, -1873755915, 780100206, -1015289378, 30024949, 69728795, -2069687047,
1435848728, 787754160, -728408519, -451076113, 1659602917, -1305071806, 914470093, 937399337, 1861809423, -1067449309,
1452468940, -2124550557, -75917900, 566213424, 427649056, -84659407, -1337101961, 1141594668, 655208359, 348320975,
-905314209, -325513097, -1976993658, 1447097260, -2001160380, 550429030, 483762225, 1283163745, -817832190, 662465957,
622542511, -643631113, 1309447724, -1809609203, -223541258, 1239516780, 2038745777, -1593182772, 1744120199, 2086253132,
-2144548936, -1185688527, 622944503, 952411006, -1457932780, 2055672639, -1232425915, -1931788629, -1068456881, -1874345111,
1827240226, -264342284, 439209453, 1427936683, -802755347, 7776699, 1247504537, -1212354224, -346828621, 762346373,
824466652, -418927097, 1066703529, 2132970806, -1724412360, 1977816914, -1586026947, 531983058, -1962730010, -196959496,
-992223810, 746112047, -955399402, -2023148259, 859750440, -735691976, 1572423665, 670399355, 255223096, 1421606604,
-1723824451, -640600976, -1390390518, -831976721, -962247488, 839592429, 506631314, 1418144035, -930254817, -2050051455,
685021823, 1099984855, 816012280, 439489006, -880226026, 416676075, -2025168093, -1944506089, -490000468, -22854590,
883642439, -1527699724, -1524126691, -173563997, 627085274, 2131530630, -212423861, 755295665, 1302081446, -2055840728,
2063789066, -638070567, 1128185141, -566608961, -1107908167, 537397848, 1012073370, 1412519866, -653233702, 1151099288,
-1205016763, -617062816, -150327200, -1773165388, 1014374739, 1898591500, -12599295, 207350703, -1329570337, -2016219596,
-1317712883, 1583979870, 1747865778, -1168915472, 1030354189, -1411887538, -925796305, 789540837, -1514500313, 1140091809,
-1630985765, 1777854409, -1739203565, 2138700015, 214441662, 1243180358, 1581885858, -377638115, 870577284, -2037895234,
-171870773, -447084866, -1687769036, 1514154095, 1479138217, -2104950080, -2003567681, -1230135561, 736376550, -964565851,
157750307, 1304392987, 1789809295, 2063014017, -571117472, 561345048, 665870672, 2109562103, -1743717759, -361397593,
1621357351, 383620136, 1368220618, -290034363, 886622853, 615109235, -1813892269, -1839422105, -1919340845, 827359235,
-753450756, 543977902, 1574608794, 696754664, -1508231077, -2071596525, 169937557, 1927893838, -1096604192, -2144111678,
1845860487, -1258994360, -1514365882, -1355567102, -1932047710, -1981639303, -2097118281, 292020444, 249864992, -1241411194,
-441574998, 795662681, -1032577167, 892154533, 1764327727, 1020089339, -235736662, 191815957, -1825814844, -764075082,
747035683, 1085305105, -706295755, -1063767662, 58406530, 695498794, -1332654809, -305330567, -797369870, 40474669,
-852916187, 1719837599, -1805086992, -820152663, -2126566773, 1236648839, 705749109, 1708682047, -1900302330, -41084014,
-1559223049, 1061300725, 1048160200, 1536921898, -1770973001, 692472958, -1077086517, 227107962, -841816921, -130247532,
-504501529, 1034299853, -1436091730, 784699634, 940719833, -1631955837, -1714714641, 424848728, -415820372, -744566796,
-753590630, -19596472, 1392066560, 2016101373, 631637556, -1284981227, -1933906004, 1466119086, -257513388, 872492827,
1383181635, -1580810149, 913543194, -1535213300, 769529626, -1502164692, 1225755647, 1854877864, -553698071, 1601527897,
-683060116, 813593436, -1424254504, 1670061115, -1599588889, 408177271, 1630170527, -1830287993, 891789550, -216160020,
-1737709873, 194220860, -988236453, 1996670217, -1554198187, -22613257, -952442521, -149358124, -1578238171, 586587971,
1680340951, -1960437524, -1494405384, -133308879, 1046480489, -913496705, 4198779, -1602801558, -409927709, -71151896,
293515552, 1139733681, -1549930592, -2020871463, 1470654517, -657942142, -1420479901, -1013786682, -1349493762, -752203359,
1926577370, -1321120908, 2095088026, -1733648217, 626746747, -833117119, 653055659, -1252834627, 1901283281, 592130177,
-1436143314, -1375013769, 1272581705, -902812105, 738650176, 935572304, 115522123, 1994693690, 672177609, -528389935,
-1749806396, -309392346, 1699675192, -1223889507, 39816454, -387558037, 650626262, -1845601508, 920349824, 1545942851,
240716715, -1441834534, -1776126869, -768707722, 118421076, 904148780, 1864149645, -1851606124, -812391389, -509273079,
-310516810, 725490786, -2019971678, 749827360, -1797886692, -1301662340, 232860709, -806532515, 1280339860, 495718612,
-1078156397, -264506052, -116379536, 607915817, 1420583149, -2014815128, -1673013594, -340867910, -1343267598, 1294095658,
-1708467733, -40516034, 1660151587, 1124455332, 584619702, -2138055493, -648000086, 1745200775, -622147536, -1580526918,
1704344939, 386121355, -1723510238, -87119066, -1488745083, 1208063473, -1636148616, -600119932, 1326899923, -455475838,
-790079721, -465776531, 1677616317, 1906188660, -1050408645, 372006027, 661292513, -189495921, -1791298059, -2095030288,
1931886234, -2019043588, -930135540, -806943095, -962425466, -1969000747, -84245920, -278533211, 1550315106, -51206964,
1960684447, -783757708, 329484527, -71762056, -1261547897, 142207092, 426181775, 1993596353, -1320644409, 1895741850,
-1928999227, 445994744, 2011242709, 841827631, 372014794, 949489896, -1826990653, 96978596, -1612842883, -1557406351,
-1692856196, 1098960909, -1969733354, 645589343, -546980010, -1843863895, -1577451271, -410732170, -957003870, 1275054411,
-439679059, -1351796067, 1068630472, 1799850054, -1502183064, 1189046499, 118357175, 1322284835, 189775171, -1687918971,
1975065374, -674179410, 551480912, -1803894741, 699198156, -1033923316, -941863183, -221689044, -388192822, 644080630,
-1352903023, -1239469879, 1541733319, 1455721575, 982854204, 1232290751, -1313520844, -1721397283, -2108408521, -2120923568,
538870332, 1667271383, 1227981066, -1488573834, -419594508, -1696327410, -442867040, -850169882, 495658030, 1501509342,
806464075, 599472492, -1300376179, 650864853, 1978428149, -1854604812, 1134897317, 715257345, -314549554, 1512037375,
-234114674, 446446261, -1055518707, -1733070763, 1205259804, -1833997665, -1543813904, 734023101, -1018786490, -1239333615,
-1493906795, 652664849, 383911689, 1168102118, 1074185881, -648714651, -1420323354, -2035067198, 2113155735, 930721292,
-1958536166, -1936090572, -1337021633, -908753881, -1467587344, 2017478690, 157607216, 856569316, -373372251, 600035010,
-953699905, 2015200293, 1882510180, -2143543857, 1742576179, -943900498, 890137608, -1862042984, 2137857644, 453762186,
1744206186, 544834182, -1576630346, 2122842295, -1628730837, -163170218, -1282316078, -920040383, -1851867040, 1702944321,
765248199, -947181295, 1742866016, 377061568, 454399783, 224737896, -1426525787, -1952910614, -1514474754, -1898080240,
436756014, -1437118886, -1120009458, 1276584103, -219973039, -135606357, 1052728123, 850732009, -1298949977, -266286042,
1766101379, 1752264422, -1929647067, 540497574, -1707420726, -1147631557, 253544893, -333343616, -1133633805, 596382341,
1203637139, 1223980636, 1782656614, -63405987, -332063905, -1000038702, 1559569994, 555093326, 1803162040, 1345540161,
-1624078682, 697865091, 27401625, 1942755674, 1479682554, -1070320944, 1671846137, -1221355132, 761805388, 1670473099,
-1943370653, -449731591, 383091959, -2055014600, -1923863729, 1623824043, -1693045799, -138460935, -1594461486, 1103100368,
-2116585725, 1408653078, 1239099371, -644093815, 1360856426, 252098404, 429838355, 1903230669, -552312735, 89919053,
-184120717, -1182598842, -1055950023, 1261668000, -205545107, 569464266, 1079168583, -880576311, -1894522418, -2056455304,
-2133356272, 241991858, 926920268, 1495976966, -641158556, -907788440, 1685448400, 918126658, -159042122, -572392168,
581286167, -656694172, -1004523611, 2065056585, -196798284, 357521757, -687615239, 545269095, 1254288480, -1283505223,
1552905903, 1288951927, -169939682, -195912563, -1849960222, -173122469, -1414515943, -690615733, 754958509, 1834109713,
619620541, -1152518611, -782575179, -1939871832, -1229610081, 340011020, -388062228, -43293286, 792906454, -621000970,
-485381791, -614913074, 769816552, -306229950, 872964621, -1830034749, 60982827, 1998164810, -596671347, 355701395,
-903833297, -1992277629, 1407589819, -1784229111, 1750229311, -334082357, -2083781793, 1488423319, -2099600275, -416079172,
-1035190216, -1257042769, -1485913123, 1760780468, 1113116460, 549145183, 15591049, -254082889, -1868058941, -669392492,
983714948, 631208865, -1783218586, -2135136623, -1974571057, -2042838223, -1543275668, 856466695, -1983932273, 438795841,
-43357262, 598129831, 1902488611, -1201762635, -1307554665, -1363624363, -856592465, 788700621, 600679934, -1961256486,
-1825820149, 1056826553, 318674485, -1364103893, -1440477215, 1554750381, 829883778, 39176420, 2059009022, 1856553046,
947864788, 258196882, -1758137617, 1217455843, -224047282, -1902028338, 827829642, 766801455, -87624624, -2073237494,
-1201984282, -942674421, -185504672, 1116575221, 640136231, -790890053, 1315103851, -774321806, -1289498960, -315852800,
1596879224, -589168831, 1953838047, 98773032, 253603075, 1192313950, -458045245, 178592171, 946082702, 809094082,
595497722, -1699207459, -931309180, -1487284615, -865449602, -609750685, 477399618, -1847251402, -493568070, 15073191,
1009981854, 1970290613, -36480888, -1845883799, -1531981828, -983728047, 2059320792, 798198227, 505052023, 541968548,
-1725433592, 1061655119, 269136430, -168697011, 602882194, -786293658, -149345906, 1886136393, -768418797, -2137759352,
1680323607, -1342037103, -1126255667, 94661103, -715621492, 415920606, 2011068761, -1818962579, 237526692, 552064663,
1484695906, 1042155297, -1176064582, -864860701, 1351815418, 1471123779, -1602093094, -1246017128, -985133624, -610738325,
616517741, 183866320, 20829529, 1083075109, -1171903423, 1966642413, 2009615829, 2059239995, 28769868, 1327814281,
-77978824, -1218571095, 552649087, 1631959154, 2031571590, 2009784724, 251687449, 1329050722, 202112024, 553544811,
1145902360, 2142594848, -444097200, -2136585242, -1401388582, 1287011331, -538170578, -661614600, -354985445, 1777864532,
-30725121, 240281249, -1300734666, -1934140165, 1880643313, -776103486, -1669383138, 1559942133, -1785251808, 1535003532,
-953759267, -122821212, 1421957135, 2049065608, 1440782813, -957700142, -752519109, -1337160249, -29412590, 1258032483,
-1893387858, -2026570558, -41650054, 1618333767, 211647068, 4153589, 932248335, -1881956500, 1747710542, -1988111358,
-1136916823, 1448767654, 709379061, -463093094, -529335352, -1665819958, -635194336, 234636615, 692974535, -1066124683,
-1508835643, 1115692813, -1293193947, 1493066310, -660956132, -2014720727, 168986133, 286359147, -1744694949, 1422866752,
-578126849, 524290544, -460568506, -1882822609, 1872014660, 1112797713, -1276112245, -1573979837, -1499123171, 1635353153,
836494454, 314532024, -1529326948, -226434181, -1040264379, 1256288900, -1176825047, 369829713, 425694130, 197848569,
1693147441, -294717947, -1514013953, 232872347, -116965875, -692288629, 267224441, -875990518, -1753366165, 1267582628,
2143518106, -1269000319, -1656236572, 383704212, -1381453565, -549968570, 1863114961, -977823690, -832508990, 1751969945,
-1659649676, 836194322, 2016890515, -998551605, 1156153330, 1260024224, 1894700170, -979079555, -1256119352, -6652756,
1867945198, 1115423526, 1294608322, -474866447, 947465840, 1634165844, 876649197, 8620942, 145429956, -296726840,
-1792065183, 1484282095, -1630916693, 353721663, 2046779276, 613623096, 262145920, 204327272, -1444630578, 855891258,
-2001212153, 285120011, 1376508568, 201746552, -1426772185, 428662866, 1100538776, 204722621, 1057804449, -145025309,
-1844138149, 1248551132, 1308052126, -1229746888, -517840619, -140828690, 707145163, 1470637682, 197822439, -1267172102,
2084582891, -2147051264, -1198037232, 608924850, 909707425, 1965631934, 765735438, 950793833, -1880692967, 217312035,
-1482014463, 1597626120, 767650900, -1408146589, -846279805, 27741007, -912197879, 1331292330, 910771576, 1223823356,
-147097195, -144144530, -2091188179, -44188438, -716983520, 1465965606, -813810351, -624099930, -840958343, -1823274575,
1361563121, -1676136732, 450800379, 189889896, -378254739, -720634074, -1171589822, 2141365551, 1825588270, 1859709418,
-1082394159, -325495365, -588536621, 26744702, 1506113773, 151533276, -1149287385, 208645632, 203162335, -2082568256,
771526653, 401529785, -1129074105, 1120201267, 1911311341, -1220139057, -678163576, -861516131, 1975798843, 43593879,
458188017, 469118597, 141834133, -1522049497, -1596241703, -63758, -456019016, 175637125, -1319494279, -1004029526,
-219777618, 1258396832, -1865279510, 1941129905, -264256778, 1206989852, -2097227305, -1589035994, -1401512885, -839107189,
-1403560389, -207984445, 1525388859, 2098539898, 927425827, 1306675022, -1543032677, 777872985, 372259576, 921025818,
-1108638441, 1421458983, -1796234875, -467981749, 1770584788, -1860496863, 1253141336, -669675973, -1164758908, -696975354,
-243659039, -1704585550, -1572618869, -537833095, 1940701588, 1122518051, -112682180, -2093773251, -85439931, -1541970960,
694878103, -582143188, -1161835228, 1116301936, -770991466, 931140938, 2144844556, 1037729425, 1907370663, 1602995917,
1694295103, -1532150777, 1154376109, -608877578, -1702504790, -436749512, -1020701474, 402434970, -1033016079, 1460628581,
893100433, -1253772839, -1488656088, -1827657570, -1568171500, -70667279, -372731959, -1025062908, 156891942, -1649691083,
-851218139, 1333653814, 1881821415, -1862898852, 2003149240, 1239040334, -1922563720, 1257217877, -617175809, 23717481,
2136887014, 861157547, -348338963, -1756374224, -793636261, 331961336, -631192522, -14028072, 582211745, 425063469,
1762282654, 2134444448, 777195151, -923164645, -1989851926, 552597520, -1886538486, 1774965929, -1236015988, -268638233,
748477544, 988231244, 101623597, -1995871351, 1088896672, 687872842, -1369985224, -487648607, -739880296, 2044232630,
275539342, -2098972901, 1026755543, 983465612, 95696503, 593366876, 2083016868, 548822124, -1158280399, -873625168,
-385217023, -1902884938, 1193340651, -578506767, 333461986, 1674022361, -385999018, -1946077006, -1491903352, 884334566,
114959749, -471527478, 71497131, -1636805771, 1195805912, -1506717479, -1167303502, 170254783, -180675816, -863309472,
1813567259, 1792915362, 1697831251, -1328048181, 705009165, 261948744, -1863722252, 410082499, 826194733, -1269861164,
1172918482, 2122912340, 16575785, 1506481522, -1744595993, 285799381, 220239384, 2046649893, 1052246273, 2101822424,
908634960, 1126975015, -1868431013, 948261996, -1162016541, -326721837, -2105332855, 2108683515, 918222113, 1555421861,
169984568, 300285367, -933095007, 27457055, 1210854316, -1192238399, -1708964428, -1062660794, 89476899, -1386896231,
-971835563, -204909769, 121091503, 92952708, -232577385, 1627237652, 1677701341, -117950267, -1534138399, -275713268,
-1819265338, -75748286, -117798928, 55360519, -1832849280, -1628638790, 1086230292, -1814728634, 553405965, 628934137,
84039101, -2024633679, 964275994, 874257385, 1707600916, -229030634, -121510101, -696418860, 1101967111, -1412003475,
908236529, -1262070143, -908599226, -1659442389, 728664773, -460398441, 246804042, 134139579, 1054510948, -590219839,
-292267877, -878931239, -750748959, -1726990074, -2011984894, 1042857629, -1945741374, 971084676, 599316208, 19394901,
-201473673, 1656494946, -1154020263, -2053500403, 470731263, 1555506449, -599862044, -4920557, -216796791, 1474830532,
628036869, 1955205885, -1441210871, 1232981692, -1915533499, 1290660758, -1631314014, -295207700, -585974732, -87489301,
-1342654279, -1159510595, -43651946, -2135361193, 1572601540, 2060360987, -1123039298, -1850183339, -1028603166, -611204342,
-1031476380, 1886785228, -590653065, 1238309357, 2128988382, 498023169, 1946762543, -1965299687, 676093630, 1796129473,
469129985, -1505684337, -502888097, 1553649684, 1786984305, -833144985, -1348110201, 238507895, 754731732, -836113481,
-853640911, 1777795934, -626086230, -1238731075, 2051366869, 1655285533, -1389793380, -2007526481, -1811979120, -1625750175,
762902416, -805972281, -294012625, -112310036, -1321925202, -1470241921, -347363164, -1297172058, -1514405349, 365208961,
-278548637, 545071312, 1306422883, -1909595831, 2093412390, -314096723, -1053283239, -1498660579, -1228059023, -1205038396,
-386331498, 728070226, -2015853350, -756834290, -146935354, -1646449067, -1699033363, -438896706, 557607390, 628724590,
-1990253367, -2082251685, 383592279, 1671011116, 100791387, -1233997479, 766208548, 436700266, 1015934949, 1748346979,
1457144437, -344419202, 645575902, -1018911917, 500060828, 1206330882, -440422559, -974501227, 1019096317, 339826008,
-1607393610, -409525747, 366842907, 421768483, 1327868825, 828346559, 443058876, 429398699, 1618530338, -1765216832,
-847130681, 959776951, -621525528, -1409495847, -1563128639, -700820077, -1708262830, -1173459945, 194835745, -1272388095,
935741751, -1074740736, -2052603343, 73071400, 907349765, -2109663730, -912076002, 1512623980, -2022789236, -13846788,
928752532, 846711194, -1391447614, -2041868372, 1367630637, -16315939, 1074426215, -1750304699, 1623305430, 1805863359,
974776362, -1393376627, -2047011003, 731141555, -254884608, -1891297786, 87645411, -1422663749, 514139053, 740567446,
-1874799155, -1048354414, 1578089728, 1011681499, -1587542113, -1300615911, -453852788, -1892008907, -1522732096, -1688743783,
-1200962599, -2038405581, 97295415, -394292042, 99125250, -700340677, 552952977, 684132890, -110182185, -1658334861,
820361681, 2065119524, -1903879946, -406635167, 317972416, -380328059, 190063896, -1156853024, -1737066600, -1759248724,
-62667795, -1620066741, -1206177904, -1683526079, -1497070391, -203333090, 358707889, -1449932723, 966579665, 1648260557,
-527048854, -1305512851, -1233056353, -1819270246, 1174319286, 660451985, 272188047, -1490341011, 1305571371, 1482388489,
-187627482, -852186361, -656683720, -44900377, 1723780418, -1498633773, 1248371743, 449720544, -1670319787, 854254569,
-906621094, 805241630, 1869578789, 1645716286, -1427029333, 799828928, -1341763526, -754038706, 1010156263, -1072175057,
-1367971579, -1058909978, -1233996230, -1418679062, -895530314, 1168000332, -1259536926, 341030796, -1119285903, -1737133270,
803312216, 1554823666, -1878431910, 293426122, -2108634725, 694430534, 1758220007, 295380188, -1374731652, -971105404,
-1119544630, -1260693951, -2009840134, -269345489, -1916194340, 38399185, -1638261750, 2058841468, 901573546, -323331934,
-397855966, 1677986885, -1678919765, -537431175, 1751569102, -994846590, 1926173316, 447477929, -1539383129, -1669741016,
1395219832, -1783986285, -405915122, -1577069106, 939994944, -2142913427, -1945204986, 1540947267, -397566091, -1225308885,
-305698005, 1075397942, 2052651088, 1709569740, 1189693784, -1723235212, 133252289, 729623940, 1007115122, -298035651,
1815067437, -1804222532, -243926295, 338795968, 744311719, 1932653961, -828258228, 1790144980, -1903053031, -504030497,
-1214470492, 1396884821, -1631615633, 231702773, -489048121, 882675039, 132335520, 1631689114, -1490478369, -353636556,
1094917830, 1960032933, -55047943, -1371563062, -356867246, 694993533, 974065188, 1576833693, -1019710674, 248047778,
1703263914, -1594454239, -1518638580, 51635288, 2000191554, -105411249, -1998526384, -144414268, -1332142480, -1553804974,
-686373756, 105111738, 336416539, 273886907, 920305309, 401606332, -1585574093, 1372252360, -1114995165, 1928159505,
706871815, -494956674, 378870962, 662466904, 1879352890, -1077249502, 1449165929, -1327812995, -902028630, -1700372086,
-1446455255, -1374681563, 762556957, 299749323, -2081194181, -769973473, 2025541925, -869102073, -1552429228, -1097637794,
-972647081, -416808260, -1130500273, -1400778685, -128961507, 42440232, -304885870, -828504832, 1253576521, 1624591336,
1339246171, 1035324013, 524225510, -1676839845, -840445411, 928370182, -2003066515, -50920556, 1347800801, 1355719283,
938504744, -1607814615, -213385116, 1304344068, 38094693, -528246828, 695080502, -916364290, -1302833801, 221866407,
-1976534405, 1111457132, 324080983, 841575277, 648767122, 1087846072, 115133662, 1590411909, -884692075, -1813235328,
525745492, -1592274536, -2070421045, -1434772798, 633774305, 1045793009, 387562621, 235018680, -1994036449, -918795425,
1065662030, -1804158032, -1086031584, 1104203037, -599662977, 2080481667, -641335204, -1673370975, 7032609, -1482115571,
1888957998, 323476861, -1460069192, -992457635, 754868878, 528238832, 1935751660, -340837738, -1333601486, -1663569957,
451216923, -594489282, 465015095, -1646763795, -855403614, -333258626, 1969985061, 1484054564, 1514297999, -151152077,
-821575498, 1296573734, 1771224004, -572678994, 1268843459, -419821262, 236186489, 576148592, 937541273, -1614218070,
-1204896725, -1843548814, 364010116, 284434126, 720353550, -39266702, 2087343843, 433786639, 1767871967, -2080363608,
1544344507, 61747624, -239219410, -1813658690, 1972593525, 1232860440, -325476702, 980828260, -1174479400, -1443601595,
1400060339, 78088046, 1181028438, 1726594339, 2029486759, -841900331, 717209909, 145964391, -1902624486, 549128169,
511177441, 1570891869, 2142137782, 1125650676, -56092796, -1646818530, 598831377, 1603420740, -1940548512, -2140007500,
-274491064, -567072242, 1988520067, 2072632052, -163862861, -2111751994, -1281121975, -1547006557, -2086149091, -2006246553,
-1972038366, 1433513231, -65506387, 866168323, -2025567374, -1366734027, -1086351909, 1078978809, -458451430, -1415098040,
1580563757, 1306607176, 585546404, 586355123, 953786739, -814082435, 898724944, -1669190163, -213833779, -381463104,
-1048395834, -1335392090, -892452908, 467724082, -7809946, -874666719, 2142797484, -1407983611, 857128347, 210976420,
-1272850049, 327762210, -635610343, 520143920, -621895160, 1301404211, -1939062628, -1936206253, 1099741845, -384574493,
-520326053, 1982903845, -1662863518, -293620849, -1696687083, 1408509142, 817827972, 1530661405, -674121074, 301015476,
-638394563, 2037965798, -1439694441, -2147087704, -1186128072, -1486789220, -2087070167, -1988198056, 1180931261, -1530212458,
1016813572, 845757938, 354000239, 1687458546, 1910359542, -1616309933, 1091720209, -367601010, -1386027859, 2107407269,
172543184, -1333623785, 478225282, -1635341661, 69601741, -123475095, -1781823180, 214516306, 1588224381, -1772572908,
-1260865284, 110937030, -1093814510, 621616037, 779077976, 1774926987, -1122691941, -597913219, -33237249, 576651403,
-499061130, -111677598, 330639499, 1344187625, -1091186031, 1828758627, -806106414, 1444165116, 571338308, 1270670166,
-758917034, 1173043469, -1693833906, -1154571895, 1672635812, -1482965594, 280850089, 1926388697, 1749651375, 2083325317,
-1632693376, -1997936462, 128381254, 483822901, -809873758, 1839266631, -1329472742, 175560978, -2909964, 494630611,
-1359197123, -422096596, -2128463317, 1514567929, 167151849, -593588202, 241809161, 247517691, 972546487, 1459142686,
-259879186, 1843153227, -1124776720, -1779893494, 1166329460, 1061696127, -86666588, 1092190273, -1823193088, -2096391209,
-122074414, -198342699, 1539067600, -135679839, 722378619, 2034510008, 1078421924, -1915350275, -1514070916, 940584095,
291761632, 1910696979, 2084833524, -460583552, 113286073, -1205718901, 1413159278, -1765987003, 726893889, 2047571102,
926805650, -851654176, 469267663, -411642095, 807968868, 1325989426, -1479732796, -2073387455, 286257252, 1944648496,
-1957276945, 30567723, 2121369825, -804272869, 1830339429, -1143834574, 976184195, 1466435060, -666960122, 153192304,
228864230, 768115015, -143206981, -824660092, 7361516, 769294963, -729468006, -144975135, -671212627, -1258148119,
-200637934, -1850241895, -1411991102, -1052981711, -1704815324, -1675834843, 491271251, 1023892751, 816648884, 261649870,
817279570, 389405080, 1280566126, -1853822114, -2064819160, 884528177, -681665243, 401387193, 1824714558, 1668288084,
514335349, -818964263, 1007800411, -853707858, -833728488, -128220944, 117120165, 365691770, 2045080241, -1504484988,
2143069499, -1128710956, -35249577, 626986898, 1192636591, 1360037506, -1617753107, -1230360033, 1563738302, -2129243598,
1893869359, -2121716070, 1861877939, 1904653630, -1460760862, 791580336, 509463999, 2135255391, -1570497178, -329483140,
1747928761, 1224635421, -218876432, -522944172, 1963132728, -839342475, 358231582, -292652908, 1918375485, 1010006162,
-27373003, -65836545, 495413491, 1495717985, -475303193, -210385374, 1055924768, -1792528531, 1941973374, -633025164,
-1830111355, -2079276147, 1398046251, 1122387836, -1335188155, -301942482, 1292883184, 1570038607, -2024477024, 2017375505,
-844077780, -975229796, 1199069017, 1776101750, 908234759, 1619865510, 1908414313, -143113865, -1207365152, -279709766,
955558635, -1126968166, -1812000669, -355602846, -1616604060, 1575500210, 970311045, 53558818, 1932810874, -2093693722,
-1303739024, 170061632, 1695693043, 1577788187, -1641794156, -310447142, -349066751, 483916147, 910353087, 1160629316,
303042122, -1630944175, -1906712699, 642292015, -1184656274, -466130676, 1796683388, -912903682, 1693733899, -701345035,
811880328, -637330488, 1490883856, -1114537434, 1421676627, -1912288505, 1670340938, 1701920693, -1183344677, -1814103533,
-521000209, 394047742, 102434253, 257153902, 1616963736, 972149554, 7871824, -1835730994, 1425097179, -975194760,
1713466296, -1765227268, 836678664, 1524562645, -1054727068, -78241197, -1451681664, 2014260331, -1229044621, 1587979457,
-908350277, 1814717921, -2119722719, 1534203555, 972903492, -944942067, -1963941137, -1949217475, 578769520, -726152671,
1735119310, 203832385, 1430543664, 2072198766, -393981698, 1703772603, -1353786672, -758407696, -1497683039, -1027043124,
1613212493, 1877277935, -438448209, 480280783, 694547208, 308648499, 980880807, -700878641, 989985393, 1320264448,
1051925280, 708738155, -215410757, -1287261808, -391487706, -1692124164, 1688933791, -671868403, -1980255300, -1613212310,
-1482743572, -1241346824, 864859454, 2074633450, -1584727784, 1051085458, 1071043967, 8806186, -491814800, 677922193,
-850520377, -358998214, -480900926, 1566428477, -1216335557, 2072861765, -869336245, 849265445, 1499408854, 51787007,
-1902773389, 371581610, -861650674, -1349730038, -1813435138, -2045929908, -716092796, 1539667696, -884654474, 849848132,
-2019941906, 13863468, 1751788015, -1822618327, -1951221380, 1758844346, 450640010, -571332854, 212252907, -943453928,
-882660145, -1316682640, 2112063118, -1828028968, 1950422896, -1665620542, 920553650, 1907979831, -2062653557, -2132999703,
323562939, 1700800714, -643498158, -16494702, 1389723159, -2085542649, 1328039450, -1113945247, 1641158651, -1375270419,
161477612, -1941049089, -2001570359, -111707397, -749876717, 916623307, -1234685986, -2119817223, -1335571110, -323789084,
379373212, 2113957370, 1970807363, -2118834705, 1046354916, 1719363922, -202591490, -1949953982, -899736001, -1162664141,
731742737, 484417284, -119973384, -1939544812, -1250524558, 492083623, -1196581898, 1464447455, 1250111830, 410079231,
-1352302164, 1560081083, 1514805586, -1771139183, -269649003, -838874114, 1275871829, 1182255515, 2026230061, -1387867697,
161562367, -623673581, -303661460, -1157180301, -135852900, 1822224383, -262676858, -1975155424, 355780355, 1042993783,
-625169965, -1285015630, 60288416, 1667442347, -254674501, 2103610059, 1621644079, -457564675, 125141584, 1874978057,
-730476794, 1050630304, 1588743550, -787040971, 2101876262, 445772471, 1928563321, 1541883271, 1079790277, -1564149786,
419102709, -128629551, -1110992886, -1046887427, 444746481, 1206220050, -1377731711, -709376480, 892160568, 105911767,
-1193353152, -482022984, -1398480631, 19864601, -141683096, -2027029695, -723213798, -70639729, 933047568, -522069638,
268719896, -1315309593, 1402782659, 1981922807, 1763251692, -1335777918, -1351626321, -2094731364, -712811628, 488705757,
537648033, 309514026, 184523545, 1566503732, 1739562286, 1353041458, -898444639, -1935364922, -267345867, 294768360,
734330043, -1468631864, 375817465, -1240489257, 666511668, -1045644822, 1475373264, -891041531, 806965790, 1034744988,
-1876295759, -126840235, 188619003, 1438723930, 1275158006, 923374059, 2091037864, -1592152816, -643515996, 1473525383,
-645002258, -614679400, 1574182825, 1915370162, 512076131, 39553557, -464369391, 1262816248, -1802982749, -694982896,
1589844135, 1417281396, -1969658387, -6448666, 486948046, 1577166647, 623218854, -1416840512, 367801006, 1043276419,
1163169834, 1417631975, 723302411, -1245916527, 835531351, -48389983, 2056774965, 923990555, 1861995100, -477374531,
1284442182, -1142440152, 1118031083, -405274494, -2111226486, -866644417, 2126304431, 624768469, 1202273883, 411873938,
-29073265, 1102064757, -1524045554, -1397401976, -1091450703, 159408647, 695277053, -1150302585, 1335051900, -1499189954,
-2059261481, -1196153753, 797350706, 1353895659, 1878495036, 1605605288, -53835295, -1085773899, 456407553, 1198543195,
-1837344312, -1331566286, -1308603515, 481719855, 1303924989, -1357004113, -936164109, 1021566277, 1766298953, 149713333,
1319250233, -799073685, 1193715851, 842225076, 2136654859, -1999388347, 1121918516, -281027877, 1499337743, -1975621958,
-1343567880, -1142454481, 109594508, 1954863100, 1231895164, -283261691, 1665484287, -1987241547, 480645963, -1822425835,
351967956, -1496604099, -1141509924, -468766416, 738018913, -579185619, 75650208, 212998816, 967348185, 1551556755,
-994948307, -240586101, 1528112991, -411570187, -641260001, 619104169, 2097132088, 947791773, -1466529942, 370470760,
-792904781, 507884653, 314509442, -931375641, 405526015, -1173979577, 1856909350, 244861158, 1476785930, -1814411216,
-1682116991, 838269997, -737600654, -565401879, -1254438879, 527580371, 486241932, -1282312917, -1156552027, -1712760963,
-956142302, 85692481, -1195603314, -1298930128, -835846079, 1842929364, -525782913, 824487448, -1491048060, 1365154866,
-856278810, -809544808, -1452553398, -1280423762, 697619427, -891359923, -679323174, 1023554649, 299528192, 1494081024,
-1501662786, -1773849227, 566308042, 166922601, -1317139506, -1620859053, -816991069, 2077482808, 1069391774, -1690936832,
1916908419, -684317037, 1299040861, 1313716711, -268579902, 401212790, -1244219526, 1650955167, -856721876, -97859822,
1837607537, -95527795, -1448574777, -1856451185, -1497854069, -1289435042, -1830020332, -1456825413, 1065743438, -1010659057,
-364664033, 1120012548, -849718363, 592060437, 394490830, 945555552, -1800071660, 1718439230, -1586585870, 517853782,
-528358102, 940696794, -886832924, 2051640049, -1363383749, 2112057074, 429768003, 1863223097, 508139834, 1341130230,
-1527772445, -1916012693, -1411976559, -1211019987, 1792904598, 1833407878, -1697645776, -1367585014, -1917993155, -2036611974,
-1854528472, 1095854171, 1778855926, -1186976651, 317272827, 1037269063, -865602022, -1316185645, -677338345, -2034250867,
186646291, 318129954, 1445062576, 1594757999, -176590326, 1522483082, -211203043, -595186211, -612354201, -1426515411,
-1960046465, 60577648, -1875224675, -1051579006, -1111303461, -1569642694, 1543726692, -1611878706, -562942226, -1137036474,
-1786812890, -270722288, -411510274, -175861553, -575561217, -1677756662, 2086340330, 1799028426, 567970094, -18849535,
1419093539, 592860959, -1083058039, 1062480396, -1211282674, -1124411220, 2066175401, 6857442, 633965619, 1817149115,
915398335, -715206869, 2061549818, 1006112510, 655908518, -336823094, -569086502, 852753382, -1988853041, 982835306,
789976532, 1982247371, -2013123254, 873379797, -489940579, 791649397, -1440335318, 571916564, -572036809, -730599313,
-782777795, 234130976, -2052119398, -92397587, -1815109881, -1663073207, 906292161, -1586083040, -1459544800, -1586944802,
-668869632, 1194970673, -1902906409, 1934548637, 87833931, 282023198, 1206121678, -1338945573, -102848084, -1327737679,
266084921, -989624940, 826693832, -766641929, 748159164, 1678685295, 1172622958, -594398972, 1170597657, -1911227501,
1091076517, 2055073136, -213239463, 541336040, 2014448535, 420699580, 1527764699, 249388991, -1206775541, 183866113,
104039121, 393439876, 333826897, 1850036610, 1557910232, 2015429258, 927226164, 114032092, 67958653, -210233687,
-96733346, 2039576990, -1495324960, -991604433, -1584483417, 629101245, -1366929672, -989800109, 2010533745, -913359862,
1048884388, -930695794, -648678524, -892012927, -1353009796, 1867524694, -1890871457, 891198381, -948639583, 1457219246,
423845186, 497540411, 2016937725, 81713693, -1082097039, -1265727445, 5286621, 709824219, -200293040, 1315007262,
1112754103, -993474049, -1848957542, -1861493364, 992363813, -817896075, 804724455, -118415936, 831706999, 755634922,
-440558690, -1554278747, 1148100765, -1467002328, -215817388, -247110970, 1786439326, -1214162757, -1780529317, 915733432,
767320224, -1062584900, 1152196541, -540692844, 1425991752, -654046023, -1394202504, 2057486842, 515047799, 695776253,
991917517, -244262842, 1109626115, 1699152518, -1800866120, -1326285259, 1181715940, 1846981219, -1630184475, -1781309488,
-1491478325, -731348457, -957984162, -1616704108, -1338940810, -995479634, -1262432615, -301126374, 1287185694, 500820569,
894592028, -1374236633, 1884581744, 1027783705, 512157108, -1187219510, -717768896, 1950843367, -2023560111, 55262615,
-582705577, 2021250818, -1996439851, 1670161425, -212061395, -2013455463, -694821812, -1991341522, -1612185128, 1275567029,
-920118623, 941181354, 1177719632, -728708138, 994628852, -1134381486, 1194735354, 2002319382, 1166779769, 2054648118,
1576484339, -2005582914, 1388030810, 1355295397, -944753018, -1479067723, -1952393660, 1735194684, 2101219916, -830146727,
1044545452, 820625114, -742855743, -1804013308, 538280349, 688496288, -1364870729, -1436927326, 1124924622, -700396528,
1759951892, 885066384, 498716396, 151223144, -830789653, -273400863, -41855409, -1178523990, 2120368630, -998842498,
611805057, 250404017, 290774585, -2127225744, -357456628, -1851396375, 350752003, 1608098972, -1211675071, -1734134648,
-96222386, -2075218639, 1826283157, -1767128559, -140923873, 293594078, -442371634, -1881599107, 288475167, 1774880966,
213836754, 1704291315, 1517443940, 1259363714, -649395378, -1349807536, 825047972, 226131273, -30745563, -686275290,
919616290, 419848143, -402495055, 1657358813, -995075240, 1755049991, 1996187118, 631213607, -762045526, 2049064753,
21224169, -301235373, -1278961472, 1908055519, 1245548109, 1198310940, 198880859, 179279201, -22461745, -2048222394,
1428751885, -1885097973, -1007932237, 369121314, 18998511, 2133117668, -380291527, 24045412, 589885265, -317304729,
-515514873, 740555298, -503141140, -1966816477, 198875618, -225146526, -870643357, 1142782304, -1903437487, -1571343605,
718187018, 1489059614, -1173510554, -2096762211, -905232164, -859448885, -2124640628, -652739989, -806684979, -599271586,
-1392970775, 1740509469, -411472967, 805503931, -968600124, -1903413476, -1008727317, -239454901, 1936576887, 1031874742,
631741480, -1769390596, 482920571, 1253697415, 1625886216, -950756266, -168612178, -1627865755, 1947937126, 1995508621,
1103095700, -723267245, 912914158, 1474753802, 1317865779, -537763750, -1541470003, -1680628135, -2052612924, 779273783,
1320979393, 1583110562, -183703443, -1462223253, 1187979149, -1802903750, -575965145, 1794040225, 1484367891, 43197959,
-885420722, -1839517031, -438203963, -1388842718, 2034013253, 1777034854, -781871454, 1394644542, -665636343, 154020775,
-2048855475, -1847588629, -430212688, 2098279851, 1861898030, 1628885888, -481770733, 1636830509, -651801674, 1350594549,
1992783733, -1162975665, -1632805473, -686102738, -1042410661, -1714227423, -1383542552, -1904672616, -1292751548, -912546058,
1450871061, -1212282330, 1082634058, 641921254, -896752297, -1721682114, 902322349, -1525968703, -855746310, -1388312279,
1949756330, -858221403, -24707868, 1006850229, -1619406715, -1414356237, -891319813, 1870823534, 116039236, 1150115900,
-828623177, 1721272573, -1757232834, 628597380, 973026146, 1643796225, -862649539, -1563642393, -1490659465, 1860708987,
-331096267, -221536073, -2081532850, 684230554, -287754536, 650039021, -1466181569, 1150312694, 1051780129, 490667805,
-1337634390, 1527924004, 776948342, -1876768865, -1694977033, -1485587553, -348117010, -1848264550, 1380136189, -1642139484,
-1252084935, 1901794439, -750063697, 261529453, 355221740, -816429380, -197551404, 436912792, 1882108864, -1538635007,
-1124497144, -152816435, -925945896, 517548398, 737348504, 192313973, 899634838, -1954970968, 682012153, 219781636,
-1639953753, -1688747073, -2077449593, 1916502362, -1201217890, -864412337, 1445237171, -837685422, 562078002, 768156810,
-417843160, -1658030431, 542707576, -1952138580, 452027934, 628744411, 1352929065, 851091086, 1076107414, -1981867193,
-1829700002, 1814771943, -265735756, -1762865357, -1127186659, -493130468, 671757867, 1818173266, -1164051120, 1127581531,
-1511330664, -793535415, -372200456, 1721279925, -2075489524, 1497455219, 680550938, 1079535151, -978409450, -1110325634,
-1938539868, 469619359, 946394327, 370174639, -1620319502, 1255748487, 747167804, 745037038, 1193478582, 1790773087,
978147041, -1750972725, -2099229739, 1469082142, 750321763, 815217538, -1248218704, 1579694305, -935691019, 1387007581,
-1397474205, -235013812, 1352305367, 262942436, 148119835, 644102139, -990212035, -1217173577, 206364802, 749235178
];

//}}}

//{{{  tuned coefficients

// data=c:/projects/chessdata/quiet-labeled.epd
// epochs=13
// k=3.62
// err=0.056518112261189794
// last update Fri Dec 03 2021 10:45:36 GMT+0000 (Greenwich Mean Time)

var VALUE_VECTOR   = [0,100,347,351,537,1040,10000];
var WPAWN_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  108,  116,  132,  164,  164,  132,  116,  108,    0,    0,
     0,    0,   44,  109,   53,   98,   95,  167,   35,  -25,    0,    0,
     0,    0,   -5,   -4,   12,    7,   51,   69,   39,  -11,    0,    0,
     0,    0,  -22,    2,  -12,    8,    7,    4,    3,  -34,    0,    0,
     0,    0,  -32,  -30,   -9,    2,    0,    3,  -23,  -37,    0,    0,
     0,    0,  -27,  -28,  -13,  -12,   -8,    5,    8,  -19,    0,    0,
     0,    0,  -37,  -19,  -36,  -21,  -36,    8,   11,  -32,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WPAWN_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   -8,   -7,    9,   -3,   18,  -31,   19,   31,    0,    0,
     0,    0,   11,   11,    4,   -7,  -18,  -13,    4,   11,    0,    0,
     0,    0,    6,   -7,  -12,  -25,  -21,  -15,   -6,    0,    0,    0,
     0,    0,    1,   -3,  -16,  -20,  -18,  -19,  -11,   -8,    0,    0,
     0,    0,  -12,  -10,  -16,  -13,   -9,  -14,  -22,  -18,    0,    0,
     0,    0,   -4,  -13,    2,   -7,   11,   -7,  -18,  -18,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WKNIGHT_PSTS   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0, -163,  -86,  -44,  -54,   36, -109,  -41,  -90,    0,    0,
     0,    0,  -74,  -49,   69,   25,   11,   55,   -2,  -25,    0,    0,
     0,    0,  -42,   30,   22,   48,   71,  103,   52,   55,    0,    0,
     0,    0,    1,   25,    6,   33,   30,   67,   29,   32,    0,    0,
     0,    0,    0,   18,   17,   11,   30,   23,   29,    4,    0,    0,
     0,    0,  -15,    2,   17,   32,   44,   25,   35,   -6,    0,    0,
     0,    0,   -8,  -29,    2,   13,   20,   27,   16,    7,    0,    0,
     0,    0, -101,   -3,  -29,   -8,   22,    3,   -1,   -1,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WKNIGHT_PSTE   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -60,  -55,  -20,  -38,  -41,  -36,  -69, -111,    0,    0,
     0,    0,  -43,  -23,  -44,  -10,  -19,  -41,  -42,  -71,    0,    0,
     0,    0,  -41,  -37,   -4,   -6,  -29,  -27,  -42,  -66,    0,    0,
     0,    0,  -34,  -15,    8,    4,   11,  -11,  -20,  -39,    0,    0,
     0,    0,  -33,  -28,    1,    8,    0,    2,  -12,  -35,    0,    0,
     0,    0,  -40,  -16,  -13,   -4,   -7,  -15,  -38,  -33,    0,    0,
     0,    0,  -58,  -35,  -25,  -20,  -20,  -35,  -43,  -62,    0,    0,
     0,    0,  -40,  -63,  -41,  -34,  -45,  -41,  -67,  -94,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WBISHOP_PSTS   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -43,  -15, -117,  -71,  -49,  -63,   -3,  -20,    0,    0,
     0,    0,  -32,    4,  -33,  -45,   19,   27,   43,  -72,    0,    0,
     0,    0,  -28,   31,   35,   18,   15,   48,   32,   -1,    0,    0,
     0,    0,    1,    9,    9,   42,   23,   21,    7,    4,    0,    0,
     0,    0,    6,   12,   11,   30,   29,    3,   11,   17,    0,    0,
     0,    0,    9,   29,   26,   17,   24,   40,   30,   19,    0,    0,
     0,    0,   21,   29,   21,    9,   17,   31,   54,   10,    0,    0,
     0,    0,  -14,   18,   14,    9,   18,   13,  -19,   -2,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WBISHOP_PSTE   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -29,  -38,  -23,  -23,  -18,  -21,  -34,  -42,    0,    0,
     0,    0,  -21,  -29,  -17,  -25,  -28,  -28,  -34,  -27,    0,    0,
     0,    0,  -13,  -31,  -29,  -29,  -25,  -30,  -28,  -17,    0,    0,
     0,    0,  -29,  -18,  -18,  -21,  -15,  -21,  -23,  -23,    0,    0,
     0,    0,  -31,  -26,  -15,  -14,  -25,  -18,  -30,  -34,    0,    0,
     0,    0,  -34,  -29,  -23,  -20,  -17,  -29,  -32,  -36,    0,    0,
     0,    0,  -40,  -40,  -35,  -26,  -23,  -37,  -41,  -52,    0,    0,
     0,    0,  -44,  -33,  -39,  -30,  -35,  -33,  -28,  -38,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WROOK_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   20,   25,    5,   33,   31,    4,    4,   20,    0,    0,
     0,    0,   -2,    2,   27,   35,   43,   40,  -16,   12,    0,    0,
     0,    0,  -12,   -3,    2,    9,   -8,   14,   42,   -9,    0,    0,
     0,    0,  -30,  -28,   -3,   10,    1,   15,  -23,  -32,    0,    0,
     0,    0,  -40,  -32,  -12,  -11,   -1,  -13,    1,  -35,    0,    0,
     0,    0,  -38,  -16,   -6,  -10,    6,    1,   -3,  -31,    0,    0,
     0,    0,  -33,  -11,  -10,    1,    9,   11,   -6,  -60,    0,    0,
     0,    0,   -7,   -5,    5,   15,   15,   12,  -29,   -8,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WROOK_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   35,   30,   41,   32,   33,   35,   34,   30,    0,    0,
     0,    0,   25,   24,   18,   16,    4,   15,   31,   23,    0,    0,
     0,    0,   33,   35,   30,   30,   27,   21,   18,   21,    0,    0,
     0,    0,   35,   33,   35,   20,   23,   25,   23,   33,    0,    0,
     0,    0,   31,   34,   30,   24,   15,   18,   13,   22,    0,    0,
     0,    0,   26,   21,   11,   17,    6,    9,   10,   12,    0,    0,
     0,    0,   20,   14,   16,   15,    5,    6,    4,   22,    0,    0,
     0,    0,   14,   19,   17,   11,    8,   11,   18,   -7,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WQUEEN_PSTS    = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -27,   -7,    7,    0,   74,   51,   57,   50,    0,    0,
     0,    0,  -15,  -43,   -3,    8,  -31,   36,   32,   51,    0,    0,
     0,    0,   -8,  -15,    7,  -22,   21,   58,   39,   53,    0,    0,
     0,    0,  -35,  -29,  -29,  -30,   -7,   -4,   -5,   -8,    0,    0,
     0,    0,   -5,  -38,  -10,  -17,   -7,   -6,   -6,   -4,    0,    0,
     0,    0,  -21,    9,   -4,    4,    6,    2,   12,    6,    0,    0,
     0,    0,  -18,    5,   18,   14,   23,   27,   14,   25,    0,    0,
     0,    0,    8,    2,    9,   21,    3,   -1,   -9,  -34,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WQUEEN_PSTE    = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   -2,   33,   35,   37,   26,   27,    7,   32,    0,    0,
     0,    0,  -15,   19,   27,   36,   69,   31,   21,   14,    0,    0,
     0,    0,   -9,   11,    5,   68,   61,   38,   39,   23,    0,    0,
     0,    0,   31,   31,   33,   52,   63,   50,   71,   62,    0,    0,
     0,    0,   -9,   43,   20,   54,   29,   38,   48,   36,    0,    0,
     0,    0,   13,  -27,   18,    2,    6,   22,   23,   27,    0,    0,
     0,    0,  -17,  -27,  -25,  -14,  -16,  -23,  -45,  -28,    0,    0,
     0,    0,  -35,  -34,  -27,  -34,    2,  -31,  -22,  -45,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WKING_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -81,   48,   34,  -11,  -92,  -73,   11,  -17,    0,    0,
     0,    0,   45,   30,   -6,    3,  -33,   16,  -21,  -62,    0,    0,
     0,    0,   36,   31,   27,  -50,  -14,   31,   65,   -9,    0,    0,
     0,    0,  -20,   -1,  -11,  -49,  -50,  -37,   -8,  -59,    0,    0,
     0,    0,  -33,   27,  -24,  -63,  -61,  -40,  -25,  -61,    0,    0,
     0,    0,   13,   28,    2,  -22,  -25,  -11,   23,   -5,    0,    0,
     0,    0,   30,   60,   25,  -30,   -9,   16,   52,   42,    0,    0,
     0,    0,   -1,   61,   44,  -29,   40,   -9,   53,   30,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WKING_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0, -136,  -71,  -38,  -55,  -25,    0,  -33,  -39,    0,    0,
     0,    0,  -36,  -16,   -8,   -3,    7,   15,    0,   -2,    0,    0,
     0,    0,  -17,   -4,   -5,    6,    4,   33,   25,   -4,    0,    0,
     0,    0,  -19,   -1,    8,   12,   12,   19,   12,   -5,    0,    0,
     0,    0,  -34,  -27,    3,   10,   12,    8,   -7,  -20,    0,    0,
     0,    0,  -37,  -25,  -10,   -1,    2,   -3,  -15,  -26,    0,    0,
     0,    0,  -51,  -40,  -20,  -11,   -9,  -18,  -30,  -43,    0,    0,
     0,    0,  -79,  -63,  -48,  -32,  -57,  -31,  -54,  -73,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BPAWN_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -37,  -19,  -36,  -21,  -36,    8,   11,  -32,    0,    0,
     0,    0,  -27,  -28,  -13,  -12,   -8,    5,    8,  -19,    0,    0,
     0,    0,  -32,  -30,   -9,    2,    0,    3,  -23,  -37,    0,    0,
     0,    0,  -22,    2,  -12,    8,    7,    4,    3,  -34,    0,    0,
     0,    0,   -5,   -4,   12,    7,   51,   69,   39,  -11,    0,    0,
     0,    0,   44,  109,   53,   98,   95,  167,   35,  -25,    0,    0,
     0,    0,  108,  116,  132,  164,  164,  132,  116,  108,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BPAWN_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   -4,  -13,    2,   -7,   11,   -7,  -18,  -18,    0,    0,
     0,    0,  -12,  -10,  -16,  -13,   -9,  -14,  -22,  -18,    0,    0,
     0,    0,    1,   -3,  -16,  -20,  -18,  -19,  -11,   -8,    0,    0,
     0,    0,    6,   -7,  -12,  -25,  -21,  -15,   -6,    0,    0,    0,
     0,    0,   11,   11,    4,   -7,  -18,  -13,    4,   11,    0,    0,
     0,    0,   -8,   -7,    9,   -3,   18,  -31,   19,   31,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BKNIGHT_PSTS   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0, -101,   -3,  -29,   -8,   22,    3,   -1,   -1,    0,    0,
     0,    0,   -8,  -29,    2,   13,   20,   27,   16,    7,    0,    0,
     0,    0,  -15,    2,   17,   32,   44,   25,   35,   -6,    0,    0,
     0,    0,    0,   18,   17,   11,   30,   23,   29,    4,    0,    0,
     0,    0,    1,   25,    6,   33,   30,   67,   29,   32,    0,    0,
     0,    0,  -42,   30,   22,   48,   71,  103,   52,   55,    0,    0,
     0,    0,  -74,  -49,   69,   25,   11,   55,   -2,  -25,    0,    0,
     0,    0, -163,  -86,  -44,  -54,   36, -109,  -41,  -90,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BKNIGHT_PSTE   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -40,  -63,  -41,  -34,  -45,  -41,  -67,  -94,    0,    0,
     0,    0,  -58,  -35,  -25,  -20,  -20,  -35,  -43,  -62,    0,    0,
     0,    0,  -40,  -16,  -13,   -4,   -7,  -15,  -38,  -33,    0,    0,
     0,    0,  -33,  -28,    1,    8,    0,    2,  -12,  -35,    0,    0,
     0,    0,  -34,  -15,    8,    4,   11,  -11,  -20,  -39,    0,    0,
     0,    0,  -41,  -37,   -4,   -6,  -29,  -27,  -42,  -66,    0,    0,
     0,    0,  -43,  -23,  -44,  -10,  -19,  -41,  -42,  -71,    0,    0,
     0,    0,  -60,  -55,  -20,  -38,  -41,  -36,  -69, -111,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BBISHOP_PSTS   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -14,   18,   14,    9,   18,   13,  -19,   -2,    0,    0,
     0,    0,   21,   29,   21,    9,   17,   31,   54,   10,    0,    0,
     0,    0,    9,   29,   26,   17,   24,   40,   30,   19,    0,    0,
     0,    0,    6,   12,   11,   30,   29,    3,   11,   17,    0,    0,
     0,    0,    1,    9,    9,   42,   23,   21,    7,    4,    0,    0,
     0,    0,  -28,   31,   35,   18,   15,   48,   32,   -1,    0,    0,
     0,    0,  -32,    4,  -33,  -45,   19,   27,   43,  -72,    0,    0,
     0,    0,  -43,  -15, -117,  -71,  -49,  -63,   -3,  -20,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BBISHOP_PSTE   = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -44,  -33,  -39,  -30,  -35,  -33,  -28,  -38,    0,    0,
     0,    0,  -40,  -40,  -35,  -26,  -23,  -37,  -41,  -52,    0,    0,
     0,    0,  -34,  -29,  -23,  -20,  -17,  -29,  -32,  -36,    0,    0,
     0,    0,  -31,  -26,  -15,  -14,  -25,  -18,  -30,  -34,    0,    0,
     0,    0,  -29,  -18,  -18,  -21,  -15,  -21,  -23,  -23,    0,    0,
     0,    0,  -13,  -31,  -29,  -29,  -25,  -30,  -28,  -17,    0,    0,
     0,    0,  -21,  -29,  -17,  -25,  -28,  -28,  -34,  -27,    0,    0,
     0,    0,  -29,  -38,  -23,  -23,  -18,  -21,  -34,  -42,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BROOK_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   -7,   -5,    5,   15,   15,   12,  -29,   -8,    0,    0,
     0,    0,  -33,  -11,  -10,    1,    9,   11,   -6,  -60,    0,    0,
     0,    0,  -38,  -16,   -6,  -10,    6,    1,   -3,  -31,    0,    0,
     0,    0,  -40,  -32,  -12,  -11,   -1,  -13,    1,  -35,    0,    0,
     0,    0,  -30,  -28,   -3,   10,    1,   15,  -23,  -32,    0,    0,
     0,    0,  -12,   -3,    2,    9,   -8,   14,   42,   -9,    0,    0,
     0,    0,   -2,    2,   27,   35,   43,   40,  -16,   12,    0,    0,
     0,    0,   20,   25,    5,   33,   31,    4,    4,   20,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BROOK_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   14,   19,   17,   11,    8,   11,   18,   -7,    0,    0,
     0,    0,   20,   14,   16,   15,    5,    6,    4,   22,    0,    0,
     0,    0,   26,   21,   11,   17,    6,    9,   10,   12,    0,    0,
     0,    0,   31,   34,   30,   24,   15,   18,   13,   22,    0,    0,
     0,    0,   35,   33,   35,   20,   23,   25,   23,   33,    0,    0,
     0,    0,   33,   35,   30,   30,   27,   21,   18,   21,    0,    0,
     0,    0,   25,   24,   18,   16,    4,   15,   31,   23,    0,    0,
     0,    0,   35,   30,   41,   32,   33,   35,   34,   30,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BQUEEN_PSTS    = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    8,    2,    9,   21,    3,   -1,   -9,  -34,    0,    0,
     0,    0,  -18,    5,   18,   14,   23,   27,   14,   25,    0,    0,
     0,    0,  -21,    9,   -4,    4,    6,    2,   12,    6,    0,    0,
     0,    0,   -5,  -38,  -10,  -17,   -7,   -6,   -6,   -4,    0,    0,
     0,    0,  -35,  -29,  -29,  -30,   -7,   -4,   -5,   -8,    0,    0,
     0,    0,   -8,  -15,    7,  -22,   21,   58,   39,   53,    0,    0,
     0,    0,  -15,  -43,   -3,    8,  -31,   36,   32,   51,    0,    0,
     0,    0,  -27,   -7,    7,    0,   74,   51,   57,   50,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BQUEEN_PSTE    = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -35,  -34,  -27,  -34,    2,  -31,  -22,  -45,    0,    0,
     0,    0,  -17,  -27,  -25,  -14,  -16,  -23,  -45,  -28,    0,    0,
     0,    0,   13,  -27,   18,    2,    6,   22,   23,   27,    0,    0,
     0,    0,   -9,   43,   20,   54,   29,   38,   48,   36,    0,    0,
     0,    0,   31,   31,   33,   52,   63,   50,   71,   62,    0,    0,
     0,    0,   -9,   11,    5,   68,   61,   38,   39,   23,    0,    0,
     0,    0,  -15,   19,   27,   36,   69,   31,   21,   14,    0,    0,
     0,    0,   -2,   33,   35,   37,   26,   27,    7,   32,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BKING_PSTS     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,   -1,   61,   44,  -29,   40,   -9,   53,   30,    0,    0,
     0,    0,   30,   60,   25,  -30,   -9,   16,   52,   42,    0,    0,
     0,    0,   13,   28,    2,  -22,  -25,  -11,   23,   -5,    0,    0,
     0,    0,  -33,   27,  -24,  -63,  -61,  -40,  -25,  -61,    0,    0,
     0,    0,  -20,   -1,  -11,  -49,  -50,  -37,   -8,  -59,    0,    0,
     0,    0,   36,   31,   27,  -50,  -14,   31,   65,   -9,    0,    0,
     0,    0,   45,   30,   -6,    3,  -33,   16,  -21,  -62,    0,    0,
     0,    0,  -81,   48,   34,  -11,  -92,  -73,   11,  -17,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BKING_PSTE     = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,  -79,  -63,  -48,  -32,  -57,  -31,  -54,  -73,    0,    0,
     0,    0,  -51,  -40,  -20,  -11,   -9,  -18,  -30,  -43,    0,    0,
     0,    0,  -37,  -25,  -10,   -1,    2,   -3,  -15,  -26,    0,    0,
     0,    0,  -34,  -27,    3,   10,   12,    8,   -7,  -20,    0,    0,
     0,    0,  -19,   -1,    8,   12,   12,   19,   12,   -5,    0,    0,
     0,    0,  -17,   -4,   -5,    6,    4,   33,   25,   -4,    0,    0,
     0,    0,  -36,  -16,   -8,   -3,    7,   15,    0,   -2,    0,    0,
     0,    0, -136,  -71,  -38,  -55,  -25,    0,  -33,  -39,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var WOUTPOST       = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,   27,   21,   15,   33,   28,   31,    0,    0,    0,
     0,    0,    0,   11,   18,   29,   17,   40,   48,    0,    0,    0,
     0,    0,    0,   15,   20,   22,   16,   24,   24,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var BOUTPOST       = [
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,   15,   20,   22,   16,   24,   24,    0,    0,    0,
     0,    0,    0,   11,   18,   29,   17,   40,   48,    0,    0,    0,
     0,    0,    0,   27,   21,   15,   33,   28,   31,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,
     0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0
];
var EV             = [5,-1,7,2,4,2,2,5,1,1,4,3,21,8,11,13,13,9,9,-3,-2,41,99,27,5,22,19,-1,-9,15,37,5,4,13,58,102,91,793,40,26,4,2,8,4,0,-1,60,2,5,4];
var WSTORM         = [0,0,0,29,3,3,-9,-1,0,5];
var WSHELTER       = [0,0,0,6,11,12,35,27,0,28];
var ATT_W          = [0,0.01,0.41999999999999993,0.78,1.11,1.5200000000000005,0.97,0.99];
var PAWN_PASSED    = [0,0,0,0,0.1,0.30000000000000004,0.6999999999999998,1.2000000000000126,0];
var imbalN_S       = [-101,13,4,-2,1,-1,0,10,24];
var imbalN_E       = [-102,-35,-22,-14,-5,2,15,27,28];
var imbalB_S       = [-51,0,4,2,2,4,4,9,15];
var imbalB_E       = [12,-19,-15,-10,-10,-6,-3,-3,14];
var imbalR_S       = [47,10,-5,-8,-8,-9,-4,-4,-3];
var imbalR_E       = [-9,-12,-1,2,2,7,8,15,23];
var imbalQ_S       = [3,-8,-5,2,3,2,-1,-3,-18];
var imbalQ_E       = [-19,-16,-2,-3,-7,-5,0,-4,-7];

//}}}
//{{{  ev assignments

var MOB_NS               = EV[iMOB_NS];
var MOB_NE               = EV[iMOB_NE];
var MOB_BS               = EV[iMOB_BS];
var MOB_BE               = EV[iMOB_BE];
var MOB_RS               = EV[iMOB_RS];
var MOB_RE               = EV[iMOB_RE];
var MOB_QS               = EV[iMOB_QS];
var MOB_QE               = EV[iMOB_QE];
var ATT_N                = EV[iATT_N];
var ATT_B                = EV[iATT_B];
var ATT_R                = EV[iATT_R];
var ATT_Q                = EV[iATT_Q];
var ATT_M                = EV[iATT_M];
var PAWN_DOUBLED_S       = EV[iPAWN_DOUBLED_S];
var PAWN_DOUBLED_E       = EV[iPAWN_DOUBLED_E];
var PAWN_ISOLATED_S      = EV[iPAWN_ISOLATED_S];
var PAWN_ISOLATED_E      = EV[iPAWN_ISOLATED_E];
var PAWN_BACKWARD_S      = EV[iPAWN_BACKWARD_S];
var PAWN_BACKWARD_E      = EV[iPAWN_BACKWARD_E];
var PAWN_PASSED_OFFSET_S = EV[iPAWN_PASSED_OFFSET_S];
var PAWN_PASSED_OFFSET_E = EV[iPAWN_PASSED_OFFSET_E];
var PAWN_PASSED_MULT_S   = EV[iPAWN_PASSED_MULT_S];
var PAWN_PASSED_MULT_E   = EV[iPAWN_PASSED_MULT_E];
var TWOBISHOPS_S         = EV[iTWOBISHOPS_S];
var ROOK7TH_S            = EV[iROOK7TH_S];
var ROOK7TH_E            = EV[iROOK7TH_E];
var ROOKOPEN_S           = EV[iROOKOPEN_S];
var ROOKOPEN_E           = EV[iROOKOPEN_E];
var QUEEN7TH_S           = EV[iQUEEN7TH_S];
var QUEEN7TH_E           = EV[iQUEEN7TH_E];
var TRAPPED              = EV[iTRAPPED];
var KING_PENALTY         = EV[iKING_PENALTY];
var PAWN_OFFSET_S        = EV[iPAWN_OFFSET_S];
var PAWN_OFFSET_E        = EV[iPAWN_OFFSET_E];
var PAWN_MULT_S          = EV[iPAWN_MULT_S];
var PAWN_MULT_E          = EV[iPAWN_MULT_E];
var PAWN_PASS_FREE       = EV[iPAWN_PASS_FREE];
var PAWN_PASS_UNSTOP     = EV[iPAWN_PASS_UNSTOP];
var PAWN_PASS_KING1      = EV[iPAWN_PASS_KING1];
var PAWN_PASS_KING2      = EV[iPAWN_PASS_KING2];
var MOBOFF_NS            = EV[iMOBOFF_NS];
var MOBOFF_NE            = EV[iMOBOFF_NE];
var MOBOFF_BS            = EV[iMOBOFF_BS];
var MOBOFF_BE            = EV[iMOBOFF_BE];
var MOBOFF_RS            = EV[iMOBOFF_RS];
var MOBOFF_RE            = EV[iMOBOFF_RE];
var TWOBISHOPS_E         = EV[iTWOBISHOPS_E];
var SHELTERM             = EV[iSHELTERM];
var MOBOFF_QS            = EV[iMOBOFF_QS];
var MOBOFF_QE            = EV[iMOBOFF_QE];

//}}}
//{{{  pst lists

var WS_PST = [NULL_PST, WPAWN_PSTS,  WKNIGHT_PSTS, WBISHOP_PSTS, WROOK_PSTS, WQUEEN_PSTS, WKING_PSTS]; // opening/middle eval.
var WE_PST = [NULL_PST, WPAWN_PSTE,  WKNIGHT_PSTE, WBISHOP_PSTE, WROOK_PSTE, WQUEEN_PSTE, WKING_PSTE]; // end eval.

var BS_PST = [NULL_PST, BPAWN_PSTS,  BKNIGHT_PSTS, BBISHOP_PSTS, BROOK_PSTS, BQUEEN_PSTS, BKING_PSTS];
var BE_PST = [NULL_PST, BPAWN_PSTE,  BKNIGHT_PSTE, BBISHOP_PSTE, BROOK_PSTE, BQUEEN_PSTE, BKING_PSTE];

var WM_PST = [NULL_PST, WPAWN_PSTE,  WKNIGHT_PSTE, WBISHOP_PSTE, WROOK_PSTE, WQUEEN_PSTE, WKING_PSTE]; // move ordering.
var BM_PST = [NULL_PST, BPAWN_PSTE,  BKNIGHT_PSTE, BBISHOP_PSTE, BROOK_PSTE, BQUEEN_PSTE, BKING_PSTE];

//}}}

//{{{  lozChess class

//{{{  lozChess
//
//   node[0]
//     .root            =  true;
//     .ply             =  0
//     .parentNode      => NULL
//     .grandParentNode => NULL
//     .childNode       => node[1];
//
//   node[1]
//     .root            =  false;
//     .ply             =  1
//     .parentNode      => node[0]
//     .grandParentNode => NULL
//     .childNode       => node[2];
//
//  ...
//
//   node[n]
//     .root            =  false;
//     .ply             =  n
//     .parentNode      => node[n-1]
//     .grandParentNode => node[n-2] | NULL
//     .childNode       => node[n+1] | NULL
//
//   etc
//
//  Search starts at node[0] with a depth spec.  In Lozza "depth" is the depth to
//  search and can jump around all over the place with extensions and reductions,
//  "ply" is the distance from the root.  Killers are stored in nodes because they
//  need to be ply based not depth based.  The .grandParentNode pointer can be used
//  to easily look up killers for the previous move of the same colour.
//

function lozChess () {

  this.nodes = Array(MAX_PLY);

  var parentNode = null;
  for (var i=0; i < this.nodes.length; i++) {
    this.nodes[i]      = new lozNode(parentNode);
    this.nodes[i].ply  = i;                     // distance to root node for mate etc.
    parentNode         = this.nodes[i];
    this.nodes[i].root = i == 0;
  }

  this.board = new lozBoard();
  this.stats = new lozStats();
  this.uci   = new lozUCI();

  this.rootNode = this.nodes[0];

  for (var i=0; i < this.nodes.length; i++)
    this.nodes[i].board = this.board;

  this.board.init();

  //{{{  init STARRAY (b init in here)
  //
  // STARRAY can be used when in check to filter moves that cannot possibly
  // be legal without overhead.  Happily EP captures fall out in the wash
  // since they are to a square that a knight would be checking the king on.
  //
  // e.g. with a king on A1, STARRAY[A1] =
  //
  // 1  0  0  0  0  0  0  2
  // 1  0  0  0  0  0  2  0
  // 1  0  0  0  0  2  0  0
  // 1  0  0  0  2  0  0  0
  // 1  0  0  2  0  0  0  0
  // 1 -1  2  0  0  0  0  0
  // 1  2 -1  0  0  0  0  0
  // 0  3  3  3  3  3  3  3
  //
  // Now condsider a rook on H1.  Slides to H2-H7 are not considered because they
  // do not hit a ray and thus cannot be used to block a check.  The rook slide
  // to H8 hits a ray, but corners are special cases - you can't slide to a corner
  // to block a check, so it's also ignored.  The slides to G1-B1 hit rays but the
  // from and to rays are the same, so again these slides cannot block a check.
  // Captures to any ray are always considered. -1 = knight attacks, so slides must
  // be to rays > 0 to be considered at all.  This vastly reduces the number of
  // moves to consider when in check and is available pretty much for free.  Captures
  // could be further pruned by considering the piece type encountered - i.e. can it
  // theoretically be giving check or not.
  //
  
  for (var i=0; i < this.board.b.length; i++)
    this.board.b[i] = EDGE;
  
  for (var i=0; i < B88.length; i++)
    this.board.b[B88[i]] = NULL;
  
  for (var i=0; i < 144; i++) {
    STARRAY[i] = Array(144);
    for (var j=0; j < 144; j++)
      STARRAY[i][j] = 0;
  }
  
  for (var i=0; i < B88.length; i++) {
    var sq = B88[i];
    for (var j=0; j < KING_OFFSETS.length; j++) {
      var offset = KING_OFFSETS[j];
      for (var k=1; k < 8; k++) {
        var dest = sq + k * offset;
        if (this.board.b[dest] == EDGE)
          break;
        STARRAY[sq][dest] = j+1;
      }
    }
    for (var j=0; j < KNIGHT_OFFSETS.length; j++) {
      var offset = KNIGHT_OFFSETS[j];
      var dest   = sq + offset;
      if (this.board.b[dest] == EDGE)
        continue;
      STARRAY[sq][dest] = -1;
    }
  }
  
  //}}}
  //{{{  init *KZONES
  
  for (var i=0; i < 144; i++) {
  
    WKZONES[i] = Array(144);
    for (var j=0; j < 144; j++)
      WKZONES[i][j] = 0;
  
    BKZONES[i] = Array(144);
    for (var j=0; j < 144; j++)
      BKZONES[i][j] = 0;
  }
  
  for (var i=0; i < B88.length; i++) {
  
    var sq  = B88[i];
    var wkz = WKZONES[sq];
    var bkz = BKZONES[sq];
  
  // W
  
    if (!this.board.b[sq+13]) wkz[sq+13]=1;
    if (!this.board.b[sq+12]) wkz[sq+12]=1;
    if (!this.board.b[sq+11]) wkz[sq+11]=1;
  
    if (!this.board.b[sq-1])  wkz[sq-1]=1;
    if (!this.board.b[sq+0])  wkz[sq+0]=1;
    if (!this.board.b[sq+1])  wkz[sq+1]=1;
  
    if (!this.board.b[sq-11]) wkz[sq-11]=1;
    if (!this.board.b[sq-12]) wkz[sq-12]=1;
    if (!this.board.b[sq-13]) wkz[sq-13]=1;
  
    if (!this.board.b[sq-23]) wkz[sq-23]=1;
    if (!this.board.b[sq-24]) wkz[sq-24]=1;
    if (!this.board.b[sq-25]) wkz[sq-25]=1;
  
  // B
  
    if (!this.board.b[sq-13]) bkz[sq-13]=1;
    if (!this.board.b[sq-12]) bkz[sq-12]=1;
    if (!this.board.b[sq-11]) bkz[sq-11]=1;
  
    if (!this.board.b[sq-1])  bkz[sq-1]=1;
    if (!this.board.b[sq+0])  bkz[sq+0]=1;
    if (!this.board.b[sq+1])  bkz[sq+1]=1;
  
    if (!this.board.b[sq+11]) bkz[sq+11]=1;
    if (!this.board.b[sq+12]) bkz[sq+12]=1;
    if (!this.board.b[sq+13]) bkz[sq+13]=1;
  
    if (!this.board.b[sq+23]) bkz[sq+23]=1;
    if (!this.board.b[sq+24]) bkz[sq+24]=1;
    if (!this.board.b[sq+25]) bkz[sq+25]=1;
  }
  
  //}}}
  //{{{  init DIST
  
  for (var i=0; i < 144; i++) {
    DIST[i]   = Array(144);
    var rankI = RANK[i];
    var fileI = FILE[i];
    for (var j=0; j < 144; j++) {
      var rankJ = RANK[j];
      var fileJ = FILE[j];
      DIST[i][j] = Math.max(Math.abs(rankI-rankJ),Math.abs(fileI-fileJ));
    }
  }
  
  //}}}

  return this;
}

//}}}
//{{{  .init

lozChess.prototype.init = function () {

  for (var i=0; i < this.nodes.length; i++)
    this.nodes[i].init();

  this.board.init();
  this.stats.init();
}

//}}}
//{{{  .newGameInit

lozChess.prototype.newGameInit = function () {

  this.board.ttInit();
  this.uci.numMoves = 0;
}

//}}}
//{{{  .position

lozChess.prototype.position = function () {

  this.init();
  return this.board.position();
}

//}}}
//{{{  .go

lozChess.prototype.go = function() {

  //this.stats.init();
  //this.stats.update();

  var board = this.board;
  var spec  = this.uci.spec;

  //{{{  sort out spec
  
  //this.uci.send('info hashfull',myround(1000*board.hashUsed/TTSIZE));
  
  var totTime = 0;
  var movTime = 0;
  var incTime = 0;
  
  if (spec.depth <= 0)
    spec.depth = MAX_PLY;
  
  if (spec.moveTime > 0)
    this.stats.moveTime = spec.moveTime;
  
  if (spec.maxNodes > 0)
    this.stats.maxNodes = spec.maxNodes;
  
  if (spec.moveTime == 0) {
  
    if (spec.movesToGo > 0)
      var movesToGo = spec.movesToGo + 2;
    else
      var movesToGo = 30;
  
    if (board.turn == WHITE) {
      totTime = spec.wTime;
      incTime = spec.wInc;
    }
    else {
      totTime = spec.bTime;
      incTime = spec.bInc;
    }
  
    //totTime = myround(totTime * (movesToGo - 1) / movesToGo);
    movTime = myround(totTime / movesToGo) + incTime;
  
    //if (this.uci.numMoves <= 3) {
      //movTime *= 2;
    //}
  
    movTime = movTime * 0.95;
  
    if (movTime > 0)
      this.stats.moveTime = movTime | 0;
  
    if (this.stats.moveTime < 1 && (spec.wTime || spec.bTime))
      this.stats.moveTime = 1;
  }
  
  //}}}

  var alpha       = -INFINITY;
  var beta        = INFINITY;
  var asp         = ASP_MAX;
  var ply         = 1;
  var maxPly      = spec.depth;
  var bestMoveStr = '';
  var score       = 0;

  while (ply <= maxPly) {

    this.stats.ply = ply;

    score = this.search(this.rootNode, ply, board.turn, alpha, beta);

    if (this.stats.timeOut) {
      break;
    }

    if (score <= alpha || score >= beta) {
      //{{{  research
      
      if (score >= beta) {
        //this.uci.debug('BETA', ply, score, '>=', beta);
      }
      else {
        //this.uci.debug('ALPHA', ply, score, '<=', alpha);
        if (totTime > 30000) {
          movTime              = movTime / 2 | 0;
          this.stats.moveTime += movTime;
        }
      }
      
      alpha = -INFINITY;
      beta  = INFINITY;
      asp   = ASP_MAX * 10;
      
      continue;
      
      //}}}
    }

    if (Math.abs(score) >= MINMATE && Math.abs(score) <= MATE) {
      break;
    }

    alpha = score - asp;
    beta  = score + asp;

    asp -= ASP_DELTA;       //  shrink the window.
    if (asp < ASP_MIN)
      asp = ASP_MIN;

    ply += 1;
  }

  this.stats.update();
  this.stats.stop();

  bestMoveStr = board.formatMove(this.stats.bestMove,UCI_FMT);

  if (lozzaHost == HOST_WEB)
    board.makeMove(this.rootNode,this.stats.bestMove);

  this.uci.send('bestmove',bestMoveStr);
}

//}}}
//{{{  .search

lozChess.prototype.search = function (node, depth, turn, alpha, beta) {

  //{{{  housekeeping
  
  if (!node.childNode) {
    this.uci.debug('S DEPTH');
    this.stats.timeOut = 1;
    return;
  }
  
  //}}}

  var board          = this.board;
  var nextTurn       = ~turn & COLOR_MASK;
  var oAlpha         = alpha;
  var numLegalMoves  = 0;
  var numSlides      = 0;
  var move           = 0;
  var bestMove       = 0;
  var score          = 0;
  var bestScore      = -INFINITY;
  var inCheck        = board.isKingAttacked(nextTurn);
  var R              = 0;
  var E              = 0;
  var givesCheck     = INCHECK_UNKNOWN;
  var keeper         = false;
  var doLMR          = depth >= 3;

  node.cache();

  board.ttGet(node, depth, alpha, beta);  // load hash move.

  if (inCheck)
    board.genEvasions(node, turn);
  else
    board.genMoves(node, turn);

  if (this.stats.timeOut)
    return;

  while (move = node.getNextMove()) {

    board.makeMove(node,move);

    //{{{  legal?
    
    if (board.isKingAttacked(nextTurn)) {
    
      board.unmakeMove(node,move);
    
      node.uncache();
    
      continue;
    }
    
    //}}}

    numLegalMoves++;
    if (node.base < BASE_LMR)
      numSlides++;

    //{{{  send current move to UCI
    
    if (this.stats.splits > 3)
      this.uci.send('info currmove ' + board.formatMove(move,SAN_FMT) + ' currmovenumber ' + numLegalMoves);
    
    //}}}

    //{{{  extend/reduce
    
    givesCheck = INCHECK_UNKNOWN;
    E          = 0;
    R          = 0;
    
    if (inCheck) {
      E = 1;
    }
    
    else if (doLMR) {
    
      givesCheck = board.isKingAttacked(turn);
      keeper     = node.base >= BASE_LMR || (move & KEEPER_MASK) || givesCheck || board.alphaMate(alpha);
    
      if (!keeper && numSlides > 4) {
        R = 1 + depth/5 + numSlides/20 | 0;
      }
    }
    
    //}}}

    if (numLegalMoves == 1) {
      score = -this.alphabeta(node.childNode, depth+E-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);
    }
    else {
      score = -this.alphabeta(node.childNode, depth+E-R-1, nextTurn, -alpha-1, -alpha, NULL_Y, givesCheck);
      if (!this.stats.timeOut && score > alpha) {
        score = -this.alphabeta(node.childNode, depth+E-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);
      }
    }

    //{{{  unmake move
    
    board.unmakeMove(node,move);
    
    node.uncache();
    
    //}}}

    if (this.stats.timeOut) {
      return;
    }

    if (score > bestScore) {
      if (score > alpha) {
        if (score >= beta) {
          node.addKiller(score, move);
          board.ttPut(TT_BETA, depth, score, move, node.ply, alpha, beta);
          board.addHistory(depth*depth*depth, move);
          return score;
        }
        alpha = score;
        board.addHistory(depth*depth, move);
        //{{{  update best move & send score to UI
        
        this.stats.bestMove = move;
        
        var absScore = Math.abs(score);
        var units    = 'cp';
        var uciScore = score;
        var mv       = board.formatMove(move,board.mvFmt);
        var pvStr    = board.getPVStr(node,move,depth);
        
        if (absScore >= MINMATE && absScore <= MATE) {
          if (lozzaHost != HOST_NODEJS)
            pvStr += '#';
          var units    = 'mate';
          var uciScore = (MATE - absScore) / 2 | 0;
          if (score < 0)
            uciScore = -uciScore;
        }
        
        this.uci.send('info',this.stats.nodeStr(),'depth',this.stats.ply,'seldepth',this.stats.selDepth,'score',units,uciScore,'pv',pvStr);
        this.stats.update();
        
        if (this.stats.splits > 5)
          this.uci.send('info hashfull',myround(1000*board.hashUsed/TTSIZE));
        
        //}}}
      }
      bestScore = score;
      bestMove  = move;
    }
    else
      board.addHistory(-depth, move);
  }

  if (numLegalMoves == 0)
    this.uci.debug('INVALID');

  if (numLegalMoves == 1)
    this.stats.timeOut = 1;  // only one legal move so don't waste any more time.

  if (bestScore > oAlpha) {
    board.ttPut(TT_EXACT, depth, bestScore, bestMove, node.ply, alpha, beta);
    return bestScore;
  }
  else {
    board.ttPut(TT_ALPHA, depth, oAlpha,    bestMove, node.ply, alpha, beta);
    return oAlpha;
  }
}

//}}}
//{{{  .alphabeta

lozChess.prototype.alphabeta = function (node, depth, turn, alpha, beta, nullOK, inCheck) {

  //{{{  housekeeping
  
  if (!node.childNode) {
    this.uci.debug('AB DEPTH');
    this.stats.timeOut = 1;
    return;
  }
  
  this.stats.lazyUpdate();
  if (this.stats.timeOut)
    return;
  
  if (node.ply > this.stats.selDepth)
    this.stats.selDepth = node.ply;
  
  //}}}

  var board    = this.board;
  var nextTurn = ~turn & COLOR_MASK;
  var score    = 0;
  var pvNode   = beta != (alpha + 1);

  //{{{  mate distance pruning
  
  var matingValue = MATE - node.ply;
  
  if (matingValue < beta) {
     beta = matingValue;
     if (alpha >= matingValue)
       return matingValue;
  }
  
  var matingValue = -MATE + node.ply;
  
  if (matingValue > alpha) {
     alpha = matingValue;
     if (beta <= matingValue)
       return matingValue;
  }
  
  //}}}
  //{{{  check for draws
  
  if (board.repHi - board.repLo > 100)
    return CONTEMPT;
  
  for (var i=board.repHi-5; i >= board.repLo; i -= 2) {
  
    if (board.repLoHash[i] == board.loHash && board.repHiHash[i] == board.hiHash)
      return CONTEMPT;
  }
  
  //}}}
  //{{{  horizon
  
  if (depth <= 0) {
  
    score = board.ttGet(node, 0, alpha, beta);
  
    if (score != TTSCORE_UNKNOWN)
      return score;
  
    score = this.qSearch(node, -1, turn, alpha, beta);
  
    return score;
  }
  
  //}}}
  //{{{  try tt
  
  score = board.ttGet(node, depth, alpha, beta);  // sets/clears node.hashMove.
  
  if (score != TTSCORE_UNKNOWN) {
    return score;
  }
  
  //}}}

  if (inCheck == INCHECK_UNKNOWN)
    inCheck  = board.isKingAttacked(nextTurn);

  var R         = 0;
  var E         = 0;
  var lonePawns = (turn == WHITE && board.wCount == board.wCounts[PAWN]+1) || (turn == BLACK && board.bCount == board.bCounts[PAWN]+1);
  var standPat  = board.evaluate(turn);
  var doBeta    = !pvNode && !inCheck && !lonePawns && nullOK == NULL_Y && !board.betaMate(beta);

  //{{{  prune?
  
  if (doBeta && depth <= 2 && (standPat - depth * 200) >= beta) {
    return beta;
  }
  
  //}}}

  node.cache();

  //{{{  try null move
  //
  //  Use childNode to make sure killers are aligned.
  //
  
  R = 3;
  
  if (doBeta && depth > 2 && standPat > beta) {
  
    board.loHash ^= board.loEP[board.ep];
    board.hiHash ^= board.hiEP[board.ep];
  
    board.ep = 0; // what else?
  
    board.loHash ^= board.loEP[board.ep];
    board.hiHash ^= board.hiEP[board.ep];
  
    board.loHash ^= board.loTurn;
    board.hiHash ^= board.hiTurn;
  
    score = -this.alphabeta(node.childNode, depth-R-1, nextTurn, -beta, -beta+1, NULL_N, INCHECK_UNKNOWN);
  
    node.uncache();
  
    if (this.stats.timeOut)
      return;
  
    if (score >= beta) {
      if (board.betaMate(score))
        score = beta;
      return score;
    }
  
    if (this.stats.timeOut)
      return;
  }
  
  R = 0;
  
  //}}}

  var bestScore      = -INFINITY;
  var move           = 0;
  var bestMove       = 0;
  var oAlpha         = alpha;
  var numLegalMoves  = 0;
  var numSlides      = 0;
  var givesCheck     = INCHECK_UNKNOWN;
  var keeper         = false;
  var doFutility     = !inCheck && depth <= 4 && (standPat + depth * 100) < alpha && !lonePawns;
  var doLMR          = !inCheck && depth >= 3;
  var doLMP          = !pvNode && !inCheck && depth <= 2 && !lonePawns;
  var doIID          = !node.hashMove && pvNode && depth > 3;

  //{{{  IID
  //
  //  If there is no hash move after IID it means that the search returned
  //  a mate or draw score and we could return immediately I think, because
  //  the subsequent search is presumably going to find the same.  However
  //  it's a small optimisation and I'm not totally convinced.  Needs to be
  //  tested.
  //
  //  Use this node so the killers align.  Should be safe.
  //
  
  if (doIID) {
  
    this.alphabeta(node, depth-2, turn, alpha, beta, NULL_N, inCheck);
    board.ttGet(node, 0, alpha, beta);
  }
  
  if (this.stats.timeOut)
    return;
  
  //}}}

  if (inCheck)
    board.genEvasions(node, turn);
  else
    board.genMoves(node, turn);

  if (this.stats.timeOut)
    return;

  while (move = node.getNextMove()) {

    board.makeMove(node,move);

    //{{{  legal?
    
    if (board.isKingAttacked(nextTurn)) {
    
      board.unmakeMove(node,move);
    
      node.uncache();
    
      continue;
    }
    
    //}}}

    numLegalMoves++;
    if (node.base < BASE_LMR) {
      numSlides++;
    }

    //{{{  extend/reduce/prune
    
    givesCheck = INCHECK_UNKNOWN;
    E          = 0;
    R          = 0;
    
    if (inCheck && (pvNode || depth < 5)) {
      E = 1;
    }
    
    else if (!inCheck && (doLMP || doLMR || doFutility)) {
    
      givesCheck = board.isKingAttacked(turn);
      keeper     = node.base >= BASE_LMR || (move & KEEPER_MASK) || givesCheck || board.alphaMate(alpha);
    
      if (doLMP && !keeper && numSlides > depth*5) {
    
        board.unmakeMove(node,move);
        node.uncache();
        continue;
      }
    
      if (doFutility && !keeper && numLegalMoves > 1) {
    
        board.unmakeMove(node,move);
        node.uncache();
        continue;
      }
    
      if (doLMR && !keeper && numLegalMoves > 4) {
        R = 1 + depth/5 + numSlides/20 | 0;
      }
    }
    
    //}}}

    if (pvNode) {
      if (numLegalMoves == 1)
        score = -this.alphabeta(node.childNode, depth+E-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);
      else {
        score = -this.alphabeta(node.childNode, depth+E-R-1, nextTurn, -alpha-1, -alpha, NULL_Y, givesCheck);
        if (!this.stats.timeOut && score > alpha) {
          score = -this.alphabeta(node.childNode, depth+E-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);
        }
      }
    }
    else {
      score = -this.alphabeta(node.childNode, depth+E-R-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);  // ZW by implication.
      if (R && !this.stats.timeOut && score > alpha)
        score = -this.alphabeta(node.childNode, depth+E-1, nextTurn, -beta, -alpha, NULL_Y, givesCheck);
    }

    //{{{  unmake move
    
    board.unmakeMove(node,move);
    
    node.uncache();
    
    //}}}

    if (this.stats.timeOut)
      return;

    if (score > bestScore) {
      if (score > alpha) {
        if (score >= beta) {
          node.addKiller(score, move);
          board.ttPut(TT_BETA, depth, score, move, node.ply, alpha, beta);
          board.addHistory(depth*depth*depth, move);
          return score;
        }
        board.addHistory(depth*depth, move);
        alpha     = score;
      }
      bestScore = score;
      bestMove  = move;
    }
    else
      board.addHistory(-depth, move);
  }

  //{{{  no moves?
  
  if (numLegalMoves == 0) {
  
    if (inCheck) {
      board.ttPut(TT_EXACT, depth, -MATE + node.ply, 0, node.ply, alpha, beta);
      return -MATE + node.ply;
    }
  
    else {
      board.ttPut(TT_EXACT, depth, CONTEMPT, 0, node.ply, alpha, beta);
      return CONTEMPT;
    }
  }
  
  //}}}

  if (bestScore > oAlpha) {
    board.ttPut(TT_EXACT, depth, bestScore, bestMove, node.ply, alpha, beta);
    return bestScore;
  }
  else {
    board.ttPut(TT_ALPHA, depth, oAlpha,    bestMove, node.ply, alpha, beta);
    return oAlpha;
  }
}

//}}}
//{{{  .quiescence

lozChess.prototype.qSearch = function (node, depth, turn, alpha, beta) {

  //{{{  housekeeping
  
  this.stats.checkTime();
  if (this.stats.timeOut)
    return;
  
  if (node.ply > this.stats.selDepth)
    this.stats.selDepth = node.ply;
  
  if (!node.childNode) {
    //this.uci.debug('Q DEPTH');
    return this.board.evaluate(turn);
  }
  
  //}}}

  var board         = this.board;
  var numLegalMoves = 0;
  var move          = 0;
  var standPat      = 0;
  var phase         = 0;
  var nextTurn      = ~turn & COLOR_MASK;

  if (depth > -2)
    var inCheck = board.isKingAttacked(nextTurn);
  else
    var inCheck = false;

  if (!inCheck) {
    this.stats.nodes++;
    standPat = board.evaluate(turn);
    if (standPat >= beta)
      return standPat;
    if (standPat > alpha)
      alpha = standPat;
    phase = board.cleanPhase(board.phase);
  }

  node.cache();

  if (inCheck)
    board.genEvasions(node, turn);
  else
    board.genQMoves(node, turn);

  while (move = node.getNextMove()) {

    //{{{  futile?
    
    if (!inCheck && phase <= EPHASE && !(move & MOVE_PROMOTE_MASK) && standPat + 200 + VALUE_VECTOR[((move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS) & PIECE_MASK] < alpha) {
    
      continue;
    }
    
    //}}}

    board.makeMove(node,move);

    //{{{  legal?
    
    if (board.isKingAttacked(nextTurn)) {
    
      board.unmakeMove(node,move);
    
      node.uncache();
    
      continue;
    }
    
    //}}}

    numLegalMoves++;

    var score = -this.qSearch(node.childNode, depth-1, nextTurn, -beta, -alpha);

    //{{{  unmake move
    
    board.unmakeMove(node,move);
    
    node.uncache();
    
    //}}}

    if (score > alpha) {
      if (score >= beta) {
        return score;
      }
      alpha = score;
    }
  }

  //{{{  no moves?
  //
  // Some legal moves will be missed because of futility but only
  // if not in check and numLegalMoves is only needed if in check.
  //
  
  if (inCheck && numLegalMoves == 0) {
  
     return -MATE + node.ply;
  }
  
  //}}}

  return alpha;
}

//}}}
//{{{  .perft

lozChess.prototype.perft = function () {

  var spec = this.uci.spec;

  this.stats.ply = spec.depth;

  var moves = this.perftSearch(this.rootNode, spec.depth, this.board.turn, spec.inner);

  this.stats.update();

  var error = moves - spec.moves;

  if (error == 0)
    var err = '';
  else
    var err = 'ERROR ' + error;

  this.uci.send('info string',spec.id,spec.depth,moves,spec.moves,err,this.board.fen());
}

//}}}
//{{{  .perftSearch

lozChess.prototype.perftSearch = function (node, depth, turn, inner) {

  this.stats.nodes++;

  if (depth == 0)
    return 1;

  var board         = this.board;
  var numNodes      = 0;
  var totalNodes    = 0;
  var move          = 0;
  var nextTurn      = ~turn & COLOR_MASK;
  var numLegalMoves = 0;
  var inCheck       = board.isKingAttacked(nextTurn);

  node.cache();

  if (inCheck)
    board.genEvasions(node, turn);
  else
    board.genMoves(node, turn);

  while (move = node.getNextMove()) {

    board.makeMove(node,move);

    //{{{  legal?
    
    if (board.isKingAttacked(nextTurn)) {
    
      board.unmakeMove(node,move);
    
      node.uncache();
    
      continue;
    }
    
    //}}}

    numLegalMoves++;

    var numNodes = this.perftSearch(node.childNode, depth-1, nextTurn);

    totalNodes += numNodes;

    //{{{  unmake move
    
    board.unmakeMove(node,move);
    
    node.uncache();
    
    //}}}

    if (node.root) {
      var fmove = board.formatMove(move,SAN_FMT);
      this.uci.send('info currmove ' + fmove + ' currmovenumber ' + numLegalMoves);
      if (inner)
        this.uci.send('info string',fmove,numNodes);
    }
  }

  if (depth > 2)
    this.stats.lazyUpdate();

  return totalNodes;
}

//}}}

//}}}
//{{{  lozNetNode class

function lozNetNode () {

  this.sum      = 0;
  this.weights  = [];
}

//}}}
//{{{  lozBoard class

//{{{  lozBoard

function lozBoard () {

  this.lozza        = null;
  this.verbose      = false;
  this.mvFmt        = 0;
  this.hashUsed     = 0;

  this.b = new Uint16Array(144);    // pieces.
  this.z = new Uint16Array(144);    // indexes to w|bList.

  this.wList = new Uint16Array(16); // list of squares with white pieces.
  this.bList = new Uint16Array(16); // list of squares with black pieces.

  this.firstBP = 0;
  this.firstWP = 0;

  this.h1 = Array(NETH1SIZE);
  for (var i=0; i < NETH1SIZE; i++)
    this.h1[i] = new lozNetNode;

  this.o1 = new lozNetNode;

  //{{{  network
  
  // last update Thu Nov 11 2021 14:51:34 GMT+0000 (Greenwich Mean Time)
  // hidden layer = 8
  
  this.netScale = 200;
  this.h1[0].weights = [0.5842384945421863,-0.5807407818432533,-0.5667999311645442,0.3320726531966698,-0.28134661348722156,0.0321010252449212,0.2868429378726809,-0.34928716355999967,4.677335901153136,4.386432886432247,4.614014223897465,4.588935396511808,3.522428435263634,2.40433036076121,4.047986775448825,4.57178292480968,2.3895325905294866,3.1215541704591128,2.152767857503026,2.5069888218795695,2.340044666719193,1.3325082120288372,2.8101464078245284,0.618970686341379,2.1875829070810826,2.326887200573379,1.583013786347071,2.822041041176295,2.0079697931836957,1.041993361265449,1.866013685956489,2.450332963279908,2.011150710082825,1.2395762848941287,1.7337873407531583,2.0040660326742916,2.709881609306343,1.2492685084036708,2.359132612867338,1.2601998851717706,2.409453530891768,2.1556051405013523,1.7710883126029138,1.8560160685965663,2.8501638256639192,0.8686451575423437,1.300133237210412,0.3497659312327141,1.355949662195922,0.4033307388836337,1.2928846513597863,2.3229643461923737,1.235628178366845,1.0295381391995908,2.1109490463394667,1.0827031070463036,-0.1796975841920796,-0.2505845783471745,-0.5087706950000266,-0.597999257527817,-0.39033978840952077,-0.7749067827153584,-0.5903662679182289,0.3358405850521722,4.97068534090814,6.4536236329019765,6.671542286668715,6.6481926910299665,7.930862323376735,6.947852393417766,7.521275038885259,6.594318399078776,7.708918417642386,8.306375368727526,9.838862785039474,7.835410982165263,6.760996778368222,8.746800579318846,7.576402080083357,6.84292424189242,7.686675803183791,9.206621859213584,7.784494849456725,7.526668581544502,8.857666055122895,9.390345903683409,8.936787927233015,8.957355632880713,8.746749341758369,9.248362169582842,8.455221369354032,8.806063489951793,8.428599550960158,9.242022442641796,7.142508677293773,8.678739221523841,7.638033136896096,8.582008578215847,8.125551889781608,7.209715240731056,7.474657912204189,7.9207083239390785,7.908992709000976,7.61748683099838,7.525005433247306,7.424730467906114,9.764145192488328,8.83575053735939,7.85071419798141,9.367799152993319,8.554092298814306,6.833148833563229,7.63422069327528,8.471043153786187,8.712572588533742,7.174384114549031,9.034773839746942,9.142969043270096,8.95463207905502,8.667530493861735,6.714058893216743,7.467642988353352,8.709491523655611,8.21425091752478,9.132957951725054,7.7146173095455675,7.9570465066419445,6.810291678651045,8.615921161962156,8.968093502635504,8.146904548116407,8.502651003797265,8.117208529030018,7.670893730560373,9.32918000944778,8.215022996566983,8.629616242265802,8.998611174317034,8.386082376227654,8.701270998112335,9.024926239412473,8.245033435992628,8.40173480649194,8.52725485806712,8.611645620317505,8.561022550604989,8.448105633505488,9.298815390773793,8.156032345986107,8.726179091690764,7.320197353024757,8.66552943647508,9.021134213357609,8.749936791727656,8.084989459998953,7.933966654788463,9.345293727686503,8.800260164948162,8.107661291775287,7.834928626571315,9.018286975175807,8.496725557194004,9.495613302848918,8.044717433165644,8.395451605885107,8.998835918662706,9.073932027454873,8.566329563221881,8.891189908203947,8.955502706173746,7.921768126273609,8.741430010691987,8.024648553231758,8.927066907324605,8.269934466186717,8.667279505490201,8.715740603729603,8.392471035418799,7.737685850830319,8.830919334084113,8.979626904020597,9.092379362564266,9.498682283421978,9.140069141414001,7.824174144115884,9.551900319408416,9.206648481963674,7.576784578377128,9.267220070052867,9.265784274623739,8.370504992842449,7.865501640202252,14.261711831119122,14.373479516880007,13.794914386990978,14.35780060698614,14.462582941359646,13.314065782377401,15.252892830909431,13.022366979568222,13.386672067078132,13.151708318264033,12.845964534460693,12.559879318622864,13.692793909115789,12.850065641309524,12.57105004248983,12.858474411578072,13.336831605960944,12.48357383267091,12.670477641605467,13.701776054909221,13.183917913971369,13.56509908257271,12.454980439339252,13.525797815719946,12.594926306650581,12.836398827463162,13.677250522582822,14.288904961985116,13.515073129426451,13.060061773299184,13.149093190098638,12.92254485760504,14.603862720576887,13.545871005052774,12.98138238934928,13.812671899330907,13.27041605232807,12.75191111887762,13.525570752627408,14.779872254342667,14.463804831011739,14.051835280834664,13.176861144053701,13.482872492039592,14.088258464040205,14.007404168445552,14.007203527815408,13.6969097014943,13.508092195046583,12.69866384552194,14.984164745869782,14.56910906627204,13.699641272186616,15.036903227111006,13.212342849657702,14.351754047211339,13.669756000847265,13.745470172640175,14.150604020574244,14.643366702746437,13.641180579116222,13.438609544218862,14.21580606554652,14.206497432278466,27.28332844297816,27.771986196510845,28.604147185456743,27.151492523999632,27.158559571054308,27.21698003050185,27.799710205944955,27.51688089101412,26.356016399252614,28.12381467526381,27.3861303117434,26.996369627925453,27.695337653619156,28.192977897467372,27.452792774785443,28.436766912472795,26.814338381643157,27.114777028290145,26.788092019250044,28.489494107294945,27.88801238346269,27.5529472803033,28.01601169454369,29.035334713592675,26.67091149019485,26.93320792203996,27.62344419296251,27.421184912486964,27.72417651837345,27.529114548076773,27.61713029751326,28.79550054733478,27.79004612087448,27.64135468517113,27.897829338129622,26.457401268289523,28.337217686093908,26.955697373812296,27.211705772346033,27.65971509636088,26.640971496779567,28.08811158793784,28.300171393068563,26.20133598973525,27.57730395413257,28.8097912789162,28.58390036114155,26.88646497455653,27.330429666630767,27.074246500747652,27.364629992579896,28.615750586980404,26.909043084421775,27.028629325730464,27.010467190504606,28.25520375350883,27.72827133771259,28.31624580071891,28.02076816302396,28.368060571100706,27.332073597065655,27.141794645481724,27.274499647879995,26.732979667214746,-2.0192383681345554,-0.6148389294219351,-0.2337549146386336,-0.23922244637306955,-0.9120075584513805,0.03559308528830206,0.18138239398740555,-1.0220424026686712,-0.6923226873771207,0.4208041436750327,0.3212187818084732,0.5602234207612491,-0.3979436562617122,-1.0237833598972013,0.09376528631433018,0.5686940075552098,-0.154457168784893,-1.6925273937004937,-0.2269891758440061,-1.2138499676411314,-1.2725298798087636,-0.5484947988178528,0.2343265438288623,-1.2359250181678245,-0.5547925523044644,0.07271367219663807,-0.8691921508655318,-1.6063243313015036,-2.0845970502841857,-2.119576588866348,-0.8242256714816724,-0.9451600207012784,-0.6323097606745797,-0.6442287454746841,-0.8535899111357115,-1.584535008170099,0.09540273987402298,-0.7737574904636044,-0.13520168084075343,-0.6552538050399269,1.0458205851447469,0.8477588435359323,0.13351861282360517,0.18834148997606828,0.07698669644579567,-0.9613956236951584,-0.012557218735545373,1.0643109086874856,-0.4770792736756669,0.004006581456580055,-0.1379992785678838,-0.445708683139554,0.1754827758187042,0.2175254913288349,-0.0877777170459138,0.0405402879680702,0.5282662776323712,0.4848873516918845,-0.43296067184071974,-0.11444361877283225,-0.6353094077981845,0.2552103133070317,-1.1145080560753127,-0.9190526511918707,-0.14933980501504784,0.6224004609586915,-0.44407036492933427,0.054026855535951324,0.8683898885717451,-0.8735407647806084,-0.5586300422800345,-0.15144794732507005,-1.6365712497028349,-3.1449341971799836,-2.261699210580864,-1.4366653611677247,-2.553235756065114,-3.007130168362629,-1.5086718189592008,-3.208526254319236,-2.1544065989321455,-2.475778256707078,-1.5136971205354792,-1.570561467053245,-2.98225724427265,-2.4611358037672177,-1.6804162022000249,-2.328697897259578,-1.6572827326520425,-2.067619205325789,-2.2035003361161385,-2.460573220386834,-2.5677916722115475,-1.7020899825743023,-2.0749943732560534,-1.5193408640342898,-1.6593241113289858,-2.2567113827942205,-1.7172266354890495,-1.3670773203522186,-2.5414220797688682,-2.013355869149431,-1.2299761454310718,-1.6264620961984546,-2.4382056860288652,-2.57342883398592,-2.7004860931131285,-3.41045680785568,-2.2130073029509925,-1.6558180326922112,-3.3898927972865533,-1.7763492333491282,-4.380088680966329,-5.3125101544454525,-4.425734869268736,-4.027361277033496,-3.6574906120854194,-3.7195924321079743,-3.942204014763152,-4.319652330681236,0.7856348929495383,0.030207383066135574,-0.607063691037327,0.12940695977286198,0.7029815866873337,-0.7096494620156348,0.341886363064658,0.9100292870545537,-6.7288237253695895,-7.54131366764219,-7.445572289818421,-8.05540949509339,-7.910002233871612,-9.210186867620775,-7.113747933612254,-7.452304311458315,-8.26085968595402,-8.789070256288731,-9.101829309922016,-8.176113606955942,-7.564052712703319,-8.227118492441551,-7.688100735163318,-9.602227470384278,-8.021911030772893,-7.754225744351415,-7.761507823808042,-8.515733159097037,-7.691572942249292,-8.717279847035842,-9.304633530348996,-7.371728993276922,-6.869349419088835,-9.14808003493637,-8.200646252109987,-9.374244762446281,-8.428047560630898,-8.101659222325027,-7.847239953540205,-7.5375215899556975,-7.295461287379245,-8.809919805565064,-8.798343990806982,-8.321539140746149,-7.904680018665737,-8.421310150280702,-8.390786581157672,-7.649731227227879,-8.879618274387342,-8.17983278716883,-7.436912976659725,-9.120441094633751,-8.610825423665183,-8.720232769196587,-7.902514694731249,-8.61938702628416,-6.302140368933845,-8.281864287048094,-9.616498927633952,-7.657643143138523,-8.414671402946436,-7.995821696006457,-7.366970541213503,-8.30526607756003,-4.296355976698959,-7.894066243661781,-7.628589758976017,-7.77950017651291,-7.455388282649364,-7.179008921571077,-8.817119205786856,-5.832873607247253,-8.73357720100921,-9.316178955973633,-9.236275516698376,-8.821761614802751,-9.509096096875036,-8.751965975999454,-8.392536066874671,-8.39222708449285,-9.049640236880537,-9.3792099007161,-8.760059816547756,-8.027276631505355,-8.046494791901903,-9.368492459431726,-9.377675951969659,-8.642636736001906,-7.759319043353669,-8.54455103308393,-9.835673695321127,-10.413865624402316,-9.271033139168965,-8.326396440465004,-8.180087045154309,-9.311789716583338,-10.41581363888808,-8.534717753356095,-8.304708353742313,-9.855632684557676,-8.317187095310606,-8.896457983579138,-10.073012073495358,-9.747827650388725,-8.071284004897194,-9.0252575348315,-8.457414003655352,-8.80812139739127,-9.360574833334395,-8.57015035693891,-9.466263131045542,-7.92663004639912,-8.777986492086384,-8.459476363574197,-9.147069754882592,-8.818228630222608,-8.217975903212846,-8.78962991940308,-9.739068681425207,-9.802707481602123,-8.699026827432347,-10.06921163153848,-8.377515201746302,-9.792262398969507,-8.057090935624922,-8.997589019852398,-7.6698323209796495,-9.494195869469428,-7.499784588642462,-7.540763466107791,-7.7852056440773705,-8.999984062953626,-8.51241694864878,-8.114832951647456,-8.87268622392373,-8.728487481505963,-13.16380263612547,-14.559072797187103,-13.3590644609549,-12.44398873396395,-14.202229444711177,-14.00698346153814,-14.055954342383032,-12.735422896169263,-12.891756186742885,-14.979376422057975,-16.14124444372283,-14.50113870587618,-13.739977470505154,-13.754206790754615,-14.254906841743052,-13.215894775289955,-14.237783268607046,-15.389429710236302,-13.697766190436948,-13.204355151397463,-13.785022676311335,-13.086153428486597,-14.954508061105619,-13.784823327530505,-13.696611516426936,-13.30917083879241,-13.667727555490975,-13.575068639778591,-12.923220939587496,-13.91176331563302,-14.506517795987348,-13.464865849125163,-13.726238765482345,-14.009469218184838,-13.343306408133781,-15.397095671983188,-13.083344652990823,-13.086712933296216,-14.012682385922211,-13.798060799315737,-13.502115504363175,-13.0038260480995,-14.684338216746342,-14.152289372079723,-14.185508095911317,-12.437785857395884,-14.19825587518686,-13.488181389708583,-13.387396096481037,-13.307491865131633,-12.683551771959737,-14.472108083041507,-14.381174153497307,-13.979800357718958,-13.82954509093799,-14.009264808924373,-14.957261974780327,-13.056175529247287,-14.463359067752181,-13.864197481690125,-14.212866074708582,-14.734307727587247,-14.229319720369906,-14.182812660907855,-28.49276655467991,-27.6765054669649,-27.017434481256373,-26.332317073204184,-28.068376139210674,-27.67862778314602,-28.36037035011185,-28.19393230344588,-28.203650680138317,-27.500196575991573,-26.573067756993296,-28.374241418946458,-27.58090680263895,-27.85026602451091,-28.017468872832293,-27.348216796199427,-27.89184143944384,-27.280120734857487,-27.53050610836104,-27.431490848112514,-27.99755100730826,-27.724725773843325,-27.15714394816662,-28.22172356393635,-26.84958765859592,-26.809177953667135,-28.216335279644905,-26.93391854050031,-27.359354551182445,-27.761999752161703,-28.65103400650228,-27.3026247132361,-27.51760173430995,-27.477770105421538,-27.43632548724059,-27.007782736369556,-26.787196658843616,-27.541779775967058,-27.81752506012884,-27.697537708290167,-26.992571279395566,-27.951820122211515,-27.22663964890964,-26.768071586243174,-28.254483275002634,-27.86897778208747,-27.97174255470832,-28.022161153414743,-27.663296242253185,-28.227962500224084,-27.558671596712024,-26.966992973820766,-27.52504324571526,-29.095078320535034,-28.297017115893105,-27.849253580730096,-26.789488097048594,-27.4265202848731,-28.27806822981785,-27.97936434662402,-28.730996182001856,-28.015263096733264,-27.935410498078888,-27.85919834843072,-0.7043230313441886,-1.8928607312156875,-1.363251383396107,-0.8569798102736779,-1.0442307408611293,-0.08034987596369005,-1.169676070130855,-0.8114252282355074,-1.4805635254416356,-0.47708916742680035,-2.1426615120241457,0.15015739983984266,-0.035629141825507235,-0.46348529609763595,-0.8305819452765238,-0.7734936927242708,-0.48092318165646153,0.10291115104832005,-0.8712819288727781,-0.4769353455866059,-1.0086851293328034,-0.04317958957317068,0.10421425015534166,-0.49391252452038564,-0.4655617830273518,-0.5411724199986453,0.15029749663425782,-0.31630871809554945,-0.31347596249809917,-0.25772057497752576,-0.418673816825751,-0.5905060914299273,-0.48692017785492914,0.15757416960282725,-0.547199309830865,0.5916592332408541,-0.6427064367819066,-0.27008997135837254,-0.21548679148601269,0.7631083474946503,-0.6637267097644324,-0.302728799601261,0.46435617404480234,0.06544311067309369,0.34760304513748413,-0.5947073098725686,0.11312273031094446,0.6710013599366742,-1.3545892039609964,-0.9882276580958994,-0.0814135957873282,-0.010498276537569746,0.30129547696743,0.6292344420366709,-0.3665680642375124,-0.08966397452918351,0.2622402566404535,-1.338092509522996,-1.1968781916698907,0.3100907746579347,-1.2014097076121126,-0.7831801071469618,-1.1131328177228448,0.12350148511011226];
  this.h1[1].weights = [0.20163889952774383,-0.7336497945294966,-0.15233234377028904,-0.7292164748116177,-0.398850915156737,-0.6702792007163025,-0.7327431990289965,0.2703532377339761,-6.779027662169013,-9.282732384244198,-7.553371652402386,-6.942658533812663,-7.133559908808919,-6.653211953729986,-7.893303486589511,-7.932000245451396,-5.262514341536418,-6.114858098384127,-5.689740819465285,-4.472645821857721,-5.688034456614872,-5.323908271080642,-4.747963546664216,-4.938090753208753,-3.5745810765238826,-3.849691465234775,-3.475427689684297,-2.524872393870993,-3.4007319062910493,-4.542851361545751,-3.113532200955283,-3.406325298200525,-3.2027938520229915,-2.9821823555468248,-2.6345651648618653,-3.3900394937533385,-2.0719106222329584,-3.217961996278575,-2.7404259079522553,-2.641705465718389,-3.9392092247335464,-3.62722451760786,-2.566902383165212,-3.739487293027246,-3.0842666024745315,-2.7115560198286883,-3.718848566141782,-4.019868771872296,-2.236325072159934,-4.930430602293157,-2.2304944715642874,-0.4810912067661764,-3.0970719002552682,-3.6469172655763233,-3.3404914100610745,-2.9479541557613698,0.18629144619086002,-0.8395654991036481,-0.3008273000040189,0.7230965061795636,0.09093929671400147,-0.6184650883241964,0.1267531321388331,-0.9394925466560053,-6.161404450615968,-6.775235809748737,-8.532162322500257,-8.45069960369295,-7.668018870282348,-7.098400997287261,-6.761240042295859,-4.439857305409278,-7.468755248376885,-7.930995860549801,-8.8576679299339,-9.185480260201178,-8.674960825489315,-9.652501320489552,-8.561133519648667,-7.566647445217018,-8.196654701566583,-10.453125265650167,-11.150690462502704,-11.47029828434763,-10.015855469199858,-9.739490552136289,-11.061054281356695,-8.91662916814732,-7.990317137954836,-9.497769195805676,-10.561840692322349,-11.313860020467825,-10.200189320736637,-11.021605996531544,-10.40553925549813,-8.291689171667766,-7.339546330254386,-8.613878428060147,-9.748261510744557,-9.361630971194165,-11.399335458700929,-8.558346725152003,-9.947099249955432,-7.940709548447803,-7.28311138666127,-8.785224324031706,-8.753898538929331,-10.064028130098695,-10.686990646102172,-9.554137391622517,-9.33895700811202,-7.6153932158550175,-6.9963318996520725,-7.074306069256282,-7.4401036187940575,-8.96650767887211,-8.615901917986971,-7.811938759436123,-8.04456345595621,-6.895407068954152,-6.619444969378048,-7.013403686421952,-7.205670719810691,-8.106753925303773,-7.370146746968174,-8.212496545247301,-7.894174142913287,-7.0001294957682205,-7.755446657802599,-8.945781557929658,-9.735986559475702,-8.721027323223048,-9.30406175860578,-9.914833208287183,-7.946728642964758,-9.421936102494875,-8.847726819882269,-9.708226635101589,-9.84688767050957,-10.14914253854997,-9.909544752536267,-10.49443422895168,-9.707773289134547,-8.880690654304292,-8.802285292607252,-10.16042680694443,-10.90020552359117,-10.679143215506626,-9.568711971492048,-11.853140626401586,-10.020260001223114,-10.86211883286547,-9.458435021246103,-9.734606560193386,-10.670736953095023,-10.16629484993556,-11.813905449173413,-10.232584373959517,-10.023063216974458,-10.193188518856836,-8.26780365857479,-10.491572715898307,-10.113666824399784,-10.69189559164494,-10.357309680624697,-9.436424582737395,-10.070078743458293,-10.108354218979853,-8.992063680355564,-10.427927349710956,-10.03144032806583,-9.840566004632517,-9.918208067895925,-10.945433506777533,-10.07855015914894,-9.689078138635292,-9.257333242308357,-9.769906332725382,-9.194296629546884,-9.865299014589393,-9.186519484923194,-10.377251298279825,-9.407381782598268,-9.233803972905912,-8.332434510726571,-9.177278026681964,-8.783632377826155,-8.861980138476403,-8.8904590469729,-8.427024983473675,-9.032149249704204,-8.491264042399262,-15.220128848052877,-16.479300001919327,-15.366955806618252,-15.543388277559574,-15.425377693313502,-15.748264760796229,-15.39781700758834,-16.74303232651225,-16.296547219863523,-16.451499425039895,-15.706958471755668,-16.202104156775935,-17.084532464340892,-16.039759331894913,-15.944632615591523,-16.38130003103409,-15.592415704859672,-17.21227314273504,-15.501556076092744,-15.511396941624977,-15.339199191614656,-15.083163795647472,-16.489393501315057,-15.258012250878986,-14.794142815526254,-14.141094093497182,-15.826079628556087,-16.01914550203941,-15.940436665579272,-16.463788978692406,-15.329010139736505,-15.80285381669338,-13.548827450210467,-15.28937863720731,-15.082842366448736,-15.318733085397556,-14.765651497066251,-15.041648264521188,-14.045907128335848,-14.392400432930291,-13.564412049269286,-14.914020897054304,-15.29473673289364,-14.651302982813933,-14.226801448248864,-15.421288030147567,-14.597795791856624,-14.79901616129646,-14.37934153716731,-14.525560973797116,-14.036620622739111,-14.998939355219198,-15.820846573211899,-13.844075195346388,-14.69285907270676,-12.811642579909265,-13.821378025240882,-15.421025465744673,-14.75191691169282,-15.398981208053868,-16.05178196606736,-16.44095136166762,-13.666659768278706,-13.391315865554299,-28.675562822060648,-28.93460411772649,-30.36884432146143,-29.337114930398545,-29.907900583538467,-29.99139509574807,-29.47481037731729,-30.45130222796019,-27.325745844883716,-27.731365351060766,-30.109537868459743,-29.59690562101515,-30.03190427858507,-30.902879086002226,-29.733381367620417,-30.2108272356384,-28.556881611687228,-28.476261411659074,-28.07449279665465,-30.05523747120553,-31.191469583955914,-31.053527844569224,-30.421649026208172,-29.887995004359656,-28.03535792706235,-27.49339717848356,-28.379297437339446,-29.699241096412138,-29.36905472503398,-30.752995463911127,-28.58898254294664,-27.89341422918094,-28.560151322313303,-27.18419543231163,-28.735891958422492,-28.757767371929365,-28.158952437423014,-29.585998357004655,-29.899226182630972,-28.413597309660577,-28.087498256144503,-28.575396075783427,-28.24343987501059,-28.697878854733695,-28.44414734061416,-28.47047725686164,-28.20959569630216,-28.504521373270876,-28.020652671065054,-27.467966635577096,-29.102934016334608,-29.406818166330844,-28.59252948269186,-28.581311641871395,-28.857728254228057,-28.318446165792622,-29.16530580270271,-27.20786181477785,-27.951150803439965,-28.795177905818214,-27.893637063392987,-26.962955847810065,-27.740699363786828,-26.9231328083011,2.369321890486142,0.5186670876007115,0.04274281487751965,0.978678026657107,-0.185651856368331,0.3187958437006747,0.14751984832895218,-0.37399433227323226,-0.6272880928030748,-1.120972149979799,-0.33021379588048977,-0.7453813294243736,-1.2127350634547984,-1.3861920656187643,0.5324950213429367,-0.5281070225394883,-0.25776691313151195,-2.465263918438017,-1.5928030972437004,-0.19171362792289368,-1.2858461218104311,-2.8788855898295203,-2.357684243394649,-1.1321826942451043,-0.5674286575253642,-0.6068292817496524,-0.4338372074085532,-0.9489722199562559,-0.8239345802249429,-2.3837634549386917,-1.7028264110154356,0.5340013088254761,-0.6055111345177198,0.46550524323296244,-0.23344457526538323,-0.5382701541237389,0.5843217897280586,-1.0078710500447021,-0.6454757641668446,1.8189032846438224,1.1090168704440133,0.6596585067864738,-0.2827326554567738,-0.5309436777196396,-0.25097862863746573,-0.19737372863592087,-0.2572959441861064,0.44825954518451117,0.6841901880213269,-0.694907964966673,-0.840976143416736,-0.5850009724071636,0.6996626801709849,0.22951524492165953,0.10434009391047086,0.63778707250805,1.7459201885506428,-0.27981798957468823,-0.07118709999476341,0.8717354305421997,0.45526062915120674,0.8824882520647688,-0.31103080376844183,0.7940299567599572,0.3665423834227317,0.8769619854338644,0.11640687314801923,-0.22568103882445145,0.04598460355256373,-0.549678117639274,0.7788380086071807,-0.6363575564485608,3.013912110879646,2.533341170928855,1.998609799472133,2.022157067581308,2.8774194991122273,3.473154070829711,3.3909274204462947,2.7988495542924037,3.30779574968449,3.2185128734390567,2.959951708090572,2.955415396825876,2.9835189120519403,2.8612464949403784,3.0088396423966763,1.6713809978600684,3.525833714910275,2.971845038168614,2.0023322424099117,3.254279054560986,1.5134190828429808,2.9446566045524962,2.6771157688730254,3.54456546670279,3.9289002294100563,4.049183838991403,4.016055327517964,3.833115757099323,4.345399368007987,2.7854621082980824,4.560542215028136,2.9083417827687,5.206589231616242,4.840324368971675,4.181223779521356,4.208109955593369,5.356298528427448,5.106292895174478,4.18008744745761,3.7930543799957173,8.5165532349573,8.762484858109657,7.581784838968704,7.3633397099054,6.4691667052930715,5.807604242754216,7.287146610396125,7.115515597681269,-0.378208848444769,-0.8796346272806161,0.3943590992294088,-0.8157301745231398,-0.34280468342024584,0.381734597803451,0.02469310901873456,-0.16877452138566795,6.040579213287959,6.31897622356421,6.183942477077713,6.702533755822347,6.796221223850724,6.448392817425278,7.077961353210448,6.453402400356658,7.662595662826055,6.342348586930745,7.042536660185826,8.279868756009117,9.102685136251706,7.696746941682696,8.558708092692324,7.31580481082925,7.926577562168629,8.584599436507006,8.814703408598426,9.77175703401967,8.885528446188662,9.60040318472181,9.134091617589979,7.5875545050996545,8.717638424295883,9.073341742444077,10.266658564737604,10.259028562281788,10.321967484493221,10.075132584453057,10.183465617015177,8.09809685241575,8.739165916635798,9.500780892709974,10.336714013488598,11.787875005869676,10.274343798667271,10.945261403586741,9.102005231056603,9.075593647966443,6.94782015665242,10.266874042914315,9.996834019173983,10.138789663961905,9.849693451746827,11.686219249909668,11.660614545815305,8.922722378851855,6.94105437451301,8.41821427764792,8.597583627097675,10.097011549219989,9.21804794999572,9.78284735298676,8.707695822556651,7.204241631838121,5.682130708259516,7.49458321563879,8.303842028196982,7.97033298088106,8.066292589600335,6.74181874231173,7.749298381471743,5.6587479622899615,6.771077334223551,8.722967955435989,8.758261337093879,8.662145988489614,8.167040923738412,8.767570945489803,8.810561198400492,8.16817723259169,9.307730733826336,10.1029670936624,9.012826864179488,9.96645299778888,9.308526496262203,9.576328770663284,9.252774421141137,8.38330863556903,8.850033736389628,9.530633045268207,9.316564713659913,10.492432562275546,10.91435694999373,10.145133785864221,8.988647181578502,9.908349211794404,9.238555631494114,9.320455864439044,10.26678581866149,9.129380391230928,10.200200370911054,9.13089295610578,9.813577861307621,10.431936346932789,9.056034103347795,9.62288693106724,10.827417316047551,11.174345983125011,10.518741058211717,10.584018745186274,9.640113989247984,10.674880919309649,8.644610176558814,10.169257676760655,10.74357261329644,9.853965748498213,10.95810478562247,11.699518951204812,9.969889334844781,10.070310573627161,8.87009099319708,9.038564939718185,9.581981181001376,9.501842840316815,10.854155511438524,9.753757055103616,9.760452887012066,7.220618353610739,7.758720516712223,8.576992298197762,9.18923163820848,8.78907765373729,8.889399590501991,8.956169443788845,8.03396712838311,8.39498249376356,14.368467757302117,13.70846329571202,15.469935349850845,15.088834001074506,14.545546215217588,14.872874186606877,13.073686830791967,13.826828270470656,14.366072487961528,14.700248978617438,14.442636400424089,14.426014317602972,14.875308844545545,14.514243799495016,14.75522622426612,13.476392026580085,13.551998420507736,14.068976392147441,14.90088882750342,15.585030719387344,15.582686381411426,14.831225170295049,13.636745534496177,13.235732519706168,14.316128860551883,15.01784971915724,15.225525192737015,14.76904141157199,14.800383883707143,13.988263318258799,15.636705073683412,13.769194805149281,15.261545787068332,14.96628430762794,16.089835485728724,14.573609313114158,15.593773464719341,15.468495484465057,15.868805441625025,14.216371522957143,15.839263903910334,15.763026769671182,14.633732844920024,15.457120173784062,15.139285867783055,15.359654123201995,15.786719458071392,15.28449106529327,15.920736874860316,16.051134127515425,15.636920640506716,15.510221348147489,16.01777165537895,15.745492758917228,15.512425230907688,15.065738522162352,15.485329147757628,16.49699966775615,16.853003903055747,15.727411335214532,14.858212744746512,15.876980845054117,15.881998110098436,15.05480876015747,28.856039641321473,27.581438386037547,27.61380318173965,28.994808045297457,26.797211334077208,26.56894359489363,28.606206365487715,26.27162649627762,27.04636417387418,28.31178640478736,28.36603414051682,28.153327265772603,28.488606429036306,27.77025120399034,26.22933603269487,27.86711822400459,27.1412015937867,29.70947947561735,27.64955391361846,28.305611325562545,28.40953945129078,28.463750500204934,30.037067887353363,28.910476506333648,28.285773558863553,27.550745740941696,28.11303553175456,28.78736593848497,29.115958798387716,28.834474980184112,29.16540159038345,28.270032342326882,27.451096343671527,28.211520252026915,29.257916204231428,29.538400009083198,30.546399942311663,30.4801606994571,28.763139871025647,29.646427360641287,27.877524560726517,28.329332579977883,29.084218387119652,30.09143939059865,29.89695872348259,30.55964521386225,31.46267197667672,30.22153273668994,27.96800907350675,27.16022916760317,29.383925821743755,29.104951101928194,29.341900546169022,30.536852724886643,29.800825982709668,30.65236282385855,28.44061297983153,28.138879447203095,29.669823884880415,29.282180968167484,29.394559598397073,29.049218167734622,28.423363050674265,29.332526607148544,-1.8188504018624605,-0.7982981124564968,-1.4499965779544337,-0.25936047186439815,-2.340127423633769,-1.0980103773637437,0.21247984090361463,-1.750449273910052,-0.4568124310410964,-1.1965984401108753,-1.5012964116625036,-0.7331015665551474,0.4808259690495321,-1.0337082838114398,-0.2455251948667714,-1.0749480470888946,-0.6880922561887697,0.3881698365924729,0.7420802128227048,0.7681144591772081,-0.19790898535390938,0.8489744778045154,0.08606861102696818,-1.6707278580657259,-1.5112174575367252,0.3068452786505133,0.6725096046164744,-0.34627169770976457,0.23558148113839045,1.0918893838536246,0.2664568990746401,-0.8931223396806645,-0.0671264248250867,0.36823536317022043,1.0254507410608689,0.3555876697203098,0.8770543811768062,1.291452180670805,-0.07086733621599811,-0.8735953731369108,0.683043205320751,1.2886134562816434,0.8022366599159315,1.2802966465865249,0.5185947953985901,2.283732038685747,2.0944789024803874,0.7351865010940563,-0.4899754155731059,-0.4779162540011761,1.0838178526571027,0.23096053320137674,1.569354631550218,2.3957343471503116,0.4493518332573475,1.233215093998153,-2.88544413775373,-0.9521168345238149,0.40529329807650427,-0.7974589194576683,-1.0124511307891293,0.4264391251787534,-0.41399283245906016,1.3853150501499205];
  this.h1[2].weights = [0.07453946178764959,-0.4896635632183157,0.5087735743988504,0.46629553649870736,0.3339180499788581,-0.3442243906820588,-0.729429278581561,0.6988848821758431,-4.784172297643234,-6.918556437550084,-4.408383520560912,-4.709837966217323,-4.9634795324299175,-5.613371470478463,-4.453525722150998,-6.016999141667454,-3.948691755143635,-3.7700692522913113,-4.282848145849367,-2.5110217899295963,-2.273422561194604,-3.2893972238764366,-3.072075460602916,-2.418585631110332,-3.2014687102855865,-2.904175376616044,-1.9182158348331644,-2.7030711970244288,-3.0470706271351884,-1.8617311287465512,-3.2664653075565644,-1.600321231959915,-3.1447351935976218,-1.6341217412056797,-1.369621082250277,-1.7693536503224159,-1.6242316078965235,-1.9298244870156989,-1.6208242711381062,-2.457257302482486,-2.0520807728233152,-1.7908779959812509,-1.789981338465735,-1.7686104744311832,-1.9688078203901767,-2.5154463440083346,-3.35429238919657,-3.483259542846591,-2.98848904638341,-3.8214958519340554,-1.612027498726131,-0.624476656353349,-1.252470482596294,-3.3762479164814465,-1.8826455568472875,-2.0317993148738407,0.7745465255344679,-0.7750052226138244,-0.025458928818649085,0.021626683614074604,0.8540809333047146,0.1919600879927823,-0.182092639204126,0.178494549340102,-4.35556280461578,-6.058544615078987,-6.465841907226829,-6.580916725337143,-5.3004913805332015,-5.763895965695927,-4.811148110593077,-3.160964313313771,-4.971355478832332,-6.173881650630654,-6.55784262911334,-6.715246347614053,-8.120211013944264,-6.233578070560418,-6.666444869881715,-5.7988483887914155,-6.7213414120543185,-7.7781234430008634,-7.882270524313535,-8.382240184882486,-8.443579416086221,-7.566964686004852,-8.201845500892642,-7.272607989382096,-6.483197604210579,-6.271386307515626,-7.350714875987685,-8.16233633698777,-7.00980271576787,-8.677468287955028,-6.724307351416534,-6.208803508980446,-5.312974910332572,-7.456255632788008,-8.393275623522255,-6.779385748056292,-8.350777167203029,-7.1895605444048565,-6.449250182134733,-7.2896852168084845,-6.446007607472774,-7.584066964386097,-6.957474372518609,-8.361139362718584,-7.929289655562417,-6.239629595092739,-6.293559482528743,-5.860537647434878,-6.3130832089956685,-5.240266940673991,-5.715257519275235,-7.63044547500347,-5.600475457670852,-6.808732411357811,-6.279542608654045,-6.464502083526363,-5.506190583254072,-5.41444565132236,-5.525274381543921,-6.025461730974392,-6.5756179184129095,-6.125118511828246,-6.258613458084451,-3.9093841506956237,-6.678987192328471,-7.395854579014922,-6.505350417668641,-6.8649676782719204,-7.395257429475406,-8.005224571915832,-7.375967703187548,-5.922024093880406,-7.500958843606073,-7.969504294868064,-7.229769737419788,-7.232119711388065,-7.671125718338476,-7.691240363665794,-6.585992308769987,-5.851962765545621,-7.410148225980228,-6.982427372489129,-8.565461205653563,-6.945733100797854,-6.987404405284884,-7.950543264178651,-7.127274319596839,-7.8170248233723365,-7.22790064245039,-7.781286173592123,-6.807888949020478,-8.389758431207175,-7.209107734218978,-8.773340326771168,-6.433995562346034,-7.342094382668144,-6.241550049828299,-7.614351842145398,-7.340588863472724,-7.2376754446433305,-8.60088756319815,-8.012959734003813,-6.8840878039417674,-7.884806634707492,-6.678833899863948,-8.204512285605155,-7.726268370461974,-7.236926217906271,-7.306204087784901,-6.870713246293014,-8.6518443174128,-7.965762677510811,-7.086891395829441,-7.72783467358433,-6.600351171531342,-7.494634697921348,-8.187307100048528,-7.585419162706887,-6.820923027698502,-6.564042168375966,-7.347996185606328,-7.294281140553169,-7.161784439399569,-7.2726008582325745,-6.82001388474179,-6.964528648365649,-6.874474530363392,-6.682165491734476,-12.65847447727897,-11.160251281744541,-11.623762978679325,-11.227962685520582,-12.582831250281002,-11.008457283316181,-11.137852399935964,-12.041881353057336,-12.543721617618354,-12.62527171548512,-13.012573229424946,-12.70806004034213,-13.148015513234586,-12.15781545543393,-12.441869160446997,-12.544367449891288,-11.112485584724878,-12.03295713308045,-13.012725365840732,-12.339060027086832,-12.047857078735936,-12.990400423657524,-11.75924300775739,-11.97153778934094,-10.617154330032786,-12.507017610412612,-12.125791976740839,-11.94610620243866,-11.722687410916189,-11.138543884927294,-12.346755333090284,-12.421176112088594,-10.824150642672882,-12.433908737890413,-12.16893323473474,-10.253266347916764,-11.492201812017674,-11.447971150867964,-11.917947038648453,-11.17524399999436,-10.19878625787442,-10.103941758728407,-10.595192745147015,-10.512148053705038,-11.431028962819196,-11.115802615387278,-12.005109734550285,-10.479224893460811,-10.771117459938244,-12.054136982078877,-10.301472323156888,-11.146608858292842,-11.937224656425972,-10.976085162611419,-10.635061300530813,-10.287773554282708,-11.465801161664574,-11.009663743336205,-11.947659890717723,-12.202437202610954,-12.528087435185178,-11.723973440459057,-10.98188425588355,-10.238826215315536,-21.16883243053598,-22.140634241064713,-22.43625470265912,-22.439315041029456,-22.46321692902838,-23.18523387691548,-23.392917174321298,-22.73950708988017,-20.661230059578457,-20.980268529434174,-22.1882823254905,-23.22468894351904,-22.58243060680379,-23.470146619719152,-22.030810523801215,-22.232308233370453,-21.10483895971003,-22.140166208072824,-21.87788892691924,-23.21996081802033,-23.345856226466868,-24.02801828327694,-23.430742785332,-23.572714223764855,-21.862650986940274,-21.09338309268346,-21.81090600707269,-21.99991815484676,-22.99430257467399,-21.871577967796064,-21.673950727896088,-22.39984937838504,-21.46786321135777,-21.45726029966003,-21.32145664905354,-22.31980903699259,-22.39596932342095,-21.358357690861578,-22.223720103344004,-22.153065110812513,-20.80890455175787,-21.493976873084,-21.78945363732299,-22.8400137182992,-21.92662180427918,-21.979514607398535,-23.056115771467148,-22.29633794734738,-20.446794032862353,-21.582742862937778,-22.46362626935498,-22.179471147514978,-22.333356425449317,-22.09483513469302,-21.11824706690359,-20.858458990511632,-21.87011428269501,-21.934312640280627,-22.262613094675604,-22.788902191943304,-21.92765540035251,-20.573927242388187,-21.140743609296564,-20.550675329638224,1.6738911398533938,0.12715578500349972,1.186093749577123,1.6804831368821154,-0.33740683286986684,-0.7436275631061379,-1.0883422271442826,-0.774606013308594,-0.20160506000840075,-0.047896383498769075,0.2519739054796056,0.6335946950202059,-1.5735897250989177,-1.8995853490562757,-0.5769758766159995,0.47128910775411287,0.3475380611142274,-0.1991971253960618,-0.7843323197499661,-0.5922486078785257,-1.2032769780850372,-1.282799867404111,-1.6328422262929008,-1.0687833392070558,0.2920457721537718,0.6466770717618977,0.21216142020785633,-0.6500716684146708,-0.7774632995497616,-0.5373372723959945,-0.49386903004734917,0.44907377779443347,-0.8133322313038297,0.23876162954397007,-1.2219020212654015,0.531222945297216,-0.6636498586576574,-0.2600350442842098,0.32268217880009614,1.109157630640668,-0.13779164973150573,0.94884943756066,-0.5478294616489556,-0.018721298117918596,0.42015133779703123,0.49932550061637154,-1.1881476212242508,1.546850700236654,-0.8185037506078947,0.21304237138662552,-0.8483837784156761,0.7494805292670254,1.2770941067942327,0.3824208149321903,-0.2810202944882358,-0.6960655292966786,0.9393950839603356,0.901405228934242,0.8038522361454591,0.8477493293588866,-0.6024713793266181,0.45686098984805606,-0.2998015424345368,0.03321591622701241,-0.3686242001633042,-0.22745638083675823,-0.4858995787934308,-0.7498531312139827,0.42427917524829617,-0.6870575563365855,0.1652536498440882,0.46847940130845434,1.153148675437613,0.9665305529559537,1.4399496525280158,0.8843168326260109,2.3675185748448913,2.3290839927399363,2.116745349237269,0.5532780881712288,1.5304259576570511,2.333759063905865,2.246631934649518,1.594901643849674,1.7090513613253615,1.5852838627002306,2.0401812029125335,1.7722798479065487,2.673975850483733,1.713678584610369,1.8147941565263275,3.1370411987819153,2.142572219319341,1.516362010578092,2.257238883993996,1.8896010942232073,1.8010133548000395,3.1494432843589846,1.955181514885065,1.9498085955726259,2.7429730415406866,1.2372869228895416,3.1225182756134595,1.964202470624861,3.1133415436484917,3.6297960159089673,3.770552371666284,3.5338589363963795,3.1422919923905996,3.882177729422789,3.835250228048556,3.7806591202480986,6.2905694578330555,6.448571333004699,4.964484748913336,5.3371757953609205,4.614348248407929,3.6723184438015553,3.845831560814331,3.9979362398129896,0.6628541591650237,0.4853771828211486,-0.740006853128071,0.6362460386860582,0.38355356565362264,0.7230791420629639,-0.05301759705211628,0.35892463502408845,5.5259005865705735,5.680664364659731,5.076021427371831,5.212683364667451,6.784767536761445,5.084368567611785,5.96642470407281,4.55700275092152,6.056184090114341,6.4357134875551845,6.032283611340504,6.959950857228238,7.007971793592998,6.633330304953036,6.69323269111836,5.536278576546645,5.148984854625267,6.437327948261076,7.775252751971518,6.87948145398182,7.413986732584616,7.096066504840435,7.806007974717651,7.042639385145181,7.161422763760388,7.662011545680733,7.966235334815164,8.210103490455094,6.780247890485712,6.747753397573403,7.591320846010708,6.1239149156507695,5.728409013716209,7.768760724282607,7.2478162149830725,7.68243785863898,8.06559673212072,9.029581895700819,7.819164553159816,7.321831840587284,6.453968153440082,8.278677239782214,6.935378357999483,7.035211830643914,7.768123756683244,8.174584438747257,7.490002140001718,6.629770166708006,6.380515474360955,7.009929117608891,6.787176237358793,7.738323325320166,6.6510025969137745,6.549420807348908,5.696709929131579,6.147049573686314,4.221660608947698,5.111175769232855,6.9537152951432395,6.405213036117519,5.56673359815939,6.57990179066972,5.397705340015593,5.67426649366613,5.188091410840374,7.600389339123421,5.531203999489544,6.663404580085986,6.687654433561084,5.793407460358051,6.732876804367695,7.579081237099283,6.8291898754813145,7.637850450394337,7.146149428798971,8.267344800677435,7.65231243681297,7.461779505970228,7.6572892363869105,7.063722937630958,6.7293257490544605,7.3073992903303,7.469910956644438,8.2084138873498,7.640393861070347,7.31500016549796,6.582683104618301,7.649028827803289,6.855240518400203,7.7916752773870845,7.205779630016227,8.159252306520411,7.1468122960502525,7.69865401295989,7.9029405119213845,8.041746735521848,6.815566302538346,7.039479207653234,7.2687232597463565,7.957121752667431,7.714479234550486,7.311193795795842,7.433969264600343,6.847101436188854,6.31496754870001,8.531082323468974,8.216934820922983,8.22705530688691,7.6369056372587405,7.64602759958381,7.619598946972127,7.3723662976021105,8.0278120283652,7.404148957913509,7.190602079383712,5.85158501899481,6.323537791492297,7.53324844724384,6.8764982524271066,6.808422164877606,7.168059068042775,7.710381667891602,6.5896537976869425,7.177622583796397,6.98446872261156,7.264531293991848,6.341135336724308,7.743783947293888,11.432596770423428,11.05291454748016,11.336724328055327,11.90209701916971,11.743927218539113,11.357271838429067,10.712690588114333,11.319376983727087,11.24258846137638,10.78477317720159,10.471623631163116,11.267048544116017,10.332133075421591,10.760047806405924,10.952883614432398,9.710641450908744,10.561297574238411,11.457293638149618,11.888256999881529,10.875824693023985,10.556016625978938,11.381382039721474,11.12013252870775,10.712358984665899,11.265994066800458,11.433754716417669,11.411714878509244,10.991393634701442,10.653359791252937,11.847008168878359,10.563348420977018,11.25022174815456,12.273857539003544,11.120565393377829,11.72698922939026,12.084497503080057,11.666729501053126,11.741640028672082,10.856938579531324,11.136103937059385,11.710504203957557,12.228467830044018,12.292924042614242,12.110178125858141,10.760882926708149,12.92869127211212,12.104001275924812,11.060616421578576,12.10595689476366,12.032876791691654,12.800926999782288,11.617935906026037,12.43195350138583,12.312698647800557,11.40286883320953,11.086028651812304,12.869694482877728,11.944788786523429,12.04372702577083,12.570538934100286,12.34874489215073,12.20010853524308,11.80285382223482,12.175426850615802,22.543458783452905,20.4121459530758,21.500985617532017,22.439072688894793,20.93262464898311,21.11534746202993,21.633420354262622,21.39503675538019,20.581493668013056,21.852448287344867,21.802557732786056,22.062853458471192,22.13991534900114,22.9892127941183,21.382991645416976,21.933101971424612,22.35432360669585,21.72852119933391,22.86413559054056,21.741477599690313,23.202207284715346,22.772760870541386,21.939774385966867,22.041645441261124,22.15292967983594,21.662932243113072,21.549313342713567,23.1271504807297,23.090553529912196,23.04502410375279,21.907019434252895,21.88682892447187,20.517376508275138,21.692969370832866,22.16343942656985,22.43495962047975,22.350922972026165,22.37360373583152,21.601495144738976,22.009351982650934,22.094269098315472,21.190540386825997,23.054683961755536,22.635504776409174,22.496492823576023,22.150323246343156,23.947858618293655,22.76293165960214,22.431974735507104,22.186703834139443,22.14421736437464,21.60179389121206,21.630550440564406,23.27492198976013,23.557296755060573,22.1542195542256,22.023005361459727,21.374977934420237,22.2343267946537,21.995477204276042,21.704006297365908,21.715209440379027,22.804284150328563,22.156267321291892,-1.6548598734874693,0.24780882297897594,-0.7814260597536945,-1.4166099764320306,-1.228960877993734,-1.0140252434627641,0.15377720015010715,-1.1583274628892148,0.2218684036349727,-0.7647522354667029,-1.1349904842864205,0.2864926396824166,0.9251679387289561,0.6670883407679296,0.4714959144297655,-0.23298273681375062,-1.247901755249155,-0.19114729048536738,0.08010584913088782,0.06162885154354395,0.127823211664343,0.7428034017598869,0.44062240438423195,-0.32671492470328395,-0.6493231219669203,0.02168359808757742,0.8938102110800893,0.2908074314356401,1.204061026376792,0.19395337897060294,-0.3554283001130829,-0.35281519339435724,-0.5759253621982897,-0.3868106787411112,-0.22246336608909617,-0.22224825219501992,-0.4463747705095654,-0.19417234617383364,0.11917286511872521,-0.7341079363604122,-0.32660822954804763,0.17881225291482178,1.2866283203598057,-0.2703978556616743,0.6113065299629054,1.4220023008163514,2.0850504586047784,0.0018722238272154304,0.8391678932634885,-0.2481824462417822,-0.5047835410014377,-0.20853685501844113,-0.472851110524176,0.795744172131057,0.5320267914141643,0.2672399772211599,-2.350962477073071,-0.7857965835349684,0.5622995286810875,-1.9590317925356588,-0.5553992618557118,-0.39129149458970547,0.09818208497827441,0.7528290471798106];
  this.h1[3].weights = [-0.9187289124946516,-0.40695673792802056,0.9898261420803403,-0.8108044439664219,0.0903979363767422,-0.9589270140129522,-0.3901804081501852,0.9212209569732916,8.454637928155474,7.503719667170872,6.272226528042288,5.807688253628982,6.646116643771055,6.028473706179199,7.283898385308862,6.50035567369018,4.808207418879337,4.453250757821806,4.9168238520918575,4.573677730160187,5.190570292209221,5.621135651707709,5.216530393349431,5.325443354242838,4.214001028863086,3.6653784480212273,3.2502905689117285,3.075030249520401,3.3490416062138224,3.5494617725083333,4.247450587301994,3.0692809009015245,2.948790708713191,3.9077026426849595,3.2421624545612775,3.12969056205581,3.095052439709687,2.3222477875295606,3.6293783044788652,2.4345234194994063,2.349701435024003,2.7997898443302516,3.3239657147736126,3.464340491054528,2.6586243257716347,3.7339096042567,3.087222534150304,2.9167585514051027,3.134944865555777,3.2413144500232542,2.2895165673818636,1.693641509844242,2.386169059488637,2.821808207429039,4.683303663566719,1.8685117770784554,-0.20160804666248477,0.42267533570334104,0.46768723052367234,-0.32024661193561466,0.6892855660041795,-0.22638942651510296,0.3385384235673152,0.08813149024742684,6.405510393393795,7.71236615941122,8.580191884120563,8.93846718779977,9.345918226686349,7.817874092955395,8.675401618763102,5.548970379214381,7.783850658577901,8.714265796960268,9.142641460284691,9.261991478544067,9.387337923267268,9.515323737124913,8.959848563256275,8.518818685291068,7.581133805839283,9.844250272363158,10.657865710241756,10.442919888472103,11.503000150015508,11.546048685329533,11.197621642581533,9.538105675633211,8.337942103728064,9.651104764960879,10.88374585214616,10.94532927428035,10.018504414108277,11.451583842099838,9.344448463563351,10.102886348697785,7.6961446084302585,10.125539593950029,10.391814451528568,9.520779601596427,10.241944906487992,10.383381251163902,9.70829265941365,9.619112804784104,7.567069439084566,8.28319664971538,8.398775540803722,9.519494243560144,9.2636066798721,9.402986874860689,8.414728415615139,7.5054259222887465,8.457884076564657,7.694144723809187,9.018308006548606,9.50883669557419,8.826109192411524,8.90874781959082,8.151864228019486,7.166479543568441,5.436471400501866,8.776620747887987,7.086007996687992,8.589896556610016,7.972384889875337,7.48194192318024,7.376147086686936,7.260043378585699,10.03704181387079,8.631477500354048,8.9229646405538,9.39994368305809,9.996603061312033,10.745625576880544,8.407609069140326,9.725345852157558,9.060077837957728,10.018688043032235,10.153956414291185,9.592723467436787,10.513244868194493,10.229480737485833,11.335891706553804,9.099785136856985,9.908256967300915,10.347981090705943,10.064880669955697,10.929592642753331,10.379062213562182,11.617446724653261,10.72187395881047,9.717121754270892,9.046553051709285,10.411855113912877,10.62768154615436,11.304966403890708,10.914981308643286,11.670300023209125,10.953491844666674,10.957548569155017,10.327588243678253,11.222057047908944,9.479814663082934,10.78704149110343,11.301544080356498,10.696025427243901,10.315691536566497,10.163000620780306,10.007556406262463,9.949744505148407,10.567535726028694,10.966954684967924,10.526971599809233,11.408866146945183,10.087198367251917,10.463773216408496,10.215375596409196,9.909999819584632,11.005948181036686,9.354480391712386,9.328319809568614,10.159276125682277,10.398536920896506,8.622680518155255,7.91745249183613,10.378107369346077,9.74415449789209,10.512338236904071,9.848302663587827,8.881883457708218,9.134660234783567,9.200795814463447,16.5205006984234,16.63462026846593,17.327730286258323,16.595916378822203,17.654606307581982,16.669304703691378,15.962997075255094,16.900218104127603,16.40984688870697,16.700804523263027,17.593656381069678,17.692935800650456,17.387090709489122,16.561438284704238,16.417674804404406,16.971630285648402,15.605074119462357,16.150423510614864,16.126405352727353,16.650242486566416,15.825790455634442,17.153316942657028,16.627908293304625,16.155340406754007,16.296087087598522,16.27448328004778,16.9585458862866,15.733100061839968,16.515725327059364,15.86907560689527,16.007170754423594,15.437944875386318,15.59313445584801,14.92427675369259,15.54314949549928,16.06951014321869,16.069502500310186,16.167839009448794,15.494990611942425,15.572818028735632,15.08549437384322,15.47744258112304,15.47564070821714,15.592002868225237,15.473565522164336,14.71689735968457,15.8518865716845,14.622970820546481,14.503972519794573,15.664732413541776,15.312045262323787,14.602010431764274,14.788482210066308,14.516817922041719,16.18606920152513,15.048027183114936,14.697176506150175,15.633627007334711,16.027957534991888,15.309653875658546,15.619438591388235,15.178127768840044,14.367261363579399,13.976247023281015,30.174617331391094,31.169765169766237,30.68487628335403,32.06248264571481,32.49691857534197,32.057336167086106,30.986877617005185,31.389162526136854,29.14057347352274,30.76333880750005,31.105928026079358,31.910365353733614,31.307218421408994,31.36165921285703,32.50048729839366,30.97206284833408,30.239074830387594,30.15195338906556,30.98036616453464,30.646150146384496,31.470234824671266,32.25537311694366,30.88643407857287,30.800043404199762,29.029091363784385,29.728098143347115,30.774963934627046,30.227430775972245,32.02816564450576,31.1501370630951,31.478692746430834,30.744076147977744,29.379260635700984,29.77251226060521,29.68981879236267,31.47504615974623,30.563480680040065,30.10582009827829,30.235166430253205,30.371017459822724,28.673754390699152,30.23092667251013,30.167562431637368,30.52999144208088,29.994361467771473,30.3039268247897,29.880243962091672,30.95647206566126,29.475809582601684,29.83235590431526,29.897591748650715,28.870520839187392,29.68483475542704,29.67455699545801,29.62089639377083,30.599932332858568,29.077472736350362,29.5582557585893,29.328033699923175,29.346828598080442,29.033539641580102,28.402854833159306,28.71618184974973,28.291943988743174,-2.3264504295884327,-0.292311332542689,0.07317898931548755,-0.44743804240795415,-0.006819923018327676,0.4525495820854633,-0.005122544370164647,0.03977648623842673,0.5756586409318875,0.7523236498794502,-0.06218686722482523,0.13932490533490974,0.7325442531716041,1.3848666312081404,1.1404946879946083,0.6504035171455083,0.42875658773726993,0.9524134118032475,0.2779623354460188,0.9151350943833452,1.5072258246094694,1.169083722933678,2.088610019145881,0.10867124526983908,0.20629007787102352,1.1741961232274503,0.5806774232621387,1.200926774767426,0.8438154862497188,0.6075348996638213,1.014798212697844,-0.046198272465660016,-1.2397026481157396,0.004219533063188218,0.672444460563074,0.07654432458730585,0.47099834336678575,0.43368574014734806,-0.28207051914621994,-1.074533976008004,-1.3159654232756717,-0.18012117983846526,0.415033587886199,-0.39409509229188994,0.6225944475999102,0.05660901242363733,-0.5661864586836143,-1.0007240290442423,0.3868998391940231,-0.6132724919662776,-0.30386856295415987,-0.9992644798970725,-0.3365467589668102,0.062010409951353956,0.9115538766246514,-1.0115646615079568,-1.6678950424703665,0.10911012922434077,-0.38881577975984927,-1.2874133751040786,-1.3376912393326152,-1.7945916441735905,0.40576778945733105,-1.0886413003647275,0.5392067754774472,0.07869359558381728,-0.915770942468145,0.3247738269013358,-0.6344879739208942,-0.6074643829854054,0.23089063305222624,0.6102350667904561,-2.6464716878199925,-2.929474142441135,-2.845216400109616,-1.5008571194052005,-2.5173089284480668,-4.021206635663726,-4.28448711464584,-3.2098460351589373,-3.716371737764524,-2.2565261390001035,-2.521975358731035,-3.1002729327862815,-2.5092990014127046,-2.7357105232542325,-3.128834847778556,-2.978261488172018,-3.2887274300342084,-2.7744931940419457,-3.4678163828808257,-3.186327611533359,-3.404158280491946,-3.156745431299398,-2.484108725744606,-2.713291951948748,-3.7410030303823216,-4.548134057540203,-3.877568193024833,-3.4708641151194013,-3.306082550023402,-3.4646225473619388,-4.084703029201117,-3.4339534592960157,-5.452809535561547,-6.021026857906958,-5.657535440961312,-4.127609454982896,-4.757505692686974,-4.856379767149592,-5.570719631615693,-4.547611012994763,-8.01510888924159,-7.534410082757394,-6.835498467320629,-6.64958952994464,-6.2782328444648146,-5.735463009889274,-7.3976515188242,-6.808624676956698,-0.9979349000481452,0.9026330570392584,0.18491587450982117,0.8055924207428276,0.06929277666620726,0.33813471022942165,0.14118974054865374,0.44028985598574444,-6.822936183200649,-7.515637828503504,-7.818377066287323,-7.719054645637172,-7.608906134603315,-7.8628098585611195,-7.391757454363893,-6.731276496150483,-6.812667335178764,-7.348539926393868,-8.738902190225701,-8.063276036517934,-8.178316351415516,-8.603152254150999,-7.9381583154955155,-7.537160002001081,-8.20928012434626,-8.757449455588025,-9.667982645903031,-9.662269868417198,-9.800492135734325,-10.362761711124977,-10.179312855626236,-7.718147139058588,-8.596566600083195,-8.59152577659565,-9.62123785131113,-9.777471419504003,-9.437137546094489,-10.21704954585507,-10.4037172649655,-9.339800988897935,-8.347375432675515,-10.513431827664112,-9.935880710052297,-12.187900828107109,-11.10808680370408,-11.528801196658954,-10.657752426326962,-9.858201626438051,-7.939311037011147,-10.667607350627229,-10.940559218272568,-11.643527889879818,-11.720813685315102,-10.632111048445022,-10.534636348645199,-8.658979047180061,-7.5417735488323485,-8.463900893255406,-9.864342852081279,-9.860129781454429,-9.603966962690514,-9.193043532189128,-8.457906923879731,-7.790206721599783,-5.009397621888149,-7.108246838060379,-8.30629864716767,-8.190085804764747,-8.396777398831741,-7.6531579818382545,-7.323819382826938,-6.001728836084794,-9.000856507920664,-9.893366391351483,-9.189652162952974,-8.855345007193312,-9.965645018373621,-9.054082339480056,-9.550958510018285,-8.418549590449272,-10.265049766397777,-10.3783821004487,-10.66888358798676,-10.295967752767728,-11.233907860527008,-9.940670407322518,-11.097713700542526,-9.55229182029623,-9.73109608734979,-9.814475627927143,-11.083514885256633,-10.861297669055785,-9.756764590764819,-10.737570564716902,-10.939410024235032,-10.480817430490807,-9.619643845173458,-9.945628211622417,-10.841634317071845,-11.460199017749884,-10.940447313602299,-10.127839908172504,-9.343092065446415,-10.99684072277557,-10.864829306596395,-9.131774505807035,-11.209747336441533,-11.80411831686625,-10.551968725235776,-10.866992128586622,-10.761591053756437,-9.457677338218996,-9.667220753883942,-10.135578678020039,-11.006173432418178,-10.922865567363706,-10.347788573690057,-12.099002346167401,-11.214040423580649,-8.877130582754978,-8.802375400801353,-10.592706403420882,-10.602545447906698,-10.25534485365265,-10.688455313237542,-11.026448151032692,-11.627215571732473,-9.559321390123873,-9.343419647776628,-8.897852405144862,-9.081881025265856,-9.99252335251622,-10.709585554920498,-10.042407794370076,-9.462527999093911,-9.021583195907676,-14.418238613857305,-15.447195853842773,-15.882805469816432,-16.38807205215624,-15.020810449672739,-15.436290248001914,-15.456468101144472,-14.09117434369483,-13.96184577115038,-15.029057218960487,-15.179388954457552,-15.32874935535723,-15.601375872197597,-15.699829919523465,-15.465116437072664,-14.708681999266817,-15.099142995377578,-15.328362292627995,-15.173850103837832,-15.162309080661863,-15.364192629948453,-15.284320747801285,-16.333142712848826,-14.191340092100035,-15.792473789382054,-16.16012000096267,-15.032729588566081,-16.030308309957093,-15.028710957252665,-15.626406863397944,-15.253128029390972,-15.154525290163498,-15.400212821748623,-16.55129133938262,-17.07468441903723,-16.683155501925672,-16.630988123952278,-17.379235954822356,-15.699393317788093,-15.970590292726836,-15.518696004401987,-16.747773641670985,-17.022776810395342,-16.60767718557999,-16.575391709077977,-16.18750716777688,-16.601297048766536,-16.483569382660075,-16.634384139741144,-17.515781259092186,-17.911769898387668,-17.040787883792394,-16.783666622596048,-17.17931059570454,-15.895701251378384,-16.80896298232876,-16.25092052891976,-16.084525939804543,-16.139637700568958,-18.028567291822498,-16.73094076681392,-16.976757019498624,-16.22881142559675,-15.523123751796591,-29.63629252391262,-28.856396669356254,-29.428947498693827,-29.9259723836334,-29.513790652658198,-28.178586740350998,-28.29242966278881,-27.40131365684062,-29.477709397090724,-28.747904228655337,-31.110371091254265,-29.992216799108604,-30.23111633808321,-30.55367984060372,-29.09280283547005,-30.191321086627113,-29.011890645855587,-30.002880328005347,-30.49381116029459,-29.07868191092493,-29.97962915343877,-29.627516456823038,-29.989159813062688,-29.884271211772838,-28.766301863410593,-29.72113519890562,-29.27281032836585,-31.500652474932703,-31.120458544139126,-29.874643464983325,-30.78175183674158,-30.287310754860652,-29.01280197671966,-29.219698600430135,-30.665218371453147,-31.42297904222628,-31.593976879037655,-31.523656943168564,-31.209012820003593,-30.697160727290658,-29.611872711590753,-28.988614539986326,-31.237314367948148,-30.339903022937666,-32.64190207657587,-31.39866915122026,-31.313222571518963,-31.774119971774493,-28.788043893559855,-29.995686617513936,-31.020412448697098,-31.890031277774494,-31.25350292970774,-30.85162748201258,-31.286729141167807,-31.939638835126534,-29.805580562273004,-30.46143755859777,-31.720344765223647,-30.832226039143304,-31.78105801071535,-32.24744707181805,-30.9279576022046,-31.007543203218777,1.5126126175903445,0.2087231121019408,0.8994096890728422,1.6499299138454133,1.1389612058417535,0.7168377724477403,-0.9598026217654677,-0.1302604192076825,0.44037183469600577,0.015904158653942683,-0.14143102272860697,0.575524683485054,0.28282644326305095,0.2202691018627708,-0.18965499105391478,-0.39298311222344484,-0.17244013171738445,-0.11870202246384162,-0.3228950391026477,-0.7733025364652394,-0.07942945519637738,-0.6528209479419526,-0.0985125470073806,0.17198943817112158,1.468159463545172,-1.0683120211244912,-1.0528020502745898,-0.6220459877311946,-0.11433488051861798,-1.3365399465015324,0.19911876458213418,0.8425521173651349,0.5689782578611653,-0.3602881270815538,-1.0460769898440083,-0.9566444885614915,-0.81972805521529,-1.7013845472142166,-0.5155141831504004,-0.5389684278632044,-0.48291025666515563,-0.5525129659943652,0.1130956054307799,-0.77958591710887,-0.9576809148277936,-2.190251934135204,-1.836055447190437,-0.7472651912944108,-0.9311842194897536,-0.9686851812192341,-0.9836933304436377,-0.17350708829572692,-1.466445668675164,-1.5183256455503693,-0.5017904360733969,0.31121326725902576,2.1267154412160174,0.32706401788587497,0.9317720177989947,0.38403174625698167,1.4544392174723284,0.03848717165789929,-0.27948545448438356,0.46447963078177484];
  this.h1[4].weights = [0.8566460848433595,0.837998234997055,0.08406270682281747,-0.057749963269067894,-0.3128131277155246,0.8773193053419188,-0.8950448829519608,0.459796018891935,-6.879370755090387,-7.751702559053261,-7.261255508895954,-6.143878804517703,-7.503290467975526,-7.456823214065447,-6.417146750635138,-6.21368178722527,-3.8936884579599296,-4.143877051417921,-5.163686167319319,-4.8732782332642035,-5.244821547664328,-4.272631150688308,-4.5488440856272545,-4.73599489915762,-3.197370182431252,-3.4559376019055668,-2.825444709941525,-3.275019226465259,-4.581556678373505,-2.777327854540426,-2.2484434713280748,-3.139648182345836,-3.8367346356688006,-3.1896504572456004,-2.5344581424003487,-4.513005328623571,-2.818362296072144,-2.7584091545730987,-3.4790532681636717,-2.3447730331480257,-2.317960196478717,-3.4935803289145366,-2.325588317552764,-2.482206165352804,-3.4309078428935598,-2.5085117661982608,-3.4515618633748297,-2.7298997603410076,-2.132602796512163,-4.6584255771936025,-3.0598599249691594,-0.4146696071647004,-1.802128354315298,-2.90093079400158,-3.324428317907359,-2.61023582469796,0.12062692598125979,0.8589565215467676,0.25196045894322383,0.7502881714431684,0.8399323632894999,0.7907519179744917,0.4197208239232082,0.7491642380283543,-4.9670429965965415,-7.309619263687911,-9.71896026504374,-7.358183081873623,-8.280977333429117,-7.119339374290945,-6.608369417650701,-4.534431221279035,-6.674398029627991,-6.1768757193688515,-9.117669928884846,-10.09199525998632,-8.66875320680228,-8.481012952537348,-6.722447594228411,-6.945235902960614,-8.100750240641215,-10.35782029713537,-10.421687483888125,-10.039944910926058,-8.828449969756148,-9.811860380406932,-9.393641316684533,-8.01370458791293,-7.519896490332246,-8.623789481430942,-9.627931760982959,-10.492538038338278,-10.051329962021887,-9.94296819312578,-9.942673109579411,-7.9277242129089815,-7.10014017930823,-8.368399186845283,-8.280639591377984,-9.318344946207215,-10.775061124704868,-9.31160429777681,-8.119683884405196,-7.17807103388527,-6.547603993866375,-7.369786609549548,-8.600576300070916,-10.0796123167028,-9.410301957518305,-9.050108374110483,-8.385129947735088,-8.188746277516552,-6.380261469258337,-5.772970884275893,-8.138163416975155,-7.8601935281506,-7.955694117715992,-7.740869993362669,-6.838665761253947,-7.004733559471833,-5.274434638074519,-8.149657616121946,-6.044615048337401,-6.598767295627893,-6.76185002824033,-6.719892580706978,-6.708285196625049,-5.765885849539386,-7.812353569165119,-8.607649658280982,-9.136320905560511,-8.00769106286724,-8.274272409405977,-9.16961691426023,-9.361244862214196,-7.757105733291862,-7.962088537729394,-9.689999619406567,-8.300437662560968,-9.612490594376961,-8.724088935859237,-9.14512760472168,-9.765943713551163,-8.252541736296402,-8.551648044401633,-10.080205160112497,-9.739532473048673,-8.879532842175998,-9.43068580021488,-10.193799373665348,-10.937411244470654,-8.73909706544282,-8.948791151985256,-9.66204626991199,-9.651730743235571,-10.457353440320167,-10.436608257133042,-10.826466822728888,-10.309386427670056,-8.83129866496861,-9.449249811811514,-8.647052256586052,-9.781901925522298,-10.807816303298434,-9.280803759678083,-9.180112271314087,-9.888391301178709,-8.408296000648045,-7.932179795686873,-9.931237293223171,-9.649629197793,-10.740091017674146,-9.300606518353453,-10.643975328561568,-10.190022485656982,-9.300808598309757,-9.292030960877284,-8.53307863898475,-8.838000486343779,-8.688536801212985,-10.21603868528291,-9.167508911827042,-9.672529472599537,-8.436174890431689,-8.89493390854102,-9.652854343664153,-9.403895345515238,-8.338663370501346,-7.731336731752547,-7.38968536639178,-8.499488504842384,-7.394121183105796,-15.522426313270905,-15.417134816775643,-14.142073756868568,-16.14781953824287,-15.933317303565062,-14.611772429184057,-13.963578912882861,-15.924488620111001,-15.958221395351472,-14.912805903736288,-15.019633598162716,-15.120104039759287,-15.164086650768176,-16.176617834120155,-15.99607104233444,-15.718275292933573,-14.242722043093506,-16.05937813932924,-14.720967295253676,-14.377062428079991,-14.49003913671954,-14.537266884595105,-15.503311144006139,-14.223508338236886,-15.851977220235327,-13.09439972818067,-15.536037066712511,-14.298893472317443,-15.807721642042535,-14.997442299047007,-14.52343247014164,-14.253037263418163,-14.281927458744494,-14.96830528389042,-13.90235412924034,-13.05858680903231,-14.884924781931918,-13.843564954089729,-14.291200883727678,-12.899882373832975,-12.201010589303342,-13.871339697145455,-13.629534293947396,-13.293098388637274,-13.821221684342046,-14.630038829283434,-13.082429669955316,-13.83730574471414,-13.265171586552212,-14.441294937639954,-13.124580116487115,-14.332688961106609,-15.137336188090453,-14.47051838416403,-13.617790213773734,-12.948993837958485,-13.689747922621052,-14.879337528196098,-14.320448630458571,-14.859188627617593,-14.453528484758634,-15.791156052728724,-13.644182126362455,-13.90324221292536,-25.204399373569952,-26.016596032430773,-26.95910559668344,-27.574694882181344,-28.89875383107527,-27.886496718281887,-27.693950820985755,-27.966786535242274,-26.092093202739537,-26.003990719705204,-27.019660453656726,-29.30683042644457,-28.87030450527326,-28.14134366945631,-28.32058568760956,-28.920514009602346,-25.817210549324024,-27.174045547496355,-27.981235269772952,-27.718209411891362,-27.696695995268342,-28.531300877145323,-28.272848105291537,-28.556464246518317,-26.192334379421574,-25.43491970661465,-26.98748413810903,-28.78208794832757,-29.36953176312283,-28.65172997141365,-27.24909549994376,-27.631511026905947,-26.447668965470275,-26.325781061910423,-26.264989999789766,-27.940218547478874,-25.93771045849615,-26.22514667889474,-28.514575888942275,-27.168927629293787,-27.321849138147343,-27.81667201365828,-25.331943088403147,-27.644213269880346,-27.64402161971576,-26.044179712812156,-27.73232874800541,-26.666191671876962,-25.90664877870827,-27.28741664160257,-27.29439731411576,-26.630814412032038,-27.36203982115043,-27.5199566366085,-26.390609686309492,-26.969419784747185,-26.089207877418083,-26.11942884079645,-25.301672929840386,-27.533323144966502,-24.814892347017302,-26.182641638933504,-25.4243589346122,-25.424191116242838,2.2865559502526405,0.7797017884384595,-0.4173659611043223,1.8063748055682527,1.505588399987178,-0.4371041087735786,-0.9147926348770055,-0.17163886960934116,-0.5354493579414227,-1.1817691492340074,-0.9136852501881536,0.1375565262444184,-1.2527194523206528,-2.6771384069544815,-0.4528651147399899,-0.5342390526188978,-0.8090131127417206,-0.8351990954720053,0.2848234118081975,-1.6102568379134086,-0.3247838017094414,-2.0886543196147906,-1.7461711808748324,-0.4657392210773618,-0.4679539448298913,-0.18227699137002387,-1.327296594146986,-0.894536210426689,-2.3061163879219926,-2.4910572089889933,-0.23979295278086096,0.6569912746057099,1.287262576251181,0.9888946559392351,-0.1150642362299764,-0.36477018875380296,-1.0572361084865582,0.15127886093970067,-1.056410244840336,-0.08160505679127684,0.10535045011904719,1.422679836270903,0.8067090290865527,0.3164063938906426,-1.2565406199389182,-0.09268422213090861,0.23958322512993607,1.3474522717551551,0.8060965876556485,-0.5061104077233082,-0.23899271032747987,-0.5621513495267361,-0.23681858584817536,0.14817661433572232,-0.8860618070687932,0.2944051043152271,0.5073241878298783,-0.8242472714498119,0.8628564669442595,-0.46779805374691524,0.992983687986115,1.6825236172701987,-0.159067627647966,0.39687047574250567,-0.4661121818962983,-0.5699143629122458,-0.18713733990171244,0.272957084666011,0.42012226510755646,0.5091693011151945,0.9070869693012193,-0.8894519255793161,3.148318753174035,3.1355638227571547,3.350801806655189,1.2448004616250399,2.374481217850975,3.0663208098895853,3.105587087614539,2.488886606891925,1.936056941873544,2.4039873031961676,2.8782339262774372,2.07763966638516,2.440792031028714,1.869959229484284,3.433722820214828,1.620909861489115,2.5210028880456243,2.4923109386033655,1.596638191786966,3.1143600763049877,1.3699404340413595,2.7100334622283686,3.127273605019122,2.081176707408946,4.487834561755051,4.370997084635522,2.8222200961778974,2.506471683677428,2.9816101855079946,1.9294145311305422,3.5810405549916524,3.738195628497306,3.4861125550523155,4.6198812355436365,4.75802940345117,3.507313074166268,4.067449545381221,5.407213160434319,4.049391386893571,4.552742613715104,8.075306834553341,7.01384607321936,6.979916494273177,6.011696008001647,6.717685673505302,5.364765973418512,5.751631872409144,6.942934126426655,-0.7514523241052928,0.41972026232264303,0.5545583782463268,0.6103710507822333,-0.9868261726049083,-0.9284053382965407,-0.2602774294406993,-0.6865783933494636,5.6776457459073235,6.736784629841766,6.136513533581441,6.804032729534986,8.20038436723385,7.415227096958471,8.28179797435141,5.676963636852283,7.674284394726,6.537291778618279,7.346913344973888,7.987073422113767,7.234691053173275,7.433443275536844,8.654185532157827,6.359309380811359,6.024853419014607,7.501113156390702,8.634540864243961,8.631686441855281,8.351438570155105,8.570078484718225,7.819943248683443,7.600098377697392,6.91915195792001,7.960023914215479,9.675858742682786,8.478317703759677,8.442420993695643,8.859661549614747,9.413803541204278,7.299654047373712,8.284534146892234,8.322927020678238,8.945272905050254,10.217660330557619,10.3061102178448,10.587359673384082,8.483506305013234,9.56636847652116,6.9635129488647936,10.198779500655258,10.364494698757419,9.612042197051323,11.198215417153449,10.032567691600406,9.850121292621052,8.742083968202698,6.21528494912658,8.77535662836181,8.691919408407463,8.587518182377295,9.105852889382719,9.255427489179688,8.659524606438543,8.051088731746876,5.5349957451055065,6.826745864739878,8.364635826370744,7.891386757283603,8.434315492388453,7.322698550147592,5.379885338548045,5.514245744104611,7.9899943334396974,9.512243274791608,6.987599871323233,9.086218787813685,8.523476553609546,7.413158306529099,7.2440531559937,7.627050263732592,9.046867236452467,9.18096628779252,9.906148698223406,10.071728298718229,10.05434376839585,9.469395188081783,10.0017262316777,8.302457644967177,7.891084547037393,9.796903559207044,9.556894822322294,9.852577979147757,9.868592298840857,9.454699780762517,9.758684570469969,7.812457462258699,8.158479173121373,9.654301637243961,9.554819194710438,9.45886689905521,10.528147781943161,9.326726029561362,9.228928017716434,8.606761379964238,9.315009184958411,8.035792393446938,9.008415090466356,9.213039256509783,10.902276618746185,10.01668969651147,8.69525555187706,9.849566772098328,9.022562508832296,9.707517679439778,9.308904203758166,9.279670208036606,10.592883266953864,10.662101372784205,8.99593680763248,8.995258191389771,8.542506632089847,9.828191811487851,8.748293213809365,7.6433763117072395,9.411951058306864,9.181779056502378,9.825944190487089,7.898674304874911,7.8242945804877095,9.62493911019434,7.889696956242601,9.51420690796946,8.306188664178805,8.530198059060911,9.450431270422268,7.581175868272161,13.784829161769139,13.696577564785265,15.451758320594644,15.455742285311427,14.286611199555507,14.003029584392578,13.1368478666612,12.600638904811735,12.984013743313877,13.584232852130258,13.686551335586042,13.454814038380922,13.369334771054858,14.051162869735846,14.193887236164441,13.458409978778548,12.660818096732076,12.48507366421106,13.61674174743062,13.75284126297715,13.162433837103622,14.246146974162931,14.686886024190859,13.11029916688743,13.030768739314139,14.131041857390022,13.735718793878766,14.031636216305017,13.493838049806183,13.069775091503512,13.449403946047754,13.520209728930732,13.755082329661187,15.38995054710506,15.09728690058828,13.395365869817706,15.534789177826985,14.18587772323983,13.318572224074293,14.05111208034465,15.611574303215747,14.775966750688283,13.910552880115631,15.250076648285615,14.79214295504298,15.628369703477665,14.78955045863612,13.913917838260323,14.626623741638111,16.242212209651584,15.507843968795658,14.799211563246278,15.950582912919696,16.168603294522214,14.349150562985466,14.72714271479387,15.997749461340641,15.961989895043294,14.767274937028516,15.033829452023602,15.170261918936621,14.165553386345598,14.059516289908373,15.130202423923157,26.025698193709335,24.196044079878963,24.648932124356204,27.753630682015313,25.770665713264354,25.580338410599346,24.927095036157862,25.110221491674462,26.47676538352438,27.042457239365646,26.995772074431084,26.84761805920772,26.448236909680265,27.33218739904755,26.472565467419887,26.60109971306394,26.13745777064607,27.202234260534013,26.52080998517515,26.33264558950222,26.28967929563447,27.00399454270909,27.114548161136465,27.343570407148565,25.433464760433,25.89560789275595,27.130938748495947,28.051212977460768,26.491482905686183,27.5355168507296,27.523511529403926,27.27007679602751,26.367319635578777,26.513337459464154,26.37798588422265,28.13524132942727,28.3495583130606,27.856890808466034,26.581892162619354,26.768017935423053,26.28812706342327,26.603746713379074,27.262253491759232,27.832173260752874,28.97385412863868,28.382622050920773,29.21341101425292,28.10263092757705,26.908982391264214,25.72605735976468,26.25697249176742,27.796129371622794,27.832624583206343,27.159648775430945,29.000251009210455,27.297749065109002,25.60348392787286,26.35465921722852,27.84441556658653,28.023347526354218,28.471800585463818,28.01208142503725,27.842906266848082,28.278117763931427,-0.7271642694771718,-1.695396617729396,-1.9047609766838152,-0.8068912320025993,-1.4004442241412165,-2.0518904724102085,0.38181584306557087,-0.01462144826934096,-1.302392595251883,-0.6607002490797376,-1.4074073018088649,0.7159110079315792,-0.2559418793846744,0.637050873376493,-0.7318367659563377,0.10448332191733849,-1.0740242847818926,-0.5794295423449224,0.7612522811539598,0.6987576462631022,0.33841086798659936,0.6305784594405868,-0.1725121875969593,-1.264434494933201,-0.3194023774447382,0.6985273850464132,0.7264046077138467,-0.4839397565443072,0.8243062315841437,1.22105969354679,-0.9513329196107776,-1.0590619944729638,0.25672163239337115,0.5275306991683902,0.8651584058069888,1.4954632554958687,0.6708463561727145,0.94865869660788,-0.24925053127564012,0.09299839382668473,0.20251177707657525,0.8480819176911376,0.5590749643989072,1.3759120509947929,0.5390107008027905,1.1531680417744254,1.1188601322486924,0.7905813154436963,0.00898868289283237,1.0235086259111241,0.8088570135123911,0.668935785779729,0.8950795164146745,1.5429821696785646,0.07755585856820654,0.4908114068610493,-2.116317598243362,0.005011816618509462,0.11721863433712927,-0.8484825619255225,0.32714357068164857,0.02963290384432008,0.8497123866917786,-0.6267299983644675];
  this.h1[5].weights = [-0.6102581913237342,-0.5008460295465329,0.032207856042726135,-0.301391867394984,0.4035330850821399,0.47471507457531414,-0.5846230440707303,-0.5762606264717172,-5.938180936464772,-6.770307876816707,-5.6447707289959865,-6.766092189313731,-7.008075518871802,-7.322412160870394,-5.522769884485973,-6.193558438398212,-3.4143276560596987,-3.4191556082426495,-5.512095318949978,-4.237688493011721,-4.0959687785152665,-4.85019240901667,-3.881931657255648,-3.230077571645278,-3.6823843496109894,-2.7188338873211157,-3.309542002821295,-3.1047209546658623,-3.2555916849268804,-3.2746494859800843,-3.65427253461851,-3.271818165610524,-2.220346776809599,-3.544894961190089,-2.310998611146269,-3.3463337500833554,-3.3257380567401325,-2.093082676763612,-2.4100650040091764,-2.3214858717310674,-3.3084120430674075,-2.573217602428694,-2.3354826191793885,-3.810100400952717,-3.2361231298643287,-3.536928993068643,-3.8103724757309885,-2.9900467862054363,-2.4342524303108,-3.558624127409373,-2.471774503472832,-2.134027654351038,-3.4891368761439323,-4.306278256512366,-4.251760713499621,-3.603408268891447,0.23645535569701837,-0.20634533372665453,0.8201153456889965,-0.3652193879832888,0.7409702310168256,-0.8128746520537828,-0.5081856326723297,0.7215003868130867,-4.537187027666527,-6.107419231192797,-8.93329298878856,-6.420030596196163,-7.198073073062893,-6.041658190410062,-6.440472175550522,-5.1166770550334455,-6.3790475068977415,-6.770324637780696,-8.135672367950688,-8.94903906792642,-9.736121696071134,-8.868600238572874,-6.910541188137155,-8.106606053699965,-6.320820381005694,-10.255637332875308,-10.175524868704272,-10.026623855301645,-9.157399829328435,-10.133650381126401,-9.15752457163296,-9.07700238577533,-7.674099388411233,-9.084368403121804,-8.539956362450754,-9.376478241344412,-10.228121584375799,-10.68156759913474,-9.019932369046996,-8.407107418211,-6.681062983677796,-7.961723908162682,-9.554136391323217,-10.152858255170111,-10.361778332220107,-9.47920176854846,-8.424537450227037,-8.416137780079847,-7.1030848974649405,-8.10896227795033,-8.27642956236539,-8.830791581621996,-10.315167860035771,-8.28749469540079,-8.105606017280603,-7.435895408761312,-6.3099564985344045,-7.393547556759533,-7.2532795026396375,-7.717659074570233,-8.36059629610365,-7.790476151041766,-7.292904938210043,-7.24290700927972,-6.676595386147797,-7.5792618057026155,-5.981133197193243,-7.69708538988805,-7.017272907448403,-7.340088997249384,-6.558164869175802,-5.775834807659297,-7.7117524673394815,-9.43710180299084,-10.054864131150225,-8.858967164862039,-8.416836875829866,-8.801713829449401,-8.54103544746291,-8.760329008772985,-8.716256237434862,-9.21788892609139,-8.153570042812769,-8.414200823244306,-9.61302206841723,-9.63388261359154,-10.377958695197716,-8.17631357032113,-7.881906896813917,-8.836106792530774,-10.371606885366031,-9.727118874000423,-9.916844282574669,-10.19025756046625,-9.600543294274571,-8.404474593680428,-8.526683142100241,-8.577877827514058,-10.334089543849064,-8.906027445586085,-9.319782232640831,-10.281298725581113,-9.147711825080998,-8.865137121626535,-8.13957961565395,-9.044664019624603,-8.464188019695614,-10.08049958641516,-9.894780605395685,-9.70093331435048,-8.079338750258863,-8.920087749585207,-9.092343176563674,-10.19945979725965,-9.911481967968363,-10.491278690902394,-9.20748336044607,-9.389261884053784,-9.175953953037105,-8.694443519814925,-9.123906205351396,-8.662817238087571,-8.926732274385772,-9.97918659220092,-9.982592210992777,-10.033058878659363,-10.200189316444247,-9.330143553395088,-7.66443319614277,-8.704084355145062,-8.00721755305144,-9.537979223574427,-9.020969982039707,-8.23509116734205,-8.237705088923802,-7.149175322489263,-14.04343604748307,-14.8900837204455,-15.787029526527784,-14.714531182857817,-15.248239712891017,-14.288392186912297,-13.790510693438698,-15.918433628458567,-14.734576633777998,-14.560264338778497,-15.723951170359353,-16.602925116504075,-14.664728320717545,-16.53905937284381,-14.47576156513127,-15.4423453727998,-14.548817080690869,-14.504735232354708,-14.84015863043443,-14.769525888469927,-14.383402277918972,-14.564873261455826,-15.649238667184493,-15.378360124588642,-15.347254236741879,-15.039999808223264,-14.436452534942074,-14.823319703516304,-14.937161926549289,-15.536152238955482,-14.042344355738734,-15.380290020725358,-13.391419626346421,-13.541310386613365,-13.498422890825118,-14.153373247708428,-13.830976790948508,-13.448087535512803,-15.106826639416786,-12.59095983365427,-13.455880619816591,-14.20231017703181,-13.128227039618498,-13.589732370797917,-13.797257376481108,-13.591574464914402,-14.159120380607675,-14.453794335888723,-13.574092795406527,-13.329999653558103,-13.982052042910597,-14.395954194847864,-14.38334977958854,-14.403436947870649,-13.591737088435183,-12.580477709466994,-14.563375503563396,-14.71211627337201,-14.131219071495144,-14.382294746200678,-14.700625936105059,-14.035523606928253,-13.990109063093348,-12.97686490226357,-27.222033248739468,-28.0189139968394,-28.030361279316985,-27.581803101565395,-27.161680986873026,-27.293274342514476,-28.662288339620712,-27.442011283740232,-26.732692368824406,-25.809315338477823,-27.82942303271673,-28.14294518556569,-27.196165506326743,-28.19056119844813,-26.79594462159783,-28.663990577938804,-26.111042380061363,-26.19831789871051,-27.944977454103075,-28.725419274389346,-28.449437047090843,-28.375462766837867,-28.38779374959714,-28.5369045985596,-26.056477385077418,-25.849098935165213,-26.798580111872358,-28.13899079292628,-29.0752078974621,-27.42082539297797,-26.491667539152377,-27.437196923843292,-26.327530142097945,-25.52755132700016,-25.703845338775633,-27.018229292382117,-27.319540033510656,-27.072919691452977,-27.90775915463924,-28.43858587218881,-27.325878643698463,-26.278496415160426,-26.70198789340457,-26.813145956791768,-27.07341481682721,-27.19630302261727,-27.293476128289836,-26.595731088692165,-26.38671521697867,-25.954739737343683,-27.276929549960993,-26.135736878163144,-26.626841440574363,-28.222036838517667,-27.042381394769023,-26.03632248005602,-27.674920695781733,-26.438719767162134,-25.969580861330293,-26.033662934530962,-26.817331780254296,-25.678042095591707,-26.46875514300213,-25.44421633853412,1.7134400697440924,0.1844336826045651,0.08543404407096224,0.05469475271928619,0.021172421437384906,-0.5424777241739139,-0.3717045487530818,-1.1711445571806383,0.24038002417166213,0.04445798441133735,-0.17263817518333,-0.012284225282777481,-0.4286883716398246,-2.0668652346575915,-0.20194692481778492,0.6890371870643606,-0.13484511423456252,-2.1623581852113687,-0.7179904967538917,-0.7656449696269448,-0.07032667123828287,-1.29202882094725,-0.22218168645149855,-1.1867028341955999,-0.043154210323345835,-0.898924219205081,-1.6089695701254758,-1.3492886170312666,-1.3218743504897013,-0.668122727061642,-0.9299392590304661,1.159913353216318,0.023500133622986332,-0.16426510316372805,-1.0744480818795443,-0.11733275944619953,0.02970163555171777,-0.9343942118714942,-0.5860939804297624,0.11636161820653874,1.8692819653672486,-0.2049751028938715,0.7873548962898193,0.709983034400819,-0.6596576781831834,-0.8012613050779749,0.14889067224770125,1.5721897894975132,0.4023368966686627,-0.47076664415583086,-0.37323041866412554,-0.22395264528863504,0.06198276491882411,-0.45231957314949967,0.038818210634084256,0.8031267565314482,1.6178392332064684,0.4417703624738898,-0.3310425072861791,0.42014998799318576,0.8974616664041174,0.9934552079781699,0.031040109007818905,-0.38160910598246744,0.4474221915032288,-0.6794119438810018,-0.0014505538998563772,0.02126236668076631,0.46973854422987493,-0.9689814472779945,-0.6579164079695912,0.6155543094332718,3.408638318368802,3.1661900039813022,2.6452234828421455,1.282355828381644,3.220906773837532,3.2984718537133797,2.7596653292942652,1.8030288406704118,2.0055826437369517,2.0732230327381327,2.9488580470128123,2.1203463634544923,3.0066959694503153,1.6410223426300932,2.5204813477572983,2.5134065268297037,2.7340044030998985,2.964566344782968,1.7487414434333755,2.737251054612355,2.9484624161021245,2.502732350612298,3.225262766959249,2.41682596018817,3.6022748135271234,2.7470220978303903,3.752337463711496,2.2047443569216822,2.7990494526727194,1.8251749989624475,3.6505496379973708,2.804924956472704,4.231673513136358,5.170226164578995,4.073122149835438,2.890677337691267,4.490574116455732,4.962919544510397,3.979816917999471,4.838150280969473,6.6177017155702025,8.15375771585075,6.626395741753194,4.829065664373742,5.40161377010376,5.636011389561731,6.23280031630022,6.505587234181611,-0.21072380579173045,-0.4969225541820772,0.4971109877899442,0.6261077373117394,0.33524722365949433,-0.14720485369087033,0.3071754878069526,-0.6203730153571025,6.244132716289628,5.878078182071133,6.93660995183006,7.1382687629087505,8.587165898607141,6.038340493443388,6.608427142973714,6.85327103560212,7.680822238892808,6.672836221961423,6.936352907082257,7.594215076761854,8.641215268299232,8.621584554739144,8.343810968992225,6.5207897415889216,7.353753716738101,7.947534599867658,9.16840008404198,7.984808801982087,9.400065583728304,9.288046107877104,8.187115428697863,8.297907643381075,8.909270176387157,9.152566166674168,9.213352646000818,9.280293266899847,9.684496705693386,8.753578412476928,9.685232591259668,7.070367188475196,8.137414148585055,8.13560277227593,9.750678364661916,9.816852120979364,9.687956289558372,9.759766301046259,9.675820532769814,9.355970261062604,6.44883803869949,10.117097773221245,9.944632066103656,9.79652878365337,9.404191613890637,9.184259542810008,9.951783780390063,7.756757293367291,6.5158377446938704,8.465465208099307,7.752684501223433,9.337266776146311,9.004557213941817,9.573252465813498,7.1263588149075705,6.314936456267041,5.035441663419845,5.3954358354086915,8.873030937226526,7.586945032708384,8.39565688407416,6.163705217069057,6.134514008280383,5.030271929354441,8.200347638569022,8.4037051595799,7.8254904567139745,8.978704659667624,7.875081690572126,8.69669268676112,7.8382302477515085,8.90561665457555,9.428041133190675,9.52421576191779,8.948569010226572,8.484983928565624,9.583359439703507,9.932607908016243,8.98217115756218,8.880448770694528,7.996533594970958,9.974098989538087,8.460337828827798,10.096300548909038,10.114438120094263,9.896083820817568,9.99313393701712,7.934440643562831,8.73025563872505,9.711534267580193,9.512486408197205,9.126341230725306,8.91466641173322,8.46250538124586,9.724959006439898,8.938791223432284,9.718446032606916,9.528599465975308,10.630812069284056,10.155360202971922,10.15275235083695,9.595874459648972,8.84644551282633,9.097180403652203,9.269288587146129,10.419434570232564,9.01586348800448,8.982143497868616,9.063574997611063,10.91860764512738,10.061695435610954,8.836046775609232,9.352274007725944,8.900471078865138,8.414503994109166,8.670816951447735,9.371341837523591,8.816876859399635,9.113755759804384,7.629227263354881,8.406536923568265,8.331835897981872,9.309126406030506,9.196026592470531,9.059264053422247,9.19967362147562,9.352985150343452,9.245014845785425,13.079780733696117,13.605600580063355,15.099158121879826,15.162506961222311,14.554151543921284,15.321865797207368,12.74849053303893,12.8956753306281,12.940039796983218,14.69899986362271,12.563192962226944,13.62492641841969,14.364343840018954,13.98828178302892,14.719649358611168,12.70971149581294,13.717290302072863,12.676528239552296,14.55129908685562,13.752501984326216,14.768329043141886,14.796768697209865,13.01509150436559,13.873986308351958,14.31379514939297,13.644251874935842,14.701550972435122,14.760212411631041,15.169363875202897,13.52790342739604,14.077262239657308,13.044921467833024,15.33508343616938,13.610904347986931,14.827375907903344,14.595798316332699,15.985749601369076,15.658051786954193,13.91747641098627,12.686506096166614,13.825601771401741,14.497895058799244,14.4977885625934,15.33806763385106,13.311868724484198,14.888109529157997,15.081037367706942,15.455908057715076,14.264164929604503,14.626444325815319,16.47151938643002,14.461721496143703,15.24664589236923,14.834681135582587,15.200057579168627,14.80160150675199,14.781023770913349,15.338452290226565,15.88005698714611,14.939418083043849,14.15355620683531,15.045890706048004,13.918812121486841,13.782822402261901,27.20610484338883,25.55878396740796,25.757365727497948,27.51061264273022,25.602076043993517,25.385137460404575,26.38973809631544,24.269129529663147,24.990283669331927,26.297466854917197,26.53901909452042,26.20362903303946,26.321347580279227,26.185412003766064,25.731935277036946,27.0480257500957,26.92140548072079,27.537500792352024,26.300915512158056,26.58488121007693,26.52593025196544,26.60583860569828,27.688370408811835,28.369333485684344,26.39881273407573,26.677177680430415,27.65002704637133,27.602071817812945,27.551578036212838,27.20957463948611,27.499250059677458,26.21913405666495,25.748875443199864,26.74132696896843,27.389024684194588,27.792348408426136,28.042776580750342,27.690859009914828,27.97084452582659,27.322470367220316,26.67768440983132,27.115305428947938,27.283800026144704,27.28649380537897,29.32986726624755,28.584095860985432,28.409742789223202,28.302221737112507,27.41525756110513,27.0216553899757,26.495093961297506,28.826959184899902,26.931097721813256,27.7446930283834,27.401953488843414,27.71450445839312,25.35072380754529,27.583368145675355,27.270725296064377,26.995818933351135,28.652140608634724,27.536352752166284,27.19496599199517,28.241480627392388,-0.6263841053086865,-0.5821657689845923,-0.4950074545393398,-0.10844366114202174,-1.2038623135984783,-1.2733366473713121,0.4302277383455433,-1.263946483941956,-1.0449311393193392,0.32843044863135284,-0.13659024039994824,0.4589706315629991,-0.3806237922524284,-0.8899756753811076,-0.05013227196999964,-0.5893507610932743,-0.9791229423193093,0.3682069811712317,-0.15134034702875013,0.5630546944169277,0.3533104117555076,-0.49466234791915664,0.632056592142388,-1.0754667586708337,-0.04137184702363108,-0.8136866737541507,-0.5692688902106718,0.2152674101289727,0.11556999696288547,0.10748320383340242,0.3301207170814475,-1.152159470431965,0.8758366146388825,0.36760267621624954,-0.2105077085951729,0.971818816709928,-0.18621546739450243,-0.037231542987533076,0.8889294413795518,0.8596945073873504,0.03732815245960712,0.25709432388640824,0.17643118674680705,0.18943509175342013,0.08314942508276574,-0.048099831984822844,1.7798427713425073,0.8689295463111898,-0.527022280026299,0.11297063979287583,0.9414275071436593,1.2430815349657431,-0.014469466642458965,0.5823669690430106,0.8749812927386158,0.4055744119336501,-2.0935829739789296,-1.1873934071767294,-0.9335224504372247,-1.1511503538079393,-0.24148917158685979,-0.10279072986929472,0.8739959518537821,-0.43475168684114585];
  this.h1[6].weights = [0.20338522730614006,-0.016959012745395796,0.6309245146062219,-0.787461111197377,0.4867197179516163,0.12796955285627787,0.6825356422373012,0.22676750480072627,6.94400560680041,7.463148311970518,5.734536516362185,4.880591535282547,5.357195655106123,5.183815970627057,5.95254872419969,6.2509744129539255,4.255231244165789,4.647773415885976,3.8223500168429116,3.780376362385655,3.1184074009611167,3.037845207100256,4.519055336171991,3.7554984008295884,1.88882837442216,2.5736035080051645,2.8241077793427416,3.003060932672003,2.896928493677872,2.403895168744924,3.716695015006383,3.153575766853207,2.9198271662412103,2.2627784445153813,3.071132689282815,2.175126852940292,2.624330060101803,2.590867919522679,2.9652243910267484,3.035614601529943,3.0792441419239225,2.511790367837382,2.287027799756468,1.68782016569744,1.816961151237261,1.9654317625642461,2.706315123039247,2.071801220753432,2.9014991567982724,2.468797683305145,2.681878957686471,1.2752522364726886,1.1620034768094287,3.7281723090883983,2.2606273095319045,2.3606391488554475,-0.6759141163644387,-0.9666584183712028,-0.5946104239084673,0.8849152986794464,0.9148841423362439,0.8777227290238172,0.9021649269633789,0.4632720280766711,5.203603363857438,6.479059312844529,7.502660193254412,6.022074286260793,7.098513139551008,6.943288955218092,6.983040634889365,4.4804728536576865,6.1073392965913955,7.223908397827052,8.27557338542617,9.026993473356132,7.972336121428724,7.616094530511958,7.5029168467371985,5.9649357491025725,5.974833413489226,8.179423829109515,8.792595886383314,8.728214174459318,8.669658326131591,9.552547268376886,8.608636420534857,7.741531895618444,6.63126289850565,8.903129498940325,7.432218999625988,9.277213613129248,9.656189027278188,9.363586605408454,9.214518897925217,8.63806587463889,7.469856294529673,7.242218135896667,7.914642527331936,8.315609446659575,8.54495858481359,8.412927719965111,8.50684934121721,7.500811327839219,5.56984571807882,7.730645427075164,8.01560643542231,8.197265578885213,8.154131192560639,8.856889723697961,8.21851926390602,6.180628969116416,5.919337561504352,6.671740566336459,6.135871060957962,7.2097640004669215,7.200213714236623,7.951421909032742,7.917172470015586,6.202376062985907,5.482604879012826,6.1604094188218745,5.24107628752191,6.633608388289754,6.6515674633530555,6.638976383726401,7.053837262821472,5.2057713042833615,7.913704849945258,8.270034035762217,7.5433582971468764,8.728932519281795,9.376555480655375,7.864321989412768,7.358573279203665,6.678490639484885,8.10043270979575,8.738971772051778,8.979264587395361,8.703288913671466,9.042663499646054,9.469873424588565,8.351843468207424,8.583920302828263,8.237812446028794,9.863125508857848,9.749731719913452,9.617158815981703,9.831789039585718,9.106131254803538,9.536145217524401,7.828560614784445,8.864832777491541,9.341795043392324,8.546861356824943,9.131347567066957,8.85225735328608,8.093157775956582,7.76466807562473,8.77338649337579,8.77066540065084,8.994953465246583,9.074982642370157,9.292672654016199,8.438022625491122,7.937343594888071,8.003524875162814,9.390654451038246,7.385224436962183,8.95369818370937,8.39473455646578,8.579906374074334,9.320284745213232,8.366905538652857,9.190435630345194,8.135554532368081,7.8118162225253664,8.538904432479788,8.419781411505912,8.808004893013768,8.917654128722832,8.613079643494197,8.894137123132595,6.967837706375906,7.616378844210525,7.213449910237704,8.043530527262584,7.934838507877227,8.267477610278661,7.70384635048116,7.251029120992472,7.665537046230169,14.766559708034734,12.711250873352439,13.712447607429285,13.992386299358976,13.181318178754907,12.851649048631424,13.543355850505664,13.114531073250351,14.015878938893438,14.432657737859396,13.514009996160473,13.714991788932846,13.829983036154998,14.042462130520779,13.767982195377996,13.31036025512076,14.010724666942723,13.986137851083374,14.641819794994952,14.59316604822062,14.08728705896355,13.885623435316157,13.767063997460333,12.916892335046397,12.681221777752414,14.060086547807078,13.52471140013391,13.876461343026158,13.236677304138757,14.467321360957754,13.706439823292358,12.607831985042017,13.282638908396061,13.498195950771345,13.62464594972536,13.590516227653202,12.829424756271708,12.207182214138019,13.835444795836931,13.091538504652071,12.652253804572135,13.207523756700601,12.416330245885108,13.190921503738277,12.482129675285613,11.736994312099306,13.123675550501636,12.644044536901596,11.618148129151525,12.268976082676993,12.847398734448333,13.414530989570387,13.071623158230915,13.637456363983823,13.526586768456117,11.301911978475864,12.862262177103169,12.792516553687586,12.761546980102212,13.931703907270846,12.65594335436504,13.257829101201578,13.716571917508562,12.469742465005888,25.31520866854323,26.192502084796487,25.687143267252658,24.96529240536209,25.876217496319,26.23585038412449,25.33548870976936,26.523807255203078,24.96467080182957,24.18070650322519,25.818908926108747,25.480834634942333,24.747205960819084,25.84599779733266,25.39717403263769,26.428086764450672,24.968131791518164,25.159072259469184,25.537702643743142,25.73172508803008,26.57202730463445,26.197633416436354,26.04741081598485,26.558127369816265,25.44471516114641,24.922431587295193,24.38793912517983,24.916764908080882,25.498780444346924,24.938057074748247,26.49353193153132,26.26313685625164,24.272027842685336,24.677221388098136,25.568751739020726,24.91771912107352,25.371905250986106,26.08783267820341,24.79316875062095,24.334128571765852,23.901814438120304,24.29494573009912,25.131206319416833,24.421136158425718,24.458055987840144,25.36429899953765,25.984632747085627,25.096101441523317,24.498719308975488,23.712708972342906,25.333530804749426,25.190150444817505,25.561541022394564,25.001976286189738,24.04230386041395,24.02817720667376,24.894168070752794,23.812104297184696,25.119283344711974,25.040645382741822,24.513630854545415,24.035158896664583,24.91834998985801,23.549652170454106,-1.9606171433408575,-0.3608160974985046,-0.1261973905350423,-1.1424017864772904,-0.808641438528565,0.16298295550924907,0.3219893179907894,0.45150191039039683,-0.028863724040403726,0.889887467894285,1.0785094514964448,0.8819260292423464,0.8443550741227944,1.337237770975379,0.21972383012643526,0.022103553017077504,0.3236349884477303,1.0836572381457175,0.9548778945064602,0.08796284918061846,-0.06148988421919267,2.375050022066103,1.1926141799851238,0.657987904217891,-0.23332836053087236,-0.30182906507168744,0.4563722435709209,0.027237556131616204,0.48335421581274485,1.3856926871405029,0.7896830610250155,0.41234952756247495,-0.6281079774922642,0.18755184964071442,-0.20307317941162362,-0.1960532087314131,-0.009793975525216495,-0.49692879708894316,-0.6238145017359314,-0.12029197710435306,-0.09940087986452419,-0.20541489700202706,-0.2938525347235866,0.24350460604161736,-0.14438595284971395,0.6073414390333232,0.9502031200713377,-0.13596321000903722,-0.5055510221534405,-0.4254982356151952,-0.8514942127840798,0.27505947215529053,-0.3927478427227718,0.15283974684067816,-0.14819574799412966,0.08196292984575435,-2.094111855321383,-0.38407834324031687,-1.1380508256602215,-0.6445204949966924,-0.6573853589314453,-1.4981558604687788,-0.2620278632201499,-0.7776898346411545,-0.006551600489003384,0.27202158472936055,-0.5723190500626423,0.36675005649985204,0.5119505764751167,0.007824166177280212,0.059172100464515154,0.8124484731119845,-1.8861761157571484,-3.2531069646999966,-1.839455988252852,-1.6434621714032596,-2.268043701721226,-2.9629100474624384,-2.730098897244013,-2.080594191993606,-2.0122351626176997,-2.8075509344417267,-2.685273299659823,-1.4491151309244337,-3.7107380898312456,-2.2989877476105804,-2.611365653494042,-1.772019223588328,-2.192609286752905,-3.6066893219100864,-2.188307625283203,-3.4770594099404506,-2.936807578872618,-2.661196146365958,-2.4296351778673126,-1.7123806101431607,-3.290485712998998,-3.2212278543845088,-3.1609810345585965,-2.874438028405102,-3.151904679816086,-3.2344262709640246,-2.4445567549698355,-3.2194118151561795,-3.320778531765239,-3.828275199988928,-3.8725718955351156,-3.725670774964435,-3.5538111815593254,-3.531981975284967,-4.585562252825155,-4.230710906341196,-7.5029742926413,-5.978847270202045,-5.861773560466606,-4.6782972783833054,-4.393961235519587,-4.543134097409157,-5.5334108898768255,-6.394086588764559,0.6817373396833983,-0.947472149552449,-0.6195709991311849,-0.5479967446736489,0.6061486648271868,0.7732248517715399,-0.1828803345844019,-0.5821741231866762,-5.169799563622641,-7.335455384431118,-5.392269161521151,-6.452575807321494,-7.457410472681147,-7.0224291918716375,-7.517550024266198,-5.625524524632267,-5.886045727152007,-6.502221905069461,-7.530663173306364,-7.533440791633078,-7.922805703919328,-7.345235154351387,-6.9586582043192085,-6.769592054546196,-6.053609529691071,-7.53776876874129,-8.481706518694313,-8.6342418684307,-7.586891760057914,-8.493497596120234,-8.627488020086666,-7.382971269773737,-6.729284166706727,-7.643305485918326,-8.546999234765329,-9.207811439301484,-8.60605806280568,-8.030660481522638,-7.7620295369195125,-7.391492781441113,-6.784830768713547,-8.697699185475383,-9.65636546801778,-10.111803985685434,-8.915868743490657,-9.310816334277389,-8.821448096256084,-8.186162425485962,-7.612251252985448,-8.350420202378933,-8.08171985547706,-9.835419185279987,-9.556435697684025,-8.609830862597272,-8.726911287165615,-7.332113323975404,-5.375022288972863,-7.151061486220653,-8.299319653249963,-8.20762625561923,-8.726980682668088,-8.95867082120837,-7.491353119140403,-6.336974247118152,-4.016183712688802,-6.553520705042735,-7.373777681193227,-6.598009766117297,-7.657676647887752,-6.798830069771334,-6.701611480097571,-4.539450405852993,-6.583796312672541,-9.133848867807043,-7.316943599938807,-8.607937697277713,-8.546134991091723,-7.383363790397655,-8.280235736906342,-7.142300330360368,-7.238883823752866,-7.4938886477474265,-7.823614810024023,-8.206950061707756,-8.393858916465804,-9.484747021822454,-8.98229994755484,-7.846736503647248,-7.761737280593582,-8.370990485246628,-9.44976511160226,-9.625439789758367,-8.741884104127363,-8.207397191228175,-8.580913880416349,-8.663804756759536,-8.219946834275197,-7.686731773437058,-8.203736841737884,-9.51233918068433,-8.924692083140782,-8.825029313739094,-8.82765087747365,-8.969665504599908,-7.834301040280207,-9.09920897038603,-9.212882726400492,-9.316076677245169,-9.320348307765775,-9.030198452869605,-9.360400431887607,-7.8654892921918025,-8.127883218675775,-9.142818176078878,-8.602479827766729,-8.37085511300357,-9.309216316134775,-9.474816957125375,-8.422835804939075,-8.637054767709742,-7.14942826563789,-9.231381589162968,-8.619810844872568,-8.600034104867476,-8.311370467809304,-8.732362593270889,-8.212553400743863,-8.006743896031296,-7.304023498614462,-7.781206633218885,-7.828969834231598,-7.925622489777879,-7.816855486141558,-8.23287369939897,-7.538317670649351,-7.507488188170971,-12.813005910563064,-13.6569346621292,-13.525900520547287,-13.602127035845008,-13.539355022040255,-13.972941163606432,-12.246368798244974,-13.02729548311547,-12.51274766905004,-13.37460745877458,-12.963402884932307,-13.707075617872942,-12.521160570386808,-12.368504364227222,-12.234737240486565,-13.073540511919877,-12.083768252077805,-12.99919172020833,-12.055060331880354,-13.460083547279318,-12.89626087414869,-13.095919165881051,-13.719659955239548,-12.671823322457366,-12.68539116621438,-13.221415697196019,-13.084508125172633,-14.376186407473712,-12.486348000565787,-13.173695258828827,-13.665095430097645,-12.694899326973227,-13.213048328113395,-12.448143494266455,-14.676359979787899,-13.34500659554623,-13.647672759484951,-13.582081721256973,-13.7473902191385,-13.342635112842078,-12.596841623279365,-13.399555901705357,-13.846700658642103,-13.482858102401607,-13.91584780711826,-13.341187613870751,-14.622948281638326,-12.96242319021369,-12.953733353809818,-13.603333273507827,-13.700913862794513,-13.577469760148348,-14.48164027816564,-14.0611285917635,-12.585572560110435,-12.985862988434494,-14.385087852346913,-14.12381793803685,-14.420564064345305,-14.233982463917533,-13.876782744159813,-13.770073267525209,-12.551360819247124,-13.789386083209804,-24.580125196646645,-24.376881759162274,-24.85418980354672,-25.163542128414143,-24.398152210988506,-24.232673536252133,-24.438912468579378,-23.72066071614834,-24.02807951788842,-24.06318283067321,-24.91013353295422,-24.57086489511583,-25.230073861793166,-25.732783128496834,-24.189239918352825,-25.189149607650812,-23.7708544561208,-24.67937350807545,-24.532849378389212,-25.26645999868408,-25.960662252930334,-25.048453240673727,-25.806199852529357,-25.091554401158255,-24.993424573822264,-25.06525415609855,-25.370988930578275,-25.183009416835663,-24.92340280253039,-25.357080880730994,-26.15566682315453,-25.176321494399996,-24.830835019118414,-24.99556293092122,-24.132284078016525,-25.257758593853122,-26.421781541490112,-26.203006609080166,-25.072257275190633,-25.77730842244379,-25.145689764763553,-25.127055857015982,-25.380544258421345,-25.27701103253051,-25.99806754128817,-25.676553439339052,-26.355056962500704,-26.015546179972983,-24.78328444879625,-25.02919004194205,-24.770937392374158,-25.516420172613003,-25.409219344750692,-25.45878024221171,-25.76633581456441,-25.79707468311021,-24.53649666718116,-25.09217564916711,-26.051761542851885,-25.56512483352405,-26.626278126999175,-25.36595566085022,-25.633984414480754,-26.343904666617842,0.7844714241187931,0.11487579659081389,0.45133730906043645,1.3249173485700625,0.4871511231957823,0.8321635770597055,0.014668701551268338,1.0821118843752775,-0.002621824000570138,-0.18385997324637848,0.11142022592342478,0.35608994640921066,0.22043293657322224,-0.22139578256070785,-0.6284499782436785,0.021540345704060524,-0.35733249972910963,-0.24796832950637424,0.8760758602438179,-0.11045598732157416,-0.38033180106344844,0.19505982335179511,0.6070662125595372,-0.22576084094314036,0.2639725584535112,0.4695598528796997,-0.115022090951237,-0.3546952757892492,-0.566454793638414,0.32644546155450255,-0.2780182644452903,1.1081372236020168,-0.5799107700079694,-0.43342184477071594,-1.2979097167468348,0.14617379856773655,-0.028795408829881342,-1.1077415593010842,-0.7014017839293686,0.5174797468371845,0.1549573247490035,-0.5157480998136423,-0.7602730467357685,0.17558873103738165,-0.9795483673914552,-1.42513615644676,-0.46082079773168266,0.627045332218205,-0.40551517592624065,0.1825732717252055,-0.5697073850727001,-0.21192856273486246,-0.6924896739670179,-0.6485538456543763,-0.20618569181392632,0.5109506242474101,2.9587964605791566,-0.5084292955671396,-0.28581493026539767,0.42239345749388035,0.3477697187109901,0.25845384578675884,0.32920241277781226,0.43118553609886057];
  this.h1[7].weights = [0.9109909142938695,0.8840335598893838,0.7825634196353866,-0.8209547960069941,-0.6744356495998565,-0.9913522616347681,0.11927453423866785,-0.7618974296879188,-5.346630018673346,-5.7747259027957325,-6.0418526535898485,-5.764033478700407,-5.550430672354585,-4.981863339959632,-6.301870433425628,-5.698786427351733,-4.2712539426270295,-4.210976512969324,-4.245837173665029,-3.3214297395564234,-3.893862571785275,-3.8454430922691842,-3.610441881035923,-2.791802583118011,-3.1078158878193514,-3.320135616938717,-2.69522476514184,-2.9350308627133344,-2.5924141632746314,-2.484738156872587,-2.085351794659501,-2.042323271570373,-1.7808123139173773,-2.1560951502891963,-1.9309252153321992,-3.0560471058171017,-2.4841447336784404,-2.365359807095739,-1.8433614751009835,-1.7746358662881372,-1.8291282931080035,-2.4520607026276413,-2.406547621745834,-2.107042822363704,-2.8405231996410834,-2.158482418637454,-2.699629252294042,-2.1354313890536885,-2.10680869055472,-2.540474198801779,-1.798453611092901,-1.7356300671302454,-2.5231801868807398,-2.491711352953996,-3.043121587115869,-2.3707997094126205,-0.42816884412619993,-0.2822186050552462,-0.5249096917749152,-0.9075619159459358,-0.013396910086703517,-0.18199679520173184,0.2640480317097431,-0.8677604556238174,-4.504271864289033,-6.297521952380365,-7.613399138988229,-7.230899551420786,-7.972473960598448,-6.449081993123973,-6.9904752227144344,-5.563377498209223,-6.329685885113452,-7.583519204831831,-8.515773644170027,-8.621780603656013,-8.25592251759996,-8.465389738646687,-7.47506299941065,-7.053317190131572,-7.340921989338459,-9.670521631312766,-8.595443021494283,-9.48268926139366,-9.10605031838957,-8.781099878056462,-8.647874047536208,-7.765385325955399,-8.227993595447032,-7.861219555663071,-8.640109038722805,-9.6153073295329,-8.827583243947949,-9.175537721534722,-8.031457440646626,-7.528925428484682,-7.444698729162477,-8.06586421327367,-8.370900832552975,-8.917796858216336,-8.492859330836794,-8.812401745089016,-8.69278366267081,-7.125207510968658,-6.87566527029544,-7.272734616580243,-8.502557453160856,-7.946476015064438,-8.60608728182443,-7.985605882314033,-8.507179283697903,-7.880937118254664,-6.261382787676714,-6.775079155202603,-7.749612821367708,-7.099654901153304,-7.7583024516258385,-7.606817720564429,-6.975114163026995,-7.613964910956476,-5.184250866966084,-6.4772638071165,-6.740622734071816,-6.340498249666946,-7.47864649488986,-6.919094344892273,-7.069498740894235,-5.880799600153877,-8.007575014226061,-7.86331626755945,-7.883050682198097,-8.299491513045487,-7.983512925459445,-7.832410341822271,-8.564452038637144,-8.534770150339273,-8.249488782472767,-8.711126157346522,-8.231937129239768,-8.376178921211308,-9.107141238106317,-8.18994219836849,-8.935149943997011,-7.2082184003575325,-8.26072658617854,-8.259481491562667,-8.715794044565598,-8.119218457697523,-8.14139701646036,-9.131866370185872,-8.68100027164493,-9.034336472104863,-8.593952970027352,-8.13921834599925,-9.259164587846955,-9.329798062304546,-9.888301466234081,-9.159431053019782,-9.3889253948583,-8.123333233889802,-7.92824968944101,-8.118015205655185,-9.449820779000836,-9.184174683777375,-9.480110777898108,-9.178950290623805,-9.018627525656541,-7.921553298239154,-8.483343482648495,-8.600609767455147,-9.412893623142352,-9.291095461029636,-8.966858353949764,-8.971499940046018,-8.470640974776193,-8.591734791475751,-8.500299756418016,-8.630132947824121,-9.140136271995251,-8.302831676499268,-8.3839202969737,-8.389693098702613,-9.408543925249816,-8.759550764018826,-7.417635683366833,-8.734606654333836,-7.472366634280527,-7.998785429221922,-7.943965561687899,-8.232020645338137,-7.780804345053251,-7.765652757840406,-13.378740899040654,-14.347440579864804,-13.814302958198537,-14.376595368964207,-14.07557024743174,-14.39929531353081,-13.594690092128022,-13.317876366981732,-13.699568737394097,-13.725432646520286,-14.505386848712462,-14.062246906099787,-13.685676509659396,-13.964339037191607,-13.753638285947503,-13.36161985821603,-13.855166443265981,-13.776421128715873,-13.457373957707802,-13.277532509791236,-13.84255290968161,-13.10626117600259,-13.906428854610516,-13.565052832894335,-13.629948783847396,-12.864517800246537,-13.694135184170163,-13.61872311728982,-13.769080155741568,-13.449865394023199,-12.916685277459054,-14.103275908994362,-12.943226124518038,-13.082089878691264,-13.550651620608697,-13.262073511649211,-13.613659305648698,-13.512391961352645,-12.998563875673474,-12.890528668741633,-12.732172934826812,-12.79418424631494,-13.861182858380584,-13.029351713858336,-13.724366974566943,-13.97384575180545,-13.146663286257395,-12.322271369035363,-13.070228980465206,-13.350840613554187,-13.285624085222455,-13.259652550068578,-13.184993636820533,-13.351749184546884,-12.669084742415638,-12.995342670756902,-12.985587993912818,-12.97614779933176,-14.223617218403959,-13.518918839762431,-14.077936911633863,-13.283424211691747,-12.517774193427737,-12.577554154050043,-24.315393196804255,-25.096568062936328,-26.11701240805331,-25.900284986555672,-26.469336786615674,-25.941240172276668,-26.186757124157584,-26.107915711078018,-24.698733566531175,-25.24375254524822,-25.260366471417633,-26.145242764023457,-26.77457775206998,-26.537858797640023,-26.323691782148902,-26.820613166369366,-24.95481780980873,-25.49286166800412,-25.860616058997657,-26.533956444872427,-26.544199108309634,-26.862183177142718,-27.297581680557222,-27.45267508887394,-24.670197223382562,-25.46132949407492,-26.02735583527226,-26.39086819550502,-26.137206171501862,-27.008750517738104,-25.873342910694117,-25.75025733196637,-25.104733781004576,-25.51615204652785,-25.43730076137896,-25.774802156998103,-26.204123087683325,-25.411185907576204,-26.30538273274348,-26.712249928102292,-25.619584698322296,-25.710800220771507,-25.724171762250855,-25.88280052998664,-26.28074520716949,-25.603981817052283,-25.948513402315626,-26.110790576014587,-24.633851014138163,-25.921013782484135,-25.778633249565225,-25.824838211547977,-25.951330882570907,-25.884105635721053,-24.906424464361244,-25.795274479209144,-25.496943861787564,-25.024448049915097,-25.11609090773321,-26.059438646760753,-25.168622810665152,-25.033026409933644,-24.439626601259253,-24.039724102536265,1.6668274781474892,0.4237983255838202,-0.14183348430629622,-0.09760155841771982,-0.12445744274376648,-0.035928276335342776,0.0033070645397550134,-0.35879213756205214,-0.20563098682054184,0.5066041707077442,-0.3149299953888327,-0.42277030997055354,-0.3961987372459736,-0.4237923047790202,-0.9945980186758598,-0.44435348828232973,-0.27796866466529824,-0.1907056170650466,-0.43741044329446505,-0.5186546275252086,-0.8276379726547769,-0.784014877664289,-0.9153375156938433,-0.12454453687024315,0.18782240654457272,-0.7536121110562783,-0.7728233368055584,-0.26596429494997526,-0.1546046774575514,-0.16244373432852896,-0.5883849445881251,0.2622680758590197,0.391087804264476,-0.12795726037005412,-0.39619034779605466,-0.9872784155996063,-0.6766455498614405,-0.757946903987594,-0.5920779111615015,0.3454477765446607,0.07859108150251977,-0.34215977897662797,-0.26652611076871935,-0.3572697365191187,0.12107692894827023,0.21009779425715452,0.16560320597906522,0.1489057109823992,0.6426057180178947,-0.3379996588209366,-0.4019187728349113,0.5973437439154802,-0.3685940989461253,0.34356143881839885,0.36858133362060325,-0.06685438704071504,0.23222251229616095,-0.08897338677465737,-0.04458281612082376,0.8698346925863727,0.9973940241554822,0.16850478763414206,-0.15666662465953957,0.057515082056274744,0.9711228268526524,0.9057002823227416,0.3033601431697357,0.08956476888688725,-0.99381561818549,0.25851492087253414,0.39261509814521256,-0.07793893915318195,2.7805456214581676,2.563049871060649,2.172502874322851,1.5709295966526775,1.738847949261303,2.4884274249232976,3.3156734329408173,2.058583033372735,2.2280571129568214,2.6866620225871434,2.4422648317094535,2.903976792616207,1.6638639151336818,2.674976939405757,3.222858292213564,2.6937202971756986,2.1755437841824583,1.9403915880092846,2.697468238759385,2.309755616119361,2.396602462454509,1.8662731036872617,2.8515227725727854,2.4077681211795596,2.423868379768228,2.3664528795475612,2.016559455993556,2.859265072123828,2.51030617985083,2.5013471774654903,2.906647290493744,2.3384622966089927,4.271094077769261,3.8558313213778375,4.044769265251047,3.7762374321369907,3.589244714070776,3.4012052235872563,4.135887415759214,3.2262706585800767,5.6068563326815735,6.015175447951802,4.86225167930091,5.1018225565010695,5.9878792079997565,5.379557609043012,6.024788876000302,5.563836338434036,-0.407167627746003,-0.09931525050543488,-0.2800716417303071,-0.259970082121459,0.23809209177165203,-0.6788244453613532,-0.5396433942618404,-0.5699338568490271,5.296920890114366,6.353469239180307,7.534894374528547,7.256832653190865,7.264591634379909,6.751918139736215,6.987514168577242,5.887659116822121,7.0002481911648715,7.057499766389899,6.99219392098338,7.630701685363883,7.8254992731875985,8.311804070560164,7.644320541892253,7.415014023994086,7.259404508432717,7.285039325434423,7.774089424530758,8.013075973726721,9.107859382298148,7.844469139694689,7.420432760514129,7.2090156527880405,7.2940467649261596,8.555476286311762,8.058808201208565,7.900074107761111,8.83362918862897,8.926890324282784,8.391314279570722,7.342106213744157,8.136351884360499,7.961071947191832,7.916324524757461,8.825725608213967,8.828373773006463,9.340549531337974,8.030004638110906,7.6617423475155615,5.95964309021997,8.671612978128543,9.086524303759667,8.31487819882506,8.658728592346748,9.853171509978425,8.80179286083626,8.57754319235319,7.291865610090145,6.914542416457903,8.337264347657687,8.595624129767272,7.345058150894735,7.432963905720857,7.814941480436474,6.866757762483716,5.605310438530841,6.409760306370647,7.664752392181633,6.870464601704627,7.660341557880026,6.610374728085442,6.893014272213567,5.183186812232999,8.11154257214377,7.851920994346582,8.286115008290272,8.297257282330861,7.331661029553252,8.35029167630204,7.037957154824232,8.571345262295829,8.809366558357706,9.016714717308826,9.2674164620891,8.267358940486528,8.190365317290915,8.067754723943002,9.23876620650473,8.315770798516338,8.572268650016245,9.066567818728684,8.536404040793835,8.547447052999614,9.244440227903688,9.614675041266462,8.69288386722928,8.240703113295224,8.280609528179989,9.637523191541911,9.34919781657054,9.14606725173917,9.349308158868098,9.027971944685255,8.62573981458666,7.885082891034926,8.514244777361686,8.805438342490831,8.32601266810419,8.778299414181085,9.395933176447423,9.189038683477627,8.405324600866871,9.365775354807942,8.078965734743614,8.686253726417384,9.313549936265836,9.33600008849543,8.475169744195814,8.564331344148728,8.999301717412655,8.623477535286105,8.953257689803133,8.114576474793298,8.162348197972017,8.441623982428345,9.36534710298342,8.67944188973032,9.401169259920223,7.354120091772625,8.703264753107105,8.515884603345507,8.108092199280469,8.04625890532274,8.680912710958266,8.192674818481967,8.04858389797038,8.457141181368215,13.325590133154694,12.728985151510397,13.334069742710767,13.418873996259759,13.840768567014075,12.823096328028353,13.28547402129094,12.014101923425477,13.257068430639254,12.623779390408483,13.33492770219786,13.11836540363864,13.65643569172589,13.851495907268363,13.521145473475888,11.914327558932792,12.880894669408983,13.210531840092914,14.002212724272784,12.758251500575916,13.27259795798809,12.94904369432225,12.550338415513687,12.898397555623813,13.151246477694011,12.939193140231163,13.939455933200957,12.892569951819532,14.335182498834785,13.296113434823674,13.265696718643383,13.500048777893385,13.551099631828974,13.788451430234344,13.313082177789093,14.006743678919097,13.494816365848592,13.663885164171923,13.158195703058867,13.714608849780442,14.54373903908635,14.121504905770948,14.024165664620318,14.098686797402232,13.878633185982086,14.206465118981047,13.46973981962352,13.377465514578512,14.532962314595723,13.943445541242124,14.138553942770132,14.859340058793286,13.529087503377049,13.717894164234696,14.527161894950314,14.164000311796993,13.557413376689889,13.514532096465421,13.372967795795999,13.574899874984553,14.603086066330844,12.9662838834019,14.346289729382095,14.289825079171875,25.59623237717912,25.331878739622248,25.28360226089093,25.673179671452214,25.018700812750115,25.488190865541075,25.134906612797568,24.69946618767001,24.703503132521323,26.35688505768501,25.928420255713448,25.934105585596484,26.034231755677048,25.20883104163109,25.610664514381583,25.372182043409847,25.98564922110921,25.20692104554943,26.084962771759077,26.18287614145772,25.39156400953127,26.179081702805675,25.995807341787934,26.005936657873907,25.03416094448485,25.094680622819823,25.604449446308173,25.77985729392818,26.174325727192265,26.05128752204211,25.177659006901063,26.344366121519705,25.378837104231696,25.10899604102366,26.152266143283825,25.65945907397802,26.167308200132812,25.899976924984063,27.029192875700524,26.152274594496117,24.8676168217727,25.976010205591486,25.90758022507273,27.102337286741907,26.37585085598104,27.632837742799012,26.183264153351853,27.334560101348348,24.42883517952873,25.07048654827415,26.52552081612323,26.493299579993593,26.591872979901478,27.124201177139145,26.592539541214393,27.009986091811385,25.16037926149213,26.56365380215243,25.794757744160435,26.272257231709194,26.132743295628522,26.890536073201986,26.575932331079382,26.719296698015537,-0.9071225619464599,0.10836246824431323,-0.07253698338945634,0.0788838434184875,-1.245886283510817,-0.8051142472125121,-0.6284353846418204,-0.21181731200585177,-1.0367514253540295,0.010428517677407802,0.10568000729152964,-0.2015497502378575,-0.03561742057318187,-0.11228178923582265,-0.5463574282934552,-0.7086273517334152,-1.309470196459548,-0.43391160097196707,0.2645002294049466,-0.728545966961139,-0.15014708243226227,-0.11138180055542923,0.5514092394184194,-0.8093654675873083,-0.34066462663542096,-0.520857561697577,0.04680657454369258,0.06891602559092994,0.14467737649955828,-0.14559026351312884,0.005821366672249174,0.0412455665206621,-0.6153034372744809,0.7284206791374415,-0.03689118398904983,0.5332452532840761,0.5191870589975123,0.07667267232932573,1.0250656197960974,-0.33289385815637007,0.2695281728281398,0.9243322775828459,0.7842506338883517,0.32627365000015424,0.48437288835539855,1.3135422615479893,1.247798404082165,0.47149076277856844,-0.34368203386699764,0.5355626930992363,-0.24853315936561451,0.5886998289345537,0.2611271101352151,0.877130833224755,0.8132893372905521,0.9537124479802999,-1.121148095213793,-1.1026223327715783,0.10915536899042055,-0.5158172629833782,0.032562555039614284,0.5415418970025955,-0.03439780503530453,0.9246389857903096];
  this.o1.weights = [0.05037837032668257,-0.03272159215919704,-0.011979198314430452,0.07758144671168725,-0.023124422071070322,-0.034430609315458514,0.08247333707043136,-0.10721238598698202];
  
  //}}}

  this.runningEvalS = 0;  // these are all cached across make/unmakeMove.
  this.runningEvalE = 0;
  this.rights       = 0;
  this.ep           = 0;
  this.repLo        = 0;
  this.repHi        = 0;
  this.loHash       = 0;
  this.hiHash       = 0;
  this.ploHash      = 0;
  this.phiHash      = 0;

  // use separate typed arrays to save space.  optimiser probably has a go anyway but better
  // to be explicit at the expense of some conversion.  total width is 16 bytes.

  this.ttLo      = new Int32Array(TTSIZE);
  this.ttHi      = new Int32Array(TTSIZE);
  this.ttType    = new Uint8Array(TTSIZE);
  this.ttDepth   = new Int8Array(TTSIZE);   // allow -ve depths but currently not used for q.
  this.ttMove    = new Uint32Array(TTSIZE); // see constants for structure.
  this.ttScore   = new Int16Array(TTSIZE);

  this.pttLo     = new Int32Array(PTTSIZE);
  this.pttHi     = new Int32Array(PTTSIZE);
  this.pttFlags  = new Uint8Array(PTTSIZE);
  this.pttScoreS = new Int16Array(PTTSIZE);
  this.pttScoreE = new Int16Array(PTTSIZE);
  this.pttwLeast = new Uint32Array(PTTSIZE);
  this.pttbLeast = new Uint32Array(PTTSIZE);
  this.pttwMost  = new Uint32Array(PTTSIZE);
  this.pttbMost  = new Uint32Array(PTTSIZE);

  this.ttType.fill(0);
  this.pttFlags.fill(0);

  this.turn = 0;

  //{{{  Zobrist turn
  
  this.loTurn = this.rand32();
  this.hiTurn = this.rand32();
  
  //}}}
  //{{{  Zobrist pieces
  
  this.loPieces = Array(2);
  for (var i=0; i < 2; i++) {
    this.loPieces[i] = Array(6);
    for (var j=0; j < 6; j++) {
      this.loPieces[i][j] = new Array(144);
      for (var k=0; k < 144; k++)
        this.loPieces[i][j][k] = this.rand32();
    }
  }
  
  this.hiPieces = Array(2);
  for (var i=0; i < 2; i++) {
    this.hiPieces[i] = Array(6);
    for (var j=0; j < 6; j++) {
      this.hiPieces[i][j] = new Array(144);
      for (var k=0; k < 144; k++)
        this.hiPieces[i][j][k] = this.rand32();
    }
  }
  
  //}}}
  //{{{  Zobrist rights
  
  this.loRights = new Array(16);
  this.hiRights = new Array(16);
  
  for (var i=0; i < 16; i++) {
    this.loRights[i] = this.rand32();
    this.hiRights[i] = this.rand32();
  }
  
  //}}}
  //{{{  Zobrist EP
  
  this.loEP = new Array(144);
  this.hiEP = new Array(144);
  
  for (var i=0; i < 144; i++) {
    this.loEP[i] = this.rand32();
    this.hiEP[i] = this.rand32();
  }
  
  //}}}

  this.repLoHash = new Array(1000);
  for (var i=0; i < 1000; i++)
    this.repLoHash[i] = 0;

  this.repHiHash = new Array(1000);
  for (var i=0; i < 1000; i++)
    this.repHiHash[i] = 0;

  this.phase = TPHASE;

  this.wCounts = new Uint16Array(7);
  this.bCounts = new Uint16Array(7);

  this.wCount  = 0;
  this.bCount  = 0;

  this.wHistory = Array(7)
  for (var i=0; i < 7; i++) {
    this.wHistory[i] = Array(144);
    for (var j=0; j < 144; j++)
      this.wHistory[i][j] = 0;
  }

  this.bHistory = Array(7)
  for (var i=0; i < 7; i++) {
    this.bHistory[i] = Array(144);
    for (var j=0; j < 144; j++)
      this.bHistory[i][j] = 0;
  }
}

//}}}
//{{{  .init

lozBoard.prototype.init = function () {

  for (var i=0; i < this.b.length; i++)
    this.b[i] = EDGE;

  for (var i=0; i < B88.length; i++)
    this.b[B88[i]] = NULL;

  for (var i=0; i < this.z.length; i++)
    this.z[i] = NO_Z;

  this.loHash = 0;
  this.hiHash = 0;

  this.ploHash = 0;
  this.phiHash = 0;

  this.repLo = 0;
  this.repHi = 0;

  this.phase = TPHASE;

  for (var i=0; i < this.wCounts.length; i++)
    this.wCounts[i] = 0;

  for (var i=0; i < this.bCounts.length; i++)
    this.bCounts[i] = 0;

  this.wCount = 0;
  this.bCount = 0;

  for (var i=0; i < this.wList.length; i++)
    this.wList[i] = EMPTY;

  for (var i=0; i < this.bList.length; i++)
    this.bList[i] = EMPTY;

  this.firstBP = 0;
  this.firstWP = 0;

  if (lozzaHost == HOST_WEB)
    this.mvFmt = SAN_FMT;
  else
    this.mvFmt = UCI_FMT;
}

//}}}
//{{{  .position

lozBoard.prototype.position = function () {

  var spec = lozza.uci.spec;

  //{{{  board turn
  
  if (spec.turn == 'w')
    this.turn = WHITE;
  
  else {
    this.turn = BLACK;
    this.loHash ^= this.loTurn;
    this.hiHash ^= this.hiTurn;
  }
  
  //}}}
  //{{{  board rights
  
  this.rights = 0;
  
  for (var i=0; i < spec.rights.length; i++) {
  
    var ch = spec.rights.charAt(i);
  
    if (ch == 'K') this.rights |= WHITE_RIGHTS_KING;
    if (ch == 'Q') this.rights |= WHITE_RIGHTS_QUEEN;
    if (ch == 'k') this.rights |= BLACK_RIGHTS_KING;
    if (ch == 'q') this.rights |= BLACK_RIGHTS_QUEEN;
  }
  
  this.loHash ^= this.loRights[this.rights];
  this.hiHash ^= this.hiRights[this.rights];
  
  //}}}
  //{{{  board board
  
  this.phase = TPHASE;
  
  var sq = 0;
  var nw = 0;
  var nb = 0;
  
  for (var j=0; j < spec.board.length; j++) {
  
    var ch  = spec.board.charAt(j);
    var chn = parseInt(ch);
  
    while (this.b[sq] == EDGE)
      sq++;
  
    if (isNaN(chn)) {
  
      if (ch != '/') {
  
        var obj   = MAP[ch];
        var piece = obj & PIECE_MASK;
        var col   = obj & COLOR_MASK;
  
        if (col == WHITE) {
          this.wList[nw] = sq;
          this.b[sq]     = obj;
          this.z[sq]     = nw;
          nw++;
          this.wCounts[piece]++;
          this.wCount++;
        }
  
        else {
          this.bList[nb] = sq;
          this.b[sq]     = obj;
          this.z[sq]     = nb;
          nb++;
          this.bCounts[piece]++;
          this.bCount++;
        }
  
        this.loHash ^= this.loPieces[col>>>3][piece-1][sq];
        this.hiHash ^= this.hiPieces[col>>>3][piece-1][sq];
  
        if (piece == PAWN) {
          this.ploHash ^= this.loPieces[col>>>3][0][sq];
          this.phiHash ^= this.hiPieces[col>>>3][0][sq];
        }
  
        this.phase -= VPHASE[piece];
  
        sq++;
      }
    }
  
    else {
  
      for (var k=0; k < chn; k++) {
        this.b[sq] = NULL;
        sq++;
      }
    }
  }
  
  //}}}
  //{{{  board ep
  
  if (spec.ep.length == 2)
    this.ep = COORDS.indexOf(spec.ep)
  else
    this.ep = 0;
  
  this.loHash ^= this.loEP[this.ep];
  this.hiHash ^= this.hiEP[this.ep];
  
  //}}}

  //{{{  init running evals and h1
  
  for (var i=0; i<NETH1SIZE; i++)
    this.h1[i].sum = 0;
  
  this.runningEvalS = 0;
  this.runningEvalE = 0;
  
  var next  = 0;
  var count = 0;
  
  while (count < this.wCount) {
  
    sq = this.wList[next];
  
    if (!sq) {
      next++;
      continue;
    }
  
    var piece = this.b[sq] & PIECE_MASK;
  
    this.runningEvalS += VALUE_VECTOR[piece];
    this.runningEvalS += WS_PST[piece][sq];
    this.runningEvalE += VALUE_VECTOR[piece];
    this.runningEvalE += WE_PST[piece][sq];
  
    this.netwAdd(piece,sq);
  
    count++;
    next++
  }
  
  var next  = 0;
  var count = 0;
  
  while (count < this.bCount) {
  
    sq = this.bList[next];
  
    if (!sq) {
      next++;
      continue;
    }
  
    var piece = this.b[sq] & PIECE_MASK;
  
    this.runningEvalS -= VALUE_VECTOR[piece];
    this.runningEvalS -= BS_PST[piece][sq];
    this.runningEvalE -= VALUE_VECTOR[piece];
    this.runningEvalE -= BE_PST[piece][sq];
  
    this.netbAdd(piece,sq);
  
    count++;
    next++
  }
  
  //}}}

  this.compact();

  for (var i=0; i < spec.moves.length; i++) {
    if (!this.playMove(spec.moves[i]))
      return 0;
  }

  this.compact();

  for (var i=0; i < 7; i++) {
    for (var j=0; j < 144; j++)
      this.wHistory[i][j] = 0;
  }

  for (var i=0; i < 7; i++) {
    for (var j=0; j < 144; j++)
      this.bHistory[i][j] = 0;
  }

  return 1;
}

//}}}
//{{{  .compact

lozBoard.prototype.compact = function () {

  //{{{  compact white list
  
  var v = [];
  
  for (var i=0; i<16; i++) {
    if (this.wList[i])
      v.push(this.wList[i]);
  }
  
  v.sort(function(a,b) {
    return lozza.board.b[b] - lozza.board.b[a];
  });
  
  for (var i=0; i<16; i++) {
    if (i < v.length) {
      this.wList[i] = v[i];
      this.z[v[i]]  = i;
    }
    else
      this.wList[i] = EMPTY;
  }
  
  this.firstWP = 0;
  for (var i=0; i<16; i++) {
    if (this.b[this.wList[i]] == W_PAWN) {
      this.firstWP = i;
      break;
    }
  }
  
  //}}}
  //{{{  compact black list
  
  var v = [];
  
  for (var i=0; i<16; i++) {
    if (this.bList[i])
      v.push(this.bList[i]);
  }
  
  v.sort(function(a,b) {
    return lozza.board.b[b] - lozza.board.b[a];
  });
  
  for (var i=0; i<16; i++) {
    if (i < v.length) {
      this.bList[i] = v[i];
      this.z[v[i]]  = i;
    }
    else
      this.bList[i] = EMPTY;
  }
  
  this.firstBP = 0;
  for (var i=0; i<16; i++) {
    if (this.b[this.bList[i]] == B_PAWN) {
      this.firstBP = i;
      break;
    }
  }
  
  //}}}
}

//}}}
//{{{  .genMoves

lozBoard.prototype.genMoves = function(node, turn) {

  node.numMoves    = 0;
  node.sortedIndex = 0;

  var b = this.b;

  //{{{  colour based stuff
  
  if (turn == WHITE) {
  
    var pOffsetOrth  = WP_OFFSET_ORTH;
    var pOffsetDiag1 = WP_OFFSET_DIAG1;
    var pOffsetDiag2 = WP_OFFSET_DIAG2;
    var pHomeRank    = 2;
    var pPromoteRank = 7;
    var rights       = this.rights & WHITE_RIGHTS;
    var pList        = this.wList;
    var theirKingSq  = this.bList[0];
    var pCount       = this.wCount;
    var CAPTURE      = IS_B;
  
    if (rights) {
  
      if ((rights & WHITE_RIGHTS_KING)  && b[F1] == NULL && b[G1] == NULL                  && !this.isAttacked(F1,BLACK) && !this.isAttacked(E1,BLACK))
        node.addCastle(MOVE_E1G1);
  
      if ((rights & WHITE_RIGHTS_QUEEN) && b[B1] == NULL && b[C1] == NULL && b[D1] == NULL && !this.isAttacked(D1,BLACK) && !this.isAttacked(E1,BLACK))
        node.addCastle(MOVE_E1C1);
    }
  }
  
  else {
  
    var pOffsetOrth  = BP_OFFSET_ORTH;
    var pOffsetDiag1 = BP_OFFSET_DIAG1;
    var pOffsetDiag2 = BP_OFFSET_DIAG2;
    var pHomeRank    = 7;
    var pPromoteRank = 2;
    var rights       = this.rights & BLACK_RIGHTS;
    var pList        = this.bList;
    var theirKingSq  = this.wList[0];
    var pCount       = this.bCount;
    var CAPTURE      = IS_W;
  
    if (rights) {
  
      if ((rights & BLACK_RIGHTS_KING)  && b[F8] == NULL && b[G8] == NULL &&                  !this.isAttacked(F8,WHITE) && !this.isAttacked(E8,WHITE))
        node.addCastle(MOVE_E8G8);
  
      if ((rights & BLACK_RIGHTS_QUEEN) && b[B8] == NULL && b[C8] == NULL && b[D8] == NULL && !this.isAttacked(D8,WHITE) && !this.isAttacked(E8,WHITE))
        node.addCastle(MOVE_E8C8);
    }
  }
  
  //}}}

  var next    = 0;
  var count   = 0;
  var to      = 0;
  var toObj   = 0;
  var fr      = 0;
  var frObj   = 0;
  var frPiece = 0;
  var frMove  = 0;
  var frRank  = 0;

  while (count < pCount) {

    fr = pList[next];
    if (!fr) {
      next++;
      continue;
    }

    frObj   = b[fr];
    frPiece = frObj & PIECE_MASK;
    frMove  = (frObj << MOVE_FROBJ_BITS) | (fr << MOVE_FR_BITS);
    frRank  = RANK[fr];

    if (frPiece == PAWN) {
      //{{{  P
      
      frMove |= MOVE_PAWN_MASK;
      
      to     = fr + pOffsetOrth;
      toObj  = b[to];
      
      if (!toObj) {
      
        if (frRank == pPromoteRank)
          node.addPromotion(frMove | to);
      
        else {
          node.addSlide(frMove | to);
      
          if (frRank == pHomeRank) {
      
            to += pOffsetOrth;
            if (!b[to])
              node.addSlide(frMove | to | MOVE_EPMAKE_MASK);
          }
        }
      }
      
      to    = fr + pOffsetDiag1;
      toObj = b[to];
      
      if (CAPTURE[toObj]) {
      
        if (frRank == pPromoteRank)
          node.addPromotion(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (!toObj && to == this.ep)
        node.addEPTake(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
      to    = fr + pOffsetDiag2;
      toObj = b[to];
      
      if (CAPTURE[toObj]) {
      
        if (frRank == pPromoteRank)
          node.addPromotion(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (!toObj && to == this.ep)
        node.addEPTake(frMove | to);
      
      //}}}
    }

    else if (IS_N[frObj]) {
      //{{{  N
      
      var offsets = OFFSETS[frPiece];
      var dir     = 0;
      
      while (dir < 8) {
      
        to    = fr + offsets[dir++];
        toObj = b[to];
      
        if (!toObj)
          node.addSlide(frMove | to);
        else if (CAPTURE[toObj])
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      //}}}
    }

    else if (IS_K[frObj]) {
      //{{{  K
      
      var offsets = OFFSETS[frPiece];
      var dir     = 0;
      
      while (dir < 8) {
      
        to    = fr + offsets[dir++];
        toObj = b[to];
      
        if (DIST[to][theirKingSq] > 1) {
          if (!toObj)
            node.addSlide(frMove | to);
          else if (CAPTURE[toObj])
            node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        }
      }
      
      //}}}
    }

    else {
      //{{{  BRQ
      
      var offsets = OFFSETS[frPiece];
      var len     = offsets.length;
      var dir     = 0;
      
      while (dir < len) {
      
        var offset = offsets[dir++];
      
        to     = fr + offset;
        toObj  = b[to];
      
        while (!toObj) {
      
          node.addSlide(frMove | to);
      
          to    += offset;
          toObj = b[to];
        }
      
        if (CAPTURE[toObj])
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      //}}}
    }

    next++;
    count++
  }
}

//}}}
//{{{  .genEvasions

lozBoard.prototype.genEvasions = function(node, turn) {

  node.numMoves    = 0;
  node.sortedIndex = 0;

  var b = this.b;

  //{{{  colour based stuff
  
  if (turn == WHITE) {
  
    var pOffsetOrth  = WP_OFFSET_ORTH;
    var pOffsetDiag1 = WP_OFFSET_DIAG1;
    var pOffsetDiag2 = WP_OFFSET_DIAG2;
    var pHomeRank    = 2;
    var pPromoteRank = 8;
    var pList        = this.wList;
    var pCount       = this.wCount;
    var ray          = STARRAY[this.wList[0]];
    var myKing       = W_KING;
    var theirKingSq  = this.bList[0];
  }
  
  else {
  
    var pOffsetOrth  = BP_OFFSET_ORTH;
    var pOffsetDiag1 = BP_OFFSET_DIAG1;
    var pOffsetDiag2 = BP_OFFSET_DIAG2;
    var pHomeRank    = 7;
    var pPromoteRank = 1;
    var pList        = this.bList;
    var pCount       = this.bCount;
    var ray          = STARRAY[this.bList[0]];
    var myKing       = B_KING;
    var theirKingSq  = this.wList[0];
  }
  
  //}}}

  var next  = 0;
  var count = 0;

  while (count < pCount) {

    var fr = pList[next];
    if (!fr) {
      next++;
      continue;
    }

    var frObj   = this.b[fr];
    var frPiece = frObj & PIECE_MASK;
    var frMove  = (frObj << MOVE_FROBJ_BITS) | (fr << MOVE_FR_BITS);
    var rayFrom = ray[fr];

    if (frPiece == PAWN) {
      //{{{  pawn
      
      frMove |= MOVE_PAWN_MASK;
      
      var to        = fr + pOffsetOrth;
      var toObj     = b[to];
      var rayTo     = ray[to];
      var keepSlide = rayTo > 0 && (rayTo != rayFrom) && !CORNERS[to];
      
      if (toObj == NULL) {
      
        if (RANK[to] == pPromoteRank && keepSlide)
          node.addPromotion(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
        else {
          if (keepSlide)
            node.addSlide(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
          if (RANK[fr] == pHomeRank) {
      
            to       += pOffsetOrth;
            toObj     = b[to];
            rayTo     = ray[to];
            keepSlide = rayTo > 0 && (rayTo != rayFrom) && !CORNERS[to];
      
            if (toObj == NULL && keepSlide)
              node.addSlide(frMove | (toObj << MOVE_TOOBJ_BITS) | to | MOVE_EPMAKE_MASK);
          }
        }
      }
      
      var to    = fr + pOffsetDiag1;
      var toObj = b[to];
      var rayTo = ray[to];
      
      if (toObj != NULL && toObj != EDGE && (toObj & COLOR_MASK) != turn && rayTo) {
      
        if (RANK[to] == pPromoteRank)
          node.addPromotion(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (toObj == NULL && to == this.ep && rayTo)
        node.addEPTake(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
      var to    = fr + pOffsetDiag2;
      var toObj = b[to];
      var rayTo = ray[to];
      
      if (toObj != NULL && toObj != EDGE && (toObj & COLOR_MASK) != turn && rayTo) {
      
        if (RANK[to] == pPromoteRank)
          node.addPromotion(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (toObj == NULL && to == this.ep && rayTo)
        node.addEPTake(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
      //}}}
    }

    else {
      //{{{  not a pawn
      
      var offsets = OFFSETS[frPiece];
      var limit   = LIMITS[frPiece];
      
      for (var dir=0; dir < offsets.length; dir++) {
      
        var offset = offsets[dir];
      
        for (var slide=1; slide<=limit; slide++) {
      
          var to    = fr + offset * slide;
          var toObj = b[to];
          var rayTo = ray[to];
      
          if (toObj == NULL) {
            if ((frObj == myKing && DIST[to][theirKingSq] > 1) || ((rayTo > 0 && (rayTo != rayFrom) && !CORNERS[to])))
              node.addSlide(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      
            continue;
          }
      
          if (toObj == EDGE)
            break;
      
          if ((toObj & COLOR_MASK) != turn) {
            if (rayTo)
              node.addCapture(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
          }
      
          break;
        }
      }
      
      //}}}
    }

    next++;
    count++
  }
}

//}}}
//{{{  .genQMoves

lozBoard.prototype.genQMoves = function(node, turn) {

  node.numMoves    = 0;
  node.sortedIndex = 0;

  var b = this.b;

  //{{{  colour based stuff
  
  if (turn == WHITE) {
  
    var pOffsetOrth  = WP_OFFSET_ORTH;
    var pOffsetDiag1 = WP_OFFSET_DIAG1;
    var pOffsetDiag2 = WP_OFFSET_DIAG2;
    var pPromoteRank = 7;
    var pList        = this.wList;
    var theirKingSq  = this.bList[0];
    var pCount       = this.wCount;
    var CAPTURE      = IS_B;
  }
  
  else {
  
    var pOffsetOrth  = BP_OFFSET_ORTH;
    var pOffsetDiag1 = BP_OFFSET_DIAG1;
    var pOffsetDiag2 = BP_OFFSET_DIAG2;
    var pPromoteRank = 2;
    var pList        = this.bList;
    var theirKingSq  = this.wList[0];
    var pCount       = this.bCount;
    var CAPTURE      = IS_W;
  }
  
  //}}}

  var next    = 0;
  var count   = 0;
  var to      = 0;
  var toObj   = 0;
  var fr      = 0;
  var frObj   = 0;
  var frPiece = 0;
  var frMove  = 0;
  var frRank  = 0;

  while (count < pCount) {

    fr = pList[next];
    if (!fr) {
      next++;
      continue;
    }

    frObj   = b[fr];
    frPiece = frObj & PIECE_MASK;
    frMove  = (frObj << MOVE_FROBJ_BITS) | (fr << MOVE_FR_BITS);
    frRank  = RANK[fr];

    if (frPiece == PAWN) {
      //{{{  P
      
      frMove |= MOVE_PAWN_MASK;
      
      to     = fr + pOffsetOrth;
      toObj  = b[to];
      
      if (!toObj) {
      
        if (frRank == pPromoteRank)
          node.addQPromotion(MOVE_PROMOTE_MASK | frMove | to);
      }
      
      to    = fr + pOffsetDiag1;
      toObj = b[to];
      
      if (CAPTURE[toObj]) {
      
        if (frRank == pPromoteRank)
          node.addQPromotion(MOVE_PROMOTE_MASK | frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addQMove(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (!toObj && to == this.ep)
        node.addQMove(MOVE_EPTAKE_MASK | frMove | to);
      
      to    = fr + pOffsetDiag2;
      toObj = b[to];
      
      if (CAPTURE[toObj]) {
      
        if (frRank == pPromoteRank)
          node.addQPromotion(MOVE_PROMOTE_MASK | frMove | (toObj << MOVE_TOOBJ_BITS) | to);
        else
          node.addQMove(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      else if (!toObj && to == this.ep)
        node.addQMove(MOVE_EPTAKE_MASK | frMove | to);
      
      //}}}
    }

    else if (IS_N[frObj]) {
      //{{{  N
      
      var offsets = OFFSETS[frPiece];
      var dir     = 0;
      
      while (dir < 8) {
      
        to    = fr + offsets[dir++];
        toObj = b[to];
      
        if (CAPTURE[toObj])
          node.addQMove(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      //}}}
    }

    else if (IS_K[frObj]) {
      //{{{  K
      
      var offsets = OFFSETS[frPiece];
      var dir     = 0;
      
      while (dir < 8) {
      
        to    = fr + offsets[dir++];
        toObj = b[to];
      
        if (CAPTURE[toObj] && DIST[to][theirKingSq] > 1)
          node.addQMove(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      //}}}
    }

    else {
      //{{{  BRQ
      
      var offsets = OFFSETS[frPiece];
      var len     = offsets.length;
      var dir     = 0;
      
      while (dir < len) {
      
        var offset = offsets[dir++];
      
        to = fr + offset;
      
        while (!b[to])
          to += offset;
      
        toObj = b[to];
      
        if (CAPTURE[toObj])
          node.addQMove(frMove | (toObj << MOVE_TOOBJ_BITS) | to);
      }
      
      //}}}
    }

    next++;
    count++
  }
}

//}}}
//{{{  .makeMove

lozBoard.prototype.makeMove = function (node,move) {

  var b = this.b;
  var z = this.z;

  var fr      = (move & MOVE_FR_MASK   ) >>> MOVE_FR_BITS;
  var to      = (move & MOVE_TO_MASK   ) >>> MOVE_TO_BITS;
  var toObj   = (move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS;
  var frObj   = (move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS;
  var frPiece = frObj & PIECE_MASK;
  var frCol   = frObj & COLOR_MASK;
  var frColI  = frCol >>> 3;

  //{{{  slide piece
  
  b[fr] = NULL;
  b[to] = frObj;
  
  node.frZ = z[fr];
  node.toZ = z[to];
  
  z[fr] = NO_Z;
  z[to] = node.frZ;
  
  this.loHash ^= this.loPieces[frColI][frPiece-1][fr];
  this.hiHash ^= this.hiPieces[frColI][frPiece-1][fr];
  
  this.loHash ^= this.loPieces[frColI][frPiece-1][to];
  this.hiHash ^= this.hiPieces[frColI][frPiece-1][to];
  
  if (frPiece == PAWN) {
    this.ploHash ^= this.loPieces[frColI][PAWN-1][fr];
    this.phiHash ^= this.hiPieces[frColI][PAWN-1][fr];
    this.ploHash ^= this.loPieces[frColI][PAWN-1][to];
    this.phiHash ^= this.hiPieces[frColI][PAWN-1][to];
  }
  
  if (frCol == WHITE) {
  
    this.wList[node.frZ] = to;
  
    this.runningEvalS -= WS_PST[frPiece][fr];
    this.runningEvalS += WS_PST[frPiece][to];
    this.runningEvalE -= WE_PST[frPiece][fr];
    this.runningEvalE += WE_PST[frPiece][to];
  
    this.netwMove(frPiece,fr,to);
  }
  
  else {
  
    this.bList[node.frZ] = to;
  
    this.runningEvalS += BS_PST[frPiece][fr];
    this.runningEvalS -= BS_PST[frPiece][to];
    this.runningEvalE += BE_PST[frPiece][fr];
    this.runningEvalE -= BE_PST[frPiece][to];
  
    this.netbMove(frPiece,fr,to);
  }
  
  //}}}
  //{{{  clear rights?
  
  if (this.rights) {
  
    this.loHash ^= this.loRights[this.rights];
    this.hiHash ^= this.hiRights[this.rights];
  
    this.rights &= MASK_RIGHTS[fr] & MASK_RIGHTS[to];
  
    this.loHash ^= this.loRights[this.rights];
    this.hiHash ^= this.hiRights[this.rights];
  }
  
  //}}}
  //{{{  capture?
  
  if (toObj) {
  
    var toPiece = toObj & PIECE_MASK;
    var toCol   = toObj & COLOR_MASK;
    var toColI  = toCol >>> 3;
  
    this.loHash ^= this.loPieces[toColI][toPiece-1][to];
    this.hiHash ^= this.hiPieces[toColI][toPiece-1][to];
  
    if (toPiece == PAWN) {
      this.ploHash ^= this.loPieces[toColI][PAWN-1][to];
      this.phiHash ^= this.hiPieces[toColI][PAWN-1][to];
    }
  
    this.phase += VPHASE[toPiece];
  
    if (toCol == WHITE) {
  
      this.wList[node.toZ] = EMPTY;
  
      this.runningEvalS -= VALUE_VECTOR[toPiece];
      this.runningEvalS -= WS_PST[toPiece][to];
      this.runningEvalE -= VALUE_VECTOR[toPiece];
      this.runningEvalE -= WE_PST[toPiece][to];
  
      this.wCounts[toPiece]--;
      this.wCount--;
  
      this.netwDel(toPiece,to);
    }
  
    else {
  
      this.bList[node.toZ] = EMPTY;
  
      this.runningEvalS += VALUE_VECTOR[toPiece];
      this.runningEvalS += BS_PST[toPiece][to];
      this.runningEvalE += VALUE_VECTOR[toPiece];
      this.runningEvalE += BE_PST[toPiece][to];
  
      this.bCounts[toPiece]--;
      this.bCount--;
  
      this.netbDel(toPiece,to);
    }
  }
  
  //}}}
  //{{{  reset EP
  
  this.loHash ^= this.loEP[this.ep];
  this.hiHash ^= this.hiEP[this.ep];
  
  this.ep = 0;
  
  this.loHash ^= this.loEP[this.ep];
  this.hiHash ^= this.hiEP[this.ep];
  
  //}}}

  if (move & MOVE_SPECIAL_MASK) {
    //{{{  ikky stuff
    
    if (frCol == WHITE) {
    
      //{{{  white
      
      var ep = to + 12;
      
      if (move & MOVE_EPMAKE_MASK) {
      
        this.loHash ^= this.loEP[this.ep];
        this.hiHash ^= this.hiEP[this.ep];
      
        this.ep = ep;
      
        this.loHash ^= this.loEP[this.ep];
        this.hiHash ^= this.hiEP[this.ep];
      }
      
      else if (move & MOVE_EPTAKE_MASK) {
      
        b[ep]    = NULL;
        node.epZ = z[ep];
        z[ep]    = NO_Z;
      
        this.bList[node.epZ] = EMPTY;
      
        this.loHash ^= this.loPieces[I_BLACK][PAWN-1][ep];
        this.hiHash ^= this.hiPieces[I_BLACK][PAWN-1][ep];
      
        this.ploHash ^= this.loPieces[I_BLACK][PAWN-1][ep];
        this.phiHash ^= this.hiPieces[I_BLACK][PAWN-1][ep];
      
        this.runningEvalS += VALUE_PAWN;
        this.runningEvalS += BS_PST[PAWN][ep];  // sic.
        this.runningEvalE += VALUE_PAWN;
        this.runningEvalE += BE_PST[PAWN][ep];  // sic.
      
        this.bCounts[PAWN]--;
        this.bCount--;
      
        this.netbDel(PAWN,ep);
      }
      
      else if (move & MOVE_PROMOTE_MASK) {
      
        var pro = ((move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS) + 2;  //NBRQ
        b[to]   = WHITE | pro;
      
        this.loHash ^= this.loPieces[I_WHITE][PAWN-1][to];
        this.hiHash ^= this.hiPieces[I_WHITE][PAWN-1][to];
        this.loHash ^= this.loPieces[I_WHITE][pro-1][to];
        this.hiHash ^= this.hiPieces[I_WHITE][pro-1][to];
      
        this.ploHash ^= this.loPieces[0][PAWN-1][to];
        this.phiHash ^= this.hiPieces[0][PAWN-1][to];
      
        this.runningEvalS -= VALUE_PAWN;
        this.runningEvalS -= WS_PST[PAWN][to];
        this.runningEvalE -= VALUE_PAWN;
        this.runningEvalE -= WE_PST[PAWN][to];
      
        this.wCounts[PAWN]--;
      
        this.runningEvalS += VALUE_VECTOR[pro];
        this.runningEvalS += WS_PST[pro][to];
        this.runningEvalE += VALUE_VECTOR[pro];
        this.runningEvalE += WE_PST[pro][to];
      
        this.wCounts[pro]++;
      
        this.phase -= VPHASE[pro];
      
        this.netwDel(PAWN,to);
        this.netwAdd(pro,to);
      }
      
      else if (move == MOVE_E1G1) {
      
        b[H1] = NULL;
        b[F1] = W_ROOK;
        z[F1] = z[H1];
        z[H1] = NO_Z;
      
        this.wList[z[F1]] = F1;
      
        this.loHash ^= this.loPieces[I_WHITE][ROOK-1][H1];
        this.hiHash ^= this.hiPieces[I_WHITE][ROOK-1][H1];
        this.loHash ^= this.loPieces[I_WHITE][ROOK-1][F1];
        this.hiHash ^= this.hiPieces[I_WHITE][ROOK-1][F1];
      
        this.runningEvalS -= WS_PST[ROOK][H1];
        this.runningEvalS += WS_PST[ROOK][F1];
        this.runningEvalE -= WE_PST[ROOK][H1];
        this.runningEvalE += WE_PST[ROOK][F1];
      
        this.netwMove(ROOK,H1,F1)
        //this.netwMove(KING,E1,G1)
      }
      
      else if (move == MOVE_E1C1) {
      
        b[A1] = NULL;
        b[D1] = W_ROOK;
        z[D1] = z[A1];
        z[A1] = NO_Z;
      
        this.wList[z[D1]] = D1;
      
        this.loHash ^= this.loPieces[I_WHITE][ROOK-1][A1];
        this.hiHash ^= this.hiPieces[I_WHITE][ROOK-1][A1];
        this.loHash ^= this.loPieces[I_WHITE][ROOK-1][D1];
        this.hiHash ^= this.hiPieces[I_WHITE][ROOK-1][D1];
      
        this.runningEvalS -= WS_PST[ROOK][A1];
        this.runningEvalS += WS_PST[ROOK][D1];
        this.runningEvalE -= WE_PST[ROOK][A1];
        this.runningEvalE += WE_PST[ROOK][D1];
      
        this.netwMove(ROOK,A1,D1)
        //this.netwMove(KING,E1,C1)
      }
      
      //}}}
    }
    
    else {
    
      //{{{  black
      
      var ep = to - 12;
      
      if (move & MOVE_EPMAKE_MASK) {
      
        this.loHash ^= this.loEP[this.ep];
        this.hiHash ^= this.hiEP[this.ep];
      
        this.ep = ep;
      
        this.loHash ^= this.loEP[this.ep];
        this.hiHash ^= this.hiEP[this.ep];
      }
      
      else if (move & MOVE_EPTAKE_MASK) {
      
        b[ep]    = NULL;
        node.epZ = z[ep];
        z[ep]    = NO_Z;
      
        this.wList[node.epZ] = EMPTY;
      
        this.loHash ^= this.loPieces[I_WHITE][PAWN-1][ep];
        this.hiHash ^= this.hiPieces[I_WHITE][PAWN-1][ep];
      
        this.ploHash ^= this.loPieces[I_WHITE][PAWN-1][ep];
        this.phiHash ^= this.hiPieces[I_WHITE][PAWN-1][ep];
      
        this.runningEvalS -= VALUE_PAWN;
        this.runningEvalS -= WS_PST[PAWN][ep];  // sic.
        this.runningEvalE -= VALUE_PAWN;
        this.runningEvalE -= WE_PST[PAWN][ep];  // sic.
      
        this.wCounts[PAWN]--;
        this.wCount--;
      
        this.netwDel(PAWN,ep);
      }
      
      else if (move & MOVE_PROMOTE_MASK) {
      
        var pro = ((move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS) + 2;  //NBRQ
        b[to]   = BLACK | pro;
      
        this.loHash ^= this.loPieces[I_BLACK][PAWN-1][to];
        this.hiHash ^= this.hiPieces[I_BLACK][PAWN-1][to];
        this.loHash ^= this.loPieces[I_BLACK][pro-1][to];
        this.hiHash ^= this.hiPieces[I_BLACK][pro-1][to];
      
        this.ploHash ^= this.loPieces[I_BLACK][PAWN-1][to];
        this.phiHash ^= this.hiPieces[I_BLACK][PAWN-1][to];
      
        this.runningEvalS += VALUE_PAWN;
        this.runningEvalS += BS_PST[PAWN][to];
        this.runningEvalE += VALUE_PAWN;
        this.runningEvalE += BE_PST[PAWN][to];
      
        this.bCounts[PAWN]--;
      
        this.runningEvalS -= VALUE_VECTOR[pro];
        this.runningEvalS -= BS_PST[pro][to];
        this.runningEvalE -= VALUE_VECTOR[pro];
        this.runningEvalE -= BE_PST[pro][to];
      
        this.bCounts[pro]++;
      
        this.phase -= VPHASE[pro];
      
        this.netbDel(PAWN,to);
        this.netbAdd(pro,to);
      }
      
      else if (move == MOVE_E8G8) {
      
        b[H8] = NULL;
        b[F8] = B_ROOK;
        z[F8] = z[H8];
        z[H8] = NO_Z;
      
        this.bList[z[F8]] = F8;
      
        this.loHash ^= this.loPieces[I_BLACK][ROOK-1][H8];
        this.hiHash ^= this.hiPieces[I_BLACK][ROOK-1][H8];
        this.loHash ^= this.loPieces[I_BLACK][ROOK-1][F8];
        this.hiHash ^= this.hiPieces[I_BLACK][ROOK-1][F8];
      
        this.runningEvalS += BS_PST[ROOK][H8];
        this.runningEvalS -= BS_PST[ROOK][F8];
        this.runningEvalE += BE_PST[ROOK][H8];
        this.runningEvalE -= BE_PST[ROOK][F8];
      
        this.netbMove(ROOK,H8,F8)
        //this.netbMove(KING,E8,G8)
      }
      
      else if (move == MOVE_E8C8) {
      
        b[A8] = NULL;
        b[D8] = B_ROOK;
        z[D8] = z[A8];
        z[A8] = NO_Z;
      
        this.bList[z[D8]] = D8;
      
        this.loHash ^= this.loPieces[I_BLACK][ROOK-1][A8];
        this.hiHash ^= this.hiPieces[I_BLACK][ROOK-1][A8];
        this.loHash ^= this.loPieces[I_BLACK][ROOK-1][D8];
        this.hiHash ^= this.hiPieces[I_BLACK][ROOK-1][D8];
      
        this.runningEvalS += BS_PST[ROOK][A8];
        this.runningEvalS -= BS_PST[ROOK][D8];
        this.runningEvalE += BE_PST[ROOK][A8];
        this.runningEvalE -= BE_PST[ROOK][D8];
      
        this.netbMove(ROOK,A8,D8)
        //this.netbMove(KING,E8,C8)
      }
      
      //}}}
    }
    
    //}}}
  }

  //{{{  flip turn in hash
  
  this.loHash ^= this.loTurn;
  this.hiHash ^= this.hiTurn;
  
  //}}}
  //{{{  push rep hash
  //
  //  Repetitions are cancelled by pawn moves, castling, captures, EP
  //  and promotions; i.e. moves that are not reversible.  The nearest
  //  repetition is 5 indexes back from the current one and then that
  //  and every other one entry is a possible rep.  Can also check for
  //  50 move rule by testing hi-lo > 100 - it's not perfect because of
  //  the pawn move reset but it's a type 2 error, so safe.
  //
  
  this.repLoHash[this.repHi] = this.loHash;
  this.repHiHash[this.repHi] = this.hiHash;
  
  this.repHi++;
  
  if ((move & (MOVE_SPECIAL_MASK | MOVE_TOOBJ_MASK)) || frPiece == PAWN)
    this.repLo = this.repHi;
  
  //}}}
}

//}}}
//{{{  .unmakeMove

lozBoard.prototype.unmakeMove = function (node,move) {

  var b = this.b;
  var z = this.z;

  var fr    = (move & MOVE_FR_MASK   ) >>> MOVE_FR_BITS;
  var to    = (move & MOVE_TO_MASK   ) >>> MOVE_TO_BITS;
  var toObj = (move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS;
  var frObj = (move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS;
  var frCol = frObj & COLOR_MASK;

  b[fr] = frObj;
  b[to] = toObj;

  z[fr] = node.frZ;
  z[to] = node.toZ;

  if (frCol == WHITE)
    this.wList[node.frZ] = fr;
  else
    this.bList[node.frZ] = fr;

  //{{{  capture?
  
  if (toObj) {
  
    var toPiece = toObj & PIECE_MASK;
    var toCol   = toObj & COLOR_MASK;
  
    this.phase -= VPHASE[toPiece];
  
    if (toCol == WHITE) {
  
      this.wList[node.toZ] = to;
  
      this.wCounts[toPiece]++;
      this.wCount++;
    }
  
    else {
  
      this.bList[node.toZ] = to;
  
      this.bCounts[toPiece]++;
      this.bCount++;
    }
  }
  
  //}}}

  if (move & MOVE_SPECIAL_MASK) {
    //{{{  ikky stuff
    
    if ((frObj & COLOR_MASK) == WHITE) {
    
      var ep = to + 12;
    
      if (move & MOVE_EPTAKE_MASK) {
    
        b[ep] = B_PAWN;
        z[ep] = node.epZ;
    
        this.bList[node.epZ] = ep;
    
        this.bCounts[PAWN]++;
        this.bCount++;
      }
    
      else if (move & MOVE_PROMOTE_MASK) {
    
        var pro = ((move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS) + 2;  //NBRQ
    
        this.wCounts[PAWN]++;
        this.wCounts[pro]--;
    
        this.phase += VPHASE[pro];
      }
    
      else if (move == MOVE_E1G1) {
    
        b[H1] = W_ROOK;
        b[F1] = NULL;
        z[H1] = z[F1];
        z[F1] = NO_Z;
    
        this.wList[z[H1]] = H1;
      }
    
      else if (move == MOVE_E1C1) {
    
        b[A1] = W_ROOK;
        b[D1] = NULL;
        z[A1] = z[D1];
        z[D1] = NO_Z;
    
        this.wList[z[A1]] = A1;
      }
    }
    
    else {
    
      var ep = to - 12;
    
      if (move & MOVE_EPTAKE_MASK) {
    
        b[ep] = W_PAWN;
        z[ep] = node.epZ;
    
        this.wList[node.epZ] = ep;
    
        this.wCounts[PAWN]++;
        this.wCount++;
      }
    
      else if (move & MOVE_PROMOTE_MASK) {
    
        var pro = ((move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS) + 2;  //NBRQ
    
        this.bCounts[PAWN]++;
        this.bCounts[pro]--;
    
        this.phase += VPHASE[pro];
      }
    
      else if (move == MOVE_E8G8) {
    
        b[H8] = B_ROOK;
        b[F8] = NULL;
        z[H8] = z[F8];
        z[F8] = NO_Z;
    
        this.bList[z[H8]] = H8;
      }
    
      else if (move == MOVE_E8C8) {
    
        b[A8] = B_ROOK;
        b[D8] = NULL;
        z[A8] = z[D8];
        z[D8] = NO_Z;
    
        this.bList[z[A8]] = A8;
      }
    }
    
    //}}}
  }
}

//}}}
//{{{  .isKingAttacked

lozBoard.prototype.isKingAttacked = function(byCol) {

  return this.isAttacked((byCol == WHITE) ? this.bList[0] : this.wList[0], byCol);
}

//}}}
//{{{  .isAttacked

lozBoard.prototype.isAttacked = function(to, byCol) {

  var b  = this.b;
  var fr = 0;

  //{{{  colour stuff
  
  if (byCol == WHITE) {
  
    if (b[to+13] == W_PAWN || b[to+11] == W_PAWN)
      return 1;
  
    var RQ = IS_WRQ;
    var BQ = IS_WBQ;
  }
  
  else {
  
    if (b[to-13] == B_PAWN || b[to-11] == B_PAWN)
      return 1;
  
    var RQ = IS_BRQ;
    var BQ = IS_BBQ;
  }
  
  var knight = KNIGHT | byCol;
  var king   = KING   | byCol;
  
  //}}}

  //{{{  knights
  
  if (b[to + -10] == knight) return 1;
  if (b[to + -23] == knight) return 1;
  if (b[to + -14] == knight) return 1;
  if (b[to + -25] == knight) return 1;
  if (b[to +  10] == knight) return 1;
  if (b[to +  23] == knight) return 1;
  if (b[to +  14] == knight) return 1;
  if (b[to +  25] == knight) return 1;
  
  //}}}
  //{{{  queen, bishop, rook
  
  fr = to + 1;  while (!b[fr]) fr += 1;  if (RQ[b[fr]]) return 1;
  fr = to - 1;  while (!b[fr]) fr -= 1;  if (RQ[b[fr]]) return 1;
  fr = to + 12; while (!b[fr]) fr += 12; if (RQ[b[fr]]) return 1;
  fr = to - 12; while (!b[fr]) fr -= 12; if (RQ[b[fr]]) return 1;
  fr = to + 11; while (!b[fr]) fr += 11; if (BQ[b[fr]]) return 1;
  fr = to - 11; while (!b[fr]) fr -= 11; if (BQ[b[fr]]) return 1;
  fr = to + 13; while (!b[fr]) fr += 13; if (BQ[b[fr]]) return 1;
  fr = to - 13; while (!b[fr]) fr -= 13; if (BQ[b[fr]]) return 1;
  
  //}}}
  //{{{  kings
  
  if (b[to + -11] == king) return 1;
  if (b[to + -13] == king) return 1;
  if (b[to + -12] == king) return 1;
  if (b[to + -1 ] == king) return 1;
  if (b[to +  11] == king) return 1;
  if (b[to +  13] == king) return 1;
  if (b[to +  12] == king) return 1;
  if (b[to +  1 ] == king) return 1;
  
  //}}}

  return 0;
}


//}}}
//{{{  .formatMove

lozBoard.prototype.formatMove = function (move, fmt) {

  if (move == 0)
    return 'NULL';

  var fr    = (move & MOVE_FR_MASK   ) >>> MOVE_FR_BITS;
  var to    = (move & MOVE_TO_MASK   ) >>> MOVE_TO_BITS;
  var toObj = (move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS;
  var frObj = (move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS;

  var frCoord = COORDS[fr];
  var toCoord = COORDS[to];

  var frPiece = frObj & PIECE_MASK;
  var frCol   = frObj & COLOR_MASK;
  var frName  = NAMES[frPiece];

  var toPiece = toObj & PIECE_MASK;
  var toCol   = toObj & COLOR_MASK;
  var toName  = NAMES[toPiece];

  if (move & MOVE_PROMOTE_MASK)
    var pro = PROMOTES[(move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS];
  else
    var pro = '';

  if (fmt == UCI_FMT)
    return frCoord + toCoord + pro;

  if (pro)
    pro = '=' + pro.toUpperCase();

  if (toObj != NULL) {
    if (frPiece == PAWN)
      return frCoord + 'x' + toCoord + pro;
    else
      return frName + 'x' + toCoord;
  }

  if (frPiece == PAWN)
    return toCoord + pro;

  if (move == MOVE_E1G1 || move == MOVE_E8G8)
    return 'O-O';

  if (move == MOVE_E1C1 || move == MOVE_E8C8)
    return 'O-O-O';

  return frName + toCoord;

}

//}}}
//{{{  .evaluate

var MOB_NIS = IS_NBRQKE;
var MOB_BIS = IS_NBRQKE;
var MOB_RIS = IS_RQKE;
var MOB_QIS = IS_QKE;

var ATT_L = 7;

lozBoard.prototype.evaluate = function (turn) {

  //this.hashCheck(turn);

  //{{{  init
  
  var uci = this.lozza.uci;
  var b   = this.b;
  
  var phase = this.cleanPhase(this.phase);
  
  var numPieces = this.wCount + this.bCount;
  
  var wNumQueens  = this.wCounts[QUEEN];
  var wNumRooks   = this.wCounts[ROOK];
  var wNumBishops = this.wCounts[BISHOP];
  var wNumKnights = this.wCounts[KNIGHT];
  var wNumPawns   = this.wCounts[PAWN];
  
  var bNumQueens  = this.bCounts[QUEEN];
  var bNumRooks   = this.bCounts[ROOK];
  var bNumBishops = this.bCounts[BISHOP];
  var bNumKnights = this.bCounts[KNIGHT];
  var bNumPawns   = this.bCounts[PAWN];
  
  var wKingSq   = this.wList[0];
  var wKingRank = RANK[wKingSq];
  var wKingFile = FILE[wKingSq];
  
  var bKingSq   = this.bList[0];
  var bKingRank = RANK[bKingSq];
  var bKingFile = FILE[bKingSq];
  
  var wKingBits = (wKingFile-1) << 2;
  var wKingMask = 0xF << wKingBits;
  
  var bKingBits = (bKingFile-1) << 2;
  var bKingMask = 0xF << bKingBits;
  
  var bonus   = 0;  // generic.
  var penalty = 0;  // generic.
  
  var WKZ = WKZONES[wKingSq];
  var BKZ = BKZONES[bKingSq];
  
  var wCanBeAttacked = bNumQueens && (bNumRooks || bNumBishops || bNumKnights);
  var bCanBeAttacked = wNumQueens && (wNumRooks || wNumBishops || wNumKnights);
  
  //}}}
  //{{{  draw?
  
  //todo - lots more here and drawish.
  
  if (numPieces == 2)                                                                  // K v K.
    return CONTEMPT;
  
  if (numPieces == 3 && (wNumKnights || wNumBishops || bNumKnights || bNumBishops))    // K v K+N|B.
    return CONTEMPT;
  
  if (numPieces == 4 && (wNumKnights || wNumBishops) && (bNumKnights || bNumBishops))  // K+N|B v K+N|B.
    return CONTEMPT;
  
  if (numPieces == 4 && (wNumKnights == 2 || bNumKnights == 2))                        // K v K+NN.
    return CONTEMPT;
  
  if (numPieces == 5 && wNumKnights == 2 && (bNumKnights || bNumBishops))              //
    return CONTEMPT;                                                                   //
                                                                                       // K+N|B v K+NN
  if (numPieces == 5 && bNumKnights == 2 && (wNumKnights || wNumBishops))              //
    return CONTEMPT;                                                                   //
  
  if (numPieces == 5 && wNumBishops == 2 && bNumBishops)                               //
    return CONTEMPT;                                                                   //
                                                                                       // K+B v K+BB
  if (numPieces == 5 && bNumBishops == 2 && wNumBishops)                               //
    return CONTEMPT;                                                                   //
  
  if (numPieces == 4 && wNumRooks && bNumRooks)                                        // K+R v K+R.
    return CONTEMPT;
  
  if (numPieces == 4 && wNumQueens && bNumQueens)                                      // K+Q v K+Q.
    return CONTEMPT;
  
  //}}}

  var hceE = 0;
  var netE = 0;
  var E    = 0;

  if (USEHCE) {
    //{{{  hce
    
    //{{{  P
    
    //{{{  vars valid if hash used or not
    
    var pawnsS = 0;            // pawn eval.
    var pawnsE = 0;
    
    var wPassed = 0;
    var bPassed = 0;
    
    var wHome   = 0;           // non zero if >= 1 W pawn on home rank.
    var bHome   = 0;           // non zero if >= 1 B pawn on home rank.
    
    var wLeast  = 0x99999999;  // rank of least advanced pawns per file.
    var bLeast  = 0x00000000;  // rank of least advanced pawns per file.
    
    var wMost   = 0x00000000;  // rank of most advanced pawns per file.
    var bMost   = 0x99999999;  // rank of most advanced pawns per file.
    
    var wLeastL = 0;           // wLeast << 4.
    var bLeastL = 0;
    
    var wMostL  = 0;
    var bMostL  = 0;
    
    var wLeastR = 0;           // wLeast >>> 4.
    var bLeastR = 0;
    
    var wMostR  = 0;
    var bMostR  = 0;
    
    //}}}
    
    var idx   = this.ploHash & PTTMASK;
    var flags = this.pttFlags[idx];
    
    if (USEPAWNHASH && (flags & PTT_EXACT) && this.pttLo[idx] == this.ploHash && this.pttHi[idx] == this.phiHash) {
      //{{{  get tt
      
      pawnsS = this.pttScoreS[idx];
      pawnsE = this.pttScoreE[idx];
      
      wLeast = this.pttwLeast[idx];
      bLeast = this.pttbLeast[idx];
      
      wMost  = this.pttwMost[idx];
      bMost  = this.pttbMost[idx];
      
      wHome  = flags & PTT_WHOME;
      bHome  = flags & PTT_BHOME;
      
      wPassed  = flags & PTT_WPASS;
      bPassed  = flags & PTT_BPASS;
      
      wLeastR = (wLeast >>> 4) | 0x90000000;
      wLeastL = (wLeast <<  4) | 0x00000009;
      
      wMostR = (wMost >>> 4);
      wMostL = (wMost <<  4);
      
      bLeastR = bLeast >>> 4;
      bLeastL = bLeast <<  4;
      
      bMostR = (bMost >>> 4) | 0x90000000;
      bMostL = (bMost <<  4) | 0x00000009;
      
      //}}}
    }
    
    else {
      //{{{  phase 1
      
      //{{{  white
      
      var next  = this.firstWP;
      var count = 0;
      
      while (count < wNumPawns) {
      
        var sq = this.wList[next];
      
        if (!sq || b[sq] != W_PAWN) {
          next++;
          continue;
        }
      
        var rank   = RANK[sq];
        var file   = FILE[sq];
        var bits   = (file-1) << 2;
        var mask   = 0xF << bits;
        var lRank  = (wLeast & mask) >>> bits;
        var mRank  = (wMost  & mask) >>> bits;
      
        if (lRank != 9) {
          pawnsS -= PAWN_DOUBLED_S;
          pawnsE -= PAWN_DOUBLED_E;
        }
      
        if (rank < lRank)
          wLeast = (wLeast & ~mask) | (rank << bits);
      
        if (rank > mRank)
          wMost  = (wMost  & ~mask) | (rank << bits);
      
        if (rank == 2)
          wHome = PTT_WHOME;
      
        count++;
        next++
      }
      
      wLeastR = (wLeast >>> 4) | 0x90000000;
      wLeastL = (wLeast <<  4) | 0x00000009;
      
      wMostR  = (wMost >>> 4);
      wMostL  = (wMost <<  4);
      
      //}}}
      //{{{  black
      
      var next  = this.firstBP;
      var count = 0;
      
      while (count < bNumPawns) {
      
        var sq = this.bList[next];
      
        if (!sq || b[sq] != B_PAWN) {
          next++;
          continue;
        }
      
        var rank   = RANK[sq];
        var file   = FILE[sq];
        var bits   = (file-1) << 2;
        var mask   = 0xF << bits;
        var lRank  = (bLeast & mask) >>> bits;
        var mRank  = (bMost  & mask) >>> bits;
      
        if (lRank != 0) {
      
          pawnsS += PAWN_DOUBLED_S;
          pawnsE += PAWN_DOUBLED_E;
        }
      
        if (rank > lRank)
          bLeast = (bLeast & ~mask) | (rank << bits);
      
        if (rank < mRank)
          bMost  = (bMost & ~mask)  | (rank << bits);
      
        if (rank == 7)
          bHome = PTT_BHOME;
      
        count++;
        next++
      }
      
      bLeastR = bLeast >>> 4;
      bLeastL = bLeast <<  4;
      
      bMostR  = (bMost >>> 4) | 0x90000000;
      bMostL  = (bMost <<  4) | 0x00000009;
      
      //}}}
      
      //}}}
      //{{{  phase 2
      
      //{{{  white
      
      var next  = this.firstWP;
      var count = 0;
      
      while (count < wNumPawns) {
      
        var sq = this.wList[next];
      
        if (!sq || b[sq] != W_PAWN) {
          next++;
          continue;
        }
      
        var file  = FILE[sq];
        var bits  = (file-1) << 2;
        var rank  = RANK[sq];
        var open  = 0;
      
        if ((wMost >>> bits & 0xF) == rank && (bLeast >>> bits & 0xF) < rank) {
          open = 1;
        }
      
        if ((wLeastL >>> bits & 0xF) == 9 && (wLeastR >>> bits & 0xF) == 9) {
          pawnsS -= PAWN_ISOLATED_S + PAWN_ISOLATED_S * open;
          pawnsE -= PAWN_ISOLATED_E;
        }
      
        else if ((wLeastL >>> bits & 0xF) > rank && (wLeastR >>> bits & 0xF) > rank) {
          var backward = true;
          if ((IS_WP[b[sq-11]] || IS_WP[b[sq-13]]) && !IS_P[b[sq-12]] && !IS_BP[b[sq-11]] && !IS_BP[b[sq-13]] && !IS_BP[b[sq-23]] && !IS_BP[b[sq-25]])
            backward = false;
          else if (rank == 2 && (IS_WP[b[sq-23]] || IS_WP[b[sq-25]]) && !IS_P[b[sq-12]] && !IS_P[b[sq-24]] && !IS_BP[b[sq-11]] && !IS_BP[b[sq-13]] && !IS_BP[b[sq-23]] && !IS_BP[b[sq-25]] && !IS_BP[b[sq-37]] && !IS_BP[b[sq-35]])
            backward = false;
          if (backward) {
            pawnsS -= PAWN_BACKWARD_S + PAWN_BACKWARD_S * open;
            pawnsE -= PAWN_BACKWARD_E;
          }
        }
      
        if (open) {
          if ((bLeastL >>> bits & 0xF) <= rank && (bLeastR >>> bits & 0xF) <= rank) {
            wPassed = PTT_WPASS;
          }
          else {
            var defenders = 0;
            var sq2       = sq;
            while (b[sq2] != EDGE) {
              defenders += IS_WP[b[sq2+1]];
              defenders += IS_WP[b[sq2-1]];
              sq2 += 12;
            }
            var attackers = 0;
            var sq2       = sq-12;
            while (b[sq2] != EDGE) {
              attackers += IS_BP[b[sq2+1]];
              attackers += IS_BP[b[sq2-1]];
              sq2 -= 12;
            }
            if (defenders >= attackers) {
              defenders = IS_WP[b[sq+11]] + IS_WP[b[sq+13]];
              attackers = IS_BP[b[sq-11]] + IS_BP[b[sq-13]];
              if (defenders >= attackers) {
                pawnsS += PAWN_PASSED_OFFSET_S + PAWN_PASSED_MULT_S * PAWN_PASSED[rank] | 0;
                pawnsE += PAWN_PASSED_OFFSET_E + PAWN_PASSED_MULT_E * PAWN_PASSED[rank] | 0;
              }
            }
          }
        }
      
        count++;
        next++
      }
      
      //}}}
      //{{{  black
      
      var next  = this.firstBP;
      var count = 0;
      
      while (count < bNumPawns) {
      
        var sq = this.bList[next];
      
        if (!sq || b[sq] != B_PAWN) {
          next++;
          continue;
        }
      
        var file  = FILE[sq];
        var bits  = (file-1) << 2;
        var rank  = RANK[sq];
        var open  = 0;
      
        if ((bMost >>> bits & 0xF) == rank && (wLeast >>> bits & 0xF) > rank) {
          open = 1;
        }
      
        if ((bLeastL >>> bits & 0xF) == 0x0 && (bLeastR >>> bits & 0xF) == 0x0) {
          pawnsS += PAWN_ISOLATED_S + PAWN_ISOLATED_S * open;
          pawnsE += PAWN_ISOLATED_E;
        }
      
        else if ((bLeastL >>> bits & 0xF) < rank && (bLeastR >>> bits & 0xF) < rank) {
          var backward = true;
          if ((IS_BP[b[sq+11]] || IS_BP[b[sq+13]]) && !IS_P[b[sq+12]] && !IS_WP[b[sq+11]] && !IS_WP[b[sq+13]] && !IS_WP[b[sq+23]] && !IS_WP[b[sq+25]])
            backward = false;
          else if (rank == 7 && (IS_BP[b[sq+23]] || IS_BP[b[sq+25]]) && !IS_P[b[sq+12]] && !IS_P[b[sq+24]] && !IS_WP[b[sq+11]] && !IS_WP[b[sq+13]] && !IS_WP[b[sq+23]] && !IS_WP[b[sq+25]] && !IS_WP[b[sq+37]] && !IS_WP[b[sq+35]])
            backward = false;
          if (backward) {
            pawnsS += PAWN_BACKWARD_S + PAWN_BACKWARD_S * open;
            pawnsE += PAWN_BACKWARD_E;
          }
        }
      
        if (open) {
          if ((wLeastL >>> bits & 0xF) >= rank && (wLeastR >>> bits & 0xF) >= rank) {
            bPassed = PTT_BPASS;
          }
          else {
            var defenders = 0;
            var sq2       = sq;
            while (b[sq2] != EDGE) {
              defenders += IS_BP[b[sq2+1]];
              defenders += IS_BP[b[sq2-1]];
              sq2 -= 12;
            }
            var attackers = 0;
            var sq2       = sq+12;
            while (b[sq2] != EDGE) {
              attackers += IS_WP[b[sq2+1]];
              attackers += IS_WP[b[sq2-1]];
              sq2 += 12;
            }
            if (defenders >= attackers) {
              defenders = IS_BP[b[sq-11]] + IS_BP[b[sq-13]];
              attackers = IS_WP[b[sq+11]] + IS_WP[b[sq+13]];
              if (defenders >= attackers) {
                pawnsS -= PAWN_PASSED_OFFSET_S + PAWN_PASSED_MULT_S * PAWN_PASSED[9-rank] | 0;
                pawnsE -= PAWN_PASSED_OFFSET_E + PAWN_PASSED_MULT_E * PAWN_PASSED[9-rank] | 0;
              }
            }
          }
        }
      
        count++;
        next++
      }
      
      //}}}
      
      //}}}
      //{{{  put tt
      
      this.pttFlags[idx]  = PTT_EXACT | wHome | bHome | wPassed | bPassed;
      
      this.pttLo[idx]     = this.ploHash;
      this.pttHi[idx]     = this.phiHash;
      
      this.pttScoreS[idx] = pawnsS;
      this.pttScoreE[idx] = pawnsE;
      
      this.pttwLeast[idx] = wLeast;
      this.pttbLeast[idx] = bLeast;
      
      this.pttwMost[idx]  = wMost;
      this.pttbMost[idx]  = bMost;
      
      //}}}
    }
    
    //{{{  phase 3
    //
    // Only pawns are included in the hash, so evaluation taht includes other
    // pieces must be onde here.
    //
    
    //{{{  white
    
    if (wPassed) {
    
      var next  = this.firstWP;
      var count = 0;
    
      while (count < wNumPawns) {
    
        var sq = this.wList[next];
    
        if (!sq || b[sq] != W_PAWN) {
          next++;
          continue;
        }
    
        var file  = FILE[sq];
        var bits  = (file-1) << 2;
        var rank  = RANK[sq];
        var sq2   = sq-12;
    
        if ((wMost >>> bits & 0xF) == rank && (bLeast >>> bits & 0xF) < rank) {  // open.
          if ((bLeastL >>> bits & 0xF) <= rank && (bLeastR >>> bits & 0xF) <= rank) {  // passed.
    
            //{{{  king dist
            
            var passKings = PAWN_PASS_KING1 * DIST[bKingSq][sq2] - PAWN_PASS_KING2 * DIST[wKingSq][sq2];
            
            //}}}
            //{{{  attacked?
            
            var passFree = 0;
            
            if (!b[sq2])
              passFree = PAWN_PASS_FREE * (!this.isAttacked(sq2,BLACK)|0);
            
            //}}}
            //{{{  unstoppable
            
            var passUnstop    = 0;
            var oppoOnlyPawns = bNumPawns + 1 == this.bCount;
            
            if (oppoOnlyPawns) {
            
              var promSq = W_PROMOTE_SQ[file];
            
              if (DIST[wKingSq][sq] <= 1 && DIST[wKingSq][promSq] <= 1)
                passUnstop = PAWN_PASS_UNSTOP;
            
              else if (DIST[sq][promSq] < DIST[bKingSq][promSq] + ((turn==WHITE)|0) - 1) {  // oppo cannot get there
            
                var blocked = 0;
                while(!b[sq2])
                  sq2 -= 12;
                if (b[sq2] == EDGE)
                  passUnstop = PAWN_PASS_UNSTOP;
              }
            }
            
            //}}}
    
            pawnsS += PAWN_OFFSET_S + (PAWN_MULT_S                                    ) * PAWN_PASSED[rank] | 0;
            pawnsE += PAWN_OFFSET_E + (PAWN_MULT_E + passKings + passFree + passUnstop) * PAWN_PASSED[rank] | 0;
    
            //console.log('W PASS',COORDS[sq],'Kdist,free,unstop=',passKings,passFree,passUnstop);
          }
        }
        count++;
        next++
      }
    }
    
    //}}}
    //{{{  black
    
    if (bPassed) {
    
      var next  = this.firstBP;
      var count = 0;
    
      while (count < bNumPawns) {
    
        var sq = this.bList[next];
    
        if (!sq || b[sq] != B_PAWN) {
          next++;
          continue;
        }
    
        var file  = FILE[sq];
        var bits  = (file-1) << 2;
        var rank  = RANK[sq];
        var sq2   = sq+12;
    
        if ((bMost >>> bits & 0xF) == rank && (wLeast >>> bits & 0xF) > rank) {  // open.
          if ((wLeastL >>> bits & 0xF) >= rank && (wLeastR >>> bits & 0xF) >= rank) {  // passed.
            //{{{  king dist
            
            var passKings = PAWN_PASS_KING1 * DIST[wKingSq][sq2] - PAWN_PASS_KING2 * DIST[bKingSq][sq2];
            
            //}}}
            //{{{  attacked?
            
            var passFree = 0;
            
            if (!b[sq2])
              passFree = PAWN_PASS_FREE * (!this.isAttacked(sq2,WHITE)|0);
            
            //}}}
            //{{{  unstoppable
            
            var passUnstop    = 0;
            var oppoOnlyPawns = wNumPawns + 1 == this.wCount;
            
            if (oppoOnlyPawns) {
            
              var promSq = B_PROMOTE_SQ[file];
            
              if (DIST[bKingSq][sq] <= 1 && DIST[bKingSq][promSq] <= 1)
                passUnstop = PAWN_PASS_UNSTOP;
            
              else if (DIST[sq][promSq] < DIST[wKingSq][promSq] + ((turn==BLACK)|0) - 1) {  // oppo cannot get there
            
                var blocked = 0;
                while(!b[sq2])
                  sq2 += 12;
                if (b[sq2] == EDGE)
                  passUnstop = PAWN_PASS_UNSTOP;
              }
            }
            
            //}}}
    
            pawnsS -= PAWN_OFFSET_S + (PAWN_MULT_S                                    ) * PAWN_PASSED[9-rank] | 0;
            pawnsE -= PAWN_OFFSET_E + (PAWN_MULT_E + passKings + passFree + passUnstop) * PAWN_PASSED[9-rank] | 0;
    
            //console.log('B PASS',COORDS[sq],'Kdist,free,unstop=',passKings,passFree,passUnstop);
          }
        }
        count++;
        next++
      }
    }
    
    //}}}
    
    //if (bPassed || wPassed)
      //console.log('----------------------------')
    
    //}}}
    
    //}}}
    //{{{  K
    
    var penalty = 0;
    
    var kingS = 0;
    var kingE = 0;
    
    if (wCanBeAttacked) {
      //{{{  shelter
      
      penalty = 0;
      
      penalty += WSHELTER[(wLeast & wKingMask) >>> wKingBits] * SHELTERM;
      
      if (wKingFile != 8)
        penalty += WSHELTER[(wLeastR & wKingMask) >>> wKingBits];
      
      if (wKingFile != 1)
        penalty += WSHELTER[(wLeastL & wKingMask) >>> wKingBits];
      
      if (penalty == 0)
        penalty = KING_PENALTY;
      
      kingS -= penalty;
      
      //}}}
      //{{{  storm
      
      penalty = 0;
      
      penalty += WSTORM[(bMost & wKingMask) >>> wKingBits];
      
      if (wKingFile != 8)
        penalty += WSTORM[(bMostR & wKingMask) >>> wKingBits];
      
      if (wKingFile != 1)
        penalty += WSTORM[(bMostL & wKingMask) >>> wKingBits];
      
      kingS -= penalty;
      
      //}}}
    }
    
    if (bCanBeAttacked) {
      //{{{  shelter
      
      penalty = 0;
      
      penalty += WSHELTER[9 - ((bLeast & bKingMask) >>> bKingBits)] * SHELTERM;
      
      if (bKingFile != 8)
        penalty += WSHELTER[9 - ((bLeastR & bKingMask) >>> bKingBits)];
      
      if (bKingFile != 1)
        penalty += WSHELTER[9 - ((bLeastL & bKingMask) >>> bKingBits)];
      
      if (penalty == 0)
        penalty = KING_PENALTY;
      
      kingS += penalty;
      
      //}}}
      //{{{  storm
      
      penalty = 0;
      
      penalty += WSTORM[9 - ((wMost & bKingMask) >>> bKingBits)];
      
      if (bKingFile != 8)
        penalty += WSTORM[9 - ((wMostR & bKingMask) >>> bKingBits)];
      
      if (bKingFile != 1)
        penalty += WSTORM[9 - ((wMostL & bKingMask) >>> bKingBits)];
      
      kingS += penalty;
      
      //}}}
    }
    
    //}}}
    //{{{  NBRQ
    
    var mobS = 0;
    var mobE = 0;
    
    var attS = 0;
    var attE = 0;
    
    var knightsS = 0;
    var knightsE = 0;
    
    var bishopsS = 0;
    var bishopsE = 0;
    
    var rooksS = 0;
    var rooksE = 0;
    
    var queensS = 0;
    var queensE = 0;
    
    //{{{  white
    
    var mob     = 0;
    var to      = 0;
    var fr      = 0;
    var frObj   = 0;
    var frRank  = 0;
    var frFile  = 0;
    var frBits  = 0;
    var frMask  = 0;
    var rDist   = 0;
    var fDist   = 0;
    var wBishop = 0;
    var bBishop = 0;
    var attackN = 0;
    var attackV = 0;
    var att     = 0;
    
    var pList  = this.wList;
    var pCount = this.wCount - 1 - wNumPawns;
    
    var next  = 1;  // ignore king.
    var count = 0;
    
    while (count < pCount) {
    
      fr = pList[next++];
      if (!fr)
        continue;
    
      frObj  = b[fr];
      if (frObj == W_PAWN)
        continue;
    
      frRank = RANK[fr];
      frFile = FILE[fr];
      frBits = (frFile-1) << 2;
      frMask = 0xF << frBits;
    
      if (frObj == W_KNIGHT) {
        //{{{  N
        
        mob = 0;
        att = 0;
        
        to = fr+10; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr-10; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr+14; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr-14; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr+23; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr-23; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr+25; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        to = fr-25; mob += MOB_NIS[b[to]]; att += BKZ[to] * MOB_NIS[b[to]];
        
        if (mob) {
          mobS += mob * MOB_NS;
          mobE += mob * MOB_NE;
        }
        else {
          mobS -= MOBOFF_NS
          mobS -= MOBOFF_NE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_N;
        }
        
        //{{{  outpost
        
        var outpost = WOUTPOST[fr];
        
        if (outpost) {
        
          if (((bLeastR & frMask) >>> frBits) <= frRank && ((bLeastL & frMask) >>> frBits) <= frRank) {
            knightsS += outpost;
            knightsS += outpost * IS_WP[b[fr+11]];
            knightsS += outpost * IS_WP[b[fr+13]];
          }
        }
        
        //}}}
        
        knightsS += imbalN_S[wNumPawns];
        knightsE += imbalN_E[wNumPawns];
        
        //}}}
      }
    
      else if (frObj == W_BISHOP) {
        //{{{  B
        
        mob = 0;
        att = 0;
        
        to = fr + 11;  while (!b[to]) {att += BKZ[to]; to += 11; mob++;} mob += MOB_BIS[b[to]]; att += BKZ[to] * MOB_BIS[b[to]];
        to = fr - 11;  while (!b[to]) {att += BKZ[to]; to -= 11; mob++;} mob += MOB_BIS[b[to]]; att += BKZ[to] * MOB_BIS[b[to]];
        to = fr + 13;  while (!b[to]) {att += BKZ[to]; to += 13; mob++;} mob += MOB_BIS[b[to]]; att += BKZ[to] * MOB_BIS[b[to]];
        to = fr - 13;  while (!b[to]) {att += BKZ[to]; to -= 13; mob++;} mob += MOB_BIS[b[to]]; att += BKZ[to] * MOB_BIS[b[to]];
        
        if (mob) {
          mobS += mob * MOB_BS;
          mobE += mob * MOB_BE;
        }
        else {
          mobS -= MOBOFF_BS
          mobS -= MOBOFF_BE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_B;
        }
        
        wBishop += WSQUARE[fr];
        bBishop += BSQUARE[fr];
        
        bishopsS += imbalB_S[wNumPawns];
        bishopsE += imbalB_E[wNumPawns];
        
        //}}}
      }
    
      else if (frObj == W_ROOK) {
        //{{{  R
        
        mob = 0;
        att = 0;
        
        to = fr + 1;   while (!b[to]) {att += BKZ[to]; to += 1;  mob++;} mob += MOB_RIS[b[to]]; att += BKZ[to] * MOB_RIS[b[to]];
        to = fr - 1;   while (!b[to]) {att += BKZ[to]; to -= 1;  mob++;} mob += MOB_RIS[b[to]]; att += BKZ[to] * MOB_RIS[b[to]];
        to = fr + 12;  while (!b[to]) {att += BKZ[to]; to += 12; mob++;} mob += MOB_RIS[b[to]]; att += BKZ[to] * MOB_RIS[b[to]];
        to = fr - 12;  while (!b[to]) {att += BKZ[to]; to -= 12; mob++;} mob += MOB_RIS[b[to]]; att += BKZ[to] * MOB_RIS[b[to]];
        
        if (mob) {
          mobS += mob * MOB_RS;
          mobE += mob * MOB_RE;
        }
        else {
          mobS -= MOBOFF_RS
          mobS -= MOBOFF_RE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_R;
        }
        
        //{{{  7th
        
        if (frRank == 7 && (bKingRank == 8 || bHome)) {
          rooksS += ROOK7TH_S;
          rooksE += ROOK7TH_E;
        }
        
        //}}}
        //{{{  semi/open file
        
        rooksS -= ROOKOPEN_S;
        rooksE -= ROOKOPEN_E;
        
        if (!(wMost & frMask)) {   // no w pawn.
        
          rooksS += ROOKOPEN_S;
          rooksE += ROOKOPEN_E;
        
          if (!(bLeast & frMask)) {  // no b pawn.
            rooksS += ROOKOPEN_S;
            rooksE += ROOKOPEN_E;
          }
        
          if (frFile == bKingFile) {
            rooksS += ROOKOPEN_S;
          }
        
          if (Math.abs(frFile - bKingFile) <= 1) {
            rooksS += ROOKOPEN_S;
          }
        }
        
        //}}}
        
        rooksS += imbalR_S[wNumPawns];
        rooksE += imbalR_E[wNumPawns];
        
        //}}}
      }
    
      else if (frObj == W_QUEEN) {
        //{{{  Q
        
        mob = 0;
        att = 0;
        
        to = fr + 1;   while (!b[to]) {att += BKZ[to]; to += 1;  mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr - 1;   while (!b[to]) {att += BKZ[to]; to -= 1;  mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr + 12;  while (!b[to]) {att += BKZ[to]; to += 12; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr - 12;  while (!b[to]) {att += BKZ[to]; to -= 12; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        
        to = fr + 11;  while (!b[to]) {att += BKZ[to]; to += 11; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr - 11;  while (!b[to]) {att += BKZ[to]; to -= 11; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr + 13;  while (!b[to]) {att += BKZ[to]; to += 13; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        to = fr - 13;  while (!b[to]) {att += BKZ[to]; to -= 13; mob++;} mob += MOB_QIS[b[to]]; att += BKZ[to] * MOB_QIS[b[to]];
        
        if (mob) {
          mobS += mob * MOB_QS;
          mobE += mob * MOB_QE;
        }
        else {
          mobS -= MOBOFF_QS
          mobS -= MOBOFF_QE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_Q;
        }
        
        //{{{  7th rank
        
        if (frRank == 7 && (bKingRank == 8 || bHome)) {
          queensS += QUEEN7TH_S;
          queensE += QUEEN7TH_E;
        }
        
        //}}}
        
        queensS += imbalQ_S[wNumPawns];
        queensE += imbalQ_E[wNumPawns];
        
        //}}}
      }
    
      count++;
    }
    
    if (bCanBeAttacked) {
    
      if (attackN > ATT_L)
        attackN = ATT_L;
    
      attS += (attackV * ATT_M * ATT_W[attackN]) | 0;
      attE += 0;
    }
    
    if (wBishop && bBishop) {
      bishopsS += TWOBISHOPS_S;
      bishopsE += TWOBISHOPS_E;
    }
    
    //}}}
    //{{{  black
    
    var mob     = 0;
    var to      = 0;
    var fr      = 0;
    var frObj   = 0;
    var frRank  = 0;
    var frFile  = 0;
    var frBits  = 0;
    var frMask  = 0;
    var rDist   = 0;
    var fDist   = 0;
    var wBishop = 0;
    var bBishop = 0;
    var attackN = 0;
    var attackV = 0;
    var att     = 0;
    
    var pList  = this.bList;
    var pCount = this.bCount - 1 - bNumPawns;
    
    var next  = 1;  // ignore king.
    var count = 0;
    
    while (count < pCount) {
    
      fr = pList[next++];
      if (!fr)
        continue;
    
      frObj = b[fr];
    
      if (frObj == B_PAWN)
        continue;
    
      frRank  = RANK[fr];
      frFile  = FILE[fr];
      frBits  = (frFile-1) << 2;
      frMask  = 0xF << frBits;
    
      if (frObj == B_KNIGHT) {
        //{{{  N
        
        mob = 0;
        att = 0;
        
        to = fr+10; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr-10; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr+14; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr-14; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr+23; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr-23; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr+25; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        to = fr-25; mob += MOB_NIS[b[to]]; att += WKZ[to] * MOB_NIS[b[to]];
        
        if (mob) {
          mobS -= mob * MOB_NS;
          mobE -= mob * MOB_NE;
        }
        else {
          mobS += MOBOFF_NS
          mobS += MOBOFF_NE
        }
        
        
        if (att) {
          attackN++;
          attackV += ATT_N;
        }
        
        //{{{  outpost
        
        var outpost = BOUTPOST[fr];
        
        if (outpost) {
        
          if (((wLeastR & frMask) >>> frBits) >= frRank && ((wLeastL & frMask) >>> frBits) >= frRank) {
            knightsS -= outpost;
            knightsS -= outpost * IS_BP[b[fr-11]];
            knightsS -= outpost * IS_BP[b[fr-13]];
          }
        }
        
        //}}}
        
        knightsS -= imbalN_S[bNumPawns];
        knightsE -= imbalN_E[bNumPawns];
        
        //}}}
      }
    
      else if (frObj == B_BISHOP) {
        //{{{  B
        
        mob = 0;
        att = 0;
        
        to = fr + 11;  while (!b[to]) {att += WKZ[to]; to += 11; mob++;} mob += MOB_BIS[b[to]]; att += WKZ[to] * MOB_BIS[b[to]];
        to = fr - 11;  while (!b[to]) {att += WKZ[to]; to -= 11; mob++;} mob += MOB_BIS[b[to]]; att += WKZ[to] * MOB_BIS[b[to]];
        to = fr + 13;  while (!b[to]) {att += WKZ[to]; to += 13; mob++;} mob += MOB_BIS[b[to]]; att += WKZ[to] * MOB_BIS[b[to]];
        to = fr - 13;  while (!b[to]) {att += WKZ[to]; to -= 13; mob++;} mob += MOB_BIS[b[to]]; att += WKZ[to] * MOB_BIS[b[to]];
        
        if (mob) {
          mobS -= mob * MOB_BS;
          mobE -= mob * MOB_BE;
        }
        else {
          mobS += MOBOFF_BS
          mobS += MOBOFF_BE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_B;
        }
        
        wBishop += WSQUARE[fr];
        bBishop += BSQUARE[fr];
        
        bishopsS -= imbalB_S[bNumPawns];
        bishopsE -= imbalB_E[bNumPawns];
        
        //}}}
      }
    
      else if (frObj == B_ROOK) {
        //{{{  R
        
        mob = 0;
        att = 0;
        
        to = fr + 1;   while (!b[to]) {att += WKZ[to]; to += 1;  mob++;} mob += MOB_RIS[b[to]]; att += WKZ[to] * MOB_RIS[b[to]];
        to = fr - 1;   while (!b[to]) {att += WKZ[to]; to -= 1;  mob++;} mob += MOB_RIS[b[to]]; att += WKZ[to] * MOB_RIS[b[to]];
        to = fr + 12;  while (!b[to]) {att += WKZ[to]; to += 12; mob++;} mob += MOB_RIS[b[to]]; att += WKZ[to] * MOB_RIS[b[to]];
        to = fr - 12;  while (!b[to]) {att += WKZ[to]; to -= 12; mob++;} mob += MOB_RIS[b[to]]; att += WKZ[to] * MOB_RIS[b[to]];
        
        if (mob) {
          mobS -= mob * MOB_RS;
          mobE -= mob * MOB_RE;
        }
        else {
          mobS += MOBOFF_RS
          mobS += MOBOFF_RE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_R;
        }
        
        //{{{  7th rank
        
        if (frRank == 2 && (wKingRank == 1 || wHome)) {
          rooksS -= ROOK7TH_S;
          rooksE -= ROOK7TH_E;
        }
        
        //}}}
        //{{{  semi/open file
        
        rooksS += ROOKOPEN_S;
        rooksE += ROOKOPEN_E;
        
        if (!(bLeast & frMask)) { // no b pawn.
        
          rooksS -= ROOKOPEN_S;
          rooksE -= ROOKOPEN_E;
        
          if (!(wMost & frMask)) {  // no w pawn.
            rooksS -= ROOKOPEN_S;
            rooksE -= ROOKOPEN_E;
          }
        
          if (frFile == wKingFile) {
            rooksS -= ROOKOPEN_S;
          }
        
          if (Math.abs(frFile - wKingFile) <= 1) {
            rooksS -= ROOKOPEN_S;
          }
        }
        
        //}}}
        
        rooksS -= imbalR_S[bNumPawns];
        rooksE -= imbalR_E[bNumPawns];
        
        //}}}
      }
    
      else if (frObj == B_QUEEN) {
        //{{{  Q
        
        mob = 0;
        att = 0;
        
        to = fr + 1;   while (!b[to]) {att += WKZ[to]; to += 1;  mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr - 1;   while (!b[to]) {att += WKZ[to]; to -= 1;  mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr + 12;  while (!b[to]) {att += WKZ[to]; to += 12; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr - 12;  while (!b[to]) {att += WKZ[to]; to -= 12; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        
        to = fr + 11;  while (!b[to]) {att += WKZ[to]; to += 11; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr - 11;  while (!b[to]) {att += WKZ[to]; to -= 11; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr + 13;  while (!b[to]) {att += WKZ[to]; to += 13; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        to = fr - 13;  while (!b[to]) {att += WKZ[to]; to -= 13; mob++;} mob += MOB_QIS[b[to]]; att += WKZ[to] * MOB_QIS[b[to]];
        
        if (mob) {
          mobS -= mob * MOB_QS;
          mobE -= mob * MOB_QE;
        }
        else {
          mobS += MOBOFF_QS
          mobS += MOBOFF_QE
        }
        
        if (att) {
          attackN++;
          attackV += ATT_Q;
        }
        
        //{{{  7th rank
        
        if (frRank == 2 && (wKingRank == 1 || wHome)) {
          queensS -= QUEEN7TH_S;
          queensE -= QUEEN7TH_E;
        }
        
        //}}}
        
        queensS -= imbalQ_S[bNumPawns];
        queensE -= imbalQ_E[bNumPawns];
        
        //}}}
      }
    
      count++;
    }
    
    if (wCanBeAttacked) {
    
      if (attackN > ATT_L)
        attackN = ATT_L;
    
      attS -= (attackV * ATT_M * ATT_W[attackN]) | 0;
      attE -= 0;
    }
    
    if (wBishop && bBishop) {
      bishopsS -= TWOBISHOPS_S;
      bishopsE -= TWOBISHOPS_E;
    }
    
    //}}}
    
    //}}}
    
    //{{{  trapped
    
    var trappedS = 0;
    var trappedE = 0;
    
    //{{{  trapped bishops
    
    var trap = 0;
    
    if (wNumBishops) {
    
      trap = 0;
    
      trap += IS_WB[b[SQA7]] & IS_BP[b[SQB6]];
      trap += IS_WB[b[SQH7]] & IS_BP[b[SQG6]];
    
      trap += IS_WB[b[SQB8]] & IS_BP[b[SQC7]];
      trap += IS_WB[b[SQG7]] & IS_BP[b[SQF7]];
    
      trap += IS_WB[b[SQA6]] & IS_BP[b[SQB5]];
      trap += IS_WB[b[SQH6]] & IS_BP[b[SQG5]];
    
      trap += IS_WB[b[SQC1]] & IS_WP[b[SQD2]] & IS_O[b[SQD3]];
      trap += IS_WB[b[SQF1]] & IS_WP[b[SQE2]] & IS_O[b[SQE3]];
    
      trappedS -= trap * TRAPPED;
      trappedE -= trap * TRAPPED;
    }
    
    if (bNumBishops) {
    
      trap = 0;
    
      trap += IS_BB[b[SQA2]] & IS_WP[b[SQB3]];
      trap += IS_BB[b[SQH2]] & IS_WP[b[SQG3]];
    
      trap += IS_BB[b[SQB1]] & IS_WP[b[SQC2]];
      trap += IS_BB[b[SQG2]] & IS_WP[b[SQF2]];
    
      trap += IS_BB[b[SQA3]] & IS_WP[b[SQB4]];
      trap += IS_BB[b[SQH3]] & IS_WP[b[SQG4]];
    
      trap += IS_BB[b[SQC8]] & IS_BP[b[SQD7]] * IS_O[b[SQD6]];
      trap += IS_BB[b[SQF8]] & IS_BP[b[SQE7]] * IS_O[b[SQE6]];
    
      trappedS += trap * TRAPPED;
      trappedE += trap * TRAPPED;
    }
    
    //}}}
    //{{{  trapped knights
    
    if (wNumKnights) {
    
      trap = 0;
    
      trap += IS_WN[b[SQA8]] & (IS_BP[b[SQA7]] | IS_BP[b[SQC7]]);
      trap += IS_WN[b[SQH8]] & (IS_BP[b[SQH7]] | IS_BP[b[SQF7]]);
    
      trap += IS_WN[b[SQA7]] & IS_BP[b[SQA6]] & IS_BP[b[SQB7]];
      trap += IS_WN[b[SQH7]] & IS_BP[b[SQH6]] & IS_BP[b[SQG7]];
    
      trap += IS_WN[b[SQA7]] & IS_BP[b[SQB7]] & IS_BP[b[SQC6]];
      trap += IS_WN[b[SQH7]] & IS_BP[b[SQG7]] & IS_BP[b[SQF6]];
    
      trappedS -= trap * TRAPPED;
      trappedE -= trap * TRAPPED;
    }
    
    if (bNumKnights) {
    
      trap = 0;
    
      trap += IS_BN[b[SQA1]] & (IS_WP[b[SQA2]] | IS_WP[b[SQC2]]);
      trap += IS_BN[b[SQH1]] & (IS_WP[b[SQH2]] | IS_WP[b[SQF2]]);
    
      trap += IS_BN[b[SQA2]] & IS_WP[b[SQA3]] & IS_WP[b[SQB2]];
      trap += IS_BN[b[SQH2]] & IS_WP[b[SQH3]] & IS_WP[b[SQG2]];
    
      trap += IS_BN[b[SQA2]] & IS_WP[b[SQB2]] & IS_WP[b[SQC3]];
      trap += IS_BN[b[SQH2]] & IS_WP[b[SQG2]] & IS_WP[b[SQF3]];
    
      trappedS += trap * TRAPPED;
      trappedE += trap * TRAPPED;
    }
    
    //}}}
    
    //}}}
    //{{{  tempo
    
    if (turn == WHITE) {
     var tempoS = 21;
     var tempoE = 0;
    }
    
    else {
     var tempoS = -21;
     var tempoE = 0;
    }
    
    //}}}
    
    //{{{  combine
    
    var evalS = this.runningEvalS;
    var evalE = this.runningEvalE;
    
    evalS += mobS;
    evalE += mobE;
    
    evalS += trappedS;
    evalE += trappedE;
    
    evalS += tempoS;
    evalE += tempoE;
    
    evalS += attS;
    evalE += attE;
    
    evalS += pawnsS;
    evalE += pawnsE;
    
    evalS += knightsS;
    evalE += knightsE;
    
    evalS += bishopsS;
    evalE += bishopsE;
    
    evalS += rooksS;
    evalE += rooksE;
    
    evalS += queensS;
    evalE += queensE;
    
    evalS += kingS;
    evalE += kingE;
    
    hceE = (evalS * (TPHASE - phase) + evalE * phase) / TPHASE;
    
    //}}}
    //{{{  verbose
    
    if (this.verbose) {
      uci.send('info string','phased eval =',myround(hceE)|0);
      uci.send('info string','phase =',phase);
      uci.send('info string','eval =',evalS,evalE);
      uci.send('info string','trapped =',trappedS,trappedE);
      uci.send('info string','mobility =',mobS,mobE);
      uci.send('info string','attacks =',attS,attE);
      uci.send('info string','material =',this.runningEvalS,this.runningEvalE);
      uci.send('info string','kings =',kingS,kingE);
      uci.send('info string','queens =',queensS,queensE);
      uci.send('info string','rooks =',rooksS,rooksE);
      uci.send('info string','bishops =',bishopsS,bishopsE);
      uci.send('info string','knights =',knightsS,knightsE);
      uci.send('info string','pawns =',pawnsS,pawnsE);
      uci.send('info string','tempo =',tempoS,tempoE);
    }
    
    //}}}
    
    //}}}
  }

  if (USENET) {
    //{{{  net
    
    netE = this.netEval();
    
    if (this.verbose) {
      uci.send('info string','net eval =',myround(netE)|0);
    }
    
    //}}}
  }

  var stm = this.stm(turn);

  if (USEHCE && USENET) {
    if (this.verbose) {
      uci.send('info string','hybrid eval =',myround((hceE+netE)/2)|0);
    }
    return stm * myround((hceE + netE) / 2) | 0;
  }
  else if (USEHCE) {
    return stm * myround(hceE) | 0;
  }
  else {
    return stm * myround(netE) | 0;
  }
}

//}}}
//{{{  .hashCheck

lozBoard.prototype.hashCheck = function (turn) {

  var evalS = 0;
  var evalE = 0;

  var nn1 = this.netEval();
  var nn2 = this.netFullEval();
  if (myround(nn1) != myround(nn2))
    lozza.uci.debug('NET',nn1,nn2);

  var loHash = 0;
  var hiHash = 0;

  var ploHash = 0;
  var phiHash = 0;

  if (turn) {
    loHash ^= this.loTurn;
    hiHash ^= this.hiTurn;
  }

  loHash ^= this.loRights[this.rights];
  hiHash ^= this.hiRights[this.rights];

  loHash ^= this.loEP[this.ep];
  hiHash ^= this.hiEP[this.ep];

  for (var sq=0; sq<144; sq++) {

    var obj = this.b[sq];

    if (obj == NULL || obj == EDGE)
      continue;

    var piece = obj & PIECE_MASK;
    var col   = obj & COLOR_MASK;

    loHash ^= this.loPieces[col>>>3][piece-1][sq];
    hiHash ^= this.hiPieces[col>>>3][piece-1][sq];

    if (piece == PAWN) {
      ploHash ^= this.loPieces[col>>>3][0][sq];
      phiHash ^= this.hiPieces[col>>>3][0][sq];
    }

    if (col == WHITE) {
      evalS += VALUE_VECTOR[piece];
      evalE += VALUE_VECTOR[piece];
      evalS += WS_PST[piece][sq];
      evalE += WE_PST[piece][sq];
    }
    else {
      evalS -= VALUE_VECTOR[piece];
      evalE -= VALUE_VECTOR[piece];
      evalS -= BS_PST[piece][sq];
      evalE -= BE_PST[piece][sq];
    }
  }

  if (this.loHash != loHash)
    lozza.uci.debug('LO',this.loHash,loHash);

  if (this.hiHash != hiHash)
    lozza.uci.debug('HI',this.hiHash,hiHash);

  if (this.ploHash != ploHash)
    lozza.uci.debug('PLO',this.ploHash,ploHash);

  if (this.phiHash != phiHash)
    lozza.uci.debug('PHI',this.phiHash,phiHash);

  if (this.runningEvalS != evalS)
    lozza.uci.debug('MATS',this.runningEvalS,evalS);

  if (this.runningEvalE != evalE)
    lozza.uci.debug('MATE',this.runningEvalE,evalE);
}

//}}}
//{{{  .rand32

lozBoard.prototype.rand32 = function () {

  var r = randoms[nextRandom];

  nextRandom++;

  if (nextRandom == 4000) {
    lozza.uci.send('info','run out of randoms');
  }

  return r;
}

//}}}
//{{{  .ttPut

lozBoard.prototype.ttPut = function (type,depth,score,move,ply,alpha,beta) {

  var idx = this.loHash & TTMASK;

  //if (this.ttType[idx] == TT_EXACT && this.loHash == this.ttLo[idx] && this.hiHash == this.ttHi[idx] && this.ttDepth[idx] > depth && this.ttScore[idx] > alpha && this.ttScore[idx] < beta) {
    //return;
  //}

  if (this.ttType[idx] == TT_EMPTY)
    this.hashUsed++;

  if (score <= -MINMATE && score >= -MATE)
    score -= ply;

  else if (score >= MINMATE && score <= MATE)
    score += ply;

  this.ttLo[idx]    = this.loHash;
  this.ttHi[idx]    = this.hiHash;
  this.ttType[idx]  = type;
  this.ttDepth[idx] = depth;
  this.ttScore[idx] = score;
  this.ttMove[idx]  = move;
}

//}}}
//{{{  .ttGet

lozBoard.prototype.ttGet = function (node, depth, alpha, beta) {

  var idx   = this.loHash & TTMASK;
  var type  = this.ttType[idx];

  node.hashMove = 0;

  if (type == TT_EMPTY) {
    return TTSCORE_UNKNOWN;
  }

  var lo = this.ttLo[idx];
  var hi = this.ttHi[idx];

  if (lo != this.loHash || hi != this.hiHash) {
    return TTSCORE_UNKNOWN;
  }

  //
  // Set the hash move before the depth check
  // so that iterative deepening works.
  //

  node.hashMove = this.ttMove[idx];

  if (this.ttDepth[idx] < depth) {
    return TTSCORE_UNKNOWN;
  }

  var score = this.ttScore[idx];

  if (score <= -MINMATE && score >= -MATE)
    score += node.ply;

  else if (score >= MINMATE && score <= MATE)
    score -= node.ply;

  if (type == TT_EXACT) {
    return score;
   }

  if (type == TT_ALPHA && score <= alpha) {
    return score;
  }

  if (type == TT_BETA && score >= beta) {
    return score;
  }

  return TTSCORE_UNKNOWN;
}

//}}}
//{{{  .ttGetMove

lozBoard.prototype.ttGetMove = function (node) {

  var idx = this.loHash & TTMASK;

  if (this.ttType[idx] != TT_EMPTY && this.ttLo[idx] == this.loHash && this.ttHi[idx] == this.hiHash)
    return this.ttMove[idx];

  return 0;
}

//}}}
//{{{  .ttInit

lozBoard.prototype.ttInit = function () {

  this.loHash = 0;
  this.hiHash = 0;

  this.ploHash = 0;
  this.phiHash = 0;

  this.ttType.fill(0);
  this.pttFlags.fill(0);

  this.hashUsed = 0;
}

//}}}
//{{{  .fen

lozBoard.prototype.fen = function (turn) {

  var fen = '';
  var n   = 0;

  for (var i=0; i < 8; i++) {
    for (var j=0; j < 8; j++) {
      var sq  = B88[i*8 + j]
      var obj = this.b[sq];
      if (obj == NULL)
        n++;
      else {
        if (n) {
          fen += '' + n;
          n = 0;
        }
        fen += UMAP[obj];
      }
    }
    if (n) {
      fen += '' + n;
      n = 0;
    }
    if (i < 7)
      fen += '/';
  }

  if (turn == WHITE)
    fen += ' w';
  else
    fen += ' b';

  if (this.rights) {
    fen += ' ';
    if (this.rights & WHITE_RIGHTS_KING)
      fen += 'K';
    if (this.rights & WHITE_RIGHTS_QUEEN)
      fen += 'Q';
    if (this.rights & BLACK_RIGHTS_KING)
      fen += 'k';
    if (this.rights & BLACK_RIGHTS_QUEEN)
      fen += 'Q';
  }
  else
    fen += ' -';

  if (this.ep)
    fen += ' ' + COORDS[this.ep];
  else
    fen += ' -';

  fen += ' 0 1';

  return fen;
}

//}}}
//{{{  .playMove

lozBoard.prototype.playMove = function (moveStr) {

  var move     = 0;
  var node     = lozza.rootNode;
  var nextTurn = ~this.turn & COLOR_MASK;

  node.cache();

  this.genMoves(node, this.turn);

  while (move = node.getNextMove()) {

    this.makeMove(node,move);

    var attacker = this.isKingAttacked(nextTurn);

    if (attacker) {

      this.unmakeMove(node,move);
      node.uncache();

      continue;
    }

    var fMove = this.formatMove(move,UCI_FMT);

    if (moveStr == fMove || moveStr+'q' == fMove) {
      this.turn = ~this.turn & COLOR_MASK;
      return true;
    }

    this.unmakeMove(node,move);
    node.uncache();
  }

  return false;
}

//}}}
//{{{  .getPVStr

lozBoard.prototype.getPVStr = function(node,move,depth) {

  if (!node || !depth)
    return '';

  if (!move)
    move = this.ttGetMove(node);

  if (!move)
    return '';

  node.cache();
  this.makeMove(node,move);

  var mv = this.formatMove(move, this.mvFmt);
  var pv = ' ' + this.getPVStr(node.childNode,0,depth-1);

  this.unmakeMove(node,move);
  node.uncache();

  return mv + pv;
}

//}}}
//{{{  .addHistory

lozBoard.prototype.addHistory = function (x, move) {

  var to      = (move & MOVE_TO_MASK)    >>> MOVE_TO_BITS;
  var frObj   = (move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS;
  var frPiece = frObj & PIECE_MASK;

  if ((frObj & COLOR_MASK) == WHITE) {
    this.wHistory[frPiece][to] += x;
  }
  else {
    this.bHistory[frPiece][to] += x;
  }
}

//}}}
//{{{  .betaMate

lozBoard.prototype.betaMate = function (score) {

  return (score >= MINMATE && score <= MATE);
}

//}}}
//{{{  .alphaMate

lozBoard.prototype.alphaMate = function (score) {

  return (score <= -MINMATE && score >= -MATE)
}

//}}}
//{{{  .cleanPhase

lozBoard.prototype.cleanPhase = function (p) {

  if (p <= 0)            // because of say 3 queens early on.
    return 0;

  else if (p >= TPHASE)  // jic.
    return TPHASE;

  return p;
}

//}}}
//{{{  .stm

lozBoard.prototype.stm = function (turn) {
  return (-turn >> 31) | 1;  // 1,-1 (white,black) multiplier.
}

//}}}
//{{{  .sti

lozBoard.prototype.sti = function (turn) {
  return turn >>> 3;  // 0,1 (white,black) index.
}

//}}}
//{{{  .net*

lozBoard.prototype.netwMove = function (p,fr,to) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum -= h.weights[64*(p-1) + NETMAP[fr]];
    h.sum += h.weights[64*(p-1) + NETMAP[to]];
  }
}

lozBoard.prototype.netbMove = function (p,fr,to) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum -= h.weights[NETINOFF + 64*(p-1) + NETMAP[fr]];
    h.sum += h.weights[NETINOFF + 64*(p-1) + NETMAP[to]];
  }
}

lozBoard.prototype.netwAdd = function (p,sq) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum += h.weights[64*(p-1) + NETMAP[sq]];
  }
}

lozBoard.prototype.netbAdd = function (p,sq) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum += h.weights[NETINOFF + 64*(p-1) + NETMAP[sq]];
  }
}

lozBoard.prototype.netwDel = function (p,sq) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum -= h.weights[64*(p-1) + NETMAP[sq]];
  }
}

lozBoard.prototype.netbDel = function (p,sq) {

  if (!USENET) return;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum -= h.weights[NETINOFF + 64*(p-1) + NETMAP[sq]];
  }
}

lozBoard.prototype.netEval = function () {

  if (!USENET) return 0;

  this.o1.sum = 0;

  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    this.o1.sum += Math.max(0.0,h.sum) * this.o1.weights[i];
  }

  return this.o1.sum * this.netScale;
}

lozBoard.prototype.netFullEval = function () {

  if (!USENET) return 0;

  //{{{  init h1 sums
  
  for (var i=0; i < NETH1SIZE; i++) {
    var h = this.h1[i];
    h.sum = 0;
  }
  
  //}}}
  //{{{  white
  
  var next  = 0;
  var count = 0;
  var sq     = 0;
  
  while (count < this.wCount) {
  
    sq = this.wList[next++];
    if (!sq)
      continue;
  
    var piece = this.b[sq] & PIECE_MASK;
    var inx   = (piece-1) * 64 + NETMAP[sq];
  
    for (var i=0; i < NETH1SIZE; i++) {
      var h = this.h1[i];
      h.sum += h.weights[inx];
    }
  
    count++;
  }
  
  //}}}
  //{{{  black
  
  var next  = 0;
  var count = 0;
  var sq     = 0;
  
  while (count < this.bCount) {
  
    sq = this.bList[next++];
    if (!sq)
      continue;
  
    var piece = this.b[sq] & PIECE_MASK;
    var inx   = NETINOFF + (piece-1) * 64 + NETMAP[sq];
  
    for (var i=0; i < NETH1SIZE; i++) {
      var h = this.h1[i];
      h.sum += h.weights[inx];
    }
  
    count++;
  }
  
  //}}}

  return this.netEval();
}


//}}}

//}}}
//{{{  lozNode class

//{{{  lozNode

function lozNode (parentNode) {

  this.ply        = 0;          //  distance from root.
  this.root       = false;      //  only true for the root node node[0].
  this.childNode  = null;       //  pointer to next node (towards leaf) in tree.
  this.parentNode = parentNode; //  pointer previous node (towards root) in tree.

  if (parentNode) {
    this.grandparentNode = parentNode.parentNode;
    parentNode.childNode = this;
  }
  else
    this.grandparentNode = null;

  this.moves = new Uint32Array(MAX_MOVES);
  this.ranks = Array(MAX_MOVES);

  for (var i=0; i < MAX_MOVES; i++) {
    this.moves[i] = 0;
    this.ranks[i] = 0;
  }

  this.killer1     = 0;
  this.killer2     = 0;
  this.mateKiller  = 0;
  this.numMoves    = 0;         //  number of pseudo-legal moves for this node.
  this.sortedIndex = 0;         //  index to next selection-sorted pseudo-legal move.
  this.hashMove    = 0;         //  loaded when we look up the tt.
  this.base        = 0;         //  move type base (e.g. good capture) - can be used for LMR.

  this.C_runningEvalS = 0;      // cached before move generation and restored after each unmakeMove.
  this.C_runningEvalE = 0;
  this.C_rights       = 0;
  this.C_ep           = 0;
  this.C_repLo        = 0;
  this.C_repHi        = 0;
  this.C_loHash       = 0;
  this.C_hiHash       = 0;
  this.C_ploHash      = 0;
  this.C_phiHash      = 0;
  this.C_h1           = Array(NETH1SIZE);

  this.toZ = 0;                 // move to square index (captures) to piece list - cached during make|unmakeMove.
  this.frZ = 0;                 // move from square index to piece list          - ditto.
  this.epZ = 0;                 // captured ep pawn index to piece list          - ditto.
}

//}}}
//{{{  .init
//
//  By storing the killers in the node, we are implicitly using depth from root, rather than
//  depth, which can jump around all over the place and is inappropriate to use for killers.
//

lozNode.prototype.init = function() {

  this.killer1      = 0;
  this.killer2      = 0;
  this.mateKiller   = 0;
  this.numMoves     = 0;
  this.sortedIndex  = 0;
  this.hashMove     = 0;
  this.base         = 0;

  this.toZ = 0;
  this.frZ = 0;
  this.epZ = 0;
}

//}}}
//{{{  .cache
//
// We cache the board before move generation (those elements not done in unmakeMove)
// and restore after each unmakeMove.
//

lozNode.prototype.cache = function() {

  var board = this.board;

  this.C_runningEvalS = board.runningEvalS;
  this.C_runningEvalE = board.runningEvalE
  this.C_rights       = board.rights;
  this.C_ep           = board.ep;
  this.C_repLo        = board.repLo;
  this.C_repHi        = board.repHi;
  this.C_loHash       = board.loHash;
  this.C_hiHash       = board.hiHash;
  this.C_ploHash      = board.ploHash;
  this.C_phiHash      = board.phiHash;

  if (USENET) {
    for (var i=0; i < NETH1SIZE; i++) {
      this.C_h1[i] = board.h1[i].sum;
    }
  }
}

//}}}
//{{{  .uncache

lozNode.prototype.uncache = function() {

  var board = this.board;

  board.runningEvalS   = this.C_runningEvalS;
  board.runningEvalE   = this.C_runningEvalE;
  board.rights         = this.C_rights;
  board.ep             = this.C_ep;
  board.repLo          = this.C_repLo;
  board.repHi          = this.C_repHi;
  board.loHash         = this.C_loHash;
  board.hiHash         = this.C_hiHash;
  board.ploHash        = this.C_ploHash;
  board.phiHash        = this.C_phiHash;

  if (USENET) {
    for (var i=0; i < NETH1SIZE; i++) {
      board.h1[i].sum = this.C_h1[i];
    }
  }
}

//}}}
//{{{  .getNextMove

lozNode.prototype.getNextMove = function () {

  if (this.sortedIndex == this.numMoves)
    return 0;

  var maxR = -INFINITY;
  var maxI = 0;

  for (var i=this.sortedIndex; i < this.numMoves; i++) {
    if (this.ranks[i] > maxR) {
      maxR = this.ranks[i];
      maxI = i;
    }
  }

  var maxM = this.moves[maxI]

  this.moves[maxI] = this.moves[this.sortedIndex];
  this.ranks[maxI] = this.ranks[this.sortedIndex];

  this.base = maxR;

  this.sortedIndex++;

  return maxM;
}

//}}}
//{{{  .addSlide

lozNode.prototype.addSlide = function (move) {

  var n = this.numMoves++;

  this.moves[n] = move;

  if (move == this.hashMove)
    this.ranks[n] = BASE_HASH;

  else if (move == this.mateKiller)
    this.ranks[n] = BASE_MATEKILLER;

  else if (move == this.killer1)
    this.ranks[n] = BASE_MYKILLERS + 1;

  else if (move == this.killer2)
    this.ranks[n] = BASE_MYKILLERS;

  else if (this.grandparentNode && move == this.grandparentNode.killer1)
    this.ranks[n] = BASE_GPKILLERS + 1;

  else if (this.grandparentNode && move == this.grandparentNode.killer2)
    this.ranks[n] = BASE_GPKILLERS;

  else
    this.ranks[n] = this.slideBase(move);
}

//}}}
//{{{  .slideBase

lozNode.prototype.slideBase = function (move) {

    var to      = (move & MOVE_TO_MASK)    >>> MOVE_TO_BITS;
    var fr      = (move & MOVE_FR_MASK)    >>> MOVE_FR_BITS;
    var frObj   = (move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS;
    var frPiece = frObj & PIECE_MASK;
    var frCol   = frObj & COLOR_MASK;

    if (frCol == WHITE) {
      var pst = WM_PST[frPiece];
      var his = this.board.wHistory[frPiece][to];
    }
    else {
      var pst = BM_PST[frPiece];
      var his = this.board.bHistory[frPiece][to];
    }

    if (!his)
      return BASE_PSTSLIDE + pst[to] - pst[fr];

    else
      return BASE_HISSLIDE + his;
}

//}}}
//{{{  .addCastle

lozNode.prototype.addCastle = function (move) {

  var n = this.numMoves++;

  this.moves[n] = move;

  if (move == this.hashMove)
    this.ranks[n] = BASE_HASH;

  else if (move == this.mateKiller)
    this.ranks[n] = BASE_MATEKILLER;

  else if (move == this.killer1)
    this.ranks[n] = BASE_MYKILLERS + 1;

  else if (move == this.killer2)
    this.ranks[n] = BASE_MYKILLERS;

  else if (this.grandparentNode && move == this.grandparentNode.killer1)
    this.ranks[n] = BASE_GPKILLERS + 1;

  else if (this.grandparentNode && move == this.grandparentNode.killer2)
    this.ranks[n] = BASE_GPKILLERS;

  else
    this.ranks[n] = BASE_CASTLING;
}

//}}}
//{{{  .addCapture

lozNode.prototype.addCapture = function (move) {

  var n = this.numMoves++;

  this.moves[n] = move;

  if (move == this.hashMove)
    this.ranks[n] = BASE_HASH;

  else {

    var victim = RANK_VECTOR[((move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS) & PIECE_MASK];
    var attack = RANK_VECTOR[((move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS) & PIECE_MASK];

    if (victim > attack)
      this.ranks[n] = BASE_GOODTAKES + victim * 64 - attack;

    else if (victim == attack)
      this.ranks[n] = BASE_EVENTAKES + victim * 64 - attack;

    else {

      if (move == this.mateKiller)
        this.ranks[n] = BASE_MATEKILLER;

      else if (move == this.killer1)
        this.ranks[n] = BASE_MYKILLERS + 1;

      else if (move == this.killer2)
        this.ranks[n] = BASE_MYKILLERS;

      else if (this.grandparentNode && move == this.grandparentNode.killer1)
        this.ranks[n] = BASE_GPKILLERS + 1;

      else if (this.grandparentNode && move == this.grandparentNode.killer2)
        this.ranks[n] = BASE_GPKILLERS;

      else
        this.ranks[n] = BASE_BADTAKES  + victim * 64 - attack;
    }
  }
}

//}}}
//{{{  .addPromotion

lozNode.prototype.addPromotion = function (move) {

  var n = 0;

  n             = this.numMoves++;
  this.moves[n] = move | QPRO;
  if ((move | QPRO) == this.hashMove)
    this.ranks[n] = BASE_HASH;
  else
    this.ranks[n] = BASE_PROMOTES + QUEEN;

  n             = this.numMoves++;
  this.moves[n] = move | RPRO;
  if ((move | RPRO) == this.hashMove)
    this.ranks[n] = BASE_HASH;
  else
    this.ranks[n] = BASE_PROMOTES + ROOK;

  n             = this.numMoves++;
  this.moves[n] = move | BPRO;
  if ((move | BPRO) == this.hashMove)
    this.ranks[n] = BASE_HASH;
  else
    this.ranks[n] = BASE_PROMOTES + BISHOP;

  n             = this.numMoves++;
  this.moves[n] = move | NPRO;
  if ((move | NPRO) == this.hashMove)
    this.ranks[n] = BASE_HASH;
  else
    this.ranks[n] = BASE_PROMOTES + KNIGHT;
}

//}}}
//{{{  .addEPTake

lozNode.prototype.addEPTake = function (move) {

  var n = this.numMoves++;

  this.moves[n] = move | MOVE_EPTAKE_MASK;

  if ((move | MOVE_EPTAKE_MASK) == this.hashMove)
    this.ranks[n] = BASE_HASH;
  else
    this.ranks[n] = BASE_EPTAKES;
}

//}}}
//{{{  .addQMove

lozNode.prototype.addQMove = function (move) {

  var n = this.numMoves++;

  this.moves[n] = move;

  if (move & MOVE_PROMOTE_MASK)
    this.ranks[n] = BASE_PROMOTES + ((move & MOVE_PROMAS_MASK) >>> MOVE_PROMAS_BITS); // QRBN.

  else if (move & MOVE_EPTAKE_MASK)
    this.ranks[n] = BASE_EPTAKES;

  else {
    var victim = RANK_VECTOR[((move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS) & PIECE_MASK];
    var attack = RANK_VECTOR[((move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS) & PIECE_MASK];

    if (victim > attack)
      this.ranks[n] = BASE_GOODTAKES + victim * 64 - attack;

    else if (victim == attack)
      this.ranks[n] = BASE_EVENTAKES + victim * 64 - attack;

    else
      this.ranks[n] = BASE_BADTAKES + victim * 64 - attack;
  }
}

//}}}
//{{{  .addQPromotion

lozNode.prototype.addQPromotion = function (move) {

  this.addQMove (move | (QUEEN-2)  << MOVE_PROMAS_BITS);
  this.addQMove (move | (ROOK-2)   << MOVE_PROMAS_BITS);
  this.addQMove (move | (BISHOP-2) << MOVE_PROMAS_BITS);
  this.addQMove (move | (KNIGHT-2) << MOVE_PROMAS_BITS);
}

//}}}
//{{{  .addKiller

lozNode.prototype.addKiller = function (score, move) {

  if (move == this.hashMove)
    return;

  if (move & (MOVE_EPTAKE_MASK | MOVE_PROMOTE_MASK))
    return;  // before killers in move ordering.

  if (move & MOVE_TOOBJ_MASK) {

    var victim = RANK_VECTOR[((move & MOVE_TOOBJ_MASK) >>> MOVE_TOOBJ_BITS) & PIECE_MASK];
    var attack = RANK_VECTOR[((move & MOVE_FROBJ_MASK) >>> MOVE_FROBJ_BITS) & PIECE_MASK];

    if (victim >= attack)
      return; // before killers in move ordering.
  }

  if (score >= MINMATE && score <= MATE) {
    this.mateKiller = move;
    if (this.killer1 == move)
      this.killer1 = 0;
    if (this.killer2 == move)
      this.killer2 = 0;
    return;
  }

  if (this.killer1 == move || this.killer2 == move) {
    return;
  }

  if (this.killer1 == 0) {
    this.killer1 = move;
    return;
  }

  if (this.killer2 == 0) {
    this.killer2 = move;
    return;
  }

  var tmp      = this.killer1;
  this.killer1 = move;
  this.killer2 = tmp;
}

//}}}

//}}}
//{{{  lozStats class

//{{{  lozStats

function lozStats () {
}

//}}}
//{{{  .init

lozStats.prototype.init = function () {

  this.startTime = Date.now();
  this.splitTime = 0;
  this.nodes     = 0;  // per analysis
  this.ply       = 0;  // current ID root ply
  this.splits    = 0;
  this.moveTime  = 0;
  this.maxNodes  = 0;
  this.timeOut   = 0;
  this.selDepth  = 0;
  this.bestMove  = 0;
}

//}}}
//{{{  .lazyUpdate

lozStats.prototype.lazyUpdate = function () {

  this.checkTime();

  if (Date.now() - this.splitTime > 500) {
    this.splits++;
    this.update();
    this.splitTime = Date.now();
  }
}

//}}}
//{{{  .checkTime

lozStats.prototype.checkTime = function () {

  if (this.moveTime > 0 && ((Date.now() - this.startTime) > this.moveTime))
    this.timeOut = 1;

  if (this.maxNodes > 0 && this.nodes >= this.maxNodes)
    this.timeOut = 1;
}

//}}}
//{{{  .nodeStr

lozStats.prototype.nodeStr = function () {

  var tim = Date.now() - this.startTime;
  var nps = (this.nodes * 1000) / tim | 0;

  return 'nodes ' + this.nodes + ' time ' + tim + ' nps ' + nps;
}

//}}}
//{{{  .update

lozStats.prototype.update = function () {

  var tim = Date.now() - this.startTime;
  var nps = (this.nodes * 1000) / tim | 0;

  lozza.uci.send('info',this.nodeStr());
}

//}}}
//{{{  .stop

lozStats.prototype.stop = function () {

  this.stopTime  = Date.now();
  this.time      = this.stopTime - this.startTime;
  this.timeSec   = myround(this.time / 100) / 10;
  this.nodesMega = myround(this.nodes / 100000) / 10;
}

//}}}

//}}}
//{{{  lozUCI class

//{{{  lozUCI

function lozUCI () {

  this.message   = '';
  this.tokens    = [];
  this.command   = '';
  this.spec      = {};
  this.debugging = DEBUG;
  this.nodefs    = 0;
  this.numMoves  = 0;

  this.options = {};
}

//}}}
//{{{  .post

lozUCI.prototype.post = function (s) {

  if (lozzaHost == HOST_NODEJS)
    this.nodefs.writeSync(1, s + '\n');

  else if (lozzaHost == HOST_WEB)
    postMessage(s);

  else
    console.log(s);
}

//}}}
//{{{  .send

lozUCI.prototype.send = function () {

  var s = '';

  for (var i = 0; i < arguments.length; i++)
    s += arguments[i] + ' ';

  this.post(s);
}

//}}}
//{{{  .debug

lozUCI.prototype.debug = function () {

  if (!this.debugging)
    return;

  var s = '';

  for (var i = 0; i < arguments.length; i++)
    s += arguments[i] + ' ';

  s = s.trim();

  if (s)
    this.post('info string debug ' + this.spec.id + ' ' + s);
  else
    this.post('info string debug ');
}

//}}}
//{{{  .getInt

lozUCI.prototype.getInt = function (key, def) {

  for (var i=0; i < this.tokens.length; i++)
    if (this.tokens[i] == key)
      if (i < this.tokens.length - 1)
        return parseInt(this.tokens[i+1]);

  return def;
}

//}}}
//{{{  .getStr

lozUCI.prototype.getStr = function (key, def) {

  for (var i=0; i < this.tokens.length; i++)
    if (this.tokens[i] == key)
      if (i < this.tokens.length - 1)
        return this.tokens[i+1];

  return def;
}

//}}}
//{{{  .getArr

lozUCI.prototype.getArr = function (key, to) {

  var lo = 0;
  var hi = 0;

  for (var i=0; i < this.tokens.length; i++) {
    if (this.tokens[i] == key) {
      lo = i + 1;  //assumes at least one item
      hi = lo;
      for (var j=lo; j < this.tokens.length; j++) {
        if (this.tokens[j] == to)
          break;
        hi = j;
      }
    }
  }

  return {lo:lo, hi:hi};
}

//}}}
//{{{  .onmessage

onmessage = function(e) {

  var uci = lozza.uci;

  uci.messageList = e.data.split('\n');

  for (var messageNum=0; messageNum < uci.messageList.length; messageNum++ ) {

    uci.message = uci.messageList[messageNum].replace(/(\r\n|\n|\r)/gm,"");
    uci.message = uci.message.trim();
    uci.message = uci.message.replace(/\s+/g,' ');

    uci.tokens  = uci.message.split(' ');
    uci.command = uci.tokens[0];

    if (!uci.command)
      continue;

    //{{{  shorthand
    
    if (uci.command == 'u')
      uci.command = 'ucinewgame';
    
    if (uci.command == 'b')
      uci.command = 'board';
    
    if (uci.command == 'q')
      uci.command = 'quit';
    
    if (uci.command == 'p') {
      uci.command = 'position';
      if (uci.tokens[1] == 's') {
        uci.tokens[1] = 'startpos';
      }
    }
    
    if (uci.command == 'g') {
      uci.command = 'go';
      if (uci.tokens[1] == 'd') {
        uci.tokens[1] = 'depth';
      }
    }
    
    //}}}

    switch (uci.command) {

    case 'position':
      //{{{  position
      
      uci.spec.board    = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
      uci.spec.turn     = 'w';
      uci.spec.rights   = 'KQkq';
      uci.spec.ep       = '-';
      uci.spec.hmc      = 0;
      uci.spec.fmc      = 1;
      uci.spec.id       = '';
      
      var arr = uci.getArr('fen','moves');
      
      if (arr.lo > 0) { // handle partial FENs
        if (arr.lo <= arr.hi) uci.spec.board  =          uci.tokens[arr.lo];  arr.lo++;
        if (arr.lo <= arr.hi) uci.spec.turn   =          uci.tokens[arr.lo];  arr.lo++;
        if (arr.lo <= arr.hi) uci.spec.rights =          uci.tokens[arr.lo];  arr.lo++;
        if (arr.lo <= arr.hi) uci.spec.ep     =          uci.tokens[arr.lo];  arr.lo++;
        if (arr.lo <= arr.hi) uci.spec.hmc    = parseInt(uci.tokens[arr.lo]); arr.lo++;
        if (arr.lo <= arr.hi) uci.spec.fmc    = parseInt(uci.tokens[arr.lo]); arr.lo++;
      }
      
      uci.spec.moves = [];
      
      var arr = uci.getArr('moves','fen');
      
      if (arr.lo > 0) {
        for (var i=arr.lo; i <= arr.hi; i++)
          uci.spec.moves.push(uci.tokens[i]);
      }
      
      lozza.position();
      
      break;
      
      //}}}

    case 'go':
      //{{{  go
      
      if (!uci.spec.board) {
        uci.send('info string send a position command first and a ucinewgame before that if you need to reset the hash');
        return;
      }
      
      lozza.stats.init();
      
      uci.spec.depth     = uci.getInt('depth',0);
      uci.spec.moveTime  = uci.getInt('movetime',0);
      uci.spec.maxNodes  = uci.getInt('nodes',0);
      uci.spec.wTime     = uci.getInt('wtime',0);
      uci.spec.bTime     = uci.getInt('btime',0);
      uci.spec.wInc      = uci.getInt('winc',0);
      uci.spec.bInc      = uci.getInt('binc',0);
      uci.spec.movesToGo = uci.getInt('movestogo',0);
      
      uci.numMoves++;
      
      lozza.go();
      
      break;
      
      //}}}

    case 'ucinewgame':
      //{{{  ucinewgame
      
      lozza.newGameInit();
      
      break;
      
      //}}}

    case 'quit':
      //{{{  quit
      
      if (lozzaHost == HOST_NODEJS)
        process.exit();
      else
        close();
      
      break;
      
      //}}}

    case 'stop':
      //{{{  stop
      
      lozza.stats.timeOut = 1;
      
      break;
      
      //}}}

    case 'bench':
      //{{{  bench
      
      uci.debugging = 1;
      
      for (var i=0; i < WS_PST.length; i++) {
        var wpst = WS_PST[i];
        var bpst = BS_PST[i];
        if (wpst.length != 144)
          uci.debug('ws pst len err',i)
        if (bpst.length != 144)
          uci.debug('bs pst len err',i)
        for (var j=0; j < wpst.length; j++) {
          if (wpst[j] != bpst[wbmap(j)])
            uci.debug('s pst err',i,j,wpst[j],bpst[wbmap(j)])
        }
      }
      
      for (var i=0; i < WE_PST.length; i++) {
        var wpst = WE_PST[i];
        var bpst = BE_PST[i];
        if (wpst.length != 144)
          uci.debug('we pst len err',i)
        if (bpst.length != 144)
          uci.debug('be pst len err',i)
        for (var j=0; j < wpst.length; j++) {
          if (wpst[j] != bpst[wbmap(j)])
            uci.debug('e pst err',i,j,wpst[j],bpst[wbmap(j)])
        }
      }
      
      if (WOUTPOST.length != 144)
        uci.debug('w outpost len err',i)
      if (BOUTPOST.length != 144)
        uci.debug('b outpost len err',i)
      for (var j=0; j < WOUTPOST.length; j++) {
        if (WOUTPOST[j] != BOUTPOST[wbmap(j)])
          uci.debug('outpost err',j,WOUTPOST[j],BOUTPOST[wbmap(j)])
      }
      
      for (var i=0; i < 144; i++) {
        for (var j=0; j < 144; j++) {
          if (WKZONES[i][j] != BKZONES[wbmap(i)][wbmap(j)])
            uci.debug('kzones err',i,j,WKZONES[i][j],BKZONES[i][j])
        }
      }
      
      uci.debug('bench done ok')
      
      uci.debugging = 0;
      
      break;
      
      //}}}

    case 'debug':
      //{{{  debug
      
      if (uci.getStr('debug','off') == 'on')
        uci.debugging = 1;
      else
        uci.debugging = 0;
      
      break;
      
      //}}}

    case 'uci':
      //{{{  uci
      
      uci.send('id name Lozza',BUILD);
      uci.send('id author Colin Jenkins');
      //uci.send('option');
      uci.send('uciok');
      
      break;
      
      //}}}

    case 'isready':
      //{{{  isready
      
      uci.send('readyok');
      
      break;
      
      //}}}

    case 'setoption':
      //{{{  setoption
      
      var key = uci.getStr('name');
      var val = uci.getStr('value');
      
      uci.options[key] = val;
      
      break;
      
      //}}}

    case 'ping':
      //{{{  ping
      
      uci.send('info string Lozza build',BUILD,HOSTS[lozzaHost],'is alive');
      
      break;
      
      //}}}

    case 'id':
      //{{{  id
      
      uci.spec.id = uci.tokens[1];
      
      break;
      
      //}}}

    case 'perft':
      //{{{  perft
      
      uci.spec.depth = uci.getInt('depth',0);
      uci.spec.moves = uci.getInt('moves',0);
      uci.spec.inner = uci.getInt('inner',0);
      
      lozza.perft();
      
      break;
      
      //}}}

    case 'eval':
      //{{{  eval
      
      lozza.board.verbose = true;
      lozza.board.evaluate(lozza.board.turn);
      //lozza.board.evaluate(lozza.board.turn);  //  uses pawn hash.
      lozza.board.verbose = false;
      
      break;
      
      //}}}

    case 'board':
      //{{{  board
      
      uci.send('board',lozza.board.fen());
      
      break;
      
      //}}}

    default:
      //{{{  ?
      
      uci.send('info string','unknown command',uci.command);
      
      break;
      
      //}}}
    }
  }
}

//}}}

//}}}

var lozza         = new lozChess()
lozza.board.lozza = lozza;

//{{{  node interface

if (lozzaHost == HOST_NODEJS) {

  lozza.uci.nodefs = require('fs');

  process.stdin.setEncoding('utf8');

  process.stdin.on('readable', function() {
    var chunk = process.stdin.read();
    process.stdin.resume();
    if (chunk !== null) {
      onmessage({data: chunk});
    }
  });

  process.stdin.on('end', function() {
    process.exit();
  });
}

//}}}

