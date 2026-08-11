var state = {
    currentGame: null,
    gameHistory: [],
    alphaColor: 'w',
    betaColor: 'b',
    currentTurn: 'w',
    isMatchRunning: false,
    workers: { alpha: null, beta: null },
    pendingSearch: null,
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
    
    setTimeout(function() {
        startSystem();
    }, 500);
});

function startSystem() {
    if (state.workers.alpha) { state.workers.alpha.terminate(); }
    if (state.workers.beta) { state.workers.beta.terminate(); }
    
    state.workers.alpha = createWorker('alpha', BASE_PATH + 'stockfish.alpha.js', 4);
    state.workers.beta = createWorker('beta', BASE_PATH + 'stockfish.beta.js', 4);
    
    setTimeout(function() {
        startMatch();
    }, 5000);
}

function createWorker(name, path, multiPV) {
    var engineURL = new URL(path, window.location.href).href;

    var code = '';
    code += 'try {\n';
    code += '  importScripts(' + JSON.stringify(engineURL) + ');\n';
    code += '  var engine = null;\n';
    code += '  if (typeof Stockfish === "function") {\n';
    code += '    engine = Stockfish();\n';
    code += '  }\n';
    code += '  else if (typeof STOCKFISH === "function") {\n';
    code += '    engine = STOCKFISH();\n';
    code += '  }\n';
    code += '  else if (typeof Stockfish === "object" && Stockfish && Stockfish.postMessage) {\n';
    code += '    engine = Stockfish;\n';
    code += '  }\n';
    code += '  else if (typeof STOCKFISH === "object" && STOCKFISH && STOCKFISH.postMessage) {\n';
    code += '    engine = STOCKFISH;\n';
    code += '  }\n';
    code += '  if (engine && engine.postMessage) {\n';
    code += '    engine.onmessage = function(m) {\n';
    code += '      var d = typeof m === "string" ? m : (m && m.data ? m.data : "");\n';
    code += '      if (d) self.postMessage({data: d});\n';
    code += '    };\n';
    code += '    self.onmessage = function(e) {\n';
    code += '      var c = e.data;\n';
    code += '      if (c === "init") {\n';
    code += '        engine.postMessage("uci");\n';
    code += '        engine.postMessage("setoption name MultiPV value ' + multiPV + '");\n';
    code += '        engine.postMessage("isready");\n';
    code += '      }\n';
    code += '      else if (c && c.fen) {\n';
    code += '        engine.postMessage("stop");\n';
    code += '        engine.postMessage("position fen " + c.fen);\n';
    code += '        engine.postMessage("go depth 20 movetime 3000");\n';
    code += '      }\n';
    code += '      else if (c === "stop") {\n';
    code += '        engine.postMessage("stop");\n';
    code += '      }\n';
    code += '      else if (c === "quit") {\n';
    code += '        engine.postMessage("quit");\n';
    code += '      }\n';
    code += '    };\n';
    code += '  } else {\n';
    code += '    self.postMessage({data: "error:engine"});\n';
    code += '  }\n';
    code += '} catch(err) {\n';
    code += '  self.postMessage({data: "error:" + err.message});\n';
    code += '}\n';

    var blob = new Blob([code], { type: 'application/javascript' });
    var url = URL.createObjectURL(blob);
    var worker = new Worker(url);

    worker.onmessage = function(e) {
        if (!e.data || !e.data.data) return;
        var msg = e.data.data;

        if (msg.indexOf('readyok') !== -1) {
            worker.ready = true;
        }

        if (msg.indexOf('bestmove') !== -1 && worker.searching) {
            worker.searching = false;
            handleBestmove(name, msg);
        }
    };

    worker.onerror = function(error) {
        console.error('Worker error [' + name + ']:', error.message, error.filename, error.lineno);
        worker.ready = false;
        worker.searching = false;
    };

    worker.ready = false;
    worker.searching = false;
    worker.postMessage('init');
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
    worker.postMessage({ fen: fen });
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
