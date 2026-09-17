const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

const socket = io();

// گرفتن اطلاعات کاربر از تلگرام
const tgUser = tg?.initDataUnsafe?.user || null;
const user = tgUser || {
  id: Math.floor(Math.random() * 100000),
  first_name: 'کاربر تستی'
};

// گرفتن roomId از پارامتر URL (از بات با ?room=room_xxx می‌آید)
const urlParams = new URLSearchParams(window.location.search);
let currentRoomId = urlParams.get('tgWebAppStartParam') || urlParams.get('room') || null;

let myRole = null; // 'kicker' | 'goalie'
let myChoice = null;
let currentRound = 1;
let iAmHost = false;

const BOT_USERNAME = "penalty_ben_bot";

// عناصر DOM
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const createSection = document.getElementById('create-section');
const waitingSection = document.getElementById('waiting-section');
const btnCreate = document.getElementById('btn-create');
const btnCopy = document.getElementById('btn-copy');
const inviteLinkInput = document.getElementById('invite-link');

const p1Name = document.getElementById('p1-name');
const p2Name = document.getElementById('p2-name');
const p1Score = document.getElementById('p1-score');
const p2Score = document.getElementById('p2-score');
const roundText = document.getElementById('round-text');
const roleStatus = document.getElementById('role-status');
const subStatus = document.getElementById('sub-status');
const targetBtns = document.querySelectorAll('.target-btn');
const goalkeeper = document.getElementById('goalkeeper');
const ball = document.getElementById('ball');
const modal = document.getElementById('result-modal');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalEmoji = document.getElementById('modal-emoji');
const flash = document.getElementById('flash');
const roleChip = document.getElementById('role-chip');
const p1Avatar = document.getElementById('p1-avatar');
const p2Avatar = document.getElementById('p2-avatar');
const p1Role = document.getElementById('p1-role');
const p2Role = document.getElementById('p2-role');

// ۱. اگر با لینک دعوت جوین شده، مستقیم به اتاق وصل شو
if (currentRoomId) {
  joinRoom(currentRoomId);
}

function joinRoom(roomId) {
  socket.emit('joinRoom', {
    roomId: roomId,
    playerName: user.first_name,
    playerAvatar: user.photo_url,
    playerTgId: user.id
  });
}

btnCreate.addEventListener('click', () => {
  const generatedRoomId = 'room_' + Math.random().toString(36).substring(2, 8);
  currentRoomId = generatedRoomId;
  iAmHost = true;

  joinRoom(generatedRoomId);

  createSection.classList.add('hidden');
  waitingSection.classList.remove('hidden');

  // ⭐ لینک دعوت = دیپ‌لینک ربات: دوستت روبات رو استارت می‌کنه و مستقیم میره زمین تو
  const inviteUrl = `https://t.me/${BOT_USERNAME}?start=${generatedRoomId}`;
  inviteLinkInput.value = inviteUrl;
});

btnCopy.addEventListener('click', async () => {
  const link = inviteLinkInput.value;
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    if (tg && tg.openTelegramLink) {
      // داخل تلگرام: مستقیم share کن — بهترین راه برای موبایل
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=⚽ بیا پنالتی! ضربه بزن یا دروازه‌بانی کن 🧤`);
    } else {
      await navigator.clipboard.writeText(link);
      btnCopy.innerText = "کپی شد! ✅";
      setTimeout(() => btnCopy.innerText = "کپی لینک دعوت", 2000);
    }
  } catch (e) {
    // فالبک: سلکت دستی
    inviteLinkInput.removeAttribute('readonly');
    inviteLinkInput.select();
    document.execCommand('copy');
    inviteLinkInput.setAttribute('readonly', '');
    btnCopy.innerText = "کپی شد! ✅";
    setTimeout(() => btnCopy.innerText = "کپی لینک دعوت", 2000);
  }
});

// ۲. انتخاب جهت
targetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myChoice) return; // اجازه انتخاب دوباره نده
    const direction = btn.getAttribute('data-dir');
    myChoice = direction;

    targetBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    subStatus.innerText = "حرکت ثبت شد. منتظر انتخاب حریف...";

    socket.emit('makeMove', {
      roomId: currentRoomId,
      direction: direction
    });
  });
});

// ۳. گوش دادن به ایونت‌های سرور (Socket Listeners)
socket.on('gameStart', ({ room, kicker, goalie, round }) => {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');

  p1Name.innerText = room.players[0].name;
  p2Name.innerText = room.players[1].name;
  p1Avatar.innerText = initial(room.players[0].name);
  p2Avatar.innerText = initial(room.players[1].name);
  p1Score.innerText = '۰';
  p2Score.innerText = '۰';
  updateRoles(kicker, goalie, round);
  vibrate('medium');
});

socket.on('opponentMoved', () => {
  if (!myChoice) {
    subStatus.innerText = "حریف انتخاب کرد! نوبت شماست ⚡";
  }
});

socket.on('roundResult', ({ kickerChoice, goalieChoice, isGoal, scores, round }) => {
  // اجرای انیمیشن‌ها همزمان
  ball.className = `ball shoot-${kickerChoice}`;
  goalkeeper.className = `goalkeeper dive-${goalieChoice}`;

  setTimeout(() => {
    // فلاش سبز برای گل، قرمز برای مهار + ویبره
    flash.className = `flash ${isGoal ? 'goal' : 'save'}`;
    vibrate(isGoal ? 'heavy' : 'light');

    // بروزرسانی اسکوربورد (scoreها با socket.id کلید خورده‌اند)
    const playerIds = Object.keys(scores);
    p1Score.innerText = toFa(scores[playerIds[0]]);
    p2Score.innerText = toFa(scores[playerIds[1]]);

    // نمایش مودال
    modal.classList.remove('hidden');
    if (isGoal) {
      modalEmoji.innerText = '⚽';
      modalTitle.innerText = "گـــل شـــد!";
      modalDesc.innerText = myRole === 'kicker'
        ? "شوتت وارد دروازه شد! 🔥"
        : "توپ وارد دروازه شد 😔";
    } else {
      modalEmoji.innerText = '🧤';
      modalTitle.innerText = "مهـار شـــد!";
      modalDesc.innerText = myRole === 'kicker'
        ? "دروازه‌بان جهت شوتت رو خوند و توپ رو گرفت!"
        : "آفرین! حدست درست بود و توپ رو گرفتی 🧤";
    }
  }, 600);
});

socket.on('nextRound', ({ round, kicker, goalie }) => {
  modal.classList.add('hidden');
  flash.className = 'flash';
  resetPitch();
  updateRoles(kicker, goalie, round);
});

socket.on('gameOver', ({ winner, players }) => {
  modal.classList.remove('hidden');
  if (winner) {
    if (winner.id === socket.id) {
      modalEmoji.innerText = '🏆';
      modalTitle.innerText = "تو بردی!";
      modalDesc.innerText = `نتیجه: ${toFa(players[0].score)} - ${toFa(players[1].score)}`;
      vibrate('heavy');
    } else {
      modalEmoji.innerText = '😔';
      modalTitle.innerText = "باختی!";
      modalDesc.innerText = `نتیجه: ${toFa(players[0].score)} - ${toFa(players[1].score)}`;
      vibrate('light');
    }
  } else {
    modalEmoji.innerText = '🤝';
    modalTitle.innerText = "مساوی!";
    modalDesc.innerText = `نتیجه برابر ${toFa(players[0].score)} شد.`;
  }
});

// اتصال قطع شد → دوباره وصل شو
socket.on('disconnect', () => {
  if (currentRoomId) {
    subStatus && (subStatus.innerText = "اتصال قطع شد. در حال اتصال مجدد...");
  }
});

socket.on('connect', () => {
  // اگر وسط بازی ریکانکت شدیم، دوباره به اتاق بپیوند
  if (currentRoomId && myRole) {
    joinRoom(currentRoomId);
  }
});

socket.on('roomRejoined', () => {
  if (subStatus) subStatus.innerText = "دوباره وصل شدی ✅";
});

socket.on('playerReconnected', () => {
  if (subStatus) subStatus.innerText = "حریف برگشت ✅";
});

socket.on('opponentDisconnected', () => {
  if (subStatus) subStatus.innerText = "⏳ حریف قطع شد... (۶۰ ثانیه فرصت برگشت)";
});

socket.on('roomClosed', () => {
  modalTitle.innerText = "🚪 بازی تعطیل شد";
  modalDesc.innerText = "حریف دیگه برنگشت.";
  modal.classList.remove('hidden');
});

socket.on('roomFull', () => {
  alert('این اتاق پر است یا بسته شده است.');
  // برگرد به لابی
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
});

socket.on('connect_error', () => {
  if (subStatus) subStatus.innerText = "خطا در اتصال به سرور...";
});

// توابع کمکی
function updateRoles(kicker, goalie, round) {
  currentRound = round;
  roundText.innerText = `راند ${round}`;
  myChoice = null;
  targetBtns.forEach(b => b.classList.remove('selected'));

  const iAmKicker = socket.id === kicker.id;
  myRole = iAmKicker ? 'kicker' : 'goalie';

  // رنگ و ایموجی چیپ نقش پایین صفحه
  if (iAmKicker) {
    roleChip.innerText = '👟';
    roleChip.classList.remove('goalie');
    roleStatus.innerText = "نقش: پنالتی‌زن";
    subStatus.innerText = "یک گوشه از دروازه را برای شوت انتخاب کن";
  } else {
    roleChip.innerText = '🧤';
    roleChip.classList.add('goalie');
    roleStatus.innerText = "نقش: دروازه‌بان";
    subStatus.innerText = "حدس بزن شوت به کدوم سمت میاد و شیرجه بزن";
  }

  // تگ نقش روی اسکوربورد (راند ۱: پ1 شوت‌زن / راند ۲ برعکس)
  const p1IsKicker = room_has(roomPlayersRef, kicker.id);
  if (p1IsKicker) {
    p1Role.innerText = '👟';
    p2Role.innerText = '🧤';
  } else {
    p1Role.innerText = '🧤';
    p2Role.innerText = '👟';
  }
}

// هلپر کوچک برای چک عضویت
let roomPlayersRef = [];
const _origGameStart = socket.listeners('gameStart')[0];
socket.off('gameStart', _origGameStart);
socket.on('gameStart', (data) => {
  roomPlayersRef = data.room.players.map(p => p.id);
  _origGameStart(data);
});
function room_has(list, id) { return list.includes(id); }

function resetPitch() {
  ball.className = 'ball';
  goalkeeper.className = 'goalkeeper';
  flash.className = 'flash';
}

function initial(name) {
  return (name || '؟').trim().charAt(0);
}

function vibrate(style) {
  try {
    if (tg && tg.HapticFeedback) {
      tg.HapticFeedback.impactOccurred(style);
    }
  } catch (e) {}
}

function toFa(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}
