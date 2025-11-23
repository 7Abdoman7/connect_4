const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(__dirname));

// Game State
let waitingPlayer = null;
const privateRooms = {}; // { code: { p1: socket, p2: socket, room: string } }

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- RANDOM MATCHMAKING ---
    socket.on('find_match', () => {
        if (waitingPlayer && waitingPlayer.id !== socket.id) {
            // Match found
            const room = `room_${waitingPlayer.id}_${socket.id}`;
            const p1 = waitingPlayer;
            const p2 = socket;

            p1.join(room);
            p2.join(room);

            // Notify players
            p1.emit('game_start', { role: 1, room: room }); // Player 1 (Red)
            p2.emit('game_start', { role: 2, room: room }); // Player 2 (Yellow)

            console.log(`Random Game started in ${room}`);
            waitingPlayer = null;
        } else {
            // Wait for opponent
            waitingPlayer = socket;
            socket.emit('waiting_for_opponent');
            console.log('User waiting for random opponent:', socket.id);
        }
    });

    // --- PRIVATE ROOMS ---
    socket.on('create_private', () => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        privateRooms[code] = { p1: socket, p2: null, room: `private_${code}` };
        socket.join(privateRooms[code].room);
        socket.emit('private_created', { code: code });
        console.log(`Private room created: ${code}`);
    });

    socket.on('join_private', (data) => {
        const code = data.code;
        const roomData = privateRooms[code];

        if (roomData && !roomData.p2) {
            roomData.p2 = socket;
            const room = roomData.room;

            socket.join(room);

            // Notify players
            roomData.p1.emit('game_start', { role: 1, room: room });
            roomData.p2.emit('game_start', { role: 2, room: room });

            console.log(`Private Game started in ${room}`);
            // Keep room in privateRooms to handle restarts if needed, or move to a activeGames map
            // For simplicity, we keep it but might need cleanup logic later
        } else {
            socket.emit('error_msg', { msg: "Invalid code or room full" });
        }
    });

    socket.on('request_restart', (data) => {
        io.to(data.room).emit('restart_game');
    });

    socket.on('make_move', (data) => {
        // data: { room, col, player }
        socket.to(data.room).emit('opponent_move', data);
    });

    socket.on('game_over', (data) => {
        // data: { room, winner }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }
        // Basic cleanup for private rooms if creator leaves before start
        for (const code in privateRooms) {
            if (privateRooms[code].p1 === socket) {
                delete privateRooms[code];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
