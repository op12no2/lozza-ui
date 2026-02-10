#!/usr/local/bin/node
"use strict"

const INT32_MIN = -0x80000000; // -2147483648
const INT32_MAX =  0x7fffffff; // 2147483647
const INT16_MIN = -0x8000; // -32768
const INT16_MAX =  0x7fff; // 32767

const INF = 31000;
const MATE = 30000;
const MATEISH = 29000;
const MAX_MOVES = 256;
const MAX_PLY = 64;

const WHITE = 0;
const BLACK = 8;

const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;

const WPAWN = PAWN | WHITE;
const WKNIGHT = KNIGHT | WHITE;
const WBISHOP = BISHOP | WHITE;
const WROOK = ROOK | WHITE;
const WQUEEN = QUEEN | WHITE;
const WKING = KING | WHITE;

const BPAWN = PAWN | BLACK;
const BKNIGHT = KNIGHT | BLACK;
const BBISHOP = BISHOP | BLACK;
const BROOK = ROOK | BLACK;
const BQUEEN = QUEEN | BLACK;
const BKING = KING | BLACK;

const WHITE_RIGHTS_KING = 1;
const WHITE_RIGHTS_QUEEN = 2;
const BLACK_RIGHTS_KING = 4;
const BLACK_RIGHTS_QUEEN = 8;

const MOVE_FLAG_CAPTURE = 1 << 14;
const MOVE_FLAG_EPCAPTURE = 2 << 14;  // will also have MOVE_FLAG_CAPTURE set 
const MOVE_FLAG_CASTLE = 4 << 14;   
const MOVE_FLAG_PROMOTE = 8 << 14; // may also have MOVE_FLAG_CAPTURE set
const MOVE_FLAG_SPECIAL = MOVE_FLAG_PROMOTE | MOVE_FLAG_EPCAPTURE | MOVE_FLAG_CASTLE;
const MOVE_FLAG_NOISY = MOVE_FLAG_PROMOTE | MOVE_FLAG_CAPTURE;
const PROMOTE_SHIFT = 20; // KNIGHT, BISHOP, ROOK, QUEEN

const RIGHTS_TABLE = new Uint8Array(128);
RIGHTS_TABLE.fill(15);
RIGHTS_TABLE[0x00] = 15 & ~WHITE_RIGHTS_QUEEN;                        // a1
RIGHTS_TABLE[0x04] = 15 & ~(WHITE_RIGHTS_KING | WHITE_RIGHTS_QUEEN);  // e1
RIGHTS_TABLE[0x07] = 15 & ~WHITE_RIGHTS_KING;                         // h1
RIGHTS_TABLE[0x70] = 15 & ~BLACK_RIGHTS_QUEEN;                        // a8
RIGHTS_TABLE[0x74] = 15 & ~(BLACK_RIGHTS_KING | BLACK_RIGHTS_QUEEN);  // e8
RIGHTS_TABLE[0x77] = 15 & ~BLACK_RIGHTS_KING;                         // h8

const KNIGHT_OFFSETS = new Int8Array([-33, -31, -18, -14, 14, 18, 31, 33]);
const BISHOP_OFFSETS = new Int8Array([-17, -15, 15, 17]);
const ROOK_OFFSETS = new Int8Array([-16, -1, 1, 16]);
const QUEEN_OFFSETS = new Int8Array([-17, -16, -15, -1, 1, 15, 16, 17]);
const KING_OFFSETS = new Int8Array([-17, -16, -15, -1, 1, 15, 16, 17]);

const DELTA_VALS = new Int16Array(7);
DELTA_VALS[PAWN]   = 100;
DELTA_VALS[KNIGHT] = 350;
DELTA_VALS[BISHOP] = 350;
DELTA_VALS[ROOK]   = 525;
DELTA_VALS[QUEEN]  = 1000;

// board globals - maintained throughout search via make and unmake funcs

const g_board = new Uint8Array(128); 
const g_plix = new Uint8Array(128);  // piece list index per square
const g_pieces = new Uint8Array(34); // piece lists
let g_stm = 0;
let g_rights = 0;
let g_ep = 0;
let g_loHash = 0;
let g_hiHash = 0;

// time control globals

let g_nodes = 0; // node counter (init to 0)
let g_maxNodes = 0; // node target if given (else 0)
let g_maxDepth = 0; // target depth if given (set to MAX_PLY otherwise)
let g_startTime = 0; // always set via now()
let g_finishTime = 0; // finish time if appropriate (else 0)
let g_finished = 0; // 1 when time/nodes reached (else 0)

function now() {
  return performance.now() | 0;
}

const PERFTFENS = [
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 0, 1,         'startpos-0'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 1, 20,        'startpos-1'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 2, 400,       'startpos-2'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 3, 8902,      'startpos-3'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 4, 197281,    'startpos-4'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 5, 4865609,   'startpos-5'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1', 1, 48,        'kiwipete-1'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1', 2, 2039,      'kiwipete-2'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1', 3, 97862,     'kiwipete-3'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1', 4, 4085603,   'kiwipete-4'],
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w Q    -  0 1', 3, 4729,      'castling-2'],
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w K    -  0 1', 3, 4686,      'castling-3'],
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w -    -  0 1', 3, 4522,      'castling-4'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b kq   -  0 1', 3, 4893,      'castling-5'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b q    -  0 1', 3, 4729,      'castling-6'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b k    -  0 1', 3, 4686,      'castling-7'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b -    -  0 1', 3, 4522,      'castling-8'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1', 1, 42,        'cpw-pos5-1'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1', 2, 1352,      'cpw-pos5-2'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq -  0 1', 3, 53392,     'cpw-pos5-3'],
  ['fen 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8                         w -    -  0 1', 5, 674624,    'cpw-pos3-5'],
  ['fen n1n5/PPPk4/8/8/8/8/4Kppp/5N1N                           b -    -  0 1', 1, 24,        'prom-1    '],
  ['fen 8/5bk1/8/2Pp4/8/1K6/8/8                                 w -    d6 0 1', 6, 824064,    'ccc-1     '],
  ['fen 8/8/1k6/8/2pP4/8/5BK1/8                                 b -    d3 0 1', 6, 824064,    'ccc-2     '],
  ['fen 8/8/1k6/2b5/2pP4/8/5K2/8                                b -    d3 0 1', 6, 1440467,   'ccc-3     '],
  ['fen 8/5k2/8/2Pp4/2B5/1K6/8/8                                w -    d6 0 1', 6, 1440467,   'ccc-4     '],
  ['fen 5k2/8/8/8/8/8/8/4K2R                                    w K    -  0 1', 6, 661072,    'ccc-5     '],
  ['fen 4k2r/8/8/8/8/8/8/5K2                                    b k    -  0 1', 6, 661072,    'ccc-6     '],
  ['fen 3k4/8/8/8/8/8/8/R3K3                                    w Q    -  0 1', 6, 803711,    'ccc-7     '],
  ['fen r3k3/8/8/8/8/8/8/3K4                                    b q    -  0 1', 6, 803711,    'ccc-8     '],
  ['fen r3k2r/1b4bq/8/8/8/8/7B/R3K2R                            w KQkq -  0 1', 4, 1274206,   'ccc-9     '],
  ['fen r3k2r/7b/8/8/8/8/1B4BQ/R3K2R                            b KQkq -  0 1', 4, 1274206,   'ccc-10    '],
  ['fen r3k2r/8/3Q4/8/8/5q2/8/R3K2R                             b KQkq -  0 1', 4, 1720476,   'ccc-11    '],
  ['fen r3k2r/8/5Q2/8/8/3q4/8/R3K2R                             w KQkq -  0 1', 4, 1720476,   'ccc-12    '],
  ['fen 2K2r2/4P3/8/8/8/8/8/3k4                                 w -    -  0 1', 6, 3821001,   'ccc-13    '],
  ['fen 3K4/8/8/8/8/8/4p3/2k2R2                                 b -    -  0 1', 6, 3821001,   'ccc-14    '],
  ['fen 8/8/1P2K3/8/2n5/1q6/8/5k2                               b -    -  0 1', 5, 1004658,   'ccc-15    '],
  ['fen 5K2/8/1Q6/2N5/8/1p2k3/8/8                               w -    -  0 1', 5, 1004658,   'ccc-16    '],
  ['fen 4k3/1P6/8/8/8/8/K7/8                                    w -    -  0 1', 6, 217342,    'ccc-17    '],
  ['fen 8/k7/8/8/8/8/1p6/4K3                                    b -    -  0 1', 6, 217342,    'ccc-18    '],
  ['fen 8/P1k5/K7/8/8/8/8/8                                     w -    -  0 1', 6, 92683,     'ccc-19    '],
  ['fen 8/8/8/8/8/k7/p1K5/8                                     b -    -  0 1', 6, 92683,     'ccc-20    '],
  ['fen K1k5/8/P7/8/8/8/8/8                                     w -    -  0 1', 6, 2217,      'ccc-21    '],
  ['fen 8/8/8/8/8/p7/8/k1K5                                     b -    -  0 1', 6, 2217,      'ccc-22    '],
  ['fen 8/k1P5/8/1K6/8/8/8/8                                    w -    -  0 1', 7, 567584,    'ccc-23    '],
  ['fen 8/8/8/8/1k6/8/K1p5/8                                    b -    -  0 1', 7, 567584,    'ccc-24    '],
  ['fen 8/8/2k5/5q2/5n2/8/5K2/8                                 b -    -  0 1', 4, 23527,     'ccc-25    '],
  ['fen 8/5k2/8/5N2/5Q2/2K5/8/8                                 w -    -  0 1', 4, 23527,     'ccc-26    '],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq -  0 1', 6, 119060324, 'cpw-pos1-6'],
  ['fen 8/p7/8/1P6/K1k3p1/6P1/7P/8                              w -    -  0 1', 8, 8103790,   'jvm-7     '],
  ['fen n1n5/PPPk4/8/8/8/8/4Kppp/5N1N                           b -    -  0 1', 6, 71179139,  'jvm-8     '],
  ['fen r3k2r/p6p/8/B7/1pp1p3/3b4/P6P/R3K2R                     w KQkq -  0 1', 6, 77054993,  'jvm-9     '],
  ['fen 8/5p2/8/2k3P1/p3K3/8/1P6/8                              b -    -  0 1', 8, 64451405,  'jvm-11    '],
  ['fen r3k2r/pb3p2/5npp/n2p4/1p1PPB2/6P1/P2N1PBP/R3K2R         w KQkq -  0 1', 5, 29179893,  'jvm-12    '],
  ['fen 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8                         w -    -  0 1', 7, 178633661, 'jvm-10    '],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -  0 1', 5, 193690690, 'jvm-6     '],
  ['fen 8/2pkp3/8/RP3P1Q/6B1/8/2PPP3/rb1K1n1r                   w -    -  0 1', 6, 181153194, 'ob1       '],
  ['fen rnbqkb1r/ppppp1pp/7n/4Pp2/8/8/PPPP1PPP/RNBQKBNR         w KQkq f6 0 1', 6, 244063299, 'jvm-5     '],
  ['fen 8/2ppp3/8/RP1k1P1Q/8/8/2PPP3/rb1K1n1r                   w -    -  0 1', 6, 205552081, 'ob2       '],
  ['fen 8/8/3q4/4r3/1b3n2/8/3PPP2/2k1K2R                        w K    -  0 1', 6, 207139531, 'ob3       '],
  ['fen 4r2r/RP1kP1P1/3P1P2/8/8/3ppp2/1p4p1/4K2R                b K    -  0 1', 6, 314516438, 'ob4       '],
  ['fen r3k2r/8/8/8/3pPp2/8/8/R3K1RR                            b KQkq e3 0 1', 6, 485647607, 'jvm-1     '],
  ['fen 8/3K4/2p5/p2b2r1/5k2/8/8/1q6                            b -    -  0 1', 7, 493407574, 'jvm-4     '],
  ['fen r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1   w kq   -  0 1', 6, 706045033, 'jvm-2     '],
  ['fen r6r/1P4P1/2kPPP2/8/8/3ppp2/1p4p1/R3K2R                  w KQ   -  0 1', 6, 975944981, 'ob5       ']
];

const BENCHFENS = [

"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkQ - 0 1",
"r3k2r/2pb1ppp/2pp1q2/p7/1nP1B3/1P2P3/P2N1PPP/R2QK2R w KQkq a6 0 14",
"4rrk1/2p1b1p1/p1p3q1/4p3/2P2n1p/1P1NR2P/PB3PP1/3R1QK1 b - - 2 24",
"r3qbrk/6p1/2b2pPp/p3pP1Q/PpPpP2P/3P1B2/2PB3K/R5R1 w - - 16 42",
"6k1/1R3p2/6p1/2Bp3p/3P2q1/P7/1P2rQ1K/5R2 b - - 4 44",
"8/8/1p2k1p1/3p3p/1p1P1P1P/1P2PK2/8/8 w - - 3 54",
"7r/2p3k1/1p1p1qp1/1P1Bp3/p1P2r1P/P7/4R3/Q4RK1 w - - 0 36",
"r1bq1rk1/pp2b1pp/n1pp1n2/3P1p2/2P1p3/2N1P2N/PP2BPPP/R1BQ1RK1 b - - 2 10",
"3r3k/2r4p/1p1b3q/p4P2/P2Pp3/1B2P3/3BQ1RP/6K1 w - - 3 87",
"2r4r/1p4k1/1Pnp4/3Qb1pq/8/4BpPp/5P2/2RR1BK1 w - - 0 42",
"4q1bk/6b1/7p/p1p4p/PNPpP2P/KN4P1/3Q4/4R3 b - - 0 37",
"2q3r1/1r2pk2/pp3pp1/2pP3p/P1Pb1BbP/1P4Q1/R3NPP1/4R1K1 w - - 2 34",
"1r2r2k/1b4q1/pp5p/2pPp1p1/P3Pn2/1P1B1Q1P/2R3P1/4BR1K b - - 1 37",
"r3kbbr/pp1n1p1P/3ppnp1/q5N1/1P1pP3/P1N1B3/2P1QP2/R3KB1R b KQkq b3 0 17",
"8/6pk/2b1Rp2/3r4/1R1B2PP/P5K1/8/2r5 b - - 16 42",
"1r4k1/4ppb1/2n1b1qp/pB4p1/1n1BP1P1/7P/2PNQPK1/3RN3 w - - 8 29",
"8/p2B4/PkP5/4p1pK/4Pb1p/5P2/8/8 w - - 29 68",
"3r4/ppq1ppkp/4bnp1/2pN4/2P1P3/1P4P1/PQ3PBP/R4K2 b - - 2 20",
"5rr1/4n2k/4q2P/P1P2n2/3B1p2/4pP2/2N1P3/1RR1K2Q w - - 1 49",
"1r5k/2pq2p1/3p3p/p1pP4/4QP2/PP1R3P/6PK/8 w - - 1 51",
"q5k1/5ppp/1r3bn1/1B6/P1N2P2/BQ2P1P1/5K1P/8 b - - 2 34",
"r1b2k1r/5n2/p4q2/1ppn1Pp1/3pp1p1/NP2P3/P1PPBK2/1RQN2R1 w - - 0 22",
"r1bqk2r/pppp1ppp/5n2/4b3/4P3/P1N5/1PP2PPP/R1BQKB1R w KQkq - 0 5",
"r1bqr1k1/pp1p1ppp/2p5/8/3N1Q2/P2BB3/1PP2PPP/R3K2n b Q - 1 12",
"r1bq2k1/p4r1p/1pp2pp1/3p4/1P1B3Q/P2B1N2/2P3PP/4R1K1 b - - 2 19",
"r4qk1/6r1/1p4p1/2ppBbN1/1p5Q/P7/2P3PP/5RK1 w - - 2 25",
"r7/6k1/1p6/2pp1p2/7Q/8/p1P2K1P/8 w - - 0 32",
"r3k2r/ppp1pp1p/2nqb1pn/3p4/4P3/2PP4/PP1NBPPP/R2QK1NR w KQkq - 1 5",
"3r1rk1/1pp1pn1p/p1n1q1p1/3p4/Q3P3/2P5/PP1NBPPP/4RRK1 w - - 0 12",
"5rk1/1pp1pn1p/p3Brp1/8/1n6/5N2/PP3PPP/2R2RK1 w - - 2 20",
"8/1p2pk1p/p1p1r1p1/3n4/8/5R2/PP3PPP/4R1K1 b - - 3 27",
"8/4pk2/1p1r2p1/p1p4p/Pn5P/3R4/1P3PP1/4RK2 w - - 1 33",
"8/5k2/1pnrp1p1/p1p4p/P6P/4R1PK/1P3P2/4R3 b - - 1 38",
"8/8/1p1kp1p1/p1pr1n1p/P6P/1R4P1/1P3PK1/1R6 b - - 15 45",
"8/8/1p1k2p1/p1prp2p/P2n3P/6P1/1P1R1PK1/4R3 b - - 5 49",
"8/8/1p4p1/p1p2k1p/P2npP1P/4K1P1/1P6/3R4 w - - 6 54",
"8/8/1p4p1/p1p2k1p/P2n1P1P/4K1P1/1P6/6R1 b - - 6 59",
"8/5k2/1p4p1/p1pK3p/P2n1P1P/6P1/1P6/4R3 b - - 14 63",
"8/1R6/1p1K1kp1/p6p/P1p2P1P/6P1/1Pn5/8 w - - 0 67",
"1rb1rn1k/p3q1bp/2p3p1/2p1p3/2P1P2N/PP1RQNP1/1B3P2/4R1K1 b - - 4 23",
"4rrk1/pp1n1pp1/q5p1/P1pP4/2n3P1/7P/1P3PB1/R1BQ1RK1 w - - 3 22",
"r2qr1k1/pb1nbppp/1pn1p3/2ppP3/3P4/2PB1NN1/PP3PPP/R1BQR1K1 w - - 4 12",
"2r2k2/8/4P1R1/1p6/8/P4K1N/7b/2B5 b - - 0 55",
"6k1/5pp1/8/2bKP2P/2P5/p4PNb/B7/8 b - - 1 44",
"2rqr1k1/1p3p1p/p2p2p1/P1nPb3/2B1P3/5P2/1PQ2NPP/R1R4K w - - 3 25",
"r1b2rk1/p1q1ppbp/6p1/2Q5/8/4BP2/PPP3PP/2KR1B1R b - - 2 14",
"6r1/5k2/p1b1r2p/1pB1p1p1/1Pp3PP/2P1R1K1/2P2P2/3R4 w - - 1 36",
"rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2",
"2rr2k1/1p4bp/p1q1p1p1/4Pp1n/2PB4/1PN3P1/P3Q2P/2RR2K1 w - f6 0 20",
"3br1k1/p1pn3p/1p3n2/5pNq/2P1p3/1PN3PP/P2Q1PB1/4R1K1 w - - 0 23",
"2r2b2/5p2/5k2/p1r1pP2/P2pB3/1P3P2/K1P3R1/7R w - - 23 93"
];
let g_seed = 1;

let g_loStm = 0;
let g_hiStm = 0;

const g_loPieces = Array(15);
const g_hiPieces = Array(15);

const g_loRights = new Int32Array(16);
const g_hiRights = new Int32Array(16);

const g_loEP = new Int32Array(128);
const g_hiEP = new Int32Array(128);

function rand32(seed) { // Mulberry32
  seed = seed + 0x6D2B79F5 | 0;
  var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
  return ((t ^ (t >>> 14)) >>> 0);
}

function initZobrist() {

  g_loStm = rand32(g_seed++);
  g_hiStm = rand32(g_seed++);

  for (let i=0; i < 15; i++) {
    g_loPieces[i] = new Int32Array(128);
    g_hiPieces[i] = new Int32Array(128);
    for (let j=0; j < 128; j++){
      g_loPieces[i][j] = rand32(g_seed++);
      g_hiPieces[i][j] = rand32(g_seed++);
    }
  }

  for (let i=0; i < 16; i++) {
    g_loRights[i] = rand32(g_seed++);
    g_hiRights[i] = rand32(g_seed++);
  }

  for (let i=0; i < 128; i++) {
    g_loEP[i] = rand32(g_seed++);
    g_hiEP[i] = rand32(g_seed++);
  }

}

const TT_EXACT = 1;
const TT_ALPHA = 2;
const TT_BETA = 3;
const TT_TYPE_MASK = 3;
const TT_INCHECK = 4;
const TT_DEFAULT = 16; // mb
const TT_WIDTH = 18; // bytes - see below

let g_ttSize = 1;
let g_ttMask = 0; // 0 implies tt not resized yet

let g_ttLoHash = new Int32Array(g_ttSize); // 4
let g_ttHiHash = new Int32Array(g_ttSize); // 4
let g_ttType = new Uint8Array(g_ttSize); // 1
let g_ttDepth = new Int8Array(g_ttSize); // 1
let g_ttMove = new Uint32Array(g_ttSize); // 4
let g_ttEval = new Int16Array(g_ttSize); // 2
let g_ttScore = new Int16Array(g_ttSize); // 2

function ttResize(mb) {

  const bytesPerEntry = TT_WIDTH;
  const requestedBytes = mb * 1024 * 1024;
  const entriesNeeded = requestedBytes / bytesPerEntry;
  const pow2 = Math.ceil(Math.log2(entriesNeeded));

  g_ttSize = 1 << pow2;
  g_ttMask = g_ttSize - 1;

  g_ttLoHash = new Int32Array(g_ttSize);
  g_ttHiHash = new Int32Array(g_ttSize);
  g_ttType = new Uint8Array(g_ttSize);
  g_ttDepth = new Int8Array(g_ttSize);
  g_ttMove = new Uint32Array(g_ttSize);
  g_ttEval = new Int16Array(g_ttSize);
  g_ttScore = new Int16Array(g_ttSize);

  uciSend('info tt bits ' + pow2 + ' entries ' + g_ttSize + ' (0x' + g_ttSize.toString(16) + ') mb ' + Math.trunc((TT_WIDTH * g_ttSize) / (1024 * 1024)));

}

function ttPut(type, depth, score, move, ev, inCheck) {

  const idx = g_loHash & g_ttMask;

  g_ttLoHash[idx] = g_loHash;
  g_ttHiHash[idx] = g_hiHash;
  g_ttType[idx] = inCheck ? type | TT_INCHECK : type;
  g_ttDepth[idx] = depth;
  g_ttScore[idx] = score;
  g_ttEval[idx] = ev;
  g_ttMove[idx] = move;

}

function ttGet() {

  const idx = g_loHash & g_ttMask;

  if (g_ttType[idx] && g_ttLoHash[idx] === g_loHash && g_ttHiHash[idx] === g_hiHash)
    return idx;

  return -1;

}

function ttClear() {

  g_ttType.fill(0);

}

function putAdjustedScore(ply, score) {

  if (score < -MATEISH)
    return score - ply;

  else if (score > MATEISH)
    return score + ply;

  else
   return score;

}

function getAdjustedScore(ply, score) {

  if (score < -MATEISH)
    return score + ply;

  else if (score > MATEISH)
    return score - ply;

  else
    return score;

}

function nodeStruct() {

  this.numMoves = 0;
  this.moves = new Uint32Array(MAX_MOVES);
  this.ranks = new Int32Array(MAX_MOVES);
  this.playedMoves = new Uint32Array(MAX_MOVES); // for applying penalties on beta cutoff
  this.nextMove = 0; // for move iterator
  this.ttMove = 0;  // for move iterator
  this.inCheck = 0; // for move iterator (gen castling moves when not in check)
  this.noisyOnly = 0; // for move iterator (qsearch skips quiets)
  this.stage = 0; // for move iterator
  this.pv = new Uint32Array(MAX_MOVES);
  this.pvLen = 0;
  this.undoRights = 0; // undo* for unmake()
  this.undoEp = 0;
  this.undoCaptured = 0;
  this.undoCapIdx = 0;
  this.undoLoHash = 0;
  this.undoHiHash = 0;
  this.undoHmClock = 0;

}

const g_ss = Array(MAX_PLY);

let rootNode = null;

function initNodes () {
  for (let i=0; i < MAX_PLY; i++) {
    g_ss[i] = new nodeStruct;
  }
  rootNode = g_ss[0];
}

function formatMove(move) {

  const fr = (move >> 7) & 0x7F;
  const to = move & 0x7F;

  let s = String.fromCharCode(97 + (fr & 7))
        + String.fromCharCode(49 + (fr >> 4))
        + String.fromCharCode(97 + (to & 7))
        + String.fromCharCode(49 + (to >> 4));

  if (move & MOVE_FLAG_PROMOTE)
    s += 'nbrq'[(move >> PROMOTE_SHIFT) - 2];

  return s;
}


const pieceChar = [' ', 'P', 'N', 'B', 'R', 'Q', 'K', ' ', ' ', 'p', 'n', 'b', 'r', 'q', 'k'];

const charPiece = new Uint8Array(128);
charPiece[80] = WPAWN;    // P
charPiece[78] = WKNIGHT;  // N
charPiece[66] = WBISHOP;  // B
charPiece[82] = WROOK;    // R
charPiece[81] = WQUEEN;   // Q
charPiece[75] = WKING;    // K
charPiece[112] = BPAWN;   // p
charPiece[110] = BKNIGHT; // n
charPiece[98] = BBISHOP;  // b
charPiece[114] = BROOK;   // r
charPiece[113] = BQUEEN;  // q
charPiece[107] = BKING;   // k

function position(boardStr, stmStr, rightsStr, epStr, moves) {

  g_hhNext = 0;
  g_hmClock = 0;

  g_board.fill(0);

  let rank = 7;
  let file = 0;

  for (let i = 0; i < boardStr.length; i++) {
    const cc = boardStr.charCodeAt(i);
    if (cc === 47) { // /
      rank--;
      file = 0;
    }
    else if (cc >= 49 && cc <= 56)
      file += cc - 48;
    else {
      g_board[rank * 16 + file] = charPiece[cc];
      file++;
    }
  }

  if (stmStr === 'w')
    g_stm = WHITE;
  else
    g_stm = BLACK;

  g_rights = 0;
  for (let i = 0; i < rightsStr.length; i++) {
    const cc = rightsStr.charCodeAt(i);
    if (cc === 75)       // K
      g_rights |= WHITE_RIGHTS_KING;
    else if (cc === 81)  // Q
      g_rights |= WHITE_RIGHTS_QUEEN;
    else if (cc === 107) // k
      g_rights |= BLACK_RIGHTS_KING;
    else if (cc === 113) // q
      g_rights |= BLACK_RIGHTS_QUEEN;
  }

  if (epStr === '-')
    g_ep = 0;
  else
    g_ep = (epStr.charCodeAt(1) - 49) * 16 + (epStr.charCodeAt(0) - 97);

  // build piece list

  const pl = g_pieces;
  const b = g_board;
  const px = g_plix;

  pl.fill(0);
  px.fill(0);

  let wCount = 1;
  let bCount = 1;

  for (let sq = 0; sq < 128; sq++) {

    if (sq & 0x88) {
      sq += 7;
      continue;
    }

    const piece = b[sq];

    if (!piece)
      continue;

    if (piece & BLACK) {
      if ((piece & 7) === KING) {
        pl[17 + 1] = sq;
        px[sq] = 1;
      }
      else {
        bCount++;
        pl[17 + bCount] = sq;
        px[sq] = bCount;
      }
    }
    else {
      if ((piece & 7) === KING) {
        pl[0 + 1] = sq;
        px[sq] = 1;
      }
      else {
        wCount++;
        pl[0 + wCount] = sq;
        px[sq] = wCount;
      }
    }
  }

  pl[0]  = wCount;
  pl[17] = bCount;

  // init hash

  g_loHash = 0;
  g_hiHash = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = b[sq];
    if (piece) {
      g_loHash ^= g_loPieces[piece][sq];
      g_hiHash ^= g_hiPieces[piece][sq];
    }
  }

  g_loHash ^= g_loRights[g_rights];
  g_hiHash ^= g_hiRights[g_rights];

  if (g_ep) {
    g_loHash ^= g_loEP[g_ep];
    g_hiHash ^= g_hiEP[g_ep];
  }

  if (g_stm === BLACK) {
    g_loHash ^= g_loStm;
    g_hiHash ^= g_hiStm;
  }

  if (moves) {
    for (let m = 0; m < moves.length; m++) {
      rootNode.numMoves = 0;
      genNoisy(rootNode);
      genQuiets(rootNode);
      genCastling(rootNode);
      let found = 0;
      for (let i = 0; i < rootNode.numMoves; i++) {
        if (formatMove(rootNode.moves[i]) === moves[m]) {
          make(rootNode, rootNode.moves[i]);
          found = 1;
          break;
        }
      }
      if (!found) {
        uciSend('info string illegal move ' + moves[m]);
        return;
      }
    }
  }
}

function printBoard() {

  const sep = '  +---+---+---+---+---+---+---+---+';

  uciSend(sep);

  for (let rank = 7; rank >= 0; rank--) {
    let line = (rank + 1) + ' |';
    for (let file = 0; file < 8; file++) {
      const piece = g_board[rank * 16 + file];
      const ch = piece ? pieceChar[piece] : ' ';
      line += ' ' + ch + ' |';
    }
    uciSend(line);
    uciSend(sep);
  }

  uciSend('    a   b   c   d   e   f   g   h');

  let rightsStr = '';
  if (g_rights & WHITE_RIGHTS_KING)
    rightsStr += 'K';
  if (g_rights & WHITE_RIGHTS_QUEEN)
    rightsStr += 'Q';
  if (g_rights & BLACK_RIGHTS_KING)
    rightsStr += 'k';
  if (g_rights & BLACK_RIGHTS_QUEEN)
    rightsStr += 'q';
  if (!rightsStr)
    rightsStr = '-';

  let epStr = '-';
  if (g_ep) {
    const file = g_ep & 0x0F;
    const rank = g_ep >> 4;
    epStr = String.fromCharCode(97 + file) + String.fromCharCode(49 + rank);
  }

  uciSend('');
  uciSend('  stm: ' + (g_stm === WHITE ? 'w' : 'b') + ' rights: ' + rightsStr + ' ep: ' + epStr);
}

function isProbablyLegal(move) {

  const b = g_board;
  const fr = (move >> 7) & 0x7F;
  const to = move & 0x7F;

  // off board check

  if ((fr | to) & 0x88)
    return 0;

  // from must have a piece of stm colour

  const frPiece = b[fr];

  if (!frPiece || (frPiece & BLACK) !== g_stm)
    return 0;

  // to must be empty or opposite colour (unless castling)

  const toPiece = b[to];

  if (move & MOVE_FLAG_CASTLE)
    return (frPiece & 7) === KING;

  if (toPiece) {
    if ((toPiece & BLACK) === g_stm)
      return 0;
    if (!(move & MOVE_FLAG_CAPTURE))
      return 0;
  }
  else if (move & MOVE_FLAG_CAPTURE) {
    if (!(move & MOVE_FLAG_EPCAPTURE))
      return 0;
  }

  // promote flag must match pawn on correct rank

  if (move & MOVE_FLAG_PROMOTE) {
    if ((frPiece & 7) !== PAWN)
      return 0;
  }

  return 1;

}

function isAttacked(sq, byColour) {

  const b = g_board;

  // pawn

  const pawnDir = byColour === WHITE ? -16 : 16;
  const pawnPiece = PAWN | byColour;

  for (let i = -1; i <= 1; i += 2) {
    const from = sq + pawnDir + i;
    if (!(from & 0x88) && b[from] === pawnPiece)
      return 1;
  }

  // knight

  const knightPiece = KNIGHT | byColour;

  for (let i = 0; i < 8; i++) {
    const from = sq + KNIGHT_OFFSETS[i];
    if (!(from & 0x88) && b[from] === knightPiece)
      return 1;
  }

  // king

  const kingPiece = KING | byColour;

  for (let i = 0; i < 8; i++) {
    const from = sq + KING_OFFSETS[i];
    if (!(from & 0x88) && b[from] === kingPiece)
      return 1;
  }

  // diagonal rays (bishop, queen)

  for (let i = 0; i < 4; i++) {
    const dir = BISHOP_OFFSETS[i];
    for (let to = sq + dir; !(to & 0x88); to += dir) {
      const p = b[to];
      if (!p)
        continue;
      if ((p & BLACK) === byColour) {
        const type = p & 7;
        if (type === BISHOP || type === QUEEN)
          return 1;
      }
      break;
    }
  }

  // orthogonal rays (rook, queen)

  for (let i = 0; i < 4; i++) {
    const dir = ROOK_OFFSETS[i];
    for (let to = sq + dir; !(to & 0x88); to += dir) {
      const p = b[to];
      if (!p)
        continue;
      if ((p & BLACK) === byColour) {
        const type = p & 7;
        if (type === ROOK || type === QUEEN)
          return 1;
      }
      break;
    }
  }

  return 0;
}

const g_loHH = new Int32Array(1024);
const g_hiHH = new Int32Array(1024);
let g_hhNext = 0;
let g_hmClock = 0;

function isDraw() {

  // 50-move rule

  if (g_hmClock >= 100)
    return 1;

  // 2-fold repetition

  const lo = g_loHash;
  const hi = g_hiHash;
  const stop = g_hhNext - g_hmClock;
  for (let i = g_hhNext - 2; i >= 0 && i >= stop; i -= 2) {
    if (g_loHH[i] === lo && g_hiHH[i] === hi)
      return 1;
  }

  // insufficient material

  const b  = g_board;
  const pl = g_pieces;
  const nw = pl[0];
  const nb = pl[17];
  const total = nw + nb;

  // KvK
  if (total === 2)
    return 1;

  // KvK+minor
  if (total === 3) {
    const sq = nw === 2 ? pl[2] : pl[19];
    const pt = b[sq] & 7;
    if (pt === KNIGHT || pt === BISHOP)
      return 1;
  }

  if (total === 4) {
    // KNvKN, KBvKB (same colour bishops), KNNvK
    if (nw === 2 && nb === 2) {
      const wpt = b[pl[2]] & 7;
      const bpt = b[pl[19]] & 7;
      if (wpt === KNIGHT && bpt === KNIGHT)
        return 1;
      if (wpt === BISHOP && bpt === BISHOP) {
        const wsq = pl[2];
        const bsq = pl[19];
        if (((wsq ^ (wsq >> 4)) & 1) === ((bsq ^ (bsq >> 4)) & 1))
          return 1;
      }
    }
    // KNNvK
    if (nw === 1 || nb === 1) {
      const base = nw === 3 ? 0 : 17;
      const pt1 = b[pl[base + 2]] & 7;
      const pt2 = b[pl[base + 3]] & 7;
      if (pt1 === KNIGHT && pt2 === KNIGHT)
        return 1;
    }
  }

  return 0;

}

function drawTests() {

  let fails = 0;
  let count = 0;

  function check(id, got, expect) {
    count++;
    if (got !== expect) {
      fails++;
      uciSend(id + ' *** FAIL *** got ' + got + ' expected ' + expect);
    }
    else {
      uciSend(id + ' ok');
    }
  }

  const sp = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const kk = '4k3/8/8/8/8/8/8/4K3';

  // 2-fold repetition: Nf3 Nf6 Ng1 Ng8 returns to startpos
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
  check('rep-2fold', isDraw(), 1);

  // half the cycle is not a repetition
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6']);
  check('rep-none', isDraw(), 0);

  // pawn move breaks repetition chain
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6', 'e2e4', 'f6g8', 'f3g1']);
  check('rep-pawn-breaks', isDraw(), 0);

  // capture breaks repetition chain
  position(sp, 'w', 'KQkq', '-', ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'g1f3', 'd5d8', 'f3g1']);
  check('rep-cap-breaks', isDraw(), 0);

  // double repetition (3 occurrences of the position)
  position(sp, 'w', 'KQkq', '-',
    ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  check('rep-3fold', isDraw(), 1);

  // rook shuffle repetition in KRvKR
  position('4k3/8/8/8/8/8/8/R3K3', 'w', '-', '-',
    ['a1b1', 'e8d8', 'b1a1', 'd8e8']);
  check('rep-rook-shuffle', isDraw(), 1);

  // hmClock counts non-pawn non-capture moves
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
  check('hmclock-4', g_hmClock, 4);

  // hmClock resets on pawn move
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6', 'e2e4']);
  check('hmclock-pawn', g_hmClock, 0);

  // hmClock resets on capture
  position(sp, 'w', 'KQkq', '-', ['e2e4', 'd7d5', 'e4d5']);
  check('hmclock-cap', g_hmClock, 0);

  // hmClock increments after capture reset
  position(sp, 'w', 'KQkq', '-', ['e2e4', 'd7d5', 'e4d5', 'g8f6', 'g1f3']);
  check('hmclock-after-cap', g_hmClock, 2);

  // 50-move rule at exactly 100 half-moves
  const kr = '4k3/8/8/8/8/8/8/R3K2R';
  position(kr, 'w', '-', '-');
  g_hmClock = 100;
  check('50move-100', isDraw(), 1);

  // 50-move rule at 99 is not yet a draw
  position(kr, 'w', '-', '-');
  g_hmClock = 99;
  check('50move-99', isDraw(), 0);

  // position() resets hhNext and hmClock
  position(sp, 'w', 'KQkq', '-', ['g1f3', 'g8f6']);
  position(sp, 'w', 'KQkq', '-');
  check('reset-hhNext', g_hhNext, 0);
  check('reset-hmClock', g_hmClock, 0);

  // no draw at startpos
  position(sp, 'w', 'KQkq', '-');
  check('startpos-no-draw', isDraw(), 0);

  // material draws
  position(kk, 'w', '-', '-');
  check('mat-KvK', isDraw(), 1);

  position('4k3/8/8/8/8/8/8/4K1N1', 'w', '-', '-');
  check('mat-KNvK', isDraw(), 1);

  position('4k3/8/8/8/8/8/8/4K1B1', 'w', '-', '-');
  check('mat-KBvK', isDraw(), 1);

  position('4k3/8/8/8/8/8/8/4K1R1', 'w', '-', '-');
  check('mat-KRvK-no', isDraw(), 0);

  uciSend('');
  uciSend(count + ' draw tests, ' + fails + ' fails');

}

function make(node, move) {

  const b = g_board;
  const pl = g_pieces;
  const px = g_plix;
  const fr = (move >> 7) & 0x7F;
  const to = move & 0x7F;

  const stm = g_stm;
  const stmBase = (stm >>> 3) * 17;
  const oppBase = stmBase ^ 17;

  node.undoHmClock = g_hmClock;
  g_loHH[g_hhNext] = g_loHash;
  g_hiHH[g_hhNext] = g_hiHash;
  g_hhNext++;
  if ((b[fr] & 7) === PAWN || (move & MOVE_FLAG_CAPTURE))
    g_hmClock = 0;
  else
    g_hmClock++;

  node.undoRights = g_rights;
  node.undoEp = g_ep;
  node.undoLoHash = g_loHash;
  node.undoHiHash = g_hiHash;

  // hash: update rights

  g_loHash ^= g_loRights[g_rights];
  g_hiHash ^= g_hiRights[g_rights];
  g_rights &= RIGHTS_TABLE[fr] & RIGHTS_TABLE[to];
  g_loHash ^= g_loRights[g_rights];
  g_hiHash ^= g_hiRights[g_rights];

  // hash: remove old ep

  if (g_ep) {
    g_loHash ^= g_loEP[g_ep];
    g_hiHash ^= g_hiEP[g_ep];
  }
  g_ep = 0;

  // hash: toggle stm

  g_loHash ^= g_loStm;
  g_hiHash ^= g_hiStm;

  if (move & MOVE_FLAG_SPECIAL) {

    if (move & MOVE_FLAG_PROMOTE) {

      if (move & MOVE_FLAG_CAPTURE) {
        g_loHash ^= g_loPieces[b[to]][to];
        g_hiHash ^= g_hiPieces[b[to]][to];
        const capIdx = px[to];
        const lastIdx = pl[oppBase];
        const lastSq = pl[oppBase + lastIdx];
        pl[oppBase + capIdx] = lastSq;
        px[lastSq] = capIdx;
        pl[oppBase]--;
        node.undoCaptured = b[to];
        node.undoCapIdx = capIdx;
      }

      g_loHash ^= g_loPieces[b[fr]][fr];
      g_hiHash ^= g_hiPieces[b[fr]][fr];

      const idx = px[fr];
      pl[stmBase + idx] = to;
      px[to] = idx;

      const promPiece = (move >> PROMOTE_SHIFT) | stm;
      g_loHash ^= g_loPieces[promPiece][to];
      g_hiHash ^= g_hiPieces[promPiece][to];

      b[to] = promPiece;
      b[fr] = 0;
      g_stm = stm ^ BLACK;
      return;
    }

    if (move & MOVE_FLAG_EPCAPTURE) {

      const capSq = to - 16 + (stm << 2);

      g_loHash ^= g_loPieces[b[capSq]][capSq];
      g_hiHash ^= g_hiPieces[b[capSq]][capSq];

      const capIdx = px[capSq];
      const lastIdx = pl[oppBase];
      const lastSq = pl[oppBase + lastIdx];
      pl[oppBase + capIdx] = lastSq;
      px[lastSq] = capIdx;
      pl[oppBase]--;
      node.undoCapIdx = capIdx;

      g_loHash ^= g_loPieces[b[fr]][fr];
      g_hiHash ^= g_hiPieces[b[fr]][fr];
      g_loHash ^= g_loPieces[b[fr]][to];
      g_hiHash ^= g_hiPieces[b[fr]][to];

      const idx = px[fr];
      pl[stmBase + idx] = to;
      px[to] = idx;

      b[to] = b[fr];
      b[fr] = 0;
      b[capSq] = 0;
      g_stm = stm ^ BLACK;
      return;
    }

    // castle

    g_loHash ^= g_loPieces[b[fr]][fr];
    g_hiHash ^= g_hiPieces[b[fr]][fr];
    g_loHash ^= g_loPieces[b[fr]][to];
    g_hiHash ^= g_hiPieces[b[fr]][to];

    pl[stmBase + 1] = to;
    px[to] = 1;

    b[to] = b[fr];
    b[fr] = 0;

    let rookFr, rookTo;

    if (to & 4) {
      rookFr = to + 1; rookTo = to - 1;
    }
    else {
      rookFr = to - 2; rookTo = to + 1;
    }

    const rookPiece = ROOK | stm;
    g_loHash ^= g_loPieces[rookPiece][rookFr];
    g_hiHash ^= g_hiPieces[rookPiece][rookFr];
    g_loHash ^= g_loPieces[rookPiece][rookTo];
    g_hiHash ^= g_hiPieces[rookPiece][rookTo];

    const rookIdx = px[rookFr];
    pl[stmBase + rookIdx] = rookTo;
    px[rookTo] = rookIdx;

    b[rookTo] = b[rookFr];
    b[rookFr] = 0;

    g_stm = stm ^ BLACK;
    return;
  }

  // quiet move or normal capture

  if ((b[fr] & 7) === PAWN && (to - fr === 32 || to - fr === -32)) {
    g_ep = (fr + to) >> 1;
    g_loHash ^= g_loEP[g_ep];
    g_hiHash ^= g_hiEP[g_ep];
  }

  if (move & MOVE_FLAG_CAPTURE) {
    g_loHash ^= g_loPieces[b[to]][to];
    g_hiHash ^= g_hiPieces[b[to]][to];
    const capIdx = px[to];
    const lastIdx = pl[oppBase];
    const lastSq = pl[oppBase + lastIdx];
    pl[oppBase + capIdx] = lastSq;
    px[lastSq] = capIdx;
    pl[oppBase]--;
    node.undoCaptured = b[to];
    node.undoCapIdx = capIdx;
  }

  g_loHash ^= g_loPieces[b[fr]][fr];
  g_hiHash ^= g_hiPieces[b[fr]][fr];
  g_loHash ^= g_loPieces[b[fr]][to];
  g_hiHash ^= g_hiPieces[b[fr]][to];

  const idx = px[fr];
  pl[stmBase + idx] = to;
  px[to] = idx;

  b[to] = b[fr];
  b[fr] = 0;

  g_stm = stm ^ BLACK;

  //checkHash();

}

function unmake (node, move) {

  const b = g_board;
  const pl = g_pieces;
  const px = g_plix;
  const fr = (move >> 7) & 0x7F;
  const to = move & 0x7F;

  // stm was flipped by make, so current stm is the opponent of the mover
  // the mover's colour is stm ^ BLACK
  const stm = g_stm ^ BLACK;
  const stmBase = (stm >>> 3) * 17;
  const oppBase = stmBase ^ 17;

  if (move & MOVE_FLAG_SPECIAL) {

    if (move & MOVE_FLAG_PROMOTE) {

      // move piece back as a pawn
      b[fr] = PAWN | stm;
      px[fr] = px[to];
      const idx = px[fr];
      pl[stmBase + idx] = fr;

      if (move & MOVE_FLAG_CAPTURE) {
        // un-swap-delete
        const capIdx = node.undoCapIdx;
        pl[oppBase]++;
        const lastSq = pl[oppBase + capIdx];
        pl[oppBase + pl[oppBase]] = lastSq;
        px[lastSq] = pl[oppBase];
        pl[oppBase + capIdx] = to;
        px[to] = capIdx;
        b[to] = node.undoCaptured;
      }
      else {
        b[to] = 0;
      }

      g_rights = node.undoRights;
      g_ep = node.undoEp;
      g_loHash = node.undoLoHash;
      g_hiHash = node.undoHiHash;
      g_stm = stm;
      g_hmClock = node.undoHmClock;
      g_hhNext--;
      return;
    }

    if (move & MOVE_FLAG_EPCAPTURE) {

      const capSq = to - 16 + (stm << 2);

      // move pawn back
      const idx = px[to];
      pl[stmBase + idx] = fr;
      px[fr] = idx;
      b[fr] = b[to];
      b[to] = 0;

      // restore captured pawn
      const capIdx = node.undoCapIdx;
      pl[oppBase]++;
      const lastSq = pl[oppBase + capIdx];
      pl[oppBase + pl[oppBase]] = lastSq;
      px[lastSq] = pl[oppBase];
      pl[oppBase + capIdx] = capSq;
      px[capSq] = capIdx;
      b[capSq] = PAWN | (stm ^ BLACK);

      g_rights = node.undoRights;
      g_ep = node.undoEp;
      g_loHash = node.undoLoHash;
      g_hiHash = node.undoHiHash;
      g_stm = stm;
      g_hmClock = node.undoHmClock;
      g_hhNext--;
      return;
    }

    // castle - move king back, move rook back

    pl[stmBase + 1] = fr;
    px[fr] = 1;
    b[fr] = b[to];
    b[to] = 0;

    let rookFr, rookTo;

    if (to & 4) {
      rookFr = to + 1; rookTo = to - 1;
    }
    else {
      rookFr = to - 2; rookTo = to + 1;
    }

    const rookIdx = px[rookTo];
    pl[stmBase + rookIdx] = rookFr;
    px[rookFr] = rookIdx;
    b[rookFr] = b[rookTo];
    b[rookTo] = 0;

    g_rights = node.undoRights;
    g_ep = node.undoEp;
    g_loHash = node.undoLoHash;
    g_hiHash = node.undoHiHash;
    g_stm = stm;
    g_hmClock = node.undoHmClock;
    g_hhNext--;
    return;
  }

  // quiet move or normal capture

  // move piece back
  const idx = px[to];
  pl[stmBase + idx] = fr;
  px[fr] = idx;
  b[fr] = b[to];

  if (move & MOVE_FLAG_CAPTURE) {
    // un-swap-delete
    const capIdx = node.undoCapIdx;
    pl[oppBase]++;
    const lastSq = pl[oppBase + capIdx];
    pl[oppBase + pl[oppBase]] = lastSq;
    px[lastSq] = pl[oppBase];
    pl[oppBase + capIdx] = to;
    px[to] = capIdx;
    b[to] = node.undoCaptured;
  }
  else {
    b[to] = 0;
  }

  g_rights = node.undoRights;
  g_ep = node.undoEp;
  g_loHash = node.undoLoHash;
  g_hiHash = node.undoHiHash;
  g_stm = stm;
  g_hmClock = node.undoHmClock;
  g_hhNext--;

  //checkHash();

}

function checkHash() {

  const b = g_board;

  let lo = 0;
  let hi = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = b[sq];
    if (piece) {
      lo ^= g_loPieces[piece][sq];
      hi ^= g_hiPieces[piece][sq];
    }
  }

  lo ^= g_loRights[g_rights];
  hi ^= g_hiRights[g_rights];

  if (g_ep) {
    lo ^= g_loEP[g_ep];
    hi ^= g_hiEP[g_ep];
  }

  if (g_stm === BLACK) {
    lo ^= g_loStm;
    hi ^= g_hiStm;
  }

  if (lo !== g_loHash || hi !== g_hiHash) {
    uciSend('info string HASH MISMATCH lo ' + g_loHash + ' expected ' + lo + ' hi ' + g_hiHash + ' expected ' + hi);
  }

}

// noisy - captures (inc. EP) and promotions
// quiet - non-captures excluding promotions
// quiet and noisy are mutually exclusive throughout

function genNoisy(node) { 

  const b = g_board;
  const moves = node.moves;
  const stm = g_stm;
  const curEp = g_ep;

  let numMoves = node.numMoves;

  const enemy = stm ^ BLACK;

  const pawnDir = stm === WHITE ? 16 : -16;
  const promoteR = stm === WHITE ? 0x70 : 0x00;

  const pl = g_pieces;
  const base = (stm >>> 3) * 17;
  const count = pl[base];

  for (let i = 1; i <= count; i++) {

    const sq = pl[base + i];
    const piece = b[sq];
    const from = sq << 7;

    switch (piece & 7) {

      case PAWN: {

        const to1 = sq + pawnDir;

        // push promotions

        if (!b[to1] && (to1 & 0x70) === promoteR) {
          moves[numMoves++] = from | to1 | MOVE_FLAG_PROMOTE | (QUEEN  << PROMOTE_SHIFT);
          moves[numMoves++] = from | to1 | MOVE_FLAG_PROMOTE | (ROOK   << PROMOTE_SHIFT);
          moves[numMoves++] = from | to1 | MOVE_FLAG_PROMOTE | (BISHOP << PROMOTE_SHIFT);
          moves[numMoves++] = from | to1 | MOVE_FLAG_PROMOTE | (KNIGHT << PROMOTE_SHIFT);
        }

        // captures

        for (let i = -1; i <= 1; i += 2) {

          const to = to1 + i;

          if (to & 0x88)
            continue;

          if (b[to] && (b[to] & BLACK) === enemy) {

            if ((to & 0x70) === promoteR) {
              moves[numMoves++] = from | to | MOVE_FLAG_PROMOTE | MOVE_FLAG_CAPTURE | (QUEEN  << PROMOTE_SHIFT);
              moves[numMoves++] = from | to | MOVE_FLAG_PROMOTE | MOVE_FLAG_CAPTURE | (ROOK   << PROMOTE_SHIFT);
              moves[numMoves++] = from | to | MOVE_FLAG_PROMOTE | MOVE_FLAG_CAPTURE | (BISHOP << PROMOTE_SHIFT);
              moves[numMoves++] = from | to | MOVE_FLAG_PROMOTE | MOVE_FLAG_CAPTURE | (KNIGHT << PROMOTE_SHIFT);
            }
            else {
              moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;
            }
          }
          else if (curEp && to === curEp) {
            moves[numMoves++] = from | to | MOVE_FLAG_EPCAPTURE | MOVE_FLAG_CAPTURE;
          }
        }

        break;
      }

      case KNIGHT: {

        for (let i = 0; i < 8; i++) {

          const to = sq + KNIGHT_OFFSETS[i];

          if (to & 0x88)
            continue;

          if (b[to] && (b[to] & BLACK) === enemy)
            moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;
        }

        break;
      }

      case BISHOP: {

        for (let i = 0; i < 4; i++) {

          const dir = BISHOP_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to])
              continue;

            if ((b[to] & BLACK) === enemy)
              moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;

            break;
          }
        }

        break;
      }

      case ROOK: {

        for (let i = 0; i < 4; i++) {

          const dir = ROOK_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to])
              continue;

            if ((b[to] & BLACK) === enemy)
              moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;

            break;
          }
        }

        break;
      }

      case QUEEN: {

        for (let i = 0; i < 8; i++) {

          const dir = QUEEN_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to])
              continue;

            if ((b[to] & BLACK) === enemy)
              moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;

            break;
          }
        }

        break;
      }

      case KING: {

        for (let i = 0; i < 8; i++) {

          const to = sq + KING_OFFSETS[i];

          if (to & 0x88)
            continue;

          if (b[to] && (b[to] & BLACK) === enemy)
            moves[numMoves++] = from | to | MOVE_FLAG_CAPTURE;
        }

        break;
      }
    }
  }

  node.numMoves = numMoves;

}

function genQuiets(node) {

  const b = g_board;
  const moves = node.moves;
  const stm = g_stm;

  let numMoves = node.numMoves;

  const pawnDir = stm === WHITE ? 16 : -16;
  const pawnStartR = stm === WHITE ? 0x10 : 0x60;
  const promoteR = stm === WHITE ? 0x70 : 0x00;

  const pl = g_pieces;
  const base = (stm >>> 3) * 17;
  const count = pl[base];

  for (let i = 1; i <= count; i++) {

    const sq = pl[base + i];
    const piece = b[sq];
    const from = sq << 7;

    switch (piece & 7) {

      case PAWN: {

        const to1 = sq + pawnDir;

        // single push (non-promote)

        if (!b[to1] && (to1 & 0x70) !== promoteR) {

          moves[numMoves++] = from | to1;

          // double push

          const to2 = sq + pawnDir * 2;

          if ((sq & 0x70) === pawnStartR && !b[to2])
            moves[numMoves++] = from | to2;
        }

        break;
      }

      case KNIGHT: {

        for (let i = 0; i < 8; i++) {

          const to = sq + KNIGHT_OFFSETS[i];

          if (to & 0x88)
            continue;

          if (!b[to])
            moves[numMoves++] = from | to;
        }

        break;
      }

      case BISHOP: {

        for (let i = 0; i < 4; i++) {

          const dir = BISHOP_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to]) {
              moves[numMoves++] = from | to;
              continue;
            }

            break;
          }
        }

        break;
      }

      case ROOK: {

        for (let i = 0; i < 4; i++) {

          const dir = ROOK_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to]) {
              moves[numMoves++] = from | to;
              continue;
            }

            break;
          }
        }

        break;
      }

      case QUEEN: {

        for (let i = 0; i < 8; i++) {

          const dir = QUEEN_OFFSETS[i];

          for (let to = sq + dir; !(to & 0x88); to += dir) {

            if (!b[to]) {
              moves[numMoves++] = from | to;
              continue;
            }

            break;
          }
        }

        break;
      }

      case KING: {

        for (let i = 0; i < 8; i++) {

          const to = sq + KING_OFFSETS[i];

          if (to & 0x88)
            continue;

          if (!b[to])
            moves[numMoves++] = from | to;
        }

        break;
      }
    }
  }

  node.numMoves = numMoves;

}

function genCastling(node) {

  const b = g_board;
  const moves = node.moves;
  const enemy = g_stm ^ BLACK;

  const base = (g_stm >>> 3) * 17;
  const sq = g_pieces[base + 1];
  const from = sq << 7;

  let numMoves = node.numMoves;

  if (g_stm === WHITE) {
    if ((g_rights & WHITE_RIGHTS_KING) && !b[0x05] && !b[0x06]
        && !isAttacked(0x05, enemy) && !isAttacked(0x06, enemy))
      moves[numMoves++] = from | 0x06 | MOVE_FLAG_CASTLE;
    if ((g_rights & WHITE_RIGHTS_QUEEN) && !b[0x03] && !b[0x02] && !b[0x01]
        && !isAttacked(0x03, enemy) && !isAttacked(0x02, enemy))
      moves[numMoves++] = from | 0x02 | MOVE_FLAG_CASTLE;
  }
  else {
    if ((g_rights & BLACK_RIGHTS_KING) && !b[0x75] && !b[0x76]
        && !isAttacked(0x75, enemy) && !isAttacked(0x76, enemy))
      moves[numMoves++] = from | 0x76 | MOVE_FLAG_CASTLE;
    if ((g_rights & BLACK_RIGHTS_QUEEN) && !b[0x73] && !b[0x72] && !b[0x71]
        && !isAttacked(0x73, enemy) && !isAttacked(0x72, enemy))
      moves[numMoves++] = from | 0x72 | MOVE_FLAG_CASTLE;
  }

  node.numMoves = numMoves;

}

const g_qpth = Array(15); // quiet piece to history

function updateQpth(move, bonus) {

  const to = move & 0x7F;
  const fr = (move >> 7) & 0x7F;
  const piece = g_board[fr];

  g_qpth[piece][to] += bonus;

}

function initQpth () {

    for (let i=0; i < 15; i++) {
      g_qpth[i] = new Int32Array(128)
    }

}

function clearQpth () {

    for (let i=0; i < 15; i++) {
      g_qpth[i].fill(0);
    }

}

function removeTTMove(node) {

  const ttMove = node.ttMove;
  const moves = node.moves;
  const n = node.numMoves;

  for (let i = 0; i < n; i++) {
    if (moves[i] == ttMove) {
      moves[i] = moves[n - 1];
      node.numMoves--;
      return;
    }
  }

  console.log('MISSING TT MOVE');
}

function getNextSortedMove(node) {

  const moves = node.moves;
  const ranks = node.ranks;
  const next = node.nextMove;
  const num = node.numMoves;
  let maxR = INT32_MIN;
  let maxI = 0;
  let maxM = 0;

  for (let i=next; i < num; i++) {
    if (ranks[i] > maxR) {
      maxR = ranks[i];
      maxI = i;
    }
  }

  maxM = moves[maxI];

  moves[maxI] = moves[next];
  ranks[maxI] = ranks[next];

  node.nextMove++;

  return maxM;

}

function rankQuiets(node) {

  const b = g_board;
  const moves = node.moves;
  const ranks = node.ranks;
  const n = node.numMoves;

  for (let i=0; i < n; i++) {

    const m = moves[i];
    const fr = (m >> 7) & 0x7F;
    const to = m & 0x7F;
    const piece = b[fr];

    ranks[i] = g_qpth[piece][to];

    if (m & MOVE_FLAG_NOISY)
      console.log('NOISY MOVE IN QUIET LIST');
  }
}

function rankNoisy(node) {

  const b = g_board;
  const moves = node.moves;
  const ranks = node.ranks;
  const n = node.numMoves;

  for (let i = 0; i < n; i++) {

    const m = moves[i];
    const fr = (m >> 7) & 0x7F;
    const to = m & 0x7F;

    if (!(m & MOVE_FLAG_NOISY))
      console.log('QUIET MOVE IN NOISY LIST');
  
    let rank = 0;

    if (m & MOVE_FLAG_PROMOTE) {
      rank = 1000000 + ((m >> PROMOTE_SHIFT) & 7) * 100000;
      if (m & MOVE_FLAG_CAPTURE)
        rank += (b[to] & 7) * 100 - (b[fr] & 7);
    }
    else if (m & MOVE_FLAG_EPCAPTURE) {
      rank = PAWN * 100 - PAWN;
    }
    else {
      rank = (b[to] & 7) * 100 - (b[fr] & 7);
    }

    ranks[i] = rank;
  }
}

function initSearch(node, inCheck, ttMove, noisyOnly) {

  node.stage = 0;
  node.inCheck = inCheck;
  node.ttMove = ttMove;
  node.noisyOnly = noisyOnly;

}

function getNextMove(node) {

  switch (node.stage) {

    case 0: {

      node.stage++;

      if (node.ttMove) {
        return node.ttMove;
      }

    }

    case 1: {

      node.stage++;
      node.nextMove = 0;
      node.numMoves = 0;
      genNoisy(node);
      if (node.ttMove && (node.ttMove & MOVE_FLAG_NOISY))
        removeTTMove(node);
      rankNoisy(node);

    }

    case 2: {

      if (node.nextMove < node.numMoves) {
        return getNextSortedMove(node);
      }

      if (node.noisyOnly)
        return 0;

      node.stage++;

    }

    case 3: {

      node.stage++;
      node.nextMove = 0;
      node.numMoves = 0;
      genQuiets(node);
      if (g_rights && !node.inCheck)
        genCastling(node);
      if (node.ttMove && !(node.ttMove & MOVE_FLAG_NOISY))
        removeTTMove(node);
      rankQuiets(node);

    }

    case 4: {

      if (node.nextMove < node.numMoves) {
        return getNextSortedMove(node);
      }

      return 0;

    }

    default:
      return 0;

  }
}

function perft(ply, depth) {

  if (depth === 0)
    return 1;

  const node = g_ss[ply];
  const stm = g_stm;
  const nstm = stm ^ BLACK;
  const kix = (stm >>> 3) * 17 + 1; // our king square index in piece list
  const inCheck = isAttacked(g_pieces[kix], nstm); // to exercise the move iterator
  
  let move = 0;
  let total = 0;

  initSearch(node, inCheck, 0, 0);

  while ((move = getNextMove(node))) {

    make(node, move);
    if (!isAttacked(g_pieces[kix], nstm))
      total += perft(ply + 1, depth - 1);
    unmake(node, move);
  }

  return total;
}

function perftTests(maxDepth) {

  let totalNodes = 0;
  let fails = 0;
  let count = 0;
  const t1 = Date.now();

  for (let i = 0; i < PERFTFENS.length; i++) {

    const entry = PERFTFENS[i];
    const depth = entry[1];

    if (maxDepth && depth > maxDepth)
      continue;

    const fen = entry[0].replace(/\s+/g, ' ').split(' ');
    const expect = entry[2];
    const id  = entry[3].trim();

    position(fen[1], fen[2], fen[3], fen[4]);

    const n = perft(0, depth);
    totalNodes += n;
    count++;

    const ok = n === expect;
    if (!ok)
      fails++;

    uciSend(id + ' depth ' + depth + ' ' + (ok ? 'ok' : '*** FAIL *** got ' + n + ' expected ' + expect));
  }

  const t2 = Date.now();
  const ms = t2 - t1;
  const nps = ms ? Math.floor(totalNodes / ms * 1000) : 0;

  uciSend('');
  uciSend(count + ' tests, ' + fails + ' fails, ' + totalNodes + ' nodes in ' + ms + ' ms ' + nps + ' nps');

}

function checkTime() {

    if (g_finishTime && now() >= g_finishTime)
      g_finished = 1;
    
    if (g_maxNodes && g_nodes >= g_maxNodes)
      g_finished = 1;
      
}

function initTimeControl(tokens) {

  // defaults

  g_nodes = 0;
  g_maxNodes = 0;
  g_maxDepth = MAX_PLY;
  g_startTime = now();
  g_finishTime = 0;
  g_finished = 0;

  // parse go params into a map

  const params = {};

  for (let i = 1; i < tokens.length; i++) {
    const key = tokens[i];
    if (key === 'infinite') {
      params.infinite = true;
    }
    else if (key === 'ponder') {
      params.ponder = true;
    }
    else if (i + 1 < tokens.length) {
      params[key] = parseInt(tokens[i + 1]);
      i++;
    }
  }

  // fixed depth

  if (params.depth) {
    g_maxDepth = params.depth;
    return;
  }
  if (params.d) {
    g_maxDepth = params.d;
    return;
  }

  // fixed nodes

  if (params.nodes) {
    g_maxNodes = params.nodes;
    return;
  }

  // fixed move time

  if (params.movetime) {
    g_finishTime = g_startTime + params.movetime;
    return;
  }

  // infinite or ponder - no limits

  if (params.infinite || params.ponder) {
    return;
  }

  // time + inc based

  const wtime = params.wtime || 0;
  const btime = params.btime || 0;
  const winc = params.winc || 0;
  const binc = params.binc || 0;
  const movestogo = Math.max(params.movestogo || 20, 2);

  const myTime = g_stm === WHITE ? wtime : btime;
  const myInc = g_stm === WHITE ? winc : binc;

  const alloc = myTime / movestogo + myInc;

  // don't use more than half the remaining time

  const limit = myTime / 2;

  const ms = Math.max(Math.min(alloc, limit), 1);

  g_finishTime = g_startTime + ms;

}

// PeSTO piece-square tables adapted for 0x88 board
// https://www.chessprogramming.org/PeSTO%27s_Evaluation_Function

const g_mgPST = new Int16Array(15 * 128);
const g_egPST = new Int16Array(15 * 128);

const PHASE_INC = new Uint8Array(7);
PHASE_INC[KNIGHT] = 1;
PHASE_INC[BISHOP] = 1;
PHASE_INC[ROOK]   = 2;
PHASE_INC[QUEEN]  = 4;

function initPST() {

  // material values indexed by piece type (PAWN=1 .. KING=6)
  const mgVal = [0, 82, 337, 365, 477, 1025, 0];
  const egVal = [0, 94, 281, 297, 512,  936, 0];

  // raw 8x8 PSTs from PeSTO/Rofchade, row 0 = rank 8, row 7 = rank 1
  const mgRaw = [
    null,
    // pawn
    [ 0,   0,   0,   0,   0,   0,  0,   0,
     98, 134,  61,  95,  68, 126, 34, -11,
     -6,   7,  26,  31,  65,  56, 25, -20,
    -14,  13,   6,  21,  23,  12, 17, -23,
    -27,  -2,  -5,  12,  17,   6, 10, -25,
    -26,  -4,  -4, -10,   3,   3, 33, -12,
    -35,  -1, -20, -23, -15,  24, 38, -22,
      0,   0,   0,   0,   0,   0,  0,   0],
    // knight
    [-167, -89, -34, -49,  61, -97, -15, -107,
      -73, -41,  72,  36,  23,  62,   7,  -17,
      -47,  60,  37,  65,  84, 129,  73,   44,
       -9,  17,  19,  53,  37,  69,  18,   22,
      -13,   4,  16,  13,  28,  19,  21,   -8,
      -23,  -9,  12,  10,  19,  17,  25,  -16,
      -29, -53, -12,  -3,  -1,  18, -14,  -19,
     -105, -21, -58, -33, -17, -28, -19,  -23],
    // bishop
    [-29,   4, -82, -37, -25, -42,   7,  -8,
     -26,  16, -18, -13,  30,  59,  18, -47,
     -16,  37,  43,  40,  35,  50,  37,  -2,
      -4,   5,  19,  50,  37,  37,   7,  -2,
      -6,  13,  13,  26,  34,  12,  10,   4,
       0,  15,  15,  15,  14,  27,  18,  10,
       4,  15,  16,   0,   7,  21,  33,   1,
     -33,  -3, -14, -21, -13, -12, -39, -21],
    // rook
    [ 32,  42,  32,  51, 63,  9,  31,  43,
      27,  32,  58,  62, 80, 67,  26,  44,
      -5,  19,  26,  36, 17, 45,  61,  16,
     -24, -11,   7,  26, 24, 35,  -8, -20,
     -36, -26, -12,  -1,  9, -7,   6, -23,
     -45, -25, -16, -17,  3,  0,  -5, -33,
     -44, -16, -20,  -9, -1, 11,  -6, -71,
     -19, -13,   1,  17, 16,  7, -37, -26],
    // queen
    [-28,   0,  29,  12,  59,  44,  43,  45,
     -24, -39,  -5,   1, -16,  57,  28,  54,
     -13, -17,   7,   8,  29,  56,  47,  57,
     -27, -27, -16, -16,  -1,  17,  -2,   1,
      -9, -26,  -9, -10,  -2,  -4,   3,  -3,
     -14,   2, -11,  -2,  -5,   2,  14,   5,
     -35,  -8,  11,   2,   8,  15,  -3,   1,
      -1, -18,  -9,  10, -15, -25, -31, -50],
    // king
    [-65,  23,  16, -15, -56, -34,   2,  13,
      29,  -1, -20,  -7,  -8,  -4, -38, -29,
      -9,  24,   2, -16, -20,   6,  22, -22,
     -17, -20, -12, -27, -30, -25, -14, -36,
     -49,  -1, -27, -39, -46, -44, -33, -51,
     -14, -14, -22, -46, -44, -30, -15, -27,
       1,   7,  -8, -64, -43, -16,   9,   8,
     -15,  36,  12, -54,   8, -28,  24,  14]
  ];

  const egRaw = [
    null,
    // pawn
    [  0,   0,   0,   0,   0,   0,   0,   0,
     178, 173, 158, 134, 147, 132, 165, 187,
      94, 100,  85,  67,  56,  53,  82,  84,
      32,  24,  13,   5,  -2,   4,  17,  17,
      13,   9,  -3,  -7,  -7,  -8,   3,  -1,
       4,   7,  -6,   1,   0,  -5,  -1,  -8,
      13,   8,   8,  10,  13,   0,   2,  -7,
       0,   0,   0,   0,   0,   0,   0,   0],
    // knight
    [-58, -38, -13, -28, -31, -27, -63, -99,
     -25,  -8, -25,  -2,  -9, -25, -24, -52,
     -24, -20,  10,   9,  -1,  -9, -19, -41,
     -17,   3,  22,  22,  22,  11,   8, -18,
     -18,  -6,  16,  25,  16,  17,   4, -18,
     -23,  -3,  -1,  15,  10,  -3, -20, -22,
     -42, -20, -10,  -5,  -2, -20, -23, -44,
     -29, -51, -23, -15, -22, -18, -50, -64],
    // bishop
    [-14, -21, -11,  -8, -7,  -9, -17, -24,
      -8,  -4,   7, -12, -3, -13,  -4, -14,
       2,  -8,   0,  -1, -2,   6,   0,   4,
      -3,   9,  12,   9, 14,  10,   3,   2,
      -6,   3,  13,  19,  7,  10,  -3,  -9,
     -12,  -3,   8,  10, 13,   3,  -7, -15,
     -14, -18,  -7,  -1,  4,  -9, -15, -27,
     -23,  -9, -23,  -5, -9, -16,  -5, -17],
    // rook
    [13, 10, 18, 15, 12,  12,   8,   5,
     11, 13, 13, 11, -3,   3,   8,   3,
      7,  7,  7,  5,  4,  -3,  -5,  -3,
      4,  3, 13,  1,  2,   1,  -1,   2,
      3,  5,  8,  4, -5,  -6,  -8, -11,
     -4,  0, -5, -1, -7, -12,  -8, -16,
     -6, -6,  0,  2, -9,  -9, -11,  -3,
     -9,  2,  3, -1, -5, -13,   4, -20],
    // queen
    [ -9,  22,  22,  27,  27,  19,  10,  20,
     -17,  20,  32,  41,  58,  25,  30,   0,
     -20,   6,   9,  49,  47,  35,  19,   9,
       3,  22,  24,  45,  57,  40,  57,  36,
     -18,  28,  19,  47,  31,  34,  39,  23,
     -16, -27,  15,   6,   9,  17,  10,   5,
     -22, -23, -30, -16, -16, -23, -36, -32,
     -33, -28, -22, -43,  -5, -32, -20, -41],
    // king
    [-74, -35, -18, -18, -11,  15,   4, -17,
     -12,  17,  14,  17,  17,  38,  23,  11,
      10,  17,  23,  15,  20,  45,  44,  13,
      -8,  22,  24,  27,  26,  33,  26,   3,
     -18,  -4,  21,  24,  27,  23,   9, -11,
     -19,  -3,  11,  21,  23,  16,   7,  -9,
     -27, -11,   4,  13,  14,   4,  -5, -17,
     -53, -34, -21, -11, -28, -14, -24, -43]
  ];

  for (let pieceType = PAWN; pieceType <= KING; pieceType++) {
    const wPiece = pieceType | WHITE;
    const bPiece = pieceType | BLACK;
    const wBase = wPiece * 128;
    const bBase = bPiece * 128;
    const mgV = mgVal[pieceType];
    const egV = egVal[pieceType];
    const mgT = mgRaw[pieceType];
    const egT = egRaw[pieceType];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq88 = rank * 16 + file;
        const wIdx = (7 - rank) * 8 + file;
        const bIdx = rank * 8 + file;
        g_mgPST[wBase + sq88] = mgV + mgT[wIdx];
        g_egPST[wBase + sq88] = egV + egT[wIdx];
        g_mgPST[bBase + sq88] = mgV + mgT[bIdx];
        g_egPST[bBase + sq88] = egV + egT[bIdx];
      }
    }
  }
}

function evaluate() {

  const b  = g_board;
  const pl = g_pieces;

  let mgW = 0, mgB = 0, egW = 0, egB = 0;
  let phase = 0;

  // white pieces (base = 0)
  const wCount = pl[0];
  for (let i = 1; i <= wCount; i++) {
    const sq = pl[i];
    const piece = b[sq];
    const idx = piece * 128 + sq;
    mgW += g_mgPST[idx];
    egW += g_egPST[idx];
    phase += PHASE_INC[piece & 7];
  }

  // black pieces (base = 17)
  const bCount = pl[17];
  for (let i = 1; i <= bCount; i++) {
    const sq = pl[17 + i];
    const piece = b[sq];
    const idx = piece * 128 + sq;
    mgB += g_mgPST[idx];
    egB += g_egPST[idx];
    phase += PHASE_INC[piece & 7];
  }

  // tapered eval
  const mgScore = g_stm === WHITE ? mgW - mgB : mgB - mgW;
  const egScore = g_stm === WHITE ? egW - egB : egB - egW;
  let mgPhase = phase;
  if (mgPhase > 24) mgPhase = 24;
  const egPhase = 24 - mgPhase;

  return (mgScore * mgPhase + egScore * egPhase) / 24 | 0;
}

function collectPV(node, cNode, move) {

  if (cNode) {
    node.pv.set(cNode.pv.subarray(0, cNode.pvLen), 0);
    node.pvLen = cNode.pvLen;
    node.pv[node.pvLen++] = move;
  }
  else {
    node.pv[0] = move;
    node.pvLen = 1;
  }

}

function report (value, depth) {

  let pvStr = 'pv';
  for (let i=rootNode.pvLen-1; i >= 0; i--)
    pvStr += ' ' + formatMove(rootNode.pv[i]);

  const elapsed = now() - g_startTime;
  const nps = (g_nodes * 1000) / elapsed | 0;
  const nodeStr = 'nodes ' + g_nodes + ' time ' + elapsed + ' nps ' + nps + ' ';
  const depthStr = 'depth ' + depth + ' ';
  const scoreStr = 'score cp ' + value + ' ';

  uciSend('info ' + depthStr + scoreStr + nodeStr + pvStr);

}

const g_lmr = Array(MAX_PLY);

function initLMR() {
  for (let d = 0; d < MAX_PLY; d++) {
    g_lmr[d] = Array(MAX_MOVES);
    for (let m = 0; m < MAX_MOVES; m++) {
      g_lmr[d][m] = Math.floor(0.75 + Math.log(d) * Math.log(m) / 2.25);
     }
  }
}

function search(ply, depth, alpha, beta) {

  if (depth <= 0)
    return qsearch(ply, 0, alpha, beta);

  g_nodes++;
  if ((g_nodes & 1023) == 0) {
    checkTime();
    if (g_finished)
      return 0;
  }

  if (ply >= MAX_PLY)
    return evaluate();

  const node = g_ss[ply]; 
  const cNode = ply <= MAX_PLY - 2 ? g_ss[ply + 1] : 0;
  
  node.pvLen = 0;
  
  // mate distance pruning
  const matingScore = MATE - ply;
  if (matingScore < beta) {
    beta = matingScore;
    if (alpha >= matingScore)
      return matingScore;
  }
  const matedScore = -MATE + ply;
  if (matedScore > alpha) {
    alpha = matedScore;
    if (beta <= matedScore)
      return matedScore;
  }

  const isRoot = ply === 0;

  if (!isRoot && isDraw()) {
    return 0;
  }

  const isPV = beta !== (alpha + 1);
  const ttix = ttGet();
  
  if (!isPV && ttix >= 0 && g_ttDepth[ttix] >= depth) {
    const type = g_ttType[ttix] & TT_TYPE_MASK;
    const score = getAdjustedScore(ply, g_ttScore[ttix]);
    if (type === TT_EXACT || (type === TT_BETA && score >= beta) || (type === TT_ALPHA && score <= alpha)) {
      return score;
    }
  }

  const stm = g_stm;
  const nstm = stm ^ BLACK;
  const kix = (stm >>> 3) * 17 + 1;
  const origAlpha = alpha;
  const inCheck = ttix >= 0 ? (g_ttType[ttix] & TT_INCHECK) !== 0 : isAttacked(g_pieces[kix], nstm);
  const ev = ttix >= 0 ? g_ttEval[ttix] : evaluate();
  const ttMove = ttix >= 0 && isProbablyLegal(g_ttMove[ttix]) ? g_ttMove[ttix] : 0;
  const playedMoves = node.playedMoves;

  // https://www.talkchess.com/forum3/viewtopic.php?f=7&t=74769
  if (depth > 5 && isPV && !ttMove)
    depth--;

  let move = 0;
  let played = 0;
  let bestMove = 0;
  let bestScore = -INF;
  let score = 0;
  
  // beta pruning
  if (!isPV && !inCheck && beta < MATEISH && depth <= 8 && (ev - depth * 100) >= beta)
    return ev;

  initSearch(node, inCheck, ttMove, 0);

  while ((move = getNextMove(node))) {

    const noisy = move & MOVE_FLAG_NOISY;

    // late move pruning
    if (depth > 1 && !inCheck && !noisy && alpha > -MATEISH && played > depth * depth * depth)
      continue;

    // futility pruning
    if (played && !inCheck && depth <= 1 && !noisy && alpha > -MATEISH && ev + 100 < alpha)
      continue;

    make(node, move);
    if (isAttacked(g_pieces[kix], nstm)) {
      unmake(node, move);
      continue;
    }

    playedMoves[played++] = move;

    // late move reductions 
    let R = 0;
    if (depth >= 3 && played > 3) {
      R = g_lmr[depth][played];
      R -= inCheck;
      if (isPV)
        R -= 1;
      if (R > depth - 2)
        R = depth - 2;
    }

    if (isPV) {
      if (played === 1) {
        score = -search(ply + 1, depth - 1, -beta, -alpha);
      }
      else {
        score = -search(ply + 1, depth - 1 - R, -alpha - 1, -alpha);
        if (!g_finished && score > alpha)
          score = -search(ply + 1, depth - 1, -beta, -alpha);
      }  
    }
    else {
      score = -search(ply + 1, depth - 1 - R, -beta, -alpha);
      if (!g_finished && score > alpha)
        score = -search(ply + 1, depth - 1, -beta, -alpha);
    }

    if (g_finished)
      return 0;

    unmake(node, move);

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (bestScore > alpha) {
        alpha = bestScore;
        if (isPV) {
          collectPV(node, cNode, bestMove);
        }  
        if (bestScore >= beta) {
          if (!(bestMove & MOVE_FLAG_NOISY)) {
            const bonus = depth * depth;
            updateQpth(bestMove, bonus);
            for (let i = 0; i < played - 1; i++) {
              const pm = playedMoves[i];
              if (!(pm & MOVE_FLAG_NOISY)) {
                updateQpth(playedMoves[i], -bonus);
              }  
            }  
          }  
          ttPut(TT_BETA, depth, putAdjustedScore(ply, bestScore), bestMove, ev, inCheck);
          return bestScore;
        }  
      }
    }
  }

  if (played === 0) {
    if (inCheck)
      return -MATE + ply;
    else
      return 0;
  }

  ttPut(alpha > origAlpha ? TT_EXACT : TT_ALPHA, depth, putAdjustedScore(ply, bestScore), bestMove, ev, inCheck);

  return bestScore;

}

function qsearch(ply, depth, alpha, beta) {

  g_nodes++;
  if ((g_nodes & 1023) == 0) {
    checkTime();
    if (g_finished)
      return 0;
  }

  if (ply >= MAX_PLY)
    return evaluate();

  const node = g_ss[ply]; 
  node.pvLen = 0;

  if (isDraw()) {
    return 0;
  }

  const ttix = ttGet();

  if (ttix >= 0) {
    const type = g_ttType[ttix] & TT_TYPE_MASK;
    const score = getAdjustedScore(ply, g_ttScore[ttix]);
    if (type === TT_EXACT || (type === TT_BETA && score >= beta) || (type === TT_ALPHA && score <= alpha)) {
      return score;
    }
  }

  const stm = g_stm;
  const nstm = stm ^ BLACK;
  const kix = (stm >>> 3) * 17 + 1;
  const inCheck = ttix >= 0 ? (g_ttType[ttix] & TT_INCHECK) !== 0 : isAttacked(g_pieces[kix], nstm);
  const ev = ttix >= 0 ? g_ttEval[ttix] : evaluate();
  const ttMove = ttix >= 0 && isProbablyLegal(g_ttMove[ttix]) && (inCheck || (g_ttMove[ttix] & MOVE_FLAG_NOISY)) ? g_ttMove[ttix] : 0;

  let bestScore = -INF;

  if (!inCheck) {
    bestScore = ev;
    if (ev >= beta)
      return ev;
    if (ev > alpha)
      alpha = ev;
  }

  let move = 0;
  let played = 0;
  let bestMove = 0;
  let score = 0;
  let origAlpha = alpha;

  initSearch(node, inCheck, ttMove, inCheck ^ 1);

  while ((move = getNextMove(node))) {

    // delta pruning

    if (!inCheck && !(move & MOVE_FLAG_PROMOTE)) {
      const captured = (move & MOVE_FLAG_EPCAPTURE) ? PAWN : (g_board[move & 0x7F] & 7);
      if (ev + DELTA_VALS[captured] + 200 < alpha)
        continue;
    }

    make(node, move);
    if (isAttacked(g_pieces[kix], nstm)) {
      unmake(node, move);
      continue;
    }

    played++;

    score = -qsearch(ply + 1, depth - 1, -beta, -alpha);

    if (g_finished)
      return 0;

    unmake(node, move);

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (bestScore > alpha) {
        alpha = bestScore;
        if (bestScore >= beta) {
          ttPut(TT_BETA, 0, putAdjustedScore(ply, bestScore), bestMove, ev, inCheck);
          return bestScore;
        }
      }
    }
  }

  if (inCheck && played === 0) {
    return -MATE + ply;
  }

  //ttPut(alpha > origAlpha ? TT_EXACT : TT_ALPHA, 0, putAdjustedScore(ply, bestScore), bestMove, ev);

  return bestScore;

}

function go() {

  clearQpth();

  let alpha = 0;
  let beta = 0;
  let score = 0;
  let delta = 0;
  let depth = 0;
  let bm = 0; // best move from last completed iteration

  for (let d=1; d <= g_maxDepth; d++) {
    
    alpha = -INF;
    beta  = INF;
    delta = 10;
    depth = d;
    
    if (depth >= 4) {
      alpha = Math.max(-INF, score - delta);
      beta  = Math.min(INF,  score + delta);
    }
    
    while (1) {
      
      score = search(0, depth, alpha, beta);
      
      if (g_finished)
        break;
      
      delta += delta/2 | 0;
      
      if (score <= alpha) {
        alpha = Math.max(-INF, alpha - delta);
      }
      
      else if (score >= beta) {
        beta = Math.min(INF, beta + delta);
      }
      
      else {
        bm = rootNode.pv[rootNode.pvLen-1];
        report(score, depth);
        break;
      }

    }

    if (g_finished)
      break;
    
  }

  if (!bm)
    console.log('NO BEST MOVE');

  uciSend('bestmove ' + formatMove(bm));

}

function newGame () {
  ttClear();  
}

function bench() {

  const depth = 6;

  let nodes = 0;
  let start = now();
  
  for (let i=0; i < BENCHFENS.length; i++) {
        
    const fen = BENCHFENS[i];
        
    uciExecLine('ucinewgame'); // clear tt (create on first call if not already created)
    uciExecLine('position fen ' + fen);
    uciExecLine('go depth ' + depth); // g_nodes cleared here
        
    nodes += g_nodes;
        
  }
        
  const elapsed = now() - start;
  const nps = nodes/elapsed * 1000 | 0;
        
  uciSend('nodes ' + nodes + ' elapsed ' + elapsed + ' nps ' + nps);
        
}  

function uciSend(s) {
  if (nodeHost) {
    console.log(s);
  }
  else {
    postMessage(s);
  }
}

function uciExecLine(line) {
  const tokens = line.trim().split(/\s+/);

  if (tokens.length === 0 || tokens[0] === '') {
    return;
  }

  const cmd = tokens[0];

  switch (cmd) {

    case 'isready': {
      uciSend('readyok');
      break;
    }

    case 'ucinewgame':
    case 'u': {
      if (g_ttMask === 0)
        ttResize(TT_DEFAULT);
      newGame();
      break;
    }    

    case 'uci': {
      uciSend('id name Lozza 11');
      uciSend('id author xyzzy');
      uciSend('option name Hash type spin default ' + TT_DEFAULT + ' min 1 max 1024');
      //uciSend('option name MultiPV type spin default 1 min 1 max 10');
      uciSend('uciok');
      break;
    }

    case 'p':
    case 'position': {
      const mi = tokens.indexOf('moves');
      const moves = mi >= 0 ? tokens.slice(mi + 1) : null;

      if (tokens[1] === 'startpos' || tokens[1] === 's') {
        position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'w', 'KQkq', '-', moves);
      }
      else {
        position(tokens[2], tokens[3], tokens[4], tokens[5], moves);
      }
      break;
    }

    case 'b':
    case 'board': {
      printBoard();
      break;
    }

    case 'h':
    case 'bench': {
      bench();
      break;
    }

    case 'o':
    case 'setoption': {
      if (tokens[2].toLowerCase() === 'hash')
        ttResize(parseInt(tokens[4]));
      break;
    }

    case 'perft':
    case 'f': {
      const depth = parseInt(tokens[1]) || 0;
      const t1 = Date.now();
      const n = perft(0, depth);
      const t2 = Date.now();
      const ms = t2 - t1;
      const nps = ms ? Math.floor(n / ms * 1000) : 0;
      uciSend('perft ' + depth + ' = ' + n + ' in ' + ms + ' ms ' + nps + ' nps');
      break;
    }

    case 'pt': {
      perftTests(parseInt(tokens[1]) || 0);
      break;
    }

    case 'dt': {
      drawTests();
      break;
    }

    case 'eval':
    case 'e': {
      uciSend('eval ' + evaluate());
      break;
    }

    case 'go':
    case 'g': {
      if (g_ttMask === 0)
        ttResize(TT_DEFAULT);
      initTimeControl(tokens);
      go();
      break;
    }

    case 'quit':
    case 'q': {
      if (nodeHost) {
        process.exit(0);
      }
      break;
    }

    default: {
      uciSend('?');
      break;
    }  
  }
}

initNodes();
initPST();
initZobrist();
initQpth();
initLMR();

const nodeHost = typeof process !== 'undefined' && process.versions?.node;

let feedBuf = '';

function feed(chunk) {
  feedBuf += String(chunk);

  const lines = feedBuf.split('\n');

  feedBuf = lines.pop();

  for (const raw of lines) {
    uciExecLine(raw.trimEnd());
  }
}

if (!nodeHost) {
  onmessage = function(e) {
    uciExecLine(e.data.trim());
  };
}
else {
  if (process.argv.length > 2) {
    for (let i = 2; i < process.argv.length; i++) {
      uciExecLine(process.argv[i]);
    }
    process.exit(0);
  }

  process.stdin.setEncoding('utf8');

  process.stdin.on('data', function(chunk) {
    feed(chunk);
  });

  process.stdin.on('end', function() {
    process.exit(0);
  });
}

