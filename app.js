var state = {
    currentGame: null,
    gameHistory: [],
    alphaColor: 'w',
    betaColor: 'b',
    currentTurn: 'w',
    isMatchRunning: false,
    workers: { alpha: null, beta: null },
    searchActive: false,
    nextMoveTimer: null,
    matchTransitionTimer: null,
    colorSwap: false
};

var BASE_PATH = '/DrDer-chess-alpha/';

function initEmptyBoard() {
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    drawBoard();
}

document.addEventListener('DOMContentLoaded', function() {
    initEmptyBoard();
    document.getElementById('whitePlayer').textContent = 'Alpha';
    document.getElementById('blackPlayer').textContent = 'Beta';
    startSystem();
});

function startSystem() {
    if (state.workers.alpha) { state.workers.alpha.terminate(); }
    if (state.workers.beta) { state.workers.beta.terminate(); }

    var alphaPath = new URL(BASE_PATH + 'stockfish.alpha.js', window.location.href).href;
    var betaPath = new URL(BASE_PATH + 'stockfish.beta.js', window.location.href).href;

    state.workers.alpha = createWorker('alpha', alphaPath);
    state.workers.beta = createWorker('beta', betaPath);

    setTimeout(function() {
        if (state.workers.alpha.ready && state.workers.beta.ready) {
            startMatch();
        } else {
            startMatch();
        }
    }, 5000);
}

function createWorker(name, path) {
    var worker = new Worker(path);

    worker.ready = false;
    worker.searching = false;
    worker.name = name;

    worker.onmessage = function(e) {
        var msg = (typeof e.data === 'string') ? e.data : (e.data && e.data.data ? e.data.data : '');

        if (msg.indexOf('readyok') !== -1) {
            worker.ready = true;
        }

        if (msg.indexOf('bestmove') !== -1 && worker.searching) {
            worker.searching = false;
            handleBestmove(name, msg);
        }
    };

    worker.onerror = function(error) {
        worker.ready = false;
        worker.searching = false;
    };

    worker.postMessage('uci');
    worker.postMessage('setoption name MultiPV value 4');
    worker.postMessage('isready');

    return worker;
}

function handleBestmove(playerName, msg) {
    var parts = msg.split(' ');
    var bestMove = parts[1];

    if (!bestMove || bestMove === '(none)') {
        state.searchActive = false;
        if (state.currentGame && state.currentGame.game_over()) {
            endMatch();
        } else {
            makeNextMove();
        }
        return;
    }

    state.searchActive = false;

    try {
        var move = state.currentGame.move(bestMove, { sloppy: true });
        if (move) {
            state.gameHistory.push(move);
            state.currentTurn = state.currentGame.turn();
            drawBoard();

            if (state.currentGame.game_over()) {
                endMatch();
            } else {
                scheduleNextMove();
            }
        }
    } catch(e) {}
}

function scheduleNextMove() {
    if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);
    state.nextMoveTimer = setTimeout(function() {
        state.nextMoveTimer = null;
        makeNextMove();
    }, 200);
}

function makeNextMove() {
    if (!state.isMatchRunning) return;
    if (state.searchActive) return;
    if (!state.currentGame || state.currentGame.game_over()) {
        endMatch();
        return;
    }

    var playerName = state.currentTurn === state.alphaColor ? 'alpha' : 'beta';
    var worker = state.workers[playerName];

    if (!worker || !worker.ready) {
        scheduleNextMove();
        return;
    }

    state.searchActive = true;
    worker.searching = true;

    var fen = state.currentGame.fen();
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go depth 20 movetime 3000');
}

function startMatch() {
    if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);
    if (state.matchTransitionTimer) clearTimeout(state.matchTransitionTimer);

    state.isMatchRunning = true;
    state.currentGame = new Chess();
    state.gameHistory = [];
    state.currentTurn = 'w';
    state.searchActive = false;
    state.colorSwap = !state.colorSwap;
    state.alphaColor = state.colorSwap ? 'b' : 'w';
    state.betaColor = state.colorSwap ? 'w' : 'b';

    document.getElementById('whitePlayer').textContent = state.alphaColor === 'w' ? 'Alpha' : 'Beta';
    document.getElementById('blackPlayer').textContent = state.alphaColor === 'w' ? 'Beta' : 'Alpha';

    drawBoard();
    scheduleNextMove();
}

function endMatch() {
    state.isMatchRunning = false;
    state.searchActive = false;

    if (state.nextMoveTimer) clearTimeout(state.nextMoveTimer);

    state.matchTransitionTimer = setTimeout(function() {
        state.matchTransitionTimer = null;
        startMatch();
    }, 500);
}

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

window.drderChess = { state: state };
