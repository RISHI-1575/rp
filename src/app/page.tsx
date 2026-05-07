"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";

type Msg = { id: number; from: string; text: string; time: string; enc?: boolean };
type View = "lobby" | "connecting" | "call";

let mid = 0;
const rid = () => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function genKey() { return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
async function expKey(k: CryptoKey) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", k)))); }
async function impKey(s: string) { return crypto.subtle.importKey("raw", Uint8Array.from(atob(s), c => c.charCodeAt(0)), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
async function enc(t: string, k: CryptoKey) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(t)); const m = new Uint8Array(12 + new Uint8Array(ct).length); m.set(iv); m.set(new Uint8Array(ct), 12); return btoa(String.fromCharCode(...m)); }
async function dec(d: string, k: CryptoKey) { const m = Uint8Array.from(atob(d), c => c.charCodeAt(0)); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: m.slice(0, 12) }, k, m.slice(12))); }

const ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

export default function Home() {
  const [view, setView] = useState<View>("lobby");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [copied, setCopied] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [peer2, setPeer2] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [err, setErr] = useState("");
  const [dur, setDur] = useState(0);
  const [e2e, setE2e] = useState(false);
  const [chat, setChat] = useState(false);
  const [ls, setLs] = useState<MediaStream | null>(null);
  const [rs, setRs] = useState<MediaStream | null>(null);
  const [unread, setUnread] = useState(0);
  const [typing, setTyping] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pipPos, setPipPos] = useState({ x: -1, y: -1 });

  const pr = useRef<Peer | null>(null);
  const cr = useRef<MediaConnection | null>(null);
  const dr = useRef<DataConnection | null>(null);
  const lv = useRef<HTMLVideoElement>(null);
  const rv = useRef<HTMLVideoElement>(null);
  const ce = useRef<HTMLDivElement>(null);
  const tr = useRef<ReturnType<typeof setInterval> | null>(null);
  const kr = useRef<CryptoKey | null>(null);
  const host = useRef(false);
  const nr = useRef(name); nr.current = name;
  const origS = useRef<MediaStream | null>(null);
  const dragging = useRef(false);
  const dragOff = useRef({ x: 0, y: 0 });
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (lv.current && ls) { lv.current.srcObject = ls; lv.current.play().catch(() => {}); } }, [ls, view]);
  useEffect(() => { if (rv.current && rs) { rv.current.srcObject = rs; rv.current.play().catch(() => {}); } }, [rs, view]);
  useEffect(() => { ce.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    if (view === "call") { setDur(0); tr.current = setInterval(() => setDur(d => d + 1), 1000); }
    else if (tr.current) { clearInterval(tr.current); tr.current = null; }
    return () => { if (tr.current) clearInterval(tr.current); };
  }, [view]);
  useEffect(() => {
    if (view === "call" && pipPos.x === -1) setPipPos({ x: window.innerWidth - 240, y: window.innerHeight - 220 });
  }, [view, pipPos.x]);
  useEffect(() => {
    const mv = (e: MouseEvent | TouchEvent) => { if (!dragging.current) return; const cx = "touches" in e ? e.touches[0].clientX : e.clientX; const cy = "touches" in e ? e.touches[0].clientY : e.clientY; setPipPos({ x: cx - dragOff.current.x, y: cy - dragOff.current.y }); };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", mv, { passive: false }); window.addEventListener("touchend", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); window.removeEventListener("touchmove", mv); window.removeEventListener("touchend", up); };
  }, []);

  const pipDown = (e: React.MouseEvent | React.TouchEvent) => {
    dragging.current = true;
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragOff.current = { x: cx - pipPos.x, y: cy - pipPos.y };
  };

  const fmtD = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const cleanup = useCallback(() => {
    cr.current?.close(); dr.current?.close();
    ls?.getTracks().forEach(t => t.stop());
    origS.current?.getTracks().forEach(t => t.stop());
    pr.current?.destroy();
    cr.current = null; dr.current = null; pr.current = null; kr.current = null; origS.current = null;
    setLs(null); setRs(null); setMsgs([]); setPeer2(""); setRoomId(""); setJoinId("");
    setCopied(false); setDur(0); setE2e(false); setUnread(0); setTyping(false); setSharing(false);
    setPipPos({ x: -1, y: -1 }); setView("lobby");
  }, [ls]);

  const setupDC = useCallback((conn: DataConnection) => {
    dr.current = conn;
    conn.on("open", async () => {
      if (host.current) { const k = await genKey(); kr.current = k; conn.send({ type: "key", key: await expKey(k) }); }
      conn.send({ type: "name", name: nr.current });
    });
    conn.on("data", async (data) => {
      const p = data as Record<string, string>;
      if (p.type === "name" && p.name) setPeer2(p.name);
      else if (p.type === "key" && p.key) { kr.current = await impKey(p.key); setE2e(true); conn.send({ type: "key-ack" }); }
      else if (p.type === "key-ack") setE2e(true);
      else if (p.type === "typing") { setTyping(true); if (tt.current) clearTimeout(tt.current); tt.current = setTimeout(() => setTyping(false), 2000); }
      else if (p.type === "chat" && p.text) {
        let text = p.text;
        if (kr.current) { try { text = await dec(p.text, kr.current); } catch { text = "[decryption failed]"; } }
        setMsgs(prev => [...prev, { id: ++mid, from: p.name || "Them", text, time: now(), enc: true }]);
        if (!chat) setUnread(u => u + 1);
      }
    });
    conn.on("close", () => cleanup()); conn.on("error", () => cleanup());
  }, [cleanup, chat]);

  const getMedia = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: { echoCancellation: true, noiseSuppression: true } });
      setLs(s); origS.current = s; return s;
    } catch { setErr("Camera/mic access denied."); setView("lobby"); return null; }
  };

  const createRoom = async () => {
    if (!name.trim()) { setErr("Enter your name"); return; }
    setErr(""); setView("connecting"); host.current = true;
    const id = "rp-" + rid(); setRoomId(id);
    const s = await getMedia(); if (!s) return;
    const peer = new Peer(id, { config: { iceServers: ICE } }); pr.current = peer;
    peer.on("open", () => setView("connecting"));
    peer.on("call", c => { c.answer(s); cr.current = c; c.on("stream", r => { setRs(r); setView("call"); }); c.on("close", () => cleanup()); c.on("error", () => cleanup()); });
    peer.on("connection", c => setupDC(c));
    peer.on("error", e => { setErr(e.message); cleanup(); });
  };

  const joinRoom = async () => {
    if (!name.trim()) { setErr("Enter your name"); return; }
    const code = joinId.trim().toUpperCase(); if (!code) { setErr("Enter a room code"); return; }
    setErr(""); setView("connecting"); host.current = false;
    const s = await getMedia(); if (!s) return;
    const fid = code.startsWith("RP-") ? code.replace("RP-", "rp-") : "rp-" + code;
    const peer = new Peer("rp-" + rid() + "-J", { config: { iceServers: ICE } }); pr.current = peer;
    peer.on("open", () => {
      const c = peer.call(fid, s); if (!c) { setErr("Can't reach room."); cleanup(); return; }
      cr.current = c; c.on("stream", r => { setRs(r); setView("call"); }); c.on("close", () => cleanup()); c.on("error", () => cleanup());
      setupDC(peer.connect(fid, { reliable: true }));
    });
    peer.on("error", e => { setErr(e.type === "peer-unavailable" ? "Room not found." : e.message); cleanup(); });
  };

  const sendMsg = async () => {
    if (!draft.trim() || !dr.current) return;
    const t = draft.trim(); let p = t;
    if (kr.current) { try { p = await enc(t, kr.current); } catch {} }
    dr.current.send({ type: "chat", name, text: p });
    setMsgs(prev => [...prev, { id: ++mid, from: "You", text: t, time: now(), enc: !!kr.current }]);
    setDraft("");
  };

  const sendTyp = () => { dr.current?.send({ type: "typing" }); };
  const togMic = () => { const t = ls?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; setMic(t.enabled); } };
  const togCam = () => { const t = ls?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; setCam(t.enabled); } };

  const togScreen = async () => {
    if (!cr.current) return;
    if (sharing) {
      ls?.getTracks().forEach(t => t.stop());
      if (origS.current) { setLs(origS.current); const sn = cr.current.peerConnection?.getSenders().find(s => s.track?.kind === "video"); const vt = origS.current.getVideoTracks()[0]; if (sn && vt) sn.replaceTrack(vt); }
      setSharing(false);
    } else {
      try { const sc = await navigator.mediaDevices.getDisplayMedia({ video: true }); const sn = cr.current.peerConnection?.getSenders().find(s => s.track?.kind === "video"); const vt = sc.getVideoTracks()[0]; if (sn && vt) sn.replaceTrack(vt); setLs(sc); setSharing(true); vt.onended = () => togScreen(); } catch {}
    }
  };

  const copyCode = () => { navigator.clipboard.writeText(roomId.replace("rp-", "")); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const openChat = () => { setChat(true); setUnread(0); };
  const dc = roomId.replace("rp-", "");

  // ======================== LOBBY ========================
  if (view === "lobby" || view === "connecting") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(160deg, #fdf2f8 0%, #fce7f3 25%, #e0e7ff 50%, #f3e8ff 75%, #fdf2f8 100%)", position: "relative", overflow: "hidden" }}>
        {/* Floating orbs — pastel pink, blue, lily */}
        <div style={{ position: "absolute", top: -100, left: -100, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(244,114,182,0.25), transparent 70%)", filter: "blur(60px)", animation: "float1 12s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -120, right: -80, width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(196,181,253,0.3), transparent 70%)", filter: "blur(80px)", animation: "float2 15s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "30%", right: "20%", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle, rgba(147,197,253,0.25), transparent 70%)", filter: "blur(50px)", animation: "float1 18s ease-in-out infinite 3s" }} />

        {/* Lily petals */}
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{ position: "absolute", width: 14 + i * 3, height: 14 + i * 3, bottom: `${5 + i * 4}%`, left: `${10 + i * 14}%`, borderRadius: "50% 0 50% 0", background: `linear-gradient(135deg, rgba(244,114,182,${0.15 + i * 0.03}), rgba(196,181,253,${0.12 + i * 0.02}))`, animation: `float${i % 2 === 0 ? 2 : 1} ${10 + i * 2}s ease-in-out infinite ${i}s`, pointerEvents: "none" }} />
        ))}

        <div style={{ width: "100%", maxWidth: 460, position: "relative", zIndex: 10, animation: "fade-up 0.6s ease-out" }}>
          {/* Hero card */}
          <div style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)", border: "1px solid rgba(244,114,182,0.2)", borderRadius: 28, padding: "48px 40px 40px", textAlign: "center", marginBottom: 20, boxShadow: "0 20px 80px rgba(244,114,182,0.1), 0 4px 20px rgba(147,197,253,0.08), inset 0 1px 0 rgba(255,255,255,0.8)" }}>
            {/* Logo */}
            <div style={{ width: 88, height: 88, borderRadius: 24, background: "linear-gradient(135deg, rgba(244,114,182,0.2), rgba(196,181,253,0.2), rgba(147,197,253,0.15))", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 20, border: "1px solid rgba(244,114,182,0.2)", boxShadow: "0 8px 32px rgba(244,114,182,0.12)" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
            </div>
            <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 8px", background: "linear-gradient(135deg, #ec4899, #a78bfa, #60a5fa)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 4s linear infinite" }}>rp</h1>
            <p style={{ fontSize: 14, color: "#9d7a9f", margin: "0 0 16px" }}>Next-gen encrypted video calls</p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="rgb(34,197,94)"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" /></svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(34,197,94)" }}>End-to-end encrypted</span>
            </div>
          </div>

          {err && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 16, padding: "12px 16px", marginBottom: 20, fontSize: 14, color: "#ef4444", animation: "scale-up 0.3s ease-out" }}>{err}</div>}

          {/* Form card */}
          <div style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)", border: "1px solid rgba(244,114,182,0.15)", borderRadius: 24, padding: "32px 28px", boxShadow: "0 12px 48px rgba(244,114,182,0.08), inset 0 1px 0 rgba(255,255,255,0.7)" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#b07ab0", marginBottom: 8 }}>Your Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" maxLength={30}
              style={{ width: "100%", padding: "14px 18px", borderRadius: 16, border: "2px solid rgba(244,114,182,0.15)", background: "rgba(255,255,255,0.5)", color: "#4a2040", fontSize: 15, marginBottom: 20, transition: "border-color 0.2s" }}
              onFocus={e => e.target.style.borderColor = "rgba(236,72,153,0.5)"}
              onBlur={e => e.target.style.borderColor = "rgba(244,114,182,0.15)"} />

            {view === "lobby" && <>
              <button onClick={createRoom} style={{ width: "100%", padding: "16px", borderRadius: 16, border: "none", background: "linear-gradient(135deg, #ec4899, #a78bfa)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 24px rgba(236,72,153,0.3)", transition: "all 0.2s", marginBottom: 24 }}
                onMouseOver={e => { (e.target as HTMLElement).style.transform = "translateY(-2px)"; (e.target as HTMLElement).style.boxShadow = "0 10px 36px rgba(236,72,153,0.4)"; }}
                onMouseOut={e => { (e.target as HTMLElement).style.transform = ""; (e.target as HTMLElement).style.boxShadow = "0 6px 24px rgba(236,72,153,0.3)"; }}>
                Create Room
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(196,181,253,0.3)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#b07ab0" }}>or join</span>
                <div style={{ flex: 1, height: 1, background: "rgba(196,181,253,0.3)" }} />
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <input type="text" value={joinId} onChange={e => setJoinId(e.target.value.toUpperCase())} placeholder="CODE" maxLength={10}
                  onKeyDown={e => e.key === "Enter" && joinRoom()}
                  style={{ flex: 1, padding: "14px 16px", borderRadius: 16, border: "2px solid rgba(196,181,253,0.2)", background: "rgba(255,255,255,0.5)", color: "#4a2040", fontSize: 20, fontFamily: "var(--font-mono)", letterSpacing: "0.25em", textAlign: "center", transition: "border-color 0.2s" }}
                  onFocus={e => e.target.style.borderColor = "rgba(167,139,250,0.5)"}
                  onBlur={e => e.target.style.borderColor = "rgba(196,181,253,0.2)"} />
                <button onClick={joinRoom} style={{ padding: "14px 28px", borderRadius: 16, border: "1px solid rgba(196,181,253,0.3)", background: "rgba(255,255,255,0.4)", color: "#6d4c7d", fontSize: 15, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseOver={e => (e.target as HTMLElement).style.background = "rgba(255,255,255,0.7)"}
                  onMouseOut={e => (e.target as HTMLElement).style.background = "rgba(255,255,255,0.4)"}>
                  Join
                </button>
              </div>
            </>}

            {view === "connecting" && roomId && (
              <div style={{ textAlign: "center", animation: "scale-up 0.3s ease-out" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", animation: "pulse-ring 2s infinite" }} />
                  <span style={{ fontSize: 14, color: "#9d7a9f" }}>Waiting for someone...</span>
                </div>
                <div style={{ padding: "20px", borderRadius: 20, background: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                  <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--font-mono)", letterSpacing: "0.35em", background: "linear-gradient(135deg, #ec4899, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{dc}</div>
                </div>
                <button onClick={copyCode} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: copied ? "#22c55e" : "linear-gradient(135deg, #ec4899, #a78bfa)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>
                  {copied ? "Copied!" : "Copy Code"}
                </button>
                <p style={{ fontSize: 12, color: "#b07ab0", marginBottom: 12 }}>Share this code to connect</p>
                <button onClick={cleanup} style={{ fontSize: 14, color: "#b07ab0", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
              </div>
            )}

            {view === "connecting" && !roomId && (
              <div style={{ textAlign: "center", padding: "30px 0", animation: "scale-up 0.3s ease-out" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid rgba(236,72,153,0.2)", borderTopColor: "#ec4899", animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
                <p style={{ fontSize: 14, color: "#9d7a9f" }}>Connecting...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </div>
            )}
          </div>

          <p style={{ textAlign: "center", fontSize: 12, color: "#c4a0c4", marginTop: 20 }}>No sign-up · Peer-to-peer · Zero data stored</p>
        </div>
      </div>
    );
  }

  // ======================== CALL (Google Meet layout, pastel theme) ========================
  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, #fdf2f8, #ede9fe, #e0f2fe)", overflow: "hidden", position: "relative" }}>

      {/* Main video area */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
        {/* Remote video */}
        <video ref={rv} autoPlay playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16, background: "#f5e6f0", boxShadow: "0 8px 40px rgba(244,114,182,0.12)" }} />

        {/* Remote name badge */}
        {peer2 && (
          <div style={{ position: "absolute", bottom: 90, left: 24, display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 12, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(244,114,182,0.15)", animation: "fade-up 0.3s ease-out" }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "#6d4c7d" }}>{peer2}</span>
          </div>
        )}

        {/* Draggable PiP */}
        <div style={{ position: "absolute", left: pipPos.x === -1 ? undefined : pipPos.x, top: pipPos.y === -1 ? undefined : pipPos.y, right: pipPos.x === -1 ? 20 : undefined, bottom: pipPos.y === -1 ? 90 : undefined, zIndex: 30, borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 24px rgba(196,181,253,0.3)", border: "2px solid rgba(244,114,182,0.25)", cursor: "grab", userSelect: "none", touchAction: "none", width: 200, transition: dragging.current ? "none" : "box-shadow 0.3s" }}
          onMouseDown={pipDown} onTouchStart={pipDown}
          onMouseOver={e => (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(196,181,253,0.3), 0 0 0 2px rgba(236,72,153,0.4)"}
          onMouseOut={e => (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(196,181,253,0.3)"}>
          <video ref={lv} autoPlay playsInline muted
            style={{ width: 200, height: 150, objectFit: "cover", display: "block", background: "#f5e6f0" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "4px 10px", background: "linear-gradient(transparent, rgba(107,70,120,0.6))", fontSize: 12, fontWeight: 500, color: "#fff" }}>
            {name || "You"}
          </div>
          {!mic && (
            <div style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: "50%", background: "rgba(239,68,68,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /></svg>
            </div>
          )}
        </div>

        {/* Call duration */}
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", padding: "6px 16px", borderRadius: 20, background: "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(244,114,182,0.12)", fontSize: 13, fontWeight: 500, color: "#6d4c7d", fontFamily: "var(--font-mono)" }}>
          {fmtD(dur)}
          {e2e && <span style={{ marginLeft: 8, color: "#22c55e" }}>🔒</span>}
        </div>
      </div>

      {/* Bottom controls bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 20px", gap: 8, background: "rgba(255,255,255,0.5)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(244,114,182,0.1)", position: "relative", zIndex: 20 }}>
        {/* Left: meeting info */}
        <div style={{ position: "absolute", left: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#b07ab0", fontFamily: "var(--font-mono)" }}>{fmtD(dur)}</span>
          <span style={{ fontSize: 12, color: "rgba(176,122,176,0.4)" }}>|</span>
          <span style={{ fontSize: 12, color: "#b07ab0" }}>{dc || "rp"}</span>
        </div>

        {/* Mic */}
        <button onClick={togMic} title={mic ? "Mute" : "Unmute"}
          style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", background: mic ? "rgba(255,255,255,0.7)" : "#ef4444", color: mic ? "#6d4c7d" : "#fff", boxShadow: mic ? "0 2px 12px rgba(244,114,182,0.1)" : "0 2px 12px rgba(239,68,68,0.3)", border: mic ? "1px solid rgba(244,114,182,0.15)" : "none" }}
          onMouseOver={e => { if (mic) (e.currentTarget).style.background = "rgba(255,255,255,0.9)"; }}
          onMouseOut={e => { if (mic) (e.currentTarget).style.background = "rgba(255,255,255,0.7)"; }}>
          {mic ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6d4c7d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.5-.36 2.18" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>}
        </button>

        {/* Camera */}
        <button onClick={togCam} title={cam ? "Camera off" : "Camera on"}
          style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", background: cam ? "rgba(255,255,255,0.7)" : "#ef4444", color: cam ? "#6d4c7d" : "#fff", boxShadow: cam ? "0 2px 12px rgba(244,114,182,0.1)" : "0 2px 12px rgba(239,68,68,0.3)", border: cam ? "1px solid rgba(244,114,182,0.15)" : "none" }}
          onMouseOver={e => { if (cam) (e.currentTarget).style.background = "rgba(255,255,255,0.9)"; }}
          onMouseOut={e => { if (cam) (e.currentTarget).style.background = "rgba(255,255,255,0.7)"; }}>
          {cam ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6d4c7d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M21 17V7l-7 5 7 5z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>}
        </button>

        {/* Screen share */}
        <button onClick={togScreen} title="Screen share"
          style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", background: sharing ? "linear-gradient(135deg, #60a5fa, #93c5fd)" : "rgba(255,255,255,0.7)", color: sharing ? "#fff" : "#6d4c7d", boxShadow: sharing ? "0 2px 12px rgba(96,165,250,0.3)" : "0 2px 12px rgba(244,114,182,0.1)", border: sharing ? "none" : "1px solid rgba(244,114,182,0.15)" }}
          onMouseOver={e => { if (!sharing) (e.currentTarget).style.background = "rgba(255,255,255,0.9)"; }}
          onMouseOut={e => { if (!sharing) (e.currentTarget).style.background = "rgba(255,255,255,0.7)"; }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        </button>

        {/* End call */}
        <button onClick={cleanup} title="Leave call"
          style={{ width: 56, height: 48, borderRadius: 24, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#ef4444", color: "#fff", transition: "all 0.15s", marginLeft: 4, boxShadow: "0 4px 16px rgba(239,68,68,0.3)" }}
          onMouseOver={e => (e.currentTarget).style.background = "#dc2626"}
          onMouseOut={e => (e.currentTarget).style.background = "#ef4444"}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="23" y1="1" x2="1" y2="23" /></svg>
        </button>

        {/* Right side: chat toggle */}
        <div style={{ position: "absolute", right: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => chat ? setChat(false) : openChat()} title="Chat"
            style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: chat ? "rgba(236,72,153,0.12)" : "rgba(255,255,255,0.7)", color: chat ? "#ec4899" : "#6d4c7d", transition: "all 0.15s", position: "relative", boxShadow: "0 2px 12px rgba(244,114,182,0.1)", border: "1px solid rgba(244,114,182,0.15)" }}
            onMouseOver={e => { if (!chat) (e.currentTarget).style.background = "rgba(255,255,255,0.9)"; }}
            onMouseOut={e => { if (!chat) (e.currentTarget).style.background = "rgba(255,255,255,0.7)"; }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            {unread > 0 && <div style={{ position: "absolute", top: -2, right: -2, width: 20, height: 20, borderRadius: "50%", background: "#ec4899", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", animation: "scale-up 0.3s ease-out" }}>{unread}</div>}
          </button>
        </div>
      </div>

      {/* Chat panel — slides from right */}
      {chat && (
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 68, width: "min(380px, 100vw)", background: "rgba(255,255,255,0.75)", backdropFilter: "blur(24px)", borderLeft: "1px solid rgba(244,114,182,0.12)", display: "flex", flexDirection: "column", zIndex: 40, animation: "fade-up 0.25s ease-out", borderRadius: "0 0 0 16px" }}>
          {/* Chat header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid rgba(244,114,182,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: "#6d4c7d" }}>In-call messages</span>
              {e2e && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>E2E</span>}
            </div>
            <button onClick={() => setChat(false)} style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: "transparent", color: "#b07ab0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, transition: "background 0.15s" }}
              onMouseOver={e => (e.currentTarget).style.background = "rgba(244,114,182,0.08)"}
              onMouseOut={e => (e.currentTarget).style.background = "transparent"}>✕</button>
          </div>

          {/* Chat notice */}
          <div style={{ padding: "12px 20px", fontSize: 12, color: "#b07ab0", borderBottom: "1px solid rgba(244,114,182,0.06)" }}>
            Messages are only visible to people in the call and are deleted when the call ends.
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: "center", marginTop: 40, color: "#c4a0c4", fontSize: 13 }}>No messages yet</div>
            )}
            {msgs.map(m => (
              <div key={m.id} style={{ marginBottom: 16, animation: "msg-in 0.25s ease-out" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: m.from === "You" ? "#ec4899" : "#6d4c7d" }}>{m.from === "You" ? "You" : peer2 || "Them"}</span>
                  <span style={{ fontSize: 11, color: "#c4a0c4" }}>{m.time}</span>
                </div>
                <p style={{ fontSize: 14, color: "#4a2040", margin: 0, lineHeight: 1.5 }}>{m.text}</p>
              </div>
            ))}
            {typing && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 0", animation: "fade-up 0.2s ease-out" }}>
                <span style={{ fontSize: 12, color: "#b07ab0" }}>{peer2 || "Them"} is typing</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#d8b4fe", animation: `typing-bounce 1.2s ease-in-out infinite ${i * 0.15}s` }} />)}
                </div>
              </div>
            )}
            <div ref={ce} />
          </div>

          {/* Chat input */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(244,114,182,0.1)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="text" value={draft} onChange={e => { setDraft(e.target.value); sendTyp(); }}
                onKeyDown={e => e.key === "Enter" && sendMsg()}
                placeholder="Send a message" maxLength={500}
                style={{ flex: 1, padding: "12px 16px", borderRadius: 24, border: "1px solid rgba(244,114,182,0.15)", background: "rgba(255,255,255,0.6)", color: "#4a2040", fontSize: 14, transition: "border-color 0.2s" }}
                onFocus={e => e.target.style.borderColor = "rgba(236,72,153,0.4)"}
                onBlur={e => e.target.style.borderColor = "rgba(244,114,182,0.15)"} />
              <button onClick={sendMsg} disabled={!draft.trim()}
                style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: draft.trim() ? "linear-gradient(135deg, #ec4899, #a78bfa)" : "rgba(244,114,182,0.1)", color: draft.trim() ? "#fff" : "#d8b4fe", cursor: draft.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
