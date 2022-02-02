
// ccc-n from http://www.talkchess.com/forum/viewtopic.php?t=47318

var qp = [
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w Q    - 0 1', 'depth 3 moves 4729',     'castling-2'],
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w K    - 0 1', 'depth 3 moves 4686',     'castling-3'],
  ['fen 4k3/8/8/8/8/8/R7/R3K2R                                  w -    - 0 1', 'depth 3 moves 4522',     'castling-4'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b kq   - 0 1', 'depth 3 moves 4893',     'castling-5'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b q    - 0 1', 'depth 3 moves 4729',     'castling-6'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b k    - 0 1', 'depth 3 moves 4686',     'castling-7'],
  ['fen r3k2r/r7/8/8/8/8/8/4K3                                  b -    - 0 1', 'depth 3 moves 4522',     'castling-8'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 0 moves 1',        'cpw-pos1-0'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 1 moves 20',       'cpw-pos1-1'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 2 moves 400',      'cpw-pos1-2'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 3 moves 8902',     'cpw-pos1-3'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 4 moves 197281',   'cpw-pos1-4'],
  ['fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR             w KQkq - 0 1', 'depth 6 moves 119060324','cpw-pos1-6'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq - 0 1', 'depth 1 moves 42',       'cpw-pos5-1'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq - 0 1', 'depth 2 moves 1352',     'cpw-pos5-2'],
  ['fen rnbqkb1r/pp1p1ppp/2p5/4P3/2B5/8/PPP1NnPP/RNBQK2R        w KQkq - 0 1', 'depth 3 moves 53392',    'cpw-pos5-3'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'depth 1 moves 48',       'cpw-pos2-1'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'depth 2 moves 2039',     'cpw-pos2-2'],
  ['fen r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'depth 3 moves 97862',    'cpw-pos2-3'],
  ['fen 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8                         w -    - 0 1', 'depth 5 moves 674624',   'cpw-pos3-5'],
  ['fen n1n5/PPPk4/8/8/8/8/4Kppp/5N1N                           b -    - 0 1', 'depth 1 moves 24',       'prom-1'],
  ['fen 8/5bk1/8/2Pp4/8/1K6/8/8                                 w -   d6 0 1', 'depth 6 moves 824064',   'ccc-1'],
  ['fen 8/8/1k6/8/2pP4/8/5BK1/8                                 b -   d3 0 1', 'depth 6 moves 824064',   'ccc-2'],
  ['fen 8/8/1k6/2b5/2pP4/8/5K2/8                                b -   d3 0 1', 'depth 6 moves 1440467',  'ccc-3'],
  ['fen 8/5k2/8/2Pp4/2B5/1K6/8/8                                w -   d6 0 1', 'depth 6 moves 1440467',  'ccc-4'],
  ['fen 5k2/8/8/8/8/8/8/4K2R                                    w K    - 0 1', 'depth 6 moves 661072',   'ccc-5'],
  ['fen 4k2r/8/8/8/8/8/8/5K2                                    b k    - 0 1', 'depth 6 moves 661072',   'ccc-6'],
  ['fen 3k4/8/8/8/8/8/8/R3K3                                    w Q    - 0 1', 'depth 6 moves 803711',   'ccc-7'],
  ['fen r3k3/8/8/8/8/8/8/3K4                                    b q    - 0 1', 'depth 6 moves 803711',   'ccc-8'],
  ['fen r3k2r/1b4bq/8/8/8/8/7B/R3K2R                            w KQkq - 0 1', 'depth 4 moves 1274206',  'ccc-9'],
  ['fen r3k2r/7b/8/8/8/8/1B4BQ/R3K2R                            b KQkq - 0 1', 'depth 4 moves 1274206',  'ccc-10'],
  ['fen r3k2r/8/3Q4/8/8/5q2/8/R3K2R                             b KQkq - 0 1', 'depth 4 moves 1720476',  'ccc-11'],
  ['fen r3k2r/8/5Q2/8/8/3q4/8/R3K2R                             w KQkq - 0 1', 'depth 4 moves 1720476',  'ccc-12'],
  ['fen 2K2r2/4P3/8/8/8/8/8/3k4                                 w -    - 0 1', 'depth 6 moves 3821001',  'ccc-13'],
  ['fen 3K4/8/8/8/8/8/4p3/2k2R2                                 b -    - 0 1', 'depth 6 moves 3821001',  'ccc-14'],
  ['fen 8/8/1P2K3/8/2n5/1q6/8/5k2                               b -    - 0 1', 'depth 5 moves 1004658',  'ccc-15'],
  ['fen 5K2/8/1Q6/2N5/8/1p2k3/8/8                               w -    - 0 1', 'depth 5 moves 1004658',  'ccc-16'],
  ['fen 4k3/1P6/8/8/8/8/K7/8                                    w -    - 0 1', 'depth 6 moves 217342',   'ccc-17'],
  ['fen 8/k7/8/8/8/8/1p6/4K3                                    b -    - 0 1', 'depth 6 moves 217342',   'ccc-18'],
  ['fen 8/P1k5/K7/8/8/8/8/8                                     w -    - 0 1', 'depth 6 moves 92683',    'ccc-19'],
  ['fen 8/8/8/8/8/k7/p1K5/8                                     b -    - 0 1', 'depth 6 moves 92683',    'ccc-20'],
  ['fen K1k5/8/P7/8/8/8/8/8                                     w -    - 0 1', 'depth 6 moves 2217',     'ccc-21'],
  ['fen 8/8/8/8/8/p7/8/k1K5                                     b -    - 0 1', 'depth 6 moves 2217',     'ccc-22'],
  ['fen 8/k1P5/8/1K6/8/8/8/8                                    w -    - 0 1', 'depth 7 moves 567584',   'ccc-23'],
  ['fen 8/8/8/8/1k6/8/K1p5/8                                    b -    - 0 1', 'depth 7 moves 567584',   'ccc-24'],
  ['fen 8/8/2k5/5q2/5n2/8/5K2/8                                 b -    - 0 1', 'depth 4 moves 23527',    'ccc-25'],
  ['fen 8/5k2/8/5N2/5Q2/2K5/8/8                                 w -    - 0 1', 'depth 4 moves 23527',    'ccc-26'],
  ['fen 8/2pkp3/8/RP3P1Q/6B1/8/2PPP3/rb1K1n1r                   w -    - 0 1', 'depth 6 moves 181153194','ob1'],
  ['fen 8/2ppp3/8/RP1k1P1Q/8/8/2PPP3/rb1K1n1r                   w -    - 0 1', 'depth 6 moves 205552081','ob2'],
  ['fen 8/8/3q4/4r3/1b3n2/8/3PPP2/2k1K2R                        w K    - 0 1', 'depth 6 moves 207139531','ob3'],
  ['fen 4r2r/RP1kP1P1/3P1P2/8/8/3ppp2/1p4p1/4K2R                b K    - 0 1', 'depth 6 moves 314516438','ob4'],
  ['fen r6r/1P4P1/2kPPP2/8/8/3ppp2/1p4p1/R3K2R                  w KQ   - 0 1', 'depth 6 moves 975944981','ob5']
];

lozData.idInfo  = '#info';
lozData.idStats = '#stats';

var engine       = new Worker('lozza.js');
engine.onmessage = lozStandardRx;

$(function() {

  engine.postMessage('ping');
  engine.postMessage('debug on');

  for (var i=0; i < qp.length; i++) {
    engine.postMessage('ucinewgame');
    engine.postMessage('position ' + qp[i][0]);
    engine.postMessage('id ' + qp[i][2]);
    engine.postMessage('perft inner 0 ' + qp[i][1]);
  }

});

