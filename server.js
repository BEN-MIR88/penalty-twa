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

// زمان امن برای ریکانکت: اگر بازیکن قطع شد، ۶۰ ثانیه فرصت برگشت داره
const RECONNECT_GRACE_MS = 60000;

// شروع ربات تلگرام
const TelegramBot = require('node-telegram-bot-api');
const BOT_TOKEN = process.env.BOT_TOKEN || '8996508732:AAEZU1IanYRb_w5Q0_YETYDKsfkNyvDNWZ8';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://penalty-twa.onrender.com';

let bot = null;
try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram Bot is running...');

  // دستور /start — بدون payload: منوی اصلی
  // دستور /start room_xxx — با payload: ورود مستقیم به زمین دوستت
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'بازیکن';

    // payload بعد از /start (مثلاً /start room_abc123)
    const parts = (msg.text || '').split(' ');
    const payload = parts.length > 1 ? parts[1].trim() : null;

    if (payload && payload.startsWith('room_')) {
      // بازیکن دوم از روی لینک دعوت اومده → مستقیم به زمین دوستش ببرش
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
        `⚽ سلام ${firstName}!\n\n${'بازیکن اول منتظرته! لینک دعوت او را باز کردی.'}\n\nبرای شروع بازی روی دکمه زیر بزن 👇`,
        keyboard
      );
      return;
    }

    // /start معمولی → منوی اصلی
    const welcomeMessage = `⚽ سلام ${firstName}!

به بازی **ضربات پنالتی** خوش اومدی! 🎯

🎮 **نحوه بازی:**
• یک مسابقه جدید بساز
• لینک دعوت رو برای دوستت بفرست
• هر کدوم یک بار ضربه بزنید و یک بار دروازه‌بانی کنید
• برنده کسیه که گل بیشتری بزنه! 🏆`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🎮 شروع بازی',
              web_app: { url: WEB_APP_URL }
            }
          ],
          [
            {
              text: '📖 راهنمای بازی',
              callback_data: 'help'
            }
          ]
        ]
      }
    };

    bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  });

  // مدیریت callback دکمه‌ها
  bot.on('callback_query', (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    if (data === 'help') {
      bot.sendMessage(chatId, `📖 **راهنمای بازی پنالتی:**

⚽ **هدف بازی:**
دو بازیکن به صورت آنلاین مقابل هم بازی می‌کنند.

🔄 **نحوه بازی:**
1️⃣ بازیکن اول مسابقه می‌سازه و لینک دعوت می‌فرسته
2️⃣ بازیکن دوم با لینک وارد می‌شه
3️⃣ راند ۱: بازیکن ۱ ضربه میزنه، بازیکن ۲ دروازه‌بانه
4️⃣ راند ۲: جابجا میشن
5️⃣ برنده کسیه که گل بیشتری بزنه! 🏆

🎯 **نحوه انتخاب:**
• **پنالتی‌زن:** یکی از گوشه‌های دروازه (چپ، وسط، راست) رو انتخاب کن
• **دروازه‌بان:** حدس بزن توپ به کدوم سمت میاد و شیرجه بزن`, { parse_mode: 'Markdown' });
    }

    bot.answerCallbackQuery(callbackQuery.id);
  });

  bot.on('polling_error', (error) => {
    console.error('Bot polling error:', error.code);
  });
} catch (e) {
  console.error('Bot failed to start:', e.message);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ۱. ساخت یا ورود به اتاق
  socket.on('joinRoom', ({ roomId, playerName, playerAvatar, playerTgId }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      // ایجاد اتاق جدید (بازیکن اول = پنالتی‌زن دور اول)
      rooms[roomId] = {
        id: roomId,
        players: [{ id: socket.id, tgId: playerTgId, name: playerName || 'Player 1', avatar: playerAvatar, score: 0, disconnected: false }],
        round: 1,
        kickerIndex: 0,
        goalieIndex: null,
        choices: { kicker: null, goalie: null },
        status: 'waiting' // waiting, playing, finished
      };
      socket.emit('roomCreated', { roomId, role: 'kicker' });
    } else {
      const room = rooms[roomId];

      // آیا این بازیکن قبلاً در اتاق بوده (ریکونکت)؟
      const rejoinIdx = room.players.findIndex(p => p.tgId && playerTgId && p.tgId === playerTgId);
      if (rejoinIdx !== -1) {
        room.players[rejoinIdx].id = socket.id;
        room.players[rejoinIdx].disconnected = false;
        socket.emit('roomRejoined', { roomId, role: rejoinIdx === room.kickerIndex ? 'kicker' : 'goalie' });
        io.to(roomId).emit('playerReconnected');
        return;
      }

      if (room.players.length === 1 && room.players[0].id !== socket.id) {
        // بازیکن دوم وارد می‌شود (دروازه‌بان دور اول)
        room.players.push({ id: socket.id, tgId: playerTgId, name: playerName || 'Player 2', avatar: playerAvatar, score: 0, disconnected: false });
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

          // اتاق رو نگه دار تا بازیکن‌ها بتونن دوباره بازی کنن، بعد از ۱ دقیقه پاکش کن
          setTimeout(() => { delete rooms[roomId]; }, RECONNECT_GRACE_MS);
        }
      }, 4500); // ۴.۵ ثانیه وقفه برای پخش انیمیشن‌ها
    }
  });

  socket.on('disconnect', () => {
    // مدیریت قطع اتصال: به جای حذف فوری اتاق، گرِیس پریود بده تا ریکانکت ممکن باشه
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players[idx].disconnected = true;

        if (room.status === 'playing') {
          io.to(roomId).emit('opponentDisconnected');
          // ۶۰ ثانیه صبر کن؛ اگر برنگشت اتاق رو ببند
          setTimeout(() => {
            const r = rooms[roomId];
            if (r && r.players.some(p => p.disconnected)) {
              io.to(roomId).emit('roomClosed');
              delete rooms[roomId];
            }
          }, RECONNECT_GRACE_MS);
        } else {
          // اتاق در حالت waiting بود (میزبان رفت) → ببند
          delete rooms[roomId];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`⚡ Penalty Game running on port ${PORT}`));
