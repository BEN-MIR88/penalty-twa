// ===== ذخیره‌سازی اتاق‌ها روی دیسک =====
// چون Render (پلن رایگان) هر لحظه ممکن است ری‌استارت یا بخوابد،
// اتاق‌های در حال انتظار در فایل rooms.json ذخیره میشوند تا لینک‌های دعوت زنده بمانند.
const fs = require('fs');
const path = require('path');

const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const SAVE_DEBOUNCE_MS = 1000;

let saveTimer = null;

function saveRooms(rooms) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // فقط داده‌های قابل بازیابی — socket.idها بعد از ری‌استارت بی‌معنی هستند
      const persistable = {};
      for (const [id, r] of Object.entries(rooms)) {
        persistable[id] = {
          id: r.id,
          players: r.players.map(p => ({
            tgId: p.tgId,
            name: p.name,
            avatar: p.avatar,
            username: p.username,
            score: p.score,
            disconnected: true // همه آفلاین فرض میشوند تا با سوکت تازه دوباره وصل شوند
          })),
          kickerIndex: r.kickerIndex,
          goalieIndex: r.goalieIndex,
          choices: r.choices,
          turn: r.turn,
          kickNumber: r.kickNumber,
          history: r.history,
          status: r.status,
          isPublic: r.isPublic,
          createdAt: r.createdAt,
          lastActivity: Date.now()
        };
      }
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(persistable));
    } catch (e) {
      console.error('Rooms save failed:', e.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

// بازیابی هنگام استارت — اتاق‌های قدیمی با grace طولانی دوباره زنده میشوند
function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    const now = Date.now();

    const restored = {};
    for (const [id, r] of Object.entries(raw)) {
      // فقط اتاق‌های تازه (کمتر از ۳۰ دقیقه) بازیابی شوند
      if (now - (r.lastActivity || 0) > 30 * 60 * 1000) continue;

      // در بازیِ در جریان، حریفی که نرفته ببرد نیست — بازی به حالت معلق نمیرود؛
      // اگر بازی تمام‌نشده بود، از آخرین ضربه تمام‌شده ادامه میدهیم
      if (r.status === 'playing' && r.choices && (r.choices.kicker || r.choices.goalie)) {
        // ضربه ناقص را لغو کن
        r.choices = { kicker: null, goalie: null };
      }

      restored[id] = r;
    }

    if (Object.keys(restored).length) {
      console.log(`♻️ ${Object.keys(restored).length} room(s) restored from disk`);
    }
    return restored;
  } catch (e) {
    console.error('Rooms load failed:', e.message);
    return {};
  }
}

module.exports = { saveRooms, loadRooms };
