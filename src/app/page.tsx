"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";

/* ── Types ── */
type ChatMessage = { id: number; from: string; text: string; time: string; encrypted?: boolean };
type AppState = "lobby" | "connecting" | "in-call";

/* ── Helpers ── */
function rid() {
  const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function ts() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
let msgId = 0;

/* ── Crypto ── */
async function genKey() { return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
async function expKey(k: CryptoKey) { const r = await crypto.subtle.exportKey("raw", k); return btoa(String.fromCharCode(...new Uint8Array(r))); }
async function impKey(s: string) { return crypto.subtle.importKey("raw", Uint8Array.from(atob(s), c => c.charCodeAt(0)), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
async function enc(t: string, k: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(t));
  const m = new Uint8Array(iv.length + new Uint8Array(ct).length);
  m.set(iv); m.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...m));
}
async function dec(d: string, k: CryptoKey) {
  const m = Uint8Array.from(atob(d), c => c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: m.slice(0, 12) }, k, m.slice(12)));
}

const ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

/* ── Icons ── */
const Icon = ({ d, size = 20, className = "" }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{d.split("|").map((p, i) => <path key={i} d={p} />)}</svg>
);
const VideoIcon = () => <Icon d="M23 7l-7 5 7 5V7z|M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5z" />;
const MicIcon = () => <Icon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v4|M8 23h8" />;
const MicOffIcon = () => <Icon d="M1 1l22 22|M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6|M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.5-.36 2.18|M12 19v4|M8 23h8" />;
const CamOffIcon = () => <Icon d="M1 1l22 22|M21 17V7l-7 5 7 5z|M1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5z" />;
const PhoneOffIcon = () => <Icon d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91|M23 1L1 23" />;
const ChatIcon = () => <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const SendIcon = () => <Icon d="M22 2L11 13|M22 2l-7 20-4-9-9-4 20-7z" size={16} />;
const ShieldIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" /></svg>
);
const LockIcon = ({ size = 8 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" /></svg>
);
const SunIcon = () => <Icon d="M12 3v1m0 16v1m-8-9H3m18 0h-1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" size={16} />;
const MoonIcon = () => <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" size={16} />;
const ScreenShareIcon = () => <Icon d="M2 3h20v14H2z|M8 21h8|M12 17v4" size={18} />;

/* ── Lily Particles ── */
const LilyParticles = () => (
  <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className={`lily-particle p${i}`} />)}
  </div>
);

/* ── Main ── */
export default function Home() {
  const [state, setState] = useState<AppState>("lobby");
  const [dark, setDark] = useState(false);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [copied, setCopied] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState("");
  const [dur, setDur] = useState(0);
  const [e2e, setE2e] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [unread, setUnread] = useState(0);
  const [typing, setTyping] = useState(false);
  const [screenShare, setScreenShare] = useState(false);

  // PiP drag state
  const [pipPos, setPipPos] = useState({ x: -1, y: -1 });
  const pipDragging = useRef(false);
  const pipOffset = useRef({ x: 0, y: 0 });

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataRef = useRef<DataConnection | null>(null);
  const localVidRef = useRef<HTMLVideoElement>(null);
  const remoteVidRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const isHost = useRef(false);
  const nameRef = useRef(name);
  nameRef.current = name;
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origStreamRef = useRef<MediaStream | null>(null);

  // Dark mode toggle
  useEffect(() => {
    document.body.classList.toggle("dark-mode", dark);
    document.body.classList.toggle("light-mode", !dark);
  }, [dark]);

  // Attach streams
  useEffect(() => {
    if (localVidRef.current && localStream) {
      localVidRef.current.srcObject = localStream;
      localVidRef.current.play().catch(() => {});
    }
  }, [localStream, state]);

  useEffect(() => {
    if (remoteVidRef.current && remoteStream) {
      remoteVidRef.current.srcObject = remoteStream;
      remoteVidRef.current.play().catch(() => {});
    }
  }, [remoteStream, state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (state === "in-call") {
      setDur(0);
      timerRef.current = setInterval(() => setDur(d => d + 1), 1000);
    } else if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  // PiP default position
  useEffect(() => {
    if (state === "in-call" && pipPos.x === -1) {
      setPipPos({ x: window.innerWidth - 220, y: window.innerHeight - 200 });
    }
  }, [state, pipPos.x]);

  // PiP drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!pipDragging.current) return;
      const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
      const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
      setPipPos({ x: cx - pipOffset.current.x, y: cy - pipOffset.current.y });
    };
    const onUp = () => { pipDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const startPipDrag = (e: React.MouseEvent | React.TouchEvent) => {
    pipDragging.current = true;
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    pipOffset.current = { x: cx - pipPos.x, y: cy - pipPos.y };
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const cleanup = useCallback(() => {
    callRef.current?.close(); dataRef.current?.close();
    localStream?.getTracks().forEach(t => t.stop());
    origStreamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy();
    callRef.current = null; dataRef.current = null; peerRef.current = null; keyRef.current = null; origStreamRef.current = null;
    setLocalStream(null); setRemoteStream(null); setMsgs([]); setRemoteName("");
    setRoomId(""); setJoinId(""); setCopied(false); setDur(0); setE2e(false);
    setUnread(0); setTyping(false); setScreenShare(false);
    setPipPos({ x: -1, y: -1 });
    setState("lobby");
  }, [localStream]);

  const setupData = useCallback((conn: DataConnection) => {
    dataRef.current = conn;
    conn.on("open", async () => {
      if (isHost.current) {
        const k = await genKey(); keyRef.current = k;
        conn.send({ type: "key", key: await expKey(k) });
      }
      conn.send({ type: "name", name: nameRef.current });
    });
    conn.on("data", async (data) => {
      const p = data as Record<string, string>;
      if (p.type === "name" && p.name) setRemoteName(p.name);
      else if (p.type === "key" && p.key) { keyRef.current = await impKey(p.key); setE2e(true); conn.send({ type: "key-ack" }); }
      else if (p.type === "key-ack") setE2e(true);
      else if (p.type === "typing") { setTyping(true); if (typingTimer.current) clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 2000); }
      else if (p.type === "chat" && p.text) {
        let text = p.text;
        if (keyRef.current) { try { text = await dec(p.text, keyRef.current); } catch { text = "[decryption failed]"; } }
        const from = p.name || "Them";
        setMsgs(prev => [...prev, { id: ++msgId, from, text, time: ts(), encrypted: true }]);
        if (!chatOpen) setUnread(u => u + 1);
      }
    });
    conn.on("close", () => cleanup());
    conn.on("error", () => cleanup());
  }, [cleanup, chatOpen]);

  const getMedia = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setLocalStream(s);
      origStreamRef.current = s;
      return s;
    } catch { setError("Camera/mic access denied."); setState("lobby"); return null; }
  };

  const createRoom = async () => {
    if (!name.trim()) { setError("Please enter your name"); return; }
    setError(""); setState("connecting"); isHost.current = true;
    const id = "rp-" + rid(); setRoomId(id);
    const stream = await getMedia(); if (!stream) return;
    const peer = new Peer(id, { config: { iceServers: ICE } }); peerRef.current = peer;
    peer.on("open", () => setState("connecting"));
    peer.on("call", call => {
      call.answer(stream); callRef.current = call;
      call.on("stream", rs => { setRemoteStream(rs); setState("in-call"); });
      call.on("close", () => cleanup()); call.on("error", () => cleanup());
    });
    peer.on("connection", conn => setupData(conn));
    peer.on("error", err => { setError(`Connection failed: ${err.message}`); cleanup(); });
  };

  const joinRoom = async () => {
    if (!name.trim()) { setError("Please enter your name"); return; }
    const code = joinId.trim().toUpperCase();
    if (!code) { setError("Please enter a room code"); return; }
    setError(""); setState("connecting"); isHost.current = false;
    const stream = await getMedia(); if (!stream) return;
    const fullId = code.startsWith("RP-") ? code.replace("RP-", "rp-") : "rp-" + code;
    const peer = new Peer("rp-" + rid() + "-J", { config: { iceServers: ICE } }); peerRef.current = peer;
    peer.on("open", () => {
      const call = peer.call(fullId, stream);
      if (!call) { setError("Could not reach room."); cleanup(); return; }
      callRef.current = call;
      call.on("stream", rs => { setRemoteStream(rs); setState("in-call"); });
      call.on("close", () => cleanup()); call.on("error", () => cleanup());
      setupData(peer.connect(fullId, { reliable: true }));
    });
    peer.on("error", err => {
      setError(err.type === "peer-unavailable" ? "Room not found. Check the code." : `Connection failed: ${err.message}`);
      cleanup();
    });
  };

  const sendMsg = async () => {
    if (!draft.trim() || !dataRef.current) return;
    const text = draft.trim(); let payload = text;
    if (keyRef.current) { try { payload = await enc(text, keyRef.current); } catch {} }
    dataRef.current.send({ type: "chat", name, text: payload });
    setMsgs(prev => [...prev, { id: ++msgId, from: "You", text, time: ts(), encrypted: !!keyRef.current }]);
    setDraft("");
  };

  const sendTyping = () => { dataRef.current?.send({ type: "typing" }); };

  const toggleMic = () => { const t = localStream?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setMicOn(t.enabled); } };
  const toggleCam = () => { const t = localStream?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setCamOn(t.enabled); } };

  const toggleScreenShare = async () => {
    if (!callRef.current || !peerRef.current) return;
    if (screenShare) {
      localStream?.getTracks().forEach(t => t.stop());
      if (origStreamRef.current) {
        setLocalStream(origStreamRef.current);
        const sender = callRef.current.peerConnection?.getSenders().find(s => s.track?.kind === "video");
        const vt = origStreamRef.current.getVideoTracks()[0];
        if (sender && vt) sender.replaceTrack(vt);
      }
      setScreenShare(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const sender = callRef.current.peerConnection?.getSenders().find(s => s.track?.kind === "video");
        const vt = screen.getVideoTracks()[0];
        if (sender && vt) sender.replaceTrack(vt);
        setLocalStream(screen);
        setScreenShare(true);
        vt.onended = () => toggleScreenShare();
      } catch {}
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(roomId.replace("rp-", ""));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const openChat = () => { setChatOpen(true); setUnread(0); };
  const displayCode = roomId.replace("rp-", "");

  /* ══════════════════ LOBBY ══════════════════ */
  if (state === "lobby" || state === "connecting") {
    return (
      <div className="flex flex-1 items-center justify-center p-4 relative overflow-hidden min-h-screen">
        <LilyParticles />

        {/* Background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl animate-float-slow" style={{ background: "radial-gradient(circle, rgba(248,141,175,0.25), transparent 70%)" }} />
          <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full blur-3xl animate-float-slow" style={{ animationDelay: "3s", background: "radial-gradient(circle, rgba(204,122,255,0.2), transparent 70%)" }} />
          <div className="absolute top-1/4 right-1/3 w-64 h-64 rounded-full blur-3xl animate-float" style={{ animationDelay: "5s", background: "radial-gradient(circle, rgba(168,212,240,0.2), transparent 70%)" }} />
        </div>

        {/* Theme toggle */}
        <button onClick={() => setDark(!dark)} className="absolute top-6 right-6 z-20 w-10 h-10 rounded-xl glass flex items-center justify-center hover:scale-110 transition-all" style={{ boxShadow: "var(--shadow-card)" }}>
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className="w-full max-w-lg space-y-6 relative z-10 animate-slide-up">
          {/* Hero card */}
          <div className="glass-strong rounded-[28px] p-10 text-center card-3d" style={{ boxShadow: "var(--shadow-card-lg)" }}>
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl mb-5 relative" style={{ background: "linear-gradient(135deg, var(--pink-100), var(--lily-100), var(--blue-100))" }}>
              <div className="absolute inset-0 rounded-3xl animate-pulse-soft" style={{ background: "linear-gradient(135deg, var(--pink-200), var(--lily-200))", opacity: 0.3 }} />
              <VideoIcon />
            </div>
            <h1 className="text-5xl font-extrabold tracking-tight shimmer-text mb-2">rp</h1>
            <p className="text-sm opacity-60 mb-4">Next-generation encrypted video platform</p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(34,197,94,0.1)", color: "rgb(22,163,74)" }}>
              <ShieldIcon size={14} />
              <span>End-to-end encrypted</span>
            </div>
          </div>

          {error && <div className="rounded-2xl px-4 py-3 text-sm animate-scale-in font-medium" style={{ background: "rgba(239,68,68,0.08)", color: "rgb(220,38,38)", border: "1px solid rgba(239,68,68,0.15)" }}>{error}</div>}

          {/* Form card */}
          <div className="glass rounded-[28px] p-7 space-y-5 card-3d" style={{ boxShadow: "var(--shadow-card)" }}>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.15em] font-semibold opacity-50 mb-2">Your Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name"
                className="w-full rounded-2xl px-5 py-3.5 text-[15px] transition-all border-2 placeholder:opacity-40"
                style={{ background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.6)", borderColor: dark ? "rgba(255,180,220,0.12)" : "rgba(200,162,212,0.25)" }}
                onFocus={e => e.target.style.borderColor = "var(--pink-300)"}
                onBlur={e => e.target.style.borderColor = dark ? "rgba(255,180,220,0.12)" : "rgba(200,162,212,0.25)"}
                maxLength={30} />
            </div>

            {state === "lobby" && (
              <>
                <button onClick={createRoom} className="btn-primary w-full text-[15px] py-4 rounded-2xl">
                  Create Room
                </button>
                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px opacity-20" style={{ background: "currentColor" }} />
                  <span className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-40">or join</span>
                  <div className="flex-1 h-px opacity-20" style={{ background: "currentColor" }} />
                </div>
                <div className="flex gap-3">
                  <input type="text" value={joinId} onChange={e => setJoinId(e.target.value.toUpperCase())} placeholder="CODE"
                    className="flex-1 rounded-2xl px-4 py-3.5 font-mono tracking-[0.3em] text-center text-lg transition-all border-2 placeholder:opacity-30"
                    style={{ background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.6)", borderColor: dark ? "rgba(255,180,220,0.12)" : "rgba(200,162,212,0.25)" }}
                    maxLength={10} onKeyDown={e => e.key === "Enter" && joinRoom()} />
                  <button onClick={joinRoom} className="btn-glass rounded-2xl px-6 font-semibold" style={{ background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.5)" }}>
                    Join
                  </button>
                </div>
              </>
            )}

            {state === "connecting" && roomId && (
              <div className="space-y-5 text-center animate-scale-in">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full animate-pulse-soft" style={{ background: "rgb(34,197,94)" }} />
                  <span className="text-sm opacity-60">Waiting for someone to join...</span>
                </div>
                <div className="rounded-2xl p-5" style={{ background: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.5)" }}>
                  <span className="font-mono text-4xl tracking-[0.4em] font-extrabold gradient-text">{displayCode}</span>
                  <br />
                  <button onClick={copyCode} className="mt-4 btn-primary text-sm py-2 px-5 rounded-xl">
                    {copied ? "Copied!" : "Copy Code"}
                  </button>
                </div>
                <p className="text-xs opacity-40">Share this code to start a call</p>
                <button onClick={cleanup} className="text-sm opacity-50 hover:opacity-100 transition font-medium">Cancel</button>
              </div>
            )}

            {state === "connecting" && !roomId && (
              <div className="text-center py-6 animate-scale-in">
                <div className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin mx-auto" style={{ borderColor: "var(--pink-300)", borderTopColor: "transparent" }} />
                <p className="text-sm opacity-50 mt-3">Connecting...</p>
              </div>
            )}
          </div>

          <p className="text-center text-xs opacity-30">No sign-up &middot; Peer-to-peer &middot; Zero data stored</p>
        </div>
      </div>
    );
  }

  /* ══════════════════ IN-CALL ══════════════════ */
  return (
    <div className="flex flex-1 h-screen overflow-hidden relative">
      <LilyParticles />

      {/* ── Chat sidebar ── */}
      <div className={`chat-sidebar ${chatOpen ? "w-[340px] min-w-[340px]" : "w-0 min-w-0 overflow-hidden"} glass-strong border-r flex flex-col transition-all duration-400 ease-[cubic-bezier(0.23,1,0.32,1)] z-40 relative`}
        style={{ borderColor: dark ? "var(--glass-border-dark)" : "var(--glass-border)" }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${dark ? "rgba(255,180,220,0.1)" : "rgba(200,162,212,0.2)"}` }}>
          <div className="flex items-center gap-2.5">
            <ChatIcon />
            <span className="text-sm font-bold">Chat</span>
            {e2e && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "rgb(22,163,74)" }}>
                <LockIcon size={8} /> E2E
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] opacity-40 font-medium">clears on hang up</span>
            <button onClick={() => setChatOpen(false)} className="sm:hidden w-7 h-7 rounded-lg flex items-center justify-center opacity-50 hover:opacity-100 transition">
              <Icon d="M18 6L6 18|M6 6l12 12" size={14} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.length === 0 && (
            <div className="text-center mt-16 space-y-3 opacity-40">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: dark ? "rgba(255,180,220,0.08)" : "rgba(200,162,212,0.12)" }}>
                <ChatIcon />
              </div>
              <p className="text-xs">Send a message to start chatting</p>
            </div>
          )}
          {msgs.map(msg => (
            <div key={msg.id} className={`flex flex-col ${msg.from === "You" ? "items-end" : "items-start"} animate-msg-in`}>
              <div className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                msg.from === "You"
                  ? "rounded-2xl rounded-br-md text-white shadow-md"
                  : "rounded-2xl rounded-bl-md shadow-sm"
              }`}
                style={msg.from === "You"
                  ? { background: "linear-gradient(135deg, var(--pink-400), var(--lily-400))" }
                  : { background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.7)", border: `1px solid ${dark ? "rgba(255,180,220,0.1)" : "rgba(200,162,212,0.2)"}` }
                }>
                {msg.text}
              </div>
              <span className="text-[10px] opacity-40 mt-1 px-1 flex items-center gap-1">
                {msg.from === "You" ? "You" : remoteName || "Them"} &middot; {msg.time}
                {msg.encrypted && <LockIcon size={8} />}
              </span>
            </div>
          ))}
          {typing && (
            <div className="flex items-start animate-fade-in">
              <div className="px-4 py-3 rounded-2xl rounded-bl-md" style={{ background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.7)" }}>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => <div key={i} className="w-2 h-2 rounded-full typing-dot" style={{ background: "var(--pink-300)" }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3" style={{ borderTop: `1px solid ${dark ? "rgba(255,180,220,0.1)" : "rgba(200,162,212,0.2)"}` }}>
          <div className="flex gap-2">
            <input type="text" value={draft}
              onChange={e => { setDraft(e.target.value); sendTyping(); }}
              onKeyDown={e => e.key === "Enter" && sendMsg()}
              placeholder={e2e ? "Encrypted message..." : "Type a message..."}
              className="flex-1 rounded-2xl px-4 py-3 text-sm transition-all border placeholder:opacity-40"
              style={{ background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.6)", borderColor: dark ? "rgba(255,180,220,0.12)" : "rgba(200,162,212,0.2)" }}
              maxLength={500} />
            <button onClick={sendMsg} disabled={!draft.trim()}
              className="rounded-2xl px-4 py-3 text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-25"
              style={{ background: "linear-gradient(135deg, var(--pink-400), var(--lily-400))" }}>
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      {/* ── Video area ── */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar */}
        <div className="glass-strong flex items-center justify-between px-5 py-3 z-20" style={{ borderBottom: `1px solid ${dark ? "rgba(255,180,220,0.1)" : "rgba(200,162,212,0.2)"}` }}>
          <div className="flex items-center gap-3">
            {/* Chat toggle */}
            <button onClick={() => chatOpen ? setChatOpen(false) : openChat()} className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110"
              style={{ background: dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.4)" }}>
              <ChatIcon />
              {unread > 0 && <span className="unread-badge">{unread}</span>}
            </button>
            <div className="w-2.5 h-2.5 rounded-full animate-pulse-soft" style={{ background: "rgb(34,197,94)" }} />
            <span className="text-sm font-bold">
              {remoteName ? `Call with ${remoteName}` : "Connected"}
            </span>
            {e2e && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "rgb(22,163,74)" }}>
                <LockIcon /> Encrypted
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono opacity-50 font-medium">{fmtDur(dur)}</span>
            <button onClick={() => setDark(!dark)} className="w-8 h-8 rounded-lg flex items-center justify-center opacity-50 hover:opacity-100 transition">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>

        {/* Video container */}
        <div className="flex-1 relative overflow-hidden" style={{ background: dark ? "rgba(10,5,8,0.5)" : "linear-gradient(135deg, rgba(254,240,245,0.3), rgba(249,240,255,0.3), rgba(240,245,255,0.3))" }}>
          {/* Remote video */}
          <video ref={remoteVidRef} autoPlay playsInline
            className="w-full h-full object-cover"
            style={{ background: dark ? "#0a0508" : "linear-gradient(135deg, #f9f0ff, #fef0f5)" }} />

          {/* Remote name overlay */}
          {remoteName && (
            <div className="absolute top-5 left-5 glass rounded-xl px-4 py-2 flex items-center gap-2 animate-fade-in">
              <div className="w-2 h-2 rounded-full" style={{ background: "rgb(34,197,94)" }} />
              <span className="text-sm font-semibold">{remoteName}</span>
            </div>
          )}

          {/* Draggable PiP */}
          <video ref={localVidRef} autoPlay playsInline muted
            className="pip-video absolute w-[200px] h-[150px] object-cover rounded-2xl z-30"
            style={{
              left: pipPos.x === -1 ? undefined : pipPos.x,
              top: pipPos.y === -1 ? undefined : pipPos.y,
              right: pipPos.x === -1 ? 24 : undefined,
              bottom: pipPos.y === -1 ? 100 : undefined,
              border: `3px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.7)"}`,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
            onMouseDown={startPipDrag}
            onTouchStart={startPipDrag} />
        </div>

        {/* Controls bar */}
        <div className="glass-strong flex items-center justify-center gap-2 sm:gap-3 py-4 px-4 z-20" style={{ borderTop: `1px solid ${dark ? "rgba(255,180,220,0.1)" : "rgba(200,162,212,0.2)"}` }}>
          {/* Mic */}
          <button onClick={toggleMic} title={micOn ? "Mute" : "Unmute"}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${
              micOn ? "" : "!bg-red-500/15 !text-red-500"
            }`}
            style={micOn ? { background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)", boxShadow: "var(--shadow-card)" } : undefined}>
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </button>

          {/* Camera */}
          <button onClick={toggleCam} title={camOn ? "Camera off" : "Camera on"}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${
              camOn ? "" : "!bg-red-500/15 !text-red-500"
            }`}
            style={camOn ? { background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)", boxShadow: "var(--shadow-card)" } : undefined}>
            {camOn ? <VideoIcon /> : <CamOffIcon />}
          </button>

          {/* Screen share */}
          <button onClick={toggleScreenShare} title={screenShare ? "Stop sharing" : "Share screen"}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${
              screenShare ? "!text-green-500" : ""
            }`}
            style={{ background: screenShare ? "rgba(34,197,94,0.15)" : (dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)"), boxShadow: "var(--shadow-card)" }}>
            <ScreenShareIcon />
          </button>

          {/* End call */}
          <button onClick={cleanup} title="End call"
            className="w-16 h-12 sm:w-20 sm:h-14 rounded-2xl text-white flex items-center justify-center transition-all active:scale-90 ml-2"
            style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)", boxShadow: "0 4px 20px rgba(239,68,68,0.35)" }}>
            <PhoneOffIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
