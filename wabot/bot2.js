const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');

const LLAMA_URL     = 'http://localhost:8080/v1/chat/completions';
const BOT_PREFIX    = '!ai';
const TARGET_GROUPS = ['Instagram tags ', 'Nonsense', 'Bot Testing'];

console.log('🚀 Starting BOT2.JS - SPEED DEMON MODE (Llama-Only, No History)');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: puppeteer.executablePath(),
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('✅ Bot2 is ready and monitoring...'));

client.on('message_create', async (msg) => {
  if (!msg.body.startsWith(BOT_PREFIX)) return;

  const chat = await msg.getChat();
  if (chat.isGroup && !TARGET_GROUPS.includes(chat.name)) return;

  const userText = msg.body.slice(BOT_PREFIX.length).trim();
  if (!userText) return;

  console.log(`\n--- SPEED TEST ---`);
  console.log(`Input: ${userText.substring(0, 50)}...`);

  try {
    const startTime = Date.now();
    
    // PURE SINGLE TURN REQUEST - NO HISTORY, NO SYSTEM PROMPT
    const response = await axios.post(LLAMA_URL, {
      messages: [{ role: "user", content: userText }],
      stream: false,
      max_tokens: 256
    });

    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    const reply = response.data.choices[0].message.content;
    const tokenCount = reply.split(/\s+/).length; // Rough estimate
    const tps = (tokenCount / durationSec).toFixed(2);

    console.log(`⏱️ Response Time: ${durationSec}s`);
    console.log(`📊 Est. Speed: ${tps} tokens/sec`);
    console.log(`------------------\n`);

    await msg.reply(reply + `\n\n📊 *Speed:* ${tps} t/s\n⏱️ *Time:* ${durationSec}s`);

  } catch (err) {
    console.error('Llama Error:', err.message);
    if (err.code === 'ECONNREFUSED') {
      await msg.reply('❌ Llama-server is not running on port 8080!');
    } else {
      await msg.reply('❌ Error: ' + err.message);
    }
  }
});

client.initialize();