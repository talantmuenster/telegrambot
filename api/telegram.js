import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKENN;
const MANAGER_CHAT_ID = Number(process.env.MANAGER_CHAT_ID);

if (!BOT_TOKEN) throw new Error('BOT TOKEN not provided');

const bot = new Telegraf(BOT_TOKEN);

const DB_PATH = path.join(process.cwd(), 'submissions.json');

// ===== DB =====
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { submissions: [], lastId: 0 };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ===== Сохранение заявки =====
function saveSubmissionToJson({ text, photo }) {
  const db = loadDb();
  const id = ++db.lastId;

  const submission = {
    id,
    text,
    photo: photo || null,
    favorite: false,
    selected: false,
    createdAt: Date.now(),
  };

  db.submissions.push(submission);
  saveDb(db);

  return submission;
}

// ===== Кнопки =====
function buildKeyboard(sub, index = null, total = null) {
  const fav = sub.favorite ? '⭐ Убрать' : '⭐ В избранное';
  const sel = sub.selected ? '🏁 Убрать' : '🏁 В отбор';

  const nav =
    index && total
      ? [
          Markup.button.callback('← Назад', `prev:${index}`),
          Markup.button.callback(`${index}/${total}`, 'noop'),
          Markup.button.callback('Вперёд →', `next:${index}`)
        ]
      : [];

  const kb = [
    [
      Markup.button.callback(fav, `fav:${sub.id}`),
      Markup.button.callback(sel, `sel:${sub.id}`)
    ]
  ];

  if (nav.length) kb.push(nav);

  return kb;
}

// ===== Отправка заявки менеджеру =====
async function sendSubmissionCard(ctx, sub, index, total) {
  const keyboard = buildKeyboard(sub, index, total);

  if (sub.photo) {
    await ctx.replyWithPhoto(sub.photo, {
      caption: sub.text,
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    await ctx.reply(sub.text, {
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// ===== Приём сообщений от пользователей =====
bot.on('message', async (ctx) => {
  const msg = ctx.message;
  const text = msg.caption || msg.text || '';

  // Определение заявки
  const isSubmission = text.startsWith('🎄') || msg.photo;

  if (!isSubmission) return;

  const photo = msg.photo ? msg.photo.at(-1).file_id : null;
  const submission = saveSubmissionToJson({ text, photo });

  // Отправка менеджеру
  if (photo) {
    await bot.telegram.sendPhoto(MANAGER_CHAT_ID, photo, {
      caption: text,
      reply_markup: { inline_keyboard: buildKeyboard(submission) }
    });
  } else {
    await bot.telegram.sendMessage(MANAGER_CHAT_ID, text, {
      reply_markup: { inline_keyboard: buildKeyboard(submission) }
    });
  }
});

// ===== Команды менеджера =====
bot.command('all', (ctx) => {
  const db = loadDb();
  const list = db.submissions;

  if (!list.length) return ctx.reply('❌ Заявок нет');

  sendSubmissionCard(ctx, list[0], 1, list.length);
});

bot.command('favorites', (ctx) => {
  const fav = loadDb().submissions.filter((s) => s.favorite);
  if (!fav.length) return ctx.reply('⭐ Нет избранных');

  sendSubmissionCard(ctx, fav[0], 1, fav.length);
});

bot.command('selected', (ctx) => {
  const sel = loadDb().submissions.filter((s) => s.selected);
  if (!sel.length) return ctx.reply('🏁 Нет отобранных');

  sendSubmissionCard(ctx, sel[0], 1, sel.length);
});

// ===== Обработка кнопок =====
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [type, value] = data.split(':');

  const db = loadDb();
  const list = db.submissions;

  if (type === 'noop') return ctx.answerCbQuery();

  // Навигация
  if (type === 'next' || type === 'prev') {
    const index = Number(value) - 1;
    const total = list.length;

    let newIndex =
      type === 'next'
        ? (index + 1) % total
        : (index - 1 + total) % total;

    const sub = list[newIndex];
    await ctx.deleteMessage();
    await sendSubmissionCard(ctx, sub, newIndex + 1, total);

    return ctx.answerCbQuery();
  }

  // fav / sel
  const id = Number(value);
  const sub = list.find((s) => s.id === id);
  if (!sub) return ctx.answerCbQuery('Не найдено');

  if (type === 'fav') sub.favorite = !sub.favorite;
  if (type === 'sel') sub.selected = !sub.selected;

  saveDb(db);

  const index = list.findIndex((x) => x.id === id) + 1;
  const total = list.length;

  await ctx.editMessageReplyMarkup({
    inline_keyboard: buildKeyboard(sub, index, total)
  });

  ctx.answerCbQuery('Готово');
});

// ===== Webhook обработчик для Vercel =====
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    } catch (err) {
      console.error(err);
      return res.status(500).send('ERROR');
    }
  }

  res.status(200).send('Bot running');
}
