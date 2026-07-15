# COCOMITalk

**A voice-first PWA where three AI personas — on Claude, GPT, and Gemini — talk with you, and hold meetings with each other.** Built and deployed entirely from an Android phone (Termux + Claude Code + GitHub Pages), by a non-engineer, as part of the [COCOMIOS](https://github.com/akiyamanx/COCOMIOS) AI-family project. Vanilla JavaScript, no build step, no framework.

## What it does

- 🗣 **Voice in / voice out** — speech recognition (Web Speech / Whisper) and TTS (Web Speech / OpenAI / VOICEVOX), with provider fallback and audio-health monitoring
- 👭 **Three-sisters meeting mode** — the three AI personas discuss a topic in relay rounds, with a router, per-persona prompts, and meeting minutes generation
- 🧠 **Meeting memory (RAG)** — past decisions are stored in a vector DB (Cloudflare Vectorize) and injected back into future meetings
- 📄 **Doc generator** — turns a meeting into a structured document
- 📊 **Token monitor** — built-in usage tracking, because API safety is a first-class feature
- 📱 **PWA** — installable, offline-capable shell, phone-first UI

## Architecture (short version)

Static PWA (GitHub Pages) → Cloudflare Worker relay (holds the API keys as secrets; the frontend never sees them) → Claude / OpenAI / Gemini APIs, plus Vectorize for meeting memory. All development happens on a phone; every change ships through git.

## Language note

The app UI and most code comments are in Japanese — this is a system that runs in Japanese daily. The architecture, module layout (one file per concern, ~500-line cap per file), and safety patterns are readable from the file names and structure.

## License

MIT — see [LICENSE](./LICENSE).

---

*Part of the COCOMI family: an experiment in giving AI a persistent persona, inheritable judgment, and a safe pair of hands — from a phone.* 🌸
