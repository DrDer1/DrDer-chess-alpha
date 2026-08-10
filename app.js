/* ============================================
   DrDer Chess Alpha - Advanced Broadcast System v3.8
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
const COUNTDOWN_SECONDS = 3;
const COUNTDOWN_INTERVAL_MS = 1000;
const MAX_OPENING_ATTEMPTS = 5;
const MAX_USED_OPENINGS = 48;
const MAX_MOVES_DISPLAY = 30;
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
    version: 3.8,
    currentMatch: 1,
    alphaWins: 0,
    betaWins: 0,
    draws: 0,
    currentGame: null,
    gameHistory: [],
    alphaColor: 'w',
    betaColor: 'b',
    currentTurn: 'w',
    isMatchRunning: false,
    isMatchEnding: false,
    matchGeneration: 0,
    workers: {
        alpha: { instance: null, status: 'idle', url: null, restartCount: 0, generation: 0, recovering: false },
        beta: { instance: null, status: 'idle', url: null, restartCount: 0, generation: 0, recovering: false }
    },
    pendingSearch: null,
    searchActive: false,
    usedOpenings: [],
    lastEvaluation: '0.00',
    isTransitioning: false,
    nextMoveTimer: null,
    transitionTimer: null,
    workerRestartTimer: null,
    searchWatchdogTimer: null,
    boardCache: { squares: null, container: null },
    logThrottle: {}
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
// OPENINGS DATABASE
// ============================================

const openingsDatabase = [
    { name: 'Sicilian Defense', moves: ['e4', 'c5'] },
    { name: 'French Defense', moves: ['e4', 'e6'] },
    { name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
    { name: "Queen's Gambit", moves: ['d4', 'd5'] },
    { name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
    { name: "Queen's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'e6'] },
    { name: 'English Opening', moves: ['c4'] },
    { name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
    { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
    { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
    { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'] },
    { name: 'Pirc Defense', moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'] },
    { name: 'Modern Defense', moves: ['e4', 'g6'] },
    { name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
    { name: 'Grünfeld Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
    { name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
    { name: 'Semi-Slav', moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'c6'] },
    { name: 'Dutch Defense', moves: ['d4', 'f5'] },
    { name: "Alekhine's Defense", moves: ['e4', 'Nf6'] },
    { name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
    { name: "Petrov's Defense", moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
    { name: 'London System', moves: ['d4', 'Nf6', 'Bf4', 'e6', 'e3', 'c5'] },
    { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4'] },
    { name: 'Four Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'] }
];

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() { initializeApp(); });

function initializeApp() {
    var cb = document.getElementById('continueBtn');
    var rb = document.getElementById('resetBtn');
    if (cb) cb.addEventListener('click', startContinue);
    if (rb) rb.addEventListener('click', startReset);
    loadState();
    showHomeScreen();
}

function showHomeScreen() {
    var h = document.getElementById('homeScreen');
    var l = document.getElementById('liveScreen');
    if (h) h.style.display = 'flex';
    if (l) l.style.display = 'none';
}

function showLiveScreen() {
    var h = document.getElementById('homeScreen');
    var l = document.getElementById('liveScreen');
    if (h) h.style.display = 'none';
    if (l) l.style.display = 'flex';
}

function startContinue() {
    debugLog('INIT', 'Continue');
    loadState();
    showLiveScreen();
    fullCleanup();
    initializeWorkers();
    startMatch();
}

function startReset() {
    debugLog('INIT', 'Reset');
    state.currentMatch = 1; state.alphaWins = 0; state.betaWins = 0; state.draws = 0;
    state.usedOpenings = []; state.alphaColor = 'w'; state.betaColor = 'b';
    try { localStorage.removeItem('drderChessState'); } catch(e) {}
    showLiveScreen();
    fullCleanup();
    initializeWorkers();
    startMatch();
}

function fullCleanup() {
    invalidateCurrentSearch();
    cancelNextMoveTimer();
    cancelTransitionTimer();
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
// STATE & STORAGE
// ============================================

function saveState() {
    try {
        var d = { version: state.version, currentMatch: state.currentMatch, alphaWins: state.alphaWins, betaWins: state.betaWins, draws: state.draws, usedOpenings: state.usedOpenings.slice(-MAX_USED_OPENINGS), alphaColor: state.alphaColor, betaColor: state.betaColor };
        localStorage.setItem('drderChessState', JSON.stringify(d));
    } catch(e) {}
}

function loadState() {
    try {
        var s = localStorage.getItem('drderChessState');
        if (s) {
            var l = JSON.parse(s);
            if (l && typeof l === 'object') {
                state.currentMatch = (typeof l.currentMatch === 'number' && l.currentMatch > 0) ? l.currentMatch : 1;
                state.alphaWins = (typeof l.alphaWins === 'number' && l.alphaWins >= 0) ? l.alphaWins : 0;
                state.betaWins = (typeof l.betaWins === 'number' && l.betaWins >= 0) ? l.betaWins : 0;
                state.draws = (typeof l.draws === 'number' && l.draws >= 0) ? l.draws : 0;
                state.usedOpenings = Array.isArray(l.usedOpenings) ? l.usedOpenings.slice(-MAX_USED_OPENINGS) : [];
                state.alphaColor = (l.alphaColor === 'w' || l.alphaColor === 'b') ? l.alphaColor : 'w';
                state.betaColor = (l.betaColor === 'w' || l.betaColor === 'b') ? l.betaColor : 'b';
                if (state.alphaColor === state.betaColor) { state.alphaColor = 'w'; state.betaColor = 'b'; }
            }
        }
    } catch(e) {}
}

// ============================================
// TIMER MANAGEMENT
// ============================================

function cancelNextMoveTimer() { if (state.nextMoveTimer !== null) { clearTimeout(state.nextMoveTimer); state.nextMoveTimer = null; } }
function cancelTransitionTimer() { if (state.transitionTimer !== null) { clearInterval(state.transitionTimer); state.transitionTimer = null; } }
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
        if (!cs || cs.id !== searchId || !cs.active || cs.completed) return;
        if (state.workers[search.player] && state.workers[search.player].generation !== workerGen) return;
        debugLog('WATCHDOG', 'Timeout: ' + searchId);
        handleSearchTimeout(cs, matchGen);
    }, timeoutMs);
}

function handleSearchTimeout(search, matchGen) {
    if (!search || !search.active || search.completed) return;
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
    state.workers.alpha.restartCount = 0; state.workers.alpha.recovering = false;
    state.workers.beta.restartCount = 0; state.workers.beta.recovering = false;
    state.workers.alpha = createWorker('alpha');
    state.workers.beta = createWorker('beta');
}

function terminateWorker(playerName) {
    var w = state.workers[playerName];
    if (!w) return;
    if (w.instance) { try { w.instance.postMessage({ type: 'quit' }); } catch(e) {} w.instance.terminate(); }
    if (w.url) { try { URL.revokeObjectURL(w.url); } catch(e) {} }
    state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: (w.generation || 0) + 1, recovering: false };
}

function createWorker(playerName) {
    var w = state.workers[playerName];
    var gen = w.generation;
    var enginePath = getEnginePath(playerName);
    debugLog('WORKER', 'Create: ' + playerName + ' gen ' + gen);

    var wc = '';
    wc += 'var sf=null,workerGen=' + gen + ',enginePath=' + JSON.stringify(enginePath) + ',ready=false,it=null;\n';
    wc += 'function ci(){if(it){clearTimeout(it);it=null;}}\n';
    wc += 'self.onmessage=function(e){var c=e.data;\n';
    wc += 'if(c.type==="init"){try{importScripts(enginePath);\n';
    wc += 'var EC=null;\n';
    wc += 'if(typeof Stockfish==="function")EC=Stockfish;\n';
    wc += 'else if(typeof STOCKFISH==="function")EC=STOCKFISH;\n';
    wc += 'if(EC){sf=EC();}\n';
    wc += 'else if(typeof Stockfish==="object"&&Stockfish!==null&&typeof Stockfish.postMessage==="function")sf=Stockfish;\n';
    wc += 'else if(typeof STOCKFISH==="object"&&STOCKFISH!==null&&typeof STOCKFISH.postMessage==="function")sf=STOCKFISH;\n';
    wc += 'if(sf&&typeof sf.postMessage==="function"){\n';
    wc += 'sf.onmessage=function(m){if(ready){var d=null;\n';
    wc += 'if(typeof m==="string")d=m;\n';
    wc += 'else if(m&&typeof m.data==="string")d=m.data;\n';
    wc += 'else if(m&&typeof m==="object"&&typeof m.data==="string")d=m.data;\n';
    wc += 'if(typeof d==="string"&&d.length>0)self.postMessage({type:"engine",data:d,generation:workerGen});}\n';
    wc += 'else{var rd=(typeof m==="string")?m:(m&&m.data?m.data:"");\n';
    wc += 'if(typeof rd==="string"&&rd.indexOf("readyok")!==-1){ready=true;ci();self.postMessage({type:"engine",data:"readyok",generation:workerGen});}}};\n';
    wc += 'sf.postMessage("uci");sf.postMessage("setoption name MultiPV value "+c.multiPV);sf.postMessage("isready");\n';
    wc += 'it=setTimeout(function(){if(!ready){ci();self.postMessage({type:"error",data:"Init timeout",generation:workerGen});}},' + WORKER_INIT_TIMEOUT_MS + ');\n';
    wc += '}else{self.postMessage({type:"error",data:"No postMessage",generation:workerGen});}}catch(err){self.postMessage({type:"error",data:err.message,generation:workerGen});}}\n';
    wc += 'else if(c.type==="search"&&sf&&ready){sf.postMessage("stop");sf.postMessage("position fen "+c.fen);sf.postMessage("go depth "+c.depth+" movetime "+c.movetime);}\n';
    wc += 'else if(c.type==="stop"&&sf){sf.postMessage("stop");}\n';
    wc += 'else if(c.type==="quit"&&sf){ci();sf.postMessage("quit");}};\n';

    var blob, url, instance;
    try { blob = new Blob([wc], { type: 'application/javascript' }); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }
    try { url = URL.createObjectURL(blob); } catch(e) {
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }
    try { instance = new Worker(url); } catch(e) {
        try { URL.revokeObjectURL(url); } catch(e2) {}
        state.workers[playerName] = { instance: null, status: 'idle', url: null, restartCount: w.restartCount || 0, generation: gen + 1, recovering: false };
        handleWorkerError(playerName, gen + 1); return state.workers[playerName];
    }

    state.workers[playerName] = { instance: instance, status: 'initializing', url: url, restartCount: w.restartCount || 0, generation: gen, recovering: w.recovering || false };

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
    if (state.isMatchEnding) return;
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
    var oldGen = w.generation;
    terminateWorker(playerName);
    state.workers[playerName].restartCount = w.restartCount;
    state.workers[playerName].generation = oldGen + 1;
    state.workers[playerName].recovering = true;
    createWorker(playerName);
    if (!state.isMatchEnding) {
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
    invalidateCurrentSearch();
    var s = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        player: playerName, fen: fen,
        candidates: [], bestCandidate: null,
        active: true, completed: false, moveApplied: false,
        matchGeneration: state.matchGeneration,
        workerGeneration: state.workers[playerName].generation
    };
    state.pendingSearch = s;
    state.searchActive = true;
    var p = personalities[playerName];
    startSearchWatchdog(s, p.movetime, state.matchGeneration, state.workers[playerName].generation);
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
    if (msgStr === 'readyok' || msgStr.indexOf('readyok') !== -1) { w.status = 'ready'; return; }
    var search = state.pendingSearch;
    if (!isValidSearchForMessage(search, playerName, workerGeneration)) return;
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
    var searcherColor = playerName === 'alpha' ? state.alphaColor : state.betaColor;
    var move;
    try { move = state.currentGame.move(moveStr, { sloppy: true }); } catch(e) { move = null; }
    if (!move) { search.moveApplied = false; invalidateCurrentSearch(); if (state.isMatchRunning && !state.isMatchEnding && !state.isTransitioning && state.currentGame && !isGameFinished()) makeNextMove(); return; }
    state.gameHistory.push(move);
    state.currentTurn = state.currentGame.turn();
    updateEvaluation(search, searcherColor);
    invalidateCurrentSearch();
    updateUI();
    if (isGameFinished()) { endMatch(); return; }
    scheduleNextMove(MOVE_DELAY_MS);
}

function updateEvaluation(search, searcherColor) {
    var bc = search.bestCandidate || getBestCandidateFromSearch(search);
    if (!bc) return;
    if (bc.isMate) {
        var m = Math.abs(bc.mateIn);
        state.lastEvaluation = bc.mateIn > 0 ? (searcherColor === 'w' ? 'M' + m : '-M' + m) : (searcherColor === 'w' ? '-M' + m : 'M' + m);
    } else {
        var ds = searcherColor === 'w' ? bc.score : -bc.score;
        var v = (ds / 100).toFixed(2);
        state.lastEvaluation = (ds > 0 ? '+' : '') + v;
        if (ds === 0) state.lastEvaluation = '0.00';
    }
}

// ============================================
// MATCH LOGIC
// ============================================

function startMatch() {
    if (state.isTransitioning) return;
    invalidateCurrentSearch(); cancelNextMoveTimer(); cancelTransitionTimer(); cancelSearchWatchdog(); cancelWorkerRestartTimer();
    state.isMatchRunning = true; state.isMatchEnding = false; state.matchGeneration++;
    state.currentGame = new Chess(); state.gameHistory = []; state.currentTurn = 'w'; state.lastEvaluation = '0.00'; state.isTransitioning = false;
    state.boardCache.squares = null; state.boardCache.container = null;
    state.alphaColor = (state.currentMatch % 2 === 0) ? 'b' : 'w';
    state.betaColor = (state.currentMatch % 2 === 0) ? 'w' : 'b';
    applyOpening();
    updateUI();
    makeNextMove();
}

function applyOpening() {
    if (!state.currentGame) return;
    var origFen = state.currentGame.fen(), origTurn = state.currentTurn;
    var avail = [];
    for (var i = 0; i < openingsDatabase.length; i++) { if (state.usedOpenings.indexOf(openingsDatabase[i].name) === -1) avail.push(openingsDatabase[i]); }
    if (avail.length === 0) { state.usedOpenings = []; avail = openingsDatabase.slice(); }
    var opening = null, applied = 0;
    for (var a = 0; a < Math.min(avail.length, MAX_OPENING_ATTEMPTS); a++) {
        var idx = Math.floor(Math.random() * avail.length), cand = avail[idx];
        try { state.currentGame = new Chess(); state.currentGame.load(origFen); state.gameHistory = []; state.currentTurn = origTurn; } catch(e) { state.currentGame = new Chess(); state.gameHistory = []; state.currentTurn = 'w'; }
        applied = 0; var ok = true;
        for (var j = 0; j < cand.moves.length; j++) {
            try { var mv = state.currentGame.move(cand.moves[j], { sloppy: true }); if (mv) { state.gameHistory.push(mv); state.currentTurn = state.currentGame.turn(); applied++; } else { ok = false; break; } } catch(e) { ok = false; break; }
        }
        if (applied > 0 && ok) { opening = cand; break; }
        else { avail.splice(idx, 1); if (avail.length === 0) break; }
    }
    if (opening) {
        state.usedOpenings.push(opening.name);
        if (state.usedOpenings.length > MAX_USED_OPENINGS) state.usedOpenings = state.usedOpenings.slice(-24);
        var el = document.getElementById('openingName'); if (el) el.textContent = opening.name;
    } else {
        try { state.currentGame = new Chess(); state.currentGame.load(origFen); state.gameHistory = []; state.currentTurn = origTurn; } catch(e) { state.currentGame = new Chess(); state.gameHistory = []; state.currentTurn = 'w'; }
    }
}

function makeNextMove() {
    if (!state.isMatchRunning || state.isMatchEnding || state.isTransitioning || !state.currentGame || state.searchActive) return;
    if (isGameFinished()) { endMatch(); return; }
    var pn = state.currentTurn === state.alphaColor ? 'alpha' : 'beta';
    var w = state.workers[pn];
    if (!w || w.status !== 'ready') { scheduleNextMove(WORKER_READY_POLL_MS); return; }
    var fen = state.currentGame.fen();
    createSearch(pn, fen);
    if (w.instance) {
        try { w.instance.postMessage({ type: 'search', fen: fen, depth: personalities[pn].depth, movetime: personalities[pn].movetime }); }
        catch(e) { invalidateCurrentSearch(); handleWorkerError(pn, w.generation); }
    }
}

function endMatch() {
    if (!state.isMatchRunning || state.isMatchEnding) return;
    state.isMatchEnding = true; state.isMatchRunning = false; state.isTransitioning = true;
    invalidateCurrentSearch(); cancelNextMoveTimer(); cancelTransitionTimer(); cancelSearchWatchdog(); cancelWorkerRestartTimer();
    if (state.workers.alpha.instance) { try { state.workers.alpha.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    if (state.workers.beta.instance) { try { state.workers.beta.instance.postMessage({ type: 'stop' }); } catch(e) {} }
    var result = '';
    if (state.currentGame) {
        if (state.currentGame.in_checkmate()) {
            var wc = state.currentTurn === 'w' ? 'b' : 'w';
            var winner = wc === state.alphaColor ? 'ALPHA' : 'BETA';
            if (winner === 'ALPHA') state.alphaWins++; else state.betaWins++;
            result = winner + ' \u064a\u0641\u0648\u0632 \u0628\u0627\u0644\u062d\u0645\u064a\u0629';
        } else if (state.currentGame.in_stalemate()) { state.draws++; result = '\u062a\u0639\u0627\u062f\u0644 (\u0631\u062f\u0628\u0629)'; }
        else if (state.currentGame.in_threefold_repetition()) { state.draws++; result = '\u062a\u0639\u0627\u062f\u0644 (\u062a\u0643\u0631\u0627\u0631)'; }
        else if (state.currentGame.insufficient_material()) { state.draws++; result = '\u062a\u0639\u0627\u062f\u0644 (\u0645\u0627\u062f\u0629)'; }
        else { state.draws++; result = '\u062a\u0639\u0627\u062f\u0644'; }
    } else { state.draws++; result = '\u062a\u0639\u0627\u062f\u0644'; }
    state.currentMatch++;
    saveState();
    showMatchEnd(result);
}

function showMatchEnd(result) {
    var scr = document.getElementById('matchEndScreen'), resEl = document.getElementById('matchResult'), timEl = document.getElementById('countdownTimer');
    if (resEl) resEl.textContent = result;
    if (scr) scr.style.display = 'flex';
    var count = COUNTDOWN_SECONDS;
    if (timEl) timEl.textContent = count;
    cancelTransitionTimer();
    state.transitionTimer = setInterval(function() {
        count--;
        if (count > 0) { if (timEl) timEl.textContent = count; }
        else { clearInterval(state.transitionTimer); state.transitionTimer = null; if (scr) scr.style.display = 'none'; state.isTransitioning = false; state.isMatchEnding = false; startMatch(); }
    }, COUNTDOWN_INTERVAL_MS);
}

// ============================================
// UI RENDERING
// ============================================

function updateUI() {
    var el;
    el = document.getElementById('matchNumber'); if (el) el.textContent = state.currentMatch;
    el = document.getElementById('whitePlayerName'); if (el) el.textContent = state.alphaColor === 'w' ? 'ALPHA' : 'BETA';
    el = document.getElementById('blackPlayerName'); if (el) el.textContent = state.alphaColor === 'w' ? 'BETA' : 'ALPHA';
    el = document.getElementById('alphaWins'); if (el) el.textContent = state.alphaWins;
    el = document.getElementById('betaWins'); if (el) el.textContent = state.betaWins;
    el = document.getElementById('draws'); if (el) el.textContent = state.draws;
    el = document.getElementById('totalMatches'); if (el) el.textContent = state.alphaWins + state.betaWins + state.draws;
    el = document.getElementById('moveCounter'); if (el) { var fm = state.gameHistory.length > 0 ? Math.floor((state.gameHistory.length - 1) / 2) + 1 : 1; el.textContent = fm; }
    el = document.getElementById('evaluation'); if (el) el.textContent = state.lastEvaluation;
    updateMovesList();
    drawBoard();
}

function updateMovesList() {
    var lst = document.getElementById('movesList'); if (!lst) return;
    lst.innerHTML = '';
    if (state.gameHistory.length === 0) { lst.innerHTML = '<div class="moves-empty">\u0641\u064a \u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0627\u0641\u062a\u062a\u0627\u062d\u064a\u0629...</div>'; return; }
    var st = Math.max(0, state.gameHistory.length - MAX_MOVES_DISPLAY);
    for (var i = st; i < state.gameHistory.length; i++) { var d = document.createElement('div'); d.className = 'move-item'; d.textContent = state.gameHistory[i].san; lst.appendChild(d); }
    lst.scrollTop = lst.scrollHeight;
}

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

window.drderChess = { state: state, startContinue: startContinue, startReset: startReset };
