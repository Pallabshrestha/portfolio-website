# Bagh Chal

The traditional Nepali board game of tigers and goats, played in the browser.
Three files, no dependencies, no build step, no network calls.

- `index.html` - markup, plus every SVG gradient, filter and the two crystal
  piece shapes in `<defs>`
- `styles.css` - site chrome (shared with the rest of the portfolio) and the
  board styling
- `app.js` - board graph, rules, the computer opponent, rendering, interaction

## The board

25 points on a 5x5 grid, connected Alquerque-style: every point joins its
orthogonal neighbours, and a point also joins its diagonal neighbours when
`(row + column)` is even. That single parity rule is what produces the classic
Bagh Chal picture of two full diagonals plus the four half diagonals, and it
gives 56 connections in total (40 orthogonal, 16 diagonal).

Because two diagonal steps preserve the parity of `(row + column)`, a jump that
starts on a legal diagonal is always legal for its whole length. No extra check
is needed when generating jumps.

Points are named like a map, columns `a`-`e` from the left and rows `1`-`5` from
the top, so `c3` is the centre.

## Rules as implemented

- Four tigers start in the corners, twenty goats start off the board.
- Goats move first. During the placement phase the only legal goat action is to
  drop a goat on an empty point; goats cannot move at all until all twenty are
  placed.
- Tigers either step one point along a line, or jump straight over a single
  adjacent goat onto the empty point directly beyond, eating it. Jumping is
  never compulsory.
- Tigers win by eating five goats, or if the goats have no legal move.
- Goats win if no tiger can move.

## The computer opponent

Minimax with alpha-beta pruning and iterative deepening under a time budget, so
a slow position degrades to a shallower search instead of freezing the tab. The
position is scored from the tigers' point of view: captures dominate, then the
number of jumps available, tiger mobility, and a penalty for each trapped tiger.

Moves are ordered by a one-ply evaluation before searching, which matters most
during placement where the goats have up to twenty-one replies at every node.
The root is searched with a full window so that equal-scoring moves really are
equal, and one is then picked at random to keep games from repeating.

| Level  | Depth | Budget | Deliberate mistakes |
|--------|-------|--------|---------------------|
| Easy   | 2     | 250 ms | 35% of moves        |
| Medium | 4     | 700 ms | 6% of moves         |
| Hard   | 6     | 1300 ms| none                |

Each game carries a generation stamp. Restarting while the computer is thinking
voids the queued callback, so a stale move cannot land in the new game.

## Tests

Neither file is wired to a test runner. Two scripts were used while building it
and are worth re-running by hand after any change to the rules:

1. Assert the connection graph (degrees, symmetry, edge count, jump validity).
2. Slice sections 1-3 out of `app.js`, evaluate them in Node, and assert the win
   conditions from hand-built positions: tigers trapped, goats stuck, the fifth
   capture, and that `unmake` exactly reverses `make`.

A third check runs in the browser console: play a few hundred games in
two-player mode by clicking only elements the UI marks `.pt-hit.playable`, and
confirm every game reaches a result.

## Editing notes

- `styles.css` and `app.js` are loaded with a `?v=` cache-busting token because
  GitHub Pages serves them with a four hour max-age. Bump the token in
  `index.html` whenever either file changes, or returning visitors keep the old
  copy.
- The pieces are drawn once in `<defs>` as `#tigerHead` and `#goatHead` and
  placed with `<use>`. They are scaled to 0.84 so the corner pieces sit inside
  the slab rather than over its chiselled edge.
- Carved lines are two strokes: a dark channel, and a lighter lip offset down
  and right. The point sockets use a radial gradient lit from the bottom right,
  the inversion that makes the eye read a dent instead of a bump.
