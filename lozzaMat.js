// lozzaMat.js: Lozza, a UCI chess engine in plain JavaScript, written to be read. it runs as a
// web worker in a page (or under node with a small host) and talks UCI through messages. this is
// the material-only build: the evaluation is Larry Kaufman's piece values, 100, 325, 325, 500
// and 975, plus 50 for the bishop pair, and nothing else, so it shows what the search is worth
// with the barest knowledge. the other builds share everything but the evaluation
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

}

function remove_piece(node, piece, sq) {

  const pos = node.pos;

  node.board[sq] = 0;

  pos.mg    -= pst_mg[piece * 64 + sq];
  pos.eg    -= pst_eg[piece * 64 + sq];
  pos.phase -= PHASE[piece & 7];
  pos.mat   -= MAT_INC[piece];

  hash_piece(pos, piece, sq);

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

// pos and board share one buffer, so copying pos copies the board too

function new_node() {
  const pos = new_pos();
  return {
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

// material only: Larry Kaufman's piece values, 100 325 325 500 975 and 50 for the bishop pair,
// no tables and no phase. the values sit in the piece square tables as flat entries, so
// put_piece and remove_piece keep the material balance in P_MG; the pair comes off the
// material key

const PHASE     = new Uint8Array([0, 0, 1, 1, 2, 4, 0, 0]);
const MAX_PHASE = 24;

const MAT_VALUE   = [0, 100, 325, 325, 500, 975, 0];
const BISHOP_PAIR = 50;

const pst_mg = new Int32Array(16 * 64);
const pst_eg = new Int32Array(16 * 64);

for (let ptype=PAWN; ptype <= KING; ptype++) {
  for (let sq=0; sq < 64; sq++) {
    pst_mg[(ptype | WHITE) * 64 + sq] =  MAT_VALUE[ptype];
    pst_mg[(ptype | BLACK) * 64 + sq] = -MAT_VALUE[ptype];
  }
}

function evaluate(ply) {

  const pos = nodes[ply].pos;
  const key = pos.mat;

  let e = pos.mg;

  if (((key >>> MAT_SHIFT[BISHOP]) & 7) >= 2)
    e += BISHOP_PAIR;

  if (((key >>> MAT_SHIFT[BISHOP | BLACK]) & 7) >= 2)
    e -= BISHOP_PAIR;

  return pos.stm === WHITE ? e : -e;

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

  // a verification search with a move excluded must not store its partial result

  if (excluded !== 0)
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

  let score = 0;

  for (let depth=1; depth <= max_depth; depth++) {

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

    const elapsed = performance.now() - start;
    const root    = nodes[0];

    root_move = root.pv_len ? root.pv[0] : 0;

    let pv = '';
    for (let i=0; i < root.pv_len; i++)
      pv += ' ' + move_to_uci(root.pv[i]);

    uci_send('info depth ' + depth +
             ' seldepth ' + sel_depth +
             ' score ' + score_to_uci(score) +
             ' nodes ' + search_nodes +
             ' time ' + Math.round(elapsed) +
             ' nps ' + Math.round(search_nodes * 1000 / (elapsed || 1)) +
             ' hashfull ' + tt_hashfull() +
             ' pv' + pv);

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
      uci_send('id name Lozza ' + VER + ' Mat');
      uci_send('id author Colin Jenkins');
      uci_send('option name Hash type spin default 16 min 1 max 1024');
      uci_send('option name Contempt type spin default 0 min -200 max 200');
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
