/* ============================================
   DrDer Chess - Local AI vs AI Display
   GitHub Pages Compatible Version
   ============================================ */

var personalities = {
    alpha: {
        name: 'ALPHA', type: 'TACTICAL AI',
        aggression: 0.95, kingAttack: 0.98, tacticalRisk: 0.85, sacrifice: 0.80,
        pieceActivity: 0.95, defense: 0.40, endgame: 0.60, drawAvoidance: 0.98,
        depth: 22, movetime: 3000, multiPV: 4, threshold: 65
    },
    beta: {
        name: 'BETA', type: 'STRATEGIC AI',
        aggression: 0.55, kingAttack: 0.60, tacticalRisk: 0.40, sacrifice: 0.20,
        pieceActivity: 0.75, defense: 0.98, endgame: 0.98, drawAvoidance: 0.75,
        depth: 20, movetime: 3000, multiPV: 4, threshold: 30
    }
};

var MAX_WORKER_RESTARTS = 5;
var SEARCH_WATCHDOG_MARGIN = 3000;
var MOVE_DELAY_MS = 200;
var WORKER_RESTART_DELAY_MS = 1000;
var WORKER_READY_POLL_MS = 500;
var MATCH_TRANSITION_DELAY_MS = 500;
var MAX_PERSONALITY_BONUS = 20;
var MAX_HISTORY_LENGTH = 200;
var DEBUG = false;

var ENGINE_PATHS = {
    alpha: './stockfish.alpha.js',
    beta: './stockfish.beta.js'
};

var state = {
    currentGame: null,
    gameHistory: [],
    alphaColor: 'w',
    betaColor: 'b',
    currentTurn: 'w',
    isMatchRunning: false,
    isMatchEnding: false,
    matchGeneration: 0,
    workers: {
        alpha: { instance: null, status: 'idle', url: null, restartCount: 0, generation: 0, recovering: false, searchSeq: 0 },
        beta: { instance: null, status: 'idle', url: null, restartCount: 0, generation: 0, recovering: false, searchSeq: 0 }
    },
    pendingSearch: null,
    searchActive: false,
    isTransitioning: false,
    nextMoveTimer: null,
    matchTransitionTimer: null,
    workerRestartTimer: null,
    searchWatchdogTimer: null,
    boardCache: null,
    colorSwap: false,
    workersReadyCount: 0,
    totalMatches: 0,
    isFinalFailure: false
};

function debugLog(tag, msg) {
    if (!DEBUG || typeof console === 'undefined') return;
    console.log('[DrDer][' + tag + '] ' + msg);
}

function initEmptyBoard() {
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    drawBoard();
}

document.addEventListener('DOMContentLoaded', function() {
    initEmptyBoard();
    fullCleanup();
    initializeWorkers();
});

function fullCleanup() {
    invalidateCurrentSearch();
    cancelAllTimers();
    state.isMatchRunning = false;
    state.isMatchEnding = false;
    state.isTransitioning = false;
    state.searchActive = false;
    state.matchGeneration = (state.matchGeneration || 0) + 1;
    state.workersReadyCount = 0;
    state.isFinalFailure = false;
    state.boardCache = null;
}

function cancelAllTimers() {
    if (state.nextMoveTimer !== null) { clearTimeout(state.nextMoveTimer); state.nextMoveTimer = null; }
    if (state.matchTransitionTimer !== null) { clearTimeout(state.matchTransitionTimer); state.matchTransitionTimer = null; }
    if (state.workerRestartTimer !== null) { clearTimeout(state.workerRestartTimer); state.workerRestartTimer = null; }
    if (state.searchWatchdogTimer !== null) { clearTimeout(state.searchWatchdogTimer); state.searchWatchdogTimer = null; }
}

function scheduleNextMove(delay) {
    if (state.nextMoveTimer !== null) { clearTimeout(state.nextMoveTimer); state.nextMoveTimer = null; }
    if (!state.isMatchRunning || state.isMatchEnding || state.isTransitioning) return;
    state.nextMoveTimer = setTimeout(function() { state.nextMoveTimer = null; makeNextMove(); }, delay);
}

function startSearchWatchdog(search, movetime, matchGen, workerGen) {
    if (state.searchWatchdogTimer !== null) { clearTimeout(state.searchWatchdogTimer); state.searchWatchdogTimer = null; }
    if (!search || !search.id || !search.active) return;
    var timeoutMs = movetime + SEARCH_WATCHDOG_MARGIN;
    var searchId = search.id;
    state.searchWatchdogTimer = setTimeout(function() {
        state.searchWatchdogTimer = null;
        if (state.matchGeneration !== matchGen) return;
        var cs = state.pendingSearch;
        if (!cs || cs.id !== searchId || !cs.active || cs.completed || cs.moveApplied) return;
        if (state.workers[search.player] && state.workers[search.player].generation !== workerGen) return;
        handleSearchTimeout(cs, matchGen);
    }, timeoutMs);
}

function handleSearchTimeout(search, matchGen) {
    if (!search || !search.active || search.completed || search.moveApplied) return;
    if (state.matchGeneration !== matchGen) return;
    var pn = search.player;
    var sid = search.id;
    var w = state.workers[pn];
    if (w && w.instance) { try { w.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    setTimeout(function() {
        if (state.matchGeneration !== matchGen) return;
        var cs = state.pendingSearch;
        if (!cs || cs.id !== sid) return;
        if (cs.completed || cs.moveApplied) return;
        completeSearch(cs);
        invalidateCurrentSearch();
        if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) {
            handleWorkerError(pn, state.workers[pn] ? state.workers[pn].generation : 0);
        }
    }, 500);
}

function getEnginePath(playerName) { return ENGINE_PATHS[playerName] || './stockfish.alpha.js'; }

function initializeWorkers() {
    invalidateCurrentSearch();
    cancelAllTimers();
    terminateWorker('alpha'); terminateWorker('beta');
    state.workersReadyCount = 0;
    state.isFinalFailure = false;
    state.workers.alpha = createWorker('alpha');
    state.workers.beta = createWorker('beta');
}

function terminateWorker(playerName) {
    var w = state.workers[playerName];
    if (!w) return;
    if (w.instance) { try { w.instance.postMessage({ type: 'quit' }); } catch(e) {} w.instance.terminate(); }
    if (w.url) { try { URL.revokeObjectURL(w.url); } catch(e) {} }
    state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: (w.generation || 0) + 1, recovering: false, searchSeq: (w.searchSeq || 0) + 1 };
}

function createWorker(playerName) {
    var w = state.workers[playerName];
    var gen = w.generation;
    var enginePath = getEnginePath(playerName);

    var wc = 'var sf=null,workerGen=' + gen + ',ready=false,it=null,activeSearchSeq=null;\n';
    wc += 'function ci(){if(it){clearTimeout(it);it=null;}}\n';
    wc += 'function send(d){self.postMessage({type:"engine",data:d,generation:workerGen});}\n';
    wc += 'try{importScripts(' + JSON.stringify(enginePath) + ');\n';
    wc += 'var EC=typeof Stockfish==="function"?Stockfish:(typeof STOCKFISH==="function"?STOCKFISH:null);\n';
    wc += 'if(EC)sf=EC();else if(typeof Stockfish==="object"&&Stockfish&&Stockfish.postMessage)sf=Stockfish;\n';
    wc += 'else if(typeof STOCKFISH==="object"&&STOCKFISH&&STOCKFISH.postMessage)sf=STOCKFISH;\n';
    wc += 'if(sf&&sf.postMessage){sf.onmessage=function(m){var d=typeof m==="string"?m:(m&&m.data?m.data:"");\n';
    wc += 'if(typeof d==="string"&&d){if(!ready){if(d.indexOf("readyok")!==-1){ready=true;ci();send("readyok");}return;}\n';
    wc += 'if(d.indexOf("bestmove")===0&&activeSearchSeq!==null){var s=activeSearchSeq;activeSearchSeq=null;send(d+" seq:"+s);}\n';
    wc += 'else if(activeSearchSeq!==null){send(d);}}};\n';
    wc += 'self.onmessage=function(e){var c=e.data;\n';
    wc += 'if(c.type==="init"){sf.postMessage("uci");sf.postMessage("setoption name MultiPV value "+c.multiPV);sf.postMessage("isready");\n';
    wc += 'it=setTimeout(function(){if(!ready){ci();send("error:init timeout");}},15000);}\n';
    wc += 'else if(c.type==="search"&&ready){activeSearchSeq=c.searchSeq;sf.postMessage("position fen "+c.fen);sf.postMessage("go depth "+c.depth+" movetime "+c.movetime);}\n';
    wc += 'else if(c.type==="stop"){activeSearchSeq=null;sf.postMessage("stop");}\n';
    wc += 'else if(c.type==="quit"){activeSearchSeq=null;ci();sf.postMessage("quit");}};\n';
    wc += '}else{send("error:engine init failed");}\n';
    wc += '}catch(err){self.postMessage({type:"error",data:err.message,generation:workerGen});}\n';

    var blob, url, instance;
    try { blob = new Blob([wc], { type: 'application/javascript' }); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: (w.restartCount||0), generation: gen+1, recovering: false, searchSeq: (w.searchSeq||0)+1 };
        handleWorkerError(playerName, gen+1);
        return state.workers[playerName];
    }
    try { url = URL.createObjectURL(blob); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: (w.restartCount||0), generation: gen+1, recovering: false, searchSeq: (w.searchSeq||0)+1 };
        handleWorkerError(playerName, gen+1);
        return state.workers[playerName];
    }
    try { instance = new Worker(url); } catch(e) {
        try { URL.revokeObjectURL(url); } catch(e2) {}
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: (w.restartCount||0), generation: gen+1, recovering: false, searchSeq: (w.searchSeq||0)+1 };
        handleWorkerError(playerName, gen+1);
        return state.workers[playerName];
    }

    state.workers[playerName] = { instance: instance, status: 'initializing', url: url, restartCount: w.restartCount||0, generation: gen, recovering: false, searchSeq: w.searchSeq||0 };

    instance.onmessage = function(e) {
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data.generation !== undefined && e.data.generation !== gen) return;
        if (e.data.type === 'engine') handleEngineMessage(playerName, e.data.data, gen);
        else if (e.data.type === 'error') { handleWorkerError(playerName, gen); }
    };
    instance.onerror = function() { handleWorkerError(playerName, gen); };
    instance.postMessage({ type: 'init', multiPV: personalities[playerName].multiPV });
    return state.workers[playerName];
}

function handleWorkerError(playerName, workerGeneration) {
    var w = state.workers[playerName];
    if (!w) return;
    if (workerGeneration !== undefined && w.generation !== workerGeneration) return;
    if (state.isMatchEnding || state.isTransitioning) return;
    if (w.recovering) return;
    
    w.restartCount = (w.restartCount || 0) + 1;
    
    var alphaMaxed = state.workers.alpha.restartCount > MAX_WORKER_RESTARTS;
    var betaMaxed = state.workers.beta.restartCount > MAX_WORKER_RESTARTS;
    
    if (alphaMaxed && betaMaxed) {
        if (!state.isFinalFailure) {
            state.isFinalFailure = true;
            var el = document.getElementById('whitePlayer');
            if (el) { el.textContent = 'Error'; el.style.color = '#ff4444'; }
            el = document.getElementById('blackPlayer');
            if (el) { el.textContent = 'Error'; el.style.color = '#ff4444'; }
        }
        return;
    }
    
    if (w.restartCount > MAX_WORKER_RESTARTS) {
        var playerEl = document.getElementById(playerName === 'alpha' ? (state.alphaColor === 'w' ? 'whitePlayer' : 'blackPlayer') : (state.betaColor === 'w' ? 'whitePlayer' : 'blackPlayer'));
        if (playerEl) { playerEl.textContent = 'Error'; playerEl.style.color = '#ff4444'; }
        if (state.isMatchRunning && !state.isMatchEnding) { makeNextMove(); }
        return;
    }
    
    w.recovering = true;
    invalidateCurrentSearch();
    cancelAllTimers();
    terminateWorker(playerName);
    state.workers[playerName].restartCount = w.restartCount;
    state.workers[playerName].recovering = true;
    createWorker(playerName);
    
    if (!state.isMatchEnding && !state.isFinalFailure) {
        state.workerRestartTimer = setTimeout(function() {
            state.workerRestartTimer = null;
            if (state.workers[playerName]) state.workers[playerName].recovering = false;
            makeNextMove();
        }, WORKER_RESTART_DELAY_MS);
    } else { if (state.workers[playerName]) state.workers[playerName].recovering = false; }
}

function invalidateCurrentSearch() {
    if (state.searchWatchdogTimer !== null) { clearTimeout(state.searchWatchdogTimer); state.searchWatchdogTimer = null; }
    if (state.pendingSearch) { state.pendingSearch.active = false; state.pendingSearch.completed = true; state.pendingSearch = null; }
    state.searchActive = false;
}

function createSearch(playerName, fen) {
    if (state.searchActive) return null;
    invalidateCurrentSearch();
    var w = state.workers[playerName];
    if (!w || w.status !== 'ready') return null;
    w.searchSeq = (w.searchSeq || 0) + 1;
    var s = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        player: playerName, fen: fen,
        candidates: [], bestCandidate: null,
        active: true, completed: false, moveApplied: false,
        matchGeneration: state.matchGeneration,
        workerGeneration: w.generation,
        searchSeq: w.searchSeq
    };
    state.pendingSearch = s;
    state.searchActive = true;
    startSearchWatchdog(s, personalities[playerName].movetime, state.matchGeneration, w.generation);
    return s;
}

function isValidSearchForMove(search, playerName) {
    if (!search) return false;
    if (search.matchGeneration !== state.matchGeneration) return false;
    if (search.player !== playerName) return false;
    if (!search.completed) return false;
    if (search.moveApplied) return false;
    if (!state.isMatchRunning || state.isMatchEnding) return false;
    if (state.isTransitioning) return false;
    if (!state.currentGame) return false;
    if (state.currentTurn !== (playerName === 'alpha' ? state.alphaColor : state.betaColor)) return false;
    var cf = state.currentGame.fen().split(' '), sf = search.fen.split(' ');
    if (cf[0] !== sf[0] || cf[1] !== sf[1] || cf[2] !== sf[2] || cf[3] !== sf[3]) return false;
    return true;
}

function completeSearch(search) {
    if (!search) return;
    if (state.searchWatchdogTimer !== null) { clearTimeout(state.searchWatchdogTimer); state.searchWatchdogTimer = null; }
    search.active = false; search.completed = true; state.searchActive = false;
}

function handleEngineMessage(playerName, msg, workerGeneration) {
    var msgStr = null;
    if (typeof msg === 'string') msgStr = msg;
    else if (msg && typeof msg === 'object') {
        if (typeof msg.data === 'string') msgStr = msg.data;
        else { try { msgStr = String(msg); } catch(e) {} }
    }
    if (!msgStr) return;
    var w = state.workers[playerName];
    if (!w || w.generation !== workerGeneration) return;

    if (msgStr === 'readyok' || msgStr.indexOf('readyok') !== -1) {
        w.status = 'ready';
        state.workersReadyCount++;
        if (state.workersReadyCount >= 2 && !state.isMatchRunning && !state.isTransitioning) { startMatch(); }
        return;
    }

    if (msgStr.indexOf('error:') === 0) { handleWorkerError(playerName, workerGeneration); return; }

    var msgSearchSeq = null;
    if (msgStr.indexOf(' seq:') !== -1) {
        var seqIdx = msgStr.indexOf(' seq:');
        msgSearchSeq = parseInt(msgStr.substring(seqIdx + 5));
        msgStr = msgStr.substring(0, seqIdx);
    }
    var search = state.pendingSearch;
    if (!search || search.matchGeneration !== state.matchGeneration || search.player !== playerName || search.workerGeneration !== workerGeneration || !search.active || search.completed) return;
    if (msgStr.indexOf('bestmove') === 0 && msgSearchSeq !== null && search.searchSeq !== msgSearchSeq) return;
    if (msgStr.indexOf('multipv') !== -1) handleInfoMessage(search, msgStr);
    if (msgStr.indexOf('bestmove') === 0) handleBestmoveMessage(search, msgStr, playerName);
}

function handleInfoMessage(search, msg) {
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
    else if (mtI !== -1) { mateIn = parseInt(parts[mtI + 1]); if (isNaN(mateIn)) mateIn = 0; score = mateIn > 0 ? 100000 - mateIn : -100000 - mateIn; isMate = true; }
    if (!search.candidates) search.candidates = [];
    var ex = search.candidates[rank - 1];
    if (!ex || depth >= (ex.depth || 0)) {
        search.candidates[rank - 1] = { move: move, score: score, rank: rank, isMate: isMate, mateIn: mateIn, depth: depth };
    }
    if (rank === 1) search.bestCandidate = search.candidates[0];
}

function handleBestmoveMessage(search, msg, playerName) {
    if (search.completed || search.moveApplied) return;
    if (!state.isMatchRunning || state.isMatchEnding) return;
    if (search.matchGeneration !== state.matchGeneration) return;
    var parts = msg.split(' ');
    var bestMove = parts[1];
    if (!bestMove || bestMove === '(none)') {
        completeSearch(search); invalidateCurrentSearch();
        if (state.currentGame && isGameFinished()) { endMatch(); }
        else if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) {
            handleWorkerError(playerName, state.workers[playerName] ? state.workers[playerName].generation : 0);
        }
        return;
    }
    completeSearch(search);
    var cf = state.currentGame ? state.currentGame.fen().split(' ') : [];
    var sf = search.fen.split(' ');
    if (cf[0] !== sf[0] || cf[1] !== sf[1] || cf[2] !== sf[2] || cf[3] !== sf[3]) {
        invalidateCurrentSearch();
        if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) makeNextMove();
        return;
    }
    if (!simulateMove(bestMove)) {
        invalidateCurrentSearch();
        if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) {
            handleWorkerError(playerName, state.workers[playerName] ? state.workers[playerName].generation : 0);
        }
        return;
    }
    var chosen = playerName === 'alpha' ? selectAlphaMove(search, bestMove) : selectBetaMove(search, bestMove);
    if (!chosen || !simulateMove(chosen)) chosen = bestMove;
    executeMove(playerName, chosen);
}

function isGameFinished() { return state.currentGame ? state.currentGame.game_over() : false; }

function getBestCandidateFromSearch(search) {
    if (!search.candidates) return null;
    for (var i = 0; i < search.candidates.length; i++) { if (search.candidates[i] && search.candidates[i].rank === 1) return search.candidates[i]; }
    for (var j = 0; j < search.candidates.length; j++) { if (search.candidates[j] && search.candidates[j].move) return search.candidates[j]; }
    return null;
}

function getValidCandidates(candidates) {
    var v = [];
    for (var i = 0; i < candidates.length; i++) { if (candidates[i] && candidates[i].move) v.push(candidates[i]); }
    v.sort(function(a, b) { return a.rank - b.rank; });
    return v;
}

function selectAlphaMove(search, bestMove) {
    var valid = getValidCandidates(search.candidates);
    if (valid.length === 0) return bestMove;
    if (valid.length === 1) return valid[0].move;
    var best = getBestCandidateFromSearch(search);
    if (!best) return bestMove || valid[0].move;
    if (best.isMate && best.mateIn > 0 && best.mateIn <= 5) return best.move;
    var p = personalities.alpha, phase = getGamePhase();
    var scored = [];
    for (var j = 0; j < valid.length; j++) {
        var c = valid[j];
        if (!c.isMate && c.score < best.score - p.threshold) continue;
        if (c.isMate && c.mateIn > 0 && c.mateIn <= 5) { scored.push({ move: c.move, final: c.score + 5000 }); continue; }
        var bonus = c.score;
        var sim = simulateMove(c.move);
        if (!sim) continue;
        if (sim.san.indexOf('+') !== -1) bonus += Math.round(8 * p.aggression);
        if (sim.captured) bonus += Math.round(6 * p.aggression);
        if (sim.captured && sim.piece !== 'p' && sim.captured !== 'p') bonus += Math.round(4 * p.tacticalRisk);
        if (phase === 'middlegame' && (sim.piece === 'q' || sim.piece === 'r')) bonus += Math.round(4 * p.pieceActivity);
        if (c.isMate && c.mateIn > 0) bonus += Math.min(200, (10 - c.mateIn) * 20);
        var delta = bonus - c.score;
        if (Math.abs(delta) > MAX_PERSONALITY_BONUS) bonus = c.score + (delta > 0 ? MAX_PERSONALITY_BONUS : -MAX_PERSONALITY_BONUS);
        scored.push({ move: c.move, final: bonus });
    }
    scored.sort(function(a, b) { return b.final - a.final; });
    return (scored.length > 0 && scored[0].final !== -Infinity) ? scored[0].move : best.move;
}

function selectBetaMove(search, bestMove) {
    var valid = getValidCandidates(search.candidates);
    if (valid.length === 0) return bestMove;
    if (valid.length === 1) return valid[0].move;
    var best = getBestCandidateFromSearch(search);
    if (!best) return bestMove || valid[0].move;
    if (best.isMate && best.mateIn > 0 && best.mateIn <= 5) return best.move;
    var p = personalities.beta, phase = getGamePhase();
    var scored = [];
    for (var j = 0; j < valid.length; j++) {
        var c = valid[j];
        if (!c.isMate && c.score < best.score - p.threshold) continue;
        if (c.isMate && c.mateIn > 0 && c.mateIn <= 5) { scored.push({ move: c.move, final: c.score + 5000 }); continue; }
        var bonus = c.score;
        var sim = simulateMove(c.move);
        if (!sim) continue;
        if (sim.san.indexOf('O-O') !== -1) bonus += Math.round(8 * p.defense);
        if ((sim.piece === 'n' || sim.piece === 'b') && phase === 'opening') bonus += Math.round(4 * p.pieceActivity);
        if (phase === 'endgame' && sim.captured) bonus += Math.round(5 * p.endgame);
        if (p.tacticalRisk < 0.5 && sim.san.indexOf('+') !== -1 && !sim.captured) bonus -= Math.round(4 * (1 - p.tacticalRisk));
        if (p.sacrifice < 0.3 && sim.captured && sim.piece !== 'p' && sim.captured === 'p') bonus -= Math.round(3 * (1 - p.sacrifice));
        var delta = bonus - c.score;
        if (Math.abs(delta) > MAX_PERSONALITY_BONUS) bonus = c.score + (delta > 0 ? MAX_PERSONALITY_BONUS : -MAX_PERSONALITY_BONUS);
        scored.push({ move: c.move, final: bonus });
    }
    scored.sort(function(a, b) { return b.final - a.final; });
    return (scored.length > 0 && scored[0].final !== -Infinity) ? scored[0].move : best.move;
}

function simulateMove(moveStr) {
    if (!state.currentGame) return null;
    var move = null, applied = false;
    try {
        move = state.currentGame.move(moveStr, { sloppy: true });
        if (move) { applied = true; return move; }
        return null;
    } catch(e) { return null; }
    finally { if (applied && state.currentGame) { try { state.currentGame.undo(); } catch(e) {} } }
}

function getGamePhase() {
    if (!state.currentGame) return 'middlegame';
    var b = state.currentGame.board(), t = 0;
    for (var ri = 0; ri < 8; ri++) { for (var ci = 0; ci < 8; ci++) { if (b[ri][ci]) t++; } }
    var mv = state.gameHistory.length;
    if (mv <= 12 && t >= 28) return 'opening';
    if (t <= 12) return 'endgame';
    return 'middlegame';
}

function executeMove(playerName, moveStr) {
    var search = state.pendingSearch;
    if (!isValidSearchForMove(search, playerName)) return;
    if (!moveStr || typeof moveStr !== 'string') { invalidateCurrentSearch(); makeNextMove(); return; }
    if (search.moveApplied) return;
    search.moveApplied = true;
    var move;
    try { move = state.currentGame.move(moveStr, { sloppy: true }); } catch(e) { move = null; }
    if (!move) { search.moveApplied = false; invalidateCurrentSearch(); makeNextMove(); return; }
    state.gameHistory.push(move);
    if (state.gameHistory.length > MAX_HISTORY_LENGTH) { state.gameHistory = state.gameHistory.slice(-MAX_HISTORY_LENGTH); }
    state.currentTurn = state.currentGame.turn();
    invalidateCurrentSearch();
    drawBoard();
    if (isGameFinished()) { endMatch(); return; }
    scheduleNextMove(MOVE_DELAY_MS);
}

function startMatch() {
    if (state.isTransitioning || state.isFinalFailure) return;
    invalidateCurrentSearch(); cancelAllTimers();
    state.isMatchRunning = true; state.isMatchEnding = false; state.matchGeneration++;
    state.currentGame = new Chess(); state.gameHistory = []; state.currentTurn = 'w'; state.isTransitioning = false;
    state.boardCache = null;
    state.colorSwap = !state.colorSwap;
    state.alphaColor = state.colorSwap ? 'b' : 'w';
    state.betaColor = state.colorSwap ? 'w' : 'b';
    state.totalMatches++;
    updatePlayerDisplay();
    drawBoard();
    makeNextMove();
}

function updatePlayerDisplay() {
    var wEl = document.getElementById('whitePlayer');
    var bEl = document.getElementById('blackPlayer');
    if (wEl) { wEl.textContent = state.alphaColor === 'w' ? 'Alpha' : 'Beta'; wEl.style.color = '#cccccc'; }
    if (bEl) { bEl.textContent = state.alphaColor === 'w' ? 'Beta' : 'Alpha'; bEl.style.color = '#cccccc'; }
}

function makeNextMove() {
    if (!state.isMatchRunning || state.isMatchEnding || state.isTransitioning || !state.currentGame) return;
    if (state.searchActive) return;
    if (isGameFinished()) { endMatch(); return; }
    var pn = state.currentTurn === state.alphaColor ? 'alpha' : 'beta';
    var w = state.workers[pn];
    if (!w || w.status !== 'ready') {
        if (w && w.status === 'initializing' && !w.recovering) { scheduleNextMove(WORKER_READY_POLL_MS); }
        else if (!w || w.status === 'idle') { handleWorkerError(pn, w ? w.generation : 0); }
        return;
    }
    var fen = state.currentGame.fen();
    var search = createSearch(pn, fen);
    if (!search) return;
    if (w.instance) {
        try { w.instance.postMessage({ type: 'search', fen: fen, depth: personalities[pn].depth, movetime: personalities[pn].movetime, searchSeq: search.searchSeq }); }
        catch(e) { invalidateCurrentSearch(); handleWorkerError(pn, w.generation); }
    }
}

function endMatch() {
    if (!state.isMatchRunning || state.isMatchEnding) return;
    state.isMatchEnding = true; state.isMatchRunning = false; state.isTransitioning = true;
    invalidateCurrentSearch(); cancelAllTimers();
    if (state.workers.alpha.instance) { try { state.workers.alpha.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    if (state.workers.beta.instance) { try { state.workers.beta.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    state.matchTransitionTimer = setTimeout(function() {
        state.matchTransitionTimer = null;
        state.isTransitioning = false;
        state.isMatchEnding = false;
        startMatch();
    }, MATCH_TRANSITION_DELAY_MS);
}

function drawBoard() {
    if (!state.currentGame) return;
    var board = state.currentGame.board(), cb = document.getElementById('chessboard');
    if (!cb) return;
    var ic = { w: { p: '\u2659', n: '\u2658', b: '\u2657', r: '\u2656', q: '\u2655', k: '\u2654' }, b: { p: '\u265F', n: '\u265E', b: '\u265D', r: '\u265C', q: '\u265B', k: '\u265A' } };
    cb.innerHTML = '';
    for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
            var sq = document.createElement('div');
            sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
            var p = board[r][c];
            if (p) {
                var pc = document.createElement('div');
                pc.className = 'piece ' + (p.color === 'w' ? 'white' : 'black');
                pc.textContent = ic[p.color][p.type];
                sq.appendChild(pc);
            }
            cb.appendChild(sq);
        }
    }
}

window.drderChess = { state: state };
