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
const myUsername = tgUser?.username || null;

// ===== لیست مسابقه‌های عمومی =====
const publicList = document.getElementById('public-rooms');
const publicListItems = document.getElementById('public-rooms-items');
let publicListTimer = null;

function requestPublicRooms() {
  socket.emit('listPublicRooms');
}

socket.on('publicRoomsList', ({ rooms }) => {
  if (!publicList || !publicListItems) return;

  if (!rooms.length) {
    publicList.classList.add('hidden');
    return;
  }

  publicList.classList.remove('hidden');
  publicListItems.innerHTML = '';

  rooms.forEach(r => {
    const item = document.createElement('button');
    item.className = 'public-room-item';
    const mins = Math.max(0, Math.floor((Date.now() - r.createdAt) / 60000));
    item.innerHTML = `<span class="pr-avatar">${(r.hostName || '؟').charAt(0)}</span>
      <span class="pr-info"><span class="pr-name"></span><span class="pr-time">${toFa(mins)} دقیقه پیش</span></span>
      <span class="pr-join">ورود ⚽</span>`;
    item.querySelector('.pr-name').innerText = r.hostName;
    item.addEventListener('click', () => {
      if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
      currentRoomId = r.roomId;
      persistRoom(r.roomId);
      createSection.classList.add('hidden');
      joinRoom(r.roomId);
    });
    publicListItems.appendChild(item);
  });
});

// شروع رفرش دوره‌ای لیست وقتی لابی فعال است
setInterval(() => {
  if (lobbyScreen.classList.contains('active') && socket.connected) {
    requestPublicRooms();
  }
}, 5000);

// گرفتن roomId از پارامتر URL
const urlParams = new URLSearchParams(window.location.search);
let currentRoomId = urlParams.get('tgWebAppStartParam') || urlParams.get('room') || null;

let myIndex = null;   // ایندکس من در آرایه بازیکن‌ها (0 یا 1)
let myRole = null;    // 'kicker' یا 'goalie'
let myChoice = null;
let roomState = null; // آخرین وضعیت اتاق

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
const p1Dots = document.getElementById('dots-p1');
const p2Dots = document.getElementById('dots-p2');
const playerCards = [document.querySelector('.player.p1'), document.querySelector('.player.p2')];
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
const btnRematch = document.getElementById('btn-rematch');

// ===== مانا (Persist): اگر وسط لابی/بازی هستیم، بعد از بستن اپ هم حفظ شود =====
const PERSIST_KEY = 'penalty_room';
try {
  const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null');
  if (saved && saved.roomId && Date.now() - saved.ts < 2 * 60 * 60 * 1000) {
    currentRoomId = saved.roomId;
    // بعد از وصل شدن سوکت، ریکانکت میکنیم (هندلر connect پایین)
  } else {
    localStorage.removeItem(PERSIST_KEY);
  }
} catch (e) {}

function persistRoom(roomId) {
  try {
    if (roomId) localStorage.setItem(PERSIST_KEY, JSON.stringify({ roomId, ts: Date.now() }));
    else localStorage.removeItem(PERSIST_KEY);
  } catch (e) {}
}

// دکمه بازگشت به لابی
const btnLeave = document.getElementById('btn-leave');
if (btnLeave) {
  btnLeave.addEventListener('click', () => {
    if (currentRoomId) socket.emit('leaveRoom', { roomId: currentRoomId });
    backToLobby();
  });
}

function backToLobby() {
  currentRoomId = null;
  myIndex = null;
  roomState = null;
  persistRoom(null);
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
  createSection.classList.remove('hidden');
  waitingSection.classList.add('hidden');
  modal.classList.add('hidden');
  resetPitch();
}

// ۱. اگر با لینک دعوت جوین شده، مستقیم به اتاق وصل شو
if (currentRoomId) {
  joinRoom(currentRoomId);
}

function joinRoom(roomId) {
  socket.emit('joinRoom', {
    roomId: roomId,
    playerName: user.first_name,
    playerAvatar: user.photo_url,
    playerTgId: String(user.id),
    playerUsername: myUsername
  });
}

btnCreate.addEventListener('click', () => {
  // ساخت مسابقه جدید: اول اتاق قبلی را ترک کن
  if (currentRoomId) {
    socket.emit('leaveRoom', { roomId: currentRoomId });
  }
  createSection.classList.add('hidden');
  waitingSection.classList.remove('hidden');
  // roomId را سرور میسازد و در roomCreated برمی‌گرداند — مسابقه عمومی است
  socket.emit('createRoom', {
    playerName: user.first_name,
    playerAvatar: user.photo_url,
    playerTgId: String(user.id),
    playerUsername: myUsername,
    isPublic: true
  });
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

// ۲. انتخاب جهت — ناحیه دکمه‌ها LTR است پس "چپ" واقعاً سمت چپ صفحه است
// (هر دو بازیکن زمین را از دید پنالتی‌زن می‌بینند، مثل پخش تلویزیونی)
targetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myChoice) return;
    if (roomState && roomState.status !== 'playing') return;
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
    btnRematch.classList.add('hidden');
    subStatus.innerText = "در انتظار حریف برای بازی مجدد...";
  });
}

// ===== ایونت‌های سرور =====

socket.on('roomCreated', ({ roomId, youIndex }) => {
  myIndex = youIndex;
  currentRoomId = roomId;
  persistRoom(roomId);
  const inviteUrl = `https://t.me/${BOT_USERNAME}?start=${roomId}`;
  inviteLinkInput.value = inviteUrl;
  subStatus.innerText = '';
  // اتاق من از لیست عمومی حذف شود چون منتظرم
  requestPublicRooms();
});

// شروع بازی (برای هر بازیکن جدا فرستاده میشه)
socket.on('gameStart', ({ room, youIndex }) => {
  myIndex = youIndex;
  roomState = room;
  persistRoom(room.id);

  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  modal.classList.add('hidden');
  btnRematch && btnRematch.classList.add('hidden');

  updateFromRoom(room);
  vibrate('medium');
});

socket.on('opponentMoved', () => {
  if (!myChoice) {
    subStatus.innerText = "حریف انتخاب کرد! نوبت شماست ⚡";
  }
});

socket.on('roundResult', ({ kickerIndex, kickerChoice, goalieChoice, isGoal, scores, history, kickNumber }) => {
  // انیمیشن شوت نسبت به دید پنالتی‌زن
  ball.className = `ball shoot-${kickerChoice}`;
  goalkeeper.className = `goalkeeper dive-${goalieChoice}`;

  setTimeout(() => {
    flash.className = `flash ${isGoal ? 'goal' : 'save'}`;
    vibrate(isGoal ? 'heavy' : 'light');

    // اگر توپ گرفته شد، به پایین برگردد
    if (!isGoal) setTimeout(resetPitch, 900);

    updateScores(scores);
    renderDots(history);
    roundText.innerText = `ضربه ${toFa(kickNumber)}/${toFa(TOTAL_KICKS)}`;

    modal.classList.remove('hidden');
    const iKicked = kickerIndex === myIndex;
    if (isGoal) {
      modalEmoji.innerText = '⚽';
      modalTitle.innerText = "گـــل شـــد!";
      modalDesc.innerText = iKicked
        ? "شوتت وارد دروازه شد! 🔥"
        : "توپ وارد دروازه شد 😔";
    } else {
      modalEmoji.innerText = '🧤';
      modalTitle.innerText = "مهـار شـــد!";
      modalDesc.innerText = iKicked
        ? "دروازه‌بان جهت شوتت رو خوند!"
        : "آفرین! توپ رو گرفتی 🧤";
    }
  }, 600);
});

socket.on('nextTurn', ({ room }) => {
  modal.classList.add('hidden');
  flash.className = 'flash';
  resetPitch();
  roomState = room;
  updateFromRoom(room);
  vibrate('light');
});

socket.on('gameOver', ({ winnerIndex, scores, history }) => {
  if (roomState) roomState.status = 'finished';
  renderDots(history);
  updateScores(scores);
  btnRematch && btnRematch.classList.remove('hidden');
  targetBtns.forEach(b => b.classList.remove('selected'));

  const myScore = scores[myIndex] ?? 0;
  const oppScore = scores[myIndex === 0 ? 1 : 0] ?? 0;

  if (winnerIndex === null || winnerIndex === undefined) {
    modalEmoji.innerText = '🤝';
    modalTitle.innerText = "مساوی!";
    modalDesc.innerText = `نتیجه: ${toFa(myScore)} - ${toFa(oppScore)}`;
  } else if (winnerIndex === myIndex) {
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

// ریکانکت — کل وضعیت بازی بازسازی میشود
socket.on('roomRejoined', ({ room, youIndex }) => {
  myIndex = youIndex;
  roomState = room;
  currentRoomId = room.id;
  persistRoom(room.id);

  if (room.status === 'waiting') {
    // اتاق هنوز منتظر بازیکن دوم است — من همون میزبانم
    lobbyScreen.classList.add('active');
    gameScreen.classList.remove('active');
    createSection.classList.add('hidden');
    waitingSection.classList.remove('hidden');
    if (inviteLinkInput) {
      inviteLinkInput.value = `https://t.me/${BOT_USERNAME}?start=${room.id}`;
    }
    subStatus.innerText = '';
    return;
  }

  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  modal.classList.add('hidden');
  btnRematch && btnRematch.classList.add('hidden');

  resetPitch();
  updateScores([room.players[0].score, room.players[1].score]);
  renderDots(room.history);
  roundText.innerText = `ضربه ${toFa(room.kickNumber)}/${toFa(TOTAL_KICKS)}`;
  updateTurnUI(room);

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
  roomState = null;
  myIndex = null;
  persistRoom(null);
});

// ❗ لینک قدیمی/منقضی — اتاق دیگر وجود ندارد
socket.on('roomNotFound', ({ roomId }) => {
  currentRoomId = null;
  myIndex = null;
  roomState = null;
  persistRoom(null);
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
  createSection.classList.remove('hidden');
  waitingSection.classList.add('hidden');
  modalEmoji.innerText = '⌛';
  modalTitle.innerText = "اتاق پیدا نشد";
  modalDesc.innerText = "این لینک منقضی شده. یه مسابقه جدید بساز و لینک تازه بفرست!";
  modal.classList.remove('hidden');
});

// 🔒 عضویت اجباری در کانال
socket.on('notMember', () => {
  currentRoomId = null;
  myIndex = null;
  roomState = null;
  persistRoom(null);
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
  createSection.classList.remove('hidden');
  waitingSection.classList.add('hidden');
  modalEmoji.innerText = '🔒';
  modalTitle.innerText = "عضو کانال نیستی!";
  modalDesc.innerText = "برای بازی کردن باید اول عضو کانال بشی. بعد از عضویت، بازی رو دوباره باز کن.";
  modal.classList.remove('hidden');

  // دکمه موقت عضویت داخل مودال
  let joinBtn = document.getElementById('btn-join-channel');
  if (!joinBtn) {
    joinBtn = document.createElement('button');
    joinBtn.id = 'btn-join-channel';
    joinBtn.className = 'btn-primary';
    joinBtn.style.marginTop = '14px';
    joinBtn.innerText = '📢 عضویت در کانال';
    modal.querySelector('.modal-content').appendChild(joinBtn);
    joinBtn.addEventListener('click', () => {
      const url = 'https://t.me/shayadmessi';
      if (tg && tg.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, '_blank');
    });
  }
});

socket.on('roomFull', () => {
  currentRoomId = null;
  myIndex = null;
  roomState = null;
  persistRoom(null);
  lobbyScreen.classList.add('active');
  gameScreen.classList.remove('active');
  modalEmoji.innerText = '🚫';
  modalTitle.innerText = "اتاق پر است";
  modalDesc.innerText = "این مسابقه شروع شده یا بسته شده. یه مسابقه جدید بساز!";
  modal.classList.remove('hidden');
});

// اتصال دوباره بعد از قطعی: اگر در اتاق بودیم، دوباره بپیوند
socket.on('connect', () => {
  if (currentRoomId) {
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

function updateFromRoom(room) {
  updateNames(room);
  updateScores([room.players[0].score, room.players[1].score]);
  renderDots(room.history);
  roundText.innerText = `ضربه ${toFa(room.kickNumber)}/${toFa(TOTAL_KICKS)}`;
  updateTurnUI(room);
}

function updateNames(room) {
  p1Name.innerText = room.players[0].name;
  p2Name.innerText = room.players[1].name;
  p1Avatar.innerText = initial(room.players[0].name);
  p2Avatar.innerText = initial(room.players[1].name);
  if (room.players[0].avatar && p1Avatar.tagName === 'IMG') p1Avatar.src = room.players[0].avatar;
  if (room.players[1].avatar && p2Avatar.tagName === 'IMG') p2Avatar.src = room.players[1].avatar;
}

function updateScores(scores) {
  if (!scores) return;
  p1Score.innerText = toFa(scores[0] ?? 0);
  p2Score.innerText = toFa(scores[1] ?? 0);
}

// برجسته کردن کارت بازیکنی که نوبتش است
function updateTurnUI(room) {
  const iAmKicker = room.kickerIndex === myIndex;
  myRole = iAmKicker ? 'kicker' : 'goalie';
  myChoice = null;
  targetBtns.forEach(b => b.classList.remove('selected'));

  // تگ نقش روی اسکوربورد
  if (playerCards[0] && playerCards[1]) {
    playerCards[0].classList.toggle('is-kicker', room.kickerIndex === 0);
    playerCards[0].classList.toggle('is-goalie', room.kickerIndex !== 0);
    playerCards[1].classList.toggle('is-kicker', room.kickerIndex === 1);
    playerCards[1].classList.toggle('is-goalie', room.kickerIndex !== 1);
  }

  // کارت نوبت‌دار بدرخشد
  playerCards.forEach((card, i) => {
    if (card) card.classList.toggle('active-turn', room.kickerIndex === i);
  });

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
  if (!p1Dots || !p2Dots) return;

  [p1Dots, p2Dots].forEach((container, i) => {
    container.innerHTML = '';
    const mine = (history || []).filter(h => h.by === i);

    for (let k = 0; k < TOTAL_KICKS; k++) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (mine[k]) {
        dot.classList.add(mine[k].goal ? 'goal' : 'miss');
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
