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

const KICKS_PER_PLAYER = 5;        // هر بازیکن ۵ ضربه میزند
const ROUND_ANIM_MS = 4500;        // مدت نمایش نتیجه هر ضربه
const RECONNECT_GRACE_MS = 60000;  // فرصت برگشت بعد از قطع شدن وسط بازی
const WAITING_GRACE_MS = 10000;    // فرصت برگشت بعد از قطع شدن در حالت انتظار (رفرش صفحه)
const ROOM_TTL_MS = 30 * 60 * 1000; // عمر اتاق رهاشده (پاک‌سازی اتاق‌های شبح)
const VALID_DIRS = ['left', 'center', 'right'];

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
    players: room.players.map(p => ({ name: p.name, avatar: p.avatar, score: p.score, disconnected: !!p.disconnected })),
    kickerIndex: room.kickerIndex,
    goalieIndex: room.goalieIndex,
    kickNumber: room.kickNumber,          // ضربه چندم از ۵ ضربه‌ی هر تیم
    totalKicks: KICKS_PER_PLAYER,
    history: room.history,                // [{by: 0|1, goal: bool}]
    status: room.status
  };
}

// تعداد ضربه‌های زده‌شده‌ی هر بازیکن (بر اساس ایندکس 0 یا 1)
function kicksTaken(room, idx) {
  return room.history.filter(h => h.by === idx).length;
}

// آیا هر دو همه ضربه‌ها را زده‌اند؟
function allKicksDone(room) {
  return kicksTaken(room, 0) >= KICKS_PER_PLAYER && kicksTaken(room, 1) >= KICKS_PER_PLAYER;
}

// آیا بازی از قبل مشخص شده؟ (ریاضی کارت‌ها تمام)
function earlyWinnerIndex(room) {
  const s0 = room.players[0].score;
  const s1 = room.players[1].score;
  const k0 = KICKS_PER_PLAYER - kicksTaken(room, 0); // ضربه‌های باقی‌مانده پ1
  const k1 = KICKS_PER_PLAYER - kicksTaken(room, 1); // ضربه‌های باقی‌مانده پ2

  if (s0 > s1 + k1) return 0;
  if (s1 > s0 + k0) return 1;
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

  // ۱. ساخت مسابقه جدید — فقط صاحب لینک این را می‌فرستد
  socket.on('createRoom', ({ playerName, playerAvatar, playerTgId }) => {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 8);
    socket.join(roomId);

    rooms[roomId] = {
      id: roomId,
      players: [{ id: socket.id, tgId: playerTgId != null ? String(playerTgId) : null, name: playerName || 'بازیکن ۱', avatar: playerAvatar, score: 0, disconnected: false }],
      kickerIndex: 0,
      goalieIndex: null,
      choices: { kicker: null, goalie: null },
      turn: 'A',
      kickNumber: 1,
      history: [],
      status: 'waiting',
      lastActivity: Date.now()
    };
    socket.emit('roomCreated', { roomId, youIndex: 0 });
  });

  // ۲. ورود به اتاق — فقط با roomId معتبر (لینک دعوت یا ریکانکت)
  socket.on('joinRoom', ({ roomId, playerName, playerAvatar, playerTgId }) => {
    if (!roomId || typeof roomId !== 'string') return;

    const room = rooms[roomId];

    // ❗ اتاق وجود ندارد — لینک قدیمی/منقضی. هیچ اتاق شبحی ساخته نمیشود.
    if (!room) {
      socket.emit('roomNotFound', { roomId });
      return;
    }

    room.lastActivity = Date.now();
    socket.join(roomId);

    // ریکانکت: اول با tgId چک کن، بعد با socket.id
    let rejoinIdx = room.players.findIndex(p => p.tgId && playerTgId != null && p.tgId === String(playerTgId));
    if (rejoinIdx === -1) {
      rejoinIdx = room.players.findIndex(p => p.id === socket.id);
    }

    if (rejoinIdx !== -1) {
      // بازیکن قبلی برگشته (رفرش صفحه، قطع شدن اینترنت، یا کلیک دوباره)
      room.players[rejoinIdx].id = socket.id;
      room.players[rejoinIdx].disconnected = false;
      socket.emit('roomRejoined', { room: publicRoom(room), youIndex: rejoinIdx });
      socket.to(roomId).emit('playerReconnected');
      return;
    }

    // بازیکن دوم
    if (room.players.length === 1) {
      room.players.push({ id: socket.id, tgId: playerTgId != null ? String(playerTgId) : null, name: playerName || 'بازیکن ۲', avatar: playerAvatar, score: 0, disconnected: false });
      room.goalieIndex = 1;
      room.status = 'playing';
      room.kickerIndex = 0;

      // هر بازیکن باید بدونه خودش کدوم بازیکن هست (ایندکس 0 یا 1)
      io.to(room.players[0].id).emit('gameStart', { room: publicRoom(room), youIndex: 0 });
      io.to(room.players[1].id).emit('gameStart', { room: publicRoom(room), youIndex: 1 });
    } else {
      socket.emit('roomFull');
    }
  });

  // ۳. حرکت (شوت یا شیرجه)
  socket.on('makeMove', ({ roomId, direction }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;
    if (!VALID_DIRS.includes(direction)) return;

    const kicker = room.players[room.kickerIndex];
    const goalie = room.players[room.goalieIndex];

    if (socket.id === kicker.id) {
      if (room.choices.kicker) return; // جلوگیری از دو بار انتخاب
      room.choices.kicker = direction;
    } else if (socket.id === goalie.id) {
      if (room.choices.goalie) return;
      room.choices.goalie = direction;
    } else {
      return; // این بازیکن نوبتش نیست!
    }

    room.lastActivity = Date.now();
    socket.to(roomId).emit('opponentMoved');

    if (room.choices.kicker && room.choices.goalie) {
      // ⚽ قانون درست: اگه گلر همون جهتی رو که شوت شده رو انتخاب کنه، توپ گرفته میشه
      const isGoal = room.choices.kicker !== room.choices.goalie;
      if (isGoal) kicker.score += 1;

      // تاریخچه با ایندکس بازیکن (0 یا 1) ذخیره میشه
      room.history.push({ by: room.kickerIndex, goal: isGoal });

      io.to(roomId).emit('roundResult', {
        kickerIndex: room.kickerIndex,
        kickerChoice: room.choices.kicker,
        goalieChoice: room.choices.goalie,
        isGoal: isGoal,
        scores: [room.players[0].score, room.players[1].score],
        history: room.history,
        kickNumber: room.kickNumber
      });

      room.choices = { kicker: null, goalie: null };

      setTimeout(() => {
        const r = rooms[roomId];
        if (!r || r.status !== 'playing') return;

        const earlyWin = earlyWinnerIndex(r);
        if (allKicksDone(r) || earlyWin !== null) {
          r.status = 'finished';
          let winnerIndex = earlyWin;
          if (winnerIndex === null && allKicksDone(r)) {
            if (r.players[0].score > r.players[1].score) winnerIndex = 0;
            else if (r.players[1].score > r.players[0].score) winnerIndex = 1;
          }

          io.to(roomId).emit('gameOver', {
            winnerIndex,
            scores: [r.players[0].score, r.players[1].score],
            history: r.history
          });
          // اتاق ۶۰ ثانیه برای بازی مجدد نگه داشته می‌شود
          setTimeout(() => { if (rooms[roomId] && rooms[roomId].status === 'finished') delete rooms[roomId]; }, RECONNECT_GRACE_MS);
        } else {
          nextTurn(r);
          io.to(roomId).emit('nextTurn', { room: publicRoom(r) });
        }
      }, ROUND_ANIM_MS);
    }
  });

  // ۴. بازی مجدد
  socket.on('rematch', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.status !== 'finished') return;

    room.status = 'playing';
    room.players.forEach(p => { p.score = 0; p.disconnected = false; });
    room.turn = 'A';
    room.kickNumber = 1;
    room.history = [];
    room.kickerIndex = 0;
    room.goalieIndex = 1;
    room.choices = { kicker: null, goalie: null };
    room.lastActivity = Date.now();

    io.to(room.players[0].id).emit('gameStart', { room: publicRoom(room), youIndex: 0 });
    io.to(room.players[1].id).emit('gameStart', { room: publicRoom(room), youIndex: 1 });
  });

  // ۵. خروج داوطلب (دکمه بازگشت به لابی)
  socket.on('leaveRoom', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    room.players[idx].disconnected = true;
    socket.leave(roomId);

    if (room.status === 'waiting') {
      // هنوز کسی نیامده — کمی فرصت بده برگردد (رفرش)، بعد پاک کن
      setTimeout(() => {
        const r = rooms[roomId];
        if (r && r.status === 'waiting' && r.players.every(p => p.disconnected)) {
          delete rooms[roomId];
          console.log('Room removed (host left waiting):', roomId);
        }
      }, WAITING_GRACE_MS);
    } else {
      // وسط بازی رفته — مثل قطع شدن
      io.to(roomId).emit('opponentDisconnected');
    }
  });

  // ۶. قطع شدن اتصال
  socket.on('disconnect', () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;

      room.players[idx].disconnected = true;

      if (room.status === 'waiting') {
        // ❗ اتاقِ در حال انتظار فوراً پاک نمیشود — شاید رفرش کرده باشد.
        // اگر تا ۱۰ ثانیه برنگشت، اتاق حذف میشود تا لینک قدیمی به اتاق شبح نخورد.
        setTimeout(() => {
          const r = rooms[roomId];
          if (r && r.status === 'waiting' && r.players.every(p => p.disconnected)) {
            delete rooms[roomId];
            console.log('Room removed (waiting, host gone):', roomId);
          }
        }, WAITING_GRACE_MS);
      } else {
        // وسط بازی یا بعد از پایان — ۶۰ ثانیه فرصت برگشت
        io.to(roomId).emit('opponentDisconnected');
        setTimeout(() => {
          const r = rooms[roomId];
          if (r && r.players.some(p => p.disconnected)) {
            io.to(roomId).emit('roomClosed');
            delete rooms[roomId];
            console.log('Room removed (player never returned):', roomId);
          }
        }, RECONNECT_GRACE_MS);
      }
      break;
    }
  });
});

// پاک‌سازی اتاق‌های شبح (رهاشده) — هر ۵ دقیقه
setInterval(() => {
  const now = Date.now();
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    const idleFor = now - (room.lastActivity || 0);
    const everyoneGone = room.players.every(p => p.disconnected);

    if (room.status === 'waiting' && everyoneGone && idleFor > WAITING_GRACE_MS) {
      delete rooms[roomId];
      console.log('Ghost waiting room swept:', roomId);
    } else if (idleFor > ROOM_TTL_MS) {
      io.to(roomId).emit('roomClosed');
      delete rooms[roomId];
      console.log('Stale room swept:', roomId);
    }
  }
}, 5 * 60 * 1000);

// Keep-alive: چون پلن رایگان Render بعد از ۱۵ دقیقه بی‌کاری می‌خوابد،
// هر ۱۰ دقیقه یک بار خودمان را ping می‌کنیم تا سرویس بیدار بماند
// و لینک‌های دعوت وسط روز مُرد نشوند.
const SELF_URL = process.env.SELF_URL || WEB_APP_URL;
setInterval(() => {
  http.get(`${SELF_URL}/health`, () => {}).on('error', () => {});
}, 10 * 60 * 1000);

app.get('/health', (req, res) => res.json({ ok: true, rooms: Object.keys(rooms).length, uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`⚡ Penalty Game running on port ${PORT}`));
