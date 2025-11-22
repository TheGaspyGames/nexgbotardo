const mineflayer = require('mineflayer');
const readline = require('readline');

// ================== CONFIG ==================
// Usa el HOST tal como lo pones en Minecraft Java
const HOST = "nexgneration.sdlf.fun";   // o "192.95.32.45"
const PORT = 25565;                     // el puerto que ya vimos
const USERNAME = "BotAFK";              // nick del bot
const RECONNECT_DELAY_MS = 2 * 60 * 1000; // 2 minutos
// ============================================

console.log("[BOT] Script iniciado.");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Ingresa la contraseña del bot (para /login y /register): ", (password) => {
  console.log("[BOT] Contraseña recibida. Creando bot...");
  startBot(password);
});

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

  let antiAfkInterval = null;

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
    console.log(reason);
    console.log("==================================");
  });

  bot.on('end', () => {
    console.log("[BOT] Conexión terminada. Se intentará reconectar en " + (RECONNECT_DELAY_MS / 1000) + " segundos.");
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    setTimeout(() => {
      console.log("[BOT] Reintentando conexión...");
      startBot(password);
    }, RECONNECT_DELAY_MS);
  });

  bot.on('error', (err) => {
    console.log("==================================");
    console.log("[BOT] ERROR de conexión / red:");
    console.error(err);
    console.log("[BOT] Se intentará reconectar en " + (RECONNECT_DELAY_MS / 1000) + " segundos.");
    console.log("==================================");
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    setTimeout(() => {
      console.log("[BOT] Reintentando conexión...");
      startBot(password);
    }, RECONNECT_DELAY_MS);
  });
}

