const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { exec } = require('child_process');

// ── Config ────────────────────────────────────────────────
const OLLAMA_URL    = 'http://localhost:11434/api/chat';
const LLAMA_URL     = 'http://localhost:8080/v1/chat/completions'; // llama-server
let currentModel    = 'dolphin-mixtral:8x7b'; // default model
let currentProvider = 'ollama';                // 'ollama' or 'llama'
let ph3dMode        = true;                    // ON by default for real-time search
let claudeMode      = false;
let showThoughts    = false;                  // Toggle for <think> blocks
let thinkLevel      = 0;                      // 0=none, 1=some, 2=full
let claudePage      = null;                   // Holds the puppeteer page
const BACKEND_URL   = 'http://localhost:5000'; // server2.py
const BOT_PREFIX    = '!ai';                   // users type !ai followed by their question
const TARGET_GROUPS = ['Instagram tags ', 'Nonsense', 'Bot Testing']; // exact names
const MAX_HISTORY   = 15;                      // how many messages to remember per group
// ─────────────────────────────────────────────────────────

const history = new Map(); // stores conversation history per group

const TOOLS = [
  { type: "function", function: { name: "web_search", description: "Search the web for current events, news, or info.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "scrape_url", description: "Extract text from a webpage URL.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } }
];

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: puppeteer.executablePath(),
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

// Show QR code in terminal on first run
client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp (Linked Devices):');
  qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
  console.log(`⌛ [WhatsApp Prep] ${percent}% - ${message}`);
});

client.on('authenticated', () => {
  console.log('🔐 Authenticated successfully! Syncing messages...');
});

client.on('ready', async () => {
  console.log('\n✅ WhatsApp bot is ready and listening!');
  
  try {
    console.log('🌐 Opening Claude.ai tab in the background...');
    claudePage = await client.pupBrowser.newPage();
    await claudePage.goto('https://claude.ai/new', { waitUntil: 'networkidle2' });
    console.log("✅ Claude tab ready! Please log into Claude in the Chrome window if you haven't already.");
  } catch(e) {
    console.error('❌ Failed to open Claude tab:', e.message);
  }
});

async function sendToClaude(text) {
  if (!claudePage) throw new Error("Claude page not initialized");
  
  const inputSelector = '.ProseMirror, div[contenteditable="true"]';
  await claudePage.waitForSelector(inputSelector, { timeout: 10000 });
  await claudePage.focus(inputSelector);
  
  await claudePage.keyboard.down('Control');
  await claudePage.keyboard.press('A');
  await claudePage.keyboard.up('Control');
  await claudePage.keyboard.press('Backspace');

  await claudePage.keyboard.type(text);
  await new Promise(r => setTimeout(r, 500));
  await claudePage.keyboard.press('Enter');

  console.log('[DEBUG] Sent to Claude, waiting for response...');
  await new Promise(r => setTimeout(r, 2000));

  let lastLength = -1;
  let noChangeCount = 0;
  let finalResponse = "";

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const responses = await claudePage.evaluate(() => {
      const assistantMsgs = Array.from(document.querySelectorAll('.font-claude-message, [data-is-streaming]'));
      if (assistantMsgs.length > 0) return assistantMsgs[assistantMsgs.length - 1].innerText;
      return "";
    });

    if (responses === "") continue;

    if (responses.length === lastLength) {
      noChangeCount++;
      if (noChangeCount >= 2) { 
        finalResponse = responses;
        break;
      }
    } else {
      noChangeCount = 0;
      lastLength = responses.length;
    }
  }
  
  if (!finalResponse) throw new Error("Timed out waiting for Claude");
  return finalResponse;
}

client.on('auth_failure', msg => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', reason => {
  console.log('⚠️ Bot disconnected:', reason);
});

async function safeReply(msg, text) {
  try {
    if (msg.fromMe) {
      const chat = await msg.getChat();
      await chat.sendMessage(text);
    } else {
      await msg.reply(text);
    }
  } catch (err) {
    console.log('[DEBUG] safeReply error:', err.message);
    try {
      const chat = await msg.getChat();
      await chat.sendMessage(text);
    } catch(ex) {}
  }
}

client.on('message_create', async msg => {
  try {
    const chat = await msg.getChat();
    console.log(`\n--- NEW MESSAGE ---`);
    console.log(`[DEBUG RAW] type: ${msg.type}, hasMedia: ${msg.hasMedia}, hasQuotedMsg: ${msg.hasQuotedMsg}`);
    console.log(`[DEBUG RAW] body: "${msg.body}"`);
    console.log(`[DEBUG RAW] caption (msg._data.caption): "${msg._data?.caption || 'none'}"`);
    console.log(`[DEBUG RAW] filename: "${msg._data?.filename || 'none'}"`);
    console.log(`[DEBUG] Received message in chat: "${chat.name}"`);

    // Only respond in the target groups OR in Direct Messages
    if (chat.isGroup && !TARGET_GROUPS.includes(chat.name)) {
      console.log(`[DEBUG] ↳ Ignored: Group message but not from target groups: ${TARGET_GROUPS.join(', ')}`);
      return;
    }

    // Intercept /model command dynamically
    if (msg.body.toLowerCase().startsWith('/model')) {
      const newModel = msg.body.slice(6).trim();
      if (newModel) {
        currentModel = newModel;
        console.log(`[DEBUG] Modeled switched to: ${currentModel}`);
        await safeReply(msg, `✅ Model dynamically updated to: ${currentModel}`);
      } else {
        await safeReply(msg, `🤖 Current model is: ${currentModel}\nTo switch it, send: /model <model_name>`);
      }
      return;
    }

    if (msg.body.toLowerCase() === '/ph3dgpt') {
      ph3dMode = !ph3dMode;
      console.log(`[DEBUG] ph3dMode switched to: ${ph3dMode}`);
      await safeReply(msg, `⚙️ ph3d Mode is now **${ph3dMode ? 'ON' : 'OFF'}**.\nEnabled tools: Web Search, Scrape.`);
      return;
    }

    if (msg.body.toLowerCase() === '/reset') {
      const resetChatId = (chat.id && chat.id._serialized) ? chat.id._serialized : (msg.fromMe ? msg.to : msg.from);
      history.set(resetChatId, []);
      console.log(`[DEBUG] Chat history reset for: ${resetChatId}`);
      await safeReply(msg, '🧹 Conversation history has been cleared! Starting fresh.');
      return;
    }

    if (msg.body.toLowerCase() === '/claude') {
      claudeMode = !claudeMode;
      console.log(`[DEBUG] claudeMode switched to: ${claudeMode}`);
      await safeReply(msg, `🤖 Claude Mode is now **${claudeMode ? 'ON' : 'OFF'}**.\nMake sure you are logged into Claude in the visible Chrome window!`);
      return;
    }

    if (msg.body.toLowerCase() === '/mode') {
      const statusMsg = `📊 *Current Bot Modes & Settings*\n\n` +
                        `🌐 *Provider:* \`${currentProvider.toUpperCase()}\`\n` +
                        `🤖 *Model:* \`${currentModel}\`\n` +
                        `⚙️ *ph3d Mode (Tools):* ${ph3dMode ? 'ON ✅' : 'OFF ❌'}\n` +
                        `🧠 *Think Level:* ${thinkLevel}\n` +
                        `💬 *Claude Mode:* ${claudeMode ? 'ON ✅' : 'OFF ❌'}\n` +
                        `💭 *Show Thoughts:* ${showThoughts ? 'ON ✅' : 'OFF ❌'}`;
      await safeReply(msg, statusMsg);
      return;
    }

    if (msg.body.toLowerCase() === '/ollama') {
      try {
        currentProvider = 'ollama';
        
        // Kill llama-server to free VRAM
        exec('taskkill /F /IM llama-server.exe', (err) => {
          if (!err) console.log('[DEBUG] llama-server terminated to free VRAM.');
        });

        const res = await axios.get('http://localhost:11434/api/tags');
        if (res.data && res.data.models && res.data.models.length > 0) {
          currentModel = res.data.models[0].name;
          await safeReply(msg, `✅ Switch to **OLLAMA**.\n🤖 Auto-selected model: \`${currentModel}\``);
        } else {
          await safeReply(msg, `✅ Switch to **OLLAMA**.\n⚠️ No models found. Please use \`/model <name>\` manually.`);
        }
      } catch (e) {
        currentProvider = 'ollama';
        await safeReply(msg, `✅ Switch to **OLLAMA**.\n⚠️ Could not fetch models (server might be starting).`);
      }
      return;
    }

    if (msg.body.toLowerCase() === '/llama.cpp') {
      try {
        currentProvider = 'llama';

        // Kill ollama to free VRAM
        exec('taskkill /F /IM ollama.exe', (err) => {
          if (!err) console.log('[DEBUG] ollama terminated to free VRAM.');
        });

        // Check if server is already running
        try {
          const res = await axios.get('http://localhost:8080/v1/models', { timeout: 2000 });
          if (res.data && res.data.data && res.data.data.length > 0) {
            currentModel = res.data.data[0].id;
            await safeReply(msg, `✅ Switch to **LLAMA.CPP**.\n🤖 Auto-selected model: \`${currentModel}\``);
            return;
          }
        } catch (e) {
          // Server is likely down, proceed to launch
          console.log(`[DEBUG] llama-server not responding on 8080. Attempting on-demand launch...`);
        }

        await safeReply(msg, `⚠️ **Llama-server is down.** Launching it now for you...\nPlease wait about 45 seconds for initialization.`);

        const llamaExec = 'C:\\Users\\Eddie\\llama.cpp\\llama-server.exe';
        const llamaHF = 'jenerallee78/gemma-4-26B-A4B-it-ara-abliterated:Q5_K_M';
        const cmd = `start "Llama Server" "${llamaExec}" -hf "${llamaHF}" -c 8192`;
        
        exec(cmd, (err) => {
          if (err) console.error(`[ERROR] Failed to launch llama-server: ${err.message}`);
        });

        // Loop to wait for initialization (45 seconds total)
        for (let i = 0; i < 45; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const check = await axios.get('http://localhost:8080/v1/models', { timeout: 1000 });
            if (check.data && check.data.data && check.data.data.length > 0) {
              currentModel = check.data.data[0].id;
              await safeReply(msg, `✅ **Llama-server is READY!**\n🤖 Auto-selected model: \`${currentModel}\``);
              return;
            }
          } catch (err) {}
        }
        await safeReply(msg, `❌ **Llama-server timed out.** Check your PC to see if it crashed during startup.`);
      } catch (e) {
        currentProvider = 'llama';
        await safeReply(msg, `❌ **Error:** ${e.message}`);
      }
      return;
    }

    if (msg.body.toLowerCase().startsWith('/thoughts')) {
      const arg = msg.body.slice(9).trim().toLowerCase();
      if (arg === 'on') {
        showThoughts = true;
        await safeReply(msg, `💭 AI thoughts will now be shown in the chat.`);
      } else if (arg === 'off') {
        showThoughts = false;
        await safeReply(msg, `💭 AI thoughts are now hidden.`);
      } else {
        await safeReply(msg, `💭 Thoughts are currently **${showThoughts ? 'ON' : 'OFF'}**.\nUse \`/thoughts on\` or \`/thoughts off\`.`);
      }
      return;
    }

    if (msg.body.toLowerCase().startsWith('/think')) {
      const arg = msg.body.slice(6).trim();
      if (['0', '1', '2'].includes(arg)) {
        thinkLevel = parseInt(arg, 10);
        await safeReply(msg, `🧠 Think level set to: ${thinkLevel}`);
      } else {
        await safeReply(msg, `🧠 Current Think Level: ${thinkLevel}\nUse \`/think 0\` (none), \`/think 1\` (some), or \`/think 2\` (full).`);
      }
      return;
    }

    if (msg.body.toLowerCase() === '/ais') {
      try {
        if (currentProvider === 'ollama') {
          const res = await axios.get('http://localhost:11434/api/tags');
          if (res.data && res.data.models) {
            const modelList = res.data.models.map(m => `- ${m.name}`).join('\n');
            await safeReply(msg, `*Available Ollama Models:*\n\n${modelList}\n\nUse \`/model <name>\` to switch.`);
          } else {
            await safeReply(msg, 'Could not fetch models from Ollama.');
          }
        } else {
          // llama.cpp / OpenAI models list
          const res = await axios.get('http://localhost:8080/v1/models');
          if (res.data && res.data.data) {
            const modelList = res.data.data.map(m => `- ${m.id}`).join('\n');
            await safeReply(msg, `*Available llama.cpp Models:*\n\n${modelList}\n\nUse \`/model <name>\` to switch.`);
          } else {
            await safeReply(msg, 'Could not fetch models from llama.cpp.');
          }
        }
      } catch (err) {
        console.error('Error fetching models:', err.message);
        await safeReply(msg, `⚠️ Error fetching models from ${currentProvider.toUpperCase()}. Make sure the server is running on the correct port.`);
      }
      return;
    }

    // WhatsApp Web stores the caption in _data.caption if the file was sent as a Document
    // Workaround: Sometimes pasted images put base64 in body and caption in _data.caption.
    let rootText = (msg.body && typeof msg.body === 'string') ? msg.body : "";
    if ((msg.hasMedia || msg.type === 'image') && msg._data && msg._data.caption) {
      if (msg._data.caption.toLowerCase().startsWith(BOT_PREFIX.toLowerCase())) {
        rootText = msg._data.caption;
      }
    }

    // Only respond if message starts with prefix (if prefix is set)
    if (BOT_PREFIX && !rootText.toLowerCase().startsWith(BOT_PREFIX.toLowerCase())) {
      console.log(`[DEBUG] ↳ Ignored: Doesn't start with prefix "${BOT_PREFIX}"`);
      return;
    }

    // Strip the prefix to get the actual question
    let userText = BOT_PREFIX
      ? rootText.slice(BOT_PREFIX.length).trim()
      : rootText.trim();

    // ── Vision: handle image messages ──────────────────────
    let imageBase64 = null;

    if (msg.hasMedia || msg.type === 'image') {
      try {
        let media = await msg.downloadMedia();
        
        // If media download fails (common when texting yourself from desktop due to instant event firing), try reloading the message
        if (!media) {
          console.log(`[DEBUG] Media missing on initial event. Waiting 2.5s for cloud sync...`);
          await new Promise(r => setTimeout(r, 2500));
          const chat = await msg.getChat();
          const recentMsgs = await chat.fetchMessages({limit: 5});
          const reloadedMsg = recentMsgs.find(m => m.id.id === msg.id.id);
          if (reloadedMsg) {
            media = await reloadedMsg.downloadMedia();
          }
        }

        if (media && media.mimetype && media.mimetype.startsWith('image/')) {
          imageBase64 = media.data; // already base64 from wwebjs
          console.log(`📷 Full-res image received (${media.mimetype}, ${Math.round(media.data.length * 0.75 / 1024)} KB)`);
          
          try {
            require('fs').writeFileSync('debug_image.jpg', Buffer.from(imageBase64, 'base64'));
          } catch(err) {}
        } else {
          throw new Error("No media returned from downloadMedia even after reload");
        }
      } catch (e) {
        console.error('Failed to download full media, falling back to thumbnail if available:', e.message);
        if (msg.type === 'image' && typeof msg.body === 'string' && msg.body.length > 100) {
          imageBase64 = msg.body;
          console.log(`📷 Inline base64 thumbnail fallback (${Math.round(imageBase64.length * 0.75 / 1024)} KB)`);
        }
      }
    } else if (msg.hasQuotedMsg) {
      try {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg.hasMedia) {
          const media = await quotedMsg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            imageBase64 = media.data;
            console.log(`📷 Quoted image received (${media.mimetype}, ${Math.round(media.data.length * 0.75 / 1024)} KB)`);
          }
        }
      } catch (e) {
        console.error('Failed to download quoted media:', e.message);
      }
    }

    // If it's just an image with no text beyond the prefix, default prompt
    if (imageBase64 && !userText) {
      userText = 'What is in this image?';
    }

    if (!userText) return;

    // Get sender name safely (can fail in some group conditions)
    let senderName = msg.from;
    try {
      if (msg.author || msg.from) {
        const contact = await msg.getContact();
        senderName = contact.pushname || contact.name || msg.author || msg.from;
      }
    } catch (e) {}
    console.log(`[${chat.name}] ${senderName}: ${userText}${imageBase64 ? ' [+image]' : ''}`);

    // Show typing indicator
    try {
      await chat.sendStateTyping();
    } catch (e) {}

    // Get or create history for this group safely
    const chatId = (chat.id && chat.id._serialized) ? chat.id._serialized : (msg.fromMe ? msg.to : msg.from);
    if (!history.has(chatId)) history.set(chatId, []);
    const messages = history.get(chatId);

    // --- System Prompt Anchor ---
    const SYSTEM_PROMPT = { 
      role: 'system', 
      content: "You are a high-performance assistant. Your internal training data is STALE. For all news, prices, or current events, you MUST use web_search. Never guestimate a number—search it. Be concise." 
    };
    const hasSystem = messages.some(m => m.role === 'system');
    if (!hasSystem) messages.unshift(SYSTEM_PROMPT);

    // Build the user message — include images array if we have one
    const userMessage = { role: 'user', content: userText };
    if (imageBase64) {
      userMessage.images = [imageBase64];
    }

    // Add user message to history (store without images to save memory)
    messages.push({ role: 'user', content: userText });

    // Intercept if claudeMode is ON
    if (claudeMode) {
      try {
        const claudeReply = await sendToClaude(userText);
        console.log(`[Claude reply]: ${claudeReply.substring(0, 80)}...`);
        messages.push({ role: 'assistant', content: claudeReply });
        await safeReply(msg, claudeReply);
      } catch (err) {
        console.error('Claude Scraper Error:', err.message);
        await safeReply(msg, '⚠️ Failed to scrape Claude. Check the Chrome window to log in or solve Captchas!');
      }
      return; // Skip Ollama
    }

    // Call AI with tool looping
    function canVision(model) {
      const vKeywords = ["vision", "llava", "moondream", "qwen-vl", "lava", "bakllava", "minicpm"];
      return vKeywords.some(k => model.toLowerCase().includes(k));
    }

    // --- Sliding Window Context Management ---
    // Preserve System Message, but trim history until it fits 7.5k tokens
    const TOKEN_LIMIT = 7500; 
    function estimateTokens(msgs) {
      return msgs.reduce((sum, m) => sum + (m.content ? m.content.length / 4 : 0) + 20, 0);
    }

    // Keep dropping oldest messages (index 0) until we are under the limit
    while (messages.length > 2 && estimateTokens(messages) > TOKEN_LIMIT) {
      console.log(`[DEBUG] Context full (~${Math.round(estimateTokens(messages))} tokens). Ejecting oldest message...`);
      messages.shift(); // Remove oldest User/Assistant pair
    }

    // Build optimized messages with truncation and vision sanitization
    let aiMessages = messages.map(m => {
      let content = m.content || "";
      if (content.length > 10000) {
        content = content.substring(0, 10000) + "\n\n[... Content truncated for performance ...]";
      }
      const clean = { role: m.role, content: content };
      if (canVision(currentModel) && m.images) clean.images = m.images;
      if (m.tool_calls) {
        clean.tool_calls = m.tool_calls.map(tc => ({ ...tc, type: tc.type || "function" }));
      }
      if (m.role === 'tool') clean.tool_call_id = m.tool_call_id;
      return clean;
    });

    if (aiMessages.length === 0 || aiMessages[0].role !== 'system') {
      let thinkInstruction = "- Keep reasoning to a minimum.";
      if (thinkLevel === 1) thinkInstruction = "- Use moderate reasoning.";
      else if (thinkLevel === 2) thinkInstruction = "- Think deeply and step-by-step.";

      aiMessages.unshift({
        role: 'system',
        content: `You are ph3dgpt — a sharp, no-nonsense AI. UK time. ${thinkInstruction}\nPersonality: EDGE, DRY WIT, CONCISE.`
      });
    }

    let finalReply = "";
    let iterations = 0;
    
    // Benchmarking
    const startTime = Date.now();
    
    let finalAiResponse; // Renamed for safety and scoped correctly
    
    while (iterations < 5) {
      iterations++;
      try {
        if (currentProvider === 'ollama') {
          finalAiResponse = await axios.post(OLLAMA_URL, {
            model: currentModel,
            messages: aiMessages,
            stream: false,
            tools: (ph3dMode && !imageBase64) ? TOOLS : undefined
          });
        } else {
          const payload = {
            model: currentModel,
            messages: aiMessages,
            stream: false
          };
          
          if (ph3dMode && !imageBase64) {
             payload.tools = TOOLS;
             payload.tool_choice = "auto";
          }

          const res = await axios.post(LLAMA_URL, payload);
          const choice = res.data.choices[0];
          finalAiResponse = { data: { message: { 
            role: "assistant", 
            content: choice.message.content || "", 
            tool_calls: choice.message.tool_calls || []
          }, usage: res.data.usage } };
        }
      } catch (e) {
        throw new Error(`${currentProvider.toUpperCase()} Error: ${e.response?.data?.error || e.message}`);
      }

      const msgData = finalAiResponse.data.message;
      aiMessages.push(msgData);

      if (msgData.tool_calls && msgData.tool_calls.length > 0) {
        console.log(`[DEBUG] Tool use detected: ${msgData.tool_calls.length} calls.`);
        try { await safeReply(msg, "🔍 _Checking the live web..._"); } catch(e) {}
        try { await chat.sendStateTyping(); } catch(e) {}
        
        for (const call of msgData.tool_calls) {
          const fnName = call.function.name;
          let args = call.function.arguments || {};
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch(e) { 
            if (fnName === 'web_search') args = { query: args }; 
          } }

          let resultStr = "";
          try {
            if (fnName === 'web_search') {
              const res = await axios.get(`${BACKEND_URL}/search?q=${encodeURIComponent(args.query)}`);
              resultStr = JSON.stringify(res.data);
            } else if (fnName === 'scrape_url') {
              const res = await axios.post(`${BACKEND_URL}/scrape`, { url: args.url });
              resultStr = res.data.output || res.data.error;
            } else {
              resultStr = `Tool ${fnName} not recognized.`;
            }
          } catch (err) {
            resultStr = `Error calling tool: ${err.message}`;
          }

          console.log(`[TOOL] ✅ Result (${fnName}): ${resultStr.substring(0, 150)}${resultStr.length > 150 ? '...' : ''}`);

          aiMessages.push({
            role: 'tool',
            content: resultStr,
            tool_call_id: call.id,
            name: fnName
          });
        }
      } else {
        finalReply = msgData.content || "";
        if (!showThoughts) {
          finalReply = finalReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } else {
          finalReply = finalReply.replace(/<think>/g, '\n[🧠 *Reasoning*]\n_').replace(/<\/think>/g, '_\n\n');
        }

        if (!finalReply.trim() && iterations < 5) {
          console.log(`[DEBUG] Empty response from ${currentProvider}, retrying...`);
          aiMessages.pop();
          continue;
        }
        break;
      }
    }

    if (!finalReply.trim()) finalReply = "The model failed to generate a response. Please check your local servers.";

    messages.push({ role: 'assistant', content: finalReply });
    if (messages.length > MAX_HISTORY) messages.splice(0, messages.length - MAX_HISTORY);

    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    
    // Get actual token count from server usage if available
    let tokenCount = finalReply.split(/\s+/).length * 1.3; // fallback heuristic
    
    // Check finalAiResponse.data.usage (standard for our llama-server wrapper)
    if (finalAiResponse && finalAiResponse.data && finalAiResponse.data.usage && finalAiResponse.data.usage.completion_tokens) {
      tokenCount = finalAiResponse.data.usage.completion_tokens;
    }

    const tps = (tokenCount / durationSec).toFixed(2);

    console.log(`[Bot reply]: ${finalReply.substring(0, 80)}... (${tps} t/s | ${tokenCount} tokens)`);
    await safeReply(msg, finalReply + `\n\n📊 *Speed:* ${tps} t/s | ⏱️ *Time:* ${durationSec.toFixed(2)}s | 🎟️ *Tokens:* ${Math.round(tokenCount)}`);

  } catch (err) {
    let errorMessage = err.message;
    if (err.response && err.response.data) {
      // If server sent a JSON error (common for llama-server context limits)
      errorMessage = typeof err.response.data === 'string' 
        ? err.response.data 
        : JSON.stringify(err.response.data.error || err.response.data);
    }
    
    console.error('🔴 LLAMA Error:', errorMessage);
    
    try {
      if (err.response?.status === 400 && errorMessage.includes('support tools')) {
        await safeReply(msg, `⚠️ **Model Error:** The model \`${currentModel}\` does not support native tool calling! Please switch to a model like \`llama3.1\` or \`mistral\` using \`/model\`, or disable \`/ph3dgpt\` Mode.`);
      } else {
        await safeReply(msg, `⚠️ **LLAMA Error:** ${errorMessage.substring(0, 500)}${errorMessage.length > 500 ? '...' : ''}`);
      }
    } catch (_) {}
  }
});

client.initialize();

// ── Clean Shutdown ─────────────────────────────────────────

/**
 * Ensures the Puppeteer browser is closed cleanly when the process exits.
 * This prevents session locks that cause "browser is already running" errors.
 */
const cleanExit = async () => {
  console.log('\n🛑 Shutdown requested. Cleaning up Chrome...');
  try {
    if (client) {
      await client.destroy();
      console.log('✅ Chrome process closed. Goodbye!');
    }
  } catch (e) {
    console.error('❌ Error during cleanup:', e.message);
  }
  process.exit(0);
};

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);