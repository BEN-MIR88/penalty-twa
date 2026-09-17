const TelegramBot = require('node-telegram-bot-api');

// توکن رباتت
const BOT_TOKEN = '8996508732:AAEZU1IanYRb_w5Q0_YETYDKsfkNyvDNWZ8';

// آدرس وب‌اپت
const WEB_APP_URL = 'https://penalty-twa.onrender.com';

// ساخت ربات
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot is running...');

// دستور /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'بازیکن';
  
  // پیام خوش‌آمدگویی
  const welcomeMessage = `⚽ سلام ${firstName}!

به بازی **ضربات پنالتی** خوش اومدی! 🎯

🎮 **نحوه بازی:**
• یک مسابقه جدید بساز
• لینک دعوت رو برای دوستت بفرست
• هر کدوم یک بار ضربه بزنید و یک بار دروازه‌بانی کنید
• برنده کسیه که گل بیشتری بزنه! 🏆`;

  // دکمه بازی
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

// دستور /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `📖 **راهنمای بازی پنالتی:**

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
• **دروازه‌بان:** حدس بزن توپ به کدوم سمت میاد و شیرجه بزن`;

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
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

// مدیریت خطاها
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code);
});
