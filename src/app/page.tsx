"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Peer, { MediaConnection, DataConnection } from "peerjs";

type ChatMessage = {
  from: string;
  text: string;
  time: string;
};

type AppState = "lobby" | "connecting" | "in-call";

function generateRoomId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function timeStamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

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

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const dataRef = useRef<DataConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setMessages([]);
    setRemoteName("");
    setRoomId("");
    setJoinId("");
    setCopied(false);
    setCallDuration(0);
    setState("lobby");
  }, []);

  const setupDataConnection = useCallback((conn: DataConnection) => {
    dataRef.current = conn;
    conn.on("data", (data) => {
      const parsed = data as { type: string; name?: string; text?: string };
      if (parsed.type === "name" && parsed.name) {
        setRemoteName(parsed.name);
      } else if (parsed.type === "chat" && parsed.text) {
        const text = parsed.text;
        const from = parsed.name || "Them";
        setMessages((prev) => [...prev, { from, text, time: timeStamp() }]);
      }
    });
    conn.on("open", () => {
      conn.send({ type: "name", name });
    });
    conn.on("close", cleanup);
  }, [name, cleanup]);

  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
    if (!name.trim()) { setError("Enter your name first"); return; }
    setError("");
    setState("connecting");
    const id = generateRoomId();
    setRoomId(id);

    const stream = await getMedia();
    if (!stream) return;

    const peer = new Peer(id);
    peerRef.current = peer;

    peer.on("open", () => {
      setState("connecting");
    });

    peer.on("call", (call) => {
      call.answer(stream);
      callRef.current = call;
      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setState("in-call");
      });
      call.on("close", cleanup);
    });

    peer.on("connection", (conn) => {
      setupDataConnection(conn);
    });

    peer.on("error", (err) => {
      setError(`Connection error: ${err.message}`);
      cleanup();
    });
  };

  const joinRoom = async () => {
    if (!name.trim()) { setError("Enter your name first"); return; }
    if (!joinId.trim()) { setError("Enter a room code to join"); return; }
    setError("");
    setState("connecting");

    const stream = await getMedia();
    if (!stream) return;

    const myId = generateRoomId() + "-j";
    const peer = new Peer(myId);
    peerRef.current = peer;

    peer.on("open", () => {
      const call = peer.call(joinId.trim().toLowerCase(), stream);
      callRef.current = call;

      call.on("stream", (remoteStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        setState("in-call");
      });
      call.on("close", cleanup);

      const conn = peer.connect(joinId.trim().toLowerCase());
      setupDataConnection(conn);
    });

    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        setError("Room not found. Check the code and try again.");
      } else {
        setError(`Connection error: ${err.message}`);
      }
      cleanup();
    });
  };

  const sendMessage = () => {
    if (!draft.trim() || !dataRef.current) return;
    dataRef.current.send({ type: "chat", name, text: draft.trim() });
    setMessages((prev) => [...prev, { from: "You", text: draft.trim(), time: timeStamp() }]);
    setDraft("");
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMicOn(track.enabled); }
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setCamOn(track.enabled); }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── LOBBY ──
  if (state === "lobby" || state === "connecting") {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">rp</h1>
            <p className="text-muted text-sm">Instant peer-to-peer video calls with live chat</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Name input */}
          <div>
            <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-white placeholder-muted/50 focus:border-accent transition"
              maxLength={30}
            />
          </div>

          {/* Create Room */}
          {state === "lobby" && (
            <>
              <button
                onClick={createRoom}
                className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-3 px-6 rounded-xl transition-all active:scale-[0.98]"
              >
                Create Room
              </button>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-muted text-xs uppercase tracking-wider">or join</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="flex gap-3">
                <input
                  type="text"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toLowerCase())}
                  placeholder="Enter room code"
                  className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-white placeholder-muted/50 focus:border-accent transition font-mono tracking-wider"
                  maxLength={10}
                  onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                />
                <button
                  onClick={joinRoom}
                  className="bg-surface-2 hover:bg-border text-white font-medium py-3 px-6 rounded-xl transition-all active:scale-[0.98]"
                >
                  Join
                </button>
              </div>
            </>
          )}

          {/* Waiting for peer */}
          {state === "connecting" && roomId && (
            <div className="bg-surface border border-border rounded-xl p-6 space-y-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm text-muted">Waiting for someone to join...</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-2xl tracking-[0.3em] text-white">{roomId}</span>
                <button
                  onClick={copyCode}
                  className="text-accent hover:text-accent-hover text-sm underline underline-offset-2 transition"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted">Share this code with someone to start a call</p>
              <button onClick={cleanup} className="text-sm text-muted hover:text-white transition">
                Cancel
              </button>
            </div>
          )}

          {state === "connecting" && !roomId && (
            <div className="text-center space-y-3">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted">Connecting...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── IN-CALL ──
  return (
    <div className="flex flex-1 h-screen overflow-hidden">
      {/* Chat sidebar */}
      <div className="w-80 min-w-80 bg-surface border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-sm font-medium">Chat</span>
          </div>
          <span className="text-xs text-muted">clears on hang up</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-muted text-xs text-center mt-8">
              Messages will appear here
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.from === "You" ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                  msg.from === "You"
                    ? "bg-accent text-white rounded-br-md"
                    : "bg-surface-2 text-white rounded-bl-md"
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-muted mt-1 px-1">
                {msg.from === "You" ? "You" : remoteName || "Them"} · {msg.time}
              </span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 bg-surface-2 border border-border rounded-xl px-3 py-2 text-sm text-white placeholder-muted/50 focus:border-accent transition"
              maxLength={500}
            />
            <button
              onClick={sendMessage}
              disabled={!draft.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:hover:bg-accent text-white px-3 py-2 rounded-xl transition"
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
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm font-medium">
              {remoteName ? `Call with ${remoteName}` : "Connected"}
            </span>
          </div>
          <span className="text-sm font-mono text-muted">{formatDuration(callDuration)}</span>
        </div>

        {/* Videos */}
        <div className="flex-1 flex items-center justify-center p-6 gap-4 relative">
          {/* Remote video (large) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full max-h-[calc(100vh-160px)] object-cover rounded-2xl bg-surface"
          />
          {/* Local video (picture-in-picture) */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-8 right-8 w-48 h-36 object-cover rounded-xl border-2 border-border shadow-2xl"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 py-4 border-t border-border">
          <button
            onClick={toggleMic}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
              micOn ? "bg-surface-2 hover:bg-border text-white" : "bg-red-500/20 text-red-400"
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
            className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
              camOn ? "bg-surface-2 hover:bg-border text-white" : "bg-red-500/20 text-red-400"
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
                <path d="M16.16 3.84a2 2 0 0 1 .84 1.63v12a2 2 0 0 1-3.38 1.47L9.8 15.12" />
                <path d="M1 1l22 22" />
                <path d="M7.5 7.5C6 9 5.5 11 6 13l-2.5 2.5A2 2 0 0 1 1 14V6a2 2 0 0 1 2-2h10" />
              </svg>
            )}
          </button>

          <button
            onClick={cleanup}
            className="w-14 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition active:scale-95"
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
