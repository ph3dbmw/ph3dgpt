const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const puppeteer = require('puppeteer');

// ── Config ────────────────────────────────────────────────
const OLLAMA_URL   = 'http://localhost:11434/api/chat';
let currentModel   = 'dolphin-mixtral:8x7b'; // default model
let ph3dMode       = false;                           // OFF by default
let claudeMode     = false;
let thinkLevel     = 0; // 0=none, 1=some, 2=full
let claudePage     = null; // Holds the puppeteer page
const BACKEND_URL  = 'http://localhost:5000'; // server2.py
const BOT_PREFIX   = '!ai';              // users type !ai followed by their question
                                          // set to null to reply to ALL messages in group
const TARGET_GROUPS = ['Instagram tags ', 'Nonsense'];    // exact names of your WhatsApp groups
const MAX_HISTORY  = 20;                 // how many messages to remember per group
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
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

// Show QR code in terminal on first run
client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp (Linked Devices):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ WhatsApp bot is ready and listening!');
  
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

client.on('message_create', async msg => {
  try {
    const chat = await msg.getChat();
    console.log(`[DEBUG] Received message in chat: "${chat.name}" (isGroup: ${chat.isGroup})`);

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
        try { await msg.reply(`✅ Model dynamically updated to: ${currentModel}`); } catch(e) {}
      } else {
        try { await msg.reply(`🤖 Current model is: ${currentModel}\nTo switch it, send: /model <model_name>`); } catch(e) {}
      }
      return;
    }

    if (msg.body.toLowerCase() === '/ph3dgpt') {
      ph3dMode = !ph3dMode;
      console.log(`[DEBUG] ph3dMode switched to: ${ph3dMode}`);
      try { await msg.reply(`⚙️ ph3d Mode is now **${ph3dMode ? 'ON' : 'OFF'}**.\nEnabled tools: Web Search, Scrape.`); } catch(e) {}
      return;
    }

    if (msg.body.toLowerCase() === '/reset') {
      const resetChatId = (chat.id && chat.id._serialized) ? chat.id._serialized : (msg.fromMe ? msg.to : msg.from);
      history.set(resetChatId, []);
      console.log(`[DEBUG] Chat history reset for: ${resetChatId}`);
      try { await msg.reply('🧹 Conversation history has been cleared! Starting fresh.'); } catch(e) {}
      return;
    }

    if (msg.body.toLowerCase() === '/claude') {
      claudeMode = !claudeMode;
      console.log(`[DEBUG] claudeMode switched to: ${claudeMode}`);
      try { await msg.reply(`🤖 Claude Mode is now **${claudeMode ? 'ON' : 'OFF'}**.\nMake sure you are logged into Claude in the visible Chrome window!`); } catch(e) {}
      return;
    }

    if (msg.body.toLowerCase() === '/mode') {
      const statusMsg = `📊 *Current Bot Modes & Settings*\n\n` +
                        `🤖 *Model:* \`${currentModel}\`\n` +
                        `⚙️ *ph3d Mode (Tools):* ${ph3dMode ? 'ON ✅' : 'OFF ❌'}\n` +
                        `🧠 *Think Level:* ${thinkLevel}\n` +
                        `💬 *Claude Mode:* ${claudeMode ? 'ON ✅' : 'OFF ❌'}`;
      try { await msg.reply(statusMsg); } catch(e) {}
      return;
    }

    if (msg.body.toLowerCase().startsWith('/think')) {
      const arg = msg.body.slice(6).trim();
      if (['0', '1', '2'].includes(arg)) {
        thinkLevel = parseInt(arg, 10);
        try { await msg.reply(`🧠 Think level set to: ${thinkLevel}`); } catch(e) {}
      } else {
        try { await msg.reply(`🧠 Current Think Level: ${thinkLevel}\nUse \`/think 0\` (none), \`/think 1\` (some), or \`/think 2\` (full).`); } catch(e) {}
      }
      return;
    }

    if (msg.body.toLowerCase() === '/ais') {
      try {
        const res = await axios.get('http://localhost:11434/api/tags');
        if (res.data && res.data.models) {
          const modelList = res.data.models.map(m => `- ${m.name}`).join('\n');
          await msg.reply(`*Available Ollama Models:*\n\n${modelList}\n\nUse \`/model <name>\` to switch.`);
        } else {
          try { await msg.reply('Could not fetch models from Ollama.'); } catch(e) {}
        }
      } catch (err) {
        console.error('Error fetching models:', err.message);
        try { await msg.reply('⚠️ Error fetching models from Ollama. Make sure Ollama is running.'); } catch(e) {}
      }
      return;
    }

    // Only respond if message starts with prefix (if prefix is set)
    if (BOT_PREFIX && !msg.body.toLowerCase().startsWith(BOT_PREFIX.toLowerCase())) {
      console.log(`[DEBUG] ↳ Ignored: Doesn't start with prefix "${BOT_PREFIX}"`);
      return;
    }

    // Strip the prefix to get the actual question
    const userText = BOT_PREFIX
      ? msg.body.slice(BOT_PREFIX.length).trim()
      : msg.body.trim();

    if (!userText) return;

    // Get sender name safely (can fail in some group conditions)
    let senderName = msg.from;
    try {
      if (msg.author || msg.from) {
        const contact = await msg.getContact();
        senderName = contact.pushname || contact.name || msg.author || msg.from;
      }
    } catch (e) {}
    console.log(`[${chat.name}] ${senderName}: ${userText}`);

    // Show typing indicator
    try {
      await chat.sendStateTyping();
    } catch (e) {}

    // Get or create history for this group safely
    const chatId = (chat.id && chat.id._serialized) ? chat.id._serialized : (msg.fromMe ? msg.to : msg.from);
    if (!history.has(chatId)) history.set(chatId, []);
    const messages = history.get(chatId);

    // Add user message to history
    messages.push({ role: 'user', content: userText });

    // Intercept if claudeMode is ON
    if (claudeMode) {
      try {
        const claudeReply = await sendToClaude(userText);
        console.log(`[Claude reply]: ${claudeReply.substring(0, 80)}...`);
        messages.push({ role: 'assistant', content: claudeReply });
        await msg.reply(claudeReply);
      } catch (err) {
        console.error('Claude Scraper Error:', err.message);
        await msg.reply('⚠️ Failed to scrape Claude. Check the Chrome window to log in or solve Captchas!');
      }
      return; // Skip Ollama
    }

    // Call Ollama with tool looping if ph3dMode is enabled
    let ollamaMessages = [...messages];
    if (ph3dMode) {
      if (ollamaMessages.length === 0 || ollamaMessages[0].role !== 'system') {
        let thinkInstruction = "- Keep your internal reasoning and `<think>` process to an absolute minimum to ensure fast responses. Answer directly without deep thinking.";
        if (thinkLevel === 1) {
          thinkInstruction = "- You may use a moderate amount of internal reasoning if needed to get the right answer, but try to be efficient.";
        } else if (thinkLevel === 2) {
          thinkInstruction = "- Think deeply and step-by-step through the problem before answering. Take your time to get it right.";
        }

        ollamaMessages.unshift({
          role: 'system',
          content: `You are ph3dgpt — a sharp, no-nonsense AI with a bit of attitude. You get things done, you don't waffle, and you never kiss up to the user.

## Identity
- Your name is ph3dgpt.
- If asked who you are or what model you are, say you are ph3dgpt. Do not mention the underlying model.
- You have a confident, slightly edgy personality — think less corporate chatbot, more brilliant mate who happens to know everything.

## Date & Time Awareness
- You do not have a built-in clock. If you need the current date or time, use web_search to look it up.
- Always use UK time (GMT/BST) as the default unless the user specifies otherwise.

## Reasoning
${thinkInstruction}
- Break down multi-part questions before addressing each part.
- If you are uncertain, say so clearly rather than guessing confidently.

## Response Style
- Be concise. No filler phrases like "Certainly!", "Great question!" or "Of course!". Just answer.
- Match the register of the user — casual chat gets casual replies, technical questions get technical answers.
- Use markdown only when it genuinely helps readability. Avoid it for simple conversational replies.
- Never repeat the user's question back to them before answering.
- A dry wit is welcome. Don't force it, but don't suppress it either.

## Honesty
- If you don't know something, say so. Never bluff, fabricate facts, or invent sources.
- If a question is dumb, you can say so — tactfully, but honestly.

## Creative Writing
- When asked to rap, write lyrics, or compose poetry, ALWAYS make lines rhyme as instructed.
- For raps: end words of couplets or alternating lines must rhyme. Maintain rhythm and syllable flow. Actually sound like a rapper, not a greeting card.
- For poems: respect the requested structure (sonnet, haiku, limerick, etc).
- Mentally verify rhymes and rhythm before responding.

## Coding
- Always include brief comments explaining non-obvious logic.
- If a solution has caveats or edge cases, mention them.
- Prefer working, simple code over clever but fragile code.
- When debugging, explain what caused the issue, not just the fix.

## Math & Logic
- Show your working for any calculation, don't just give the answer.
- Double-check arithmetic before responding.

## Conversation Memory
- Track context across the conversation. If the user refers to something said earlier, use it.
- Do not ask for information the user already provided earlier in the chat.

## Summarisation
- Lead with the key point first, then supporting detail.
- Match summary length to source length — don't write an essay about a tweet.

## Language
- Detect the language the user is writing in and reply in that language unless told otherwise.

## Tools
- Use web_search for anything that could have changed recently — current events, news, prices, sports results, weather, date/time, etc. When in doubt, search rather than answering from memory.
- Use run_command only when the user explicitly asks to run a command.
- Use file tools only when the user explicitly asks to read or write a file.
- For normal conversation and image analysis, reply directly without using any tools.`
        });
      }
    }

    let finalReply = "";
    let iterations = 0;
    
    while (iterations < 5) {
      iterations++;
      const response = await axios.post(OLLAMA_URL, {
        model: currentModel,
        messages: ollamaMessages,
        stream: false,
        tools: ph3dMode ? TOOLS : undefined
      });

      const msgData = response.data.message;
      ollamaMessages.push(msgData);

      if (msgData.tool_calls && msgData.tool_calls.length > 0) {
        console.log(`[DEBUG] Ollama used ${msgData.tool_calls.length} tools.`);
        try { await chat.sendStateTyping(); } catch(e) {} // Keep typing indicator active
        
        for (const call of msgData.tool_calls) {
          const fnName = call.function.name;
          const args = call.function.arguments || {};
          let resultStr = "";

          try {
            if (fnName === 'web_search') {
              const res = await axios.get(`${BACKEND_URL}/search?q=${encodeURIComponent(args.query)}`);
              resultStr = JSON.stringify(res.data);
            } else if (fnName === 'scrape_url') {
              const res = await axios.post(`${BACKEND_URL}/scrape`, { url: args.url });
              resultStr = res.data.output || res.data.error;
            } else {
              resultStr = `Tool ${fnName} not recognized or disabled.`;
            }
          } catch (err) {
            resultStr = `Error calling backend server2.py tool: ${err.message}`;
          }

          ollamaMessages.push({
            role: 'tool',
            content: resultStr,
            name: fnName
          });
        }
      } else {
        finalReply = msgData.content;
        break;
      }
    }

    if (!finalReply) finalReply = "Sorry, I hit a tool loop error and couldn't formulate a response.";

    // Add assistant reply to history cache (saving only the final reply to save tokens on next turn)
    messages.push({ role: 'assistant', content: finalReply });

    // Trim history to avoid it growing forever
    if (messages.length > MAX_HISTORY) {
      messages.splice(0, messages.length - MAX_HISTORY);
    }

    console.log(`[Bot reply]: ${finalReply.substring(0, 80)}...`);

    await msg.reply(finalReply);

  } catch (err) {
    const ollamaError = err.response?.data?.error || err.message;
    console.error('Error:', ollamaError);
    
    try {
      if (err.response?.status === 400 && ollamaError.includes('support tools')) {
        await msg.reply(`⚠️ **Model Error:** The model \`${currentModel}\` does not support native tool calling! Please switch to a model like \`llama3.1\` or \`mistral\` using \`/model\`, or disable \`/ph3dgpt\` Mode.`);
      } else {
        await msg.reply(`⚠️ **Error:** ${ollamaError}`);
      }
    } catch (_) {}
  }
});

client.initialize();