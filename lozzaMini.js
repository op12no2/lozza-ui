// lozzaMini.js: Lozza, a UCI chess engine in plain JavaScript, written to be read. it runs as a
// web worker in a page (or under node with a small host) and talks UCI through messages. this is
// the small net build, with the net written out in the source as boards so that it can be read:
// (768 -> 16) x 2 -> 1; for each of the 16 hidden units twelve boards give the weight of each
// piece on each square (NET_BOARDS below), two accumulators sum them for the pieces on the board
// as seen from each side, SCReLU squares each after clipping, and the output weights add them
// up; trained with bullet on leela's test80 data. bullet's quantisation: QA 255, QB 64, output
// scale 400. the other builds share everything but the evaluation
//
const VER = "12.0";

const TRACE = false;

const PAWN   = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK   = 4;
const QUEEN  = 5;
const KING   = 6;

const WHITE = 0; // white colour
const BLACK = 8; // black colour

const WHITE_INDEX = 0;  // any colour >>> 3;
const BLACK_INDEX = 1;  // any colour >>> 3;

const WHITE_RIGHTS_KING  = 1;
const WHITE_RIGHTS_QUEEN = 2;
const BLACK_RIGHTS_KING  = 4;
const BLACK_RIGHTS_QUEEN = 8;

// moves are ints: bits 0-5 the from square, 6-11 the to square, 12 a capture of any kind (ep
// included), 13 an ep capture, 14 a promotion with the piece in bits 15-16 as piece - KNIGHT,
// and 17 castling, encoded as the king's move

const CAPTURE_BIT       = 1 << 12;
const EP_CAPTURE_BIT    = 1 << 13;
const PROMO_BIT         = 1 << 14;
const PROMO_PIECE_SHIFT = 15;
const PROMO_PIECE_MASK  = 3 << PROMO_PIECE_SHIFT; // promo piece - KNIGHT
const CASTLE_BIT        = 1 << 17;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

//
// pos
//

// each ply's position is an object, created up front and copied field by field by make_move
// (copy-make): the board (a piece code per square, a1 = 0), the side to move, the castling
// rights, the ep square, the halfmove clock, the zobrist hash as two int32 halves, the running
// piece square sums and phase (white positive), the king squares by colour index, the material
// key (piece counts packed, see MAT_SHIFT) and the pawn key (the zobrist of the pawns alone,
// for the correction history)

function new_pos() {
  return {
    board:  new Uint8Array(64),  // a piece code per square, a1 = 0, 0 for empty
    stm:    0,                   // the side to move, WHITE or BLACK
    rights: 0,                   // the castling rights, the WHITE/BLACK_RIGHTS_KING/QUEEN bits
    ep:     0,                   // the ep target square, 0 for none
    hmc:    0,                   // the halfmove clock, for the 50 move rule
    lo:     0,                   // the zobrist hash, as two int32 halves
    hi:     0,
    mg:     0,                   // the running piece square sums, white positive
    eg:     0,
    phase:  0,                   // the running phase, 0 (no pieces) to 24 and beyond
    kings:  new Uint8Array(2),   // the king squares by colour index
    mat:    0,                   // the material key, piece counts packed as MAT_SHIFT says
    pk_lo:  0,                   // the pawn key, the zobrist of the pawns alone (correction history)
    pk_hi:  0
  };
}

function copy_pos(dst, src) {
  dst.board.set(src.board);
  dst.stm      = src.stm;
  dst.rights   = src.rights;
  dst.ep       = src.ep;
  dst.hmc      = src.hmc;
  dst.lo       = src.lo;
  dst.hi       = src.hi;
  dst.mg       = src.mg;
  dst.eg       = src.eg;
  dst.phase    = src.phase;
  dst.kings[0] = src.kings[0];
  dst.kings[1] = src.kings[1];
  dst.mat      = src.mat;
  dst.pk_lo    = src.pk_lo;
  dst.pk_hi    = src.pk_hi;
}

function clear_pos(pos) {
  pos.board.fill(0);
  pos.stm      = 0;
  pos.rights   = 0;
  pos.ep       = 0;
  pos.hmc      = 0;
  pos.lo       = 0;
  pos.hi       = 0;
  pos.mg       = 0;
  pos.eg       = 0;
  pos.phase    = 0;
  pos.kings[0] = 0;
  pos.kings[1] = 0;
  pos.mat      = 0;
  pos.pk_lo    = 0;
  pos.pk_hi    = 0;
}

// the material key, pos.mat: how many of each piece each side has, packed into one int (4 bits
// per side for pawns, 3 for each other type, 32 bits in all) and kept up to date by put_piece
// and remove_piece. anything that only needs the counts reads them from the key instead of
// scanning the board: the material imbalance (which also caches its result by the key, so a
// material balance is evaluated once and looked up after), the endgame scale class, the
// material draw test and the bishop pair. the idea is the material hash key of
// https://www.chessprogramming.org/Material_Hash_Table, counts in the key and the lookup by it.
// MAT_SHIFT is the bit position of each piece code's count, MAT_INC what adding one piece adds

const MAT_SHIFT = new Int8Array([0, 0, 8, 11, 14, 17, 0, 0, 0, 4, 20, 23, 26, 29, 0, 0]);
const MAT_INC   = new Int32Array(16);

for (let piece=PAWN; piece <= (QUEEN | BLACK); piece++)
  if ((piece & 7) >= PAWN && (piece & 7) <= QUEEN)
    MAT_INC[piece] = 1 << MAT_SHIFT[piece];

// every board change goes through these so the sums, keys and hash keep up

function put_piece(node, piece, sq) {

  const pos = node.pos;

  node.board[sq] = piece;

  pos.mg    += pst_mg[piece * 64 + sq];
  pos.eg    += pst_eg[piece * 64 + sq];
  pos.phase += PHASE[piece & 7];
  pos.mat   += MAT_INC[piece];

  hash_piece(pos, piece, sq);

  net_add(node.acc, NET_ROW[piece * 64 + sq]);

}

function remove_piece(node, piece, sq) {

  const pos = node.pos;

  node.board[sq] = 0;

  pos.mg    -= pst_mg[piece * 64 + sq];
  pos.eg    -= pst_eg[piece * 64 + sq];
  pos.phase -= PHASE[piece & 7];
  pos.mat   -= MAT_INC[piece];

  hash_piece(pos, piece, sq);

  net_sub(node.acc, NET_ROW[piece * 64 + sq]);

}

// pawn_sq is the pawn that just double pushed
// ep is only set if a by_colour pawn is beside it, so equal positions hash the same

function ep_capturable(b, pawn_sq, by_colour) {

  const pawn = PAWN | by_colour;
  const file = pawn_sq & 7;

  return (file > 0 && b[pawn_sq - 1] === pawn) || (file < 7 && b[pawn_sq + 1] === pawn);

}

// fields after the board default to w - - 0 so short fens are ok

function set_position(ply, fen) {

  const node = nodes[ply];
  const pos  = node.pos;
  const b    = node.board;

  const [board_str, stm_str = 'w', rights_str = '-', ep_str = '-', hmc_str = '0'] = fen.trim().split(/\s+/);

  clear_pos(pos);

  net_reset(node);

  node.cont = -1;

  let rank = 7;
  let file = 0;

  for (const ch of board_str) {
    if (ch === '/') {
      rank--;
      file = 0;
    }
    else if (ch >= '1' && ch <= '8') {
      file += ch.charCodeAt(0) - 48;
    }
    else {
      const sq     = rank * 8 + file;
      const colour = ch === ch.toLowerCase() ? BLACK : WHITE;
      const ptype  = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
      put_piece(node, ptype | colour, sq);
      if (ptype === KING)
        pos.kings[(colour >>> 3)] = sq;
      file++;
    }
  }

  pos.stm = stm_str === 'b' ? BLACK : WHITE;

  for (const ch of rights_str) {
    switch (ch) {
      case 'K': pos.rights |= WHITE_RIGHTS_KING;  break;
      case 'Q': pos.rights |= WHITE_RIGHTS_QUEEN; break;
      case 'k': pos.rights |= BLACK_RIGHTS_KING;  break;
      case 'q': pos.rights |= BLACK_RIGHTS_QUEEN; break;
    }
  }

  if (ep_str !== '-') {
    const ep = (ep_str.charCodeAt(1) - 49) * 8 + (ep_str.charCodeAt(0) - 97);
    if (ep_capturable(b, ep - PAWN_PUSH[pos.stm >>> 3], pos.stm))
      pos.ep = ep;
  }

  pos.hmc = parseInt(hmc_str) || 0;

  set_hash(node);

}

function sq_name(sq) {
  return String.fromCharCode(97 + (sq & 7), 49 + (sq >>> 3));
}

function hex32(x) {
  return (x >>> 0).toString(16).padStart(8, '0');
}

// the fen of a position; the move number is not kept, so it is always 1

function fen_string(ply) {

  const pos = nodes[ply].pos;
  const b   = nodes[ply].board;

  let s = '';

  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = b[rank * 8 + file];
      if (piece === 0) {
        empty++;
        continue;
      }
      if (empty) {
        s += empty;
        empty = 0;
      }
      const ch = '.pnbrqk'[piece & 7];
      s += piece & BLACK ? ch : ch.toUpperCase();
    }
    if (empty)
      s += empty;
    if (rank)
      s += '/';
  }

  const r = pos.rights;

  let rights = '';
  if (r & WHITE_RIGHTS_KING)  rights += 'K';
  if (r & WHITE_RIGHTS_QUEEN) rights += 'Q';
  if (r & BLACK_RIGHTS_KING)  rights += 'k';
  if (r & BLACK_RIGHTS_QUEEN) rights += 'q';

  return s + ' ' + (pos.stm === BLACK ? 'b' : 'w') +
         ' ' + (rights || '-') +
         ' ' + (pos.ep ? sq_name(pos.ep) : '-') +
         ' ' + pos.hmc + ' 1';

}

// the board command: the fen first, as lozza 11 prints it (web pages read it), then a diagram

function pp_position(ply) {

  const pos = nodes[ply].pos;
  const b   = nodes[ply].board;

  uci_send(fen_string(ply));

  for (let rank = 7; rank >= 0; rank--) {
    let s = (rank + 1) + '  ';
    for (let file = 0; file < 8; file++) {
      const piece = b[rank * 8 + file];
      const ch    = '.pnbrqk'[piece & 7];
      s += (piece & BLACK ? ch : ch.toUpperCase()) + ' ';
    }
    uci_send(s);
  }
  uci_send('   a b c d e f g h');

  const r = pos.rights;

  let rights = '';
  if (r & WHITE_RIGHTS_KING)  rights += 'K';
  if (r & WHITE_RIGHTS_QUEEN) rights += 'Q';
  if (r & BLACK_RIGHTS_KING)  rights += 'k';
  if (r & BLACK_RIGHTS_QUEEN) rights += 'q';

  uci_send('stm ' + (pos.stm === BLACK ? 'b' : 'w') +
           ' rights ' + (rights || '-') +
           ' ep ' + (pos.ep ? sq_name(pos.ep) : '-') +
           ' hmc ' + pos.hmc +
           ' kings ' + sq_name(pos.kings[WHITE_INDEX]) + ' ' + sq_name(pos.kings[BLACK_INDEX]) +
           ' hash ' + hex32(pos.hi) + hex32(pos.lo));

}

//
// nodes
//

const MAX_MOVES = 256;
const MAX_PLY   = 128;

//
// the net, written out: one block per hidden unit, twelve boards each (white pawn, knight,
// bishop, rook, queen, king, then black), rank 8 at the top as a diagram, each entry the weight
// of that piece on that square for the unit in 1/255 of a pawn; then the unit's bias and its
// two output weights, for the unit seen from our side and from theirs. a unit fires (squared,
// after clipping) on the sum of the weights of the pieces on the board as seen from each side
//

const NET_BOARDS = [

  [ // unit 0: bias -14, output weights -123 (ours) 121 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        -5,   15,  -11,    1,  -33,   10,  -15,   -5,
         6,   11,   -8,    7,  -23,   11,  -17,   -3,
        11,   20,   -9,   26,  -26,   30,  -12,    8,
        11,   32,  -19,   32,  -38,   40,  -11,   11,
         6,   32,  -24,   28,  -37,   41,   -9,   13,
         8,   27,  -21,   30,  -24,   33,   -4,   12,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -40,  -40,  -36,  -39,  -31,  -57,  -31,  -56,
       -26,  -26,  -21,  -37,  -23,  -35,  -25,  -35,
       -25,  -24,  -30,  -19,  -25,  -21,  -30,  -22,
       -24,  -21,  -26,   -9,  -35,   -7,  -25,  -13,
       -28,  -15,  -20,  -13,  -19,   -7,  -22,  -15,
       -23,  -16,  -24,   -9,  -11,  -16,  -13,  -11,
       -24,  -19,  -13,  -15,  -13,   -8,  -10,  -13,
       -29,  -26,  -16,  -14,  -11,  -11,  -13,  -21,
    ],
    [ // white bishops
       -45,  -45,  -36,  -42,  -32,  -49,  -33,  -58,
       -37,  -31,  -42,  -27,  -41,  -22,  -49,  -33,
       -30,  -35,  -31,  -29,  -28,  -39,  -23,  -36,
       -32,  -22,  -36,  -13,  -44,  -14,  -35,  -18,
       -25,  -29,  -29,  -25,  -24,  -38,  -19,  -33,
       -35,  -22,  -30,  -21,  -24,  -23,  -32,  -21,
       -31,  -40,  -20,  -30,  -20,  -24,  -32,  -41,
       -45,  -31,  -35,  -17,  -24,  -27,  -36,  -45,
    ],
    [ // white rooks
       -36,  -37,  -44,  -39,  -39,  -37,  -38,  -38,
       -25,  -34,  -35,  -35,  -32,  -34,  -39,  -35,
       -24,  -32,  -34,  -33,  -31,  -31,  -32,  -31,
       -24,  -31,  -32,  -28,  -31,  -26,  -29,  -29,
       -29,  -28,  -33,  -32,  -34,  -26,  -31,  -28,
       -30,  -30,  -35,  -29,  -37,  -22,  -28,  -31,
       -30,  -27,  -37,  -28,  -36,  -18,  -32,  -32,
       -46,  -32,  -43,  -36,  -42,  -30,  -41,  -47,
    ],
    [ // white queens
       -97,  -91,  -92,  -96,  -92,  -91,  -81,  -96,
       -68,  -74,  -75,  -74,  -79,  -70,  -69,  -69,
       -71,  -67,  -68,  -63,  -65,  -65,  -72,  -78,
       -64,  -61,  -56,  -50,  -54,  -50,  -62,  -69,
       -72,  -58,  -53,  -51,  -45,  -48,  -52,  -60,
       -64,  -70,  -56,  -50,  -52,  -50,  -50,  -58,
       -66,  -65,  -69,  -57,  -61,  -47,  -53,  -61,
       -72,  -71,  -71,  -70,  -62,  -52,  -64,  -74,
    ],
    [ // white kings
       -12,    5,    7,   17,   11,    7,    0,    9,
       -14,   -8,   -5,    9,    7,    6,    1,    5,
       -13,  -16,  -12,    8,    8,    3,   -1,    6,
        -9,   -8,   -3,    9,    6,    8,   -1,    5,
        -7,   -1,    0,    9,    6,    6,    1,    1,
        -7,   -1,    0,    3,    6,    4,    2,   -1,
        -7,   -5,   -1,    1,    2,    2,    1,    2,
        -6,   -5,   -6,   -6,    1,   -1,   -2,    3,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        25,   18,    2,    9,  -11,   15,    6,   11,
        24,   21,    7,   -5,   -7,   10,   11,   10,
        23,   19,    7,   -3,    1,    9,   12,   11,
        23,   17,   12,    5,   10,    6,   14,   12,
        27,   12,   28,   21,   25,    7,   16,   13,
        28,   12,   27,   28,   15,   18,    7,    9,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        15,    9,   30,   23,   32,   21,   27,   -1,
        24,   16,   42,   14,   40,   25,   37,   19,
        23,   28,   30,   33,   36,   30,   33,   32,
        21,   41,   30,   42,   21,   49,   27,   30,
        19,   43,   24,   45,   25,   53,   23,   39,
        18,   30,   31,   39,   29,   35,   22,   24,
        21,   18,   30,   19,   32,   15,   26,    9,
         1,    3,   18,    9,   19,   -5,   11,  -16,
    ],
    [ // black bishops
        24,   31,   19,   32,   25,   27,   20,   16,
        23,   28,   33,   25,   27,   34,   26,   17,
        29,   31,   39,   29,   30,   39,   28,   24,
        27,   38,   28,   37,   23,   32,   31,   25,
        31,   34,   33,   35,   33,   41,   31,   29,
        22,   39,   26,   32,   28,   37,   29,   25,
        21,   23,   29,   29,   26,   40,   14,   16,
         6,   19,   19,   22,   25,   13,   21,    0,
    ],
    [ // black rooks
        20,   31,   34,   44,   39,   28,   36,   24,
        34,   36,   41,   53,   49,   40,   41,   43,
        38,   44,   44,   54,   50,   46,   46,   44,
        45,   53,   49,   55,   50,   55,   48,   51,
        47,   56,   44,   57,   49,   57,   44,   49,
        49,   54,   45,   57,   46,   55,   42,   47,
        48,   57,   45,   56,   46,   55,   36,   46,
        42,   49,   37,   48,   45,   46,   44,   43,
    ],
    [ // black queens
        48,   53,   55,   54,   56,   57,   53,   51,
        51,   60,   54,   67,   61,   69,   66,   59,
        56,   54,   72,   73,   77,   76,   71,   62,
        51,   69,   71,   81,   75,   81,   69,   63,
        61,   69,   70,   81,   74,   77,   69,   56,
        52,   66,   63,   71,   66,   64,   58,   52,
        56,   62,   60,   63,   54,   64,   68,   60,
        43,   49,   44,   41,   43,   41,   53,   49,
    ],
    [ // black kings
         3,    5,   -6,   -5,  -16,   -1,  -11,   -8,
         7,    5,   -1,    1,   -2,    1,    0,   -6,
         6,    9,    6,    5,    1,    5,    3,   -3,
         6,   12,   13,    6,    6,    5,    4,   -2,
         9,   11,   15,    8,    8,    7,    6,   -2,
         8,   13,   12,   14,   10,   12,    4,    4,
         6,   18,   19,   19,   15,   14,    3,    2,
       -12,   13,   18,   27,   18,   16,    2,    3,
    ],
  ],

  [ // unit 1: bias 147, output weights 52 (ours) -53 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       -17,  -19,  -47,  -13,  -28,  -17,  -13,  -14,
        -9,   -1,  -51,  -11,  -14,  -21,  -11,  -11,
        -4,    4,  -49,   -8,   -6,  -14,   -2,   -5,
        -1,    3,  -76,   -9,    2,   -6,    3,    0,
         9,  -21,  -67,  -16,    1,   -1,    5,    4,
         7,  -16,  -56,   -6,   -1,    2,    7,    5,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -11,  -10,  -18,  -19,  -22,  -17,  -24,  -33,
       -10,  -31,  -36,  -37,  -23,  -27,  -17,  -21,
       -16,  -45,  -35,  -39,  -27,  -33,  -36,  -25,
       -27,  -32,  -49,  -40,  -33,  -33,  -34,  -31,
       -35,  -25,  -60,  -31,  -33,  -31,  -34,  -36,
       -51,  -23,  -44,  -28,  -42,  -29,  -28,  -35,
       -25,  -43,  -34,  -37,  -27,  -22,  -39,  -34,
       -27,  -39,  -26,  -40,  -29,  -34,  -31,  -27,
    ],
    [ // white bishops
       -40,  -37,  -32,  -33,  -34,  -36,  -45,  -55,
       -26,  -29,  -37,  -24,  -35,  -42,  -34,  -40,
       -29,  -30,  -37,  -31,  -31,  -40,  -37,  -37,
       -29,  -36,  -54,  -37,  -33,  -36,  -32,  -33,
       -28,  -39,  -57,  -41,  -30,  -29,  -28,  -32,
       -24,  -43,  -49,  -38,  -21,  -33,  -31,  -30,
       -23,  -30,  -47,  -32,  -24,  -23,  -31,  -29,
       -27,  -31,  -40,  -29,  -28,  -29,  -30,  -37,
    ],
    [ // white rooks
       -32,  -30,  -56,  -32,  -36,  -34,  -33,  -31,
       -38,  -40,  -59,  -37,  -42,  -37,  -31,  -33,
       -37,  -33,  -63,  -34,  -37,  -35,  -30,  -31,
       -35,  -30,  -61,  -32,  -38,  -37,  -33,  -31,
       -32,  -29,  -40,  -36,  -37,  -32,  -34,  -35,
       -25,  -27,  -27,  -32,  -37,  -38,  -40,  -43,
       -31,  -27,  -22,  -28,  -42,  -42,  -46,  -51,
       -32,  -28,  -17,  -28,  -42,  -39,  -36,  -38,
    ],
    [ // white queens
       -82,  -83,  -93,  -82,  -85,  -88,  -87,  -92,
       -65,  -69,  -78,  -65,  -72,  -82,  -70,  -75,
       -62,  -59,  -77,  -60,  -74,  -74,  -69,  -68,
       -57,  -55,  -75,  -60,  -68,  -66,  -67,  -73,
       -51,  -58,  -62,  -61,  -61,  -65,  -67,  -75,
       -53,  -51,  -56,  -57,  -61,  -72,  -73,  -78,
       -55,  -50,  -54,  -54,  -67,  -70,  -77,  -87,
       -54,  -53,  -51,  -56,  -66,  -67,  -72,  -86,
    ],
    [ // white kings
       -55,    0,   -6,  -26,  -30,  -27,   -4,  -30,
       -20,   -3,   -6,   15,    7,    4,   10,   -3,
        -8,    5,    1,   23,   24,   16,   18,    7,
         1,    1,   10,   16,   26,   23,   21,   12,
         0,    3,    6,   10,   22,   25,   23,   18,
        -7,   -3,   -6,    4,   17,   23,   23,   21,
       -11,  -14,  -16,    4,   16,   22,   25,   25,
       -12,   -7,  -12,    1,   17,   22,   23,   23,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         1,   -8,  -45,   -6,   -4,   -4,   11,    7,
         1,    1,  -71,    5,   -6,   -9,    8,    8,
        -8,   26, -218,   18,   -4,   -8,    9,    4,
        -7,   37, -268,   21,   -3,   -6,    9,    7,
         5,   41, -274,   18,    5,    8,   18,   15,
         1,   10, -250,    9,   -6,   21,    9,   14,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        29,   20,   26,   19,   20,   18,   18,   12,
        22,   21,   31,   22,   21,   30,   13,   10,
        19,   32,   27,   32,   22,   23,   24,   18,
        28,   42,   26,   29,   31,   25,   23,   19,
        29,   40,   20,   42,   28,   32,   27,   24,
        41,   32,   29,   39,   39,   35,   29,   33,
        52,   30,   30,   31,   49,   39,   43,   33,
        32,   36,   39,   37,   39,   41,   36,   11,
    ],
    [ // black bishops
        29,   21,   15,   20,   17,   24,   27,   19,
        31,   24,   19,   17,   26,   30,   31,   30,
        19,   12,   23,   17,   26,   24,   29,   30,
        27,   10,   21,   17,   29,   31,   30,   24,
        22,   28,   10,   41,   29,   27,   25,   22,
        29,   28,   32,   36,   31,   22,   24,   18,
        22,   32,   18,   41,   25,   27,   21,   21,
        15,   19,   29,   26,   24,   22,   17,    2,
    ],
    [ // black rooks
        26,   32,   21,   34,   31,   24,   27,   26,
        26,   31,   19,   33,   29,   21,   16,   12,
        33,   33,   20,   34,   33,   24,   26,   20,
        29,   32,   19,   28,   35,   32,   32,   29,
        27,   36,    7,   42,   36,   35,   39,   39,
        34,   36,   11,   42,   38,   39,   41,   41,
        34,   30,   16,   40,   36,   38,   39,   40,
        42,   43,   18,   46,   43,   43,   42,   43,
    ],
    [ // black queens
        62,   59,   59,   58,   53,   47,   45,   35,
        57,   64,   63,   61,   49,   50,   41,   35,
        55,   59,   63,   56,   54,   42,   46,   41,
        61,   53,   59,   55,   51,   47,   44,   44,
        57,   57,   43,   65,   51,   48,   44,   43,
        52,   58,   42,   66,   49,   47,   46,   46,
        60,   48,   37,   64,   53,   42,   55,   52,
        48,   48,   34,   52,   46,   45,   48,   44,
    ],
    [ // black kings
        11,    8,    4,   -6,    3,    3,    7,    5,
        17,    9,    5,    2,    3,    5,    9,    9,
        16,   19,   15,   10,   12,    9,    8,    5,
        25,   31,   33,   24,   22,   16,   15,    4,
        26,   44,   44,   46,   30,   17,   12,    2,
        25,   53,   52,   57,   30,    9,    5,   -4,
        19,   52,   47,   52,   19,    5,   -4,  -14,
       -18,   50,   42,    6,  -14,  -25,  -17,  -42,
    ],
  ],

  [ // unit 2: bias -21, output weights -80 (ours) 81 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       -19,   10,  -12,   11,  -27,  -20,   -1,  -18,
         5,   20,   -4,   20,  -11,   -5,   11,    1,
        15,   35,    3,   41,    9,   -3,   29,   10,
        16,   40,   -1,   16,   21,  -21,   42,    9,
        13,   34,   -8,   -4,   30,  -49,   45,    9,
        13,   31,  -12,  -10,   12,  -51,   36,   10,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -11,  -14,  -14,  -14,  -14,  -25,  -14,  -28,
        -4,   -3,    0,   -9,   -9,   -3,   -1,  -10,
        -5,    3,  -12,   -6,   -6,  -14,   -4,  -13,
        -1,   -6,  -15,  -10,  -13,  -13,  -11,   -4,
        -9,   -2,  -14,   -9,   -7,  -11,   -4,  -13,
         2,   -1,  -13,   -5,    4,  -13,    2,  -11,
        -6,   -3,   -1,   -7,   -2,   -7,    1,   -4,
         5,   -5,   -1,   -8,   -6,    3,   -3,   -8,
    ],
    [ // white bishops
       -27,  -20,  -22,  -18,  -16,  -26,  -16,  -31,
       -22,  -13,  -21,  -12,  -16,  -13,  -16,  -22,
       -12,  -12,  -20,   -7,  -11,  -14,  -12,  -15,
        -7,  -10,  -17,  -15,  -18,  -14,  -12,  -10,
        -8,   -8,  -18,  -25,   -4,  -19,  -10,  -14,
        -3,  -11,  -17,  -16,   -9,  -17,  -16,  -10,
       -14,  -13,  -12,  -13,  -15,   -3,  -15,  -19,
       -12,  -16,   -6,  -16,  -17,   -2,  -14,  -17,
    ],
    [ // white rooks
       -20,  -17,  -23,  -17,  -20,  -21,  -20,  -16,
       -11,  -12,  -17,  -16,  -18,  -14,  -19,  -12,
        -8,   -9,  -16,  -10,  -13,   -9,  -14,   -7,
        -6,  -10,  -15,  -10,  -16,  -12,  -12,   -4,
       -10,  -12,  -18,  -17,  -17,  -20,  -11,   -7,
       -12,  -11,  -22,  -15,  -14,  -19,   -6,   -6,
       -13,  -10,  -24,  -17,  -17,  -32,   -7,  -18,
       -25,  -11,  -26,  -22,  -22,  -51,    2,   -4,
    ],
    [ // white queens
       -24,  -22,  -28,  -25,  -30,  -26,  -16,  -17,
       -17,  -13,  -14,  -12,  -15,  -17,   -8,   -6,
       -12,   -3,   -8,   -4,   -5,   -2,   -7,  -11,
        -7,   -8,   -5,   -4,   -4,   -5,   -7,  -12,
       -16,   -3,   -8,  -10,    0,   -2,   -5,   -7,
        -5,  -16,  -12,   -8,   -1,   -7,   -6,   -3,
        -7,   -7,  -23,  -14,  -13,   -6,    2,   -7,
        -8,   -7,  -15,  -22,  -14,  -17,    4,   -7,
    ],
    [ // white kings
       -28,  -10,  -17,  -29,  -19,  -20,  -19,  -28,
       -46,  -31,  -36,  -26,  -25,  -17,  -27,  -32,
       -38,  -33,  -32,  -18,  -19,  -12,  -32,  -30,
       -29,  -24,  -21,  -13,  -11,  -10,  -19,  -24,
       -18,  -15,   -9,  -13,   -9,  -14,   -8,  -13,
       -15,   -8,   -7,   -8,   -6,  -11,    1,   -4,
       -22,   -5,    2,   -1,    4,    3,   11,    5,
       -14,   -8,    6,    1,   10,   18,   14,   10,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         8,    8,    4,    4,   -9,   -5,    6,    6,
         7,    6,    8,   -2,   -9,  -12,    3,    4,
         7,    7,   -2,    4,  -16,  -10,   -1,   10,
         8,   10,   10,    6,    0,    4,    6,   14,
        20,   19,   28,   35,   19,   26,   21,   18,
        27,   27,   32,   34,   22,   12,   45,   20,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -23,  -17,   -2,  -10,   -2,   -4,    4,  -26,
       -11,   -4,    3,    9,    5,   15,   -5,    3,
        -2,    6,   11,   28,    7,   21,    1,   12,
        -3,   21,   27,   31,   33,   26,   35,    3,
         6,   23,   32,   27,   42,   11,   49,    9,
        11,   18,   25,   32,   39,   16,   45,   16,
         6,   13,   21,   29,   25,   25,    4,   24,
        19,    8,   17,   28,   12,   28,    0,    2,
    ],
    [ // black bishops
        -8,    4,    2,    7,    2,    5,   -1,  -11,
         9,    3,   16,   15,    4,   11,   10,    4,
        17,   23,   24,   21,   15,   17,   22,   18,
        17,   27,   29,   36,   26,   22,   29,   13,
        17,   25,   27,   32,   39,   20,   26,   28,
        11,   23,   18,   32,   31,   13,   39,   23,
         5,   14,   19,   21,   18,   10,   24,    3,
         1,   13,   12,   20,   23,   15,   15,   16,
    ],
    [ // black rooks
         7,   15,   17,   17,   26,   15,   20,    6,
         9,   19,   19,   21,   33,   26,   19,   13,
        14,   23,   29,   26,   35,   32,   22,   16,
        24,   35,   32,   37,   40,   34,   34,   21,
        35,   46,   38,   42,   48,   35,   45,   34,
        48,   55,   45,   54,   53,   41,   56,   48,
        54,   65,   55,   56,   61,   38,   67,   56,
        46,   53,   44,   50,   51,   44,   46,   42,
    ],
    [ // black queens
        33,   32,   34,   29,   39,   36,   33,   30,
        42,   40,   32,   38,   40,   48,   43,   38,
        38,   43,   53,   52,   59,   55,   53,   48,
        40,   57,   63,   75,   73,   68,   52,   51,
        52,   62,   67,   85,   86,   74,   56,   50,
        53,   72,   67,   79,   87,   81,   69,   48,
        60,   72,   76,   79,   88,   61,   95,   78,
        60,   62,   59,   67,   66,   74,   71,   65,
    ],
    [ // black kings
       -15,   -8,  -13,   -6,  -19,   -9,   -8,  -12,
        -4,    1,   -2,    1,   -3,  -10,   -3,   -7,
        -2,   10,    5,    8,    4,   -3,    2,   -2,
         5,   11,    9,   12,   12,    6,   10,    7,
         7,    8,    9,   12,   12,   10,   12,   14,
        10,   14,   10,   21,   17,   17,   18,   18,
        13,   31,   28,   28,   29,   29,   28,   22,
        10,   35,   36,   32,   40,   37,   44,   24,
    ],
  ],

  [ // unit 3: bias -1, output weights 122 (ours) -125 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        35,   40,   33,   52,   53,   58,   64,   61,
        24,   29,   22,   49,   46,   57,   56,   62,
        27,   29,   18,   45,   45,   51,   57,   53,
        26,   29,   17,   28,   40,   43,   55,   45,
        27,   28,   10,   19,   29,   37,   40,   40,
        28,   27,   10,   29,   20,   39,   36,   38,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
         0,   23,   23,   40,   35,   32,   28,   26,
        18,   35,   31,   47,   41,   45,   36,   41,
        25,   24,   43,   40,   55,   45,   48,   32,
        29,   26,   44,   34,   60,   41,   56,   45,
        28,   34,   36,   45,   46,   60,   59,   50,
        20,   33,   30,   55,   38,   55,   44,   58,
        25,   37,   30,   33,   42,   53,   47,   35,
        25,   18,   41,   32,   44,   30,   38,   24,
    ],
    [ // white bishops
        -2,   22,   15,   27,   31,   22,   27,   22,
        18,   17,   32,   26,   36,   34,   41,   25,
        20,   30,   27,   38,   42,   46,   37,   31,
        27,   29,   36,   30,   55,   45,   49,   33,
        24,   32,   35,   43,   38,   50,   35,   41,
        25,   30,   42,   40,   38,   37,   37,   21,
        29,   39,   40,   34,   34,   34,   18,   24,
        39,   39,   29,   31,   32,   30,   15,   12,
    ],
    [ // white rooks
        48,   44,   47,   48,   51,   53,   53,   52,
        52,   45,   50,   49,   52,   49,   50,   49,
        56,   49,   54,   54,   62,   58,   55,   53,
        52,   45,   50,   53,   58,   61,   57,   54,
        51,   45,   48,   49,   57,   57,   59,   53,
        46,   44,   42,   49,   54,   46,   54,   52,
        44,   41,   43,   48,   54,   46,   57,   56,
        33,   37,   39,   44,   46,   37,   59,   52,
    ],
    [ // white queens
        52,   70,   70,   76,   79,   79,   71,   69,
        64,   65,   79,   81,   88,   84,   79,   80,
        71,   74,   82,   85,   92,   97,   87,   88,
        73,   71,   82,   84,   94,   97,   94,   86,
        68,   78,   87,   86,   93,  101,   93,   87,
        73,   76,   89,   87,   95,   89,   89,   80,
        75,   83,   84,   84,   85,   82,   89,   81,
        76,   80,   79,   72,   80,   73,   75,   72,
    ],
    [ // white kings
       -31,  -25,   -9,    0,   15,   23,   26,   10,
       -16,  -17,   -1,   14,   28,   37,   35,   25,
       -12,   -7,    8,   23,   35,   41,   38,   28,
       -17,   -2,    8,   19,   28,   35,   34,   24,
       -24,  -14,   -4,    2,   13,   24,   26,   18,
       -31,  -22,  -13,   -6,    4,   14,   19,   11,
       -26,  -26,  -14,  -14,   -2,    8,    9,    1,
       -25,  -22,  -21,  -21,  -13,   -4,   -7,   -8,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         0,   -8,   15,  -26,    6,  -43,  -27,  -38,
         1,   -7,   19,  -25,   10,  -38,  -26,  -38,
        -6,  -10,   -2,  -12,  -25,  -24,  -42,  -35,
       -15,  -18,  -15,  -20,  -42,  -18,  -47,  -35,
       -24,  -30,  -29,  -28,  -46,  -26,  -52,  -40,
       -35,  -43,  -47,  -55,  -70,  -62,  -66,  -53,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -36,  -23,  -30,  -23,  -24,  -27,  -30,  -48,
       -27,  -26,  -14,  -25,  -24,  -31,  -29,  -29,
       -20,  -22,  -22,  -23,  -19,  -27,  -30,  -40,
       -24,  -18,  -21,  -23,  -27,  -36,  -38,  -37,
       -20,  -23,  -21,  -25,  -39,  -33,  -41,  -28,
       -27,  -26,  -27,  -25,  -38,  -41,  -43,  -33,
       -31,  -33,  -33,  -37,  -37,  -53,  -42,  -44,
       -53,  -41,  -40,  -42,  -37,  -50,  -43,  -62,
    ],
    [ // black bishops
       -43,  -37,  -34,  -33,  -30,  -36,  -31,  -48,
       -34,  -38,  -33,  -21,  -34,  -24,  -30,  -37,
       -31,  -30,  -26,  -36,  -22,  -38,  -32,  -31,
       -33,  -26,  -32,  -37,  -31,  -47,  -39,  -45,
       -31,  -33,  -33,  -32,  -46,  -46,  -50,  -38,
       -41,  -35,  -40,  -33,  -47,  -50,  -43,  -35,
       -37,  -46,  -43,  -44,  -46,  -49,  -54,  -52,
       -54,  -50,  -48,  -47,  -48,  -49,  -51,  -58,
    ],
    [ // black rooks
       -48,  -48,  -37,  -46,  -41,  -49,  -59,  -66,
       -46,  -46,  -36,  -41,  -38,  -39,  -55,  -57,
       -38,  -40,  -31,  -37,  -35,  -27,  -39,  -45,
       -38,  -34,  -32,  -37,  -36,  -37,  -41,  -40,
       -35,  -35,  -38,  -40,  -46,  -47,  -47,  -40,
       -39,  -39,  -46,  -44,  -53,  -50,  -52,  -43,
       -38,  -42,  -45,  -45,  -49,  -53,  -54,  -46,
       -41,  -47,  -48,  -48,  -49,  -48,  -49,  -48,
    ],
    [ // black queens
       -92,  -88,  -79,  -80,  -80,  -82,  -88,  -95,
       -86,  -86,  -81,  -76,  -83,  -73,  -86,  -91,
       -83,  -83,  -75,  -75,  -71,  -74,  -77,  -82,
       -82,  -80,  -78,  -75,  -74,  -80,  -86,  -86,
       -83,  -81,  -78,  -78,  -86,  -90,  -94,  -93,
       -91,  -86,  -88,  -90,  -94,  -98,  -98,  -98,
       -89,  -93,  -94,  -95, -103, -106,  -92,  -95,
       -94,  -99,  -99, -104, -108, -107,  -99, -106,
    ],
    [ // black kings
         2,    0,   -6,    2,  -12,  -14,  -16,  -11,
        12,   12,   10,   11,    3,   -9,  -14,  -11,
        17,   24,   25,   19,   17,   -3,  -10,   -9,
        17,   23,   24,   20,   15,   -2,   -6,   -1,
        18,   18,   19,   15,    7,    3,   -1,    2,
        18,   24,   17,   23,   13,   14,    6,   10,
        23,   25,   25,   22,   17,   20,   10,    9,
        18,   20,   15,   16,   18,   10,    0,    4,
    ],
  ],

  [ // unit 4: bias 10, output weights 127 (ours) -127 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        -4,  -41,  -55,  -52,  -77,  -66,  -77,  -36,
         6,  -14,  -33,  -19,  -40,  -40,  -42,  -14,
        19,   11,    6,    2,   -1,   -6,    2,   10,
        28,   27,   14,   24,   11,   17,   16,   20,
        29,   26,   28,   21,   27,   19,   29,   24,
        31,   22,   22,   21,   24,   24,   26,   27,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -60,   -8,  -15,   -6,  -18,  -46,  -24,  -67,
         6,    4,    2,    1,    5,   -8,    2,  -17,
         7,    6,   11,   11,    5,   -6,   -2,    5,
        25,   20,   24,   25,   16,   25,   22,   18,
        24,   33,   37,   31,   37,   30,   30,   28,
        38,   41,   38,   51,   51,   41,   48,   31,
        32,   41,   46,   46,   44,   53,   44,   43,
        28,   33,   45,   50,   48,   49,   44,   16,
    ],
    [ // white bishops
         7,    2,   12,    3,   16,  -14,   15,   -3,
         9,   11,    3,   13,   -4,   13,  -12,   10,
        17,   13,   11,    3,    6,  -14,   17,    3,
        14,   27,   11,   25,    5,   19,   15,   27,
        25,   18,   32,   21,   37,   14,   33,   15,
         7,   38,   29,   39,   29,   39,   26,   32,
        28,   11,   39,   30,   34,   36,   34,   12,
         5,   29,   17,   43,   33,   33,   20,   15,
    ],
    [ // white rooks
        25,   18,   16,   16,   17,   17,   23,   20,
        40,   32,   31,   33,   28,   21,   20,   28,
        53,   45,   45,   46,   43,   37,   41,   44,
        60,   58,   56,   59,   57,   55,   57,   57,
        59,   57,   60,   59,   61,   62,   58,   55,
        51,   49,   51,   56,   55,   60,   49,   42,
        51,   46,   51,   52,   58,   54,   43,   39,
        30,   38,   38,   40,   42,   37,   33,   25,
    ],
    [ // white queens
        37,   34,   39,   28,   34,   38,   51,   30,
        52,   54,   51,   56,   45,   53,   57,   63,
        65,   62,   73,   65,   72,   56,   71,   47,
        70,   85,   81,   92,   82,   95,   70,   72,
        75,   82,   99,   92,  110,   95,   92,   73,
        70,   78,   91,  103,   98,  105,   88,   83,
        77,   77,   79,   85,   90,   97,   97,   73,
        69,   76,   76,   77,   81,   92,   77,   72,
    ],
    [ // white kings
       -31,  -46,  -39,  -36,  -31,  -39,  -37,  -35,
       -38,  -39,  -44,  -23,  -37,  -30,  -41,  -33,
       -18,  -21,  -14,  -15,   -3,  -24,  -16,  -28,
       -15,    2,    0,   14,    1,    9,  -10,   -9,
         0,    2,   20,   14,   23,    7,   10,   -8,
        -6,   11,    9,   24,   12,   16,    1,    2,
        -2,   -3,   13,    4,   15,    0,    7,   -7,
       -13,   -3,   -6,    4,   -5,    8,   -7,   -5,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         5,   -1,    4,   -4,   -4,    0,   10,    4,
         5,    5,    2,   -2,   -6,    1,    6,    3,
         5,    4,    4,  -10,   14,  -12,   12,    2,
         3,   12,    1,   11,   -1,   -1,    5,    4,
         8,    7,   11,    9,   14,  -12,    7,    0,
        -5,   -2,   -5,    9,  -13,    1,   -2,  -12,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -55,  -52,  -30,  -27,  -33,  -34,  -42,  -62,
       -40,  -33,  -23,  -32,  -20,  -17,  -30,  -45,
       -36,  -24,  -20,   -9,  -10,  -27,  -18,  -32,
       -31,  -23,  -17,   -9,  -12,   -7,  -23,  -36,
       -30,  -25,  -17,  -15,  -16,  -19,  -26,  -31,
       -34,  -35,  -31,  -21,  -30,  -39,  -41,  -39,
       -47,  -42,  -39,  -37,  -38,  -39,  -48,  -46,
       -81,  -63,  -60,  -58,  -51,  -86,  -64, -111,
    ],
    [ // black bishops
       -76,  -14,  -81,   -3,  -60,  -18,  -81,  -35,
       -19,  -71,   -1,  -62,   -7,  -57,  -16,  -77,
       -70,   -2,  -49,    3,  -56,    5,  -58,  -21,
       -13,  -57,   -1,  -47,   11,  -52,   -4,  -66,
       -64,   -4,  -58,   -1,  -48,    2,  -57,  -10,
       -16,  -62,  -12,  -60,   -6,  -72,   -7,  -70,
       -67,  -18,  -70,  -14,  -74,  -10,  -80,  -22,
       -42,  -76,  -24,  -77,  -18,  -86,  -16,  -86,
    ],
    [ // black rooks
       -80,  -64,  -60,  -63,  -64,  -73,  -62,  -80,
       -57,  -54,  -48,  -48,  -51,  -54,  -50,  -59,
       -50,  -48,  -44,  -47,  -48,  -53,  -46,  -57,
       -39,  -38,  -37,  -35,  -40,  -36,  -39,  -43,
       -37,  -38,  -39,  -38,  -36,  -42,  -37,  -40,
       -40,  -43,  -49,  -40,  -51,  -49,  -50,  -44,
       -44,  -53,  -52,  -54,  -57,  -62,  -61,  -52,
       -57,  -62,  -64,  -61,  -64,  -64,  -61,  -63,
    ],
    [ // black queens
      -128, -122, -121, -123, -117, -118, -123, -131,
      -119, -113, -116, -109, -106,  -98, -101, -120,
      -115, -115,  -95,  -95,  -89,  -91,  -96, -112,
      -118, -100,  -91,  -86,  -81,  -84,  -98, -108,
      -105, -101,  -97,  -86,  -89,  -89, -104, -117,
      -109, -104, -100, -104, -102, -110, -116, -127,
      -113, -113, -111, -107, -120, -118, -112, -110,
      -133, -124, -123, -126, -124, -128, -117, -132,
    ],
    [ // black kings
       -12,   -8,  -16,  -13,  -13,   -6,   -6,   -1,
        -5,   -2,    3,    3,    8,    8,    6,    3,
        -3,    9,   14,   18,   16,   19,   14,    3,
        -4,    7,   17,   15,   24,   18,   17,    3,
        -5,    0,    0,   10,    6,   16,    0,   -4,
        -6,  -15,  -10,  -12,    5,  -15,   -3,  -16,
        -8,  -14,  -15,   -3,  -10,   -1,  -19,  -17,
        -9,  -11,   -5,    4,    6,    1,   -7,  -16,
    ],
  ],

  [ // unit 5: bias 25, output weights -82 (ours) 85 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        15,   28,   25,   22,   21,   23,   17,   14,
         4,   18,   20,   11,   13,   17,   11,    1,
         3,   12,   16,   12,   11,   17,   13,    3,
         5,   10,    5,    0,    4,   10,   12,    3,
         4,    3,   -1,   -7,   -5,    3,    7,    4,
         4,    1,   -4,   -6,   -6,   -1,    7,    5,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -32,  -48,  -41,  -38,  -39,  -32,  -52,  -50,
       -42,  -39,  -45,  -45,  -46,  -35,  -39,  -42,
       -48,  -46,  -44,  -50,  -43,  -43,  -45,  -46,
       -49,  -54,  -53,  -52,  -56,  -53,  -53,  -56,
       -55,  -52,  -57,  -57,  -53,  -60,  -51,  -58,
       -63,  -57,  -61,  -61,  -61,  -61,  -60,  -63,
       -60,  -59,  -61,  -62,  -61,  -60,  -60,  -63,
       -60,  -65,  -62,  -64,  -62,  -65,  -63,  -60,
    ],
    [ // white bishops
       -73,  -64,  -58,  -49,  -56,  -52,  -68,  -71,
       -60,  -58,  -59,  -55,  -53,  -57,  -49,  -59,
       -63,  -61,  -58,  -57,  -55,  -50,  -58,  -66,
       -63,  -63,  -59,  -59,  -60,  -60,  -62,  -65,
       -63,  -61,  -63,  -63,  -62,  -63,  -62,  -63,
       -66,  -65,  -67,  -68,  -66,  -69,  -65,  -67,
       -67,  -67,  -69,  -69,  -70,  -65,  -70,  -68,
       -68,  -70,  -69,  -69,  -66,  -66,  -66,  -76,
    ],
    [ // white rooks
       -91,  -93,  -94,  -92,  -90,  -85,  -87,  -89,
       -89,  -90,  -97,  -94,  -93,  -84,  -79,  -84,
       -92,  -94,  -95,  -97,  -92,  -90,  -88,  -90,
       -94,  -97,  -99,  -94,  -96,  -96,  -93,  -95,
       -96,  -98, -101, -101,  -96, -100,  -96, -101,
      -102, -104, -105, -104, -106, -106, -105, -107,
      -105, -106, -108, -108, -109, -109, -106, -107,
      -113, -110, -109, -109, -110, -115, -109, -112,
    ],
    [ // white queens
      -170, -172, -166, -165, -161, -153, -156, -161,
      -178, -179, -180, -174, -172, -163, -166, -168,
      -181, -180, -175, -177, -164, -163, -171, -181,
      -183, -183, -179, -175, -175, -174, -178, -186,
      -187, -184, -183, -182, -180, -183, -183, -186,
      -190, -191, -188, -187, -187, -185, -188, -189,
      -187, -190, -192, -192, -192, -189, -186, -183,
      -191, -191, -192, -194, -191, -192, -184, -184,
    ],
    [ // white kings
       -36,  -31,  -36,  -51,  -46,  -44,  -31,  -38,
       -30,  -14,  -20,  -23,  -31,  -25,  -32,  -29,
       -16,   -6,   -1,   -5,  -10,   -9,  -12,  -15,
        -8,    1,    5,    9,    5,    3,    0,   -3,
        -1,    3,    8,   10,   12,   10,    7,    4,
         4,    4,    7,   10,   10,    9,    8,    6,
         5,    5,    4,    6,    7,    5,    3,    2,
         4,    6,    6,    2,    2,    2,    1,   -2,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        25,   25,   22,   23,   21,   28,   36,   27,
        24,   27,   23,   18,   21,   27,   35,   25,
        26,   32,   25,   25,   25,   30,   38,   25,
        29,   37,   32,   34,   30,   37,   41,   28,
        44,   53,   41,   41,   40,   40,   48,   39,
        66,   68,   49,   49,   45,   45,   49,   58,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        52,   60,   61,   60,   64,   60,   66,   56,
        60,   64,   68,   68,   72,   70,   67,   61,
        63,   71,   73,   76,   74,   76,   75,   68,
        73,   77,   81,   82,   86,   81,   85,   76,
        76,   80,   84,   87,   87,   90,   88,   82,
        77,   84,   88,   88,   95,   94,   92,   89,
        80,   85,   86,   92,   89,   95,   89,   84,
        73,   75,   85,   90,   88,   96,   67,   52,
    ],
    [ // black bishops
        72,   72,   70,   71,   73,   75,   72,   63,
        73,   75,   77,   75,   74,   75,   73,   71,
        75,   78,   85,   80,   80,   80,   81,   75,
        75,   82,   85,   87,   87,   84,   83,   80,
        76,   80,   86,   88,   92,   89,   84,   79,
        77,   81,   86,   88,   92,   97,   89,   80,
        78,   82,   83,   88,   90,   83,   95,   81,
        68,   78,   84,   91,   84,   90,   71,   68,
    ],
    [ // black rooks
       107,  112,  112,  113,  112,  109,  120,  110,
       115,  116,  113,  113,  113,  114,  118,  116,
       121,  121,  119,  119,  119,  121,  123,  120,
       127,  126,  125,  124,  129,  130,  134,  130,
       129,  128,  126,  129,  130,  133,  139,  136,
       131,  129,  127,  127,  132,  137,  140,  138,
       134,  133,  128,  132,  133,  139,  143,  140,
       132,  130,  129,  132,  133,  137,  136,  133,
    ],
    [ // black queens
       204,  203,  202,  202,  204,  200,  210,  209,
       207,  206,  205,  206,  206,  206,  208,  212,
       208,  207,  213,  214,  214,  215,  213,  210,
       212,  217,  219,  224,  223,  221,  219,  217,
       220,  219,  226,  229,  232,  230,  226,  217,
       222,  226,  231,  232,  238,  240,  232,  221,
       227,  227,  227,  234,  234,  239,  239,  232,
       236,  237,  241,  244,  245,  251,  248,  243,
    ],
    [ // black kings
       -10,   -5,   -4,   -5,   -4,   -4,   -6,  -11,
        -4,   -2,    1,    6,    6,    5,    1,   -3,
        -1,    4,   10,   14,   15,   16,   12,    7,
        -5,    3,   13,   18,   20,   21,   16,    9,
       -13,    4,   11,   16,   20,   19,   14,    5,
       -16,    4,   15,   14,   15,   21,   12,   -5,
       -31,  -14,  -11,   -9,   -6,   -4,   -2,  -25,
       -42,  -23,  -26,  -36,  -29,  -25,  -22,  -50,
    ],
  ],

  [ // unit 6: bias 21, output weights 92 (ours) -89 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       110,  107,   45,   51,   30,   34,   31,   35,
       106,  100,   36,   36,   17,    3,    8,   10,
        78,   81,   27,   27,    2,   -6,    5,   10,
        55,   51,   16,    9,    3,   -5,    5,   12,
        34,   30,   14,    6,    1,    2,   12,   17,
        24,   21,   23,   11,    1,   11,   18,   19,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
        34,   21,   23,   23,    8,   14,   -1,    4,
        13,   24,   20,   25,   20,   16,    8,   -3,
        20,   15,   34,   21,   20,    5,   10,   -5,
        19,   22,   33,   20,   21,    9,   11,   -5,
        23,   30,   29,   22,   13,    4,    3,  -10,
         8,   30,   14,   20,    3,    8,   -2,   -5,
         3,   19,   20,   11,    7,    4,   -5,   -3,
         8,   -8,   17,    3,    8,   -2,   -9,   -2,
    ],
    [ // white bishops
        12,   25,   20,   19,   19,   15,    3,  -10,
        18,   35,   33,   21,   17,   14,    6,   -6,
        11,   34,   39,   27,   12,   14,    8,    9,
        13,   32,   38,   26,   26,   15,   17,   11,
        12,   26,   30,   30,   23,   29,   13,    9,
         6,   18,   29,   26,   27,   29,   25,    9,
        -8,   21,   20,   21,   24,   30,   30,   21,
         0,    3,    7,   16,   20,   26,   25,   18,
    ],
    [ // white rooks
        22,   26,   34,   31,   29,   27,   28,   28,
        16,   28,   33,   30,   27,   22,   25,   26,
        16,   29,   35,   34,   32,   29,   30,   33,
        25,   38,   40,   38,   31,   31,   28,   28,
        40,   40,   43,   39,   34,   30,   29,   27,
        41,   37,   33,   34,   32,   25,   23,   19,
        42,   36,   31,   31,   28,   20,   17,   15,
        37,   33,   29,   30,   28,   18,   21,   -1,
    ],
    [ // white queens
        48,   57,   57,   61,   57,   54,   50,   45,
        46,   56,   74,   75,   73,   63,   60,   45,
        44,   66,   78,   83,   74,   73,   65,   55,
        51,   67,   83,   79,   74,   72,   65,   60,
        54,   71,   73,   75,   68,   65,   60,   55,
        52,   56,   70,   61,   64,   61,   57,   43,
        50,   56,   59,   56,   55,   59,   50,   35,
        50,   51,   48,   50,   53,   50,   53,   32,
    ],
    [ // white kings
        28,   49,   40,   26,    9,   -6,  -22,  -51,
        35,   49,   47,   28,   12,   -7,  -22,  -27,
        35,   45,   46,   31,   12,   -1,  -19,  -19,
        37,   44,   44,   29,    8,   -6,  -15,  -24,
        33,   41,   38,   21,    1,  -11,  -21,  -29,
        26,   33,   29,   15,   -1,  -15,  -24,  -32,
        13,   22,   20,    8,   -3,  -15,  -22,  -24,
        -8,    5,   10,    4,  -10,  -13,  -18,  -24,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       -85,  -80,  -18,  -17,    2,    8,   10,    4,
       -85,  -69,   -6,  -13,   -1,    4,    6,    4,
       -69,  -36,  -11,   -6,  -11,    2,   -2,    0,
       -60,  -19,  -15,  -14,  -16,   -9,  -14,   -9,
       -61,  -26,  -11,  -21,  -37,  -27,  -35,  -24,
       -82,  -54,  -25,  -32,  -50,  -40,  -42,  -34,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -46,  -22,  -19,  -14,  -13,   -9,   -3,  -17,
       -17,  -20,  -20,  -20,  -11,   -7,   -7,  -10,
       -21,  -21,  -15,  -12,  -10,  -14,   -8,   -9,
       -13,  -17,  -18,  -11,   -8,   -4,   -5,   -3,
       -10,  -17,  -11,  -10,  -14,    3,   -6,   -2,
        -8,  -10,   -8,   -6,    3,    0,   -3,    1,
       -14,  -10,   -4,   -5,   -3,    3,    5,   -4,
       -21,   -3,   -2,   -6,   -5,  -22,  -17,  -36,
    ],
    [ // black bishops
       -41,  -46,  -27,  -31,  -12,  -25,  -24,  -38,
       -44,  -36,  -39,  -18,  -27,  -18,  -32,  -30,
       -31,  -42,  -30,  -30,  -22,  -34,  -26,  -22,
       -39,  -34,  -33,  -33,  -22,  -25,  -19,  -22,
       -26,  -30,  -27,  -28,  -28,  -22,  -20,  -23,
       -24,  -23,  -30,  -21,  -30,  -28,  -30,  -23,
       -29,  -29,  -27,  -27,  -30,  -40,  -40,  -37,
       -39,  -29,  -26,  -32,  -37,  -41,  -49,  -58,
    ],
    [ // black rooks
       -49,  -45,  -35,  -42,  -44,  -42,  -50,  -39,
       -48,  -42,  -34,  -41,  -44,  -42,  -49,  -52,
       -50,  -44,  -41,  -45,  -48,  -43,  -44,  -44,
       -49,  -52,  -45,  -46,  -40,  -41,  -36,  -36,
       -54,  -51,  -45,  -37,  -35,  -30,  -32,  -29,
       -49,  -47,  -40,  -35,  -29,  -23,  -22,  -24,
       -47,  -46,  -37,  -35,  -33,  -23,  -24,  -25,
       -45,  -45,  -38,  -38,  -37,  -30,  -33,  -32,
    ],
    [ // black queens
       -57,  -59,  -55,  -60,  -59,  -55,  -63,  -75,
       -58,  -57,  -62,  -61,  -65,  -60,  -64,  -73,
       -58,  -59,  -65,  -66,  -68,  -71,  -64,  -62,
       -59,  -65,  -68,  -70,  -67,  -67,  -62,  -62,
       -56,  -66,  -70,  -67,  -65,  -63,  -64,  -62,
       -59,  -64,  -71,  -72,  -69,  -61,  -60,  -60,
       -62,  -68,  -71,  -72,  -70,  -66,  -55,  -54,
       -69,  -66,  -73,  -72,  -73,  -64,  -60,  -59,
    ],
    [ // black kings
       -64,  -46,  -32,  -12,   11,   21,   26,   29,
       -60,  -56,  -35,   -9,    6,   19,   26,   28,
       -44,  -52,  -27,   -7,    8,   14,   21,   22,
       -16,  -33,  -19,   -3,    8,   10,   12,   11,
        -3,   -8,  -11,   -1,    6,    5,    4,    2,
         4,    4,   -3,    4,    3,    9,    3,    0,
        -3,    1,    5,    4,    1,    6,    3,   -3,
       -12,   -1,    2,    1,   -6,  -10,   -9,  -21,
    ],
  ],

  [ // unit 7: bias -63, output weights 127 (ours) -115 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       -35,  -37,  -39,  -32,  -31,  -25,  -17,  -40,
       -22,  -19,  -25,  -14,   -6,  -12,  -32,  -37,
       -11,  -10,  -13,   -8,   -7,  -14,  -18,  -25,
        -4,  -11,  -13,   -9,  -17,  -23,  -20,  -13,
         0,  -12,  -12,  -14,  -21,  -30,  -21,  -11,
         1,   -8,  -10,  -12,  -17,  -26,  -11,   -8,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -63,  -46,  -35,  -20,  -11,  -28,  -16,    0,
       -66,  -43,  -41,  -20,  -13,  -23,  -21,  -24,
       -67,  -64,  -41,  -30,  -21,  -21,  -41,  -13,
       -58,  -60,  -45,  -37,  -37,  -11,  -34,  -16,
       -63,  -61,  -50,  -44,  -30,  -39,  -24,  -32,
       -67,  -55,  -58,  -49,  -39,  -50,  -28,  -47,
       -69,  -62,  -59,  -53,  -47,  -47,  -49,  -41,
       -67,  -66,  -60,  -55,  -65,  -46,  -50,  -45,
    ],
    [ // white bishops
       -74,  -63,  -45,  -37,  -33,  -26,  -43,  -47,
       -61,  -58,  -54,  -46,  -34,  -33,  -32,  -34,
       -63,  -57,  -53,  -44,  -34,  -19,  -44,  -38,
       -54,  -58,  -44,  -46,  -34,  -32,  -36,  -39,
       -55,  -46,  -51,  -39,  -37,  -48,  -49,  -38,
       -47,  -48,  -46,  -41,  -48,  -57,  -55,  -51,
       -47,  -45,  -40,  -46,  -62,  -58,  -58,  -60,
       -50,  -39,  -48,  -53,  -59,  -63,  -66,  -71,
    ],
    [ // white rooks
       -80,  -78,  -70,  -63,  -53,  -45,  -42,  -31,
       -77,  -83,  -74,  -65,  -57,  -39,  -62,  -38,
       -82,  -80,  -72,  -64,  -43,  -42,  -41,  -30,
       -88,  -83,  -79,  -69,  -59,  -49,  -40,  -33,
       -91,  -87,  -81,  -75,  -67,  -56,  -43,  -33,
       -92,  -88,  -83,  -78,  -72,  -54,  -44,  -37,
       -99,  -96,  -93,  -91,  -84,  -64,  -49,  -45,
       -92,  -95,  -94,  -89,  -84,  -74,  -41,  -67,
    ],
    [ // white queens
       -73,  -60,  -52,  -43,  -27,  -22,  -22,  -23,
       -72,  -64,  -49,  -41,  -20,    0,  -16,   -9,
       -80,  -64,  -54,  -39,  -11,    0,    1,   -4,
       -72,  -62,  -47,  -38,  -16,  -11,   -4,   -9,
       -73,  -58,  -47,  -39,  -28,  -24,  -17,  -11,
       -67,  -61,  -45,  -39,  -38,  -30,  -26,  -15,
       -65,  -54,  -50,  -46,  -44,  -34,  -26,  -24,
       -63,  -56,  -50,  -47,  -49,  -47,  -41,  -32,
    ],
    [ // white kings
      -177, -133, -173, -111,  -95, -175, -157, -176,
      -140,  -97,  -93,  -76,  -45,  -66, -129, -136,
      -106,  -92,  -79,  -51,  -18,  -36,  -51,  -54,
       -75,  -73,  -70,  -51,  -37,  -26,  -43,  -35,
       -63,  -62,  -61,  -59,  -45,  -35,  -31,  -16,
       -27,  -30,  -43,  -42,  -37,  -27,  -21,   -6,
        -5,   -8,  -20,  -19,  -20,  -20,   -7,    1,
        -1,    3,   -1,  -19,  -15,  -16,   -4,    3,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        25,   22,   23,   18,   15,   18,  -35,   -7,
        27,   24,   29,   14,   23,   11,  -32,    1,
        22,   28,   19,   18,   22,    0,   -8,    5,
        23,   33,   19,   29,   24,    1,    6,   11,
        27,   34,   26,   30,   27,   16,   22,   22,
        24,   32,   18,   25,   10,   16,   15,   27,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        66,   63,   63,   62,   51,   44,   43,   35,
        74,   68,   67,   55,   44,   40,   38,   38,
        69,   62,   69,   52,   55,   43,   38,   38,
        72,   73,   66,   53,   50,   43,   46,   34,
        73,   73,   66,   62,   42,   36,   38,   41,
        79,   80,   70,   64,   51,   40,   42,   43,
        77,   71,   73,   65,   51,   51,   55,   57,
        15,   85,   80,   69,   79,   61,   83,    0,
    ],
    [ // black bishops
        60,   48,   61,   55,   62,   41,   50,   46,
        58,   63,   52,   63,   54,   54,   46,   49,
        65,   61,   66,   52,   56,   51,   37,   41,
        66,   69,   62,   60,   42,   49,   49,   43,
        72,   66,   69,   57,   47,   43,   53,   52,
        65,   70,   64,   59,   56,   61,   58,   55,
        62,   54,   53,   60,   59,   59,   73,   56,
        46,   65,   68,   78,   80,   89,   73,   60,
    ],
    [ // black rooks
       107,  112,  111,  108,  106,  100,   57,   81,
       112,  112,  111,  107,  103,   87,   61,   51,
       112,  114,  107,  102,   97,   84,   73,   72,
       115,  112,  106,  100,   93,   83,   76,   79,
       112,  111,  106,  102,   92,   81,   78,   82,
       112,  110,  108,  104,   94,   88,   90,   91,
       114,  112,  110,  106,   96,   94,  101,   96,
       119,  118,  116,  114,  106,   99,   97,  100,
    ],
    [ // black queens
       137,  132,  135,  124,  131,  132,  116,  114,
       137,  137,  129,  131,  124,  123,  109,  108,
       141,  132,  134,  124,  127,  116,  116,  109,
       140,  142,  136,  127,  118,  118,  112,  116,
       147,  142,  138,  132,  124,  110,  109,  114,
       147,  147,  139,  137,  127,  112,  113,  118,
       147,  142,  138,  135,  128,  118,  134,  131,
       130,  137,  133,  131,  124,  123,  129,  133,
    ],
    [ // black kings
      -227, -130,  -76,  -43,  -15,   -5,   -5,  -11,
      -228, -120,  -69,  -35,   -9,    9,    2,   -1,
      -259,  -93,  -30,   -5,   10,   15,    3,    7,
      -117,  -64,  -27,  -10,    1,   -2,    4,    6,
      -182,  -90,  -47,  -31,  -25,  -23,  -14,   -4,
      -198, -157,  -91,  -57,  -46,  -40,  -28,  -27,
      -198, -179, -160, -107,  -77,  -58,  -57,  -63,
      -159, -171, -126,  -99,  -97,  -89,  -80, -132,
    ],
  ],

  [ // unit 8: bias 9, output weights 76 (ours) -75 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
       -14,   -1,    6,    3,   -9,  -30,   -7,    4,
        -2,    2,   10,    7,   -2,   -4,  -21,   -6,
        15,   20,   13,   14,    9,   -1,  -13,   -4,
        20,   29,   13,   15,    3,   -3,  -10,   -7,
        26,   27,   16,    3,    7,  -13,   -3,   -2,
        20,   30,   14,   -3,    2,  -10,   -3,   -1,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
        -9,    9,    8,   -5,    0,  -19,    0,  -21,
        33,   18,   22,    8,   -8,   -1,  -13,   -6,
        27,   40,   20,   15,    6,   -2,   -5,  -21,
        34,   24,   15,   10,    1,  -17,   -7,  -11,
        24,   25,   20,    6,    4,  -14,   -8,  -13,
        26,   21,   24,    9,    9,   -2,   -1,  -11,
        19,   24,   24,   17,    4,    2,   -4,    9,
        21,   20,   18,   17,   10,    9,   -1,   -5,
    ],
    [ // white bishops
         1,    2,   -5,    2,    2,   -8,    1,  -10,
        15,   12,   14,    7,   11,   -8,    3,   -9,
        15,   23,   17,   24,    8,    0,   -3,   -4,
        22,   13,   15,    5,    0,   -7,    2,   -6,
        19,   20,    2,    5,    1,    5,   -3,    5,
        25,   15,    7,    6,   11,    5,   13,   10,
        18,   15,   17,   14,   11,   12,   26,   28,
         4,   14,   16,    9,    5,    6,   18,   16,
    ],
    [ // white rooks
         9,    8,   -2,    3,    5,    1,    0,    1,
         0,   -4,  -13,   -9,  -13,  -14,  -17,  -19,
         3,    3,   -9,   -9,   -6,  -15,  -11,  -13,
         5,    6,   -4,   -6,  -10,  -14,  -10,   -4,
         2,    8,    3,    2,   -5,   -6,   -7,    2,
         0,    6,    6,    6,    6,    2,    4,    7,
       -10,   -8,   -1,    4,    4,    2,   -1,   -5,
        -5,   -5,    1,    6,   10,    5,   -4,    6,
    ],
    [ // white queens
         7,    5,    0,   -1,  -10,   -3,    5,    5,
        17,   13,    4,   -2,  -15,  -19,  -13,    1,
        19,   15,   11,   10,  -10,  -12,   -8,   -1,
        22,   22,   13,    7,    1,   -8,   -4,   10,
        20,   23,   20,   14,   11,    9,   11,   13,
        22,   24,   22,   24,   21,   17,   19,   25,
         7,   16,   26,   22,   28,   29,   28,   29,
         1,   11,   18,   23,   23,   25,   26,   22,
    ],
    [ // white kings
        21,   39,   33,   12,  -10,  -38, -138, -124,
        41,   53,   52,   28,   -1,  -38,  -52, -170,
        39,   55,   49,   32,    1,  -45,  -85, -136,
        38,   45,   38,   17,   -4,  -47, -124, -185,
        39,   42,   28,   12,  -14,  -59,  -82, -201,
        45,   42,   28,   10,   -8,  -38,  -53,  -63,
        49,   40,   23,    4,   -8,  -28,  -33,  -36,
        51,   37,   22,   -1,   -4,  -28,  -21,  -26,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        12,    5,  -20,    1,   12,   -1,   13,   -5,
         8,    2,  -28,  -10,   14,   -9,   10,   -7,
        10,    0,  -26,  -19,    2,  -21,    9,  -11,
         9,   -2,  -12,   -7,   -5,  -36,   -7,  -26,
        19,   32,   19,   14,   -4,  -45,  -21,  -34,
        40,   57,   36,   14,  -13,  -55,  -20,  -29,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -16,   -6,    1,    6,    4,   10,    8,    3,
        -8,   -1,   -1,    2,    3,   10,   12,   12,
        -4,   -9,    1,    5,   12,    3,   12,   14,
       -13,   -4,   -3,    7,   12,   12,   25,   13,
       -19,   -9,   -8,    3,   11,    8,   19,    7,
       -11,  -19,  -11,   -3,   -6,    4,    6,    6,
       -10,    6,   -9,   -2,    1,  -16,    0,    7,
        17,   19,   11,   16,    3,   17,    1,   12,
    ],
    [ // black bishops
       -12,    1,    9,    2,   -8,    1,  -19,   -7,
        -8,  -11,    1,    0,   -3,  -11,   -9,  -13,
        -6,   -2,   -6,    5,   -3,    0,  -12,   -4,
        -7,   -8,    0,   -4,    2,   -3,    3,   -4,
       -14,   -9,  -15,   -3,    5,    0,    6,    6,
       -15,  -23,  -10,  -13,    0,   -5,    2,   -5,
        -2,  -10,  -13,   -2,   -3,   -6,   -7,   -6,
        -3,   -7,   -3,    7,    3,    9,   -3,   -1,
    ],
    [ // black rooks
        28,   20,   14,   20,   26,   26,   35,    3,
        25,   22,   13,   20,   27,   19,   24,   18,
        25,   19,   19,   22,   30,   22,   21,   12,
        22,   19,   16,   20,   25,   23,   23,    9,
        26,   14,   12,   16,   24,   18,   21,    7,
        27,   13,    7,   12,   16,   17,   19,   14,
        23,   13,    5,    9,   15,    9,   18,   10,
        23,   17,    7,   11,   16,   17,   21,   15,
    ],
    [ // black queens
         2,   14,   18,   15,   17,    7,    5,   -2,
         7,   15,   10,   17,   14,    8,   11,   -3,
         7,    9,   18,   20,   24,   16,   12,    5,
         2,    5,   13,   21,   19,   22,   17,   12,
         3,    3,    3,   12,   26,   25,   28,   12,
         1,   -4,  -12,    1,   23,   29,   21,   20,
         1,    2,   -3,    6,   20,   17,   29,   23,
         5,   -5,   -4,    0,   16,   19,   20,   18,
    ],
    [ // black kings
       -21,  -26,  -18,    0,  -11,    3,  -10,  -18,
       -16,   -5,   -3,    6,    3,    8,    6,   -2,
         4,   10,    6,   12,   19,   23,   20,   10,
         7,    4,    8,   15,   28,   35,   38,   25,
        -5,  -13,   -6,   14,   34,   52,   49,   34,
       -25,  -35,  -25,   11,   43,   58,   59,   38,
       -29,  -27,  -31,    5,   33,   47,   47,   35,
       -29,  -28,  -24,  -11,   16,   31,   37,   24,
    ],
  ],

  [ // unit 9: bias 63, output weights 44 (ours) -42 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         4,   23,   31,   38,   63,   47,   54,   30,
        -6,   24,   22,   28,   57,   21,   28,   23,
         8,   18,   21,   26,   53,    9,   27,   21,
         6,   23,    9,   26,   20,   18,   19,   20,
         6,   20,   -1,   24,    3,    9,    8,   21,
         9,   20,    5,   21,    6,    7,   13,   19,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -20,   -2,    5,    3,   13,   13,   15,  -19,
         0,   -1,   22,    5,   35,   14,   34,   -2,
        -1,   13,    0,   13,    5,   12,    8,   21,
       -10,   -2,    0,   31,   -5,   27,    3,    8,
       -11,    7,   -1,   12,   11,   15,    2,   -1,
       -24,  -19,    9,  -15,   24,  -16,   13,  -14,
       -17,  -17,  -12,  -11,   -6,  -10,   -9,  -28,
       -26,  -18,  -29,   -6,  -34,   -8,  -19,  -20,
    ],
    [ // white bishops
       -28,  -23,   -5,    0,  -15,    0,   -4,  -14,
       -19,   -8,  -13,    7,    2,   11,    0,   -4,
       -11,   -8,    5,    2,    2,   -5,    3,   -6,
        -4,   -7,    1,   26,   -6,    4,    9,   -7,
        -4,   -5,   14,   13,    4,    0,    9,    1,
       -11,    8,    2,   -6,    0,  -17,   -5,    8,
         4,   -6,  -11,   -7,  -14,  -10,  -16,  -18,
        -6,  -23,  -11,  -21,  -17,  -21,  -28,  -37,
    ],
    [ // white rooks
        19,   11,   14,   18,   24,   22,   16,   16,
        18,    6,    9,   15,   16,   23,   16,   18,
        22,   12,   15,   16,   10,   20,   23,   24,
        12,    1,    9,   12,   22,   11,   18,   16,
        -4,   -7,   -9,    3,    8,    5,   -1,   -5,
        -7,   -9,  -14,   -7,    1,    0,   -6,  -13,
        -9,   -4,  -15,   -6,   -4,    6,   -2,   -8,
       -13,   -4,  -12,   -6,   -1,   -3,    2,    0,
    ],
    [ // white queens
        17,   11,   27,   25,   32,   23,   28,   14,
        16,   15,   19,   40,   43,   39,   26,   27,
        15,   24,   29,   37,   53,   41,   31,   16,
        16,   14,   31,   50,   38,   40,   22,   16,
         6,   11,   25,   29,   25,   19,   19,    9,
         2,   14,   14,   14,    6,   12,   10,   16,
        14,    5,    8,    6,   -3,   11,    8,    1,
         0,    4,   -4,    1,    2,    5,    0,    4,
    ],
    [ // white kings
        -8,   10,   24,   39,   29,   35,   28,    7,
        -5,   18,   35,   47,   40,   31,   17,    7,
        -3,   13,   38,   46,   42,   16,   15,    1,
        -5,   14,   30,   45,   36,   20,   18,    4,
        -1,   12,   24,   35,   34,   27,   19,    8,
        -7,    3,   15,   18,   13,   13,   10,   -1,
       -15,   -5,    7,    8,    4,    4,    3,    3,
       -21,  -14,    0,   -5,    2,   -6,    2,   -4,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        16,   -8,  -15,   15,  -90,  -12,   -9,   -9,
        18,   -6,  -22,    3, -224,  -10,  -15,   -7,
        11,   -9,    5,  -20,  -20,  -16,   -5,  -12,
         4,  -12,    8,  -31,    6,  -32,    4,  -24,
         1,  -18,   14,  -26,   10,  -38,  -10,  -29,
       -12,  -48,   -7,  -39,  -13, -105,  -31,  -68,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
         4,   28,   17,    1,    4,    4,   15,   16,
        30,   15,    1,   15,   23,   15,   -7,    4,
        16,   17,   20,    8,   -6,    7,   20,   15,
        30,   20,    7,   22,    9,   21,   10,    1,
        22,   21,   22,   18,   12,   15,   17,   23,
        23,   25,   26,   21,   21,   25,   25,   21,
        23,   23,   24,   27,   25,   21,   26,   16,
        15,   20,   26,   26,   25,   22,   20,   -6,
    ],
    [ // black bishops
        24,   11,  -24,    8,   -5,   19,  -16,    5,
        18,   14,    6,  -23,   18,  -18,   14,   13,
        12,   13,    9,    5,  -25,   13,    7,   11,
        12,   10,    5,   16,  -10,    4,    8,   12,
         9,    9,    5,    6,    9,    7,    1,    8,
         8,    4,   13,    3,   18,    9,   11,   -1,
        -2,    9,    9,   12,   10,    8,    9,   -4,
         0,   -2,    7,    8,   11,    7,    7,   -2,
    ],
    [ // black rooks
        17,   12,   25,   15,  -16,   -5,   19,   12,
        15,    9,   23,   19,  -16,    6,   10,    5,
        12,   10,   15,   11,   -1,   -6,   -3,   -1,
        20,   20,   19,   27,    5,   22,   15,   18,
        24,   26,   22,   15,   18,   17,   22,   23,
        25,   27,   24,   21,   20,   19,   28,   27,
        23,   27,   21,   21,   18,   16,   22,   23,
        24,   23,   24,   25,   24,   19,   22,   23,
    ],
    [ // black queens
        30,   33,   18,   16,    9,   16,   16,   16,
        26,   26,   24,    6,    7,   13,   19,   20,
        18,   19,   20,   11,    4,   11,   15,   17,
        23,   23,   20,   30,   13,   20,   18,   20,
        21,   22,   23,   25,   22,   23,   25,   19,
        17,   25,   23,   27,   35,   30,   36,   17,
        16,   24,   29,   29,   33,   25,   40,   37,
        28,   28,   27,   26,   25,   24,   37,   39,
    ],
    [ // black kings
        -3,   -3,    0,   -1,    7,    4,    9,    0,
         2,    9,    3,    7,   13,    8,    7,   10,
        11,   14,    9,    3,  -11,    8,   14,   11,
         5,   19,    8,   11,   -1,   17,   13,   21,
         7,   13,   16,    5,   18,   17,   27,   21,
         6,   16,   18,   14,   28,   25,   35,   25,
         3,    9,   18,   11,   31,   25,   46,   21,
       -17,   -3,   -5,    7,   13,   31,   45,    6,
    ],
  ],

  [ // unit 10: bias -32, output weights 65 (ours) -64 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        -3,  -11,   -8,  -15,    1,  -31,   13,  -51,
         9,    2,   -1,   10,    3,   -4,  -21,  -53,
         8,    4,   10,   12,    1,   -6,   -7,  -35,
         3,   10,   -1,   -1,    7,   -5,   -1,  -15,
         3,    4,   -3,   -8,   -1,   -7,    5,   -2,
         2,    5,   -2,   -5,   -8,  -10,   11,   -3,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -31,   -2,  -11,  -12,  -12,  -25,  -11,  -28,
         5,   -2,    0,   -5,   -5,   12,    2,   10,
         2,   10,    5,   11,   14,   -7,   11,   20,
        11,    3,    7,    5,   10,   -3,    0,   32,
        -1,    3,    4,    9,   -1,   14,   -5,   20,
         2,    7,   -1,   13,    6,    7,   11,    8,
        -8,    4,    2,    8,    9,   -4,   14,    1,
        -9,   -3,    4,    1,    9,   -1,    9,  -14,
    ],
    [ // white bishops
       -10,   -4,  -11,   -8,   -6,   -9,   -5,  -22,
        -1,   -4,    3,   -3,    3,   -9,   -4,    5,
         3,    6,    7,   20,    6,   -8,   -8,   36,
        10,    4,   11,    0,    9,   -8,    0,   26,
         4,   12,   -2,    4,    0,    5,    1,   17,
        10,    5,   10,    2,    6,    5,   11,   13,
         3,   12,    5,    8,    4,   18,   10,   16,
         7,   -6,   -1,    0,   12,    3,    7,   10,
    ],
    [ // white rooks
        12,   10,   13,   11,   11,   11,    5,   27,
        12,    7,   13,    9,   11,    5,  -13,   44,
         9,    9,    9,    9,    8,    8,    3,   43,
        10,    4,    8,    5,    8,    7,   11,   32,
        10,    6,    6,    5,    8,    8,   11,   10,
        12,   10,    8,    8,   10,   10,   13,   -6,
         6,    4,    8,    9,    9,    5,    3,  -36,
         5,    2,    7,    7,    9,    3,   -1,  -27,
    ],
    [ // white queens
        35,   41,   36,   34,   30,   35,   32,   26,
        51,   44,   48,   44,   45,   24,   27,   48,
        48,   50,   49,   46,   47,   49,   31,   43,
        49,   43,   50,   44,   53,   44,   36,   33,
        46,   50,   44,   44,   50,   47,   42,   27,
        53,   41,   52,   46,   49,   50,   48,   30,
        49,   50,   44,   41,   47,   52,   44,    8,
        48,   42,   37,   41,   48,   48,   37,    7,
    ],
    [ // white kings
       -14,   -7,    3,    9,   12,    4,   -1,    4,
       -18,  -10,    0,    6,   13,   16,    7,   15,
       -28,  -17,  -12,    2,    8,    7,   10,   21,
       -29,  -22,  -16,   -8,    1,   -1,    9,   14,
       -30,  -27,  -19,  -10,   -3,   -4,   -3,   15,
       -28,  -17,  -16,  -10,   -3,   -4,  -10,    9,
       -17,  -16,  -11,  -13,   -4,   -4,   -4,   14,
       -16,  -12,  -13,  -14,   -3,   -5,    7,   19,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         9,   -4,    8,  -11,   14,    6,   -3,   98,
         4,    1,    8,  -13,   -2,    3,  -17,   99,
         2,   -1,    5,  -14,  -12,   14,  -21,   95,
        -3,    6,    0,   -4,   -7,   25,  -25,   91,
        -5,   10,    1,    3,   -1,   22,  -40,   98,
         0,    2,  -13,  -16,  -14,   -3,   -3,   91,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        12,    5,   10,   14,    5,   11,   19,  -21,
        13,   12,   13,    2,   10,   10,    8,   11,
        13,    5,    8,   12,   14,    3,    5,   11,
        10,   14,   11,    8,   12,    6,   12,    2,
         7,    8,   15,    6,    4,   14,    0,   13,
         3,    3,   10,    6,   -4,   -1,  -16,    3,
        -1,    9,   -1,    4,   -1,  -11,    5,    0,
         2,    8,   14,   10,   -2,  -16,  -10,    9,
    ],
    [ // black bishops
        -7,    0,   -3,    5,   -7,   23,   -3,  -20,
         4,   -7,   -2,    1,    2,   -8,    0,   -1,
        -2,    3,    2,    1,    1,   -6,   -1,    1,
         7,    0,    4,   -2,   -1,    2,    0,   -3,
        -1,    5,    2,    4,   -2,    5,   -2,    4,
        -2,    4,    2,   -3,   -1,    1,  -16,  -12,
        -6,    2,    2,    4,   -4,   -4,  -13,   -5,
        -3,   -4,    5,   -1,    2,   -7,  -15,    5,
    ],
    [ // black rooks
        -5,    3,    6,    3,    5,   -6,    6,   56,
         5,    8,    6,    6,   10,    6,   -4,   49,
         7,    9,   12,    9,   12,   15,    2,   34,
         7,   11,   12,   11,   14,   21,    7,   30,
        10,   14,   11,   10,   15,   19,    5,   27,
        10,   12,    6,    7,   11,   10,    6,   19,
         5,    7,    1,    1,    1,   -3,    2,    8,
         5,    3,   -1,    1,    4,    2,   -3,   11,
    ],
    [ // black queens
       -17,  -18,  -10,  -22,  -14,  -12,  -21,    6,
       -16,  -12,  -18,  -10,  -12,   -7,  -29,    3,
       -18,  -19,   -2,   -7,   -1,  -11,  -12,   -9,
       -21,   -6,   -4,   -1,   -6,    4,  -14,   -1,
       -11,   -6,   -2,   -5,    2,   -1,  -10,   -2,
       -18,   -9,  -15,  -10,    3,   -7,  -11,    0,
       -18,  -19,  -14,  -10,  -11,   -3,   -7,    5,
       -12,  -12,  -19,  -14,  -25,  -10,  -18,   -1,
    ],
    [ // black kings
       -20,  -17,  -16,    1,  -13,    7,   -7,  -27,
        -7,   -3,    4,    4,    1,   -6,    8,   -8,
         6,   10,   12,    9,    4,    1,    8,    5,
        12,   13,   17,   11,    9,    9,   12,    6,
         7,   15,   19,   16,   16,   17,    5,   -6,
         2,   15,   19,   25,   20,   17,  -15,    8,
         1,   10,   16,   16,   19,    4,  -25,   25,
        -1,    7,   14,   12,   14,    9,    6,   28,
    ],
  ],

  [ // unit 11: bias 1, output weights -68 (ours) 68 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         9,   -2,   -9,  -66,   -2,  -27,   17,   -1,
        12,    6,   12, -101,   47,  -23,   20,    3,
        15,    0,   34, -128,   51,  -25,   21,    0,
        13,    4,   19,  -71,   43,  -17,   13,    2,
         8,   11,   -4,  -10,   25,    0,    7,    6,
         9,   13,  -10,   -3,    4,    2,    1,    6,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -26,    0,  -13,   -8,  -17,  -26,  -19,  -31,
         7,    2,  -12,  -11,   -5,   -4,   -3,   -8,
         9,   -5,   -4,  -13,    2,   -8,  -11,   -6,
         4,   -4,    5,  -21,    1,    0,  -12,   -6,
         0,    0,   -1,  -15,   -1,  -11,   -5,   -9,
        -7,  -10,   -6,   -5,    8,  -14,    1,   -6,
         7,   -8,   -1,   -4,   -8,   -2,    9,   -9,
        -4,   -3,   -4,   12,   -8,    2,   -1,  -18,
    ],
    [ // white bishops
       -41,  -27,  -19,  -26,  -20,  -35,  -29,  -38,
       -21,  -21,  -15,  -21,  -18,  -19,  -23,  -24,
       -18,  -21,   -5,  -22,   -5,  -31,  -15,  -15,
       -13,  -18,  -11,  -32,   -9,  -16,  -14,  -11,
       -15,  -15,  -35,   -8,  -28,  -15,  -12,  -14,
       -16,  -24,  -33,  -13,  -20,  -17,  -13,  -11,
       -29,  -33,  -15,  -13,  -17,  -16,  -22,  -15,
       -34,  -19,  -15,  -12,  -13,  -18,  -26,  -37,
    ],
    [ // white rooks
       -14,  -19,  -24,  -30,  -12,  -21,  -18,  -18,
       -11,  -20,  -24,  -25,  -17,  -18,  -26,  -18,
       -13,  -23,  -20,  -33,  -10,  -22,  -18,  -16,
       -17,  -27,  -24,  -40,  -10,  -23,  -16,  -18,
       -21,  -24,  -34,  -41,  -25,  -24,  -24,  -23,
       -16,  -18,  -25,  -40,  -16,  -19,  -17,  -21,
       -21,  -22,  -26,  -41,  -18,  -26,  -23,  -29,
       -35,  -23,  -31,  -41,  -24,  -32,  -26,  -34,
    ],
    [ // white queens
       -67,  -58,  -61,  -75,  -66,  -69,  -57,  -81,
       -38,  -48,  -46,  -62,  -50,  -58,  -42,  -47,
       -40,  -44,  -42,  -48,  -41,  -47,  -54,  -54,
       -36,  -40,  -34,  -39,  -29,  -34,  -45,  -51,
       -44,  -36,  -38,  -32,  -37,  -34,  -39,  -47,
       -38,  -41,  -35,  -33,  -32,  -35,  -39,  -35,
       -42,  -42,  -42,  -36,  -42,  -36,  -38,  -47,
       -45,  -45,  -42,  -43,  -40,  -35,  -40,  -53,
    ],
    [ // white kings
       -22,    8,   34,   42,   12,   10,   11,   -6,
        -3,   10,   40,   37,   37,   -1,   11,   -8,
         2,    5,   41,   33,   48,   -7,    6,  -12,
         3,    7,   31,   27,   35,    3,   -1,   -6,
        -2,    8,   10,   19,   10,    5,   -5,   -1,
        -5,    2,   -4,    0,   -3,    1,   -6,   -2,
        -1,   -4,   -7,   -3,   -6,   -5,    1,    3,
         2,   -3,   -8,   -8,   -2,   -3,    0,    8,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        29,    7,  -12,  -26,    0,   12,   14,   19,
        27,   13,  -24,  -52,  -16,   16,   13,   21,
        25,   13,  -11,  -49,    1,    8,   16,   19,
        28,   14,   -2,    3,    4,    7,   25,   17,
        33,   20,   21,   14,   31,    6,   24,   23,
        37,   15,   25,   28,   15,   12,   19,    9,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        -5,    7,   -4,   31,   -8,   16,   -3,    1,
        15,   14,   13,    9,    7,   25,    7,   -2,
        21,    1,   25,  -18,   32,   -2,   26,    0,
        23,    8,   23,  -14,   33,   11,   26,   -6,
        15,   27,   12,   28,   14,   29,   18,   22,
         3,   30,   11,   30,   16,   30,    1,   20,
        15,   17,   13,   14,   13,   10,   11,   12,
        12,    4,   22,    8,   19,   -6,   14,  -24,
    ],
    [ // black bishops
        35,   15,    9,   18,   21,   22,   23,    3,
        19,   29,   14,    9,   22,   29,   18,    4,
        22,   21,   29,    0,   27,   28,   16,   15,
        22,   25,   13,    2,   21,   22,   23,   16,
        26,   23,   18,   19,   24,   29,   25,   22,
        15,   27,   23,   15,   29,   27,   24,   14,
        15,   20,   22,   23,   26,   23,    9,   10,
         6,   11,   15,   22,   21,   11,   15,   -2,
    ],
    [ // black rooks
        15,   25,   32,   51,   25,   21,   32,   19,
        29,   30,   35,   55,   32,   31,   30,   27,
        36,   39,   35,   54,   37,   39,   38,   30,
        42,   45,   40,   38,   40,   45,   44,   39,
        40,   41,   36,   35,   44,   38,   46,   36,
        41,   40,   40,   34,   53,   39,   44,   38,
        40,   44,   40,   38,   46,   42,   40,   39,
        34,   38,   33,   34,   44,   34,   42,   39,
    ],
    [ // black queens
        51,   48,   51,   42,   45,   46,   44,   29,
        45,   57,   50,   58,   50,   54,   48,   33,
        49,   50,   66,   55,   64,   56,   52,   41,
        48,   63,   62,   59,   64,   67,   54,   51,
        56,   59,   63,   55,   71,   62,   58,   42,
        45,   56,   54,   54,   60,   52,   47,   43,
        49,   51,   50,   50,   48,   49,   59,   54,
        31,   29,   25,   23,   22,   21,   32,   26,
    ],
    [ // black kings
        -5,   -1,   -1,  -15,   -7,    5,    4,    4,
        -6,   -4,   -9,  -21,    2,    3,   10,   10,
        -6,   -4,   -8,  -16,   -1,   11,   10,    8,
        -7,    0,   -4,   -5,    1,   16,   13,   10,
        -7,    1,   -4,   -4,   12,   22,   17,   15,
        -3,   -1,   -3,   -7,   15,   15,   28,   18,
        -3,    1,    1,   -3,   13,   13,   22,   11,
       -13,    4,    4,    6,    1,    6,    4,   -2,
    ],
  ],

  [ // unit 12: bias -21, output weights 87 (ours) -88 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         4,    2,  -15,   -9,  -25,   -5,    7,   23,
        12,    5,    2,    0,   -6,  -17,   -2,   16,
         1,    6,   -1,    2,    5,  -11,    2,   19,
        -5,   -7,   -6,   -1,   -3,    3,   17,   26,
       -11,  -21,  -13,   -3,   -2,   12,   30,   34,
        -8,  -26,  -25,   -8,    0,   30,   35,   28,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
        11,   12,    9,   15,   14,    1,   16,   13,
        18,   15,   22,   20,   18,   15,   19,   17,
        23,   19,   19,   24,   25,   28,   20,    9,
        19,   17,   20,   22,   13,   26,   24,   21,
        19,   14,   16,   16,   18,   22,   25,   17,
        15,   13,   19,   16,   22,   15,   26,   26,
        14,   12,   15,   13,   18,   24,   30,   24,
        13,   16,   12,   16,   17,   30,   31,   10,
    ],
    [ // white bishops
         8,    9,   13,    8,    7,    3,    7,    6,
        13,   14,   18,   14,    9,    6,    7,   10,
        16,   19,   20,   16,   15,   17,   18,    8,
        14,   14,   17,   19,   16,   24,   23,   19,
        15,    6,   14,   14,   17,   18,   24,   19,
        16,   10,    7,   15,   13,   23,   23,   28,
        11,    4,    9,   14,   14,   26,   35,   19,
        11,   11,   24,   15,   16,   30,   33,   19,
    ],
    [ // white rooks
        24,   18,   21,   24,   27,   28,   25,   27,
        16,   12,   17,   21,   22,   25,   26,   17,
        21,   15,   20,   25,   28,   30,   27,   21,
        19,   19,   20,   25,   27,   31,   25,   22,
        23,   18,   20,   26,   25,   28,   26,   25,
        26,   25,   20,   25,   31,   24,   23,   16,
        34,   32,   23,   25,   27,   19,    4,  -40,
        30,   34,   25,   27,   29,   17,   -9,    3,
    ],
    [ // white queens
        31,   34,   25,   25,   25,   32,   42,   46,
        38,   28,   28,   24,   25,   27,   46,   48,
        37,   30,   27,   30,   27,   35,   37,   30,
        41,   37,   34,   34,   36,   37,   38,   37,
        37,   41,   41,   37,   35,   40,   39,   40,
        48,   41,   42,   42,   42,   38,   41,   31,
        54,   54,   42,   41,   39,   45,   29,   20,
        53,   52,   52,   45,   42,   42,   33,   28,
    ],
    [ // white kings
       -38, -193, -181, -179, -174,  -46,  -16,   -6,
      -140, -107, -199,  -95, -130,  -42,  -23,  -10,
      -204, -191, -190, -166, -185, -174,  -28,  -17,
      -196, -212, -190, -164, -197, -199,  -21,  -19,
      -221, -193, -223, -204, -211, -201,  -19,   -9,
      -214, -213, -219, -221, -217,  -39,   -3,    2,
      -219, -226, -233, -187,  -74,  -20,   15,   11,
      -202, -242, -229, -144,  -27,   -7,   11,    1,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        -2,  -12,   -8,   -2,  -14,   -6,    3,   -1,
        -4,  -16,   -9,   -7,  -14,   -6,    5,   -7,
        -1,   -5,   -7,   -1,  -14,  -15,   -3,   -9,
         1,    0,    1,    2,  -12,  -23,   -4,  -15,
         6,   -4,  -10,  -10,  -13,  -20,   15,  -28,
       -15,  -26,  -34,  -35,  -27,   37,  101,   76,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -13,  -13,  -12,  -14,  -20,  -18,  -13,  -18,
       -13,   -8,  -11,  -12,  -10,  -18,  -13,  -21,
       -12,   -7,  -10,  -10,  -10,  -18,   -8,  -15,
        -4,   -7,   -4,   -3,   -4,   -7,  -18,  -14,
         2,   -3,    2,   -6,   -8,   -4,  -13,  -13,
         3,   -7,  -13,   -1,  -11,  -33,  -19,  -13,
        -6,  -10,  -17,  -27,  -15,   -5,   29,  -40,
       -19,  -12,  -16,  -16,  -39,  -19,  -14,  -16,
    ],
    [ // black bishops
       -24,  -23,   -4,  -10,   -9,  -16,  -11,   -9,
       -17,  -17,  -17,   -5,  -11,   -3,    0,  -13,
        -2,  -16,  -16,   -9,   -5,   -2,   -6,   -4,
        -5,   -6,  -14,   -9,    0,   -3,    1,   -8,
        -1,   -7,   -2,   -8,   -5,    2,   -2,    2,
        -2,    2,   -2,    0,   -7,  -15,  -19,  -18,
        -8,   -8,   -4,   -2,   -8,  -14,   10,  -10,
       -12,   -5,    5,   -1,   -4,    3,  -38,  -55,
    ],
    [ // black rooks
         4,    6,    5,    5,    5,    8,   12,  -17,
         3,    5,    3,    4,    5,   10,   12,    4,
         6,    8,    8,   10,   10,   15,   15,   12,
         8,    8,   10,   13,   14,   14,   18,   18,
        10,   11,    8,   12,   16,   19,   22,   25,
        15,   10,   13,   16,   19,   24,   28,   34,
        10,    8,   13,   14,   23,   22,    2,   -8,
        10,    1,    3,    3,    9,   12,   13,   15,
    ],
    [ // black queens
        30,   34,   35,   37,   37,   40,   36,   21,
        42,   40,   36,   35,   35,   40,   34,   18,
        50,   40,   46,   43,   43,   41,   41,   34,
        43,   55,   48,   51,   49,   48,   43,   36,
        57,   54,   61,   58,   61,   50,   47,   37,
        60,   62,   64,   64,   54,   48,   39,   28,
        65,   55,   63,   60,   58,   42,   11,   10,
        50,   51,   48,   42,   39,   34,   31,   17,
    ],
    [ // black kings
        -7,   -2,    4,   10,    0,   -4,  -10,  -12,
        -5,    9,   12,   10,    2,   -4,  -11,  -10,
         8,   10,   13,   13,   10,    6,   -2,   -5,
         7,   12,   11,   18,   23,   19,   14,   11,
        10,    8,   14,   24,   27,   29,   14,   10,
         3,    7,   17,   30,   28,   10,   -7,  -42,
       -12,    0,    9,   16,   12,   -2, -142, -139,
       -34,  -17,  -16,    1,    5,  -34,  -42, -105,
    ],
  ],

  [ // unit 13: bias -23, output weights 115 (ours) -118 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        30,   21,   15,    5,   16,   16,   16,   15,
        37,   37,   34,   37,   42,   24,   15,    6,
        24,   30,   32,   38,   46,   24,   15,    5,
        16,   18,   16,   38,   34,   22,   11,    8,
         8,    6,   17,   29,   25,   21,    9,    8,
         8,    0,    7,   22,   22,   15,    6,   10,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
        12,   26,   33,   30,   41,   17,   33,    3,
        38,   40,   34,   39,   40,   37,   36,   29,
        45,   47,   46,   59,   48,   55,   29,   45,
        45,   41,   52,   55,   45,   58,   27,   41,
        34,   42,   54,   51,   60,   41,   39,   27,
        31,   32,   40,   47,   57,   23,   41,   20,
        21,   23,   32,   33,   32,   38,   27,   22,
        18,   12,   22,   33,   20,   31,   19,   20,
    ],
    [ // white bishops
         6,   22,   21,   22,   22,   16,   14,   -8,
        24,   27,   35,   26,   29,   26,   15,   13,
        25,   37,   34,   44,   37,   38,   27,   27,
        32,   31,   37,   41,   44,   42,   31,   28,
        28,   27,   24,   45,   46,   34,   26,   28,
        20,   20,   23,   32,   37,   30,   29,   20,
        10,    0,   16,   28,   24,   27,   15,   23,
        -3,    4,   10,   23,   27,   13,   17,    7,
    ],
    [ // white rooks
        54,   51,   48,   49,   49,   48,   52,   50,
        57,   56,   54,   53,   50,   59,   52,   56,
        53,   52,   49,   49,   52,   51,   52,   51,
        46,   47,   45,   45,   47,   47,   42,   43,
        40,   38,   38,   38,   33,   34,   33,   35,
        41,   40,   38,   30,   24,   34,   31,   33,
        42,   43,   36,   27,   24,   35,   34,   36,
        25,   39,   30,   18,   15,   24,   29,   19,
    ],
    [ // white queens
        58,   61,   56,   54,   51,   51,   64,   53,
        77,   71,   70,   62,   55,   59,   70,   65,
        72,   76,   73,   72,   62,   60,   54,   50,
        73,   72,   76,   73,   82,   70,   61,   52,
        56,   68,   67,   74,   76,   72,   62,   59,
        64,   52,   62,   63,   66,   66,   64,   62,
        61,   54,   47,   53,   54,   62,   63,   57,
        48,   47,   46,   41,   51,   57,   50,   49,
    ],
    [ // white kings
       -19,    2,   10,   20,   20,   12,  -14,  -13,
         7,    9,   21,   35,   36,   22,    4,   -4,
        14,   14,   22,   32,   41,   22,   14,    1,
        11,    8,   16,   24,   26,   19,    3,   -3,
         0,    4,    9,   17,   20,   12,    2,   -6,
       -11,    0,    3,   12,   11,   11,    1,   -4,
       -17,  -14,   -4,    2,    6,    2,   -2,   -7,
       -24,  -21,  -26,  -14,  -13,   -8,  -14,  -10,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         2,    1,  -11,    2,   11,   24,   14,   18,
         3,    6,   -4,   -2,   17,   24,   11,   19,
         5,   12,    0,   -2,   31,    6,   12,   11,
         2,   12,    0,   17,   23,   -6,    8,    3,
        -8,   -5,  -12,   12,   27,  -15,   -1,   -3,
       -25,  -25,  -30,    0,    6,   -2,  -11,  -13,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -25,  -38,  -25,  -17,  -22,  -15,  -25,  -25,
       -34,  -31,  -23,  -22,  -24,  -13,  -17,  -21,
       -33,  -23,  -24,  -23,  -16,  -20,  -15,  -27,
       -31,  -30,  -29,  -35,  -27,  -28,  -22,  -29,
       -29,  -35,  -34,  -30,  -26,  -27,  -25,  -26,
       -42,  -38,  -40,  -30,  -35,  -35,  -36,  -37,
       -45,  -43,  -46,  -40,  -39,  -40,  -45,  -42,
       -68,  -54,  -47,  -49,  -46,  -54,  -54,  -56,
    ],
    [ // black bishops
       -26,  -16,  -35,  -12,  -21,  -19,  -19,   -9,
       -20,  -30,  -14,  -26,  -18,  -15,   -3,  -20,
       -33,  -16,  -23,  -14,  -24,    4,  -13,  -14,
       -21,  -32,  -24,  -28,  -16,  -22,  -17,  -18,
       -28,  -26,  -35,  -22,  -23,  -22,  -23,  -16,
       -25,  -27,  -24,  -35,  -25,  -40,  -20,  -30,
       -36,  -23,  -31,  -30,  -37,  -28,  -46,  -31,
       -31,  -34,  -30,  -39,  -31,  -45,  -32,  -44,
    ],
    [ // black rooks
       -42,  -31,  -33,  -24,  -17,  -27,  -27,  -44,
       -26,  -25,  -26,  -16,   -8,  -17,  -23,  -26,
       -27,  -25,  -24,  -13,   -8,  -15,  -18,  -23,
       -27,  -26,  -25,  -16,  -14,  -15,  -17,  -20,
       -27,  -26,  -29,  -22,  -17,  -22,  -16,  -21,
       -32,  -32,  -34,  -28,  -26,  -31,  -25,  -27,
       -36,  -38,  -38,  -34,  -33,  -35,  -36,  -33,
       -43,  -44,  -47,  -41,  -39,  -43,  -41,  -41,
    ],
    [ // black queens
       -76,  -77,  -79,  -88,  -72,  -69,  -74,  -78,
       -74,  -70,  -79,  -72,  -70,  -59,  -60,  -73,
       -75,  -77,  -61,  -63,  -57,  -54,  -62,  -72,
       -82,  -69,  -66,  -63,  -59,  -61,  -70,  -73,
       -76,  -72,  -72,  -71,  -69,  -73,  -76,  -83,
       -86,  -81,  -79,  -80,  -88,  -90,  -92,  -93,
       -89,  -90,  -89,  -98,  -99, -104,  -88,  -92,
      -115, -113, -124, -125, -124, -128, -121, -121,
    ],
    [ // black kings
         5,   11,    6,   -6,   -4,    2,    0,    1,
         3,    1,   -1,   -2,    1,    6,    3,    1,
        -5,   -9,   -4,    2,    4,    9,    1,    0,
        -7,   -8,   -8,   -4,   -1,   -1,   -3,   -4,
        -2,   -6,   -9,  -13,  -11,  -12,   -6,   -7,
        -5,   -7,  -11,  -26,  -21,  -25,   -3,  -10,
       -12,  -31,  -30,  -37,  -27,  -34,  -14,  -15,
       -19,  -26,  -30,  -26,  -39,  -30,  -41,  -15,
    ],
  ],

  [ // unit 14: bias -30, output weights -63 (ours) 64 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        87,  -38,  -22,   -4,  -34,    0,  -12,  -24,
        93,  -39,   -7,   11,  -20,    1,  -10,  -11,
        89,  -14,    6,   18,   -7,   16,    3,    5,
        83,  -36,   19,    3,    0,   17,   14,   11,
        95,  -65,   37,  -21,    8,   13,   18,   16,
        87,  -62,   21,  -18,    9,   16,   18,   18,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
        -5,  -15,  -10,   -3,    0,  -13,   -8,  -16,
         6,   -4,   -4,    1,    5,    2,    3,    1,
        12,  -14,   -6,    3,    5,    3,    1,    6,
        12,  -12,   -5,   -6,   -4,   10,    7,   11,
         6,  -14,    3,   -3,    4,   12,    8,   11,
         8,   -7,    6,    8,    6,    3,   13,   17,
         4,    0,    6,   -3,   12,   15,   10,    9,
         0,    6,    4,    9,   14,    8,   17,    9,
    ],
    [ // white bishops
       -23,  -26,  -16,  -15,  -19,  -25,  -19,  -27,
       -10,  -29,   -8,  -16,  -13,   -8,  -19,  -17,
       -15,  -25,  -17,   -6,  -14,  -11,  -12,   -9,
        -9,  -26,  -11,  -17,  -14,   -4,   -2,   -5,
       -17,  -34,  -10,  -29,   -4,  -12,   -4,   -1,
       -16,  -27,   -8,  -16,  -10,  -13,   -6,   -7,
       -11,   -7,  -18,   -6,  -14,   -2,  -14,   -9,
       -10,  -13,  -13,  -11,   -1,  -12,  -10,  -15,
    ],
    [ // white rooks
       -15,  -36,  -27,  -18,  -19,  -15,  -18,  -19,
       -15,  -27,  -23,  -16,  -16,  -11,  -16,  -14,
        -7,  -25,  -21,   -8,   -8,   -6,   -7,   -8,
       -10,  -23,  -23,  -12,  -15,   -8,   -8,   -9,
        -7,  -28,  -20,  -22,  -16,  -16,  -12,  -13,
        -6,  -24,  -19,  -14,  -22,  -13,  -10,  -13,
        -2,  -31,  -14,  -14,  -16,   -8,   -6,  -11,
       -12,  -38,  -17,  -19,  -24,  -16,   -8,  -19,
    ],
    [ // white queens
       -81,  -82,  -79,  -81,  -77,  -75,  -65,  -72,
       -55,  -70,  -64,  -61,  -65,  -56,  -49,  -45,
       -56,  -64,  -61,  -54,  -52,  -50,  -52,  -56,
       -49,  -54,  -50,  -47,  -45,  -36,  -44,  -53,
       -58,  -54,  -44,  -53,  -38,  -39,  -41,  -47,
       -52,  -58,  -40,  -45,  -45,  -45,  -42,  -44,
       -48,  -49,  -52,  -44,  -49,  -36,  -38,  -44,
       -44,  -56,  -45,  -55,  -46,  -40,  -43,  -48,
    ],
    [ // white kings
        32,    6,    3,    4,    5,   -6,  -21,  -36,
        25,  -41,  -15,   12,    0,    9,  -14,  -15,
         6,  -35,  -21,    3,    6,    4,   -3,   -9,
       -13,  -26,  -16,   -3,    1,    2,   -8,   -7,
       -11,  -28,  -13,  -15,   -1,   -4,    0,   -9,
        -6,  -29,  -21,  -17,   -8,   -1,    2,    1,
         4,  -14,  -17,  -15,   -4,    2,    8,    5,
        10,   -3,   -6,   -5,    3,   10,    6,    9,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        11,   -3,   -7,   -1,   -1,    8,    2,    4,
         7,    5,  -16,   -3,    4,    4,    3,    1,
         0,   11,  -15,   -9,    1,   -5,   -3,    0,
       -21,   34,    3,    4,   -2,   -5,   -1,    3,
       -56,   63,   16,   21,   13,   -1,    8,    6,
       -57,   55,   14,   21,   -6,    9,   -1,   10,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
       -16,  -20,   -1,   -5,   -4,  -15,  -18,  -35,
       -11,   16,  -12,    3,   -5,   -1,  -16,  -12,
       -15,   26,  -14,   20,   -3,    0,   -6,  -19,
        22,    8,   18,    8,   10,   -3,   -1,  -16,
        45,    0,   27,    0,   15,    7,    1,  -11,
        47,   -6,   19,   11,   11,   -3,    1,   -6,
        14,   19,   -6,    8,    1,   -7,  -13,  -18,
       -46,   26,   -8,    8,  -14,  -22,  -29,  -48,
    ],
    [ // black bishops
         4,    2,   -4,   14,    9,    6,    3,    0,
        12,    3,   10,   10,   12,   14,   15,    6,
        19,   10,   11,   15,   10,   21,   13,   10,
        25,   14,    9,   15,   13,   13,   15,   -2,
        30,   16,   18,   15,   16,   17,    5,   12,
        31,    8,   18,   21,   18,    5,   11,    2,
        33,    2,   16,   17,    6,   10,   -7,   -6,
       -17,    3,   15,   -1,    8,    2,    0,  -24,
    ],
    [ // black rooks
         0,   20,   30,   19,   20,    8,    8,    1,
        14,   25,   36,   22,   26,   15,   10,   10,
        28,   34,   38,   26,   29,   25,   19,   16,
        45,   33,   41,   28,   31,   27,   23,   23,
        61,   31,   43,   34,   33,   29,   26,   27,
        71,   21,   38,   36,   33,   30,   31,   29,
        78,   16,   42,   35,   35,   34,   33,   36,
        70,   17,   40,   33,   36,   31,   31,   29,
    ],
    [ // black queens
        40,   38,   48,   35,   44,   41,   37,   39,
        45,   49,   49,   48,   46,   51,   43,   40,
        61,   46,   68,   57,   64,   58,   51,   42,
        62,   64,   68,   69,   64,   60,   46,   43,
        79,   63,   76,   72,   61,   57,   46,   36,
        80,   61,   74,   66,   56,   52,   43,   31,
        88,   49,   69,   59,   53,   46,   58,   46,
        38,   43,   44,   40,   39,   34,   44,   28,
    ],
    [ // black kings
        11,    5,    3,   -4,  -17,   -7,  -13,  -16,
        17,    2,    6,    4,    0,   -5,   -9,  -15,
        19,   10,   10,    8,    3,   -1,   -9,  -15,
        26,   17,   14,   14,    3,   -5,  -10,  -15,
        29,   22,   14,   14,   -2,   -6,  -15,  -17,
        46,   19,   16,   12,    5,   -8,   -8,  -16,
        54,   19,   26,   17,    8,   -2,  -10,  -14,
        49,   28,   27,   23,    9,    5,    5,  -23,
    ],
  ],

  [ // unit 15: bias -1, output weights -106 (ours) 106 (theirs)
    [ // white pawns
         0,    0,    0,    0,    0,    0,    0,    0,
         4,   -6,   11,   -8,   19,  -27,   10,  -12,
        13,   14,    6,   19,    6,   12,   -4,    8,
        13,    4,   13,   -3,   25,   -9,   19,   -1,
         8,   13,   -9,   20,   -3,   11,    6,    6,
        10,    4,    6,   -3,    8,   -2,   13,    3,
        11,    5,   -2,    7,   -5,    9,    2,    6,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // white knights
       -55,  -44,  -44,  -31,  -44,  -49,  -42,  -59,
       -27,  -28,  -29,  -21,  -23,  -21,  -31,  -31,
       -24,  -22,  -15,  -14,  -13,  -23,  -26,  -24,
       -17,  -18,  -12,   -8,   -5,  -12,  -14,  -16,
       -25,  -14,   -7,   -4,   -6,   -5,   -8,  -22,
       -23,  -14,  -13,   -4,   -4,  -11,  -11,  -18,
       -29,  -22,  -15,  -16,  -15,  -12,  -16,  -26,
       -30,  -34,  -17,  -18,  -19,  -22,  -23,  -44,
    ],
    [ // white bishops
       -94,   20, -101,   21,  -86,    9,  -95,    9,
        29,  -95,   36,  -96,   30, -101,   28, -102,
       -86,   44,  -90,   39,  -97,   37,  -94,   32,
        37,  -73,   38,  -76,   49,  -80,   41,  -83,
       -81,   39,  -72,   53,  -74,   43,  -80,   35,
        29,  -76,   49,  -74,   48,  -72,   37,  -88,
       -85,   32,  -77,   37,  -74,   42,  -78,   25,
        27,  -87,   22,  -77,   34,  -83,   25,  -95,
    ],
    [ // white rooks
       -37,  -40,  -41,  -40,  -35,  -39,  -36,  -37,
       -27,  -28,  -32,  -29,  -37,  -30,  -40,  -29,
       -21,  -28,  -28,  -28,  -19,  -33,  -24,  -29,
       -23,  -22,  -26,  -20,  -23,  -16,  -27,  -20,
       -22,  -25,  -21,  -22,  -19,  -21,  -21,  -27,
       -31,  -27,  -30,  -25,  -28,  -24,  -33,  -33,
       -32,  -34,  -30,  -28,  -28,  -32,  -29,  -35,
       -49,  -37,  -38,  -36,  -39,  -42,  -40,  -49,
    ],
    [ // white queens
       -99,  -78,  -91,  -81,  -87,  -75,  -86,  -80,
       -70,  -82,  -64,  -78,  -65,  -80,  -62,  -78,
       -79,  -59,  -74,  -54,  -70,  -62,  -68,  -74,
       -64,  -72,  -53,  -62,  -46,  -56,  -60,  -72,
       -77,  -60,  -62,  -47,  -52,  -45,  -65,  -66,
       -69,  -76,  -55,  -64,  -49,  -61,  -59,  -71,
       -76,  -67,  -74,  -67,  -69,  -61,  -66,  -69,
       -74,  -81,  -75,  -81,  -73,  -75,  -76,  -89,
    ],
    [ // white kings
       -21,  -10,  -11,   -5,   -1,    2,   -2,  -10,
       -10,  -20,    0,  -14,    9,  -13,    1,   -9,
        -7,    0,  -13,    9,   -5,   13,  -11,    2,
        -1,   -4,   13,    1,   20,    0,   13,   -4,
        -1,    9,    7,   19,    8,   21,    7,    5,
        -4,    5,   13,   10,   16,    9,   11,    6,
         0,   -5,    2,    5,    4,    5,    5,   -1,
        -8,   -4,  -11,   -8,   -9,   -3,   -5,    2,
    ],
    [ // black pawns
         0,    0,    0,    0,    0,    0,    0,    0,
        15,   19,   13,   13,   14,    4,   24,   18,
        17,   22,   10,   19,    3,   21,    9,   21,
        12,   21,   14,    7,   19,    6,   12,   17,
        11,   16,   -3,   21,  -10,    9,   -3,    6,
        -6,   -9,   -9,  -18,   -8,  -21,  -23,    1,
       -26,  -15,  -45,  -24,  -49,  -26,  -40,   -9,
         0,    0,    0,    0,    0,    0,    0,    0,
    ],
    [ // black knights
        13,   24,   26,   36,   24,   34,   21,   19,
        28,   24,   36,   26,   34,   29,   34,   19,
        20,   31,   31,   31,   38,   23,   28,   23,
        26,   28,   19,   33,   23,   30,   24,   12,
        16,   18,   29,   18,   16,   17,   16,   23,
        18,   14,    7,   21,    7,   14,    4,   -1,
        -3,   14,    8,   11,    5,    5,   -4,   11,
       -27,  -10,    1,   -7,    7,  -26,    0,  -69,
    ],
    [ // black bishops
        23,    3,   16,   17,   29,   14,   18,   -8,
        -3,   23,   13,   26,   14,   30,   11,   26,
        26,    9,   33,   14,   30,   17,   30,    6,
         6,   27,    9,   31,   14,   24,   10,   27,
        23,    7,   19,    8,   25,    4,   26,    6,
         3,   18,    2,   17,   -2,   14,    4,   22,
        19,    2,   14,    1,   14,    1,    4,  -11,
        -3,   13,   -2,   14,   -2,    7,   -5,    9,
    ],
    [ // black rooks
        21,   25,   26,   24,   27,   21,   19,   11,
        31,   32,   29,   36,   32,   36,   28,   22,
        33,   31,   37,   33,   38,   38,   33,   27,
        36,   38,   35,   42,   39,   41,   37,   35,
        42,   37,   37,   37,   41,   38,   38,   37,
        35,   34,   27,   33,   33,   26,   31,   33,
        30,   20,   25,   24,   25,   22,   21,   23,
        17,   16,   11,   17,   16,   19,   18,   21,
    ],
    [ // black queens
        55,   46,   59,   43,   65,   54,   60,   37,
        46,   64,   45,   68,   50,   76,   47,   60,
        60,   46,   75,   58,   81,   60,   74,   46,
        42,   69,   56,   81,   62,   81,   51,   64,
        64,   49,   70,   53,   73,   48,   66,   36,
        40,   61,   41,   60,   40,   56,   36,   49,
        53,   32,   51,   35,   45,   38,   60,   42,
        14,   40,   20,   33,   22,   34,   36,   42,
    ],
    [ // black kings
        -8,  -11,    0,   -9,    1,  -10,    0,   -7,
       -10,   12,   -5,   17,   -6,   11,   -8,    3,
         8,   -3,   21,    1,   23,   -5,    9,  -10,
        -9,   15,   -1,   26,    0,   18,   -8,    6,
         3,   -9,   14,   -1,   16,  -10,    7,  -17,
       -18,   -4,  -17,    4,  -15,   -3,  -19,   -5,
       -15,  -34,   -8,  -35,   -8,  -43,  -18,  -25,
       -23,  -18,  -29,  -19,  -38,  -22,  -28,  -21,
    ],
  ],
];

const NET_BIAS = [-14, 147, -21, -1, 10, 25, 21, -63, 9, 63, -32, 1, -21, -23, -30, -1];
const NET_OUT  = [-123, 52, -80, 122, 127, -82, 92, 127, 76, 44, 65, -68, 87, 115, -63, -106, 121, -53, 81, -125, -127, 85, -89, -115, -75, -42, -64, 68, -88, -118, 64, 106];  // ours then theirs
const NET_OUT_BIAS = -16;


//
// net
//

// the net, (768 -> 16) x 2 -> 1 with SCReLU (clipped at QA, then squared), in place of the hand-crafted eval. each
// node holds two accumulators of 16, one seen from white's side and one from black's,
// kept up to date by put_piece and remove_piece (one weight row per piece and square added or
// taken away) and copied along with the position; evaluate applies the activation to each,
// weights them by the output row with the side to move's accumulator first, and scales to
// centipawns. the weights are the base64 blob in get_weights() at the end of the file, in
// bullet's layout

const NET_QA      = 255;
const NET_QB      = 64;
const NET_QAB     = NET_QA * NET_QB;
const NET_SCALE   = 400;
const NET_I_SIZE  = 768;
const NET_H1_SIZE = 16;

const net_h1_w = new Int32Array(NET_I_SIZE * NET_H1_SIZE);  // feature rows, as seen from white's side
const net_h2_w = new Int32Array(NET_I_SIZE * NET_H1_SIZE);  // the same rows as seen from black's side (colours swapped, squares mirrored)
const net_h1_b = new Int32Array(NET_H1_SIZE);
const net_o_w  = new Int32Array(NET_H1_SIZE * 2);
let   net_o_b  = 0;

// the weight row of a piece on a square; the net's feature order is white pawn..king then
// black pawn..king, a1 = 0 like our squares

const NET_ROW = new Int32Array(16 * 64);

for (let piece=PAWN; piece <= (KING | BLACK); piece++) {
  if ((piece & 7) < PAWN || (piece & 7) > KING)
    continue;
  const feature = (piece & 7) - 1 + (piece & BLACK ? 6 : 0);
  for (let sq=0; sq < 64; sq++)
    NET_ROW[piece * 64 + sq] = (feature * 64 + sq) * NET_H1_SIZE;
}

function net_add(acc, row) {
  for (let h=0; h < NET_H1_SIZE; h++) {
    acc[h]               += net_h1_w[row + h];
    acc[NET_H1_SIZE + h] += net_h2_w[row + h];
  }
}

function net_sub(acc, row) {
  for (let h=0; h < NET_H1_SIZE; h++) {
    acc[h]               -= net_h1_w[row + h];
    acc[NET_H1_SIZE + h] -= net_h2_w[row + h];
  }
}

// SCReLU (clipped at QA, then squared) of both accumulators by the output weights, the side to move's half first

function net_eval(acc, stm) {
  const a = stm === WHITE ? 0 : NET_H1_SIZE;
  const b = NET_H1_SIZE - a;
  let e = 0;
  for (let h=0; h < NET_H1_SIZE; h++) {
    const rx = Math.min(Math.max(acc[a + h], 0), NET_QA);
    const ry = Math.min(Math.max(acc[b + h], 0), NET_QA);
    e = (e + Math.imul(net_o_w[h], Math.imul(rx, rx)) + Math.imul(net_o_w[NET_H1_SIZE + h], Math.imul(ry, ry))) | 0;
  }
  return e;
}

// an empty board's accumulators are the biases

function net_reset(node) {
  node.acc.set(net_h1_b, 0);
  node.acc.set(net_h1_b, NET_H1_SIZE);
}

// the boards above feed the tables the accumulators use: a row per feature (piece and square),
// with the black-side table holding each row under the colour-flipped feature (piece colour
// swapped, square mirrored). the boards are written rank 8 first, so the diagram index is the
// square with its rank flipped

function net_load() {

  for (let piece=0; piece < 12; piece++) {
    for (let sq=0; sq < 64; sq++) {
      const feature = piece * 64 + sq;
      const flipped = (((piece + 6) % 12) << 6) | (sq ^ 56);
      for (let j=0; j < NET_H1_SIZE; j++) {
        const w = NET_BOARDS[j][piece][sq ^ 56];
        net_h1_w[feature * NET_H1_SIZE + j] = w;
        net_h2_w[flipped * NET_H1_SIZE + j] = w;
      }
    }
  }

  for (let j=0; j < NET_H1_SIZE; j++)
    net_h1_b[j] = NET_BIAS[j];

  for (let j=0; j < NET_H1_SIZE * 2; j++)
    net_o_w[j] = NET_OUT[j];

  net_o_b = NET_OUT_BIAS;

}

net_load();


// pos and board share one buffer, so copying pos copies the board too

function new_node() {
  const pos = new_pos();
  return {
    acc:       new Int16Array(NET_H1_SIZE * 2),
    pos:       pos,                         // the position at this ply
    board:     pos.board,                   // its board, for short
    moves:     new Uint32Array(MAX_MOVES),  // the moves generated here, ranked by init_moves
    ranks:     new Int32Array(MAX_MOVES),   // their ranks, picked best first by get_move
    num_moves: 0,                           // how many
    next_move: 0,                           // how many get_move has handed out
    played:    new Uint32Array(MAX_MOVES),  // the quiet moves searched here, for the history malus on a cutoff
    in_check:  0,                           // is the side to move in check (set by gen_moves)
    eval:      0,                           // the static eval here, for improving
    excluded:  0,                           // the move left out of a singular verification search, or 0
    killer:    0,                           // the killer move, a quiet that cut off here before
    cont:      -1,                          // the move that led here as piece * 64 + dst, for continuation history (-1 at the root or after a null move)
    pv:        new Uint32Array(MAX_PLY),    // the principal variation from here
    pv_len:    0
  };
}

// one extra so make_move(ply) can always write nodes[ply+1]

const nodes = Array.from({ length: MAX_PLY + 1 }, new_node);

// hashes of the positions since the last irreversible move, for repetition detection
// the game positions from uci fill 0..rep_root, search ply p will use rep_root + p

const MAX_REP = 1024;

const rep_lo = new Int32Array(MAX_REP + MAX_PLY + 1);
const rep_hi = new Int32Array(MAX_REP + MAX_PLY + 1);

let rep_root = 0;

function rep_set(i, pos) {
  rep_lo[i] = pos.lo;
  rep_hi[i] = pos.hi;
}

//
// hash
//

// zobrist keys as lo/hi 32 bit halves
// keys for piece 0 and ep square 0 stay 0 so hashing an empty square or no ep is a no-op

// prng - xorshift32 for the state, then a non linear mix of the output.
// xorshift alone is linear over GF(2): with the two halves of a zobrist key taken from
// consecutive outputs, the hi half would be a fixed linear function of the lo half.

let rng_state = 1234567890;

function rand32() {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >>> 17;
  rng_state ^= rng_state << 5;
  let x = rng_state;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return x ^ (x >>> 16);
}

const piece_lo  = new Int32Array(16 * 64);
const piece_hi  = new Int32Array(16 * 64);
const rights_lo = new Int32Array(16);
const rights_hi = new Int32Array(16);
const ep_lo     = new Int32Array(64);
const ep_hi     = new Int32Array(64);
const stm_lo    = rand32();
const stm_hi    = rand32();

for (const colour of [WHITE, BLACK]) {
  for (let ptype=PAWN; ptype <= KING; ptype++) {
    for (let sq=0; sq < 64; sq++) {
      piece_lo[(ptype | colour) * 64 + sq] = rand32();
      piece_hi[(ptype | colour) * 64 + sq] = rand32();
    }
  }
}

for (let i=0; i < 16; i++) {
  rights_lo[i] = rand32();
  rights_hi[i] = rand32();
}

for (let sq=1; sq < 64; sq++) {
  ep_lo[sq] = rand32();
  ep_hi[sq] = rand32();
}

// each of these toggles a feature in or out of the hash

function hash_piece(pos, piece, sq) {
  pos.lo ^= piece_lo[piece * 64 + sq];
  pos.hi ^= piece_hi[piece * 64 + sq];
  if ((piece & 7) === PAWN) {
    pos.pk_lo ^= piece_lo[piece * 64 + sq];
    pos.pk_hi ^= piece_hi[piece * 64 + sq];
  }
}

function hash_rights(pos) {
  pos.lo ^= rights_lo[pos.rights];
  pos.hi ^= rights_hi[pos.rights];
}

function hash_ep(pos) {
  pos.lo ^= ep_lo[pos.ep];
  pos.hi ^= ep_hi[pos.ep];
}

function hash_stm(pos) {
  pos.lo ^= stm_lo;
  pos.hi ^= stm_hi;
}

// from scratch; make_move updates incrementally

function set_hash(node) {

  const pos = node.pos;
  const b   = node.board;

  pos.lo    = 0;
  pos.hi    = 0;
  pos.pk_lo = 0;
  pos.pk_hi = 0;

  for (let sq=0; sq < 64; sq++)
    hash_piece(pos, b[sq], sq);

  hash_rights(pos);
  hash_ep(pos);

  if (pos.stm === BLACK)
    hash_stm(pos);

}

//
// attacks
//

// attack tables per square, as small arrays of squares so there is no off-board arithmetic
// anywhere: the squares a knight or a king reaches, the squares a pawn of each colour attacks
// a square from and the squares it attacks (by colour index), the rays a slider walks (rook
// directions 0-3, bishop directions 4-7; rays[sq * 8 + dir] lists the squares in order out to
// the edge), whether two squares share a rank, file or diagonal, and the king distance
// between two squares

const PAWN_PUSH = [8, -8];

const ROOK_DIRS   = [[1,0],[-1,0],[0,1],[0,-1]];
const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]];

function on_board(f, r) {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

function step_targets(steps) {
  const table = [];
  for (let sq=0; sq < 64; sq++) {
    const list = [];
    for (const [df, dr] of steps)
      if (on_board((sq & 7) + df, (sq >>> 3) + dr))
        list.push(((sq >>> 3) + dr) * 8 + (sq & 7) + df);
    table.push(Int8Array.from(list));
  }
  return table;
}

const knight_to = step_targets([[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]);
const king_to   = step_targets([[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]);
const pawn_from = [step_targets([[-1,-1],[1,-1]]), step_targets([[-1,1],[1,1]])];
const pawn_to   = [pawn_from[BLACK_INDEX], pawn_from[WHITE_INDEX]];

const rays = [];

for (let sq=0; sq < 64; sq++) {
  for (const [df, dr] of ROOK_DIRS.concat(BISHOP_DIRS)) {
    const list = [];
    let f = (sq & 7) + df;
    let r = (sq >>> 3) + dr;
    while (on_board(f, r)) {
      list.push(r * 8 + f);
      f += df;
      r += dr;
    }
    rays.push(Int8Array.from(list));
  }
}

const on_line = new Uint8Array(64 * 64);

for (let sq=0; sq < 64; sq++)
  for (let dir=0; dir < 8; dir++)
    for (const s of rays[sq * 8 + dir])
      on_line[sq * 64 + s] = 1;

const dist = new Uint8Array(64 * 64);

for (let a=0; a < 64; a++)
  for (let s=0; s < 64; s++)
    dist[a * 64 + s] = Math.max(Math.abs((a & 7) - (s & 7)), Math.abs((a >>> 3) - (s >>> 3)));

// the king zone: a king's square and its neighbours, king_zone[ksq * 64 + sq]

const king_zone = new Uint8Array(64 * 64);

for (let k=0; k < 64; k++)
  for (let s=0; s < 64; s++)
    king_zone[k * 64 + s] = dist[k * 64 + s] <= 1 ? 1 : 0;

//
// isattacked
//

// is sq attacked by by_colour, reading the board; skip is a square treated as empty (the king
// when its own moves are tested), or -1. steppers look at the squares they would come from,
// sliders walk each ray to the first piece

function attacked(b, sq, by_colour, skip) {

  const pawn = PAWN | by_colour;
  const from = pawn_from[by_colour >>> 3][sq];

  for (let i=0; i < from.length; i++)
    if (b[from[i]] === pawn)
      return true;

  const knight = KNIGHT | by_colour;
  const kn     = knight_to[sq];

  for (let i=0; i < kn.length; i++)
    if (b[kn[i]] === knight)
      return true;

  const king = KING | by_colour;
  const kg   = king_to[sq];

  for (let i=0; i < kg.length; i++)
    if (b[kg[i]] === king)
      return true;

  const queen  = QUEEN  | by_colour;
  const rook   = ROOK   | by_colour;
  const bishop = BISHOP | by_colour;

  for (let dir=0; dir < 8; dir++) {
    const ray    = rays[sq * 8 + dir];
    const slider = dir < 4 ? rook : bishop;
    for (let i=0; i < ray.length; i++) {
      const s = ray[i];
      if (s === skip)
        continue;
      const piece = b[s];
      if (piece === 0)
        continue;
      if (piece === slider || piece === queen)
        return true;
      break;
    }
  }

  return false;

}

function is_attacked(node, sq, by_colour) {
  return attacked(node.board, sq, by_colour, -1);
}

function is_in_check(node) {
  const stm = node.pos.stm;
  return is_attacked(node, node.pos.kings[(stm >>> 3)], stm ^ BLACK);
}

//
// movegen
//

// pseudo-legal moves from the board: a loop over the squares, steppers from their target
// lists, sliders along their rays. whether a move leaves the own king in check is settled
// when it is made (make_move returns false and the caller skips it), so there are no pins
// or check masks here. with captures_only (the qsearch, not in check) only captures,
// promotions and ep are generated

const PROMO_QUEEN  = PROMO_BIT | ((QUEEN  - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_ROOK   = PROMO_BIT | ((ROOK   - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_BISHOP = PROMO_BIT | ((BISHOP - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_KNIGHT = PROMO_BIT | ((KNIGHT - KNIGHT) << PROMO_PIECE_SHIFT);

function add_promos(moves, n, move) {
  moves[n++] = move | PROMO_QUEEN;
  moves[n++] = move | PROMO_ROOK;
  moves[n++] = move | PROMO_BISHOP;
  moves[n++] = move | PROMO_KNIGHT;
  return n;
}

// a pawn: the push (a promotion on the last rank, a double push from the start rank), the
// two captures, and ep when its target is the ep square

function gen_pawn(moves, n, b, sq, stm, ep, captures_only) {

  const forward = PAWN_PUSH[stm >>> 3];
  const to      = sq + forward;
  const promo   = (to >>> 3) === (stm === WHITE ? 7 : 0);

  if (b[to] === 0) {
    if (promo)
      n = add_promos(moves, n, sq | (to << 6));
    else if (!captures_only) {
      moves[n++] = sq | (to << 6);
      if ((sq >>> 3) === (stm === WHITE ? 1 : 6) && b[to + forward] === 0)
        moves[n++] = sq | ((to + forward) << 6);
    }
  }

  const targets = pawn_to[stm >>> 3][sq];

  for (let i=0; i < targets.length; i++) {
    const t   = targets[i];
    const cap = b[t];
    if (cap !== 0 && (cap & BLACK) !== stm) {
      if (promo)
        n = add_promos(moves, n, sq | (t << 6) | CAPTURE_BIT);
      else
        moves[n++] = sq | (t << 6) | CAPTURE_BIT;
    }
    else if (ep !== 0 && t === ep)
      moves[n++] = sq | (t << 6) | CAPTURE_BIT | EP_CAPTURE_BIT;
  }

  return n;

}

// a knight or a king: each target square that is empty or holds an enemy piece

function gen_steps(moves, n, b, sq, targets, stm, captures_only) {

  for (let i=0; i < targets.length; i++) {
    const t   = targets[i];
    const cap = b[t];
    if (cap === 0) {
      if (!captures_only)
        moves[n++] = sq | (t << 6);
    }
    else if ((cap & BLACK) !== stm)
      moves[n++] = sq | (t << 6) | CAPTURE_BIT;
  }

  return n;

}

// a slider: along each of its rays until a piece, which is captured if it is an enemy

function gen_rays(moves, n, b, sq, d0, d1, stm, captures_only) {

  for (let dir=d0; dir < d1; dir++) {
    const ray = rays[sq * 8 + dir];
    for (let i=0; i < ray.length; i++) {
      const t   = ray[i];
      const cap = b[t];
      if (cap === 0) {
        if (!captures_only)
          moves[n++] = sq | (t << 6);
        continue;
      }
      if ((cap & BLACK) !== stm)
        moves[n++] = sq | (t << 6) | CAPTURE_BIT;
      break;
    }
  }

  return n;

}

// castling, encoded as the king's move: the right must remain, the squares between must be
// empty and the square the king passes over not attacked; the square it lands on is checked
// like any other king move, when the move is made

function gen_castling(moves, n, b, pos, stm) {

  const rights = pos.rights;

  if (stm === WHITE) {
    if ((rights & WHITE_RIGHTS_KING)  && b[5] === 0 && b[6] === 0 && !attacked(b, 5, BLACK, -1))
      moves[n++] = 4 | (6 << 6) | CASTLE_BIT;
    if ((rights & WHITE_RIGHTS_QUEEN) && b[3] === 0 && b[2] === 0 && b[1] === 0 && !attacked(b, 3, BLACK, -1))
      moves[n++] = 4 | (2 << 6) | CASTLE_BIT;
  }
  else {
    if ((rights & BLACK_RIGHTS_KING)  && b[61] === 0 && b[62] === 0 && !attacked(b, 61, WHITE, -1))
      moves[n++] = 60 | (62 << 6) | CASTLE_BIT;
    if ((rights & BLACK_RIGHTS_QUEEN) && b[59] === 0 && b[58] === 0 && b[57] === 0 && !attacked(b, 59, WHITE, -1))
      moves[n++] = 60 | (58 << 6) | CASTLE_BIT;
  }

  return n;

}

function gen_moves(ply, captures_only) {

  const node  = nodes[ply];
  const pos   = node.pos;
  const b     = node.board;
  const moves = node.moves;
  const stm   = pos.stm;
  const ep    = pos.ep;

  node.in_check = is_in_check(node);

  let n = 0;

  for (let sq=0; sq < 64; sq++) {

    const piece = b[sq];

    if (piece === 0 || (piece & BLACK) !== stm)
      continue;

    switch (piece & 7) {
      case PAWN:
        n = gen_pawn(moves, n, b, sq, stm, ep, captures_only);
        break;
      case KNIGHT:
        n = gen_steps(moves, n, b, sq, knight_to[sq], stm, captures_only);
        break;
      case BISHOP:
        n = gen_rays(moves, n, b, sq, 4, 8, stm, captures_only);
        break;
      case ROOK:
        n = gen_rays(moves, n, b, sq, 0, 4, stm, captures_only);
        break;
      case QUEEN:
        n = gen_rays(moves, n, b, sq, 0, 8, stm, captures_only);
        break;
      case KING:
        n = gen_steps(moves, n, b, sq, king_to[sq], stm, captures_only);
        break;
    }
  }

  if (!captures_only && !node.in_check)
    n = gen_castling(moves, n, b, pos, stm);

  node.num_moves = n;

}

// the legal moves of a position, left in node.moves[0 .. n): for the root and the moves command

function legal_moves(ply) {

  gen_moves(ply, false);

  const node = nodes[ply];

  let n = 0;

  for (let i=0; i < node.num_moves; i++)
    if (make_move(ply, node.moves[i]))
      node.moves[n++] = node.moves[i];

  node.num_moves = n;

  return n;

}

//
// makemove
//

// rights are lost when anything moves from or to a king or rook home square

const RIGHTS_MASK = new Uint8Array(64).fill(15);

RIGHTS_MASK[0]  = 15 & ~WHITE_RIGHTS_QUEEN;
RIGHTS_MASK[4]  = 15 & ~(WHITE_RIGHTS_KING | WHITE_RIGHTS_QUEEN);
RIGHTS_MASK[7]  = 15 & ~WHITE_RIGHTS_KING;
RIGHTS_MASK[56] = 15 & ~BLACK_RIGHTS_QUEEN;
RIGHTS_MASK[60] = 15 & ~(BLACK_RIGHTS_KING | BLACK_RIGHTS_QUEEN);
RIGHTS_MASK[63] = 15 & ~BLACK_RIGHTS_KING;

// copy nodes[ply] into nodes[ply+1] and play move there; returns false if the move leaves
// the mover's king attacked (the move is pseudo-legal), and the caller skips it

function make_move(ply, move) {

  const node = nodes[ply + 1];
  const pos  = node.pos;
  const b    = node.board;

  copy_pos(pos, nodes[ply].pos);

  node.acc.set(nodes[ply].acc);

  const stm  = pos.stm;
  const stmi = stm >>> 3;
  const ksq  = pos.kings[stmi];

  const src      = move & 63;
  const dst      = (move >>> 6) & 63;
  const piece    = b[src];
  const ptype    = piece & 7;

  node.cont = piece * 64 + dst;
  const captured = b[dst];
  const placed   = move & PROMO_BIT ? (((move & PROMO_PIECE_MASK) >>> PROMO_PIECE_SHIFT) + KNIGHT) | stm : piece;

  remove_piece(node, piece, src);

  if (captured !== 0)
    remove_piece(node, captured, dst);

  put_piece(node, placed, dst);

  if (move & EP_CAPTURE_BIT) {
    const cap_sq = dst - PAWN_PUSH[stmi];
    remove_piece(node, b[cap_sq], cap_sq);
  }
  else if (move & CASTLE_BIT) {
    const rook     = ROOK | stm;
    const rook_src = dst > src ? src + 3 : src - 4;
    const rook_dst = dst > src ? src + 1 : src - 1;
    remove_piece(node, rook, rook_src);
    put_piece(node, rook, rook_dst);
  }

  if (ptype === KING)
    pos.kings[stmi] = dst;

  hash_rights(pos);
  pos.rights &= RIGHTS_MASK[src] & RIGHTS_MASK[dst];
  hash_rights(pos);

  hash_ep(pos);
  if (ptype === PAWN && (dst - src === 16 || src - dst === 16) && ep_capturable(b, dst, stm ^ BLACK))
    pos.ep = src + PAWN_PUSH[stmi];
  else
    pos.ep = 0;
  hash_ep(pos);

  if (ptype === PAWN || (move & CAPTURE_BIT))
    pos.hmc = 0;
  else
    pos.hmc++;

  pos.stm = stm ^ BLACK;
  hash_stm(pos);

  // only a king move, a move out of check, an ep capture or a piece leaving a line through
  // the king can leave the king attacked, so the others need no test

  if (ptype === KING || nodes[ply].in_check || (move & EP_CAPTURE_BIT) || on_line[ksq * 64 + src])
    return !attacked(b, pos.kings[stmi], stm ^ BLACK, -1);

  return true;

}

// pass the move, for null move pruning
// hmc is reset so repetition scans don't look back across the null move

function make_null(ply) {

  const pos = nodes[ply + 1].pos;

  copy_pos(pos, nodes[ply].pos);

  nodes[ply + 1].acc.set(nodes[ply].acc);

  nodes[ply + 1].cont = -1;

  hash_ep(pos);
  pos.ep = 0;

  pos.hmc = 0;

  pos.stm ^= BLACK;
  hash_stm(pos);

}

//
// iterate
//

// move ordering - generate everything, rank it, then pick the best remaining each time
// the tt move only gets a rank if it was generated, so a stale one is never played

const RANK_TT      = 1 << 30;
const RANK_CAPTURE = 1 << 28;
const RANK_KILLER  = 1 << 26;
const RANK_BAD     = -(1 << 27); // losing captures, below the quiets
const RANK_UNDER   = -(1 << 28);

// static exchange evaluation: the material outcome of the captures on a move's target
// square, each side recapturing with its least valuable attacker and free to stop. pieces
// that have already captured are marked gone (see_gone[sq] === see_stamp) so the sliders
// behind them join in

const SEE_VALUE = [0, 100, 300, 300, 500, 900, 10000];

const see_gain = new Int32Array(32);
const see_gone = new Int32Array(64);
const see_first = new Int8Array(8);  // the first piece on each ray from the target

let see_stamp = 0;
let see_sq    = 0;

// the least valuable colour piece attacking sq that is not gone, as a piece type with see_sq
// set to its square, or 0

function see_attacker(b, sq, colour) {

  const pawn = PAWN | colour;
  const from = pawn_from[colour >>> 3][sq];

  for (let i=0; i < from.length; i++)
    if (b[from[i]] === pawn && see_gone[from[i]] !== see_stamp) {
      see_sq = from[i];
      return PAWN;
    }

  const knight = KNIGHT | colour;
  const kn     = knight_to[sq];

  for (let i=0; i < kn.length; i++)
    if (b[kn[i]] === knight && see_gone[kn[i]] !== see_stamp) {
      see_sq = kn[i];
      return KNIGHT;
    }

  // the first piece still there on each ray, then the cheapest slider among them: a bishop
  // on a diagonal, a rook on a line, a queen on either

  for (let dir=0; dir < 8; dir++) {
    const ray = rays[sq * 8 + dir];
    see_first[dir] = -1;
    for (let i=0; i < ray.length; i++) {
      const s = ray[i];
      if (see_gone[s] === see_stamp)
        continue;
      if (b[s] !== 0) {
        see_first[dir] = s;
        break;
      }
    }
  }

  const bishop = BISHOP | colour;

  for (let dir=4; dir < 8; dir++)
    if (see_first[dir] >= 0 && b[see_first[dir]] === bishop) {
      see_sq = see_first[dir];
      return BISHOP;
    }

  const rook = ROOK | colour;

  for (let dir=0; dir < 4; dir++)
    if (see_first[dir] >= 0 && b[see_first[dir]] === rook) {
      see_sq = see_first[dir];
      return ROOK;
    }

  const queen = QUEEN | colour;

  for (let dir=0; dir < 8; dir++)
    if (see_first[dir] >= 0 && b[see_first[dir]] === queen) {
      see_sq = see_first[dir];
      return QUEEN;
    }

  const king = KING | colour;
  const kg   = king_to[sq];

  for (let i=0; i < kg.length; i++)
    if (b[kg[i]] === king && see_gone[kg[i]] !== see_stamp) {
      see_sq = kg[i];
      return KING;
    }

  return 0;

}

function see(node, move) {

  const b      = node.board;
  const src    = move & 63;
  const dst    = (move >>> 6) & 63;
  const colour = b[src] & BLACK;

  see_stamp++;
  see_gone[src] = see_stamp;

  if (move & EP_CAPTURE_BIT) {
    see_gone[colour === WHITE ? dst - 8 : dst + 8] = see_stamp;
    see_gain[0] = SEE_VALUE[PAWN];
  }
  else {
    see_gain[0] = SEE_VALUE[b[dst] & 7];
  }

  let on_sq = SEE_VALUE[b[src] & 7];
  let side  = colour ^ BLACK;
  let d     = 0;

  while (true) {
    const piece = see_attacker(b, dst, side);
    if (piece === 0)
      break;
    d++;
    see_gain[d] = on_sq - see_gain[d - 1];
    if (Math.max(-see_gain[d - 1], see_gain[d]) < 0)
      break;
    on_sq = SEE_VALUE[piece];
    see_gone[see_sq] = see_stamp;
    side ^= BLACK;
  }

  // each side may decline to recapture, folded back from the last capture to the first

  for (; d > 0; d--)
    see_gain[d - 1] = -Math.max(-see_gain[d - 1], see_gain[d]);

  return see_gain[0];

}

const quiet_history = new Int32Array(16 * 64); // piece * 64 + dst

// gravity keeps entries within +-HISTORY_MAX, well below RANK_KILLER

const HISTORY_MAX = 16384;

function update_history(b, move, bonus) {
  const i = b[move & 63] * 64 + ((move >>> 6) & 63);
  quiet_history[i] += bonus - ((quiet_history[i] * Math.abs(bonus) / HISTORY_MAX) | 0);
}

// continuation history: a quiet move (piece * 64 + dst) given the move one or two plies
// before (node.cont, the move that led to the node, -1 after a null move or at a root);
// the two tables follow quiet_history in scale and gravity

const CONT_SIZE    = 16 * 64;
const cont_history = new Int32Array(2 * CONT_SIZE * CONT_SIZE);

function update_cont(i, bonus) {
  cont_history[i] += bonus - ((cont_history[i] * Math.abs(bonus) / HISTORY_MAX) | 0);
}

function update_quiet(ply, b, move, bonus) {
  const idx = b[move & 63] * 64 + ((move >>> 6) & 63);
  quiet_history[idx] += bonus - ((quiet_history[idx] * Math.abs(bonus) / HISTORY_MAX) | 0);
  const c1 = nodes[ply].cont;
  if (c1 >= 0)
    update_cont(c1 * CONT_SIZE + idx, bonus);
  if (ply > 0) {
    const c2 = nodes[ply - 1].cont;
    if (c2 >= 0)
      update_cont(CONT_SIZE * CONT_SIZE + c2 * CONT_SIZE + idx, bonus);
  }
}

function init_moves(ply, tt_move, captures_only) {

  gen_moves(ply, captures_only);

  const node   = nodes[ply];
  const b      = node.board;
  const moves  = node.moves;
  const ranks  = node.ranks;
  const killer = node.killer;
  const n      = node.num_moves;

  node.tt_move   = tt_move;
  node.next_move = 0;

  const c1 = node.cont;
  const c2 = ply > 0 ? nodes[ply - 1].cont : -1;

  // losing captures rank below the quiets, and in qsearch they are dropped

  let k = 0;

  for (let i=0; i < n; i++) {

    const move = moves[i];
    const src  = move & 63;
    const dst  = (move >>> 6) & 63;

    let rank;

    if (move === tt_move) {
      rank = RANK_TT;
    }
    else if ((move & PROMO_BIT) && (move & PROMO_PIECE_MASK) !== (QUEEN - KNIGHT) << PROMO_PIECE_SHIFT) {
      rank = RANK_UNDER;
    }
    else if (move & PROMO_BIT) {
      const victim = b[dst] & 7;
      rank = RANK_CAPTURE + victim * 8 - PAWN + QUEEN * 8;
    }
    else if (move & CAPTURE_BIT) {
      const victim = move & EP_CAPTURE_BIT ? PAWN : b[dst] & 7;
      rank = victim * 8 - (b[src] & 7);
      if (see(node, move) >= 0)
        rank += RANK_CAPTURE;
      else if (captures_only)
        continue;
      else
        rank += RANK_BAD;
    }
    else if (move === killer) {
      rank = RANK_KILLER;
    }
    else {
      const idx = b[src] * 64 + dst;
      rank = quiet_history[idx];
      if (c1 >= 0)
        rank += cont_history[c1 * CONT_SIZE + idx];
      if (c2 >= 0)
        rank += cont_history[CONT_SIZE * CONT_SIZE + c2 * CONT_SIZE + idx];
    }

    moves[k] = move;
    ranks[k++] = rank;

  }

  node.num_moves = k;

}

// 0 when there are no moves left

function get_move(ply) {

  const node  = nodes[ply];
  const moves = node.moves;
  const ranks = node.ranks;
  const n     = node.num_moves;
  const i     = node.next_move;

  if (i >= n)
    return 0;

  let best = i;
  for (let j=i+1; j < n; j++)
    if (ranks[j] > ranks[best])
      best = j;

  const move = moves[best];
  const rank = ranks[best];

  moves[best] = moves[i];
  ranks[best] = ranks[i];
  moves[i]    = move;
  ranks[i]    = rank;

  node.next_move = i + 1;

  return move;

}

//
// eval
//

// material + piece square tables, tapered between middlegame and endgame by phase
// tables are from white's point of view, laid out as seen with rank 8 at the top

const PIECE_VALUE_MG = [0, 63, 214, 203, 405, 716, 0];
const PIECE_VALUE_EG = [0, 112, 246, 305, 506, 641, 0];
const PHASE          = new Uint8Array([0, 0, 1, 1, 2, 4, 0, 0]);
const MAX_PHASE      = 24;

const PASSED_MG = [0, 7, -2, -22, -12, -26, 0, 0];
const PASSED_EG = [0, 25, 24, 41, 56, 65, 0, 0];
const KNIGHT_MOB_MG = [-34, -18, -9, -4, 0, 4, 8, 12, 13];
const KNIGHT_MOB_EG = [-58, -38, -20, -7, 3, 11, 14, 14, 13];
const BISHOP_MOB_MG = [-32, -21, -12, -5, 1, 5, 8, 9, 10, 12, 16, 19, 23, 25];
const BISHOP_MOB_EG = [-53, -36, -20, -8, 2, 10, 15, 18, 20, 19, 18, 17, 16, 15];
const ROOK_MOB_MG = [-23, -11, -7, -4, -4, -1, 1, 3, 5, 6, 7, 8, 10, 12, 13];
const ROOK_MOB_EG = [-49, -33, -22, -14, -8, -1, 4, 8, 13, 18, 22, 26, 28, 27, 24];
const QUEEN_MOB_MG = [-18, -16, -15, -13, -11, -8, -6, -5, -3, -2, 0, 1, 1, 1, 2, 3, 6, 9, 14, 20, 25, 30, 33, 35, 37, 39, 40, 41];
const QUEEN_MOB_EG = [-105, -90, -75, -60, -45, -32, -20, -10, -2, 4, 9, 15, 19, 23, 25, 27, 27, 25, 21, 15, 9, 3, -4, -11, -17, -24, -31, -38];
const ISOLATED_MG = [-1, -5, -9, -9, -8, -3, -1, 2];
const ISOLATED_EG = [-4, -11, -13, -16, -16, -12, -11, -3];
const BACKWARD_MG = [-7];
const BACKWARD_EG = [-14];
const DOUBLED_MG = [2];
const DOUBLED_EG = [-22];
const SUPPORTED_MG = [23, 20, 16, 12, 13, 18, 25, 31];
const SUPPORTED_EG = [12, 12, 11, 11, 23, 46, 69, 92];
const PHALANX_MG = [4, 4, 5, 9, 20, 33, 46, 60];
const PHALANX_EG = [-6, -3, 1, 12, 34, 64, 94, 125];
const PASSED_FREE_MG = [5, 3, 1, 1, 1, 4, 8, 12];
const PASSED_FREE_EG = [-1, 2, 4, 13, 27, 49, 73, 97];
const PASSED_OWN_KING_MG = [-1, 2, 5, 9, 11, 10, 8, 6];
const PASSED_OWN_KING_EG = [2, -2, -6, -13, -19, -21, -18, -15];
const PASSED_ENEMY_KING_MG = [-3, -3, -3, -4, -8, -8, -4, 0];
const PASSED_ENEMY_KING_EG = [-5, -2, 2, 11, 25, 41, 47, 52];
const KS_OPEN_MG = [-7];
const KS_OPEN_EG = [-1];
const KS_OPEN_Q_MG = [-8];
const KS_OPEN_Q_EG = [0];
const KS_KFILE_MG = [-16];
const KS_KFILE_EG = [2];
const KS_ATTACK_MG = [-3, -1, 2, 5, 10, 14, 18, 23];
const KS_ATTACK_EG = [-2, -1, -1, 0, -1, -2, -3, -3];
const KS_ATT_OPEN_MG = [16];
const KS_ATT_OPEN_EG = [-3];
const KS_QCHECK_MG = [75, 9];
const KS_QCHECK_EG = [9, 7];
const THREAT_PAWN_MG = [46];
const THREAT_PAWN_EG = [10];
const THREAT_MINOR_MG = [32];
const THREAT_MINOR_EG = [-7];
const THREAT_HANG_MG = [15];
const THREAT_HANG_EG = [3];
const IMB_US_MG = [128, 192, 144, 240, 64, 0, -144, -16, -128, 48, -144, -848, 112, -1184, -2656];
const IMB_US_EG = [240, 368, 288, 448, 1072, -784, -384, -848, -1680, 976, -464, -624, -1968, -2688, -8592];
const IMB_THEM_MG = [0, -112, -112, -80, -240, 112, 0, -96, 128, -480, 112, 96, 0, 256, -48, 80, -128, -256, 0, 240, 240, 480, 48, -240, 0];
const IMB_THEM_EG = [0, -256, -240, -448, -944, 256, 0, 160, 16, -64, 240, -160, 0, -80, -576, 448, -16, 80, 0, -896, 944, 64, 576, 896, 0];
const ROOK_FILE_MG = [32, 12];
const ROOK_FILE_EG = [5, 9];
const MINOR_BEHIND_MG = [7];
const MINOR_BEHIND_EG = [18];
const THREAT_PUSH_MG = [21];
const THREAT_PUSH_EG = [16];
const PAWNLESS_FLANK_MG = [27];
const PAWNLESS_FLANK_EG = [-63];
const KS_QCONTACT_MG = [101];
const KS_QCONTACT_EG = [11];
const KS_QDIST_MG = [125, 93, 62, 31, 10, -3, -15, -26];
const KS_QDIST_EG = [15, 10, 6, 2, 2, 1, -2, -3];
const ENDGAME_SCALE = [64, 24, 50, 0, 47];

const PAWN_MG = [
    0,  0,  0,  0,  0,  0,  0,  0,
   16, 21, 16, 51, 53, 46,-28,-57,
    9,  2, 22, 29, 37, 60, 39,  5,
  -16, -7, -6, -4, 12, 10, -5,-16,
  -20,-17,-10, -2,  0, -7,-16,-26,
  -26,-22,-17,-17,-11,-15, -8,-26,
  -18,-14,-11,-13, -9,  7, 11,-20,
    0,  0,  0,  0,  0,  0,  0,  0
];

const PAWN_EG = [
    0,  0,  0,  0,  0,  0,  0,  0,
   62, 79,109, 88, 89, 72,103, 98,
   -2, 16,  0,-15,-13,-16, 10,  7,
   -6,-14,-27,-38,-37,-34,-16,-18,
  -17,-14,-29,-34,-33,-30,-21,-27,
  -21,-18,-25,-19,-19,-21,-23,-30,
  -17,-11,-14,-10, -2,-14,-19,-29,
    0,  0,  0,  0,  0,  0,  0,  0
];

const KNIGHT_MG = [
  -131,-103,-66,-35,-13,-69,-96,-102,
  -34,-17, -1, 14,  9, 33,  4, -2,
  -14, 16, 27, 42, 56, 73, 28, 14,
    4, 23, 34, 55, 37, 67, 32, 33,
   -3, 10, 21, 28, 33, 32, 37, 13,
  -20,  0, 11, 10, 25, 22, 20, -2,
  -28,-15, -5, 11, 12,  7, -1, -3,
  -61,-16,-25, -6,  2,  1,-12,-33
];

const KNIGHT_EG = [
  -57, -4,  8, -2,  5,-11,  0,-75,
  -11,  1,  3, 12,  4,-12, -6,-24,
   -9,  0, 18, 19, 10, -7, -4,-16,
    3,  9, 22, 28, 28, 18, 14, -1,
    7,  4, 21, 24, 27, 19, 12,  8,
  -10, -2,  1, 18, 16, -2, -5,  1,
  -15, -7,  0, -2, -2, -3,-10, -2,
  -15,-28, -4,  0,  2,-12,-21,-13
];

const BISHOP_MG = [
  -21,-42,-50,-73,-77,-60,-41,-41,
  -24,-13,-21,-26, -9, -4,-23,-28,
   -9,  2,  6, 15, 12, 35, 13, 10,
  -14, 21, 13, 30, 28, 27, 26, -7,
   -2, -5,  9, 26, 23, 11,  5, 18,
   -4, 16, 12, 12, 13, 19, 16, 15,
    6, 12, 16,  3, 14, 18, 28, 13,
    1, 20,  2, -4,  6, -5,  9, 12
];

const BISHOP_EG = [
   -3,  7,  7, 12, 17, -1,  7,-10,
   -8,  4,  2,  7, -3,  3,  6, -8,
    5,  3,  9,  3,  8,  5,  6, -4,
    0,  4,  8, 23, 12, 11, -1,  2,
   -8,  5, 14, 16, 12,  8,  5,-19,
   -8,  6,  7,  9, 15,  7,  0,-13,
  -11,-17,-13,  2, -2, -8,-15,-28,
  -23,-17, -6,  1, -3,  2,-15,-32
];

const ROOK_MG = [
    2,-10, -3,  1,  6, 24, 14, 20,
  -13,-16, -1, 14,  6, 34, 20, 37,
  -22,  1, -3, -2, 25, 33, 63, 28,
  -22, -5, -5, -1,  3, 21, 24,  7,
  -32,-28,-19,-13,-12,-14,  9,-11,
  -31,-24,-19,-18, -9,  0, 22,  0,
  -30,-23,-12, -8, -3,  4, 18,-23,
  -12,-11, -7,  3,  7,  7,  3, -6
];

const ROOK_EG = [
   10, 19, 21, 15, 14, 10, 16,  9,
   13, 23, 24, 16, 14,  4,  6, -3,
   12, 10, 10,  8, -3, -5, -9, -9,
   13,  8, 14,  7,  2, -3,  2, -2,
    6, 10,  6,  4,  2,  3, -4, -6,
   -3, -3, -6, -2, -7,-15,-25,-25,
  -11, -6, -8, -9,-15,-20,-29,-18,
   -8, -8, -2,-10,-15,-11,-16,-26
];

const QUEEN_MG = [
  -41,-31,-12,-20,-29,-34, -8,-32,
  -15,-35,-38,-61,-85,-38,-35,  0,
    1, -9,-22,-33,-35,-15,-11, -5,
   -6, -1,-10,-31,-30, -6, -5, -8,
    9, -6, -9, -6, -6, -2,  5,  7,
   13, 14, 12, 12, 14, 23, 31, 21,
   24, 26, 32, 39, 38, 44, 50, 51,
   29, 35, 41, 48, 48, 37, 44, 33
];

const QUEEN_EG = [
   33, 17, 12, 20, 22, 32, -4, 27,
   12, 22, 39, 51, 76, 41, 32, 24,
    0,  3, 21, 35, 50, 35, 14, 10,
   11, 10, 18, 41, 43, 24, 29, 19,
  -16, 16, 16, 27, 20, 12,  4, -1,
  -30,-14, -3, -9, -4,-12,-23,-26,
  -38,-36,-39,-39,-37,-53,-78,-76,
  -36,-43,-43,-37,-50,-45,-55,-57
];

const KING_MG = [
   16, 26,  7, -1,-40,-69,-35, 46,
  -48, -4, -4, 45, 18,-20,  7,-18,
  -52, 27,  9, -8, 20, 57, 34, -5,
  -23,  0, -8,-35,-33,-18,-13,-67,
  -45, -7,-16,-50,-49,-20,-36,-85,
  -10, 18, -2,-10, -1, -1, 16,-23,
   50, 40, 31,  8,  3, 24, 50, 40,
   27, 66, 52,-23, 20, -2, 49, 33
];

const KING_EG = [
  -77,-35,-15, -4, -5, 13,  3,-78,
  -13, 11, 23, 11, 19, 38, 25,  7,
   -3, 14, 25, 32, 38, 27, 27, -4,
  -16,  9, 26, 33, 37, 28, 18, -1,
  -24, -2, 13, 28, 28, 11,  4, -6,
  -35,-18, -3,  5,  5, -5,-17,-24,
  -52,-31,-22,-14,-10,-21,-34,-50,
  -79,-65,-44,-29,-46,-33,-58,-89
];

const MG_TABLES = [null, PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
const EG_TABLES = [null, PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

// piece * 64 + sq, white positive, black negative, value included
// piece 0 stays 0 so empty squares can be summed without a test

const pst_mg = new Int32Array(16 * 64);
const pst_eg = new Int32Array(16 * 64);

for (let ptype=PAWN; ptype <= KING; ptype++) {
  for (let sq=0; sq < 64; sq++) {
    pst_mg[(ptype | WHITE) * 64 + sq] =   PIECE_VALUE_MG[ptype] + MG_TABLES[ptype][sq ^ 56];
    pst_eg[(ptype | WHITE) * 64 + sq] =   PIECE_VALUE_EG[ptype] + EG_TABLES[ptype][sq ^ 56];
    pst_mg[(ptype | BLACK) * 64 + sq] = -(PIECE_VALUE_MG[ptype] + MG_TABLES[ptype][sq]);
    pst_eg[(ptype | BLACK) * 64 + sq] = -(PIECE_VALUE_EG[ptype] + EG_TABLES[ptype][sq]);
  }
}

// tuner features - with TRACE set, evaluate() adds each term's white minus black count
// to trace[feature] and records the phase; pst features are (ptype - 1) * 64 + table index

const F_PST        = 0;
const F_PASSED     = F_PST + 6 * 64;      // + rank from the pawn's side
const F_MOB_KNIGHT = F_PASSED + 8;        // + safe squares
const F_MOB_BISHOP = F_MOB_KNIGHT + 9;
const F_MOB_ROOK   = F_MOB_BISHOP + 14;
const F_MOB_QUEEN  = F_MOB_ROOK + 15;
const F_ISOLATED          = F_MOB_QUEEN + 28;    // + file
const F_BACKWARD          = F_ISOLATED + 8;
const F_DOUBLED           = F_BACKWARD + 1;
const F_SUPPORTED         = F_DOUBLED + 1;       // + rank from the pawn's side
const F_PHALANX           = F_SUPPORTED + 8;     // + rank
const F_PASSED_FREE       = F_PHALANX + 8;       // + rank
const F_PASSED_OWN_KING   = F_PASSED_FREE + 8;   // + rank, counts king distance to the stop square
const F_PASSED_ENEMY_KING = F_PASSED_OWN_KING + 8;
const F_KS_OPEN           = F_PASSED_ENEMY_KING + 8; // open files near own king
const F_KS_OPEN_Q         = F_KS_OPEN + 1;           // the same while the enemy has a queen
const F_KS_KFILE          = F_KS_OPEN_Q + 1;         // own king on a file without own pawns
const F_KS_ATTACK         = F_KS_KFILE + 1;          // + attackers (max 7), counts attack value
const F_KS_ATT_OPEN       = F_KS_ATTACK + 8;         // attackers x open files near the enemy king
const F_KS_QCHECK         = F_KS_ATT_OPEN + 1;       // + 0 when it's our move, 1 when not
const F_THREAT_PAWN       = F_KS_QCHECK + 2;         // our pawns attacking their pieces
const F_THREAT_MINOR      = F_THREAT_PAWN + 1;       // our minors attacking their rooks and queens
const F_THREAT_HANG       = F_THREAT_MINOR + 1;      // their pieces we attack and they don't defend
const F_IMB_US            = F_THREAT_HANG + 1;       // + pair index of our count x our count
const F_IMB_THEM          = F_IMB_US + 15;           // + (i - 1) * 5 + (j - 1): our count i x their count j
const F_ROOK_FILE         = F_IMB_THEM + 25;        // + 0 open (no pawns), 1 semi-open (no own pawns)
const F_MINOR_BEHIND      = F_ROOK_FILE + 2;         // our knights and bishops with a pawn right in front
const F_THREAT_PUSH       = F_MINOR_BEHIND + 1;      // their pieces a safe pawn push of ours would attack
const F_PAWNLESS_FLANK    = F_THREAT_PUSH + 1;       // our king on a flank with no pawns
const F_KS_QCONTACT       = F_PAWNLESS_FLANK + 1;         // squares next to the enemy king our queen attacks, supported, not defended by other than the king
const F_KS_QDIST          = F_KS_QCONTACT + 1;       // + distance from our queen to the enemy king, per queen
const NUM_FEATURES        = F_KS_QDIST + 8;

// endgame scale classes: the eg part of the eval is scaled by ENDGAME_SCALE[class] / 64,
// shrinking it toward a draw in endings the side ahead often can't win (class 0 stays 64)

const SC_NORMAL     = 0;
const SC_OCB        = 1; // opposite coloured bishops and pawns only
const SC_OCB_PIECES = 2; // opposite coloured bishops with other pieces
const SC_NO_PAWNS   = 3; // the side ahead has no pawns and at most a minor's worth more
const SC_ONE_WING   = 4; // all pawns on one wing

// material imbalance pairs: index of the (i, j) pair of piece types PAWN..QUEEN with i <= j

const IMB_UNITS = 16; // the pair weights are stored x16: they act on products of counts

const IMB_PAIR = new Int8Array(36).fill(-1);

for (let i=PAWN, k=0; i <= QUEEN; i++)
  for (let j=i; j <= QUEEN; j++)
    IMB_PAIR[i * 6 + j] = k++;

const imb_count = new Int32Array(16); // piece counts by piece code

// material changes rarely in a search, so the imbalance score is cached by the position's
// material key (P_MAT, piece counts packed into an int, kept up to date by put/remove_piece);
// the score is in IMB_UNITS per centipawn (sixteenths), the units the weights are stored in

const IMB_CACHE_SIZE = 1 << 14;

const imb_keys = new Int32Array(IMB_CACHE_SIZE).fill(-1);
const imb_mgs  = new Int32Array(IMB_CACHE_SIZE);
const imb_egs  = new Int32Array(IMB_CACHE_SIZE);

let imb_mg = 0;
let imb_eg = 0;

// white minus black, into imb_mg and imb_eg, from the position's material key

function imbalance(pos) {

  const key = pos.mat;
  const i   = (key ^ (key >>> 14)) & (IMB_CACHE_SIZE - 1);

  if (!TRACE && imb_keys[i] === key) {
    imb_mg = imb_mgs[i];
    imb_eg = imb_egs[i];
    return;
  }

  const n = imb_count;

  for (let piece=PAWN; piece <= (QUEEN | BLACK); piece++)
    n[piece] = (key >>> MAT_SHIFT[piece]) & ((piece & 7) === PAWN ? 15 : 7);

  imb_mg = 0;
  imb_eg = 0;

  for (let c=0; c < 2; c++) {

    const us   = c << 3;
    const them = us ^ BLACK;

    let i_mg = 0;
    let i_eg = 0;

    for (let i=PAWN; i <= QUEEN; i++) {
      const ni = n[i | us];
      if (ni === 0)
        continue;
      for (let j=i; j <= QUEEN; j++) {
        const v = j === i ? (ni * (ni - 1)) >> 1 : ni * n[j | us];
        if (v === 0)
          continue;
        const k = IMB_PAIR[i * 6 + j];
        i_mg += IMB_US_MG[k] * v;
        i_eg += IMB_US_EG[k] * v;
        if (TRACE)
          trace[F_IMB_US + k] += c ? -v : v;
      }
      for (let j=PAWN; j <= QUEEN; j++) {
        const v = ni * n[j | them];
        if (v === 0)
          continue;
        const k = (i - 1) * 5 + (j - 1);
        i_mg += IMB_THEM_MG[k] * v;
        i_eg += IMB_THEM_EG[k] * v;
        if (TRACE)
          trace[F_IMB_THEM + k] += c ? -v : v;
      }
    }

    if (c) {
      imb_mg -= i_mg;
      imb_eg -= i_eg;
    }
    else {
      imb_mg += i_mg;
      imb_eg += i_eg;
    }
  }

  imb_keys[i] = key;
  imb_mgs[i]  = imb_mg;
  imb_egs[i]  = imb_eg;

}

// king attack value per piece attacking the enemy king zone (based on fruit 2.1's king attack units)

const KS_UNIT = [0, 0, 3, 1, 5, 5, 0];

// per side, filled by the mobility loop: all attacks and queen attacks, for safe checks

// per square the piece types of each colour attacking it, one bit per type (1 << ptype),
// filled by the pawn and piece passes in evaluate and read by the terms; and per colour and
// file the number of pawns and the ranks of the lowest and highest, for the pawn terms

const squares    = new Uint8Array(32);  // the occupied squares, listed once per evaluate for the passes
let   num_squares = 0;
const att        = [new Uint8Array(64), new Uint8Array(64)];
const area       = [new Uint8Array(64), new Uint8Array(64)];  // the mobility area per colour: no own piece, no enemy pawn attack
const ks_open    = new Int32Array(2);   // open files on and beside the king, per colour
const ks_kfile   = new Int32Array(2);   // the king's own file open
const pawn_count = [new Uint8Array(8), new Uint8Array(8)];
const pawn_low   = [new Int8Array(8), new Int8Array(8)];
const pawn_high  = [new Int8Array(8), new Int8Array(8)];

const push_att = new Int32Array(64); // squares the safe pawn pushes of a side would attack, as a stamp
let   push_stamp = 0;

// mobility tables and features by piece type

const MOB_MG = [null, null, KNIGHT_MOB_MG, BISHOP_MOB_MG, ROOK_MOB_MG, QUEEN_MOB_MG];
const MOB_EG = [null, null, KNIGHT_MOB_EG, BISHOP_MOB_EG, ROOK_MOB_EG, QUEEN_MOB_EG];
const F_MOB  = [0, 0, F_MOB_KNIGHT, F_MOB_BISHOP, F_MOB_ROOK, F_MOB_QUEEN];

const trace = new Int16Array(NUM_FEATURES);

let trace_phase = 0;
let trace_class = 0;

// from the side to move's point of view

// the endgame scale class, from the side ahead in the endgame part (counts from the material
// key); the idea of stockfish's endgame scale factors and fruit 2.1's draw multipliers, our
// own classes and tuned scales, the classes distilled from lozza 11's net (its neurons for
// drawish endings)

// is the bishop of this piece code on a light square (rank + file odd)

function bishop_on_light(b, bishop) {
  for (let i=0; i < num_squares; i++) {
    const sq = squares[i];
    if (b[sq] === bishop)
      return (((sq >>> 3) + (sq & 7)) & 1) === 1;
  }
  return false;
}

function scale_class(pos, b, eg) {

  const key    = pos.mat;
  const strong = eg > 0 ? 0 : BLACK;
  const weak   = strong ^ BLACK;

  const sb = (key >>> MAT_SHIFT[BISHOP | strong]) & 7;
  const wb = (key >>> MAT_SHIFT[BISHOP | weak])   & 7;

  const s_other = ((key >>> MAT_SHIFT[KNIGHT | strong]) & 7) + ((key >>> MAT_SHIFT[ROOK | strong]) & 7) + ((key >>> MAT_SHIFT[QUEEN | strong]) & 7);
  const w_other = ((key >>> MAT_SHIFT[KNIGHT | weak])   & 7) + ((key >>> MAT_SHIFT[ROOK | weak])   & 7) + ((key >>> MAT_SHIFT[QUEEN | weak])   & 7);

  // opposite coloured bishops, one each

  if (sb === 1 && wb === 1 && bishop_on_light(b, BISHOP | strong) !== bishop_on_light(b, BISHOP | weak))
    return s_other + w_other === 0 ? SC_OCB : SC_OCB_PIECES;

  // the side ahead has no pawns and at most a minor's worth more

  if (((key >>> MAT_SHIFT[PAWN | strong]) & 15) === 0) {
    const s_npm = ((key >>> MAT_SHIFT[KNIGHT | strong]) & 7) + sb + 2 * ((key >>> MAT_SHIFT[ROOK | strong]) & 7) + 4 * ((key >>> MAT_SHIFT[QUEEN | strong]) & 7);
    const w_npm = ((key >>> MAT_SHIFT[KNIGHT | weak])   & 7) + wb + 2 * ((key >>> MAT_SHIFT[ROOK | weak])   & 7) + 4 * ((key >>> MAT_SHIFT[QUEEN | weak])   & 7);
    if (s_npm - w_npm <= 1)
      return SC_NO_PAWNS;
  }

  // pawns, all on one wing (files a-d or e-h)

  let left  = 0;
  let right = 0;

  for (let f=0; f < 4; f++) {
    left  += pawn_count[0][f]     + pawn_count[1][f];
    right += pawn_count[0][f + 4] + pawn_count[1][f + 4];
  }

  if ((left === 0) !== (right === 0))
    return SC_ONE_WING;

  return SC_NORMAL;

}

// evaluations are cached by the full hash (the tt keeps them too, but only where it keeps an entry)

const EVAL_CACHE_SIZE = 1 << 16;
const EVAL_CACHE_MASK = EVAL_CACHE_SIZE - 1;

const ec_lo   = new Int32Array(EVAL_CACHE_SIZE);
const ec_hi   = new Int32Array(EVAL_CACHE_SIZE);
const ec_eval = new Int32Array(EVAL_CACHE_SIZE);

// the eval is a list of passes over the board: the occupied squares are listed, the pawn pass
// fills the pawn tables and the pawns' attack bits, and each term function adds white minus
// black to ev_mg / ev_eg

let ev_mg = 0;
let ev_eg = 0;

function list_squares(b) {

  // the pieces on the board, listed once for the passes below

  num_squares = 0;

  for (let sq=0; sq < 64; sq++)
    if (b[sq] !== 0)
      squares[num_squares++] = sq;

}

function pawn_pass(b) {

  // the pawn pass: per colour and file the number of own pawns and the ranks of the lowest and
  // highest, and the squares each pawn attacks as the pawn bit of att[]

  att[WHITE_INDEX].fill(0);
  att[BLACK_INDEX].fill(0);

  for (let c=0; c < 2; c++) {
    pawn_count[c].fill(0);
    pawn_low[c].fill(8);
    pawn_high[c].fill(-1);
  }

  for (let i=0; i < num_squares; i++) {

    const sq    = squares[i];
    const piece = b[sq];

    if ((piece & 7) !== PAWN)
      continue;

    const c = piece >>> 3;
    const f = sq & 7;
    const r = sq >>> 3;

    pawn_count[c][f]++;

    if (r < pawn_low[c][f])
      pawn_low[c][f] = r;
    if (r > pawn_high[c][f])
      pawn_high[c][f] = r;

    const targets = pawn_to[c][sq];

    for (let i=0; i < targets.length; i++)
      att[c][targets[i]] |= 1 << PAWN;

  }

}

function pawn_terms(pos, b) {

  let mg = 0;
  let eg = 0;

  // pawn structure and passed pawns, ranks from the pawn's side: isolated, backward, doubled,
  // and connected pawns as supported and phalanx (the idea of stockfish's connected pawns),
  // passers by rank with their free path and king distances. "ahead" is up the board for
  // white and down it for black

  for (let c=0; c < 2; c++) {

    const colour = c << 3;
    const pawn   = PAWN | colour;
    const sign   = c ? -1 : 1;
    const e      = c ^ 1;

    const own_count  = pawn_count[c];
    const own_low    = pawn_low[c];
    const own_high   = pawn_high[c];
    const enemy_low  = pawn_low[e];
    const enemy_high = pawn_high[e];

    const own_k   = pos.kings[c] * 64;
    const enemy_k = pos.kings[e] * 64;

    let pm = 0;
    let pe = 0;

    for (let i=0; i < num_squares; i++) {

      const sq = squares[i];

      if (b[sq] !== pawn)
        continue;

      const f    = sq & 7;
      const rank = sq >>> 3;
      const r    = c ? 7 - rank : rank;
      const stop = c ? sq - 8 : sq + 8;

      // isolated: no own pawn on either neighbouring file; else backward: the neighbouring own
      // pawns are all ahead of it and an enemy pawn attacks the square in front

      const left  = f > 0 ? own_count[f - 1] : 0;
      const right = f < 7 ? own_count[f + 1] : 0;

      if (left + right === 0) {
        pm += ISOLATED_MG[f];
        pe += ISOLATED_EG[f];
        if (TRACE)
          trace[F_ISOLATED + f] += sign;
      }
      else {
        let level_or_behind = false;
        if (c === 0)
          level_or_behind = (f > 0 && own_low[f - 1] <= rank) || (f < 7 && own_low[f + 1] <= rank);
        else
          level_or_behind = (f > 0 && own_high[f - 1] >= rank) || (f < 7 && own_high[f + 1] >= rank);
        if (!level_or_behind && (att[e][stop] & (1 << PAWN)) !== 0) {
          pm += BACKWARD_MG[0];
          pe += BACKWARD_EG[0];
          if (TRACE)
            trace[F_BACKWARD] += sign;
        }
      }

      // doubled: another own pawn ahead on the file

      if (c === 0 ? own_high[f] > rank : own_low[f] < rank) {
        pm += DOUBLED_MG[0];
        pe += DOUBLED_EG[0];
        if (TRACE)
          trace[F_DOUBLED] += sign;
      }

      // supported: an own pawn attacks this square; phalanx: an own pawn beside it

      if ((att[c][sq] & (1 << PAWN)) !== 0) {
        pm += SUPPORTED_MG[r];
        pe += SUPPORTED_EG[r];
        if (TRACE)
          trace[F_SUPPORTED + r] += sign;
      }

      if ((f > 0 && b[sq - 1] === pawn) || (f < 7 && b[sq + 1] === pawn)) {
        pm += PHALANX_MG[r];
        pe += PHALANX_EG[r];
        if (TRACE)
          trace[F_PHALANX + r] += sign;
      }

      // passed: no enemy pawn ahead on its own or the neighbouring files

      let blocked = false;

      for (let g=f-1; g <= f+1; g++) {
        if (g < 0 || g > 7)
          continue;
        if (c === 0 ? enemy_high[g] > rank : enemy_low[g] < rank)
          blocked = true;
      }

      if (blocked)
        continue;

      pm += PASSED_MG[r];
      pe += PASSED_EG[r];
      if (TRACE)
        trace[F_PASSED + r] += sign;

      if (b[stop] === 0) {
        pm += PASSED_FREE_MG[r];
        pe += PASSED_FREE_EG[r];
        if (TRACE)
          trace[F_PASSED_FREE + r] += sign;
      }

      const d_own   = dist[own_k + stop];
      const d_enemy = dist[enemy_k + stop];

      pm += PASSED_OWN_KING_MG[r] * d_own + PASSED_ENEMY_KING_MG[r] * d_enemy;
      pe += PASSED_OWN_KING_EG[r] * d_own + PASSED_ENEMY_KING_EG[r] * d_enemy;

      if (TRACE) {
        trace[F_PASSED_OWN_KING + r]   += sign * d_own;
        trace[F_PASSED_ENEMY_KING + r] += sign * d_enemy;
      }

    }

    if (c) {
      mg -= pm;
      eg -= pe;
    }
    else {
      mg += pm;
      eg += pe;
    }

  }

  ev_mg += mg;
  ev_eg += eg;

}

function king_exposure(pos) {

  let mg = 0;
  let eg = 0;

  // king exposure per side: open files (no own pawns) on and beside the king's file, and
  // whether the king's own file is open

  for (let c=0; c < 2; c++) {

    const kf = pos.kings[c] & 7;

    let open = 0;

    ks_kfile[c] = 0;

    for (let f=kf-1; f <= kf+1; f++) {
      if (f < 0 || f > 7)
        continue;
      if (pawn_count[c][f] === 0) {
        open++;
        if (f === kf)
          ks_kfile[c] = 1;
      }
    }

    ks_open[c] = open;

    // a king on a flank (files a-d, c-f or e-h by its file) with no pawns of either colour
    // (the idea of stockfish's pawnless flank, distilled from lozza 11's net)

    const f0 = kf <= 2 ? 0 : kf <= 4 ? 2 : 4;

    let flank_pawns = 0;

    for (let f=f0; f < f0 + 4; f++)
      flank_pawns += pawn_count[0][f] + pawn_count[1][f];

    if (flank_pawns === 0) {
      if (c) {
        mg -= PAWNLESS_FLANK_MG[0];
        eg -= PAWNLESS_FLANK_EG[0];
      }
      else {
        mg += PAWNLESS_FLANK_MG[0];
        eg += PAWNLESS_FLANK_EG[0];
      }
      if (TRACE)
        trace[F_PAWNLESS_FLANK] += c ? -1 : 1;
    }
  }


  ev_mg += mg;
  ev_eg += eg;
}

function piece_terms(pos, b) {

  let mg = 0;
  let eg = 0;

  // the piece pass: each piece's attacks go into att[] by type (sliders stop at the first
  // piece, which is attacked), and are counted for safe mobility, the squares of the side's
  // area, those holding no own piece and not attacked by an enemy pawn, scored by count (the
  // idea of stockfish's mobility area). pieces attacking the enemy king zone are counted for king safety, based on fruit
  // 2.1's king attack (via lozza 2.5): they give an attack value weighted by a tuned table
  // indexed by the number of attackers (the non-linearity), attackers count more against open
  // files, and own king exposure counts against us, more so while the enemy has a queen. the
  // products (attackers x open files, exposure x enemy queen) and the king on an open file
  // were distilled from lozza 11's net: its pairwise discovery ranked them top of what our
  // eval lacked. rooks on open or half open files and minors behind pawns are scored on the way

  for (let sq=0; sq < 64; sq++) {
    const piece = b[sq];
    area[WHITE_INDEX][sq] = (piece === 0 || (piece & BLACK) !== WHITE) && (att[BLACK_INDEX][sq] & (1 << PAWN)) === 0 ? 1 : 0;
    area[BLACK_INDEX][sq] = (piece === 0 || (piece & BLACK) !== BLACK) && (att[WHITE_INDEX][sq] & (1 << PAWN)) === 0 ? 1 : 0;
  }

  for (let c=0; c < 2; c++) {

    const colour = c << 3;
    const e      = c ^ 1;
    const ek     = pos.kings[e];
    const kz     = ek * 64;

    let mob_mg = 0;
    let mob_eg = 0;

    let attackers = 0;
    let attack    = 0;

    const att_c  = att[c];
    const area_c = area[c];

    for (let i=0; i < num_squares; i++) {

      const sq    = squares[i];
      const piece = b[sq];

      if ((piece & BLACK) !== colour)
        continue;

      const ptype = piece & 7;

      if (ptype === PAWN)
        continue;

      const bit = 1 << ptype;

      if (ptype === KING) {
        const targets = king_to[sq];
        for (let j=0; j < targets.length; j++)
          att_c[targets[j]] |= bit;
        continue;
      }

      let n    = 0;
      let zone = 0;

      if (ptype === KNIGHT) {
        const targets = knight_to[sq];
        for (let j=0; j < targets.length; j++) {
          const t = targets[j];
          att_c[t] |= bit;
          n    += area_c[t];
          zone |= king_zone[kz + t];
        }
      }
      else {
        const d0 = ptype === BISHOP ? 4 : 0;
        const d1 = ptype === ROOK   ? 4 : 8;
        for (let dir=d0; dir < d1; dir++) {
          const ray = rays[sq * 8 + dir];
          for (let j=0; j < ray.length; j++) {
            const t = ray[j];
            att_c[t] |= bit;
            n    += area_c[t];
            zone |= king_zone[kz + t];
            if (b[t] !== 0)
              break;
          }
        }
      }

      mob_mg += MOB_MG[ptype][n];
      mob_eg += MOB_EG[ptype][n];

      if (TRACE)
        trace[F_MOB[ptype] + n] += c ? -1 : 1;

      if (zone) {
        attackers++;
        attack += KS_UNIT[ptype];
      }

      if (ptype === ROOK) {
        // a rook on a file with no own pawn, open or half open (distilled from lozza 11's net)
        const f = sq & 7;
        if (pawn_count[c][f] === 0) {
          const k = pawn_count[e][f] === 0 ? 0 : 1;
          mob_mg += ROOK_FILE_MG[k];
          mob_eg += ROOK_FILE_EG[k];
          if (TRACE)
            trace[F_ROOK_FILE + k] += c ? -1 : 1;
        }
      }
      else if (ptype <= BISHOP) {
        // a minor behind a pawn (the idea of stockfish's minor behind pawn, distilled from
        // lozza 11's net)
        const ahead = c ? sq - 8 : sq + 8;
        if (ahead >= 0 && ahead < 64 && (b[ahead] & 7) === PAWN) {
          mob_mg += MINOR_BEHIND_MG[0];
          mob_eg += MINOR_BEHIND_EG[0];
          if (TRACE)
            trace[F_MINOR_BEHIND] += c ? -1 : 1;
        }
      }
    }

    const at = attackers < 7 ? attackers : 7;

    const own_open  = ks_open[c];
    const own_kfile = ks_kfile[c];
    const enemy_q   = ((pos.mat >>> MAT_SHIFT[QUEEN | (colour ^ BLACK)]) & 7) !== 0 ? 1 : 0;
    const att_open  = attackers * ks_open[e];

    mob_mg += KS_ATTACK_MG[at] * attack + KS_ATT_OPEN_MG[0] * att_open +
              KS_OPEN_MG[0] * own_open + KS_OPEN_Q_MG[0] * own_open * enemy_q + KS_KFILE_MG[0] * own_kfile;
    mob_eg += KS_ATTACK_EG[at] * attack + KS_ATT_OPEN_EG[0] * att_open +
              KS_OPEN_EG[0] * own_open + KS_OPEN_Q_EG[0] * own_open * enemy_q + KS_KFILE_EG[0] * own_kfile;

    if (TRACE) {
      const sign = c ? -1 : 1;
      trace[F_KS_ATTACK + at]  += sign * attack;
      trace[F_KS_ATT_OPEN]     += sign * att_open;
      trace[F_KS_OPEN]         += sign * own_open;
      trace[F_KS_OPEN_Q]       += sign * own_open * enemy_q;
      trace[F_KS_KFILE]        += sign * own_kfile;
    }

    if (c) {
      mg -= mob_mg;
      eg -= mob_eg;
    }
    else {
      mg += mob_mg;
      eg += mob_eg;
    }
  }

  ev_mg += mg;
  ev_eg += eg;

}

function threat_terms(b) {

  let mg = 0;
  let eg = 0;

  // threats (the idea of stockfish's threats, distilled from lozza 11's net): our pawns
  // attacking their pieces, our minors attacking their rooks and queens, their pieces we attack
  // that they don't defend (hanging), and safe pawn pushes: one square forward to an empty
  // square no enemy pawn attacks that we attack or they don't, counting the pieces the pushed
  // pawns would attack (the idea of stockfish's threats by safe pawn pushes, also from the net)

  for (let c=0; c < 2; c++) {

    const colour = c << 3;
    const e      = c ^ 1;
    const them   = e << 3;
    const minors = (1 << KNIGHT) | (1 << BISHOP);

    let pawn  = 0;
    let minor = 0;
    let hang  = 0;
    let push  = 0;

    push_stamp++;

    for (let i=0; i < num_squares; i++) {

      const sq    = squares[i];
      const piece = b[sq];

      if ((piece & BLACK) === colour) {
        if ((piece & 7) === PAWN) {
          const to = c ? sq - 8 : sq + 8;
          if (b[to] === 0 && (att[e][to] & (1 << PAWN)) === 0 && (att[c][to] !== 0 || att[e][to] === 0)) {
            const targets = pawn_to[c][to];
            for (let j=0; j < targets.length; j++) {
              const t  = targets[j];
              const on = b[t];
              if (push_att[t] !== push_stamp && on !== 0 && (on & BLACK) === them && (on & 7) !== PAWN && (on & 7) !== KING)
                push++;
              push_att[t] = push_stamp;
            }
          }
        }
        continue;
      }

      const ptype = piece & 7;

      if (ptype === PAWN || ptype === KING)
        continue;

      if ((att[c][sq] & (1 << PAWN)) !== 0)
        pawn++;
      if (ptype >= ROOK && (att[c][sq] & minors) !== 0)
        minor++;
      if (att[c][sq] !== 0 && att[e][sq] === 0)
        hang++;
    }

    const t_mg = THREAT_PAWN_MG[0] * pawn + THREAT_MINOR_MG[0] * minor + THREAT_HANG_MG[0] * hang + THREAT_PUSH_MG[0] * push;
    const t_eg = THREAT_PAWN_EG[0] * pawn + THREAT_MINOR_EG[0] * minor + THREAT_HANG_EG[0] * hang + THREAT_PUSH_EG[0] * push;

    if (c) {
      mg -= t_mg;
      eg -= t_eg;
    }
    else {
      mg += t_mg;
      eg += t_eg;
    }

    if (TRACE) {
      const sign = c ? -1 : 1;
      trace[F_THREAT_PAWN]  += sign * pawn;
      trace[F_THREAT_MINOR] += sign * minor;
      trace[F_THREAT_HANG]  += sign * hang;
      trace[F_THREAT_PUSH]  += sign * push;
    }
  }

  ev_mg += mg;
  ev_eg += eg;

}

function queen_terms(pos, b) {

  let mg = 0;
  let eg = 0;

  // the queen against the enemy king: safe checks (squares from which our queen would check
  // their king, that it attacks, that hold no own piece and that they do not attack; worth
  // more when it is our move to give them: distilled from lozza 11's net, a safe check counts
  // when you can give it), contact (squares next to their king our queen attacks, defended by
  // nothing but their king and attacked by another of our pieces too) and how close our
  // queens are to their king (both read off the neurons our other terms could not explain)

  for (let c=0; c < 2; c++) {

    const colour = c << 3;
    const e      = c ^ 1;
    const ek     = pos.kings[e];
    const queen  = QUEEN | colour;

    let queens = 0;
    let qd_mg  = 0;
    let qd_eg  = 0;

    for (let i=0; i < num_squares; i++) {
      const sq = squares[i];
      if (b[sq] === queen) {
        queens++;
        const d = dist[sq * 64 + ek];
        qd_mg += KS_QDIST_MG[d];
        qd_eg += KS_QDIST_EG[d];
        if (TRACE)
          trace[F_KS_QDIST + d] += c ? -1 : 1;
      }
    }

    if (queens !== 0) {

      let qc = 0;

      const zone = king_to[ek];

      for (let i=0; i < zone.length; i++) {
        const s    = zone[i];
        const on_s = b[s];
        if ((att[c][s] & (1 << QUEEN)) !== 0 && (on_s === 0 || (on_s & BLACK) !== colour) &&
            (att[e][s] & ~(1 << KING)) === 0 && (att[c][s] & ~(1 << QUEEN)) !== 0)
          qc++;
      }

      qd_mg += KS_QCONTACT_MG[0] * qc;
      qd_eg += KS_QCONTACT_EG[0] * qc;

      if (TRACE)
        trace[F_KS_QCONTACT] += c ? -qc : qc;

      if (c) {
        mg -= qd_mg;
        eg -= qd_eg;
      }
      else {
        mg += qd_mg;
        eg += qd_eg;
      }
    }

    if (queens === 0)
      continue;

    // the check squares are the rays from their king out to the first piece, which counts
    // when it is one of theirs

    let n = 0;

    for (let dir=0; dir < 8; dir++) {
      const ray = rays[ek * 8 + dir];
      for (let i=0; i < ray.length; i++) {
        const s    = ray[i];
        const on_s = b[s];
        if (on_s === 0 || (on_s & BLACK) !== colour) {
          if ((att[c][s] & (1 << QUEEN)) !== 0 && att[e][s] === 0)
            n++;
        }
        if (on_s !== 0)
          break;
      }
    }

    if (n !== 0) {
      const k = (pos.stm >>> 3) === c ? 0 : 1;
      if (c) {
        mg -= KS_QCHECK_MG[k] * n;
        eg -= KS_QCHECK_EG[k] * n;
      }
      else {
        mg += KS_QCHECK_MG[k] * n;
        eg += KS_QCHECK_EG[k] * n;
      }
      if (TRACE)
        trace[F_KS_QCHECK + k] += c ? -n : n;
    }
  }

  ev_mg += mg;
  ev_eg += eg;

}

// the net's score from the side to move's view, through the eval cache

function evaluate(ply) {

  const node = nodes[ply];
  const pos  = node.pos;

  const ec = pos.lo & EVAL_CACHE_MASK;

  if (ec_lo[ec] === pos.lo && ec_hi[ec] === pos.hi)
    return ec_eval[ec];

  let e = net_eval(node.acc, pos.stm) | 0;

  e = (e / NET_QA) | 0;
  e = (e + net_o_b) | 0;
  e = Math.imul(e, NET_SCALE) | 0;
  e = (e / NET_QAB) | 0;

  ec_lo[ec]   = pos.lo;
  ec_hi[ec]   = pos.hi;
  ec_eval[ec] = e;

  return e;

}

function evaluate_hce(ply) {

  const pos = nodes[ply].pos;
  const b   = nodes[ply].board;

  const ec = pos.lo & EVAL_CACHE_MASK;

  if (!TRACE && ec_lo[ec] === pos.lo && ec_hi[ec] === pos.hi)
    return ec_eval[ec];

  // the piece square sums and phase are kept up to date by put_piece and remove_piece

  let mg    = pos.mg;
  let eg    = pos.eg;
  let phase = pos.phase;

  if (TRACE) {
    for (let sq=0; sq < 64; sq++) {
      const piece = b[sq];
      if (piece !== 0) {
        const black = piece & BLACK;
        trace[F_PST + ((piece & 7) - 1) * 64 + (black ? sq : sq ^ 56)] += black ? -1 : 1;
      }
    }
  }

  list_squares(b);
  pawn_pass(b);

  ev_mg = 0;
  ev_eg = 0;

  pawn_terms(pos, b);
  king_exposure(pos);
  piece_terms(pos, b);

  // material imbalance, quadratic in piece counts: for each pair of piece types a weight on
  // our count x our count and on our count x their count (the idea of stockfish's material
  // imbalance, our own weights; the need for it was distilled from lozza 11's net, which valued
  // queen imbalances two pawns differently from us); a type with itself counts pairs, n (n - 1) / 2, which is 0
  // for one piece so it can't trade value with the piece value itself (and bishop x bishop
  // is the bishop pair); the result (imb_mg, imb_eg) is in sixteenths of a centipawn

  imbalance(pos);

  threat_terms(b);
  queen_terms(pos, b);

  mg += ev_mg;
  eg += ev_eg;

  if (phase > MAX_PHASE)
    phase = MAX_PHASE;

  const sc = scale_class(pos, b, eg * IMB_UNITS + imb_eg);

  if (TRACE) {
    trace_phase = phase;
    trace_class = sc;
  }

  // the imbalance is in finer units and joins here, so nothing is truncated before the taper

  const e = (((mg * IMB_UNITS + imb_mg) * phase + (eg * IMB_UNITS + imb_eg) * (MAX_PHASE - phase) * ENDGAME_SCALE[sc] / 64) / (MAX_PHASE * IMB_UNITS)) | 0;

  const v = pos.stm === WHITE ? e : -e;

  ec_lo[ec]   = pos.lo;
  ec_hi[ec]   = pos.hi;
  ec_eval[ec] = v;

  return v;

}

//
// tt
//

// transposition table - indexed by the lo hash, verified with the hi hash, always replace
// mate scores are stored relative to the node and converted back on the way out

const TT_EXACT = 1;
const TT_LOWER = 2; // score >= beta
const TT_UPPER = 3; // score <= alpha

const TT_ENTRY_BYTES = 14;

// the static eval is cached in the entry; it depends only on the position, so a hit at any
// depth can use it; in check there is none

const TT_NO_EVAL = -32768;

let tt_mask   = 0;
let tt_checks = null;
let tt_moves  = null;
let tt_scores = null;
let tt_depths = null;
let tt_flags  = null;
let tt_evals  = null;

function tt_resize(mb) {

  let entries = 1;
  while (entries * 2 * TT_ENTRY_BYTES <= mb * 1024 * 1024)
    entries *= 2;

  tt_mask   = entries - 1;
  tt_checks = new Int32Array(entries);
  tt_moves  = new Uint32Array(entries);
  tt_scores = new Int16Array(entries);
  tt_depths = new Uint8Array(entries);
  tt_flags  = new Uint8Array(entries);
  tt_evals  = new Int16Array(entries);

}

function tt_clear() {

  for (let i=0; i <= MAX_PLY; i++)
    nodes[i].killer = 0;

  quiet_history.fill(0);
  cont_history.fill(0);
  tt_flags.fill(0);
  corr_pawn.fill(0);
}

// correction history: how far the static eval has been off at positions with the same pawn
// structure and side to move, learnt from search results and added back to the static eval;
// entries are a running average in 1/CORR_GRAIN of a centipawn

const CORR_SIZE  = 1 << 14;
const CORR_GRAIN = 256;
const CORR_MAX   = CORR_GRAIN * 32;

const corr_pawn = new Int32Array(2 * CORR_SIZE);

function corr_index(pos) {
  let h = Math.imul(pos.pk_lo ^ 0x2545f491, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15) ^ pos.pk_hi, 0x85ebca6b);
  h ^= h >>> 13;
  return (pos.stm >>> 3) * CORR_SIZE + (h & (CORR_SIZE - 1));
}

function corrected(pos, ev) {
  const v = ev + ((corr_pawn[corr_index(pos)] / CORR_GRAIN) | 0);
  return v > MATE - MAX_PLY - 1 ? MATE - MAX_PLY - 1 : v < -MATE + MAX_PLY + 1 ? -MATE + MAX_PLY + 1 : v;
}

function corr_update(pos, depth, diff) {
  const i = corr_index(pos);
  const w = depth + 1 < 16 ? depth + 1 : 16;
  const v = ((corr_pawn[i] * (256 - w) + diff * CORR_GRAIN * w) / 256) | 0;
  corr_pawn[i] = v > CORR_MAX ? CORR_MAX : v < -CORR_MAX ? -CORR_MAX : v;
}

// per mille of the first 1000 entries in use

function tt_hashfull() {
  let n = 0;
  for (let i=0; i < 1000; i++)
    if (tt_flags[i] !== 0)
      n++;
  return n;
}

// index of the entry for pos, or -1

function tt_get(pos) {

  const i = pos.lo & tt_mask;

  if (tt_flags[i] !== 0 && tt_checks[i] === pos.hi)
    return i;

  return -1;

}

function tt_score(i, ply) {

  const score = tt_scores[i];

  if (score > MATE - MAX_PLY)
    return score - ply;

  if (score < -MATE + MAX_PLY)
    return score + ply;

  return score;

}

// qsearch entries (depth 0) never replace one from the main search

function tt_put(pos, ply, depth, flag, score, move, ev) {

  const i = pos.lo & tt_mask;

  if (depth === 0 && tt_flags[i] !== 0 && tt_depths[i] > 0)
    return;

  if (score > MATE - MAX_PLY)
    score += ply;
  else if (score < -MATE + MAX_PLY)
    score -= ply;

  tt_checks[i] = pos.hi;
  tt_moves[i]  = move;
  tt_scores[i] = score;
  tt_depths[i] = depth;
  tt_flags[i]  = flag;
  tt_evals[i]  = ev;

}

tt_resize(16);

//
// search
//

const INF  = 30000;
const MATE = 29000; // mate at ply p scores MATE - p

const RFP_DEPTH  = 8;
const RFP_MARGIN = 113;

const FUTILITY_DEPTH  = 3;
const FUTILITY_MARGIN = 113;

// late move pruning: at depth <= LMP_DEPTH, quiets after LMP_MOVES x depth are skipped

const LMP_DEPTH = 2;
const LMP_MOVES = 5;

// see pruning: at depth <= SEEP_DEPTH, losing captures after the first move are skipped

const SEEP_DEPTH = 2;

// aspiration windows from this depth: the last score +- delta, widened on the failing side
// with delta doubling, and fully open once delta passes the max

const ASP_DEPTH = 4;
const ASP_DELTA = 34;
const ASP_MAX   = 567;

// time per move: alloc = left / moves to go + TIME_INC% of the increment; no new iteration
// after TIME_SOFT% of alloc, abort at TIME_HARD% of alloc but never past TIME_CAP% of what's left

// singular extensions from this depth: the other moves are searched at half depth against
// the tt score minus SE_MARGIN per ply; if none get there the tt move is extended

const SE_DEPTH  = 8;
const SE_MARGIN = 2;

const TIME_MTG  = 30;
const TIME_SOFT = 50;
const TIME_HARD = 300;
const TIME_CAP  = 50;
const TIME_INC  = 50;

// late move reductions by depth and move number

const lmr_table = new Uint8Array(64 * 64);

for (let d=1; d < 64; d++)
  for (let m=1; m < 64; m++)
    lmr_table[d * 64 + m] = (0.75 + Math.log(d) * Math.log(m) / 2.25) | 0;

let search_nodes = 0;
let sel_depth    = 0;
let stop_search  = false;
let stop_time    = Infinity;
let stop_nodes   = Infinity;
let limits_on    = false;
let root_move    = 0;

// MultiPV (the MultiPV uci option, 1-10): the root is searched once per line per iteration, each
// time with the first moves of the lines already found excluded, so the lines are the best
// moves in order; the search skips excluded root moves and stores nothing in the tt for a
// root with exclusions, as it does for a singular verification search

let multi_pv = 1;

const root_excluded   = new Uint32Array(10);
let   root_excluded_n = 0;

function root_is_excluded(move) {
  for (let i=0; i < root_excluded_n; i++)
    if (root_excluded[i] === move)
      return true;
  return false;
}

// contempt (the Contempt uci option, cp): a draw is worth -contempt to the side the engine
// plays (the side to move at the root) and +contempt to the other

let contempt = 0;
let root_stm = WHITE;

function draw_score(pos) {
  return pos.stm === root_stm ? -contempt : contempt;
}

// set when a stop command arrives at a yield during a search (uci_poll); go clears it

let stop_flag = false;

// limits are off until depth 1 completes so there is always a move to play

function check_limits() {

  if (!limits_on)
    return;

  if (search_nodes >= stop_nodes)
    stop_search = true;
  else if ((search_nodes & 1023) === 0 && performance.now() >= stop_time)
    stop_search = true;

}

// scan back over the positions since the last irreversible move, same side to move only

function is_repetition(ply) {

  const pos  = nodes[ply].pos;
  const cur  = rep_root + ply;
  const last = Math.max(0, cur - pos.hmc);

  for (let i=cur-4; i >= last; i -= 2)
    if (rep_lo[i] === pos.lo && rep_hi[i] === pos.hi)
      return true;

  return false;

}

// bare kings, or a king and one minor against a king

function material_draw(pos) {

  const key = pos.mat;

  if (((key >>> MAT_SHIFT[PAWN]) & 15) !== 0 || ((key >>> MAT_SHIFT[PAWN | BLACK]) & 15) !== 0)
    return false;

  const majors = ((key >>> MAT_SHIFT[ROOK]) & 7) + ((key >>> MAT_SHIFT[QUEEN]) & 7) +
                 ((key >>> MAT_SHIFT[ROOK | BLACK]) & 7) + ((key >>> MAT_SHIFT[QUEEN | BLACK]) & 7);

  if (majors !== 0)
    return false;

  const minors = ((key >>> MAT_SHIFT[KNIGHT]) & 7) + ((key >>> MAT_SHIFT[BISHOP]) & 7) +
                 ((key >>> MAT_SHIFT[KNIGHT | BLACK]) & 7) + ((key >>> MAT_SHIFT[BISHOP | BLACK]) & 7);

  return minors <= 1;

}

// null move is unsafe in pawn endings because of zugzwang

function has_pieces(b, colour) {

  for (let sq=0; sq < 64; sq++) {
    const piece = b[sq];
    const ptype = piece & 7;
    if ((piece & 8) === colour && ptype >= KNIGHT && ptype <= QUEEN)
      return true;
  }

  return false;

}

function qsearch(ply, alpha, beta) {

  search_nodes++;
  check_limits();

  if (ply > sel_depth)
    sel_depth = ply;

  const node = nodes[ply];
  const pos  = node.pos;

  node.pv_len = 0;

  if (ply >= MAX_PLY - 1)
    return evaluate(ply);

  if (material_draw(pos))
    return draw_score(pos);

  // any tt entry is deep enough for qsearch

  let tt_move = 0;

  const ti = tt_get(pos);

  if (ti >= 0) {
    tt_move = tt_moves[ti];
    const score = tt_score(ti, ply);
    const flag  = tt_flags[ti];
    if (flag === TT_EXACT || (flag === TT_LOWER && score >= beta) || (flag === TT_UPPER && score <= alpha))
      return score;
  }

  const in_check = is_in_check(node);

  // in check every move is generated and there is no standing pat

  const raw = in_check ? TT_NO_EVAL : ti >= 0 && tt_evals[ti] !== TT_NO_EVAL ? tt_evals[ti] : evaluate(ply);
  const ev  = in_check ? TT_NO_EVAL : corrected(pos, raw);

  const alpha_in = alpha;

  let best = -INF;

  if (!in_check) {
    best = ev;
    if (best >= beta) {
      tt_put(pos, ply, 0, TT_LOWER, best, 0, raw);
      return best;
    }
    if (best > alpha)
      alpha = best;
  }

  init_moves(ply, tt_move, !in_check);

  let best_move = 0;
  let legal     = 0;
  let move;

  while ((move = get_move(ply)) !== 0) {

    if (!make_move(ply, move))
      continue;

    legal++;

    const score = -qsearch(ply + 1, -beta, -alpha);

    if (stop_search)
      return 0;

    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha     = score;
        best_move = move;
        if (score >= beta)
          break;
      }
    }
  }

  if (in_check && legal === 0)
    best = -MATE + ply;

  const flag = best >= beta ? TT_LOWER : best > alpha_in ? TT_EXACT : TT_UPPER;

  tt_put(pos, ply, 0, flag, best, best_move, raw);

  return best;

}

function search(ply, depth, alpha, beta) {

  const node = nodes[ply];
  const pos  = node.pos;
  const b    = node.board;

  node.pv_len = 0;

  rep_set(rep_root + ply, pos);

  if (ply > 0 && (pos.hmc >= 100 || is_repetition(ply) || material_draw(pos)))
    return draw_score(pos);

  if (ply >= MAX_PLY - 1)
    return evaluate(ply);

  // mate distance pruning - nothing here can beat a mate already found nearer the root

  if (ply > 0) {
    if (alpha < -MATE + ply)
      alpha = -MATE + ply;
    if (beta > MATE - ply - 1)
      beta = MATE - ply - 1;
    if (alpha >= beta)
      return alpha;
  }

  const in_check = is_in_check(node);

  if (in_check)
    depth++;

  if (depth <= 0)
    return qsearch(ply, alpha, beta);

  search_nodes++;
  check_limits();

  if (ply > sel_depth)
    sel_depth = ply;

  // pv nodes have an open window; everything else is searched with a null window
  // tt cutoffs only happen off the pv so the pv stays whole

  const pv_node  = beta - alpha > 1;
  const excluded = node.excluded;

  let tt_move = 0;

  const ti = tt_get(pos);

  if (ti >= 0) {
    tt_move = tt_moves[ti];
    if (!pv_node && excluded === 0 && tt_depths[ti] >= depth) {
      const score = tt_score(ti, ply);
      const flag  = tt_flags[ti];
      if (flag === TT_EXACT || (flag === TT_LOWER && score >= beta) || (flag === TT_UPPER && score <= alpha))
        return score;
    }
  }

  // static eval, and whether it's up on two plies ago (same side to move); in check there
  // is no eval, which counts as -INF so the next but one ply is improving

  const raw = in_check ? -INF : ti >= 0 && tt_evals[ti] !== TT_NO_EVAL ? tt_evals[ti] : evaluate(ply);
  const ev  = in_check ? -INF : corrected(pos, raw);

  node.eval = ev;

  const improving = !in_check && (ply < 2 || ev > nodes[ply - 2].eval) ? 1 : 0;

  // reverse futility - at low depth a static eval well above beta is trusted

  if (!pv_node && !in_check && excluded === 0 && depth <= RFP_DEPTH && beta < MATE - MAX_PLY && ev - (depth - improving) * RFP_MARGIN >= beta)
    return ev;

  // null move - if passing still fails high, a real move almost certainly will

  if (!pv_node && !in_check && excluded === 0 && depth >= 3 && ev >= beta && has_pieces(b, pos.stm)) {
    make_null(ply);
    const r     = 3 + (depth >> 2);
    const score = -search(ply + 1, depth - 1 - r, -beta, -beta + 1);
    if (stop_search)
      return 0;
    if (score >= beta)
      return score > MATE - MAX_PLY ? beta : score;
  }

  // singular extension: when the tt move looks much better than everything else, it is
  // probably the only move, and the only move deserves a deeper look. the test is a reduced
  // search of this node with the tt move excluded against a bar some way below the tt score:
  // if nothing reaches the bar the tt move is singular and gets one more ply. if the others
  // reach the bar and the bar is already above beta, several moves beat beta and the node
  // can be cut right away (multi-cut). the verification search runs at this same ply, before
  // this node generates its moves

  let extension = 0;

  if (ply > 0 && excluded === 0 && depth >= SE_DEPTH && tt_move !== 0 && tt_depths[ti] >= depth - 3 &&
      (tt_flags[ti] === TT_LOWER || tt_flags[ti] === TT_EXACT)) {

    const tt_s = tt_score(ti, ply);

    if (tt_s > -MATE + MAX_PLY && tt_s < MATE - MAX_PLY) {

      const s_beta = tt_s - SE_MARGIN * depth;

      node.excluded = tt_move;
      const score = search(ply, (depth - 1) >> 1, s_beta - 1, s_beta);
      node.excluded = 0;
      node.pv_len   = 0;

      if (stop_search)
        return 0;

      if (score < s_beta)
        extension = 1;
      else if (s_beta >= beta)
        return s_beta;
    }
  }

  init_moves(ply, ply === 0 ? root_move : tt_move, false);

  const alpha_in = alpha;

  let best       = -INF;
  let best_move  = 0;
  let legal      = 0;
  let num_played = 0;
  let move;

  while ((move = get_move(ply)) !== 0) {

    if (move === excluded)
      continue;

    if (ply === 0 && root_excluded_n !== 0 && root_is_excluded(move))
      continue;

    // see pruning - at the lowest depths, after the first move, losing captures are skipped
    // (they were ranked below the quiets by their see)

    if (!pv_node && !in_check && depth <= SEEP_DEPTH && legal > 0 && alpha > -MATE + MAX_PLY &&
        node.ranks[node.next_move - 1] < RANK_BAD + RANK_KILLER && node.ranks[node.next_move - 1] > RANK_UNDER)
      continue;

    // late move pruning - at the lowest depths, once enough quiets have been tried, skip the rest

    if (!pv_node && !in_check && depth <= LMP_DEPTH && num_played > LMP_MOVES * depth &&
        (move & (CAPTURE_BIT | PROMO_BIT)) === 0 && alpha > -MATE + MAX_PLY)
      continue;

    if (!make_move(ply, move))
      continue;

    legal++;

    const quiet = (move & (CAPTURE_BIT | PROMO_BIT)) === 0;
    const new_depth = depth - 1 + (move === tt_move ? extension : 0);

    // futility - at low depth a quiet move that doesn't give check can't lift a static eval
    // this far below alpha

    if (!pv_node && !in_check && depth <= FUTILITY_DEPTH && legal > 1 && quiet &&
        alpha > -MATE + MAX_PLY && alpha < MATE - MAX_PLY && ev + FUTILITY_MARGIN * depth <= alpha &&
        !is_in_check(nodes[ply + 1])) {
      node.played[num_played++] = move;
      continue;
    }

    let score;

    if (legal === 1) {
      score = -search(ply + 1, new_depth, -beta, -alpha);
    }
    else {

      // late moves (quiet or capturing, not promotions) are searched shallower first and only
      // re-searched if they beat alpha

      let r = 0;

      if ((quiet || (move & PROMO_BIT) === 0) && !in_check && depth >= 3 && legal > 3) {
        r = lmr_table[Math.min(depth, 63) * 64 + Math.min(legal, 63)];
        if (pv_node)
          r--;
        if (r > depth - 2)
          r = depth - 2;
        if (r < 0)
          r = 0;
      }

      score = -search(ply + 1, new_depth - r, -alpha - 1, -alpha);

      if (r > 0 && score > alpha)
        score = -search(ply + 1, new_depth, -alpha - 1, -alpha);

      if (score > alpha && score < beta)
        score = -search(ply + 1, new_depth, -beta, -alpha);
    }

    if (stop_search)
      return 0;

    if (score > best) {

      best = score;

      if (score > alpha) {

        alpha     = score;
        best_move = move;

        const child = nodes[ply + 1];
        node.pv[0] = move;
        for (let i=0; i < child.pv_len; i++)
          node.pv[i + 1] = child.pv[i];
        node.pv_len = child.pv_len + 1;

        if (score >= beta) {
          if (quiet) {
            node.killer = move;
            const bonus = depth * depth;
            update_quiet(ply, b, move, bonus);
            for (let i=0; i < num_played; i++)
              update_quiet(ply, b, node.played[i], -bonus);
          }
          break;
        }
      }
    }

    if (quiet)
      node.played[num_played++] = move;
  }

  // with the tt move excluded and nothing else legal, the tt move is singular

  if (legal === 0)
    best = excluded !== 0 ? alpha : in_check ? -MATE + ply : draw_score(pos);

  // a verification search with a move excluded must not store its partial result, nor a root
  // searching a later MultiPV line

  if (excluded !== 0 || (ply === 0 && root_excluded_n !== 0))
    return best;

  // on a fail low there is no best move, so keep the one we had

  const flag = best >= beta ? TT_LOWER : best > alpha_in ? TT_EXACT : TT_UPPER;

  // the static eval was off by best - raw where the search result is trustworthy: a quiet
  // or no best move, and not a bound on the wrong side of the eval

  if (!in_check && (best_move & (CAPTURE_BIT | PROMO_BIT)) === 0 && best > -MATE + MAX_PLY && best < MATE - MAX_PLY &&
      !(flag === TT_LOWER && best <= ev) && !(flag === TT_UPPER && best >= ev))
    corr_update(pos, depth, best - raw);

  tt_put(pos, ply, depth, flag, best, best_move || tt_move, in_check ? TT_NO_EVAL : raw);

  return best;

}

function score_to_uci(score) {

  if (score > MATE - MAX_PLY)
    return 'mate ' + ((MATE - score + 1) >> 1);

  if (score < -MATE + MAX_PLY)
    return 'mate ' + -((MATE + score + 1) >> 1);

  return 'cp ' + score;

}

// iterative deepening from nodes[0], returns the best move or 0 if there are no moves
// soft_ms: don't start another iteration after this, hard_ms: abort the search
// the search itself is synchronous; between root searches the host gets a turn (uci_yield), so
// a stop or isready sent during a search is seen at the next yield

async function go(max_depth, max_nodes, soft_ms, hard_ms) {

  const start = performance.now();

  search_nodes = 0;
  sel_depth    = 0;
  stop_search  = false;
  stop_flag    = false;
  stop_time    = start + hard_ms;
  stop_nodes   = max_nodes;
  limits_on    = false;
  root_move    = 0;
  root_stm     = nodes[0].pos.stm;

  // history and killers carry over from the last search of this game, history halved

  for (let i=0; i < quiet_history.length; i++)
    quiet_history[i] >>= 1;

  for (let i=0; i < cont_history.length; i++)
    cont_history[i] >>= 1;

  // the lines: a score, a first move and a pv each; multi is the lines asked for, capped by the
  // legal moves

  const multi      = Math.min(multi_pv, Math.max(1, legal_moves(0)));
  const line_score = new Int32Array(multi);
  const line_move  = new Uint32Array(multi);
  const line_pv    = [];
  const line_len   = new Int32Array(multi);

  for (let k=0; k < multi; k++)
    line_pv.push(new Uint32Array(MAX_PLY));

  for (let depth=1; depth <= max_depth; depth++) {

    let done = 0;

    for (let k=0; k < multi; k++) {

      // the lines found so far at this depth are excluded; the line's own first move from the
      // last depth is tried first

      root_excluded_n = k;
      for (let i=0; i < k; i++)
        root_excluded[i] = line_move[i];

      root_move = line_move[k];

      let score = line_score[k];
      let alpha = -INF;
      let beta  = INF;
      let delta = ASP_DELTA;

      if (depth >= ASP_DEPTH) {
        alpha = Math.max(score - delta, -INF);
        beta  = Math.min(score + delta, INF);
      }

      while (true) {

        score = search(0, depth, alpha, beta);

        if (stop_search)
          break;

        if (score <= alpha)
          alpha = Math.max(score - delta, -INF);
        else if (score >= beta)
          beta = Math.min(score + delta, INF);
        else
          break;

        delta *= 2;

        if (delta > ASP_MAX) {
          alpha = -INF;
          beta  = INF;
        }

        await uci_yield();

        if (stop_search)
          break;
      }

      if (stop_search)
        break;

      const root = nodes[0];

      line_score[k] = score;
      line_move[k]  = root.pv_len ? root.pv[0] : 0;
      line_len[k]   = root.pv_len;
      line_pv[k].set(root.pv.subarray(0, root.pv_len));

      done++;
    }

    root_excluded_n = 0;

    if (stop_search)
      break;

    // the lines in score order (the exclusions make line k the best of the rest, so they are
    // already in order; sorting guards the ties), the first is the move to play

    const order = [];
    for (let k=0; k < multi; k++)
      order.push(k);
    order.sort((a, b) => line_score[b] - line_score[a]);

    root_move = line_move[order[0]];

    const elapsed = performance.now() - start;

    for (let n=0; n < multi; n++) {
      const k = order[n];
      let pv = '';
      for (let i=0; i < line_len[k]; i++)
        pv += ' ' + move_to_uci(line_pv[k][i]);
      uci_send('info depth ' + depth +
               ' seldepth ' + sel_depth +
               (multi > 1 ? ' multipv ' + (n + 1) : '') +
               ' score ' + score_to_uci(line_score[k]) +
               ' nodes ' + search_nodes +
               ' time ' + Math.round(elapsed) +
               ' nps ' + Math.round(search_nodes * 1000 / (elapsed || 1)) +
               ' hashfull ' + tt_hashfull() +
               ' pv' + pv);
    }

    const score = line_score[order[0]];

    if (root_move === 0 || elapsed >= soft_ms || search_nodes >= max_nodes)
      break;

    // a mate found within the depth searched won't get any shorter

    if ((score > MATE - MAX_PLY || score < -MATE + MAX_PLY) && MATE - Math.abs(score) <= depth)
      break;

    limits_on = true;

    await uci_yield();

    if (stop_search)
      break;
  }

  root_excluded_n = 0;

  return root_move;

}

//
// perft
//

function perft(ply, depth) {

  if (depth === 0)
    return 1;

  init_moves(ply, 0, false);

  let total = 0;
  let move;

  while ((move = get_move(ply)) !== 0) {
    if (make_move(ply, move))
      total += perft(ply + 1, depth - 1);
  }

  return total;

}

//
// bench
//

// fixed depth searches from a cleared tt; the total node count is a fingerprint of the search
// (identical counts mean a change didn't alter it), the format is what test frameworks parse

const BENCH_DEPTH = 10;

// the positions are ethereal's bench set

const BENCH_FENS = [
  START_FEN,
  'r3k2r/2pb1ppp/2pp1q2/p7/1nP1B3/1P2P3/P2N1PPP/R2QK2R w KQkq a6 0 14',
  '4rrk1/2p1b1p1/p1p3q1/4p3/2P2n1p/1P1NR2P/PB3PP1/3R1QK1 b - - 2 24',
  'r3qbrk/6p1/2b2pPp/p3pP1Q/PpPpP2P/3P1B2/2PB3K/R5R1 w - - 16 42',
  '6k1/1R3p2/6p1/2Bp3p/3P2q1/P7/1P2rQ1K/5R2 b - - 4 44',
  '8/8/1p2k1p1/3p3p/1p1P1P1P/1P2PK2/8/8 w - - 3 54',
  '7r/2p3k1/1p1p1qp1/1P1Bp3/p1P2r1P/P7/4R3/Q4RK1 w - - 0 36',
  'r1bq1rk1/pp2b1pp/n1pp1n2/3P1p2/2P1p3/2N1P2N/PP2BPPP/R1BQ1RK1 b - - 2 10',
  '3r3k/2r4p/1p1b3q/p4P2/P2Pp3/1B2P3/3BQ1RP/6K1 w - - 3 87',
  '2r4r/1p4k1/1Pnp4/3Qb1pq/8/4BpPp/5P2/2RR1BK1 w - - 0 42',
  '4q1bk/6b1/7p/p1p4p/PNPpP2P/KN4P1/3Q4/4R3 b - - 0 37',
  '2q3r1/1r2pk2/pp3pp1/2pP3p/P1Pb1BbP/1P4Q1/R3NPP1/4R1K1 w - - 2 34',
  '1r2r2k/1b4q1/pp5p/2pPp1p1/P3Pn2/1P1B1Q1P/2R3P1/4BR1K b - - 1 37',
  'r3kbbr/pp1n1p1P/3ppnp1/q5N1/1P1pP3/P1N1B3/2P1QP2/R3KB1R b KQkq b3 0 17',
  '8/6pk/2b1Rp2/3r4/1R1B2PP/P5K1/8/2r5 b - - 16 42',
  '1r4k1/4ppb1/2n1b1qp/pB4p1/1n1BP1P1/7P/2PNQPK1/3RN3 w - - 8 29',
  '8/p2B4/PkP5/4p1pK/4Pb1p/5P2/8/8 w - - 29 68',
  '3r4/ppq1ppkp/4bnp1/2pN4/2P1P3/1P4P1/PQ3PBP/R4K2 b - - 2 20',
  '5rr1/4n2k/4q2P/P1P2n2/3B1p2/4pP2/2N1P3/1RR1K2Q w - - 1 49',
  '1r5k/2pq2p1/3p3p/p1pP4/4QP2/PP1R3P/6PK/8 w - - 1 51',
  'q5k1/5ppp/1r3bn1/1B6/P1N2P2/BQ2P1P1/5K1P/8 b - - 2 34',
  'r1b2k1r/5n2/p4q2/1ppn1Pp1/3pp1p1/NP2P3/P1PPBK2/1RQN2R1 w - - 0 22',
  'r1bqk2r/pppp1ppp/5n2/4b3/4P3/P1N5/1PP2PPP/R1BQKB1R w KQkq - 0 5',
  'r1bqr1k1/pp1p1ppp/2p5/8/3N1Q2/P2BB3/1PP2PPP/R3K2n b Q - 1 12',
  'r1bq2k1/p4r1p/1pp2pp1/3p4/1P1B3Q/P2B1N2/2P3PP/4R1K1 b - - 2 19',
  'r4qk1/6r1/1p4p1/2ppBbN1/1p5Q/P7/2P3PP/5RK1 w - - 2 25',
  'r7/6k1/1p6/2pp1p2/7Q/8/p1P2K1P/8 w - - 0 32',
  'r3k2r/ppp1pp1p/2nqb1pn/3p4/4P3/2PP4/PP1NBPPP/R2QK1NR w KQkq - 1 5',
  '3r1rk1/1pp1pn1p/p1n1q1p1/3p4/Q3P3/2P5/PP1NBPPP/4RRK1 w - - 0 12',
  '5rk1/1pp1pn1p/p3Brp1/8/1n6/5N2/PP3PPP/2R2RK1 w - - 2 20',
  '8/1p2pk1p/p1p1r1p1/3n4/8/5R2/PP3PPP/4R1K1 b - - 3 27',
  '8/4pk2/1p1r2p1/p1p4p/Pn5P/3R4/1P3PP1/4RK2 w - - 1 33',
  '8/5k2/1pnrp1p1/p1p4p/P6P/4R1PK/1P3P2/4R3 b - - 1 38',
  '8/8/1p1kp1p1/p1pr1n1p/P6P/1R4P1/1P3PK1/1R6 b - - 15 45',
  '8/8/1p1k2p1/p1prp2p/P2n3P/6P1/1P1R1PK1/4R3 b - - 5 49',
  '8/8/1p4p1/p1p2k1p/P2npP1P/4K1P1/1P6/3R4 w - - 6 54',
  '8/8/1p4p1/p1p2k1p/P2n1P1P/4K1P1/1P6/6R1 b - - 6 59',
  '8/5k2/1p4p1/p1pK3p/P2n1P1P/6P1/1P6/4R3 b - - 14 63',
  '8/1R6/1p1K1kp1/p6p/P1p2P1P/6P1/1Pn5/8 w - - 0 67',
  '1rb1rn1k/p3q1bp/2p3p1/2p1p3/2P1P2N/PP1RQNP1/1B3P2/4R1K1 b - - 4 23',
  '4rrk1/pp1n1pp1/q5p1/P1pP4/2n3P1/7P/1P3PB1/R1BQ1RK1 w - - 3 22',
  'r2qr1k1/pb1nbppp/1pn1p3/2ppP3/3P4/2PB1NN1/PP3PPP/R1BQR1K1 w - - 4 12',
  '2r2k2/8/4P1R1/1p6/8/P4K1N/7b/2B5 b - - 0 55',
  '6k1/5pp1/8/2bKP2P/2P5/p4PNb/B7/8 b - - 1 44',
  '2rqr1k1/1p3p1p/p2p2p1/P1nPb3/2B1P3/5P2/1PQ2NPP/R1R4K w - - 3 25',
  'r1b2rk1/p1q1ppbp/6p1/2Q5/8/4BP2/PPP3PP/2KR1B1R b - - 2 14',
  '6r1/5k2/p1b1r2p/1pB1p1p1/1Pp3PP/2P1R1K1/2P2P2/3R4 w - - 1 36',
  'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2',
  '2rr2k1/1p4bp/p1q1p1p1/4Pp1n/2PB4/1PN3P1/P3Q2P/2RR2K1 w - f6 0 20',
  '3br1k1/p1pn3p/1p3n2/5pNq/2P1p3/1PN3PP/P2Q1PB1/4R1K1 w - - 0 23',
  '2r2b2/5p2/5k2/p1r1pP2/P2pB3/1P3P2/K1P3R1/7R w - - 23 93'
];

async function bench(depth) {

  let total = 0;

  const t = performance.now();

  uci_quiet = true;

  for (const fen of BENCH_FENS) {
    tt_clear();
    set_position(0, fen);
    rep_root = 0;
    rep_set(0, nodes[0].pos);
    await go(depth, Infinity, Infinity, Infinity);
    total += search_nodes;
  }

  uci_quiet = false;

  const ms = performance.now() - t;

  uci_send('bench: ' + total + ' nodes ' + Math.round(total * 1000 / ms) + ' nps');

}

//
// uci
//

// lozza runs as a web worker: commands arrive as messages (onmessage) and every reply is a
// message back (postMessage); quit closes the worker. a host for another environment has to
// provide those three globals

// bench sets uci_quiet so the searches it runs print nothing

let uci_quiet = false;

function uci_send(s) {
  if (!uci_quiet)
    postMessage(s);
}

function move_to_uci(move) {

  let s = sq_name(move & 63) + sq_name((move >>> 6) & 63);

  if (move & PROMO_BIT)
    s += 'nbrq'[(move & PROMO_PIECE_MASK) >>> PROMO_PIECE_SHIFT];

  return s;

}

// match against the legal moves so the flags come for free; 0 if not found

function uci_to_move(ply, str) {

  legal_moves(ply);

  const node = nodes[ply];

  for (let i=0; i < node.num_moves; i++) {
    const move = node.moves[i];
    if (move_to_uci(move) === str)
      return move;
  }

  return 0;

}

async function uci_exec(line) {

  const tokens = line.trim().split(/\s+/);

  switch (tokens[0]) {

    case 'uci':
      uci_send('id name Lozza ' + VER + ' Mini');
      uci_send('id author Colin Jenkins');
      uci_send('option name Hash type spin default 16 min 1 max 1024');
      uci_send('option name Contempt type spin default 0 min -200 max 200');
      uci_send('option name MultiPV type spin default 1 min 1 max 10');
      uci_send('uciok');
      break;

    case 'isready':
      uci_send('readyok');
      break;

    case 'ucinewgame':
    case 'u':
      tt_clear();
      break;

    case 'setoption':
    case 'o':
      switch ((tokens[2] || '').toLowerCase()) {
        case 'hash':
          tt_resize(parseInt(tokens[4]) || 16);
          break;
        case 'contempt':
          contempt = Math.max(-200, Math.min(200, parseInt(tokens[4]) || 0));
          break;
        case 'multipv':
          multi_pv = Math.max(1, Math.min(10, parseInt(tokens[4]) || 1));
          break;
      }
      break;

    case 'position':
    case 'p': {
      let i = 2;
      let fen = START_FEN;
      if (tokens[1] === 'fen') {
        while (i < tokens.length && tokens[i] !== 'moves')
          i++;
        fen = tokens.slice(2, i).join(' ');
      }
      set_position(0, fen);
      rep_root = 0;
      rep_set(rep_root, nodes[0].pos);
      if (tokens[i] === 'moves') {
        for (i++; i < tokens.length; i++) {
          const move = uci_to_move(0, tokens[i]);
          if (move === 0) {
            uci_send('info string illegal move ' + tokens[i]);
            break;
          }
          make_move(0, move);
          copy_pos(nodes[0].pos, nodes[1].pos);
          nodes[0].acc.set(nodes[1].acc);
          nodes[0].cont = nodes[1].cont;
          rep_root = nodes[0].pos.hmc === 0 ? 0 : rep_root + 1;
          rep_set(rep_root, nodes[0].pos);
        }
      }
      break;
    }

    case 'perft':
    case 'f': {
      const depth = parseInt(tokens[1]) || 1;
      const t     = performance.now();
      const total = perft(0, depth);
      const ms    = performance.now() - t;
      uci_send('perft depth ' + depth + ' nodes ' + total + ' time ' + Math.round(ms) + ' nps ' + Math.round(total * 1000 / ms));
      break;
    }

    case 'go':
    case 'g': {
      let depth = MAX_PLY - 1, nodes_limit = Infinity, movetime = 0, movestogo = TIME_MTG;
      let wtime = 0, btime = 0, winc = 0, binc = 0;
      const infinite = tokens.includes('infinite');
      for (let i=1; i < tokens.length - 1; i++) {
        switch (tokens[i]) {
          case 'depth':     depth       = parseInt(tokens[++i]); break;
          case 'd':         depth       = parseInt(tokens[++i]); break;
          case 'nodes':     nodes_limit = parseInt(tokens[++i]); break;
          case 'movetime':  movetime    = parseInt(tokens[++i]); break;
          case 'movestogo': movestogo   = Math.max(2, parseInt(tokens[++i]) || TIME_MTG); break;
          case 'wtime':     wtime       = parseInt(tokens[++i]); break;
          case 'btime':     btime       = parseInt(tokens[++i]); break;
          case 'winc':      winc        = parseInt(tokens[++i]); break;
          case 'binc':      binc        = parseInt(tokens[++i]); break;
        }
      }
      // soft: don't start another iteration, hard: abort
      let soft = Infinity, hard = Infinity;
      const time = nodes[0].pos.stm === WHITE ? wtime : btime;
      const inc  = nodes[0].pos.stm === WHITE ? winc  : binc;
      if (movetime) {
        soft = hard = movetime;
      }
      else if (time) {
        const alloc = time / movestogo + inc * TIME_INC / 100;
        soft = alloc * TIME_SOFT / 100;
        hard = Math.min(alloc * TIME_HARD / 100, time * TIME_CAP / 100);
      }
      // with no legal moves there is no search: mate or stalemate is reported exactly as
      // lozza 11 does (after stockfish), so a gui can tell them apart
      let move = 0;
      if (legal_moves(0) === 0)
        uci_send('info depth 0 score ' + (is_in_check(nodes[0]) ? 'mate 0' : 'cp 0'));
      else
        move = await go(depth, nodes_limit, soft, hard);
      // in infinite mode bestmove has to wait for stop, even if the search finished
      if (infinite && !stop_flag)
        await new Promise(resolve => { stop_waiter = resolve; });
      uci_send('bestmove ' + (move ? move_to_uci(move) : '0000'));
      break;
    }

    case 'eval':
    case 'e':
      uci_send('eval ' + evaluate(0));
      break;

    case 'board':
    case 'b':
      pp_position(0);
      break;

    // the legal moves in the current position, one per line, as in lozza 11

    case 'moves':
    case 'm':
      legal_moves(0);
      for (let i=0; i < nodes[0].num_moves; i++)
        uci_send(move_to_uci(nodes[0].moves[i]));
      break;

    case 'bench':
    case 'h':
      await bench(parseInt(tokens[1]) || BENCH_DEPTH);
      break;

    case 'quit':
    case 'q':
      close();
      break;

  }

}

// commands queue up and run one at a time; a search is synchronous, so while it runs new
// messages are only delivered when go yields (uci_yield): stop ends the search there, isready
// is answered there, anything else (quit included) waits for bestmove, as in lozza 11; a quit
// that finds a finished infinite search waiting for stop ends it

const uci_queue = [];

let uci_busy    = false;
let stop_waiter = null;  // resolves a finished infinite search that is waiting for stop

function uci_receive(line) {
  uci_queue.push(line);
  if (!uci_busy)
    uci_drain();
  else if (stop_waiter !== null)
    uci_poll();
}

async function uci_drain() {
  uci_busy = true;
  while (uci_queue.length)
    await uci_exec(uci_queue.shift());
  uci_busy = false;
}

function uci_poll() {
  for (let i=0; i < uci_queue.length; i++) {
    const cmd = uci_queue[i].trim().split(/\s+/)[0];
    if (cmd === 'stop') {
      uci_queue.splice(i, 1);
      stop_search = true;
      stop_flag   = true;
      if (stop_waiter !== null) {
        const resolve = stop_waiter;
        stop_waiter = null;
        resolve();
      }
      return;
    }
    if (cmd === 'isready' || ((cmd === 'quit' || cmd === 'q') && stop_waiter !== null))
      uci_exec(uci_queue.splice(i--, 1)[0]);
  }
}

// a turn for the host: two macrotasks (the second lets a message that arrived during the first
// be delivered), then the commands that came in are looked at. setImmediate where it exists,
// else a message channel (setTimeout is clamped in a worker, and the channel is made on first
// use so a script that never searches exits normally)

let yield_channel = null;
let yield_resolve = null;

function uci_turn() {
  if (typeof setImmediate === 'function')
    return new Promise(resolve => setImmediate(resolve));
  if (yield_channel === null) {
    yield_channel = new MessageChannel();
    yield_channel.port1.onmessage = () => yield_resolve();
  }
  return new Promise(resolve => { yield_resolve = resolve; yield_channel.port2.postMessage(0); });
}

async function uci_yield() {
  await uci_turn();
  await uci_turn();
  uci_poll();
}

function uci_start() {
  onmessage = e => uci_receive(e.data);
}

//
// main
//

// a go before any position command searches the start position

set_position(0, START_FEN);
rep_set(0, nodes[0].pos);

uci_start();
