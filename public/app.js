/**
 * MeetFlow AI — Client Application
 * - Dual-Stream Audio Mixer (Tab/System Audio + Mic via Web Audio API)
 * - Offline Whisper Flow (In-Browser Web Worker via Transformers.js)
 * - Burmese (မြန်မာဘာသာ my-MM) + English Hybrid ASR
 * - Claude Pro Subscription Bridge + Direct AI Summarizer
 * - Personal Zero-Burden Auto-PM Kanban & Task Tracker
 * - Document Generator (Word .doc, Markdown .md, PDF Print)
 * - Google Calendar & Microsoft Teams OAuth + ICS Sync
 */

const state = {
  projects: [],
  meetings: [],
  tasks: [],
  calendarEvents: [],
  settings: {},
  selectedProjectFilter: 'all',
  activeMeetingId: null,
  selectedArchiveMeetingId: null,
  recording: {
    active: false,
    startTime: 0,
    elapsedSeconds: 0,
    timerInterval: null,
    audioCtx: null,
    micStream: null,
    tabStream: null,
    animFrame: null,
    speechRec: null,
    mediaRecorder: null,
    pcmBuffer: [],
    pcmInterval: null,
    currentLang: 'en-US' // 'en-US' | 'my-MM'
  },
  whisperWorker: null,
  whisperReady: false,
  pipWindow: null
};

// Toast helper
function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function formatDuration(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// Fetch initial state from backend
async function loadAppState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    state.projects = data.projects || [];
    state.meetings = data.meetings || [];
    state.tasks = data.tasks || [];
    state.calendarEvents = data.calendarEvents || [];
    state.settings = data.settings || {};

    if (!state.activeMeetingId && state.meetings.length > 0) {
      state.activeMeetingId = state.meetings[0].id;
    }
    if (!state.selectedArchiveMeetingId && state.meetings.length > 0) {
      state.selectedArchiveMeetingId = state.meetings[0].id;
    }

    renderAll();
  } catch (err) {
    console.error('Failed to load state:', err);
    showToast('Error connecting to server');
  }
}

function renderAll() {
  renderProjectSelectors();
  renderLiveRecorderMeeting();
  renderKanbanAndTasks();
  renderMeetingsArchive();
  renderDocStudioSelectors();
  renderCalendarView();
  renderSettingsView();
  updateBadges();
}

function updateBadges() {
  const openTasks = state.tasks.filter(t => t.status !== 'done').length;
  document.getElementById('navTasksCount').textContent = openTasks;
  document.getElementById('navMeetingsCount').textContent = state.meetings.length;
}

function renderProjectSelectors() {
  const globalSel = document.getElementById('globalProjectFilter');
  const recSel = document.getElementById('recProjectSelect');

  globalSel.innerHTML = `<option value="all">All Projects (${state.projects.length})</option>` +
    state.projects.map(p => `<option value="${p.id}" ${state.selectedProjectFilter === p.id ? 'selected' : ''}>${p.name}</option>`).join('');

  const activeMeeting = getActiveMeeting();
  recSel.innerHTML = state.projects.map(p =>
    `<option value="${p.id}" ${activeMeeting?.projectId === p.id ? 'selected' : ''}>📁 ${p.name}</option>`
  ).join('');
}

function getActiveMeeting() {
  return state.meetings.find(m => m.id === state.activeMeetingId) || state.meetings[0] || null;
}

// ==========================================
// 1. LIVE RECORDER STUDIO & AUDIO CAPTURE
// ==========================================

function renderLiveRecorderMeeting() {
  const m = getActiveMeeting();
  if (!m) return;

  document.getElementById('recMeetingTitle').value = m.title || '';
  document.getElementById('recLiveNotes').value = m.notes || '';
  document.getElementById('recProjectSelect').value = m.projectId || (state.projects[0]?.id || '');

  const feed = document.getElementById('liveTranscriptList');
  const segments = m.transcript || [];
  if (segments.length === 0) {
    feed.innerHTML = `<div class="text-muted text-xs" style="padding:18px;text-align:center;">
      No transcript lines yet. Click <strong>"🔴 Capture Meeting Audio + Mic"</strong> above (or <strong>"+ Test EN/မြန်မာ Segment"</strong>) to start!
    </div>`;
  } else {
    feed.innerHTML = segments.map(seg => {
      const isMy = /[\u1000-\u109F]/.test(seg.text) || seg.lang === 'my';
      return `
        <div class="utterance-item ${isMy ? 'lang-my' : ''}">
          <div class="utterance-meta">
            <span class="utterance-speaker">${escapeHtml(seg.speaker || 'Speaker')}</span>
            <span>${escapeHtml(seg.timestamp || '00:00')} · ${isMy ? '🇲🇲 မြန်မာ' : '🇬🇧 EN'}</span>
          </div>
          <div>${escapeHtml(seg.text)}</div>
        </div>
      `;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
  }

  renderLiveSummaryBox(m);
  updatePipWindowTranscript(m);
}

function renderLiveSummaryBox(m) {
  const box = document.getElementById('liveSummaryPreview');
  if (!m || !m.summary) {
    box.innerHTML = `<div class="text-muted text-xs">Click <strong>"⚡ Summarize & Auto-Add Tasks"</strong> to generate executive minutes and push action items to your PM Kanban board.</div>`;
    return;
  }
  const s = m.summary;
  const linkedTasks = state.tasks.filter(t => t.meetingId === m.id);
  box.innerHTML = `
    <div class="summary-sec-title">Executive Summary</div>
    <div>${escapeHtml(s.executiveSummary || '')}</div>

    <div class="summary-sec-title">Key Decisions (${(s.keyDecisions || []).length})</div>
    <ul style="padding-left:16px;">
      ${(s.keyDecisions || []).map(d => `<li>${escapeHtml(d)}</li>`).join('')}
    </ul>

    <div class="summary-sec-title">Auto-Extracted PM Tasks (${linkedTasks.length})</div>
    <ul style="padding-left:16px;">
      ${linkedTasks.map(t => `<li><strong>[${t.priority.toUpperCase()}]</strong> ${escapeHtml(t.title)} <em>(${t.status})</em></li>`).join('')}
    </ul>
  `;
}

// Initialize Offline Whisper Web Worker
function initWhisperWorker(preloadNow = false) {
  if (!state.whisperWorker) {
    state.whisperWorker = new Worker('/whisper-worker.js', { type: 'module' });
    state.whisperWorker.addEventListener('message', (e) => {
      const data = e.data;
      const badge = document.getElementById('whisperStatusText');
      if (data.status === 'loading') {
        badge.textContent = data.message || 'Loading Offline Whisper...';
      } else if (data.status === 'progress') {
        badge.textContent = `Whisper Download: ${data.progress}%`;
      } else if (data.status === 'ready') {
        state.whisperReady = true;
        badge.textContent = `Offline Whisper Ready (${data.model.split('/')[1]})`;
        showToast('Offline Whisper model loaded in browser!');
      } else if (data.status === 'complete') {
        const clean = (data.text || '')
          .replace(/\[BLANK_AUDIO\]/gi, '')
          .replace(/\(.*\)/g, '')
          .trim();
        if (clean && clean.length > 2) {
          appendTranscriptSegment(data.speaker || 'Meeting Audio (Whisper)', clean, 'en');
        }
      } else if (data.status === 'error') {
        console.warn('Whisper Worker warning:', data.error);
        badge.textContent = 'WebSpeech + Burmese Hybrid Active';
      }
    });
  }
  if (preloadNow) {
    state.whisperWorker.postMessage({ type: 'load', model: 'Xenova/whisper-tiny.en' });
  }
}

// Start Live Recording (Tab + Mic OR Mic Only)
async function startLiveRecording(includeTabAudio = true) {
  try {
    // Ensure we have an active meeting record
    let currentMeeting = getActiveMeeting();
    const titleVal = document.getElementById('recMeetingTitle').value.trim() || 'Live Meeting Session';
    const projVal = document.getElementById('recProjectSelect').value;
    const platVal = document.getElementById('recPlatformSelect').value;

    if (!currentMeeting || currentMeeting.id === 'meet-sample-1') {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleVal,
          projectId: projVal,
          platform: platVal,
          participants: ['Ethan (You)', 'Meeting Participants']
        })
      });
      currentMeeting = await res.json();
      state.meetings.unshift(currentMeeting);
      state.activeMeetingId = currentMeeting.id;
      renderAll();
    }

    // 1. Capture Microphone
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    state.recording.micStream = micStream;

    // 2. Capture Tab / System Audio if requested (for Google Meet / MS Teams remote participants)
    let tabStream = null;
    if (includeTabAudio && navigator.mediaDevices.getDisplayMedia) {
      try {
        tabStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            suppressLocalAudioPlayback: false
          },
          systemAudio: 'include'
        });
        state.recording.tabStream = tabStream;
        const audioTracks = tabStream.getAudioTracks();
        if (audioTracks.length === 0) {
          showToast('Note: No tab audio track shared. Check "Also share tab audio" to capture remote voices.');
        } else {
          showToast('Capturing both Meeting Tab Audio + Your Microphone!');
        }
      } catch (tabErr) {
        console.warn('Tab share skipped or cancelled, continuing with Mic:', tabErr);
        showToast('Continuing with Microphone capture.');
      }
    }

    // 3. Mix streams in Web Audio API (16kHz for Offline Whisper compatibility)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate: 16000 });
    state.recording.audioCtx = audioCtx;

    const destNode = audioCtx.createMediaStreamDestination();
    const masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 256;

    // Mic node
    const micSource = audioCtx.createMediaStreamSource(micStream);
    const micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 128;
    micSource.connect(micAnalyser);
    micSource.connect(masterAnalyser);
    micSource.connect(destNode);

    // Tab audio node (if available)
    let tabAnalyser = null;
    if (tabStream && tabStream.getAudioTracks().length > 0) {
      const tabAudioOnly = new MediaStream(tabStream.getAudioTracks());
      const tabSource = audioCtx.createMediaStreamSource(tabAudioOnly);
      tabAnalyser = audioCtx.createAnalyser();
      tabAnalyser.fftSize = 128;
      tabSource.connect(tabAnalyser);
      tabSource.connect(masterAnalyser);
      tabSource.connect(destNode);
    }

    // 4. Collect 16kHz Float32 PCM chunks for Offline Whisper Worker
    const engineMode = document.getElementById('recAsrEngine').value;
    if (engineMode === 'whisper_en') {
      initWhisperWorker(true);
    }

    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    masterAnalyser.connect(processor);
    processor.connect(audioCtx.destination);
    state.recording.pcmBuffer = [];

    processor.onaudioprocess = (e) => {
      if (!state.recording.active) return;
      const input = e.inputBuffer.getChannelData(0);
      state.recording.pcmBuffer.push(new Float32Array(input));
    };

    // Every 8 seconds, if Offline Whisper is ready and there is speech energy, run offline Whisper
    state.recording.pcmInterval = setInterval(() => {
      if (!state.recording.active || state.recording.pcmBuffer.length === 0) return;
      const chunks = state.recording.pcmBuffer.splice(0, state.recording.pcmBuffer.length);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged = new Float32Array(totalLen);
      let offset = 0;
      let sumSq = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
        for (let i = 0; i < c.length; i += 8) {
          sumSq += c[i] * c[i];
        }
      }
      const rms = Math.sqrt(sumSq / (totalLen / 8));
      // Only send to Offline Whisper if RMS energy indicates speech and Whisper worker is ready
      if (rms > 0.012 && state.whisperReady && state.whisperWorker && !state.recording.speechRecActive) {
        state.whisperWorker.postMessage({
          type: 'transcribe',
          audio: merged,
          model: 'Xenova/whisper-tiny.en',
          speaker: tabAnalyser ? 'Meeting Mix (Offline Whisper)' : 'Ethan (Offline Whisper)'
        });
      }
    }, 8000);

    // 5. Start Browser Live SpeechRecognition (supports both English 'en-US' and Burmese 'my-MM'!)
    startBrowserLiveSpeechRecognition();

    // 6. If Burmese Hybrid ASR + Gemini key is present, also record 10s WebM chunks for cloud Burmese refinement
    if (engineMode === 'burmese_hybrid' && state.settings.hasGeminiKey) {
      startBurmeseChunkRecorder(destNode.stream);
    }

    // 7. Start Visualizer & Timer
    state.recording.active = true;
    state.recording.startTime = Date.now() - (state.recording.elapsedSeconds * 1000);
    document.getElementById('navRecBadge').classList.remove('hidden');
    document.getElementById('btnStopRecording').classList.remove('hidden');
    document.getElementById('btnStartShareAndRecord').classList.add('hidden');
    document.getElementById('btnStartMicOnly').classList.add('hidden');

    state.recording.timerInterval = setInterval(() => {
      state.recording.elapsedSeconds = Math.floor((Date.now() - state.recording.startTime) / 1000);
      document.getElementById('recTimer').textContent = formatDuration(state.recording.elapsedSeconds);
    }, 1000);

    drawAudioVisualizer(masterAnalyser, micAnalyser, tabAnalyser);
  } catch (err) {
    console.error('Recording error:', err);
    showToast(`Could not start audio capture: ${err.message}`);
  }
}

function startBrowserLiveSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('liveInterimStatus').textContent = 'Offline Whisper PCM capture active';
    return;
  }

  const engineMode = document.getElementById('recAsrEngine').value;
  if (engineMode === 'burmese_hybrid') {
    state.recording.currentLang = 'my-MM';
  }
  updateLangBadgeUI();

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = state.recording.currentLang;

  rec.onstart = () => {
    state.recording.speechRecActive = true;
    document.getElementById('liveInterimStatus').textContent =
      `Listening live (${rec.lang === 'my-MM' ? '🇲🇲 မြန်မာဘာသာ' : '🇬🇧 English'})...`;
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        const langCode = rec.lang.startsWith('my') ? 'my' : 'en';
        const speakerName = document.getElementById('manualSpeakerInput').value.trim() || 'Ethan (You)';
        appendTranscriptSegment(speakerName, transcript.trim(), langCode);
      } else {
        interim += transcript;
      }
    }
    if (interim) {
      document.getElementById('liveInterimStatus').textContent = `💬 ${interim}`;
    }
  };

  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('SpeechRecognition notice:', e.error);
    }
  };

  rec.onend = () => {
    if (state.recording.active) {
      try {
        rec.lang = state.recording.currentLang;
        rec.start();
      } catch (_) {}
    } else {
      state.recording.speechRecActive = false;
    }
  };

  try {
    rec.start();
    state.recording.speechRec = rec;
  } catch (e) {
    console.warn('Could not start SpeechRecognition:', e);
  }
}

function startBurmeseChunkRecorder(mixedStream) {
  try {
    const mr = new MediaRecorder(mixedStream, { mimeType: 'audio/webm' });
    state.recording.mediaRecorder = mr;
    mr.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size < 2000 || !state.recording.active) return;
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result || '').toString().split(',')[1];
        if (!base64) return;
        try {
          const res = await fetch('/api/ai/transcribe-burmese', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: 'audio/webm',
              languageHint: 'my'
            })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.text && data.text.length > 1) {
              appendTranscriptSegment('Burmese Hybrid ASR (မြန်မာ)', data.text, 'my');
            }
          }
        } catch (err) {
          console.warn('Burmese chunk ASR skipped:', err);
        }
      };
      reader.readAsDataURL(ev.data);
    };
    mr.start(10000);
  } catch (e) {
    console.warn('MediaRecorder Burmese chunker not started:', e);
  }
}

function drawAudioVisualizer(masterAnalyser, micAnalyser, tabAnalyser) {
  const canvas = document.getElementById('audioCanvas');
  const ctx = canvas.getContext('2d');
  const bufLen = masterAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufLen);
  const micData = new Uint8Array(micAnalyser.frequencyBinCount);
  const tabData = tabAnalyser ? new Uint8Array(tabAnalyser.frequencyBinCount) : null;

  function renderFrame() {
    if (!state.recording.active) return;
    state.recording.animFrame = requestAnimationFrame(renderFrame);

    masterAnalyser.getByteFrequencyData(dataArray);
    micAnalyser.getByteFrequencyData(micData);
    if (tabAnalyser && tabData) tabAnalyser.getByteFrequencyData(tabData);

    // Update level meters
    const micAvg = micData.reduce((a, b) => a + b, 0) / micData.length;
    document.getElementById('micLevelFill').style.width = `${Math.min(100, micAvg * 1.4)}%`;

    if (tabData) {
      const tabAvg = tabData.reduce((a, b) => a + b, 0) / tabData.length;
      document.getElementById('tabLevelFill').style.width = `${Math.min(100, tabAvg * 1.4)}%`;
    }

    // Draw spectrum bars
    ctx.fillStyle = '#080c16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufLen) * 2.2;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = i % 2 === 0 ? '#6366f1' : '#10b981';
      ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 2;
    }
  }
  renderFrame();
}

async function stopLiveRecording() {
  state.recording.active = false;
  clearInterval(state.recording.timerInterval);
  clearInterval(state.recording.pcmInterval);
  cancelAnimationFrame(state.recording.animFrame);

  if (state.recording.speechRec) {
    try { state.recording.speechRec.stop(); } catch (_) {}
    state.recording.speechRec = null;
  }
  if (state.recording.mediaRecorder && state.recording.mediaRecorder.state !== 'inactive') {
    try { state.recording.mediaRecorder.stop(); } catch (_) {}
  }
  if (state.recording.micStream) {
    state.recording.micStream.getTracks().forEach(t => t.stop());
  }
  if (state.recording.tabStream) {
    state.recording.tabStream.getTracks().forEach(t => t.stop());
  }
  if (state.recording.audioCtx) {
    try { await state.recording.audioCtx.close(); } catch (_) {}
  }

  document.getElementById('navRecBadge').classList.add('hidden');
  document.getElementById('btnStopRecording').classList.add('hidden');
  document.getElementById('btnStartShareAndRecord').classList.remove('hidden');
  document.getElementById('btnStartMicOnly').classList.remove('hidden');
  document.getElementById('liveInterimStatus').textContent = 'Recording stopped — Analyzing minutes & tasks...';

  await saveCurrentMeetingMetadata();
  await triggerAnalyzeCurrentMeeting();
}

async function appendTranscriptSegment(speaker, text, lang = 'en') {
  if (!text) return;
  const m = getActiveMeeting();
  if (!m) return;

  const timestamp = formatDuration(state.recording.elapsedSeconds || 0);
  const res = await fetch(`/api/meetings/${m.id}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      speaker,
      text,
      timestamp,
      lang,
      durationSeconds: state.recording.elapsedSeconds
    })
  });
  if (res.ok) {
    const data = await res.json();
    const idx = state.meetings.findIndex(x => x.id === m.id);
    if (idx !== -1) state.meetings[idx] = data.meeting;
    renderLiveRecorderMeeting();
  }
}

async function saveCurrentMeetingMetadata() {
  const m = getActiveMeeting();
  if (!m) return;
  const title = document.getElementById('recMeetingTitle').value.trim() || m.title;
  const projectId = document.getElementById('recProjectSelect').value || m.projectId;
  const platform = document.getElementById('recPlatformSelect').value || m.platform;
  const notes = document.getElementById('recLiveNotes').value;

  const res = await fetch(`/api/meetings/${m.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      projectId,
      platform,
      notes,
      durationSeconds: state.recording.elapsedSeconds || m.durationSeconds
    })
  });
  if (res.ok) {
    const updated = await res.json();
    const idx = state.meetings.findIndex(x => x.id === m.id);
    if (idx !== -1) state.meetings[idx] = updated;
  }
}

async function triggerAnalyzeCurrentMeeting() {
  const m = getActiveMeeting();
  if (!m) return;
  await saveCurrentMeetingMetadata();
  showToast('Analyzing meeting & extracting tasks for your PM board...');

  const res = await fetch(`/api/meetings/${m.id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoAddTasks: true })
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(`Analysis error: ${data.error}`);
    return;
  }

  const idx = state.meetings.findIndex(x => x.id === m.id);
  if (idx !== -1) state.meetings[idx] = data.meeting;
  if (Array.isArray(data.createdTasks) && data.createdTasks.length > 0) {
    state.tasks = [...data.createdTasks, ...state.tasks];
  }

  renderAll();
  showToast(`Done via ${data.providerUsed}! Added ${data.createdTasks?.length || 0} tasks to your PM Board.`);
}

function updateLangBadgeUI() {
  const badge = document.getElementById('currentLiveLangBadge');
  if (state.recording.currentLang === 'my-MM') {
    badge.textContent = '🇲🇲 မြန်မာ (Burmese)';
  } else {
    badge.textContent = '🇬🇧 EN (English)';
  }
}

// ==========================================
// 2. FLOATING PICTURE-IN-PICTURE COMPANION
// ==========================================

async function openFloatingCompanionWindow() {
  if (!('documentPictureInPicture' in window)) {
    window.open(window.location.href, 'MeetFlowCompanion', 'width=420,height=620,menubar=no,toolbar=no');
    return;
  }
  try {
    const pipWin = await window.documentPictureInPicture.requestWindow({
      width: 390,
      height: 480
    });
    state.pipWindow = pipWin;
    pipWin.document.head.innerHTML = `
      <style>
        body { font-family: 'Inter', 'Noto Sans Myanmar', sans-serif; background:#0b0f19; color:#f1f5f9; margin:0; padding:12px; display:flex; flex-direction:column; height:94vh; }
        .head { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #26334d; padding-bottom:8px; margin-bottom:8px; }
        .btn { background:#6366f1; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; }
        .feed { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px; font-size:12.5px; }
        .line { background:#161f33; padding:6px 8px; border-left:3px solid #6366f1; border-radius:4px; }
      </style>
    `;
    pipWin.document.body.innerHTML = `
      <div class="head">
        <strong>🎙️ MeetFlow Live Companion</strong>
        <button id="pipLangBtn" class="btn">Switch EN / မြန်မာ</button>
      </div>
      <div id="pipFeed" class="feed"></div>
    `;
    pipWin.document.getElementById('pipLangBtn').addEventListener('click', () => {
      document.getElementById('btnToggleLangQuick').click();
    });
    updatePipWindowTranscript(getActiveMeeting());
  } catch (err) {
    console.warn('PiP error:', err);
  }
}

function updatePipWindowTranscript(m) {
  if (!state.pipWindow || state.pipWindow.closed || !m) return;
  const feed = state.pipWindow.document.getElementById('pipFeed');
  if (!feed) return;
  feed.innerHTML = (m.transcript || []).slice(-10).map(s =>
    `<div class="line"><strong>${escapeHtml(s.speaker)}:</strong> ${escapeHtml(s.text)}</div>`
  ).join('');
  feed.scrollTop = feed.scrollHeight;
}

// ==========================================
// 3. PERSONAL AUTO-PM TOOL (KANBAN & TASKS)
// ==========================================

function renderKanbanAndTasks() {
  const filteredTasks = state.selectedProjectFilter === 'all'
    ? state.tasks
    : state.tasks.filter(t => t.projectId === state.selectedProjectFilter);

  const statuses = ['todo', 'in_progress', 'blocked', 'done'];
  for (const st of statuses) {
    const colEl = document.getElementById(`col-${st}`);
    const countEl = document.getElementById(`count-${st}`);
    const items = filteredTasks.filter(t => t.status === st);
    countEl.textContent = items.length;

    colEl.innerHTML = items.map(t => {
      const proj = state.projects.find(p => p.id === t.projectId);
      const srcMeeting = state.meetings.find(m => m.id === t.meetingId);
      return `
        <div class="task-card" draggable="true" data-task-id="${t.id}">
          <div class="task-card-top">
            <span class="prio-badge prio-${t.priority || 'medium'}">${t.priority || 'medium'}</span>
            ${t.autoExtracted ? `<span class="badge badge-accent" title="Auto-extracted from meeting transcript">🤖 Auto-PM</span>` : ''}
          </div>
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-desc">${escapeHtml(t.description || '')}</div>
          <div class="task-footer">
            <span>📁 ${escapeHtml(proj ? proj.name : 'General')}</span>
            <span>📅 ${escapeHtml(t.dueDate || 'No date')}</span>
          </div>
          ${srcMeeting ? `<div class="text-xs text-muted" style="margin-top:5px;">🎙️ From: <em>${escapeHtml(srcMeeting.title)}</em> (${escapeHtml(t.meetingTimestamp || '00:00')})</div>` : ''}
          <div style="display:flex;gap:4px;margin-top:8px;">
            ${st !== 'todo' ? `<button class="btn-ghost btn-xs" onclick="moveTaskStatus('${t.id}','todo')">To Do</button>` : ''}
            ${st !== 'in_progress' ? `<button class="btn-ghost btn-xs" onclick="moveTaskStatus('${t.id}','in_progress')">Start</button>` : ''}
            ${st !== 'done' ? `<button class="btn-ghost btn-xs" onclick="moveTaskStatus('${t.id}','done')">✓ Done</button>` : ''}
            <button class="btn-ghost btn-xs" style="margin-left:auto;color:#fca5a5;" onclick="deleteTask('${t.id}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Bind HTML5 Drag-and-Drop on Kanban Cards
  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', card.dataset.taskId);
    });
  });

  document.querySelectorAll('.kanban-col').forEach(col => {
    col.ondragover = (ev) => ev.preventDefault();
    col.ondrop = async (ev) => {
      ev.preventDefault();
      const taskId = ev.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (taskId && newStatus) {
        await moveTaskStatus(taskId, newStatus);
      }
    };
  });

  // Render Table List View
  const tbody = document.getElementById('pmTableBody');
  tbody.innerHTML = filteredTasks.map(t => {
    const proj = state.projects.find(p => p.id === t.projectId);
    const srcMeeting = state.meetings.find(m => m.id === t.meetingId);
    return `
      <tr>
        <td>
          <select class="input-select compact" onchange="moveTaskStatus('${t.id}', this.value)">
            <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option>
            <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </td>
        <td><strong>${escapeHtml(t.title)}</strong><div class="text-xs text-muted">${escapeHtml(t.description || '')}</div></td>
        <td>${escapeHtml(proj ? proj.name : 'General')}</td>
        <td><span class="prio-badge prio-${t.priority}">${t.priority}</span></td>
        <td>${escapeHtml(t.dueDate || '-')}</td>
        <td>${srcMeeting ? `🎙️ ${escapeHtml(srcMeeting.title)}` : 'Manual'}</td>
        <td><button class="btn-ghost btn-xs" onclick="deleteTask('${t.id}')">Delete</button></td>
      </tr>
    `;
  }).join('');

  // Render Projects Overview
  const projGrid = document.getElementById('pmProjectsView');
  projGrid.innerHTML = state.projects.map(p => {
    const pTasks = state.tasks.filter(t => t.projectId === p.id);
    const doneCount = pTasks.filter(t => t.status === 'done').length;
    const pct = pTasks.length ? Math.round((doneCount / pTasks.length) * 100) : 0;
    const pMeets = state.meetings.filter(m => m.projectId === p.id);
    return `
      <div class="card">
        <div class="card-header">
          <h3 style="color:${p.color || '#a5b4fc'}">📁 ${escapeHtml(p.name)}</h3>
          <span class="badge">${pct}% Done</span>
        </div>
        <p class="text-xs text-muted" style="margin-bottom:10px;">${escapeHtml(p.description || '')}</p>
        <div class="meter-bar" style="margin-bottom:10px;"><div class="meter-fill" style="width:${pct}%"></div></div>
        <div class="text-xs text-muted">
          📋 <strong>${pTasks.length}</strong> Tasks (${doneCount} completed) · 🎙️ <strong>${pMeets.length}</strong> Linked Meetings
        </div>
      </div>
    `;
  }).join('');
}

window.moveTaskStatus = async function(taskId, status) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (res.ok) {
    const updated = await res.json();
    const idx = state.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) state.tasks[idx] = updated;
    renderKanbanAndTasks();
    updateBadges();
  }
};

window.deleteTask = async function(taskId) {
  const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  if (res.ok) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    renderKanbanAndTasks();
    updateBadges();
  }
};

// ==========================================
// 4. MEETINGS ARCHIVE & DOCUMENT STUDIO
// ==========================================

function renderMeetingsArchive() {
  const listEl = document.getElementById('meetingsArchiveList');
  const detailEl = document.getElementById('meetingDetailPane');

  listEl.innerHTML = state.meetings.map(m => {
    const isActive = m.id === state.selectedArchiveMeetingId;
    return `
      <div class="archive-item ${isActive ? 'active' : ''}" onclick="selectArchiveMeeting('${m.id}')">
        <div style="font-weight:600;font-size:13.5px;">${escapeHtml(m.title)}</div>
        <div class="text-xs text-muted">${new Date(m.date).toLocaleString()} · ${escapeHtml(m.platform || 'Web')}</div>
        <div class="text-xs" style="margin-top:4px;color:#a5b4fc;">
          💬 ${(m.transcript || []).length} lines · 📄 ${(m.documents || []).length} docs
        </div>
      </div>
    `;
  }).join('');

  const m = state.meetings.find(x => x.id === state.selectedArchiveMeetingId) || state.meetings[0];
  if (!m) {
    detailEl.innerHTML = `<div class="text-muted">No meetings recorded yet.</div>`;
    return;
  }

  const s = m.summary;
  const mTasks = state.tasks.filter(t => t.meetingId === m.id);

  detailEl.innerHTML = `
    <div class="card-header">
      <div>
        <h2>${escapeHtml(m.title)}</h2>
        <div class="text-xs text-muted">${new Date(m.date).toLocaleString()} · Platform: ${escapeHtml(m.platform)} · Participants: ${(m.participants || []).join(', ')}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-secondary btn-sm" onclick="loadMeetingIntoStudio('${m.id}')">🎙️ Open in Live Studio</button>
        <button class="btn-primary btn-sm" onclick="openDocStudioForMeeting('${m.id}')">📄 Generate Document</button>
      </div>
    </div>

    <hr class="divider" />

    ${s ? `
      <div class="summary-sec-title">Executive Summary</div>
      <p style="font-size:13.5px;margin-bottom:10px;">${escapeHtml(s.executiveSummary)}</p>

      <div class="summary-sec-title">Key Decisions</div>
      <ul style="padding-left:18px;font-size:13px;margin-bottom:10px;">
        ${(s.keyDecisions || []).map(d => `<li>${escapeHtml(d)}</li>`).join('')}
      </ul>

      <div class="summary-sec-title">Risks & Blockers</div>
      <ul style="padding-left:18px;font-size:13px;margin-bottom:10px;">
        ${(s.risksAndBlockers || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    ` : `<div class="text-muted text-xs" style="margin-bottom:10px;">Not summarized yet. Open in Live Studio to analyze.</div>`}

    <div class="summary-sec-title">Synced PM Action Items (${mTasks.length})</div>
    <ul style="padding-left:18px;font-size:13px;margin-bottom:12px;">
      ${mTasks.map(t => `<li><strong>[${t.priority.toUpperCase()}]</strong> ${escapeHtml(t.title)} — <em>${t.assignee}</em> (${t.status})</li>`).join('') || '<li>No tasks linked yet.</li>'}
    </ul>

    <div class="summary-sec-title">Full Transcript (${(m.transcript || []).length} segments)</div>
    <div class="transcript-feed" style="height:220px;">
      ${(m.transcript || []).map(seg => `
        <div class="utterance-item">
          <div class="utterance-meta">
            <span class="utterance-speaker">${escapeHtml(seg.speaker)}</span>
            <span>${escapeHtml(seg.timestamp)}</span>
          </div>
          <div>${escapeHtml(seg.text)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

window.selectArchiveMeeting = function(id) {
  state.selectedArchiveMeetingId = id;
  renderMeetingsArchive();
};

window.loadMeetingIntoStudio = function(id) {
  state.activeMeetingId = id;
  switchView('recorder');
  renderLiveRecorderMeeting();
};

window.openDocStudioForMeeting = function(id) {
  document.getElementById('docMeetingSelect').value = id;
  switchView('docs');
};

function renderDocStudioSelectors() {
  const sel = document.getElementById('docMeetingSelect');
  sel.innerHTML = state.meetings.map(m =>
    `<option value="${m.id}">${escapeHtml(m.title)} (${new Date(m.date).toLocaleDateString()})</option>`
  ).join('');

  // Prepopulate editor with first available generated doc if empty
  const ed = document.getElementById('docMarkdownEditor');
  if (!ed.value && state.meetings[0]?.documents?.[0]) {
    ed.value = state.meetings[0].documents[0].content;
    document.getElementById('docTitleInput').value = state.meetings[0].documents[0].title;
  }
}

// ==========================================
// 5. CALENDAR (GOOGLE & MICROSOFT TEAMS)
// ==========================================

function renderCalendarView() {
  document.getElementById('googleConnStatus').textContent = state.settings.googleConnected
    ? '✅ Connected via Google OAuth 2.0'
    : 'Ready for Google OAuth 2.0 or ICS Feed';
  document.getElementById('msConnStatus').textContent = state.settings.microsoftConnected
    ? '✅ Connected via Microsoft Graph OAuth 2.0'
    : 'Ready for Microsoft Teams OAuth 2.0 or ICS Feed';

  const icsList = document.getElementById('icsFeedsList');
  icsList.innerHTML = (state.settings.icsFeeds || []).map((f, idx) => `
    <span class="badge">📅 ${escapeHtml(f.label)}: ${escapeHtml(f.url.slice(0, 35))}...</span>
  `).join('');

  const grid = document.getElementById('calendarEventsGrid');
  grid.innerHTML = (state.calendarEvents || []).map(ev => `
    <div class="cal-event-card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="badge badge-accent">${escapeHtml(ev.source || ev.platform)}</span>
        <span class="text-xs text-muted">${new Date(ev.start).toLocaleString()}</span>
      </div>
      <div style="font-weight:700;font-size:14.5px;">${escapeHtml(ev.title)}</div>
      <div class="text-xs text-muted">👥 Attendees: ${(ev.attendees || []).join(', ') || 'Ethan'}</div>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <button class="btn-primary btn-sm flex-1" onclick="startRecordingFromCalendar('${ev.id}')">
          🎙️ Launch Live Studio for Call
        </button>
        ${ev.meetingUrl ? `<a href="${escapeHtml(ev.meetingUrl)}" target="_blank" class="btn-secondary btn-sm" style="text-decoration:none;">🔗 Join Call</a>` : ''}
      </div>
    </div>
  `).join('');
}

window.startRecordingFromCalendar = async function(calEventId) {
  const ev = state.calendarEvents.find(e => e.id === calEventId);
  if (!ev) return;

  if (ev.meetingUrl) {
    window.open(ev.meetingUrl, '_blank');
  }

  const res = await fetch('/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: ev.title,
      platform: ev.platform || ev.source,
      projectId: ev.projectId || (state.projects[0]?.id || 'proj-personal'),
      participants: ev.attendees || ['Ethan (You)'],
      calendarEventId: ev.id
    })
  });
  if (res.ok) {
    const newMeet = await res.json();
    state.meetings.unshift(newMeet);
    state.activeMeetingId = newMeet.id;
    renderAll();
    switchView('recorder');
    showToast(`Prepared Live Studio for "${ev.title}"!`);
  }
};

// ==========================================
// 6. SETTINGS VIEW
// ==========================================

function renderSettingsView() {
  const s = state.settings || {};
  document.getElementById('setAiProvider').value = s.aiProvider || 'claude_bridge';
  document.getElementById('setAnthropicKey').value = s.anthropicApiKey || '';
  document.getElementById('setAnthropicModel').value = s.anthropicModel || 'claude-3-7-sonnet-latest';
  document.getElementById('setGeminiKey').value = s.geminiApiKey || '';
  document.getElementById('setAutoAddPm').checked = s.autoAddActionItemsToPM !== false;

  document.getElementById('setGoogleClientId').value = s.googleClientId || '';
  document.getElementById('setGoogleClientSecret').value = s.googleClientSecret || '';
  document.getElementById('setGoogleRedirect').value = s.googleRedirectUri || `${window.location.origin}/api/calendar/google/callback`;

  document.getElementById('setMsClientId').value = s.msClientId || '';
  document.getElementById('setMsClientSecret').value = s.msClientSecret || '';
  document.getElementById('setMsRedirect').value = s.msRedirectUri || `${window.location.origin}/api/calendar/microsoft/callback`;
}

// ==========================================
// NAVIGATION & EVENT LISTENERS
// ==========================================

function switchView(viewName) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });

  const titles = {
    recorder: ['Live Meeting Recorder Studio', 'Capture Tab/System Audio + Mic simultaneously with Offline Whisper (EN) & Burmese (မြန်မာ) ASR'],
    pm: ['Personal Auto-PM Workspace', 'Zero manual data entry — Action items from your meetings flow directly into your Kanban board'],
    meetings: ['Meetings & Minutes Archive', 'Review verbatim bilingual transcripts, decisions, and linked project tasks'],
    docs: ['Document Generator Studio', 'Generate Formal Minutes (MOM), PRDs, Bilingual Burmese/English Reports, and Follow-up Emails'],
    calendar: ['Google Calendar & Microsoft Teams Sync', 'Connect via OAuth 2.0 or private ICS feeds to launch recordings in 1 click'],
    settings: ['AI, Speech & Cloud Configuration', 'Configure Offline Whisper, Burmese ASR, Claude Pro Bridge / API keys, and Calendar OAuth']
  };
  if (titles[viewName]) {
    document.getElementById('viewTitle').textContent = titles[viewName][0];
    document.getElementById('viewSubtitle').textContent = titles[viewName][1];
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadAppState();

  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Global project filter
  document.getElementById('globalProjectFilter').addEventListener('change', (e) => {
    state.selectedProjectFilter = e.target.value;
    renderKanbanAndTasks();
  });

  // New live recording session button
  document.getElementById('btnQuickNewMeeting').addEventListener('click', async () => {
    const title = prompt('Enter title for new meeting session:', `Meeting Sync (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
    if (!title) return;
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        projectId: document.getElementById('recProjectSelect').value || 'proj-personal',
        platform: document.getElementById('recPlatformSelect').value || 'Google Meet'
      })
    });
    if (res.ok) {
      const m = await res.json();
      state.meetings.unshift(m);
      state.activeMeetingId = m.id;
      state.recording.elapsedSeconds = 0;
      document.getElementById('recTimer').textContent = '00:00';
      renderAll();
      switchView('recorder');
      showToast(`Created meeting "${m.title}"`);
    }
  });

  // Warm up Offline Whisper button
  document.getElementById('btnPreloadWhisper').addEventListener('click', () => {
    initWhisperWorker(true);
  });

  // Quick toggle language EN <-> Burmese (my-MM)
  document.getElementById('btnToggleLangQuick').addEventListener('click', () => {
    state.recording.currentLang = state.recording.currentLang === 'en-US' ? 'my-MM' : 'en-US';
    updateLangBadgeUI();
    if (state.recording.speechRec && state.recording.active) {
      try { state.recording.speechRec.stop(); } catch (_) {}
    }
    showToast(`Switched live speech language to ${state.recording.currentLang === 'my-MM' ? 'Burmese (မြန်မာဘာသာ)' : 'English (EN)'}`);
  });

  // Recording start/stop buttons
  document.getElementById('btnStartShareAndRecord').addEventListener('click', () => startLiveRecording(true));
  document.getElementById('btnStartMicOnly').addEventListener('click', () => startLiveRecording(false));
  document.getElementById('btnStopRecording').addEventListener('click', () => stopLiveRecording());

  // Popout Floating Companion
  document.getElementById('btnPopoutPip').addEventListener('click', () => openFloatingCompanionWindow());

  // Add simulated Bilingual EN + Burmese segment for easy testing
  document.getElementById('btnAddSimBurmese').addEventListener('click', async () => {
    const samples = [
      {
        speaker: 'Ko Thura (Client)',
        text: 'ဒီအပတ် သောကြာနေ့မတိုင်ခင် Google Calendar နဲ့ Teams Calendar ချိတ်ဆက်မှုကို အပြီးစမ်းသပ်ပေးပါ။ Action item အနေနဲ့ မှတ်ထားပေးပါနော်။',
        lang: 'my'
      },
      {
        speaker: 'Ethan (You)',
        text: 'Got it! I will finalize the GCP Cloud Run deployment script and verify the Burmese meeting minutes export by Thursday.',
        lang: 'en'
      }
    ];
    for (const s of samples) {
      state.recording.elapsedSeconds += 18;
      await appendTranscriptSegment(s.speaker, s.text, s.lang);
    }
    showToast('Added bilingual English + Burmese (မြန်မာ) test segments!');
  });

  // Manual line input
  document.getElementById('btnAddUtterance').addEventListener('click', async () => {
    const speaker = document.getElementById('manualSpeakerInput').value.trim() || 'Ethan (You)';
    const input = document.getElementById('manualUtteranceInput');
    const text = input.value.trim();
    if (!text) return;
    const isMy = /[\u1000-\u109F]/.test(text);
    input.value = '';
    await appendTranscriptSegment(speaker, text, isMy ? 'my' : 'en');
  });

  document.getElementById('manualUtteranceInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnAddUtterance').click();
  });

  // Quick note tag buttons
  document.querySelectorAll('.btn-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const area = document.getElementById('recLiveNotes');
      area.value = (area.value ? area.value + '\n' : '') + btn.dataset.insert;
      area.focus();
    });
  });

  // Auto-save notes on blur
  document.getElementById('recLiveNotes').addEventListener('blur', () => saveCurrentMeetingMetadata());
  document.getElementById('recMeetingTitle').addEventListener('blur', () => saveCurrentMeetingMetadata());

  // Summarize & Auto-Add Tasks button
  document.getElementById('btnAnalyzeLiveMeeting').addEventListener('click', () => triggerAnalyzeCurrentMeeting());

  // Claude Pro Bridge Modal
  document.getElementById('btnOpenClaudeBridge').addEventListener('click', async () => {
    await saveCurrentMeetingMetadata();
    const m = getActiveMeeting();
    if (!m) return;
    const res = await fetch(`/api/meetings/${m.id}/claude-prompt?mode=analyze`);
    const data = await res.json();
    document.getElementById('claudePromptBox').value = data.prompt || '';
    document.getElementById('claudeBridgeModal').classList.remove('hidden');
  });

  document.getElementById('btnCloseClaudeModal').addEventListener('click', () => {
    document.getElementById('claudeBridgeModal').classList.add('hidden');
  });

  document.getElementById('btnCopyAndOpenClaude').addEventListener('click', async () => {
    const promptText = document.getElementById('claudePromptBox').value;
    await navigator.clipboard.writeText(promptText);
    showToast('Copied structured prompt! Paste it into your Claude Pro tab.');
    window.open('https://claude.ai/new', '_blank');
  });

  document.getElementById('btnJustCopyClaudePrompt').addEventListener('click', async () => {
    const promptText = document.getElementById('claudePromptBox').value;
    await navigator.clipboard.writeText(promptText);
    showToast('Prompt copied to clipboard!');
  });

  document.getElementById('btnImportClaudeResponse').addEventListener('click', async () => {
    const rawResponse = document.getElementById('claudeResponseInput').value.trim();
    const m = getActiveMeeting();
    if (!rawResponse || !m) return;
    const res = await fetch(`/api/meetings/${m.id}/import-claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawResponse })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to parse JSON');
      return;
    }
    const idx = state.meetings.findIndex(x => x.id === m.id);
    if (idx !== -1) state.meetings[idx] = data.meeting;
    if (data.createdTasks?.length) {
      state.tasks = [...data.createdTasks, ...state.tasks];
    }
    document.getElementById('claudeBridgeModal').classList.add('hidden');
    renderAll();
    showToast(`Imported Claude Pro summary & created ${data.createdTasks?.length || 0} PM tasks!`);
  });

  // PM sub-tabs (Kanban / List / Projects)
  document.querySelectorAll('.pm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pm-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.pmmode;
      document.getElementById('pmKanbanView').classList.toggle('hidden', mode !== 'kanban');
      document.getElementById('pmListView').classList.toggle('hidden', mode !== 'list');
      document.getElementById('pmProjectsView').classList.toggle('hidden', mode !== 'projects');
    });
  });

  // Quick Add Task
  document.getElementById('btnQuickAddTask').addEventListener('click', async () => {
    const input = document.getElementById('quickTaskTitle');
    const title = input.value.trim();
    if (!title) return;
    const priority = document.getElementById('quickTaskPriority').value;
    const projectId = state.selectedProjectFilter !== 'all'
      ? state.selectedProjectFilter
      : (state.projects[0]?.id || 'proj-personal');

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, priority, projectId })
    });
    if (res.ok) {
      const t = await res.json();
      state.tasks.unshift(t);
      input.value = '';
      renderKanbanAndTasks();
      updateBadges();
      showToast('Task added to board!');
    }
  });

  // New Project button
  document.getElementById('btnNewProjectModal').addEventListener('click', async () => {
    const name = prompt('Project Name:');
    if (!name) return;
    const description = prompt('Short Project Description (optional):') || '';
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    });
    if (res.ok) {
      const p = await res.json();
      state.projects.push(p);
      renderAll();
      showToast(`Project "${p.name}" created!`);
    }
  });

  // Document Studio Generation
  document.getElementById('btnGenerateDocument').addEventListener('click', async () => {
    const meetingId = document.getElementById('docMeetingSelect').value;
    const docType = document.querySelector('input[name="docType"]:checked')?.value || 'mom';
    if (!meetingId) return;

    showToast('Generating structured document...');
    const res = await fetch(`/api/meetings/${meetingId}/generate-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType })
    });
    const data = await res.json();
    if (res.ok && data.doc) {
      document.getElementById('docTitleInput').value = data.doc.title;
      document.getElementById('docMarkdownEditor').value = data.doc.content;
      const idx = state.meetings.findIndex(m => m.id === meetingId);
      if (idx !== -1) state.meetings[idx] = data.meeting;
      showToast(`Generated "${data.doc.title}"!`);
    }
  });

  document.getElementById('btnClaudeDocPrompt').addEventListener('click', async () => {
    const meetingId = document.getElementById('docMeetingSelect').value;
    const docType = document.querySelector('input[name="docType"]:checked')?.value || 'mom';
    const res = await fetch(`/api/meetings/${meetingId}/claude-prompt?mode=doc&docType=${docType}`);
    const data = await res.json();
    await navigator.clipboard.writeText(data.prompt || '');
    showToast('Copied Document Prompt for Claude Pro! Opening claude.ai...');
    window.open('https://claude.ai/new', '_blank');
  });

  // Document Exports (Copy, Word .doc, Markdown .md, Print PDF)
  document.getElementById('btnCopyDocMd').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('docMarkdownEditor').value);
    showToast('Document copied to clipboard!');
  });

  document.getElementById('btnExportMd').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'meeting-document';
    const content = document.getElementById('docMarkdownEditor').value;
    downloadFile(`${slugify(title)}.md`, content, 'text/markdown;charset=utf-8');
  });

  document.getElementById('btnExportWord').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'Meeting-Document';
    const md = document.getElementById('docMarkdownEditor').value;
    const htmlBody = simpleMarkdownToHtml(md);
    const wordHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${escapeHtml(title)}</title>
      <style>body{font-family:'Calibri','Noto Sans Myanmar',sans-serif;line-height:1.5;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #999;padding:6px;}</style>
      </head><body>${htmlBody}</body></html>`;
    downloadFile(`${slugify(title)}.doc`, wordHtml, 'application/msword;charset=utf-8');
  });

  document.getElementById('btnPrintPdf').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'Meeting Document';
    const md = document.getElementById('docMarkdownEditor').value;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>${escapeHtml(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Myanmar:wght@400;600&display=swap" rel="stylesheet">
      <style>body{font-family:'Inter','Noto Sans Myanmar',sans-serif;padding:36px;color:#111;line-height:1.6;} table{border-collapse:collapse;width:100%;margin:14px 0;} th,td{border:1px solid #ccc;padding:8px;text-align:left;}</style>
      </head><body>${simpleMarkdownToHtml(md)}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  });

  // Calendar OAuth & Sync buttons
  document.getElementById('btnConnectGoogle').addEventListener('click', async () => {
    const res = await fetch('/api/calendar/google/auth');
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else showToast(data.error || 'Configure Google Client ID in Settings first, or use ICS URL below.');
  });

  document.getElementById('btnConnectMicrosoft').addEventListener('click', async () => {
    const res = await fetch('/api/calendar/microsoft/auth');
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else showToast(data.error || 'Configure Microsoft Client ID in Settings first, or use ICS URL below.');
  });

  document.getElementById('btnSyncCalendars').addEventListener('click', async () => {
    showToast('Syncing Google & Microsoft Teams calendars...');
    const res = await fetch('/api/calendar/sync', { method: 'POST' });
    const data = await res.json();
    state.calendarEvents = data.calendarEvents || state.calendarEvents;
    renderCalendarView();
    showToast(`Calendar sync complete (${data.calendarEvents?.length || 0} events)!`);
  });

  document.getElementById('btnAddIcsFeed').addEventListener('click', async () => {
    const label = document.getElementById('icsLabelInput').value.trim() || 'Calendar Feed';
    const url = document.getElementById('icsUrlInput').value.trim();
    if (!url) return;
    const feeds = [...(state.settings.icsFeeds || []), { label, url }];
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icsFeeds: feeds })
    });
    document.getElementById('icsUrlInput').value = '';
    await loadAppState();
    document.getElementById('btnSyncCalendars').click();
  });

  document.getElementById('btnAddScheduleEvent').addEventListener('click', async () => {
    const title = prompt('Meeting Title:');
    if (!title) return;
    const meetingUrl = prompt('Google Meet or MS Teams Join URL (optional):') || '';
    const platform = meetingUrl.includes('teams') ? 'MS Teams' : 'Google Meet';
    const res = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        meetingUrl,
        platform,
        source: platform === 'MS Teams' ? 'Microsoft Teams' : 'Google Calendar',
        start: new Date(Date.now() + 3600000).toISOString()
      })
    });
    if (res.ok) {
      const ev = await res.json();
      state.calendarEvents.unshift(ev);
      renderCalendarView();
      showToast('Added meeting to calendar!');
    }
  });

  // Save Settings
  document.getElementById('btnSaveAiSettings').addEventListener('click', async () => {
    const body = {
      aiProvider: document.getElementById('setAiProvider').value,
      anthropicApiKey: document.getElementById('setAnthropicKey').value.trim(),
      anthropicModel: document.getElementById('setAnthropicModel').value.trim(),
      geminiApiKey: document.getElementById('setGeminiKey').value.trim(),
      autoAddActionItemsToPM: document.getElementById('setAutoAddPm').checked
    };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      showToast('Saved AI & Speech settings!');
    }
  });

  document.getElementById('btnSaveOAuthSettings').addEventListener('click', async () => {
    const body = {
      googleClientId: document.getElementById('setGoogleClientId').value.trim(),
      googleClientSecret: document.getElementById('setGoogleClientSecret').value.trim(),
      googleRedirectUri: document.getElementById('setGoogleRedirect').value.trim(),
      msClientId: document.getElementById('setMsClientId').value.trim(),
      msClientSecret: document.getElementById('setMsClientSecret').value.trim(),
      msRedirectUri: document.getElementById('setMsRedirect').value.trim()
    };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      showToast('Saved Calendar OAuth settings!');
    }
  });
});

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function slugify(str) {
  return String(str || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function simpleMarkdownToHtml(md) {
  const lines = String(md || '').split('\n');
  let html = '';
  let inTable = false;

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      if (line.includes('---')) continue;
      if (!inTable) {
        html += '<table>';
        inTable = true;
      }
      const cells = line.split('|').slice(1, -1).map(c => `<td>${escapeHtml(c.trim())}</td>`).join('');
      html += `<tr>${cells}</tr>`;
      continue;
    } else if (inTable) {
      html += '</table>';
      inTable = false;
    }

    if (line.startsWith('# ')) html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    else if (line.startsWith('## ')) html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    else if (line.startsWith('### ')) html += `<h3>${escapeHtml(line.slice(4))}</h3>`;
    else if (line.startsWith('- ')) html += `<li>${escapeHtml(line.slice(2))}</li>`;
    else if (line.trim() === '---') html += '<hr/>';
    else if (line.trim() === '') html += '<br/>';
    else html += `<p>${escapeHtml(line)}</p>`;
  }
  if (inTable) html += '</table>';
  return html;
}
