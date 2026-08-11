/* ============================================
   DrDer Chess - Local AI vs AI Display
   ============================================ */

// ============================================
// PERSONALITY DEFINITIONS
// ============================================

const personalities = {
    alpha: {
        name: 'ALPHA',
        type: 'TACTICAL AI',
        aggression: 0.95,
        kingAttack: 0.98,
        tacticalRisk: 0.85,
        sacrifice: 0.80,
        pieceActivity: 0.95,
        defense: 0.40,
        endgame: 0.60,
        drawAvoidance: 0.98,
        depth: 22,
        movetime: 7000,
        multiPV: 4,
        threshold: 65
    },
    beta: {
        name: 'BETA',
        type: 'STRATEGIC AI',
        aggression: 0.55,
        kingAttack: 0.60,
        tacticalRisk: 0.40,
        sacrifice: 0.20,
        pieceActivity: 0.75,
        defense: 0.98,
        endgame: 0.98,
        drawAvoidance: 0.75,
        depth: 20,
        movetime: 7000,
        multiPV: 4,
        threshold: 30
    }
};

// ============================================
// CONSTANTS
// ============================================

const MAX_WORKER_RESTARTS = 5;
const SEARCH_WATCHDOG_MARGIN = 3000;
const MOVE_DELAY_MS = 300;
const WORKER_RESTART_DELAY_MS = 1000;
const WORKER_READY_POLL_MS = 500;
const MATCH_TRANSITION_DELAY_MS = 500;
const WORKER_INIT_TIMEOUT_MS = 15000;
const MAX_PERSONALITY_BONUS = 20;
const DEBUG = true;

// ============================================
// STOCKFISH ENGINE PATHS
// ============================================

const ENGINE_PATHS = {
    alpha: './stockfish.alpha.js',
    beta: './stockfish.beta.js'
};

// ============================================
// GLOBAL STATE
// ============================================

const state = {
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
    boardCache: { squares: null, container: null },
    logThrottle: {},
    colorSwap: false
};

// ============================================
// DIAGNOSTIC LOGGING
// ============================================

function debugLog(tag, message) {
    if (!DEBUG) return;
    if (typeof console === 'undefined' || !console.log) return;
    var now = Date.now();
    var key = tag + ':' + message;
    if (state.logThrottle[key] && now - state.logThrottle[key] < 2000) return;
    state.logThrottle[key] = now;
    var keys = Object.keys(state.logThrottle);
    if (keys.length > 100) {
        for (var i = 0; i < keys.length; i++) {
            if (now - state.logThrottle[keys[i]] > 10000) delete state.logThrottle[keys[i]];
        }
    }
    console.log('[DrDer][' + tag + '] ' + message);
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    debugLog('INIT', 'Starting local AI vs AI display');
    fullCleanup();
    initializeWorkers();
    startMatch();
}

function fullCleanup() {
    invalidateCurrentSearch();
    cancelNextMoveTimer();
    cancelMatchTransitionTimer();
    cancelWorkerRestartTimer();
    cancelSearchWatchdog();
    state.isMatchRunning = false;
    state.isMatchEnding = false;
    state.isTransitioning = false;
    state.searchActive = false;
    state.matchGeneration = (state.matchGeneration || 0) + 1;
    state.boardCache.squares = null;
    state.boardCache.container = null;
}

// ============================================
// TIMER MANAGEMENT
// ============================================

function cancelNextMoveTimer() { if (state.nextMoveTimer !== null) { clearTimeout(state.nextMoveTimer); state.nextMoveTimer = null; } }
function cancelMatchTransitionTimer() { if (state.matchTransitionTimer !== null) { clearTimeout(state.matchTransitionTimer); state.matchTransitionTimer = null; } }
function cancelWorkerRestartTimer() { if (state.workerRestartTimer !== null) { clearTimeout(state.workerRestartTimer); state.workerRestartTimer = null; } }
function cancelSearchWatchdog() { if (state.searchWatchdogTimer !== null) { clearTimeout(state.searchWatchdogTimer); state.searchWatchdogTimer = null; } }

function scheduleNextMove(delay) {
    cancelNextMoveTimer();
    if (!state.isMatchRunning || state.isMatchEnding || state.isTransitioning) return;
    state.nextMoveTimer = setTimeout(function() { state.nextMoveTimer = null; makeNextMove(); }, delay);
}

// ============================================
// SEARCH WATCHDOG
// ============================================

function startSearchWatchdog(search, movetime, matchGen, workerGen) {
    cancelSearchWatchdog();
    if (!search || !search.id || !search.active) return;
    var timeoutMs = movetime + SEARCH_WATCHDOG_MARGIN;
    var searchId = search.id;
    state.searchWatchdogTimer = setTimeout(function() {
        state.searchWatchdogTimer = null;
        if (state.matchGeneration !== matchGen) return;
        var cs = state.pendingSearch;
        if (!cs || cs.id !== searchId || !cs.active || cs.completed || cs.moveApplied) return;
        if (state.workers[search.player] && state.workers[search.player].generation !== workerGen) return;
        debugLog('WATCHDOG', 'Timeout: ' + searchId);
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
        debugLog('WATCHDOG', 'Force recovery: ' + pn);
        completeSearch(cs);
        invalidateCurrentSearch();
        if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) {
            handleWorkerError(pn, state.workers[pn] ? state.workers[pn].generation : 0);
        }
    }, 500);
}

// ============================================
// WORKER MANAGEMENT
// ============================================

function getEnginePath(playerName) { return ENGINE_PATHS[playerName] || './stockfish.alpha.js'; }

function initializeWorkers() {
    invalidateCurrentSearch();
    cancelNextMoveTimer(); cancelSearchWatchdog(); cancelWorkerRestartTimer();
    terminateWorker('alpha'); terminateWorker('beta');
    state.workers.alpha.restartCount = 0; state.workers.alpha.recovering = false; state.workers.alpha.searchSeq = 0;
    state.workers.beta.restartCount = 0; state.workers.beta.recovering = false; state.workers.beta.searchSeq = 0;
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
    debugLog('WORKER', 'Create: ' + playerName + ' gen ' + gen);

    var wc = '';
    wc += 'var sf=null,workerGen=' + gen + ',enginePath=' + JSON.stringify(enginePath) + ',ready=false,it=null,activeSearchSeq=null;\n';
    wc += 'function ci(){if(it){clearTimeout(it);it=null;}}\n';
    wc += 'function sendEngineMsg(d){self.postMessage({type:"engine",data:d,generation:workerGen});}\n';
    wc += 'self.onmessage=function(e){var c=e.data;\n';
    wc += 'if(c.type==="init"){try{importScripts(enginePath);\n';
    wc += 'var EC=null;\n';
    wc += 'if(typeof Stockfish==="function")EC=Stockfish;\n';
    wc += 'else if(typeof STOCKFISH==="function")EC=STOCKFISH;\n';
    wc += 'if(EC){sf=EC();}\n';
    wc += 'else if(typeof Stockfish==="object"&&Stockfish!==null&&typeof Stockfish.postMessage==="function")sf=Stockfish;\n';
    wc += 'else if(typeof STOCKFISH==="object"&&STOCKFISH!==null&&typeof STOCKFISH.postMessage==="function")sf=STOCKFISH;\n';
    wc += 'if(sf&&typeof sf.postMessage==="function"){\n';
    wc += 'sf.onmessage=function(m){\n';
    wc += 'var d=null;\n';
    wc += 'if(typeof m==="string")d=m;\n';
    wc += 'else if(m&&typeof m.data==="string")d=m.data;\n';
    wc += 'else if(m&&typeof m==="object"&&typeof m.data==="string")d=m.data;\n';
    wc += 'if(typeof d==="string"&&d.length>0){\n';
    wc += 'if(!ready){if(d.indexOf("readyok")!==-1){ready=true;ci();sendEngineMsg("readyok");}return;}\n';
    wc += 'if(d.indexOf("bestmove")===0&&activeSearchSeq!==null){\n';
    wc += 'var bmSeq=activeSearchSeq;activeSearchSeq=null;\n';
    wc += 'sendEngineMsg(d+" seq:"+bmSeq);\n';
    wc += '}else if(d.indexOf("multipv")!==-1&&activeSearchSeq!==null){sendEngineMsg(d);}\n';
    wc += '}};\n';
    wc += 'sf.postMessage("uci");sf.postMessage("setoption name MultiPV value "+c.multiPV);sf.postMessage("isready");\n';
    wc += 'it=setTimeout(function(){if(!ready){ci();self.postMessage({type:"error",data:"Init timeout",generation:workerGen});}},' + WORKER_INIT_TIMEOUT_MS + ');\n';
    wc += '}else{self.postMessage({type:"error",data:"No postMessage",generation:workerGen});}}catch(err){self.postMessage({type:"error",data:err.message,generation:workerGen});}}\n';
    wc += 'else if(c.type==="search"&&sf&&ready){\n';
    wc += 'activeSearchSeq=c.searchSeq;\n';
    wc += 'sf.postMessage("position fen "+c.fen);\n';
    wc += 'sf.postMessage("go depth "+c.depth+" movetime "+c.movetime);\n';
    wc += '}\n';
    wc += 'else if(c.type==="stop"&&sf){activeSearchSeq=null;sf.postMessage("stop");}\n';
    wc += 'else if(c.type==="quit"&&sf){activeSearchSeq=null;ci();sf.postMessage("quit");}};\n';

    var blob, url, instance;
    try { blob = new Blob([wc], { type: 'application/javascript' }); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false, searchSeq: (w.searchSeq || 0) + 1 };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }
    try { url = URL.createObjectURL(blob); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false, searchSeq: (w.searchSeq || 0) + 1 };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }
    try { instance = new Worker(url); } catch(e) {
        try { URL.revokeObjectURL(url); } catch(e2) {}
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false, searchSeq: (w.searchSeq || 0) + 1 };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }

    state.workers[playerName] = { instance: instance, status: 'initializing', url: url, restartCount: w.restartCount || 0, generation: gen, recovering: w.recovering || false, searchSeq: w.searchSeq || 0 };

    instance.onmessage = function(e) {
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data.generation !== undefined && e.data.generation !== gen) return;
        if (e.data.type === 'engine') handleEngineMessage(playerName, e.data.data, gen);
        else if (e.data.type === 'error') { debugLog('WORKER', 'Error: ' + playerName); handleWorkerError(playerName, gen); }
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
    debugLog('WORKER', 'Crash: ' + playerName + ' #' + w.restartCount);
    if (w.restartCount > MAX_WORKER_RESTARTS) {
        debugLog('WORKER', 'MAX_WORKER_RESTARTS exceeded for ' + playerName);
        return;
    }
    w.recovering = true;
    invalidateCurrentSearch();
    cancelNextMoveTimer(); cancelWorkerRestartTimer(); cancelSearchWatchdog();
    terminateWorker(playerName);
    state.workers[playerName].restartCount = w.restartCount;
    state.workers[playerName].recovering = true;
    createWorker(playerName);
    if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) {
        state.workerRestartTimer = setTimeout(function() {
            state.workerRestartTimer = null;
            if (state.workers[playerName]) state.workers[playerName].recovering = false;
            makeNextMove();
        }, WORKER_RESTART_DELAY_MS);
    } else { if (state.workers[playerName]) state.workers[playerName].recovering = false; }
}

// ============================================
// SEARCH MANAGEMENT
// ============================================

function invalidateCurrentSearch() {
    cancelSearchWatchdog();
    if (state.pendingSearch) { state.pendingSearch.active = false; state.pendingSearch.completed = true; state.pendingSearch = null; }
    state.searchActive = false;
}

function createSearch(playerName, fen) {
    if (state.searchActive) {
        debugLog('SEARCH', 'Cannot create search - already active');
        return null;
    }
    invalidateCurrentSearch();
    var w = state.workers[playerName];
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
    var p = personalities[playerName];
    startSearchWatchdog(s, p.movetime, state.matchGeneration, w.generation);
    return s;
}

function isValidSearchForMessage(search, playerName, workerGeneration) {
    if (!search) return false;
    return search.matchGeneration === state.matchGeneration && search.player === playerName && search.workerGeneration === workerGeneration && search.active && !search.completed;
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
    cancelSearchWatchdog();
    search.active = false; search.completed = true; state.searchActive = false;
}

// ============================================
// ENGINE MESSAGE HANDLING
// ============================================

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
        debugLog('ENGINE', playerName + ' ready');
        return;
    }
    var msgSearchSeq = null;
    if (msgStr.indexOf(' seq:') !== -1) {
        var seqIdx = msgStr.indexOf(' seq:');
        msgSearchSeq = parseInt(msgStr.substring(seqIdx + 5));
        msgStr = msgStr.substring(0, seqIdx);
    }
    var search = state.pendingSearch;
    if (!isValidSearchForMessage(search, playerName, workerGeneration)) return;
    if (msgStr.indexOf('bestmove') === 0 && msgSearchSeq !== null && search.searchSeq !== msgSearchSeq) {
        debugLog('ENGINE', 'Stale bestmove seq ' + msgSearchSeq + ' vs current ' + search.searchSeq);
        return;
    }
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
    var pv = [];
    for (var j = pvI + 1; j < parts.length; j++) {
        var t = parts[j];
        if (t === 'score' || t === 'multipv' || t === 'depth' || t === 'cp' || t === 'mate' || t === 'nodes' || t === 'nps' || t === 'time' || t === 'pv' || t === 'hashfull' || t === 'tbhits' || t === 'seldepth' || t === 'currmove' || t === 'currmovenumber' || t === 'string' || t === 'upperbound' || t === 'lowerbound') break;
        pv.push(t);
    }
    var ex = search.candidates[rank - 1];
    if (!ex || depth >= (ex.depth || 0)) {
        search.candidates[rank - 1] = { move: move, score: score, rank: rank, isMate: isMate, mateIn: mateIn, depth: depth, pv: pv };
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
            var w = state.workers[playerName];
            handleWorkerError(playerName, w ? w.generation : 0);
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
            var w2 = state.workers[playerName];
            handleWorkerError(playerName, w2 ? w2.generation : 0);
        }
        return;
    }
    var chosen = playerName === 'alpha' ? selectAlphaMove(search, bestMove) : selectBetaMove(search, bestMove);
    if (!chosen || !simulateMove(chosen)) chosen = bestMove;
    executeMove(playerName, chosen);
}

// ============================================
// GAME OVER
// ============================================

function isGameFinished() { return state.currentGame ? state.currentGame.game_over() : false; }

// ============================================
// MOVE SELECTION
// ============================================

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
        if (!c.isMate && c.score < best.score - p.threshold) { scored.push({ move: c.move, final: -Infinity }); continue; }
        if (c.isMate && c.mateIn > 0 && c.mateIn <= 5) { scored.push({ move: c.move, final: c.score + 5000 }); continue; }
        var bonus = c.score;
        var sim = simulateMove(c.move);
        if (!sim) { scored.push({ move: c.move, final: -Infinity }); continue; }
        if (sim.san.indexOf('+') !== -1) bonus += Math.round(8 * p.aggression);
        if (sim.captured) bonus += Math.round(6 * p.aggression);
        if (sim.san.indexOf('+') !== -1) bonus += Math.round(5 * p.kingAttack);
        if (sim.captured && sim.piece !== 'p' && sim.captured !== 'p') bonus += Math.round(4 * p.tacticalRisk);
        if (sim.captured && sim.piece === 'p' && (sim.captured === 'n' || sim.captured === 'b')) bonus += Math.round(3 * p.sacrifice);
        if (phase === 'middlegame' && (sim.piece === 'q' || sim.piece === 'r')) bonus += Math.round(4 * p.pieceActivity);
        if (sim.piece === 'p' && sim.san.indexOf('x') === -1 && sim.san.indexOf('+') === -1) bonus -= Math.round(3 * (1 - p.defense));
        if (phase === 'endgame' && sim.san.indexOf('+') !== -1) bonus -= Math.round(2 * (1 - p.endgame));
        if (p.drawAvoidance > 0.7 && sim.captured && sim.piece === 'q' && sim.captured === 'q') bonus -= Math.round(5 * p.drawAvoidance);
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
        if (!c.isMate && c.score < best.score - p.threshold) { scored.push({ move: c.move, final: -Infinity }); continue; }
        if (c.isMate && c.mateIn > 0 && c.mateIn <= 5) { scored.push({ move: c.move, final: c.score + 5000 }); continue; }
        var bonus = c.score;
        var sim = simulateMove(c.move);
        if (!sim) { scored.push({ move: c.move, final: -Infinity }); continue; }
        if (sim.san.indexOf('O-O') !== -1) bonus += Math.round(8 * p.defense);
        if ((sim.piece === 'n' || sim.piece === 'b') && phase === 'opening') bonus += Math.round(4 * p.pieceActivity);
        if (sim.piece === 'p' && sim.san.indexOf('x') === -1) bonus += Math.round(2 * p.defense);
        if (phase === 'endgame' && sim.captured) bonus += Math.round(5 * p.endgame);
        if (p.tacticalRisk < 0.5 && sim.san.indexOf('+') !== -1 && !sim.captured) bonus -= Math.round(4 * (1 - p.tacticalRisk));
        if (p.sacrifice < 0.3 && sim.captured && sim.piece !== 'p' && sim.captured === 'p') bonus -= Math.round(3 * (1 - p.sacrifice));
        if (p.drawAvoidance > 0.5 && sim.captured && sim.piece === 'q' && sim.captured === 'q') bonus -= Math.round(3 * p.drawAvoidance);
        if (sim.san.indexOf('+') !== -1 && !sim.captured) bonus -= Math.round(2 * (1 - p.aggression));
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
    var b = state.currentGame.board(), t = 0, q = 0, rk = 0, mn = 0;
    for (var ri = 0; ri < 8; ri++) { for (var ci = 0; ci < 8; ci++) { var pc = b[ri][ci]; if (pc) { t++; if (pc.type === 'q') q++; if (pc.type === 'r') rk++; if (pc.type === 'n' || pc.type === 'b') mn++; } } }
    var mv = state.gameHistory.length;
    if (mv <= 12 && t >= 28) return 'opening';
    if (t <= 12 || (q === 0 && rk <= 2 && mn <= 4)) return 'endgame';
    if (t <= 20 && q <= 1 && mv > 30) return 'endgame';
    return 'middlegame';
}

// ============================================
// MOVE EXECUTION
// ============================================

function executeMove(playerName, moveStr) {
    var search = state.pendingSearch;
    if (!isValidSearchForMove(search, playerName)) return;
    if (!moveStr || typeof moveStr !== 'string') { invalidateCurrentSearch(); if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning) makeNextMove(); return; }
    if (search.moveApplied) return;
    search.moveApplied = true;
    var move;
    try { move = state.currentGame.move(moveStr, { sloppy: true }); } catch(e) { move = null; }
    if (!move) { search.moveApplied = false; invalidateCurrentSearch(); if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning && state.currentGame && !isGameFinished()) makeNextMove(); return; }
    state.gameHistory.push(move);
    state.currentTurn = state.currentGame.turn();
    invalidateCurrentSearch();
    drawBoard();
    if (isGameFinished()) { endMatch(); return; }
    scheduleNextMove(MOVE_DELAY_MS);
}

// ============================================
// MATCH LOGIC
// ============================================

function startMatch() {
    if (state.isTransitioning) return;
    invalidateCurrentSearch(); cancelNextMoveTimer(); cancelMatchTransitionTimer(); cancelSearchWatchdog(); cancelWorkerRestartTimer();
    state.isMatchRunning = true; state.isMatchEnding = false; state.matchGeneration++;
    state.currentGame = new Chess(); state.gameHistory = []; state.currentTurn = 'w'; state.isTransitioning = false;
    state.boardCache.squares = null; state.boardCache.container = null;
    state.colorSwap = !state.colorSwap;
    state.alphaColor = state.colorSwap ? 'b' : 'w';
    state.betaColor = state.colorSwap ? 'w' : 'b';
    drawBoard();
    makeNextMove();
}

function makeNextMove() {
    if (!state.isMatchRunning || state.isMatchEnding || state.isTransitioning || !state.currentGame) return;
    if (state.searchActive) return;
    if (isGameFinished()) { endMatch(); return; }
    var pn = state.currentTurn === state.alphaColor ? 'alpha' : 'beta';
    var w = state.workers[pn];
    if (!w || w.status !== 'ready') {
        if (w && w.status === 'initializing' && !w.recovering) {
            scheduleNextMove(WORKER_READY_POLL_MS);
        } else if (!w || w.status === 'idle') {
            debugLog('MATCH', 'Worker ' + pn + ' not available, recovery');
            handleWorkerError(pn, w ? w.generation : 0);
        }
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
    invalidateCurrentSearch(); cancelNextMoveTimer(); cancelSearchWatchdog(); cancelWorkerRestartTimer();
    if (state.workers.alpha.instance) { try { state.workers.alpha.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    if (state.workers.beta.instance) { try { state.workers.beta.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    debugLog('MATCH', 'Match ended');
    cancelMatchTransitionTimer();
    state.matchTransitionTimer = setTimeout(function() {
        state.matchTransitionTimer = null;
        state.isTransitioning = false;
        state.isMatchEnding = false;
        startMatch();
    }, MATCH_TRANSITION_DELAY_MS);
}

// ============================================
// UI RENDERING
// ============================================

function drawBoard() {
    if (!state.currentGame) return;
    var board = state.currentGame.board(), cb = document.getElementById('chessboard'); if (!cb) return;
    var ic = { w: { p: '\u2659', n: '\u2658', b: '\u2657', r: '\u2656', q: '\u2655', k: '\u2654' }, b: { p: '\u265F', n: '\u265E', b: '\u265D', r: '\u265C', q: '\u265B', k: '\u265A' } };
    if (state.boardCache.container === cb && state.boardCache.squares && state.boardCache.squares.length === 64) {
        var sqs = state.boardCache.squares, idx = 0;
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < 8; c++) {
                var sq = sqs[idx], p = board[r][c], cp = sq.querySelector('.piece');
                if (p) {
                    var ec = ic[p.color][p.type];
                    if (!cp || cp.textContent !== ec) { if (cp) sq.removeChild(cp); var pc = document.createElement('div'); pc.className = 'piece ' + (p.color === 'w' ? 'white' : 'black'); pc.textContent = ec; sq.appendChild(pc); }
                } else { if (cp) sq.removeChild(cp); }
                idx++;
            }
        }
    } else {
        cb.innerHTML = ''; var sqs = [];
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < 8; c++) {
                var sq = document.createElement('div'); sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
                var p = board[r][c];
                if (p) { var pc = document.createElement('div'); pc.className = 'piece ' + (p.color === 'w' ? 'white' : 'black'); pc.textContent = ic[p.color][p.type]; sq.appendChild(pc); }
                cb.appendChild(sq); sqs.push(sq);
            }
        }
        state.boardCache.container = cb; state.boardCache.squares = sqs;
    }
}

// ============================================
// GLOBAL EXPORT
// ============================================

window.drderChess = { state: state };
