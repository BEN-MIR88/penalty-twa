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

// گرفتن roomId از پارامتر URL
const urlParams = new URLSearchParams(window.location.search);
let currentRoomId = urlParams.get('tgWebAppStartParam') || urlParams.get('room') || null;

let myRole = null;
let myChoice = null;
let playerIdsRef = []; // [id پ1, id پ2]

const BOT_USERNAME = "penalty_ben_bot";
const TOTAL_KICKS = 5;

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
const p1Avatar = document.getElementById('p1-avatar');
const p2Avatar = document.getElementById('p2-avatar');
const p1Role = document.getElementById('p1-role');
const p2Role = document.getElementById('p2-role');
const roundText = document.getElementById('round-text');
const roleStatus = document.getElementById('role-status');
const subStatus = document.getElementById('sub-status');
const roleChip = document.getElementById('role-chip');
const targetBtns = document.querySelectorAll('.target-btn');
const goalkeeper = document.getElementById('goalkeeper');
const ball = document.getElementById('ball');
const modal = document.getElementById('result-modal');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalEmoji = document.getElementById('modal-emoji');
const flash = document.getElementById('flash');
const dotsP1 = document.getElementById('dots-p1');
const dotsP2 = document.getElementById('dots-p2');
const btnRematch = document.getElementById('btn-rematch');

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

  joinRoom(generatedRoomId);

  createSection.classList.add('hidden');
  waitingSection.classList.remove('hidden');

  // لینک دعوت = دیپ‌لینک ربات
  const inviteUrl = `https://t.me/${BOT_USERNAME}?start=${generatedRoomId}`;
  inviteLinkInput.value = inviteUrl;
});

btnCopy.addEventListener('click', async () => {
  const link = inviteLinkInput.value;
  try {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=⚽ بیا پنالتی! هرکی ۵ تا شوت میزنه، بیشترین گل برنده‌ست 🧤`);
    } else {
      await navigator.clipboard.writeText(link);
      btnCopy.innerText = "کپی شد! ✅";
      setTimeout(() => btnCopy.innerText = "📤 ارسال لینک به دوستت", 2000);
    }
  } catch (e) {
    inviteLinkInput.removeAttribute('readonly');
    inviteLinkInput.select();
    document.execCommand('copy');
    inviteLinkInput.setAttribute('readonly', '');
    btnCopy.innerText = "کپی شد! ✅";
    setTimeout(() => btnCopy.innerText = "📤 ارسال لینک به دوستت", 2000);
  }
});

// ۲. انتخاب جهت
targetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myChoice) return;
    const direction = btn.getAttribute('data-dir');
    myChoice = direction;

    targetBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    subStatus.innerText = "حرکت ثبت شد. منتظر حریف...";

    socket.emit('makeMove', {
      roomId: currentRoomId,
      direction: direction
    });
  });
});

// دکمه بازی مجدد
if (btnRematch) {
  btnRematch.addEventListener('click', () => {
    socket.emit('rematch', { roomId: currentRoomId });
  });
}

// ۳. ایونت‌های سرور
socket.on('gameStart', ({ room, kicker, goalie }) => {
  playerIdsRef = [room.players[0].id, room.players[1].id];

  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  modal.classList.add('hidden');
  btnRematch && btnRematch.classList.add('hidden');

  p1Name.innerText = room.players[0].name;
  p2Name.innerText = room.players[1].name;
  p1Avatar.innerText = initial(room.players[0].name);
  p2Avatar.innerText = initial(room.players[1].name);
  p1Score.innerText = '۰';
  p2Score.innerText = '۰';

  renderDots([]);
  updateTurn(room);
  vibrate('medium');
});

socket.on('opponentMoved', () => {
  if (!myChoice) {
    subStatus.innerText = "حریف انتخاب کرد! نوبت شماست ⚡";
  }
});

socket.on('roundResult', ({ kickerId, isGoal, scores, history }) => {
  const kickerChoice = arguments[0].kickerChoice;
  const goalieChoice = arguments[0].goalieChoice;

  ball.className = `ball shoot-${kickerChoice}`;
  goalkeeper.className = `goalkeeper dive-${goalieChoice}`;

  setTimeout(() => {
    flash.className = `flash ${isGoal ? 'goal' : 'save'}`;
    vibrate(isGoal ? 'heavy' : 'light');

    const pid = playerIdsRef;
    p1Score.innerText = toFa(scores[pid[0]] ?? 0);
    p2Score.innerText = toFa(scores[pid[1]] ?? 0);

    renderDots(history);

    modal.classList.remove('hidden');
    if (isGoal) {
      modalEmoji.innerText = '⚽';
      modalTitle.innerText = "گـــل شـــد!";
      modalDesc.innerText = kickerId === socket.id
        ? "شوتت وارد دروازه شد! 🔥"
        : "توپ وارد دروازه شد 😔";
    } else {
      modalEmoji.innerText = '🧤';
      modalTitle.innerText = "مهـار شـــد!";
      modalDesc.innerText = kickerId === socket.id
        ? "دروازه‌بان جهت شوتت رو خوند!"
        : "آفرین! توپ رو گرفتی 🧤";
    }
  }, 600);
});

socket.on('nextTurn', ({ room, kicker, goalie, kickNumber }) => {
  modal.classList.add('hidden');
  flash.className = 'flash';
  resetPitch();
  updateTurn(room);
  vibrate('light');
});

socket.on('gameOver', ({ winner, players, history }) => {
  renderDots(history);
  btnRematch && btnRematch.classList.remove('hidden');

  const myScore = players.find(p => p.id === socket.id)?.score ?? 0;
  const oppScore = players.find(p => p.id !== socket.id)?.score ?? 0;

  if (!winner) {
    modalEmoji.innerText = '🤝';
    modalTitle.innerText = "مساوی!";
    modalDesc.innerText = `نتیجه: ${toFa(myScore)} - ${toFa(oppScore)}`;
  } else if (winner.id === socket.id) {
    modalEmoji.innerText = '🏆';
    modalTitle.innerText = "تو بردی!";
    modalDesc.innerText = `نتیجه: ${toFa(myScore)} - ${toFa(oppScore)}`;
    vibrate('heavy');
  } else {
    modalEmoji.innerText = '😔';
    modalTitle.innerText = "باختی!";
    modalDesc.innerText = `نتیجه: ${toFa(myScore)} - ${toFa(oppScore)}`;
    vibrate('light');
  }
  modal.classList.remove('hidden');
});

// ریکانکت
socket.on('roomRejoined', ({ room }) => {
  // بازیکن وسط بازی ریکانکت شده — کل وضعیت را بازسازی کن
  playerIdsRef = [room.players[0].id, room.players[1].id];

  if (room.status === 'waiting') {
    lobbyScreen.classList.add('active');
    gameScreen.classList.remove('active');
    createSection.classList.remove('hidden');
    waitingSection.classList.add('hidden');
    return;
  }

  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  modal.classList.add('hidden');

  p1Name.innerText = room.players[0].name;
  p2Name.innerText = room.players[1].name;
  p1Avatar.innerText = initial(room.players[0].name);
  p2Avatar.innerText = initial(room.players[1].name);
  const pid = playerIdsRef;
  p1Score.innerText = toFa(room.players[0].score ?? 0);
  p2Score.innerText = toFa(room.players[1].score ?? 0);

  renderDots(room.history);
  updateTurn(room);

  subStatus.innerText = "دوباره وصل شدی ✅";
});

socket.on('playerReconnected', () => {
  subStatus.innerText = "حریف برگشت ✅";
});

socket.on('opponentDisconnected', () => {
  subStatus.innerText = "⏳ حریف قطع شد... (۶۰ ثانیه فرصت برگشت)";
});

socket.on('roomClosed', () => {
  modalEmoji.innerText = '🚪';
  modalTitle.innerText = "بازی تعطیل شد";
  modalDesc.innerText = "حریف دیگه برنگشت.";
  btnRematch && btnRematch.classList.add('hidden');
  modal.classList.remove('hidden');
});

socket.on('roomFull', () => {
  alert('این اتاق پر است یا بسته شده است.');
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
});

socket.on('connect', () => {
  if (currentRoomId && playerIdsRef.length) {
    joinRoom(currentRoomId);
  }
});

socket.on('disconnect', () => {
  if (currentRoomId) {
    subStatus && (subStatus.innerText = "اتصال قطع شد. در حال اتصال مجدد...");
  }
});

socket.on('connect_error', () => {
  if (subStatus) subStatus.innerText = "خطا در اتصال به سرور...";
});

// ===== توابع کمکی =====

function updateTurn(room) {
  const iAmKicker = room.currentKicker.id === socket.id;
  myRole = iAmKicker ? 'kicker' : 'goalie';
  myChoice = null;
  targetBtns.forEach(b => b.classList.remove('selected'));

  roundText.innerText = `ضربه ${toFa(room.kickNumber)}/${toFa(TOTAL_KICKS)}`;

  // تگ نقش روی اسکوربورد
  const p1IsKicker = room.kickerIndex === 0;
  p1Role.innerText = p1IsKicker ? '👟' : '🧤';
  p2Role.innerText = p1IsKicker ? '🧤' : '👟';

  if (iAmKicker) {
    roleChip.innerText = '👟';
    roleChip.classList.remove('goalie');
    roleStatus.innerText = "نوبت شوت توست 👟";
    subStatus.innerText = "یک گوشه از دروازه را انتخاب کن";
  } else {
    roleChip.innerText = '🧤';
    roleChip.classList.add('goalie');
    roleStatus.innerText = "نوبت دروازه‌بانی توست 🧤";
    subStatus.innerText = "حدس بزن توپ کجا میره و شیرجه بزن";
  }
}

// دایره‌های وضعیت ضربه‌ها: سبز=گل، قرمز=نشد، خاکستری=باقی‌مانده
function renderDots(history) {
  if (!dotsP1 || !dotsP2) return;
  const pid = playerIdsRef;
  if (!pid.length) return;

  [dotsP1, dotsP2].forEach((container, i) => {
    container.innerHTML = '';
    const me = history.filter(h => h.by === pid[i]);

    for (let k = 0; k < TOTAL_KICKS; k++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (me[k]) {
        dot.classList.add(me[k].goal ? 'goal' : 'miss');
      }
      container.appendChild(dot);
    }
  });
}

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
