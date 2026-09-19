// تست تایم‌اوت نوبت: بازیکن دوم AFK → بعد از ۱۵ ثانیه خودکار حل میشود
const { io } = require('socket.io-client');

const URL = 'http://localhost:3999';
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const host = io(URL, { transports: ['websocket'] });
  await new Promise(r => host.on('connect', r));

  let roomId = null;
  let gameStarted = false;
  let roundResult = null;

  host.on('roomCreated', d => { roomId = d.roomId; });
  host.on('gameStart', () => { gameStarted = true; });
  host.on('roundResult', d => { roundResult = d; });

  host.emit('createRoom', { playerName: 'Host', playerTgId: '900', isPublic: false });
  await wait(300);
  if (!roomId) { console.log('❌ اتاق ساخته نشد'); process.exit(1); }

  // بازیکن دوم میآید و بعدش AFK میشود (هیچ انتخابی نمیکند)
  const guest = io(URL, { transports: ['websocket'] });
  await new Promise(r => guest.on('connect', r));
  guest.emit('joinRoom', { roomId, playerName: 'AFK', playerTgId: '901' });
  await wait(500);

  if (!gameStarted) { console.log('❌ بازی شروع نشد'); process.exit(1); }
  console.log('✅ بازی شروع شد — حالت: host نوبت شوت دارد، guest AFK است');

  // host ضربه میزند، guest هیچوقت انتخاب نمیکند
  host.emit('makeMove', { roomId, direction: 'left' });
  console.log('⏱ منتظر تایم‌اوت ۱۵ ثانیه‌ای...');

  for (let i = 0; i < 200 && !roundResult; i++) await wait(100);
  if (!roundResult) { console.log('❌ تایم‌اوت کار نکرد — بازی گیر کرد!'); process.exit(1); }

  // host چپ زده، AFK خودکار وسط → چپ ≠ وسط → گل!
  if (!roundResult.isGoal || roundResult.kickerChoice !== 'left' || roundResult.goalieChoice !== 'center') {
    console.log('❌ نتیجه تایم‌اوت غلط:', roundResult);
    process.exit(1);
  }
  console.log('✅ تایم‌اوت کار کرد: AFK خودکار وسط زد → گل حساب شد');

  // حالا نوبت بعد باید برگردد (بازی ادامه دارد)
  let nextTurnReceived = false;
  host.on('nextTurn', () => { nextTurnReceived = true; });
  await wait(5000);
  if (!nextTurnReceived) { console.log('❌ nextTurn بعد از ضربه تایم‌اوتی نیامد'); process.exit(1); }
  console.log('✅ بازی بعد از تایم‌اوت ادامه پیدا کرد (nextTurn رسید)');

  console.log('\n🎉 تست تایم‌اوت پاس شد!');
  host.close(); guest.close();
  process.exit(0);
}

run().catch(e => { console.error('❌ خطا:', e); process.exit(1); });
