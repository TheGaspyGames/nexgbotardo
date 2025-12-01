"""Minecraft bot ported from index.js to Python using pyCraft.

This script mirrors the behavior of the original Node version:
- Connects to a server with a fixed host/port/username.
- Prompts for the bot password and responds to /register or /login prompts.
- Supports manual chat messages from the terminal.
- Attempts automatic reconnection with throttle-aware delays.
- Performs small periodic movements to avoid AFK kicks once a spawn
  position has been received.

Before running install dependencies:
    pip install pyCraft

Run with:
    python bot.py
"""
from __future__ import annotations

import importlib.util
import json
import sys
import threading
import time
from queue import Queue, Empty
from typing import Optional


def _ensure_pycraft_installed() -> None:
    if importlib.util.find_spec("minecraft") is None:
        sys.exit(
            "pyCraft no está instalado. Ejecuta `pip install pyCraft` "
            "o `pip install -r requirements.txt` antes de usar el bot."
        )


_ensure_pycraft_installed()

from minecraft.networking.connection import Connection
from minecraft.networking.packets.clientbound.play import (
    ChatMessagePacket,
    DisconnectPacket,
    JoinGamePacket,
    PlayerPositionAndLookPacket,
)
from minecraft.networking.packets.serverbound.play import (
    ChatPacket,
    PlayerPositionAndLookPacket as OutgoingPositionPacket,
)

HOST = "nexgneration.sdlf.fun"
PORT = 25565
USERNAME = "BotAFK"
RECONNECT_DELAY_MS = 2 * 60 * 1000
THROTTLED_RECONNECT_DELAY_MS = 10 * 60 * 1000


class MinecraftBot:
    def __init__(self, password: str) -> None:
        self.password = password
        self.connection: Optional[Connection] = None
        self.last_disconnect_reason: Optional[str] = None
        self._listener_threads: list[threading.Thread] = []
        self._stop_event = threading.Event()
        self._spawn_position: Optional[tuple[float, float, float, float, float]] = None
        self._movement_toggle = 1
        self._chat_queue: "Queue[str]" = Queue()

    # ----- Connection management -----
    def connect(self) -> None:
        print(f"[BOT] Intentando conectar a {HOST}:{PORT} con nick {USERNAME}...")
        self.connection = Connection(host=HOST, port=PORT, username=USERNAME)

        self.connection.register_packet_listener(
            self._handle_join_game, JoinGamePacket
        )
        self.connection.register_packet_listener(
            self._handle_disconnect, DisconnectPacket
        )
        self.connection.register_packet_listener(self._handle_chat, ChatMessagePacket)
        self.connection.register_packet_listener(
            self._handle_position_update, PlayerPositionAndLookPacket
        )

        # pyCraft runs networking on its own thread; this call blocks until connected
        # or a failure occurs.
        self.connection.connect()
        self._start_threads()

    def disconnect(self) -> None:
        self._stop_event.set()
        if self.connection:
            try:
                self.connection.disconnect()
            except Exception:
                pass

    # ----- Listeners -----
    def _handle_join_game(self, _packet: JoinGamePacket) -> None:
        print("[BOT] Se ha conectado al servidor (login de conexión correcto).")
        self._stop_event.clear()

    def _handle_disconnect(self, packet: DisconnectPacket) -> None:
        text = self._extract_reason(packet.json_data)
        self.last_disconnect_reason = text
        print("==================================")
        print("[BOT] Conexión terminada.")
        if text:
            print(text)
        print("==================================")
        self._stop_event.set()

    def _handle_chat(self, packet: ChatMessagePacket) -> None:
        message = self._extract_reason(packet.json_data)
        if message:
            print(f"[SERVER] {message}")
            lower = message.lower()
            if "/register" in lower or "registr" in lower:
                print("[BOT] Detectado mensaje de registro. Enviando /register...")
                self.send_chat(f"/register {self.password} {self.password}")
            elif "/login" in lower or "log" in lower:
                print("[BOT] Detectado mensaje de login. Enviando /login...")
                self.send_chat(f"/login {self.password}")

    def _handle_position_update(self, packet: PlayerPositionAndLookPacket) -> None:
        self._spawn_position = (
            packet.x,
            packet.y,
            packet.z,
            packet.yaw,
            packet.pitch,
        )
        # Reset anti-AFK cycle whenever a fresh position is received.
        self._movement_toggle = 1

    # ----- Background workers -----
    def _start_threads(self) -> None:
        chat_thread = threading.Thread(target=self._chat_worker, daemon=True)
        chat_thread.start()
        self._listener_threads.append(chat_thread)

        anti_afk_thread = threading.Thread(target=self._anti_afk_worker, daemon=True)
        anti_afk_thread.start()
        self._listener_threads.append(anti_afk_thread)

    def _chat_worker(self) -> None:
        while not self._stop_event.is_set():
            try:
                message = self._chat_queue.get(timeout=0.5)
            except Empty:
                continue
            self._send_chat_packet(message)

    def _anti_afk_worker(self) -> None:
        while not self._stop_event.is_set():
            time.sleep(30)
            if not self._spawn_position or not self.connection:
                continue
            x, y, z, yaw, pitch = self._spawn_position
            offset = 0.15 * self._movement_toggle
            self._movement_toggle *= -1

            packet = OutgoingPositionPacket()
            packet.x = x + offset
            packet.y = y
            packet.z = z
            packet.yaw = yaw
            packet.pitch = pitch
            packet.on_ground = True
            try:
                self.connection.write_packet(packet)
                print(
                    f"[BOT] Movimiento anti-AFK enviado (offset {offset:+.2f} en X)."
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[BOT] No se pudo enviar el paquete anti-AFK: {exc}")

    # ----- Chat helpers -----
    def send_chat(self, text: str) -> None:
        self._chat_queue.put(text)

    def _send_chat_packet(self, text: str) -> None:
        if not self.connection:
            print("[BOT] Aún no hay una conexión activa, no se envió el mensaje.")
            return
        packet = ChatPacket()
        packet.message = text
        try:
            self.connection.write_packet(packet)
            print(f"[BOT] Mensaje enviado: {text}")
        except Exception as exc:  # noqa: BLE001
            print("[BOT] No se pudo enviar el mensaje desde la terminal:")
            print(exc)

    # ----- Utility -----
    @staticmethod
    def _extract_reason(data: Optional[str]) -> str:
        if not data:
            return ""
        try:
            parsed = json.loads(data)
            if isinstance(parsed, dict) and "text" in parsed:
                return str(parsed.get("text", ""))
            if isinstance(parsed, dict) and "extra" in parsed:
                extras = parsed.get("extra", [])
                return "".join(
                    part.get("text", "") for part in extras if isinstance(part, dict)
                )
        except Exception:
            return str(data)
        return str(data)


def calculate_reconnect_delay(reason_text: str) -> float:
    lower = reason_text.lower()
    if "throttle" in lower:
        return THROTTLED_RECONNECT_DELAY_MS / 1000
    return RECONNECT_DELAY_MS / 1000


def prompt_password() -> str:
    try:
        return input("Ingresa la contraseña del bot (para /login y /register): ")
    except EOFError:
        return ""


def main() -> None:
    print("[BOT] Script iniciado.")
    password = prompt_password()
    if not password:
        print("[BOT] No se ingresó contraseña. Saliendo.")
        return

    def console_input_worker(bot: MinecraftBot) -> None:
        while True:
            try:
                text = input("Escribe un mensaje para enviar al chat: ").strip()
            except EOFError:
                break
            if not text:
                continue
            bot.send_chat(text)

    reconnect_reason = ""
    while True:
        bot = MinecraftBot(password=password)
        bot_thread = threading.Thread(target=bot.connect, daemon=True)
        bot_thread.start()

        input_thread = threading.Thread(
            target=console_input_worker, args=(bot,), daemon=True
        )
        input_thread.start()

        while not bot._stop_event.wait(timeout=1):
            pass

        reconnect_reason = bot.last_disconnect_reason or reconnect_reason
        bot.disconnect()
        delay = calculate_reconnect_delay(reconnect_reason)
        print(
            f"[BOT] Reconexión programada en {int(delay)} segundos. Motivo: {reconnect_reason}"
        )
        time.sleep(delay)


if __name__ == "__main__":
    main()
