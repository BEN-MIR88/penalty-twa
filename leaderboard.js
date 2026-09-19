// ===== سیستم امتیاز و لیدربورد =====
// امتیازها در فایل leaderboard.json ذخیره می‌شوند تا با ری‌استارت سرور از بین نروند
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'leaderboard.json');
const SAVE_DEBOUNCE_MS = 2000;

let data = { players: {} }; // tgId -> { name, username, wins, draws, losses, goals, matches, points }

// بارگذاری اولیه
try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.players) data.players = {};
  }
} catch (e) {
  console.error('Leaderboard load failed:', e.message);
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Leaderboard save failed:', e.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

function ensurePlayer(tgId, name, username) {
  const key = String(tgId);
  if (!data.players[key]) {
    data.players[key] = { name: name || 'بازیکن', username: username || null, wins: 0, draws: 0, losses: 0, goals: 0, matches: 0, points: 0 };
  }
  // آپدیت نام/یوزرنیم اگر عوض شده
  if (name) data.players[key].name = name;
  if (username) data.players[key].username = username;
  return data.players[key];
}

/**
 * ثبت نتیجه یک مسابقه
 * winnerIndex: 0 یا 1 یا null (مساوی)
 * امتیازدهی: برد = ۳، مساوی = ۱، باخت = ۰
 */
function recordResult({ winnerIndex, players, scores, history }) {
  if (!players || players.length !== 2) return;

  players.forEach((p, idx) => {
    if (!p.tgId) return; // بازیکن بدون tgId ثبت نمیشود
    const player = ensurePlayer(p.tgId, p.name, p.username);

    player.matches += 1;
    player.goals += (scores && scores[idx]) || 0;

    if (winnerIndex === null || winnerIndex === undefined) {
      player.draws += 1;
      player.points += 1;
    } else if (winnerIndex === idx) {
      player.wins += 1;
      player.points += 3;
    } else {
      player.losses += 1;
    }
  });

  scheduleSave();
}

// جدول بهترین بازیکن‌ها
function topPlayers(limit = 10) {
  return Object.entries(data.players)
    .map(([tgId, p]) => ({ tgId, ...p }))
    .sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// آمار یک بازیکن خاص
function playerStats(tgId) {
  return data.players[String(tgId)] || null;
}

module.exports = { recordResult, topPlayers, playerStats, ensurePlayer };
