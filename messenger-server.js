require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const OpenAI = require('openai');

const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function translateToJapanese(text) {
  try {
    const res = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{ role: 'user', content: `以下のテキストを日本語に翻訳してください。翻訳文のみ返してください:\n${text}` }]
    });
    return res.choices[0].message.content;
  } catch { return null; }
}

async function generateReplySuggestions(customerName, history, lastMessage) {
  try {
    const historyText = history.slice(-6).map(m => `${m.from === 'me' ? '自分' : customerName}: ${m.text}`).join('\n');
    const res = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [
        { role: 'system', content: 'You are a staff member at a Japanese trading card shop. Always reply in the same language as the customer\'s last message. Never use Japanese unless the customer wrote in Japanese. Consider the full conversation context when generating replies.' },
        { role: 'user', content: `Here is the full conversation so far between a Japanese trading card shop staff and a customer:\n\n${historyText}\n\nBased on the ENTIRE conversation context above, generate 3 natural reply options for the staff to send next. Replies must be in the same language as the customer. Each option on its own line:\n1. [reply] | [Japanese translation]\n2. [reply] | [Japanese translation]\n3. [reply] | [Japanese translation]\n\n1-2 sentences each. No extra text or labels.` }
      ]
    });
    const text = res.choices[0].message.content;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];
    for (const l of lines) {
      const body = l.replace(/^[1-3][\.\)]\s*/, '').trim();
      if (!body) continue;
      const [en, ja] = body.split('|').map(s => s.trim());
      if (en) results.push({ en, ja: ja || '' });
      if (results.length >= 3) break;
    }
    return results;
  } catch(e) { console.error('❌ AI suggestions error:', e.message); return []; }
}

const DATA_FILE = path.join(__dirname, 'conversations.json');
const PORT = process.env.MESSENGER_PORT || 3210;

// --- データ管理 ---
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { customers: {}, messages: {} };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { customers: {}, messages: {} }; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// --- WebSocket クライアント管理 ---
const wsClients = new Set();

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// --- Discord Bot ---
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

discord.once('ready', () => {
  console.log(`✅ Discord Bot起動: ${discord.user.tag}`);
});

discord.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const customerId = `discord_${msg.author.id}`;
  const customerName = msg.author.globalName || msg.author.username;
  const channelName = msg.channel.name || 'DM';

  // 顧客登録
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      id: customerId,
      name: customerName,
      platform: 'discord',
      avatar: msg.author.displayAvatarURL(),
      tags: [],
      note: '',
      createdAt: new Date().toISOString(),
    };
  }
  db.customers[customerId].lastSeen = new Date().toISOString();
  db.customers[customerId].unread = (db.customers[customerId].unread || 0) + 1;

  // メッセージ保存
  if (!db.messages[customerId]) db.messages[customerId] = [];
  const translation = await translateToJapanese(msg.content);
  const message = {
    id: msg.id,
    from: 'customer',
    text: msg.content,
    translation,
    channel: channelName,
    channelId: msg.channelId,
    platform: 'discord',
    timestamp: msg.createdAt.toISOString(),
  };
  db.messages[customerId].push(message);
  saveData(db);

  // AI返信案を生成
  const suggestions = await generateReplySuggestions(customerName, db.messages[customerId], msg.content);

  // フロントに通知
  broadcast('new_message', { customerId, customer: db.customers[customerId], message, suggestions });
  console.log(`📨 Discord [${customerName}]: ${msg.content}`);
});

// --- Express API ---
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// 顧客一覧
app.get('/api/customers', (req, res) => {
  const list = Object.values(db.customers).sort((a, b) =>
    new Date(b.lastSeen || b.createdAt) - new Date(a.lastSeen || a.createdAt)
  );
  res.json(list);
});

// メッセージ一覧
app.get('/api/messages/:customerId', (req, res) => {
  res.json(db.messages[req.params.customerId] || []);
});

// 既読にする
app.post('/api/customers/:customerId/read', (req, res) => {
  if (db.customers[req.params.customerId]) {
    db.customers[req.params.customerId].unread = 0;
    saveData(db);
  }
  res.json({ ok: true });
});

// タグ・メモ更新
app.post('/api/customers/:customerId/update', (req, res) => {
  const { tags, note } = req.body;
  if (db.customers[req.params.customerId]) {
    if (tags !== undefined) db.customers[req.params.customerId].tags = tags;
    if (note !== undefined) db.customers[req.params.customerId].note = note;
    saveData(db);
  }
  res.json({ ok: true });
});

// Discord返信
app.post('/api/reply/discord', async (req, res) => {
  const { channelId, text } = req.body;
  try {
    const channel = await discord.channels.fetch(channelId);
    await channel.send(text);

    // 送信メッセージも保存
    const customerId = req.body.customerId;
    if (customerId && db.messages[customerId]) {
      const message = {
        id: `sent_${Date.now()}`,
        from: 'me',
        text,
        platform: 'discord',
        timestamp: new Date().toISOString(),
      };
      db.messages[customerId].push(message);
      saveData(db);
      broadcast('new_message', { customerId, message });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WhatsApp Webhook 検証
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'kyosuke_verify_token') {
    console.log('✅ WhatsApp Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// WhatsApp メッセージ受信
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    if (!value?.messages) return;

    for (const msg of value.messages) {
      if (msg.type !== 'text') continue;
      const waId = msg.from;
      const text = msg.text.body;
      const contact = value.contacts?.find(c => c.wa_id === waId);
      const name = contact?.profile?.name || waId;
      const customerId = `whatsapp_${waId}`;

      if (!db.customers[customerId]) {
        db.customers[customerId] = {
          id: customerId, name,
          platform: 'whatsapp',
          tags: [], note: '',
          createdAt: new Date().toISOString(),
        };
      }
      db.customers[customerId].lastSeen = new Date().toISOString();
      db.customers[customerId].unread = (db.customers[customerId].unread || 0) + 1;

      if (!db.messages[customerId]) db.messages[customerId] = [];
      const translation = await translateToJapanese(text);
      const message = {
        id: msg.id, from: 'customer', text, translation,
        platform: 'whatsapp',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
      };
      db.messages[customerId].push(message);
      saveData(db);

      const suggestions = await generateReplySuggestions(name, db.messages[customerId], text);
      broadcast('new_message', { customerId, customer: db.customers[customerId], message, suggestions });
      console.log(`📱 WhatsApp [${name}]: ${text}`);
    }
  } catch (e) { console.error('WhatsApp webhook error:', e); }
});

// WhatsApp 返信
app.post('/api/reply/whatsapp', async (req, res) => {
  const { waId, text, customerId } = req.body;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: waId, type: 'text', text: { body: text } })
    });
    if (!r.ok) throw new Error(await r.text());

    if (customerId && db.messages[customerId]) {
      const message = { id: `sent_${Date.now()}`, from: 'me', text, platform: 'whatsapp', timestamp: new Date().toISOString() };
      db.messages[customerId].push(message);
      saveData(db);
      broadcast('new_message', { customerId, message });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messenger Webhook 検証
app.get('/webhook/messenger', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === 'kyosuke_verify_token') {
    console.log('✅ Messenger Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Messenger メッセージ受信
app.post('/webhook/messenger', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'page') return;
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (!event.message || event.message.is_echo) continue;
        const senderId = event.sender.id;
        const text = event.message.text;
        if (!text) continue;
        const customerId = `messenger_${senderId}`;

        // ユーザー名取得
        let name = senderId;
        try {
          const r = await fetch(`https://graph.facebook.com/v20.0/${senderId}?fields=name&access_token=${process.env.MESSENGER_PAGE_TOKEN}`);
          if (r.ok) { const d = await r.json(); name = d.name || senderId; }
        } catch {}

        if (!db.customers[customerId]) {
          db.customers[customerId] = {
            id: customerId, name,
            platform: 'messenger',
            tags: [], note: '',
            createdAt: new Date().toISOString(),
          };
        }
        db.customers[customerId].lastSeen = new Date().toISOString();
        db.customers[customerId].unread = (db.customers[customerId].unread || 0) + 1;

        if (!db.messages[customerId]) db.messages[customerId] = [];
        const translation = await translateToJapanese(text);
        const message = {
          id: event.message.mid, from: 'customer', text, translation,
          platform: 'messenger',
          timestamp: new Date(event.timestamp).toISOString(),
        };
        db.messages[customerId].push(message);
        saveData(db);

        const suggestions = await generateReplySuggestions(name, db.messages[customerId], text);
        broadcast('new_message', { customerId, customer: db.customers[customerId], message, suggestions });
        console.log(`💬 Messenger [${name}]: ${text}`);
      }
    }
  } catch (e) { console.error('Messenger webhook error:', e); }
});

// Messenger 返信
app.post('/api/reply/messenger', async (req, res) => {
  const { senderId, text, customerId } = req.body;
  try {
    const r = await fetch('https://graph.facebook.com/v20.0/me/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.MESSENGER_PAGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: senderId }, message: { text } })
    });
    if (!r.ok) throw new Error(await r.text());

    if (customerId && db.messages[customerId]) {
      const message = { id: `sent_${Date.now()}`, from: 'me', text, platform: 'messenger', timestamp: new Date().toISOString() };
      db.messages[customerId].push(message);
      saveData(db);
      broadcast('new_message', { customerId, message });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// WhatsApp手動メッセージ追加（暫定）
app.post('/api/messages/:customerId/manual', (req, res) => {
  const { text, from, platform } = req.body;
  const customerId = req.params.customerId;
  if (!db.messages[customerId]) db.messages[customerId] = [];
  const message = {
    id: `manual_${Date.now()}`,
    from: from || 'customer',
    text,
    platform: platform || 'whatsapp',
    timestamp: new Date().toISOString(),
  };
  db.messages[customerId].push(message);
  saveData(db);
  broadcast('new_message', { customerId, message });
  res.json({ ok: true });
});

// LINE取込: AIパース
app.post('/api/parse-line', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ items: [] });
  try {
    const response = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `あなたはトレーディングカードショップの仕入れ担当者です。業者からのLINE/Discordメッセージを解析し、商品ごとの仕入れ情報をJSON形式で抽出してください。

出力形式（JSONオブジェクト）:
{
  "items": [
    {
      "name": "商品名（ポケモンカードゲーム〇〇 拡張パックなど正式名に近い形で）",
      "price": 数値（1BOXあたりの単価、円）,
      "qty": 数値（数量）,
      "unit": "BOX" または "カートン" または "case",
      "shrink": true または false または null（シュリンクあり=true、なし=false、不明=null）,
      "isCarton": true または false（カートン・caseならtrue）
    }
  ]
}

ルール:
- カートン・caseは1カートンあたりの総額を入力し isCarton:true にする
- シュリなし・シュリンクなし・白箱はshrink:false
- 数量が書かれていない場合はqty:1
- ダメージ品・訳あり品・送料・注意書きはスキップ
- 同じ商品で複数の数量・価格がある場合は別itemとして出力
- 商品名は略称（例:「蒼空」「ミラクル」）でも構わない
- 価格が100円未満のものはスキップ`
        },
        { role: 'user', content: text }
      ]
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    res.json({ items: parsed.items || [] });
  } catch (e) {
    console.error('AI parse error:', e.message);
    res.json({ items: [], error: e.message });
  }
});

// AI返信案を生成
app.post('/api/suggest/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const customer = db.customers[customerId];
  const messages = db.messages[customerId] || [];
  const last = messages.filter(m => m.from === 'customer').pop();
  if (!last) return res.json({ suggestions: [] });
  const suggestions = await generateReplySuggestions(customer?.name || '顧客', messages, last.text);
  res.json({ suggestions });
});

// 顧客追加（手動）
app.post('/api/customers', (req, res) => {
  const { name, platform, note } = req.body;
  const id = `manual_${Date.now()}`;
  db.customers[id] = {
    id, name, platform: platform || 'whatsapp',
    tags: [], note: note || '',
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    unread: 0,
  };
  if (!db.messages[id]) db.messages[id] = [];
  saveData(db);
  broadcast('customer_added', db.customers[id]);
  res.json(db.customers[id]);
});

// ── 価格・在庫変動 Discord通知 ────────────────────────
app.post('/api/notify-price-changes', async (req, res) => {
  const { changes } = req.body;
  if (!changes?.length) return res.json({ ok: true, sent: 0 });

  const webhookUrl = process.env.DISCORD_PRICE_WEBHOOK;
  if (!webhookUrl) return res.status(400).json({ error: 'DISCORD_PRICE_WEBHOOK未設定' });

  const fmt = n => `¥${Number(n).toLocaleString('ja-JP')}`;
  const diff = (a, b) => { const d = b - a; return d > 0 ? `(+${fmt(d)})` : `(${fmt(d)})`; };

  // 分類
  const watch = [], buy = [], other = [];
  changes.forEach(c => {
    const up   = c.newPrice > c.oldPrice;
    const down = c.newPrice < c.oldPrice;
    const stockDown = c.oldStock != null && c.newStock != null && c.newStock < c.oldStock;
    const stockUp   = c.oldStock != null && c.newStock != null && c.newStock > c.oldStock;
    if (up   && (stockDown || c.newStock === 0)) watch.push(c);
    else if (down && stockUp) buy.push(c);
    else other.push(c);
  });

  const PRICELIST_URL = 'https://kyosuke-takei.github.io/pricelist/';

  const itemLine = c => {
    const name = (c.nameEn || c.name || '').replace(/^pkmn-tcg-\S+\s+/, '');
    let s = `• **${name}**: ${fmt(c.oldPrice)} → ${fmt(c.newPrice)} ${diff(c.oldPrice, c.newPrice)}`;
    if (c.oldStock != null && c.newStock != null) s += ` | Stock: ${c.oldStock}→**${c.newStock}**`;
    else if (c.newStock != null) s += ` | Stock: ${c.newStock}`;
    return s;
  };

  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const lines = [`📊 **Price & Stock Report** ${today}`];
  if (watch.length) {
    lines.push('', '🚨 **Watch** — Price ↑ & Stock ↓ (consider buying)');
    watch.forEach(c => lines.push(itemLine(c)));
  }
  if (buy.length) {
    lines.push('', '💰 **Buy Opportunity** — Price ↓ & Stock ↑');
    buy.forEach(c => lines.push(itemLine(c)));
  }
  if (other.length) {
    lines.push('', '📝 **Other Changes**');
    other.forEach(c => lines.push(itemLine(c)));
  }
  lines.push('', `🔗 [View Price List](${PRICELIST_URL})`);

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: lines.join('\n') })
    });
    if (!r.ok) throw new Error(`Webhook error: ${r.status}`);
    res.json({ ok: true, sent: changes.length });
  } catch (e) {
    console.error('Discord通知エラー:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 商品名 日→英 AI翻訳 ─────────────────────────────
app.post('/api/translate-names', async (req, res) => {
  const { names } = req.body; // [{ id, name }]
  if (!names?.length) return res.json({ results: [] });
  try {
    const resp = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'あなたはトレーディングカードゲームの専門家です。日本語の商品名を英語の正式名称に変換してください。ポケモンカードのBOX名はできるだけ公式英語名（例: Scarlet & Violet, Terastal Festival ex, etc.）を使用してください。回答は {"results":[{"id":"...","nameEn":"..."},...]} の形式のみで返してください。' },
        { role: 'user', content: JSON.stringify(names) }
      ]
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ results: [], error: e.message });
  }
});

// 静的ファイル配信（admin.html, data.json等）
app.use(express.static(__dirname));

// --- HTTP + WebSocket サーバー起動 ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`🚀 メッセンジャーサーバー起動: http://localhost:${PORT}`);
});

discord.login(process.env.DISCORD_BOT_TOKEN);
