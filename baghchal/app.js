/* ============================================================
   Bagh Chal - Tigers and Goats
   Traditional Nepali board game, 5x5 Alquerque board.

   No dependencies, no network. Everything runs in the browser.

   Sections
     1. Board geometry and the connection graph
     2. Game state, move generation, make / unmake
     3. The computer opponent (alpha-beta with iterative deepening)
     4. Rendering
     5. Interaction and controls
   ============================================================ */

(function () {
  "use strict";

  /* ══════════════════════════════════════════════════════════
     1. BOARD GEOMETRY AND THE CONNECTION GRAPH
     ══════════════════════════════════════════════════════════ */

  var N = 5;                 // 5x5 points
  var NP = N * N;            // 25 points
  var EMPTY = 0, GOAT = 1, TIGER = 2;

  var TOTAL_GOATS = 20;
  var CAPTURES_TO_WIN = 5;

  var GOAT_SIDE = "goat", TIGER_SIDE = "tiger";

  function idx(r, c) { return r * N + c; }
  function rowOf(p) { return (p / N) | 0; }
  function colOf(p) { return p % N; }

  // Point names: columns a-e from the left, rows 1-5 from the top.
  var COLS = "abcde";
  function nameOf(p) { return COLS[colOf(p)] + (rowOf(p) + 1); }

  // The eight compass directions. A diagonal only exists on a point where
  // (row + column) is even - that is what produces the classic Bagh Chal
  // pattern of two full diagonals plus four half diagonals.
  var DIRS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  var ADJ = [];    // ADJ[p]   = array of points one step away
  var JUMPS = [];  // JUMPS[p] = array of {mid, to} - jump over mid, land on to

  (function buildGraph() {
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var p = idx(r, c);
        ADJ[p] = [];
        JUMPS[p] = [];
        var diagonalsAllowed = ((r + c) % 2) === 0;

        for (var d = 0; d < DIRS.length; d++) {
          var dr = DIRS[d][0], dc = DIRS[d][1];
          if (dr !== 0 && dc !== 0 && !diagonalsAllowed) continue;

          var nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < N && nc >= 0 && nc < N) ADJ[p].push(idx(nr, nc));

          // A jump keeps going in the same direction. Moving two diagonal
          // steps preserves the parity of (row + column), so if the diagonal
          // was legal from p it is also legal from the midpoint.
          var jr = r + 2 * dr, jc = c + 2 * dc;
          if (jr >= 0 && jr < N && jc >= 0 && jc < N) {
            JUMPS[p].push({ mid: idx(nr, nc), to: idx(jr, jc) });
          }
        }
      }
    }
  })();

  // Unique edges, for drawing the board lines once.
  var EDGES = (function () {
    var out = [], seen = {};
    for (var p = 0; p < NP; p++) {
      for (var i = 0; i < ADJ[p].length; i++) {
        var q = ADJ[p][i];
        var key = p < q ? p * NP + q : q * NP + p;
        if (!seen[key]) { seen[key] = 1; out.push([p, q]); }
      }
    }
    return out;
  })();

  var CORNERS = [idx(0, 0), idx(0, N - 1), idx(N - 1, 0), idx(N - 1, N - 1)];

  // Pixel position inside the 0..100 viewBox.
  function px(p) { return 10 + colOf(p) * 20; }
  function py(p) { return 10 + rowOf(p) * 20; }


  /* ══════════════════════════════════════════════════════════
     2. GAME STATE, MOVE GENERATION, MAKE / UNMAKE
     ══════════════════════════════════════════════════════════ */

  // S is the single live position. The search borrows it, mutates it with
  // make/unmake, and the caller restores a snapshot afterwards as a safety
  // net in case a search was aborted part way down the tree.
  var S = {
    board: new Int8Array(NP),
    goatsPlaced: 0,
    captured: 0,
    turn: GOAT_SIDE
  };

  function inPlacement(st) { return st.goatsPlaced < TOTAL_GOATS; }

  function resetState() {
    S.board = new Int8Array(NP);
    for (var i = 0; i < CORNERS.length; i++) S.board[CORNERS[i]] = TIGER;
    S.goatsPlaced = 0;
    S.captured = 0;
    S.turn = GOAT_SIDE;   // goats always start
  }

  function snapshot() {
    return {
      board: S.board.slice(),
      goatsPlaced: S.goatsPlaced,
      captured: S.captured,
      turn: S.turn
    };
  }

  function restore(snap) {
    S.board = snap.board.slice();
    S.goatsPlaced = snap.goatsPlaced;
    S.captured = snap.captured;
    S.turn = snap.turn;
  }

  function genGoat() {
    var out = [], p, i;
    if (inPlacement(S)) {
      for (p = 0; p < NP; p++) {
        if (S.board[p] === EMPTY) out.push({ type: "place", from: -1, to: p, cap: -1 });
      }
      return out;
    }
    for (p = 0; p < NP; p++) {
      if (S.board[p] !== GOAT) continue;
      var A = ADJ[p];
      for (i = 0; i < A.length; i++) {
        if (S.board[A[i]] === EMPTY) out.push({ type: "move", from: p, to: A[i], cap: -1 });
      }
    }
    return out;
  }

  function genTiger() {
    var out = [], p, i;
    // Jumps first - they are also the best ordering for alpha-beta.
    for (p = 0; p < NP; p++) {
      if (S.board[p] !== TIGER) continue;
      var J = JUMPS[p];
      for (i = 0; i < J.length; i++) {
        if (S.board[J[i].mid] === GOAT && S.board[J[i].to] === EMPTY) {
          out.push({ type: "jump", from: p, to: J[i].to, cap: J[i].mid });
        }
      }
    }
    for (p = 0; p < NP; p++) {
      if (S.board[p] !== TIGER) continue;
      var A = ADJ[p];
      for (i = 0; i < A.length; i++) {
        if (S.board[A[i]] === EMPTY) out.push({ type: "move", from: p, to: A[i], cap: -1 });
      }
    }
    return out;
  }

  function genMoves() { return S.turn === TIGER_SIDE ? genTiger() : genGoat(); }

  function make(m) {
    if (m.type === "place") {
      S.board[m.to] = GOAT;
      S.goatsPlaced++;
    } else if (m.type === "jump") {
      S.board[m.to] = TIGER;
      S.board[m.from] = EMPTY;
      S.board[m.cap] = EMPTY;
      S.captured++;
    } else {
      S.board[m.to] = S.board[m.from];
      S.board[m.from] = EMPTY;
    }
    S.turn = S.turn === GOAT_SIDE ? TIGER_SIDE : GOAT_SIDE;
  }

  function unmake(m) {
    S.turn = S.turn === GOAT_SIDE ? TIGER_SIDE : GOAT_SIDE;
    if (m.type === "place") {
      S.board[m.to] = EMPTY;
      S.goatsPlaced--;
    } else if (m.type === "jump") {
      S.board[m.from] = TIGER;
      S.board[m.to] = EMPTY;
      S.board[m.cap] = GOAT;
      S.captured--;
    } else {
      S.board[m.from] = S.board[m.to];
      S.board[m.to] = EMPTY;
    }
  }

  // Returns "tiger", "goat" or null. A side that cannot move has lost.
  function winner() {
    if (S.captured >= CAPTURES_TO_WIN) return TIGER_SIDE;
    if (genMoves().length === 0) return S.turn === TIGER_SIDE ? GOAT_SIDE : TIGER_SIDE;
    return null;
  }

  function countGoats() {
    var n = 0;
    for (var p = 0; p < NP; p++) if (S.board[p] === GOAT) n++;
    return n;
  }

  function countBlockedTigers() {
    var blocked = 0;
    for (var p = 0; p < NP; p++) {
      if (S.board[p] !== TIGER) continue;
      var can = false, i;
      var A = ADJ[p];
      for (i = 0; i < A.length && !can; i++) if (S.board[A[i]] === EMPTY) can = true;
      var J = JUMPS[p];
      for (i = 0; i < J.length && !can; i++) {
        if (S.board[J[i].mid] === GOAT && S.board[J[i].to] === EMPTY) can = true;
      }
      if (!can) blocked++;
    }
    return blocked;
  }


  /* ══════════════════════════════════════════════════════════
     3. THE COMPUTER OPPONENT
     ══════════════════════════════════════════════════════════ */

  var WIN = 100000;
  var searchDeadline = 0, searchAborted = false, searchNodes = 0;

  // Always scored from the tigers' point of view: positive favours tigers.
  function evaluate() {
    var score = S.captured * 220;
    var mob = 0, jumps = 0, blocked = 0, degree = 0;

    for (var p = 0; p < NP; p++) {
      if (S.board[p] !== TIGER) continue;
      degree += ADJ[p].length;

      var own = 0, i;
      var J = JUMPS[p];
      for (i = 0; i < J.length; i++) {
        if (S.board[J[i].mid] === GOAT && S.board[J[i].to] === EMPTY) { jumps++; own++; }
      }
      var A = ADJ[p];
      for (i = 0; i < A.length; i++) if (S.board[A[i]] === EMPTY) { mob++; own++; }
      if (own === 0) blocked++;
    }

    return score + jumps * 45 + mob * 2 - blocked * 85 + degree * 1.2;
  }

  // Cheap one-ply ordering. Good ordering matters a lot in the placement
  // phase, where the goats have up to twenty-one replies at every node.
  function orderMoves(moves, maximizing) {
    var scored = new Array(moves.length);
    for (var i = 0; i < moves.length; i++) {
      make(moves[i]);
      scored[i] = { m: moves[i], v: evaluate() };
      unmake(moves[i]);
    }
    scored.sort(maximizing ? function (a, b) { return b.v - a.v; }
                           : function (a, b) { return a.v - b.v; });
    for (var j = 0; j < scored.length; j++) moves[j] = scored[j].m;
    return moves;
  }

  function minimax(depth, alpha, beta, ply) {
    searchNodes++;
    if ((searchNodes & 511) === 0 && performance.now() > searchDeadline) searchAborted = true;
    if (searchAborted) return evaluate();

    if (S.captured >= CAPTURES_TO_WIN) return WIN - ply;

    var maximizing = S.turn === TIGER_SIDE;
    var moves = maximizing ? genTiger() : genGoat();
    if (moves.length === 0) return maximizing ? -(WIN - ply) : (WIN - ply);
    if (depth === 0) return evaluate();

    if (depth >= 2) orderMoves(moves, maximizing);

    var i, v;
    if (maximizing) {
      var best = -Infinity;
      for (i = 0; i < moves.length; i++) {
        make(moves[i]);
        v = minimax(depth - 1, alpha, beta, ply + 1);
        unmake(moves[i]);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    var worst = Infinity;
    for (i = 0; i < moves.length; i++) {
      make(moves[i]);
      v = minimax(depth - 1, alpha, beta, ply + 1);
      unmake(moves[i]);
      if (v < worst) worst = v;
      if (worst < beta) beta = worst;
      if (beta <= alpha) break;
    }
    return worst;
  }

  var LEVELS = {
    easy:   { maxDepth: 2, budget: 250,  blunder: 0.35 },
    medium: { maxDepth: 4, budget: 700,  blunder: 0.06 },
    hard:   { maxDepth: 6, budget: 1300, blunder: 0 }
  };

  function chooseMove(level) {
    var cfg = LEVELS[level] || LEVELS.medium;
    var maximizing = S.turn === TIGER_SIDE;
    var legal = genMoves();
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    // A deliberate slip now and then, so Easy is actually beatable and does
    // not feel like it is reading your mind.
    if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
      return legal[(Math.random() * legal.length) | 0];
    }

    var saved = snapshot();
    searchAborted = false;
    searchNodes = 0;
    searchDeadline = performance.now() + cfg.budget;

    var bestMove = legal[0];

    // Iterative deepening: keep the best move from the last depth that
    // finished, so running out of time never returns a half-searched answer.
    for (var depth = 1; depth <= cfg.maxDepth; depth++) {
      var moves = genMoves();
      orderMoves(moves, maximizing);

      var localBest = null;
      var localScore = maximizing ? -Infinity : Infinity;
      var ties = [];

      for (var i = 0; i < moves.length; i++) {
        make(moves[i]);
        // Full window at the root. Narrowing it here would make the scores
        // of the later moves mere bounds, and the tie-break below would then
        // sometimes pick a move that only looked equal.
        var v = minimax(depth - 1, -Infinity, Infinity, 1);
        unmake(moves[i]);

        if (searchAborted) break;

        var better = maximizing ? v > localScore : v < localScore;
        if (better) {
          localScore = v;
          localBest = moves[i];
          ties = [moves[i]];
        } else if (v === localScore) {
          ties.push(moves[i]);
        }
      }

      if (localBest && !searchAborted) {
        // Break ties randomly so repeated games do not play out identically.
        bestMove = ties.length > 1 ? ties[(Math.random() * ties.length) | 0] : localBest;
      }
      if (searchAborted) break;
      if (Math.abs(localScore) > WIN - 200) break;  // forced result found
    }

    restore(saved);
    return bestMove;
  }


  /* ══════════════════════════════════════════════════════════
     4. RENDERING
     ══════════════════════════════════════════════════════════ */

  var SVGNS = "http://www.w3.org/2000/svg";
  function $(id) { return document.getElementById(id); }
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    return el;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var gLines = $("gLines"), gDots = $("gDots"), gPieces = $("gPieces"),
      gHints = $("gHints"), gHits = $("gHits"), gLastMove = $("gLastMove");

  // The lines are engraved, not painted: a dark channel with a lighter lip
  // offset down and right, which is what sells "cut into stone".
  function drawStaticBoard() {
    clear(gLines);
    clear(gDots);
    var i, p;

    for (i = 0; i < EDGES.length; i++) {
      var a = EDGES[i][0], b = EDGES[i][1];
      gLines.appendChild(svgEl("line", {
        x1: px(a), y1: py(a), x2: px(b), y2: py(b),
        stroke: "#11161a", "stroke-width": 1.15,
        "stroke-linecap": "round", "stroke-opacity": 0.72
      }));
      gLines.appendChild(svgEl("line", {
        x1: px(a) + 0.34, y1: py(a) + 0.34, x2: px(b) + 0.34, y2: py(b) + 0.34,
        stroke: "#93a1ad", "stroke-width": 0.42,
        "stroke-linecap": "round", "stroke-opacity": 0.3
      }));
    }

    for (p = 0; p < NP; p++) {
      gDots.appendChild(svgEl("circle", {
        cx: px(p), cy: py(p), r: 2.15, fill: "url(#socket)"
      }));
      gDots.appendChild(svgEl("circle", {
        cx: px(p), cy: py(p), r: 2.15, fill: "none",
        stroke: "#9dabb7", "stroke-width": 0.3, "stroke-opacity": 0.3
      }));
    }
  }

  function drawPieces() {
    clear(gPieces);
    var showMovable = $("optMovable").checked;
    for (var p = 0; p < NP; p++) {
      var v = S.board[p];
      if (v === EMPTY) continue;
      var cls = "piece";
      if (p === ui.selected) cls += " selected";
      if (showMovable && isMovable(p)) cls += " movable-hint";
      if (isMovable(p)) cls += " movable";

      // Scaled so the corner pieces sit inside the slab rather than
      // hanging over its chiselled edge.
      var g = svgEl("g", {
        class: cls,
        transform: "translate(" + px(p) + "," + py(p) + ") scale(0.84)"
      });
      // Invisible ring the selection / movable outline is drawn on.
      g.appendChild(svgEl("circle", { class: "piece-base", r: 8.2, fill: "none" }));
      g.appendChild(svgEl("use", { href: v === TIGER ? "#tigerHead" : "#goatHead" }));
      gPieces.appendChild(g);
    }
  }

  function drawHints() {
    clear(gHints);
    if (!$("optHints").checked) return;
    if (ui.selected < 0 || !humanToMove() || ui.gameOver) return;
    for (var i = 0; i < ui.legal.length; i++) {
      var m = ui.legal[i];
      if (m.from !== ui.selected) continue;
      gHints.appendChild(svgEl("circle", {
        class: "hint-dot" + (m.type === "jump" ? " capture" : ""),
        cx: px(m.to), cy: py(m.to), r: m.type === "jump" ? 4.4 : 3.4
      }));
    }
  }

  function drawLastMove() {
    clear(gLastMove);
    var m = ui.lastMove;
    if (!m) return;
    if (m.from < 0) {
      gLastMove.appendChild(svgEl("circle", {
        class: "last-move", cx: px(m.to), cy: py(m.to), r: 8.4
      }));
      return;
    }
    gLastMove.appendChild(svgEl("line", {
      class: "last-move",
      x1: px(m.from), y1: py(m.from), x2: px(m.to), y2: py(m.to)
    }));
  }

  function drawHits() {
    clear(gHits);
    for (var p = 0; p < NP; p++) {
      var playable = isClickable(p);
      var attrs = {
        class: "pt-hit" + (playable ? " playable" : ""),
        cx: px(p), cy: py(p), r: 9,
        "data-p": p
      };
      var el = svgEl("circle", attrs);
      if (playable) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", describePoint(p));
      }
      gHits.appendChild(el);
    }
  }

  function describePoint(p) {
    var v = S.board[p];
    var what = v === TIGER ? "tiger" : v === GOAT ? "goat" : "empty point";
    return nameOf(p) + ", " + what;
  }

  function render() {
    drawPieces();
    drawLastMove();
    drawHints();
    drawHits();
    renderStatus();
  }


  /* ══════════════════════════════════════════════════════════
     5. INTERACTION AND CONTROLS
     ══════════════════════════════════════════════════════════ */

  var ui = {
    mode: "vs",            // "vs" = against the computer, "hotseat" = two players
    humanSide: GOAT_SIDE,
    level: "medium",
    selected: -1,
    legal: [],
    history: [],           // snapshots, one per move played
    log: [],
    lastMove: null,
    gameOver: null,
    thinking: false,
    gen: 0                 // bumped on every new game, to void stale AI callbacks
  };

  function humanToMove() {
    if (ui.thinking || ui.gameOver) return false;
    return ui.mode === "hotseat" || S.turn === ui.humanSide;
  }

  function isMovable(p) {
    if (!humanToMove()) return false;
    var side = S.turn === TIGER_SIDE ? TIGER : GOAT;
    if (S.board[p] !== side) return false;
    for (var i = 0; i < ui.legal.length; i++) if (ui.legal[i].from === p) return true;
    return false;
  }

  function isClickable(p) {
    if (!humanToMove()) return false;
    if (isMovable(p)) return true;
    for (var i = 0; i < ui.legal.length; i++) {
      var m = ui.legal[i];
      if (m.to !== p) continue;
      if (m.from < 0) return true;                 // a placement
      if (m.from === ui.selected) return true;     // a destination for the selection
    }
    return false;
  }

  function refreshLegal() {
    ui.legal = ui.gameOver ? [] : genMoves();
  }

  function moveText(m) {
    if (m.type === "place") return nameOf(m.to);
    if (m.type === "jump") return nameOf(m.from) + " x " + nameOf(m.to);
    return nameOf(m.from) + " - " + nameOf(m.to);
  }

  function playMove(m) {
    ui.history.push(snapshot());
    var side = S.turn;
    make(m);

    ui.log.push({
      n: ui.log.length + 1,
      side: side,
      text: moveText(m),
      cap: m.type === "jump" ? nameOf(m.cap) : null
    });
    ui.lastMove = m;
    ui.selected = -1;

    ui.gameOver = winner();
    refreshLegal();
    render();
    renderLog();

    if (ui.gameOver) {
      showResult();
      return;
    }
    maybeStartComputer();
  }

  function maybeStartComputer() {
    if (ui.mode !== "vs" || ui.gameOver) return;
    if (S.turn === ui.humanSide) return;

    ui.thinking = true;
    $("thinking").classList.remove("hidden");
    render();

    // Restarting while the computer is queued must not let the old callback
    // drop a move into the new game, so each game carries a generation stamp
    // and a stale callback simply returns.
    var gen = ui.gen;

    // Two frames plus a timeout, so the "Thinking" chip is actually painted
    // before the search blocks the main thread.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () {
          if (gen !== ui.gen) return;
          var m = chooseMove(ui.level);
          if (gen !== ui.gen) return;
          ui.thinking = false;
          $("thinking").classList.add("hidden");
          if (!m) {
            ui.gameOver = winner();
            refreshLegal();
            render();
            if (ui.gameOver) showResult();
            return;
          }
          playMove(m);
        }, 20);
      });
    });
  }

  function onPointActivate(p) {
    if (!humanToMove()) return;

    // A placement is a single click on an empty point.
    if (inPlacement(S) && S.turn === GOAT_SIDE) {
      for (var i = 0; i < ui.legal.length; i++) {
        if (ui.legal[i].from < 0 && ui.legal[i].to === p) { playMove(ui.legal[i]); return; }
      }
      toast("Goats can only go on an empty point.");
      return;
    }

    // Clicking a piece of the side to move selects it.
    if (isMovable(p)) {
      ui.selected = ui.selected === p ? -1 : p;
      render();
      return;
    }

    // With something selected, clicking a highlighted point plays the move.
    if (ui.selected >= 0) {
      for (var j = 0; j < ui.legal.length; j++) {
        var m = ui.legal[j];
        if (m.from === ui.selected && m.to === p) { playMove(m); return; }
      }
    }

    if (ui.selected >= 0) { ui.selected = -1; render(); }
  }

  function undo() {
    if (ui.thinking || ui.history.length === 0) return;

    function stepBack() {
      var snap = ui.history.pop();
      if (!snap) return false;
      restore(snap);
      ui.log.pop();
      return true;
    }

    stepBack();
    // Against the computer, step back past its reply too, so the board comes
    // back to the player rather than handing them the computer's turn.
    if (ui.mode === "vs" && S.turn !== ui.humanSide && ui.history.length > 0) stepBack();

    ui.gameOver = null;
    ui.selected = -1;
    ui.lastMove = null;
    hideResult();
    refreshLegal();
    render();
    renderLog();

    // If undo landed on the computer's turn anyway (it opened the game), let
    // it think again rather than leaving the board stuck.
    maybeStartComputer();
  }

  function applyModeUi() {
    var hot = ui.mode === "hotseat";
    $("modeVs").setAttribute("aria-checked", hot ? "false" : "true");
    $("modeHot").setAttribute("aria-checked", hot ? "true" : "false");
    $("fieldSide").classList.toggle("hidden", hot);
    $("fieldLevel").classList.toggle("hidden", hot);
    $("seats").classList.toggle("hidden", !hot);
  }

  function playerName(side) {
    if (ui.mode !== "hotseat") return side === TIGER_SIDE ? "Tigers" : "Goats";
    var el = side === TIGER_SIDE ? $("nameTiger") : $("nameGoat");
    var v = (el.value || "").trim();
    return v || (side === TIGER_SIDE ? "Player 2" : "Player 1");
  }

  function newGame() {
    ui.gen++;
    ui.humanSide = $("optSide").value === "tiger" ? TIGER_SIDE : GOAT_SIDE;
    ui.level = $("optLevel").value;
    applyModeUi();

    resetState();
    ui.selected = -1;
    ui.history = [];
    ui.log = [];
    ui.lastMove = null;
    ui.gameOver = null;
    ui.thinking = false;
    $("thinking").classList.add("hidden");

    hideResult();
    refreshLegal();
    render();
    renderLog();
    maybeStartComputer();
  }


  /* ---------- status, log, result, toast ---------- */

  function renderStatus() {
    var goatsOnBoard = countGoats();
    var blocked = countBlockedTigers();

    $("goatsLeft").textContent = String(TOTAL_GOATS - S.goatsPlaced);
    $("goatsBoard").textContent = String(goatsOnBoard);
    $("tigersBlocked").textContent = String(blocked);

    var pips = $("pips");
    clear(pips);
    for (var i = 0; i < CAPTURES_TO_WIN; i++) {
      var s = document.createElement("span");
      s.className = "pip" + (i < S.captured ? " on" : "");
      pips.appendChild(s);
    }

    var dot = $("turnDot");
    dot.className = "turn-dot" + (S.turn === TIGER_SIDE ? " tiger" : "");

    var hot = ui.mode === "hotseat";
    var title, sub;

    if (ui.gameOver) {
      title = hot
        ? playerName(ui.gameOver) + " wins"
        : (ui.gameOver === TIGER_SIDE ? "Tigers win" : "Goats win");
      sub = ui.gameOver === TIGER_SIDE ? "Five goats eaten." : "Every tiger is trapped.";
    } else if (S.turn === GOAT_SIDE) {
      title = hot
        ? playerName(GOAT_SIDE) + (inPlacement(S) ? " to place" : " to move")
        : (inPlacement(S) ? "Goats to place" : "Goats to move");
      if (!humanToMove()) {
        sub = "The computer is playing the goats.";
      } else {
        sub = inPlacement(S)
          ? "Click any empty point to put a goat down."
          : "Pick a goat, then an empty point next to it.";
        if (hot) sub = "Goats. " + sub;
      }
    } else {
      title = hot ? playerName(TIGER_SIDE) + " to move" : "Tigers to move";
      if (!humanToMove()) {
        sub = "The computer is playing the tigers.";
      } else {
        sub = "Pick a tiger, then where it goes. Jump a goat to eat it.";
        if (hot) sub = "Tigers. " + sub;
      }
    }

    $("turnText").textContent = title;
    $("turnSub").textContent = sub;
    $("btnUndo").disabled = ui.thinking || ui.history.length === 0;
  }

  function renderLog() {
    var box = $("log");
    clear(box);
    if (ui.log.length === 0) {
      var p = document.createElement("p");
      p.className = "log-empty";
      p.textContent = "No moves yet.";
      box.appendChild(p);
      return;
    }
    for (var i = ui.log.length - 1; i >= 0; i--) {
      var e = ui.log[i];
      var row = document.createElement("div");
      row.className = "log-item";

      var n = document.createElement("span");
      n.className = "log-n";
      n.textContent = e.n;

      var side = document.createElement("span");
      side.className = "log-side" + (e.side === TIGER_SIDE ? " tiger" : "");

      var txt = document.createElement("span");
      txt.className = "log-txt";
      txt.textContent = e.text;

      row.appendChild(n);
      row.appendChild(side);
      row.appendChild(txt);

      if (e.cap) {
        var cap = document.createElement("span");
        cap.className = "log-cap";
        cap.textContent = "ate " + e.cap;
        row.appendChild(cap);
      }
      box.appendChild(row);
    }
  }

  function showResult() {
    var tigersWon = ui.gameOver === TIGER_SIDE;
    $("resultTitle").textContent = ui.mode === "hotseat"
      ? playerName(ui.gameOver) + " wins"
      : (tigersWon ? "Tigers win" : "Goats win");

    var text;
    if (tigersWon) {
      text = S.captured >= CAPTURES_TO_WIN
        ? "Five goats eaten."
        : "The goats have nowhere left to move.";
    } else {
      text = "Every tiger is trapped with nowhere to go.";
    }
    if (ui.mode === "hotseat") {
      text += " Playing the " + (tigersWon ? "tigers." : "goats.");
    } else {
      text += ui.gameOver === ui.humanSide ? " You win." : " The computer wins.";
    }
    $("resultText").textContent = text;
    $("result").classList.remove("hidden");
  }

  function hideResult() { $("result").classList.add("hidden"); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2200);
  }


  /* ---------- wiring ---------- */

  $("board").addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest(".pt-hit") : null;
    if (!el) return;
    onPointActivate(Number(el.getAttribute("data-p")));
  });

  $("board").addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return;
    var el = ev.target;
    if (!el || !el.classList || !el.classList.contains("pt-hit")) return;
    ev.preventDefault();
    onPointActivate(Number(el.getAttribute("data-p")));
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && ui.selected >= 0) { ui.selected = -1; render(); }
  });

  $("btnNew").addEventListener("click", newGame);
  $("btnRestart").addEventListener("click", newGame);
  $("btnResultNew").addEventListener("click", newGame);
  $("btnUndo").addEventListener("click", undo);
  $("optSide").addEventListener("change", newGame);
  $("optLevel").addEventListener("change", newGame);

  $("modeVs").addEventListener("click", function () {
    if (ui.mode === "vs") return;
    ui.mode = "vs";
    newGame();
  });
  $("modeHot").addEventListener("click", function () {
    if (ui.mode === "hotseat") return;
    ui.mode = "hotseat";
    newGame();
  });

  // Swapping seats just swaps the two names - the goats always move first.
  $("btnSwap").addEventListener("click", function () {
    var a = $("nameGoat").value;
    $("nameGoat").value = $("nameTiger").value;
    $("nameTiger").value = a;
    renderStatus();
    toast($("nameGoat").value + " now plays the goats.");
  });
  $("nameGoat").addEventListener("input", renderStatus);
  $("nameTiger").addEventListener("input", renderStatus);

  // These two only change what is drawn, so they must not restart the game.
  $("optHints").addEventListener("change", function () { drawHints(); });
  $("optMovable").addEventListener("change", function () { drawPieces(); });

  drawStaticBoard();
  newGame();
})();
