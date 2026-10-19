# 🎙️ MeetFlow AI — Live Meeting Recorder, Offline Whisper & Burmese (မြန်မာ) ASR + Personal Auto-PM

**MeetFlow AI** is a self-hosted personal meeting assistant and zero-burden Project Management workspace designed for **Google Cloud Run (GCP)**.

It captures **both your Microphone and Browser Tab / System Audio** (Google Meet, Microsoft Teams, Zoom) simultaneously, transcribes speech in **English (Offline Whisper)** and **Burmese (`မြန်မာဘာသာ` Hybrid ASR)**, generates **Meeting Minutes & Full Documents**, syncs with **Google Calendar & Microsoft Teams Calendar**, and **automatically populates your Personal Kanban Board** so you never have to manually enter project management data again.

---

## ✨ Key Features

1. **Dual-Stream Live Audio Capture + Floating Companion (`PiP`)**
   - Uses Web Audio API (`getDisplayMedia` + `getUserMedia`) to mix remote meeting participants (Google Meet / MS Teams tab or system audio) with your own microphone.
   - Includes a **🪟 Floating Companion Mode** (Document Picture-in-Picture) that stays on top while you are in your call.

2. **Dual-Language Speech Recognition (Offline English Whisper + Burmese `မြန်မာဘာသာ`)**
   - **English (`whisper_en`)**: Runs **Offline Whisper (`Xenova/whisper-tiny.en`)** directly inside your browser via WebAssembly/WebGPU (`whisper-worker.js`) alongside instant Web Speech streaming.
   - **Burmese (`burmese_hybrid` — `my-MM`)**: Combines live `my-MM` Myanmar Unicode speech streaming with **Gemini 2.5 Flash Multimodal Audio ASR** (`/api/ai/transcribe-burmese`) for industry-leading accuracy on Burmese and mixed Burmese-English business conversations.
   - **1-Click Live Language Toggle**: Switch between `🇬🇧 EN` and `🇲🇲 မြန်မာ` anytime mid-meeting.

3. **Claude Pro Subscription Bridge + Direct API Summarizer**
   - **🟣 Claude Pro Web Bridge ($0 API Cost)**: Click *"Use My Claude Pro Subscription"* to copy a structured prompt, paste it into your `claude.ai` Pro chat, and paste the JSON response back to auto-populate minutes and Kanban tasks.
   - **Direct API Mode**: Also supports Anthropic Claude API (`claude-3-7-sonnet`), Google Gemini 2.5 API, and a **100% Offline Smart Bilingual NLP Engine**.

4. **Zero-Burden Personal Auto-PM Tool**
   - Every time you summarize a meeting, extracted **Action Items** are automatically created as tasks on your **Kanban Board** (`To Do`, `In Progress`, `Blocked`, `Done`) with priority, due date, project tag, and a backlink to the exact meeting & timestamp.

5. **Document Generator Studio**
   - Generate and export:
     - **Formal Minutes of Meeting (MOM)**
     - **Bilingual English + Burmese (`မြန်မာ`) Executive Report**
     - **Product Requirements & Technical Specification (PRD)**
     - **Stakeholder Follow-up Email & Action Tracker**
     - **Agile Sprint Backlog & User Stories**
   - Export as **Word (`.doc`)**, **Markdown (`.md`)**, **Printable PDF**, or 1-click clipboard copy.

6. **Google Calendar & Microsoft Teams Calendar Integration**
   - Full **OAuth 2.0** flows for Google Calendar API v3 and Microsoft Graph API (Teams / Outlook), plus **Zero-Setup Private ICS Feed URL sync**.

---

## 🚀 Quick Start (Local)

```bash
npm install
npm start
```

Then open **http://localhost:8080** in Chrome or Edge.

---

## ☁️ Deploying to GCP Cloud Run

### Option 1: One-Command PowerShell Deploy
```powershell
.\deploy-gcp.ps1 -ProjectId "your-gcp-project-id" -Region "asia-southeast1"
```

### Option 2: Automated GitHub CI/CD via Cloud Build
This repository includes a ready-to-use `Dockerfile` and `cloudbuild.yaml`. Connect your GitHub repository (`EthannMK/meetflow-ai`) to **Google Cloud Build** and every push to `main` will automatically build and deploy to Cloud Run.
