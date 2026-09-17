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

const KICKS_PER_PLAYER = 5;       // هر بازیکن ۵ ضربه میزند
const ROUND_ANIM_MS = 4500;       // مدت نمایش نتیجه هر ضربه
const RECONNECT_GRACE_MS = 60000; // فرصت برگشت بعد از قطع شدن

// شروع ربات تلگرام
const TelegramBot = require('node-telegram-bot-api');
const BOT_TOKEN = process.env.BOT_TOKEN || '8996508732:AAEZU1IanYRb_w5Q0_YETYDKsfkNyvDNWZ8';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://penalty-twa.onrender.com';

let bot = null;
try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram Bot is running...');

  // /start بدون payload → منو | /start room_xxx → ورود به زمین دوست
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'بازیکن';

    const parts = (msg.text || '').split(' ');
    const payload = parts.length > 1 ? parts[1].trim() : null;

    if (payload && payload.startsWith('room_')) {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🎮 ورود به زمین دوستت',
                web_app: { url: `${WEB_APP_URL}?room=${payload}` }
              }
            ]
          ]
        }
      };
      bot.sendMessage(chatId,
        `⚽ سلام ${firstName}!\n\nبازیکن اول منتظرته! برای شروع بازی روی دکمه زیر بزن 👇`,
        keyboard
      );
      return;
    }

    const welcomeMessage = `⚽ سلام ${firstName}!

به بازی **ضربات پنالتی** خوش اومدی! 🎯

🎮 **نحوه بازی:**
• یک مسابقه جدید بساز و لینکش رو برای دوستت بفرست
• هر بازیکن ۵ ضربه میزنه (شوت و دروازه‌بانی یکی‌یکی)
• کی بیشترین گل رو بزنه برنده‌ست! 🏆`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎮 شروع بازی', web_app: { url: WEB_APP_URL } }
          ],
          [
            { text: '📖 راهنمای بازی', callback_data: 'help' }
          ]
        ]
      }
    };

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    if (callbackQuery.data === 'help') {
      bot.sendMessage(chatId, `📖 **راهنمای بازی پنالتی:**

⚽ دو بازیکن آنلاین مقابل هم. هرکدام ۵ ضربه.

🔄 نوبت‌ها یکی‌یکی عوض میشه: یک ضربه تو شوت میزنی، یک ضربه گلر میشی.

🎯 **پنالتی‌زن:** گوشه دروازه رو انتخاب کن.
🧤 **دروازه‌بان:** حدس بزن توپ کجا میره و شیرجه بزن.

🏆 بعد از ۱۰ ضربه، هرکی گل بیشتری زده برنده‌ست!`);
    }
    bot.answerCallbackQuery(callbackQuery.id);
  });

  bot.on('polling_error', (error) => {
    console.error('Bot polling error:', error.code);
  });
} catch (e) {
  console.error('Bot failed to start:', e.message);
}

// ===== توابع کمکی بازی =====

function publicRoom(room) {
  return {
    id: room.id,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, disconnected: !!p.disconnected })),
    kickerIndex: room.kickerIndex,
    goalieIndex: room.goalieIndex,
    currentKicker: room.players[room.kickerIndex],
    currentGoalie: room.players[room.goalieIndex],
    kickNumber: room.kickNumber,          // ضربه چندم از ۵ ضربه‌ی هر تیم
    turn: room.turn,                      // 'A' یعنی بازیکن اول شوت‌زن است
    totalKicks: KICKS_PER_PLAYER,
    history: room.history,                // [{by: playerId, goal: bool}]
    status: room.status
  };
}

// آیا هر دو همه ضربه‌ها را زده‌اند؟
function allKicksDone(room) {
  return room.history.filter(h => h.by === room.players[0].id).length >= KICKS_PER_PLAYER &&
         room.history.filter(h => h.by === room.players[1].id).length >= KICKS_PER_PLAYER;
}

// آیا بازی از قبل مشخص شده؟ (ریاضی کارت‌ها تمام)
function earlyWinner(room) {
  const s0 = room.players[0].score;
  const s1 = room.players[1].score;
  const k0 = KICKS_PER_PLAYER - room.history.filter(h => h.by === room.players[0].id).length; // ضربه‌های باقی‌مانده پ1
  const k1 = KICKS_PER_PLAYER - room.history.filter(h => h.by === room.players[1].id).length;

  if (s0 > s1 + k1) return room.players[0];
  if (s1 > s0 + k0) return room.players[1];
  return null;
}

// نوبت بعدی: شوت و گلر جابجا میشوند
function nextTurn(room) {
  room.turn = room.turn === 'A' ? 'B' : 'A';
  room.kickNumber = Math.floor(room.history.length / 2) + 1;

  if (room.turn === 'A') {
    room.kickerIndex = 0;
    room.goalieIndex = 1;
  } else {
    room.kickerIndex = 1;
    room.goalieIndex = 0;
  }
  room.choices = { kicker: null, goalie: null };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ۱. ساخت یا ورود به اتاق
  socket.on('joinRoom', ({ roomId, playerName, playerAvatar, playerTgId }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      // ایجاد اتاق جدید
      rooms[roomId] = {
        id: roomId,
        players: [{ id: socket.id, tgId: playerTgId, name: playerName || 'Player 1', avatar: playerAvatar, score: 0, disconnected: false }],
        round: 1,
        kickerIndex: 0,
        goalieIndex: null,
        choices: { kicker: null, goalie: null },
        turn: 'A',
        kickNumber: 1,
        history: [],
        status: 'waiting'
      };
      socket.emit('roomCreated', { roomId, role: 'kicker' });
      return;
    }

    const room = rooms[roomId];

    // ریکانکت با tgId
    const rejoinIdx = room.players.findIndex(p => p.tgId && playerTgId && p.tgId === playerTgId);
    if (rejoinIdx !== -1) {
      room.players[rejoinIdx].id = socket.id;
      room.players[rejoinIdx].disconnected = false;
      socket.emit('roomRejoined', {
        room: publicRoom(room),
        role: rejoinIdx === room.kickerIndex ? 'kicker' : 'goalie'
      });
      io.to(roomId).emit('playerReconnected');
      return;
    }

    if (room.players.length === 1 && room.players[0].id !== socket.id) {
      // بازیکن دوم
      room.players.push({ id: socket.id, tgId: playerTgId, name: playerName || 'Player 2', avatar: playerAvatar, score: 0, disconnected: false });
      room.goalieIndex = 1;
      room.status = 'playing';

      io.to(roomId).emit('gameStart', {
        room: publicRoom(room),
        kicker: room.players[0],
        goalie: room.players[1],
        round: 1
      });
    } else {
      socket.emit('roomFull');
    }
  });

  // ۲. حرکت (شوت یا شیرجه)
  socket.on('makeMove', ({ roomId, direction }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const isKicker = socket.id === room.players[room.kickerIndex].id;
    const isGoalie = socket.id === room.players[room.goalieIndex].id;

    if (isKicker) room.choices.kicker = direction;
    else if (isGoalie) room.choices.goalie = direction;
    else return;

    socket.to(roomId).emit('opponentMoved');

    if (room.choices.kicker && room.choices.goalie) {
      const kicker = room.players[room.kickerIndex];
      const isGoal = room.choices.kicker !== room.choices.goalie;
      if (isGoal) kicker.score += 1;

      room.history.push({ by: kicker.id, goal: isGoal });

      io.to(roomId).emit('roundResult', {
        kickerChoice: room.choices.kicker,
        goalieChoice: room.choices.goalie,
        isGoal: isGoal,
        kickerId: kicker.id,
        kickerName: kicker.name,
        scores: {
          [room.players[0].id]: room.players[0].score,
          [room.players[1].id]: room.players[1].score
        },
        history: room.history,
        kickNumber: room.kickNumber
      });

      room.choices = { kicker: null, goalie: null };

      setTimeout(() => {
        const r = rooms[roomId];
        if (!r) return;

        const earlyWin = earlyWinner(r);
        if (allKicksDone(r) || earlyWin) {
          r.status = 'finished';
          let winner = earlyWin;
          if (!winner && allKicksDone(r)) {
            if (r.players[0].score > r.players[1].score) winner = r.players[0];
            else if (r.players[1].score > r.players[0].score) winner = r.players[1];
          }

          io.to(roomId).emit('gameOver', {
            winner,
            players: r.players,
            history: r.history
          });
          // اتاق ۶۰ ثانیه برای ریمچ نگه داشته می‌شود
          setTimeout(() => { if (rooms[roomId] && rooms[roomId].status === 'finished') delete rooms[roomId]; }, RECONNECT_GRACE_MS);
        } else {
          nextTurn(r);
          io.to(roomId).emit('nextTurn', {
            room: publicRoom(r),
            kicker: r.players[r.kickerIndex],
            goalie: r.players[r.goalieIndex],
            kickNumber: r.kickNumber,
            turn: r.turn
          });
        }
      }, ROUND_ANIM_MS);
    }
  });

  // ۳. درخواست بازی مجدد
  socket.on('rematch', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'finished') return;

    room.status = 'waiting';
    room.players.forEach(p => { p.score = 0; });
    room.turn = 'A';
    room.kickNumber = 1;
    room.history = [];
    room.kickerIndex = 0;
    room.goalieIndex = 1;
    room.choices = { kicker: null, goalie: null };

    io.to(roomId).emit('gameStart', {
      room: publicRoom(room),
      kicker: room.players[0],
      goalie: room.players[1],
      round: 1
    });
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players[idx].disconnected = true;

        if (room.status === 'playing' || room.status === 'finished') {
          io.to(roomId).emit('opponentDisconnected');
          setTimeout(() => {
            const r = rooms[roomId];
            if (r && r.players.some(p => p.disconnected)) {
              io.to(roomId).emit('roomClosed');
              delete rooms[roomId];
            }
          }, RECONNECT_GRACE_MS);
        } else {
          delete rooms[roomId];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`⚡ Penalty Game running on port ${PORT}`));
