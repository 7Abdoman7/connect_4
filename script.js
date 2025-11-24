/* --- CONFIGURATION --- */
const ROWS = 6;
const COLS = 7;
const P1 = 1;
const P2 = 2;
const EMPTY = 0;

/* --- STATE --- */
let board = [];
let moveHistory = []; // Stack: {row, col, player}
let gameActive = false;
let currentPlayer = P1;
let config = { mode: 'PvAI', depth: 6, sound: true };

/* --- DOM ELEMENTS --- */
let els = {};

/* --- INITIALIZATION --- */
function init() {
    // Populate DOM elements
    els = {
        board: document.getElementById('board'),
        status: document.getElementById('status-bar'),
        sndBtn: document.getElementById('snd-btn'),
        modal: document.getElementById('modal-overlay'),
        mTitle: document.getElementById('modal-title'),
        mMsg: document.getElementById('modal-msg'),

        // Menus
        mainMenu: document.getElementById('main-menu'),
        aiSetup: document.getElementById('ai-setup-menu'),
        onlineMode: document.getElementById('online-mode-menu'),
        onlineFriend: document.getElementById('online-friend-menu'),
        onlineWaiting: document.getElementById('online-waiting-menu'),

        // Inputs
        setupDiff: document.getElementById('setup-difficulty'),
        setupTurn: document.getElementById('setup-turn-order'),
        onlineTurnPref: document.getElementById('online-turn-pref'),
        omCodeInput: document.getElementById('room-code-input'),
        omCodeDisplay: document.getElementById('room-code-display'),

        // Game Wrapper
        gameWrapper: document.querySelector('.game-wrapper'),
        controls: document.querySelector('.controls'),
        statusBar: document.getElementById('status-bar')
    };

    console.log("Initialized Elements:", els);

    createGrid();
    initAudio();
    showMainMenu();
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
    init();
});

/* --- NAVIGATION --- */
function hideAllMenus() {
    const menus = [els.mainMenu, els.aiSetup, els.onlineMode, els.onlineFriend, els.onlineWaiting];
    menus.forEach(m => {
        if (m) m.style.display = 'none';
    });
    if (els.gameWrapper) els.gameWrapper.style.display = 'none';
    if (els.controls) els.controls.style.display = 'none';
    if (els.statusBar) els.statusBar.style.display = 'none';
    if (els.modal) els.modal.classList.remove('active');
}

function showMainMenu() {
    gameActive = false;
    hideAllMenus();
    if (els.mainMenu) els.mainMenu.style.display = 'flex';

    // Disconnect socket if connected to a game? 
    // Ideally we leave the room.
    if (socket && socket.connected) {
        socket.emit('quit_game', { room: onlineRoom });
    }
}

function startPvAI() {
    hideAllMenus();
    if (els.aiSetup) {
        els.aiSetup.style.display = 'flex';
    } else {
        console.error("Error: AI Setup menu not found!");
        alert("Error: AI Setup menu missing. Please check console.");
    }
}

function confirmAiSetup() {
    try {
        console.log("Starting AI Setup...");
        config.mode = 'PvAI';
        if (els.setupDiff) config.depth = parseInt(els.setupDiff.value);
        const turn = els.setupTurn ? parseInt(els.setupTurn.value) : 1;

        hideAllMenus();
        if (els.gameWrapper) {
            console.log("Showing Game Wrapper");
            els.gameWrapper.style.setProperty('display', 'block', 'important');
        } else {
            console.error("Game Wrapper not found!");
            // Fallback
            const gw = document.querySelector('.game-wrapper');
            if (gw) gw.style.setProperty('display', 'block', 'important');
        }
        if (els.controls) els.controls.style.display = 'flex';
        if (els.statusBar) els.statusBar.style.display = 'block';

        createGrid();
        fullReset(turn);
    } catch (e) {
        console.error("Setup Error:", e);
        alert("Error starting game: " + e.message);
    }
}

function startOnline() {
    if (!socket || !socket.connected) {
        alert("Online mode is unavailable. Please ensure the server is running.");
        return;
    }
    config.mode = 'OnlinePvP';
    showOnlineModeSelect();
}

function showOnlineModeSelect() {
    hideAllMenus();
    if (els.onlineMode) els.onlineMode.style.display = 'flex';
}

function showFriendMenu() {
    hideAllMenus();
    if (els.onlineFriend) els.onlineFriend.style.display = 'flex';
}

function createGrid() {
    const boardEl = els.board || document.getElementById('board');
    console.log("Creating Grid...", boardEl);

    if (!boardEl) { console.error("Board element not found"); return; }

    boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (r === 0 && c === 0) {
                console.log("Cell created at", r, c);
            }
            let cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.c = c;
            cell.dataset.r = r;

            let piece = document.createElement('div');
            piece.className = 'piece';
            piece.id = `p-${r}-${c}`;
            cell.appendChild(piece);

            // Interactions
            cell.onclick = () => handleInteract(c);
            cell.onmouseenter = () => showGhost(c);
            cell.onmouseleave = clearGhosts;

            boardEl.appendChild(cell);
        }
    }
}

function fullReset(turnOverride) {
    gameActive = true;
    board = Array(ROWS).fill().map(() => Array(COLS).fill(EMPTY));
    moveHistory = [];

    // Determine starting player based on mode and settings
    if (config.mode === 'PvAI') {
        const pref = turnOverride !== undefined ? turnOverride : 1;
        currentPlayer = (pref === 2) ? P2 : P1;
    } else {
        // Online - Default P1, but online overrides this on game_start
        currentPlayer = P1;
    }

    // Clear UI
    document.querySelectorAll('.piece').forEach(p => p.className = 'piece');
    document.querySelectorAll('.cell').forEach(c => c.classList.remove('win-bg'));
    document.querySelectorAll('.win').forEach(e => e.classList.remove('win'));
    if (els.modal) els.modal.classList.remove('active');

    setStatus();

    // Trigger AI if it starts
    if (config.mode === 'PvAI' && currentPlayer === P2) {
        setTimeout(processAiTurn, 500);
    }
}

/* --- GAME LOGIC --- */
function handleInteract(col) {
    // Resume Audio Context on first click
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (!gameActive) return;
    if (config.mode === 'PvAI' && currentPlayer !== P1) return; // Strict check: Only P1 can click in PvAI
    if (config.mode === 'OnlinePvP' && currentPlayer !== myOnlineRole) return; // Wait for Online Opponent

    if (isValidMove(col)) {
        const row = executeMove(col, currentPlayer);
        if (row === -1) return;

        // Emit Online Move
        if (config.mode === 'OnlinePvP') {
            socket.emit('make_move', { room: onlineRoom, col: col, player: myOnlineRole });
        }

        if (checkGameEnd(row, col, currentPlayer)) return;

        // Next Turn
        currentPlayer = currentPlayer === P1 ? P2 : P1;
        setStatus();
        showGhost(col); // update ghost color immediately

        // Trigger AI if needed
        if (config.mode === 'PvAI' && gameActive) {
            els.status.textContent = "🤖 CPU Thinking...";
            setTimeout(processAiTurn, 100); // Slight delay for rendering
        }
    }
}

function executeMove(col, player) {
    const row = getNextOpenRow(col);
    if (row === -1) return -1;

    board[row][col] = player;
    moveHistory.push({ r: row, c: col, p: player });

    // Animate
    const pDiv = document.getElementById(`p-${row}-${col}`);
    pDiv.classList.add(player === P1 ? 'p1' : 'p2', 'drop');
    playSfx('drop');

    return row;
}

function getNextOpenRow(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === EMPTY) return r;
    }
    return -1;
}

function isValidMove(col) {
    return board[0][col] === EMPTY;
}

/* --- WIN CHECKER --- */
function checkGameEnd(lastR, lastC, p) {
    if (checkWin(board, p)) {
        gameActive = false;
        highlightWin(p);
        playSfx('win');

        // Determine who won for the modal
        // In OnlinePvP, 'p' is the player who just moved.
        // If I am P1 and P2 just moved and won, p is P2.
        showModal(p, false);

        if (config.mode === 'PvAI' && p === P1) fireConfetti();
        if (config.mode === 'OnlinePvP' && p === myOnlineRole) fireConfetti();

        return true;
    }
    if (board[0].every(c => c !== EMPTY)) {
        gameActive = false;
        showModal(0, true);
        return true;
    }
    return false;
}

function checkWin(b, p) {
    // Horiz
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS - 3; c++)
            if (b[r][c] == p && b[r][c + 1] == p && b[r][c + 2] == p && b[r][c + 3] == p) return true;
    // Vert
    for (let r = 0; r < ROWS - 3; r++)
        for (let c = 0; c < COLS; c++)
            if (b[r][c] == p && b[r + 1][c] == p && b[r + 2][c] == p && b[r + 3][c] == p) return true;
    // Diag \
    for (let r = 0; r < ROWS - 3; r++)
        for (let c = 0; c < COLS - 3; c++)
            if (b[r][c] == p && b[r + 1][c + 1] == p && b[r + 2][c + 2] == p && b[r + 3][c + 3] == p) return true;
    // Diag /
    for (let r = 3; r < ROWS; r++)
        for (let c = 0; c < COLS - 3; c++)
            if (b[r][c] == p && b[r - 1][c + 1] == p && b[r - 2][c + 2] == p && b[r - 3][c + 3] == p) return true;
    return false;
}

function highlightWin(p) {
    const directions = [[0, 1], [1, 0], [1, 1], [-1, 1]];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] !== p) continue;
            for (let [dr, dc] of directions) {
                let match = true;
                let coords = [];
                for (let i = 0; i < 4; i++) {
                    let nr = r + dr * i, nc = c + dc * i;
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== p) {
                        match = false; break;
                    }
                    coords.push([nr, nc]);
                }
                if (match) coords.forEach(([xr, xc]) => document.getElementById(`p-${xr}-${xc}`).classList.add('win'));
            }
        }
    }
}

/* --- AI SYSTEM (Minimax) --- */
function processAiTurn() {
    if (!gameActive) return;

    try {
        const move = getBestMove(board, currentPlayer);
        const row = executeMove(move, currentPlayer);

        if (checkGameEnd(row, move, currentPlayer)) return;

        currentPlayer = currentPlayer === P1 ? P2 : P1;
        setStatus();
    } catch (e) {
        console.error("AI Error:", e);
        currentPlayer = P1;
        setStatus();
        els.status.textContent = "CPU Error. Your Turn.";
    }
}

function getBestMove(b, player) {
    const movesMade = moveHistory.length;
    if (movesMade < 2) return Math.floor(Math.random() * 3) + 2;

    const opponent = player === P1 ? P2 : P1;
    const maxDepth = config.depth;

    let validMoves = [];
    for (let c = 0; c < COLS; c++) if (b[0][c] === EMPTY) validMoves.push(c);
    validMoves.sort((x, y) => Math.abs(3 - x) - Math.abs(3 - y));

    let bestScore = -Infinity;
    let bestMove = validMoves[0];
    let alpha = -Infinity;
    let beta = Infinity;

    for (let col of validMoves) {
        let r = getNextOpenRowTemp(b, col);
        b[r][col] = player;
        let score = minimax(b, maxDepth - 1, alpha, beta, false, player, opponent);
        b[r][col] = EMPTY;

        if (score > bestScore) {
            bestScore = score;
            bestMove = col;
        }
        alpha = Math.max(alpha, score);
    }
    return bestMove;
}

function minimax(b, depth, alpha, beta, isMax, me, opp) {
    if (checkWin(b, me)) return 10000 + depth;
    if (checkWin(b, opp)) return -10000 - depth;
    if (depth === 0) return evaluate(b, me, opp);

    let validMoves = [];
    for (let c = 0; c < COLS; c++) if (b[0][c] === EMPTY) validMoves.push(c);
    if (validMoves.length === 0) return 0;

    let minEval = Infinity;
    for (let col of validMoves) {
        let r = getNextOpenRowTemp(b, col);
        b[r][col] = opp;
        let moveEval = minimax(b, depth - 1, alpha, beta, true, me, opp);
        b[r][col] = EMPTY;
        minEval = Math.min(minEval, moveEval);
        beta = Math.min(beta, moveEval);
        if (beta <= alpha) break;
    }
    return minEval;
}


function evaluate(b, me, opp) {
    let score = 0;
    for (let r = 0; r < ROWS; r++) if (b[r][3] === me) score += 5;

    const scoreWindow = (cells) => {
        let sc = 0;
        let myC = cells.filter(c => c === me).length;
        let opC = cells.filter(c => c === opp).length;
        let emC = cells.filter(c => c === EMPTY).length;

        if (myC === 3 && emC === 1) sc += 50;
        else if (myC === 2 && emC === 2) sc += 10;

        if (opC === 3 && emC === 1) sc -= 60;
        return sc;
    };

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 3; c++)
        score += scoreWindow([b[r][c], b[r][c + 1], b[r][c + 2], b[r][c + 3]]);

    for (let r = 0; r < ROWS - 3; r++) for (let c = 0; c < COLS; c++)
        score += scoreWindow([b[r][c], b[r + 1][c], b[r + 2][c], b[r + 3][c]]);

    for (let r = 0; r < ROWS - 3; r++) for (let c = 0; c < COLS - 3; c++) {
        score += scoreWindow([b[r][c], b[r + 1][c + 1], b[r + 2][c + 2], b[r + 3][c + 3]]);
        score += scoreWindow([b[r + 3][c], b[r + 2][c + 1], b[r + 1][c + 2], b[r][c + 3]]);
    }
    return score;
}

function getNextOpenRowTemp(b, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (b[r][col] === EMPTY) return r;
    return -1;
}

/* --- AUDIO ENGINE --- */
let audioCtx = null;
function initAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
}

function toggleSound() {
    config.sound = !config.sound;
    els.sndBtn.textContent = config.sound ? '🔊' : '🔇';
}

function playSfx(type) {
    if (!config.sound || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'drop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'win') {
        const playNote = (f, d) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g);
            g.connect(audioCtx.destination);
            o.type = 'triangle';
            o.frequency.value = f;
            g.gain.setValueAtTime(0, now + d);
            g.gain.linearRampToValueAtTime(0.1, now + d + 0.1);
            g.gain.linearRampToValueAtTime(0, now + d + 0.4);
            o.start(now + d);
            o.stop(now + d + 0.4);
        };
        playNote(523.25, 0);
        playNote(659.25, 0.1);
        playNote(783.99, 0.2);
        playNote(1046.50, 0.4);
    }
}

/* --- PARTICLES (Confetti) --- */
const cvs = document.getElementById('confetti-canvas');
const ctx = cvs.getContext('2d');
let particles = [];

window.onresize = () => { cvs.width = window.innerWidth; cvs.height = window.innerHeight; };
window.onresize();

function fireConfetti() {
    particles = [];
    for (let i = 0; i < 100; i++) {
        particles.push({
            x: window.innerWidth / 2, y: window.innerHeight / 2,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            size: Math.random() * 6 + 2, life: 100
        });
    }
    requestAnimationFrame(updateConfetti);
}

function updateConfetti() {
    if (!particles.length) { ctx.clearRect(0, 0, cvs.width, cvs.height); return; }
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.3;
        p.life--; p.size *= 0.96;

        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();

        if (p.life <= 0) particles.splice(i, 1);
    }
    requestAnimationFrame(updateConfetti);
}

/* --- HELPERS --- */
function showGhost(c) {
    if (!gameActive) return;
    clearGhosts();
    const r = getNextOpenRow(c);
    if (r !== -1) {
        document.querySelector(`.cell[data-c='${c}'][data-r='${r}']`).classList.add(currentPlayer === P1 ? 'ghost-p1' : 'ghost-p2');
    }
}
function clearGhosts() {
    document.querySelectorAll('.ghost-p1, .ghost-p2').forEach(e => e.classList.remove('ghost-p1', 'ghost-p2'));
}
function setStatus() {
    if (!gameActive) return;
    if (!els.status) return;

    if (config.mode === 'PvAI') {
        if (currentPlayer === P1) {
            els.status.textContent = "Your Turn";
            els.status.style.color = 'var(--p1-color)';
        } else {
            els.status.textContent = "CPU Thinking...";
            els.status.style.color = 'var(--p2-color)';
        }
    } else {
        const name = (currentPlayer === P1) ? 'Player 1' : 'Player 2';
        els.status.textContent = `${name} Turn`;
        els.status.style.color = currentPlayer === P1 ? 'var(--p1-color)' : 'var(--p2-color)';
    }
}

function showModal(winner, draw) {
    if (draw) {
        els.mTitle.textContent = "Draw!";
        els.mTitle.style.color = '#666';
        els.mMsg.textContent = "The board is full.";
    } else {
        if (config.mode === 'PvAI') {
            els.mTitle.textContent = winner === P1 ? "You Win!" : "AI Wins!";
            els.mTitle.style.color = winner === P1 ? 'var(--p1-color)' : 'var(--p2-color)';
            els.mMsg.textContent = winner === P1 ? "Congratulations!" : "Better luck next time.";
        } else {
            // Online PvP
            if (winner === myOnlineRole) {
                els.mTitle.textContent = "You Win!";
                els.mTitle.style.color = 'var(--accent)';
                els.mMsg.textContent = "Congratulations!";
            } else {
                els.mTitle.textContent = "You Lose!";
                els.mTitle.style.color = '#666';
                els.mMsg.textContent = "Your opponent won this round.";
            }
        }
    }
    setTimeout(() => els.modal.classList.add('active'), 600);
}

function closeModal() {
    els.modal.classList.remove('active');
    showMainMenu();
    fullReset(); // Reset board state when returning to menu
}

function quitGame() {
    if (gameActive) {
        gameActive = false;
        // If online, maybe emit a quit event?
        if (config.mode === 'OnlinePvP' && socket && socket.connected) {
            // The server likely handles disconnect, but we can be explicit if needed.
            // For now, just treating it as a local loss/quit.
            // If we want to notify opponent of quit explicitly:
            // socket.emit('quit_game', { room: onlineRoom }); 
            // (Already handled in showMainMenu -> quit_game emit)
        }

        els.mTitle.textContent = "You Quit";
        els.mTitle.style.color = '#666';
        els.mMsg.textContent = "Game ended.";
        els.modal.classList.add('active');
    } else {
        showMainMenu();
    }
}

// Boot
/* --- ONLINE MULTIPLAYER --- */
/* --- ONLINE MULTIPLAYER --- */
let socket;
let myOnlineRole = null; // P1 or P2
let onlineRoom = null;

try {
    if (typeof io !== 'undefined') {
        socket = io();
        socket.on('connect', () => {
            console.log('Connected to server:', socket.id);
        });
    } else {
        throw new Error('Socket.io not found');
    }
} catch (e) {
    console.warn("Online features disabled:", e.message);
    // Mock socket to prevent crashes in offline mode
    socket = {
        on: () => { },
        emit: () => { },
        connected: false
    };
}

socket.on('waiting_for_opponent', () => {
    els.status.textContent = "Searching for opponent...";
    gameActive = false;
});

socket.on('private_created', (data) => {
    hideAllMenus();
    if (els.onlineWaiting) els.onlineWaiting.style.display = 'flex';
    if (els.omCodeDisplay) els.omCodeDisplay.textContent = data.code;
});

socket.on('error_msg', (data) => {
    alert(data.msg);
});

socket.on('game_start', (data) => {
    myOnlineRole = data.role; // 1 or 2
    onlineRoom = data.room;

    hideAllMenus();
    els.gameWrapper.style.display = 'block';
    els.controls.style.display = 'flex';
    els.statusBar.style.display = 'block';

    createGrid();
    fullReset();
    gameActive = true;

    const roleName = myOnlineRole === P1 ? "Player 1 (Red)" : "Player 2 (Yellow)";
    els.status.textContent = `Game Started! You are ${roleName}`;

    if (myOnlineRole === P2) {
        els.status.textContent += ". Waiting for Opponent...";
    } else {
        els.status.textContent += ". Your Turn!";
    }
});

socket.on('opponent_move', (data) => {
    // Even if gameActive is false (e.g. just finished), we might need to process the final move?
    // But usually if gameActive is false, it means game over.
    // However, if I am the loser, the winner made the move that ended the game.
    // So I need to process it.

    // data: { col, player }
    const row = executeMove(data.col, data.player);
    if (row === -1) return;

    // Check if this move ended the game
    if (checkGameEnd(row, data.col, data.player)) return;

    currentPlayer = currentPlayer === P1 ? P2 : P1;
    setStatus();
});

socket.on('game_won_by_quit', () => {
    gameActive = false;
    els.status.textContent = "Opponent Quit! You Win!";
    els.status.style.color = 'var(--accent)';
    showModal(myOnlineRole, false);
});

/* --- ONLINE MENU FUNCTIONS --- */
function joinRandom() {
    hideAllMenus();
    if (els.gameWrapper) els.gameWrapper.style.display = 'block';
    if (els.controls) els.controls.style.display = 'flex';
    if (els.statusBar) els.statusBar.style.display = 'block';
    socket.emit('find_match');
    els.status.textContent = "Searching for random opponent...";
}

function createPrivate() {
    const pref = parseInt(els.onlineTurnPref.value);
    socket.emit('create_private', { role_pref: pref });
}

function joinPrivate() {
    const code = els.omCodeInput.value;
    if (code.length !== 4) { alert("Please enter a 4-digit code"); return; }
    socket.emit('join_private', { code: code });
}

// Start the game
// init() is called via DOMContentLoaded above
