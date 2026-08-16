/* ============================================
   DrDer Chess Alpha - Professional Personality System v3.2
   ============================================ */

var personalities = {
    alpha: {
        name: 'ALPHA',
        type: 'TACTICAL AI',
        aggression: 0.90,
        kingAttack: 0.90,
        tacticalRisk: 0.75,
        sacrifice: 0.65,
        pieceActivity: 0.85,
        defense: 0.35,
        endgame: 0.50,
        drawAvoidance: 0.85
    },
    beta: {
        name: 'BETA',
        type: 'STRATEGIC AI',
        aggression: 0.50,
        kingAttack: 0.50,
        tacticalRisk: 0.25,
        sacrifice: 0.10,
        pieceActivity: 0.75,
        defense: 0.90,
        endgame: 0.90,
        drawAvoidance: 0.65
    }
};

var state = {
    currentGame: null,
    gameHistory: [],
    alphaColor: 'w',
    betaColor: 'b',
    currentTurn: 'w',
    isMatchRunning: false,
    workers: { alpha: null, beta: null },
    searchActive: false,
    globalSearchId: 1,
    currentSearchId: 0,
    multiPV: { currentDepth: 0, slots: {}, bestComplete: [], bestCompleteDepth: 0 },
    nextMoveTimer: null,
    matchTransitionTimer: null,
    watchdogTimer: null,
    colorSwap: false,
    openingMoves: [],
    openingIndex: 0,
    waitingForGameReady: false,
    capturedByWhite: [],
    capturedByBlack: []
};

var OPENINGS = [
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'],
    ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6'],
    ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6', 'c1g5', 'f8e7'],
    ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5'],
    ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7'],
    ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'd1c2', 'e8g8'],
    ['c2c4', 'e7e5', 'b1c3', 'b8c6', 'g1f3', 'g8f6', 'g2g3', 'f8b4'],
    ['c2c4', 'e7e6', 'b1c3', 'd7d5', 'd2d4', 'g8f6', 'c1g5', 'f8e7'],
    ['g1f3', 'd7d5', 'd2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8e7'],
    ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6', 'f2f4', 'f8g7']
];

var SEARCH_TIMEOUT = 12000;
var MAX_EVAL_LOSS = 50;
var MATE_SCORE = 100000;
var DEBUG = false;

function log(tag, msg) {
    if (DEBUG && typeof console !== 'undefined') {
        console.log('[DrDer][' + tag + '] ' + msg);
    }
}

// ============================================
// التهيئة
// ============================================

function initEmptyBoard() {
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    state.capturedByWhite = [];
    state.capturedByBlack = [];
    drawBoard();
    updateCapturedDisplay();
}

document.addEventListener('DOMContentLoaded', function() {
    initEmptyBoard();
    document.getElementById('whitePlayer').textContent = 'Alpha';
    document.getElementById('blackPlayer').textContent = 'Beta';
    startSystem();
});

function startSystem() {
    terminateAllWorkers();
    
    var alphaPath = new URL('stockfish.alpha.js', window.location.href).href;
    var betaPath = new URL('stockfish.beta.js', window.location.href).href;
    
    state.workers.alpha = createWorker('alpha', alphaPath);
    state.workers.beta = createWorker('beta', betaPath);

    var checkReady = function() {
        var a = state.workers.alpha && state.workers.alpha.ready;
        var b = state.workers.beta && state.workers.beta.ready;
        if (a && b && !state.waitingForGameReady) {
            prepareMatch();
        } else {
            setTimeout(checkReady, 500);
        }
    };
    setTimeout(checkReady, 2000);
}

function terminateAllWorkers() {
    ['alpha', 'beta'].forEach(function(name) {
        if (state.workers[name]) {
            try { state.workers[name].postMessage('stop'); } catch(e) {}
            state.workers[name].terminate();
        }
    });
}

// ============================================
// إنشاء Worker
// ============================================

function createWorker(name, path) {
    var worker;
    
    try {
        worker = new Worker(path);
    } catch (e) {
        console.error('[DrDer] Failed to create ' + name + ' worker:', e.message);
        return null;
    }
    
    worker.ready = false;
    worker.gameReady = false;
    worker.searching = false;
    worker.name = name;
    worker.workerSearchId = 0;

    worker.onmessage = function(e) {
        var msg = e.data;
        if (msg && typeof msg === 'object' && msg.data) msg = msg.data;
        if (typeof msg !== 'string') return;

        if (msg.indexOf('readyok') !== -1) {
            if (!worker.ready) {
                worker.ready = true;
                return;
            }
            worker.gameReady = true;
            onWorkerReady(name);
            return;
        }

        if (msg.indexOf('info') !== -1 && msg.indexOf('multipv') !== -1) {
            parseStockfishInfo(msg, worker);
            return;
        }

        if (msg.indexOf('bestmove') !== -1) {
            if (worker.workerSearchId === state.currentSearchId) {
                handleBestmove(name, msg, worker);
            }
        }
    };

    worker.onerror = function(e) {
        console.error('[DrDer] ' + name + ' worker error:', e.message || 'unknown');
        worker.ready = false;
        worker.gameReady = false;
        worker.searching = false;
        handleWorkerCrash(name);
    };

    initializeEngine(worker);
    return worker;
}

function initializeEngine(worker) {
    worker.postMessage('uci');
    worker.postMessage('setoption name MultiPV value 4');
    worker.postMessage('isready');
}

function onWorkerReady(name) {
    if (!state.waitingForGameReady) return;
    
    var a = state.workers.alpha && state.workers.alpha.gameReady;
    var b = state.workers.beta && state.workers.beta.gameReady;
    
    if (a && b) {
        state.waitingForGameReady = false;
        startMatch();
    }
}

function handleWorkerCrash(name) {
    if (!state.isMatchRunning) return;
    state.searchActive = false;
    if (state.watchdogTimer) { clearTimeout(state.watchdogTimer); state.watchdogTimer = null; }
    var worker = state.workers[name];
    if (worker) { worker.searching = false; worker.terminate(); }
    state.workers[name] = createWorker(name, new URL('stockfish.' + name + '.js', window.location.href).href);
}

// ============================================
// MultiPV Snapshot
// ============================================

function parseStockfishInfo(msg, worker) {
    if (worker.workerSearchId !== state.currentSearchId) return;

    var parts = msg.split(' ');
    var pvI = -1, mpI = -1, cpI = -1, mtI = -1, dI = -1;
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === 'pv') pvI = i;
        else if (parts[i] === 'multipv') mpI = i;
        else if (parts[i] === 'cp') cpI = i;
        else if (parts[i] === 'mate') mtI = i;
        else if (parts[i] === 'depth') dI = i;
    }
    if (pvI === -1 || mpI === -1) return;

    var rank = parseInt(parts[mpI + 1]);
    if (isNaN(rank) || rank < 1 || rank > 10) return;
    var move = parts[pvI + 1];
    if (!move) return;

    var score = 0, isMate = false, mateIn = 0, depth = 0;
    if (dI !== -1) { depth = parseInt(parts[dI + 1]); if (isNaN(depth)) depth = 0; }
    if (cpI !== -1) { score = parseInt(parts[cpI + 1]); if (isNaN(score)) score = 0; }
    else if (mtI !== -1) {
        mateIn = parseInt(parts[mtI + 1]); if (isNaN(mateIn)) mateIn = 0;
        score = mateIn > 0 ? MATE_SCORE - mateIn : -MATE_SCORE - mateIn;
        isMate = true;
    }

    var pv = [];
    for (var j = pvI + 1; j < parts.length; j++) {
        var token = parts[j];
        if (token === 'score' || token === 'multipv' || token === 'depth' || token === 'cp' || token === 'mate' || token === 'nodes' || token === 'nps' || token === 'time' || token === 'pv') break;
        pv.push(token);
    }

    if (depth > state.multiPV.currentDepth) {
        state.multiPV.currentDepth = depth;
        state.multiPV.slots = {};
    }
    if (depth < state.multiPV.currentDepth) return;

    state.multiPV.slots[rank] = {
        move: move, score: score, rank: rank,
        isMate: isMate, mateIn: mateIn, depth: depth, pv: pv
    };

    tryCommitSnapshot();
}

function tryCommitSnapshot() {
    var slots = state.multiPV.slots;
    var complete = [];
    for (var i = 1; i <= 4; i++) {
        if (!slots[i]) return;
        complete.push(slots[i]);
    }
    if (state.multiPV.currentDepth >= state.multiPV.bestCompleteDepth) {
        state.multiPV.bestComplete = complete;
        state.multiPV.bestCompleteDepth = state.multiPV.currentDepth;
    }
}

function getBestCandidates() {
    var c = state.multiPV.bestComplete;
    if (c.length === 4) return c;
    var arr = [];
    for (var i = 1; i <= 4; i++) {
        if (state.multiPV.slots[i]) arr.push(state.multiPV.slots[i]);
    }
    return arr;
}

// ============================================
// bestmove
// ============================================

function handleBestmove(playerName, msg, worker) {
    if (!state.isMatchRunning) return;
    if (worker.workerSearchId !== state.currentSearchId) return;
    if (state.watchdogTimer) { clearTimeout(state.watchdogTimer); state.watchdogTimer = null; }
    worker.searching = false;
    state.searchActive = false;

    var parts = msg.split(' ');
    var bestMove = parts[1];
    if (!bestMove || bestMove === '(none)') {
        if (state.currentGame && state.currentGame.game_over()) { endMatch(); }
        else { scheduleNextMove(); }
        return;
    }

    var chosenMove = selectBestMove(playerName, bestMove, getBestCandidates(), state.currentGame);
    try {
        var move = state.currentGame.move(chosenMove, { sloppy: true });
        if (move) {
            state.gameHistory.push(move);
            if (move.captured) {
                if (move.color === 'w') {
                    state.capturedByWhite.push(move.captured);
                } else {
                    state.capturedByBlack.push(move.captured);
                }
            }
            state.currentTurn = state.currentGame.turn();
            drawBoard();
            updateCapturedDisplay();
            if (state.currentGame.game_over()) { endMatch(); }
            else { scheduleNextMove(); }
        } else { scheduleNextMove(); }
    } catch(e) { scheduleNextMove(); }
}

// ============================================
// selectBestMove
// ============================================

function selectBestMove(playerName, bestMove, candidates, game) {
    var valid = [];
    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (!c || !c.move) continue;
        var mo = simulateMove(c.move, game);
        if (!mo) continue;
        valid.push({
            move: c.move, score: c.score, isMate: c.isMate, mateIn: c.mateIn,
            depth: c.depth, san: mo.san, captured: mo.captured, piece: mo.piece,
            isCheck: mo.san.indexOf('+') !== -1,
            isCastle: mo.san.indexOf('O-O') !== -1,
            from: mo.from, to: mo.to, flags: mo.flags
        });
    }
    if (valid.length === 0) return bestMove;

    valid.sort(function(a, b) { return b.score - a.score; });
    var bestScore = valid[0].score;

    var filtered = [];
    for (var j = 0; j < valid.length; j++) {
        var v = valid[j];
        if (v.isMate && v.mateIn > 0 && v.mateIn <= 5) { filtered.push(v); }
        else if (!v.isMate && v.score >= bestScore - MAX_EVAL_LOSS) { filtered.push(v); }
    }
    if (filtered.length === 0) return valid[0].move;
    if (filtered.length === 1) return filtered[0].move;

    var scored = [];
    for (var k = 0; k < filtered.length; k++) {
        var cand = filtered[k];
        var eq = calcEngineQuality(cand, bestScore);
        var pb = (playerName === 'alpha') ? evalAlpha(cand, game) : evalBeta(cand, game);
        scored.push({ move: cand.move, final: eq + pb, san: cand.san, engine: cand.score });
    }
    scored.sort(function(a, b) { return b.final - a.final; });
    return scored[0].move;
}

function calcEngineQuality(cand, bestScore) {
    if (cand.isMate && cand.mateIn > 0 && cand.mateIn <= 5) return 3000;
    if (cand.isMate && cand.mateIn < 0) return -2000;
    var loss = bestScore - cand.score;
    if (loss <= 0) return 1000;
    var quality = 1000 - (loss * 5);
    return Math.max(0, quality);
}

function simulateMove(moveStr, game) {
    try {
        var move = game.move(moveStr, { sloppy: true });
        if (move) { game.undo(); return move; }
    } catch(e) {}
    return null;
}

function evalAlpha(cand, game) {
    var b = 0, p = personalities.alpha;
    if (cand.isCheck) b += Math.round(12 * p.aggression);
    if (cand.captured) b += Math.round(10 * p.tacticalRisk);
    if (cand.captured && cand.piece !== 'p' && cand.captured !== 'p') b += Math.round(8 * p.tacticalRisk);
    if (cand.captured && cand.piece === 'p' && (cand.captured === 'n' || cand.captured === 'b')) b += Math.round(6 * p.sacrifice);
    if (cand.piece === 'q' || cand.piece === 'r') b += Math.round(5 * p.pieceActivity);

    try {
        var move = game.move(cand.move, { sloppy: true });
        if (move) {
            var board = game.board(), turn = game.turn();
            var oppColor = turn, myColor = turn === 'w' ? 'b' : 'w';
            var oppKing = findKing(board, oppColor);
            if (oppKing && countAttackers(game, oppKing, myColor) >= 2) b += Math.round(6 * p.kingAttack);
            if (game.moves().length >= 35) b += Math.round(4 * p.pieceActivity);
            game.undo();
        }
    } catch(e) {}

    if (cand.isMate && cand.mateIn > 0) b += 500;
    return b;
}

function evalBeta(cand, game) {
    var b = 0, p = personalities.beta;
    if (cand.isCastle) b += Math.round(12 * p.defense);
    if ((cand.piece === 'n' || cand.piece === 'b') && !cand.captured) b += Math.round(7 * p.pieceActivity);
    if (cand.piece === 'p' && !cand.captured) b += Math.round(3 * p.defense);
    if (cand.isCheck && !cand.captured) b -= Math.round(5 * (1 - p.tacticalRisk));

    try {
        var move = game.move(cand.move, { sloppy: true });
        if (move) {
            var board = game.board(), turn = game.turn();
            var myColor = turn, oppColor = turn === 'w' ? 'b' : 'w';
            var myKing = findKing(board, myColor);
            if (myKing && countAttackers(game, myKing, oppColor) === 0) b += Math.round(5 * p.defense);
            game.undo();
        }
    } catch(e) {}

    if (cand.isMate && cand.mateIn > 0) b += 500;
    return b;
}

function findKing(board, color) {
    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var piece = board[r][c];
            if (piece && piece.type === 'k' && piece.color === color) return { row: r, col: c };
        }
    }
    return null;
}

function countAttackers(game, target, attackerColor) {
    var count = 0;
    var moves = game.moves({ verbose: true });
    var sq = String.fromCharCode(97 + target.col) + (8 - target.row);
    for (var i = 0; i < moves.length; i++) {
        if (moves[i].to === sq) {
            var piece = game.get(moves[i].from);
            if (piece && piece.color === attackerColor) count++;
        }
    }
    return count;
}

// ============================================
// التوقيت والجدولة
// ============================================

function scheduleNextMove() {
    if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);
    state.nextMoveTimer = setTimeout(function() { state.nextMoveTimer = null; makeNextMove(); }, 300);
}

function makeNextMove() {
    if (!state.isMatchRunning) return;
    if (state.searchActive) return;
    if (!state.currentGame || state.currentGame.game_over()) { endMatch(); return; }

    // الافتتاحية - نقلة نقلة مع تفكير
    if (state.openingIndex < state.openingMoves.length) {
        var openingMove = state.openingMoves[state.openingIndex];
        state.openingIndex++;
        try {
            var move = state.currentGame.move(openingMove, { sloppy: true });
            if (move) {
                state.gameHistory.push(move);
                if (move.captured) {
                    if (move.color === 'w') {
                        state.capturedByWhite.push(move.captured);
                    } else {
                        state.capturedByBlack.push(move.captured);
                    }
                }
                state.currentTurn = state.currentGame.turn();
                drawBoard();
                updateCapturedDisplay();
            }
        } catch(e) {}
        // تأخير أطول للافتتاحية - 1.5 ثانية بين كل حركة
        if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);
        state.nextMoveTimer = setTimeout(function() { state.nextMoveTimer = null; makeNextMove(); }, 1500);
        return;
    }

    var playerName = state.currentTurn === state.alphaColor ? 'alpha' : 'beta';
    var worker = state.workers[playerName];
    if (!worker || !worker.ready || !worker.gameReady) { scheduleNextMove(); return; }

    state.searchActive = true;
    state.globalSearchId++;
    state.currentSearchId = state.globalSearchId;
    state.multiPV = { currentDepth: 0, slots: {}, bestComplete: [], bestCompleteDepth: 0 };
    worker.workerSearchId = state.currentSearchId;
    worker.searching = true;

    var fen = state.currentGame.fen();
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go movetime 7000');

    if (state.watchdogTimer) clearTimeout(state.watchdogTimer);
    state.watchdogTimer = setTimeout(function() {
        state.watchdogTimer = null;
        if (worker.workerSearchId === state.currentSearchId && worker.searching) {
            worker.postMessage('stop');
            setTimeout(function() {
                if (worker.workerSearchId === state.currentSearchId && worker.searching) {
                    worker.searching = false;
                    state.searchActive = false;
                    handleWorkerCrash(playerName);
                }
            }, 2000);
        }
    }, SEARCH_TIMEOUT);
}

// ============================================
// المباراة
// ============================================

function prepareMatch() {
    state.isMatchRunning = false;
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    state.searchActive = false;
    state.multiPV = { currentDepth: 0, slots: {}, bestComplete: [], bestCompleteDepth: 0 };
    state.colorSwap = !state.colorSwap;
    state.alphaColor = state.colorSwap ? 'b' : 'w';
    state.betaColor = state.colorSwap ? 'w' : 'b';
    state.waitingForGameReady = true;
    state.capturedByWhite = [];
    state.capturedByBlack = [];

    document.getElementById('whitePlayer').textContent = state.alphaColor === 'w' ? 'Alpha' : 'Beta';
    document.getElementById('blackPlayer').textContent = state.alphaColor === 'w' ? 'Beta' : 'Alpha';

    ['alpha', 'beta'].forEach(function(name) {
        var w = state.workers[name];
        if (w && w.ready) {
            w.gameReady = false;
            w.postMessage('stop');
            w.postMessage('ucinewgame');
            w.postMessage('isready');
        }
    });
}

function startMatch() {
    state.isMatchRunning = true;
    state.openingIndex = 0;
    state.openingMoves = OPENINGS[Math.floor(Math.random() * OPENINGS.length)];
    drawBoard();
    updateCapturedDisplay();
    scheduleNextMove();
}

function endMatch() {
    if (!state.isMatchRunning) return;
    state.isMatchRunning = false;
    state.searchActive = false;
    state.globalSearchId++;
    state.currentSearchId = state.globalSearchId;

    if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);
    if (state.watchdogTimer) { clearTimeout(state.watchdogTimer); state.watchdogTimer = null; }

    if (state.workers.alpha) { try { state.workers.alpha.postMessage('stop'); } catch(e) {} state.workers.alpha.searching = false; }
    if (state.workers.beta) { try { state.workers.beta.postMessage('stop'); } catch(e) {} state.workers.beta.searching = false; }

    state.matchTransitionTimer = setTimeout(function() { state.matchTransitionTimer = null; prepareMatch(); }, 800);
}

// ============================================
// رسم الرقعة والقطع المأسورة
// ============================================

function drawBoard() {
    if (!state.currentGame) return;
    var board = state.currentGame.board();
    var cb = document.getElementById('chessboard');
    if (!cb) return;

    var icons = {
        w: { p: '\u2659', n: '\u2658', b: '\u2657', r: '\u2656', q: '\u2655', k: '\u2654' },
        b: { p: '\u265F', n: '\u265E', b: '\u265D', r: '\u265C', q: '\u265B', k: '\u265A' }
    };

    cb.innerHTML = '';
    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var sq = document.createElement('div');
            sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            var p = board[r][c];
            if (p) {
                var pc = document.createElement('div');
                pc.className = 'piece ' + (p.color === 'w' ? 'white' : 'black');
                pc.textContent = icons[p.color][p.type];
                sq.appendChild(pc);
            }
            cb.appendChild(sq);
        }
    }
}

function updateCapturedDisplay() {
    var whiteCapturedEl = document.getElementById('whiteCaptured');
    var blackCapturedEl = document.getElementById('blackCaptured');
    
    if (whiteCapturedEl) {
        whiteCapturedEl.textContent = state.capturedByWhite.join(' ');
    }
    if (blackCapturedEl) {
        blackCapturedEl.textContent = state.capturedByBlack.join(' ');
    }
}

window.drderChess = { state: state };
