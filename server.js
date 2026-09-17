const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// دیتابیس موقت در حافظه (In-Memory Game Rooms)
const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ۱. ساخت یا ورود به اتاق
  socket.on('joinRoom', ({ roomId, playerName, playerAvatar }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      // ایجاد اتاق جدید (بازیکن اول = پنالتی‌زن دور اول)
      rooms[roomId] = {
        id: roomId,
        players: [{ id: socket.id, name: playerName || 'Player 1', avatar: playerAvatar, score: 0 }],
        round: 1,
        kickerIndex: 0,
        goalieIndex: null,
        choices: { kicker: null, goalie: null },
        status: 'waiting' // waiting, playing, finished
      };
      socket.emit('roomCreated', { roomId, role: 'kicker' });
    } else {
      const room = rooms[roomId];
      if (room.players.length === 1 && room.players[0].id !== socket.id) {
        // بازیکن دوم وارد می‌شود (دروازه‌بان دور اول)
        room.players.push({ id: socket.id, name: playerName || 'Player 2', avatar: playerAvatar, score: 0 });
        room.goalieIndex = 1;
        room.status = 'playing';
        
        io.to(roomId).emit('gameStart', {
          room,
          kicker: room.players[room.kickerIndex],
          goalie: room.players[room.goalieIndex],
          round: room.round
        });
      } else {
        socket.emit('roomFull');
      }
    }
  });

  // ۲. دریافت تصمیم شوت یا شیرجه
  socket.on('makeMove', ({ roomId, direction }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const isKicker = socket.id === room.players[room.kickerIndex].id;
    const isGoalie = socket.id === room.players[room.goalieIndex].id;

    if (isKicker) {
      room.choices.kicker = direction; // 'left' | 'center' | 'right'
    } else if (isGoalie) {
      room.choices.goalie = direction; // 'left' | 'center' | 'right'
    }

    // به حریف اطلاع بده که بازیکن مقابل حرکتش رو زد (جهت لو داده نمیشه!)
    socket.to(roomId).emit('opponentMoved');

    // اگر هر دو نفر انتخاب کردند، نتیجه رو محاسبه کن
    if (room.choices.kicker && room.choices.goalie) {
      const isGoal = room.choices.kicker !== room.choices.goalie;
      
      if (isGoal) {
        room.players[room.kickerIndex].score += 1;
      }

      const resultData = {
        kickerChoice: room.choices.kicker,
        goalieChoice: room.choices.goalie,
        isGoal: isGoal,
        scores: {
          [room.players[0].id]: room.players[0].score,
          [room.players[1].id]: room.players[1].score
        },
        round: room.round
      };

      // ارسال انیمیشن و نتیجه راند به هر دو
      io.to(roomId).emit('roundResult', resultData);

      // پاک کردن انتخاب‌ها
      room.choices = { kicker: null, goalie: null };

      // جابجایی نقش‌ها برای راند ۲ یا اتمام بازی
      setTimeout(() => {
        if (room.round === 1) {
          room.round = 2;
          // جابجایی جای شوت‌زن و گلر
          room.kickerIndex = 1;
          room.goalieIndex = 0;

          io.to(roomId).emit('nextRound', {
            round: 2,
            kicker: room.players[room.kickerIndex],
            goalie: room.players[room.goalieIndex]
          });
        } else {
          // پایان بازی (راند ۲ تمام شد)
          room.status = 'finished';
          let winner = null;
          if (room.players[0].score > room.players[1].score) winner = room.players[0];
          else if (room.players[1].score > room.players[0].score) winner = room.players[1];

          io.to(roomId).emit('gameOver', {
            winner: winner, // null یعنی مساوی
            players: room.players
          });
          delete rooms[roomId]; // پاک‌سازی حافظه
        }
      }, 4500); // ۴.۵ ثانیه وقفه برای پخش انیمیشن‌ها
    }
  });

  socket.on('disconnect', () => {
    // مدیریت قطع اتصال
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.some(p => p.id === socket.id)) {
        io.to(roomId).emit('playerDisconnected');
        delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`⚡ Penalty Game running on port ${PORT}`));
