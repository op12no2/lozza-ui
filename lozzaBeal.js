
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

// moves - see CLAUDE.md for the layout

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

// each ply's position is one int32 slot in its own buffer, copied with a single native set()
//
//   0..31   bitboards, a lo/hi pair per piece code at piece * 2 + half; codes 0 and 8 are
//           never pieces, so those slots hold the white and black occupancy
//   32..47  the board, 64 bytes, seen through node.board
//   48..    the state below; mg, eg and phase are the running pst sums, white positive

const P_BOARD  = 32;
const P_STM    = 48;
const P_RIGHTS = 49;
const P_EP     = 50;
const P_HMC    = 51;
const P_LO     = 52; // hash
const P_HI     = 53;
const P_MG     = 54;
const P_EG     = 55;
const P_PHASE  = 56;
const P_KINGS  = 57; // + colour index
const P_MAT    = 59; // material key: piece counts packed, see MAT_SHIFT
const P_SIZE   = 60;

// bit position of each piece code's count in the material key: 4 bits for pawns, 3 for the
// rest (white then black), 32 bits in all

const MAT_SHIFT = new Int8Array([0, 0, 8, 11, 14, 17, 0, 0, 0, 4, 20, 23, 26, 29, 0, 0]);
const MAT_INC   = new Int32Array(16);

for (let piece=PAWN; piece <= (QUEEN | BLACK); piece++)
  if ((piece & 7) >= PAWN && (piece & 7) <= QUEEN)
    MAT_INC[piece] = 1 << MAT_SHIFT[piece];

// every board change goes through these so the bitboards, sums and hash keep up

function put_piece(node, piece, sq) {

  const pos = node.pos;
  const bit = 1 << (sq & 31);
  const hi  = sq >>> 5;

  node.board[sq] = piece;

  pos[piece * 2 + hi]           ^= bit;
  pos[(piece & BLACK) * 2 + hi] ^= bit;

  pos[P_MG]    += pst_mg[piece * 64 + sq];
  pos[P_EG]    += pst_eg[piece * 64 + sq];
  pos[P_PHASE] += PHASE[piece & 7];
  pos[P_MAT]   += MAT_INC[piece];

  hash_piece(pos, piece, sq);

}

function remove_piece(node, piece, sq) {

  const pos = node.pos;
  const bit = 1 << (sq & 31);
  const hi  = sq >>> 5;

  node.board[sq] = 0;

  pos[piece * 2 + hi]           ^= bit;
  pos[(piece & BLACK) * 2 + hi] ^= bit;

  pos[P_MG]    -= pst_mg[piece * 64 + sq];
  pos[P_EG]    -= pst_eg[piece * 64 + sq];
  pos[P_PHASE] -= PHASE[piece & 7];
  pos[P_MAT]   -= MAT_INC[piece];

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

  pos.fill(0);

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
        pos[P_KINGS + (colour >>> 3)] = sq;
      file++;
    }
  }

  pos[P_STM] = stm_str === 'b' ? BLACK : WHITE;

  for (const ch of rights_str) {
    switch (ch) {
      case 'K': pos[P_RIGHTS] |= WHITE_RIGHTS_KING;  break;
      case 'Q': pos[P_RIGHTS] |= WHITE_RIGHTS_QUEEN; break;
      case 'k': pos[P_RIGHTS] |= BLACK_RIGHTS_KING;  break;
      case 'q': pos[P_RIGHTS] |= BLACK_RIGHTS_QUEEN; break;
    }
  }

  if (ep_str !== '-') {
    const ep = (ep_str.charCodeAt(1) - 49) * 8 + (ep_str.charCodeAt(0) - 97);
    if (ep_capturable(b, ep - PAWN_PUSH[pos[P_STM] >>> 3], pos[P_STM]))
      pos[P_EP] = ep;
  }

  pos[P_HMC] = parseInt(hmc_str) || 0;

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

  const r = pos[P_RIGHTS];

  let rights = '';
  if (r & WHITE_RIGHTS_KING)  rights += 'K';
  if (r & WHITE_RIGHTS_QUEEN) rights += 'Q';
  if (r & BLACK_RIGHTS_KING)  rights += 'k';
  if (r & BLACK_RIGHTS_QUEEN) rights += 'q';

  return s + ' ' + (pos[P_STM] === BLACK ? 'b' : 'w') +
         ' ' + (rights || '-') +
         ' ' + (pos[P_EP] ? sq_name(pos[P_EP]) : '-') +
         ' ' + pos[P_HMC] + ' 1';

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

  const r = pos[P_RIGHTS];

  let rights = '';
  if (r & WHITE_RIGHTS_KING)  rights += 'K';
  if (r & WHITE_RIGHTS_QUEEN) rights += 'Q';
  if (r & BLACK_RIGHTS_KING)  rights += 'k';
  if (r & BLACK_RIGHTS_QUEEN) rights += 'q';

  uci_send('stm ' + (pos[P_STM] === BLACK ? 'b' : 'w') +
           ' rights ' + (rights || '-') +
           ' ep ' + (pos[P_EP] ? sq_name(pos[P_EP]) : '-') +
           ' hmc ' + pos[P_HMC] +
           ' kings ' + sq_name(pos[P_KINGS + WHITE_INDEX]) + ' ' + sq_name(pos[P_KINGS + BLACK_INDEX]) +
           ' hash ' + hex32(pos[P_HI]) + hex32(pos[P_LO]));

}

//
// nodes
//

const MAX_MOVES = 256;
const MAX_PLY   = 128;

// pos and board share one buffer, so copying pos copies the board too

function new_node() {
  const buf = new ArrayBuffer(P_SIZE * 4);
  return {
    pos:       new Int32Array(buf),
    board:     new Uint8Array(buf, P_BOARD * 4, 64),
    moves:     new Uint32Array(MAX_MOVES),
    played:    new Uint32Array(MAX_MOVES),
    num_moves: 0,
    ranks:     new Int32Array(MAX_MOVES),
    next_move: 0,
    in_check:  0,
    excluded:  0,
    tt_move:   0,
    stage:     0,
    killer:    0,
    cont:      -1,
    pv:        new Uint32Array(MAX_PLY),
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
  rep_lo[i] = pos[P_LO];
  rep_hi[i] = pos[P_HI];
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
  pos[P_LO] ^= piece_lo[piece * 64 + sq];
  pos[P_HI] ^= piece_hi[piece * 64 + sq];
}

function hash_rights(pos) {
  pos[P_LO] ^= rights_lo[pos[P_RIGHTS]];
  pos[P_HI] ^= rights_hi[pos[P_RIGHTS]];
}

function hash_ep(pos) {
  pos[P_LO] ^= ep_lo[pos[P_EP]];
  pos[P_HI] ^= ep_hi[pos[P_EP]];
}

function hash_stm(pos) {
  pos[P_LO] ^= stm_lo;
  pos[P_HI] ^= stm_hi;
}

// from scratch; make_move updates incrementally

function set_hash(node) {

  const pos = node.pos;
  const b   = node.board;

  pos[P_LO] = 0;
  pos[P_HI] = 0;

  for (let sq=0; sq < 64; sq++)
    hash_piece(pos, b[sq], sq);

  hash_rights(pos);
  hash_ep(pos);

  if (pos[P_STM] === BLACK)
    hash_stm(pos);

}

//
// attacks
//

// bitboards are lo/hi int32 pairs; tables of them are interleaved at sq * 2 + half
// bit loops go msb first because x & -x and x & (x - 1) overflow int32 when bit 31 is set,
// which makes v8 deopt: sq = msb(x); x ^= 1 << sq (1 << sq only uses sq & 31)

const PAWN_PUSH = [8, -8];

const FILE_A = 0x01010101; // per bitboard half
const FILE_H = 0x80808080 | 0;
const LIGHT_SQUARES = 0x55aa55aa; // b1, a2, ..: squares with rank + file odd, the same in both halves

function msb(x) {
  return 31 - Math.clz32(x);
}

function more_than_one(x) { // x must be non-zero
  return (x ^ (1 << msb(x))) !== 0;
}

function on_board(f, r) {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

function make_step_bb(steps) {

  const bb = new Int32Array(128);

  for (let sq=0; sq < 64; sq++) {
    const f = sq & 7;
    const r = sq >>> 3;
    for (const [df, dr] of steps) {
      if (on_board(f + df, r + dr)) {
        const s = (r + dr) * 8 + f + df;
        bb[sq * 2 + (s >>> 5)] |= 1 << s;
      }
    }
  }

  return bb;

}

const knight_bb = make_step_bb([[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]);
const king_bb   = make_step_bb([[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]);

// the squares a pawn of each colour attacks

const pawn_bb = [make_step_bb([[-1,1],[1,1]]), make_step_bb([[-1,-1],[1,-1]])];

const ROOK_DIRS   = [[1,0],[-1,0],[0,1],[0,-1]];
const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]];

// slider attacks the slow way, for building the tables

function slow_attacks(sq, occ_lo, occ_hi, dirs, out) {

  let lo = 0;
  let hi = 0;

  for (const [df, dr] of dirs) {
    let f = (sq & 7) + df;
    let r = (sq >>> 3) + dr;
    while (on_board(f, r)) {
      const s = r * 8 + f;
      if (s < 32)
        lo |= 1 << s;
      else
        hi |= 1 << s;
      if (((s < 32 ? occ_lo : occ_hi) & (1 << s)) !== 0)
        break;
      f += df;
      r += dr;
    }
  }

  out[0] = lo;
  out[1] = hi;

}

// fancy magic bitboards with 32 bit multiplies, found at startup: each half of the relevant
// occupancy is multiplied by its own magic and the products xored
//
//   index = (imul(occ_lo & mask_lo, magic_lo) ^ imul(occ_hi & mask_hi, magic_hi)) >>> shift
//
// magics[k * 6 + 0..5] = mask_lo, mask_hi, magic_lo, magic_hi, shift, offset into magic_att
// with k = sq for rooks and 64 + sq for bishops; magic_att is interleaved lo/hi

const magics = new Int32Array(128 * 6);

let magic_att = null;

function find_magic(k, sq, dirs, chunks) {

  // the relevant occupancy is the rays without their edge squares

  const sqs = [];

  for (const [df, dr] of dirs) {
    let f = (sq & 7) + df;
    let r = (sq >>> 3) + dr;
    while (on_board(f + df, r + dr)) {
      sqs.push(r * 8 + f);
      f += df;
      r += dr;
    }
  }

  const bits = sqs.length;
  const n    = 1 << bits;

  const occ_lo = new Int32Array(n);
  const occ_hi = new Int32Array(n);
  const att_lo = new Int32Array(n);
  const att_hi = new Int32Array(n);
  const out    = new Int32Array(2);

  let mask_lo = 0;
  let mask_hi = 0;

  for (const s of sqs) {
    if (s < 32)
      mask_lo |= 1 << s;
    else
      mask_hi |= 1 << s;
  }

  for (let i=0; i < n; i++) {
    let lo = 0;
    let hi = 0;
    for (let j=0; j < bits; j++) {
      if ((i & (1 << j)) !== 0) {
        if (sqs[j] < 32)
          lo |= 1 << sqs[j];
        else
          hi |= 1 << sqs[j];
      }
    }
    occ_lo[i] = lo;
    occ_hi[i] = hi;
    slow_attacks(sq, lo, hi, dirs, out);
    att_lo[i] = out[0];
    att_hi[i] = out[1];
  }

  const shift = 32 - bits;
  const epoch = new Int32Array(n);
  const t_lo  = new Int32Array(n);
  const t_hi  = new Int32Array(n);

  for (let tries=1; ; tries++) {

    const magic_lo = rand32() & rand32() & rand32();
    const magic_hi = rand32() & rand32() & rand32();

    let ok = true;

    for (let i=0; i < n; i++) {
      const index = (Math.imul(occ_lo[i], magic_lo) ^ Math.imul(occ_hi[i], magic_hi)) >>> shift;
      if (epoch[index] !== tries) {
        epoch[index] = tries;
        t_lo[index]  = att_lo[i];
        t_hi[index]  = att_hi[i];
      }
      else if (t_lo[index] !== att_lo[i] || t_hi[index] !== att_hi[i]) {
        ok = false;
        break;
      }
    }

    if (!ok)
      continue;

    const t = new Int32Array(n * 2);

    for (let i=0; i < n; i++) {
      t[i * 2]     = t_lo[i];
      t[i * 2 + 1] = t_hi[i];
    }

    chunks.push(t);

    const o = k * 6;

    magics[o]     = mask_lo;
    magics[o + 1] = mask_hi;
    magics[o + 2] = magic_lo;
    magics[o + 3] = magic_hi;
    magics[o + 4] = shift;

    return;

  }

}

function init_magics() {

  const chunks = [];

  for (let sq=0; sq < 64; sq++)
    find_magic(sq, sq, ROOK_DIRS, chunks);

  for (let sq=0; sq < 64; sq++)
    find_magic(64 + sq, sq, BISHOP_DIRS, chunks);

  let total = 0;
  for (const c of chunks)
    total += c.length;

  magic_att = new Int32Array(total);

  for (let k=0, off=0; k < 128; k++) {
    magics[k * 6 + 5] = off;
    magic_att.set(chunks[k], off);
    off += chunks[k].length;
  }

}

init_magics(); // 120ms ish

// index of the lo half of a slider's attacks in magic_att

function rook_index(sq, occ_lo, occ_hi) {
  const o = sq * 6;
  return magics[o + 5] + (((Math.imul(occ_lo & magics[o], magics[o + 2]) ^ Math.imul(occ_hi & magics[o + 1], magics[o + 3])) >>> magics[o + 4]) << 1);
}

function bishop_index(sq, occ_lo, occ_hi) {
  const o = (sq + 64) * 6;
  return magics[o + 5] + (((Math.imul(occ_lo & magics[o], magics[o + 2]) ^ Math.imul(occ_hi & magics[o + 1], magics[o + 3])) >>> magics[o + 4]) << 1);
}

// empty board slider attacks, and for squares a and b on a line, the squares strictly
// between them and the whole line through them, at (a * 64 + b) * 2

const rook_bb    = new Int32Array(128);
const bishop_bb  = new Int32Array(128);
const between_bb = new Int32Array(64 * 64 * 2);
const line_bb    = new Int32Array(64 * 64 * 2);

for (let a=0; a < 64; a++) {

  let i = rook_index(a, 0, 0);
  rook_bb[a * 2]     = magic_att[i];
  rook_bb[a * 2 + 1] = magic_att[i + 1];

  i = bishop_index(a, 0, 0);
  bishop_bb[a * 2]     = magic_att[i];
  bishop_bb[a * 2 + 1] = magic_att[i + 1];

  for (const [df, dr] of ROOK_DIRS.concat(BISHOP_DIRS)) {

    let line_lo = a < 32 ? 1 << a : 0;
    let line_hi = a < 32 ? 0 : 1 << a;

    for (const s of [1, -1]) {
      let f = (a & 7) + df * s;
      let r = (a >>> 3) + dr * s;
      while (on_board(f, r)) {
        const b = r * 8 + f;
        if (b < 32)
          line_lo |= 1 << b;
        else
          line_hi |= 1 << b;
        f += df * s;
        r += dr * s;
      }
    }

    let bet_lo = 0;
    let bet_hi = 0;
    let f = (a & 7) + df;
    let r = (a >>> 3) + dr;

    while (on_board(f, r)) {
      const b = r * 8 + f;
      const j = (a * 64 + b) * 2;
      between_bb[j]     = bet_lo;
      between_bb[j + 1] = bet_hi;
      line_bb[j]        = line_lo;
      line_bb[j + 1]    = line_hi;
      if (b < 32)
        bet_lo |= 1 << b;
      else
        bet_hi |= 1 << b;
      f += df;
      r += dr;
    }

  }

}

// squares that must be free of enemy pawns for a pawn on sq to be passed:
// ahead of it on its own and the adjacent files, by colour index

const passed_bb = [new Int32Array(128), new Int32Array(128)];

for (let sq=0; sq < 64; sq++) {
  for (let s=0; s < 64; s++) {
    if (Math.abs((s & 7) - (sq & 7)) <= 1) {
      if ((s >>> 3) > (sq >>> 3))
        passed_bb[WHITE_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
      if ((s >>> 3) < (sq >>> 3))
        passed_bb[BLACK_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
    }
  }
}

// for a pawn on sq, by colour index: the squares ahead on its own file, and the adjacent
// files level with or behind it; adj_file_bb[file] is the files either side, per half;
// dist is the king distance between two squares

const front_bb    = [new Int32Array(128), new Int32Array(128)];
const behind_bb   = [new Int32Array(128), new Int32Array(128)];
const adj_file_bb = new Int32Array(8);
const dist        = new Uint8Array(64 * 64);

for (let sq=0; sq < 64; sq++) {
  for (let s=0; s < 64; s++) {
    const df = Math.abs((s & 7) - (sq & 7));
    const r  = sq >>> 3;
    const r2 = s >>> 3;
    dist[sq * 64 + s] = Math.max(df, Math.abs(r2 - r));
    if (df === 0) {
      if (r2 > r)
        front_bb[WHITE_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
      if (r2 < r)
        front_bb[BLACK_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
    }
    if (df === 1) {
      if (r2 <= r)
        behind_bb[WHITE_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
      if (r2 >= r)
        behind_bb[BLACK_INDEX][sq * 2 + (s >>> 5)] |= 1 << s;
    }
  }
}

for (let f=0; f < 8; f++)
  adj_file_bb[f] = (f > 0 ? FILE_A << (f - 1) : 0) | (f < 7 ? FILE_A << (f + 1) : 0);

//
// isattacked
//

// is sq attacked by by_colour, given the occupancy (so the king can be taken out of it
// when testing its own moves); steppers are mask tests, sliders a magic lookup

function attacked(pos, sq, by_colour, occ_lo, occ_hi) {

  const i = sq * 2;

  const pawns   = (PAWN   | by_colour) * 2;
  const knights = (KNIGHT | by_colour) * 2;
  const kings   = (KING   | by_colour) * 2;

  const pawn_at = pawn_bb[(by_colour >>> 3) ^ 1];

  if (((pawn_at[i] & pos[pawns]) | (pawn_at[i + 1] & pos[pawns + 1])) !== 0)
    return true;

  if (((knight_bb[i] & pos[knights]) | (knight_bb[i + 1] & pos[knights + 1])) !== 0)
    return true;

  if (((king_bb[i] & pos[kings]) | (king_bb[i + 1] & pos[kings + 1])) !== 0)
    return true;

  const queens = (QUEEN | by_colour) * 2;

  const bishops = (BISHOP | by_colour) * 2;
  const bq_lo   = pos[bishops] | pos[queens];
  const bq_hi   = pos[bishops + 1] | pos[queens + 1];

  if (((bishop_bb[i] & bq_lo) | (bishop_bb[i + 1] & bq_hi)) !== 0) {
    const a = bishop_index(sq, occ_lo, occ_hi);
    if (((magic_att[a] & bq_lo) | (magic_att[a + 1] & bq_hi)) !== 0)
      return true;
  }

  const rooks = (ROOK | by_colour) * 2;
  const rq_lo = pos[rooks] | pos[queens];
  const rq_hi = pos[rooks + 1] | pos[queens + 1];

  if (((rook_bb[i] & rq_lo) | (rook_bb[i + 1] & rq_hi)) !== 0) {
    const a = rook_index(sq, occ_lo, occ_hi);
    if (((magic_att[a] & rq_lo) | (magic_att[a + 1] & rq_hi)) !== 0)
      return true;
  }

  return false;

}

function is_attacked(pos, sq, by_colour) {
  return attacked(pos, sq, by_colour, pos[0] | pos[16], pos[1] | pos[17]);
}

function is_in_check(pos) {
  const stm = pos[P_STM];
  return is_attacked(pos, pos[P_KINGS + (stm >>> 3)], stm ^ BLACK);
}

//
// movegen
//

// legal moves only; checkers and pins are found once per node
//
// non-king moves are masked by the check mask and, if pinned, by the pin line; king moves
// test the target square with the king taken out of the occupancy; ep is rare and awkward,
// so it is played into nodes[ply + 1] (free during generation) and tested there
//
// captures_only generates captures and promotions, for qsearch when not in check

const PROMO_QUEEN  = PROMO_BIT | ((QUEEN  - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_ROOK   = PROMO_BIT | ((ROOK   - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_BISHOP = PROMO_BIT | ((BISHOP - KNIGHT) << PROMO_PIECE_SHIFT);
const PROMO_KNIGHT = PROMO_BIT | ((KNIGHT - KNIGHT) << PROMO_PIECE_SHIFT);

// one move per target square; flags carry CAPTURE_BIT for captures

function add_targets(moves, n, from_bits, lo, hi) {

  while (lo !== 0) {
    const dst = msb(lo);
    lo ^= 1 << dst;
    moves[n++] = from_bits | (dst << 6);
  }

  while (hi !== 0) {
    const dst = 32 + msb(hi);
    hi ^= 1 << dst;
    moves[n++] = from_bits | (dst << 6);
  }

  return n;

}

// pawn targets, the source found by stepping back delta from the target

function add_pawn_targets(moves, n, flags, delta, lo, hi) {

  while (lo !== 0) {
    const dst = msb(lo);
    lo ^= 1 << dst;
    moves[n++] = flags | (dst << 6) | (dst - delta);
  }

  while (hi !== 0) {
    const dst = 32 + msb(hi);
    hi ^= 1 << dst;
    moves[n++] = flags | (dst << 6) | (dst - delta);
  }

  return n;

}

function add_promo_targets(moves, n, flags, delta, lo, hi) {

  while (lo !== 0) {
    const dst = msb(lo);
    lo ^= 1 << dst;
    const move = flags | (dst << 6) | (dst - delta);
    moves[n++] = move | PROMO_QUEEN;
    moves[n++] = move | PROMO_ROOK;
    moves[n++] = move | PROMO_BISHOP;
    moves[n++] = move | PROMO_KNIGHT;
  }

  while (hi !== 0) {
    const dst = 32 + msb(hi);
    hi ^= 1 << dst;
    const move = flags | (dst << 6) | (dst - delta);
    moves[n++] = move | PROMO_QUEEN;
    moves[n++] = move | PROMO_ROOK;
    moves[n++] = move | PROMO_BISHOP;
    moves[n++] = move | PROMO_KNIGHT;
  }

  return n;

}

// pawn moves except ep, set-wise for the pawns in p, targets restricted to m

function gen_pawns(moves, n, stm, p_lo, p_hi, occ_lo, occ_hi, them_lo, them_hi, m_lo, m_hi, captures_only) {

  if (stm === WHITE) {

    const s1_lo = (p_lo << 8) & ~occ_lo;
    const s1_hi = ((p_hi << 8) | (p_lo >>> 24)) & ~occ_hi;

    n = add_promo_targets(moves, n, 0, 8, 0, s1_hi & m_hi & 0xFF000000);

    if (!captures_only) {
      n = add_pawn_targets(moves, n, 0, 8, s1_lo & m_lo, s1_hi & m_hi & 0x00FFFFFF);
      const s2_lo = ((s1_lo & 0x00FF0000) << 8) & ~occ_lo & m_lo;
      n = add_pawn_targets(moves, n, 0, 16, s2_lo, 0);
    }

    const l_lo  = p_lo & ~FILE_A;
    const l_hi  = p_hi & ~FILE_A;
    const c7_lo = (l_lo << 7) & them_lo & m_lo;
    const c7_hi = ((l_hi << 7) | (l_lo >>> 25)) & them_hi & m_hi;

    n = add_pawn_targets (moves, n, CAPTURE_BIT, 7, c7_lo, c7_hi & 0x00FFFFFF);
    n = add_promo_targets(moves, n, CAPTURE_BIT, 7, 0,     c7_hi & 0xFF000000);

    const r_lo  = p_lo & ~FILE_H;
    const r_hi  = p_hi & ~FILE_H;
    const c9_lo = (r_lo << 9) & them_lo & m_lo;
    const c9_hi = ((r_hi << 9) | (r_lo >>> 23)) & them_hi & m_hi;

    n = add_pawn_targets (moves, n, CAPTURE_BIT, 9, c9_lo, c9_hi & 0x00FFFFFF);
    n = add_promo_targets(moves, n, CAPTURE_BIT, 9, 0,     c9_hi & 0xFF000000);

  }

  else {

    const s1_lo = ((p_lo >>> 8) | (p_hi << 24)) & ~occ_lo;
    const s1_hi = (p_hi >>> 8) & ~occ_hi;

    n = add_promo_targets(moves, n, 0, -8, s1_lo & m_lo & 0xFF, 0);

    if (!captures_only) {
      n = add_pawn_targets(moves, n, 0, -8, s1_lo & m_lo & ~0xFF, s1_hi & m_hi);
      const s2_hi = ((s1_hi & 0x0000FF00) >>> 8) & ~occ_hi & m_hi;
      n = add_pawn_targets(moves, n, 0, -16, 0, s2_hi);
    }

    const l_lo  = p_lo & ~FILE_A;
    const l_hi  = p_hi & ~FILE_A;
    const c9_lo = ((l_lo >>> 9) | (l_hi << 23)) & them_lo & m_lo;
    const c9_hi = (l_hi >>> 9) & them_hi & m_hi;

    n = add_pawn_targets (moves, n, CAPTURE_BIT, -9, c9_lo & ~0xFF, c9_hi);
    n = add_promo_targets(moves, n, CAPTURE_BIT, -9, c9_lo &  0xFF, 0);

    const r_lo  = p_lo & ~FILE_H;
    const r_hi  = p_hi & ~FILE_H;
    const c7_lo = ((r_lo >>> 7) | (r_hi << 25)) & them_lo & m_lo;
    const c7_hi = (r_hi >>> 7) & them_hi & m_hi;

    n = add_pawn_targets (moves, n, CAPTURE_BIT, -7, c7_lo & ~0xFF, c7_hi);
    n = add_promo_targets(moves, n, CAPTURE_BIT, -7, c7_lo &  0xFF, 0);

  }

  return n;

}

// one piece's moves from attacks a, limited to its pin line if pinned
// captures and quiet moves are added separately so captures carry CAPTURE_BIT

function add_piece(moves, n, src, ksq, pin_lo, pin_hi, a_lo, a_hi, them_lo, them_hi, empty_lo, empty_hi) {

  if ((((src < 32 ? pin_lo : pin_hi) >>> (src & 31)) & 1) !== 0) {
    const l = (ksq * 64 + src) * 2;
    a_lo &= line_bb[l];
    a_hi &= line_bb[l + 1];
  }

  n = add_targets(moves, n, src | CAPTURE_BIT, a_lo & them_lo, a_hi & them_hi);
  n = add_targets(moves, n, src, a_lo & empty_lo, a_hi & empty_hi);

  return n;

}

function gen_moves(ply, captures_only) {

  const node  = nodes[ply];
  const pos   = node.pos;
  const moves = node.moves;

  const stm  = pos[P_STM];
  const them = stm ^ BLACK;
  const ksq  = pos[P_KINGS + (stm >>> 3)];

  const us_lo   = pos[stm * 2];
  const us_hi   = pos[stm * 2 + 1];
  const them_lo = pos[them * 2];
  const them_hi = pos[them * 2 + 1];
  const occ_lo  = us_lo | them_lo;
  const occ_hi  = us_hi | them_hi;

  let n = 0;

  // checkers from pawns and knights

  const k2 = ksq * 2;
  const tp = (PAWN   | them) * 2;
  const tn = (KNIGHT | them) * 2;

  const pawn_at = pawn_bb[stm >>> 3];

  let chk_lo = (pawn_at[k2]     & pos[tp])     | (knight_bb[k2]     & pos[tn]);
  let chk_hi = (pawn_at[k2 + 1] & pos[tp + 1]) | (knight_bb[k2 + 1] & pos[tn + 1]);

  // checkers and pins from sliders on a line with the king

  const tq = (QUEEN  | them) * 2;
  const tb = (BISHOP | them) * 2;
  const tr = (ROOK   | them) * 2;

  let pin_lo = 0;
  let pin_hi = 0;

  let s_lo = (bishop_bb[k2]     & (pos[tb]     | pos[tq]))     | (rook_bb[k2]     & (pos[tr]     | pos[tq]));
  let s_hi = (bishop_bb[k2 + 1] & (pos[tb + 1] | pos[tq + 1])) | (rook_bb[k2 + 1] & (pos[tr + 1] | pos[tq + 1]));

  while ((s_lo | s_hi) !== 0) {

    let sq;

    if (s_lo !== 0) {
      sq = msb(s_lo);
      s_lo ^= 1 << sq;
    }
    else {
      sq = 32 + msb(s_hi);
      s_hi ^= 1 << sq;
    }

    const j      = (ksq * 64 + sq) * 2;
    const bet_lo = between_bb[j]     & occ_lo;
    const bet_hi = between_bb[j + 1] & occ_hi;

    if ((bet_lo | bet_hi) === 0) {
      if (sq < 32)
        chk_lo |= 1 << sq;
      else
        chk_hi |= 1 << sq;
    }
    else if (bet_hi === 0 ? !more_than_one(bet_lo) : (bet_lo === 0 && !more_than_one(bet_hi))) {
      pin_lo |= bet_lo & us_lo;
      pin_hi |= bet_hi & us_hi;
    }

  }

  // in captures_only mode only enemy squares are targets

  const empty_lo = captures_only ? 0 : ~occ_lo;
  const empty_hi = captures_only ? 0 : ~occ_hi;

  // king moves, the target tested with the king out of the occupancy; squares next to the
  // enemy king are never legal, so they are masked out before the test (from cwtch)

  const x_lo = occ_lo ^ (ksq < 32 ? 1 << ksq : 0);
  const x_hi = occ_hi ^ (ksq < 32 ? 0 : 1 << ksq);
  const ek2  = pos[P_KINGS + (them >>> 3)] * 2;

  for (let half=0; half < 2; half++) {
    const t = king_bb[k2 + half] & ~king_bb[ek2 + half] & ~(half ? us_hi : us_lo) & (half ? them_hi | empty_hi : them_lo | empty_lo);
    let targets = t;
    while (targets !== 0) {
      const b   = msb(targets);
      targets ^= 1 << b;
      const dst = (half << 5) | b;
      if (!attacked(pos, dst, them, x_lo, x_hi))
        moves[n++] = ksq | (dst << 6) | ((((half ? them_hi : them_lo) >>> b) & 1) !== 0 ? CAPTURE_BIT : 0);
    }
  }

  // the check mask, or castling if not in check

  let m_lo = -1;
  let m_hi = -1;

  if ((chk_lo | chk_hi) !== 0) {

    if (chk_hi === 0 ? more_than_one(chk_lo) : (chk_lo !== 0 || more_than_one(chk_hi))) {
      node.num_moves = n;
      return;  // double check, only king moves
    }

    const c = chk_lo !== 0 ? msb(chk_lo) : 32 + msb(chk_hi);
    const j = (ksq * 64 + c) * 2;

    m_lo = between_bb[j]     | chk_lo;
    m_hi = between_bb[j + 1] | chk_hi;

  }

  else if (!captures_only) {

    const rights = pos[P_RIGHTS];

    if (stm === WHITE) {
      if ((rights & WHITE_RIGHTS_KING) && (occ_lo & 0x60) === 0 && !attacked(pos, 5, BLACK, occ_lo, occ_hi) && !attacked(pos, 6, BLACK, occ_lo, occ_hi))
        moves[n++] = 4 | (6 << 6) | CASTLE_BIT;
      if ((rights & WHITE_RIGHTS_QUEEN) && (occ_lo & 0x0E) === 0 && !attacked(pos, 3, BLACK, occ_lo, occ_hi) && !attacked(pos, 2, BLACK, occ_lo, occ_hi))
        moves[n++] = 4 | (2 << 6) | CASTLE_BIT;
    }
    else {
      if ((rights & BLACK_RIGHTS_KING) && (occ_hi & 0x60000000) === 0 && !attacked(pos, 61, WHITE, occ_lo, occ_hi) && !attacked(pos, 62, WHITE, occ_lo, occ_hi))
        moves[n++] = 60 | (62 << 6) | CASTLE_BIT;
      if ((rights & BLACK_RIGHTS_QUEEN) && (occ_hi & 0x0E000000) === 0 && !attacked(pos, 59, WHITE, occ_lo, occ_hi) && !attacked(pos, 58, WHITE, occ_lo, occ_hi))
        moves[n++] = 60 | (58 << 6) | CASTLE_BIT;
    }

  }

  // pawns - unpinned ones set-wise, pinned ones one at a time along their pin line

  const up   = (PAWN | stm) * 2;
  const p_lo = pos[up];
  const p_hi = pos[up + 1];

  n = gen_pawns(moves, n, stm, p_lo & ~pin_lo, p_hi & ~pin_hi, occ_lo, occ_hi, them_lo, them_hi, m_lo, m_hi, captures_only);

  let pp_lo = p_lo & pin_lo;
  let pp_hi = p_hi & pin_hi;

  while ((pp_lo | pp_hi) !== 0) {
    let src;
    if (pp_lo !== 0) {
      src = msb(pp_lo);
      pp_lo ^= 1 << src;
    }
    else {
      src = 32 + msb(pp_hi);
      pp_hi ^= 1 << src;
    }
    const l = (ksq * 64 + src) * 2;
    n = gen_pawns(moves, n, stm, src < 32 ? 1 << src : 0, src < 32 ? 0 : 1 << src, occ_lo, occ_hi, them_lo, them_hi, m_lo & line_bb[l], m_hi & line_bb[l + 1], captures_only);
  }

  // ep, tested by playing it

  const ep = pos[P_EP];

  if (ep !== 0) {

    const pawn_from = pawn_bb[(stm >>> 3) ^ 1];

    let a_lo = pawn_from[ep * 2]     & p_lo;
    let a_hi = pawn_from[ep * 2 + 1] & p_hi;

    while ((a_lo | a_hi) !== 0) {
      let src;
      if (a_lo !== 0) {
        src = msb(a_lo);
        a_lo ^= 1 << src;
      }
      else {
        src = 32 + msb(a_hi);
        a_hi ^= 1 << src;
      }
      const move = src | (ep << 6) | CAPTURE_BIT | EP_CAPTURE_BIT;
      make_move(ply, move);
      if (!is_attacked(nodes[ply + 1].pos, ksq, them))
        moves[n++] = move;
    }

  }

  // knights - a pinned knight can never move

  const t_lo = them_lo & m_lo;
  const t_hi = them_hi & m_hi;
  const e_lo = empty_lo & m_lo;
  const e_hi = empty_hi & m_hi;

  let b_lo = pos[(KNIGHT | stm) * 2]     & ~pin_lo;
  let b_hi = pos[(KNIGHT | stm) * 2 + 1] & ~pin_hi;

  while ((b_lo | b_hi) !== 0) {
    let src;
    if (b_lo !== 0) {
      src = msb(b_lo);
      b_lo ^= 1 << src;
    }
    else {
      src = 32 + msb(b_hi);
      b_hi ^= 1 << src;
    }
    const a_lo = knight_bb[src * 2];
    const a_hi = knight_bb[src * 2 + 1];
    n = add_targets(moves, n, src | CAPTURE_BIT, a_lo & t_lo, a_hi & t_hi);
    n = add_targets(moves, n, src, a_lo & e_lo, a_hi & e_hi);
  }

  // bishops, rooks and queens

  for (let ptype=BISHOP; ptype <= QUEEN; ptype++) {

    b_lo = pos[(ptype | stm) * 2];
    b_hi = pos[(ptype | stm) * 2 + 1];

    while ((b_lo | b_hi) !== 0) {

      let src;

      if (b_lo !== 0) {
        src = msb(b_lo);
        b_lo ^= 1 << src;
      }
      else {
        src = 32 + msb(b_hi);
        b_hi ^= 1 << src;
      }

      let a_lo = 0;
      let a_hi = 0;

      if (ptype !== ROOK) {
        const i = bishop_index(src, occ_lo, occ_hi);
        a_lo |= magic_att[i];
        a_hi |= magic_att[i + 1];
      }

      if (ptype !== BISHOP) {
        const i = rook_index(src, occ_lo, occ_hi);
        a_lo |= magic_att[i];
        a_hi |= magic_att[i + 1];
      }

      n = add_piece(moves, n, src, ksq, pin_lo, pin_hi, a_lo, a_hi, t_lo, t_hi, e_lo, e_hi);

    }

  }

  node.num_moves = n;

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

// copy nodes[ply] into nodes[ply+1] and play move there; moves are legal from gen_moves

function make_move(ply, move) {

  const node = nodes[ply + 1];
  const pos  = node.pos;
  const b    = node.board;

  pos.set(nodes[ply].pos);

  const stm  = pos[P_STM];
  const stmi = stm >>> 3;

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
    pos[P_KINGS + stmi] = dst;

  hash_rights(pos);
  pos[P_RIGHTS] &= RIGHTS_MASK[src] & RIGHTS_MASK[dst];
  hash_rights(pos);

  hash_ep(pos);
  if (ptype === PAWN && (dst - src === 16 || src - dst === 16) && ep_capturable(b, dst, stm ^ BLACK))
    pos[P_EP] = src + PAWN_PUSH[stmi];
  else
    pos[P_EP] = 0;
  hash_ep(pos);

  if (ptype === PAWN || (move & CAPTURE_BIT))
    pos[P_HMC] = 0;
  else
    pos[P_HMC]++;

  pos[P_STM] = stm ^ BLACK;
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
// square, each side recapturing with its least valuable attacker and free to stop

const SEE_VALUE = [0, 100, 300, 300, 500, 900, 10000];

const see_gain = new Int32Array(32);

let see_sq = 0;

// the least valuable colour piece attacking sq given the occupancy, as a piece type with
// see_sq set to its square, or 0

function see_attacker(pos, sq, colour, occ_lo, occ_hi) {

  const i = sq * 2;

  let p    = (PAWN | colour) * 2;
  let a_lo = pawn_bb[(colour >>> 3) ^ 1][i]     & pos[p]     & occ_lo;
  let a_hi = pawn_bb[(colour >>> 3) ^ 1][i + 1] & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return PAWN;
  }

  p    = (KNIGHT | colour) * 2;
  a_lo = knight_bb[i]     & pos[p]     & occ_lo;
  a_hi = knight_bb[i + 1] & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return KNIGHT;
  }

  const bi = bishop_index(sq, occ_lo, occ_hi);

  p    = (BISHOP | colour) * 2;
  a_lo = magic_att[bi]     & pos[p]     & occ_lo;
  a_hi = magic_att[bi + 1] & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return BISHOP;
  }

  const ri = rook_index(sq, occ_lo, occ_hi);

  p    = (ROOK | colour) * 2;
  a_lo = magic_att[ri]     & pos[p]     & occ_lo;
  a_hi = magic_att[ri + 1] & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return ROOK;
  }

  p    = (QUEEN | colour) * 2;
  a_lo = (magic_att[bi]     | magic_att[ri])     & pos[p]     & occ_lo;
  a_hi = (magic_att[bi + 1] | magic_att[ri + 1]) & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return QUEEN;
  }

  p    = (KING | colour) * 2;
  a_lo = king_bb[i]     & pos[p]     & occ_lo;
  a_hi = king_bb[i + 1] & pos[p + 1] & occ_hi;
  if ((a_lo | a_hi) !== 0) {
    see_sq = a_lo !== 0 ? msb(a_lo) : 32 + msb(a_hi);
    return KING;
  }

  return 0;

}

function see(node, move) {

  const pos    = node.pos;
  const b      = node.board;
  const src    = move & 63;
  const dst    = (move >>> 6) & 63;
  const colour = b[src] & BLACK;

  let occ_lo = (pos[0] | pos[16]) ^ (src < 32 ? 1 << src : 0);
  let occ_hi = (pos[1] | pos[17]) ^ (src < 32 ? 0 : 1 << src);

  if (move & EP_CAPTURE_BIT) {
    const cap = colour === WHITE ? dst - 8 : dst + 8;
    occ_lo ^= cap < 32 ? 1 << cap : 0;
    occ_hi ^= cap < 32 ? 0 : 1 << cap;
    see_gain[0] = SEE_VALUE[PAWN];
  }
  else {
    see_gain[0] = SEE_VALUE[b[dst] & 7];
  }

  let on_sq = SEE_VALUE[b[src] & 7];
  let side  = colour ^ BLACK;
  let d     = 0;

  while (true) {
    const piece = see_attacker(pos, dst, side, occ_lo, occ_hi);
    if (piece === 0)
      break;
    d++;
    see_gain[d] = on_sq - see_gain[d - 1];
    if (Math.max(-see_gain[d - 1], see_gain[d]) < 0)
      break;
    on_sq = SEE_VALUE[piece];
    occ_lo ^= see_sq < 32 ? 1 << see_sq : 0;
    occ_hi ^= see_sq < 32 ? 0 : 1 << see_sq;
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

// a random number is the eval: Beal's experiment. it depends only on the position (a mix of
// the hash), from white's view, so the same position always gets the same number and the search
// still sees it as a function of the position. a search over random leaves prefers positions
// with more moves, which is a mobility eval in disguise

const PHASE     = new Uint8Array([0, 0, 1, 1, 2, 4, 0, 0]);
const MAX_PHASE = 24;

const pst_mg = new Int32Array(16 * 64);
const pst_eg = new Int32Array(16 * 64);

const BEAL_RANGE = 256; // the eval is in -BEAL_RANGE .. BEAL_RANGE - 1

function evaluate(ply) {

  const pos = nodes[ply].pos;

  let h = Math.imul(pos[P_LO] ^ 0x9e3779b1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h ^ pos[P_HI], 0xc2b2ae35);
  h ^= h >>> 13;

  const e = (h & (2 * BEAL_RANGE - 1)) - BEAL_RANGE;

  return pos[P_STM] === WHITE ? e : -e;

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

  const i = pos[P_LO] & tt_mask;

  if (tt_flags[i] !== 0 && tt_checks[i] === pos[P_HI])
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

  const i = pos[P_LO] & tt_mask;

  if (depth === 0 && tt_flags[i] !== 0 && tt_depths[i] > 0)
    return;

  if (score > MATE - MAX_PLY)
    score += ply;
  else if (score < -MATE + MAX_PLY)
    score -= ply;

  tt_checks[i] = pos[P_HI];
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

// late move pruning: at depth <= LMP_DEPTH, quiets after LMP_MOVES x depth are skipped

const LMP_DEPTH = 2;
const LMP_MOVES = 5;

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
  return pos[P_STM] === root_stm ? -contempt : contempt;
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
  const last = Math.max(0, cur - pos[P_HMC]);

  for (let i=cur-4; i >= last; i -= 2)
    if (rep_lo[i] === pos[P_LO] && rep_hi[i] === pos[P_HI])
      return true;

  return false;

}

// bare kings, or a king and one minor against a king

function material_draw(pos) {

  if ((pos[PAWN * 2] | pos[PAWN * 2 + 1] | pos[(PAWN | BLACK) * 2] | pos[(PAWN | BLACK) * 2 + 1] |
       pos[ROOK * 2] | pos[ROOK * 2 + 1] | pos[(ROOK | BLACK) * 2] | pos[(ROOK | BLACK) * 2 + 1] |
       pos[QUEEN * 2] | pos[QUEEN * 2 + 1] | pos[(QUEEN | BLACK) * 2] | pos[(QUEEN | BLACK) * 2 + 1]) !== 0)
    return false;

  const lo = pos[KNIGHT * 2]     | pos[BISHOP * 2]     | pos[(KNIGHT | BLACK) * 2]     | pos[(BISHOP | BLACK) * 2];
  const hi = pos[KNIGHT * 2 + 1] | pos[BISHOP * 2 + 1] | pos[(KNIGHT | BLACK) * 2 + 1] | pos[(BISHOP | BLACK) * 2 + 1];

  if ((lo | hi) === 0)
    return true;

  return hi === 0 ? !more_than_one(lo) : lo === 0 && !more_than_one(hi);

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

  const in_check = is_in_check(pos);

  // in check every move is generated and there is no standing pat

  const raw = in_check ? TT_NO_EVAL : ti >= 0 && tt_evals[ti] !== TT_NO_EVAL ? tt_evals[ti] : evaluate(ply);

  const alpha_in = alpha;

  let best = -INF;

  if (!in_check) {
    best = raw;
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

    make_move(ply, move);

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

  if (ply > 0 && (pos[P_HMC] >= 100 || is_repetition(ply) || material_draw(pos)))
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

  const in_check = is_in_check(pos);

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

  // the eval, kept in the tt for the qsearch's stand pat

  const raw = in_check ? -INF : ti >= 0 && tt_evals[ti] !== TT_NO_EVAL ? tt_evals[ti] : evaluate(ply);

  // singular extension - if no other move comes near the tt move's score it is extended;
  // the verification search runs at this same ply, before this node generates its moves,
  // and if it beats beta anyway (multi-cut) the node is done

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

    // late move pruning - at the lowest depths, once enough quiets have been tried, skip the rest

    if (!pv_node && !in_check && depth <= LMP_DEPTH && num_played > LMP_MOVES * depth &&
        (move & (CAPTURE_BIT | PROMO_BIT)) === 0 && alpha > -MATE + MAX_PLY)
      continue;

    make_move(ply, move);

    legal++;

    const quiet = (move & (CAPTURE_BIT | PROMO_BIT)) === 0;
    const new_depth = depth - 1 + (move === tt_move ? extension : 0);

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
  root_stm     = nodes[0].pos[P_STM];

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
    make_move(ply, move);
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

// match against the generated moves so the flags come for free; 0 if not found

function uci_to_move(ply, str) {

  gen_moves(ply, false);

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
      uci_send('id name Lozza ' + VER + ' Beal');
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
          nodes[0].pos.set(nodes[1].pos);
          nodes[0].cont = nodes[1].cont;
          rep_root = nodes[0].pos[P_HMC] === 0 ? 0 : rep_root + 1;
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
      const time = nodes[0].pos[P_STM] === WHITE ? wtime : btime;
      const inc  = nodes[0].pos[P_STM] === WHITE ? winc  : binc;
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
      gen_moves(0, false);
      let move = 0;
      if (nodes[0].num_moves === 0)
        uci_send('info depth 0 score ' + (is_in_check(nodes[0].pos) ? 'mate 0' : 'cp 0'));
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
      gen_moves(0, false);
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
