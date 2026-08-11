var testResult = '';

function initEmptyBoard() {
    var cb = document.getElementById('chessboard');
    if (!cb) return;
    
    var icons = {
        w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
        b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
    };
    
    var game = new Chess();
    var board = game.board();
    
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

document.addEventListener('DOMContentLoaded', function() {
    initEmptyBoard();
    
    document.getElementById('whitePlayer').textContent = 'Testing...';
    document.getElementById('blackPlayer').textContent = 'Please wait';
    
    // اختبار Stockfish Alpha
    try {
        var code = '';
        code += 'importScripts("./stockfish.alpha.js");\n';
        code += 'var engine = null;\n';
        code += 'if (typeof Stockfish === "function") engine = Stockfish();\n';
        code += 'else if (typeof STOCKFISH === "function") engine = STOCKFISH();\n';
        code += 'else if (typeof Stockfish === "object") engine = Stockfish;\n';
        code += 'else if (typeof STOCKFISH === "object") engine = STOCKFISH;\n';
        code += 'self.postMessage({type:"test", hasEngine: !!engine, hasPostMessage: !!(engine && engine.postMessage)});\n';
        
        var blob = new Blob([code], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        var worker = new Worker(url);
        
        worker.onmessage = function(e) {
            document.getElementById('whitePlayer').textContent = 'Alpha: ' + JSON.stringify(e.data);
            document.getElementById('blackPlayer').textContent = 'Ready';
        };
        
        worker.onerror = function(e) {
            document.getElementById('whitePlayer').textContent = 'Alpha Error';
            document.getElementById('blackPlayer').textContent = e.message || 'Unknown';
        };
    } catch(e) {
        document.getElementById('whitePlayer').textContent = 'Error';
        document.getElementById('blackPlayer').textContent = e.message;
    }
});

window.drderChess = {};
