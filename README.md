# rp — Secure Video Calls

Encrypted peer-to-peer video calling with live chat. No sign-up, no servers, no Firebase. Just share a code and start talking.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![PeerJS](https://img.shields.io/badge/PeerJS-WebRTC-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8)
![Encrypted](https://img.shields.io/badge/E2E-Encrypted-green)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black)

## Features

- **Video & Audio Calls** — Real-time peer-to-peer via WebRTC (PeerJS) with HD video support
- **End-to-End Encrypted Chat** — AES-256-GCM encrypted messages via WebRTC data channels
- **Auto-clearing Chat** — All messages are deleted when the call ends
- **No Backend Required** — Runs entirely client-side, signaling via PeerJS cloud
- **Mic & Camera Controls** — Toggle audio/video during calls
- **Call Timer** — See how long you've been on the call
- **Room Codes** — 6-character codes to connect with anyone
- **Glassmorphism UI** — Beautiful baby pink, light blue, and lily pastel theme
- **Toggle Chat Sidebar** — Show/hide chat panel during calls
- **Multiple STUN Servers** — Better NAT traversal with Google STUN servers
- **One-click Deploy** — Works on Vercel out of the box

## How It Works

1. **Create a Room** — Enter your name and click "Create Room" to get a 6-character room code
2. **Share the Code** — Send the room code to the person you want to call
3. **Join** — They enter the code and click "Join"
4. **Call + Chat** — Video call starts with an encrypted chat sidebar on the left
5. **Hang Up** — Click the red button to end. Chat history is automatically deleted

No accounts. No data stored. Everything is peer-to-peer and encrypted.

## Encryption

- **Media streams** are encrypted via SRTP (built into WebRTC)
- **Data channels** are encrypted via DTLS (built into WebRTC)
- **Chat messages** have an additional layer of AES-256-GCM encryption using the Web Crypto API
- Encryption keys are generated per-session and exchanged over the DTLS-encrypted data channel
- Keys are destroyed when the call ends — no key material is ever stored

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| UI | [React 19](https://react.dev/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| Video/Audio | [WebRTC](https://webrtc.org/) via [PeerJS](https://peerjs.com/) |
| Chat | WebRTC Data Channels + AES-256-GCM |
| Encryption | Web Crypto API (AES-GCM) |
| Fonts | [Geist](https://vercel.com/font) (Sans + Mono) |
| Hosting | [Vercel](https://vercel.com/) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Install & Run

```bash
# Clone the repo
git clone https://github.com/RISHI-1575/rp.git
cd rp

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Deploy to Vercel

### Option 1: One-click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/RISHI-1575/rp)

### Option 2: CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Option 3: Git Integration

1. Push to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the `rp` repository
4. Click Deploy — done

No environment variables needed. No server configuration required.

## Project Structure

```
rp/
├── src/
│   └── app/
│       ├── layout.tsx      # Root layout with fonts & metadata
│       ├── page.tsx         # Main app (lobby + video call + chat + encryption)
│       ├── globals.css      # Tailwind + glassmorphism + pastel theme
│       └── favicon.ico
├── public/                  # Static assets
├── package.json
├── next.config.ts
├── tsconfig.json
└── README.md
```

## How the Connection Works

```
User A (Creator)                    User B (Joiner)
─────────────────                   ─────────────────
Creates PeerJS peer                 Creates PeerJS peer
with room code ID                    with random ID
        │                                    │
        │         PeerJS Cloud Server        │
        │         (signaling only)           │
        ├────────────────────────────────────┤
        │                                    │
        │  1. Data channel opens (DTLS)      │
        │  2. AES-256 key exchanged          │
        │  3. Video/audio stream (SRTP)      │
        │◄──────────────────────────────────►│
        │     Fully encrypted P2P            │
```

- **Signaling**: PeerJS cloud server (free) handles initial connection setup only
- **Media**: Direct peer-to-peer, encrypted via SRTP
- **Chat**: Direct peer-to-peer, encrypted via DTLS + AES-256-GCM
- **Privacy**: No recordings, no storage, no tracking, no key persistence

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome | Full |
| Firefox | Full |
| Safari | Full |
| Edge | Full |
| Mobile Chrome | Full |
| Mobile Safari | Full |

> Requires camera and microphone permissions. Requires HTTPS for WebRTC (Vercel provides this automatically).

## Limitations

- **2 participants max** — This is a 1-on-1 calling app
- **NAT traversal** — Some restrictive networks may block P2P connections (multiple STUN servers help)
- **No persistence** — Chat is lost when the call ends (by design)
- **No recording** — Calls are not recorded anywhere

## License

MIT
