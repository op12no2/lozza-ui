// lozzaNNUE.js: Lozza, a UCI chess engine in plain JavaScript, written to be read. it runs as a
// web worker in a page (or under node with a small host) and talks UCI through messages. this is
// the neural network build: the evaluation is a net of (768 -> 256) x 2 -> 1, one weight row per
// piece and square, two accumulators of 256 (one from each side), unclipped squared relu (int32
// accumulators), and one output weight per hidden unit per side; Lozza experimental's net
// (2026), trained with bullet on Lozza's own games. bullet's quantisation: QA 255, QB 64, output
// scale 400. the first layer travels packed at 8 bits per weight with a scale per hidden unit
// (194 KB, base64 at the end of the file) and is unpacked into the tables when the engine loads.
// the other builds share everything but the evaluation
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
// net
//

// the net, (768 -> 256) x 2 -> 1 with squared relu (unclipped), in place of the hand-crafted eval. each
// node holds two accumulators of 256, one seen from white's side and one from black's,
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
const NET_H1_SIZE = 256;

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

// squared relu (unclipped) of both accumulators by the output weights, the side to move's half first

function net_eval(acc, stm) {
  const a = stm === WHITE ? 0 : NET_H1_SIZE;
  const b = NET_H1_SIZE - a;
  let e = 0;
  for (let h=0; h < NET_H1_SIZE; h++) {
    const rx = Math.max(acc[a + h], 0);
    const ry = Math.max(acc[b + h], 0);
    e = (e + Math.imul(net_o_w[h], Math.imul(rx, rx)) + Math.imul(net_o_w[NET_H1_SIZE + h], Math.imul(ry, ry))) | 0;
  }
  return e;
}

// an empty board's accumulators are the biases

function net_reset(node) {
  node.acc.set(net_h1_b, 0);
  node.acc.set(net_h1_b, NET_H1_SIZE);
}

function get_weights_buffer() {

  const b64 = get_weights().replace(/\s+/g, '');

  if (b64 === '')
    throw new Error('no embedded net weights');

  if (typeof Buffer !== 'undefined' && Buffer.from)
    return Buffer.from(b64, 'base64');

  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i < bin.length; i++)
    bytes[i] = bin.charCodeAt(i);

  return bytes;

}

// the blob is bullet's checkpoint with the first layer packed at build time: a header (hidden
// size, bits per weight), a scale per hidden unit in 1/64 QA units, the input weights as levels
// of that many bits (feature major, little endian within each byte; a weight is its level times
// its unit's scale), then the hidden biases, output weights (us then them) and output bias as
// bullet writes them (int16). the black-side table holds each row under the colour-flipped
// feature (piece colour swapped, square mirrored)

function net_load() {

  const buffer = get_weights_buffer();
  const bytes  = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const header = new Int16Array(buffer.buffer, buffer.byteOffset, 2);
  const bits   = header[1];
  const top    = bits === 1 ? 1 : (1 << (bits - 1)) - 1;
  const scale  = new Int16Array(buffer.buffer, buffer.byteOffset + 4, NET_H1_SIZE);

  let bitpos = (4 + NET_H1_SIZE * 2) * 8;

  for (let i=0; i < NET_I_SIZE; i++) {
    const flipped = ((((i >>> 6) + 6) % 12) << 6) | ((i & 63) ^ 56);
    const h = i * NET_H1_SIZE;
    for (let j=0; j < NET_H1_SIZE; j++) {
      let code = 0;
      for (let b=0; b < bits; b++, bitpos++)
        code |= ((bytes[bitpos >>> 3] >>> (bitpos & 7)) & 1) << b;
      const level = bits === 1 ? (code === 0 ? -1 : 1) : code - top;
      const w = Math.round(level * scale[j] / 64);
      net_h1_w[h + j]                     = w;
      net_h2_w[flipped * NET_H1_SIZE + j] = w;
    }
  }

  const rest = new Int16Array(buffer.buffer, buffer.byteOffset + ((bitpos + 15) >>> 4) * 2, NET_H1_SIZE * 3 + 1);

  for (let i=0; i < NET_H1_SIZE; i++)
    net_h1_b[i] = rest[i];

  for (let i=0; i < NET_H1_SIZE * 2; i++)
    net_o_w[i] = rest[NET_H1_SIZE + i];

  net_o_b = rest[NET_H1_SIZE * 3];

}

net_load();


// pos and board share one buffer, so copying pos copies the board too

function new_node() {
  const pos = new_pos();
  return {
    acc:       new Int32Array(NET_H1_SIZE * 2),
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
      uci_send('id name Lozza ' + VER + ' NNUE');
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

//
// weights
//

function get_weights() {
  return "AAEIAHMAtACQAIoAnABrAIkAhgBUAIYAiQCyAFgAWAAxAG4AZgB3ANoAaACIAH4AwwCFAEgAlgCwAHcAjwBSAHIAWQBfAFYAfQBKAHsApgBgAMAApwCaAHAALgBgAFkAYABGAJAAoABJAK8ASQBOAM8ATwBvAEsANQBfAFgAcwBXAJgAeACYAJYAhABaAL8AYwBuAJsAawCJAGAAgwBqAL0AdAA4AHwAhgCPADUASQBeAIwAfAChADsAoACRAIEASwBAALMAcACYAHQApABmAGcATQCoAL8AoACNALEAoQBxAIkAkACbAHYAVwCCAGUAlgB8AGQAZwB7AHwAoQAoAEUAWACbAHoAyAAsAH4AsgB0AJcAhwC/AHMAzQBvAF4APQCIAGAApQCJAHcAgQCgAHUApQCcAKgAYwB/AKkARgC2AGkAXgC0AHAAMQBkAI0AMwChAEwApQBxAIwATgB/AG0AYADOAEoASwBFAC0AhgBAAHwAUwC4AJgAuACnAEwAdwBpAJgAlAAlAL4AqACgAF4AmwA5ANAAkgB3AFUAeQBAAK4ATQA4AG4AOACaAFEAhgCrAJYAwgC3AMkAPwB+ADAAfwCaAI0AfQC+ACIAPwBaAJ8AVACrAIoAsgBWAHMAewCKAGEAVgBaAEAAjQCKAJMASQCTAJEAiACLAC0AZgBTAHcAf39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f399gn9+fTt/hX9+hIF/iHaBfoWAgIGFf2WBgoOBh4RFg4d6fXyCZIh/fYZ/h4NsgoR/f4N3gI9+eX6Tg4N1goB/jH2CWYSBe4SEf4CGg39OeZmGgCaEjZdQfYJ5aYODfoZ/f32Bfmd2j359gYJug36HgoyEiYB+g4GffICEgTaGe3+CgYOag4V9iIKDgYJ/kH9/f4h8hoB+gX+EemmAfoB9ln99f5R+aoNiWG2AalqFaoB6f3ZJhJWDhoKBg3eWgYt+fzWCgYKEYouAeoKPkn0qV5ZKcIuQeICBOIOCi39+goOEfH60m41/T36BhIN/eYKGf4KEf4Z/a4SChYWGg4GIe4GEi3xqd4GAeoODmXuAgXmCgH98gX9nd4CCg5CGXH6IdHKYfF+Gf3mDfpGAm4B/hnx/d4iPg3t2kYeEdnyAf4d/e3uKfYudhmZ8hIh/b3mGgH6Ag3+TUHqCd2WAgYSIgHt+gXxidoN9fHxVk4FVhX+FgomEb4GAwHt/0H0hhXt/gYKndn6Ae4WBgoCIbHuCf3+Eeox6f3p+hHJzfXd/gZh/f5GUgYiEX01rfGtJh2F+ZYCFf4SShox+fYJ0l3p1fH4ehH+CgmV5gYR+hqJ/lEXGKV+PhXqBf3uCf4p5fIOEgnyAv3mMfEd/hIODdHaAhoF/jn5/f3yBgoF1ZIp/inyDf2Z9d3yBe36BeYV7eoB+fICAdYSAa396gnKMg1CFgXJ0hXxjhIyChoCagnh/f3t/dnzkk3xxdn1+hHSCgH+TeI9/gX99goR0f3aBd4N3i319f5B7lFB2gHVwhX2DhIB+d398XXR+foJ6gHB+h4eAgn6IgYKAeItxfGV+IIl8goGAj4d6fH17gIKBZXM8g399hnl7gXx+kIN4c3txf4aVhGxviIRqg1hOcYFuVoRkgG1/i26Dk4KOh3+BeIl2HX5+HIJ+gYRodoB9gIqFclZclj6Njn15f32BgX+HepeBhH57fbZtiXxAf4CDgXh2f4hyfoV+f4JwfH+HelN+got/f4CKe4N6f2l9f4R7iIB8d3aAeX5yfm2Ne36dgIVXfX51eYN5YIQIcH56hYSEgHR8Z3V9gIqCeHGRYoZrhXuAfnx1foqCgn6C/niGf4KEcHRzeXuMjY9den95bn95gX9/gHt+e1d7fXx/d3qAWXyBf396gHdtQnx8c36BfTF6f2Z+gY93c3lxZ36Ce7dvDIJ6gYJtiH19f3CDcF54cX6Dk318i4SBqIJTVXV/ZYV7bYBxd4B2h5OHi2x8eHt/hXN7fCmEe4KBZXN9fn2KeI6Ccn8jeIuEdn56goGBjXx/foVwgIG9kIp1UXl9hoB2eH5ofYKDd3+ChHh/f3pCEIB/b3aCgX6Mf4B0fW97d32Ae3pzgXmGkYJqfWd8YYOIVoOBfn12fGSAiIGBeJWEgG9vf3yBgoSIfXR+f0SAdnt7f358hH6Dgn+BgXqBgHWAiGuLZnh9l4OXUXN6eW+AdImHgYp6cXhje3x/fYN/gH6Fg31+hXWDiJx/a298gH8WlHyCg3KlfnZ+h3+Dg4NsgjtvaH6EcX9/fX+ChXdff3eNgJN6e3uLiGmHWWBpe2aAbHx9fHyEeIWMhIeHgnN7fHaBgH8Xf3x+YmmWgXgAimuEf4d1YZ2Lk3x7fX+CmYN+q4aFe3mDv36JeWF/gop5end4NU6CjH9+goN/fnh8a3l/h4F2goGugoB9e3t1f3OUgHl4eH+LmG+Ab2GHcoF8hFZ7gnV6eHlkg3t/gXaTfoH4dH59dYVvjXl3fJFNfnCAe3+CfHqAf4F9fGx4gH6EgIVzoXx4fId0j015f3dvfHeBfoGBf32CW3h6en5+f399gIF7f4JaeX8+fnV7fHt6AHZ8fnqLoH59iniAgXiBhoB9fmSEf2+CfoJ/fo95UXxogYGZfn6CjIZ/gmFObX9thG2GfH98goljlHyPfw9+fIKBfoJ/En+Fd41sh4F9gIR8fH+GkGuGkJ59g3uAh1pPf3d/PHh8gsiEeXlrdX2EdXp2fzWAfYB8fYKDfSN/f2x6f4iBeISBgXqDeX54eIB2n5B/fHyBf496gmhpkYuAdoZWgId7fH56Y4KAgn94jH6DfpN+femFdI+EdoGTZn52d3tyhXx+goN/gH1xgISCfX+EeZmHhH6WepdPem56aYN3jH5/hYFmf2NxgoB9foCBgIKIgH6ATIF5gIB7gH5/gA2Cf3+HdIB+ggB9f4KHgIGGh31ne4Bwhn6Ff4NfglF9bYZ/mn5/f5KAan9oUGmHaoJYiH5+f4V4WJl+i4GChHyChoOJfhqDk2UAcoaAe32IfIqAioZlkZCegIF9gFWaPHljiY59d4LYh5p6b357hU5/dnddg4CTfX18fn9+f35xfFGAfoCGf4Z1hHx/gISDe46Pen99gYSMgYJlb4dwgH+DQ4OEf4Z5emOGf4J/eImAfoKRf39/g3STgXmAj3+Ac3R+f4l8fIF/hoR4a4KEgZF+gnyRhnx+hX2ZPHt9emyCen+AgIV9fn9XeIiBf35/goODg3h/gQ9+hYKBgoh+f30ld39/cYGdf4OLeoCBfoGEhIOAcYt/b4F/hn2AdYJUf3iDc5WAgI+WgHlLaFVmf2yEdH1+fn9xl2mYaoZ/f4R8f4iDM4svbZV7m2+QgYB/g4OFgYaIZH+HjoGDf4IviTl7bAIxhHyDv4J5f2p9fIS0fnl9eIGCh358fXuHg32Be34yiXyCgH1+X32BgH2Df3+Di4F+hIB9g4J9aICBgoeGgUmEhXt9mIVjiH2Bg3+RgmSCgH9+hHR/g316gKeGeHKAf399f4NchXoob4R9gYZ/gU54qIWBN5CGkFR6gHtsgoGIiX96foN9bHWOfoB/iDKEUoeAi4aLgoeFf6B9fod/MIl2gIGDbpiDgn6GgIR+gnmRfYB8hn19gH2Af4R/bYB9gIaXf31xmn9rg2pieH5ob4ZqgXN9kDOFkYWHgn+Cd5h+i39+L4OAgoFplH94gYyXeYVZf0t/kpF7f4Bqg4CMgICCg4R8fb2diH5Ff4SDf3d4gIaAf399jH95h4OAgIKCgYV7g4KIfWt8fnl5gIyAe42Afn1+f3+EfGaLgoGFj4NWgYZ3cot2Y4V8eId/lYKngHWEfX17gpV/dX6MhX51eX9+pIFYeop9mOuFhH1/iIJweaOBfYl3dZVEc4F5a35/hoJ9hnqCe2V1iHx+fDuXhU2FgYKGi4B6gYCyeXx/fiV+eX2BgKx7fIF9hn6BfoZvgoJ/gYR5gXl8dIKFd3Z/dnuFmIB8jJCBj4JhVnR/eCeGYIFtfJ6PhJGEj4R/gnOdfHF9fR6CfoGCaoZ/iH+Jj3yqJ605go6HeoV/jIKAjHmLgYKAeny7U4l8QH9/fYF8doOHf3+KfXp+bYGAoXBegX+LfIWBXn1+doF5fX5si4Cgfn6Af39/gX1sinl/AIOCSpB/dHOYemKEm4d+f5CCcX2QfH99eKeMe3ZgoYBxc3uAf4F4kn5/f0J1hHd+34R7g3SPeXx/d3+PTHl/d3KDfIKGf354gH5fdoV9gnaCP39wgn1/gImAioFylnB8MH0ok3+OfYOjhGN+enV9gX5jalk7f3+GeYh/e39/gnlyenF9hpZ+blyOglWDWFRwgHN5g2R/aHufioSHiYt+f394i3MYfH0fg36BfWt7fn1+jH5xf1l1O3WMiHl/fYGBf4h8hn6Cg3d7toB+eTyBgYOAcXaAiH6AjnqAgXV+fod8RIOEh3yAgpB8hnh+a35/h35+iIB2eX14gSp9bqp4fpmAhlJudnR2endjhApxg3+CgIZ+g3dldoCEloZ0dY9ifnWDfHyFf2N8iH1/foOUf3h9fYZymHF4e5KKkkl2fnlzgXeHgn2DeHp3XnaGfoF+fYBDdYZ+foiAeHmBe4BxfHx+KXp7a39/lX1vgHdkgH19q2gQjXp/gXh8d3t/hoR9ZnxufYSUfH2RjIaigk5WdoB4hYJqg3Z1oZ6AiIWOAH52eoOFd31+I4J8f3xohXx7fIl0e4Ftd1CZjHZ4g3yDgX2Iepp7f215fLuQhXdRen6Jfnd4f39Dfo57f4Fxen+PeTZ8fYJ0c4WAeIx7fnN5dXtre4KAd3uAfpKZfnFzZHwWf4dNi3V4fXV5ZoOVfnp4lHh9boV9e3yCeZV6dHSCJH1wcX14gHx9foODfXx/e3p6eZGEbplveXx7f41Gdn95cnt0hYl9h3p5eV52g31+fHx+e3p/gX2EdYidpHt7Y3t5fh2cfIx7Mo98ZYKDcX19fWZ+Vl1pfXxwh3t6f3qFemZ6boiCmHh2iI+CW4RVUnV9c4RpfHZ9epp5gICEj3+BdH2CdH19fR6CfH+GbqKAfCWEdZKAf31ggI+Ren99goKAfXeIf4CFcoDFhYpzaH1/i4N2d305fX6Fe3x/fHZwentHCYF8fXWDg4+IgH5xfXF/cHqXfnt9f2iRLH9sa3U5g3yHYn5/d3l/eWSGfX+Bdo18gHh5e3t2g3mWoXN/jSd6d3R7hIJ4fn2EgH90aoN/foR/hnaZdnB6oXqRRXmBfHGAd46Jf4h5V3pddYR6fn1/f4F/h3p9iGJtgH9+fnN7fXgDgH15d5GIfX+MeH+Af36JgH2AV3Z8cX96fX9+gX5OfWWAgpeAf5WOhJCHWVBzeXKFZoeAe3uefHiDdYp/A3h8f4R+fn8agYB6e3KQf3yCg3mFgIaLa5GRonl/fIOIAEd9gH95cXh8wZRqeXNvfIh9end/N4B4m3l6gYB+hH9/Vnd7goBzhIJ5f4V5fXR6gXuhoH5/fYDDkH9/bGOAl4F7hEuAhHd+eXllgoCCg3SHfYB8kn19cIZ3m4F5gZJjf3B5e3OLfX1+doWAe3F+iIB3fIR5n4ODfopvk0J8cHpsg3qHfH+Hf35/ZXCLgn99gIJ/gYF+fYRRg4N9gXx0fH6DA4J7gIU7kn2DjXx/gEZ+f4aGfmYAfnB4fYF/f2SEVX1tfH2cfn9+mX95fWNRcYB2hFGIfn97n4B0k3eLf4KDen+FgYd+GoWEQa52oH98foN7i4OEmG2Jk3l+fnyCcnULeXOAoX91gNuGmXt0h3yHAIJ1eHKAfo56fH98hnd9f2B/S4V8hISCiHqFe32AhoN+iJh/gHyAaImEgWpqhSSAfYFQgIV+hn19Z4iBgn92n4J/gpJ/f4KEeaaDeH+RgX12b36Ohn9/gIWGg3dofoGBkX+Ff4qGeX+OdJw2f3J7cIR6hX9/hn1+fl11hIB/fYGBg4GGd3+DBX+Cg4KBi36Aexh/gX91g4yAg4R9f3+CgIKEhX93hXxygH6Efn98hFOBd4N7loGBmJR/fVZuWnF+e4VxgYB9f4qTfJJxhoF+hHt/iIUQkC14inyYdpmAgX2BgIOCh5Bufo2chX9/gy6KLHt6AIWDe4DIf3l+dnt7h8d9eH9/gH+GfXt/e4WDf391gjiCfYCEeX8rgH9/f4WAloiDgXuJgH+BhX1jgIKCgoeBBYWHfnqFhVmJfoaGfpSDJYOFf3+CZYOUfXd/nIOAc3h/fnZ/hHWFgpeIg4OAhX+GWnenhoEZfYqXTnqCeWt/goOJfnh7gX1kc5F9gH98hYV6jYSgiIyEhoJ/lXt+h38xnHx/gYKNo4KHf4WAg36Ef4+AfH+MfoN9fYyBhIJwgnp9iZeDf3WbhGuDaGF5enCGhmuAfH6hQ4iPg4aDf4B4p3mIfn4yhYKEhHGRfniBipWDgnGLToeUiHp/f3qDgot+hIGChHp7tqmIgyh+gHWDfXeCgnuChn+kgDiDgoyQf4KBiX1/h4x/cnd6fn+BgoiFk353hH+Ag4R9ZIiCgYiIggiHiHtvpnVehngwg3yjgtyEhoN+hHF8pn56gpaGg3SCe399int2j3wpiYOEfoqJf3l5rYF/jHiDlQ55gXtse32Ejn1+f4N+YXCVfYR/QKOGoI2DeoeKhYCDhal0fYR+MH58gn+CiWx3hnx/foN9iFOFfn+CiX2Gg35wgIV8c395foOadZKalIVzhGRUdn5wcoRifnF/tmeGj4SMhH2BdLB8dn58KIWBgoRtkH+GgoqBeYUqcz2PjY17f36ChIGHe4h+hId6fbl7jn0ufoFtgHN3hYKFf4F/EYG5g4GCDGSFeox7goYAf319fIF9ggB/g5d/foF/gX+FfWiqf4KKg4IHjH91a5B7X4mJnYB/gn8/gHx7gX5ynpZ8cHydf4R2iYB/fGx4gYR/fn+Cd4F3hn2CfKt8f4FdgZENfoF8cnp+gX9+gnSBfmB1i3+MeX5+f4CJgn+HhoiKgnSOen5/fiiOf4SAgYOIdYGAen6CfX5MdYF+gJd2iX99fn+Dg3J/c3aFmIlpgpCDeYJfYXl8doiAZYF7P72ZhYeEjYOAenqQiCN+fCGEgIJ/bIl/eoOKe3t+YYsxmYt3e358g4KBgnqOfoODen27i4d5OH5/e4F9dYGCQX2Ge5ODKn+BrXtEfoCStXyDkH2Hb4Jvfn19fYKGfnh+fn+Chn1ryH2Ac4CCBf5ecnOGeWWEADCDgIx+iH97f2x6f3uIf3dfq26Ec3KAfnvZgHuDfYB/gnl9doF3gnecenp9kIaQDHeBe3SAd3+LfoGHfn1ed4p8hnx/g0F5j399h4B9goF9hHt+en0oiH4AfYGgfwCAbVt+fX6RV0htfH2BdICBfn2KgoBmd2yChJV1i7WOgniCUll2iXKGfm2VcXe6goaBi42If2p9hYF4en0mhH1/e2ypfHx8hHh9fW16R5CLhHyCfYOBgoF5d3+AAHJ+vYmGdVSBfYKDeHaDfX5/f3KChHR7e3t8HYR8inxmgn93jnuDdHt/gX2Df4B3hIB5ha9+bZBzgYZ/hAOMX3d9eXtmiIqFc391dIB7fHqBd4J7pnxwfpJPf3Z9gIR9coR9f4eCeX91f4JujoJxknd9fXSDkAl+g3p0hXWHg36Eckp2X3mQf4Z/f4CAf4t/fYV2i4d0fH5wfXt/GYl/g36Bi3t4g9xtfYJ/eXdygnZ/fW+AeH2AfIJ/ZYJudoCagHSHk4WAglRXdoZ0hnR4HXZ/vIaEeoKOf4JpfYGPg3t+H4F/gHpwp39+NH16iIF8gmKcjol6hX+Cgoh+e4t+epZ3f72JjXlofX+JgH13D3CBf4mJfYF7e3iBgECCfpCkb4KAhod7f3p9ZH94dYZ8fIZ/hYOGfGx7dn+Gf4M9jX52gXl6ZIR5hYB5jniDdot/fXeBdKGBeIKcNn5ze31/iIF/f2CMgnlkgHqChHeDeqB9aXuLco0IgYN8c4x4gqJ/g3x9hF55kH2EfX6Cg3yDWX2DT3uQf35/bHt9hA14fX+Gn5N8f4VsgIFMf4WChIBigntwe318f399gVB3YXx9mH98jZGCaoJaUHmJdIVXgJZ3eLx8g310ioE8YHyBfYB8gSSCgX6Gc6p/gIR9fZWBdpNqjo6ReX58g4V8aHp/hHoZbn65l4hwbgB1iHp9d5Btfn6HfHiBfIZ8fX9YYn2OfWF+fnuChnl+Z4KBdoOIfn+EgXl+gYFrc3+lhX9/AIeJe4J1e2SFgYJ2dm58goSFgHt+gnuxf3SEmGiAdoZ7AI19gX6Bh4R2XoGBg3eAhXxug4Z+kX+VDH+CfWyIfIqRfod/f3RoeJR/foGAgoSEgod9g0mRgICChHt9gIcWf39/dH91e4WCioF+hX5/h4aEa5t8bnt/fn55boNghm53eZyBfn+ZhIt+Yk56hniFYYN/fYGvZYCMe4d/gn57f4KFiGwjgINJj3Wgf4CCeX15gXuWbnWRyHl9fYOChCt5in6AhHp9x4iSfHR8e4NnfncAfYCAjXh4f3yGfHx/ZYRij3x+goCEe4N5fYeFg3uQk32ChH+agoGBa3SEhoN8fwCChYCFfHxnin+ChXmQf36Fo39/e4B7oX96gph/fnVye4eHfn+BhImEd12AgIKUgIWBhoVzfZpZnDGCdXtuiXyFhH6Gfn+DXnOOgoF+goKDgn5QfokMe4CBgoB/fH+DIXx+f+2DiHyDgXuAf4V/hIKGgX6IfnGBf4J9f3+DXIR0g3aUf4CTm4B6am5ZeoJ4hXKAf4N9oYmAk3CFgIOFfIGLhgCmNHqGgZZ1mX9+gXuBhYGCkm6KjoqHfX+EXYhMeH90h4d2gcGChH96hn6J34B5hIKCi4p9en9+hoJ+gX+DgJB+foh4fwx9eX9/hYmRjoiBf42AfYKFfF5+hIGFg38Ff4l/daCMV4l/hYR6MoNxhIeHfoNMgKB9doF+gXtxeX5/hIGCh46IgIuAg4WJiIJnc5+HgQSGdZVSfYN3bIKDiXt2f3yAf19zl4F+goSIg3iJgbiKjoaAgnmMe4KDfDiklYGAgdavhIZ/h3+Df4Z3iH92gZR8eHt9r3qEgm6Bd36ImYaMmZ9/eINtaHmCYoGEbn+Nf6eDi4+Gh4V/fnWoe4l8fzKGg4ODbIp+cYCKkIKDmZhHfpODe3+CfYKAhYN/f4CEenq/oYKCIX+FboCBd4J8gIKAfIyBloWBi6qKg4GMen2Hj4FugnR4fYaGhIp/gXmIgYB/hn1ki4KCgIaBEIWKfm2LdVWJeoaEfmKB/oWGboeETn+pf3WCl4OBeIB/f3+Fe5OJhHZ2gYWCiIuIgXnNhIOMjIedCH6De2xTf3Z1fn+EhX9hc5qBioQnf4Z6jYNwjYiJjYKGkICDhXs8doSCgYGjHoKEf4SAhXx9VIR+eoKVfX+Pf12AhX5qhW12g5s3gaGTfnmDaFV2eXaAg2WCloK0couKg4uGgYB1qH6JfH8whYOCgm2VgI2Ehn13gXprNXeMg3p+foCCg4F8hICFhnuBtm2Ggxp/gGKAgHaAenGFgX4AhkyFhYybbIN0kHx9ig2AfXVjh3qDgYuEiIF/hX9+gYV/aKaCgIeDgAeag3lgoIFVh5S1hIJ+hVyGcouSf2aKin90gaJ7fHOCgIBld4mMi39tf4CBhn6Jf4B6q4F/jJeKlAd4hINxe3t/iHt/aICGYXaWgId5g4KBe6V/fYeGhoGCcIlmgYiBO2p4gYGAs4yCg4J4f4J6iQB2gnqDrnSPjn52eoOAbYV3c4KapQPClHdfgWJTd4NlgINngY+Cs6iHho2MhIJ7gJJ+S31+NIaBg39skHt2g4d5b399dDGPinZ+eoCEgoJ/fn9/goR2e6yIkXwTf4JogXJ0gnqCf22Hj4qEgIGTjVCIgZmIgIaWfYR/eTZ9gYaIhn+BeYeAgHyDf27UgIJ1gX8FgEd4Yoh+V4dpiXmIdICDgo5+a3x+f4h9a4OreoF3eYCBg498hIiCg4CBgYGHhG+CdrqAgH6LfZcKgIKBdUl5dYWAidFEhmF9loCcf4SCOX6vgH+HgIeQgoyCfYV8ezZqf3+Agq9/fYV/SXx+e4pgenV7gZFwg4uAfXuEhWgzaWyCmjt8t5B9f4NbTHOPdoZ8bo2OHLWJhXyMi4CDaYGGiYl8gDSEgX+Gb5uBeoJ6enOAbHAogouBfX6ChIKCfHuHgYCHfYCubZBePoN7fn+KdYtxgYB4X4KJaIKAgHsOgoGLrWR+f3eMcIeAgIGDfoaMgnuNe3p4eH5uj3mDgYF/BJM4eoZ7e2KMjomJhYx/gIJvgI1/fnufgXw2m21+coGDioF0g391h4N4en5+gmqignOYfXp9c5iUB3+Ff3WNeYOuf4pXgSNhe4yIhH+CgIB8nYOAh3iTjnx+hX+BfH0mb3uEf4CDe4GCkXR6YoCEeHeAeH5/cn99fn17f35cnW95f5qIfJqVgXaDVVN2kGaGe3QJhHyygoNxhY2EhUx/hoaFfIAwgn2Cf3CnfH9AeHw3gHeGYoiNjX91goOChnuCfIJ/vQCDrn6PnGeEe4uCgXV6bH6Df9d+hXyDfICCPIJ/mo84e3x6iISCdH1Tg3+Hg4KFjoZ4c4V9a4x7foV+fQSDhYCHc35hhniCP4BmeIV/u3yBdH59o35ugaVqfneFfYmKgYCBlpOFeWeHk4Z/dX99h39cfYd6lwd+h4ByhX5/f36Lh4KiY36ZcYN/gYCEgY12gIZUj3CCg4JrgYC6Jmx8f4+DiHx7g3yDfYGAgoGAgHJ9fXh3f4J8eXuATRdwcoCZiH2xknV2gWFAeJd9g214iYiGtDuFcneEfkZffoKBg3mDO4KCe4Vyn4KDgnV/2IBtgGqPj6B6dIGEhIF2fn+JfYZ+gKp4j1Ztgn+OfYN2SGmDf4dleId8k4CBg1eIhJ6FTX9/f4CAd39ajYJ1fImBgIl9fnl/mmh3foGFgHwFgIx+hnV+Y4h8hY1+mn1/iFGCgIZ/fJ+DeoGcdX50e3yXjH+DgoqHgnY+hG+CY36CfZGGloCjcZQIc419bYV/iHd+joB+HGR5mot+gYaDhICJTX+GRI52goOFg4GAZR16fn+ChZB4goiChoGEgYKCg4V0hn5ugYF9fnp6eT6Ic3Z3noCCkKF6intoOnqMa4N9fH2IfbGniIN2h4CHeH2CeoaSTiaAgj2Odpp/foRzfod/apZqjJGEgXl/g4GIZn2CfX+EC4S9kZKFdIB4iXyDdnl2gH6BiXyCc5J4fIB+f5GNfXd7foF5hH19hoeHfYqYfoKJf3yBg4RjeoKGg35/AICHgIN8fGeKgIF5fX+Cf4WFgH56f3+VfXl/oIB/dn97jpB+gIKBfoF6WH6BgpSHhH13hG9+flWeM3dkeW2HfoB/fo1+fodceJOFgICGgoWAgIJ+hgSDeYWBgIWDgLExhX9/k4KCen+IgYJ+gX2DfYaBg4N7cXyAg32Bf39ahnWBeph/gZ2aen14b119j36EdXx+jXytiYSObYd/h316goqHBL05fYKEhnORf3yEdIB8f4WWbI2Pm5J5fYVtg2KAiISBhXV/u4eHf3qHeYeufXiFfoKsjX56gX6Lf4GBf4mTlot1knR9CoFufn+Kh5qJzISNkoJ+f4d8WHeGgoCDfx6Dl35yfHtMhn+EfnqiipaIcF+Bf1F/hn1shXx+dHGCdYOAhn0Alo+Dd36Eh4ONj4ZxiI+EK3Vyp19+fnxnfYV5noGCe4Z/YHOYfYOJoX+Fd5OGwoeReoCCfYtshn95MG/sf4B/x7qCg4OIgoaAj4N+gWiAnnhzfnvJfYV6YoN3gIudiIyso3hxhXJseXlghYFugaN/qoOQlX6Kgn55aZ10kH98JIWChX1shYBNg4qAeXnVtENwmH+AdYV9f31/hY+IgXp+eMh/kIsOe4FcfIB3g3aKiH56mYahgYeGeYaEbIeIdpafgWl6YYKDkG6ZkciFio2DfYODfV+HhIJ/g4Q1e5WKUKiJUYZ8komCwX/XiW6vfYFCioaKdIFufnp4eHh/hoGCkJuKcH19houFiox+faaPgoxvkp4SeoKIanePg5u4m32DhmJsqYKEiQB7hX6Wf42Ph4Ggf6CHhYOAe0Z5ioGEgXwcfYuGkn+KfHhheYFwhal+jHh9ZHmFcV+Kb3CDn3+Zu51sQ4RuCXWESIJ3ZoXUhK41jZKLkYGAenian6B/fy+EhoWJZJWDwIaKfm6AsKo3kpF6d3uJf3+Jd4WTgoWKeILDb56JC35/T3qNdIBthIh6fwaKio+Hjod7gXaUf3SVI3x/jEyHgYKLkoyEj3uMg4J5iH5kaoeDcn+AEpKKfzyRi02Ng399kLWCeYynaoeHbIB0hnCDhXRzb397gYaMhJySfnpyeoSMhpWIf4DDg3+Pr4WjEnGBkm5afVqpf5B0XIZodJSKdXSdeoWBnIOHkIBwdoIAilGEhHtHR4eNgoOClIWHg4KBjrN4eHF+bImydZ7DfWiLhYFkl29+g5u9mYCVeEiJaAx2sGt/fmeBmYGh44uHj4+FhYCHk2pvgII0goWCjWiWgE+IgYB/eqqxGZeLeH58h36AhH6BjH6Fh4p0tmWciwCDgVN+gXJ9bIqHYXmmj3uPgp+DJIR3gYp9fKKHhX9khnyCeop/sY+Ai4SChn9+ZqCBgoF/egd7RRBmjn9UiniCg52uknGJeYQAhHqBfoR0hIJ3enaBf3+HhYKKaol6gXmDgoCTfH1714h5hqODlRR4h4xxfH5/oIKLq32IaoOSgEN6iYE2famBg4x+opB/houThn16RlmBe4KAnIWDg4czgn1/dGt4enKCoXOJcoFzh4V/ZIZmeYGWh4T+mWVsh2AMdpdLhHpwodWBlRWLf46Mhod9hoq8mX6DNIGAg4Bog7J2k3eDfn+MmRyYjomDdYd/f4BydIuAeIF7jqxsf4gvg35wej5wgGR/hFRxho2HkYB+fRWKbpOfc3R2fI2OiX2DiYiEj12Ke5KAfn16gG6PhYJ/gnYGjCqrl2iDWYt5fm6VkIh8iZB9hYl5e3KCdICQc4pzf3+Ll4d/hGWKgHt1iJOBbaSAd/iHgYyXs6APfIaTc457ZoCAl3KBj2t/houBfoSCfXeff4SGfrWUgIeTX4J9fiCLeJGGgZ2AfIeNd7R/hY9/c4Jwho5odYeBdIKAh2GrcYZ7kZGJrpphWIlbCXauboGAbDB5O4anh3eEi3+NLXqNXY1xgjWCgYR/bH2BiTpqfxt8iKIXfpCxgnCFgH6CeXiahX9xnoCsS3GpZ5F+d4CbcnhegINyqn+Pe4aHfotDlHqAlDBjhniGhYp5TkCClpJ2jH+Wr4Jsf4ltlH96goR2IouKHopbg1yNfH6HkJWKdoJ5goR9dYd4gXQAhHiAeJx2kImAf4qMjol9cYmeh3hpfYfOh3eMkG6VEn6DiHCJiYt1gox5f7xngpAAin2FgYKOp22Bi3Cvdn6QgHGMfYgoLniAioOsf3+DfYODg4B9gHWHcnWEdmiFfHh9f3kNenyKe5yAha6iTIqCWwV7gFR9e3KWn4ulXYB1eISDAG95ja6Idoc3f4V/hnCYhHucdoL+gViTWoaVtYpziICAi3Rom4p2hkd/kkaFlG6CgY5xhnVyYX6RbXSBjJSdgoaFPHuBiHVkf3l+fYZ/hGubg2iArYqOjoVsf4urZXWCeYWDfyR7mI+CbXpdgoN5cZC0fWuNaYWJjHJ5aIh0gpd3gWpefpKQhIGAfoR+fEOD5IRtl36GhY+CinSopRaBi4pqjYBpfn2aeICNY4yjkX52i3+HgIhuhYA9kYl9kYuZinqLMYF7f5F9iXqEin6Ag4ODhG55f3R6fnCLgHh9eoRsDJF6gXScgYG5qmJwe2QAfJB4gXV2f5eKoZZ7d4GLgZJ9eoZmjJc3OX6JNIpyiH+Ek26BjYN8ll+Rk6OWdoKAf3lwOZiNc4SWjLRvgIBykYCXboFzhG6GpoSBfoltoIp9eHSKg5WHg218fXWCf4JJkYF8ibmEhIyAdY+EmGWMhYV+fH8kdo+GfnR6X4h7f4aUgH1xinGEg4F7jX98foeKdHt2lnePiYB8hYN4f3pyiIOBjZKDgoGNmohqR6FMcVJ+ZXeFgJiCiHx9i15xj4eDe4x/hIOIcYCCApCHgoGBhpF8fSxse3yEgG94gIuBgX6FhIJ1e36BgoB1eYOCf4GDcV2Cgn5qnHyGoaZ3sX5wVXyFY4Bzcnyegqlufop2h4SLfHyCj4sOyy17g4SEb4qBf4pyf359eqJfkJGwlHWBg3SAbSibfHqEd3zFc42FeoaNh5qEdoJ4iOKNhICEg4aHg3+WiJGggnyihnVafmpwjI1+iovMjlKThH5qhHxLYoWFiYd/SH6dinSVGjaFZoxgnM+LmotakIODYW6Qfml/eGNyB4SHgqCCk8qbp393f4qagYyVdm5KnJYAno2pa5p3h2GZVoqHiX55g4Vjc5+RbYque4F0eHinhox9gIGkgYCNeIE2OIiGjn1uwoKIjJaAjIJ6a26KWoufZoBlcaJ8gXpacH2wiKWGjIaoIJSJd2h4hn5+cmt94n6fNZWEh455iXpznXOKhH4edoqDi2h2gIF9mH+Sct21S6CfhIeVgIF6gHeFeIqDdX1v44affxh7jUV0dXKFbnKSe3+GhpIAjHpdmoZLbIJsopN6WWlef4iNc9SUz5dgkoWHdIeFVnJ+f3N/e015lYg/VVJIeHuMl6SgeJySpoWHkGKIZYmKeop3l11shoOfkYd8saFrb3J7j4WFpYFyK5Vwk6ExqzhnhJthcVhvlfXAi4OEYIWlhIiKKHuGgJ52m5yBlqJ/oIZXgnpzTreKjnuCkBh/jIepgJN/bnB/fU6CsHKKAHN4bYFzWod1S3ujh5pJox5ainEIdn1cfm5gi5x8gFqafYiHeIN+dJiyrYJ4NXGMh51dbH3bg5Z50ozepA6okHx2l4NqfXxuhnqGgY52ksxmoYYTdn80eoxzgGmHlXCFMoWErIi3g6GNaV53dYsYdnl4TYaHjo2PmMqcfYeFgXB/g1NdfoV5fXhmjpSNWKmkQH5ra4mTno5YjIWKlY56dm+BaIWBcHAbh42Is5BzjJyHe2t/hImMmJJ9gV+PfpTaZ5NdcnmeYpFsdYCGuWd2fWZwlYeMcppxhIx8iI+Ng3pKftuQU3aEdFMAbHyCh6CYeYuDgYGV6nhlb3laha1lha11XH6EfFSSdJt9mXVaWKEYUIdtPHOHf3hvZnu8glrDj3iOh4B7gIKVXqWCfTluiYWTY4+HjYqPcGZ1xJsQkJSCgY1/ZXt9bXh7gX+AlhTfiY+DHn+PS26Bc3tne41pfpqLaZWEg31bhXBudn16p4CHiGmHg397oJehloKGhYyWf4ZTh3uBgIJra3MYj3Z1f0uKgn5uibx+bY1alG98gJx8hHprXH1rZniViIaSi3legId3eouPepB+eWlYh3+Et1SYYJmGm2N9ZHWLh4KsioRtc3+Hn3aNelh9mnaGhX+ejXp7moZubm0+bZGIh3LKbW2Jf1KOiYVeZmx/UouiZ4RteG+ChIBahYOLgJiJkGeZE0yDZQp8lVl9c2ibmoJrCZGCkH1+goZ+jc2odnoya4h5l2Rv63mdgXfRd6u0DnWOfoWVfGh6dWtyYodzcHO6v3aDkCuCg15wZnSAXYaAT2hmiXqTho97RpCBVKR/ZWKBhnWIioOUjXWV4JacjIhyjmp+V5N9hn+HY1eEIIyIZn1QjkV7fonGq2OYjouJiXh/hYJfg2Vyjwt/kYeGe4R/lXJ/d2mQi4J4o3xlqoiWjay8ok9dh5lihHd/e4SyTHmNbHF9poqDdX91dneNinp9mIqQf4Zza3Z7S3l+d4V/mnJ2foyW8oWSinV4i2iHlFBtdHh3eYB/QY5xd2mPhnFppB5hiVgQe2+Ee3ZaJoCIXbqKZXx9eJOHfIpii2V9T2aCiYtqYI6GfHR3XHmCpBSGj6V6m3ZteIJxc3+DhW6jFLljhYlegoJlehh1glByhYGgfYh0i4OOjliEeXR4U0eAdnyIm3dnKYWWobKQipjegH1uiFWjeXJ0hWRlcJlppL6BS4p8f2hxyHp8hkCDkZh5lWd9eV2HeIhuh46KiX+QjV94YXyGjJCAf456faqTgJGETqY92nCTZaJ/AFaLmHiLd2dwmrKPX3x1g3+cfId4LbCMcoaLSHx3kl43gZCIcp1vepJ7h4x/f1BobX1kcYh1j4l4c3yClht/kpyEoXOIM5wXkIlcNH9lXXl0XpCFjIBDc3SMfXp+V3uLspFliS9lin6pb4eAd5V5eZ2JMa1jfpazl4x6bHx+ZF94hml2d4aXWm+QcY6TcmugfHNoj36DXn9/ipiDiYNqh4pLY242h4R4f4t/ZZCMY5OGo6GQhmuZidtTmo15iIh2M4OaloxCb1OIenyEl7+PYY6si3SEgoRsiHFnf3KCDm+Uk5iEgo+VdJN+dYW0dIWVgoWWjoWMl5x8PQCCl12qgoKsiqx6eo9exJSoj3mXe4p9nmqIhl6OdIF9mqGIhHV1apmJl3+2Y4KLhneFh3x9WmmJboGGZ4CLeH98fL8dh3V/Xpx+gHa1AIWGaUB7a4l9ZmV1goGdV219gIuAkmd2h4J4lzdBaYNbj3aLf3iNZYC7glCLXpWSw3GTjm5/hGocUJSAgZR3tqR/b352Y3JmYHlxZXd7iJSEdoyMhn+CboCNeIGAJX1zdIaOitmXhW6ZrouHi4JXhoWSU5CHgY+AeDxzm3OToXhRf3Z0fMyQfHuOlY54kX2lhnmAbqJYhV6Rb32bh4mUh25SfYKFloSDlYGFa5eOl1xHpFCga4Jhg4lotYWXZ3+LVTyPlH17i3qBcY1+gXwEpJx6fYZUkYOPO1V9eF9+rGaHloCRgYJ9a1tneHyGfHuceHR9dHp+HYCLgoOgf3hgmQirf3JXgGlOd3FueNWCl0Z9c4GPf4R5en5pjxrOHoGHfJJwf3x9hXdvPIRNtU69nJcai3xze3RqRI+JXISEgbZpkoBvgYp8Wm16hHKKuH92fXxygo6AlrR7nX1/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f3B8i31zjXCHaXZ9hIiFk2F8km+UlZN8QYCHint2jix9gm90d2pglHl2jFuFd4KGgH14gn63jXRfg5tFNGlub3F2e31ym4SBenxmgY1oj3uBcIaCh3pjkQt2h0c4m2uCi2x4dIl/QmqJgH53i3uHeX+Ef4eWgG5/g4uGanp5mH55iHOFom2GenWId4pwcHpjdnaAhl+Qe3B4b5JdV3Z5elZgfoq3LXpphatyZ35ZPHpRfFx+hnR7jXS+hm+Kfo56cn9+tIqDf5BgO3F8bY1+WXlrgUZnapBwdm8BfYF7f7CChZJ3dp1Qe4NpcXqBg3hWhXp/hY9/gn1panxpamd0gYtxiIZ3fJlvdXV/fnhdk15ueYR4iY55dT9zhIeFeJ47kWdxfU52XZF9hpJ2gnh5hXp/dYOHdoN1YoOYY4hobWh3fXKCf4mAhnmFd4OAL35+hYmFfnSDbJEJeX9GOod0eZFseWyDfT1xe318eHN/iX2AhHiIlYRch32QeHNucZ11dX90hYxzhn5xgHOKcnl1Potrf3NjiHNpfG+NVBt5pnxQU310e16IhoucfGR5LGtcP35Ob4Bki5yEx3tuiniShWNwhf6LhomDWH1xf22MgHiCT5ZEgWqHbm9ykoSAc3mohIyCcHu4g4RzZHt5iIN3U4VVh3aSb3NyXm+NfX97gnmFe4OJeHGZb3Z0eXp/eoqIcnSCd5GRgnU4doiFe3+VMYtwcnNgdV2Wfn2TdI16g3mDgHl/hXWTd118k16IXoVicYh5f4GFgJCFgoN9i1F+f39tiYJ/l3CVCXR9RDGOcH2ebHV6hXw+c352h3p9go98iId9j5l8fYd9iYtycneVb3iMfH2sdI2AcIhukXJrcVGDXnt2Zod5bX16kWg6fI97Tlh9g7Eth1+Pqnhjf0llelh9ZG+Kg32ffseadYh7jHRxeILbiYOBgVhrb4Npj4RweWqBO3Fjm3V9dGiAf2l8t36HfnJ4m219eWGFfIWCeFODU4l5lnB4eGhygmZ4g3x3gnOIg3aAl3J6fXt/fHiCfG98f3eNh313Nn+Efn95lDKNdGtyb3BZlISCinN7eoKCc3x6dId0j3lofJFgilV9ZoSIaoh9iomJd4aJf4RQeIeGhIR9eZR6mQx8gEkzgHF1dHV9cIB9Q298fn14dYKHeX+Ie4ucf2xwgYZ4dHFyj2tzfXeAnHiDdnuCdIZygGtPhFyBfWSNdWx/b5F5FHqXfktVfnmAPIqAhqZ6W305b21dg2RuiGdwmYK8gnSEd5N9X3l97IF/hIBYanOBdJCCf4N8kUaXY412eHKPfoBterSEh4Nvfqp/eXtje3uQhnlQhEWHeJF6enhkdnt2gnx/fYOAgoh5bZJyeW94hHtphH51d2tyhISBdDNzh357dZowiXJ1cmt3V5B/fpJ0kXyEg39/c22GgI55W3uLVU1hgF96hniGeoqEjHeEgX+IYoCGf4eFf3uPa5ENdH5HNpJzdpB2fnJ7eUFtc32Bc3Z/g4CBf3uRmYJ5gYGDgHF+daBsdId7gZ93gIJug3SEcXR5ToJOdXdieXhwgH6Fdx14lnZTUXt1oTuIVoqpfWCASIJ3Zn5bb4NraJOExphyiHeMfG55gviHf31tWIVxfmyNgX+BcX89iWqRdnhzhIJzaniihIp4bnusbXt6Vn9+in52T4xGg3aMd3l0bnSBbX94fH+Ac5GDbniWdHp4eX1/dIVqdnV0dn+Mf3k4dImBhXaXLY14b3djeFmTeYOGdYp+jYd+fHl6hHuId2OAl1h/XXhegIt2hH+PiZV6homBiGJ8jYGRi3Z5nICTEIJ1SDJ9c3pzdIVvfn47am+CfXh5hX2AfIh9gp+CcmyBhWp1fnKPdnaBcIGlfIWDfIFwbHGEeFKIU3V9Xoh2bn5xiXkFd5J1T1J8dn4LioR5nHtdf0d/bm6DYmqGa16be71+eIZyhoN5e3nugnmDiFmRcn5yj4Vof32QNqphjG5ycYRwflt5m4h1gnR/o3eNfVp3fpB/eFODTY91lHF9d2x1e3t7j4Nth3iFg3pzkG1wc36BemeRZXl2dH5ofYV3N2CKgHV5mzSKcnB5UHdakn+BkXOVfYFgeIF2cIaBjHRffoxWimNsZX6DeYd/f42TdoGGfolvgIZ7ioeBdod8lBB8ekoujHaBjXKAc4V7O3J2fIFzdYaHgXp4eYude2yOgIWAeHt5omx1hIN/j3OAfm+HcYN1dX1whVaBcV+AdG1/cX5qBHqjblZUfnaUKYpVfZx8aH1Qh1Z0fll0fXlKnYLEf2yRdYN/a3SB+IF/g4BYm3B/bo2GeINjjy5/Zo1ranORa3ZjbneNhnp4erJuj3ZZg3qTe3dTkjiAdYhveHdfcINwf2CCgnx3hnh2iolpeGZxfX1/cH5ubHN0gn90dzV+hIJ8dZc8hi5vdHF+Xo6CfWdwf3iIhHJ4iFqEdJt3bH6Gb5lugj9siXN6c5eHfl6FhHmMZWqJbG+OgISFioIMg29NI4ZzYJh7fn+Df0V7cXOAdX1+jneCin+GkYZ1gH2QZ3mAb4FqeXZyf5J/gnV4eHmCdXR+XH0AeHFoiHN2iW2KaSZzl3dZXnZwdwJ3dYGQbWCRNYhSfYBpY5x1Npp+xHligG6NfXVrcM4UhYmXXH5zd3OOeW2DbaRZkV+Fa3Fxil+DSICOhm59dHGwd5N8Z3BujGdmUXhRhHSfcW9jUHpten+agGd+b4uEiHqSb3l1fYB8gIukZXaRdYyShXczg4iFfHuVJolZdHZjc12UfnmKdYd8en9pfG57fn97emR+n2R1XYBndopxjYWbhG5pf4J4f1p9cYN0joRml3qTEHd/RSyLc3KDaHF2gn0+cnp6f3uEZIZwf4N8hpeAb317fnh4ZXCdcHeCeX6VXoV+eIdxjXF7dlt6ZX1uXn10a3htkmhHfqd4SFV8dqIxgV+NnnVldkFygEmAWHKMTIaVdseFc4F4iHxrdXXzi4eAeldWdnh6iYJ0glRNQH9hhHd9dE2BfGx1q32Gf3V7l4Z6fWGAd4SDflGFcpB2l3F1emlzjGtyfoJ9goCFh3N7mWx7cXx+dW2Fl257inWJgod4NY2Mh4V/kDOPQXJ6b3tbkIOEiW+OdX2Gg3t3gI1vl3dhho1khmKFanuKb3Z6f4OYgIGMhY1CfXl8npB/godslAx/ekI5inB4iHB2bn6BRW+Bgn9/WYl/hoOGfIqZgHd6eZVtdZ5vl3F9f3iCmnR/eHSEd4t1eXM+hGR/eGd6c2x9goxzHnqDcFNWgHiJGItuiJ50YH9HYW1Ngm9zlV6DloPMlXWBdphyanp+64yCgn9WZXF/c4qIj4ZwmD2QcIxzeXOVgYBsdah9hnRweKxohndkf4B8hHdMjGeDb4Z6fX97dYR7f49/hIZ2hIaAcpp0eXx9fX1siJNxeXt6iIyMdTJ9hIBegpgngn5tb292WJF9fY93jnuDhXGCc3OAuIR0Y3u1Vntdemt8goKMhJSBam2Dg4CSSnuCgIuGe4CGbpUKentDL4Nwe4VydniDgENxcH+DfHxvhXmCgn6OmohwbX6IhG98c5d5bpp2hJh5eH1xiHWFcnZ6Y25gfIFihnVwfmuKeSl1kHdLVHZ0nDeIYY6oelqDPnt2WXtkdoNgg5R+xoJ2iniSelN0gO6GgoN+V21xfXONgF+CcXpIh2Z7enx1KIF+bXu0g4iBbnqub4R6YXt3hIJ4T4pShHmQcnl7e3OAd3p8hH+Hf4qFe3mXcHhrfHt3VouDdH56doCRZnc2e4OBfnqZNJJ7cnhjdFWNen+NdYx8hIZ/f3uAh3OYf11/iluGXmtmdIh3c31/gpaBhZh/izF5hoKVf3x/kViUAXl5QjqDc3OKd3xse3lBcXB/g3t6hY17iYN6iJmAc396iWZ0fHKJcXeGdIeWdH96e39zhG92d0iKU399ZIF2b3t1im8RfJN4TFOAfn4ghY2Ho3lchD5saFyAZ219hnuYe8qBcIF5jXxweH7rh4GCeVZ+cH11koRzd22JQ5dmgnR5dIN9e2d4tICEemx8tGd5dVh4fIl/eE+DS4R4lHV4fGxzhoN5gmt2hXGBg3x1mHN6fHp/eIKKhHB7dHeIhH57NYV/hmB+mzSGf293aXVUjIF9iHiDeoSAiX93e4aDjnZid59bhVx4ZneBgIZ/hY2LdoOAfoVadIeFjnx+fHp0lwx6e0I5hnR8lHN6e4F/O3RpfYF6dYKHen9/eouaf3qGfH5+cXl7h2Bzl3lwoHd6gXiJdYB3eXNleVR1e2OEc29/ZYdwA3OSeE1VfHWUN4ddg597WoBDfW1ngVxwf3J2mnzEfnSJdYp8b3p663+Ae4RWcnR/Wo9+YYJzhjpyaIN3f3OGfYBcd6uEeIBveb2QinVXlniQf3lQjEuGfJNxeHxldH9rf4iDeYt+kYB/g5h4eXF8gH5+loN0e3R8iYBkeTB/jXKEd5c7kH1teWtzV41+gI52ioKLqHZ7gHeGb5mCX36AYYRTeV+UhnZ8fI6GiXCAin+GT3uLd42FfX6acZcHhXNHLI52cZd0g3N/czhwbIOFeHV/eHqHh3qInIJ3f36Cc3N8dIlfen50gol4gH1/hniCdXxzR4UqeHxfendvf4GMcQp8lXRPU4CBpQCEen2jeVqCQ4JjbIFvdI1bY5SExI5ngXeJd3d/euwuhYKGV3d0fXqQhnaCcI83lmSPdXp3jHGAVXucioJ5b3i4WXR8XIF3iot5UHtJhXSbeHd6ZnZyb32AgnJ3dIOAfnWRdnN5eIB/eZKDcn52eJeFhXcyfomChHaXMIEsb29cc1WSfoSFe416h36MfHfWg3qbcFt8mVF9WYZpepB2h36Chop0ioOChl17i3OCkXx7kWeVCnx9RjSEeHd5bHt7iIQ+cW56gXlzgIN7fG16iZuDgm1/gnNzf36CZ3aFgmydd4VrdIF1h3d5e12JDoJ0WH13cX95f2cBdot0TFN9dY81hF+Fn3xciDyIXm59UnSJYiqWfcSFd4p1iXl0gH/rjYiFa1V+cn12i4Nig2+KKZJtinV4dol8glJ4h4SJhXJ9somKe1Kce4xvflGKSoh7lHB0fGxveXh9j4Bzi36OgnBwkHRzdXt9e26Ni3Z8c3V/gYNvNXh+a3x2li2LMXB0ZnlXlHqDkn6RdouBdn16bYV4l4NdfYNdgWRvYKF/dYiAjIaSc4SIgIhXf4eAiJV8fpV0kxSAiEkrhnRyg3B9cn50OmxtgX95eoSGfYSEfoqci2+BhIh2dYB3ioF4gXeJn4GDe3F+dod1gHxshQB5bV+De3F/cX5uCn2UdFBTf3aLEH50b5Z4YINUg2NzgWpthHY+lYDBf22EeIR+cHh/9YeHh3xYiGl/dY2JdH9wijmIY5R0cnOKXWpYd493enVxd6VrbXxXcX6QgHxRgTqJeZh3dXtoa4F3gH+IWIF5hod/dZJte3l+f3Vik4l0f4d2jIyIczV/hYR3fJo0jXJ1fmN6Xo59iYp8f3VthHt2gX6Lk4ZyYYCPXDhjcGl7gH15hIyHfHOGg36KQIN5e5WEgXNjaJEKgX1EOIRyeohreXKCfUV1cnt9gXl2h3+Ah3qMloFlgH2LfHN4dqJ5eIZxhJlygHxxhH6GdHh8Wn5xfXlohHVrfnCNbDN6iHhRVHhxhymGhI2femF8QXFuTH9oa4dCi5Z/xX1wh3qReXB0hPiKhYSCV3Jsf3GKgWmFWY0ynGiAc393hIGBc3effIuDb3aqioN6YXx8e4KFUIhofnuZcXJ/eW6Di4qPhH2Jd4WLfnWZdoR3fH99b4aLd3aDdoiPgHkwfYaEYH+XN39+dYBvd1mQfWeLeKV5gYRpgXqCioCWdmN9k2CEW3dremp8d3aKgJ5ohH59ikqAgICEg36OlFabBHB/QTaLbnyPd3tyg3tEdnN8h4JqjIJ4jYR2iZmGb4J+hoF4f3WNeXuceIaia3J/eohwh3Jvc1VyaHt9a4l3a3Z2jXMSeol1UVZ/rZgbiWyLnnlbgkRbcFCBYmyGeIeRgsmGdoZ9kHmAdX/phYGCflhrcHl3jYZ4lXKKOIdtjHaHeCV/f293soKGenB2rFOAfGJ6enuDeU6JZoN5jnWCfXt1gWlokol3inOGg355mHN7lX59d5uGjHZ9f3SGf2h4NJGEg4B8mjeNf3J8a3VUjoCEjX1wfW2Ebn19fYZsjntfg5pghF9jaXuDdIiFgIaJdoSIgNsvdYCCi39/gqBxmAh4ez43hXR5inRtfHl/P3ZugoR/e32BhIaEf4iaeWqAfYZ2c2h3imZ1ind/j3WKfoWMd4Z3cW1jfmJ9f2eJdW2BeIxwBHaEfU1SfX2YHoSUiaF9W31Ad3FXgGxzim5/k37IgnKHeJB5VnZ87oaCgH1VWnSAcISGd4RogUKVaH14fndwgIFqdKCAgIZxfLKNgXhbgH6EfXtQg099d5V3d39bcoVxiZaIeoOPhYeBb5x5e3Z2fnt2hYtyeH95g4V+dTWLgoCMfpY6kH9veWR0U5RzbIV5hniEhH2BdXeDe5R1ZXuaW31boGx+hXZ+fIeFd3eHlYCAR3+Gfn59gX+YXpYKe31BOY1zepV3cXt/ej53c4OLfH51h3aOgXmJnIaHgnx+iHV9eoJfen94d5pwgn5rhXaBdXhrQY5Senxlg3hufHGKeAN7hXhOVn2grReKToWhelyFQHNpXH5sdJFxe5J/yJJ4gnuQboZ6fOCAgH99VXF2fXeHgHV/cok4kWmFdYBzhH1+aHW4gYNkdHS0Zop9Xo97hIF2TYdRin6Oenp/bHR9aXmUiHuFeIOCfXeZc3qXgIN5aIqPcnp6eHx9jXk0hn13enmXQ5B/bHpmdFSQgoV7eXt+hYl7f39yiXOcdVt9jVxUWn1kkYdwf3uMh4tzhI2Bg1J1hoCKfnp+dYWXDoN6PzR+d4CQcH9+fn0+c3GCgX1+fn95jId9iJmNdpd8hHJ5e3uBdneJdnyfd4h/eoV5g3l0cVd+U394Y4NycH50iXkDc418UFd6b5gehYuFoHxbiD59b2eFcmaOWHWQesp/fIJ1inxte3zfh397fldudH9eiYNlgHl8PJ9pl314dIB+gV53q32AhG97uXOIf1t+f5CAe05/TIF6ln56gW92g4F6mW1vi4+IgnlcmHR2c3uEdFuRd3R5e3p9iX54MneFfmR1mjaBg297XnZSjoJ9inmXf4d/YYB5fYR4jXVfeYxbgltjZ3+Dgn9+eYqLeoOBg4NffIeAiH1/e4ZTmBVxeD4yiXN4i3Z1dIN2OHNvf4V6doJ8e4ZyeoeWiWyGf4N6cXx5h2xzloOFp3d0f3KCeHp1dXlcdkx7d2GBeHJ+dIl2FHiMckxUfXiGMYBNgp97XolDgGFpfmR0iG9zlH3Mf2qBdYd+dH+D64OCgIFUfXZ+eY2FY393fzWGZ4F5fHWHdVVbdaKHhmR6ebhwc3lafXyJdHhPijmGdJF8d39wdYJ4foyDcoN3iXt4dZZ3c3l5hnuWmIR1eXJ4oXRpeDF6hYt8dpk8jH9vdWF2U459gYF8fn2FhIh/f3SGd5N9XXyRYINcfmJ+gH+Cf5GHkHOChn6FYHyJe3yBf3mWjJYOgXVENYh4fI53fnh8gDl2ZoWBeXiBhIGIj3qJlodrfX2FbnJ+gIRidohufZZ2gIWGhnmBdnd1Z4UQYXhjh3d0fXF/bxx6mHlNVH59iACCj3+ce1iNQoJJcoJmbI1XbJOByX17f3OGh3Z3dOIegn2NVHJvfXOFg0yCcoIwlWuhc3h3inuFPXqSf5l/cXeyc4d7VoN+jG10UHpNf3yfdHh9a3eBdH+aiG2McIN/dXaSdW97eYV5eod8cXxteHN3fnUte4d2g3eZPIxfbnVbeVWSgIWJfYeBhHR7f3hyhIGgeGOAjWKGYHtkf492g32Cio1yiYt7il9/i3+GiX5+hlCUB3mLRyuHeHqgbnp0gXI6dHOAg3d+hoh/f197i5aDgIJ/iX12fXuaTnl/bnOJdYOCfIhwfnF/dmGNBohxW4J7dX57h24bfJNxU1V+en4rgGZxnH1ijUCIZHV/XHGKfmGgfcODc5J0hnt2dXX4gIl+ill2cnh5hIV1hmSVJpxneHNydIlefFNrhn2De3x4tn9+elqZe4WPdlGNPIBtk3R0fGdudG9/jYVwdmyEiX56k3iKf3qCdIeFeHN+inqLhoB3NYWLhX58kzeNdnWDc3palHdqi3Zpe1+EdXyBhZJ7knVof4lhiFmKbXpzcoSGjIePd4aIg35MfHyBkIh/c5RtlQl0fz45iHFzeWxzdoZ/RHl9f3yNf4eIfYyFfYaWhWqFd4hneWNyoHJ1hHaDp3KAgnqIb4Z0fWtcenZ/fWeFfW2BeI9wDHaKcU1Yi72lIoVsjpt9Xn9EaW5JhH5wi4WKknzIhXWCgI5wdnR88oeGiX5XY3F6eoSMkIuAeimCbHZ3gHiOgoJyeKSBiYZxea5rhX1kfn97hn5PiHOIdIF6f3x0eYZwkZSIgYJ5hoiGc5hzhpp+fYNtiIZ5fYF4iIWHdjR+hoOBfZM0i3tyhnJ4VZCBdYt1fISQgGOYdHx/k5F5W36VXWlhjWx7g3iMiIqBJXeEkH+QQ3R/eoSCgIqVf5cJdXdBOHdzfJV6cn13ekNvfIGNgXKVjJaOi3uRmYN0foyJg3l6do9cbYZ6gphvfH9wineHb29tWX5me3xnf3ptdn6PeAZzfXhJVWqUzg5/aY6heF2GQ3B0Un97cZBQgpKGypJ8gIKReYd1e+mLhIJ9VWt1f3qKhXeDeoYlkWqJf4V/b4F8bna3f4N7d2+oZId/YX59eH+JT4NldXuWdnuAg3Z/gHG0hYSHlYWHfHqbdoF9foBUV4h2eHeCeoOMgXY0kId/gXuUPI6EdH+CelWRdJCGdoN4doaPgZ1/jnyIeGN6iGGAV3pqgXZ4VoB/h5trgYmAiDp/gn2Gf32MpliYAn99PzqQdXaScoNtfHtDdHuCfoaCg39/l4R8h5qEcnNyg259gHiEi36FeISVcIKCeIp5fHh6dVqDXX99ZIl4cn5yinELgX9xTFiFdYYdf4aJoXpcgEB1b1h/f2SYXoeMgc2BfH16knpfe3/gh4SDfFVlb3x8ioRxgYKBOY9qiXuDfox/f2p1sICDc3B7uEl3gl1+gH2Adk2HWn54iXh/gIZ2gJZwoIh8kH2Ah39vnnaDZYCCd2iGk3V2fHiFh4Z2M5uGg4d7lz7OgnKBY3hUlnp1gXt7iHuCe4l1e4OGnX9dfpBeYFtebnyEfYKCmIeHfoGJgopHcoV9l36AhKh0nRxrfj02dnOBl3Z5en+KPndwe4Z9f36Be5CBfYyXiHmAhIGVfnp4gV94nniBlXIgfHqFcoBzc3VdJVx/emWEdHB6e4l2AGaJdE5Wb4K5HYNuh59+WIlCcmpggnV8kFGEkX3Pg32LfY91gXd54oeCgnhTanl/foOJand4hUKRaZ96iX18fn1od6OAgnRydbaBf3BbgH2AfH1Ph1B8e5Jud4JsdYR1gZeGdopzj4B6dZ54gHp/gXmii5x5foF5e36seTKGi3+CeZM4ioB7fGZ2UpN3dYiBkHh/hIR/nX+De559Y36YW4RRbWeDg3uFgYOGiHd9h4aISn6HfY98gYGHVpUAf389OYZ3doB2dGt+bjt2fJiCf3+FgYCUeHmHmJV4gXqBYYF5eoVAe4Z3hJxzf4B/g3qBeXRnWYdQfHpfh313fHqHdQKDh3dLWImhmBp8k4acfluSRHppZH5/c55rf5CAzICEgHqLf4B/eeJ4g4N/U3FzfmuEiFSBdIg3nmmJd4B6iH6BWHWsgHaLWnywRIp+V4SChn51TQxKhnaDd3eCa3N+c4WnjX2KeH6AfHObfXmWdIZ+hpCCc3mBe5RshHgxgoKBgHuXO4d6cHdpclGPf32BgJOEhoR/gnZyg3uhel95m1aBWalnf4p7g36eiI1xiId/hVhuiXybf3N9kGGYBnN8PjmAeH2ac4GCfoY/d3KAhXuCgIZ7hn98iZmImoGAgYOAe4F/TXiJdo6jdn2DfolyhXR8dGF+SX93Znt2d32ChHUHaIZ7S1d5f6QSe05/mntclTyCXGqEaXucanyOd8uNcYp2jWx7fnPkh4V6fFN3eX97hYJkg3qJMI9on3p3d4h3gVV3n4Z/enN4uLOZc1eheopyfE+TUIKAi2x4g3FygHV9pn56hpOOb3R0m3p5gXmFenKQgnV+eXJ5f4N7MYCFkYF0kTyRgnhyYnpSlnaCi4CTd4OGaX2AaYKEo3ZmfZFchkuEaKCIeoV/gYeRdH+LiIdke4h9fn+He4ChlQuJeEQyi3h8gnZvd4BiOnRtnYJ3f4GLgoaNeoSUknB6gY1wfHt7f215f4WHi3KFfXd/e4NzeHBdgUKJd16Kenh8dYJ1H4SPek5WfnmMHoF5gJx8X5hLgVluen1uinF3k3/HhYh2d4Z/eIV36YKGg4RVeHZ8fYSKW4N/jS+UZ5R6c3aHcntLfbaFe2pbdLlBeYNThISMfndODEmDfIp7dINmc3t5gqSNaY6Ad3t2ZpN1dnF1iXqAjXFyenp3o3WCci+KhH93cpM3hXJ3cVp5VZCDgHh8eISOiGd/fmiCfZh+WoCHW4JdlWaAgH+GhH+Ijm2Lhn+LZIKKfZOJc3mPbJcTa41DOIx3cKt1d3d+iz56cXyBd3iDh4Z/cXWEmoV2fYOHdXyAho1xdYaCg5V0fIFzgneFdnKHaIYTfWhfdn14fHGFbwF1lnFGV351kyiCcHeVfmGUPoRfcoFcdoMvaZZ9x319fXeHhXNvdumEhnx9VX5zfnuKil6AdZgYnWWRdHd0inZuRnuHiIZ9eneugI1+WYiAiJ12T39JiX6JgXd9cnd/dYGdinaWeoGQiXmVcpBvf393b4OZeoyKe5COiW8peYyFdn+TMot+b41VeVmRfoKDdLeAaoR+hYV8hX+TfGF8hWZ9W3N1eoR8Z3eKfY1+hIN9hTN6fn5pintylFSXAXKARjh2dXyBbIZie35Kdnh/h4KQiYl/loh1ipGSZnuJgXR8g3mSh3GHeIZ/cn9+d4hriW5vemaAcH59ZYl/b3tvjW0ffXpvUll8hr8ifHOKnHhfjEFmcEx/cm2KdouXhsqCc3+Hh3uJdX7mgoqIgFprdFJ5iIOCeJKtP45sfn5+f36BgGt7loWEfnBqmVWKf2R0hXSAgUyGcYOAiHaEfHp4iYmLoYiLkH6BhoZ4mHiPgHeDfneLnnh/g3eKh4FyL3+Khmd7lCqAf4CEdnhUjn+IhnuffIuHcoiUg3SGgXllf59gfFtTanqDg4KTiYiNdX6NgYhMgH59i4KBh35jkyB+fj42dHF1n3lueH2BPX95g4CJa4KHhJCAgIyYgnSFk4edg3l7lVpsmXiHmWR6gX+LeH5wbGtjbWp9fmWPc292do1rBXaKekZXaoClAH/Fip15XYJBdXVTg5F5fxeKioPLf3yHgYtqf3F88oaFhYRUb3GBfYuGW35/iTWaLYx5gYeJgoFydaiBiYR0fKh5h3VhgYF/gH1PhmpvfYxoS4FsdoN8mbKKfYZ5g458eJp0jX59iHl+iIx5eYJ3iYd1czKeioWAe5U8mH6Ahl11VJd4k41+kY57iGZ/g3qAaZd7W3+CWohdmXJ5gXGChYx/gneEf4KEQXGBfaN/gI+XV5oAbHtCPodvfI5ybXN6f0V7e4qMhIx/hnueg3mOloxhhnyCZ4N9dYpCg391gJVveoCDiHWDfHZeXH1kf3hmiH9wd4eNdwVxf3dMWJG9mRZ/OIuheluWQnBtV4N4e5eniY6A0I97gYWOZ2V0ft2GhYN9VW5zZYOFhXN5h6c3j2uIc4B/f35/a3eigoJ7d3G0Tox6XoJ+eX57S4VrdXeNdHOEaXKFdoK0jIF4eIOCgHice4tAgIR+k46Dc3+Ce4qDgHgznYmAfHyTO4N+VHJ+fFKUe4J9hox6codxim9/g4OceGB6lWF8VpJsgoJ9iIiGgHxzgYqCiDt0gnunenqMoHuXHnh6QzlreHd7dW5ld3I8c3uSi4OEeH9ziYd/jJOEgHmOgIKFc3qBVnOCfXeldYmEd4Z0hXRzdWKEW398Y4l3d393hnAGa39tS1drfL0QgIqKmXxdiUN9aV6Dg12PeYOJfc5/h4V+j5F/enbnhoSCf1N5eIaCg4ZbgIKNOH5qjXuCgoh/fV53oICBhmV6smN+glqPh3+AfkqLWoN9d3R4g39zfnmHvIx/nbaBgXxtnXeDen5/dWaLh3aAhXh6f4J6NIaCenh3lDuLgHWAZXlSlHt7j4mAlX6Gd42GfIV4nnxfb4pWfFmDapGJdnqFmoqJeIOHg4ZFh4Z4qoJ7g5xdniGMfT47g3WBlXVvcnpjPXZviYp/hX2EfpqEfYqUoW97d4OBgHx/h25uhHyAj3B+gHyCeX94eW5XflN7fWN4d318g4R4D4t/dU5WdH6DEHYxg5t+XJY9f2ViAn94jmWAjHrPjYlyfYpqhH6A5oWDgHZViHSAb4iLq4KHpDGFaZJ8eIOHfXdfeKiGgaOCcq5ZjZhYgHyCfntKiGJ9fo56e4R0eX6EfLiIdm5/dXJ9d5p4f3mCgXuKj5R5eIV9fXuCeDGDhn9reZM/f4Q/e2BzUo+DhGSGo3h/i5mDmG2CfpN4X3WwXXhRc2qCgIR/fYCHinGGiYSLV3WIfIaAb3yghJcNdHxGNIV1dox3bm16jEFvaoeFeYKAh3+NhHqFlZR5bYOCe4R+fXxseJV9gYxwdn15hXSBd25vYnlOgXhignd5fnGCdQpsgXZLWn51rAp6w3+ZflqTQoBkbIN8epQagYFuzHl6fXmKmX2CdeCChIOGV3F2foSFglOAeYgwgmqNenx8hH2BUHSbgnd/gHe2VoWMVXyIh3F4Skhbg4qTenqAcHZ8dnyrknOxfoBzdXCYfW98d4t3gI2eeH6AeYp9b30ufIR/e3aSP4h8endke1KSfoCSiYqRg4VWgoZ/goOlf1t7llyFWWNshIuCg4CHjo15fo6MjCt9in3QhY98lCeWCW15Qi2Ld3mScXZygGA3e3SKgXt9hIWBjWp6ipGYf4ODj3GEfYKUOXaFeYJ/cn57hpB0h3l7dmN+SIB0Yoh3e310g3E5cIZwTFmDgpcXdGJ/mX1dl0OCY3CBcIqRg4GLg8mBiXx2h2d9e33ph4R5fVV/eHyJgodphHaPLoJkkXZ2dYJ1elR1pI+BdYp1sGGYeVCAdod4dk2LVI9hk356h3t6gHt+o4x4WXR9b3Nzl3x8fnSLgJOXgHJ8gXeJdHt7M5OEg4Z6lDqFfoFtYHlSkn+DgoiGiIiKhX57eIB+nnRmdphXg1aYaYOPfYJ7jIKLcoCHdotifYx7YoltgWaVlRF9iEU2d3tzgnJ5en11Q35sp4FzeoSNhYWTeYuci4uBfo14hoCFgTt4f4Zza3d/iYSEdoR0e3drjCZwcmJ8eHp9cIVvB3yEe0ZZf4KeIHV5gpF/XZc7hF1wjW98hoJ7l3PGfoiBdoGJfXN454eCgY5XfHV8fn6DWYJ2kxumaaF4cHyId39BdZOBd39Zd6xyi3tUo4aJenhMjFyJdn9oeIFrb35xhqeLdpB2hpWJe5iCjneHf4h7dIx9cYR2i32McyqNhoSJe408lXqAgHaaWpR2QY2CrIN/iVuFc4qEg4FyZn+HZolLlnN/jG+PjpqKcYeGh4KSaIt9cZWEhnqPcpcxgXpJNnd+c4l5ZXl/e0x3g4CHl49ykGiQi2yQkYxXjJV7fISHd5BDYIN1iHtxgo56iG+CbnRlam1wfn9lj3tphXuOgw96f3ZPV4S9tiB5RIugelyPNXV2TIiKdoR4jpWEyIVfhoKFbppwdvCHiYWNWm5pf4CHgGB7k547jnCBf3CBh4N+cH2nfoaMfHGjdYx+Yn5/coaGTYxyon6FcHmAmnuGcXaZh4KKfH2IhHyad4igeYF3a42hcsaIfoB4h28qrYqHh32TPYp8doB1j1WUcoSchIeGeoZti4WDe5GGe116oGKKYHlyf4V0eYyJi4V8foiGjjWCfni4iXiFZnqXE3F/UDyMjHeCeGx4fXw/dYGCiY9Zg4hzlIyAi5KLh4Ndfm6JdHeNfbV/eoeGX3qFdpFxi351bGiNbnx/ZoCEcH1+jH0kfYdnS1WDh3MXfGWLoHxekEJ3c1aFj2+IYIt/htGBfX5/jYiGb3vwgoaGgFp3dJyChod8gnzDMIFucXZ6g42Bf2l1qoOJhWmGp0x/gF1+f3p6fUiLboB7dHx6gpp1h4WJvIWDfpGBkoB1mn2Ed3+Lc2mIqHp0h3uJfIh2LpiPg2h/kDyPhjx7Z4dVjHmAfIHBfnd+ebKGg4aViHRefIZhillhboGHhICNhYKNfYKJhIpJcoB7kn94jrWAlyqJfVA7SH90qH10aHB/RW5+gpmFh3OKe4mFfo+UpYOEh3yYiHx2h01RmXmHfmd5f3SEdoV4enVpbWh8e2h3inZ1d4t8LH+Aek5WnonCRHFvjaV5XYk2empXfIlvkEqMiIvUgoJ/hY1dcHF72ISEg35XdHlih4SGpICKcTR/an97gYKHgX1ncbaLhm90AKxif4hbd4Z0g35LiG5/fHt4e3+cdIJ6c66HhI5/hH9/e554gXd9iXKQi+N3e4h7f4VqdjOQi4R3eZM8i4CRiFppU5B3gX6EpZVtiHyBlISAhrl9W355Y4ZZWWd8doR/hnmBhHN9jImLPI6Geat9fIODZpkRhIRFPJJ6d6h2dnR8g0GIeX90g4iCenqRfnuJkpx5gDiDZ4d6dIxmgIF6h5hyeX+GfoCFfn9rZIVYe39ljIF7eX6KgAl6knJPVoN8qQ90x4yffFuLP4FtXIeCf40eioZ51nqHgYGPgoJ2eeSCh4d8VXV4Z4eNikSCiLU1kW2Lfn+EiYF9Zm+UhYCAa4aqQnmEWXl5fIF3SYZpgH5qa3yCYXuCh37Pioh1foBygnSegoVyfXd6f5OTdH2Ffo2ChXoukYqHaX2JPX18iH5Qd1KWdm2PiJ+BfYh/f4WDhIqMe2V1lGCKU31rfIR/i4GLh4lugImGiFOUhXabgH+Ci1SVFGSBTTZ/d3uMdIZxfoNGdniGiIWChIR+iXx8jpeYcn+IlJuGf3eQQYCWdnegb3J+gIh8hXd5b2JzWH56ZXx1eX11iXhDgINySlKAo60YdjeKm3lblzuBZmJ8dVV0g4aBfM6Jhnh8jV+IfHrmh4mAiVV2fYFtgIJGg3ygOZZsknd8fIaAg2droH2BfoIjsoCFiVGWhYB8dEOIYoODfX9ygnR6gHGAsZJ6d4eDY3xymXuAmIp8faGQonhyhnqBf3h5K5iIcoN1jDaLgY13dnpUlXl5ho2HlHuMgoJ4hYCCi3pfZohdiFmGZ5WCdXyGiIeSb3uNjogzhIR1j3eUg3iblRF7d086inh8gHBhcYGMQWZzpIB9f3+Kf5x+epCRkm9/gYxijHp9ki5ug3qBeHR9g4GGgY10emhlilJ1e196enV/dH9zBoCNfkxZgYB7Lnl5hpZ6YJpCgGNtiX5liW58hXXHfX55c4qShYVz64iJdoJXf3WGh4KIWIF7sjuJY5hodYGHfntQfYt3eH1MgbAThYVQg3qBd3lJiWGLXYhndIl5doV0h6iUfZyeeG9yeJeDdnR8hXd3kJBxdoJ+iX+Jcy6Lf4KBd4lAj4NHdF5uVZZ1g4OAu4qDgomDeYKBg4l7YXqlYH1aimd9k3qHfoiIjWh5hImIXHOGfJmMgnyKZZUTdX1ROpR3dL9scn58fz+Dc4KIeH6Ci4GHfXiNlZSBf32Lmol9gIlsfIGHeJpvf4h5lHmDeIB1Zn5SgXtmeXxzfHmKfjV/dmtRV3p8oRltHYGaf1+WPYFYboV1fH91gIV6x4OHeXeLbX2FdemMhH6BV3R5gpF3fIKGfKEgn3CXk3d+h3t6YH56jHxse3Kojn+LU5t3gHVoRIxghq91eXiAZXt/a3exkGeFfYhNbH+VcnVqdJB3f4SZeH+AeJGAiXkqjn12hXSKQZB+cmlxdlaYf4B/hHiSfo5Kf4V5f3mTe1xtiGaOYHJjonh7jImMhoFmhIqcmV96iXuhiomAf7uRIoyDSTKSd3KzbWR0iIs/cHKMgXF6hI+BjH14ipOrhH+CgWqLf4qdcHiDiIN+dH9/f4F3iGx5dWmRIH1+ZIF6e311hXAOeoN0UFt8d6g3cJ+ElYFhkUKEZnCCbWSMP4GBdsZ8l3hyiYtzennyjIJ9hFl9cYKKfIdrhHaVI4JwoH1jdol/gFNuhoJ7eHBymzCUhlR8i4hwgE1QY5CQe3xtf3dbgnN/sZR+gHmAkIpulXCKent/fY99mIOHlG6ThIpvLnWSiH+CkjuYgXONWGdZiXKJjX6fjW57Z5h8in+ooW9ZfYNYcl5Qdn6MioZ/kY2JfHeNgpZfioJ5mYl6gpSRizGBhlE4JZV+lnN0cH2FQ357f46Df3+Pb5GLbIyQkYqHonmki4VtmFWIiXWGn26DgHmbboZ7dHVyfnV+gW2Hc2uCeY1hPXxve1ZXV3i3GH/Niph9XX9LfnBDhpN1jCmNlZPOf3qAi41rnm9684eGiIhajHqGfIKNkYaglU1+dIN4eYWNhH92dLOHioplfIWKg4BgfX96hopRgn2SgmZwa3pofIqAf4yHkY14hYx+f5h8iHJ4h32DgISEgo14kYaCdCt/joiHgpE3lYCPeWJ3WIx7e5CJpoJ1iHB8sYmFeo94ZX2MZ45YenGCiXeJboyComuAjISIOn6AcmKIeIihQJoxfIRIO4d/dopheXF2hEWMh4GMinqIi3mhgn2MkZlqhnyDbYh9dZ1jf4t2hYNqe4WChHaDcnpmZYdreYBlhnxwe3+PfzaBin9IXoy4nCl8ioyfd1yNOXhtTomLcoBri4eH04h7h36NaoB3fuCJjIqEW3J6pIWUhWd/gI88mW6De3iDh4J9cHaYhIOEdCaZT4F9XnuHcIN8UIxzfYJ7dXB9WnKDb3m+jYqGeIGGenycfoKjfIeDlZiqfMeIfoZ/iXkufIOIh3iMRoiIg39jhVWUfIKAhoKRZoxokXyPgYWxfFN8g2eKXnl1fIJ8hoyZhot6hJOAk0FtgXyig4aPgGWZMYB/TTuFiHR1b255eH9FgoaGinyAeo19hYR/i5SPZohni5eCf3mVNYCEe4KtYYB/f4GBjGVzYmiMbnp5ZYiHcnd4j3AsTYcBVlKAia4PgXuJonVejTt+d1mGhINrcYubgdGAgn+EjGB3cXj3hYqIg1xvcpKKjYtQf4ePP5hxgHZ+gImCgWt/uIGIi3yAo4OQY1eHjXR+d0uNbHCEc11ugnRzgn+QuI2JiZSEd395noaKdYF+fHGJnn1thX+Cf4N5MImOh4B8hkaTgpRyb4pUmHlnhoiUg3aMbId9hISXrHZmf4tnf1eZbYmEdnmLiHiAd4OLh4RMfn95f4OMhaF+mzV/f09Egnx+c3xhf39YR2aAnZaGgnqDdY6KeJCRl0aDeoSAhnt5j0B6eHiDumx+hnN5dY92elldgWWAfGR/d3x8eI+DIX5/cU9WhKp/DnQzjJ14Yog6f2lgf4V8eZ6LhXzRgYR3go5uf3d94oeOiotXdmF3hIqRqIGDlj6Cb4GBdYGHgXxnb5aCgHNdbKdOhYhXhIR5gGxLjW51eHB8c4WCe4ZqiLqNfXx5dnd/eJ53gpl3h3eGlp52iod6fHt/ezGbhoKDdYpJjX1bfWBzVJB2gGl4iaaBkHmYe4OAkZN5UW+UaYxbe26AfHqKf5GAiGuCh4mQRHqDfKaJi4OtuJkuh39TP3+IeZV7bX58iUNueYePgoGCind9iHuGkpp7goeCfIZ2hIp5Zo2Ag6Nze4V1kWqCfXV4Z4pcgX1jf3d/enqIfxt5h3VUWG5uohZ2io2Zel6HR4RkY39wcXw8i4Juy3iHeISOj4N6d+KIh4CFV1V0f4GDiWOEc5M5jHB/jYB/h4B8YHOQg4GFf3aXXo56UICAhYR3TYlrkH51hnOAi3aHfofXh4GTk3JqdISZf35yeX51gpVxdW6Ea5OCgnYui4eDg3yJQ4mEjnVWcVSReYSRgqCPeYU3hq2KgYSBfl9yhl6LVlhtiIF1jXx2iItvfoqMjEV/iXiegXZyeymZI52JVTmaeHbYeHVggoFAvH2Lk4l1goqCinV4gZGZb4R3iWOIgmyPZYaKf4CWb399fGtzgnSGaGeCT3t5YYB9e3h1hHUkhnxkVld/c5AXeG+In39chTyDaGZ+eXF+O4yNc86EiGh4jXl2f3fyhoeFdFpyfnSJgo5vh4WVQaZwkZaCfoJ/hGl8ooKEfoYUlkKKk1F6hXqAfEiGZoCIZoNuf2pye3iBtZGEbHNzY3p+mH90eZyJg4uLqIJnfnacgYlvK7CLhI57ikiOeXx0ZX9Vln2EM5F+oIiEioN8ioJ2p3xYSqVte1l3boGPf4CDjH2IYn6SiYxwd4Z5iIR1eZ6KlBZ0iVE2hXxthXt4cIWPSH95jIiDfoCLfJWBd5CckHeEfZSAhIF/kFN6f3aEg3GIhoCJfXx2b3Ftkkt6d2N7c3l7ZIxtB0N+gE5cg32oEH2hgZWAW404i21siXxrf2+MhXPOeId5d4mFc35y64eIgY5ZanR+iYN+TId8izSHbqRwcXuKf4lcZ4eAfYl/f6N1impMhnqBgYNPhmWMd3xefH10bX92eb+PgJJmgmNxepJ/b3J8hIp+nrV+eoSDiId3dCt+i4CEgokkjHyjVF14VpB1g4aLipJ/gomEcoF5k4h0Z3aYXohXeG6BoIWDfpGDg2ppj4OFK5ONbnqNmn2UaZcdY4daNo+AeUBvYGqDIUtzf56Ddn58joSaWnKQjp6DiHWVh4t9c60ucn9+hGV1houLiHONfH50Z5NoenFckXF6eGCLdjSBe3VOW4SHkC1uZoGTfV6NN4ZubXiHc32JjoWIv3uGeGqHd3p1f/yJgYOEVn9ph4d4f6WJg4VNfW6RUmtwhX2BXXV/fn11XnqZL3OHUIuHiX5qT4xhhap6dm5/hUaIfHygloyKhn2VgXiLdJODhoqAj3iehWmebIqKh38OlYuIhH91I3aKknlcWGF+b4KUeYmBXIBtfXqDUYuKZWx8f4SRZI9kiI5zi5ykmJKObZB6kliiiIGTe3+PXYOXL3eRbEeDgHVwdXl8dnhLi5uChYaHgZB9goF6h4CShIWPlXZ9fXiHZKCIfomjX3OMhYVke3mBZ31zf32KYpN/en6EjXpTe46NZ2+JjNQuknqGq3l4kR2AZ2iEsY1VWn19dqJ5fWKPkYKIeoC+hIONlmZgfqeMh4iBh75fVnF5kXl5hY2HfmZnqG2Gg3Z9WWmPiGONgkN2f2GMb4OIP4WPf3iHfXeLYZKcjnh4mHmBknWIWISDgHVzYYGQkXiMgYdwKXt5hIx3kFl5jICFZHxcknh6kiKNhnOOaa9uioZ/iWhdco1hkVmXb3KNe4l9l4dqdoCIdJZOcHt+j46Li5qBlDlncVg5VYJ2ckdsZoJ4TXtpioN6jYKMbpKTe4+KnVyUkIlzeIpsn0+Gg3KJg2WDh2xjeJV3c3Vyj3F5hGSEdVt2dISFLn51bF9gh4qtRH8piZx/Y6BHjXxSg4NkinSVnpnMhW+Bfohejmpn2oGKf3RidXKEeoeUnHuUnF2Jc4iGbYiIhHxvfKyKg3qAcbhOio1be35kh3NLjG2MZWJ0h4Nrc4p2YpSWfW1uiIZ5gqJwh4SJf3JohKKIdJJ7kIqHeCt5lIuBeH8+iYYch2WbWY98i4t1rYN6hHiMpY96iJh1WYWqaItWdnKCi3eDdIOFiYB9iYeYT36FdY2DeYWVkpk9bntgOn58cYl1fXaJfkhxfYKIb3CIh4V+i3qPlqR2iHuAdnR7dZh3P4aDi7NlhoWFiHh7Un93cpRsdYFldH92eYWVfTd/enRGWn93zBR9rYKedVyPN4NuVYWXcWYljoaT0X+BfYKHdoh0btGLh5GDW3N5iIqSgnOHlHVIgWKJkXOHiYJ5dYG+hIeHZ4SdXm6HV398dHt/UYpwi4FucIJ8g4aMcnyxeYmVeHSEg3mefYZrdYJ3eZizfoCMfIOKg3oqi4qIhn+FP4qMiW9QflSRfHyDaZyQaY9AioWKf4+Vd1p+kWmXXHdoeXyBiXeUeItyhIaLi16Bg3ivl4KDr1iVOWiMWD5Mb3ime31neopKjHmBiouNg5KCioN4jpOhaoKFgm99hHSSV3iGgn+ya3F4e2F7kHd4fn+AZHp7ZXB9fXZxj285dIdqS1V+ftU0gESImHRjkTd/bVyDX458fIl3g9SBh3SEkDWAg3TYhYyFfVp8XE6LgJVtgoiCUI1tjoNigIiDgmp6oIeJdX+Ap0ugiU97fYKAfUyLcH2IbXV0f5OCf4R/tJGWU31/dXZ8nn6HgoGDf56UnYB/gnqEgIN+L5eNgX95hEWKeJhiVoNUmn5+hlmliG+SjIKei4F6knVhb41edlt3Y4GFfYiKelqNcXmNf4pVfoJxdY6DcH+ClSx6f1A8aIR6ZG9kcoqEQ2dtoH+Af4GIhI+HfY2YkGaSjYiFfn94lTmGc2+AlXV+fn2MXolwfWtujl50cmSJc4B5c498L3+GbEVVfoC2DYy6h5Z2Y44/fmtlh3xvblSLRHrRgYdzbY1vkHly5ImJh39YdHZ1koGBQIN7mTynaJiMb4KMgYdnc5x7godafK5Kg3pOiYqHeWtShG6TdHZlcYJwfYd5hJyJgYqAfGZ2fpx2eXNDhHSDonN3fX5adoWCeSaPgoeRfntGlYaBXkiGVJt/dnV4eZx6gG6FiZN4iYl3XG2TYJVkk3KBiHyLd4pikW98jIaSKoF+admAl4VsiohEhXlYNoKEbZ1xaWyLh1R8mZGEiYWGiHyUh3iIlYZ+jm+MaXlse4pUc3d7fYl1epB5lXeJeHWEcIpgf39ldIGCeHmPczx6fXZOWYCGdUCCAIyTemqdLoVfZIB4fHWTgH+Dyn+OeHiIXnWEf8yDjnOCWX9ud4dpgDuHaJhMgHCDenhziIB/ZX6qg4l7anLBXY+DRIBjhoZwVZVshDFldX6Cf4aNaZKxnIVadnlsc3+WeGR3iIl/gKh7foB2fHSChk4keox5iHGPaoqBAB5pg1ygfH+EkY6Jbo6KjX1rfZeVcWVwgFuEV3AegYxyf3uHYYJkeI2rki5siniohHJ5Yc6TOneJXUCJhHqqfGlzj45FeWalhG6EhIuEinpvkJKSdo1/e2R3eG64ZHKHgnygb4J9f4V1iHKHb2+OYH1xaIFzfHp8f1owf3V5UFp7fLM7eo2FkH1ehjR7amuMiCZ2bIkAeNd0kWxtiIp5g236hoCXcFqCeX+QQIuHh2OHTYZwj4VgfouEh2CGnn57dnZ6iAB0f0yDf4dzhU2LaIuTdoF1eYN1fGyUe5eTjJB7R3JvjG15c2CUeVePfHJchHJGf4d7LqeNe5F1e0uMf40rbn9fjHqGV6WHd19/fYuEWHtroIVSjZCOhluRV36CcoJ6jHuNSF2JlIcltYhwwn+Ke4tmgyqHmHQ0rYpgo3l6bIaER5Kei4yBeY2Pk4hkf3SMmHlwe41xb4F2jWhVi4SJknd0kYCWf4ODj49ze258hld2hodzgIprT4uGeF5tf3auF3JikqF8bItNh1xuf4luhk6DgWysgY+EcIJ5e4R52Hx8iW9gbnp7iVSWV4NvhFFhd5lZfXx7goltbaOHioGScHtzjpBojIyKYIBWiHKGv21/aYF7WIhaiZ6Hd0yVf3p4eJBDfG13fHuOi4xoioVxeIuGcjaPgoZKc5o0ZXhybqJ0VZWAfpB4ipd7eniAfoKCeZJ6eHWCZKFqbV94iJmChIyEiXt8hX0Acn52goGIf3+EZaojgXhCKYt+x6R2dnWDaUN6coyMgXx5hHmJeXuGnHdrgIWQbHpaf4x9dpl+fZhyenSAf3eHcXVuVQBwhIFdjHRyeGuOcSF5hHpLWoB3fHhpb4eheliHH1lvWIJ8dJNsgot/z394hXOXd2x9e+aQhYWEVUpxgIKPm4Z/aZtEohOSdHhuBX+AXXabgIJfeHm4aJKBVX9jiYBzTYhzgIqfjX5wY3d9bXh/SnqNboF8f36eiHB6b391c46hZomDdYmIY3IboYJ/hHWcRZJgcoNHbViUg4V7dXdNhIR/g3NwdsWRgER8n1UwcYFohnZ0fHGUgIZ7gIaCkFB5gnyFiXeDgHAHMG+DPSh/fWeYbHp7gX0+bHB6gXN3got+gYd4iJV3coCEe3l9gYSNZXN8cIOVcXyDlYRxhW1wZzmHaX17WJVxaX2QiWU+dox6DVt5eIsYb1yJsXtelKBiXVSAT6SuTYKNg9GVdH92lop0fnnbj4KFf1dbaHZ1goRUd2GHLaFOknl+dlp4fmV0p32GhXZ3uG+CgF96hYZ+dk1xaH5snnducVx3g4d9RHx0enqDf3hxljF1bHt8gGGLem5+gXl5ho1zM22Ehn53nzx5eGxwp3hSlHx4lXiAl3uBg316f4Fwh3F+fI1Vkmh7YniKgYR/ioiBen9vg4JxinqAm4eFfH9iqxh4gT4oiXO8iXVqbYJzO3Z1hIR/dXeEgoFqfomcd2tcgIVeb3x0hX1vgn1qkH2BeXWBcIdtgXRLhGKBf1yOdGx8bIxtNn6AcVBYf32EeXl/iaF9YYIycnNef3NunFiEk3/SfnOHdZVzXnd69YyDhotWam+BbomNe4dxokeoEYhzdHGBf31ie4t/hH15e8Vgkn9SiUmGgnZOgkGJhpV9em9mdHpwf2T6e4Z0hYR/epiGbH10f3Z9lY9vgH1vgoN5dCp7gm2Ae5tPk21yhj9wVJV/hIJ5kDF7hG+EeWuFp4+CRn6PUzV3dV2Nhnh8foyIjIaCjIKMRYJ9fJKGfYGQhhQhcXs/Knh0aY1we355hD9xdn2Cc3yFh3aCiX6PlXhqjYB8eXZ6gYFlf3huhqZ1e4OIfnSNb3xuVYlgfHhih3RqfH2GcCt2f30HVHVtjyNyWoWmfVuKmGhvX39qoaVbd5WGzoh3hXeUgHWBd+aHgn5qVnJud3GGiXJzfJEtjViseXh4iXl2XneofoWHd3myenKCXXaLhHl6T388fnmldnhudnaLi35Wf3F9gIaLe3aQPnlrfHh3domIa3l3dHmKhnYxY4KBgHeaQXR6bXOid1aSeneOeaeWf3aIfXp8f2WKcH59mWOiYXZddZB/gneQimx2h3F6dXZ/gHuTioCDkE+pLXx5PjKTc8F/dXVyhW85dYCDgYd+an50g3J7jZx5e3WCd2F3bG+CcmuCenejd395eX9vf3WFdU57Zn59XoV+a3psjXBCfIF5UVmAfmV3gH2Fon5cgzJ8dF2Bf26tbnKNfdGAcoJ2lH1yfHzkh31/kVZtcoNzioN4hHKHPYkUkXVxb4N5flh3lH1ycXV7uW2KgF2BUYBpc1CEPImEo4Jza214cW9rYnR9k3OFhoN/l4R6e3Z7fnaSe29+eXiMh3x0L3+WfIt7nziQZ3KIRXVUlICFhnaUNHCCb4V0TYJ4k35CgI1Xhnt0XYOBenGDi4iMgX+MhIc4foJ3kYl4f32DGiJ1eDsydXRoj3B5fHeEPnJye4NzfYaFeYCDfoeWemqNf4B3dH98jGmCdniDp3d+d4qEdIh4em1Wh2p/fluFeGl5jYV0NHiFdwRRd3aYHH5Sh6N4XX+beWxjf2mpn0BcnoPOkG6FepWBb3p58oJ2dWxXg3F4b4yJf4F7oD+oVJRzd3mJa4Jdd4iKiYR1ebuCjoBYdoqAdntOf0R9cJJyfm52eI6YgWGAdYWFiYh8pJBVfGh/eYFeg3prhX50cn+McS9dgn9KbpcGZYJtcKd7Vpp/WYlqn5R1AHWCgGF4bp5senShUmVYbl1xgIt6g5eJgm9/cIKGe4CBeZeHeX+Fd5clgnpGKopzw4BvfXGCdDB1b3yDjX1/g32FeXyJmG2DVoN5bXd4c41sYI95cJ1yfHt4f217cWx7TmwBhX9JhHttdXCNeDd6h3BMXn6Xc3d0ZX6he1h5J39tZn5/c652WYV71Hp8jX+RbG99eex9d4SOUoV2g3eQgn6Dh5MxvRWGdnhyh2t9VHaTf315fHmlc4ODX34GhXR9UIJJgH+efH1ydHV6bX9sQYSVeYaHenGYhHWgfYJ7doiZa4mBdJSQTGYyjIx2i22aE5BrdJRLa1CYg395fIdKgGdyiXelgomYnDGBilp/eXxmf4B8hH2ViIl7goqDiBF6g3KVg3qEgXUjFm2DRSxsenSFcH6CaX02bXZ9hnSCh4+DjIx9jpFrZH2Ef3BvfX+CdIOBeYO2fXljjIJyj3J9aVyHWoh7YIV2aX97f4Mzd415AlRvc5AWdVeJoXVXfJt+Y12EZJKeV06OicmEc4R+loVwfGrsBYd1PleUd29xiYR5fnmbPJ5ajH93cY5Sbkh2j3J9f3J4pY5xgl51gH5sgkp/RoBxm3B+dXd2j5GHe4JtiXd/gIJ4l4pynHCFc36OemeFh3eKh31zNbGDg419mECSeGyJQXdWkX+Bdn6TS3yIWH15dIJ7nHw4fJVjiXd5anpEeTx6nYRbj3yCiIkPa3OElol/YJR3NiN0gkEsgoBgj2t/jYOBOnZvfYptfYeIZoSDe4KRf3aChot5eXZ6lH56fXeGmmpwh4GJdotvfmxakHB6fl6Pcmpxd4pwM26PfQ1bdnSzFGlbhal4X5KdRGdTgmH5nlGIhIHVhX97d5qBdHh5542EhHdWb2p7fYaEel9pfTeWUIt6gHFOe3lic5yGhIZ7dr1dio5ed42FgHZLgGyCb45zdHNndYOkc2KCeWyVf3l3dJUvd2x0f4CBhJdsgYF3foaFdDZ8hYNgf507anhvbaN3UpR/eI95oJWAgX9+fYF/ZJN2eHWFWoZmbWx7i5GBfpKEh3B/gX4ua314gJOIhXuJXKohgIE4AJB1wopyaXKDZTl7c4yFh2t8iHuId3uJmXpteYCeYnRjeoF8bZV7fJVxf3d5fXOGcXB0UV5sfH9ei3Rxe2yMeEB5gnJNW35/cXdwa4ygel6JMWBuV4V1dI9OhYx92X96f3KXd2l7fOuFgoGEVWR0hXqFi4mFdItCihKCenxyLXx7WnqifYFod3m4aZB/UoJYgH9yS4FphoiciX9xa3J8bX9smXyKd4OAeHybim57cH95fYuRaYSBcYmEY3ImjH9+i36YUZRycIFBc1SSf4J6eI4/fYhpgnhwgcKcfz16olWFeIJihYh2gH+ThY6Cf4SEikR4en53h3qCj3IILnWBPSh4eGuac3J8f38/bXR5hXd8inxvgYl8iphzbIeChHlzfoeEZXp7dYOYcnuAlIZ2iHB2cUeBZHx+YYt2b3iLiHced4J4CFl4bK0bdmWHp3lbjJhkaluBYaugW4OPgtGRdYB1lYFYe3bdh397elVabXd0gIZnbW2JMZBTi3h9d4t5fl11poCEhHV2u2KDglx1hYJ/d0t1X3hol3d4bmx1hYd5U4NzfIGDhHl2kzh1aHd7e2aGpGt+dnh5jIp1LnWDgoF4nTx4f3J1qnZUlHp3kHqYloGCg314fX9pjW99enxVhWRuZ3WSgIJ9iJBqeIKZf3Fvhn6AiIGAhpBXrDF4fzokjnHCfnNycINyNXhzg4WEemiNb4VoeYifeHhfgXtYdHJ2gnhwgHpqpXN9d3d7c4Jze3ZDgmB9gWKOdnB4Z41vSHx1e1FXgH1meH9/iqF9WII3eHNefnlqnGV+kHzTgHSHd5N5cnp57Ih9g4ZXYXSAd4CDf4ZufkCsFolzd3WEfX5feaB9f3l6e7tyiX9ZiUyCfnNNgEWDh5t/dG9udnpzanHdd49vhISAepqEdXx0fnxskJBof3Z1hIl9did8e2yLdZtKi3BwjEpyUo6Bg4B6oDNuhm+CdW6DdJSAQH2RVYB3dGSOd3hugYSGiX2Ah4OGDHyAepB9eoB9gw4icn05L3B0Z4NxeXx2hD5wbXuCdX2DfXeEiXyIlHdpjH5+enR9fIRmf3hyh7BxfHuHhXWIeHRpV4Vje31dgXdreICFeil2e3YBU3ZzkBh6XImgeVqDmXlwY4Fzp51UdJuB0Il3gXqSfXB/cemDf31pVG90dmCPg2x8e5Iunlehdnh2inh0W3SfgIiEcXbDd3Z/XXeGgXt7S34rbHebdXxyd3mLmH5agHiCiIOKd36QQ4BpeHh7Zpp/Z3p3eXqLjXcsZIuFXnGaQ2x9a3apelSTf2WMeqCWfbJ6e396fGaNbHp6jVZ5YGpkcoGLf4CehYJ5f3uAg3d/hXuiin9/e2CnNYB2Oy+JdsJ1bnl0gXAye3SHhIt+eYF1f21+hZ2Agml+cmR1dnB/d2eQeHyncH+Bb39veHJ2c1dlYHZ/VYJ5b3pvkHMxeIdtT1p+lHZ5d2SAoHhaiCx/cWZ/hnCrW1aPedF/YoR7k3JtfX3mh4J4klRodH53j4N/g39+M50XiXZ6dYZ2hVZ7ooBtd3N3tmyKf159AIFkdk5/NIOFnn1+cXJ3ZnB/XoNsjH6Hi352loR5mnZ6e3mikG+KdniFhlx3L4aMe4Vym0OMenOXRXNUjn+Ae3iOPYCDY4t4/oR3l448fZJYfntxaXx8fHmEioaEeoSGhoIfdYNzjYqCgI+OGB50cDsubnhljnF5hGOBOHFlfoZ3foCEdoyJf4eQd2eIgoBweXyAfGh6fXGGuXF2WJOFdop2eGZhgl+Ef1mIeW98gHSCJnKIewRUb3WIAXNReZx2UYSWe1ZpgmyNiEk5lIfQiniAepJ8dXt35jOMgzxWbnN0cY2GfH6FjzKSV594d3mJVWRJdX+BhYByd8h3g39hdYyDentJekF/b5R6fXJ1eIuLfG5/ZYChioJyfZNPhGp/gXZvg4hggIBwCn2GdEBngol/dp4ydn9ydaB6VpZ8f496oJeBZpCAkW96ZJJ0gHuIYnRgfmFxi3x+griJh3OGfXiGbX+CfX+LhoJhX6ophYxELI13w5x4dHCDcTB6boiFlXp/iXeId3eLk3eHepF5dHh5eXVxaYZwV5BxfIF5iHBocHOCYYJKaIJelXVteHh4dzV9iXBJVX+Innl1b32efU+JLoFnZIKVc6lrTXh22Hx7hnmOdHp0cPxbiXunVoNyg36KgYODipslpCOYemt5ik+BMmuHY2NbgHe9d2mFXpBMhHWAS4ZZj4yXj3J4cXaEeIJ8TGKLgoV+gnOQQn9xeH2BaY2VaoKFfXuHiHA2doWDeXyaOXZ8aXWmeFSUe1+LfoyOgIVyeZCGhW2VdH1+nliLZXlpeomIgn+Tg1V0f399fmKGcoeFiYZwmFurKnl9OiuIeMCYdG1wh3U3fn2JhId6ZoqfhHp6i5p8bXuDhGB3cXiHcXaJeHyCdHl8eYNthWtzbFV4cH+DXoF6bXd0jXVNf4h2S1t+pG91cHmLnHZchDZZcVmBkHWPPIOMgNWBfoF3lXd9cnz3jISFiVd2coOBhIiCinWCH54PgHSBfHp8gGR6nnqCenx3vWGJhVyBWIB/f0qAZIOLkoh3dH94f3OAho94jnV+g396mZBwoXSFaX+MlGyEgnOFf3t2KaSIgYl8m0eSfnKMSXRUkHyLfHx5Q3mNSoZ7eISiin89eqFjSnd3ZHwIewB8h4eeYn6Gh4gLb3h9eX+Ci5B2DyFtfkIue3lxim9+jYCEPnN2fI5xa4qDa4OCfIuTe2qChoqGd4CAjHt1gHeGw2Z4hYqCd4xydm1VhWh9emWSbm16e4hwLGmHfwdYd3bPFm9zh6t6X5GcAGtagWz+nYOFj4XTiXp8dZZ5dXx234SBf3hUZG9/fn2Jf5FsnyyZV419g3tseX1gcK6Bg4h4ecEriI1fe4eEeHtJgll/c5Z1hXVldoeYimyDcG6bgHxxc5Erc2t2fIBzhH9ufnp2fo2NdC+GhYJoe5pGb4B0crF0VJJ5fI16tZCDgYV9f3yAaIF3eW+EVnljZWt4jYuLfoqEcnZ/h33xYYF6gICAg4ebXK4yfn05JJR1yIh3cXKBaTh9d46Ghnlmf3+JdXqHnHptd392aXhIeH96cZV9e6xwg3V9gHGDcXJ1RWZmfIBjgXd0c3SNdEx6eHdOWYB7bXdyZYmmfVqKN2pwW4d/cJ5TgYiA1IR6hnWUfFt8e+aHf4GGVVF1f3x/hX9/bH86pQ+FeXx2JH1/YHiaf31hdXnHcYqDV4RThXhzS39bhIidinVzcXZ7a2p+jXSVe4eDgHqfiHBsdoBzg46Cb397dYiMZXQpoYF7jHqaTpV0b4tJclGUe4dse5Ema4eAg29sgX2Pfz15kVhleItpg3F4cIKJjYV+g5uGgjd6gH+aeXeCcn8CMXF7OTJ1dmyDcG55eYM/bXJ/hHN+hYh4g4d8jJtyeYOCf4h5fomJXn54d4WSbX5+lH93i3Zycj6TYH5/Xo9zbHZ7iHYReXd3AVZ3cZ0dd2WKoX1bhplxYl1/b6yiPICbgdGoeYR4lntzfXPmhX+BeFJqcHVyfoRjfXSNNJBTi3eCeoh5e1d2qn2CjXR3vXCHf1l5iop/e0t2Tl9vnXJ/dXV8ipWBVopyfYCChntxkzh4bn18e2R/kWh5fXl5go51LHOCh2V4nkRqgm92rXhSkntlknyJlX6GiH1/fIBrjHB6eIJMiWZxZ3eLiX+Ak42AdoGNgn9tgIF/iH6Cg3hdrjZ+ezYmjnPGo3F4dIJ0NXhuhYSLf3d5eYphf4mhhYiMgHNhd3p2fHJllnpolXGAf3qBcYJxc3FJbl+AglyEeXB6cY9zSX96ek5Xf5Nnd3Zdh518WoA0e3Jlf39upEpvjXvWgXmEepFteH5354OAf41XbnWBX4N/fYSCfjaWD4Z2c3eEeoFcdqN+fXtze79ujH5ZjUaGgXhNhxqAiJ+CfnVoe2tvf2ygdol4hod+bpaIeJ90f3qBjaZui3d4hYFleSmIiWuLcJ1PjXtxl0ByUpB7hH16iS58gmiLd02Cf4+GOXyRUXx2eGaRe3x7gYyIhHt/iYWGCnaCfoV+e4GRghIqc3g9LWp5a4pwfINdgzd2aXuGeH+BgXiLi32MlHhpg4B/dXl+gHxlfn9xhbNseIKQhneMc3dnXIJagX1egXZqfHmBfRZ0fncCVXF1mBZxc3+geFiDl3tlaoBykZxYZZGE0YRngnmTfHuAcOQzgnZiVXZzb3OChWV+gpUuiViieHl4iWxHTHeTgH6Nd3m5f3mAY3mGf398Sn4TfnijeHp1fXWKiH5qhXaBp4mFcn6ROIBseYF2eYmTaH1/d6xwj3czaISJe2+bQHeBcXmqelWPenuMdqOWeoZ7foxufHKTdnl7hluIYYFjeox+f3+siI19hX9+gmp/hHiLh4Z/inutM4pkOy+Ud8RufXJ0fXM0em2DhZZ/foV9kn15iJyBfX2NeXR5d3NvYHKGhWiJcH6Df4ZsW29/dGJ7XzN+V5V3cnx3d3NFe390TFmAg5d6dWZ+oX1chTOAUWqFkmumZVKGfNKAdX92kHd7fXndjIF+oFZzc393iIJthICNLr0niXhzd4VggyN3mIaOXndxwXmMgV2RQ4hLck2CRYOCoY1yd2x1cXZ6g3Zaj3yLhXh2mYZ1hHJ7fH+PhG2EgXR9gXt4M4WHbYlwnkqMbnaZRGtUmXyDbn2OE32IYIh4ZoR0p4Q5hHBhfn6AbKB8eIOBhH+LdIuKho0gcIR5o42BhHWfFiN3iUIreHZmkm10g3d/QXZyf4h3eYOLepGAeoeRdF+IgoxxfH6Nf3qCe3CFpXd9hI2Pdod6gGtkhVyTe2CGf3F6fnp0NWWAcy9XeXiCPW5ve556WZuXfVlig22MlWBVkIPRhnuAeIx6fnB77IaGeWRXeW96e4eFZ31vnDGZWod2f3mHVnYbbouKhoJ5eLhwfoVecoqKenlIYFiAb4h2dXFtc4mJgXSGdXxyg4OBe5aOgHZ0gGiLjpVxiYlwi4V7cimDhoF/fJtKinh7nDt1VpaBiX9/eTFmilyUdnSTopx7M358YDx1dml9AHt6gIaNnY6AiX+UC3p3gYKKfXdvfxksdn1BKWV0ZH9rcoF9f0NueHmJc4KHhW2Yi3yKk35jiIeJdXuCeoFmfXxziZhpdoiMgn6McW5tYH1uf39mhH1mgX6JfTZ0jnkJWmRwkx5xbo2ieF+RmGBsXn5vrJ5if4t/1oV3gnaWZH55deKDgIh2VnVshn2HkIFfhKEkh1iKeXqBinZ/YW6ngYeBeXy7UHuLZXiIeIB8SYBTgW+OcnV2hnyGi4N2hXp5g4V/fnaOMH9wd3uDcIeCc3qBfH+NiHAsdIKGfnmaPHmGb3Szc1WWdmaMdqCUh4Bye5CCfm2KeX57ol6YZ3Jrd4iEin+PfgB0gYh6hWGDdod6hX+NjGKtNmx7NySOd8eacmtug3Y3eYGHgYJ1i3+nj3p+jZl/W3x/fmd8ZnV6bGqFfH2fcHd7foNtgnJ4bk1+an2FXoJ2b3lwj3ZJfIR6S1qJnnF5d2WKontYgjVwcVh/nHajQ4GOhNh9fYF6lnx7eXzpiIOBjFVjc4aEfIp5hXCWKqcPiXZ7fIB9gGB1nHx+eHpyvWmNhl6CUHd3dUuEUYmFoYWDdHx8fnxdhYx2jnx9f3R9no51pHaELmOLpXGChHeFg3d5JpyEf4R7mkmTeXWQPnJSkXyKfX2DNWyPX4N5eYCEj301fpBggHiFaYROfEuEioaOfH+GiYgLcIF/fH6FiZp/HCt1fjcyd3NpnHF5jHuEQHF3f4Rzf4CDeoaFfoyVfXCHfoGAfYV+imx7gXSImWd+g4qDd410bXFUjmd+gmSReW91g4l1I2SHgQJVfnieF3JziqV5XpSaX2xaf3X7rWR/kH7UloZ8eZh8Vnx25oSBf3dTYHN4foOCe2J3gjCJV5F6gnxneX5db6yAhYp4eshYh4lbfI+FfHtKgEZbc5N4dnZrdoqlhXyHc3GcfXt3cpUmfGBygX5iiahueH94c36AdjGPgoJ5dZc72oBwcrV5UZhrZZJ6h5N2hnJ+cX5/eI14f2SLVZRiZ2x8gpmJg56AgHN9gICHY4J/gX+BgIWoaa84dH03MI52yIpubXSFZzOAcpWAiH94iHuFeH+KnXByYIJze39he39mZax+d5lpCnp5h3B+cnZxVihieoBiiXd1eHiPdEmCgndNWoaYmHxwU4uhfFeGJWpwXn6EcKtdeYR914F/jXyWg299feSDg3+DVWl1fnmAhISCfaQ8wA+UfoJ1KHp7XnuTfoBgcXHBbIuEU4JFgIB5Sn5GgIyXjX55bHR1cIV7lXWSdoOFe3iejX6Wd3p5kY+gcJR/d4V2onUtj4d8fnKXSYt8dpEsdVKSeohte5Mnd4J9kHdYgIuXhTJ9jVVjdXlpgHh8hIKKi4p+gIGLhjF3gn2IfnmEamUHNHB4NyxqeGtsaHCEXIo5c3J7iXqDg4N/hIN+iZN9eICHeXF+fYd/XH2Ac4OsbHl6nX51j3Nta1iHXn+BY4Z4bnqHgHkAd4ZrAlloc5QhcW+IoHpYlJlyZ2B+b5GoWHaYeNWTfXl9lol9gXXbLIR8ZVJxcmlnfYZqe3qIMadTjn2CfYZvdlB2qnmFi4B3u1yPgF97jIF6d0gCRn5tlXp4eXR3hoiCcYtugaF+hHhxlQR+a3uAeW+Gh298gnqGdIh2MWmHgntym0J3gHJ8rnhTlHZ8mXqzm35/f4CPf310l3h7dpNQhmGEbXyOgoGCkoSFdoWIgoZpgIJ/i3+GgYFqrjiPdjYhkXfHjH1scYF1NXlziYSXgXx9dJNqeoecf5tni3l3f3p2dE1sgn+Ilm9+fn+EcmVufXNVf1V6gl6QeXJ9eYRwS4V1bktYf4N2eXBTg5p5W40se2BmgIxwqHhui3bUgGqGeZB2fnx25IaCf41Va3N/eYGCaIOEiy2sK493c3mEZ4ZFdqKCZWh7c8OGj4NaqTmGcHJMiT+CiJ2Qc3ppent2eoyYbpaBiIV3dZSJc3pqeXl+kI9ygIB2gnd9dyaJiYqIc5pOlXJ5lTxoU5J4gmmCdAB7hG+HeGmCg5aENXyNV4F+emSuiH5/goyHi3d6hYuQCW2Cf5qHh4SAnRoqdnM9K3R7ZJBsboR1jzZzfH+JeX+FgnyOj3mJj3dsiX2Hbn57jnJtgHh9h4BxfnyKi3OLfHtqWIdWjXtchX9teHKCbTpdfXUHVXl2gzh5ZX2je1yimHhfZoNykZxRdI9714KAfXaTdoJ+d92Df4JyU3Fwen6DhVd+fKgXgVGsdHZ5iWhrMm+3iH2Le3jBZnZ8XXmLgmx2SQk+f3iOc2x1c2yMh4N/iFx4hoOHcXOQP39qaIh3f4mCaX+Ad5xshnkse4Z/fHWbPHN6aXWWeFeXen2MhJORgItff4Z5emqNd3l+hmR9YYFpeoiAg4CHdJNykoJ9hWN8g4NujYCApFmrLWuKOy6Qd8O6cWxqhV85jnyag4d/fIN9iER6hpaOf3KGeGZ/eXWBVHd+iHWFc4GAe4RufmN6el6AXlh9V4V/cXp1hGJBfHp2Tl1/hIZzeYN3nX9dkTt/Z2Z/kXCoeG+Eg9d8hoJ1kHt4b3Xnjn9+l1WAfIOBiIRqhnuOK5cWh293doNuhC92lIFpeHFgvWmUg12JS39xbk55S4aPk350dWtye2p/k01zqICDiH90kjmEb3mDgWuBmmp7f3yGj4pyK4yLhn55mzt7fn9/rndYknV1kHiOn2x+f3uBh4Zpe3d7en9diWVvZ3ehf4eAjotbdIWMfntheHiFkIKDcpZlrzB3fTkpknDGcHN5Z3x0MHp+hoOciGd/fIh2eoqZf3l9iHNug2Z6hXJzhXd+jXB9f3qAboduem5MgGyBhmKVfGt8coxvTnmGbktcgICdeXZWiZ98W5M7eXBcgZttk1eEkoTYgHd/e5CJgXh864mDgohSa4GHe4GPY4mCkSCWGpV6cH18fYJgeph5gH97W7tjjHxghFJ1dXhMhFaGhpCCeHV5dIBoiIWYf5B5goaKeJyKhHR1fGpykKVxfoR0iYd8cyaVhX6CfZpTinl8lSZ0VZSAg3x+jh97i2+ZeXh1iZx7NIF7YX52e2d+e3pmhoWDlXyBiYaKEIF4goCBfo+DfA8rc3w8MgBwaYR0aX59iT9xfn+Nd26AinSfiHqLlXNwhYeBg4SAfXlMe35whphgeX6HeX6MdWttXYlogYNgeIVteIiKcyh3h3sCV195miB6iIyjdFiVoHNqWICHsZ5ogJKB0o57g3yYZYB3dOaIgYN2Unlvf3qIhnx8gqYglGCbdoCGiXp7W3enfoV/eH3FaoCHYXaJeH57SYBLUnaIcFNxb3yKoI10h3N3gn9+a3KTNoNweH58aIitcXmBfX+GiXIthX+BXnmYPXKGZHm7eFWWeIeMfqKQaohwe459d2t5cX53olqGZIBrd4WCf4qdf25uf4B/hVyEe4efg4SGhFGsOm55OS2ad8Zwbm1yg3wzf3uJi4iGZ4NmjHiCipiEXW2FcHR/dXZ/U1yVeH2saHN5e4Jug3N4Y1hnZn2GXIh6b3p6jnZTgIlyRl2JuHx8bmCKoXxUgC9zcF19mHWkXnx/gNt/f358lXxXennnhIaBilRodoN/gIN8h4eCJ6cOgnN7fX98fVd4pn6BdXltvVGIh1uDOnh5aUaESoeJkYN3d2R3dGiHf211k4CBgX12m5J+VnmDdn6Ri3GghHiJhV94MJuJfnRylkiJf3uRIHNUkH+CeH+sI3qKV49vaXyLk4kseY1bf3lxZ310cHyHhnyIdX+GjIYKYX97ln+DjZ58ESd4ezktSXVshml1i06CMHhue4xxjYSDeJSJfoqOdXOLhn92hHt5fWJ8eG6Ft2t7f42DdY5xbmtjgl9/f2ODfXN5foRzJ1WHdwJXXXe2HXB5iaV4U5SaYmxahWn8pZJ3gHrVfol4f5h5en1z2zSFe2lRfXJhfYCGXWqBfiuNVIR/gHpqb3dTaZx8f4SEeL1Qk4xddIuDc4NDhU6AdaV4dXpmc4mifH+JdGO9fXl0cJgJfXRxgHJtiqxzfId5goGCdzJtgoRac5c9cYJ3cLN+VJh3d5l8cqR6hWN9i4J9dXp0fUyHU4tjeGt8iH6Chal9g3d8gnqOYI+Agnx+gIJ9e683k3c2KI95yZt7Z3F+WjOJa5qLlYZ4gneKe3uOmYhqeYt5koRrfnxHbJKAanhvent0hHNmcHFpV3JgeYFilnp3fHOEblOBe3FKW358Z3ptSIOeeFWNIm1sXgCVbKFheIV02H+GdX2UjXt8duKCg3uNU31zfWt/hZeCfKgzkBGDgIB6BGx+T3eXf2uZdmy/bIyFVJE/gG52RoFTg5Wcknp7XHd7cXqIgWaYe3B+cXubj3l2eoJ5ipOVcoCLeYV9YnImmH9rinKXS4p0epk7Z1ONeYAAgYABfYmMi3VkgYGNhTB9gFtneX1hjoB4f4B/jY9wd4WIhglVg3ymg3CEpI0QNXd6Oyh/e2iHbmt+fIw3bHd9iHmAhYN3lYp5i5BzcIp/f3eHd5KCeH55eIGGcHh6iJF3iXxxb1l/XX2AY4GCcXuHe3M2VYF3Cld8epo2c3uCn3pZpJlxU1+DXpCgTIGLbtqIcn14lXV/gnjkhIN/dVJubnt8f4BVd3mkNZJQlnh4f4hwd0xuooWHhH98vVGRf1R3i4KAc0VsVX9SkHtveHJ1ioh/e4lZfIGBgnVzkyV6dHmCe2qLjW58gXyFfIh6LGuIfnt2l0NzgV15o3ZTmnh7l4aRlXyGj4GDgHtwmXN5dY5YgWZ0aICPgoKBj3GFanCJhoJqfoGEdYKIgK05ryZgeDsoi3jIf21ic4JeOYN2m4aLg3p/eoEafIqckX5qhXtrhXiDeVBxg4FqmWx8f4KAc4BveXZYfmR7flWCeHR8eIhfWYdsdkZZgYV8enJ+f5x4WI8wemVmeJFyo3iChnvUf4N/eJGFd3915oZ/f4pTdn+BfIOBcYN5lR6dD4RydXqFeH9Gd5CGeXVwYMVag4VWjTyFXnJLhUmGhI9/d3dsd3lzfoygda10f39zc5OJcX91jH14nJVuhX93fXyAeieFh2uLdJlBk3B/iT1zVI99iHWKkSd5iGeDfGCAc6CBP3yfXH51eGmie3yAg5WCiXqDhYaMC4+BgpKFWH2dgS8mdok/MnF7Z2FsdYR5iTqBd3iEdImDh36DiXmNkYp1hXyHb399kH9jeX6Ci5Vtf4KLeYGNcnZxWI9ee3tfgXl2fX2CeUV9foZGV3V1oRdlRIGhfFukmHtrYIh2jpM1dJ520YSIeXGQfH12ceKIgH1yU3Fyc3qCiFZ/c4YXgmCTfGp6h3JrTHOOeoeHf3+/bXSOWnuXhoB2SIVGf2qgeXd0dnuKg39viYVeeHiKhYGXiIZtb4BpgoWlcoyCcYuLf24sio2Ain6XRZB3e5IjY1aXfIx5erwkWIyCs3tpiYGQfTOCfF2ZeWZmhGF5eYaTipBygJCGlA56foJnhn92Z3IiJ3d9SC8Gf26ZbGR5eIk1f3d/g36SiIt1hot1jJN7c4iKf5CCfXyNZHJ4c4iPa3p7ioBtkH1yZliPZn+CY3+BaoZ3imgofY92CVRvhIcbeYiLp3lWipl2alt+fKyYWH+eftmKeHp/mHOJe3fih4KEeVRvcGF3fI9/fImiK5dbgHN5gYp4f1d3vICGiXV/sGuPf151jXZ+fUp/SlB0iXBoc791j6qFV4p2d3x/iXp4jhWCan2GfmCNoGt2gnSDhIdxK4iLgmx3mi5miH94wHxWk3hikoilm3yJdn9/e2hygHV8d3FahGN4Z3SMgHaAmoSLboKDeohugYGGpoh8inVerjl+dzgyl3bHf317a4F7L3h/h4GXbXmBdIp8f4qYfnp2hHJzgHBzfV6Dk3R7mGRzgnd8aYBucGpbYGd/h1qPgXB8c5B2VHmPcEpcgKRyfnZhh6R8VoQxfm1efKZ0old+goPagHF/fJiHeXx85IOEf4dSfX+UeYSNc4SHkiqZD4V1dYCCe39acKN8fX53Gb9XinxZgkByd3tIhU2AiZaBcHhyc3Vob3mKd5F9e4l6epmPfptugHKEiLtwpIV0jH5wbiefiH+EdpdOi4GPlxSHVpV9f3qKlQFaiIDRfF6BjoCAKoB6XpJ6aGR7aXV4j4+Lj4iChIeFC4B7fXWHfI14eRQxdnpKMBlzaHhscG0zgzp1fX2Ido2Ch3yni3+KjXZthYB6foV8c39Ge3pmh2xsd3aGhX+PfW1haYZgeoBeaoltdXaFbiV5lnEAVIp5eidzeIelclaXmXZpXn5yop1xeo6M2oB5goGYdmx2dNs0gn9pUG9tYIGCgXx3iaMnjVZ8dnaFim1yUG6kfYWIe4G4aYOIXnCMZnh9Q4BShXGOb394enKGkIdrjWx0roF5e3eWNn9xfX95aYfkcXyJf3h/jHUxe4KEd3aaOoOAaHe1f1WTbl+PiaOhcISLgJOBf3OBcnyAfVt/Y3lkdouBf4eSgHdygYR5hV59fIGjiIWDi2euO4J1Oi2YdsWDemd0hXEsfIKIdZCJc3Vzh4B9jpl+aH1seX2EdXN3U2h+end8an5/dYlzYm56aGh4YHqAX5aAeHx7iXRPfopyRlt/mKp8Z32HnXZTkS12Z16Grm2hJXZyfdp9gH5/kn6BdXPkhYOCjVJ1fn+HfYBXhoObM50YgXx1fIFugE9snHxrXX9qv1eIgVqMOXZyVEOGV4OJhHl/e3F7e2R7gH5in36BgHp7nJF5l3mHe3mOkG97j3eJf3J5KqF/c45xmEWIfHSeJ2ZWlH2EZoaAJ3qKUYJ6Zn6Af4AzfndnjnxrZo90c4WCfYKUaX2HkIkKd31+r4l+iImRGSx9fz8tcXVpcW5qeIKGK2d/f4x4f4SDdZiCepCPjX2DfoV1h3qBiX58fXCHpW57fYyQf458dWZhiVx6gmF+gHR8fIBsNWuQfwhVdGqpH2lSgKF1U6OZYmVafXb9oYaBhHXahIZweJFof3p24oaFfHJQdmt2aHp/Smh3pjGYT5d/b39tbXdNYKqBhIB8g8E/jZZZdI6Een1AilZ6c4h8b312doeYe4CFXmWjcnJtbZYZdGxgfnVyiYJre4V/cICKdy97f4VgcpU4f4B1cq95VZZzdJqOqaJ5iI6Cgn2CdHhteT2CYZBma2F/iIeAhKBziWh1iZWLaHJ/g2uEdoCUkq8wXXhCLJJyyJpma2eGhTSveLWJi4B4gX2CX3mQmZNtfIR3fYVddHw7cIuHeqdpdnZ+f3GHbIBtXnBmd39ihHJxeW+JaFaBcH5IWYGAkXdqa4efdlWXMW5jXH+Jdp97godp34B0eXaTkXx9cuCKhICLU3d9g4WCg8WDcIUohw+Dj3l+J3h8T2qUf3lWbiq2B4WDUXtEgWhyQ4Vbh5GSgnV/Wnt7bHx0UW2PeYCDZYCWinJtcYl3eJCoanmIdot8Zm8kloZ8h2+aRIp/g5g3eFWQeoJhjqYjfpCGg3R9fIGUgDx6k2Bldn5jgoR5f3mKjoJ0boSUhQaHg4KHfYSAknA+Mnx9QTh/fGaAX3Z8fIE3em2Bf3qDgYd8iId4jY2KfH98gH+FfIiCWn17bYegb4CCh36BjG1kd1uHbH+AYXt3cHmAin8JenuAR1d4b4Ihb1yFpXpan5p0XWCBXoiiK4KQdtyJgn9xjnR6gWzbjoV/elNybXWAgotae36PMIZdrIBzfYR6dVZymoSBj4GFvWKBh115lYV4dEVyXoOPm25xemh/jnx5apFwcHeCbHFzkABub4B7fnKOlG9+hYCQhZB2LXKIjH1xl0d5doJsonpVlnx4oIaJkH+KZ36BeX5zind6doJbimN4ZnqMgoB4j3mGcY6Qqo5mk4GBVIKKgX9vrzIRj0MekXnNmXJ+cYZxOoNukYqFgXeAfIYAe4ibhHJrhX2MgHd2jWR2f35qgnB/gXqGZIJxeHJNgVuBeFeKenV9aol6TIV3bUtaf4mAdXqOh6F6WI87fmxggIdwlXGAjXzReoeEdop2dHl15ol/goxVcXN/fH2Gp4J8mw2eEZB/dnmDen9WcoR9fHqAb65dkotWjEaIbm5HhlCJjZyHe3dkbX5zf3yaepqChI93eZI1f2F/e4FJhrNyZYBxgIONZyqIjIFneZo0ZYR1eLt8V5RvaIt9vqF8iEtadnuFeH9xenyLV4xjeWd6k4SCUaCJgm6EhH6DcXeCh4CJhYideakrgXs8Mp52w357YXd/dSt2eYmEmIl6fnOFgXyNloF8bYF2dnp1c39Ip5h9d4V4e3l3l2+Gam6PWW9of4NWiHxldnePYVF4kYNSWYqeh3lyTYqmgk6ELXhqXn2jdZNRe4mB0X9yhX+YhIR6dvWDiIWJUXdykXeBhG6HlospliiGf3J3g3uBW3KbeYJ0eXKyXYqBV4QkeHt8TohJiYyFfn9xXXJ1Zntyb3OPa3+JfXyYjXiYb395j5WicL+DdIt/cnAqjYV7f3OWSIh/fpUgXlaSd4Z/goMZeYlynX5ff5CSgiWCf1qSemxaf3N1i4CPiX9tf4GCjw19g4lpineFlG4SKG17SioMkGpmY2mCSH0xeXx6jHF+hYh3jYt8iI5xfYeTgnd4fXh3ZoV+b4W8XXd2ioNxkHp5b2yKXnaEXoqCbGt2gmwkdpUFAFVfea0Zf2GIpHNQhpR5Z2GCc5qZanGMg9KFfXuCl3iBeHniMYV+ZFJxbZJ7h4h+eaeKJ49kh35/fYlrbVJ0qHmAh3SDsmSFgV51hm95gEV8ToV7iXdocXp4ipp5XYNsfpqAg3B2lSl+bHqBgWuOpHJ0iW5+iIxsLGyEgnZynTqFgX98uoRXlHJ6lJCOo3GAkH+WgoJ0gXF1fYBPiGZ1YHOcgXuGoISNcoOEfYhpeH+Jgox8i4tjrjOOeDsvnnLFcnVrbX93KX59iY2OhHqDdox8eomYeG9/kXNze3V4d1dvhnd2pWqAfHh2bmhndHVdgF94g1aGgnV9dIdsTn+QekVcg3dzfnB2hKF4V4Yzempee5hxnmt1e37XenZ7fZJ3e3l34oiDgopSeXp/eouDYISQljagHn1+aXmEaoBObKN+Z2l7Fr1xiHxXjURvcnRIhFiAgJR/e3Jzdnxod4NOZ5Jqg3p3d5qNdXJxf3V8e6h1gIl1i3d6cSSEg3WCdpZUj3eAkh9sV5h2gmqEgx1sh2qWem13g5F9LXp3YYR+aGSMb3WChoB8kHh4g4KIC292fnCSe4SJfCUyhH1BLEV7ZH9sW36FhzRwh3qMb4KAgHKch3iPj3lvhomEf4F5gH1yfnByg6lieH6KdXqMdGtuan9ff39ae3xwfWyCbjhZl34FVmp0gCJ0ZISfdVaPmHdlWoZ6mJ1lfYh73YB6eX+SeoB3c9uGgYd0T3tncHyDiHd5gqMwiliNf3l9iG92S1GUgYGDdoe4c4F1WnmKc3N1QoRUeG+EcGdyaXOIlH+Ig2lmhYB3dniWD3VpcIB+bY2+cHmIdnt/hnQudIWBcXebO358dHqpe1aecG6Qcq2cdoqmeo9/fmmBcnh9l1qMaXVhdYqKhnOZdYFpeoZ8hmZ6eYF/ioiCsnatOmR5Pi6Of8d7c2dtgWUrhYWfhpCCcX9whW54jZmAWYB7cXV8ZnR/cmyBgnqnaH99fJ1mg2p4bmKFan1/WYF2cH12jHBShIJyRV2BkIN9bHWDnHZShDRyZlp0j3CkaH+Lg+N+f357k4R9enTbh4aBkVBpdoJ7f3xbh3WLM6ASgXJsboB4gE1vo3l6c3MctE+Gfld9N39qX0aAV4CIlX92dl10fl91lIhjkW1tgnaBmI9ylmVzdHacpG15h2+QgnV0KZyAf4dyl0aMfn2RIXNXj3iDBH2RM3GOV4N7dYKPiXc7fplqfnyEX397foV8jnuNc3+HkIYJbn2Hgod/f4xfGiiMeT8wfHpoZWVxe4KCKWmGf4t5fYGHcoqCe46RhXGFdX9ufoCHf152emyHtGd/gYmPfIlyaXFii2x+f19+eHF8f4d1O16HgUNcdnCTJmxWhaF0VJGaX21WgWz9o2qBlWzXhYJ/c453cXpw3YqHb3tRbmx0foSCSWV2kSORX5aHbnRqeHJYZJ6BgYaBfLRTl3BedpWCdnNGjl2DbptxbHhagYmRgHKPZGKVd2tycpglanGKfXlonIRnbIl+foSNdC9liIJnd5Q4Xn+OcZl6VqNydo+DopJxg4mAeoWBcYNyeWeTXYxkZF95gn6Je4tuhml/hJWPX4mBhkuLin+Sha0yZ4NHJo5wxrVhZ2mHXC22h5yIjYN4hXt7g3qElIZheXxwfnRnan9gfJGJfaBsd4OAjG9/Z3FoXnRpfYJXiXppfmuPd1B/dQBIWHqIfndwWoGjd1KNLGtmWXd1d49lgoxx4YCDcHeSdmp/bNWFhX2GVHdzf358hqB9Z44LtA+WgYWALH2GXn6OiIVce2qqSomHWnswgm9uSH9gg5KOkXN5T294aXpujnCQd4xtWHuZj25yhJNxjKWQcnuKc455e3UkmI1+i3uaLJN1fYBGdVWTe4AskZEVe4qLi2twgIqDdzl3hU9xc4JjhXV3g4GYjo11e4eAiSKDhoN1g2ODp4YQLIGJRTiOfG2NZl96fIsza32DiXl9g46AgYV4jI2FaoRueWl5fn+cVHt9c4mMc3+Lj4J2jmhycVOQYIF1UX9sb3yGh3EFd4R4TFp1fJBQb2+MpHxWlJtxT12Ea42QMoSZfdCKfHVtkntxeXvziYVsgFVpb3V0doNNdWGJN5JdjXlyfod1fGJvpIZ/i4OBrFeSe1h6k391dk9vW4WjkG51d3JIjoiLZZWDgnuAh3d1lYpwqoZ6dYJ9e3U5gXGah3NqKpeJeIhpnS+Icn2FAGlZiHSFdXebOnKEhop5UHqhjIgkh5VXjnN2YHGCd4iBgIWLaH2Ee4kldYKKjpKDhopvGSJieTYmNHNwfW9yfyd4L3Z+e42EhoKNfoyPd4mLa3KEjX1pW35tkmR1eGyDymt5bIWEdoZydnZwg1d2gFeIhmdzfYRuLHmNcg5TTnWxTHNzhpx1TYybeGBffnmXqmR0j4rUf3SCfJFse3x16zWCgm1PcXNbeYKHgnyWaR96WIN2f3+NYmtJcLh5gYWAcqFYfoBicn9teYtJf0+Tb5VsdHh5eYOUe2eMc3+ZgoBydZIKd2GKhXVrdLNvTYV2dYmFcS1sg4F8cKE9e3R/fKOCWZZ4fIR/m5h7hoR/lXp3eot4fn2CT4lmfGBym3yFdp2DgXd/hHeLbIB+kHiSgX9/X6svjW85LotkwW1FY2eAcit+e4WBloOAg3eGen2LlnZ0dHRuemtxcndwRX1wcnxufHN1h2VmZHB7Zn5cc31Wknh1cXKMbkx8jWVIWIGJiXOBZoWgdk+KM35mYHCJap9HcIZ13Xt8gG2Ndnh2c+CIgn6HUn91i3t+hX+LmZ46nz1uf2h6g2N9S3SieGVqeGi2cnt9W4szcXV8RnxOiYCWdHNzYXWFZHODXGKRXH2GdH2XhnRqeXx6dY2ZbpKIc4iCd2wnjIR2dXWYUIhveJgsb1WacoNleZoJdopef3Zyc22LeDGAgGF9fndehnFvgoWGgYRefX5+iA1tfIx6lnqHloAXLG97QilUbWtwZ1mAensza3h9iGqGf4Rvl4h3i5B5b4x3h3RzgXx8cYRsb3/EZXpshYZriFlubl19W3p9WYaCanZ4gmY1X5BSAlWAeKUbf1eFn3VTmpZxYlmEbGaegnuNcOB/dH+BkmaAe3bggX2LflNzb0l+hH1mfoyYMIVckYJ5f4lockdruHh9int/sFmDc1pyi3R0e0SEVY1whm9yc1d1iop5V4NYeY99gW54lAd6aHSCe2WKiW9qhXRri4VuKmOBhIB2mzt+eXF9tIRWmnR1k4CTlmx/lniHfoZziXN2en9diGxxXHSVfn9zoGaXaHWGfH1ofn6KgZN+gKJery9rcz4uiG7EYmxpb31gMn5zln+Tg3h9dXtueI6WfWd6imR2fm90f257f3l5wGlzc3WKcIppeXlif2l9flaGcHR/cY9jVHt/PUldgXaLfnpqhpx7VYw1e19VfoVuk3SBf3jgfn96f4+KfXl65IqBhIhQclR/h4SDb4R/ljiSEYR9aHp/c3xPbp9+cWttXa5YgoBUfkV4Z3hGfVmEiZ99bHNmdoJwbmWDbZhggX9we5qKdGlnf3RtjqB1dopwg39/bySWfXx/epZIgHB+kCB/VpN3f3ochh9ijn+Nc2t/gJN5L3aRYHZ/bl6AenSAfXt0jH6EgIiKCX14g3eYf4F/bhQsdXlDNlF5ZVdrX3eHgDZndHx+e36AgnCRi3iPkHNyiHh/eHx9g4Jxf3hihapleXyAh0yMcGxxZHpqfHpbeHZ1e3mQdTR9hHQHVWZ0gB99UnyfdFeimHRoVn10mpFkgIN51IWFgXyRW3t3bNuMgIZ0UnlwdIKCg2N3eJ8wfV2TgGd3i3Z3Vm6seoSKeX6uboqJWXiLcXR3QoVfjnmccGlvXnyGi4ddjnZBjIRhdHGWCnJzdmtyZYOJaoiGZH+HhXAtXn+EeHiTTXl6aFype1eic22NXX6KbIeUfIx9e2yEcnt6nFt8aX5ga4V+hXmcb35jf4eHi1uSd4aSkI2BimStQnZ9Pi6Gg8KXaltpfH06e4iJeo18dnt5iId5hpZwS2pwaWR5aml8Zmx5fH+ian54eaJufnFvbV1+Z3p+Vnx5fHp6lWhRf4JMQFl/lXp4eWaOnHVPhzFxaFV8hW2eXX6Jieh/in14kHNmenXOh4F+jVN/bH98e4NLh2uJJaIPg3l7fXx8g1t+q3h9bHlwqFKSgVR8MHlxfUWCWIyVkX94c1Z8gGF8W4xmhmt4c3F9lolvlWx9cW2Xd253g3SDjIFpLZmIgnZzl0KObW+DHHhcnnx/Hn2QDXWQNYBwcoCBfnkkdopjin5tYn52dn96j2uNaHqDg4gXcHmEbY+HfIB6Ix57ejovb3d2kmhtcH9+K3lifoR0eH2Fb3+De4qIdmeDcYByfHKAjXBzc26Fx3B4eoR7c4htdGVch2B7dVqCdHh/fpRkOGJ4dUJYc3SQHndrh6l7UJOWVVxVgFf9oYCFiX7YhIF0co9xbXp12ImBe2xTd3VxgH2CR2dkkh6nXol4eGpqdXhba6N9f4OAd7BRi4FedYODb3JChVV8M5pybXFkc4CTcnaLVW6fimxubJkpZm5miXZ+iaRndoxzhHaNcyp9hINncp0uZIKEZJt0V5FtfZWVboh7hJWBdHSAe6R0eW+JY49lcWJ6h4KJhYp0hnN4jX+IZYaDil6NjH2LeqYwdn8zJoN+xpVybmeISi58f4t+hGt4iXuBfXqElXxwgn9neW9dc4dEdox6gnNndn54g318cnVrW29odX1fj3Vpe3SOXUWEa25IWXd7hHSCXZGdd1KMN2NpVnOCcq52f3yM13uEg3aNfWd6deSLf4OTU2Vxf3xygr2DXIsJjxuQZ4h6Kn2HYWqvhX9qnXS2R5OIVHxbg3R7T4lhh4CNknl6Y2l+ZIFvWHiZdoGFe3ifbH93e4J6dYyiXXGBcomIi3EPVI6EkXGldZCTcn9zaDqcfn2Odpd3foxehXh+h1+CelmUkFepWXNXeol6f5uLjHOAgod+jIKEiYCKoIasjGlPe3mEDiiIcIyZbGh5jHxlapV6g3yPfoF5hoeKd6V/Y4yDaml9fHp0ZG+Be4OsYYSBeYZvjW11fVyDZnx9RI14XXR2mHpSeYh6b318eJRghE2SnXRPgCNve0p8gmiLbn+hffyBhoZ5pXOUfnyGVnWHhDttbXyLlGpcgXeWhJh9l2eEbwBsflOAkISMgHJ3sFyJekd+eYV7fDqFY4t4nHeCLYN8inp3KIp5iHeBiHp3nm+EenuDgHOOql1yhHWLj49wE1GOg41wpXWOlnWCeGg5n398i3OgfHyHY4d2fn9kiX5cipVVe1d+W3yGfYCRjI5kjoWKeouDhoWBlaOFkItqTX55gxIrfW6MmXxofI97ZmmWfYN9sX+DeoqHf32phHSKg3lpg3x7ZHFvgX+DjWmEg32HcI1vdXxZgGp9fECTfV9ze5eFU3uFeW1+en2DMoNWk5x0Rn8lY35Mf4lplWWBnn/0gomGf55yl357f1N4h4M7cW53jpuAc3yJf4G5eJ9ri3Nma39UhZt/in9ze7tWhX9Jf3mOfH87hWGQfZd9fyCTgYp+cz+KeIV3god5d5tthXl9g3p9iLJedoNxi4eHcRJWjYOLbaJ3h5h4hHZoOZp8eo5xiXh5iGiNeX6Ji456V4iMV2lZclZ9h39th4qLfXyBiH58hYiBfbSehYuHbnh8fYIOLoNxkJ1va32JemFrlX2Cg5B/gXmFh35+qn5rioxcdn55fWRlb4F9hr1rgIJ7iW2Lfn9+WntpeoRGmHpgcnuWg1N6gH5pf3mJnmGFV5Khc0WHK3J/TH+GapZsgZx++YGFgnqcc8CAfHhVd4aAOl5wf4yYl2OBfo5+pnisa4N1V2p+U4N/hImAdHi5W4Z/SYB+i3p9OoJjjHmbfIMpiHyKiHxAiHqMen+FfXaXb4GRf4N8cY6UXHmDdIaHgnQUVoyHiG6me3ybdoJvbDiYh3iGep52gIdniIh7hl6SfVmHlFeIW3dXf4uFfomLiX97g3h/jYOBgHyhk4SJiWprfICADC2LdI6YbWV6iXplbJV9gn+NgIl5goN/gKqDdImGWHCAen5ma2qGfYGma4WFgot1iHF5fFBwaHyBPYN8YnOPlYRMd3t4bH97fZNph1CQn3JChSpweVF9jWqUYn2cgfmNiIVznXqSgXt8VHWChDtrfn6OmJZsg3+agJZ8p2qCdVRqflaDg4aFenZ4vVN6f0d/e4l4eDp/Zo97noGCG3x8iHx5RIl/hI+FfXt2lG99eX6Je4WTlV95f3aDhIBwEmOLgIVypnmGnHCEcW45ln9/h3+cdn6PXoV8fYRdkX1Xh5lYq1t2V36Mgn+HiYt+fIGHfoyMaoJ3k4+EiqJtWnt8ggsni3eTmm5lf4h4Y3GRfoZ9jYN/f4mEgYKnfmWCglNngHx+XmBogICBrGyFgomHgYpyeH5cfmF+fwCMe2RydpWETnVygGuAfX6QY4VIkaRyQooscXlTfItqlXR/lID6goeBc511koF6cVZ0hIA6anJ9uJaNaYCEpnqcfJtvhHFSa4BVg3+Einx6eb9gfoNEgn+Lfnk5fWGPe56AfCKBeYh8e0eMfo92f3p6eZhrfHp/h3p9gKVZdHuAg4iFcxFbmYCKcKV5ipN2enVsN519fnyCdXaAdmyCeXiGYo+EW4aNWopcd1iAj3t/iIyKf3uIhoGKhn+CfZOdgoqtaVR7gYUOK4t0j6RuanqJdmVsjX+DfIuBfnyDfoB4qoRqi4FYc357g2lgaYCAgapvhX+ChnCHcHx4XIJifX4SmHtgc3qaek53b39qfnt6j2SGRpKjdUZ/KnJ0VH58aIpreZ57+YOoh3SefY+Be3pZaIKEO3VufI+Qin6BfYt/rXmFZ39uUWp9VX6MhIZ7d3i5TIl/QoJ8jXt6Onhfrnudf3wed3mEe3s8iIF+fYZze3mdbHV8gI56fDidWXeAcnV/iXwXbXyAk3CjeJKXcYVjcDefeIGGhbF4gIt5hHx7hGmhhFmIgFODV4BZjpB+hoeZi4h2f42BjYGBgH5/onWKjGtcfYKCGCqPd5Ogbmh6jHdmZ5V7gXuMgoaAh3B/fqx/aomGXnF/f4ppYXCFioGmbYiNfIJukHCChVqEXnJ5N4V7Y3N3f25QfmV/aX9/e6Uzh1CPo3VFhSdygVJ+fGuRanqbfPGBioNymnuRiHh9aUmFgTp8bH6KkY1dgnOZgY93k2SIbU9ugk+IooiBhH94sFd5gD6AgI1wej19ZpV7lXx+G3N3lHd8O4+SjHODeX16o2l4eX+GfH2anVd2hHJ8iY5yGGd/go9xpniSknKAb284n3t/h4SOeICEXIF5Z4pnk35aiYJRi1ZyXIOOeYWGjZCEdn+Ngo6DgX5/h52DipqHfH1+gxUqjHSPjW5vdZp4ZWORfIN6iYCHf4R3f3StiHaMhVpxgXuKcl9sgZODmm2JkHyEbo9vgYBdhWSCfTmQeV10dH9wTnlzfm5+f3qdKYVIc6B2TYQkc3tSfXNnjV2CmYf1gIeLcKJ3jHl1hACthpg8f22AipKUbYR1hn2YeZZfg21VV4lVgLCrh4J4ebBSkn5Df4COb3c+hF+OfpZ7fiFweI15fSuMoodxf4p5d5lte3Z1f4B9kLZgb31yjoyKaRVpjIKHbaR4i5N1hXViO6B8gIZwkXp2hWiHd3aKg4p6XYeRVXBScVB8hXmAnZWJan1/hHqRiI6HgZucgLCObDt+foMVH4RtjYhqaHmMfGhrkXuDfYyBg3aLh4eApn1qiIaDZ31/fF5vc4B7gblWhoN6iGmPaXaDWX5kfHhBkndWc3WVd1B+hnptgHx6rGyLUo+fckmHKHKATn6HZJ5geKR+94CChX6heo+CeHaQgIOEOmJtf4aUd2qAeISBpX6ebINqMmt/V4WSgod/cXe5aYh/R315jnyAP4Ncl3qkdoQ1i3+JfXwoh2+DdoSNd3ebaYN3eH9+fY22YHKBcY6SiWURZ4uGkHGgdpWWdoZ/azughHuIdJ92dodfiH93fo2FfV2clFZdV3NQeoR+gZCajl2HgYd9loWLgIecnoaOkWo5gHuAExiIbZCQeWZ6i3xobZx+gnurgIF1i4Z9gamEdIiDe2OBaXtic26CfYOzbIaIgodskGp4fFiIa3x9QI97W3V0lH5Td4p4cH98eo1yhmCOoXFGhSdmf099lmKhU3mcfvmChIV9o2+SgHh2jYGDgjtebXuIk6B5eoKPg55+pnOFc5NtflaEj4SGhXN5tFaFf0t9e5B1fz2FXJR5nnx6K5F8hXt1O4pzinSFi4F4lmyHe3eCdoGLuV13g3GMkodrFWyKhY5upXiImXeGdWg6l3d6h3iceHuIa5F8cIqugXpdh61XtVlrVX6PgHaEmY13eoZ5f3uDhoGFhJeFiZZdPH+AgxEpfHSRm2tnfox7ZWuVfIWDjIOAc4eHfICthHCKjGBygHR9ZnBqgHqDtmqFhH+IbIt7eX9cfGd+gUSXfWB0d5R/UnmCgWx/e4myb5BYjahxQoQud4FOfYxnpGVznYH4goeDd59ytoR6eIp/g4M8V25+ipCcZYF+o4Ggfp9ue3N+a39bhJCEhYBzeLhgiIJOf3yJfXs9hGGSd6B8fx+EfIaLd0mIfYN5gYZ/epNvgJR9g3dijaxgeYVvjZCEbhFziICFbad9c595hHVvO5WFeYp6kXh+hGOIiHCGco50W4WHWmNdb09+i4Z/iIiMgneEaH6RhYSBhYCPg4ejXFGAfH8PLop2lpZrZniHfGlul3mHgomEinmMh31+rId8i4ZZX314f1pwbYh9hbNrhYd/gHGNcnF+Vmxme39Ck3tfdJiThFFzfXhtgHt9iHCIbIymcUCNMXKDU3qSaKR1epyE+pGJiXWfeZGAeXWKgIGFO1x8f4uVkWeAfYeCqn+sb4RzfWuAWoOTh4V6cna9aYJ9TX97int5O35minydgYA0en2HdnxHdHKKkIl+fHqWbXZ6fIh9foucX32Fd4iNf3EYaoyDjm2me4ica4d4bjuWgn5/fZp5gIRqg3tthnuSfVyIpFhvWW9LgZGAhYCQjIF5g3qAkI1tgH+Pj4GHqWxRgnt9ETOKe5OPaWN9iXtoc5V+gn+IgoJ2iYd8f6l+bYOGVWF9eX9XaWh8goPEa4uFh4V/iW55fFqCZX1/Qo56YnR4lX9PdHh/b4CAfaVzjFCQrnFAhjBye1R2jWijg3KfgPaCh4NwnnuLgnhxin9/hDtgb36skIxugnuggaeAkHCBcHxtg1eDjomHfHV6vW2Agkd/gIl9eTyAYrl4oHp6Mnt9g3t4UId4h3mAeX2DlWx4eX6IeHiVpVx7hICKhohwF2aVhI1qpHuVlnZ5dGg6ln2Bf4ageIB8aoJ/ZoduiopbiIJadlpyT36LfIOFoI1+fImEgIuHgoB+h5aCh4tkWYF+fRMri3aYi2xvdoV0aHOTgYR5hYJ+eYV8fIOoiXSKh1VwfXqIZmRrgX9+tmmIjIKBb4txhYBZgWJ9dy6Le2J3fId6UXdyf29/fH25bo05jad1QokwdXxYf39lnzVsnYX0hKKLc592jYd4fI6CgHo7ZG19jJCNe4Bxin6af6Vxf29+bHVWfpCOhHh1eLtRf4ZEgX+Oe3s8dGKUe5+BeSZ0fX54ekKKfXx3im+Afphkc3R9iHl4l6hfdoVueHaMdxGCi36Ja6V4j5dxdWtvNp99fX+EmHN+eHmFfcqFdJSBXYKWWohYd1OOk3yDh5GNhXmCiIeMgn9/fnOedIescTCDgoEaI4l7k6puZ3mbemZnmXyEeYiDh3+GbnyLrYJviINZa4B7jWlkb3+MhcNpiZaCgnCMbn6CVoRdcnQ7jntjdXhveFJ9dn9tfn11l3SKS4WkcEWGKHSAVn15ZqBac5p984SJg3GceZGMdXqZj3+IPGlmfISNi1WCb5Z/kn2Oa39rfXCFVYWXhn9+eXewXHp/OoKGkW94PnxnjXmieXobdHp7cn44ioWFcoV4f4agZXB2e4Z7iGilYXCIcIaAi20Tb3+CjG2iepKRcXxrcDuic3+LhYB2eXReg315hHiZfVSGjVd+VW1Tf5F4g4Khh4l5g42EkIl1fnqEmX+DnXg/gXqAHCaJd5eZam1wiHpmZ6B5g3uCgoOAf3t9fqyHfIiDY219e4psYG6DmoWfbIqSfYRrom+BfleDY4FyQoR7WnZyc3FOeWh/c356dbJ3jk5bo3RKgix0c1R4eWaeVHidfu+Din9ym3aFeml/jZmChD1obXyCk490gG+hf45/lGV7Zn9PjlSBuLOHiHZyrluHf0WAhYpheT9/YY18oHx7L218hXR/KYuMhXSDi3p6m2p/dHqCe4WWqmdygHGFlIdmDXaJg5BsoXWNknWHe2g7m4CDjm2beHyOVId0f45ukXhbiZlWqVRsVHqBen2ZlYRdkoWGd36JhYKHmJmDrZ1rPn90gxQghW+RmWppeYd5aGmWeoN/jH+Ia4iKiIiohF6HhX5vem+BV4RtfXuCpVaHhnqGaI9rdH9YhmZ8c0GQd2BxepJ6UHyMfXCAfnWgbohVkKZyRogpbXtOf45loXaDoH/0h4KGfp92iX55dYmBh4c7aWZ/iJaQZXt5mIOdgJ5of3ZPcIBahZaEg4Fxdq5lin5NeXmNgY8+g12Mead3iDWJf4l7dDWMYoxzhIx1eJlviHh9gH95laFmc4Nxh5GLaRZ7ioOQb6R0j5V2hX9rPJx/iIl1o3t3jEyDfX+Eb495XYmVV3lTfFZ8YHx8kpGJNYGFj3xyhomAi4eWh42rY0B/cIETKoVvkI55aH6LeGVom36Ef6Z6hn2JiX+Hq45tgYdudYJmelyJa39+g6ZqhYN9iGuOanWAW3hkfHhCiX5idXaPfFJ9h3VugH5+nnCLXJCob0OHLlR6TH6ZZKVRhJx/9YuChX+gdod/d3WKgoeNOmBqc4eTm4CNf6aBsnygcIF5kXB7WYaXh4Z+b3ewSYqCT3x3iYCDPoNbknmVe3szk36IfHpCjGmEcoOKf3mZbI53eoVvdpCdZnuHcYGUi24PfYuEiG2hdY+Xe494bjmYeHyKca14fpJujH13jHCaeFiYiFZHVGlXeoN7R4mLhnF5iIp93IOKfoiNlYmJpm0+f3mFECWAd5eVaW5/h31mZ5p+f4OKfoePiYt9i6qGYIKSZ3N/dHtfcGx+eoOlaYuFfY9qkHxxhFp2ZXx+SYt9YnGEkX9QfX97b4F5j51yjlqPqW9CijFyekyAlmSoaoKef/iPhYd6n3qif3h1ioKGhDtSbH+IlZpveICcgrV+pWp1eItwgFmGg4d/hHh1smGLgE5+fYyAgz6BZI13mH+AOn5+iY5/V41zg3+Ehntzl3CGlX+FfG6PjWZ5im+HjodtDXuMg4JypXlwm3SGdW86l39/hHutdoKLX4OHfYVljHxbhKNWiVF6UXmMiHeEj4mEg4uZf4OKhIGHkJGDh5ZdX399gQwrgHuSi2ZdeYd6aGyZgYeBiYR+fo+Fe4Kti3aBiGCAgnt+WXdtiX+DpmuOiHqAboltb35SX2J3fUKTfmV0fJB7Tnh5cGyCdn1/bYlEjKxxQ4wxcH5QfJBnpUyAn4X5nIiOdqCGj4B2dYqBhYM9Yn1/iZWQYXiAsoGXfZhlf3aFbn9ahqCGfn9zcr1WiH9OeXuMgH49gGS2fpR8g0F1gIR7fk6Rb4eZjHx4d5dweXV4jn+DlqFneYd0f318bRlxiIWEcaN5jZtsh29uOph6hIKBrniAhmyCfn+HZZZ9VYWSWp9Sck58kn2AgpSHhHyFi3+JjXWBgoqMhoepbF+Ad4MPJ499l65pZ36HemZ0k4F9eYmAhXuQhnqGqoBolIRma4F5gVl0aHx9hJpqj4mMhX+IbXeAWXtgdXxIhXlkc4CNe015cH5sgnx9kW6JSIyxcEKINnN8VHiWaKFiepuB9pGHhXKhdImEeG6MgoKCPGtxfKGQiWl8hJh+hn+qb3dzhm9+VoePiX18c3q5ZIaERn58ioF7Podchn6ff30ydX+HfHZQgG6EfIVwe3GZcHRteYp6eZqkZHuIf3dxh3IVb4+ElG+ieIuWdnlwcjmahn94iJd6gJaFf35vh3KfcluEmV2QT35UgpN8goKUh4B7joSEiIiHgIGIkYp/om9agHaGEiyGfJKWalx4oHdod5KHgX+HgIV9hH18hqqLdX2FZXCAeIxXZG1+gX60a4aNgINviG57eVuBW3d0Oo55a3V9iXNLeGh9bYJ9eqVyjFiFr3JAkC51d1R/hWqhW3GaffKHlI5xoYOMhndskoCFjTxvbnuKiot7fHyqepd/lWh0b4lrblGAj4x4gnV2uW57hkSFf4V+fj54Wot+kX97JG9+gnh5Tox8fnmPan91l256d3WSd3mdnWZ5hGt7Vox4Fm6Of4ptn3WJlHV6cnI5nn9/hovNenuKcYd7V4lynoFbh4hagVN6WJuJf4R9qY2HfY6PhomAjoCFgJZ2jLhyMX95hBgkin+VjGdheoR7ZmmVgIJ6iYKGgYZweoerhm9/iGZqf3uKZnJrf42IsGuIgYCGcZVsfn5YgWBUdD+JeW1zeG9sTX9vfm1/eHytbotXgqpvQo4ndXpYgIVoplFun3ruh4aBcp5+hodweIyCeYo8aG97iI2HXnp0onmtf5ZteG+Ib3NGhYqLmoOAdahnMYJBgoKPcnk+hWqPf51/eSRwe4l4eUCKf4dzi25+cppoc3d0hnt2jpBofIhvJneKchdvkIKKbqF4j5JvfG9zOqF/f4GJs3p8ilaAe2mHc5t+XIaRVo5RblmDkHmCiIyMhHeNi4mJiX9/fJOTf4SscD2BdoYYHol6jJJpZnWEe2lllIKEfYh/iH2Ad3yCroF9gYRoaH96k2psbIGuhbBsiH99hG+DaYB9WoJiZ3FKiXtsdXR/a06CdHdwf3t+jXKLW2CkcUSQKXR+WH99Z55UeqB97YSHhXGdiIB/anpPiIWgPX5udIGTh2F/dJB8ln+VZntuhlZvUYKckn6CeXWwZYGBRoCGjVV7P4RljoOdfnc2cnyIeX8ikXaKdIWJfXqZcIJ4eoR0ao65aXKIbomPhWURgYmCiXCgeIuSd4hwaTmZe3+NaL51e4xtf3V/nGmJfFuFolyDTnNif3KDb6KUg0F6i4x5mIeDfYOwln2nm2ZYf3WDEiSHaZCbamR5jXpmZ5R6foGIe4d8jYaCh6eEW4mCc2l/dnpReW2Ed4OjTomCfoJri2t3g2V7ZIBzRoV9W2x3k4BQeYd1boCFe5dpkE2OqXBFgyVveUt7pGWQYoaigPaDfoaBmXmGgnZ1i4GGhzttaYKGk5lognKSgqKBm2x/dVFygVaHqoKHfGt0tnqKf0t+fIp8gz6EYo97o3uKPaGDiYVUH4hsiXGFi355m2+Ne36HcliWomdthW+DlIloEoyKhIlznnWNlXuIcmo6l399hXameHeNZIJ6fItsnYBXho1eqVJ1Xn8siHePlYhfhYmKfpaHg36Jn5WCiaBpc39uhBEnfG+TmnlieoZ9Y2SZf4CBqIqCkIaHf4imiWOLhGZjg3R3X21yhH6Cn2uCg4aHaIxqdHxjamB/eEeEe192dpJ9UXWEc22BhnqHZ4tVjahvRIYnT3lJeKdimVGHm3z4gX6Efpp5gYNydo2EiIw5Y2p1gpWcfHSHuH+mfpd2hn2LcoBXhqODhnxtcr9yjX1OgnuJeIw9hGSJe55/djief4qKcTWIcIhxiYqGe5ttj3t6hlFokcJodoxvgI9/aRWJioKIcJ93iZh1h21sOZZ1bYt5p3Z9jHaNdn2WeJh8V4aTXXhSbmGGgopmf5eGb3SOhniNhYWAipiQgYenX15+d4MMKXt6l7FlbHyGfGNrmHx8h4t4g3GOhXyEq4Rpi5NoZoZ4eVRpbYx6g5ZqgoaFjGqMfHWHXWxkf3xIj31lc3GQh06BgXlugn+ZiWyQU5CobEODKXV5SnyVWaVeg5mD9oCFhHefgJGEdXaIg4SEOFJugYiUkXmBgJOBioGoboJ4iXKAWImihIB9bnLBaoOGTX19iH2APYNlrn2igIA4moKHkXdAi2uDe4OHf3SYboedeoV4Y5a/ZXePYoWIeGkOkImCk3ChfMObeYdubjmZe3iLfa14f4pmhIh7i2yeglSfl1ynVGpdg5OMc4OUhnNzjZF/kIx+f4WRjYODslopf3SDCyyHdpmXZmF6hX9kapeAg4KJe35yjYN8g6yGfoqCZG19eX1XbHCUfX+TbGyFiIBviHN5h1BbY3x8SYF5ZXWRjnxPeXxxaoF/epxqj1WNq2xCiDBze054lWaqTIGXgfqMh453noiNh3dzjIGFgjdpfX+Jk5BagoG1gbd/rW6CeYhxfluJmIWCe3Vuv2aKg0qDeId1ezuBaIt9nn5+QIF+g4Z3SZBviZyQeXp1l3B9d3qIeoWYuWd7kXeJfKZgFW+MfoN2n3uAnGyEc3M3k3p8goDMc4GJcId7fY1uoH1ZgplahlFwVoqSi31+k4WAfY6NgYyLb3+Bn42EgopXXH93fwoqjX+TemlZe5qCYXGYfYeChH+HeI1/fIWskXh5hGZmgHl9U2dmjoJ9qWuKi5J/f4Fte4BbeF9/fD+IeGpzdYx9R3hucGyDfnyQa5I8jK1rRZArd3ZQaJFpnGJ+lX73hoeIcJ+ChIR3bJGBg4Y6c3CBoY+KWoGFqnuSgZxsfXmIc35ThJ6GhXl1dshmjIZEj4CId3g8E12Jf5N6eD96gIGGelCSXot9inJ6c5VueHd4hHh2mq9lfIx/kl19bRJwjXiFb5h5jZd/fG9vNZx+fn6K13iFjomHfHuKb7GOWX6OVohRglaUi4h5gq2BfnWVjYSRiYJ/e6mOhYKpYkSBcoQOKol/l6JmT3SIdWd4k4iAf4h9gnWNenyFqoiDh4JobIF3i1NgcoOJi8NoiIuNhXCPbIGCY3VXfXZFjHtodX2KdU99XnZrgX97f2iQW4era0GWL3YWVH6HbqVuc5V874OUjHKdfn+Fc2qPg4WGO25qf4SMjW6AgY56jIClaHZwiHJ/R4iiiYB7cXS9bn+HQ519i3B8PWFbhoCagnhAcn+Hf3hEh3B7fo1neXOXaHhxd4l3daKiZ3+PapJsgHYZZo6PjW2cd4yXcndsczWcdX2Cib5ue4yEh3lki22Yg1yDnWGOV3ZfmZGHeoCeioBylJKFkIaKfn+Pln+HllkugHR/FCqKf5SVYk17hIFlaZB/fn2Gf4Z5gUx6gqqBg42Ha2N+e4lZW2uDiX2naYeGioZuiWyAf114WYJ2PYd9b3J0cWxRhWt2bH99foltk1aDq21DkyR5e1R8gmecanGhePKAhIVum4KBindzioF7lDxqcX6BjYxSgn6mdoaCj2h5bYZvejqIkIB2fH10tniLhj+Og4tjeT5XY4x+m4F7MHR5gnt9Q5RwjXmEa3hzmWt4dHKIe26TpWd8kG2bYYZvE1+HgIltnnyMknh2cXM3nHp8hIi/fIGJVYd6cop8n4FbjJNiilZ3ZKKKgnmEm4x/cpCRh4iHiIJ4mZOJhrlrYoJzfxgjinyUsmBddIaFaHCZe4R+hn+Ge39pd4GtgIyJgmdnfn2PWlhuiKh+o2mGg4WEaodmgX5ke2SKckaIe252dH1oTH1ydHCAf3iIbI9hcalvSZIod3dSf31olkd5mILwf4KKcpuIfIJdc1V/how+fGx9fo6LTYJ1rH2JgZxjeWuHW4NCf5iNiIF6drhybHxEiIiKkXs/gGeMg6N9fTR2dYh/fiuTgJJ9f41/eppulI59iHhpk61tdItrho6GZhR0iYOQbqF6lZJ4iW9wOZZ7f4d0sXhxjmiJd36bb413WIWiWohSbWmAe3p5pJOGgIGCiICQioB3hqKWf6OWXjKBeYEQHX9plJ1qYH+Hf2ZlkH2GgoGGhm2JgHqLpIpTiYRwdol4fldrZoR6g3xkg4Z8f22PZ3SBY3xmgG9KjX1aYW+ShFF6kHttgoCMnGeTcY2rbUWHI3J5TH+gbYt+h52C9oJ/gYKRdIaBc3WLhIaFO2xohoGZmGSCfJ6Dsn+gaX18THKDVomkg4qAcXK4cY+DS3x/iX99PYJjhHmkfoErp3yKcI4ljHaPf36Nf3uZbJaTfIl/bZWpa2+NcYiShWYPg4mCknKheJWWdox4bDmYgXd9c7d5bI91h3d/hG+pdVuGglqUTnZnfoZ5fpGVin5uhI1/kI55fYual4CMo1YxgXaDDiV2a5SRfGOEh3tjZ5p9h4GceIRykIJ8iKWPZ4uDbHSNb3pPXnKFeIW0bIKGfn9pj2xyiWJ/YoJ0R45/XXVyk4BSd49xbYN3nZRjjnmPqG5DhB5YeUZ/nGiPYoqWf/aBf4KCmHmEhHJxh4OFiztob36CmZh/cY2igqZ/nnSEe4ZygVaJm4GIenR0vWSNhU1+f4x2fDyAZKZ2noJnH5d6hW91RI5zkIKBioF4lmuVoHmMdXaRumx4knCDjodsEn+GhIxxnnaamX6RfGg5l36NhXi0d2+McZZ1fpJsm3RXgYhYeE9jZH+Cd3J8kYqFeYWNf4+MeX+Ip5F/iJ5cTICAhQUfc3SVk2pjgXt7Y2qWgImGhXuHdo18eYmjj1qJmGpzhnh9TkhpfnSDp2qAhnuBcY19e4Jdd2WCdUyWd2Fub5CDUnyHeWmAcaiMZ491jKhqQ4kmeHlKfo1ui3SEj4r5fIN9eZl5jYVzcIiBhoc4VXCEg5iVdYF/pICcgKhqe3+Hc4BViZaHh3x5bcVljYNOf3+Je408fmeBeal/gxx+f4qFeFCPdpKaeoOEeZNukjODhnV5kYdsdpJui4+CZQ9xjYNzcKB3hZ17gXJuN5WKdHx8rnZ9iGuLi4OJZ5p1V3+NW5VRc2J+kIl8g5F/h3KEi3+Mj3B+hpaNg4StWEWDiYMNJnZ3lqllWHqTe2Nxmn+Sh4R/dXeXfHqIp4l3iYRsdIV3flNsbYR5g6Jreod7f3GFbmmBTm9jf3lGh4NncIWPf092hHVsgnOYfGCVe4yrakWQKHR3SnuETZxgg5KE+YaDgXeciYiHcnGNgoWGOXV9hYSXkHeBhZ9/mn+ean57inR/VouegYd3fWXHV46SSH9/hXt6On1lg3qliYQ5eHyFdXJQlHaInIR7e3eVboKdg4x6gpbAa3eTdYWCcWwOd4uIgXGeeJWbZolycjaYdnh4hKV6fo57g3SBjGeme1STmVOGUGpdhIl6eYivh4hwgJCEj49afIOKjoCDrGhdgYOBDCOLe5ihZVh/g3FidJV/jYCFfoV2inh6iqeNanqAcHmGeoVOXm19eIOmbIqGiYR/j296g2OAYIF4SIt6aG91jYRRcXx1a4N8inxkkl2Hq2tDjSd1dk5giWiJgoGSeviBh35wnoKIhHJwi4KChTtpcn6ckYx9gn6oeoCBomyAfIpzglWHl4OIkYVvv2OJkUF+f4d+dzmAYYN6onh9NXl8hHVyUY92j5hycH1xlGyBlYGIeXubzGl/kn+Dc4FvAHWMf4twm3iNl3uAbHEzmoF7Loiuc4CNm4Z5doxwpn5agZZRl09uYX+MdHyClomCc4iKf4+Ka36ApJN7gMNhYIJ+gQ4ahXuTnGlOe4xmZnuLkoiGiH2FeoxzeYipkHyJhXJwg3yIWldrfXZ4omyHgHmGcX9odn5kfVh6dEaSf29wdYt+TXRxfm2BfYycZJBniq1tQZAidWxTfntqlE18jHb1gJCNb52Qg4N0bI2ChIA8dG6Cg4yMjoBzmnaRgZJofG6HcX9PjJSGhHeAbchKkJM6goCFeHU6YWGJcqKEgCJ0d4Z0dFeNeYeCiGB8f5ZpgIqFjHpzmrpqeZBulGSHcw15i4CIbp14j5V4fHFyNJ53emuIsHWAi5yKeG+JcKJ8WXyfXJFPcWeQjYN+iZWEiHOBjIONg3d+gZOUaoe4T1KBdoMXLIp/kY9eTX6HdGhpiYCEgYt+inmAX3iIqo2HioVvbId9lldPaoFohadriIh+iGiIaXaFYX9cdHZEhn1tcnB3fFOCanRtgHiJhmWPaoOqaUWUI3d8Unt3ZYZYd5hy9YKKgmuaiIaDb3OIhnWJO3ZpfoCJhmeDd6h4lIGoZYBvhXB9PY6Ug3R/inG5ZJmBPIKJiG92O25ni3meh4UpdHiNcnBAjnOffn5ff32ZaX2Mg4mBaKCkan+RbpZ6hXEVeouEiG+ee5OObHd0czace35/ibqCfoZuh31yinebdVt9l2CQTm5shpJ9f5CVjIRyi5KJi4t6f3+YlnaEoFc+gnt+FyKOf5OSY095iX9ocI5/h3+JgIR5gFl6iaeJl4eHbWiGe6BiWmqCkYOqb4Z7gYdrh2h+emGDY35yR4x+cHNvhHBNfHl6b397iY1qm3Vvq2xGkiN1eU9/gGyOaICYevKDh4hrmJGDglJ6U4F/hz1vZ3t+jIpxgneYe5F/k2B8aoZcgEuGnH2Jg4BwwVuKfkKCiIl9cz1sZYd3nYWEMXZ0h3V7M5d9j3h9iX95m3Cfen+EdmabkW52jm+EjIhkE3CFhZFsonyLkn+Jc3Y5nH+CfnLBgnOOd5uFgJNyiXtag6Zbkk9yaoKMf32fj4F8gIKMgoyNfnR/opZ/mJxqQYF0gA8icGmVmGljf4N7ZmuKhIqHe4eDc5GAaI2liFiIgnVznXl7UVd1hHqEfGWCiICDZ4hpe3xhiGWBaUmUhVloa5KEVHeVe22BfonOaJtWjqhvRIUbcHtLgapphlqOmIP5gYF8hJB/hoN0c4eEhII4cWWQgJ2VaHyHmIOwf6B3eIRNcYNWkZuFiYNydL1olIVJgoKIfnk6gGKidqB3hgGkeoZ1bTWMeYZ4fIqAfZ1vo3qCiHRynahqX4xugo2IZBN0i4WIb6J8kpeAjHNyOaCAgoJtrX9qkYWuhn6BfJN9VIKKWpJPcW2CeIGCjpmHbHmBkoCSjnZ+hpiXhoqUZ1aCb4AUJWdqkp52a39+emVokISJf5V6gXqSgn2JpJFii4BrZJ11dlRehn54hbBtgomEhWiPaHd8YH9ogWtFk4dgbG2Rj1V4lnNvgHaEr2KWSI2la0WKHlZ7SYCuao88j5WB+X+CfoSWh36CcXWIhoSEOHVnf4Saln92i6CCqHuUeoGEhnKCVZKWhYuAbXbBYJSBTYB/i3t8OIBlgHaffXIUfniLenxTkn+KfoCKhnqbbKJ5g4lydpiua2yTaoiIi2UQdYyEkW2he5CYf4NrbzecfXZ6daJ6bouNrI1/jXOUeVN8iVaPT2lngYyCd4mZhHN3go+DjpB2fYeZkYKHm3RSgHqBDyRze5mkXm10i3plbY6Fi4WHgIV8hoJ4i6KSYY6QcWmedXlXRGl5eYavbIOKgn1tjXt7hFt/Z31pSI+FaXBwkYtUepZ4bX+Lm7VnllCOpmtDkB90ekiApW2RWIuPhPt4g3+BmneFg3FziYWDhjdsbXqCmZZ2gICigqJ9j3t8f4VyglSXloWHg3Jyx1+IgkmAgYp+cziEZop0qXmDCpJ8i3d/WI97god7gIN7mHKdnIOHdnKenmx2lG6Gh4dlEoKJhHtvoX2HmYaFbnM2mId3f4eUgHWMkJyVfYlvmHtRgYJdhE5tYIGGdoKHj4SCdYKVhZCRa36Dm4yCg6hhUIOBgQ0qfneZml5ghn96ZnGLhouFh4FnfH+BeIinjWqIfWpnnHp5T2ptg3yDsGyAi4VwcI9sdnlPdWd9cUaShWxwfpCJU3STeW5/doGsa5Fbj6VqQ5gldntLhKVthTuIjYH8g4WBfZ1/iYZxdoqDgYA3d3uDh5mWX39+oYCiepl9gIGJc39UkZ5/hXp1aspWj4xFf4CHfYE1g2OHdaB0fx+Ae4Z0g1aTc4Slf3F/fZJwmm2BjXp9nJhrd5F2hoB3ZhB5iYWQcJ99i5hni3B4Npt1gXqHrH9yjpaUj3iHbph9VX6LUZ1PdGCEinuCiIh3hHZ8k4yKjnR7gp6OfYCkc16CfIIRJYJ/mpNcYXSDemd3g4mKiYCChH2HgHiLqZRpeohzZpl3e1ZqaHx9hMBqh4SCgnyCaHl8XH9kgGxBi391bnONgFF6kn5tf3qBuWeSMoqpakKRI3Z0TXWcU29dhYuB/H+GgXObe4eCdHOLhICEOW5ug4+SkDaCh6N8pH+YeoN/hXOBUJ6UiYhzeXTIUYORP3+DiX9wNn9ciHmeh3wRg3yMeIFYl32LiIBkfXWYbZRxk3p5dqWea3mQe4h/hWcQg4yEjWyef5SVgnZycjSaf36Aj5V8e42yjYd3iXanf1WNiFCKUXBhgI98e4yOen9ziY+SjohogIKmkm+Go4ZBg32DEyKIfpWjX1R5iIVnfoiTi4WGgIV+jHl6iqiPdoaBbWaee4BXYGx9fYGtbYSChH5sh2p9fGKEXH1tSZOAcXF2i3dMdYeCb398grtplS2HpmtClR53c1KFk26LUYGNe/mAkIJwm4V7hHRzi4d9fDl7anyEj412gX+NfZmAiW6DeoZve0uhlIWEf2pwzDSIljp/gYp9fTaKYIp2qXF8EH50h3iEV4+DYn98XX57mWyVd4SGeHCbqGp7kWuCgohoC4GKd41qoXmOmHB7c3c0mn6BhJOpfYCJuomFbYZzo4FbeoxXklFpbYmRgIOPg3yBeYGQmYyJaH2BmpiWhal9LoN+hx4nhoSXoWBMfYZ4Z3SFkoiDiYGEfJJ7eYirlIaDh3Nqo3tkWWBqfnmFqmqHh4SDa4doe3Vih2B4a0STgW9wcoFxUXqLfG5+en7EdJc0gqRnRZEbeX1Sfolwhlp9knn3goWDcpiGiIR0dYWEcYY4c2R7h4+KdYKAnHmNf5JziXCFb3s+oJyAe32Dcs5KkIU7eYeNe281hWaOmp6Bfhh+ao1zfG6Qdol3flh/e5tskHmGiH5lnpxsfo5ogYSMahB6goWJbJ99i5Bvanh1N559gH6VqYF5h5OLiXOJeJ96Wn6TWIlObm2CkX+Bk5aGg3l+kpCMjHl/e5yTSIeafjiCg38ZKIiFlaZdTnaHe2Z/hI2GgIyBhHyHdXiIp4yRh4dvZp99gV5kZoZ2hapqh4SFhGuHYX11YoFke2xBmIN0cHCIaE15lX1vf36AuWeZUHCnbEaXHHh7UIGKZI1QgpZ69oGAgm6YjYCBaX1Ugn2AOXhnfoWLjHiEfo16mX+Ma4Jxhlx8SJyUfYWIg3PHR46IQX6Ri3x4OoJlkH6hgIETfXmKcoBDkYaBeHuPgXqccad1fYd7aZmZcGqMcJCRiWcTdImEkm2lfZWVdIVraDqidoSAgs2BcJBuo3d+h3GNelWHmViEU29ogY6Af6qNhHd6f4+GkImGcIKqm4SNmF4Hg3eEGCCKcZaibGOBh4RobIGCg4KBgIFziYFuiqOOUoqDfHKyfH9UWYqDfoJ/Y4CLfYduj2p8dGGEaH9mTZqKYWJvkoJUfZd5aoGDichim1aMqXI9kxptfE5+pmqSaI6WiPyCh32FlIOIgnN2hoeAhjdxaYmGppd8fJGjg7Z+oX15i01ygleYp4GHgXt3w2uNi0uEg4x+fDeAYYp0k4N/BpSAiXBvWI5+fHt5jIB8nmutcoCGeXaZt2tfjm+LjY5gFICEhZBuo32Sm3Z9e3A6n3OGfoexgmeReYt+goJ/inxXiIZYhVJ0aoOGf4iVlYt1eYCQhZOOjHyFlZ2KiJxcZYR3hBkif2uYpVlpgYuDZW6Dgn+AknyBd4Z/gYyklFiJhXtrsnh9YXJahIGFs2+FjYB/bY5te31ch2iCbEiYlGp0aJKLVYGcdG2Bg4TMZJw9kKduQZkdXHxKf6FqkV6NmoT6goeAgZiFhIRzeIeHgo05cWqghaWVinubsoSyfJt/eYqAc4JWmZuCiIN7e8NzlI1Mh4SNfnw2gGGJdY2BcgV8e4pzfmuOfm98eYeEe51xqXF9inx9mL5papNwhY2KYBd9iIaLbKJ+kJt3f3FwOJ9yeH+IuH56j4yTeX+LfY98U4GRV3JTZmeAioJ2iZWEdneAkISQjop/g4eRh4edXVaBg4cYInxxl7ZhZoJ+hmNtiIGGgIV8gneNgXuJopRLi5V6ZK95gFxZVX59hsdnhIaAem2TXnp6WYZof2pNh5hwa2iSjlSEl3lqgICIsWWYSY6mbz+cIHJ8S3+XbJCJiYyG/HyGe4SbfISDd3aGhYCGN29ueIiflot+k7GFtH2WfXeHgnOBVpubhoiEgXXBdIyPTIOBjHd7NH9jiW+WhX8HiH+Jdn10jn1lf3V9hnqZbaeTf4d7cqCxaXWScYiPiGITgIaHgGylfpCbdn1pbziag4F8kLSDe4xxhop+hHmKfVZ8jVuEUmxog4x5gIiMfn19gZKGko+AfoaCk4iFlVtqgouFFB59d5qrW1uAhYVjcoWBgImCf2t0h3t6hqeQWoaMc2yseYBeeWWGfYPGaYCHfW1xh2Zyd05xZ39ySZCJdG54j4lTfpx2bH99fqhnmUKOqXFCkiNwf02Em26RSYeJiP6FiXx4nZCEhXR2iYR+iTZxXXeInJZ/gYy1g7Z5l35+g4ZzflSel4SGgIB3yGuPjkeGf4t7cjR/YZBsmIV5B3+AhXN6cpF6VoF3cXp9k3SmbnmKf36ft2l7kXKEiHxjFIWIg45uon6VmXWAYno2m2yAeom0fX6SgIZ4dod1lH5TfoJSiFZnX4CIf4GLgn5/dX6QiJSNfXuCjpSDhZtsaIGHghcig3+ZtFpWfoWKZmx/f4aLf31/eIp5eoqnhVKCiXhjqnmCXn5kfXuCs2aJiHyGWoFlenhah2OEb0qPi3lsco+CUnyaemyAfYCvaZoyi6twQZYlc3pMdohweHKEhYH9gIaBdZt+hoJ0cYqEfIY4bW16jpuUWoGOuYCifZJ3hIeDcYNTm5yEi3qCdMFklIREgYGNfX40f1uKZp6HcwqEgod2gnWMeleFemeBeJdypnF/dHx2qapqgpRmjIqFZQ6GhoGOcJ9+k5dybWt2NJ51gnOUn4iAj3qEe3iHeoiAVn59UnlUbmN/jnuCj4prgXx/kX+RioF+gKuXf4aWXiqCjIEdJIOBmqpYSX6JhGZugpOFi4R/fnqLdnyMqIZeh4tuX7B6gGJoZ4R/faxrhoWBhG6KZH91W4lggW5HkY93bnGLdU59m31tgHyAuWSdMYuobkGTHHZzUX6JZHx0f4yC+IKPf3Sck4aDdXyHh4GEOXlodIuSkZCEirF9qX6HaH6Fgm5+S5qXhIWCdne/WZONPoV8jXx0Nn9fkWaXiHkFf3+EeoNgj4NneH9of4KWa55xin96cKikanePb4eKjGUPiJB+kG+iepSbclp6dTafdIN5oqOCfo+XiHt0iHOWhVaHglaAUmZthp2BgI6DeX16fpCFjnuAfnu4nISLp3Vvg4yBHiKQf4+jWUiBhohmVIB+g4aHgIF4lmh7i6eOcYiQb2u1fodcdmaGeICzaIiPgHlri2N7d2KJYHltRpWMdW10hG1ShJt9a4B+fLZ1mziJpmtDlxx5e1KBg3ODcYCQfvl/ioJxlIqFhnV1fYpSiTiCaXaHk41shY6mfZiCkGiIeYNvf0WmjIR/iYp4wV2XhT6AhIt5czmDZolbn4l7AHt+ind+bI90XnqBR4J+nXOZeKF/gGufnW98kHGAjIltFoKGgpBtoX6QlW5ld3s2oHeBf5+4in6JiIZ9coZ3n3tYhINWilJkbH+TfICRjHmEeHqPl4+Nj4J0qZVvh5V9aIKLixoghH+Tsl1Je4eEan2Ng4aFh4KAeY90e4umiIOHjHBjtX5+XnNqhXuDsmiEgoCAbotnfXNihGN/cEaainxvc4dvUX+afGyAfIG9YJ4xdKRwQpMcd3dPg4xqkW6Dj3v3hIaGc56SioRreFSIfYY5e2t4ipONg4KJq32if41JgnmCYIJPrph+hoeKdMFRj4lBgImOeG85gGWRrJSLfBJ3eYZ4f12NiG1ygH+HfZtxm3V/jXVkmJFsg5B7iY2JcBB9h4SMbqZ/lpuBiXx6O510f36Ss4NxkWGRd3uGdIF4U4ebWpFRbHN8jX2Jm5+HfXuGkICMg5NzjKCkgJCVa1WBa38UJ4yIl6h/UH6Mgmhwhn2NhGV/enaMhHSLooxhhn17ZJh5eVdbYIeCg7BghIt/hHuLfYN3YYNkfFlIin9hcXGSflJ4mm9sgICFoHt+UI6pdUGCIGx7TnuXc4VGjI6G94B+g4aYfYOHbnqBhoKEOn57gXihkWR7jqCEsnqcgHaMTm+CVYikhoaBdnfBYZKLTn6BhHxyOYRfj3qOfYoSjI2Jb3RakXZ6c4CChX+ccp14hYl3b52qaX6PeoaMiG4Te4CEjXCmfZadfnp0eTujdYF8jqp/d45ujHt/g3+Oe1aEiVeIWGh1f4iCiJmeind6hZCCkIqPeYiHoo6IpGtihGiBGSWCiZeqQU59hoNmdIaBh3uVe314i4N6h6OKZ4SNcmSdc3pcenSBf4bJYYiOgoR7j39/fl2EZXw+R5KKZnRxlHxVeZsvcH18gpR1gjiKpGtCihtge056jGqGSoiQg/mEgoWBmX16hHJ8gYmAiTl1fJV8n4xzf5a4grh/nH56iX9wgFKKk4WKh3d5uGiRgU59f4F/dDiDY4l5jH99DX94jX18ZI53enSDe4J6mm+ZdX+PeWimmWerj3yIhItuFHaChYlsoX6Sm4B8fY46nnN4gZGnf3SNcZN3g4lyiXhTgJlVjlZib3+Ngn2Sp4d7gIiNhY+DkXuGi5yHgqhdcYFwgBkmfZ+crn9PfYKEZXCLgoiHgHuAfIqDfoikjlKFeXRXnXl5X05jg4CExGiEhoF/fYxFfnxaf2h7X0iNf3Jwb5KCVH2db29/doqAc4A/jqZpQpMjcn9NeY1qd1eHg4b4gX+Ff5p1hIVxeoWHgIg6bIGCf5yPY3+Rp4Ovf5l9cYWFb39Ti6B/h4J6c7toj4lNf4d/fW83hGSMdZCEiQ2QgY1vemKSc3V5fHeKfphxl497h3NqnpRnoY9+g4aGbhF1hoOBbqWAjZqBfXCBOZyCgX2NoH93jWaQgH6Je4t8WYGXWoxTZW6AkHiIi5aCg3uGj3+Si4d7iJqZjIepYWiBfX4UI4adnaV5EoKDhWZvf3+Hg4CEbXaQhHmIpI5pgYVtZ5x0eFdtbYZ/g8Nmg4OFf4CMfnB/WHRlfnFJjIVzcHqUf1J2nlRwfn14eF5/PI2lakOOJnB+UH+DansxhIOC+4aEf32eiYKGcHqDh4GEOHNFfIOWj3B8kbWCsn6efXmFhHB/VomigIV/dn7BYIyDSH+Bg3hpNoJjjnOLg30CgIGOd31hj3B2f3xze3+WcJZ0e4t8caWXaKCPgZKDf28QgIaGi3GjfpCXfIBrfzmac398i6qIgI9siHd/i3SReVJ9jVGIVGNqgJGDhpOPeIV4i46HjY+CfIiJmYyGrHVXgnaDFyeSoZ2eeUaBjIdmb39/jYeDgn54joN6i6aIY4WIbmCcdnlZcm2Df4LHZ4aIgYo+g3mBgmGDYn9wSZF+d3N2kX1SdqJNcHx/f4JogDiKpWtEkCNzek53gmp2WIB4g/mDf4B4nnJ8gXR8h4d+ijl4gIGVkY9cgY+jgqKAkX18iINwgFSJnoOGgH9wv1WRgUV9gIF+cjeDYZVykIJ5DnuCh3l9a412Z3uIan95mXORb294eW6jmGWtjUmAf392EIGLgItyo36YmXx7dng3nnWBdZeQg3+QaYl3e4p2k3xVfYhSgVdjan+Qe4GRmH+Hd4aKh5KOgHyDnJ6FhKZdKoKKfhkghKCZqXk3fod5ZnY4fI6HhYF+fI1/eYujiGZ8gWpbnnh7Xmdtf4CAv2eFg4SIgol4eXxeiWB8bkqMgHhzdop4UHeaM3J+eXmMXH8yhqZqQosgd3NPhn9rgU2CjYP2g4+FdqCEfYFveoaHf4I7gXmBgI2HV4N7poGqf4yJeIKBbIBPiqSDg35xdLtXl4VBgICDeoA2gWGNb5V9gAWFfIp1elSHd1hwe2WCfJtzj3pueHdnoKRpoYyAhoiNRA+Aj3+PaqV8mJ51aHt4N590hH6joox+kIaNe3SLe5Z9U3+IVXhWYG+HkoCHkId5gHuGkoaLioR9eYShhIWcdKSBeHsdJYajmaB3N3+Dg2Z0iYODf4eAf3mOdHiIp4tchI1zb555g1Z5b4iChLZkjI6CfnqNd3yCYoRgf2pLkYd1dHOAalF/nWps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bGuXZYyDe3t0oHtOnJkwSFZzOICLjIGTkY5oh3uOkn94h3qZs6CMkJpnlFhyf6pAiHGwuXdnfpJ2PoebhYmLnHaHdY2Lh4RmhXR7g5BkaWaHonFtjX6ErE+FgYaFappqamMwa0+DeXOKf3hwdpqSKniufa5/eIKQcIZflsFlCY0mZ2Yphpd/sFB/i4xmiI1/j7xngYVrkoCMgoYIgmR4j4KidniVj0SwlaBzd4NkaX0Xl7h/jIF7esNUkooYhGeEcHMIhjqHbKOKejqOboyBeEKWgZOKgX5tdT9odIGQi3NzpLVchYZwjJR9cjOHkYOOZQZQjK1xiYJiCGl8f4OBrlpqll2SgXuJn6J9VH+wMIJOdDF/jId9iZKGfn5+hoyAdYl7nZaeh4ixYZRkcYCnQoFzqK9nZH6Lej59kYKLhoiAf3GLi4SJa4RvgIdvdmJ4h5xgZ4h+gZ1YgoKNi2CVdWdjOXhMhIRsmIR6cH+Xlix3l4Kue3yItnKBYJa5awmMMGhaJ4Z+frxYe4OOYI2If4i6aX6MbpSJiIOIAXdleomDqFh0hZtGp5GYeW+ChWV9HJinhIl3eHjMS5GIGYhwg29tBYFBg22bgXdEhG+Oi3hCj4yCi4J7h3Y8YnmFjIhwWqW2YYKFc4mMh246lY9/jFwJVoOtbIOKZQpogHiOgaZtbpRpjoZxh3Cgd1V+gCdRVW07gpSHfY2RinV2fm+QjHiEepiTmomIuF9RaWx8rUaMeLWmY296i3dFgIyBi4yHd5x1jHuEibmIdnmDbFlheYeYW2eQgYDBUH+HiJJvlmpqaDx6S4F/a5V+fXGClpAjd5WHsHh5hYxzhHGTw2wAjihmYSyEiHO/fn+IkFuRh4OIumuEh2yVjoeBiQWGcniQiJ9kgImJTrWWn3hzgINneyCWr4aFent9vXKSiB+JbIpscQeFQ4Zyq4R0RIJuiX97SnWIloyBdHpvOWV3gZCLc2SnpFqHj3SDjH1sNXyQf5BUCFGLrmmMfWMLVH95f4StWnKTbZF/cYR0pX9TgaUtZ1RqNIuNhHuMioOJeICFjZBnfXyWoJWLiKlziGVsfapIgXi0nWZnf4Z6QIGNgIeFiHp9dIqDh4Wzg2l8hGZnZnmHnUplhIKCtFOCfoyGdpRuZGo4e0iDeWuPfHxvfZSUK3eIfq58eoaaeYRlkr9uA4oqa2MlhIB3t291jo5fiYp6h7txfYlvlIeFgYEFdGh6lYmeYnuPqUaul456a3iFZH0XkKaGiHt1dMpqgIwhg3aIaG4HflWibp6DeEiDcYiIe0qOi4qMcXZ4ezxgeXmKl3NzrqlcgYp8hX6EbjB+l4OHWwZOiK1tiIZhC057eoSHrW9wmmmLf2uGaJWCVn+PJ3JTay2DmIeAiaWFgnSAh4+OdoN+mKefioyUZY5nc3usRJB3tpJhdnuJej1+i4WKjYd+gHWNc4iIqoh0doJsZmd3ipVTZI9/fbBXhYWHgWuQbW5tPHFXgXlqin9+cHSPjix0i3amfHqGrXSCO5LKcA+JI2Z7L4aCcLc7eZOWYIWVf4G2cYGMaY2Mh4B/B2hoeIuNnmh/gpZWpJOcd3J6hGV7FJa7hnd4dXXOX5CKHIpujWJwCX5RiXCegnFLfW+Be3tHkYOEg4BxdGo7aYSJiYx0gKStXYePdXltgHIsio56hl0IW5yZaYh3ZQg4eH2BjqpXcoloj4HthnSqgU99mh12Q3U3ko6CiIyMh4x1f4+IknR/fpWLpH+DtWiVY3uAtEGAfJqpXXJ9lXg+gYp/io2JfoF5jXWCkKOBbHx/aWRkfYqlWWiDj4O3XIOJkINqkGJuaD59SnZ0ZJd/fHF2f4s4eIR4p3p6g6p6eUSMxGgOiSZoVCuEeXGxM4OLnWiIiH9+rXh/k2acY5aTbQF0Y3qJipppf2ugP4iSmXFudYVjgx6ZuJB+eXZ2tmKIjxGEd49cbAd7Rn9tnnp5NHxviIB9M42ZgY+BdnFyQVV+e4yNc36dhlh9nGxadoRxKYeXf4toElCYhG+Cf2UJZHeAl5GCbW+CY4+BZX5vlX1OgJEoglF+U4agg4x8tnqQc3+XiJVvinuMkKeNh6FzVFt1kbI/knqkmGRyfY12Q4OegI6QhYCKfYtyg4+JiHR4g3hzZXuSomBli4l8p1qGhYuDZKVtc206gEZqU2qahX5tdnyFQ3d/f61+eIWcf3tEhcdgD4ojaV4lg4Vnr1GCjJhziId1er1ueHNkiGOZhpUHeGF1i4WhYYNurz+th5BvaWiFVIwPjcKRd317dbBaj4wVi3OJYHYHfkeJf5+NcEh4aI99f0qSiJeKe3t8dUNhf3+LhnpwqKVfgohzkJiAZiKUl4SMUQNTiaVxiIpkCFp6eIx4tWpkmE2JjICNa6N0UH6TJX9RdGGAf4ODmpaISYl7kol2f4uAlJqgi5urd1hOaXypQoJ3rqBnZXuTej+DlYaRl453hXaIi4uLtY5hg4aNaWZuga1xaYeAg59Kf4OLflyWa2FmNHlNgXBzkX5ycnuZgh94q4CtfHaQiHOGVZW7YwyOHl5rIYOjdrBHkJGHZoqHf5CyaIOFbJeBjY6NDHtffJKHpF18j5oyroyWdnyOU2N6GZ/VgIp6dna2SY2IGoZngm+OBoZFgHKchnc6jHWQhHNWlH+Og31/gXg7Z4CSjId2aqizYIKJcIyMgHEzrpeDjlgEWJCpb46TawVuf4KAeKdUbJtEjH98f3ifelR8mSlJTnZTfAeIapKKjGprepGMeniDepSPnYqQtGiJRWV/rEGIcKWbcmiEjHo6fpB+jY2ZeYJrjoeIi7yDZoCGfXxndYeofGyIfYKwT39/iY5mmWlmaDF0Sn93c5R/dHB+mIsyeaB/rnx4hLFvhGSWumMNjyVdaCSCkYSwU4yMiWOMjHyOumx8hnSVhYqHhwZ8YHSOi6h0g5GxQKiTnnZ2i4Fmfh+Zw4WMd3Z5uCSZkBiEcoBrdAeFTX9vnIR8SY98j4x/SZR/fpN9d3Z4QmV+fomHdG2koGCDi3SNlIJuMZyVhJBbCFqDsXSQj2oHZXx5hnjKaWmVZpGCeYJbpXZTlIshSlFkTIGKhW+LiohrenqMjOhsjHiYnJSOkL9uh1Zxf65Di3OqlGxufYx2NoWPg4uRiXWGfY2HhJDDiGl8iXNwXHqGn2xsi4KCrFmLgIeMZpN4Y2s3aEqBf3KLhHxwhJeNLHabgat6fo+pcoZVlMJvD5AjYWIqhZd+rliHmopfkIyCjL1zhoRsjYaKgokHeGp5lIShe3KNjyLGkZhxdodpaH4gmcWFhn97dbtbk4sZh2aCbXUGgVKGbZ6KcEGIb4uGdGyRf5GRg3l+bztoeoqOinJvoahggJJziZB9bzOokn2OYghOi61vjn9lCFp4gXiBrFNplm6RhXiGZ5t9Vn+jJU1SfE6Ei4p2ipaJfoB6oYyKd4N5l6eVioqkbYBjc32qSYB6rKFqZnmKe0J+joWMh4p/m3mQgoeLwYZzfoVogGF6iaBcaI+CgqlaiYGOlWmWbWNtMntEgX5ql4B/bmuUjS51mHutenmCiXeIXZTFaQyJJ2RjKoSGf6lDgJCKWaeOf4i6b4CDapCCiYSEBoBzeoqLmV52k6EXnJWFdXKCgWR9GZfKhoOBd3fBTpSLHINxi29xBoJNmnKlgX9Bg3OKh31WmYiIkYF3fnA7YX54i5N5eKS2X3+PeYN5gG8xk46GhGIIUYiubImIZAhIenyGgqlnbZF3jIF7hWiVfFSAgyeGTnNLg5OHgoeZhYJ2e42PjHR9fJOSlI2OnleQZHCAqkmRebPGaHJ9jHhCfY6CiI2JeYN5kXWHjcONcoOAbHBqfImXYWeNgX+ZT4eHkYV0kHJZZzNvR4B4a4J/gnN7k5Ege5d/qnt5j5BzhUyQy20QhCNmZyl/j3mwQniZjFaPi36Hu2qJiG6LhoiGiwSJa3yPiZtme4uTQpqXoHZqe4NhfRyUzYp9dnR2v2OZjR6MbYllcwiKVYF1rYp4QYJygIN5UIOAk4iBc29mOWp3io2gd3ejqF+HkXyJcH5wMIOXgotgB1SUsWqQf2gKLoB6fYuTUXCea5KCaoRsnGlXeI4vfUl5SI6TgoWJj4CHeHyRjZB8fXuVgpeIiK5yf2VxhKtHgXyqmWRpgZN8P4SNiYuJiXqCfY57hoPBimd+hWxoYnyPnUxkhYB/p01/g42JbJJoZG05fUx6gGmRgYNwfYqQLnaSeap7fYKgcoZmjsVxCokpaW0rgXp3s0x4nY5ZiY+AgbR9g45vlG2KhX4GiGt3iYOcYH2Pq0GilYxzanyFYmwakrKJd4V9dsFvhYsbjHeBam4GflF+b558eTOAb4uIf0qPi4Kag3NzcD1ffHuIl3GDlZxdfJZ2fkGIeySElH6IUQVPialxkopmB1R7e4aUyGpslG+ThGeCc5p+U36IKoJTgFCajoKIh716jXWHkIaUfpF9lYCbhYqxb4tZfH+vRZZ6tm1zc32Gb0J9ioGRjYp9hHqXb4SFoYZvdYdwbmh9jadbY4eNgaJPfnqPg2qOamlpM39LRHRmnIKHcHmDiD92jHipenqGsXWLS4nFaQ6KHGpYKoiUdKNEe5mWYomPfHu1c4aTa5WGjZePCHVjeo6FmVeCg5VZyJSZd3R1iF55Ipeql4N4f3K2ZoOJFY1milBlBoRMgnGmiHI1gWiFf39YkoqVjYBoamkzZnx9hZZ2d5+ZXH6ZcUtWhnIpg5d6i2EAY5WUcZRyZQQzgHt4mZdcbpZpj4BmgW6mg1KAfyiGUnhbnpaBiImRg4t1ipOLkWyGe5GhoIOIpnuEY2+UrkKPep6baG18h3c9hpCFi4qHfoh6jneBf5l+b3+DfWFlfZuzXmSHk4SmS4SHjYBhjXdtbj1/SHR2Y5GFh3J3hH41e4xzqHt3hXaAiV+Gv2oLlRpsTSeFjnmpPIubmWCIkHl6uX2Bf2qhVI+GlQV3YnCKgp5SenynWZ+PlHB1b4pWchOUu5WDc391uWNtkBWBe4tPaQhzSoN2n4VyIHRuin+EQ5iMjIOCe4Z4PmSEeoyNb3CptmB/kHGLnYJoLZCUho1WA0qNo3WKgmUHcXt+gHa8T2SbU5iCfZN8r3hPgYUqRk9uaoBAjnqdlIxahHmVhpNdi36XmqOJk6B7ejZtgK5Dgm2ZoWtkfo9/Q3uRgIWSkXqLbpeOjIivhmqFhXt+aXeArWtzhn6Cr0SDhox8epptXGk3dlKGdHWShGtye5qFNnemfKx8fYeee4x1l75oCokZZGMfgJ+CskeVkIZth4WClr9bg4xopoONiosJfmZ5jZOram+VnhWnlZ15cZNaZX4lnd+Dj3p1eLtBk4seinSAanEGhkeEaZWBekOpeJWSa1eVfYuLfnqCdkNhi4GNhXFZpI1gfIpzlJSGaCmglYGPUgRLgqh4kY1rB3R0eYh2v290lmCKiX2Cb6F7UIKNLoZUdWeFh4Z2lJSJXYB7lo6Hbo14mJ+ei5qyZ3Y9ZXquQ4lvtrJycH6Lf0OFj4WNl5V/g4SNhYmOwJJcg4V8Zmxzg51ma4uGg7lXgoaPiGORbmJvMm9JhH92iIV2c3qagCx3pXutfH6igG6GapXEaAyKH1lmJIKrfrRMkZuJXIWHfpG4b4GHZpWKjoaOBXdifpKToF17nLQYspWidneUh2l9H57nfYt7eXeyTpiJH4Vnf2aLB4pHhWykiHlIk3iQj3BlmXqSi397cnlCbIWijIxVYqO5ZISSdoyIe3IvqJOCh1oIU4ixcpqDbAZren2BeqBJUphglIB9iWumelaGgypwRn9ghmuNV5GVim92e5aKknZ/epShk5KU1HOIM3R8r0WEdqq+aW+GiHo/f42DhZSNeId1koeClMKFZIWOdXNtfX+cYWyNfoOfVYiBkJBqlXZbbTR0SIZ/cpuHe2t9l4gufaCErnx7mJl1iF2XwGoLjyVgXCSEkoLSR4ydgmeQkX2OuH52hG+Oho2HiwVxa32RjZh4dY6XMYqWoHN1i31ofx+c14SJe3l1uUafmRiGd39tdQWDS5xtmIR3R553kIqAZ49+gJ98doBzPmGIi4iLel2hwGF/kHOEf3huLquTgIxcB1iusXGOmmYIaml2gX6uamqWX46IeoJnp39VnI0jhE9uaImch3WLq4FveXaWk5RzjXuTmYyUlMtkMy1zfqxHgHS1pGdtfYV5RoiMi4qTkHOVc46ChZHBhnB2hHFxdHuJml5roIR8lUdxg42ab41samoybUWEfW+KfoNwipaIOHmcfqt6gY61dItGk8hqD4MlYlwlgKCAqEeFmoldi4yCjraDgIZulIOMhI0DhXF+joeafH+OwD3QlqRzd4dkZX4dmc6IhHmAdbZdoZMciF+Ea3cHhU9/dqeNdj+FdIeLfVCXf56Wf3V3cDpugJSLkHaAnb9lkZlzhHafbSiVknuEYAdWjbFpl39mB2V2fHeIwkNmlHecf3l/eZKAU36TKG9LcWeOjYqDiY+FeoV2lZCSeH56j5uNkIyYWok7fX+sSnp8polkY4SOhEKAjYKMj4d6hn2He4aQxZJ4e4luc297hZdiZpB+fb9PiYSSinSNaWJsMXVDf3xolISFbnuNjSl4l3Kren2KhHeKUo/EZxOUJGdbJoGVgL5bgaSIY5CReYWweIaLYo5pioWBBIJqeIuIl2F9iapGt5iOcXSFgmR9FJjjgYN/fXK/UaiRG4x5iGRpBVZNg3KbinY6hHKHi4BgloGXnHd0eHE+YX95jKB3d6OVZICReo4rf3EmiJB+iGAFUYuxdZGEYgpLdXmHkd1sapaElYV5hnyWg1V+gi6DQ4xolJWNf4nHc3x5gJaRkn6Pe5Ogkp2KrmWJY3iErUmMe7WYbmR+i21GhomQipGSeoNzlGuHjbqQhHmGeXNrfIycVGaNiIHJVIWJlYRuhWVucDh8THp+aZWHinB6i4safox5qXp7iY10hU2JymsMjCJpVCuDl3y6bnmfkF2HjoV/sHKKkG6QhoyGkQV/ZXmPi51lf5GTQqqUqnlre4Vmfw6b4o52e4N2uHGQkxmqZopVbwd/U4B0oYl0QX5niYl6dJGIi4yEbW5rXWx/f42Yd3GsomN9l3aEZH90KYCaf45eCVWSr2mXemAFVHR8fJisWGyYc5mDc4F9lYVVeZovhEN3aKmXhoKE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h3uGg3yBYYN7g3yGloB1Z4Z5jnR/f3uTdYFbgnB9AH59fnl5jXl5XoeEeoGGGGFtf3uGiXd/iJRwf4oRlnuFf4FagiN+iXptfosVT2KEfX2Akn6Nf4KSgi9rPoNjf4B/bYyWfV+OOXd2ZoeEfkqFf5iDo3p+fYqDX317haOCh3t2fXlxjm99i4mDdneKPXyEq3OJfH9+fn9/iYB4d3qDh2xFkYx8QnxzdHt8h4tIenuYfWlzcoV9jISIeX6Egn2ChYB8k36Ee4OXgoSGgXyFP4mJc3+GgHt9foeOen9/foB3hnhybWt6f3+Kc5SHgHmPhoOGkn+KimV/kYNlf4SDb4d4goJ7f4iDeXmChJOEdXyDdIV3fn+DmoCDWIRve0x+fXpOd4p5dHCLgnt/ihdxb390eoV3g4KkdXyPCpF4ioSGYINUf3x5b4+HG0pthHl/fo15W3mAjYIydEqEX3x/gXF6l4NUdDxxdF+Fgn10hX+Rgpt8gn+Fgl97gIiSf4N4eoN2cn1uen2Fgnd1iGlzhYx8hYF7gICEgY1/eXZ6gISBQ3KVenJ8gXqCfYaBYIiAhYN9fXGGf3+CiX9/hoN2p3mDdI2DgXuCoIaDhXmCfTqHgXZ8f32BfIaEhXp/gYB/dY1/fG59f354i2uRiIJ/iYOBhoh+ioJtf5KEbICAgH2AloV4fICbh4KFg4GAjHh9goKGfHp9gYiDiD6Df3she5B/RIaHfHR9cn96gIwbc4CDmHeGc4J8lXKEcQuWdY6FinWBfH55dnWXhx1DZoZ1in2BiIN3gJmLUnx6hnd6gHp3P4mGaYVlcHNuhXR7jIKBhICngH+EhodKhHeEjX+Efnp9fX5ZeH6EgYF4e3xhfIGQd4J8dIZ+e4eJg3h8fYKCgIBnm3p/e3l6gYCGfgB8fnaFantwg396hIhyfIOHfZd8g2eQhIF2g319hod9gHOOh4p4fYKCfX9/hISBgoV9fnWGhH5uen56lHRtkI6Ae4mEg4SOf4mCbn6Rg258goJ7hoCJfoF/vIZ/eX+AhI95h4Bugnt8f4CQg4Vkfnd5YH2KfVl8g39uh4iBeH+HAHWQgpJ5hnN/foN1hnNFkHGLf4iDg4p+f3hoj3McYGyGfIV+fYWBfIGSi1B/foZ0e4NifwGWgm2QiIZ0fYVve4x/gnl7jIqGhIGDW3t+g4p+goCAgHl3MH16eoV8e4Z+jnuDg355iHeEgHmGiYZ2eHl9g5N4dpZ3gnt4foSDhn+Lg3pJhFd7dYaHd4WKeHyCf3+Ce4VMfoF/YoB0jISJeIVtbYqHe3t9goB+iH+Af4F8gH9wg4h0jXF9f6N+cY+NgX2Kg4ODin6Cg3uEkIdxfoGBfHyEhX2AfnaGhImCgICBeIJ/ZIN7fX2DdoOHjoF0e1p9jX9yf3iCbIqDgnp/f3Z1mYOYeYR0f353dYBxco1wjICJhYCTeoB5b4xnI11oiHeEf3d/gIV/jYeAenqHdnyDfZYaiIN3k46adnOFe3uGaoVnfYeFg39/gV+BiIONf4CCeX57fT6jeYOCen6FeIt6fJZ+fIF4hIF1hHqGeX16fIKIf4CQfoB+f3h9hId7jIJ+LIJGc3SDg3yEiG1+f3uAjYeEaHWDglB/eoGChHuAd2mQjHyAfYJ8f4B8eoB8e3p4doGGXoY0fYCGhXGTkH97jnuFgJGBgoeAf4+FaYGFg316fIOAhIBrgIGLgIB6g3mCglmAeYB2fZCEf5CCc39ygI98h3d6jmyMhYB/gn6Df5eAhX1/dX+Ef3aBiHeDd4aCiIl7k32BemKGBhd5bYF9fYB0fICKf4ZXloqNgXh/hH2VG4N/bYqLmnmHhYB8gA+CW39fk3+Bh4JndHeFiX6AgnV+d3NZYXuFiX19iXqffnucgGWCfH2Adnxihnt8eICDg3NykH99fn9yiYWDg3ODdAGDQHNwhIV2h4Zsen54hpyHhG59hIFQf4GNiIh3fHtgkoh+g3yDgH6Kgn2Cf3l8d3SFh2GKA3+AcoVyjI+Ff4t+iX+ZgIOJm4KLi29/h4Z/eH6Gen+BYo6Dkn+Ag319hIZel35+e4CThIGhhHN+b3+Vf414f41tjIWDgIR4eH2UgJB+f3eBh4x3g4CWjHaLhnqKhJZ9fXtreQAUe1+AfX2Bd4J/i36JDpp8s3SCgYV6kReGfmiOiZ96fYl8e4QAiFWAQ5WDgoiDaopmiI2DiYN9fn15aWV+kYx/eYV8AH56tIFIgH6CfIuCcoZ8cnd+j20kmYJ2LXxpfHl+h4JoeHqTfluCeIV2mnqJbHx9fnSjiXOBdn96gn1iWXqDhZGMZZB9eH1vfYCFhXd1en9vfnxsfFVeh119VaeKf5B5c3eOgXqFloKQhmB/iolnfYSDgYRxc39/g1qDcG55hnmCd2R9hKKAf3l6nXyCUH15fSF/f3OFgI12gGd6f3R/eg5YUYeEf4N3f4WZeYSPI5mBiHqCUYEcfpZ1bJaFLkdjf3qAgph/iHiDgnNIaT17Qn99emKLo2Jpk0KAemKHgX9NhYKWf6N2f3uChVd/dYekfIFxgIJ7c5N1eJF/iXt6i0eGfaRvf358fn+If4Z7eXhygYh2MKSEdR97cnp6fYd7Y32AooFPfXp+epKAh3qBf4J1mIaFgod9gIN+e2uBiJ6Ki1GKf3uBe317fX+CdXyBeHuJfYRtamttgIGHg3WSf3h1j4J+goqDkIhggYmFZHyDf2Z+dYOAf4JihXtygHuaeHYNf3KYe3t5gJ13gFOCbXpbfnV0cn+NeH1efnl2gYEYXkKBhYCGeH+CmnWEkjyXeoh6fz+DKXyCc2+CiDk1aoN4f32TdnZ6goh4S3A9fjN9gnpjg5huXpE6aHljgoN+E4WAkX+ed4GGg4Zjb32Bl3+GdYWFenaMZHuLg4h0eY9qgH+Gco6Ae35/iIOLf3lyeX+IdgCMhnZOfXx2hX6GhGaAi5uCdHV3f32Ef4d/eYeAe5t/e4SGgICAg7p9gIWBjIaJi3l8e4Z9eHuFg4CAgnh8gnqEenpOgn+Aj3pzk4iBdouBgoacgJB+cn+NgGx9gYB8hXZ7foGBhIh6e4R+hI53fIFyi3p8fYCVhIZLgHJ8GX54d0yBiX58bod/dYKKLWxAgX+Gh3eFfal2hIMNmHaIfIZXhVZ9enh0koc1N22He4Z6jYBDfIGIez15U4FEfYF9amKMcFmaQXF5X4N5fG+EfY1+rHaEgIOCV3CBhJGAf3eAfHt6fXZ9g4KAfHaKVH18jXmLfn6Ff4R/jX94cnd/f3pGi4t5dXt5coV+hpE4gXuGhIV+dIWDioOGf42EhnqCf396f4F7foOMgXyJf2Z6Q4d9fXyBfHx6fYWAen9ue4B5jX6CYoh/f5B7c5KDg3eFg4eKjn+KgmOCjYJpfYR/e4KYgIOCgIqIgHlsf4F7dX6BboZ9f3qBi4WDUX5/fGl+fHopf4R+eoCIfHh/lQ13dYOJf4N3g4B8eoOQMpVwiIKGcoN2f31xdpaCLSZwjnqIfIN/fnyBiX5EfVmBX3yDf3dDioJlb2uCeGuAfXqAgH6Cfbp6hoGEhmGOgICNf399gIR5fldxfHuAgH92gn+AhYI9gYZzhn+AfI2DdXd9foOTXmuIdIJ8c316gYmJIIOHaoSAeXODg3+Chn2AhIB5jniFaX1/fXN/gYaEhnd/aGeHgn5/eH6BfoB9hHqBf398eYeEgYKHfICUiXOPhIF8hYGEhH5/fXtygo+Ba32Af3qAeIZ/gH99iXuAdIJ5iXaAgWl7e3yBg4iDhWF9fXxYf4F8TX56gHOKgYB6f4tAd4yGh3uEdoN/h3uHcE2Pb4mBiHx9iH9/dnOSey5dboh8hX59g4R/gYmBTHxtgmN9gmiHCH+EdYSJmXprgHp6gHiAdXmieoOBgIBfjniBin9/gIF9eXoAqXp7gn2Af3p8f4CUe3l+eISAeoGHg3V5dX+Bm3J/i3iFfXiDgoOJg2uCejaEXnt0hoN7fYR5foKAfImBhXNyf39agX+GhYV9e2hkiIZ9gnh/gn6Ken+BgIB/fneEiXWPeX1/kHp1j4l9d4iBhYR7f35/dYeOgGh7gn99f3uAgXt/cYaGgnSCeYZ2gX9Xg3p/d312g4B9fHR9d3+FgHN4bolxioJ/eoCAe3mUgoJ7gnR/foR6g3FtinGFhYaGfJJ9i3RtfG48cHCHcoZ9eHmDh4GGd0Z2eYRcfYF/kA90gXyQj5B7iYB/e35jhFx7k311f4OCaIF6gYiCfYZ2f3l+KGl7hoB5f4N1k359jIJ1gXaGf3h6gIZ1d3h7gJGFh4p3g354d4KFind8fXgEhE52doODeoWGb3p/eoGQfIZfeX+A34F/jomFd4h3aYuHfYR4gn9+g319gIF7enx5g4hkh2J8f5uGdpGNfHeLfYR9jYCAhJ2AjYBnfoN/fHt5hYF/f2KIh46HgH+AeId+UZB9f32EfISCooFyfXJ/jX6EenKSb4yHg4CBeoB3koJ6hIF1foF8eYN1dol2iIaChXeWe3x2a3JtKYRtg3uBfnV/f4x/ghZEkYl/ZX6EfJIQeX9/ko+afZaEe3Z6QoZJenKKbX+BgHCBbYKJgoOFanx6e1JqeYyGenuAc4B5fJSDTnt1gH90fHCGe312fIKFfI+LfIB+i296hIp3d4N1OINZdnWAgnqIhW54fX2AioyEdnCBf1WAgo6AhXV5fmSPjH2GgX9/fZV6fX9+fnx4dYSFW3QAfIGFi3SPl4d7i32KgJiBhIN/hI+KbH+Bgnt4eYZ8fYFZiYCRhoKBg3yHhFeUfH+AhZyGfH6Bc3+ofox9kXV2k26RhIGAg3h2f5Z/f4GBdn6BhHiGg5OMfIqJhoeHk3+AeWuGMA2BaYF6fX9zfYCSf39hU3+Ye3N/hHeNDn9/e5OPjICRgHt1egaDSX9XnGmNh4JyfmKIh3+Fg257fHZsXn2PiXx8g3hze3+XhDd7cYGCkIB4f3tzdHqIWBScdXEzeHCEen2EfWp/f5SBdIB3hnOPeYZ6gH2BcZyCcIWCd32Cem1ffIV8jpSdioF6fnN4d3mAbVl2gXt9f4ODV3KocIUympx7j3R5cY5/d4WYgIGCV4CNhWh7gYCCdXNxdoF/a4Nya4mBfHh0gHWHkIZ8dH1veYNOeXV5YHt9cIx/j3d+XHN9b351GV5Xf4WGinyDgZR8g5Qskn+Ff39Bhxt4jnh1gId7RGp3coJ9ln51c4KBd1BsOoBrfoV7U3qSeGiTN3h8XoF5fV6Fg5Z8qnGEgX+EXY6Cfpp/hmuNk3t8lWF4jXyIfoSXaINrinCPgnR/gIuCgYN5d3h8hGAonnZrMnl4c4J6hoNxf4iYgH58foB4lYOGgIGEf3CKdnuMd31/fn95ZnuJe5SSWoh6f3lSfHJ+gH1zKoR3fnmCg2t+eXqDfpGIepBxe3CKe3x/hXuRhGiAjIFmfYSBZ391bHyDhHiFdGmCfICBeH98epN9g3d+k32CSYF+fEF/fHZ3fYx6hGt2e3B/eRhsRIeIiol8gYGPfIaDK5Z9hX+DBos9eIRcc4+IaxRuf3mEeZaGa3qBgncvc0x/WH2DeVtsnlJjkDx/fk2Bfn5nhX+XfZtshoV+gmVqhYKVeoJtiYd7foxseoh/kn91k1GIepB2kXt6gX6KgIp8eXF2eIhvJn91dVx5eXWBe4eNaIN2kIKCf3t/fox/g4SLd4Z2nnd+iYp9d3+Dd297hZR8iT2HaoB6e3h4d3t7an2GeHjFgoZ7g3SDgYCEjHuQd35xiIJ/h3t/jX5dhIl+aXyEfX53f31/g4F/hnltf3l+fnZyfXSFgIp2g4aBgkt+dnh0eXlzTnSKdoBxe3xugYseeSuAhIGGeoZ9jH6EhQiWd4OAg06DXXyBbHdvhXs1c4J5iHeRgDp5goJ8SXNHf1l8f3toMZF3Zn1DiH1Tf3t6aoN9jnqsbIqEhIF0iYaAjH2BcIOIe39/bnaJgIODe5RxinyDeYuBg4R/iX+NgXd3eX9/hVtydXF1e3F0bX6KnleDen2Gi4J2fIKEgoKOk4B7dYZwfn1/f3WAg4Zyeol3i3tShIB/eH54bHqBe39+hn19e3+Dgod5in1/gIB6kH2DboN7hYJ/fYZ9aYONf2Z/g3x8hJB8hn+Afop9fnZ6eJl3en9meX2RfIV+h4BDe4t7DH12fyp8gHl/g4l6c4CIF35yg4R9hXyCgoOBiXMhk3OBf4Zzg3V/gXZ4dYJ1VXeIe4t4h4l3fIF/fEp4V4FreIB7dA+DgGh9eHV+T3qCd3uBf4V6q3WHgIGCd3+Df4h+fH2CgHp+aaB+hXyBhneJcIWDf3qFfXqIf356i4N0cXV8gZFJend4hHtncHJ/iowmgWlth4p6d4OAfYCCioh+hHmAfohlhX96dIN8eYWFeXhwioWAf3yAfXl6gHqDeoZ6f3t/gIaFdoN+f4Z6fI1+fXGBgIWIk35+fG6Dj4FrfIF7eYJ7eoV8fnyJf4OIfHeOdnmBXoB+h3Z4eYWAXHl+eXV7cn9WYXWDd4qDe3h/j12AhYd8gIN6gX6Cgod7SYxwgYKDf3eIgYRvdX54iX17iXuId4J2iYCCentBd2KCeHuCXn4AdoZteYt/f3F8eXl9eYF6dK54gnWAg3+Kf32Einl/g4N6gQVqfoWAe4V7eH98fXZcfoKAiH9/cYiFcnF1gn+UY4N4cYt5aHlygomEP3aATIZ3d3eBgnmBgYV+gXl9anWFb3p+emSBg399h3GDaGmEjYCOgHqAe4J4hXqEe314fH+HfXR+eoCSfXuPentzhICHf3V9c36Wh5B/bXqDe3p/eoKBdH51i4KBeX98h3Z/f1p/eIF4e3GFfYN6eHtyfIJ+d3dmiHCNgH93f31zgI6Fe32Ed4N/hICHhXSJc4KChIZtk358cHWJdYZ/doJqhXV8goGIf396N3txhHF6gXmGFWeEeZGPhYB7f3t6fGtpXnSMeXaCh4J/lXOBgpJ7g3l9e3kPanuOfnSCd252dn6Ifm+DdoeCdHaBhXR2dXx9hnN+fXaJfoxzgoKJcRR7eCuDb3d2hoJvgYF6gIF9fo2EhnGHf3tig36TgoVycXlkiJB+lX57gnuXdYNzh4B8e3uAim9vbHqBlYN6j4hycoWEh4NvfnaAdIWPgW16f3l9fHWFhHd+Z4uIh4KCfoV4gH9UjHt9gHN+hYJ8em57o3uQgol4aDdqjISBe4B3fH+QgoaAgXh9fX9/hpB5h3eEg4SGbJeAhGx1p2x4mHR/fn93d3+Bjn59eg+SioNte4J9jB9egnqKkJiBm4F8dnpGiD5zb4BPe4aDgZB7f4GPd4pmfXt+WVp5kH9vf3pse3R8jYFegHyFgnd4eIZ1eW92gHp5d3t1in17aXuDiGhXbnI9gmd7dIN/bYeCfHt+doGMfH12fYJ6ToB3k3uJdnyAYYiGfJV8gH97g3SEcYOBd353fohnZFt1gYWGeo2EinaJf4R2f353gHyAkn90f3x/enpxiH9sfVeOe46HgX9/eYKBYZR6e4SDg4OAiX5yenx8k4CQe26caI1/hn9/bnaEkomCfoB3f4F1gIeJhYl+hYOFhnmSf4JxaZJoc5Zwe358e26CfpR/f3MAhY6EeXuCe4YEcoR2io+QgJiDdnd6KYoydmuKcIOHf3SNcoSCg3+HVXh6e3ByfY6Ebnlta2lzfJmHBX12f4CThHiHh292eINjFoxZZz14fX+BfYZyfoSDjIN+fn+JcZV9hIF6gYhjn3hojYaBeYp3ZUZziWOKm2qHc3p4WW58b4h2fnGCdXl1jJFjh6iBh12Kkn6OZ39ni3FxeJGAfHxWhYp9Y3Z/gXmIeWNvhXpzf29xfXh0hn15d4GDj4FueXFmiFJ7fXcrfGt+i3yKfYpkdXtwbGlMc1uKjYqKfoWAiIGJpjCPfYGFgl+FAICLWm+Tj50yd290hnmSe3l6g4J4Rl9FgnZ4hndQb5J0kYU6hYBFfHl+foZ/nnucbIuEfYNwpI2DlXaCAImHfIOPd3uQfZOGg5lgenyGfJmAcYR/kn1/e4J4cHaIVU2TYGE+e29veXuEgXaGeouCiYV+gHePgYGGf2uJc5B+c4qBgHuFfGhSeIBxgJaKhnaDcmt1c3qAb4p6hnp+fIuCc4aig4J9hJl9i3B2YodvdISAeIN6VoOGe1l5iX5sh3Z4dYuDeoBwXIF6c318e3l/eIaBcH5/dX5QeYt6bH5qdYV0i3qJanl+aX51LHU6hICHiX+FlnuGiK43kX56f31khyR9h2RziYOcAHd0d4J1kXhgeoJ/e09sNn5re4JyYlmJe4aGOYiDTXp8foKEf5l2m2aBhoGBf5mFgJF3hmGLlnmFjml0kXeRhoOacZB4k3eYg4CAgJN/hoOBfnV8a2cej1tnTnlxc3p9hoZ0hneBhIh+gn+EkYOAkIp1hniAbnWIhYF1jINpS3SGcXaRcYB7gnZpc3mAf3d3d4l1foGJfoGIkIiFgZKZgo1zfWaDa3uAhn6Me2CDhXhefop9fnt8d3yHgnqEb22DfXOKenl7cnmEhHeBf394PXSNeld1YXZkdop7iHJ/fWR/fVl7Y4B+iIl/dZaPiIihKpN5eX+CZophhH87epqEpVJ7f3qEd41+O3yCenhMbEWAbHyAfWkQjXh+dURwgzN6hXx6hHuQdqBnhISDfI6Mgn+NeX9pjIF6g4SYe4p7iot5l3GThoJ4k32KhIOQfYl/f41zgIN4KYdWamp6Z3dzfoiVYId1c4iOuoB+goKAf56IcYF7cn5/gXx7eYWEZ1J+gIB1gIaCboNze39weotyenqIdoB+hXSFjI2GhHuKjIOMcn1kgG16hnl8fn5ggIiBX4CMfYB+jnV4goF7hnR0d31wjXh2gGlyg4Z0fnGEclJ5lHpoe2l3Y2WEdoZ/g31xf41LhWyEd4WFfYOMmoiOkE2QdWyCf32CdYCCanuWg6dzhHt4iXKHf3t/gHh5UXVUgnN2f3BwJoeEeIJ7koNXe395fIF7inicZ4JxhX6hk4J9hH98bI+Cd4F6ZniHeoWNg4V+iIZ0dod/kIiCiH2JgXuGdISCizhpXGZ8emNzdICJiVZ+bmyJj39/foSCh3ygjYBvgoVshnqOfHOChGppe4h1dmlpe3+DfH13eX1+e4V3inJ/e4JoiYt/hH97eop/jHd6Y39+gH9me3J8h4OMgV98jXl9g31/f3OAcYqCfH1+d412eIFifX6Den5xhnhbdIV1XnxlgGZxd3R/int/dn+BZ4Z8e3SAiH58fZSIjYpni3h0gYKEc4WIfHd3mn6ug4aBdINyhICGgn98flJ3VIRxen9JhAh+gnh0jX6FYnqMe3t/enx1o3GEc4Z8oYF/eH2Fe32GfHmHcWl5hHp5i3tudXuCdnWHgIKCgHl9hoN0dnWEf3cve2NsiHZog3SDiXI5d29kiIx/foCGb4R8mYGBcn2Geoh1kH55goNsc4aBdXNqbYGLgYd9cnp7jnF/bIR8g3p/Zo2FdIB5f5B9gYx5dGN/f4KIX3tnemh2jYBveoN4e4B4fIJ2fHCJgYdxe3yPeXeDWnuAgnV6fISCXnl8eop6fYGCdml2dI98f3h/eHCMh4ZvfoV+gXxyiYaYdIZ4dn+BhGuPiXtwcrJ1sIuEe2iAb3x8g4l7eHhCfmyFbHl/d4cfdoF2eJJ+homAgXt6d4Jecpd3c2uIgaqcgH53iW+DeIF5hmFbfY56c4l0Xnh1fX5nfYGAgX50c4GFcHJwfX9lf4Bgbod7bn98gYhpEHh7YIWLf39/e2iDfJF6gWd+cn+FeKp+eX2Cb4F/hHB/e2OAgoB+g3Z7fYpygnKCfIB9gm6LeFx+cIGBg3+KfnRngYeEf2B+Z35vho98c39/e3uAc4KCYX9pjoR/hoJ+inl+gGKKfXtue2yGgXZzbnh4fIR/jH1rhmiMfn94gW91hYWFboWFfIN7doWFknaHfnx7g4ZnlIR1bXqgd6uXfH13fHN4ioGSc3Z7KJB8hnF5foCHJXR+d4CTeoaEgX53emd+BnOEf3mCiYCjjIB9d4l6hXd7eolzaHuPd26EcFdlcHiJfWV+bn5+dHd7hG53dnF+c4B8WXSGfY9ug4SKaSN3eV2CgXx4gnxiin+IeoFygnyIg3yAf35thHh0d4ZzcYNtioKCkH14gHmIaIRshIZ8fnxzi3VNcHqBh4l8jXqGcIaIg4V3fW5+ZIOTgHKBfH19fWuFfWx/Z5CGhYR+foF9fYNhjXh8d3yAg4Nnd3R+gnqChJeBdHpjj4SEfIN0eYiNi3B+hHqCfXyFg6F/hX+AgH+Cc5KCfGp2q2ehnXd6fHtycYCAjGN6ghqKfIh1d399gjhlgW2FkpKGmIF1dnlefyhtdntxhZF/kI14fHuDf4hteX19gV55jn5rf3FbgXJ/mn5GfWeKiJp/eYKfanR3iV4PmURrMn96e3d8fmuFe3Z4g4x3f4luioCCgnt4jGmaiFuKoaJrkHhnO3l3b3+eV453emplaHRqfnQ/aYWAe3qSinaMooCAYpGRgIhlYGSKY1aClXuMd2aCiGsoc3uCbIV0bV2HdYt6aV17bXWBfnFun3KUdm12YkyIVnGLeXt+Y4KYdo2Di2J/d3Bpbi5xX4OAWouAhYmJiYSaVYiDdn9/e4UGhIdWc5aMskR1c3eGcIl+jnSFf29BVSWFjHaIdWpbh3iqiEePhlx8hIWBhHuceX9ngIl4gn+winmbb4RNipR7f5NxfZRxs4mBpHV+TJJ6lm50f4idfX+Cm3t1dYRfU5pCQDZ8dW6DfH9ohIJ/goWNfIyBeZOCf4aId4ZwoH55iIqfeY57ZEB1f1tboX2Dc4FvcWh0e4BqcnaNfX96kX97jLKJjX+WmouFZF1Tg0VggH12hXJJg4JmAHmLgXqBZ3tij4R9fnFmgnl4eoR2cZRlnIF4eHxcf0V2lHRBe2eAjXiPho9hfHhkeWpgeViFiIqKgG+NmY9/uzCHhnJ+eHWPIYN/XmaDi7pLe3B7hHWLZ3h5g3x1T2xCgXt7dXZyVo55pH9LhYo8fYuBeoR7mnGHbIV/fYCQsZB7mnCLUoqDeoiQpG6UeJ2Jg55rhX+IeZx9f4GImH+If5eEcHmBVT2qO1Y4e3Jxf3t/eXaEeXaIjYiNgIePg32PiGyEd46MeoiMlYaQi3cZenNdZYxrhHN+cV1lcISEXGp0iYF9fJFohI2jiIp4Z42Hhml0VoBkaYV0fX5uXYZ/dkV6in+Gem5vao2GgH9zZYF9boN+dXOEb5eDeH2afnVOdJl6f3JjenpljnuMcYR9aIFxOoFngHqJiYJ+g4mOgKNgiYJsfHZ5h2KIgWVuhYe5HIdwfX98inVKdoB2d0RuSYByfX99ehR4gZeHQ4SHVX+LfXaDfo92iGaFe4F+rKGDepR6hVWHgnaMjllxjnCgjoaWdYuWeG+XeZOHiJuIiYOQRGiLhGcTfzhkSn1vfHR+g3x7g2Jri4+AjHqPgIN8mo51dX6QdXCHjZF+motnN4GCX26AenV0hXBvfnl9eUtseYV1gXyJUYeMnIiMe2ebhoZndlF9a3J/dnp5coOEgoUweYp9hn+CeW6Fg3qGf3CEe3CEfGl6emyGe3Z/dYBzQXCXe3h7Y35zZYh8jYCCe2p+fT2Hanh5jYd/b4WqjIapcIiAY3x6gINzkncmYZqGwIiJdX+CdoNkc3p/f3xOYFiDeXR/coAPb4OSa2yViEZ6jX94hHGLfqNihnOBesObd3mJeH1eiH50iYpkdIxkjJCDf3GOjHxvlG+hf4aKfIl/gYlwkYFtSXw3aF18YnZ9gIRiZH9wZo+Rfot4lXOCeZqJfGuDf3WDgJt+g5SHZDyAe3ZrXGx/fX93d1p2eoEthW6IeIp/h0iNjoeIhH9pl4qIdHFYe3d4hmd5bWxTdoeDWImGe39+eXpkc393iYlxfX57hnl3e2x+gHx6eHyCfleDjnSDeV5+fmJ+bomLhYFugn1tjnF8a42HgIN0oI19p22Gg1yBeol2gpJ5ayShgMOPjXV0f22Cd4Z/gHh0H3FbhW16e0mKO46GgnyLgIptepJ/fIJ6f4icZoNygXvOk31od3x/c4h5c4iIWGqTcnmQelh3d415dIdtn3qBfIWGg3lyeY+DYBeUQmlqdHh5dICEaw93f2GOlICLdZRlg3eagnxufJB0fn+vd3WJh2FahoVqcWNwdH5/f4RnfHluKolwhn6Me4NIi4hShG5/kpCJhnR4XnuJfYFRfmh2ZXuKimWMhXx+e22EfGV+Z4+GfH95coZ9f4R1g35/fHx8hIlcb3x7YXhvgoh2cnB+jXh9coJzcpl7fGWKiX+NcIaKfZB0goZpcn+IZoyVbGp0oX/GjIp4XHNqd3SHjX14dUJ7d4Zzen12jAyHhnh4lHyLg3mPe3h/emaLk3WAbnt/1IZ+e22Af3+PdXaYhmaCkWlijG01cHSDhXuOYoR3em54hYNqaIeGgmBzjURlY31igYGCgFtVf31fhpWHhniCXod4j3yBYH2Fh39/qnt/g4d5a3d/aXR4bYCBfn6Jb35yiEqEaXh+oHqEVoyBcH6Cg4eJi4Z2dVt9hn6FRX1keGB1jYVpjnp9f3xugHdvgG6PkYV6gXuAhX5qYoZ8fHF3k4ONXGyCe3R6eYSUe3F2b41/gHeCc3GQdYdQhYiBhHVYjniieICJbXN8iG2OiHZia6p8ypp8en11cneFhJ9sbnY9i2aGdnh3foQihYF6iZN/jZSHhnp2eXtVjZhtenqFfcqBgHVmhHuGgX97iIgwg4pqYolxI4FvgY1xfGZyaXtven6HaW6FcYZgjoYxbm98aX2GgoVrZH17WIOUf3x1fWGCfJB5d2OEgI59f6J6fXuDeF98imN0ikmEgH6ChW5+cnddgmx2gZd8gmmKd11xUoJ1poiJiI1ohI1/eWt2cXdyipKIY4mBf395X4V4Y39sloqHeH53goh6cIKbfnuHgpKFjj5xe3s1fINznId4d2mPfoB6g29viXuHY4SKfIZ9bYl8hoCCi3dwgYmBkoRvZGOIgcGbcnaPdW1xeY+RVnx/JY9tiI13d4GCO4mCan+Lj4qRgn95eHd1UoeLcXaGh4GlgX17aoKIinl2fn+OcoaQeliKbCx5d3yWe31RaYSYk4R6iat5dY2IY1aqPFcFd39oe4F9Y4yAC2eFkJ6DiG+IcIdgjHWIYZiHOYiIk3WRZ3Qfen9obLJhg3FqZ3Ruf1SFgk9xiX51eo+GcI5uh3tCb3mPeUljR4s2R3WCeHFufX18aS12gICQejR8TIVuj3RwY3Vsg4aIfm+kfn16aXidPo08cZ57f39vhJZvjoiMX4prZI9zRINUi4o4iYR8goOLdahLgpVYeYOHijuCc3FidpDHbXFgf411jGKGe4mOcDg9YoWdfGp3fXeJdLiiYKKGVn+BhH+Efpp5g2eDg3OCfZaYgJ5yhzGKhXeLlaxwk2W9hW6fa39slHuVaXSEl51+in2wgn9/iFRgszRjAH52cnx6dYaHgHd2h42Skol8lnt/f392iWWcj0+QjaVimGF+RH5sakKeYnt0dWp4dXdvlE9UeYt8fXuSjHuVno98e3qEhnRkZUKBW11+gWx7cHyDeGFCcYZnhIVefkOSholzZXd6fYSGiHt0onU3aXp/tFSJSG+ieX55Z4OUdJONjWCMe2d5bTmAVICNY46Ch4iTk26pLn+IY35zf4kdf3VRa3KO0X15d3yIe4ZxiHiJgnA6WlKCnYRjhIdah4HGl1yajV6Biod3gn+dcm9lgIR7fZ+ylX2heIw7g3h0h5VaaYJrp4KBlHJ0Z5d2o3l9fpqfhIZ/rYJxe4xlJ7IpXjh4foF8eXtrhYaBY4yMkpt9eZVzfIaKgHprioRggo+YeJuEkCB9e19SjG53aH5xa2x3goZMTH2Hfnx2kVuElb2RjXpXj5B0VHJKgGJigJN1eWl4gXdxGXqCcpCDa3NWj4mGfndzeYp1g4Z3eJBynnV3gaZ+hkN3nn94a2Z+h2yRhI5qi39kd3FKfFiDfJCJgYiLiI5sqTx+iV56cYSTYYZ0cHuQi8qKgHSEiIGCLmV0gHx7Iltcgph7X4mLZYF7o55VnIpSgYZ+cIR7k3JvaoV+dnmwrop9m3OQSIxudIyVXniGb6iMf4dtiI6XeaV3nICJl4OLgZ2BZpKDUx+XI2A5gHZogn9/XX2Ei1yRlI2UbJyHgHqRjnhreI6HcYiYjmmYj3wIgnJeaH9ZfHaAcmhwcnp9VXWChXqAfo9ehZWajZB8YoyOe1dbRn1qa3+Ddmh8VHx8fyV9hHKJgnd5YIiCiYGBZXSKeoWAcnN0gZVse4CLgXtZa5N7h3lldoZ6kXmPf42FZXp5c5Boe3KWh39+fr+OaK1mgIpYfXSEiHSbdWp0g4XNkIJ1gXd4f3t6cn98dFpCWISGcH96k1hfhZZ6do+LaoCMgHOEeI+LkGWBen1ZuJt/eIp4hU+KfnKMlFhoj1uJjn9ycGyLl2mRZaR9fIaAiIiIhHKbglwslCJlD3xzdX1/gFlaiINlkpSDlWiqcIV4lIx/b3iGYHl/m4B1mY1tBIeOYnR3a3N2fnNuYX+BZzWCeYV6iXmJeIiWf5CIeo6jj3tUYVR8gG9/YHtebFZ6gIVVh4B9hHttgWJygHuJgGt7dHB3f25zdIuGdH2AnH+AX3+RcmR7aIiNcIV1jYWEe2N/d3uObYR2k4l4gXGejmCIcX+QUn1ziIF+nG9HfJqBz5CBcYFwa3Rig3V/gnJMVVaEmXtxSJMof4qHcYqMjGR2ioB2g3OAn4JvhHp1d9CNZn1zeX9YinJxg5Jpd4l9dI6BJVGEjKR0kkyYcn9xeod5cm6DgXxUZrUnYTVxeHh9fnwuYYZ9aI2Vj5lyoV2AeI+Fekx5oHWDf55zdIqHZUR/gGNvYl99bnl2fm55fmyAf2h/foh6hlKMkYCIjX2MgJN2VHFEe4V2gGd3U3FRkYGNUop8hX94d4NiUn5kjo5fdnxvhIB/SWyBfW6Bgo2Fi0lqh3xzfGaPkX91aYaLfXpjgHVilnOBYo2LgodxYY9Yknd7kFJvb4l6hJp1W2+QgdaVfHNhX2Zwh4CKfGxuQnVWhKJ/cXuHN6aFeo+Td4+IZJN6fX59daZmdn96Z3fwgHuFYG98d4mDdoWUVXKUWmaOc1RlaoOnaY8ueGh0anmChWh6dpd7WJSyCGUcemyIgXV+SVqAg2GJlZmQbqFViHiNhHlgcJd1g4OIcHmKhWRMfYVsYX8+dgB4b3t0eHJjXYdkdXyeeIVNjINghIZ+jKOUdnWAVn6NfXtxeVp7OoiDimSMe359e2mGbj+CYZKPZnVyfnaOcVNxkYBzf4eihYpea2uAN3lwfZyLcGxuin97NoZvapA0iGeGi4KLbV6KQ312fpFWUnqIgImOd2p5jITYlG1yf2RuXXKDm3JucEJ8aoWyeWqTgnOCgXyKl4iOnXKReXWBhW+ean13f3h/24+DgVOCgoJ8c3V4lmFdkGlVh3QeY3R5qm+SX1tkdGR2fn5vdn6ReWuVlRBUJoFqiId/f3t4g4NjiJahfnGHUYx+gnV6aI54i3x8h393fYVyRoGEXFaOboFbdWyIc3lzeT5/cWxxmXyEdYiISYFOgnCghH+JcmKFd4WClHtWZVCOjJdYgXSHhnRzhHJjgmuRkYiCe2qIh3Zuj49/gmyBkoqRMWeEe2l2bXqjjH54a4aNfieBfECWcIpjf46AgWhDimaIgXuSSXN6iYOKhFJwfpeD07FzepBvdFx6f6NscYBEjF6HvXdrf3xckn5ri42VjZB4jXd1eX51o25xfXyJeKiKgn5hcHmEfXx2f5RmTpJwcIWFLX5ifIxnlD1/kJGBhH2NqnCBhIwRS6I5dgh1b3F+hIFDjYR/bX2ClneRZpp6iWqEgYZpeZk6kGSIaohIVlRjUEproVuSYHZteWR/Zoh+WmmMhHJ4koNphhp9cYZ/S4Rvem5Ijm4/cYhSAmZ9aHt9PnF1g4mKL3Vsj3+ecGlCbG5/jol8breJnXl6gJCWiU1qo3SDdVyoloWNiY1ohk9DfX8+fGV3l5eAgoCKXoFWxjx9l0WAjH6BP4VpXGd5j9V3bV9+hHSLUHx0ippxTlAnga96amqBfJGGuaFljIFCW4GDf4Z5n3Nye3+GZmxqp5x7nnyDWY8kdXSbenaJXax4dpV/ZHWUeJdKa3uenYWKhLVSdYGSPkTCMrAbdYiFfH98RpJ+bWh/h4+bhH2ecIR8gYN/aI6WQYaBoF2RaY0AflVCOKFcfThtd4F4gE57T0N4i35/dJJ3g4tmhoF3j2iPZkRQQYU/aXB8UwN0SoFyZDNtf0eBhGh1Q4x/jW4PfnB5fJR+eXO9iY13d3yvU4wcbKR7dmh2ZZ2MlI6JZIBpYFx/YIFdgI92h4R7hbqHX602eo0rd36NkUJ4bnCQaJLWg2d9hItzimqVcoaSeFRXbIO6fTx7h2GKg7mcZZiHP4GFgniGg6FxVGN/g3N8m6OXhaZzijCPY3l/mmFogG+sfZWMaoN/q4OcbHh9no1/h3+mZ3uAkzpMtx53EXd+fnl/eTmIhH1hgYiSm4KMmHV/fIiKcGhmol9/kpOJlXyOI4BqeTiSZHlteGx0g4BZekVWdol/gHCSU4SSkYyJfG9viWdSZSeAZFl8dGcub2uGdmULfYtUkH9aa0mNhZJ3Zmp3mXiBenRwooWTbXaDsnWERmupeYlla3STf5SJjG+JiFZ6cGyEX359iomChniQjFemYHmQPXx4hJVkf3Rnn3WK1YtteYKJfYI/b22DjXJJT1qFwnNfgZRvkH2om2eNikiJeHx0g4CedHNqjYN2MbKhl3eXc4xGiXFyg5ZQanRflH1ze3J8iKh8nGCPgIuQhISMmHFjk4NRGqYqSyV5g2uBfnxLhoiDWoePkJ1wooRyfYyJg2p0cJJ4jpWUh5WMgguFhmJEjFZpWntwhnx7bmo2aYeEeod0kVGElo+Qj3eAhY5pVlEwf2tgfnZxNHVuinh5IH+Cc419gHEAiISOgHNvb4Z5jXZpdYWSk311g5qAgFB4mnN1cGJ7mG+VhI17hm5nfHlyjWF9hJmJe3x5s4pThnN3kEJ1dIaRd5d2daZsjNWUcHuHeXd7a4dpepJxXFtchbxocI+QcI+Fnn19iYx1f3xvd4N5l4duc4Z/cUuqqnyFh3OVNoZydImUdFt8XYeEf3hif4e+f5c2lm50dXWHjoZ0eYF8TiaUKVY2eX6Ef3l7H3yEe2CBkZKdap9sfHuTgIVWXnuPfXuMfIuWh2oSf4FbTIZWeG5wb3F0fWt0VHtvgXaNd4taiJmKkoN5bp6PZ2BjRX95eH9helN7U317dgeMgnuKfzl9W3aBgol6YX+JbXtub3CKoIhneIGWgoFCf4hlgndqgJOCiIGOfIp6X4V0dY9Ug2OTiHOFdoyMUaR5e5UybHSHi3qZZ26Rg4vcnmp5eHZxcTt+b4KLcFNyUYW5cH51i1t+foKEiXaMe02QcHWCdpOdfneGgXUyuYt+d3Bth1R8lHOFkk9qimBmg3QiXm+GxXuVKZBkd2dxg4l9dIuSenVTtSxUJ2hziIN0fTg8g4Rnh5GYnHWcVIJ6koZ5HBSVYIV4Wnp0k4dlO3+NaWeGVWdZfW12dIFxcox2cHV+inaGYIaWhIt+d4l/kmd2fFB/jICGYng/cmKLe4NUi32EfXdxgUdbhVuRlkB3dGt2b3puio2DbnqBo4mOS3yNbkd4W4CcjnRxiIF+d2R/c26LWnlmkYyCjW5hhEZ5bXeWK2R4hHqBl3Nab4OI15Vtd2NmcSyJeXxxhHNDT2eGzXp1h4BHp4N6jZB/i35Qh291g2yGqER8foF0etSjdopgeXxhiDp0i480doZicoFrb1J4gst3jVxja21odoJ7dn2YlHZZiagpXglwfIqJan0WcoSFboCMjZSCbz1/fZB+h0lcjHeDfkxvaYt9YCCBiztVhFtmC3CCfnKKdn9sfmU+foJzeGSLj1qAgnuEsYphcGxMgoh9fn1+T3RIhn2JSpZ7h4Vzc39uUYRejJJFf4FziYV1apCfg3h/haKIi1Buf3kyd1p2rHNzcYKAgXgoiHNzhjqDVnuNgYRxZYkjbHB8lRsqb4qIiZJsb5SXed6Xa3d6aXNdfn+XbnV0NF1JhuJ5dZJdcqB5d4SSnY2TVY95foJ/gKVWeniEgnjUo36DWWx8hYd5e3eWR2mEb2Z7az1iRGWueaRKTVdzYYF4gnB6g5x8i4qeGHEwdi+Ke219PFmDSFOChaB+e3F7hoJ/eXFwgpR8gIlZc2qVglZbcI5QSYpdVXNvepJmgVp8VoZ1RHqDc4WghIE2d4Z4l5WAdIKVZ4aMhIJjfjBoWZSKgG6Cf4GNeGqFe2CAXouHUnx7bHuFY2agi359doSViJZJdpl8SHlpaKN+goRAf5JpVIB/cAVHh2mPjICIZjeHR3B2d5gaaYCHjIaBU1RsgHnOpXBtjGtzY3OPnYJ1ekxpUoPMeHiFYoJ3f4F6koKKgWmMfnN+f3iYVIZ7fIx8nYRqa1tmhIR9X3Z7mU6gg3VQf24haXJesXKxYZtShn99Yp6KT22GmhohlThfL3FxfomCjC+Ohm12fXiadYmFfHuUDXN5hVpwol6IcY9Clko7Rl1ILJ+ccZ+Hbmh5eokbf1ZLa39/KnqNhmGKOHhHn1wAgHN+YIuRd2ptoVsAbId2fnl7bHV5pIdZXJKLfZVyfwCDcACHlHpUl5lne1xrsD98V11yhz5xWIeXOYaLjXCOTTOQlkCBP4l/Un6GinQIaWStRoSSQH+Kg4pgigBqa5CCynBBdohYdX9VjXORW3FSepd/04BdZR2BioSGmG5pcCkdoIxwgniTdkN2eoCCXzabf3mnb3YmfoeAbJCceJ6KqoaagnRUYnxjYWZliZOKhH+Do1F+iIc9S8cfkyd5dmdeeoYxhn1acX2EOY6NhqVgiXR1eH8GkaRwkHyDb5Ryij9jQldHoluSJEBwiGxsOGw4R3V/h3NciHmEhVGAeHKJb5VyYFhWjGhZcpgySHV1fXdOF213UISHZGEcloKTdT5YeJJwjIGEacOVgX1xcZwthBNrmn6Pa1+Xo4mRi4dzmVp+dXV1iV6DeHOIjHd0pH5Gtll8jiyAiJGJUH11UHh8jdNzV3GBk3eDYKOAhotoSINWhMmAH4CWiXKJt6FggoAAepd9Z4J+pHxia4+GhXiwl518nG6KSp12eHGUf3R4Ypx8g3RzcHaTfX07ZX6YiXWAhp1Uf4mFV2DEAxoVbYWQe32BS4SDdGd+h4iWgqGIc4R1b4OKWoKgbo16jn2fgG41Z19eYKduDHdccoWAfDNwP1t3gXl4ZJFdg5Fgi3dyhG2Ic1FpNYdqcHF0ajdtZIR7cjF4fWmZjFRsg4qBgHtZdzmPcHWGcXy9hoN1coGzT20eZqV8YTZ0iaiSmIaJc41xa3qCfZRdf3hjiIBwepyOQqlRfpQkgX+Jj1iCWEaLlo3Ui254gYdvgFeLWYeBczuFc4TdbmCDh3iVgKCIY42IQYOZfG2BgKN8W3uJgnVLio+ihpVqi0KSRnl9jHJmcXKVfJ+FXlCFpH+OJlyFkHp7gYOcXXGWhmBEog5GKnt9g3F8gyx/eoBegI6Wm2mVk4SAgo2JZl1kjm+HlH+HlIJjVoWBWWuccA5tYmiQe31ccjlrfYd3d3yNd4OWc4qIcH2PkXFaaS+Fa2yASG9QYFd/fXhzfHxzj4B7gS6TgX97aFp1mXKDe3tuyI2BfHCBk39/OXOga4dyU5Oei4+Cj4CJZjR8dk+aTXhtfYR+iWmsjCiaZHaNKYF8gpRxi3luoWqG1ZFxeoZ+Z3dahnaCl3RGcSyIuTF4i4t3aYChhWOShmmDioBpgHCWh291gX9+X5CZgISEbIxMmnN1hYdeT31dgHuDfHB/kIJzmS2WgHF4en+FfFp5nn9EmpATRyh2d4d4eoEAfIp+YYSRopuGlHKCfomRf1cwZoB+iH19ipV+biF0kWp0mFAJYGRkhmuAbWY8XWcPboRxjm+Dkl2Lc3R7e45vbHJEhJB9e1h1T4F4gXx7EYV5gY57d4BpeX9vhX1dhYdneHCGbs6egW9eg5mMfiN7pjB8eHWMpIyKfpJ5gm1xgHp1kEt8bo2KfYB+oIoja3t8jyhzc3+HfJZ4c4t/idCebXR1f25xNYFqf4lyTXxNiMFvcoSKdJ1/i451colpZHp1cYJrk46Gd4N7Z1afkIKdcXt/UZt+fH+FcV2CYHeCiohghoKGfJgAfj54YXd+gIF1iol9e5N8EEItPW2LeXaFQYOGhFWBjJyQXGldiX2Uh4pMLXBzgohkfX2jgWE8doRnX5Fbc1VfY4JviEFvVX1pdnmQdohwhpOAhYxueqmNbV9ZU4eLjIBKgDmEWmaBe1qUgoWMe3V/PWuEa39/VHiFdZR7coS3l4Nzcn6VjYtMcZNthHxXjpqIfleQfX1uLIR+SodHhUBAi4mQYW6JIJV3epMkT3KCjX6dbW6GmoTSnnJ6e3Z2UoR0hGV8c1VoVojPe2qIdW+AdoWCfXaJg0qYd3aCXpWXb4t+gIpwg5xvjGB8dkKki356hl94llhsfIKMdklipnyQKU1UglVqfoZ7YJ2eboGOrBlTH29QdHVIigKOgIRzf4qhhoB9QIKCkniNdWZrZo2BU2uQjYM7UHuPXHSLdx46WHOIfH5HckZlaV5of3mHe4yNU394ZHqKj21zOT6Jh4h/eX9NeFxxfnZ3kW2Hb3F3flpifUqImGN/fW2LentwoqOAfWaFlpCCI3qRgTR/ZHyrdXdci32BfV6Kelk3bIFMk46HjWQfghxdg3mQHF54houFhj1na3lz05dZdXdCeUVugmleZ29BemyFxXpxpESRZH9ti5B2iYVLmnBwg3iIp3SVhIONYbSCc39kfX1jj3yDbY95cIRvYnhkG21EeY90mkqHa49rfXRYd0VFgoiuh4AJZDZ3QKOJaIhKVYKMdoJ/kh2WVlp5h3pPf3UxgGuSjCFlcZSARip2ZFRih1OGl1Y8aWx1TGVmoodigI9lib6JbWNrAGttg1Z0dX9fi4t+eQBxJGs6kIODJ4KBgZeKbYCJiYdcbm5fhnVcfYl1Z5WFjneDhHuYiFBsioSNeHRroYqDW4CBeYBQe2ByAG6NW5CQiIp4a3kwwHxxkh59YIhahXsuXKSNX8GnUm6EYIFnbJSUV2R/WlRKgLd9apA7pmd/ZEmQYoCSYV5jc3yJfYtjfXx3moB5Y2FSboVca4pjgHiLVGGObU2JiSxsgYOhjKVnf39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f394hIBvnACpen+Gf4dKgJVNjmZ3ho6IcoSrhnqgAHpneGCTj5p0g3RslIGEVYR+hLB+eaCDQkSIh6DTlYEXk4+LY3WJtm52dZx9e4BqM3ode8SBjJZcl2J5fYmWg4uLWpdsgnyHek14nX+Gd4WDjJ16ineaa26me4V6iIfhf+18kYiBfn+Gi5t/eHiLb3SIfJeGiHc6bouLf3d0en2ImGpoaHmFslBrZoVYcXltcKeLSoJynoSNkoyIfXSAf45htYNqfN99lI9+kfx0eIeOfZCNXJN6XwCjhlCF9oiDmoyAiX9+f3xZqZqIanZscH6BlX+MhIl0eYmMzX2Gj5qxbaOVk39/XoNei32FfoqEv3EjQI5QeJyblXWHk4WAjzhya6BdiXqCf31yf4l1e2mJlneogIadSkNPgYqdhZevin2Qd4WNlWaVg3qFe3GCdEt2iXyNfHeBtZIIbnh9hSBlkW4peE5ujH0AfZ+CbY9hTIKUdnt+c2ONtnyBnqyH7oHxjZN/hX8AJWufhn93g3Kqk3KakIh1MYN5jouSd2F+faNtW3CEdGt0dIiAVVWBbZQ9kmWBp35m/pWThoSJh32BW4iSY3zRdpmHjI7+dXiHfY1on0q5d38GY4NahnqGgJ+FrIWEf3SEW5ODjVJ7l3+Mm5SPjoSKPnSqcLuEe3+Sf2qZiX54hUiOY5CHi4qId7tg/iOGYHOTeIdylpOGgqBibHmIZ5l3ioGDcn+Oh3kUf3OHmI52k3rDcoOIhJuQIoaRlIp5dpyAfYaDlnN/f4NHlndw/neKjl2TaoBxhIwgkIZUcWxMhYV2A3mteIB2eoebiYGTe5lqbJWXjHOfhWiH4JWLfoaCjWaLgoaOcYBzwoK7qZF/bFmXk410WXpchYeZhV51g3C9WIKFfVNff5BylIhiepKHRNCNiY6FgoiEhmaTGmF6uZOPenCK+nR+gHRud5BUF4FQDIOPVIWBiX2ih4yIgYR6iFeKmo1eindviJGRjYyJf2N5k3OpeH5ynop+poeBh4t1i3aHgmR+g4dseSUflGN0jpOLcouZf4R3fm93ok+DV2uPhnCLeIx1dZdxdaB9lax6JmJ2ioKso2+VqY+BgXN6j2OEeI58yY2MOZd8GZxvc4uAkht+i4p/JniHaFVwa3eGdh95pHh5gYZ/l4V3g326a5mcioeIi4SCffGvjnSEf1lzaoRxl22Gcs2Ryp2EfWNERZSIe2x/ZYmDupFLdn90HnmHwYNQaI55e4KHVn+jfDPfiJCCiHSJjo5pdJVtecd6i3uMhPt2eHpnbqR/aHRubxaJm1F/iI5/kIm3f4Z3c4ZFmmaGa4SFgn+Nk4ifkIZIgoJneHt0iIo8AKWEXXiDaopyd5CCeJSHIoZ1C4B+cYl/gmyOknOGnIFncJhXiVxwh3xmV4WGcoyJal6khW+egrZrcI+GmamMoJKJfnmJh3eRmHuIdXeBdCd9jhOIdIiGoK1neoyUiCOIhGk2apB/g3wAc6Z5e3h0h5iKhnx11G1tcaiAiIaChontoYt/i418bZaRi5VxfW+QjbCMjGJoiXSFhn9RiFp0g8N1WH14dXFikqx/Rm6JfV2MnHyKaYxB2X2Ck4SRfm+SZppwan+3fo2JaYribHpZcWmodm9ihDYOiYtJf3OFl4KMf3eKiX6BNHGUel6EkoefgI+KtIuIZn+MbHR+eHiKWnCgj4F7i24aaZWMf3mdhiuthgp6jYCGgo54kI2WioOHdHaHaYN5cJSAaHSFcoQAf3rFf35/f3+KinacipWagYWCjnJ+c4F+hoSTgpOAf386g4IWs3N/gMNwAHCSlI0kipRojm+Qco19AnmtbHaKeHqBmoCRdztutnefg45+gXJ7yK6FcHyCOnSIm4aKcm1ymaCbgHF2cZmIjIh+ioxskn3UcFp0fYEMfou2e0JrfmyFiit9f394Z7BefqWHh1KMkmKTgXR2yneHi4CQ7W56XV1ol4SDcIOnC1+IXYB+iZOchrB8ln52gF9ognp0bX2DmnyNgripiFqBjFWEa4l7h4Z5tGaIdIN4AFeBh4B9hIJydkMnlIl5ZXpsf6GbxIChpWtii3KKTR6JhHpxgox22IRsTJN/f7SDppdwlo5YoYSBj4hveHmFfIh7iZJhhV59Z7aPgLB/bX06mmBxko+Nc4iBYmlzmHSMeQVxon54enyAg5V/k32EbIJfkpZ9i4R7he6ShHuPjXZ3h+qGgHWZdbaCjJF8b3OYUIiCfZpmaBR84HZZb4GEoVV5oY9CYYWFfYfAgXt3gouUQIOAgXp8kYhYqYOBcNOndW1zi+l1e39sXId5iFKIQgqLiGZ/c4qopHsAE4eCdYNqlJyEd3+ff4yLiZGjh39XeXNke22VcYKehYmkjnuUeIw6j492fXyDu14zHIyIccxtkXl5cmeRkax5YIZriV54k4aIgIODfYaEZ4Oke46JfTyKgYeEdWx1EouKhHSBjX6UlYhshoiMikqHi4ajhnN+aHkHY3V3lX59i2Zfbo16ln0afqJ3e4eDfX+Jb5p1i2iWU3h+jZqEfY3xqoNzkHyJcGtof5lzfHVlhZGamnV3kXyOmn+DgJCJfMpnYmZ7kEl8dqgMT2ZneI6RAIaAm32A4Ex/jXqEfH2KZ4mAT07Y9VyddZbJdH6BaF+Vg3drhIAHYnBahXW4jqyAMMadh3uGXXhsgn9+e3yTc4iFnYJyg4yGd3B9iGp8dIERj3+BfnuKP42Bf4eDh7R+kWuMboCBfX+BjKeFfotoeEaCcoOBg3qCfICGgIV1hoR8iX9/kJKTbYKFj7WBeouBj4KCh4KsfnRqfH97hHZYfwhz2Xp/f2mGb3CLhZuGh4FWf3+BfYGCSHuBg3yBgpKJcXN9dI91fZOBeaB8hF6B2HZ9f4V9MnSDhH98gX+CgIZ3kH6CeWZzgYl7intwfX6Te2prg4SJVX+If1xyiXyNo3gHgoOOksiEg35xin9+gmaQinR9w4GEg3iOqIF/g4ptkKdjOhyCBIOLeoS8goKAiGqCfH+AgEOKeYJueIB6f5WRfYSGhXV/iYmoeH6LkI9/lISVe3ttj12Qg4KJhY6geF1kh2yBkIWKgoaliH+TeHBnjXKAhJmIf3qDjHmJYIx2fnqBfpZg0YeGjphUh4KQmpeAeIqOeXh5yEx/d4OJWnqOfN95iIuPf2VriIqZGYCJa2R/ZX2Cgjt9jYR6hVCQjQCAf3+Ra4mkhIeZg4dufdCRh4aDgnFvdZaHf4J8fn6HiIiKfXk7gIuMgnB7ZXeGlnRWboF6bV9/b39bW5Fze9h7AoKQhpKJg4GAdJGEf4BimJx1fdGAgn+BiruBeYiFWo0Aav5QZQJrh3iCfYOHg4iOgYB/f4NIjICFYYJ9gH2IloWEgoNbgoZ+m356g5aPepKain98WJBpg4N/iH6FkHSoZYFqgYuAjYKJqX2Dj29rVppuinJsgoWAeYd9gjWUiH92goGcg8ZvgY6P8opokpWXh3CIooiid2WTfZiAW1KJe2mreYaMaYlkd4uHlx5/hkaIf2l9goM9fpx7coOBeZZ0dIeCi3N6n4GInHCFTX7joo2ChoFbe6CGgIt/f3+JlMGSjH9vRJKCiHtkfGp+h5F8X22EftRXhbB/WGaOe4qVg0KAmnyDrYN/eXp/hXuCc4oAbIDVfoJ/fYbBfHyHem+niGBdNyMHboh9g4SHg5KHfn+BgYKLNLZ+i2eGf3eHhpSIjIyFZH+GeYZ+gY6LfImOgoWHgXaPcH5/cYSEiXNvell9dYCDdICBi5p5gINubjh+YYVzgn6HghSHh3tjgnB6gnl5hHz+g36SgTiPe5GNk3+EhIx/dHp9lny2h4RDhIFnuX58jaeqcHKHiZcffIVpeoFxg4eBMnqbgYR/g4QAiIKDf5NukI6FhIyFhYaF5ZKIdoGER34iiXuRf35/iIX+kIh6cEhjgoV7MYFpmH+kfldyf3IhYoOfgFVnkYNvgYpOe5CBecJ/e354r4SHhnePnXd8w35/iX6BuH9/fnd0gn9efjeVCIGAdYCBiYaLiqh1h4x7gi6af4VyhYt5hJCVfaFdiVaBgX+EgoR5gFqJmZFxioF1q3KEiYR7hoM4TF1KhYqAeYOTgJF/XYh/emdbhWKAb2iCiYNyf3t/mpB9oHuJeJqApH9/jYTOqIiTb4+Ed4KFiox/hId9hISCQImGXZWEi4h+pmV0jYqXXnuLS2eCknyIfjV5p3t6f4F+kXd9g3+Zc3STAIKUXYWFiOmUhZOIhHF7pZV+hH1/f5eJu4SCem6EfIWCf2yIdWiBv4NgdH2GlGaCw4NMaJF5kYeieYWFe2/Zf3aFeYZ/bYxyg4BwfMJ+gIqEhql+gitvfLaCeXiGLxKBiGSDf4N9ioV7fX+Jd4IUnJeDcIx/epmGlYzDj4NfgoZ9eX9sgYN/UYiMgnKCfZVsf4V+hI6GUGVqWIWWfoB/iIGXkXZ9jo5vXHFugnh7fouEfIJ/gjt7e81ufnvnfpKJVZKDWJqEi4OMg3N+iYKph4iHoIV9gxKHgW3CfnqEnrxqZo6PllWJhXN7gZV8boo2haF6fYSAg4yBfIV9gW6udIONjnmEhYvNlYZ7jYcWfXs+hIR+g4KEgZt8VH50lH6Kgnt6i3eXfMVdWXWBfWRkf5WQTmiSg3WGI312boWGf2V1i3ePa42Oc4GPcnfMgIiLN4rFfoOAeH6TfHtvf5IfioR2hH+CX6CFkHiKmHx5LLR6hISKmoCSipN3w5OIYn6Cf393eIWHWHuZd4eFg3ScbIuPcoeJiHgmXGCNlX5ufo+DlaZdi5CYa2p9fHxrdIKHiX2AeXylhH2aJYGHTICBiH2SgpSiiIuKkXiKhIKIa3t3jFN/eH5DiYZ0jXZ4g2GSYm6ahJBthIdQZoObgIuDAXmWgXiBgH6Ki3uXf39zhlyEiZKGh4yF1qmEgY2Qf3185YOEgICBfoaEl15JeJtwh3x/hG2OFIPMcltzf4RkW3+XkU9hk4KYgdiEe3aCh3RHgWtxg4GCiHJ7kntzzHucUmmCvH+CjHF+oYKCYIpJFX2Lc4V/io/HflMNAIl1gSWA/oaDiYR7jIaWi7GVhGeHgHd7a2Z1kHJ+Y518foR8hEh+jXuEfYWoYVRvgJCCp3GHgY+gdY+FkXJSf3F/cXWHiX98goiBgoB6hmt+hMR9kYB9lH52e4KQeY2QdHuGgZyKeoGYhHyEQIKJfax5goBei2Jejk6TgoGBa5SCkX+DhS+GoXyAf398i4Bujn+Jaol0f4GLh4SIgeGVhYChgV55gil+hn+Qg3yEiXeWiXiTg4OBgYd0hZ6Ew3Zeb4F/l2F/fQBbZo1/ioQRjoF7go+Pa35vcIGAfoh1hodXZsVwj5KGh7OCfoVxaIWBe5GIhgd8f32GfsF5r4Qs16WFfYA3iGmDg3+OgDCAkICehoBzhISGg3V8d4J/ewN0gn9/fYQ/iYKBhX+DnHtugI91hH51f4OQm39/gnV2KYB6hYOZgIF+hIl8h3CFe35whISNlYd3f42En4B+g3uHg4uBiYZ0e3cfgH+FfmJ7AHu3eYFwjntsbYCBmYZ9hXOKgY2BgIJGfXyDf36HhYKGdH9qh3aBk399g5KFgIPOmmiGg38TgX+HhYKEf4N8hHuBgIR/anqDh3GCfXN3g4B7cm+Bg2Vwgp99WnSHeoeSfwiBfYeTvn95fmyBg36BZIaHfYK+f3+CeomIgoODjIWLjGBTIYFrg4KFg3SAf4GCbn99f3yCSlV6g3CBfYCAj5CAfn6DboGYh6p6f4iFl3yIf4aAe2yGX4eEgIN/ia5/kYSCc4V/fICEjKuBfoh9dmGDfol/YXyCeoCBeoV4jGh/boaFjG6Af4KMhnOBeo55joSKioR8gX7Rq3+BgkBqfoJ8lXqEjZCKb2uBgZsahYBcfIF6g3+GQYCBg4F9RgCE6X5+gIV0gY9+fpaKiG+DyJ2IhoN+iXR8hYF9g36BhZCChYOAfGB+hIiGhH1ndYKBfWpsg4mYa4KQf1VnhoeTzXoAgo6Fnat7dYFxh4KBf1qFlH+CxYB/gX6KhYKCiYRzinlvpkR9Z4WFg4N9gH9+gX+Af4J+g0p+gIdihX2Be4OTf36FhWiDXYKVdoF/gIKDiYF/hH5OgWiFgYGGf3OuebuGgnKDfnmDhIqvfX+Me3FTkXWIdY6ChXxti4GEVYZ6fnJ+f4ePsm+EjoSTgYWQnIyEqoXKhIGAaQB/ln+QYoR+c8R5fopzhm10hICYGnKDcY2Ae4SBfzl5hYJ7e4F9hIGAgYaCc4KYf4d+j4lxhdKqhoSDgHWCg4aHhYOAgIiYpoeGfnddeH+GgUR9bG6EfIFsboN6VnKJjn9TZ4yFhYZ5JYSSVJ5xf3x+cx6EfX1zkA97gsV/fYB/iJ2BfomBeYqFaGcwZmluf4aCg4CCgYB4gX+DgIRFiX+GZoWAfIGJkn+EOIV3fYSFfXx/d5Rrg4SNfoGBcopxgYZvgYGHjXh/gn6BhXuDhoSKun5+CntyOFhug3h2f4V8LYJ7gpiGfniAgHWHfGdui4tZiJd9k4WNgoFhi4V+f32IgIKAOVKNfmujen+JjopyboOAmh18gVqEhIZ7hIJBe4h/e3uGfxR6fIOCfXGFnI+BgYiGd3/gfYi6f4J7gRyDhHiBfoKgkemzhIB6dHeBhH+EgG6AhoV+bG2BhG1yh6N+TWWIh4qGf1CEg3qfYnp0h3Kig4uCeZWNfIHPfXt/foiggXp7enx/f2+INX9piH91g3+Cf4OAeH5/gnyFP5l7gnCJf39/gZOEhHyEdIGDf4p3doeGZ4OCgnSXhX1UcoOHeoGAgpJzjIR4i4CBjwCCin9wg4iEckqDa4JzfoCLg2yCiX9wfHuGkX19hX+QbyKPfoHDepOLi4R9hICBh3pziIGGgHpQn3tqkXZ+hJqJc2yCg5kgeX91Z4KLgDiJQXyNfYGAhH+CfoKKgX5wg5Frf3eOhoCB452BjoB/coOIhXeAgYOCeIaldn11fn98gX58SoR3Q4OOeW1vfYd8d4Brg0Vqhn+Df494gYZ8mnt/d4pxM390hnyHh35/0X19gXqJpoF/PHV/gH9+ZYJ1a35+gYN/gGiIgG6GgYiEgzd/jYR9ioaBiYWTebWEhXR9hYJ6eneGf2GLf4GFY4iDkmqCh4J+cX6AWZmCfpJ/RpWIgIx+eYSDiHJWb3qDfXqBjIOEgX1+R4p+i26DgYyAimp+joR5zHaSkYuDfYR+f2KHd4Weenx+R4p8cpt9e4KbnW1hiImXHoODZ3iEjYKChD+DmICBgYF+gYB6k4F+bYyGiH+Ag4aBfeCPhIWJAG6Cf4CNioFOg3+HhoNGZX+McoJ9foWEh5KEl31tb3+BcW6HkIFTYo18k4AJfYSCfKB7c3ONdIhWmIZ7d4Z6f8+DfYJzhqKCf4F7f4GAeYKHbmtggXGFfYCUqYJfg3+CfoMso5uJha18fJiElZizfoB+hn6AiH14g35lYoSIfZCDf3NpgomAe4KCk3pqgn2NgbaLiHuOjn4AgopyZ4B/gHl3g4uCgoCFenF+foJFf4J2f5NrAI+Be6F/k4iMr3WAgoGQgHeESX+CfT+Af3tveYKDe4ltbISClx5/hXRrhJWCgYMzfYV/foKCgIN/faCCgmyec4uBgoaFg4PWkoaCjYFognyDioiCh4N8gX18QG9/kXqCe3+JbosVhJhxbGuChnd1hYSDV2CLc4Z+v4SAfIWYdmh/bXGGf3yGeomCcnnOgYFChISRgX+DenqMgHlnjXVshYR9hX94Y+mIZi+AiH6ALpPjiomGiXmPg5J5mX+DeIGCg4WBf4WGa3s5i4B8h4KFWoqMgXeAf6dlc3+BiIJahIJ/joh/j4OKdj1/eoR3goWMhYGCgn6mg391V4F/f3+IcYGIf3p7hImJipF5goCCgoR8iJd/fn9YfYF3iXl/hV2YdViMDZd/f4NohoaRgoGGOYaEfYF/g36CgHiIgoFrgHR/foOIg4WF24+Eg4KLjX98doOCgYWDfIB/f40PfpGBgn6BhH+CnoWhgmpvf4ODbn+KRFtti3uaf2+Ign+Dl4Z7e3lvgIF/hH6DhRtlwneDiH+EkYOAg3Z5fn1/dYx3Z2yHg4Z9r4bGhFK8ioF9hDSPjoeKhX19Nn+OhpiBeXaEhYiFeX2Agoh5AICDgX57gU6MgYSEgYOWd1KFknWDgXx/hZSWf36CengjgHyAhmmJfHyGhnWGoIppfniEg4aViHqEiICDfnyGhYaDmYN8G3Z8sn6AfYV6anoCfKB6f4qdj3dugH+Xh3+McXmCioB+hEaAeIN/f4SQgZd5fUyDd4SJf358fYV/gsiPYIaDfzB3foaCgYN+gnyHfYJ9gn93jISHbYZ9cHSAf4B2b4OFc2uFg35YboB+knt7HoKJg5GSf3eAboCCf3tNioaFgrt+foB7hYiDg4WOh4SCZ3YrhmuGhYqAeH9/fIJwf3x/gYNUiHmEaoF+h4CGjoB+f4Vyg3+KdXl/iACSfoR+gIN5aYVgiYKEg4FgiXhvjH94hH14f4WNnoB+fX11Unt/g3KDgYN7f398h3R/NXyAj3+BGn5+gY5+f3+Ei5CKhJuFl4V0eoSTf36BeHR5e32HeoCGkIptZ4J/mSGLhXB+eoWFgIJGgH2Egn9EcoF8fH+CgnWGh39/g4GHeoTOkXiEgoCTcHqEg3+Df4KElIF9hX99b4KAh4GFfHdyg3iBcGt/gaZwhIN8VGWGg4+KfCqBf3qmcXt2gG6GhIF5PYeKhoLCfn1/fIqAgn2Fgm+QdGZ3RnhuhYWHf31/gXiBdH97f4SBToF7hl6CgoZ+gZF8fEiDdYNRhP52f1SLfn59fX+Gf01/aYF/goCCh5V7oYp/doJ5eXuDjq5/fJh9dkAedYdxZ4CGfmYAgYh+h3h7b3mCf42Wc4aMhHmFf4uAhoOPAIiFgHqVcIJ9gHZxfH12i3h/h3KBcHKCgZkdgYRrf4OAeoB/NH9/gXxzg4OEh3WAiXx3ho58hHuMiX2A0JCILoKAn4Olf4N7g4F+fa6Mn4N/aHN7iYeBfX1wboJzh3FojLRmcIR/flBuh4ONen4+fZV8rnt/c4VweIJ7fWSULoKBw358f3qJgIN9hn98i4BceDR+bX+DhoCAfn55f2x+fX+Bgkqae4Vehn2Df1+SfH98gnqEe4JsdXiZjGV/g3uFf4NpgnWGhv6CgG6Ie3+JdX+EfYGZg4+zgH5cgXMla2yAZnyAhXtqeYOGeXeDdId9cHt3dW+Ai32AlYCQfYeEiY6UgXR+doiDeH52Zot+dn12eYWJe21pfoCWIHh9bm6EiF8AhUJ7eX15eYV4J3pxgoR8dHuWf393gYl8gdmXg5V9fImCG4FXXoJ9gpycsXmEfX57d3KFgIJ+cXt/a39wa3qFoHWBhX9FZol7jn+HZnh6J6+WfHWIb4aCjoJ8lH+DgcN8enxzh4t+eHZ9fW94bXk/eHB9foSBf35+fYBsfnyAgYRKdHiJbIN8gn+Ck4GAhYF9dX+CeHJ7Tn9QfXt+apaGf3J2foeCg3aDk3iCiHmHgnaUaIOQgnl8koJyPABngHp/fYuAbYGEgH+EfoGNfX+Ag39dgIwsdbV9kYaGgno2gYNLfn5/f3Z6c2apfXV/dXmDiYdzZYSAlSGEfmxnhIh2fYNAe396f3uEgIB4eYqDe3CMmnGBd4mIfHnlg4Yle4WShJl6l3p7MINxi5STdXqBf3+Cf4CAfXlIhWx9cmiChm9yiJKARGSGf4p/jnlhf3yujX50gmt9fySFf4yDhIHRgHp/e4WRgn1Cfn2Tfn56hXRud3+Dg39/e4SBYIB5Dn6CQaF0gn02dn+GipNxknuBfGuEf3+Ae4p+XXZ7doUphIOEb4KFgn5fg5djd4p8int3lpCAj3p5fXuCck52eoCDfYCMf3x+hn1fdH50kHt/g4CAcXyKgHG/e46EhUR4hX2DcX96hZZ0eHpdlnt3hnl6g5aIa1h/gZEgeYFvdYOIhoSGQYGGfX5+gn1+eneFgX5pgYx+fXuBh3594ZKCgYJ1k4F9fTiGgnyChIKDdU54g4d2f3t/hH6Ik31ofnFrf4CGc4OEfEtliHSMfC9+fYR/ro99c4Juf0eJhH5/g3+CzoB7f26DioKCfX2AeXyCZot2b31+fod9f32ahFqAfX1/gjR8hY2KlIR/joCS45R9hYR9hoGIh3mBf2J7hIB+jYeBdmuFiYB1e4GWeH+Jg4eDUpV7d5F/fnaAh3VggH6EeX+CjYGEfYh6ZIJ/fTN/gneAiGR+joR1m32MpImefIR/gYmFeocAe4Z8YX58fJJ6lIZwg3FpdoCXJn6FdFODiYN8gEWBen2BhIJ/fXuDs4R/bZ2ef32AgIaDguWHhogGiG+CfoKFh4GBgnd/fX9WdIOQf4N6gIRxijmDc3NwaH+FenGFn31SZIh0kXuzhHyBgZ6NfX1zcoF8eYZ8gX9sbtGCfkKAgX+Cf4R5f4V9f3qQgGxjhX6HfXt7xYVbWnp/hoIyrYyJkD97fo2Fk3CKfXyHgoSEiol+hoB2bV92gHeIgoBif4eCc4OAjXx8hoODgoGIfoCUg4OEgYV4Kn5+hn2Kg4yCgYCGfJGCgXpxgoKBgINsf4p8dYCCi4uHHnR/gIKDgXqHlH9/fWJ6f32Ye4GFaIhtWX4XlYB7gHBrhImDfYVAjX18g4CDf4B+fICEhm59g31+g3uDgYXelIWBmX6NhH9/gIWCgIR9f3l9jnyDj4WBfoKEfYWegHx/bG2BgolzgJddW2iDdpF+eoeBgoOPloB5fHCAgICFgYeDSYrDfoGDfX+CgoGCfHuGfYZsioBrY4uAhn6bg7SEVpeAfX6BN42Oh42ChX91f46Fi3xjhIKFioKDfoOAj3sbfICCfX+AV4d/g4KCgZB4WoqXdYKAe3+Dl5F/f399eD5/fX+BiZZ+foV/d4ighml8h5WDg5WJhIGOfoh/gIh+g4KTgX9ldXiChYJ+hHxrc1B/gHuAgph9cXSFgZWHi5BygYSIgH6GTYF9hIR/hYR/gn5/CoR1hYl/fXeTg4GCwJUBgoB/S22AgoGGgn6EfIJ/f4GCfXePhIYxhnx5fYJ/gXVyhoWGcoWifVxtf4KGgH9ShIOBf5B+eIRvgYKAdUt8joaCsX5+gH2Fh4GChY6Ff4FhgWqFcoSCh36Af399hXB9fICCgVmKe4Nng4CMf4KMf357hnGCWIqjeX+Bbo9+hH6Cg3Rff2CCdYR+gHyDdHOKfnaBfXV8goyNf31+gXBXeX1/d1GEgXyCjXyJMYZueneef4MEeJSAjXp3gIKLi4CDhoJ7poB4coGAd4B7dHl5f3h5f290gHBphX6YPHqIc3NzhYF8hEl+fIF+dy10fYBzfml/eIOAfHx/g4d+gcp3bIGAf7NnfH+ChIF9goSuf3+EgnB2cXyHiYR6fHGBeoNwa3sTcm2DgX1TY4WDlXl/TISDgY2KenWBaX6BgG9PhH2Ig7t9e394iIGCgYOGeH91AHVibm2Bg4h8f31+en9wf3qCg4JOcXeBWoJ/jICBkH18fYN9f1mCgXB4fJJ/f4J9fYd/ZH1siXIGgoB3mnidh3Z3gnx6e4OPmX99g4B6RmZ1f1d+goN8fXZ/iHl4f3qHh4F/jJV4f4x9fX96iHyAgYtveYV7fn98gnd8eG97gHpdeXqGhIJsboF/lzWpg2+IiI4yUX5Cf3yAdHSHgIGCcYCLf3mIj32Vd32Ien3OeXxzf3+VfoN+f3GEfXZ0s4mChn5BdXeaiISAfXlug3mBdWsAomB1f5h/SmGMf418gkt9g3mQkn9xhXB/gnx+YIRYhIK3fXx9e4V5hHaDg3qDf0aESY1yf3+NeoB9fXl/eIF8fIB+Sot2hlp+f4J/e5J+f4CBfn9wf4Z1fIx8TXx+dE1+f1yAcHd9i4GAe4tziIdxfYN7f3uDjZp7e2eBeEVSVX9xb32EdnJ/eop7gnt5jHujfXdzfH6OgYOLe4qNfX14f36EXn1sfYR1gXFmgX55aXV5hIV9cmmJfo81dHtua4WLkHiBRn54eyRzhHU5dnyAhXl2eoh9eXOGiXt+0JKDiXp6n4Fke3ZCgmiHjKyTcoJ8aXl7d4SEiHx2c35thXJqegCTc3+BfkBaiHiNfIdoZYd1kpB9b4RxfX+Vh3uBeoSCvn54fnODgnd8d396fntzelaMb3yBiIB/fnx9fXN/eomBfkaAeX1kf3qFgwiQd4J9gIMXfn16dXd3f0N3fX2Ml4OAenaHhSCEcICZd42Id4CGeH9thJGAdnV/f3VRXF2Ff3aAjHx6epOCeHKCdox0f4WBeXB+h3xrnXqKiH2CfWt7gnKEf39/dXt1a7x8eId1coNsfG1ni32RN357b3CCjgCAfER9e3x4fX99gXt1foJ9a52TbH51iIZ+buaTgWx6f4aChH59bXR3gm+Ei3p/eoSAeH+AgoJ6gloAZYd1aYR/j3J8kn5EX4t7jX2LemV0KIydfWl8bn5/AIV9j4GFgcmAen10g3aEhDh9fEp8fICDgHF/gomDfX94gIBsgHtngINDf2gAgnN/gISAkXWGe3yAjIZ+eoN8h4Azdn91TAWIin9xfYR+c0uBhW57h3yCdniIfIOPdXh+e4J2ZWV2f4KIgY5/gIB4eYOAgXiNgIB/g3trgI0YeJaAi4B6eHd/foGAf3qBm3VwdmGUfneOdnaAgXhzXHSBkCJ6f3RbgYWCfABDf3+ifH+Bfn16eZOBgGtrlX5+eY+KfIrpfYOBfHedgXqBdoGDe4F+gIB8cHaHinl9cX+Eeo2PgVWFcmh/gY1ugYt4S2GIeYl8aYFjgnmOj39vfW19WpmGfoOAgHvPgnyAcoN8gXx1fX2SfoJpjIZuc4CKiH5/eoiEX3x/jqWDNIh1fZCBeoGFh5OCh3l+kRSGgoOWeoB/V29/eH6VkoN/bYCGgW9xhJNufIl8gINwjntWkHN/eX2DdGB+f4GBgoGQfYZ/oHR3foJ1mn2AfYODeHyOf3eMf4mFgId5f39/fH9+hyd4intheX1+mXrCg2yHaWl1f5VLen90aoGGf3t9Rn9/d4CBf399e4KDgX5qh4t8fnuDiYEC64+Ef21/hYOAhnuEgn2AdoB8fHV5hpB/fnKBhG+MPINbf3Vpf4GCcn+Ze1RmiHOPfKGFgHqFjHJ/c2dugHp6h36HfGxizoF/H3+Bb4F/gX1+d3yCfZCIcHGPgIV/gX2bilp0d3l/gj2DeYSTdISAiIGTgoR8e4V+hoSFkH+CfW91e3N/dIqDgWSIh4GOhYKNfHKKf4CDfIZ9fpSCgoB/hHpHfn6GfIyDjISDgIB2kYKDe2WBgoSAgHF/hn95g4KNh4Z2dYKBgn+BgIOee5B+YHN/fZh7hoNYaXVed0OSg3x/cJmCioJ9hj6SgXqFg4GAf356oISDcn2Vfn5+hoaAj92FhoKBfYWEf39/iIB/gnqAfX+Of4SMgYB7gYN9iZiCbIBwb4GDjWyEkGddaIB9kn+BhoJ/gXqdg3V3cICAf4aBioBiaL5/goN8f32Cf4F8eox+h22CjWprkYOHf4aDmY9cgoF/eoE2kYKFioB/f3qAjYCGfQR+goiMg4R9gn+FcliFf4J9g4BVh3eChIGBjnhaiaB4gYB7foOWj39/gYF9NH58f4RjjnV+hn94iJ6MY32FhoOEmIqKgYp+gn9/jIKDgouCfn54fX6EgH2FfGp4WX18fX+JmIh0boKCk4aBlWeMfI2Bf4RFgH6Eg32DgICDgn8AgnODiH9/fH+Bf4G4f/6DgX9YYX+DgYaBf4J5hH2AgIJ1eI2DggCHfHR8gX+Db3V/gnhphIF/U2eBgY19f12DhIFkiIFxg3CBg39wUImLhYKrgH2BfIGGgoaFjYOBfz6BZYxoiYOJf4F/fn+Fcn59gIOBW399g2eCgImAf46AgICEcYNyjX97foFykHyHfH2DcWd/XYdmgX+Ae5F1dYhyeIB8dH2CkIaAf3+BdVZ/fH5nhpp9fYOBfYhjd2x8iQB/gQB+i3+OeYaAhoiGfYKIgHqAf3p2h4F6gHtyenmAfH1/c4d7aWeFgJVMi5FtfS6Mfn6ESn9/goSAdHV/hXt/RH94f4R9dnaIdX6Bwnhuf4B/rFl/fH+BgH2CfZeAf4aAXHSBa4SPgnt6eYV4hW1wjGhWboGKflJciH+LeH5Ug4d+c359cYRpf4J/a16CcYeEsn97fniIgYEAhIV4iXdzi2pvboF/iHWAf316gGeBe3+AgFKEe39eg4GSgX6SfoCAg3N/W4SEcnp4iHx+g4GChXJtf2R8W258gX6LeHuFgniAfn15gpB+f36HgXpEbHB9b12Cf3x/en+OZop7fH59PICPknmBjn2Cf36Kh3SAg3N2f3mAgn2CeH56b3p+fGJ8eoN/g3JphIGXPYKIbYF/jWx+g0l/gICCV4GCf4OOf4h7eX+DfuZ6iF94f82FfnV+fpJ7gH18fIB5SHmvgoKCfll2cKaIf4B8eGx/cYFwa3GYVWyBmX9MWYp1iYCAU399fnxsfHCCbX6BeoBmjHCFg7mAfX96iH+DhIOHfIJ+Y2xOfm6Ff4Z4gX99f39vgX19goVKhX5/XoF6hIJ8kX6Cf4F/fnmBg3B8ioBQe4F3fnt/aYFqgWiQgIJ+g3Z2fnl2g3t7foOOf397Z4F2T2JHe1aNfYJ1cXh7kGJweXaWd593fIF/f4l7iIB+h4N1f3uEeoKFfHyBhH2AdmmHfHeAdXmEe3dlaoSBjT57f2lxhJKAeH1KfXt+AHyAfDGBiYCEenZtg3txd31UeoLOh4mDe3yshWt8dkuEeYKMlo5thnxWfIVth4SKfHV1hnWKaG2IZF1se4h/QVSPeYF6iGp3fnN2fHpufW+BhI+KenVvhoC7gXmAcYR7PoR/f3eLfHB3R45qf3yOcoF/foF4e317fYN8ToGAhWR/goKAeZB6hHt7b2N/fnt0eniDO3eEkIiTg3pzcIF+cHdyfol5k4F6hHt7g2qBlXN8e4GHelNhZdaHf4SKgnx7iYF3h356n39JhoR+dX2IfnCRfIyBcHqAbnyAf5J6goh6gHxmv31/fnh+goWHeGiQf4o8hHhmf32McoCMSnWCYoODf3+AfYR8gnlqcYVygXd+Rn954IGLcX6BiISEf4J7OXqBfIeIg4V8hnt5f32AhHx9TXpviW9tf4Vcan+efUdghXuEf4h6Z3F4dXmCbXhvfnQghoJ/hIGCvoN6gHqGcoGBU399hn51fYKJbXmDj4aEgXd/X3Z8emmAhUqAgHF/c3eEhQCUeYN/goR8in93gXV/gztxhGl9AIuHgmyAgn1wOIOLeH6Fen5AfIR/bZR0eoB7gXZYe3J+lHx9jH6Cf4dsfnKDepB7gH6CfXeBjH6Bj4CMhGx3eHp8gn6Bf4CYdnp7ZZx/gHd7iYCEeW1bfYGWPX18bFh/inx9cUV4gpp/f39/fX14goJ/Z3eMfHt5kFyAgPCLgn5/dnOFgH1yhIJ5fnp/gX18eoiIf31ygYN7k4yKbYRvaoB9e26Cf3pRXIlwiH54fnh6GXGcf3B2a31yj4R+hICBecqDfIJ1f3N/gHODeWJ9hm2HeG5zh4iMgYB5jBVffH1/h4EwgnaVjn6Fgol8lHmGfIGHa4WCg5J7f39Udn6bfo6ZhX1mgIWBnXaCjXN/iXt/f3aIfSWRc394fIB3X36Aj3yEf4+AhYB/dnKGg3aSf39/hIJufouGgot+iXx1gHx9fYF+hYCEOnkAfF6BgIGhe76Cg6hxZ2Z8kkt+e3N1gImAeopId4FXf4OBgX19hoeCfmh9lH97fIpxgmrpg4OBdn+Ag3+FfIOAfH94gH9/enyGkXh9aoKDdJRFfl6Bbm2AhINsgI56WGWIeYZ+m4KBgYRyk4FuaGqAbXyFf4t/cG3Hgn8AfoJ0f32Bf3+0foN4iolrbJiGjYGDfJcAVnp3en6BQW54gZB3eoCBipWBhnx2gnmGhYOMfoB/f3B2eH51iYGAXYOCg4iHf4eDcYiAgIF5g3xrloKCf36AfTV9fYh8ioCDgoN/hnWHhIF6loGChYCDb3+Gf3WAgouBg3d1gH+EgIJ+hph8iH5bdn95knyPhGeAaV58KpOAfH9nn4GIg3yAOqF/fIOCgYB/fnmGhINvf4h/fH2CgoB22IeGgYJ+hYV+f32GgH2CeoJ7e42BgoiGf3uBhHuGln9shWJwgIKGbYSEbVhggnqGf4d/gXyAX4mIdHpzgYB/hoGHgWBWu4CBh3l4fIB/gnx9i32Fa3WRaHWNh4OAhIGTd1uKf318hUOIgIV+fod+dX6PgYx+/n9/hoyEf36BgIZ5W4d/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f4FwXW6AZpN/gYJ/enN8cU6BcYiOfYp/kKOSiJMwZhKIdY97f4qNdFOJY4KTiG17hpCPk3O6W4SCmWWg/n+TgYeLfJx/f4JvgHuRgXJbl3aCfIaFn2mDW0ecibKNfX9ShYBdhIF7W4WginyTeY2LgmOJhG1kdYh/g2mDkHaIcouFgod5goiGfH+Fg3uEiYFqkGt5g497hId/fYKbIYuRcm2OfYQ0XTOdb3B8m4RZfEJ+fZt8LrBvYm9jfpJ5iYKPgIp7ZXCChYB3unt/k1aKpMloNSN2aF2IXX9HfH2Gh3x4f4uEiEx7hYN6jHp8dYKMf3uOdi2CgZNvk3l8kIB4hHmUeHFwlmuUfoiUeIBZmwh1jnWIgH+Fh4yAg3aHQFVdeG2KhW+FlnJwe22SZoqChnWGfHBrd2xri5eFf2CPg52Pfn55h32LZ45ve49UQXV5c2h3c41QpVxHh5PgiXiUVH2IiH94gWWYZ4V/in9tjYOKc390bpeAin6Vg5B0iHSIiYSTc3tsiId2colFhgCSjG2CeHiKho2afn1pmiJzh2lwoYSHqEV2k1VkgKBzbIOGeXSTjlCrdFQmOn+BYpNhlIt6aR9thWlPaaWMg4lHS6uBY781PmFdkjiFdnCDiYFih4Fvi3xUsYV/doJ5a46Hn3RsjJRYhWuNn5Vyf4hYa35vj3JrboFtjX+Ng4uKg2xcapOLi3uDdYmPk4N8jnJnTnFkkoFlj5hwM4t9gGOSZHaMgoeXdoyVgpaBdKKQlIqpi5iKf451jW2OdoeJaESEfmYpfYaFfpFURZaL4o9vlT++jYF8f3pngIKAd42Gi4mHe36Dd1+Pk3yDm4+QgYtTkoVxm4NIbnmMhX+MgI+YnZ1+g3p6iXyDmXVAfaQgg4dzapqHjF1JaKZwZ3yhfWJ8gniBlnsgknxqcF+BhHyLapB6in0Scot+bXlih4eRXkqsnGZOClddYpI3im98cHuHf4yAgYh4N391kHSKfW1+gqR0V5CKP4V/haF/ineSWJaDaIptdnaTaYyDho6JgYKaZGyWkolzk3aGio15iX95YlRubIl/co2aZ4d8eoRSkG1hm3+TjnmSmIKPin6LY5d6n4uPhXqEan9kh3Oig0lKfnlmTXF/fJ6XU0eDieSKcJFJhYiGcJN+ZoB7g3+HjXx6mHhygodfdoyvfomJk4aLV52JfpCCTG55fI2KimiLjJCEdoiCeIyLi5l9LnSdG3+LX2yffomaRGZwf2B8o3ZreoV0g5WUOlh/eoJPenl4imd/hIZ6BneCen91k459lV2Dkntkp0CHX5SJNpJzeIiLgICPeXyPfiyLd4d6fIN0dXijfH6AhimIcoyNj4KKikZ7i296bXdvgm+GgpOOiYeJWytqlJqIXYJ4ho+Jhn+LhG1PcWmIeomNnWp7iXWOjYl0eoaEftZ0joRznIs5mtWQjKGCeIuAgZWDcJB6gYCCQI13cJN2eINWk1Y+lJLZj3+YPEOKfX+Tg2GGlX92f4SIiIt+foR6YoeOkIqZhYt8i2GLgXWJijd2g2yKgI9+h5WRkHKKdHuNeomcdimGlx1/m2xrnXmIUU11uH1ff6N4ZXKLc36elCuMkXiJUoJ+dItmgn6Bdwl2eoageY+JfYZkcJR+dFwsll2HjGeSdXl7iYiMeHuNf4EsiXKKgXx4dKSGrXlxi4VFhYeJpIl/hoQ7jZZkjWpweIlpioqkk42DdaMQZYmej3ykjIeNk4KIlZplT2xhkn13lJtmeXZ1foqQYoV7g5BnddNvcIGJko8/nISrf4SCfI5vfl+MdYWJd0h+cV19eJB4bIdUSnyd2ZFsmT6ekIZ3jINslZmAf4GIdYx6goWJe1R5jqtzgnqWg4ROin9+h3SAdoGefIuQhI2CfH1lj355i4yBlHNufJ4bfLhxcJl9gktNZ5N9XYGkbGJ0fnCAjpA0pImWh1KAjnaVb4yIenQEb4iGgXvJhX+LbHqMg4CPIVZggZNMi3CAhY6GdIumgoZ/O5F/iYWDg2t1fptzhodtIIuAio2GVoNwbJKmjY12dICMcY+MhXeJg012P2iNmYUAiHeCin6lc6KST2l6aoxtfZCXZniFbH6NhX1/hoOPam6WeF6Lf2V/iIx/qYdqhX53YoB3eWp3gXFBhXhzcYWOf1CUTUOQh92OeZVJm4mKd5N5XZNEfYaBhHqFjWp+hnJOiIeBeo6GjI1zV5yKgH2LPXl9o4t/h5mHhmqXcJJ0e4mPhZp4cISnIn63VXWjfotkQmnDhV+Cmm9mdIByhYSEMKGGhX5AeoB1imuRj4trHHxXkZ53ZZGEkF6FhYNqcR9AYX2QHpFwfmmBjYKDg3R+fzSUfHeKfIFvl32ceoF7il6HhHuTfH2GjFqCpYB8Z4J+k2h4jHSOjYNOeGRIf5CAm3qNfn+Lo4qam1xJZ2aLdIeFkGl/jIWTYIhWrV6Jj0RdqG94gIhzkoSKgZJ6fnxqi2mEXYRsiW95YoBueH2LjIw4lVdAk5y2fnaFT7WJcoCTf1V6mnKEiqN/f4Z4hoVvQYlteXt/koqEgp2RgoB/f3+Bd6KDjH1OgotvWoeJhnkrg4V1cIKLmR2Bxl9xloGRWWBhnIxsdJV/YYZ3dIeCh2RlkpZsW3eOeo15cpWJeV09ZI6EZK6IioxxhJl8d3FETmhdmWmKcnGIf4ZmhsWEjW4mpGZ5iH+AdD+BhYl7jmBggH9/ineFnoyCkLmMlXhvZoFhj4R4iIuOg4icgpF5h22LiYeMjY1+h1tjRY1llH1xhJhzeIZsg3+UbYKKiIKGdGlsho2co4+ElYyijYh/fpeAfo2af52JM0x7eWNefYKQi51hOIqC0ZKGgUFvjHp/dHxmi5SAeISOq4G0c259bmSRjm+AfJGMfopkf3uGhntXc32Qg5KIfImsm4V1fIdyiHCTlIGDbZhphXt6bqeGfylOc6d5WoGde2uBinx9j5RQhmqCdUZ9j3SLZIuIjn0Xc359dX2mhXqSWoaxdVBVG0dbhIt1g157enyIY4Nxeo+HJXxvjWqLfm58jKZxf4WJRYOThJONgpOQbnmFaoh6dGSDZYh/jIeObqiKVXmMeoZydXyIiXGFfXtoYEZ7Z5SBXYiYcX+GbIRemnF2nHuAinOAeIOWkYCch5ONooKnjo2Hdntsbnt4f4hKg35rM32Lg5ubWD+GhdWNcYdHhol+gn56Y4GUgn6FjIGEkIF1gG1jgYp/hmuWk6SLb4p8fJSBS3R6iYqIhnmIjZ6Pgn98do1wiZp/UXSbH3+DhWyff4mvU22JemR/oHZgcYN/gIyCQZR0gXI/ZY9thmGAhol8H3B5io59loeAkWOMlYBvgDOIXXeQb49rfoGDg1OLe4ONfzuihYVtioV0io+rd3iGgUF+gIWnhn9Ui1CEemaNc3Z1kWuAf4uGioqMUWFvjIGEhIeDh42Gk36xcWBNfWOWenl9m25rg3OJfpl9fIeLiJZ3mWaLkYtsrP2OkqWEjHWBf5R5nZl4j4eLQZV/ZpOAgnRMlFo7g4vWkneRQlSHfH6FemGSkIR0ioCZgpt4d4FzYpZ7sY9yhY6EhV+LiGyKfYludneHjYt7iJOEk5F2hXSNkY+UfW12lh+HhX1vp4WKR05smnlpgaKCaH2DeICPiSqkeXyCSIGMdodhiWOKfBd1e4OGgrGEgIBdc6V3bDAuUF19knWIeXx7hoGKf3eEjYcyiXuLfISCfoeNq4F2kIM5iYaGm4mFjolae5Jmfn53bZFrjn+PiYh8jYYBa5COiH6Qq4aLdlx7jHlkSXZllXNumKBsg4J9hbeKdoaBfI1sen+ScJ2Ibal2laGhg6iHjY1vhnF8d3+HhzN8dWx8dYKAO5xWOI2J2JJzlkZ/jYqClIBlmp9/eIlvfn2HgH+Bh2J4iId9i46NfYVcl4p8lHpyb3qOfY+FiYqPi4J9iH56j1iKlXoLhZccgp16Z6KBg2pQb5V5YIGnfWaGhXqEj4Q3oImEgkl4gnWHZYyGhXcEa3KGlYKli4OVYIWnn3FuIzJZf45/jniBgIyGd4iEhIt+Km14eYGFfnqBh696fn6MWH95hpSCcnGLGpOWd4p3d22IbIV+ioGQhXF/ZmiPkYeGopOGjHx/hbGAZ052YJWEeoqdZnWCfoRAjnN4g4GCj3ioYoSSlpSieJifnYmOfYOFcItplnmWhkg6fHptTmiGgmacUzCJjdSSeI5EmY+HgIyCZI6gf3h/jnyBmm99f4Bcko2Hfn+Qi4aGRJSJepSeRHJzhIaJh42HoJKPj451eI6DiJR9fnydH4qbUm2igYI/S2usiF1/o2tremh2gpOOQaiKf4lOgop1h2mRcId5E3d6g2yDnoh6gGV4hntzli8BWG6KdZF0foGHh4aKq3OLiDSJfneEcXZ4goergXh9hkeJhX6YfoGHgFN3m3mDbHh5hGiGhIqGhYd8eHFkipWKgpmpg41+jp+IjGRHdmWRgHOHnmt6gYCFSYlyoG6Gh1hziYR5loV4kHyRgaV9ioh6hnt9d4l4fX58QYJzbVpygoO1vlgsl5HQkHqQSriNk396hmCNm3+DhoOAhJCGfYNzWX2OgYR5mYmGjF5/hoCbgy5yd5Z3gYSAiJiPiX2RjX6IfYeUfGeFlBqAoWZvqYSFh0twkIZkgKFqXn58coWOjj6aioSRUF6FcJFseoh+dRp3eYaXea+MhIllg6N7gn8ihF1yhXWPb4GMiH98c3eEjX4mbod6h4qGZnuIrH94foYlfYJ/l4CUj49Eh5RtjXh4fY1miIiGj4yJiitzbpKShn+kfYCSeKZ/jYxnSnZmkXSGi5pmf4ZzhHGOcHuViYu7eImLiYqMZZqrkoGliIGPfYaMfV+Kc417dj2ObmaSf4eMRppYLZSL0pJ4lDRfjoiEkYVjhIt9d4SIfH+AeISDAFiAjbSGcoCOgYFceYKNoKBIb3iwiIWHZI2PgpF1hp1/j3Z7m32EgpYbhKB4baOBhXxUaqRzXYKhc2B2gHCCjIw7mXuHh0l6inaNZoSFhXwcbpSEa3aWjYiAdImPeHd9NXVeWYhzlG56gImKbI2HhoeENpWNf4pngXOph6p9fX1/L36DgZaCiIyGXpOde4JwgYKIYoaKhI6Og5NuWWiFnod1hn6CjXh4qZCfbQx1bpN7gpGbYoSHeofmjmuAmIuQW3d7oT2XiXKgjoyJo410hIODiIZdlWx0f4ROgG5vmn+EkVCFTkKXjsOJco5Edol9f49/ZI+ffn6KiXqCfoOBiHUAZod3fYGFk3yGYnqLeo91b31/gI2LgoCKfXyPh5Wdg491hJp+k4KYHoS6enOjjI1EV2F0fWKAoIljdoVwg5eKSpOTg5ZXiWp5kGmPgoR1H295ibVsn5CLlnKNnHxvgj5NY5yGeY1fd4eOhFyKfYyDikN/foWOgYZ4nYSqeX2MjE16eoGgiYqNjV2Io36RdnNxhmeJd5OBgIeAZDp5k2uGdXmFholqgHqOUWRBfWaQdIKHlmx8dGuRjYapfIeDgIZ1pYWLl4x3nb2Vj52FfIOJg3J7cYF8got8GXl0bbB6ho5PklU8hIfTi4SKSGOMcIx+gWiPfYR+g4Z6fYp1b35zZpadf3yXiIyFi29+g3+Ne35nf4mKjoWCiXqVf35+hnGHc42ehI12jnmChIFtp4OOjVF6mXBlgaB8W4WFgH9/gke6aHZuR4KNcn9akoaNeBV3dH56f6qKf4xXaIqBRHw8eGBzkHqOgXt9goNAeXZ/iYI7j3uAbIaFcn+MrHdueIpxdGB/o4d7KIdXeY52hXZ0YI5ohHuHgIaEg3EjepF6gHGQh4eHfYF4s25dN3FZkXZ8jJpugKJqhaeSeYGGfYyPdJWhhZaJepuGmIieipZsg4Z/bG5+d3yGhDCDgG1OfIl9bItZKYOJyYxwj0mXhnl8iXthkpqJd4F/hIV0c3d5f2KQkHV4lIiNh4N6k3xrjH9FbH+ShImIeIqikJmQgoNri3F/mX9zdI5NhpCEa6eIbT9EZKF1YoGldF5thX2Cm3dH63B8ekR1kHeBY4p6i3wYcXh+f3+ZhYSUYnyQn29BJRdXZo2Ch3h7foaIZIN/e4mCPYl4hXaFe4GMhrB+cIeBW4aGgKGDfYSVRHOLd5V7dnGNaIZ5bYWGioNzWHqLi4d7iqWDjHaFgYh2YkCKW5V5goubaox8bohCio10iX+BiHq5eIaZi4ugeJmIoomMhIt5hYVxiHiWgnM7jn9mXXyDeWmSWC2IitOTg5FDpouCf4CDYYuefHmGg3iBk294f3Jii6eAfoqLjHmFbJOMhZCCaHN/jH+JhH6DhpWQgoSAbYqJgpd+jXqWHoN8dGiggICIUnGEfmeBoHJlgYR8f6SIT753en1Hhot1fmCLe417GnB6e3WFlYp+il5vnnlj3DEqXG6QeYhxfYCJfmR/g3OFfzSHdod5gYVzdpKyfnGHjlSAfX+Rh4CHdjZ+jYBvfnpwg2iBfX2IioaVbHJ2gouBb4t6g4x6i4WPemM/fleSfmqDnnSAk3mEZopscYR8g5p5goWGmYlonYGZgKCElIOChnRyh4x6nn+AM4h8ZzJ7gYZ6q1UTj4jQk3iHQJWHeH+De2aGmIB2g32PZIhzfoBoX399gX2Bjop5i2eci36PlRZ6dn+Giod5icqTf4aQinKPYIiTfgd1lxqFhXxspYFmeE9rknZhf6ZzZoCGfHyehk6+hn6CP4yFeIJfg3aDfBN1fIOOiYWBhn9hhpV6cFUff1p7jH+LdH2BjIR7i3WZi4Qwqn+Af2x9dImGs313dI5KgoaBi4aBgn8dgY5zhHZ6boVsiYl3gYZ6fmc4a4CSiYiTgYOOfo6VeYRkQ35fl3d5j6BveHp8gpp/eLh3hYW8dIqKkJ2PaZq4m4Obfn1/i4Vye3qUeJR+ekiEeml0eX2ERZZcHI+TzZN2iz4cjIV8hoBpl6F3gIOMgYKFdXuBdV9/jqx/fHiMhIhyoIqEjYNmd4B6gYuAgYWJh41zjHR4kHmKkX+GhZIcfJJ9a6KCkXpUbJ57X4Goe2h+fHR8nHgwjIuBjEV9fHWLY4eEf3wTcXSGk4iliH+Ea4aue4R3J3xdeJFhi3B+hIiDfpJ/iIWCJYJ9gImAg2+Kh7KCdISGMYB5g5WEjn9/JIyZfWx3gHaRaYV/ioaLf4VhQG2Fl35+joaAloaFfqGKZzRiXZOIgoufdHh8c3+Oh3OGi4CJbn6LijWYh4aaf52NooCFfHiGhXptkH53hoQ7h3Fqk3p/hEeSVAuJl8mXfI1DY4iBf5BzY46mfnWFhn+Lh3mJg3NcgYiJe4l5ioGCXISIaY2BO3x+Y4eIhnmFk42TjIiGfoqAiYx9cYefGoOpdm2lholASWWsg11/onZmfH52d42MQreIeo9Fd3VzjGaIioJ1FXJ4iYt/sIeHemqLiYB8XBxCWomHg49wf2OOhIZ/gp6FgTmcjnmQf4J0oICxfH6PgFqDgIKZg3+HhDx+m2GNfXZxi2mIhI2HgYmDf01vg5iJiZWvfo6Ee4mPjGVDg2OWgniPoG6Afn+Ecnx5lXKFhVt3iniJl4d8oYCWdaV6coZ3h21+ZIt1eH95SXNxbHl2gYkuo1YcmIXJkW+NR56JjIGJiWCKoH98hoh6f4B4h4OBWHl+gn57jouAjGeQiIGMh1t5erNliIGAhoSGjXWQYH2MW4KNfY9/ixyBnnNsqYGBT1VrhIdggKR4YnmFdn6Nkj+Khn6DSX5oc4xpm496dRJ3iHqPeqeMg5Nrh6mBd4gmAFyMjHqQcIOPiIWDgZl+goYqf4V+kYJ7bmSJr4KEgoFMhYp8k4COkYFAgIt/kHx9fZpoi4SJi46AjmqTdYaVgV+Hg36LgIV8kI1oRXRolIR4iZxjen19hkKMc3WJiIuJd4WVf5B6i51Wk4CpioiLc4N3hW2Sfnp3fDp8dW1zeYGHdYZaKo2Kz5CDiEO0hoWEj31ek6Z5gYeHfn+HgoyGdlV0dXl5e5eKgYlhko2Eb6Uwe319j4GFfouKiXl6mJx9jYOLkIGHf5QchqJfbqeAiWJHZn9+XIGfb2J4hHiGipBYg5OGi0d8g3OQaHmTg3keeo2NkX2thoWRZYKId22ZKVFaboSCkmpzjop+b6OGeZGDOYiJepBbfHWdg6Z6d39+RoiFfpN/fYp9YY2LZI2BcmmJZYd0g4uCgIZ+XoeDbYhweX2Gi3Z8fH1mYj14XZB7b4eYaYmjZYk5jXx0mYJ/g4GCkoWXjn6WbZt8ooeOgoKDdnBzOn6FglIsfXZnY3p8kX+KYiGEgcuNb4JMlIZ4g3mBZYeMgn2Cgn99j291enVnfJV8gImMiomGbod/hIp/Pmd/h4SDhHx/eKN/hXqAXYuAi5mAi3SOHn11iWmleVyQR2x/b11/nIRfiYuBgZKIS3xodng8fYx5gFmQlouAF253fXGDnoeHkGd9jI13dxx5WIqNh4V7en9+hVJ9eIOTgDefdoR0godubIOsdnSBhGOCeoCoiX2Ihlp+i3SHe3FshmWHcnWIhoeIfoSAgnmIdH99hIxyhn+JeGc7gFORd4yDm3CChH2EX4V1epR/goR6Tn2LloiHm8SalKCEg4eFfndxv5l5hoCGLoZ8Zn19gHZeiVoGjILKlZGHQm1/eXd7hGWOmoF1f4O1gJV1cnRvYoaGhnyLm42CinF6hXmHgmJqfYGCh4Z3g5GXknyAgmGIbo2Zg2hylR+FcoBrqYyBOE9unnZcfaOAa4WIf36fikCga395PG2LeoFhiIGLfRx2en+FjZ+EgY9ueodsdEIRelqBioCCa3p9ioRifH2Gi4JFf2yFeISEeH6Drnl3ioNLho5/lYd+jXdRfIF+eXt0cY9nf3eNhoN6kHQqfYh/g3yAhIOMfH+CgnRhOHtRk3R6hJxujHttiJOIhH6PenOLfaGBhJiHpZd0mIGdgZSMn4ZvbXNDeXeBiyl8gGmKf39/OZFYEIeGzZN3ikZhhIKJhYFsjZmCgX+EfoN9d3h6dGGBi52Bg46Niod6l4aBintrdnh8inqCeX56kZZ+hYRojWGGl4J8d4sff4OIbqOAhbZOdpB2Yn+kc2uJiH5+lm1UmnV+eDpxh3l7XIl1incadHuBhIqlhYCMaYmBh3OXOJdadY2Ag3N9e4yBUH5/mIqIO6B/gnqFfXmHjrJ7dV6FZnh4gJ6GfHiMRn+KdHd5dW+IZoR6hIKIhYVwN32AioJ1jIOCjIeDf8B6ZTtsTJJ3f4uebWuBeIR+g4t7jH12hHeOcH6YfXuYvJaMm4aKgIWBiHxogH2Ifoc1jHxrm3x6fjCfVweOiMmVf45FfIGFgYmAZo6egHaAhYNtenR4f3BeiI6CfoOGiIN/cYaHmIaBYndRjISBgX+Cm5OVqZCEZYqEh46AjXuRHYmHd2qphYUbVGy9fF1/o3hrgoB+e5KDSs1/hII6ioh1hV+SfIJ6HHl8h5ONp4F/hW+CjY9rOC8wWXWFgoNzfnqQg3+DhYKKhj18d3GBf4CDiYWwg3eHgVmIhICYh36LgSR8kXaNf3tuimaBfn+GfYCDf0t+gI6Adpa2fY54fYSMgGY4elaOf3qFn2iMjnd/ToR+cIuBd3F5jpgXl4efm3abe5yBhol8gW+AdYN/c35uOnp4Z3p6f4FkkVkJgovJlneGTMCGgoB5iWWSnXp5gYSAgoJ/j4F0W22Icn5+ioWJh2+UiIGGgTh7d4GLfXt/gXmPj4SQf3GMaoiIf395jhuCi4Rsp39welJngYBfgaN2aYCBfIGPiEuNhYGNOnJ7eodjioWDdxh1fYZ6i5SCgotwgpKCbY8fL1lxioeIboCJi4Rkf5R9joI7j4OBhoN7eX6HsHd4hYJigYN+i4V2hoU7gJR2i3l/dI9lhYBxhIaFfF6IeIWYf5abhHSOfYGDiYZmQW5TlYF6iZ1ohoJ6fC2Ec4N5gYO7e32SkZqIf5p2mIudgoSFfYF6iHeGf4N3dDuPdWdsd3uDVZJYCpCRyJN+jD+IioF3iINji592f4GAgH+Hbn+BdVp+hoF7g5SHgYdpiIZ9kZYJfXplioCCb4WOiZWAiox0jG5/hX9whY8ch4tybKeAf35SZ6uDX3+kdGl9Z3p9k4FWnYx/hUFxeXiMZoqFfHgTdYGEcYidg4WGa4BxfG2TJWFbbYZ/jXN9fIOFc4mKgJCENnd7dpKcf3OQhLJ9eYmDVIeIfY2BhIaBNYyKeGp+e3uFaYKGhYR/hHpxYHqJloKBloN6lIJ/soKLZ0N3XZSEeYWfbIOAdn6nhXNwi4eIgnh/nnmXfY2Yg5qFnaJzh4KFZY5vi3R+cnZDfndph3iBhqyIWw6Ni8SWeo5MZoeEgoWRXpecdX6HiX99gHh9gXVabZWdgICSh4OHbIeGgZuCYn+Ag4eBgJCJg4ySe5CUeo52ioJ/hHiOG3+Ye3CngoRlUmB4hFx8pHhseot5fo+OU12WhoM+gHp8jGp/ioB3HGh8eImBoIWAkGqEkH93fh+SXZCFjItzgYaLhHBpcKSDhkN1pX2XhYJ5hYeueX+EiD1vhYCQjXyLhEJ+j4B6fXx/lGiJhYSCh4SZXU2IgJSBkZiAbJGXhoaJjmc7e2mMhX+MnWp/gX+BX4F0imiHh9F4jZ9wn4R/mHmUhaGEdYh5go53aIqCfnVxPoR1Z4R3g4lQtVoNm3+/loONP12NjH6WeWWYpnp8h4V6foByfIJnVHuMi4J+hYV/cGl9hYJChjB7gAaEiYeEhoKFkn2QnHyUcYaIf4eFixyInndtqIOMallmoXdYgqN7ZHh/dX+Zi0qWknmMQICMco1qeYp/aRd6goWYhpqLhoxxg4F/e28qaFx9gouPbHlwgoaDlJeKi4M5gW+FkICJdseDrYV6fX5NhIWAmId7hn5Uf51rg3xxZYloiF+LioJ2iXYviIJ6iHmCe4eLaX59iHZkPHFcj26GhZZug4JqiJSKeXp/d4WKe5eOhpiEepB/lI2ah5+Cjl+AeGJufHWCgyZ+fmaRdn6YWoVaEIODyI9+g0l7Z4R8fHplipWFeYB5h3V4dnNpbmV6jn53eIuHioNnnoh7jHheYHmGh4mJc4SBmoSDdYRQiX2Im4CGdJAthXKLaKeXilpUd5dzYIabcmuEg4aAkXdUnGl9ejp4inx+YoyMi3oVbHx9gYSLhoaOYIGarn9DIG5ZdYqLgXV6gnyGVH56hImJTH2Ag22CgXJ7g6txdXyBa4KHf4+IfX63RH6MfpF/b2qIZoFthIV9l4FwSImIcod7gYOFhWyCfat7aDh5UY90doWebIGAaYZrjHp4lYR7i3h9hYeSiYSMepp9l4d1e3Z4dHdyi3qKflULg3lphXh+ej+GXAiFgM2Rd4VLkYqFinN/aI2Xgn19gXp7iYVwc3ZijYWAdXqDh4qHboGNcYh9iHJ1hYaIf3N1iZOLgX+EXY2IjZmCjHOXHoR3imyngYVVVXGSc2F/onhsh3+Cf5uJTp5tgHY7hYp6f1WSf4x+CXd5fX2NjYmFjGh4gXt5hilnWHuNhINtfnqOgGJ+eXuMg0OGeoR2goJwfoGtf3JshXCDZ4Dvg3h7i1R2inyIfHRshmiHbpGFhYOce2KFfHt+boqbgox6gX6Je2Q4ekGQfHmHnWyKnnaFVX90dp14hYR6iaKDlod8lXCWh5iElid7gnp0Yn18en93Iol+aWN9gntWilYOgoPKkXeGSbVyhYWAg2aNlH93gnSEeHN7f3NuYnGYeXx7lIWDhHebhXWMgD5ugYGBeoV5hIKikIGJhFaPdoKVhHB0jx2JeYNtpX+pb1NslHdif6J6bIWKgH6jglircIaAOWqIe4Jig4iHfRN4eH58iop0hoprfIqWcTkpZFl+i4Z/dH6BjH5ggHyHiYY/gHd0fH+EcX56sHN4hYVoh4N+ioR9lYhEfoSEi396cI1of3jxiH+RgHaAiIKBhnmBfXqJhX6AbX1lP3oGlHp5hp5qiH9yhC2FgHyufYWIfoOThpmCkpqAm3+XhIKTd350gIeMf4R+WyuBemdue3t+VY1ZA4aGyZV6iE9eioU+b4hqhpR0gn6Di2ePd3d9dF17jJ56eoODg4ZpiIiEh5JMdn9+X4FydXOPkZB0jYRkinyFi4CKeJAef3eLaqh/hHtOcIN5YoCiem2AgICBkmJTnXiDijaChnmFZIB+hnoMeHp/epCbhYKEbn2AdXCRKI9Vbo6AhXB9hol+WH2Af4qBP4h4hIZxenaBh7F4eniAW4GCf4mEgYGBTnaMgi96eHN/Zod2jYWDfpFuNIiFjnFrgnF5jn1+iIqDZTZ/MpGDe4aebYyBd4GifHV4m3uAhXuKmHuUc4WXcpuXlHuAUouDWYB6iXx6d3w0f3trb3qBg2ChWwWRh8eVjI0/aX+FhYd/Zoybe4B/goR6hXR7fmtaepF8fn2MgYaHcYeFeI2CVHh/g5KBgXSIfpKNgY+LZ4t6i4aCb3ySHYF/gm2nioB+VGefe2B+oH1vgYl9b5Z3XZB8f4Y4bnxph2qMjYF8EnR6g5WOlnWAiGuCkYB1YySIWIWFhYZzfnWMfXd5dZyOhjuMhnqMfIV0i4WweXaFhVx6g3+VgnqAgz99joCCc3l5kWeCeoWFf4CLczyHhI+Aco+EapGNfYKfhmc4dVCPhXqGn2p/f39+OIh+dqKAdYd7hJCGl4eBnH6bg5R0e3yChXR/bYWAfXN7N3t1Z2V6fIRFjlwFiIvElnOLSl+JhoaGgmiNmXt6f4V/fX9+f39wVn6CoHp3jX+AfGeRiHKOfGl8enRhgXR7f4eLkYmPdW6Sc4WBgI17jx+ChIltpoWITFVpj3pdfqN+a3h/fnuCh16Jf3+KOYJ6dYxniIV9eBV0eoNxjIyHg4dxhYF8cmMtXFuHiYiMcH59joFzjJ2DjYZDlm+IkYt+fJuFsIZ8fYBYiYeBiod8hoNDe5VxhX17e4Frhn+IhoSDiGZEh4OPb2t+o3GSf3p8iolrMnNdjoZ8ipxsgoKCgIKCdHh/hoVsd46eaZ9/jZZvlIeZj3yIe4R/kHCOc294dD6DdWx0d3+Bb6RbB5OVxZV9i0aLiYV9j39hk518fIWIfH6JfJGBb1ZzjH5+eYKBgZN0hIF6B4gxf31ygnqCeod/ioh7koJ6i3uFhoCAgZMejoh6bKiAgkxWbZV8X3qfem56i3iCkYhQkouAh0F8f3aMaIiJf3YXdXh5mIiLf4SNaIV9fWdvMFZYYYeJkG98eYmAd3N5hpiGO3l3aZN/hH+Hg69/dn6EaImHf5KKfYeGQ42Zd4J9foCLZoaDg4SAfIxzi4iAi4hsn4hgjn+DhYCMZzhzX4+DfIadboOAcIExjHN8kIiFinqIboaWgIageJeGl3J8hG+BXopwkHx8cncsgHdkbXCDhnCRYAuTd8SUdIpAqot8fn+XYYySZ4CLhXp7f3F/gnNRd4yDeGmIg4J9coWIgJ+jUXl6foZ/gIOLhYaJd5R1e5JoiYKBin2gIYWMf2qpfYVYWHSKe1d+pHhment8g4qQS56MgIVAeYR9i212jHlvDHl5gWSGf4mFiXiCiXtxlSo+V5mEjY5ygIOMfHeGsn+Dg0GWbH+XZn9ykoGsdnh/dVZ6hX6ViXuOfmh/kYKNfnJqhGuJVoSEh4WJemmNjXuJdX96hoxjfHyCfWgNc1SQdW6Jl2uMonKEcouRfIiIhn57g4aIj4OCkIWQgJGEent1hWxzm5B+d4J6GYd9Y3x0f41pfmINfoK/j3iFToAziYFzf2OSkIF9dHudcY1zd1ptZnR/e3pqfoaAil99cXiIfTdXfn2CgoZ0a4KNhnd6hEWIiXWZeoRzmDGHbItpqYZqVlR1jnRkgZZ2YIB+hn6NjVWwan2CP3yNeH5kh4uMfBN0enx8h3eLhotrdo1/e0UZZ1qDi4h+dH9/hohOfXmBkIFbh2+BcoGBdn6Ap3JvdH9shJGFqIl8kXpheH99h391b4lqil9vgoN4gnVJinh6gXV7eYONZH98dXhgOHdTjHeBh5lqiYJoikSGfnSJh4SBd4R8hZiAgpB6lIaUho2GhY12emh3f3eDciCBfGV0dH97U4tcCoV/xZOBglFngX+Ed4FojJN9goGMfXOAb3V7c2Z7jYB3c4aIg4hyioaHh3x8bH5/f4GHc0Bymod3e4Fjj3SKmoePdZNRf2yLcKeAeI1OdY13YX+cgWx/ioR9m31Pim1/dzd8iXx9YYqHh34VeHp8eoiCdoaMbYCYeXeBIo9acY+LfG99f4aFVHZ4hYuETJJxhHeChXN+i6x1f35+Y4R9f6GCfHN8WHmGe3V8b3WGZoJgf4iDhH5zRYyAe4N0fXeAjHt8fql+ZEB5EYxucYebbIN9dYhqkYF8ioWIgX55g4qYgHuQg5d9iYN5eHZ7cHmQjXt5gH4oe3xxk3h8d1iRWgp/gcKTdIxLcT+Eam5/aIqSfn59g5ZwhYN5c21heoN+h3SMg4CCZpOGZod6c3N8fIeIdXaCho6JhYuGUY2GgZKFiXWXTYVriWypkJEzT3GUdmR/nXhsgIiDdZKHU6dtgoI1fIV8g2OTiod9C3N6e36MdVKEhG59ioBtSihVWHCLiX10fH2Ff1R/eZuJhFakdYB8gH50g4GteXh7gG+Bk3+QhX6MiEZ7hHyEgHN2iGiDaZSBfnyMdDCKfnlyd4OgfYx3gX5+gGQ8cEOMc3GGn26KfHOFcYCPcpyAoYN5g2yDmIGTm32WhImAfoeIemV+aIF/cnx2DHt6anN5f4Bdh10GgoDHlHyGS4RxhIp/gWiOk3ptg3x4Xn2Pe31tYHaRhXRvgYSJhW6TiYOIfGl1d391b0lwSX2RjnOOgmKOeIaNf4F1ixyCdoRtqIN7nVJxk3dkfaJ1b36Jg4OYfFOJc4WGN3l/f4liiISFewt2eXyCjoOEhYRwgo18cWQffVduiI1/b3x7ioNofYGHjoZIhHWDgoiEdINysHx8coNvAHeAjYF7eIdNe4SDi4F8dolmhG2DgYWFinBhjH6CUXOHfGqMeHx4ooVmRHIkknx1h51tgJFzfVeIeX6ZfoOFenyLiJaFcZd+mIJ/iHp3fH97iHOHgXZ9ezCSd2h3dXp/TJBaCIOHxpN3iVGEh3xggIRmjZZ8e39/fXh/gIZ9b1x+i3h1coaEgX9ugIdkg5RFeHt9iYF5dneIjZOHkYdfjHp/hYGHeJAfm3KGbKeCcW9TcJR3ZH2dfWZ+hIJ8hXNUp3mGiDd9hHSJYo18gnsQdHl3gI53UIOBcYGCf21iKElYco2EhHV8foqIbnx+eJCCTpdyXY1peYCAhbFre3t+cpGCgYeFfYeDP3mBe4NyfHyEZ4ZzaX9xgH5zWox+hH13i502k3N9knmDYTpyTo19e4aca4qBbn1uf3t4kH9/f3x/d3+ZbYiafZV6eXF7iHh/dpVzi311fXE7gndqeXZ8goCBXBKLg8GXfYRKnoZ/fXmcZYyQlH2DgH5ygX1zf25XbZSAem6FgoKKepaIf46BXHl9f3l5S3mHeImOdYuCbY51g32BhXWVIoF8i3Cpf312UG6GemB7pHtwe4l+iJWCUJd7gYU0eYV+i2eHhYN+EHZ6f3+LhnaAgnp9h3tteSN5WXmMjYxzgYCTg197f4euhUyIcYKPf4R9f4Wucnx4gl9yhH6Iin+FgVZ5jotsfn1/h2WDd4R/h3+Ec2aHg4JMeZl5Y5F8fX2BhGBBeU6MhH6Hm2eCfXB2WIx3gnd/hY17hIyIln6AkXqXioCJgIF7gXmFdot0eYB2N3V2bGl1f4dXoVoLiI3Bl36KUVCJfoCAg2OSkXR8goJ9dYBzgYBrVXOTgXp0h4qCAHWIhXyJnER9fXCHfHVzh4eJh3uQi3CSdIF7f4t6kx6Fb3twqYOGhldwkHdedp1/ZnuBenaOjlarfYCFNH+CdY1tgIeAggx1e2p5jGSGf4NwgX16aXcub111jYqLdHx8jIdfg3egkINGk3V9lGV+fJ+HrnJ/e3ptgYB/jYt7hYNXd6hxgoB5f4RphIGMiX6Eg3dIkYiHbXeIfCGOgYKdfYdkQ2tajnuPiZhqiHyFfm2CgHaHhIJ7eoOHgZl6fpF7i4+ZbW+Een9vg2+IfneFdUB2dVxvdH+HepJbC4Z5upFyjE98jYGGf4NgkpF8gIaHfHiAd3KDb09+iIWAcIKEgoVxh4uBkHp1f3p5eYGFeYd5hoV2jYF8kH6Eg4GKeosgf3iHbauCimZSca54YnmYeGR7h3t9jo1Wg4J9iTp/eniOa4KKf2UVfXt9fodthYKQcXyXfXJfJ3xaeYeIjXF4epJ8YHiDf4uHTod+g5aHjXiFfqeGaXh0W4SAgIyPgYyCXYWchJB6am6Ia4Ymh4WIiHt5WIuSdIlsdniHfHR9eoJ8aw9zW41lgoGXcod5bY1whKt+koODd3SDf4iOgHV+f4mFg4V5hHaPbXlzgXV7hnASenlsgWl9kz+JWA18fsOKiYFWf46EeXx5XIuKgH+Dh4J2gndxX3Blc4B3bWCBk4CBam6id4d2a1x5foiCjXQ5fYd/eXeFTYGLdJhvkXOOJoNjg2mplpJcVneid2Z4lnVhd32FgpOCUaZwg3RIfo98d2N/dox+DHB9dXOHdYV6i3h1gn5tXCh8X3aHj3h2eXqFiE96eHiRhl+LgoVriYBufoGmb4F1hGWEdn+ZfHl/hVZygG6De3Zwg26DQKF/hn59alqQfniHdn1+hYZof313fGUSaE+NcH+Xl26Ln2+JlYNwdIh7eYNxhYGFjYJ4jICQgmyKgHd9fnN5Znx3eYB0DYN7aWJyh29gg1wRf4PNi3eCSZM7gX1sf2OFhoV4eJZ5cXt/gnptaGuQc3pxkISGgV6Ff32RdFwxcoOIgYB5iYuPgH10g1mLenybgYd0kiKEbY5qp4ZbcVJwjnBjfJdzZ3uEiIKTklxxc3mBQHmKgn9mhYeIgQB0d3Z4h3JDf4pueJeHeEoiYVp6iJF/an2Ag4RXf31/i4JWf315c4J9dIR/q3Z4gotffX1/jH19hpRkeX55jX9yeodoiEltg4SGg3B1jX52hnWFdoSNXn58gX5lDHALjHd4i5xriIF1iFyFnHmUhoGIfoWCiJN9dpCBlYFtgoGIdnN0gnuLf3d6dCOGeGlrb3p5UIBaB36BxJKChk6Ei4R7e4ZmkYt+f3mJgneFd3NtcGaCjnuZcoJ7god6eY94hYBkaoCCen9EcEJ9l4h5gINPjIeNl4SOdZZLkm6HbauAg29Ld6lzaHyXdWR/iYR6goRNsnF+fTeBin1/YXeUin8MdXt7eot3jYOCd3mFeXp8I3lac4iOfnR/gYqHVnx9e46HWY5xbX6AgnZ+hKpwe3uEaYqCfJyFfoh/XXuAgW97eHWDZYFmiod/f3twTIeDckhyg39/jGl+f3aAXDttDYx7eIqaa4qUZ4VgiHZ2fn+LfnqHfIWWe3aLdJWIZYSFdX2CY4FuhH1zf3EPe3dtb3OAgmqIXAyDf8KSeIxHfTh9iXyPao+LdX99enteg391e2tcZIV5eW6RfH+Gbn2Df4d6Ynd6fIdrinaMgY+IdoWGYI18c5GDhXSTYINrjnCphGRlT3B7dmd8mYtpfoyAe5CJRpZwe380eIR+h2aQj4R/EHd6e36Lc0KHjHV7pH94biByWX+HkX1ufn+LfVt8ep2Ig0x9dISAf4B1fYGrcXt6f2B4gH2KgXyJhE14h3mGfXR7iGWDaWuDfn+DcWKIgHuKc4ZzL41nfH6AgmI6bg7UfX+InGyEeHp/TYJ7d5N6hIN8eoaHlX6AlneVfWKCfId0f3aCdId4eIBwKop3bW9zg4NRk1wJiYK7lX+GS3mJhHZ6f2iLjH9/iYN/c4F1dn5vW3+YgHZyhHyAeW6Bh3eIf298fXtxgTdzRX+Ni3eOhFSUe4WIgpB3lCCBb39vq4yOT1BvpndifJh2bH6KfHp8iUmZd32ENH+GeodofX+EfAdyent6jXKOf4p0fIF7fWsnf1h7i46Dc317jH5WgIGCkINOj2qGin+BeYZ3rHt8eIBgjod/kYh8gIBHdotranh+iIRmg22RgWWChmtWlYN7YXV8gXmMeHqAfINgSG4DjXt8iJxnh31ufoeEfHSMf21+eoGGg5eAjJt4k4lRgnp8fH5lgW+MgW12dD2Bd2twcn2CZoJdBoSFwJFzhklkiHyDg39lg4p/eIWBenGBeoeAb1l/j39+dYp8godygoZ/f3pifH1+h32EdIR+iot3jIJlkXeFeoGGeZIfgXN/caqAhHZWb6d5anWZgmh+jX14il5Xf3eAhjd9jnyKa4yJg3gOeXl+gIpoR3+JdYGbfGleAGxadYmLjHR9e45nX3Z6nI2BUplxkJF+gHiGgax5fXuKdHiEeoiKeop/SneFaYZ7d3uEZoZ4jZB9f4R+aZCAgIpziX1TjG1/fYiEZzNxWJSNeIibbYd/fYZLhXt+o4SIfHl2fo2XZHKUgo5+bHJ2hnSBeIRtkIRxbnktkXVmY3KOiEqfWQh/f7yRc4RPho2Fen+EZ4uLgXyBgnd5eX93gnJWgo16fHGIiH9/d5CLdYWCYnx1fXh3QH2NhI2PeI6Ed5N2gXKBj3aOQ5Nohmypf4VkV3CVdGN5mnNmd4B3eYyIVJN8fYdBf4R+j2p7hXtgDnR7an6IWoaDhHeBYntycydxWouKi5F3fn6SbFeBhH+PhVSQbXKQeX1/hoCre2lzdGiEiH+Rh3uJhVN3jnWBf3mGfWt9gIeKeH+DcmGQhXY0c4CDboyAfYCDjWkOb2GPjIqJlm2Ge3CAg4Z1doqBh317iH+AlXh2jH2RjIZ8f4d5gnuKcYuDbn9yRYF2a3hwdoNsdFwMhGi9kn+FVIiJfoh+mWGakG2EjYZ7c398ioRvT3CTe3x1ho6BgnKCg4J8f1uBeXWEfYh3j3yGh3qQg3mOfIB3gIt4kSeFcoZyrIOEdVFznHdhcpN6cnmTfISKjFKSdn2RP317eJNxgIp+YBB9eIR5iV+Pgod3fYx9Vm8gb1dsiIqObX97j3lTd3WEf4JWh3d5lICCgICApXVxdYdgdoZ/iYt7h35Ufot5i3VtSoZlgSh2hYl8fnpQlzB5jXV8d4mXXnx0fH1rCmEAjmVfgZVtfXldg1iMi3iViIGDfHR3gY1tcYVlkIKAh42Cc4SAeFmDcXmGc0R/emlldXOER31iIIiHxZWLaFeFhol8gIFZlYaDgW+JgHR5enJZcW+ChX1teXuEdIWyXYGBgXmLT3+CeoeKc2p+k4Vsgn1Rg3qBj4KNcolsh22Lb5p3eGlJb5lmbXWPc251jIh9j45UnXp/e0h3gnKDanuHknw3fHt2Z4RujYGKe3eJe2VoXZBYgIqTgGd9f5GLRGd1f497Z4tzh3CDimdpfaFqeVuIbomBiZSNdnp6anyReoR4dXWFbIM9homCgnB0RY+ngIpyenSIjE97fYN/YwZpGY1xboSVbYyHcIhRiGF4i32Ngnt/iIuSfY2OeI6AYYiAfnSCaX95iX54hHgPhnZuhG9/g2mBXA+Df7mLfxZPcQ6BfXKHYJCOf317h4Zqin1zZGhlcIB4dXKHgn6LZGyGeIx5dmN0fYl1kXaMeol8dHGGTo2JSpyGinGXT4RWl2Wtk3xIVnqZdWN/intmfIqEfIOOUJRyeH43fI95emaIkot7BnV8fnaEW2uMj3N5n3mCVj9nWIqLioB2f36Hg0t+eYmQhWOEcYltg4R0fn2kbXF2e2CEi4Kegn6Qikp3jXyJfW14i2yDH4WEhH1+dliSjXWHcHuAhX9yfXx3f2sKcQKId3GRmHCCc2+JX5WFbJCEcId/g2+JjX6EjnCQfHKHgoR4bHSAWHx8dYZyEX51bGBxfH5pkFsKfIHFiHldUXqQh3x6g2WFgX9+eoh4dnmCdW9vZX+EgGhugH6BhYJzgICIe3tzdXx8eHh4JIKTfneAgl2KdYGYgYt1kiCBeottpYKGd0t1mXVudZV/cHWJhICRjVd/bYGCQnyJf4RphYiKexp4endvhmuPh4N7goZ9c2Qah1hzi5V3bX97jXdUfH17j4VlgmyHeoaEc39+pXOCaYFqgn57hoiAf35bd4tugn5wgIRkiVKNhYOAd2lekoV5aXZ/doKHc31+iIVoCXEHjHZ/jJdwh4R3iHuEZXiQfYN+f4OEiZZ8hJFmjoBthH5/doB2iXGHgHWBcQqHeWlxbX5+boBbEYmBw4x3c090bIRqen9miIuEf4N0gHCHdX+Ab2RuiHh2coh+f4BkfIV2iHx1dnl7hXyNc41+joN/hYJSkH90j4OId4dKlHmJbauRgVRUcpx1anyWdWV9h4Z9fIdWk3p+gUF9hHiKZoCIhXwSc3p5foZfMoSMdn2mfXJeI2RdcY6PdnJ+foN0UIB7f42SXZN0YoF/hX5+f6lucnODcISEfI+FfIuIR3OBhIV8cHmIZoZhgn97f4V4YJKCeolygYRfimqFfYCEXQhrC5RzfImZcIh8cYJtkIZ8s4dvgXx8doeSfYiSdpGAY395iHx/Y4p0hX1vfHAlgXZpYm18gVuEXAmGfsCRe3tLhIyChHmRao6HdYN/gn1zholxf3NdfYB+dHKJf4GIYXONgYp5Ynt3gH13IHB2doeEdHODV411gYuChnKZQ4dzinStgYdqRHWdc2x6kXtueoJ6fXiJT4h4f4Q4fIiCim18gId4BnJ7dXWJbI+EkX19hXl8bCN+WHyTlIRuf4KMdkh8e3uPhF+Ia4KJg392gIGoeDJ0fWZuh3qWjnqLgl15hHyCg3+EgmeEcYmDen97blyQf3Mxa4l2aot5f3yCiGQIc1OEhYWJmmyEh3J1bY5zfIKDiol5iIWIln+Hg3qGgkyEfYB6f3uGc45+dIB0QYd5a3BugYlWilgKkIa8j3eCVYeDfoB9iGWYhn5/i398cIF8fIJuXG2ddnlshnV+d1d/g3uBgGR6dHuHdo1ziX2IhnyLiWiLe3iGg413mk+TZYdxrICCdlZ2jXZmdZN8bnuJgHyMiFOPdXuEOn6NeIlsf4mCfAR1enl+iWVxgYV0eXZ+aG4hdFl6nJONdX9+iX5LeXSFiohdi3FqkHuFfoGAqGmCeHRlgod+lYl6iIRDdYV9h251eIRpg396g3GBfXpIkop0iW6GggCQcIGHe4RhCGpFeIN/iZdshn16gm6JdnmVgYp/fIWJg495hpx4j4Zde32LeIJvgnOPfnd0ckB/dWd0cHyHaZdZCoJ9upF3h1KWi36HeZJkxpB3gY6Ifm6GfXiFaVZ3j3x4bYeBf4JadYZ/jn6Lent9gHxnc4J8j4lygIhtln2DgoONdZpPf26RcayEil0+dZ92YneSenV5hHx8dZBLl4Bzizp/hnmOa36Hf3gAfn12eohpiYSKf36Ve4BsGoVUhJSLkHl8eo98RH5+foWFVHt7hpOAh3yAhKdzd3VxT3+Dh5CafIqGZXaLcHaHcoR/aIN2h4t/gW1wZJOJa21zmIBajpt6fXSGaTh3RX6EZIiVaIB5dnpyfGx8lIGCc4KDhoaEa3WScIqGnYp6iWeFb4Bfi4t/b3JLgnoAUXSEf2B2XgeNcr2PbohNWIWFhH58a4+Me3iIg3hnf3lzhmZWc5Z5dWyIfHRgd29/g4WDSIJ8f4aHjHeRfYeFcH6Ie490f4d/fnqXYH9YinKlfoKUZGaZbl1qkn9fc41+eJWVbYaKWodFeX2AjWmAiYFnGHB8hISEXoeEinOAjoFqZExeZXxxhZZ9gH2BdmCGeIGDgVd7b5iZdpB6hn+lbmt2hXN2im2nj3iCe2xtiYlxcWeLiGlzg4h6fXmQb2F1jHp9i4pyZJqBin2mdVw7nl+Bh3GGnmiHhmVrWX9zepCFgoZsgF5+jm5+jpI7b5h/e2CFgld9dYxnilmoPIF8blZ0bYRqimgDkoTCl32MOlCBcH+AiF5+mHV5f4SFe312cXtcT314hWd8iIE+gYqFjHd/fGJybXyHe4WWiouDjaaHjGqLi4iKgYtmk2iCb4NooIF9XFRsk21ceqp/yX5dgnV6im1JaniGOXuMc5BjiJB/bxx2g3h6jmWDg4RoVpN1bGcrPlp1hE6LV3V7eXdrcXyXink2nGmJjHNtcHGKoHJ6f25icnqEioKTiItneXlrhW5rc4Boh396gH6Ic3pcdoiGg4GNn2aWU3Z3gHZkRFdZkXuHjZ5we3p/elx1eoKLdYaLbE59di53NpB2MH+ldm95f3CAeFmJdHt3fgl7dW84coUcdIMsBImHyJZ0iq1XjnV/Z3Ziip54gYN/d3R+eHV1e0l9j3h6iY2Ff3JvlXqKgnNic3t4cn6Eg4R8i3qBgH1ginSBkoZjepQjiH9yYaZ+hWZgbYlvYnukdlp0bHx6fIhdkm54Zz9lenaQZIVwfmwacHuAkpN/hoOLV1aagXJPMm5fhYYpjmN5hH95b3Z4coiEMpR9fYyBiHB1g6d3e6uAYIGHdXJxg4V6f3uGdoF5c3+Ka399kmmFhYZkSXWHfH+FjnN8m3uMfYdtYEZ5YoeCdI+dZIiCUn54fmlyg4N/f3WSeoGJUXqXiSN5oYF9dHh6aYd9fGuWcXwTh3tsUnJxe2Z0aAqMgdWYcYIjUIB3f3yHYX+QcHuDg3+Hd3+MenBRb4CVcIyDhXt/d5WOeHeNa2h3gHlniIyKhHqQiYiGcJJ3ipGDf3OSdH+CaGqgfYCXTXCtfF54q3bJfF9+fImNXoh1fHM+e4Zykl2KdnpwF2p/emuQbYR6imaFkoF7YyNOWFmDCo9reYWHcoN6f3Z/fB2eboiHbGxoeI+ndH53g1l6f4Sac5V+hVpsdmSBdHVsfWaGf3+Ff4iAc29rlYCAd317b5psgop0fVxCaleJepaHnm55coF5dG91hH92h49xnXBWGIA6lH40eaJzlIKEe3iETIt2fHt/R4J6aVx/gn1pkCkEg3/Ol1yEsGmLfHl+dGOGdn2BhX97fHZ5cXh6S3KMeXpugopuiVemgYKEeWhqc253iHp2g5GNh3R9f2qIfoWagzCAkB2IlHhYooaETGBof3tfgaZ3W3pyeHp/jVGPdIVyRHKHdY1ciHV0byRpfH2gkWGHhY5ej5CUcU4rb12JikOQbXZ/jYF3fG90hYUll413h32EeH+Kq32BjYRbfYZ5k3d/f3Vie5mCgHN0g4RpdH+NdYKAdV5eapJ+fX53doGZf4h6g4FdQIZfhYZrkaFgfINSjGKAdmiJfH5zdZd0gIx1h5KJHHucf3p8b3tpfIuIbJF7TDx8eWVjd315ZoNnEJGCzZZqjSVpg4p/gIlhgm13fIJ/j4CafYh1ZU9xfH9xdnqAiH10pYV6jH9vanmCfXKLl4eBhJSMh3tmjHWGmoF/epZ4fo1+aqB7cHdObZp7YHuudMt2dIB8j5FTk3p/h0B3hm2JV4iMd3web3SCYYx5fnqAYnmHeX1uH0FcV4tBjmt4hYiBfImOf4F6JZVrhYp3bHOGladwgXqAYIB+gYx3moWMYn2LZYdlb22CaISCeYJ3hWuZWGmRhoZ9gX95l36ce36DXklqWoZ/oY+gZHR1d4hrd4Z8iXOCum+hbmUfbVqKf0NznoF/en56iHhTe3iHcXw8fW5ogXuFd2KCICl5iduWeIuqdYeAeniAYoaagX+Eg3d6dGpsZXtPjH98en+Lin6HZJKHhIV5c21zKn+KgoZ/kYSFf4CEZHt7iZKFYoCPHIiOSlmehXphXGqDiV57p35ZdX19e4KRX3h8hoU9ZJNujFqDg3p2Hm9whK2KbId3iGJqhIRveCJ5W46GKIZgeoSIjIhjemeJgTmRhHmKg49xbIaheILif1CHa3OId15mfXV5kYtzd3Z5i2pucpBzgoCEkGBme39+co5xgZR2m3eng2ZBe2GIgkuMoGh4kGuGYIJonIyCf2t1lHSCkYeIlGkjeJ13fH17eGV2d4R1iHpzRoN2c2V3f3RjeWkQiIvGk2SFOlh3gn+AjFmKnHV3e398fH97eWhuVGt+kHJ7kIWHgnSSjXCHg35lb6J9fIaWhoqLeoGKh16AgYmXg4p/kG98j1NqoHlmYU5tmIBteaJ4xHh8gnV8iGV1cnCIP39uco9Zi3+CdxNmg3JviXeDZohhiHl9fWYhTVlyj0KJaHl8hYKOIn+BiXoyfml/i3dxd3yHp21+aXxfdnd/jW+Mf4FUcY5rlWl0fYpogHhUjoGJf2pWfYB7hIOEr32WXoOPcodeNmlVjG6ngKJtdniJgl5zX4KVc5N0b5J5KiF/YZaEOIWRgICAfW+kb1d2d3p3fTyHcHB/eX2GaI81E4mMxJWEfa1acHBwuoNckJ15e41/d3F9a3FmfFd8eGt9jJKGe4yNkYZ9gW9HYXsPZ4V8hYGEgndwfopaiGiDkH9/iZElgpZTXp+LgV5ha398XnykgWNve354ioZ2xW92dT54lHaJXXOOgnowSWR8upBojpSPaXlqfY1uInlefI95hWx5i42AZ4V6gYuHN5lqh4uKjHSCjqGCgFyGb3+Ee358V4F/mYKEgY92bnKEY46AWo53ioNhhH5/enOBfIcUj3d/fXNsZz9oLJN6kY2hbnp/hIV0dHeGoXCQkXd5i4Myh3qYjB+NnH+hgpCFZ3WFHX1vfX5Be3BsbnmGnUqKLQmJhcaOe4auYot0eZ56YIiJe4OHcHt3p3B8dnlSeY9wen+OhYuDd5aDgoN5jXJ9gH5/gX6DhImLc31/Y4lshpSEh3mJJI2Jd1yphJKCZGN+dGKCoINYgHN+gIxBXZdzhHVBf4F3il+AjIB2IWt6eKKSi4yFhmN4m5RtfixsYGuFeI1Me4CDi1Z9c3eIiTeiil6Ngot9dY2ue3KggW6Dg3iSfHkAhIh0kItze26Ag215f5B+f36bYzN1gnt5e4F2aJlyf3yZc19Gg2SKhHCDnmZ/fVd1ZItpdImCfIV6e2aDj6J6l4oufKCFdmWIaYmDf4lziXCRPnuFaz1zdHeKnGsElorNkW6FI1p+cYSAhGGAmm94gnp+e5B5dn1qVoGIfm6FjYachGqQi2V9g1tvdIuCfoWPipOXgp6LiGqRf4WIgYpslniEen5lpXx5fE9wf3lgeqp4yX9uf4CFjleJcHp9RHyEeItckXh7dAxrdXhrj4+CfIdhj5N8dJEnM1ljgV+Ocnx4jnyEf3+VjYEyjW+OinhxeYCVrnV/enpXcIF/qICNjZCDf4JainN0cYRkjX55knx/nmN1c3eBhXh/mmOXXniDdXpgQG1fknuRi59reXqEeFBzdICHd4mRdYKJfTCEOKBsN4ykf5uEh4J5f1uHc397egCDfW1UeY1+cIYtDoGBxJZ4gLN8iXh/fHlhiJd8gId6e3mFeXd2ek52k3mCa5CFen9kooCEhHhscXp9eYR9foWRkJOBgHttjHKKlIJPdpIkioZ+XqeEiXFgYot0Yn6iclmAdnx8jndfmmuCfzpfhXaGX3dyfHAhaHl7n5J8iYGNYWebmHI7LmJiiIlkh3B6hoqAX31veoiFNn+BgYuBh3R8jax7hKSFYH2Jco94eHqAeHuSgX54doSLa3d/l3qChYaAMG2Pe3t2kW9+mHR8e5B7Y0qIY4iBZpGfYX6FVX53hHJ2hXqHe3ZzdH6PT36cfxGRnX98fXuHeHqCiG6oeVIRfXdpWHV7d2KFYxGOftGWaI8nSIN/f3+GYn+VeXiCgo53mHmPeGFReoeZenWAh4V7Z6GNfHqNVW16hX94iJKIjHqMi4iEZ49oiJF9eXSTb357fmaieXNtS2efd2B6qmrJeXF/epKMXLRuhoJBd4dthleAfXl1F2x8eXiRf355e2JxmnV7gilFWVqObI5td4aLeoKCgXmBgCinbICKam51f5aqd4F3fE96hH+KeJyHh1iCgV2KaXtudmiJgIGHhItjdnFjhHqEfHmBepdzZ4qAf2E/dFqTd6KOom15c4aHnnaDf5NtgopzhHtiIINPm2stmKBxe4CKfYh8UH9xhH9/RH11aHd7inldlCUIiYvOl32KsmWIgXeJd2OOiX9/hYl6gnp8b2iAT3qKf391j4p4h0+cjoSMgGtweGJ9fn19f5SHjoKCf2aHeoeVgjiFjCGIilpco4qJZV1ml35ffap/YXiAfIOIjWSddo2FRll1cYRcjXpydR5ufIWrkmmIe4dicYWFfF4pYF6RiHeOZnuAiYeLgHRuh4oseoZ5joWMcnSNroWG3YBKfnd1jXdyf3llhJeOd3Z4fIFoenaSgICDbZ51a4F+fHmVdoKYeol+moNiRYZfhoNThqJmfo9ijEOJcLaEg4Ztdpt4i5NZg6B4IXyefnp+fHdedYCRcIyBeUmGd2Z3dIh6cpBqCJKLyZdmjyldfIt+g4hZhJp4eX2DhXqPdIhwaFZ1apR6cImHg31/mI1mjIF4anCQhIeJkIiEkYeMinVjhIuElIKChYxxhJhnZ6h/aUlTZ4uIZHmjdct4aoR9hI1hjXqEj0CDhXSHW4+BfHokcnx/bY2Ye3V5XHt4eIBsGF1aR4p2h218gYl/ioWaf4V8LolshI16dHKSg6tzg3SAWHyBgodwmYiFYXuaYJFudnGGa4F9VoV/iIsEWmqGfYSEgZJ8l2Wvf32JZzxuVY5hjouhaXt3hH5ucXOMj3OLeXWJdE4dfWWbl1p+oX91fn15oGNdjnV6d4NJenVnenp/gEaoLxiUi9GWiYSubXSFcbB/W4qDgHmEgnd4gnh0an1VgXd+gXKYh3KJWn+CgYF4RGOAuHd9fnZ+i4l/eIiRXXtpiaV/fouQFYWfZVufiYRtYmuBg2R/qIVaeISAdYGBWJ2BkXhLd4l2il+Pj3R4F3KHicOQYImNjmttlYKMbhBdX5yIXYhqfpOYfpdgeHaKgzJ/dXaKhpBxb42xhIiagmF/fXRyen5ygpZ7pYhqe3KBiGt3cJ2Eg4Cmiol3iH5+5pB7g5eCenaCi2c6hk+OeGiNoGZ/gm57MYxqf6aBY3p/lHaJk4+WjHkqkKWBf35xfQyIco59gYB8Knl7bIhzi4BidmkNjYrJl2qCI2gveoeDiFyGqHtyf4GDdYWDjXtvVHleeWlyj4WDgoKTjHyWknxncbCFfomoeJCAiYCQsViPfIeYhJR/jV+Gi35ppXt7e0xhnYNhgKV9y318f4SBh1W7eX+ARH+FbotgiZF+dyt2XoBBjop/f45veYl1gHFIZFo4jnqHaneGpYGahJqTioIugnODkGhue4+Nq3h9f3xhen+DinSciIB4goNxhnlxeYdrdXeVh4GBh4BEgop0QHl+f3+ZcXx9fnZhQIBYj31wjp5oh5VahHyMdm+RgGuCd6F4io6IlptsE4SXiXR5dpaPd56VcX6DgkCAfm5cd3uQfo5pC5OF0ZVwhyl/fXyGf4phi5x3dICEmnyKg3t6cFOIkYJzh3mBjX+EfIZ4iYRLZHqMiYJ0koyPiY6IhoJhj22OkIKMcIlzfn+CaaCAU35Qb4B6Y36kdMt/eoOBg5FZnW15d0B8hXaKWpBygnkYbHp8bZB7hX+KY3SafXugK11bZox6jnt5eY2Df39/hZF7MJZvgYd+dXZ7mqt6fICDT319hZKHiIqPdX+BaId0dG2DZZWAXZB6jp5sWXt7fXd2foEflWt/gXl+Yzx4Vo96nYmganp+f310c3yBgHODknWQhn5Hh0mcejOPn3q2g5RqcXZQfXqBfHtChYZmZ3aJe1yGLhWBhciWd4WwZop0epZ4ZJCZfn6Bhnh/d3l6dnpVeo52dH6KiX+FeZ+Hhoh2aHGDgXp/fHiEkZKXfHt8aox0hJSIdHeLLY97f1+qhJFYYmaLcl+Ep3Rcc3R7e4IkZpNzfnk9d4R4hFl8hoF3KG53fZyShoiDiGZulJV1bjJ9Y2uLdYloeoqLh2R7dHWKiTKVi2uNgoeBfo6ygoitgFuChXSxfXZogVt8lZduenWBhmxvf41+gX9hZzp0iHZ5gXR6apl0jXqieF5BjmOPgHaSn2Z+gl14UI5pbox9f358oniBlZyOon8PeJeCdWeFeIt4nI9xq252OoWCZG14eHFsiGoZkorPk3OSJHuEf3+Bh2WDo3N2f4SOf7t0e3hZVYOThX13eIZyfnKgkWuCfml0dYt/gYaSiYaTmp2HhGmMh4WNgot0kW9/eHVnooBsfklndnZieqp3zINwgnyhjFzNcHJyRXqFdoJXkH97eRNqeX51kHd+d3tgcI54d7gqC1pjineLd3eCjYB2fn6MhXwunG+JjHpyfXuRsXt/e39VfH+ChoKOkI5Ud4FhhHZzcn9nkHx0joB9el5VdHuAhH58pGWVc4CBd3liO3JflHeRj6FxaXqFgZNph3+YcYeMdYKOfC2IPKR7LX6dgIKGkYF/dGOPc41/eReGeW1teop7WIUoE4qJx5eKiLJuiXKAkX1jiqB/gYl7fGiAdHJsg1J4j3l3h5aFgn9hpYp/f3pfcnR5Z4R+eIOrlpODg39miU6FlIQAeYYginp5YaiFh35eYaN4XX2of1mBgYCAjX1irnqAdz+AeHR+XZKHe3QabnaDoJSBhoCNZXCChXFvJkhil4hzim59hJCDbn15eoSGKo58f4yGjG5zj7F8hN+FYoN1do95eXB9YXuJg3OAeX6HbHx2h3V/gGtuTW2JhX94n3d/mHV8fJKBZUF/ZYV+YoegZ4CLXoJqgnG9eIB6iHOVdo6WfJ+sciN8m4F2b3p/bnhoj3SidX4QcnpuXHiAfXOAZgiLi8qWaZAmRHyCf4aFYIyZdnh7h4GFg3qRbnFXc4+feXCAiIKFbpCTZnyOTmt5j4SAh5SJiomMjY2CYox6iI6CkH2HaYCAe2mlgWduRmaVg193qW7JemV/eZWMX65/eYlHfXxohlt/b3xxF3F+h22QiYB1f2J8g31/miFCWWmLbItre4CNgH9+gXd+hCymen+KW2xvi4ivfIB8gUd5g4GPf6KAhWBgiGmGd3lxiGyAd2OJgI6AbVJzgYWDfYmfepZxf5B4hWNCbVeSapSHoG54eImEh2p2lI9vhJt0kX0rF4NVqHQ+jJtcboGGc5txYY56cnuBSYp1aJt8jIJjsDAHjYvOlIuFsF9zhHikf2GeqYN5goN5gX56d2x3VH+Gfn54eoZ5ilmFg4qIfyVqgkZxf3t0f5WJjXeAhlyCfISYf2qKlBmHmiteo46AUGJlkIxif6p8W3x2e3iRg2SniIN4QXOHcYlci4V3dSR0hIbTkWiHjY1ucnCEf1wVbl+ciHuLaYB4j4STeXt3ioEopZNyj4GYd42Ls4OAhoZTgH52hXN9gIJog6eBZn56hIZodniTgIaCeHZ+boWBe6eXfYKdc31/i4hdQoVaiX5kiaNmgIJjhzuHcKZugW9wfIh8ipSFiJ52JI2dgnx/cIIAfX6Hcn97eTx9fGp+d3d7P3loGZKAyZhohSdmLn2EgoZfgqKBeX1+g3qLdZd+UlF7eYBsdYqEg4GBooZ5j5Vlc3WrfH2FmHmIiJSCkm1ai2uLj4SFeoVygJZ8aal7dGRSaYOKZICqb8x+hoR6go1heYV6ljp9hXWNX4iGenwVZoR1dY2Hf3qCan2GeYZmAjVdVJJ/h2d/hpuAg3yflIJ8Kn+bgZVdb3KClq5xiYJ8VYCBf4x5oomRVnakdIx4e3SPZYWAfYyBiYhhOnuJhIeYe3p9l3t/j3eIZURxW5Jvm4qiaH19joiifHiQkXuPyXqHen4eh2OXeC6Kl1B6god9kHldiXh4dXlDkXlsaHyQhTOMMByQgcaUg4S1YIp7epWAYI+mgn2GgXl3gHd+eHtVgIJ3gH2Ph319b42HhoR8PXR8S3x6hHk3kIWReol3ZIV3h5KAfoaIHY2YbVmni4h3YG6JeGOArX9keXR+e4yKW52KeoA/c4J1jGKJf3x6I3iPkLmQfniJjmxwiICBdidgX7KJgIhndn2ShWuhfXmNhDeEo2mQipB1f4iwloKhgFCIfnmEcn99foB5qnyNeW5tgGWMcHGNgIiNa1h/fX6GeW6Bc5h1fIN5f14/eV6PdJ2HoWl5en2Jan6Ve4tviZVzo4d8IIZTlnsfjJF8roGFf3l/dQB9e4CAPH97Y4Z5hJhbiDYNj4fGl31/r22LdnajfGCKkYN9hX97fpd8c3B0UnqReXhrmoh8g3KdgIGIeVdxf4N5gTd4gYiXmHpsf1eNgoWXfXd2iSGNe4Fcq5SUQGFqlHRegqh2XYN5gXqNhVqNdX17NH2MdYRYe4B8eSRwenmgkoJzf4dng4aZcGMuZWBwhnmCd3qGh4defnN5jIc2hox9iYeGeneGsH+Bu35fgIV2h4J5f35xd5aTg391eIpseHaOhIF9d3eCgIV8P4F+f3+Ze4B+i3tiSZJfkoJzh6FrgJhvhFmReHWMh2+EeIVzhZF9qp1wFHKViHyCgod7c7qPdox+bBKAg26Len5raI1pFYmHyJNzhS57f4KFgIxlhZ98dn2EroSnfXx4Yld5fIN6fXWFiIKFjoN6hoJlZ3+LgHpxk4qKj6KKhYhikHCIj4SIcol9f3qIaal/VI9OcaN2X3+odtOGf4V9iZJgsHV7gzmAiHiDU4yIeX0ccnl7eJV/fn+CaIGMdGk8MExcaoqCh2x7g5J/XoSBf4qFOZV0hIV6dHqCkrB0gIGCTXqEf3+BiYWaVHKBbYN6eGiFZpB8VY18jotpbXaAfnF1hIMOmFt8gX59YUF2WYp0nYmgbn58f4GUbYiGf2+Gg3+KkH4mgmWdfh2SlHuviqhqf3RzHnl/fHxFh3hreHp/dCOAKxyHhcmZf4evZol9dqJ+YJCkf3+GhX57h290Z35XjJR9fYCYiYOFbp6MhIJ6aXV+fIB/fHaDiJaWhHh9ZYVjg5aFXXyJH416e2Oqhn9gX2uLdV2Ep3tcf3uAe4VGZZp3dng8X311fFeJfX93I214gaKSfoqEhF53gIxuiS6HYnKJf4prfYmJhXp4dHWHgzKXf3OKgol0eoyxfojtg2OGcnOde34ShmF3iJFYfnZ/kmlzdoqAgn+cVlJxhH56kYl7ZpmLfXyyfGRFmV+Ie2qIoGRol218foV1c3+Adn94eYCGmaKUp28IiZiBd3mLe3B3eol2iXJ9P4B/amh1fHVjimsJmIXNlnWLJ2J6gYCDjGGIomx2fYCAaIdzd29qVHd8lnx9h36agH+KkZuDgXFpHomHd4WUhp2YlKWMh12IioWDg5V1i2x/fnpppnpcXUtmeX5lfKZ/zoRzg3uSi197f3p/O4KAdIJZl4V9dxxwen9vkpB9dINndJx4fl0oGlpkgnWJeXyBkX6Chn+Ti4M0e3WCinhufH6Rs32AfHxfdH+Ag4GOj4ledX1kh310cnhriXpZjXiKgWVceXiHhIaPvWWYWH6CfX5kRXNZlG2LiKJsfXqMfkdmc3+Xc4m2eo6YFhyKUaOIKpCUdHaJgnp/dnGKfXV+hxCFemmPdoZ9cIo2CYyPypeOgbBxb3p1qnpnjZ2Ce4Z6fn2GeH5wflVzlXd7g6eFe35hp4qFhHs1bX84fH19d4B/k5KHhYFci1+Gj4JqgoYdh4pwY6iJiWJgX3V+Xn+oeFB/fH57jH1fioV6fzlffneEXIiDdHAcenqHqZWDiYmRaHWUg4N/JWdjhoV4iHCBi5SCent3dYiDMo13dZCIknd+jbN+g5qIaH+GdIJ4c4Z9boCXfGx7eH+MbHl2kYB4fX13YHeNiH6doX2Cm4V/gIWCZEWIXIh7ZomhZIOEaIJKim54d4FrdnqOf4mSipeoeByHl351hXmELYFxi32MbnsRfnpseHd8fWlwZQ2Mi82acY4mSy14iICEY4Wkd315e4CFiHeTfGdXa3KXcICQhoWAcpeJeoagOHR8kIl6iJ94iIqXhI6PWY9ijIqCkHx6bIOLeGeoe3SRSmi4gV19q3DNfGN9e46EX6CAgYc+gINvi2GEd3p6GG99hVWTkH93g2p9e3qDnyQ7WkqJfYtvgISYf4Nzj5KEiTCLj4CSjWZzfpmwe4Z7fk16hX+SdpGGgmFtkW+Me3pye2Z/en6LgIqAa2V9hISGkYp/epxwgql9gmJGcF+Sd5KIoG5+e42AfHJ/f413h4N3kH9cAIRmpH8AjpeNbX+EfqKFX4Z6en19UIV4bYt/fYJ+mC4ag4XHknmHsnmEfHqMfl+Il4KAh4l6fX95enhxUouPdHp/gId8gF6FiIGPe1x4fnB+en15Po2KlX+FjmCFd4GPgn1/hBOLi4ZOqYqFYmJqkHlfgadvW36Kfn+Ch2K8gYF+OXiFd4thkntxbxx2enyuknV0hox5enuBf24wd1qei4SJcX2Dl4ZncXV6jYg3r653l4WUf4aJsoiInXtUgIZvin1zgYBde6WOf3p/g5djfnyOfYeAm398doODeJyPeYCceYWAholeOopdiYZ5gaFqfoZngmOReHKUgntyd5WWiZKhhqCAJI6Tin9/doFSf3mIcn90eEd+eWp/e3t8ZJlpEZp4xJdziitxhIWChpNcgpx3dICGgX+Ge5t/aFRvd4N6fYyEhYGCh4N7YIVldXyWgoRxf4mKhpSFk5ZiiW6Bh3+EdJRyhX5/aKeAeIRXZX91YoGqeMh3d4CCi41aW4aIizeAgXaLXYSNeWofdXmEU411PX+CbH2JeXluKkJeS4uEjGl9iYp9gpihgHx9MHaMiZV6b3vKka9ygoB4Tnp/f5B/loGDcXuVc35+d4GHanlii4iDhIpyYX2Cg4GIf3qCm3OGfYp5YUCKX5J9YIigan2GaIdCjXNzhZB/fXeCi4GOl36bdEt5jYZwgXtig3mujXOMgG07gH1qkHx8nVeFZxyDisqXd4czd4GIhH2HYYWgenl+e56Fh319ZVxWeH6FaW14g5J/f4yEe4eDhlp/jIB+io1tgY2Si4WFV4pyi5SBiXKGcoBvhWunfG+EUG2adF2BpXPJhnSIgoSLaK1yeYg+eI53gEmNgX95JHZ6fHiPhUB/h2V+m31zVSlOX3WPgIlwd4CLhl6EfoSDgkqbdIeNenZvf4uudoB+g1p+f4GShZCHyGt0hnmLeHBshmaOa3eMe5dqcFp5fn6CfoOAfJllf4R1fmQ9dl2PbaKGn3CAfXqJfm90gZlohYpof49+MIKAnnAwlJp8iYSPjnt0eYB4gIF8FYR5aI17hHA5jSsRi4XJl46GsGmJh3+ofWKOmICBhYB8e3x2dGV7UoaIenV9gYaBh3KZhomFdm9senl/fTh2gIWRm392gVyDfXyYiGd6hSCKeH9gqZp/UVpvf3pegaZ+WX6BhH2Nhmqkd354Ol+Jdn9Ikn6AeSRwd32ekn1xg45feYSBZ2wwd2B/jYKGb32JioBvfnd4jII0jHV2h4WGbn2JsYWE94JhgnJy93x6YoFldY6Oe313cYxtc2yRg4KIeGN1f4OBRoWBeYCae39+o4BjQpRZjoFUhaJmh6tvhmOMe3CQfW2DeZGMi5OPiKF6G3yVhGsQgXdvdZCSeX1+fDR+fW5ld4F5V5BqHI6GypZygy5sfomGg41lhp55dn5/kn2FgIFrbVh3iJl0fo2AhISFmZJuiYN8b4GKg3tumoaGm5ScjIlTjHuIkYKMdY12gH+Gaqd8j4RQa5R7X4Cof8+CeYV8lZBraH1/gTeFhHaDVouLgXoecnt/cZWAgn2Ia3uEfG9FNV9dbo2AhG18f5F7cIJ/goeCP5R6gYp7b3OGkLJ5hX+AXX9/fnSBkZaJb3eBbYV5dG6HZYxy9Yp4jYBgcoF5f3WBgaIdmXx6hW2BY0V2UYprlYqia4N8h39SZnaHjm99pHiHiGwQhJmgdQx/k3yTj4lxhHhof3x0eH48g3xpZXKAeC57NQaNi8mZhYetaW6Ia7p6aIqdf4KEfHplg256b3lXfot7eH2BhHyDd6ODgYF6XnOEbwt3fnaCjp2Ne4B+VolygpKBdXyKFZGAemKokIRRXmRzeV2CqHpZgX1/eYk5bI2Ffn44d4F5gFqCfHx6H3t4g6GWgIWFgGlvjY58bCd/YW6IfoVugYqSgnh9dnmGiTaAfWqNi417ho60goiggV6FgHWGfHtpgWF3jo0AgXh+iGtzdIuAeoOmakV+goJ/hIh1ZJ2CfHmef2JFpliPfmmHomaNh2l6Zoh0dJ6BaHp6g3SIlLWJnmwRjJCEdAGAeQaGhYR4gG1yM3mBbW5ve3lik2sZiYnLmYaHLGkyd4eCjWKFo21+eXuGeIp/f3pkU3eCd2+AgH6Xg3SWi2OFk1t0f4eQf4OjdYSRm5mTflKKc4yCgYh4iXN9goNnpn57e05po3tdfal8zoN0hXSNiGd/en+JNIJ9Zopei4V7eRdveYBgk4iAeoxrc4V1fG0jTVxdiHyGe3+ElHyEfpGhioRDlnqAkmVxd3+dsXqDeXleQ35/iX2Hh4hbe4hykWp5bohmh3Z0i3OHhWVHgX+Cg35/oGabdH2Ien9jRHFZjH6PiaJufHyPfTJqg4KRdoeNeoOffCCLWp2BAYeRYnSEhX57f26LfXt6fDWHeG5me4eDaXQ1F42LxpeEhLBxiXZ/jXljjZp6gIWBfnmDdXl3eFR/nHt5g5aCgHtsmYiKhnpZeXl2AH+BeUCMkJeFhYBhiWyCiIJmfIYckH2CYKmGiWZgZm55WH+nclh9gIJ6jYBqvnV+hTVmgnaLYX+Dd3Afd3mAl5R/c4aHanGBg35oKGpipoN+iHB/gpOAaHB5e4SGNoiAc5aNknuAhbKVhKKIZ4mIb4V7eISEaneeiH+BgYOKaHt5kXR9g4R2VnyDgn1vhniAm4SEeIKCYEaLX4yFb4agZ4CFa4Rki3lwj4N/enaSjoeQo5GkgSyZkox0gnyGX4xwhW+FZngPfHtsfH50fH2eZxB8hseZeIkpU4V2fn+XYISkbnyEhIN/iHygfWtUc46aeXmLhomKepGKewCXRHV+jIN8cIOHiYSXhIyHZo5tgod/inSHaIF3g2ilfnZ7T2qieV58qHnMfoGDfIOMYI11fYY5fXpvjGKEfXdnGnd5cXSUeUN5hmh+gnd+izJQWliGgIxqfoOWdWuBfn9/hTCHfoeWZ255k6KweYd4flh/gn+WhI+BhWF2lmeGhYN0g2KFgn+TiIh2eFp5godseISGbZt7hJZ9g2Q+blePdZGEn3B9eYF/Unx+i4t7gpZ8iXhmE4JxoXVGcZVMen18f4uCaod3eIF/D357a1J7i4N9jDUUjHPElneFrnWKeHqIe2CImXV/hod7fn53eXZzUYaCd3l9i4p8e2aNiYOWeD54gIR8gjN+g4qIjX6IdWSGeImIf3l+ix6Bg4heq4SLWGJygXZeg6V0V32MgH6Gh3HVgXKDPHZ/eotlh4Zxahx3e4Wlkn+KjYtwd49/fGQ2aWK1iIOObHyDloBugnt6kIc2lZx4lIqMdJeMsIKDkoBggYV0goNwgH97epuRhnpzcYVokWl4in2Odmxgen+ChXuAgoGZZYGDeYFeO3NhinefjZ5wf3l/hIN4l4aUc4uHeIiBf0aCcpx6FYeeenmAnYp7cWaId319eUGAdWyFeoKSRYA0GI2Ew5iKhKtma4J3pn5di5eCgYl1e3uEdHNOeVR/jnl3d5GCg4J/l3Z/h35ZWoN1fISFeD2JlJGEdoRigHt9mX5neIUejG1/ZauVjWJfcJ14WX2jgVt/iIJ/i39aq312fTVliXt9TIyFgHkpcHh+oJB/iZqRYnuSf25pImFhfIGIgHN+houIe356eoeFNJiAeYSGiXl+ja2Bgv6DV4GKdj+Ae1mDbnWPi3t5cnuGbHlYkIGDiIdmYn+DgoCBfHmBnVl/f51/XkOUXox/ZoSiaYCbbogRiHNsh49/gG6DgoaTiG6dej1/lIBrZ3+MdHl4j3qAgXdAhnZwfXd/YmCHaB2Kh8eWcYc4WoCFhICJYoCafH14gYB9gHh+X2dacXiRZHqOgYmDfYGYbYaCqmSJhoKAiZhxho+Un4yIV4lqhZaSjXWLdIR6i2qlfE2ATmqfemR/pXfOfHeIfJGLZoV4f4Y8gIh5eVOCeIR9H3B6e2+SdEODimp9l3ZuWjFHXWeNf35xe4GNfW6BfIKEg0iTeYKKe3dyg46ve4Z4gGV8f3+MfJGAjmd4iXqGfXJyhWiLVWSHfoaTZlqDcnuChX+UfZhbfIN4gmFJbVGIYJuDoGyAeYSKYnCNgIZ6g5x5e4BwDYGIoX4RiZN6iIGDe4h7bIR7cn16PYF9boJzgnxNiDAZiojGlYuErnNxgk3Lf2OJl4B9iXV7dIB+eWpzVIKUeXx5gYR+gX+egImEelloiHBteD95fYOTlnuEgQSDg4KZf397iReLe3pkqZ+PVV5rinhfgKV9Y4GChHuUhWODf3t6NHqKeINZh4d/eyF4eIGglHJzk4dpdX19bm0tamN/hYZ8cX+Kj4BwfnV9iYY3nXx5ioOJbn6KsoKAr4RcgYVxinx7fH5keZCOZX14fYZsdWGVgoOAi2hthYJ+RIl8eX+cdnx8goNhSn5Ni39ihaRrhZFmhF6Td3yQfol8eX9phpSNlKF1FJyMgnV/fHsLgJqNfn55dCR7gW5lcXh5YpVpG42Fx5hshTJwNHyNgIpnhJl4Xnp8j2eJoYd6ZlR3hoJgd4OBhH9/oYR6g4xrdXyDhm5zqnqMjJOHkoJAjXKJjX+NeIp6goCGa6h9Vb9UbXB6W4Godc59fYZ/gI5jvHeBjDR/hHqJXIB5e30ecHh7Z5Rlfn5/bHiieXRRMG5dYomDgm19fZV8bH2LkIx/QZl5f41qbHp/q7F5hnl/YAN+f4iBioiGVnWIcpZ5dmyFZZB3ZIp4in1rYYl7e3N/fHoCmWl6inWCY0ltVpV9moWhb4F7jX9na4B8g3eFi3t+f3wWh3igfASOkGqFgox3g4dxfnpzfHlAmHptdHV9fkecMiCShMeXeYKtbYd3F5V7YYqYfX2DgntzgHZ5d3ZUjI1zenx/hn95dLKGh4N5XHqAeHl7endCfI2ReYSBZYt4hY2BfXuNHLFygWerhpBrXGWneFuApn5fg4KGfIc/aY16foE1eHh0i1+kg3t4HHV7f56UZXaKgWl0kYprZzB4YnyGiIVvfoGUh2d1dW6HhEGRgiWVio6BgYqxhYOagWiGgHKAgHhifVN3lpJmdYCCiGd5eJB7c4KLcFqFgn17e39zZ5qFfXqMfF1KlFeBiG2GoGiEh2l5Yox8dYCAen54f4GKk9B+oH02eoyKfXB/f2aFgoJ6fGZ3P3p+b2t5entogGkai4fDlXiDMlaDeoJ+pWCElIp8f3+EfIaFkn1qUnGKgnZ7g4CVhYGli2iAf1J5hoeFgHOLiYSPnZOOf2iMb397gIhyjXSCcYNqqYB4hE9tfnZbeaaCyoB6in6BiF9xbnqLMXyHe4xhhI9ydRh0eXlukmFFfn5vdX95cXYoYVxmgYWLeXyDk4NigH2XuoM7nXKEm3lyfJicsXSCeHdiOIF/jImMh4VieYlri4F7cIRnhn16iYGFdW5ahn+Ab3OGn1aaa3yBenxeP25XkHmPh6FrfH1/cFB4gH6IeYKIe4eIejWHZKmBP3aLfnaAfn2DhXWKdXp4fg1+e3Fme4aDZokyFpSDxJV4hK9mi3F/h31iippzfoiBe3aBcHN4dVR6l3x9hI6AgQRxkoeGh3pXeH95an83doSJkZSHgoBtjWWHf4FjdYUki29+XqeFhWFkZZ1wXH+jgWF+gYKBjH9wv259ejRnc3eNYoqMfWQcd3hsnZRpiYaFb21pgXpkMGhihYKFjnB+iJSOaH51eoyHN35/eJaNjYJ+i7OVgTuKdHqGd3uLd4KAdHWZlHaBg4GLaHl/ioh/g4doWIR+fT10iXheno+De4J9Y0WKX4OBc4SdbIOFenxcjHN1qoWBg3uKg4OSqIOjdUuNlol5g3iBdY94i3yBZ4BIcnxwenyJgX58aByZe8GZeIg0W4qAhH+PYY2bdXqDhoSBhn2hf25PfIKafHWVhoaFhJWReY+WO3l9hYWEiIaKgYmRhpSBbYtqgIN/lnWLdIh8im+qf3uHTG+Qd117onjBfYiEf4ePYLBwe4U6f4JwjF59gXhbJnZ8enKSXoR9im16iHtliDRcWmaEg4xtf36UeWN7fomBiTmmb4WQZnF9f62vfX96d156hoCQgI+CgXiCjnZ4fXaFfmx7VpGGhYSWY2d7ioSDhX59gppkc3ycgWc+lVeJf2B+oGN/mmaKWYKCaKeMg3p4gnKHko9unXU+jY+EfWB6l3B2fpN2g352QH52dHV2fJFSeG8dkYPOl2+FLGotiHyAhVmElnl7foB/f4Zve05vU21/lnl0iJSJf3yKrmZ/g3NWjIN/goeZkIaLlaOGhF2FcGOWdo50h3ODb31ppYFIk0tknnxie6J4x4NxhIJ7j2p/eXKGQXiLeHxXh4iDfx9zfHt1jXmEeI93eZ54aFUiVlxxi4eFbn17h4R0eH+Hh4JFknmBhH16eX2Pq3iDdnpffX6CmoCVhX9yd4hzg3tvdINtiktjjH+FiWZyhneDh4J8kIGYQX2Cd4VbPm5Ihm2gjp5qgXd/hHV0bn99YYmbd3+Bchx9eqF+TpCPfHd9hHqDcmeIe3F4dD6CdG5pcX9yOowzGY6DxZeWiqpvOHps0XxhipiAfIeWeHaCfn5JdVR5i3l0do19foN9hX9/hHprWYdnbIGHekaCk45+hX9Pg39xmYKFfIQXjIN2ZauVjUNiaYt5WHqme1x4hH96l4ZZf396gTB2jXh3WXx/f3opeHeAo5NsiqqJa3eIe3+FK1xieISHeXSAho6EbH93doaDN5d+doSEinSAha+Cf7qAToCJc4qCeX2DZXmShl98c4CIbHxFkX9/gpBhcYOFe4CJf3mCmnF+eoSDYVCFUYZ5XIagaoeAbI5Ni3Z4ln9qe3uKbYmSgHmYdBmLg4R0fHqCGn58hn59eHU5dnptgnGBbleDZByHhsiWZYM2ZTmChX+KYoKad250eYF3fYOJdWhVbn6AonJ+fIV+gpqGd4WKbmZ5goF/hrJBgY+YjJKCSodyj5KEh3uMfoR6g2unfHqiTnCXd2B9pHTJe36GgW+JZpJ4fog4fIZ+hFqBiX97I3F2dWiSaUV7iXF9nXhmUi5aXWiMiH9vfX2TgWx7ipGAhUiVenqKbXR2gKKwe4NsfmZuhHyAfYmQi2d0iHOJe3ZyhGiMXoGJfIaFblGHfHqFf3t/fpZqf4hwgl5DbFaFdaOIoG6DdYyKWHaTf4xvko56gGB6F35/nngOgoRvgH+Bf3ODb4N8dn10R4d9bIR2f35FjTgahoHElY6Er2KKhHelfWOGkISChoN5ZoCBdnV1U3uHdHdzj319e3SGiYOEd2Z1enR3Zz90Q4OTkHKHg1WEf3OVgYN7iBuPcnplrJaOQ1xtp3ddfqeGZH+KhHyMhWF7eH2CM3iHfYtgbnp7eR50eXuZk3FIioRuc4R9bn4sbGB/iYt4b3yBkoNseXhxioJBn4RujYaMdH6GroWCr31agIhviH56fIBhdJaChYN5gIdpe2yPf3+Cg2tthnt7R4OAcYGZfXx5hoJaSIZI3YNqh6JnhJFpgWmMe3F9gmZ7e4t4hpKjf516FoZ7gnt6e35ghpSHfXp4dj2Efmx9dHp7bnllHY+CxJR0fzJog3qGfJFigIttdn9/jHeLhpJ9aVFyhHt2eXl4hX+Bh4l4gH5hdX6HgX1PjomBi5KHi39gjGmCioGFcox3gXWHbKmCW4JObop2W32lc8l9gYV6YYthXnN/hy59f3iLXnyIeXsTdXd5b49eSH+Ibnh5eWNgM19cYomOiG17f5N6X4B8eniFRpBxg5R6dXmPx7BzhHd4WHSCe4OIi4iJYnSHa456fW9/Zo53YYZtjXppboh7eU52f4QYmHB8gnWCX0VtRYx9noigaIF5hHl0eIWAnHKJj3uDfHsWhHyheyqPdHOIfIh7cYZsfH93hXg3lH1wdXaFf02POBmBfcWWeYCqbot9b419YYmVgHyBhHlxgHBseXZWj5J3enqReH+Eap2GgoF2W3SIfnOFPHaDhJaMd3h/Zop2goSDeXmKIpNzgWWpiIZ+YGyVclx8o3pdgIWFfIM/cZR2eHY0dJB/imaEg3pxGnV5gJyUZImEdnFwl4dtbDdkYn2IiZJtfYSVbWN9c3OGg0GbdneWgo+CgIixeYKaf2d/hnSChnhmfmJ1kn9Tg3+Ah2tze42SfH+GdFmFenpDfoN6OJuAfHeMe1lDj1WGhmmFnWaCh3B0UYx3dpd+e3x8f2yFkeV2onglf3SBeHN8fWmDgod/ej18R3p/bnR1kn5em2cXlIXEl3V/Ml2CeoJ7kl+GkGt3gYCEeIZ9g31qVG6CgXhziX2Sf5SbiWeIgkt7g4Z8fomHioCRmpKGhm2MXX57goxxkG+CboNsqX93iEZrenJWdqd8xICChoGCjlOIdnyBLnt6f4thg4l5bR54e2VvklWEe4V0dn16cnE/aVlzg4WQe31+lGhShnqXbYU9j3B/lXd1g3unsnaBeHpca4F/jI+HhINxdoh5iIZ1dYVohn+BlIOLd25igId+inCHoAWaZX+DhX9pOHdckneIhJ5wg3+Pd1R0gnxyeoWDc3+Hf2OMV6aFM4yWeHKDiYVyg3OKg4KBdhR5d2tpeZCDUoo7CYIAx5l1gbJVin2Dg31bk59+fIiEfHWCbnF8dU+AkHp9gp2HgV90ooKHhnpbdYh7YISBd4qFj4yFhIR7jHSBhIZpc31Nk4SKZqyFhXZrbKJ3XIKfdlVzkn93kI14smt0gUBnfnyKX4uSdlEhd3yBlJFei4qLcmlnhVRjKW1jeoqHjm19fJZ9a3GBdH+HNJR7go6Fj4h1hLCbgUSibYSLdnqMd4WFgnuEjod0dYGFcYReXY+EhI9oWoeEf4qFfo9/mTR8gnuGZkFwRYuCqHufcIV1hn5ZgnqEiHSFnHp5dm8QgI+nfSWPk3+BfXx4e3VvfnxyeW4ofHdtfnCBjVKLODuNg8OTpYOsclCIZNaBXouVhHSIeXpzfnl+U3NUfn99aXeGgn+Lio96gYt8cUeJY2uFhXuGfJeSgHl/UId+FJSEf3uEGo96c2qlpYkrXmeidlyDonVSeICBdaGNXYyDf38+dop7gFh8hH99LXp2gZyPYZGDkXR4ioFodSVnYXSDlIN1f4yQiHt9dXqKgzeVdHeMhYx7f3+vgIGUgGB+gHl7hHSFgn57k4dge3Z+hXWBTo1/gISQX36Bq36DjXd1g51gfXt9gmBBgSOLclqHn26FgmiGSYVsc5x+Z3Z8gnWIk2R4nXsiiIGCcX1scRN4eYR+fXh4S3J8bn1wgntvfGkkhYPImWwYNGYOfnd4h1t+n3dqfpGAeIR/hmxmU3GAhJV3jYCCe3+Ujn6Dim9wd4KAiYm0a4J+oIeIf1CCcEiXiYt8jX6CdIVqo3tvsUJmonlpf6F0znx3hIR/lHiCgXCMN3+KfIhcgnR/eSRwdHVkj1eKgYpufY55ek8wVVhuiI5/cH56jYVwfo6Vh4RMkXB8hWx5c36OrXeCb3twX3uAiG2KjIdWfIF7jnp6eoRsjl2AjHyJe2tejIl8iH9+fYCZZHyIc4JcRmhRjHOXmJ9uhXWMh214e3+Meo+KfH1xfy19gqB4HJF9cHp/f3xze2iDenR/dTOSdWtwcoF7SoU6GoZ/vJeHMKpvaXp0oH1jiJCBhod0d22DfXVicE93dnV0d4F9fX1yd4OCiXl+cnpvd3aFdxN9jYxzf4RchX99l4aEeogakXJ4aa2Kh0hgbo93W4Gnf157i35+h4ZjjXd2gTV3jH6FYHCGfXcacHl8lZBhdaeMbnN9fnx3J2Zhd4eJfnV9gpKBZHp3co+IRYyDbI2Ij3V/gauEhJ55R3+LeIWCeICGZXeZh35/d4OIaYNik4SFg4toa4t9e3+FgHaBmn98eYWCYkuFW3KDXYygaIeCcI1Xj3t1mYOBfHqLgIqQn3adejOIdIJ5e3iKY4J/g355d3NDfntod213cWyLZBKBgcaTcnE4ZYGAg3uSY32TbYB+gYJ1hIiQeWpRb3eFd3mHf4d8goWHeoWAeHZ+h4FlcJVud4mWhoqEU4lueI6Gg3WHgYN5gm2qgXKDSW+Dd2N/nmzIeIKGfXeQa4xwhIc8fYF2iFyLgH95H3N1e26PYiR/hHR4inZvYzJWXWaJi39ye3+Xflt/fX92klCReYOQd3h9jqKtc4lwe2V2gHyLgo6LkGV1iXKNfnR1gmaKc36JhYhyaW2Ke3psdHx9bpd2gIN1gWJDbFOHdqOGn2qCeX2BY32Tf5tzhYp9hXh+Bn1+oXgyh3x3g39/f3aFbIF/dIV0Po98bGV1g3tKhT4Okn/Jl4x9qliKgXqdfGaLi4R/hYN3dIGAb3h1UXmUdHJ5j319gXKShoWIdmhygX16fQd3goGTj3R5gk6Ef3aOgYF4jCKQfXxkqpaHTGBtmHNffp9+YX2Ehnd+hXJ/dXZ+OHaEfopfbIB2dRxzenmelG9xjIt6c5R/aHctbGGBk4uFbX2CjntQf3R3joRFkHx7jYiRdnmArX+BnXdpf4txf4l6e4Ruc5WPg4B5fIhreHSRfXSEg3FWhoV4JYB/dmqdfnx7h4FeQYdQBIFhhaRphpRsgVuPeXaKhGeAe4Zpio+ZiKB6Ho1xg398e4Bvf5aMfnpReEeFgWp/bYp9ZoRmCpmBvZd1hDFxg3aLfItmlIx3eH+BjXSOh4h9aVZ4e396dIFyhX9/kYh5hX9xdnuIhHp1j4d6jpWIhIhpk2uDh4CPdJh6f3CPbquAWoJEbaN1XH6jdcmAg4J8dY5lYHN6hjGAhnmKYYOIenwSenh2cY1hg4CGcHl3eGlpOHJZbZuLkG59fZRxV4N+f4GFRpR3h5R1enyF265ygHd/UXSFfYyKh4yHfnZ/cImAd3KGa5B/VI2BjnBjYIKCd215gH4CnFeCg3t/bClvSYdqooWjb4J6gHR+coCAl3OAinuDd341gHWhdiF/bn2JhYV8f4Rkf4Z4cnothHtpV3F/clB1NA6Ff82Zd4Kqb4uCZYR7XLOVi3uGf3d4hW1wfnFciZZ6dnuCeoODf4aGf3p7bn6FfXl/hHGGfI+GfXN9c5B2g4mEc3iFJZZ2g2Wmho1iZmuXb1eBoHhNhIOCepCseYZ8dXlEdYB7jGB7g3x2KH53fJWPT4uChG54to1XXzd/Y3OLkphxfYiQc15yeXCQiVKZaHCTg5SEdpKjeYSLdWl5hniJh3lhhHlyf5s3gXV+iGt8go2Hf36HaG+FfHGCf316VpyGd3yQe184n0+Vh3qBomyDgWdrYpB5d5GHf390gG+Fj/NxnXYShJqBdHd7eneCjH93dTZ4WYaCcZh2iH9/nGcLjoHDl4iCQG+LfYF/oFyBlWB+h4aEfYWCfHtqV3CFgnlyhHuTeWGQiWeEdmZ/hIqAfYqBjoCPmpWHiHWPZH+Fg5Bvk2+IcIRtp32Ah0dwiHtZfJx7yH9shIOLkWqNdHWCOHiCf4hif5l0YhJren11j1uJgoVyc2Z6g2NRXlhuco6Re3p4k3hfhH2eW4k/nXB/jXRxf4FdrHR/emtaToJ/k5CKiIGNdHp1hnhzeYFLgn+OioeCsXFeDXaYhIGCfnyUioWAg2pReHNll35ck7RWhH6AjjWWa3exf4ZvfJ9Zi5+FcaeEh4K3iH2Egn9+dYF6eod8h1xsdU48b3B/VqAvVIuG7416lTF1hpKKiYSWj5+Gfop9gn6HfnRdWzl3jH56k5WNEImvpoyEgIB+hnmVgoCGdIehkKF/mYx0ZXOHpIaPbo2PhqGNWH+Biosud6J3Roi4gop6gZaGqpossooaihZ9iHeYS4t7e32QeKKIirLFiIKFMU2lhm5ic0xHjpBwkD1/iZyJaoB4gpWKLqRsiaCAmIiKj8iCdX+ARYGEbpp8bnmPmnl3a4l7cXiLUIt6iY2ChZZ0UAt7m4SEg4B+eIt9gohTTnZ3Zpt8UpG2WISBfI8xlIJ0rH+Hd36DYo+hhWimfniPt4N9iol9fnaChHqGfoBbZoBVPHV3blylLVaJi/B8c5AwVUySioWElo+khXuPdIWDj354amI+d4h9eJmPjACFq6CKg4OBVYN5k4J1h3eIi5Ong5aIdU9viaWBjW+Hl4igglZ+gYhnMHWed0B+uIKLg4OYh5maMbCLZowYhIV0hEmYe3p/jnmlhYexyYiPhDOBrId3S3FdSIGQW5R+f4ifiGyDf4STiTCjcYmgfZCQjIfCfW17fj+EfXCQe3h+jKeDeW2Ld3J0hk2MdoiMg4SSdGAAg5uFgH9/fm2TiYJ/aVR3eWSYfliVtViBhn6MJJx7drB8f3t9knCNn39crG6FkbiHfoR8fX6Bg4d7in18W3R6U0J2dnlDnDJWiorzc32ONnWFjn+GhJOPmIN7in9+eYp6fGpnPHqCdHmij4yUhaeljX+FfmuIf5CChoV4VomQmIiWhnFZeo6mg4JtiZOHn4ZXf4eBjTZ2pn1DfLl9jYSAloickyCyjGaTHH6Fd49LjnZ6f4l6p4iPsMeKg4Uvcp18eExuQUeHkXSReX+KoYRrgIB+k4I3mnOMooWUhY6GxH1yfX5JgX9xlnhvc4eQgX5sinpwdotOiniGhYSDjXg6JIWYhXaAfn8/foSCgm1Re31flXxglrZagH2AjS+ReXG0fYt0eZxqjZ99ZqmCgI+2inh9hIR2fXqReJKCgFpuelM7eHR/UZorVIaM8Gd3kTJfh4yLiISWkqeBeYt+gIuTfH1vdD17g3t5qpiKi4mwpI1/gYFph3iIg4CIfYuHjZB5lohzWGeLpYWBeYuXhaqBVoB+hGozd52AQn23epCCgJGDopgiqI1vlhl8hXiSTpN7eoGGeaiHjLDOWIOENHybgHVdcE5GhYxNlHp9i6CHX4GFfpCJOZx0iqOClH+TjMN8f3l+PoKGc5N1dXuKlnmIb3Z+bn2LTox7ioiKiJNzUjWAmoaChId+ZJaHgX96VHlzYJx/XJS1Un+Df45KlXd4t4CCgHmTb4eehluefX+RtoR4hIaBgIJ+lXiDgX9abH1UPXR9e1ueMFWIifJwfI82UYONf4iDlpOVgXmKfX57jYB7bXU+Zo99e6mVioCDpaKKgIZ/YYiCjnuKVX6Il5SdhZ2JdFlwjZ2CinWMlYesh1V/gIRvM3qufER/t3yNfoGSh6GgHLeLaJsYhYR5mFCNeHuAhH2qhouwxYiDfDuAnnp9QXNHRoeOW5V5f4qkhmx+g4WRizSVb32gg419kpDHg3R+ekGIh3KZfFh/joZ4hGiEgWuAhE6Ie4qKgYmXfVgxhZlcdHN9fGWLiX+Fe1J3emOYe2uQtlWAgICJKpp9WrJ9gnZ9pWaAnndsoEGEkbOCdIJ/gn98e5V/gHV/WG94U05wd31Wni5Vj4judXGRM2KClIKChJaOk355jXp+fot9fW9cO32IeX6mjoWDhZyli35+hWaJgJB/hod/iYyMoHubhXZMeoqahIx5jJuCrH1Yf4KDYDB9n4BGf7h8jnt6jYWimyethmmiGYJwdZhQj393f4Z4pIeDr8GJhX8+e5t3fWBuWkeEiWuUen+MnoiCg3x7ioo0q26FonyTd5WLxXlncHs+f4lwm3t5f4iGdIpri3ptf4tPj4GNjI2Hl29BQIyahH18h1FmiaiIgn5QeHpmm3hmlbdUhYCFh1mge3ijfoOQe4Z0jJuAZq5tg5e5fHGKf3+FfHmMf4B7d1l3fFBtdHt/RJ4rVYWR63t4kTRYgo+DjoGWkJN/eot/f3uOen9vVjp0jnmArpCKiX+isYeBf39yiHilgoiGaIiAi5h8m5VzTWOLnYSNhoyXg7aGWH9/hXwqfrh7Q3+6f5B9h42HppQ0qpBfog+AiXeUTYZ+d4KGen6OgK65iIGBRIWjeHdccUpIiZF4kniDgpaFVn2JfpONO5Jsg6SAj3qDj8GBcX19P4SGb6J+RIKLiHmRdYV/bnqFS4p/jpCLiZZeTwuJm4eJeYNyiaF2goF9UHh0ZZJ+Zoy1VH+Ef4JNmHNzsn+Je3qeboyihWWnTY6ctH9ygoB/g3p8n359fnpZZnlWXnF7f0eGLlWMi/B/dJAxR4aJhol/l5OagHiMf3+FknuFbls6dIt8e6SQi4d/p6GIf3mEeIl7h3+DiIiHjYqef52EcmZtiKqBjIOalIashFmAg4ReKYGnkkWBu3+KgHiSiqGaNqOJS6QWgIl2lFCQhnSHiCyUdY2ur4iDg0yBoHp9XGxeR3yNgJV5eImcgmiXhoWQiTKlf4mgg5R2oI3IfHB6f0Z+g2+hfHKCjI91fW6Gend1ik2Gf5GRhoeOclQAf56GfXeEgHWTjISDTlF6fmWUgFmItlN/hH2RO5xkc5mAh5t7f0eJm4lxqHR/hLmHdYaCd351f4N+hH6HWmpwOTpycHlvni5Wjof0fXmXMmCEmISDhZaOsoR7i3V+hY99eVloOn+Oe3p/jY12g6qkjoGDgW+Cg4yAh4d0hoSTl4CXi3ZgdIaghYRrh5eIoYlRf4OJeDF+n3dDh7iBhoOLlYaiozySmHCEEn+HeYpIj3l6f5JViIV+ra+HgokucLF/bHFxTEiZjm+RVn+KoohmeHaEkoUuvH6Fn4GTjoyKyIF6foNHgYBykn14e5OWcnRmin16c4xOinuMjYmGk3NDRH6hhYJ0iYJwi4eGhFdReH5pmYNTjLdYgX95kTyXgHCZg42fgHtSipqGXaeAe4O5iIGFgH94fo+Uf4WBiFlvfUc1dnpydKkwV4+J83pzlTVQS5KHg4iVi7KFeY9miIadfntraD18k3Z0k5OOhYWwnI+EiX9Sg4CIgX+Gdoh9jpmDmol1XW+DpH+HbY2ZjKeHU36Cim42d6t7QX+6eop0iZeGpZc/v6B5hBeCh3SHR5R9en+aVYyIgK+7hpGJMGSvlHxbb11KjJJkkFl/iaSIbnx4h42GNLOAh56ElpKMjMl/cIODPIR6dJJ5e3iOl3d0cYh6em+NTYh7h4yJg6R4UUOAoYWFeoSAZoiFhoFnUXmDZ5d9WI+3VoGFeIo5pGxym3+GnXyMXIuZhGSsY3+Gtotzh4WBf4aFgn2SfnlbcXlSI3t4ekukLlSKi/h1d5EyWIWTf4OEk4yugXaLfYCDl3t9a209f5B2d6OKi5GIs6iWg4eCWYeBh4SDhnlYhI2agZuJcF50jqSBgW2NmYilhlOAiH1+OnyifEF/u3mNhIuWhqOYPsWgcYUWfYd1jUmIaHh/lFSMhoStpYiDhzCLrX1+TG9NSZiYYY5Wf4qmiGp9eISLgzCleYmjgpOKjY3HgXiEh0qAf3OSdXxklX5ydmiGend1jEyQfIGJhouhdjgYg5yHgXqEgUyBhYeFcU17fWCTeF6PuFZ/f3+ORJh2apl6hZ96ilaGmIlLrYOHk7WHenmAgXR/g416k3+FWXJ6QDF8eHlWoS9ViYv1bXWQOE+HjYuFgpWTroB6i31/hpR8fW54PX2TdnikmI2EhLKtk3mHf16HfoeBiIZ6iYqQg3+ch3VhZ4mgg3dsiZqFqo1Tf32DWDt/sH5Egb17jYKKkoOfm0WkonaIEnaGeJFMkHx6fotUioeCrrlYg4E3hrF8e0JwdEmYlmWQVn2Io4hqe3iAjYMsqHmHo4SVfY6Jx3p+h4RChIV1lHl+eo1+hn1udH5zfIhJi4CJjo2KiHtEEYCYhX+FiYFrkImEg3lRenxhmn1kkrVQhIB6h1SidHGegIeoeJpjgZuLVaB1gI+0h2yGg4Z7gICOdYR/flh2ekU4dnZ7U5gpVYuH+HBvkTJKiJJ8ioOTj6N9eY2Ef4ORe3txezxylod6ro2LhYOluJOBhoJPiYWGgodUfIWEjZyBnoh2XXWJmYGCbomXh6uFV35+hWc1fq19RoG7e5CDjZKHp54ptaR2lhKAgoGUT4p+eX+NVI2Hia2/hYNtRYadeIBUb15Jl5pqk1N+iqWIa319iYyJKpV0fqCDjXyPi8mFeHmFQomEdZl9f3eLe3t4b4iBcXqGSouEj4+BiYx2WTKNm1mLe4V/YI6WgoB9UHh2ZZp5Y462T4GBeoY7m3aSoH+FrXaxYYOXiVaieIKLtIdtgn9/jHqEkH6Cd3lWeXlKS3d8f2CYLVWNi/N1dZA0UoaSfY6Ik5CifXiOgIGBloF+cXQ6gJp4fKuIioeCp6OQgn6FS4uEh4KLgXmHhZKYfZyMeF17iJN/iIONmIKxgVZ/gIdQN4C6fUN/u3uKf4OMhKSbL62jd5oZg2l2lFGRhHh/kFeEh46tu4SDgUiJpH2ESmp0SpiSdpVVfoqgiXN6doKJhzCwdoSiepZ6kYrGf3SCgDuBgXOXf2mEjIN6gXGMfG5/ekqPhoyOioaLhFJFkZyEZIWDUGqQnY+Hf1F5dmueeWiPtkeBgneAWKV5d56Bi7B3nnOLl5BcqXh7g7h8coZ8g4p4fIt9hHV7WHZ5O3Fye39WjilWgJLxeHSTLUqEjYGGf5aTnYJ6in+CgouBfnFuOHmTdoOpgYuJgZ2siYB4flmKfbOCgoR9iISHk32clHdMaI2bgYd+jZOCvIZWf4CDTSuKuIJBfbmCjYWHjoepmje3pXKgF32Kd5hVj355f41UTZGBr7CFh4NOiqR7h1VsZ0mMknuUU4GIl4pQbpB+jI89ro6Eo4OSdYaPw4B4f4A4goFylIF3gI2JfIlyin9zeX9LioWRj4qKll1WCoSchYWFi3Rpk5yEgoNReXtol3xsibdGgoN4f2Kac3Oaf4eJeqJqjJiEWaeBgI+3gXKHgIWLenmSfYN5dlZxfENuc397U44pVoeR8XlzjS0/iI6EiIOWlKKCe41+f4aPgodwZzx7nnl8nouMioOropGCeYVfi4Z3fomEaYZ8iph6n4l1TGiHn3+FhZaXgrKBV4CEhWAsiMGRP4O6f4iChYyBp5w/o5xrmBZ8hHiUUo2AcIeOTFSHjquihYeCUYqgeYFRbnBKmI5+llZygJaCVIh9f4uIN7Z/f6GFlnS0jcZ8dHuFPIGFcZiFcYONf3xwaIp6dHiFTI18jJCHg6NxP2l/mISAd4GBcouPgIBoUnl+Y5F/Vo62XYSBfpNJmGV0oXuHhnx/S4SZhHmmgXuIuIR/hoJ0e25xZn+EgH1bbXNDS251c22aMFWMhvR5c5MxYoiRgoCClI2thXuMcn9/n3Z4VWM7eZOGeiOTjY6Bp5iPf4B/WISBkIKKiHmIio+Rf5WGdVl2g6aGfmyJmYWVjVB+gYV1MXyUeD+Et3uGd4iWhp6ZMImLdXwUeIh7i0iVc3x+kFqChYCus4mBhSV3mpNeh3FCSpiNfpN6fYKdh1t5gH6Ngza3dISdgZOMiYfJfXJ5f0uAfHGTfHZ1iaR6fWiMe3Z4iE2LfIyRhoaffDJreZiEf3t/gWmJjIF9YE93gWaVfF+Nt2KFen6QQp6DdKh/jYiCbGCGmoZnqHZ7hriGj4WAfYV3k558iX+GW3B+TTl1dndonSxWj4vzeHiQMF9IkYeChJSQq4R4i1eNhYx5e2xpPniWgnaJm4ymg6+ak4SDgnGGgJOHgod7iYeJkYGbh3RWeoWmhH1vipqGmY1Rf36KfzJ3o3Y8f7Z2inKHmISXqTiejHd8FHWJfYZHlIB6f45ghId+rr+JkYMxd5eUbpNuMUqUj3SRVXuEoYdnf4GBiogyoHyJoIKQlIWKyH1yfX8/gnpyjHd0fImUd391iXp4cIdKkHiGjoh/kHs/a3yYhoJ3g4BkhI2AhG1QdoNllHxXirZkg4R7kDmcbHagfIOEe4ddgph/Vqh6go+2iIaFmoKAgHSKfZB9TVxsfEk6dnZyUJcpVIyO+G93jzhpiZGEgoKRj62DcYh+eYWbdXtsbTx7lYh4i52LhoSyo5GAgoJojIGTh4OHfVSFkpGDmohwX32QpIRvcJCbhZmMU36HfWY1epx3P4C3b4p7iZeFlIw3vouAhRVwiXyKS5BPen+QXIaJgK23i4GHNIyVknaHbipMopBtj1p7gaGGdnuFfomCMpJwh6CDj46Ii8p7coGEUnx/c5J2cneIhXCGcoR7dXmGSpB/eIp/h5N3I3F7k4V/f3iDXJaHhIluTnmCX5J6Yo+2aYh8go5NnXh3o31/g3yKX3ufhWereoB+toeCgX6Bhntij3yMf3hacntWPnd2d1yfKVaKivhtc5A5VoiQjomBkpKqgnSHfn+Lj3h/cG08dY2LepCSi4yDs6eTcYCCWIuAjYV/iH6JjI57lZyBc11yiaWEPnORnIKij1F/foRtOXq2eT9/uniPeoiUg6CYKa6Oi4oNdIh4jkyaenh/jV2GiXuswlWIgD6JlIp1dHBRS5iMdpBWeYKehmt7hnqKiyqmdomhhI6Bj4zJfHZsgD6DgnKVc3h1iIVwhm5veXV4f0eMf4mKioaNeEFqe5SFeISbgGGTi4V6fE55eV+Vf2WRs2WCen+JWZh1p59+h4x5hGp/nodXooJ/iLSIgISChYp+cY1/iXx0WHl4TlZxfHVXoiZViYv4ZmeROUOMlH+JfpCSpn94iX9+fo5xg3FtO2uiknuYjYmGgq2ijn2AfVeKgY6DiVKBiI6Uk3+egXVffYeegXl1k5qEpopTfn+EcTR7ontFf7d8inyNjIOYlgaxkYabFXSAh5NQkHpygYtghId8q66JhmpBhZmJhW1wRUqolXiTVnqEnIVzgIuHjIkunnp/oH+TfJKLy314g300joRylHt9fIyDgohpgoBxfItKj4OIj4KKqIBRaIuUVYiDfn9YmYR+f4JSe3FjlnlijLZggYKEhk6jeG2nfoaDd41sdZyHcZWCfpazfoOCenx6fnmRf4JuclV0e0ZpcH55V50rVYeO+3BqkDJMiZl+g3+Sj6R8c4l/gn2KeI1xazh1loh9m5GJhYGwo4t/fYpSi4OGgYaHh4iOiZN8noF3VnuImYB/gJmXf66DVH5/hk01gayBQn+3gY56hIqEn6M1k5t7pBl2aX6XUZl/dIGLXYGMgq2liYWCTY6bg4RdbEhLqot8l2B5gpuDfIKSeYWHLJ55hKN9kXWLkch1cH97QYWBb5J6f4GLg3KTZoWAcnuASpCFjIuEi5KNUG2FmINniINLZKB0k4SDUnd3aZt3ZI62WYZ+gYFclHaUkX+LsHd/bIGfhHGnb3+NtYKAhH+EiX10jn+Bc3BXc3lOi3J3f2GVMlV+j/R3Z48yRYmOhY53lJWogHSQf3+AjHiPcms5eaCBgZ6RiIV8pKaJf3B/ZYyAj4WFh3aHhoSOf5uMeFNtjZ6BhoSSmH62g1aBgYRaKISVgT58uISJe4iJhZ2YLZCbe6ccfIh9lFKNe3l+glyElXysromEi0uToYWJYHRSSqKDhpZbfpiKg09yi3mLjT2fm4OehpV0lo7JfnN0gDaFhXKdfXOEjZR5kWuOfnJ8fk2KhIqPiYqgg1FtiJqFkXqDd2aXeYSDhVR4dGOTfmmRtliAgHl6aaB0eaN+iVZ7jnp9noFppoN6krV6gYN9f4+Fc46BfXZwVXJ6PnNzg3pWhjdViZTxc2yPMUOIj4eMgJSUpYF2inyAgo9+jHFkPHGhgnuXkIqKgaCdi392hmmKhJyFh4eSiYiKkoCfnXNgcoijgIZ/mZqCsIZWf4SGYiuEq5ZCf7d/iH2Hi4OrmjaMm2meHXeHfZZSlIFpg4t6aYlzrJmIhohKjZOEg11uVEqdi4WVXG2Nh4FfiJJ+iosymnqDooWXdcOLyoNseIQ1f39vmnxnhYmJeoBfh3x0eYRNjHuNk4eHknprhH2MhH19gYFnbo2Cf2lOdYFgj4FgkLVehH19j1KdbHGdf4eKfopjhZ2Dm6B6gIy4f3l+h2d2aK4/fYCDfllyeDKGaXNubpYzVYuF+XB4kjJriJqHfoOSkaSEfYd1mH+VdHpVaj5/lHh6WpKLhYWioJaChII6hXyLf4qHd4iNjph/lId2X2WFpoaAb4mWhY6OUH6ChlA3epl0QoK0eoODhJmEmZw1l3+Ahg95iH6FRY2AfH+QXH+IeqyYioOJOHueg1RmcFFJkImFkH57g5uHQnl2gI+GMppwg6CCkIyNjsh7fnV+S4SAcpV7dmmTqnaBXH9+c3iHTY53io2Di690ZoJyjISBfoOAZnWMg31lT3OFZpB+ZIy0YoJ8e49OlItypYaJiH+DbombhIudgIB9uH+cfY53gG+cVXx9gopYb4BGeG13dWadJlaJifd0f480XUaXiXyEkY2ghXmKbpuEo3Z3bmxAeJd3eYWXi4+Gr56HfYODXoZ+jYCFhHuLjY2ZhJeFdFhgh6WGjXCKmYiOhFOCf4xzMXOYdz+BtHyHhICZg5GVO6N9kYAPf4h6gkOQhX2BjV2AiYKsrImQiTp+opNdVW5WSYWOfo5nfYWZh0x7d4KLiiyHdISde5SViYPJfnp2fzyEgXaDdnhUhaB5gW6Af3ZrhEuMcoSNhYypdmeAgoeDgYGGf1Z6lYCJblJvj2OSfVyLsmSFi3mJXKBueJt6hYqBe3GGnIWImnqBj7V/iXydf3h4k01+hH9/WXR/THhydHo4nilUi4f+YYGNOF2Kk4aBhZCQmoN4g3+Ugpx4e25zPYCReXiDk4uRh7OVh3+GhVSLfomEhIZ9UpKUmpGYiG5mY5OjiYFvipeHhYpTgIlyUjN1mXdAfLF6iICEnYaNrDOngI+CEHqJgIlHhW98gY1mgYKAq6eKgIdAgJZ+ZHdrUkqIj3iNZHqFnIdTend/jIQolnKEnoGOlIOIzH58aYBUhod2m3R4cIqSboRnf4N1eYhHlHxui4WEonhMgX6IhoiIln80j4yFl3dNc4pbkX1jj7Rjfnt/jGSUd3Cjfn2Ef39rhJ56jaKAi5a4f4ZQjoKCeIuHf3V+jlZ1ekprcXR7UpEpVouK+l19jz1WjJePgH+RjqWBeId+i5GUeH5wczt+l3l+iY+JjIGtnoaOhYZRi2SKfH+Ie4uHj5mQmIhzYGuLoIZ/cpCahI2LVIF/fmc4dat5RH20eY19gZiHk5BBoYOOhw5yhX2RT5GDeoKIXYCDgautVYOCSYWhe2VjbkVLgIt5jmB7iJeFVnt5f4mMKI54gaB8koqPhsp8hXp7QISGdZJ0d3CFk3GLYmmAcX6DS4uAgo2FiI97YYCEioaMkZB/NI2Ph4uAUXSBXJiBaoq0ZIOAgoNVnnZ0soOKgXyHkzmjh3CchoOYtH19gYiBeoSAjIR1e4RXdHtEdWtzeVaWMlOHhftadYo8Q4uWgnV+kJCchHWGgoaCj3aFcHA7aJmIfYyTh4ODqKWIfIaLLYl6iZCGVHyKh5GdjaCLdFxshZqDf3eRmIWYj1SCf4dvNXWTfUZ9sH+KfoaTg4+bK5yAkpUOeIKDlVKRg3iBiGSEiIKrjYqHdU2Kinh4Z3BSSIORfZJmfI+Wh1p8eYuQiiqac3egeoqIlYjLeoN4eUWPiXWKfXtwh415j2F/hnR/hkiRgoqMhomafHd/hJFWqJCZf0KYf5N4ilJ0fmCZgWaLs1+BgYZ+VZh4cZZ/h4N7kYZ3n4WBmIaDjbB0gXeGgn2JgIyEdnR9VXN6Uopwc3tohi5Uj4f9a3ONNlCKloaJg5OOoXl7i3+GfZB1hHFuOXOUcnqTjISFfqiZiH6MkS2LeohwiYd5ioKPloGhmXdfaIeSgop6m5d/moRYgIWBajR6mYBHfbB/inuEioGcl0KIj42dD4Btf5hVmoN5hYZbfo9/rJKKhYdNh596eW5sVEqJiIiVX3yVmoRmfHh/iI4ujH+Eo42Sf5iLzIx/d3k9hYZzlHx4gISNi5lvfYNwfYhLlIOHkYiJnnFufXuPg5yXiktgnICkfI9SdXplln1pj7Rgg36EdVuic3Olf4epeYyce6GGiJ2NgJGwfn6Df4ODh3+Hf3hvfFlkeUKTbW5+XXsxVIOO+HJxjS9LiZCFioCUkqSDeoqAgoWTd55wazl/k3F/mJKGhnmfkoN/fpE/iH6FeYSIf4eDi5GAoI53ZF6Jl4KIhpCVgaeDVoSFiVg0fo6FQXy3gYd8f4t/l5QvqpCSpRl8i4CWVpqCeXyCZnmVZqyGiIWIUYSRfoKAb0pHgYOKlFx/i5SFWHWTg4+OMJuag6F/iXqpishxfnJ6PISHdZt/d3+GpHybYH6Ec3+LSYuCh4yMiqJ7YoCFjoe2iIh3YJWDmXmJUnV4X5mCbYqzVX9/enWHl25xlIOHdHeSlY2cgX6acoKctXJ8hH9/lIp+joJ2enZVanw/d3B9fGSDNlWImvVqdooyTIqUhomBlpubgXmKgoN/k3OFcGE7caF1f5GNiIiDoJeJgGSMX4t+gXSJiIaHgouSe6CYdWhqjJ5/hoKZmIOfh1iChIpqMoWplUN9t3yJfYCMgqKcP6GLhqEZe4h5lVWShGeChnp4iVurdYqGilSFmHyDbG9WSpWLiZNaeoiIhEBnfYeMizSfiIKgh5d5uoPJenhygTWChnGbfHB/hqeCh12FfXN7hE2Od4GOho2ebWKHg4GGdHd3gGFbg3x4a1JzeVuPg26JtV6JhnqUVZqNcJB/iIN6hY6JnX94nH+Fj7WEeoR9U3JtloV6eH92V2p9RnpqcXtpli9Vi4r6cICPNWuNlYZ5hJKTloSAi3WAfYp8eFJpP32TeXFxj4uBgqKXpn9/eFGEfomCjYl3ioCHmH+WiHNWeoKlhopvipOEf41QgYaBTDx/nXlBhbR6h4R8moaRm0mndYJ+EICHfIlKin99gYtffId+q4iLiYw+fqJ8TU9uYEmNi4mPeHyCnYQ8e3WCjoo9mm+FoX+UgIiJxX56doVUgIFxU3l1caWne4F0gXpue4VMi3V9kYOak3ZyhHGDgnVweYBla4V+dmhQb3thl3pWk7Rgh418kVCZhXCnfYyKfYejjpyBhpx5iIizhnmGb4R3b612enh7e1d1fkN0bXV3S5MzVZCF+nB2jDR1TpyHe4WPk5GEgIlnkYKLcXhnbkB4jnlygZSKjIOooouAg3xXhICMhomHe498jZSDlYlwWGyDpYmIcI+Th3+KUn+DfEs4dY9zP4CzeYeNfpyGk5xNtHeKgBJ+iXuDTJeGfoGJW3+Ce6uQipKJP32ejk1RamVIh4uFjmZ8gpuFS350iI6FN4t0iZ9+k4yGjMWDemyAR4KAdIxydnSWq3mEe3aBcm6BTpJveI+Dl5V7ZId+goV2dnl+TluHe3NzVHKLX5J9bJK1Y5GTeI1ek49ynXKDh318pIebgH6cdIuMsoZxGZODc3J/j398eHBTcnw/YG50eh6WFFOQhvtejIo9bI6XgH6DjpGchH+GfICEfnh/anBBgI53cI+UjI+IoqeQhoR8TIiAiYeCiX9XhJShfZeEamZqk6SIiW6Nk4Z/h1OEioxVPH2meD1/tXqKhn+cgpOLUsx3i4ISfIp9ik6McnuChmCAg32tlI2FhUB9kHxPYGt1S4WMhIVifYGdg0d4doSKhzuSdIKgfZKEgn3HhHp1gV2Eg3KDcnNOkpZygnRtgXV8hUuJdtqLgZWJdWGFin6FeHN3f05ziH5/eE54kleSeGqPtmWMjIKQTZqIcKd7eIR+kJaHnnyOmnmPh6+CdGt6fHJ4fpB+enx6VXF8RVVvdH0zjStViYP6VXuLPVyLk41tgI+SmoJ/hHqAmIp3f3BxPHiMeXqOj4mFhaSfjn2Be06LgIVKg4l9jXqOoZGYiHFmc4SeiYFylJeFg5BSgoN2TTt2j31Df7GEkIF9mYiMuFqwepCMCHiIfpBTiYR6gIJigYF6rYtahoRKhYx+YmBvcEmEj4OLYn2Fm4JGe3yPjIw3kHWJooCLgYeGx4KGeYRPfYJ0im95fIuce4R4GIZwgIJMlX58kYiNo3BRhX+BiH99jH5YiIt6eoBUdY9YnIBskbRik4eJh2eWgG+qgISJe4qrgp53caB+j5KwgnEhgIFce3iMf3V7e1N+eVJOcXR6NpEtU4WH+FOFiztni5d8gYSNjqB+gYp9fYKGeYhuaj50j4N6kIaIhYKkoIt9fXw9iYF+bIhVcYuGkZiCoIx0YHuHmoODd5SUiISKVYGDfk86d7p/RHyxhIp+gpN6k5hIpnmSkw99gn6UVpGFd4J/YoGHf6x0jYd/TYSHe25bb2ZJio2IkWd/h52AVn11jo6JOYlxgKJ/j3+FgsqFhnuBS4+HdYx6eIKKpn+Cd21/c4aCSZB/f46DjZloVX2Eglh/end7XYmBfXmIVHV7YZWEeY+0YoeDfns/ooF1mYCGjnuStXmefISReo6Lp3t4h3x9c4V1i4R2cXpZbXlSTG1zgUl0NlSQhPljfYs3WYmWhYGJk5SdeX6Mf3yAiHSNcG46eZJ1d42Sh4SEopqLgnqLMIt+gyyIin6KgImVgKWJdWRyh4qEjniTloGRjlaBhn9SNn1ugkJ9tImMeXqShpmbV8h/k5sUhG9xlVSShXSBhmB8i4mra4uIiUyCnnxuZG1eR5mPiZJif4udhFp8eZSFizmUc4mndI9+iIvJl4N4fUx+g3SXeXyLiKB5kXhug3OBhEyNf4iPjI2bdUyFiYeIjX96SmaVf457ilNyfGOdgHaPtF6OgomAXJt/cIWEiqR4hrKAmoJ7pnKHmK1qbod8gnSGcYh8enFxWGd3Q21scYBmnTRTiY/4bHuMNGWKkYKFe5CVmIJ+i4F9gIh0k3BpPYuPc3qXloSDh5+uh34EgFeIfHiDg4p1iICDk32ii3dibomQgYmEiJWDmIlUgoF+PzZ9oYdCf7eDiHVukYecmlCwh4+eGHqFfJZXmYZ4gYRqeJJwq22LhopTho56fVpsVUaRjJCUZISGlYFSdI6Klow9kZKHpH+Rd4uDyImAdHtIgYZymXh4g4aykZRzfIFzf4NKjH2Ij4yHlW1YhYGBhod/eXlml4CDeodSd3tdmH9tkbRaiIN+dWKke3CLgoiId5apiZ19iaN0hpWueXmGd4B+hHWPeHBvblRmfFRTbHF/U4A4V4ee9Gt0iDVSiImCf4iVm5mCfI+Gf4OKdKFwZz93k3Z5kI2KhYGVoo2AYYJein+BgoqJfol/iZJ7m4ZzYG6KmoKNfpSUgo+IVoSDgD8zfZSWQIC2hYd5fJKGlptOpoKMmBZ5iHmWVpaLZn9/dnaHeatgjISKU4CZeoJnb1BHnYWUlGCFfpGEPHJ1jZKIO5VxiKSCkXauh8WNfHWFTYCBc5J/d4eLrX6FYot/cX+FT4xyhI6Ch455R4yRc4N2dHh8UW2Be3tsWG9yXZB4V4W1XoN9d5UjnHZwn4uEhXiCgomdfXqhf42DrYV2hH9Pd3GGfXp6gnRXbX44iG1zd3CRMFaOiPlyf5A2WZKVhHuIk5KThXaFf4F7hYR0TWlCfYx3aoWPiIGFopuVgYJ7ZIB3hoSNiXeMfomYfJaHdEpxeJ+RjW+FlYl6kVOHjIhqOHyjdz+HtnyEgX6diI+fU6Bxf4cXg4d8gVSLgX6CgmZ7iXitd4uJik1+mHtOWm5RSn+LjY15f3+cgDV3cn2Lh0qOcH6kf5GAgoi/endyflZ9jGuZdXZ+lrd4iHqPfWp8iE6QbYuMhIyVdkOFeXyDd3V6e1x1hX17blBtfmGSd2uOtWOEf3qSD5CLcJ6Fhod/jouJm4JynXqLh66Hf4t/in9wlXd7en96V3F8PZBvdXdolShXjYbwcJGQOFRMlIJ4hI+VmYJ4jHGNgop+emRtQXqPemiFmIuMhKKWm4WFfIyCf4yFiYd1kX+Pk32WhnFcaoGjkI9wjZSLhIhWhYuFfjh1rXk/gbN/j4x/oIeTllWdeIqDEYGJfoNVh4N7g4JlfYZ6rYeNmolKf52KVE5rTkx6iomFaH+Amn9IfHSAi41FjXN9oICXhYGIw3t5en5BgJJ0fXB2goq1eoSGh3xvcYZNkGp/j4mLjn1Qh4V/hHl2e3tNbop9e3ZVb3thk3dfjrVmhol8kUSfgnGgf4CKfXqGh56BgaB4i4yqhnWJjH92d32Ien99dlVyekZmbXZ5VpM2VYeH+WZ3iDtbk5B5cYmPjZ2AeoV9g4WJlnZobj+Chnpgk4eKjIOgnJSDhHxVhnuFhYuJeFWIiZh+mIdpXGeJn4qGcYmRi4GTWIePfWU3e6J7QYK4gomCe5yGh5Rap3aHhBJ7h3+MUJJ0fYJ/a4GKea6CkIuISYSKfU5abE9Kg4qEimZ9gp+ANHR3f4qHTpJvfJ9/j4V+hMJ+fHWAUIGSc5NyeWyMoXyEfYJ/c4KGS5Jxco6GiY90Q4KHe4R9eXh8QHGGfIV6UXKHV5d5aYm2ZouAfIVGlnhwnXeZin6KeYOhgJGifY6Wp4RzhICCd3l4jH56eXhWdXs8aXB3e1WZJ1aHiPVhh4s9Yo2SenqIj5Caf2mOfX+bhZZ7bG4/gZR6dI2TiYOFoJyPgoJ8T4qAg4J/jXGRcYykj5aKcmJ3h5uJhHSNlouHilmHioGAOHeSe0SEtISPgIKajpyVVcJ4iI4MfIR7lFaLf3qBfGiBiXmse1WKh1CFrH1QT3BwS3yOiYdkfoOdf0t0dYCLh0aVcG+lhpR/gHfGeYJ7g0cVi3Obcnd/haN+jI5ef3KAgUuKdYqRiYmTcU2Ih3WKfXWPf0iFi312f05xfFeefmiMtmaFgHyIUqV1cK96g4p+hZaAn35wmISJhaSIcIt6g3CIdIh+eHZ2V395RHFydHtKpSpUl4nxY3+KPmCIj3F8kI6LmoB4iX1+g4SQe2xuP32NhnSOjoeCeaKVjoCBe0WLeoN6hkt6iomLm3+eiXFccoORhYp3jpalg4tYhYeIhDJxqH5IgrSUkX1+lJCLulGedIuTC3qBfpRXmIZ5f31kgIt8rW+OiXxXhJl8Z0dzUUl8lI6OZn6BoH1Hd3iMhIlGhXVUpH+Jg3+Hx36IdX5IcI1zkXh3f4Shfottf3hwgX9NkXmHjImJk3JFh4NyUoF2eoRXh4KEeodQcHZfkYN0irVihoKLfkuZdniZfIGKd4yRe55pg5V9iYalgm2Hfn+Dg3yFfXpxeFd7eU9Sb299dIowVZiC82Z0iTpZiJ5/fouPk56Seo1/gIKEgYRubz5/m3Zyj46EgXSgn46Gg4Q/inp+hoqMe4iAiZl/ootzW22FiYaKepiWjYqHW4WFgnY0dp2ARoS2j49+epSQlJpTkIKGmgx9dXOWWI+CdIN/X36NhaxljYiJVoGPfGpJbl5MgY+PkmqBi6CHQnt9gbmNP6xxaqWCl3uGisiNgHWDS2mKdJV7eXyCnH2RjIR7coKLTop3h4yHiJl0R4mCfYqPfIBDYJd/i4CJVm92Ypp+do20YId/fndVnHV2mn6KpHqLmIKbfoeig4iIoXhyhH5/j5FxiXh3J3NYdHtbinBbfGmNNFWWi/Bve4s2T4iNgYCQj5KbdXWPg36Dhn2cbm08iod8fZiMhIRalZWPhH59WYp6eIWIiXiHgYuXf6CNdFZliYmDi4SQkIyYgViIhYVlOXOzgUOAtpKGfF+SipidXKOBi6MXf4N8l1WRh32CfW19k22rc4iIiVuAgHl5XWxUSHV8k5VhgIaXiFN0jX6Dh0iakW2lhY1/iYbFfHxze0uCiXWaiXqDhKp/l3WIhnaBf0uMf4eJjIWRdj6Ign6Ggn1+gVmSgoF6hlJxdV+Yem+MtV2GfYlqbph4dKB/hYx0jIaJnXp3pHiKlKt9c4d5f32Kc4x8coBvWGx3UmVwf39XhzVXiaHrbXaIMHKIkIZ8j5STlYB6j4R+gIV9hG5mQXWScXqOmIeBaZCLjYV1e2aIeX6Bko16ioCMlXqYjW9MbYeTgo5+kpeGi41Zh4eIbzF8lJQ+hrGFiXd/kouSm1Otf4KiE32KephViIZvgXh2eYl0rGOMhI9Rf5h8dltuYEmRf5KTY4d4mok7bHV7hYtMom5wpIWYfJCIw31zbWVGgYh1nYl2hoGrjIlxi390fodMjXKKi4aDjXNnjZV3eXJxfXhNg397fHJVcHFhkoNfALVdh3x1oT+ZeHChc4eDenx5ip99aaJ5h5SlhG6DfGF5b394fHSEdFZqgkd5Zm9/aJksVIR/9W9/hThskoyIeoOSlZCEf454e4aFgnNPa0R0hnd0gn51gYegiHuFg3tCenaChYR8e351iZl9m4hwPnR3n5WPbomUhXiGUYSCiG8nf4t0PYivfoh/fZiHj51Qt26AhxR/hHx6UpN/fH+CYnmEfKtsgYuKR36QfgNabEdLgY+OhnaAf5d2MXh0f5GJToZ2gaSAl4mBgMN5fXKAUIKTaoVtd32MqnmCg4t6cn6ETo1wiZGEiIt2a4mFfHR5cHx3U4OFfoFyVW92ZZF+W5G3YYaAdZ88l4tvroiJgIKJg42bfl+hfoqKqYFzg316f3KOdH97g3pZbHxMfGtxd02dMFeMgPtzepA4aDSKhXaDkY+XhICJg4eDio52a3REcYx5cImTdYiFp5WNgYN8ZIp6hYWJe3iQfIaUgZeIdkBycZ+KjG6SkoZ3jVKFhYlnKXWSeDuIs4GHjX6bh5miVJ5sgo0Sf4V7gFKQhHp+f2d9hXiseX+UiEmAlIkCZWxOS32Pi4Jqf3uXdTl6c36MiEiTfoOlf5KMf4XDe3hyfkOCkHJ7b3V9jat5i4WKfnByhEuOboeNhoeTc1iJfn55enJ5c0p6hn18dVRyfl+MgGyNtmOJinubSZJ5b551goOAfnCKmX1aoXuPkKKDb4KLeHx0eoJ9fn54WmR9T4pub3g/kSVWh4byboWLOWaThoZ4hY6Rl4F5iXZ/h4qLeWdwRHiHeo6Kg3GKhaSmkX+CfT6Df4SBhnxyQoSJoH+Yh2xZdnuji4xwiY+IfZBVh4yBaih5mXdCg7GCiYV7m4OJlVWycX2NEHyCfo1QioR5gXxffox8rX2PjYhIf6d7VWNsVUqEjY+CZ4B+m3c7e3h/jI5OjnmCpIKWhX2AxH1/eH5diY1si25zcoqqfIKQf4B0f4RMjG50jISJlXBIjHt+eH10fHY2eIN/hHtTd4tXjHtwirZmhX98lTufeXGrfoaDgY1miZ99a6F5i4uhhnZ/enx2enmJf3mBellqfEd6bGp8SY0sVIuJ82t+iDxWgIyGeYSRkZaDcIV5faKHp3pqcEF0gnhvjZJvhoGcmY+BgnwoiICFgJSKd49xiqWMmol0ZG16n4l8coqThoWOU4iEiVAmd6R5QIaxmIqEgJiKkJpWoXF/iw94f4GXVp6HfH91Z32Me6t7Q5GHUIOZfFh9cVxHfJKThmeBhJtzR3l2gI+HTKhxh6Z/j3uChsR7jHJ+ToSMbIVvdYOLuHyEhW2Bb4CBTY1xh4+MhoRyZYmDeIh+dYt4O4iGf3x/TXN6WcqDcIi2Y4h/eoZYl3tuoYOKgX+MfYSafWKhfY6HoIJwhnd+eYBzh4B3fXhZd3pEbmxse12CMlWchfFpdYc9Y4OPg3aEkY6Ug3yKen2Ef395bG1EgY2GcIyEbISFpJCLeoF9P4h8fnmMRHd7goqWg6CLc1lxgJGJhnSMlIqDiFaGgIh4JW+GeUaEsI2KgYOVkY+ZVbJyhY4KenyAmVaChHmBfGh+jH6tdoyLiVKDrX1jTXVRSYKQmI1ogYKeck96dYmQkEWmcWelfJV+f3nFf5B3e0uFimuHdXaCiKt7hJN8fnCCgkyJcoeLiouWdWmKf3RTinJ/g16ChYF7hU10dmKGe3WHtmaBgIR/UJ57erJ/iol8iH9+nHxqoXqJmp16c4N7fX6GeY5/dHt2Wnd6VoVpZnpgpDBVkIjwdHuIPk5/i4Z5kJKNmYB6hX18hIWHfG1uPX+FeXOQjmiCe6Wajn97gDSHf39+io1zfnyNln+gjnRXcH2JiIx3nZODiYRZh4WCcih0nntCh7GWiH52k4mWtlKxeoOXCH58eZZWm4N4gnxjfJB8rW9+i4VWgI56cFRzQUqJjJmbZ4CFnXBGeniCeYVKrnGUp3yRgYaKxYeHcnpUiIlxjHp7f4ejeIh6jn5sfoRPlXWKkJGDjW5njH5/ioZ4fWFZh3qDfYNSc3dnjX55i7VigX6IcFubdXabf4uVfIx1hpx1bKaDjouid2yDeH+OiXGGe3V4dlxjelJnbZqAW4coVZ2P7XRzhThbg4uEfYOSmJWFdod+eoGFf5NpZz2Fj3d0kn9xf4CrnIuEe3w+hXt6g4x7dXiBi5N6nY1xSGmCi4iJf5eQg5CJU4eDgUcrepV+Poa1joR8ZIyBqJxTp4OBmxZ9fXiVVoWHe4h/bHqjbatrfIqKV3+VeGxack1Kfl6NmmaBf59bP3SGeomNTKKDh59/kX6LhsV/hG93T4GJbpCCeH+HsnaPiol/c3+BT4x4jXqLgYp6WoeFf3iGdnyBY4N6fXmDV3NuZZB4eIu2ZIR/eGBmnHR1p4GMg3qLa4qdfmiedJCPp3puhHR9hodmhX50b3NXZnpKb2uGfEaUOlaVqOx4bYg6mIOKinWDkqOUhnmJe3mDh3iLaGE+dYRweYSEhH9yoJGSgXR7UoV5fYKIfW59do2ZcJePcj5sgJOEinqdl4CEilSJgINEHn+djj2Gr5OHfoCOhZqaUpd7f5gZgIF1lVWHg253enZzjXWtZnmGjVF/kXp+YnFvSoVNlJpniX2lWThwdHyPhVSiaoWggY94j4fEfn1tS0F9iGyShneHhZl3inmLenN4hE2FeYyOioSGeGSN/nZddWx5TWtzf3x5dkpseV6PemQ0sV+IfnWfOJhycJqBi4F7g3KKmH1fonmLjZ+GdIR8b3Z0gn56dIJyW1uCF3Fnan9jkjpUiYrxhX+xMm17i4Z2g42Sj4R6kHp/g4qBdlJpQXeHeHaBhoqCh5KCdn+DekR6eoGEkVhzVnqJl3+Xim9pcIChk4xuiouDf5RbhIKEQSl0mnc8h7F6fYN8mIWMoDyccHmLBXyIeohTiIF3g3pwfY53rG5bi4hJe5l7JV9sTU97i5KEe4F/noEheHV/j4ZMim+AnYKMgoCDvnmHc3tDgoxvgm52fo+kd5R7in57f4RKjHaJjYqHlXZviJl5W3xyfVRofoN/gHJRbH1mkn9iDbRghIJ4oUeTiHCyeYuFgoGFjJuBV6B8ho2dhHeFfXx/cpJ0fHiCeFtjfkN5a3F4ZIwpV4WL732EoTRqAJKEe4aMkpWFfpN/iIWNgXZrcUR4inp3houJhIeXo4uBhHtYjn6FhI1bcn1/ipiDmoZ0UXGEpYaNcIyNh4KJV4eDgl4gb555N4ireoaNfJqHj6BGsnB+iAp8iHuHUIuIeoJ6aX2Nea18X5WLSIKYhxpYa0xPc4uTgWyCgJyBNXx2hIqQTJB2g6CFlYuEhsJ7gnp5PYSRc3RvdXqMoHyOiYh6eXOESod3ho6Kh49zbYyDflx7cH5TZXeIfnp1Um98X5J/aJKxY4iGeZ9UlnhwpniHhnxveomdgFmjd4uamYVugIl8b3qAgXx7gXlbYH1RZW5qe0aKK1SOivd8hHs3Y3iQg3iDio6VhHyBen+FjYV3aHNCfX13fIuKiYqEnIuFfIF8MIJ+g4GQW3QPfIWYhZqIbWBufKOIim+Gj4d/jVeGin5RLXGJdzuFunaDg36aho+ZRbByfYkMeYd9lVCRjXyAdml/jXqthn6GiEqAk3tKbmhOT3mMjXxpg4Cefx14eH+OgkiUdYGggY6HgYPDfYJ1eUuCjm1/b3dsjZl4kn6Cfnd9hUiIdnqLioaOdVyLfX5cfXR+U19xh3+GeU9zhVqLe22JsmWDgX6eW454cKp9hYN9h22InH5lpHqLjJeCdXx8fXV8eod8dYF6WmF7TWhvbn1Yly1RjIzyd3x0OGVWhn94g4yJlYJ5iXx/p4yBemxxPneFeXyLi4eEgZWNiH+BfjSKgoJ+qnp2fHCLpI6ci3RZcoahhoFyi5CFhYdWh4KAVSdwk3g7hLGFh4KAloeJmUeec3yPBneGf5tTk4R6gXhsf458rnIWhIVVhJZ9U2BsV0yCk5GAbIGAn30jd3l/jKpGnG5/ooKPe4OGxH6KdXpAgYtsinJ4fYqdfIuDa4BwfIFHh3qFjZWGiHF4i3x5fINzilNeg4x/fIFOb35Zfntqia9khoB8il6aeXOnf4aCfIaKhZt/Up1/jIuTgXGBeX9yf3eIf3d/ellseUpMb255TZcrUIqN8HV7eDpYVIyAeYSJjZWCeox7f4OJhXppcT98jIV2io2FhIGdkot7f3soiX+DdJYBdluFkZmEn4tyXW+AmoeIdJaTiYeGVoWBf1kmbpJ5PoK1gYaCgZKOkptHnnOBjwV5g4aZU4yEeoJ4bn2Pfq11foeRXIaffFhibkpMfYuSkG2Cg6B8LXl5iYiAQZpycKB8i3yJiseCk3d4Q3yKbI15eH+KpnqQdIOAZ3+CS4p6iIithY94dot5ejaEdHpyanqFfnqCT3N4XZWEb4+yZIZ/gXRpjnlxjH6HiH6Dc4KbfWOifIiLknxwg3t8eYl1h3pyf3RaXnhVTGlsfF2RMVOWh/J/eXc4XlOKgXmKjJiQgXyIe36FiHx6aWg5e5l2dod6hIGBkIeKf4B/K4l7gnuOenJbeoybf6CHclNygZGIi3Omk4SHkFqGgYRRJnGfez+It4OGfn2QhZKeO5N5eZQHe3Z7mFWUgniCdmx9knqtaFuEhVmAh3xUVnFP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fIdcZKGDiIV/4zqEQ56cYZrbK4GBhnR0h3Nxh3t/mnWjYoSgo2PUgJmRuYNmeHx/fH95iYR/YHpDcHiaW5aWcmiRWDyVkVSYdJUoboiNh4OIaJ2EgG+Jf4F/jm6SYVQNeYuCe4OFnIV9b6CLfYKAOn1/f32HgI15hKqtlbCRX4Voiox/kIuefoaRexqNjH1SW2azixSE6I+fgV+dgayMMaR3rZqfdoN3mxiFhmKIcWx9lYLVRIKLilWMiX50YkpMOmaEgaNqhoazeChzh4t+iSire3+3fJFxj5jvhXKDd1Jwi3aQlY+Gg3Z2kHSBg1d0hCp/f3+Kj4uBk0t+j4l5lYGMXXSbhIuAfOcKdD+fiGSd0yh/hYpyW5RsdpSAhZJsk3OIp4Na14eckstwb4l/f3Z/V42HgXR6SHR3m12UinBipE47mJ5blHOWI3qFjIKHhmahiYB2kYF8eoZuiWBRDG6MhIWOlp9/dH2jkHaChy2SeXZvi3qIg4upsIOukll0dImXgoOJlX6HnX4mh4N9OltkqJ8afuOLnHtipHapky+mc6+ZpnqKeZsCjYtyfn9meZSA0EeBi4tKjISDdV8jXUJxLoWiWIuDpIEob3p+i4MUrm+AqIKDb5WN8o+Bg2xPe4B7kZKTiItkf6R2hnprYYYobnl+louKnp96iNSJcZB/iWJ7ioSGhnPqDH0+nJdhUNM3hoJwqkuaf3OieoOgcZlxhKaCadR0lInKinOChIVlcIF8fniJdD56gZ1bi3t8apQ4RYWMWZWJpiVud4R7mogvl5SKd5t/gISHfm9eWA1yjIF9jZKiepJ6noB5iYEnfYV+d4tyh16Bnr6QsY5TjXqHtYmKfJODioyHJoSNfzxUYaF/D33sdpyLaqV/lZwwoH60kZ10lHSPHIuFaIh9bH2Il89Yfo2KRJeagxxeRVlAao6IiHGEgrmRLXZ2hY+HLJt0fbuBjHKVj+9/cYx5SYeIbXtwjXiPf3uHbHd2Z2mGM4t4d5iLi42Vb5CehW6IeodkjX6BgoZt6RJ+QZyaSZTXQoSFdaVLiId0o3l/knGPb4WnfFzEdpWMw4dthIJxWHqHg3p7f3Y3eH+ZT494cVKZPD2EiViWg40tdT+Cf4yIcZeHhXWXjYWDjoZ2XmETdY99e4OVoIGQgqOYdYqENZCEg4GOcp+BjJuzj6iLXpNzhLSIk4GWhYiZjRiKiHVDVV2zfwqF4XOdjGKphoCZNaZxq5CdepJ9kxmHh255dkZ7hoDNTm6OjESRiIkkXDhaO26RjYVeiIO4hyx+hpCOiCqgYnm9gZJ2lY3xfH+DflSAi3Neb5B7j2F1gW6IeW93fzJ7eXObjIuOoGGTj4V2h3uJboGBhYd9c+46eD6cjm+i0zODi3inUJSBcaZ4hJ9whnaHq39X1X+VnLaFdIKJdGV1fYJ/fYN4PIh3mWuRfHVTozRNhotPk4aEL3ODhYSLhXmdioV8kXqBh46GeGBbEXWUf4CKjZyAjm6eknOMgiODfIB/i3SRUY2fuY+sjWWKe3yvg46Iln+OoYMbj5F9RVRkrYUSg+R/noVztYaOkzGrgbqTn3aQe54pg6NjfWRlf4iN02OAlIdLipGEP2YmUjZ1j4qFW4aBwogffXqHk4UynHFtwIGJcpSK74huhntBf4lpfHaNd4xqdZByfXtubYQ7iXR0m42KiKVJkIeEaIuAh2mLiYKDh3b0DXtLkIlWmc9EgYZ/p0eOf3Wge3qReJpriad+Y9t/nY+vhHWCgXJseIKEg3yGdj6CeZ1VjX5oZqhDRXmKTJmDhCR3Z4KBiIwkl4KEeZN2hZqQg4BkWAFmfYF7iZSXf41/lZJ3ioFFhH+Af4yDlIR/mr+Tpo5jjG6KqIiMgpOLjbODG4+Lc1BTarCKEX7agaWEh7KGfZAuoX63k6R7jnqfF4OAcXp2Z36NhNFRWYmDVZGIgE9TJlkxZY+JhWmGhrmHJXZ7ho6fOaZteLp8jHOckPCEeoB1S4GJfHhvlH6QbnaPboJ9X3KCL313eJuZi4CdYpOJfniLe5BhjoqIhYJ46gR7R46KZZbZNoODdpBplIt4o3uDmHOXdISqg2XUdJuVroF1g398b358hIGBh3ZDl3qbU5J8bl2WU0WEh1Cbf4k2ZHqGgYqIbJmGf3iPg4CBkIR/Yl4AepuKeYyMm4KJhaGRdYqBMoOCgX2KT41yh6Gxkq2MVopvhKGGj4WgiYu0gB+UjHc8WmO8iRKI54SjinOsg56MNJl5sZKbd4d/myGEhnF5am59i4/VS4SIp1mOoH5IaS1ZNG2Oh5ZiiYW3giV3d42OhT2jbne/fYdrlprwhI+EdlKAi36KeIx8hnV0hHN/e1uAgy6KeXWTnYuIoWKWiIBUjHuHbH2TiIGEfucKfkGSk1eW2zWDiH+Bcoh2eJt9gZRxm2WFo4Jky3KYj66CdIeDhHR/hYmAgXl2Qn90m0yMdG90pE5HiIdWjXyPM3d5jISDi3GkiYB1i3yIfpGBgmNaDX6PhHyAhpt/jFGjknaIhTeFen98i4WQd3ensI2mi1KEc4eWgY+DnpeIpo0bj4l6QVleuIoehu5+n391o4GalyeqcbecmXqQeJkgi4tsgmBofY2E10p7iI1UjoyAT1deXDRuioyiYIiFx4Qhd36HjY0yq2V8uYWSbZOp84Bvf3pMf4iAjIaOeoZOdIlyhXVZe4IweH6CkZSOgZ1Yk4eBcYh5ik2UioOKf37hPGw9m59qndwyhIJ4dYKIhWqdgYuhbH5hgaCHVtR1lJGxf259foZ0gnaMg3l+dEF5dJhOjIl0aoNBQY+IY5lxjzNpa5B8g4RsrICEdYqDf3yOcXxiWQyJmXuBi4qlf4BRko16fX8xjHx6epBwjnd+rq2Gq4lfgm2RmICRh5uCi5p/KYuFgxRPZbiKGobogZd8hqOBr8k1inKxlpx8gnadG5F+X4lsdXukftVGgIWLVYu9g1NfYVw7ZHeMoluAfriDGGqBgZKFP69zc7p/kGySje9/cISEUnaRgZidiHeEcXKLfX12U2yELoaBfzuMioqbXHuJi2GSb4FKiI6Kgn125hCGRaSbYY/bNH2GdXmHj210qn+DjmyQVoqhj07ZfJ2M0H97e3KFgIBRiIF+ZnxCdXWcaJJ7dmKLRD+RnlmRc48hpGSMiXuLc4eFgXSHgXV/gnCBS1AKcIJ4eoCLtH58jJyKe3h8VHd2eYKNaotwgaymhLSMZ3ZqjaCEi4aMgYWMiB6Hh3IzXmapmh6E4oSNf2OfgaSaOqdzsZKmeYp1myKMkmiMf3R5jH/TO3WGl1SOiX86T1lsPnFJi59ui4CgdAl4fIaJiyWvaH+peJJslZDwf2ZsT01vhnWXf46FhTh3kHJ4emdscY9Ik41yjGbNCIaFS2ByaSJneIEya3VFo3CDlX56kTp1bm+VKoEWmJ5jfDmBWXCUYquDn2NzaKGdXACRQpR7WFRpXUaAboSliaqVjl2FYmZ5DIhzYYQVf4WJn4xsbXhXgYVksYF0hjp7cmh+boOLfJKFXYp7jXMzgVmNW31fbqCBR1FpcXd5comUbY80bHRobHwmhpB/omtwlYqAbWKMi35mkH+RkIEgcZ9blIF6DjssdHB3eH9TgIeOWHmRg45zeIeCeb90kC0rSI6Fa5mLiY4zeHZRLHd5a12DWGdra4anjVeRaoSZaXWRcGOIfmiQd6p4zF6CY22ulJqad41nYYqOiZFxX4x+nX4zYXdzdkiMcXyCYTx9m4F1kYKGhHsvYHd+kWOBHJ+aVG41fj9+hjiEfI95VENqhn03gFCIhG8mh3KQflCIf4hOnoFVf2iCenyHaW6JMYJ0nIFEfEOCaXGDa3+Kfl9qho2TcHmJXX+XnXyDVQBAkH+YdGaCbH+qf39xdXFybXJ3moiUHmeCgnSGJpduVaF2epWFgGJ0f0FzXHtygJCEJIqLZ42EhGp6dX5tXWiJZ3V6hJ6Vm4KogWSHaYKjeHxhKGGUjnJti3CGdndzUl9+fHF7ooJ7Vnlyv5FHgWSFN3SLf4ZuiGuHhn9zg5xhfyd/sYKph4iGXGGPiIqMd257cqR4MnFybXVWZXB8iRBdgGN8f49+jnmPMnlydIpxghR4lHl/L29TdIRyfH+Oh1VmhpSFVYpaiIiCUIhhk2B9j32RgZOAPn9ii4qWj2R7gl2Hgpd9aXdYimmAgYKSiYlxR3uJin18hGt+co+Cf4J6OqZ9pJdrf352n3t/h395dHJ7fI2ah0V3f352fz2NX2Sof3yRfIBmcHu1gDyEe3eOiCOEiXiKhpM/lIiFS2ZehE16fIOMlI2Dnn1qkXaDp3KFSBdyhIV6kpeNjnCGhk1qhIZ8aIqWdz54it2CdopeiW6Af4d7b4xmhYxwb3jHYXtQdH5+qmlviHN/joZ9kWVhgXdCeGlifHp0cINhgIdbZHOQh32Ue4qKg2WEc3F4e3cjYpCFZVF9eWdyioRljowAamWWgGKMZH1ziHhcRJlwgol9ji2PiCV/a4t5h4xpNohRhWuThZttaop4aIBuToiATX57gH5iaIEpf4SThYtudiSfdpWFbYZ+do99hH99hXlmdIZ/kpSEd3x+f34mfVBnpX1/iop/YnB5l3UfmHl5i4dDfYRwf4CUUKSeb2lrVoBZjX+HiqaHgZSAbI15g5p+ZmsldquMZHiRgod7inUxc398cGmXfotwf37UhF2DZ3yGcmaMeGqVMYCKf4NpmW+GaWWTbLRzdX5xk42EioiAXI14DHBufnZdfmRzeX6HjXNsZI1/lVyIiHxvh3Vrb3FzGHiPe3Rig16BanZwZZKIcHhGkXFoiI9yc0l+YD+ceHuFdI1diIFcfliKS3uKbHd/SYWClX9/eHB7cHqBbkaMfkVseIN4dmuCbn5Rj4WIdWk9loqYh3CGfHedgYCTcYR6cnOGGZF+i22CgYSGI35Vaa2EdZx5gQBwfax+JoVwfoiOYHlwenaCg0WRfpNxhWJ2VYt6jYiJgoCOb1SRjYGeeW1kYx2FhH2Ch5yJeZWDTYGCiHVsm4WHcX9/vYiDi3R3kWhvhnRMljB2f3t4boNyen13kHayZYKAdp6WiXiFd06cex1zh2J4mH+AbVmAialoe4mNg5GVh4VxTIV6YXt1dUJyi1iGH4h+lm6JPmuHgl6EcpR/aoCEglxqdnBofm5ofHiLaIR8O3thiwtNhm57fVGJeJqCknqBc1mAg2x7b4k7XXN9eHptgnV3al+CjIRrLYqIj5JzdWyAlX5zXX6RfGB0gXx9bZd7gYOHgjR2enere3CfboNkcoiEeimVf3yMjX97eV1ugnhHjl2WSZhscYqKd4xheoZ5lW1EiIKElnhtcnVjlH9/iH2Eh5SRdFR/gIt7R7qJiHqBbahoZ4J9e456aIN2YJJVa2mKeG2Rb4J8Wp5+tCR+gXGaqI2IgpFinXxIWZNvY4N4dX5ufn+tMXqMl3qRhIqBT3F2fGtzhnJrd5ZdhiuDgZ84ao1gkn9CZGJ7gmuJkoRwX250ZJR/dmJmkHGLgUOAX4cvFntsPYUegmSZf5N2jWNyeYhec4CDUGlogXiFboGbcAAod4l0eCh7f6WGeJF5fomOgDt9entWbjo4aFuSd4F+eIpEeY55modtnnOEW2KEYI4ehZWBhYhadHyNXnxzUm5UpGKJY4J2YjaWAF6AjKNZlHOLhqN2aJ59a3N+eIGGjo5WioBWf4KFfzm3iYh6b3+bY21vio2dhnNmdWaMfoRyf29uaFeKX294i82JW3p4jISRinSSk5grACaDh4eRc3JZZnWDpnmAkpV9fleJPAWKWXp3jH1ybHGphFoTgX3ObreeYoWAiUc+o4ZZh4Rpf4Iuk22riGxvWJgAf3hwgXSMAHmLbn+FFIFziIZvdHyPV2mFjnWPf0R9eG+FjWKEl3GFLn90jIInkIlmgHZ7hYhxlWsOd3F1S3KiXkaslnWKhZiRPnp9f4mSepl2h2B9iW6JWVZ3gYuHdEd1H1uBdWirMYl0cXKRjYJMmH5hM4OfKHx/o3qoeGqadF1Te4WidpmPiH97WHttkYhSiriGa4FzilptdYWKiJJ9cnBgkoaJcXJicdNDgG+Dl4i2E212dmiFkniPiWGXhLx2d3dveXVAoXOEjEUae3+JfJGfjYymFXV7dJBqcymKo0V3I5RHdYkwk3+TboANaYhuWpNpmZBIP4JhiWl2hnl8h56AJG9th4aDkHl3iWGHc4t5iHNAhGhvh26uiHV9a4aGil93e2p7iq52fjyRHIWAX3eAg3J4xHuCgYByd3eAho12n0lxiYNoeSCJfl2heXOZj4R8a32Mi1+GeICXhgyBmHeViJSNb2ttZBhnhGp/fn6MpZKFiXl3i4B+pXd9PyV4eZlskpmFjGJvZDpif4Z/fpCAfW+EhL2XaYNmhk5ngYiCW3Zpg4t3jWS7XHt2ebFbpGGCimdfi4uej4RcioCsazRzgnl1XoZzgIlsandmb4OPmI6Nm0lyenmPbX80op5ydVR9c3qIJXWAl3E1WBuRfGSGVpCEWUJ7jYlufYqPgEmjfApzaWinknFedYdWgnWTfHN9SYljc3tkg4R6bGOAjpdudIZoipW3eX1tgD6ifqiQeYF8e6x7g4GFd3pneHSVkIlzdYmEfIMZkk14uH18h4mAbHqMrXlljXB3kn4yg3uAl46SZIOec11jZpJXdYJ4mZeZiqF/c4GFhJx6d1Qac46KcbGadohjeYA+an+Bf4GXe4Bze4HQl2iBXopugoCShHGEYZSUdGV2p3KGV3d2haZkh31wY4+Eh456YoZ3nWsycnlxdlWBcX+NO2l1Z3eIj46MiogUfHV0f3t9So6Vc3BHd3V6c35vgo6APXNPmIRjjl2EiHVTdn6WdISNeoRImH0lcGaEmoODaHKIWIh8jX59eFyHXW15eH+Gdl1Ze4iXY2yJZ4OBnYF6a25AoYKkkHZ9gXWngJGJjHN4Y319ipKDenqGgn19J5A4b698fHqDf295iJR/XJJwcI6GLIaNcJKNo1iVl3ldb1x1Y1F+f5Soiomef2yHfoSNeG9gH3GfjWpvloKIXH+CUnOAgHlyhoiBcYN+0JR7gWCEdXpxlH5liGx8kXt2eplgf0Z0eE6qaYeAZHGLgpWOdleKf1J4SXZxc3ZkhXF/jWt0b3OFjpCFio2BPnt4aIR4eASbfoJmYHF3fXN1aW2SiRSMapiLbYpph4F1e1lojm6YjWyGWYmBAnVQh3t7gWt+hFKNhZR6hXtxh3J3foOIjndiYHuAhV14hDaEhZaIgGV4RZ+DmJJ7dYOAloWJh4t7dW15l4SUjYp8hn57gCaBQWixf3iRgYV6c3aXgWd9cXKLjFV9inmIiqtGnp6HdoZhhG9/fYSPkI2FjnpriX2EinxwLhFrrod7jpKZiXWHiCh7f3t1dIyFiGZ/hcyQeXptgYt1eIh9Y45ncIJ/gW6SY35tbXKDr3BugVuSkYZ3jno/hH0ZZ151eHx7fXR4fo1abHF7jYiTaoiSelZ/e2l1enE+kI51bIGCcYNmbktsloVCkFuehmeCfXV/Zm5gM5V4f4lsiHmGgTh3eIo2cohpholLjnCSeYF6fX5pd4N+cIp2Wlh8hXlsa4SIfk6Ij4NpbhmQhY+ReoF/f5mKin+HgoJFfpBwk4uUd4l/gYQdfjRgpoR/lnSCe3B6l35gk2Z4jpBcgHqIeICZT4p2mnSOZlx1iHmHaoyJhX9+Vo54hpx1dWJYVo2Ge4GNloV+jDwue4R+fWikgIp7gn+9f26AdXyGdm+Eem2VaHt4hnx0hW+BbXtxe7FpfYNqlo+FgIN9AIZ7LH2hdXSWgYJ0eIKLm3B8fJiEk3uJhmdZfH1ednF+AGB7bpxWe4KYc4xFcpKCRZBul35thIZ2aGd0Z0yIfGmOfIhrgoRxeGSNM3t+aoCFS4tzkYCneI9va3aDeGN/fiFme4RxVn+DiX5oToCLfnsQf4WlmX+CfX+Qi21GfIV4W3aCZn+AmYWMgn2Ed3dph42GfKFyhnxthJWAZ3lie46MX312iWyDjEFZkKlshWh8e4hokGpzhHyackWKhoqteHNGbkaLfHt2hJyHhY5ZL3uBhJBWp4mTa3d1pWRdgIF1oYJydn1tlHOAcYR8Z3trlXF2iXDCbY+FapCmiXmKgmeMf2V+k35xlX2AhmCEiZ2FcIeehJB/joZiU4uBZG50iW5+lmeILoyFlnJ8UESSeW2GcpKFb4CPe1pwel9Zl5V1cm6FYYOEXXx1gwd6hWhrg1mHdJR6gnaRh2p4gmdzf3hXant+coaEhpp3NzNykXWAHXiHpZN5goOArY51K35xezl3f2hujKRzioV5iHh1jYCOKneudoFscHqUhml0hIGNiGF2f5xbhYAbjVSfan5qgXB3LZRicmWAmmV5gYiFoHpvh3dglYCDa4CEh3WCMC9+gZiUXaZ/kHuDfbB3bnmNiKCGdXx5dY5Bgml/fnKHeI1wdYxqzXOFf2mIiY6Kf4SBf4BgI6VzdYR/j2pee4uua32Ql4GFdo2AfZF+gV97c39VTpVpaBaHeaNueyJ3jHx6VlWMjW+BiXp0cnuCcpqKaI1nj0mDho1/YIpceX5yQnZniH2QhYF8f4toZoqIdIWIS312eX99foaRbm0UfIKDjUZ4lXV8fYemfqOMZTyChnpfdIBjYpeYepJ/hIdwfYiCj5l4mmyKcnNxgIhpcYSHlI5zeHtcOoplUn9Mi2t4d36AakKaeVZjfYl0c4B3gZl4c36HeIl+kHeCmY11fDNOd3aKlmKOtZNbiIC7WFlzipOrj35veWSUW4d0gIBhqH+HdYmMWcxcg3dle4eKl4WCYZeDrmWHfnJjfVmOY4WPVYV8cHSNmJaPjZdcenmAgnh2QoaIe3RdjGKAmH10iYx5QHhji21vd3WXhVBRd3GQZG6SgnaBmoIpc2F8s5d+f32Jb4l6iXqYfUmMQ3uDb3WAhHSFe4qIeXV5aot+rnZ5S4o9j4pqdn17fXW5c4WFinN6ZX1uhHV/VHWJiISCIouHZ615d3SIhHdvdZ2EeZR1fpOFSYiHcZiCf4NihnJlYm2ON3SCaZebk4KIeXmDV4OWe3RYAFqRjGmgko6JZoU6Pm2Dg3yLnoN6eIByqqlhiGmJbXR9g4ByVmGHj4BwdaFffIF4pnSRWYZ9X2eIhpSIhFiYf6xjYX5qbXVgh3SFjGR7en54iJORioqXLHV8b4d7f0Oln2t0YYl7gpSOc4+PiROFWpN7b4yPipBcTHR5lHCGj4B1RqB7J29kWqiCgHZ8jWyKhIOClH5bj2pvfnaQg3hldX6NlHZrhXWHh6d4g3aDF4+BsKF0hIF4t3yFh4lpdmt7e5qOgnR+i4N2fxqJam+8g3uBe4JybYihe2upcnaLgz+BZHGdjZ6oXX5zYmpjjVpxf2aJqpSInH56f3yGm3hzPx5sqoxfkZZ+hXODO1J0goaBf6R+dXaDeKyNdIJdgVx9co6Hbmlvh49/aYKlWoBFf3RxlnuGfWtui4CXhHdiinSZe1x/aG54ZIZrgY5ff3NygIqNi4aOiU1yeWpyfm5PooZxc2l+cn6FiYGIkn1pgFuRgHWGg4KZgm13mIJsnJBnclucdURiXHmkf3Z3fodwjoCEd551ZoJndnx9iolzamiBhJ9ac4JxjH+efoBlehiLhbCceHSFeH93lYaMcHZrf4Sal4mAg4iEhH01iCBrs4F5dH+DcHuLf35mnnRxiIg7gYd6moetW267bmdxZoRRb39sg5OPhpR7dICCiJR5bWYWYbGLY6SNf4Z4f2M5c4F7dHiHg3t2h3+4k2d+YoV4gXmIg2yFcn2XhHOAlkuBd3J/d5xMd3VfbI1/fYV0aIp3XnZPgmx2dGeEeYCQXXN2fYCHkXWAi3tlfntvend0T56Qe3JzfXRze5J3cZOEEYtamnl3h21/j3Z2YXqNaX+Pcn2AhnxGamqJlYOEfXuFZI+LiH6benWFcHSCfX+Hb2lZfEKNYnCDe4N3jYaCZn05k4aKlXyBg3uVg5iChXt2a3qTjpWWjH2JgX97Sn09a7WEeoWHhHZ3fnx8a492doWNUoGJgIyDrERknXt2hGKEP4d/fI+aj4OBeHWDgIaTe3ZmE3KTgm6ri5aEdnovQ3t/e3hvjoKCfoqFuI1simyAeXd+jYBejmp8joN/gYJXiFpzlGqlZl2FXoyNfICFcV18dT94a4R1jniGfoF9kGh9enqNh5Fzf4htXX98WHN5c1WTdnB6a3d3eHGMVnGOgkiaWZqAdYJ8eXtsiV9skX2SkXaCf3x4WG9wkXWNfn1+hV+Rg4p4m3qFgGhwh4N/iXRjUX2ChmKChHmATo92jX55L4eKj417dIh/kIePfoWCfoF0lHqXipaCi4OCgnh0a3WkhnySgYh+dXyPgG9zdneIkV99foN6gK4meKuVeYVmdm2QfIJugYqAf3pwkX2GjXl0OGZOgoF/l4unhG2AMDJ5g4CCZ5OGhnV+g7aOcoV2dpdyg36EX5F5enqEgXx5ZYlvdaGFtGx5i1+LjYFuhGtJcoI9ho1+e5l9hX96fo9xY39+loaVdIKEZYGBflx4dIM9kYZ+Y1x/d4ZvlFRuj3pDlGmVi3WCd4RudXtrXpiGeIh5hXd/fHVvd4RSgoR8Z39gkHaNe4d7i4JoaoZ6eIR6RWB4h3RojoWQeG9igIl8dBGBhZyfenyThpKMgE58fXtcd4phjIKZjo2JioJ/eHZxjoh3rmaEeHSAiXtxdId8iY9YfXiNaIGYGGtlqHB/XXR5inCIbXV8doZrT4x/h4x0clV8Y4Z/goqJkYFtfUE3e4Rwk1mOj5Fzf3ywdmiJg3+YdmiAf2GQcW9/g3+AdnORc3mrdNN5fIdyjJiHfIh9U3mFT4CZgHSae6aIdYKNm2h+Z5WElXiJg3+GiYNUeXN4SXhteZUNgnmOfadoaZNyW5Rsjod0fZKEaGVyb2qSkmOIeoBwgnueeIGCXopyfFN2W4tzknZ9f4x9fGeIhnyMgDpjfIZ4dI6DlHRUTHyIgn4YfIGknoB2lYe9i21Mgnx1WnaBXWp5mpuOj4aEgXqMeoONer5ihnl3fHWBaHmOgYqKaYF8nEKFghiAYLBmeGiBeHQ9jlZOZ3aNcXOFhYWSd2xxiGuOgYyIhKiEZIM6NXyDg4xZfo+Ga4R+rG9igY+ApYRseYVikHJ0f4KGdYl4jHR4p2fSf4ttX5CGj4WGe210e2V2hIB7lX+XZnCAkLN/gnqciZN5jH+GhYuDcH9we2N0nn53K4MkoXSXVnWWclNuDYmGY3p+g257dGlvg5OCf3WIU4mDmnh9clBshYM9P3OLbpKDdXqAgnNwh4xghYZIXnOEfIKBhINpb0pvhIyGRXeMh5d9gYaAjIp6J4mBfX98iWRgep5/j4qHgIF6jomEl3G0Z4d3eXGJgHyNbIaPiWZ9e45Sg48Cg2W0aXh0fkpnMpJ3cDNmf25niKeEd31ieZBciHuTsYeYhpt/OVF6coqSRoqxlHWFfKVxUX+RhqSFc3x5dItleHmJfHmGgo55eZdxoHeFfmZ8h4OOf3hsnIuUe4uMbHN5XY9qhIVNiHp0foqPhYqPijh5ent5gWYZpZ54enGGd3eVcpSEiItmgHSObm+DiIp7X19wj3BueImAcGqRhWVraYGvh4WLd4R5hYKChaR+aYptb4hrkIN+dZCDi4KHc2yBkIKWfoIliEJ+fmqQh3t2e68riICIa4JwfXWPcnJugoZ/goEVhX9ntIVxcXeDc3uDnoB/hnSGiIMAe4x7no6QaWV7dXxndn8peIFQlZWMhYJ6f35yiJR9cC1Me5CfVayUdINuhzt2coB/cn2veHR5fGyUpXGAaoNnd3mPgHZkb4yIhHuEqmWAdn6DdmxXg3dmbIeAnHh3XZV2mXh/hV1qf2ONcoGGX358f3mIjIOHiYZRfnxweYJ0Gp6Gg3Zzh3R2j4V7iY6EeHpbi3x1jZiBkWZtbIWAaISSemxonHhjYW1ruHtyhnWDdoiIcH+qgmiEZ32EeIuEcnqGhIeFb3N6fI93ln6JS4UShoOMmH6BgHmndIeFind5cnyBmIx/dIODgYB/F4hsZ6+Dd2x+hXF6cqmCfY93gIqERYOFdJyIpGtQinpqbGqCO3d/RYiYj4eOfHd5doeFfGkhGnSZjlWrkHiEiYEraXmAgnl8ooN+doFym5BvhWSJb3d8jYF0bnKJgoJ0iJpce2Z/iXVzZnd3ZGOIfoN4YleQepB2dYRocndyi3KEiVp/enx9h4l7foeDXnt7cX6AcUitnIF2fn99dIOAioONgFx+XIx8eYymgY53dHSUg22JjWRyZJJ3R29sfZp/hIZ4g3+JjHeBn3tyh2B5gnGAhHpsfIl+mXBwgYGLd5B7g2ODEIaEjISHfXx2mXqVgId0enCAipOWloB/f4J/fj6FYGythndvfYNzeHd+gHyLcn+EhTx9i3uZhaegXbR1aHZpcGGAfmmAlI6FiXt4fXiJgHxzZht9oZBoqYihg4F9N3F7gH96eqCBfniFd5+adIZjf3CFfY1/boBae5KHco6WWYJEdJlmemZ2gmZ4i4CTfm1Yh3dldmeFcXl5dZF9goxof3hWgIiGiHSGe255fHB2f3hVon17gXp7eW+BdHV0i3lri1qNd36Eh5SNentueYF4jY13eIaGbUxraX+nin+Hfol8i4x9eqF7fIZneIJ2eIRycmt+XYlgd4WCi2+Lh4d2iw2KiYWNf22BfaCAlX6KeHxye5+GlICKf4ODjX1qgG5xpYd6g3iGdnhxkYN/f3B/gYdZgYaEjH2jTlOSf3GEaHVXh354gZeJg4R6eoKAh4d/bm1cZYF/fp6ClYSCejNbeX98fWyUgH99gH+dkHSHbIOHfYOFgGuLcn+JhoOJc16Ee4CKbYFgaIlogH1/e4BRXn59VH5xiHyFfGyKe4CMZ3t6goGIinVwgHJ/gX5seHx/QI2MfnSAgYFte3h+e5F/UY9yjm97fIF7fXt2cG2MfYGMeIGLgHFTbHSBjIODioWEfox8gICHe4KFZHCIdnGEd29ge31+XoSGhYFlg4OLfoAdhoeHlIJ8g4SIiZR4lXx/eXuLcZaSk3+GipB/d35tdZ+IeouAhHZ7gXGBgH94f4OJX39+iHp4mEoAjINti2d4cox6gnF9hX+Ic3uJeoVzfHKJd2WLfoKVibCCgX8mU32CgYdhjoWBgoN6n5Zxg316gnyFgH9aknt4iISFh3Rphm9xlnSSXW+MbImHfX+Ea1Noe0yIjYt5koCFg4R8i36Dh3iKhIx2f4RxiISCY3N8hkmFZ3+ITn96ZnuSa4COeXKEbId2cnOCh3NxaXdxjotyh32FgXpwhm11f4WXeol2i3mLeIJ9lICFhnd0iYBtgYJnZXiAeF2WhI54T3SDiYyGFoSMl46CfYx/n4l7coJ+fGp4hmSNhI+Nio2OgIOAcXqKinuZZYZ0eYF/gISBgIKEiXGGdopueII/aWuSZ3togHh/a4dsYnp8lHl2h4CGeHpwZ35Ve36Hn4ufg258SSN8gn2MVYOQk4B8fJ16fIKMh5qCbX5+Z5N7f3x/h4NmdoiCcpaBuGN6g22OfYVqg3dZcIVbl3eJgI9+gXV4gIuDg315ioeReYJ/gZKKhHB/codFm317fjeFfWR4jm5wim5gilyJf2opd4p0b3R+cY6SeH5xg3h6eX5zcHyKjIGMb4F3iG6MfnZ5hoB1eIp8c32IOl16fHhxnoSDan5pfYaJew6BjI2bfn+RhKOKfF2Cf31ufYtbf3mWjYqPkH+He4JxbI16pFuBdnt4eIJ/gX+Fh4ZpgniZZYJ/SWJamG10a4B3eTuNXmFpdpB4cX12g293alyIWoB/iJiJpIFwfmQnfYB9iEt0gZN7hnuhhHx+lH+VhnV+gGGTbnJ/hIaBcIWGgG6debJdg4Nyl4GMg4R2Y3KGcpOJlHmQf5Zpd4CJq3yHdIaGj4CKgISNiYNuf3aAXZtXcoMAgHpUgYpieY5udHJfgIBkc42EaXF0gHOMmm57eYVpfn2Nc3Nzd41+jmY5eYVtjnyOe356gHmLjmSHiCA/d394dI6Bf2VrV3aChocIfo+BmICBm4PBhnFafYB6e3qDUmRzl5COjISDjHaJgWiOfaBwhHV3f3uFgINwioiFeIV3nGKGfA9YYZtqZ3CEcnYukl1Ua3eJcm+EboR3g2tdjGWOepKgiKaEiYNKLXt1hJRHhGuZd4F6lHl7gZqAmYecgH91kGJ/f4mEfnyGe4NyhYKgZ4Z6UnSFhJxqflKSf5l9qod3c35ykXmEfkN/e3KEiXl3i4cARnSAgnmAaR54foh0dYN7cpp7loOEfXpvdod0c36Dh3tqanGWcmR2h3lgaYuHn3FrjK6PeY55d3qCjHeBhYN1hWl0iGuAiYN/jpZ7lnRpV4GTf45+hFCAVYJ+boh8hHd8rGt8eId/gneAeI56aXKIfHSFfA+LgHSRgHptfYl0fn2ZhYaAdoyBeUCIiHaeh5xZaIh0dWRyh098gVCLb4eKjXx8dn2FfYR8XGJ4gHtRmI+AhIx+Xnx2fntleKCAf3mBc3udcYZhgmxwe4d/eWVwgHd3eISMcH5ymJR3Qmx/fFtpgX6KanBelYmGhYuHaW57bpJ8hYA+gX56fomAg4GGcE5+fn1+hnA8n5h+c318f3uRfpOHhH2Te2ODf3h/i4B+dWl3mmFwe4d6XmqMgo5tbXGOgIKLc3t6g4lzg4N/eIlrc4V2eoaBf5GSgo17b1+DkH+KgH1bfhiAfXqLh4V/fbBvg3mHcYJxf32PhXdyhWx7gnkih3lzmIV3aH+IdIl4f4OHdXqLgnxCgYd5momVYWaXc3Jyc31cf35NkYiLho56e3d6hnh+dlNbdZJ/XJaHjoWIfGJ8fX55dXajdXp1gnWDi2qGWoBmfHqLfnppYX9/f3KLvmd/aX2MclZndX9ma4SClW5kSot8hoOJiXBwf3KReoOBUIF+g4CHfHl6g2dpen54eIR2T6NyjHmFd2t8i3+Shol/koNfgnqAg4aMi3SAcIdybn2IfWV6inZxcHR3h4x8i36CfYWSdYGYgYOFb3iFdHuHfn6AjXiFd3B2hJB3jnyAcJQ3fIJxgoN2f3uqeIh9gW97dH+CjY+DeYRgeoN5SoF1dJCFeWeBiXd6f56Chop1inx5UIaFe5SFlldskHZweG6EboR9bIeZiYeCenx3fIhygGlwWXCBe29wgJ+FlH5veHx+fnhxo31+f4B8hYZzgmCGeXt4f353dnGChoN6jYdke3qBkHZqbWyAbXJ/g4V0t06Fg3N+gId3dHtvh4aEgk1/f39/gYGDWYFwe3l/eHuFeF1/kH50g3V7dYd9j3+Ld5OLaYN1gIOJhIVxgHqFdXV0hXt0hIN0YnVsfHWDgo19f4KGg3mDgHqBhVF0hmtkh395en9pgG1zgIaLcId4hnSFF3+AdICCeHt7koOMe4xRf3Z+h4WShYB7b4KNe2iCcnGOhX9pf4Z1gXCAgYpsdIh5eWWAf4CLfYKccIp1aIVpenaNd3uBiYeCf3l6enKIb35tdmV5eXp8joCsgn9+X3d8f39/bJ99fIqGe32AdntxgnJ9f4J8coJ5gJGCf45san9yeZdwamePj3SBfIGVf2dPcX9/c3WLeX5+fn2GfYRrgH6LgYOChV2Aa4KChHZ8golSlGV7eIR/d2+Ce4p9imWIlWmDcn99gpB9eGh7e4GAdX19f519bltra36OlYSQe4KBh4B9fqB/f4Fzfop2ZnyDdXF/eXxrgYKGh3BxeYaFhgB9hXqFfneAiYiFiXqHfX5ue4l4kYSEgXyIjoB+f3VxjYd9dnuId3uAiIOLfnSGen58hnmDgHiBSmpvemuBaoJ5hG+GgXeCf4R5eoGEh2l/b5N6c156hZCEnYR0gGpqfH+EiF+Tgn1/gnt5f4N7hXGIg4B8e3iGeHmFfoWLb3V/d3iKbXtrbIx7iXeCdoJ1XDp/cX53iHyBfnV1hHeEfnuKfX+Df3Z2dX+LhoV6gXiMYG6GendmgINpfX2XeolvgJJogXh+b3l6d2p8e3l+jHVyfIeHfXdPcG5/oIOCj3uFgYVrgIKFfH+Ccn+KcGV4g2JtfHt4aZOEhnppbniHhYQae4J6in+Ce4qAiIB4jH9/eXyIZoV/iHeFi4d+gH14d36IgnNxhHZ6gXuEhFh5hHh/f4J3gHZ3e0Rpgn5oe2x+iYVSh2hye3OIe3qBfINoe255gG5+fI+Sh46DbXttKXyBe49pf4Z8iYOAf3+Hf5N0fYh+fXxwi3Z5i4WJiGWCgH94oXePXnmNjY15g3iEf1dghnGEf4d5h352Z3x9gp57kXl9g397gn6Kl4eGdnl6kF6MW3l6V4B/ZHx/jn6Jc3mJa3+Fdm9/gnZwfn90fox2d3iIfXh+i295e6mUgI9zhXqBcoV8f31/gHmHintpdoQgbH16eGqDhINqdXF7iIl/Qn+Af5KBhp6LrYd5d3mDfXZ7hFl7dIp1i4uAf4d6h3Jlinx8bINxeodvg4SNeYl8gXyGc4hwfYBAcWh+a3FshIB9I4tpZ3dYi3x6d3SCaYBxZ4ZwlHyQl4uZglqKbSF8gIGSWHuCfIOBfX94kISbcZKHjnd8cYx1f3mCi4FtjICFeZySjGeAiY6QdoVoiYF3bIV4nHyLeYR+iG10eYOfdpd2fIR5gIp8k5eMhYN7eX9jk4J2dT2Gg2R6iIF+g3Z5gWmDgWpifYR0WYF4eYKVfnZ5knR5gmxwdHqReYSRZT19gWyHf4x+foJ2f4+BWXuFI2p7e3xxloR/ZXZffYeJhVh8fXegf3+SgLOHe3KCioR7e4FQaW6McYuNfoiJe4V6OoZ7f1SBc3qGdYaGhneOfX93eXOIbn1+TnF8hHJwc4R8eT2QYGRyP4Z4eIF0gWR/cmCIeJp+ko+LnIF1gmYlfHh1mjdzbnx4g39/fpCLnoKHjKF9eG+FdXaEiYR+cIt9gHexgpFmh3hNc398glt3UpOJhYGkhod3fn2PfYV7RnF9dn+LbnaJgV9WdoaEhoR0K5eUqnl/jIJ4kXmngXl8k2Z2f3d0gG2BfnJqaYh3bX+CelRsg4aSdXSCnX96kHhybH99eISHb4qCc3aLe26HiH+HgXeAhnAPf5CHhYR8Y4FYdXduf4F/fHunMn16gn6CgX56iXFvb4xobol8F46DdIJ8em2BjnF/i42Jh4l5joI+RniBeaKJjmJyl3N1dHyHSoGDX5ZsioWNfHx4goF5gpFcZXZ5emt6h4SIjnRyhHt8f2F3knl9cn95e41viV55a3J6g3p9ZWp7gnh7gJVnf3iUk3JNeId9UXF7g45ad06PhoSGiIRzcX5zi3+EfEN2e3qAhHB2hH8tXnaEgoKRcy9kcph2eYB6f4eGmoGBfoJwYn55gH94gn95f3aCenN6h31McIKJlXd6c4mHfJB6e3OBjnWHbW2BgnZ8inhsjIeLmX59eIRuIn6Uh39+dmqPWniBbnGBgHp/n2x9f4F5gHt0dZR9dXOIWHN/fhiGhXOAfn9piIxziGmVhIaVdpCBZ1WFgXecgYhQbY9zdXlzhleBf2aEd4qIiX58eX+Efn2JaGdzi3Z3eYKFho19dXx9fn5qdpt3fHp/e3STcIRegXJ1e4d7gml1gIt+dYSMa3x9iYJ7UoJ6flpxfYWHX1tOhoeHhIOGcmt+dot8hH1HfH96gIJxdHZ8SHF9gn+FjXM8ho6adot7eH+Ke52DgX2hfWeAfYWBd31+d4V/iHJ4eIZ7T3mFg4l4enp9gH+PeX17g4x4hYNqiYVmeot4W4mMhnyAeX2LcmSAj4eGfH14fll4fWZ5foN5fZ1zf3l/aXl2bX6Nhnx3hSR1jH9Ef31zfIN+YI2LdYp4g4aKhneQenBdg4J6koN0UW+FdXR5cYRuhH9zkJSKg397fXd1h3ZzfXNld4N5Y2x7iYWMd3l8fn2AcXiUd3mAg393kHaFXn9rc3uGentseIKQfn2Iemt8enp/d2B3bIJqd3uHkGdgGYOEgXp6h3hxeHZ6fX9/Tnl/eYCBd3I8g2N6e4V8gIt+X4logXiKc4p/g4OUg4d8o4ZufoKGf3p3f3qAfn93e3aIfWiOgoBddnZ7d5GDkn99fIOSeoKRcImEcX2LdV2EeX15gXF4jXd4gI5+hXx0g4hAeINehH56d32IfYN+fwRwam6CiIR1eoRDe458anyIdHCFgVuGi3mDZrODjmZ2jHRwcod8gYx9dVB0pHRsfWyIeop0e4N8hn96fH57eodpcHB4cnp2en9ke6qDf4J4eX59f3t1lHV9iYR4coqDeHR/fXx6bHh5cnh+k4OEinFye31+inpifnGKeYF8hoB7YVVzhIN5cYt+dHBwcXtvf2x8fn9/f3d2IoJvgoCHfod/g3J1h3x4hn99fIF7mH+EcpiLaH2ChXx/fXx6iYSEeH13gX57on+BTXd2f4CJhJOHf3+Cd32EjnyEf3WEim9ffIpmd359fX9+gYOGeXt3foWBVXp/Z458gHt+eISCfXRtdHdzgHuEf35/bIOMfXx9gXJzhIpbgIZ3f4eQhYmBeYlycY+BeYCEeWqscHx3b31rhH+NUYSKgYB5fH18fnWEaG9xnH96enyHd4COg2l/dnt9f36DeIp+fZKKgG54hTWKgXCBfnx6fXhzfZODhYhsfH57fZB6b3doh4uKeIaAhHk8AIF8e3eHdnZvbmh7Z3+EfYB9f4FjdnNyg499iYCBf5Nve2B4fX2Ff3F+foyEhV2Ej2x7gYR8fHd6eIt5f3eHeGd/jIx9gVxzf3umhYeRgIV7gXt/fo9+f315ioxuXoSHYXJ/e3p3iISDfHJ7fISGg1x5em6Zf4F3f4OGf316gnJ5fYRrf3h/fIGIhn+AeIZ1X4SHZXuGdX2EfoKJf3qJdXSUgnd9fHxwTHGKeW93b4OXiCqIc3V6b39/fIB+gmx4c3WFdGp8kYSFmYFigHZdfX+Bint8e36Qrn9sgo5+mXWFh4B9e3Z+c3qTgYiGZYl4fn2PfHmBe4mXjnuGboh7ZF2DfX92h3N8c2tqel1+lnuAfH+DXXyDeI2VgomCfXqDXXh8c3xqiYRtenyNgIFziI9pfoN/dXp+dnOAgHx4i35pe5N/fYZaeIJ+lYKHkIGBe392gX+DfXl+eIaLdmFvgxpwfH19bZaFgW13cn+KhYBgeHJykn6AeX+IiIB/eoB5eHyAZHV1gXaJiHqDgXp/diyDgmZzgXZ6gnKEjJV9jHZ2i314f3h+e0ZxpHt0d3GDf38OjG9ydE+Bf3pjeX9vfnRwiHyIf5WGiH6BZ3xzNX6BgZN5d314hIt/cHmNg5+Be4uAeHp5f3dskIGIg2yRfHt/mX96fYGDl4x4g2qMfVd2h3+DeoV5gH1ra39qgZN1g3t/hF17iniWmoOIh398gl+AYHt6ZIOKdnp7eoWEeneDZn6FdnR3f3Z3kH14eJd+aHyXa3yIf32FdomKg5J6THd+dYR9oHx4gHuEjH1id4MjcHx5enCIhIFcgYN8h4OOW3h+cpKDfG19ooR5e36EgH18fkpzdIRyjYh6hYp4en0uf353d4J1fn52goeGe5B9dYSAd3h1f30za6F9cnp0gH54IY1wcHJGf3x7f3d8aYB0aYl8nn2RkYePf3yDciF9gH+XeG54e3uBgG55jYKdfJOEint4dXp2Z4uDiX9kkHl/fKiUbHCEfQB+fHqCBn5pkYOLgJ6AgHd9fYOCgH1YcYB4fo1RfY6DBlhhjYt+gXYrhnSNdoWFfniKcYt+eX1xYm1+gG90i355kX5sf3h0eoWAV2N/irCCd5CeinGQenlteYd8kX8ojX55fYtxaoCDjIOAenx4cCp/kY18hIBzhnx6cG6DpIV4fJAAgn90f358gnqPenZzh1U9gnMPkIJ9cWaCa3uNdYaOpoyImXuWhCdeg4R6o4aCMmyodnh1fYBMf4dninCFg4R/f31/ZWiCnWx2eoyENol8fIqCcnN/g4GGZWGbd3t5eH92oWyFZHdydHqDdYJqcXmVb4KAjW9+dn95d1aBhnpLf3qBfxl5Y42Ff3yTg2xvf4CEgIR3VnuAdX6EOH+EeRpig4mIf4RyIIKKhXiGhIR7lYWOfn19fWpueYB6e3N/eXt5cXx8dXx/fE1qgoyehHx6i4Z4kXh5cn2Hf4R7RYaAdX2MeGmEiJOffXh9jXcdfI+IgYFmc4yEeXVcbHh7eYCScYB8fX2BfkF8lXVzdYZOcYN6EoiHfXF6hGqKkXiHhY2JiJx7lX1nZXx+eZqDeU9sf3h3dHeEWH+BboZvh4V6fn56fIGCf51obHiXe2aJgHWJhXV1fIB/fmdsjHZ9eHmEdpZ2hWF8Znx9gHl/aHN8g3x3fJRrf3h+jHtjeIB+SYB7h4lGdEGGgIZ7lYV3coB7hICEeFJ7gHiAg2BueXpBXH2GioiDekqFbYh2gXtrgYl/gn99f3tya36Fgn92fHiFfn9+dnh6goQ0b4KGqX1/fWeFfpJ+e3R/i3+McxOKfXd/jXdkhYOafH58fod2TH2Ti35/iXp9g3h+X4F2fXeAdmh/fXxzeno6eph/d3SGAHGNeSR8hnxofIRghpB5i3WqiIqUepV4Z2GFgXuTgGg+b5Z2dXh3gm5/f3OCj4eCfH99e32EfkKCc3Z3pXpwbnx6iI6Afnx/f39rbJB4e393gXKLe4Fjh3Z6foJ3gWl2gZV/f4R+cICDgIKCZoV/gGJ9fYqDZHRLgIaJgneFfm96dnp/gnxhfH93gn9wehF+XnqHh4mCfn19g45+eoR/eH+CgXSDfYKCfXB+fYGBfoJ5hIiEgnp6fYZ+X4d/iImAeH9vgYGUg313gIqGiIN0kH18gox2XIWOe35+dn+be3OAjX13fXCAkXt7f1x4fIR6fHF6fX58Qjt6LX+GfXV3hDh4h3pke4J7X3+HYImLeomFiIaHlHmScmeJgX1+joFhUnF2dHZ9c4V7hWp9iXmFfXZ/fXx5hXFIe3V9eHt8jY93gIV8gH6Cfn5/dn2aeXx+hn12kYJ/d4Jwen6Adn5ueHyFf4WEe3V/f4GQeWZ1e4V7hHyJhHl0S2yCg3aThXtxO3V2d3J7d3yAfoJ/aHQl0XeIf4mDhYGBiZFsfXiAhHF+fYB+gX9+h4F2eoGAf3t8e4GVgoB6enmDgH+ZgIZkfH9+lHqDlZx9eX9/f4eigYOAfYiNa1p5iWd9f318gHt/gIqCe3d+h4V8e4Rch4F/eH5+gH99f3Y5end+dX13eoRmfYOAfHyDfFuAil6CiXqAhqKFh3R7j3FokoV7foeAVUxvk3dydHGEe40zhHV9gHh2f39+eoRuOXSiin1ve4t1fYyCbouCf39/gH+BkHp/gIqFcIV/c4yBgYN+bnV/cHN3gX6DhWt/e4F/gIBjmXiIk4Z7hnKCel0ygod1lIR2dD5ubn0AfIV/fHt/gT99dH6Mj36Jh4F+gnuAg3t8j4KFfXx6f4R9eIqDc3uNfn98enx8hIKBeYR6cX6Ujn+IWnuEfpeZhJOFgXl9e3qBmH96fH2PjHBhcYIAe399fX2AhIR9gnt+h4OIgXp7Yo19f3x8e4aDf3qCOX1/fG14enh/fIOGgX16hnpGf4pcgYd7f4WLh4aAfY51Z5p+eneAgmGya6h6eXRxhJiBAId7f3dpdoF8fnSAd3pzcZF8an2Rfn+GgmaBf2l/f4GGgH97fISOfnJ/g4CXhHGJg313fXR7co6ChYRtkX1/gJJ7bnx/fpqJfIJwiX5zaod+dJCBdHVDd3WAJ32Lf357gIEXeoN1l5h+i4h+f4FXg2F6d4SBgXZ7e3KAf3aAh3R6iHyBfHp8e5F/gneOfWF+l3h+jW+EknmJiImTgoJxfHx+gJB9eYF9jYpzZmV+MHV/e352gYWBZIGIf4qCf4V6e2yJfIF3gH+Ff4N7gnt8foJldnd+f4mFcoSAe4F6F3+FZ36DeYGCeoOFiYCRdWWUfnqAfoF0PGmZd295cIKAfhuLeHZ1ZnqCfWd8e3l/dniNfI5+mIqCiH93gHkbgIF/jpR4fXp/iX9wcYB+noGBhX55eIJ3d2GJgomBaZZ8f4GZf2+JfX2QjnqBYYd/hnqFdHeTgnp9gXtsgBl9kHZ/gX+ERoCMc5aNf4uNfn+AS5B+d3iSf4J4eoF3gXx2fYR5eohygXl1fHeIfoJ2in9mgplwgI93hn93hIyHk4FEcX13gXx/enV7f4GMpHB5fi1xf32AbISEgFd5hX+LgoWAeXZvmX58d4GMhoJ/eH6Dfnx+Znd5hH+QinuDgXqBfgt8g217h3h/eniJhJmAknplhHt8enqBfElpiH1zgHSCf30VkHZ1dAB9g3yAfXZ+f3dyk32HgJaOhYiCgFp0D4GCgJOYgHx+foCEeYODhZ2FfISAd3aAdHqwiIOGgWaQgH6Bo391aYB5O3t2b3ELh06UhYOEj4GmgIOAg36Ka1h8fneBh0WGjH8waGiTjX5+eyaHe4F4iJZ+gYd2dH9wfohuanaDf3KAeXlcfnGAenWAf3pfcniAqIZ8mJx4b5R5fWR5gl15ckCVgnZ8iGxldYZ1eIF/cIl/D3mRin6Da4CKdXZtcopzfnh8mRmHfnuDh3mCgHp6dHSIY2t4ZxqVhXtseYRuho95hIqJhX+6f5aGU2F8g32igoVHcZJ1eIJ6fliBhXF5eI9/fHZ8goN3Yo2obWp+loV4h4p3hY1tgnt9f39pX6R7fnl1gH2adIJpd293fnp1g2pzgJxrkX+IjH99cYV/XoJ/gSB/fH6EAHdXiYR9gZGArHmGgnyCinlnf4J9f4wigYt6NFaDiZJ/g3gmjmiFepCKfIGTfoGAe4FrdXJ/f4ZzgHp4h4h0fH5+foN+WG6AhqCFg4OPeXeXdXxxgIgAkXsMkHx8foxuboCGkZSAfIKGfhyBk4l8g2R/hn14c2Z5fIBxgnZWhn5xgYZ/SoCCfndyh0xyf3cAiIR/YXKEZX+UfIWGgI9+rn2Yf1tqf319nYRoO3CWeX97fYBdgYNzhG2KgHp/f3x/fXSCpW54f5iAfoKFfIuDc3l6f3+Da1+Xd3+DdIR3oX5/aX10fIWEdoZpdYKZdYGHimmDeHtsgGCFfH9SiHqHeQh5UYSCfn6VgI12hIB+hYh7dX2CeX+BVH99dBhvo4eNhX13UJyFgXuBhX2ChoN9gn19anV1foqHfnl6dot+fHt8en2Dgi50gIOfg3+EgXp6lHt+d4GDAYl/OY5/foCMcWR/iJCAfX+BhXxhfZCDdIRbfH6EeXVhYHh8coBka4N+d3qAfgB8gnx2cIhGbYlzJXqBf2B5hV5+kXqFgoiMeoV7kn1fbX98eZKCVlJuhXd8fnp/Y4SBeIOMiX96fX57fH18QZNzdniTfZSEgm6JeXl+gH9+g2xolnuAgHiAdpCDgmd9bXZ+gHeCYXWAfXeHgYFyg31+iH1peoB4V4F6jIlcf0B/g4p6r4OAd396eX+GfXSBf3mAgGp5GHBcc4+Ij4N/f5usc39+iYR5f36KeIV9fXJ6dnuCjH9/g3yHjIZ9fHZ4gX8wgX6CmIGBhH2TgJmNenB/h02Nh36AfX6Cimxdg494g35+goJ6eoKPiHt+cYCLhHqBWW+BgXh+gHN6f3wARIFCe352aXOJSXaFdl1/fn9jeINlf498goWmiH+UeZV4ZW+FfHuLhExFcoJydnh4gXR8Zn19gYd5dX9+e3x+eQB7dIF6kHudfnZ9h4mMhYWAf4Fyeo97fn18nXeGfoB9gXl+en5ygWJ0e36GhYJ+e4KFgYp+aYKAfWaHfYl7e31sdIJ1eaqIcXdKe3d9ent9f396g4FRexN7cIKAiZOGf3+knn5+f4mLgX98hmyEfHmGe3Z9iId/fnp7g4aHfnx4eoKCiJJ9h3CBhoJ9hoGXkHdyfn57g2aKfIF9hYt6X3+FFoN/fIKFe4GBi4dwfXeDjYN6gFN6fH93fmh8f39/ggB6f3lxc3Z0hGN9hXZzfoV7bHqEZ4GLfIOFfol/iHmSd2mGf3p7hYRCW2h4d3p6c4F2gwGFe4SDcnOAgHt/f3lHfZmWfoJ9kI+AeIR9kIOHf36BeIeEeX6Bf397f3qFi4B3dnh9doJidXKFg4WBcoiDhIWKe2eJfoKEh32HeoV9UyOEe3mkgnx0AHhxfiR/ioB+eoGEMHt4comQf4yLgH6DmIpmfnuVg4N9fXxyhX1/gHd0d4GMgX1+e4KUhYB3gnx/gJd8foZxgZKAiZKJl5uAcn98eoiUiXmAfYeIdmB2hxt+f36BeHiEhYOIf32Gg4OBeINaen99d36AgX+Ef4BEfoZ8bXh1dX56gX6BenuEezB6hmaAiX2BjIaBeo17k3Vaj4N6eYODSVZvkHt4e3aCi4IZiHR+emZwfn15fnp8fnd7lIBhf4yHeo5+eaOCZH5+gn+NgHx6f4B/eXiDfZeBhYR/fXCAbXVxhn+GhmyMfoSDmX5mjnx/lYp9gGeJf4h1hXN4kIFvd0d9cYITf4aAf398gRaDiG2MlXuHjH6Af2qNeYB4moJ/e3x7b4J7enp+eHeCg4Z8dHx4iniCdYt/bYKcdICMaIZ/eoOFhpiEeXN7fHp/hoR+fH+EiaRqeoAmdn99gXF5h4JlgnyBiYSKeXx9Zoh/fniBgISFgnaBf36CgGl3e3iAioJ/gXZ8gX4JfIVzeol6gH57hn19fo94YoJ7fHd+hGS5Yop9dntxgHmBGI10enNAfYF/Zn5lhoV5epN/eYCehnp/gH19ew6AgH+DmHt5fYN+g3mGf4OWf3OAfHp4hHR6XIR5hIRmjIB5g5Z7cIR8gY+Ke3VqjneUe4x4dZV/bHuAhW2HLH2Qe4OAfIgWfo51iI96i5R9gIAxjmR9fp1/h3d8fGt/f3pzhnZ5iIJ/enV+eZt6gnOGgXWCnHuBkZaIe3aPhIaSg2pseYODhIqGfXqChnyfeH57LnaAfYFxfoaBXoGCf4qHhnB6eWqMg4B2g6WAhYF3gop+hYBmdnmCfpCIfIN+fIaAE3yDfHiCfoOCdo97poOVfFmBdnt9goeCRm2NgnmDeoF8fw2Od3p3B3x9fYGAbYGIe3mVgn9+pY98f4CGbHkAgICDiJ+AfX5/f4V9iI2BnYCFf4J7colpfQmEfoeKYomDd4Gyem1w5/8uAC0AXwAAAEgAOgAxAL7/wv8iAGIA/v/U/2sARgDF/8b/0P/N/7r/6/8AAFsA5P/d/wIA0P88ACcAlQDn/zkADwBVAAcAMAA6AE0AGQACAPn/0/9/AAkA8P+2/zQAOADs/9v/JwD//+3/MQAuANL/9f8AAKv/MAAxAML/+f/u/9H/2P/N/y0A5//4/9v/JgDZ/w4A8f9YAAkAwwAwAOb/4v/x/+r/XgBRAPf/sgAkAOD/vf9uABIAEgANAEUAzP8kAAEAx/8lAJwAIgBx//z/bAD//97//v/V/woA5v/9/wcAFgBGAAUABQDt/wIA+v9uAKr/4//y/87/jwDu//X/vv/+/38AAwBQAN//1v/l/8n/wv/J/xEA5f///83/NAAtAAoAOABoAOv/yP///zQAz//x/z0ANgD9/wEAhgDJ/xoACwBQAD4AYABpAMz/qwDHAPL/DgAFAPP/BQBbAFIA7f+y/yf/ZAAhALT/yv+M/zEAxP8yANH/EwDr/wYAawDb/wcAuf/L/9b/4f9KAOz/vv8AAM7/OgDP/zkAAQAvAGMAbQCSAGkA5P8cAMb/u//L//n/FAAPAAsAywDx////BAA1AEYADwBzAOz/KABkAAkAHwAAAO7/8P+x/87/FQCl/8H/ugD6/z8AigDj/yAACgDX////3gDg/zsA+f/v/woAFADt/+7/m//n/+X/JQDn/+//9P/y/x4AFADj/xwA1v9+AA8ADQDu/34Aif/v/w8A8f/v/+P/gv+C/xMAqP/l//H/5P/l/4L/MgD3//H/DQAkABMA6//k/yUA8/8QABEA5f8NAO3/DwD2/7n/4P8OALL/2f/E//L/fgAPAA0A7/8TABIADwAMAA4A8P8OAB4AFAAXAH4ADgAQADYADgDJ/xEAEwAUAPH/fgB+AO//7f9+AHoADADr/4f/DwB+AOn/6v/W//P/eADm/zAAEQAMABsAFQDv/+v/7v8QABAATwAeAIL/EADw/+7/FADq/+//OQDp/+//RADs/+r/EADw//D/FQC//woAEgDt//H/fgDa/34A7P/k/73/EwBPAPb/WABLABAA6v9+AOP/9P/B/x4AfADx/ygA8/+C/5H/8v8PABAAmP8TAOv/zP+K/zgAgv8QAHwA0v8mAHkA9v/l/2QAnf/w/xgAwP/n/34ADQAgAAsATgB+APH/DwDu/7z/o//h/97/6P/q/4L/5P9+AO3/GwAwABsA8//v/+L/EgBFABUAfgARAO3/8v9JANz/t//2/7H/GAAcABEA7v/y/+3/8f9VAO3/EwAMAH4ADQDq/w4A7P/o/34AEgCf/8H/6f8xAOz/8//l//H/EwDt//L/8//p/x4AEgANABAA9v/s/xIAEwBiABgAHADd/xkAEAAMAA4A5P/s/xwA5/8rANz/8P/z/xMA0v9+ABAA8f8QABIAHAB+AHwA7P9UABsADgAbABoAfgDO/wkADwDz/+D/7f8VABwA2v8NAPD/8P8bAPP/EwDw/wsASQAgAPL/VQA3AEAADgDQ//L/8/8RAO3/7v/x//T/8f8QAPL/4f/s/+f/hP/y/+//w//x/1cA8P/t/+3/EACD/4L/EQATAIL/gv/1/xYAeADz/9//GAAVACwADQCJ/xgAyf/u//X/5//s/xEAFwASAPD/8P/B/+H/fQDw/xAAEwDs/xYAEQDJ/xcAEADA/xMAFgDx/xAAEADr/0MA9v/u/xIADwDd/ygA4P8UABwASwDs/6//CgCw/7L/8f8UAK3/HAAMAEcA5v+C/xAA2f8NAH0AbwAOAPH/8P9iAOz/FAA6AHYAx/9+AO//gv84ANr/g/8KABkApv9jABEA6f9OABoAgv/z/+P/9P+7/5D/DgDx/xEAPgBdAH4AIgAaABcAfgAaAN//EwDn/9H/5P8NABIAHADu/7r/6/+L/+7/EQANAMb/fgBeAAoAVgDq/+P/7v8TAA8AEgAPAKr/EwDs//X/gv/z/xYA8f8TABkAgv/t/2sAQwAYAM7/FAANABoADgDu/xUADgANABUA4v/t//T/HQU=";
}
