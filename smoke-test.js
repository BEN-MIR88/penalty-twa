// تست دود منطق بازی: دو کلاینت شبیه‌سازی می‌شوند
const { io } = require('socket.io-client');

const URL = 'http://localhost:3999';
const results = { goal: 0, save: 0, turns: [], errors: [] };

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const host = io(URL, { transports: ['websocket'] });
  const guest = io(URL, { transports: ['websocket'] });

  await Promise.all([
    new Promise(r => host.on('connect', r)),
    new Promise(r => guest.on('connect', r)),
  ]);
  console.log('✅ هر دو وصل شدند');

  const state = { started: [], room: null };
  let roomId = null;

  host.on('gameStart', d => { state.started.push('host' + d.youIndex); state.room = d.room; });
  guest.on('gameStart', d => { state.started.push('guest' + d.youIndex); state.room = d.room; });

  // ۱. ساخت اتاق با createRoom
  host.on('roomCreated', d => { roomId = d.roomId; });
  host.emit('createRoom', { playerName: 'Ali', playerTgId: '111', isPublic: true });
  await wait(300);
  if (!roomId) { console.log('❌ roomCreated نگرفت!'); process.exit(1); }
  console.log('✅ اتاق ساخته شد:', roomId);

  // لیست عمومی باید اتاق را نشان دهد
  let publicList = null;
  guest.on('publicRoomsList', d => { publicList = d.rooms; });
  guest.emit('listPublicRooms');
  await wait(300);
  if (!publicList || publicList.length !== 1 || publicList[0].roomId !== roomId) {
    console.log('❌ لیست عمومی غلط است:', publicList);
    process.exit(1);
  }
  console.log('✅ لیست عمومی اتاق را نشان میدهد:', publicList[0].hostName);

  // ۲. بازیکن دوم با joinRoom بیاد — نباید اتاق شبح بسازد
  guest.emit('joinRoom', { roomId, playerName: 'Reza', playerTgId: '222' });
  await wait(300);
  if (state.started.length !== 2) { console.log('❌ gameStart نگرفت:', state.started); process.exit(1); }
  const got = state.started.sort().join(',');
  if (got !== 'guest1,host0') { console.log('❌ youIndex اشتباه:', got); process.exit(1); }
  console.log('✅ بازی شروع شد — host=index0, guest=index1');

  // ۳. لینک قدیمی: joinRoom به اتاق ناموجود → roomNotFound (نه اتاق شبح)
  const ghost = io(URL, { transports: ['websocket'] });
  await new Promise(r => ghost.on('connect', r));
  let notFound = false;
  ghost.on('roomNotFound', () => { notFound = true; });
  ghost.emit('joinRoom', { roomId: 'room_expired999', playerName: 'X', playerTgId: '999' });
  await wait(300);
  if (!notFound) { console.log('❌ roomNotFound برای لینک قدیمی نگرفت!'); process.exit(1); }
  console.log('✅ لینک قدیمی → roomNotFound (بدون اتاق شبح)');
  ghost.close();

  // ۴. بازی کامل
  let roundResult = null;
  let gameOverData = null;
  const hostLog = [];
  host.on('roundResult', d => { roundResult = d; hostLog.push(d); });
  host.on('nextTurn', d => { state.room = d.room; });
  host.on('gameOver', d => { gameOverData = d; });

  // شبیه‌سازی کامل ضربه‌ها (بازی ممکن است زودتر تمام شود — برنده زودهنگام)
  for (let round = 0; round < 10; round++) {
    if (gameOverData) break;
    const room = state.room;
    if (!room) break;
    const kickerSocket = room.kickerIndex === 0 ? host : guest;
    const goalieSocket = room.kickerIndex === 0 ? guest : host;

    // قانون: دو ضربه اول هر بازیکن گل، بقیه مهار → بازی کامل و مساوی ۲-۲
    const ki = room.kickerIndex;
    const kicksByKicker = hostLog.filter(h => h.kickerIndex === ki).length;
    const wantGoal = kicksByKicker < 2;
    // قانون فوتبال: گلر هم‌جهت شوت شیرجه بزنه = مهار، مخالف = گل
    const kick = 'right';
    const gk = wantGoal ? 'center' : 'right';

    roundResult = null;
    kickerSocket.emit('makeMove', { roomId, direction: kick });
    await wait(100);
    goalieSocket.emit('makeMove', { roomId, direction: gk });

    for (let i = 0; i < 50 && !roundResult; i++) await wait(100);
    if (!roundResult) { console.log(`❌ ضربه ${round}: نتیجه نگرفت`); process.exit(1); }

    const expected = wantGoal;
    if (roundResult.isGoal !== expected) {
      console.log(`❌ ضربه ${round}: goal=${roundResult.isGoal} ولی باید ${expected} باشد`);
      process.exit(1);
    }
    results[expected ? 'goal' : 'save']++;
    results.turns.push(roundResult.kickerIndex);
    await wait(4700); // صبر برای انیمیشن سرور
  }

  console.log(`✅ ${hostLog.length} ضربه درست محاسبه شد (${results.goal} گل / ${results.save} مهار)`);
  const kicks0 = hostLog.filter(h => h.kickerIndex === 0).length;
  const kicks1 = hostLog.filter(h => h.kickerIndex === 1).length;
  console.log(`✅ ضربه‌های بازیکن ۱: ${kicks0}، بازیکن ۲: ${kicks1}`);
  if (!gameOverData) { console.log('❌ بازی تمام نشد!'); process.exit(1); }

  // بررسی برنده: گل‌های هر بازیکن از روی تاریخچه
  const hist = gameOverData.history;
  const goalsP0 = hist.filter(h => h.by === 0 && h.goal).length;
  const goalsP1 = hist.filter(h => h.by === 1 && h.goal).length;
  const expW = goalsP0 === goalsP1 ? null : (goalsP0 > goalsP1 ? 0 : 1);
  if (gameOverData.winnerIndex !== expW) {
    console.log(`❌ برنده غلط: ${gameOverData.winnerIndex} ولی باید ${expW} (گل‌ها: ${goalsP0}-${goalsP1})`);
    process.exit(1);
  }
  if (gameOverData.scores[0] !== goalsP0 || gameOverData.scores[1] !== goalsP1) {
    console.log(`❌ اسکور غلط: ${gameOverData.scores} ولی باید ${goalsP0}-${goalsP1}`);
    process.exit(1);
  }
  console.log(`✅ gameOver درست: برنده=${gameOverData.winnerIndex}، نتیجه=${goalsP0}-${goalsP1} ${gameOverData.history.length < 10 ? '(برنده زودهنگام!)' : ''}`);

  // ۵. بازی مجدد
  const rematchStart = [];
  host.on('gameStart', d => rematchStart.push(d.youIndex));
  host.emit('rematch', { roomId });
  await wait(400);
  if (rematchStart.length !== 1) { console.log('❌ بازی مجدد نگرفت'); process.exit(1); }
  console.log('✅ بازی مجدد کار میکند');

  console.log('\n🎉 همه تست‌ها پاس شد!');
  host.close(); guest.close();
  process.exit(0);
}

run().catch(e => { console.error('❌ خطا:', e); process.exit(1); });
