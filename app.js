/* ============================================
   DrDer Chess Alpha - Professional Personality System v3.8
   Visual Move Tracking + Anti-Repeat
   ============================================ */

var personalities = {
    alpha: {
        name: 'ALPHA',
        type: 'TACTICAL AI',
        aggression: 0.95,
        kingAttack: 0.95,
        tacticalRisk: 0.80,
        sacrifice: 0.70,
        pieceActivity: 0.90,
        defense: 0.35,
        endgame: 0.55,
        drawAvoidance: 0.90,
        depth: 25,
        movetime: 8000,
        multiPV: 4,
        threshold: 50
    },
    beta: {
        name: 'BETA',
        type: 'STRATEGIC AI',
        aggression: 0.50,
        kingAttack: 0.50,
        tacticalRisk: 0.25,
        sacrifice: 0.10,
        pieceActivity: 0.80,
        defense: 0.95,
        endgame: 0.95,
        drawAvoidance: 0.70,
        depth: 23,
        movetime: 8000,
        multiPV: 4,
        threshold: 40
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
    capturedByBlack: [],
    currentOpeningName: '',
    currentOpeningNameAr: '',
    usedOpenings: [],
    soundEnabled: true,
    matchCount: 0,
    lastMove: null,
    recentMoves: [],
    audioFiles: {
        move: 'move.mp3',
        capture: 'capture.mp3',
        check: 'check.mp3',
        checkmate: 'checkmate.mp3',
        promote: 'promote.mp3'
    }
};

var PIECE_UNICODE = {
    p: '\u265F',
    n: '\u265E',
    b: '\u265D',
    r: '\u265C',
    q: '\u265B',
    k: '\u265A'
};

var OPENINGS = [
    { name: 'Ruy Lopez', nameAr: 'الروي لوبيز', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
    { name: 'Sicilian Defense', nameAr: 'الدفاع الصقلي', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4'] },
    { name: 'French Defense', nameAr: 'الدفاع الفرنسي', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3'] },
    { name: 'Caro-Kann Defense', nameAr: 'دفاع كارو-كان', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3'] },
    { name: "Queen's Gambit", nameAr: 'المناورة الوزيرية', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3'] },
    { name: 'Nimzo-Indian Defense', nameAr: 'الدفاع النيمزو-هندي', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3'] },
    { name: 'English Opening', nameAr: 'الافتتاح الإنجليزي', moves: ['c2c4', 'e7e5', 'b1c3', 'b8c6', 'g1f3'] },
    { name: 'Catalan Opening', nameAr: 'الافتتاح الكتالوني', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g2g3'] },
    { name: 'Pirc Defense', nameAr: 'دفاع بيرك', moves: ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3'] },
    { name: 'Italian Game', nameAr: 'اللعبة الإيطالية', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
    { name: 'Scotch Game', nameAr: 'اللعبة الاسكتلندية', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4'] },
    { name: 'Vienna Game', nameAr: 'لعبة فيينا', moves: ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4'] },
    { name: 'Petrov Defense', nameAr: 'دفاع بيتروف', moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3e5'] },
    { name: 'Scandinavian Defense', nameAr: 'الدفاع الإسكندنافي', moves: ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3'] },
    { name: 'Modern Defense', nameAr: 'الدفاع الحديث', moves: ['e2e4', 'g7g6', 'd2d4', 'f8g7', 'b1c3'] },
    { name: 'Alekhine Defense', nameAr: 'دفاع ألكين', moves: ['e2e4', 'g8f6', 'e4e5', 'f6d5', 'd2d4'] },
    { name: "King's Indian Defense", nameAr: 'الدفاع الملكي الهندي', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3'] },
    { name: "Queen's Indian Defense", nameAr: 'الدفاع الوزيري الهندي', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3'] },
    { name: 'Grünfeld Defense', nameAr: 'دفاع جرونفيلد', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3'] },
    { name: 'Dutch Defense', nameAr: 'الدفاع الهولندي', moves: ['d2d4', 'f7f5', 'c2c4', 'g8f6', 'g2g3'] },
    { name: 'London System', nameAr: 'نظام لندن', moves: ['d2d4', 'g8f6', 'g1f3', 'd7d5', 'c1f4'] },
    { name: 'Réti Opening', nameAr: 'افتتاح ريتي', moves: ['g1f3', 'd7d5', 'c2c4', 'e7e6', 'g2g3'] },
    { name: 'Four Knights Game', nameAr: 'لعبة الفرسان الأربعة', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b1c3'] },
    { name: 'Slav Defense', nameAr: 'دفاع السلاف', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3'] },
    { name: 'Semi-Slav Defense', nameAr: 'دفاع شبه السلاف', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3'] },
    { name: 'Benoni Defense', nameAr: 'دفاع بينوني', moves: ['d2d4', 'g8f6', 'c2c4', 'c7c5', 'd4d5'] },
    { name: 'Benko Gambit', nameAr: 'مناورة بينكو', moves: ['d2d4', 'g8f6', 'c2c4', 'c7c5', 'd4d5'] },
    { name: 'Torre Attack', nameAr: 'هجوم توري', moves: ['d2d4', 'g8f6', 'g1f3', 'e7e6', 'c1g5'] },
    { name: 'Colle System', nameAr: 'نظام كول', moves: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'e2e3'] },
    { name: 'Trompowsky Attack', nameAr: 'هجوم ترومبوفسكي', moves: ['d2d4', 'g8f6', 'c1g5', 'e7e6', 'e2e4'] },
    { name: 'Bird Opening', nameAr: 'افتتاح بيرد', moves: ['f2f4', 'd7d5', 'g1f3', 'g8f6', 'e2e3'] },
    { name: "King's Gambit", nameAr: 'مناورة الملك', moves: ['e2e4', 'e7e5', 'f2f4', 'e5f4', 'g1f3'] },
    { name: 'Evans Gambit', nameAr: 'مناورة إيفانز', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
    { name: 'Smith-Morra Gambit', nameAr: 'مناورة سميث-مورا', moves: ['e2e4', 'c7c5', 'd2d4', 'c5d4', 'c2c3'] },
    { name: 'Alapin Variation', nameAr: 'تفريعة ألابين', moves: ['e2e4', 'c7c5', 'c2c3', 'g8f6', 'e4e5'] },
    { name: 'Closed Sicilian', nameAr: 'الصقلي المغلق', moves: ['e2e4', 'c7c5', 'b1c3', 'b8c6', 'g2g3'] },
    { name: 'Caro-Kann Advance', nameAr: 'كارو-كان المتقدم', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4e5'] },
    { name: 'French Winawer', nameAr: 'الفرنسي ويناوير', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3'] },
    { name: 'French Tarrasch', nameAr: 'الفرنسي تاراش', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1d2'] },
    { name: 'French Exchange', nameAr: 'الفرنسي بالتبادل', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5'] },
    { name: 'Two Knights Defense', nameAr: 'دفاع الفرسان', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
    { name: 'Philidor Defense', nameAr: 'دفاع فيليدور', moves: ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'd2d4'] },
    { name: 'Budapest Gambit', nameAr: 'مناورة بودابست', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e5', 'd4e5'] },
    { name: 'Albin Countergambit', nameAr: 'مناورة ألبين', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e5', 'd4e5'] },
    { name: 'Chigorin Defense', nameAr: 'دفاع تشيغورين', moves: ['d2d4', 'd7d5', 'c2c4', 'b8c6', 'b1c3'] },
    { name: 'Baltic Defense', nameAr: 'دفاع البلطيق', moves: ['d2d4', 'd7d5', 'c2c4', 'c8f5', 'b1c3'] },
    { name: 'King Fianchetto Opening', nameAr: 'افتتاح الفيانكيتو', moves: ['g2g3', 'd7d5', 'f1g2', 'g8f6', 'g1f3'] },
    { name: 'Nimzowitsch-Larsen', nameAr: 'نيمزوفيتش-لارسن', moves: ['b2b3', 'd7d5', 'c1b2', 'g8f6', 'e2e3'] },
    { name: 'Kings Indian Attack', nameAr: 'الهجوم الهندي الملكي', moves: ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2'] },
    { name: 'Barcza Opening', nameAr: 'افتتاح بارتسا', moves: ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2'] }
];

var SEARCH_TIMEOUT = 14000;
var MAX_EVAL_LOSS = 40;
var MATE_SCORE = 100000;
var DEBUG = false;

function log(tag, msg) {
    if (DEBUG && typeof console !== 'undefined') {
        console.log('[DrDer][' + tag + '] ' + msg);
    }
}

// ============================================
// نظام الصوت
// ============================================

function playSound(soundName) {
    if (!state.soundEnabled) return;
    try {
        var soundFile = state.audioFiles[soundName];
        if (!soundFile) return;
        var audio = new Audio(soundFile);
        audio.volume = 0.7;
        audio.play().catch(function() {});
    } catch(e) {}
}

function playMoveSound() { playSound('move'); }
function playCaptureSound() { playSound('capture'); }
function playCheckSound() { playSound('check'); }
function playCheckmateSound() { playSound('checkmate'); }
function playPromotionSound() { playSound('promote'); }

// ============================================
// التهيئة
// ============================================

function initEmptyBoard() {
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    state.capturedByWhite = [];
    state.capturedByBlack = [];
    state.recentMoves = [];
    drawBoard();
    updateCapturedDisplay();
    updateOpeningDisplay();
}

document.addEventListener('DOMContentLoaded', function() {
    initEmptyBoard();
    
    var soundBtn = document.getElementById('toggleSound');
    if (soundBtn) {
        soundBtn.addEventListener('click', function() {
            state.soundEnabled = !state.soundEnabled;
            this.textContent = state.soundEnabled ? '🔊' : '🔇';
        });
    }
    
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
            state.lastMove = move;
            
            // تتبع آخر 20 حركة لمنع التكرار
            state.recentMoves.push(move.san);
            if (state.recentMoves.length > 20) state.recentMoves.shift();
            
            if (move.flags && move.flags.indexOf('p') !== -1) {
                playPromotionSound();
            } else if (move.captured) {
                playCaptureSound();
            } else if (move.san && move.san.indexOf('+') !== -1) {
                playCheckSound();
            } else {
                playMoveSound();
            }
            
            if (move.captured) {
                if (move.color === 'w') {
                    state.capturedByWhite.push(move.captured);
                } else {
                    state.capturedByBlack.push(move.captured);
                }
            }
            state.currentTurn = state.currentGame.turn();
            drawBoard();
            highlightMove(move);
            updateCapturedDisplay();
            if (state.currentGame.game_over()) {
                playCheckmateSound();
                endMatch();
            }
            else { scheduleNextMove(); }
        } else { scheduleNextMove(); }
    } catch(e) { scheduleNextMove(); }
}

// ============================================
// إبراز الحركة بصرياً
// ============================================

function highlightMove(move) {
    var from = move.from;
    var to = move.to;
    
    // إزالة التظليل القديم
    var oldHighlights = document.querySelectorAll('.move-highlight');
    for (var i = 0; i < oldHighlights.length; i++) {
        oldHighlights[i].classList.remove('move-highlight');
    }
    
    // تظليل مربع البداية والنهاية
    var squares = document.querySelectorAll('.square');
    for (var j = 0; j < squares.length; j++) {
        var sq = squares[j];
        var sqId = sq.getAttribute('data-square');
        if (sqId === from || sqId === to) {
            sq.classList.add('move-highlight');
        }
    }
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
        
        // منع تكرار نفس الحركة إذا كانت في recentMoves
        if (state.recentMoves.indexOf(mo.san) !== -1) {
            continue;
        }
        
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
        var pb;
        if (playerName === 'alpha') {
            pb = evalAlphaEnhanced(cand, game);
        } else {
            pb = evalBetaEnhanced(cand, game);
        }
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
    var quality = 1000 - (loss * 8);
    return Math.max(0, quality);
}

function evalAlphaEnhanced(cand, game) {
    var bonus = 0;
    var p = personalities.alpha;
    if (cand.isCheck) bonus += 15;
    if (cand.captured) bonus += 10;
    if (cand.captured && cand.piece === 'p' && (cand.captured === 'n' || cand.captured === 'b')) bonus += 8;
    if (cand.piece === 'q' || cand.piece === 'r') bonus += 5;

    try {
        var move = game.move(cand.move, { sloppy: true });
        if (move) {
            var board = game.board();
            var turn = game.turn();
            var oppColor = turn;
            var myColor = turn === 'w' ? 'b' : 'w';
            var oppKing = findKing(board, oppColor);
            if (oppKing && countAttackers(game, oppKing, myColor) >= 2) bonus += 10;
            game.undo();
        }
    } catch(e) {}

    if (!cand.captured && !cand.isCheck && cand.piece === 'p' && parseInt(cand.to.charAt(1)) <= 3) bonus -= 5;
    if (cand.isMate && cand.mateIn > 0) bonus += 500;

    return bonus;
}

function evalBetaEnhanced(cand, game) {
    var bonus = 0;
    var p = personalities.beta;
    if (cand.isCastle) bonus += 15;
    if ((cand.piece === 'n' || cand.piece === 'b') && !cand.captured) bonus += 8;
    if (cand.piece === 'p' && !cand.captured) bonus += 3;

    try {
        var move = game.move(cand.move, { sloppy: true });
        if (move) {
            var board = game.board();
            var turn = game.turn();
            var myColor = turn;
            var oppColor = turn === 'w' ? 'b' : 'w';
            var myKing = findKing(board, myColor);
            if (myKing && countAttackers(game, myKing, oppColor) === 0) bonus += 8;
            game.undo();
        }
    } catch(e) {}

    if (cand.captured && cand.piece !== 'p' && cand.captured === 'p') bonus -= 10;
    if (cand.isCheck && !cand.captured) bonus -= 4;
    if (cand.isMate && cand.mateIn > 0) bonus += 500;

    return bonus;
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

function simulateMove(moveStr, game) {
    try {
        var move = game.move(moveStr, { sloppy: true });
        if (move) { game.undo(); return move; }
    } catch(e) {}
    return null;
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

    if (state.openingIndex < state.openingMoves.length) {
        var openingMove = state.openingMoves[state.openingIndex];
        state.openingIndex++;
        try {
            var move = state.currentGame.move(openingMove, { sloppy: true });
            if (move) {
                state.gameHistory.push(move);
                state.lastMove = move;
                state.recentMoves.push(move.san);
                if (state.recentMoves.length > 20) state.recentMoves.shift();
                
                if (move.flags && move.flags.indexOf('p') !== -1) {
                    playPromotionSound();
                } else if (move.captured) {
                    playCaptureSound();
                } else {
                    playMoveSound();
                }
                
                if (move.captured) {
                    if (move.color === 'w') {
                        state.capturedByWhite.push(move.captured);
                    } else {
                        state.capturedByBlack.push(move.captured);
                    }
                }
                state.currentTurn = state.currentGame.turn();
                drawBoard();
                highlightMove(move);
                updateCapturedDisplay();
            }
        } catch(e) {}
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
    worker.postMessage('go depth ' + personalities[playerName].depth + ' movetime ' + personalities[playerName].movetime);

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
    state.recentMoves = [];
    state.lastMove = null;
    state.matchCount++;

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

function selectOpening() {
    var available = [];
    for (var i = 0; i < OPENINGS.length; i++) {
        if (state.usedOpenings.indexOf(i) === -1) {
            available.push(i);
        }
    }
    
    if (available.length === 0) {
        state.usedOpenings = [];
        for (var j = 0; j < OPENINGS.length; j++) {
            available.push(j);
        }
    }
    
    var idx = available[Math.floor(Math.random() * available.length)];
    state.usedOpenings.push(idx);
    return OPENINGS[idx];
}

function startMatch() {
    state.isMatchRunning = true;
    state.openingIndex = 0;
    var opening = selectOpening();
    state.openingMoves = opening.moves;
    state.currentOpeningName = opening.name;
    state.currentOpeningNameAr = opening.nameAr;
    drawBoard();
    updateCapturedDisplay();
    updateOpeningDisplay();
    scheduleNextMove();
}

function updateOpeningDisplay() {
    var el = document.getElementById('openingName');
    if (el) {
        el.textContent = 'افتتاحية هذه المباراة: ' + state.currentOpeningNameAr + ' (' + state.currentOpeningName + ')';
    }
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
// رسم الرقعة
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
    var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var sq = document.createElement('div');
            var squareId = files[c] + (8 - r);
            sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            sq.setAttribute('data-square', squareId);
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
    var whiteEl = document.getElementById('whiteCaptured');
    var blackEl = document.getElementById('blackCaptured');
    
    if (whiteEl) {
        var whitePieces = [];
        for (var i = 0; i < state.capturedByWhite.length; i++) {
            whitePieces.push(PIECE_UNICODE[state.capturedByWhite[i]] || state.capturedByWhite[i]);
        }
        whiteEl.textContent = whitePieces.join(' ');
    }
    if (blackEl) {
        var blackPieces = [];
        for (var j = 0; j < state.capturedByBlack.length; j++) {
            blackPieces.push(PIECE_UNICODE[state.capturedByBlack[j]] || state.capturedByBlack[j]);
        }
        blackEl.textContent = blackPieces.join(' ');
    }
}

window.drderChess = { state: state };
