"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";

type ChatMessage = {
  from: string;
  text: string;
  time: string;
  encrypted?: boolean;
};

type AppState = "lobby" | "connecting" | "in-call";

function generateRoomId() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function timeStamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importKey(keyStr: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyStr), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptMessage(text: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptMessage(data: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ICE servers for better NAT traversal
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
];

export default function Home() {
  const [state, setState] = useState<AppState>("lobby");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [encrypted, setEncrypted] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataRef = useRef<DataConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const encKeyRef = useRef<CryptoKey | null>(null);
  const isCreatorRef = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (state === "in-call") {
      setCallDuration(0);
      timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const cleanup = useCallback(() => {
    callRef.current?.close();
    dataRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    peerRef.current?.destroy();
    callRef.current = null;
    dataRef.current = null;
    localStreamRef.current = null;
    peerRef.current = null;
    encKeyRef.current = null;
    setMessages([]);
    setRemoteName("");
    setRoomId("");
    setJoinId("");
    setCopied(false);
    setCallDuration(0);
    setEncrypted(false);
    setState("lobby");
  }, []);

  const setupDataConnection = useCallback(
    (conn: DataConnection) => {
      dataRef.current = conn;

      conn.on("open", async () => {
        if (isCreatorRef.current) {
          const key = await generateEncryptionKey();
          encKeyRef.current = key;
          const exported = await exportKey(key);
          conn.send({ type: "key", key: exported });
        }
        conn.send({ type: "name", name: nameRef.current });
      });

      conn.on("data", async (data) => {
        const parsed = data as { type: string; name?: string; text?: string; key?: string };
        if (parsed.type === "name" && parsed.name) {
          setRemoteName(parsed.name);
        } else if (parsed.type === "key" && parsed.key) {
          encKeyRef.current = await importKey(parsed.key);
          setEncrypted(true);
          conn.send({ type: "key-ack" });
        } else if (parsed.type === "key-ack") {
          setEncrypted(true);
        } else if (parsed.type === "chat" && parsed.text) {
          let text = parsed.text;
          if (encKeyRef.current) {
            try {
              text = await decryptMessage(parsed.text, encKeyRef.current);
            } catch {
              text = "[decryption failed]";
            }
          }
          const from = parsed.name || "Them";
          setMessages((prev) => [...prev, { from, text, time: timeStamp(), encrypted: true }]);
        }
      });

      conn.on("close", cleanup);
      conn.on("error", () => cleanup());
    },
    [cleanup]
  );

  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch {
      setError("Camera/mic access denied. Please allow permissions and try again.");
      setState("lobby");
      return null;
    }
  };

  const createRoom = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    setError("");
    setState("connecting");
    isCreatorRef.current = true;

    const id = "rp-" + generateRoomId();
    setRoomId(id);

    const stream = await getMedia();
    if (!stream) return;

    const peer = new Peer(id, { config: { iceServers: ICE_SERVERS } });
    peerRef.current = peer;

    peer.on("open", () => setState("connecting"));

    peer.on("call", (call) => {
      call.answer(stream);
      callRef.current = call;
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.play().catch(() => {});
        }
        setState("in-call");
      });
      call.on("close", cleanup);
      call.on("error", () => cleanup());
    });

    peer.on("connection", (conn) => setupDataConnection(conn));

    peer.on("error", (err) => {
      setError(`Connection failed: ${err.message}`);
      cleanup();
    });
  };

  const joinRoom = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    const code = joinId.trim().toUpperCase();
    if (!code) {
      setError("Please enter a room code");
      return;
    }
    setError("");
    setState("connecting");
    isCreatorRef.current = false;

    const stream = await getMedia();
    if (!stream) return;

    const fullId = code.startsWith("rp-") ? code : "rp-" + code;
    const myId = "rp-" + generateRoomId() + "-J";
    const peer = new Peer(myId, { config: { iceServers: ICE_SERVERS } });
    peerRef.current = peer;

    peer.on("open", () => {
      const call = peer.call(fullId, stream);
      if (!call) {
        setError("Could not initiate call. Try again.");
        cleanup();
        return;
      }
      callRef.current = call;

      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          remoteVideoRef.current.play().catch(() => {});
        }
        setState("in-call");
      });
      call.on("close", cleanup);
      call.on("error", () => cleanup());

      const conn = peer.connect(fullId, { reliable: true });
      setupDataConnection(conn);
    });

    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        setError("Room not found. Check the code and try again.");
      } else {
        setError(`Connection failed: ${err.message}`);
      }
      cleanup();
    });
  };

  const sendMessage = async () => {
    if (!draft.trim() || !dataRef.current) return;
    const text = draft.trim();
    let payload = text;
    if (encKeyRef.current) {
      try {
        payload = await encryptMessage(text, encKeyRef.current);
      } catch {
        /* send unencrypted as fallback */
      }
    }
    dataRef.current.send({ type: "chat", name, text: payload });
    setMessages((prev) => [...prev, { from: "You", text, time: timeStamp(), encrypted: !!encKeyRef.current }]);
    setDraft("");
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  };

  const copyCode = () => {
    const code = roomId.replace("rp-", "");
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayCode = roomId.replace("rp-", "");

  // ── LOBBY ──
  if (state === "lobby" || state === "connecting") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 relative overflow-hidden min-h-screen">
        {/* Background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-accent-light/40 blur-3xl animate-float" />
          <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-blue-light/50 blur-3xl animate-float" style={{ animationDelay: "2s" }} />
          <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full bg-lily-light/40 blur-3xl animate-float" style={{ animationDelay: "4s" }} />
        </div>

        <div className="w-full max-w-md space-y-6 relative z-10 animate-slide-up">
          {/* Logo card */}
          <div className="glass-strong rounded-3xl p-8 text-center" style={{ boxShadow: "var(--shadow-lg)" }}>
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4"
              style={{ background: "linear-gradient(135deg, var(--accent-light), var(--lily-light), var(--blue-light))" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent-hover">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, var(--accent-hover), var(--lily-deep), var(--blue-deep))" }}>
              rp
            </h1>
            <p className="text-muted text-sm mt-2">Encrypted peer-to-peer video calls</p>
            <div className="flex items-center justify-center gap-1.5 mt-3">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-green-500">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
              <span className="text-xs text-green-600 font-medium">End-to-end encrypted</span>
            </div>
          </div>

          {error && (
            <div className="glass rounded-2xl px-4 py-3 border-red-200 bg-red-50/80 text-red-600 text-sm animate-fade-in">
              {error}
            </div>
          )}

          {/* Main form card */}
          <div className="glass rounded-3xl p-6 space-y-5" style={{ boxShadow: "var(--shadow)" }}>
            {/* Name input */}
            <div>
              <label className="block text-xs text-muted mb-2 font-medium uppercase tracking-wider">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full bg-white/60 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
                maxLength={30}
              />
            </div>

            {state === "lobby" && (
              <>
                <button
                  onClick={createRoom}
                  className="w-full font-semibold py-3.5 px-6 rounded-xl transition-all active:scale-[0.98] text-white shadow-md hover:shadow-lg hover:brightness-105"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--lily-deep))" }}
                >
                  Create Room
                </button>

                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-border-strong" />
                  <span className="text-muted text-xs uppercase tracking-wider font-medium">or join a room</span>
                  <div className="flex-1 h-px bg-border-strong" />
                </div>

                <div className="flex gap-3">
                  <input
                    type="text"
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                    placeholder="Room code"
                    className="flex-1 bg-white/60 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-muted/60 focus:border-blue-deep focus:ring-2 focus:ring-blue/20 transition-all font-mono tracking-[0.2em] text-center text-lg"
                    maxLength={10}
                    onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                  />
                  <button
                    onClick={joinRoom}
                    className="text-white font-semibold py-3 px-6 rounded-xl transition-all active:scale-[0.98] shadow-md hover:shadow-lg hover:brightness-105"
                    style={{ background: "linear-gradient(135deg, var(--blue-deep), var(--lily))" }}
                  >
                    Join
                  </button>
                </div>
              </>
            )}

            {/* Waiting state */}
            {state === "connecting" && roomId && (
              <div className="space-y-4 text-center animate-fade-in">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse-soft" />
                  <span className="text-sm text-muted">Waiting for someone to join...</span>
                </div>
                <div className="bg-white/50 rounded-2xl p-4">
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-3xl tracking-[0.35em] text-foreground font-bold">{displayCode}</span>
                  </div>
                  <button
                    onClick={copyCode}
                    className="mt-3 text-sm font-medium px-4 py-1.5 rounded-lg transition-all text-white"
                    style={{ background: copied ? "var(--lily-deep)" : "var(--accent)" }}
                  >
                    {copied ? "Copied!" : "Copy Code"}
                  </button>
                </div>
                <p className="text-xs text-muted">Share this code with someone to start a call</p>
                <button onClick={cleanup} className="text-sm text-muted hover:text-accent-hover transition font-medium">
                  Cancel
                </button>
              </div>
            )}

            {state === "connecting" && !roomId && (
              <div className="text-center space-y-3 animate-fade-in py-4">
                <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-muted">Connecting to room...</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-muted/60">
            No sign-up required &middot; P2P connection &middot; Nothing stored
          </p>
        </div>
      </div>
    );
  }

  // ── IN-CALL ──
  return (
    <div className="flex flex-1 h-screen overflow-hidden">
      {/* Chat sidebar */}
      <div
        className={`${chatOpen ? "w-80 min-w-80" : "w-0 min-w-0 overflow-hidden"} glass-strong border-r border-border-strong flex flex-col transition-all duration-300`}
      >
        {/* Chat header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-lily-deep">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-semibold text-foreground">Chat</span>
            {encrypted && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" /></svg>
                E2E
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted font-medium">clears on hang up</span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center mt-12 space-y-2">
              <div className="w-12 h-12 rounded-full bg-lily-light/50 flex items-center justify-center mx-auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-lily">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-muted text-xs">Messages will appear here</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.from === "You" ? "items-end" : "items-start"} animate-fade-in`}>
              <div
                className={`max-w-[85%] px-3.5 py-2.5 text-sm shadow-sm ${
                  msg.from === "You"
                    ? "rounded-2xl rounded-br-md text-white"
                    : "rounded-2xl rounded-bl-md text-foreground bg-white/70 border border-border"
                }`}
                style={msg.from === "You" ? { background: "linear-gradient(135deg, var(--accent), var(--lily-deep))" } : undefined}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-muted mt-1 px-1 flex items-center gap-1">
                {msg.from === "You" ? "You" : remoteName || "Them"} &middot; {msg.time}
                {msg.encrypted && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="text-green-500">
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
                  </svg>
                )}
              </span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={encrypted ? "Encrypted message..." : "Type a message..."}
              className="flex-1 bg-white/60 border border-border-strong rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
              maxLength={500}
            />
            <button
              onClick={sendMessage}
              disabled={!draft.trim()}
              className="disabled:opacity-30 text-white px-3 py-2.5 rounded-xl transition-all hover:brightness-110 active:scale-95"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--lily-deep))" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="glass-strong flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/50 transition text-muted"
              title={chatOpen ? "Hide chat" : "Show chat"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse-soft" />
            <span className="text-sm font-semibold text-foreground">
              {remoteName ? `Call with ${remoteName}` : "Connected"}
            </span>
            {encrypted && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" /></svg>
                Encrypted
              </span>
            )}
          </div>
          <span className="text-sm font-mono text-muted font-medium">{formatDuration(callDuration)}</span>
        </div>

        {/* Videos */}
        <div className="flex-1 flex items-center justify-center p-4 relative" style={{ background: "linear-gradient(135deg, #fce4ec40, #f3e5f540, #e8eaf640)" }}>
          {/* Remote video */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full max-h-[calc(100vh-140px)] object-cover rounded-2xl shadow-xl"
            style={{ background: "linear-gradient(135deg, #f3e5f5, #e8eaf6)" }}
          />
          {/* Local video PiP */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-7 right-7 w-52 h-40 object-cover rounded-2xl border-3 border-white/80 shadow-xl"
          />
        </div>

        {/* Controls */}
        <div className="glass-strong flex items-center justify-center gap-3 py-4 border-t border-border">
          <button
            onClick={toggleMic}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 ${
              micOn
                ? "bg-white hover:bg-white/80 text-foreground"
                : "bg-red-100 text-red-500 hover:bg-red-200"
            }`}
            title={micOn ? "Mute" : "Unmute"}
          >
            {micOn ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.5-.36 2.18" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>

          <button
            onClick={toggleCam}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 ${
              camOn
                ? "bg-white hover:bg-white/80 text-foreground"
                : "bg-red-100 text-red-500 hover:bg-red-200"
            }`}
            title={camOn ? "Turn off camera" : "Turn on camera"}
          >
            {camOn ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M21 17V7l-7 5 7 5z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            )}
          </button>

          <button
            onClick={cleanup}
            className="w-16 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-lg"
            title="End call"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
              <line x1="23" y1="1" x2="1" y2="23" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
