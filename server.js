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

            // Randomize roles
            const rand = Math.random();
            const p1Role = rand < 0.5 ? 1 : 2;
            const p2Role = p1Role === 1 ? 2 : 1;

            // Notify players
            p1.emit('game_start', { role: p1Role, room: room });
            p2.emit('game_start', { role: p2Role, room: room });

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
    socket.on('create_private', (data) => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        // data.role_pref: 1 (First) or 2 (Second)
        // If creator wants 1, they are p1. If 2, they are p2 (so we store them as p2 in the object? No, easier to store as creator and assign role later)
        // Actually, let's store explicit roles.
        // privateRooms[code] = { p1: socket, p2: null ... } implies p1 is the one who created? Not necessarily.
        // Let's stick to: p1 field is "Player A", p2 field is "Player B".
        // We will assign roles when game starts.

        const pref = data && data.role_pref ? data.role_pref : 1;

        privateRooms[code] = {
            creator: socket,
            joiner: null,
            room: `private_${code}`,
            creatorRole: pref
        };

        socket.join(privateRooms[code].room);
        socket.emit('private_created', { code: code });
        console.log(`Private room created: ${code} with pref ${pref}`);
    });

    socket.on('join_private', (data) => {
        const code = data.code;
        const roomData = privateRooms[code];

        if (roomData && !roomData.joiner) {
            roomData.joiner = socket;
            const room = roomData.room;

            socket.join(room);

            // Assign roles based on creator preference
            const creatorRole = roomData.creatorRole;
            const joinerRole = creatorRole === 1 ? 2 : 1;

            // Notify players
            roomData.creator.emit('game_start', { role: creatorRole, room: room });
            roomData.joiner.emit('game_start', { role: joinerRole, room: room });

            console.log(`Private Game started in ${room}`);
            // Keep room in privateRooms to handle restarts if needed
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

    socket.on('quit_game', (data) => {
        // data: { room }
        socket.to(data.room).emit('game_won_by_quit');
        // Cleanup room? Maybe wait for disconnect
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }

        // Check private rooms
        for (const code in privateRooms) {
            const r = privateRooms[code];
            if (r.creator === socket || r.joiner === socket) {
                // Notify other player if game was potentially active or forming
                const other = r.creator === socket ? r.joiner : r.creator;
                if (other) other.emit('game_won_by_quit'); // Treat disconnect as quit/win
                delete privateRooms[code];
                break;
            }
        }

        // We also need to check active rooms that might not be in 'privateRooms' map if we deleted them on start
        // But for now, since we kept them in privateRooms (commented out delete), this works for private.
        // For random rooms, we need a way to track them.
        // Since we didn't implement a global 'rooms' map for random games, we rely on socket.rooms.
        // However, socket.rooms is cleared on disconnect.
        // A robust solution requires mapping socket.id -> room.
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
