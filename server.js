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


// سیستم امتیاز و لیدربورد
const leaderboard = require('./leaderboard');

// ذخیره‌سازی اتاق‌ها — لینک‌های دعوت از ری‌استارت/خواب Render جان سالم ببرند
const roomsPersist = require('./rooms-persist');
const rooms = roomsPersist.loadRooms();

const KICKS_PER_PLAYER = 5;        // هر بازیکن ۵ ضربه میزند
const ROUND_ANIM_MS = 4500;        // مدت نمایش نتیجه هر ضربه
const TURN_TIMEOUT_MS = 15000;     // اگر بازیکنی ۱۵ ثانیه انتخاب نکرد، خودکار وسط دروازه
const RECONNECT_GRACE_MS = 60000;  // فرصت برگشت بعد از قطع شدن وسط بازی
const WAITING_GRACE_MS = 3 * 60 * 1000; // فرصت برگشت میزبان در حالت انتظار (۳ دقیقه — قفل صفحه/رفرش/سوییچ اپ)
const ROOM_TTL_MS = 30 * 60 * 1000; // عمر اتاق رهاشده (پاک‌سازی اتاق‌های شبح)
const VALID_DIRS = ['left', 'center', 'right'];

// ===== کانال اجباری =====
// FORCE_CHANNEL=off → چک عضویت کلاً غیرفعال میشود
const FORCE_CHANNEL = process.env.FORCE_CHANNEL || '@shayadmessi';
const FORCE_CHANNEL_URL = process.env.FORCE_CHANNEL_URL || 'https://t.me/shayadmessi';

// شروع ربات تلگرام
const TelegramBot = require('node-telegram-bot-api');
const BOT_TOKEN = process.env.BOT_TOKEN || '8996508732:AAEZU1IanYRb_w5Q0_YETYDKsfkNyvDNWZ8';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://penalty-twa.onrender.com';

let bot = null;

// ===== چک عضویت کانال (یکپارچه برای ربات و WebApp) =====
// جواب مثبت ۵ دقیقه کش میشود؛ جواب منفی فقط ۱۰ ثانیه —
// که بعد از عضویت، دکمه «بررسی عضویت» بلافاصله جواب درست بدهد.
const membershipCache = new Map(); // tgId -> { ok, ts, apiError }
const POSITIVE_CACHE_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_MS = 10 * 1000;
const CHECK_TIMEOUT_MS = 4000;

function checkMembership(tgId, { fresh = false } = {}) {
  return new Promise((resolve) => {
    if (FORCE_CHANNEL === 'off' || !bot || !tgId) return resolve(true);
    const key = String(tgId);

    if (!fresh) {
      const cached = membershipCache.get(key);
      if (cached) {
        const ttl = cached.ok ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS;
        if (Date.now() - cached.ts < ttl) return resolve(cached.ok);
      }
    }

    const apiCall = bot.getChatMember(FORCE_CHANNEL, key).then(m => {
      const ok = ['creator', 'administrator', 'member', 'restricted'].includes(m.status);
      membershipCache.set(key, { ok, ts: Date.now(), apiError: false });
      return ok;
    }).catch(e => {
      // ❗ اگر ربات ادمین کانال نباشد هیچ‌کس تأیید نمیشود — قفل مثل بقیه ربات‌ها بسته می‌ماند
      console.error('getChatMember failed:', e.message);
      membershipCache.set(key, { ok: false, ts: Date.now(), apiError: true });
      return false;
    });

    // تایم‌اوت: فقط وقتی API در دسترس نیست بازیکن رد شود (fail-open)
    Promise.race([
      apiCall,
      new Promise(r => setTimeout(() => r(true), CHECK_TIMEOUT_MS))
    ]).then(resolve);
  });
}

// آیا آخرین چک این کاربر به خطای API خورده؟ (یعنی ربات ادمین کانال نیست)
function lastCheckHadApiError(tgId) {
  const c = membershipCache.get(String(tgId));
  return !!(c && c.apiError);
}

try {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram Bot is running...');

  // ⌨️ منوی همیشگی: /start همیشه پایین صفحه کنار input دیده میشود
  bot.setMyCommands([
    { command: 'start', description: '⚽ شروع بازی' },
    { command: 'top', description: '🏆 جدول امتیازات' },
    { command: 'help', description: '📖 راهنمای بازی' }
  ]).then(() => console.log('⌨️ Bot commands set')).catch(e => console.error('setMyCommands:', e.message));

  // دکمه منو همیشه نمایش داده شود (نه فقط موقع تایپ)
  bot.setChatMenuButton({ menu_button: { type: 'commands' } }).catch(() => {});

  // 🔒 پیام قفل عضویت — دقیقاً مثل بقیه ربات‌ها
  function sendForceJoin(chatId, firstName, payload) {
    return bot.sendMessage(chatId,
      `🔒 *سلام ${firstName} عزیز*\n\nبرای شروع بازی، ابتدا در کانال زیر عضو شو:\n\n📢 ${FORCE_CHANNEL}\n\nبعد از عضویت، روی «✅ بررسی عضویت» بزن.`,
      {
        parse_mode: 'Markdown',
        ...forceJoinKeyboard(payload)
      }
    );
  }

  function forceJoinKeyboard(payload) {
    // مثل بقیه ربات‌ها: «عضویت در نام‌کانال»
    const chName = FORCE_CHANNEL.replace('@', '');
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: `📢 عضویت در ${chName}`, url: FORCE_CHANNEL_URL }],
          [{ text: '✅ بررسی عضویت', callback_data: `check_join${payload ? '|' + payload : ''}` }]
        ]
      }
    };
  }

  // پیام خوش‌آمد / دکمه ورود به زمین دوست
  function sendWelcome(chatId, firstName, payload) {
    if (payload && payload.startsWith('room_')) {
      return bot.sendMessage(chatId,
        `⚽ سلام ${firstName}!\n\nبازیکن اول منتظرته! برای شروع بازی روی دکمه زیر بزن 👇`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎮 ورود به زمین دوستت', web_app: { url: `${WEB_APP_URL}?room=${payload}` } }]
            ]
          }
        }
      );
    }

    const welcomeMessage = `⚽ سلام ${firstName}!

به بازی **ضربات پنالتی** خوش اومدی! 🎯

🎮 **نحوه بازی:**
• یک مسابقه جدید بساز و لینکش رو برای دوستت بفرست
• یا از لیست مسابقه‌های عمومی، حریف پیدا کن
• هر بازیکن ۵ ضربه میزنه (شوت و دروازه‌بانی یکی‌یکی)
• برد = ۳ امتیاز، مساوی = ۱ امتیاز 🏆`;

    return bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 شروع بازی', web_app: { url: WEB_APP_URL } }],
          [
            { text: '🏆 جدول امتیازات', callback_data: 'top' },
            { text: '📖 راهنما', callback_data: 'help' }
          ]
        ]
      }
    });
  }

  // 🏆 متن جدول امتیازات
  function sendTop(chatId, firstName) {
    const top = leaderboard.topPlayers(10);

    let text;
    if (top.length === 0) {
      text = `🏆 *جدول امتیازات*\n\nهنوز کسی امتیاز نگرفته! اولین نفر باش 💪\n\n⚽ برد = ۳ امتیاز | مساوی = ۱ امتیاز`;
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map((p, i) => {
        const rank = medals[i] || `${i + 1}.`;
        const uname = p.username ? ` @${p.username}` : '';
        return `${rank} ${p.name}${uname}\n        ${toFa(p.points)} امتیاز | ${toFa(p.wins)} برد | ${toFa(p.goals)} گل`;
      });
      text = `🏆 *جدول امتیازات*\n\n${lines.join('\n')}\n\n⚽ برد = ۳ | مساوی = ۱`;
    }

    return bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 بازی کن', web_app: { url: WEB_APP_URL } }]
        ]
      }
    });
  }

  // تبدیل اعداد به فارسی
  function toFa(n) {
    return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  }

  // /start بدون payload → منو | /start room_xxx → ورود به زمین دوست
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'بازیکن';

    const parts = (msg.text || '').split(' ');
    const payload = parts.length > 1 ? parts[1].trim() : null;

    // 🔒 عضویت اجباری در کانال
    const isMember = await checkMembership(msg.from.id);
    if (!isMember) {
      return sendForceJoin(chatId, firstName, payload);
    }

    sendWelcome(chatId, firstName, payload);
  });

  // /top — جدول امتیازات
  bot.onText(/\/top/, (msg) => {
    sendTop(msg.chat.id, msg.from.first_name || 'بازیکن');
  });

  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data || '';

    if (data === 'help') {
      bot.sendMessage(chatId, `📖 **راهنمای بازی پنالتی:**

⚽ دو بازیکن آنلاین مقابل هم. هرکدام ۵ ضربه.

🔄 نوبت‌ها یکی‌یکی عوض میشه: یک ضربه تو شوت میزنی، یک ضربه گلر میشی.

🎯 **پنالتی‌زن:** گوشه دروازه رو انتخاب کن.
🧤 **دروازه‌بان:** حدس بزن توپ کجا میره و شیرجه بزن.

🏆 برد = ۳ امتیاز، مساوی = ۱ امتیاز. جدول امتیازات با /top!`, { parse_mode: 'Markdown' });
      return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data === 'top') {
      return sendTop(chatId, callbackQuery.from.first_name || 'بازیکن').then(() => bot.answerCallbackQuery(callbackQuery.id));
    }

    if (data.startsWith('check_join')) {
      const payload = data.split('|')[1] || null;
      // fresh=true: کش منفی را نادیده بگیر — کاربر همین الان عضو شده
      const isMember = await checkMembership(callbackQuery.from.id, { fresh: true });

      if (isMember) {
        await bot.answerCallbackQuery(callbackQuery.id);
        return sendWelcome(chatId, callbackQuery.from.first_name || 'بازیکن', payload);
      }

      // تفکیک دو حالت: واقعاً عضو نشده یا ربات ادمین کانال نیست
      if (lastCheckHadApiError(callbackQuery.from.id)) {
        return bot.answerCallbackQuery(callbackQuery.id, {
          text: '⚠️ ربات فعلاً نمیتواند عضویت را بررسی کند. مطمئن شو ربات ادمین کانال است و دوباره امتحان کن.',
          show_alert: true
        });
      }
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ هنوز عضو کانال نشدی! اول عضو شو، بعد دوباره امتحان کن.',
        show_alert: true
      });
    }

    bot.answerCallbackQuery(callbackQuery.id);
  });

  bot.on('polling_error', (error) => {
    console.error('Bot polling error:', error.code);
  });

  // 🔍 بررسی راه‌اندازی: آیا ربات میتواند عضویت کانال را چک کند؟
  (async () => {
    try {
      const me = await bot.getMe();
      try {
        await bot.getChat(FORCE_CHANNEL);
        const mine = await bot.getChatMember(FORCE_CHANNEL, me.id);
        if (['creator', 'administrator'].includes(mine.status)) {
          console.log(`✅ قفل عضویت فعال است — ربات ادمین ${FORCE_CHANNEL} هست`);
        } else {
          console.error(`⚠️ ربات عضو ${FORCE_CHANNEL} هست ولی ادمین نیست! قفل عضویت کار نمیکند.`);
          console.error(`⚠️ راه‌حل: تنظیمات کانال → Administrators → Add Admin → @${me.username}`);
        }
      } catch (e) {
        console.error('================================================');
        console.error(`⚠️ ربات به کانال ${FORCE_CHANNEL} دسترسی ندارد!`);
        console.error(`⚠️ قفل عضویت الان برای همه بسته است.`);
        console.error(`⚠️ راه‌حل: در کانال → مدیریت کانال → Administrators → Add Admin → @${me.username}`);
        console.error('================================================');
      }
    } catch (e) {
      console.error('⚠️ getMe failed:', e.message);
    }
  })();

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

// حل یک ضربه (بعد از انتخاب هر دو یا تایم‌اوت) — انیمیشن، امتیاز، نوبت بعد یا پایان
function resolveKick(roomId, wasTimeout = false) {
  const room = rooms[roomId];
  if (!room || room.status !== 'playing') return;

  // اگر یکی از انتخاب‌ها غایب مانده، خودکار وسط
  if (!room.choices.kicker) room.choices.kicker = 'center';
  if (!room.choices.goalie) room.choices.goalie = 'center';

  clearTimeout(room.turnTimer);

  const kicker = room.players[room.kickerIndex];

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
    byTimeout: wasTimeout,
    scores: [room.players[0].score, room.players[1].score],
    history: room.history,
    kickNumber: room.kickNumber
  });

  room.choices = { kicker: null, goalie: null };
  roomsPersist.saveRooms(rooms);

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

      // 🏆 ثبت نتیجه در لیدربورد
      try {
        leaderboard.recordResult({
          winnerIndex,
          players: r.players.map(p => ({ tgId: p.tgId, name: p.name, username: p.username })),
          scores: [r.players[0].score, r.players[1].score],
          history: r.history
        });
      } catch (e) { console.error('Leaderboard error:', e.message); }
      roomsPersist.saveRooms(rooms);
      // اتاق ۶۰ ثانیه برای بازی مجدد نگه داشته می‌شود
      setTimeout(() => { if (rooms[roomId] && rooms[roomId].status === 'finished') delete rooms[roomId]; roomsPersist.saveRooms(rooms); }, RECONNECT_GRACE_MS);
    } else {
      nextTurn(r);
      io.to(roomId).emit('nextTurn', { room: publicRoom(r) });
    }
  }, ROUND_ANIM_MS);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ۱. ساخت مسابقه جدید — فقط صاحب لینک این را می‌فرستد
  socket.on('createRoom', async ({ playerName, playerAvatar, playerTgId, playerUsername, isPublic }) => {
    // 🔒 عضویت اجباری (برای ورود مستقیم از WebApp که از /start رد میشود)
    if (!(await checkMembership(playerTgId))) {
      return socket.emit('notMember');
    }

    const roomId = 'room_' + Math.random().toString(36).substring(2, 8);
    socket.join(roomId);

    rooms[roomId] = {
      id: roomId,
      players: [{ id: socket.id, tgId: playerTgId != null ? String(playerTgId) : null, name: playerName || 'بازیکن ۱', avatar: playerAvatar, username: playerUsername || null, score: 0, disconnected: false }],
      kickerIndex: 0,
      goalieIndex: null,
      choices: { kicker: null, goalie: null },
      turn: 'A',
      kickNumber: 1,
      history: [],
      status: 'waiting',
      isPublic: !!isPublic,   // مسابقه عمومی → در لیست لابی نمایش داده میشود
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    roomsPersist.saveRooms(rooms);
    socket.emit('roomCreated', { roomId, youIndex: 0 });
  });

  // ۲. ورود به اتاق — فقط با roomId معتبر (لینک دعوت، لیست عمومی یا ریکانکت)
  socket.on('joinRoom', async ({ roomId, playerName, playerAvatar, playerTgId, playerUsername }) => {
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

    // بازیکن دوم جدید — 🔒 عضویت اجباری
    if (!(await checkMembership(playerTgId))) {
      return socket.emit('notMember');
    }

    if (room.players.length === 1) {
      room.players.push({ id: socket.id, tgId: playerTgId != null ? String(playerTgId) : null, name: playerName || 'بازیکن ۲', avatar: playerAvatar, username: playerUsername || null, score: 0, disconnected: false });
      room.goalieIndex = 1;
      room.status = 'playing';
      room.kickerIndex = 0;
      room.isPublic = false; // از لیست عمومی حذف شود

      // هر بازیکن باید بدونه خودش کدوم بازیکن هست (ایندکس 0 یا 1)
      roomsPersist.saveRooms(rooms);
      io.to(room.players[0].id).emit('gameStart', { room: publicRoom(room), youIndex: 0 });
      io.to(room.players[1].id).emit('gameStart', { room: publicRoom(room), youIndex: 1 });
    } else {
      socket.emit('roomFull');
    }
  });

  // ۳. لیست مسابقه‌های عمومی در انتظار حریف
  socket.on('listPublicRooms', () => {
    const list = Object.values(rooms)
      .filter(r => r.status === 'waiting' && r.isPublic && !r.players.every(p => p.disconnected))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 15)
      .map(r => ({
        roomId: r.id,
        hostName: r.players[0].name,
        createdAt: r.createdAt
      }));
    socket.emit('publicRoomsList', { rooms: list });
  });

  // ۴. حرکت (شوت یا شیرجه)
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
      resolveKick(roomId);
    } else {
      // ⏱ اولین بازیکن انتخاب کرد — تایمر برای بازیکن دوم
      clearTimeout(room.turnTimer);
      room.turnTimer = setTimeout(() => {
        const r = rooms[roomId];
        if (!r || r.status !== 'playing') return;
        // بازیکن غایب خودکار وسط دروازه میزند/شیرجه میزند
        if (!r.choices.kicker) r.choices.kicker = 'center';
        if (!r.choices.goalie) r.choices.goalie = 'center';
        console.log('Turn timeout — auto-resolved:', roomId);
        resolveKick(roomId, true);
      }, TURN_TIMEOUT_MS);
    }
  });

  // ۵. بازی مجدد
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
    roomsPersist.saveRooms(rooms);

    io.to(room.players[0].id).emit('gameStart', { room: publicRoom(room), youIndex: 0 });
    io.to(room.players[1].id).emit('gameStart', { room: publicRoom(room), youIndex: 1 });
  });

  // ۶. خروج داوطلب (دکمه بازگشت به لابی)
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
          roomsPersist.saveRooms(rooms);
          console.log('Room removed (host left waiting):', roomId);
        }
      }, WAITING_GRACE_MS);
    } else {
      // وسط بازی رفته — مثل قطع شدن
      io.to(roomId).emit('opponentDisconnected');
    }
  });

  // ۷. قطع شدن اتصال
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
            roomsPersist.saveRooms(rooms);
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
            roomsPersist.saveRooms(rooms);
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
  roomsPersist.saveRooms(rooms);
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
