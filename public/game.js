const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

const socket = io();

// گرفتن اطلاعات کاربر از تلگرام
const user = tg?.initDataUnsafe?.user || {
  id: Math.floor(Math.random() * 100000),
  first_name: 'کاربر تستی'
};

// گرفتن roomId از پارامتر URL (Deep Linking تلگرام)
const urlParams = new URLSearchParams(window.location.search);
let currentRoomId = urlParams.get('tgWebAppStartParam') || urlParams.get('room') || null;

let myRole = null; // 'kicker' | 'goalie'
let myChoice = null;
let currentRound = 1;

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

// ۱. شروع یا ورود مستقیم
if (currentRoomId) {
  // اگر با لینک جوین شده است
  socket.emit('joinRoom', {
    roomId: currentRoomId,
    playerName: user.first_name,
    playerAvatar: user.photo_url
  });
}

btnCreate.addEventListener('click', () => {
  const generatedRoomId = 'room_' + Math.random().toString(36).substring(2, 8);
  currentRoomId = generatedRoomId;
  
  socket.emit('joinRoom', {
    roomId: generatedRoomId,
    playerName: user.first_name,
    playerAvatar: user.photo_url
  });

  createSection.classList.add('hidden');
  waitingSection.classList.remove('hidden');

  // لینک دعوت تحت بات تلگرام
  const botUsername = "penalty_ben_bot"; // یوزرنیم رباتت
  const inviteUrl = `https://t.me/${botUsername}/app?startapp=${generatedRoomId}`;
  inviteLinkInput.value = inviteUrl;
});

btnCopy.addEventListener('click', () => {
  navigator.clipboard.writeText(inviteLinkInput.value);
  btnCopy.innerText = "کپی شد! ✅";
  setTimeout(() => btnCopy.innerText = "کپی لینک دعوت", 2000);
});

// ۲. انتخاب جهت
targetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (myChoice) return; // اجازه انتخاب دوباره نده
    const direction = btn.getAttribute('data-dir');
    myChoice = direction;

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
  updateRoles(kicker, goalie, round);
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
    // بروزرسانی اسکوربورد
    const playerIds = Object.keys(scores);
    p1Score.innerText = scores[playerIds[0]];
    p2Score.innerText = scores[playerIds[1]];

    // نمایش مودال
    modal.classList.remove('hidden');
    if (isGoal) {
      modalTitle.innerText = "⚽ گـــل شـــد!";
      modalDesc.innerText = `پنالتی‌زن جهت (${kickerChoice}) و گلر جهت (${goalieChoice}) را انتخاب کردند.`;
    } else {
      modalTitle.innerText = "🧤 مهـار شـــد!";
      modalDesc.innerText = `دروازه‌بان دست پنالتی‌زن را خواند و توپ را گرفت!`;
    }
  }, 600);
});

socket.on('nextRound', ({ round, kicker, goalie }) => {
  modal.classList.add('hidden');
  resetPitch();
  updateRoles(kicker, goalie, round);
});

socket.on('gameOver', ({ winner, players }) => {
  modal.classList.remove('hidden');
  if (winner) {
    modalTitle.innerText = `🏆 برنده: ${winner.name}`;
    modalDesc.innerText = `بازی با نتیجه ${players[0].score} - ${players[1].score} به پایان رسید!`;
  } else {
    modalTitle.innerText = "🤝 مساوی!";
    modalDesc.innerText = `نتیجه برابر ${players[0].score} شد.`;
  }
});

function updateRoles(kicker, goalie, round) {
  currentRound = round;
  roundText.innerText = `راند ${round}`;
  myChoice = null;
  targetBtns.forEach(b => b.classList.remove('selected'));

  if (socket.id === kicker.id) {
    myRole = 'kicker';
    roleStatus.innerText = "👟 نقش: پنالتی‌زن (شوت بزن)";
    subStatus.innerText = "یک گوشه از دروازه را برای شوت انتخاب کن";
  } else {
    myRole = 'goalie';
    roleStatus.innerText = "🧤 نقش: دروازه‌بان (مهار کن)";
    subStatus.innerText = "حدس بزن شوت به کدوم سمت میاد و شیرجه بزن";
  }
}

function resetPitch() {
  ball.className = 'ball';
  goalkeeper.className = 'goalkeeper center';
}
