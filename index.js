const mineflayer = require('mineflayer');
const readline = require('readline');

// ================== CONFIG ==================
// Usa el HOST tal como lo pones en Minecraft Java
const HOST = "nexgneration.sdlf.fun";   // o "192.95.32.45"
const PORT = 25565;                     // el puerto que ya vimos
const USERNAME = "BotAFK";              // nick del bot
const RECONNECT_DELAY_MS = 2 * 60 * 1000; // 2 minutos
const THROTTLED_RECONNECT_DELAY_MS = 10 * 60 * 1000; // 10 minutos si el server throttlea
// ============================================

console.log("[BOT] Script iniciado.");

let inputInitialized = false;
let currentBot = null;
let botPassword = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function setupChatInput() {
  if (inputInitialized) return;
  inputInitialized = true;

  rl.setPrompt("Escribe un mensaje para enviar al chat: ");
  rl.on('line', (line) => {
    const text = line.trim();

    if (!text) {
      rl.prompt();
      return;
    }

    if (!currentBot) {
      console.log("[BOT] Aún no hay una conexión activa, no se envió el mensaje.");
      rl.prompt();
      return;
    }

    try {
      currentBot.chat(text);
      console.log(`[BOT] Mensaje enviado: ${text}`);
    } catch (err) {
      console.log("[BOT] No se pudo enviar el mensaje desde la terminal:");
      console.error(err);
    }

    rl.prompt();
  });

  rl.prompt();
}

rl.question("Ingresa la contraseña del bot (para /login y /register): ", (password) => {
  botPassword = password;
  console.log("[BOT] Contraseña recibida. Creando bot...");
  startBot(password);
  setupChatInput();
});

let reconnectTimeout = null;

function getReasonText(reason) {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  if (reason.message) return reason.message;
  if (reason.text) return reason.text;
  if (reason.extra && reason.extra.text) return reason.extra.text;
  if (reason.translate) return reason.translate;
  try {
    return JSON.stringify(reason);
  } catch (error) {
    return String(reason);
  }
}

function calculateReconnectDelay(reasonText) {
  const lower = reasonText.toLowerCase();
  if (lower.includes("throttle")) {
    return THROTTLED_RECONNECT_DELAY_MS;
  }
  return RECONNECT_DELAY_MS;
}

function startBot(password) {
  console.log(`[BOT] Intentando conectar a ${HOST}:${PORT} con nick ${USERNAME}...`);

  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME
    // Si tu server fuera premium con cuenta original:
    // auth: "microsoft",
    // username: "tu_correo_de_minecraft@example.com"
  });

  currentBot = bot;

  let antiAfkInterval = null;
  let hasScheduledReconnect = false;

  function scheduleReconnect(reason) {
    if (hasScheduledReconnect) return;
    hasScheduledReconnect = true;

    if (antiAfkInterval) {
      clearInterval(antiAfkInterval);
      antiAfkInterval = null;
    }

    const reasonText = getReasonText(reason);
    const delay = calculateReconnectDelay(reasonText);
    const delaySeconds = Math.round(delay / 1000);

    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const extraInfo = reasonText ? ` Motivo: ${reasonText}` : "";
    console.log(`[BOT] Reconexión programada en ${delaySeconds} segundos.${extraInfo}`);

    reconnectTimeout = setTimeout(() => {
      console.log("[BOT] Reintentando conexión...");
      startBot(password);
    }, delay);
  }

  bot.on('login', () => {
    console.log("[BOT] Se ha conectado al servidor (login de conexión correcto).");
  });

  bot.on('spawn', () => {
    console.log("[BOT] Spawn completado. Esperando mensajes de /login o /register...");

    // ANTI-AFK: mover un poco la cámara cada 30 segundos
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    antiAfkInterval = setInterval(() => {
      if (!bot.entity) return;
      const newYaw = bot.entity.yaw + 0.2;
      bot.look(newYaw, 0, false);
      console.log("[BOT] Moviendo cámara para evitar AFK.");
    }, 30000);
  });

  // Mensajes del servidor (para detectar /register y /login)
  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    const lower = msg.toLowerCase();
    console.log("[SERVER] " + msg);

    if (lower.includes("/register") || lower.includes("registr")) {
      console.log("[BOT] Detectado mensaje de registro. Enviando /register...");
      bot.chat(`/register ${password} ${password}`);
    } else if (lower.includes("/login") || lower.includes("log")) {
      console.log("[BOT] Detectado mensaje de login. Enviando /login...");
      bot.chat(`/login ${password}`);
    }
  });

  bot.on('kicked', (reason) => {
    console.log("==================================");
    console.log("[BOT] FUE KICKEADO DEL SERVER");
    console.log(getReasonText(reason));
    console.log("==================================");
    scheduleReconnect(reason);
  });

  bot.on('end', (reason) => {
    console.log("[BOT] Conexión terminada.");
    scheduleReconnect(reason);
  });

  bot.on('error', (err) => {
    console.log("==================================");
    console.log("[BOT] ERROR de conexión / red:");
    console.error(err);
    console.log("==================================");
    scheduleReconnect(err);
  });
}
