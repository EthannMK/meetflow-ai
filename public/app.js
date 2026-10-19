/**
 * MeetFlow — Calm, Human-Centered Meeting Notes, Transcript & Auto-PM Client
 * - Dual-Stream Audio Capture (Tab Audio + Mic)
 * - Offline Whisper (English) + Burmese (မြန်မာ my-MM) Hybrid ASR
 * - Granola-style Clean Document Workspace & Floating Recording Pill
 * - Automatic Action Task Board (Kanban + List)
 */

const state = {
  projects: [],
  meetings: [],
  tasks: [],
  calendarEvents: [],
  settings: {},
  selectedProjectFilter: 'all',
  activeMeetingId: null,
  activeDocTab: 'notes',
  activeDocTemplate: 'mom',
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
    currentLang: 'en-US'
  },
  whisperWorker: null,
  whisperReady: false,
  pipWindow: null
};

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function formatDuration(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

    renderAll();
  } catch (err) {
    console.error('Error loading app state:', err);
  }
}

function getActiveMeeting() {
  return state.meetings.find(m => m.id === state.activeMeetingId) || state.meetings[0] || null;
}

function renderAll() {
  renderSidebar();
  renderUpcomingBanner();
  renderMeetingWorkspace();
  renderTasksWorkspace();
  renderCalendarWorkspace();
  renderSettingsWorkspace();
}

// ==========================================
// SIDEBAR & NAVIGATION
// ==========================================

function renderSidebar() {
  const openTasks = state.tasks.filter(t => t.status !== 'done').length;
  const taskBadge = document.getElementById('navTasksCount');
  if (taskBadge) taskBadge.textContent = openTasks;

  // Recent Meetings in Sidebar
  const meetList = document.getElementById('sidebarMeetingsList');
  if (meetList) {
    meetList.innerHTML = state.meetings.map(m => {
      const isActive = m.id === state.activeMeetingId;
      const dateStr = new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `
        <div class="sidebar-meet-item ${isActive ? 'active' : ''}" onclick="selectMeeting('${m.id}')">
          <div class="sidebar-meet-title">${escapeHtml(m.title)}</div>
          <div class="sidebar-meet-sub">${dateStr} · ${escapeHtml(m.platform || 'Meeting')}</div>
        </div>
      `;
    }).join('');
  }

  // Projects in Sidebar
  const projList = document.getElementById('sidebarProjectsList');
  if (projList) {
    projList.innerHTML = `
      <div class="sidebar-proj-item ${state.selectedProjectFilter === 'all' ? 'active' : ''}" onclick="filterByProject('all')">
        <span class="proj-dot" style="background:#8C8A84"></span>
        <span>All Projects</span>
      </div>
    ` + state.projects.map(p => `
      <div class="sidebar-proj-item ${state.selectedProjectFilter === p.id ? 'active' : ''}" onclick="filterByProject('${p.id}')">
        <span class="proj-dot" style="background:${p.color || '#2563EB'}"></span>
        <span>${escapeHtml(p.name)}</span>
      </div>
    `).join('');
  }

  // Project dropdowns
  const globalFilter = document.getElementById('globalProjectFilter');
  if (globalFilter) {
    globalFilter.innerHTML = `<option value="all">All Projects</option>` +
      state.projects.map(p => `<option value="${p.id}" ${state.selectedProjectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  }

  const activeM = getActiveMeeting();
  const recProj = document.getElementById('recProjectSelect');
  if (recProj) {
    recProj.innerHTML = state.projects.map(p =>
      `<option value="${p.id}" ${activeM?.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
  }
}

window.selectMeeting = function(id) {
  state.activeMeetingId = id;
  switchMainView('workspace');
  renderAll();
};

window.filterByProject = function(projId) {
  state.selectedProjectFilter = projId;
  switchMainView('tasks');
  renderAll();
};

function switchMainView(viewName) {
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.stage-view').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
}

// ==========================================
// SPACE 1: CALM MEETING DOCUMENT WORKSPACE
// ==========================================

function renderUpcomingBanner() {
  const banner = document.getElementById('upcomingCallBanner');
  if (!banner) return;
  const nextEv = state.calendarEvents?.[0];
  if (!nextEv) {
    banner.innerHTML = '';
    return;
  }
  const timeStr = new Date(nextEv.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  banner.innerHTML = `
    <div>
      <span style="color:var(--text-muted);margin-right:6px;">Up Next · ${timeStr}</span>
      <strong>${escapeHtml(nextEv.title)}</strong>
      <span style="color:var(--text-muted);margin-left:6px;">(${escapeHtml(nextEv.platform || nextEv.source)})</span>
    </div>
    <button class="btn-secondary-soft btn-sm" onclick="startRecordingFromCalendar('${nextEv.id}')">
      Prepare Note & Join
    </button>
  `;
}

function renderMeetingWorkspace() {
  const m = getActiveMeeting();
  if (!m) return;

  document.getElementById('recMeetingTitle').value = m.title || '';
  document.getElementById('recLiveNotes').value = m.notes || '';
  document.getElementById('recProjectSelect').value = m.projectId || (state.projects[0]?.id || '');
  document.getElementById('meetingDateLabel').textContent = new Date(m.date).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Transcript List
  const listEl = document.getElementById('liveTranscriptList');
  const segments = m.transcript || [];
  if (segments.length === 0) {
    listEl.innerHTML = `<div class="text-muted text-xs" style="padding:14px 4px;">
      No transcript lines yet. Click <strong>"Record Meeting"</strong> in the bottom bar (or <strong>"+ Sample EN/မြန်မာ"</strong>) to capture live conversation.
    </div>`;
  } else {
    listEl.innerHTML = segments.map(seg => `
      <div class="utterance-row">
        <span class="utterance-time">${escapeHtml(seg.timestamp || '00:00')}</span>
        <div class="utterance-body">
          <span class="utterance-speaker-name">${escapeHtml(seg.speaker || 'Speaker')}:</span>
          <span>${escapeHtml(seg.text)}</span>
        </div>
        <button class="utterance-hover-btn" onclick="promoteUtteranceToTask('${escapeHtml(seg.text.replace(/'/g, "\\'"))}', '${escapeHtml(seg.timestamp || '00:00')}')">
          + Add to Tasks
        </button>
      </div>
    `).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  // Summary & Minutes Sheet
  renderSummarySheet(m);

  // Export Document Preview
  renderExportSheet(m);

  updatePipWindowTranscript(m);
}

function renderSummarySheet(m) {
  const sheet = document.getElementById('liveSummaryPreview');
  if (!sheet) return;

  if (!m.summary) {
    sheet.innerHTML = `
      <div style="text-align:center;padding:28px 12px;color:var(--text-secondary);">
        <p style="margin-bottom:12px;">No meeting summary generated yet.</p>
        <button class="btn-primary-soft" onclick="triggerAnalyzeCurrentMeeting()">
          Generate Summary & Action Tasks
        </button>
      </div>
    `;
    return;
  }

  const s = m.summary;
  const linkedTasks = state.tasks.filter(t => t.meetingId === m.id);

  sheet.innerHTML = `
    <div class="summary-block">
      <h4>Executive Summary</h4>
      <p>${escapeHtml(s.executiveSummary || '')}</p>
    </div>

    <div class="summary-block">
      <h4>Key Decisions</h4>
      <ul>
        ${(s.keyDecisions || []).map(d => `<li>${escapeHtml(d)}</li>`).join('') || '<li>No explicit decisions logged.</li>'}
      </ul>
    </div>

    <div class="summary-block">
      <h4>Action Items (Synced to Action Tasks Board)</h4>
      <ul>
        ${linkedTasks.map(t => `
          <li>
            <strong>${escapeHtml(t.title)}</strong>
            <span class="text-muted text-xs"> — ${escapeHtml(t.assignee || 'Ethan')} · Due ${escapeHtml(t.dueDate || 'TBD')} (${t.status})</span>
          </li>
        `).join('') || '<li>No action items extracted yet.</li>'}
      </ul>
    </div>

    <div class="summary-block" style="margin-bottom:0;">
      <h4>Risks & Open Questions</h4>
      <ul>
        ${(s.risksAndBlockers || []).map(r => `<li>${escapeHtml(r)}</li>`).join('') || '<li>None noted.</li>'}
      </ul>
    </div>
  `;
}

function renderExportSheet(m) {
  const doc = (m.documents || [])[0];
  const mdEditor = document.getElementById('docMarkdownEditor');
  const previewEl = document.getElementById('docRenderedPreview');
  const titleEl = document.getElementById('docTitleInput');

  if (doc) {
    if (!mdEditor.dataset.meetingId || mdEditor.dataset.meetingId !== m.id) {
      mdEditor.value = doc.content;
      mdEditor.dataset.meetingId = m.id;
      titleEl.value = doc.title;
    }
  } else {
    mdEditor.value = `# ${m.title}\n\nClick any template button above (Meeting Minutes, Bilingual EN/မြန်မာ, Product Spec, Follow-up Email) to generate a complete document.`;
  }

  previewEl.innerHTML = simpleMarkdownToHtml(mdEditor.value);
}

window.promoteUtteranceToTask = async function(text, timestamp) {
  const m = getActiveMeeting();
  if (!m) return;
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: text.length > 90 ? text.slice(0, 88) + '...' : text,
      description: `From meeting "${m.title}" at [${timestamp}]`,
      priority: 'medium',
      projectId: m.projectId || 'proj-personal',
      meetingId: m.id,
      meetingTimestamp: timestamp,
      autoExtracted: true
    })
  });
  if (res.ok) {
    const newTask = await res.json();
    state.tasks.unshift(newTask);
    renderSidebar();
    renderTasksWorkspace();
    showToast('Added line to your Action Tasks board');
  }
};

// ==========================================
// LIVE AUDIO CAPTURE & OFFLINE WHISPER / MY-MM
// ==========================================

function initWhisperWorker(preloadNow = false) {
  if (!state.whisperWorker) {
    state.whisperWorker = new Worker('/whisper-worker.js', { type: 'module' });
    state.whisperWorker.addEventListener('message', (e) => {
      const data = e.data;
      if (data.status === 'ready') {
        state.whisperReady = true;
        showToast('Offline Whisper (EN) ready in browser');
      } else if (data.status === 'complete') {
        const clean = (data.text || '').replace(/\[BLANK_AUDIO\]/gi, '').replace(/\(.*\)/g, '').trim();
        if (clean && clean.length > 2) {
          appendTranscriptSegment(data.speaker || 'Meeting Audio', clean, 'en');
        }
      }
    });
  }
  if (preloadNow) {
    state.whisperWorker.postMessage({ type: 'load', model: 'Xenova/whisper-tiny.en' });
  }
}

async function startLiveRecording(includeTabAudio = true) {
  try {
    let currentMeeting = getActiveMeeting();
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    state.recording.micStream = micStream;

    let tabStream = null;
    if (includeTabAudio && navigator.mediaDevices.getDisplayMedia) {
      try {
        tabStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false },
          systemAudio: 'include'
        });
        state.recording.tabStream = tabStream;
      } catch (_) {
        showToast('Recording with microphone');
      }
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContextClass({ sampleRate: 16000 });
    state.recording.audioCtx = audioCtx;

    const destNode = audioCtx.createMediaStreamDestination();
    const masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 64;

    const micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(masterAnalyser);
    micSource.connect(destNode);

    if (tabStream && tabStream.getAudioTracks().length > 0) {
      const tabAudioOnly = new MediaStream(tabStream.getAudioTracks());
      const tabSource = audioCtx.createMediaStreamSource(tabAudioOnly);
      tabSource.connect(masterAnalyser);
      tabSource.connect(destNode);
    }

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
      state.recording.pcmBuffer.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

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
        for (let i = 0; i < c.length; i += 8) sumSq += c[i] * c[i];
      }
      const rms = Math.sqrt(sumSq / (totalLen / 8));
      if (rms > 0.012 && state.whisperReady && state.whisperWorker && !state.recording.speechRecActive) {
        state.whisperWorker.postMessage({
          type: 'transcribe',
          audio: merged,
          model: 'Xenova/whisper-tiny.en',
          speaker: 'Meeting Audio'
        });
      }
    }, 8000);

    startBrowserLiveSpeechRecognition();

    if (engineMode === 'burmese_hybrid' && state.settings.hasGeminiKey) {
      startBurmeseChunkRecorder(destNode.stream);
    }

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

    drawMiniDockWaveform(masterAnalyser);
  } catch (err) {
    showToast(`Could not start recording: ${err.message}`);
  }
}

function startBrowserLiveSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

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
      rec.lang === 'my-MM' ? 'Listening in Burmese (မြန်မာ)...' : 'Listening live...';
  };

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const txt = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        const speaker = document.getElementById('manualSpeakerInput').value.trim() || 'Ethan';
        appendTranscriptSegment(speaker, txt.trim(), rec.lang.startsWith('my') ? 'my' : 'en');
      } else {
        interim += txt;
      }
    }
    if (interim) {
      document.getElementById('liveInterimStatus').textContent = interim;
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
  } catch (_) {}
}

function startBurmeseChunkRecorder(mixedStream) {
  try {
    const mr = new MediaRecorder(mixedStream, { mimeType: 'audio/webm' });
    state.recording.mediaRecorder = mr;
    mr.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size < 2000 || !state.recording.active) return;
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result || '').toString().split(',')[1];
        if (!base64) return;
        const res = await fetch('/api/ai/transcribe-burmese', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: base64, mimeType: 'audio/webm', languageHint: 'my' })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.text && data.text.length > 1) {
            appendTranscriptSegment('Participant (မြန်မာ)', data.text, 'my');
          }
        }
      };
      reader.readAsDataURL(ev.data);
    };
    mr.start(10000);
  } catch (_) {}
}

function drawMiniDockWaveform(analyser) {
  const canvas = document.getElementById('audioCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);

  function loop() {
    if (!state.recording.active) return;
    state.recording.animFrame = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bars = 14;
    const step = Math.floor(data.length / bars);
    const barW = 4;
    for (let i = 0; i < bars; i++) {
      const val = data[i * step] || 10;
      const h = Math.max(3, (val / 255) * canvas.height);
      const y = (canvas.height - h) / 2;
      ctx.fillStyle = '#22C55E';
      ctx.fillRect(i * (barW + 2), y, barW, h);
    }
  }
  loop();
}

async function stopLiveRecording() {
  state.recording.active = false;
  clearInterval(state.recording.timerInterval);
  clearInterval(state.recording.pcmInterval);
  cancelAnimationFrame(state.recording.animFrame);

  if (state.recording.speechRec) {
    try { state.recording.speechRec.stop(); } catch (_) {}
  }
  if (state.recording.mediaRecorder && state.recording.mediaRecorder.state !== 'inactive') {
    try { state.recording.mediaRecorder.stop(); } catch (_) {}
  }
  if (state.recording.micStream) state.recording.micStream.getTracks().forEach(t => t.stop());
  if (state.recording.tabStream) state.recording.tabStream.getTracks().forEach(t => t.stop());
  if (state.recording.audioCtx) {
    try { await state.recording.audioCtx.close(); } catch (_) {}
  }

  document.getElementById('navRecBadge').classList.add('hidden');
  document.getElementById('btnStopRecording').classList.add('hidden');
  document.getElementById('btnStartShareAndRecord').classList.remove('hidden');
  document.getElementById('btnStartMicOnly').classList.remove('hidden');
  document.getElementById('liveInterimStatus').textContent = 'Finished recording';

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
    renderMeetingWorkspace();
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
    body: JSON.stringify({ title, projectId, platform, notes })
  });
  if (res.ok) {
    const updated = await res.json();
    const idx = state.meetings.findIndex(x => x.id === m.id);
    if (idx !== -1) state.meetings[idx] = updated;
    renderSidebar();
  }
}

window.triggerAnalyzeCurrentMeeting = async function() {
  const m = getActiveMeeting();
  if (!m) return;
  await saveCurrentMeetingMetadata();
  showToast('Generating meeting summary & extracting tasks...');

  const res = await fetch(`/api/meetings/${m.id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoAddTasks: true })
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data.error || 'Could not summarize');
    return;
  }

  const idx = state.meetings.findIndex(x => x.id === m.id);
  if (idx !== -1) state.meetings[idx] = data.meeting;
  if (Array.isArray(data.createdTasks) && data.createdTasks.length > 0) {
    state.tasks = [...data.createdTasks, ...state.tasks];
  }

  // Switch comfortably to the Minutes & Action Items tab so the user sees the result
  switchDocSubTab('summary');
  renderAll();
  showToast(`Summary ready — ${data.createdTasks?.length || 0} tasks added to Action Tasks`);
};

function switchDocSubTab(tabName) {
  state.activeDocTab = tabName;
  document.querySelectorAll('.doc-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.doctab === tabName);
  });
  ['notes', 'summary', 'export'].forEach(t => {
    const pane = document.getElementById(`docPane-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tabName);
  });
}

function updateLangBadgeUI() {
  const badge = document.getElementById('currentLiveLangBadge');
  if (badge) {
    badge.textContent = state.recording.currentLang === 'my-MM' ? 'မြန်မာ (Burmese)' : 'English (EN)';
  }
}

// ==========================================
// SPACE 2: ACTION TASKS BOARD
// ==========================================

function renderTasksWorkspace() {
  const filtered = state.selectedProjectFilter === 'all'
    ? state.tasks
    : state.tasks.filter(t => t.projectId === state.selectedProjectFilter);

  const statuses = ['todo', 'in_progress', 'blocked', 'done'];
  for (const st of statuses) {
    const colEl = document.getElementById(`col-${st}`);
    const countEl = document.getElementById(`count-${st}`);
    if (!colEl || !countEl) continue;

    const items = filtered.filter(t => t.status === st);
    countEl.textContent = items.length;

    colEl.innerHTML = items.map(t => {
      const proj = state.projects.find(p => p.id === t.projectId);
      const srcMeet = state.meetings.find(m => m.id === t.meetingId);
      return `
        <div class="calm-task-card" draggable="true" data-task-id="${t.id}">
          <div class="task-card-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="text-xs text-muted">${escapeHtml(t.description)}</div>` : ''}
          <div class="task-card-meta">
            <span class="prio-tag ${t.priority || 'medium'}">${t.priority || 'medium'}</span>
            <span>${escapeHtml(proj ? proj.name : 'General')}</span>
          </div>
          ${srcMeet ? `<div class="text-xs text-muted" style="margin-top:4px;">From: ${escapeHtml(srcMeet.title)}</div>` : ''}
          <div class="task-card-actions">
            ${st !== 'in_progress' && st !== 'done' ? `<button class="btn-subtle-xs" onclick="moveTaskStatus('${t.id}','in_progress')">Start</button>` : ''}
            ${st !== 'done' ? `<button class="btn-subtle-xs" onclick="moveTaskStatus('${t.id}','done')">Complete</button>` : `<button class="btn-subtle-xs" onclick="moveTaskStatus('${t.id}','todo')">Reopen</button>`}
            <button class="btn-subtle-xs" style="margin-left:auto;" onclick="deleteTask('${t.id}')">Remove</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Drag and drop
  document.querySelectorAll('.calm-task-card').forEach(card => {
    card.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', card.dataset.taskId);
    });
  });

  document.querySelectorAll('.board-column').forEach(col => {
    col.ondragover = (ev) => ev.preventDefault();
    col.ondrop = async (ev) => {
      ev.preventDefault();
      const taskId = ev.dataTransfer.getData('text/plain');
      if (taskId && col.dataset.status) {
        await moveTaskStatus(taskId, col.dataset.status);
      }
    };
  });

  // Clean Table View
  const tbody = document.getElementById('pmTableBody');
  if (tbody) {
    tbody.innerHTML = filtered.map(t => {
      const proj = state.projects.find(p => p.id === t.projectId);
      const srcMeet = state.meetings.find(m => m.id === t.meetingId);
      return `
        <tr>
          <td>
            <select class="select-clean" onchange="moveTaskStatus('${t.id}', this.value)">
              <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option>
              <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option>
              <option value="done" ${t.status === 'done' ? 'selected' : ''}>Completed</option>
            </select>
          </td>
          <td><strong>${escapeHtml(t.title)}</strong></td>
          <td>${escapeHtml(proj ? proj.name : 'General')}</td>
          <td><span class="prio-tag ${t.priority}">${t.priority}</span></td>
          <td class="text-muted">${escapeHtml(t.dueDate || '-')}</td>
          <td class="text-muted">${srcMeet ? escapeHtml(srcMeet.title) : 'Manual'}</td>
          <td><button class="btn-subtle-xs" onclick="deleteTask('${t.id}')">Remove</button></td>
        </tr>
      `;
    }).join('');
  }
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
    renderSidebar();
    renderTasksWorkspace();
  }
};

window.deleteTask = async function(taskId) {
  const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  if (res.ok) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    renderSidebar();
    renderTasksWorkspace();
  }
};

// ==========================================
// SPACE 3 & 4: CALENDAR & SETTINGS
// ==========================================

function renderCalendarWorkspace() {
  const gStat = document.getElementById('googleConnStatus');
  const mStat = document.getElementById('msConnStatus');
  if (gStat) gStat.textContent = state.settings.googleConnected ? 'Connected' : 'Ready to connect';
  if (mStat) mStat.textContent = state.settings.microsoftConnected ? 'Connected' : 'Ready to connect';

  const icsList = document.getElementById('icsFeedsList');
  if (icsList) {
    icsList.innerHTML = (state.settings.icsFeeds || []).map(f =>
      `<span class="btn-subtle-xs">${escapeHtml(f.label)}</span>`
    ).join('');
  }

  const grid = document.getElementById('calendarEventsGrid');
  if (grid) {
    grid.innerHTML = (state.calendarEvents || []).map(ev => `
      <div class="event-row-card">
        <div>
          <div style="font-weight:600;font-size:14.5px;">${escapeHtml(ev.title)}</div>
          <div class="text-xs text-muted">
            ${new Date(ev.start).toLocaleString()} · ${escapeHtml(ev.source || ev.platform)} · Attendees: ${(ev.attendees || []).join(', ')}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          ${ev.meetingUrl ? `<a href="${escapeHtml(ev.meetingUrl)}" target="_blank" class="btn-secondary-soft btn-sm" style="text-decoration:none;">Join Call</a>` : ''}
          <button class="btn-primary-soft btn-sm" onclick="startRecordingFromCalendar('${ev.id}')">Open Note & Record</button>
        </div>
      </div>
    `).join('');
  }
}

window.startRecordingFromCalendar = async function(calEventId) {
  const ev = state.calendarEvents.find(e => e.id === calEventId);
  if (!ev) return;
  if (ev.meetingUrl) window.open(ev.meetingUrl, '_blank');

  const res = await fetch('/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: ev.title,
      platform: ev.platform || ev.source,
      projectId: ev.projectId || (state.projects[0]?.id || 'proj-personal'),
      participants: ev.attendees || ['Ethan']
    })
  });
  if (res.ok) {
    const m = await res.json();
    state.meetings.unshift(m);
    state.activeMeetingId = m.id;
    switchMainView('workspace');
    renderAll();
    showToast(`Opened meeting note for "${ev.title}"`);
  }
};

function renderSettingsWorkspace() {
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

// Floating Mini Companion Window
async function openFloatingCompanionWindow() {
  if (!('documentPictureInPicture' in window)) {
    window.open(window.location.href, 'MeetFlowMini', 'width=380,height=520');
    return;
  }
  try {
    const pipWin = await window.documentPictureInPicture.requestWindow({ width: 360, height: 440 });
    state.pipWindow = pipWin;
    pipWin.document.head.innerHTML = `
      <style>
        body { font-family:'Inter','Noto Sans Myanmar',sans-serif; background:#FAF9F5; color:#191918; margin:0; padding:14px; display:flex; flex-direction:column; height:92vh; }
        .top { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E4E1D8; padding-bottom:8px; margin-bottom:10px; font-weight:600; font-size:13px; }
        .btn { background:#191918; color:#fff; border:none; padding:5px 10px; border-radius:6px; font-size:11.5px; cursor:pointer; }
        .feed { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:12.5px; }
        .row { background:#fff; border:1px solid #E4E1D8; padding:7px 10px; border-radius:7px; }
      </style>
    `;
    pipWin.document.body.innerHTML = `
      <div class="top">
        <span>MeetFlow Live Note</span>
        <button id="pipLangBtn" class="btn">EN / မြန်မာ</button>
      </div>
      <div id="pipFeed" class="feed"></div>
    `;
    pipWin.document.getElementById('pipLangBtn').addEventListener('click', () => {
      document.getElementById('btnToggleLangQuick').click();
    });
    updatePipWindowTranscript(getActiveMeeting());
  } catch (_) {}
}

function updatePipWindowTranscript(m) {
  if (!state.pipWindow || state.pipWindow.closed || !m) return;
  const feed = state.pipWindow.document.getElementById('pipFeed');
  if (!feed) return;
  feed.innerHTML = (m.transcript || []).slice(-8).map(s =>
    `<div class="row"><strong>${escapeHtml(s.speaker)}:</strong> ${escapeHtml(s.text)}</div>`
  ).join('');
  feed.scrollTop = feed.scrollHeight;
}

// ==========================================
// INITIALIZATION & EVENT BINDINGS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  loadAppState();

  // Primary Sidebar Navigation
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => switchMainView(btn.dataset.view));
  });

  // Light / Dark Calm Theme Toggle
  document.getElementById('btnToggleTheme').addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
  });

  // Document Sub-Tabs (Notes / Summary / Export)
  document.querySelectorAll('.doc-tab').forEach(btn => {
    btn.addEventListener('click', () => switchDocSubTab(btn.dataset.doctab));
  });

  // New Meeting Button
  document.getElementById('btnQuickNewMeeting').addEventListener('click', async () => {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Meeting Note — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
        projectId: state.projects[0]?.id || 'proj-personal',
        platform: 'Google Meet'
      })
    });
    if (res.ok) {
      const m = await res.json();
      state.meetings.unshift(m);
      state.activeMeetingId = m.id;
      state.recording.elapsedSeconds = 0;
      document.getElementById('recTimer').textContent = '00:00';
      switchMainView('workspace');
      switchDocSubTab('notes');
      renderAll();
      document.getElementById('recMeetingTitle').focus();
      document.getElementById('recMeetingTitle').select();
    }
  });

  // Auto-save note & title changes
  document.getElementById('recMeetingTitle').addEventListener('blur', () => saveCurrentMeetingMetadata());
  document.getElementById('recLiveNotes').addEventListener('blur', () => saveCurrentMeetingMetadata());
  document.getElementById('recProjectSelect').addEventListener('change', () => saveCurrentMeetingMetadata());
  document.getElementById('recPlatformSelect').addEventListener('change', () => saveCurrentMeetingMetadata());

  // Recording Dock Controls
  document.getElementById('btnStartShareAndRecord').addEventListener('click', () => startLiveRecording(true));
  document.getElementById('btnStartMicOnly').addEventListener('click', () => startLiveRecording(false));
  document.getElementById('btnStopRecording').addEventListener('click', () => stopLiveRecording());
  document.getElementById('btnPreloadWhisper').addEventListener('click', () => initWhisperWorker(true));
  document.getElementById('btnPopoutPip').addEventListener('click', () => openFloatingCompanionWindow());

  // Language Toggle (EN <-> Burmese)
  document.getElementById('btnToggleLangQuick').addEventListener('click', () => {
    state.recording.currentLang = state.recording.currentLang === 'en-US' ? 'my-MM' : 'en-US';
    updateLangBadgeUI();
    if (state.recording.speechRec && state.recording.active) {
      try { state.recording.speechRec.stop(); } catch (_) {}
    }
    showToast(`Speech language: ${state.recording.currentLang === 'my-MM' ? 'Burmese (မြန်မာ)' : 'English'}`);
  });

  // Sample Bilingual Segment
  document.getElementById('btnAddSimBurmese').addEventListener('click', async () => {
    const samples = [
      {
        speaker: 'Ko Thura',
        text: 'ဒီအပတ် သောကြာနေ့မတိုင်ခင် Google Calendar နဲ့ Teams ချိတ်ဆက်မှုကို အပြီးစမ်းသပ်ပေးပါ။ Action item အနေနဲ့ မှတ်ထားပေးပါနော်။',
        lang: 'my'
      },
      {
        speaker: 'Ethan',
        text: 'Sounds good. I will finalize the GCP Cloud Run deployment script and verify the Burmese meeting minutes export by Thursday.',
        lang: 'en'
      }
    ];
    for (const s of samples) {
      state.recording.elapsedSeconds += 15;
      await appendTranscriptSegment(s.speaker, s.text, s.lang);
    }
    showToast('Added sample English & Burmese lines');
  });

  // Manual Utterance Input
  document.getElementById('btnAddUtterance').addEventListener('click', async () => {
    const speaker = document.getElementById('manualSpeakerInput').value.trim() || 'Ethan';
    const input = document.getElementById('manualUtteranceInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await appendTranscriptSegment(speaker, text, /[\u1000-\u109F]/.test(text) ? 'my' : 'en');
  });

  document.getElementById('manualUtteranceInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnAddUtterance').click();
  });

  // Generate Summary & Tasks
  document.getElementById('btnAnalyzeLiveMeeting').addEventListener('click', () => triggerAnalyzeCurrentMeeting());

  // Document Template Pills inside Export Tab
  document.querySelectorAll('.tpl-pill').forEach(pill => {
    pill.addEventListener('click', async () => {
      document.querySelectorAll('.tpl-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const docType = pill.dataset.docTpl;
      const m = getActiveMeeting();
      if (!m) return;

      showToast('Formatting document...');
      const res = await fetch(`/api/meetings/${m.id}/generate-doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType })
      });
      const data = await res.json();
      if (res.ok && data.doc) {
        document.getElementById('docTitleInput').value = data.doc.title;
        const mdEd = document.getElementById('docMarkdownEditor');
        mdEd.value = data.doc.content;
        document.getElementById('docRenderedPreview').innerHTML = simpleMarkdownToHtml(data.doc.content);
        const idx = state.meetings.findIndex(x => x.id === m.id);
        if (idx !== -1) state.meetings[idx] = data.meeting;
      }
    });
  });

  document.getElementById('docMarkdownEditor').addEventListener('input', (e) => {
    document.getElementById('docRenderedPreview').innerHTML = simpleMarkdownToHtml(e.target.value);
  });

  // Export Buttons
  document.getElementById('btnCopyDocMd').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('docMarkdownEditor').value);
    showToast('Copied document to clipboard');
  });

  document.getElementById('btnExportMd').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'meeting-minutes';
    downloadFile(`${slugify(title)}.md`, document.getElementById('docMarkdownEditor').value, 'text/markdown;charset=utf-8');
  });

  document.getElementById('btnExportWord').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'Meeting-Minutes';
    const htmlBody = simpleMarkdownToHtml(document.getElementById('docMarkdownEditor').value);
    const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${escapeHtml(title)}</title>
      <style>body{font-family:'Calibri','Noto Sans Myanmar',sans-serif;line-height:1.6;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #999;padding:6px;}</style>
      </head><body>${htmlBody}</body></html>`;
    downloadFile(`${slugify(title)}.doc`, wordDoc, 'application/msword;charset=utf-8');
  });

  document.getElementById('btnPrintPdf').addEventListener('click', () => {
    const title = document.getElementById('docTitleInput').value || 'Meeting Document';
    const htmlBody = simpleMarkdownToHtml(document.getElementById('docMarkdownEditor').value);
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>${escapeHtml(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Myanmar:wght@400;600&display=swap" rel="stylesheet">
      <style>body{font-family:'Inter','Noto Sans Myanmar',sans-serif;padding:40px;color:#111;line-height:1.65;} table{border-collapse:collapse;width:100%;margin:16px 0;} th,td{border:1px solid #ccc;padding:8px;text-align:left;}</style>
      </head><body>${htmlBody}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 350);
  });

  // Claude Pro Modal
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
    await navigator.clipboard.writeText(document.getElementById('claudePromptBox').value);
    showToast('Prompt copied — paste into Claude.ai');
    window.open('https://claude.ai/new', '_blank');
  });

  document.getElementById('btnJustCopyClaudePrompt').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('claudePromptBox').value);
    showToast('Prompt copied');
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
      showToast(data.error || 'Could not parse response');
      return;
    }
    const idx = state.meetings.findIndex(x => x.id === m.id);
    if (idx !== -1) state.meetings[idx] = data.meeting;
    if (data.createdTasks?.length) state.tasks = [...data.createdTasks, ...state.tasks];
    document.getElementById('claudeBridgeModal').classList.add('hidden');
    switchDocSubTab('summary');
    renderAll();
    showToast(`Imported summary & ${data.createdTasks?.length || 0} tasks`);
  });

  // Action Tasks View Switcher (Board / List)
  document.querySelectorAll('.view-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.view-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const mode = pill.dataset.pmmode;
      document.getElementById('pmKanbanView').classList.toggle('hidden', mode !== 'kanban');
      document.getElementById('pmListView').classList.toggle('hidden', mode !== 'list');
    });
  });

  document.getElementById('globalProjectFilter').addEventListener('change', (e) => {
    state.selectedProjectFilter = e.target.value;
    renderSidebar();
    renderTasksWorkspace();
  });

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
      renderSidebar();
      renderTasksWorkspace();
      showToast('Task added');
    }
  });

  document.getElementById('quickTaskTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnQuickAddTask').click();
  });

  document.getElementById('btnNewProjectModal').addEventListener('click', async () => {
    const name = prompt('New Project Name:');
    if (!name) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const p = await res.json();
      state.projects.push(p);
      renderAll();
      showToast(`Created project "${p.name}"`);
    }
  });

  // Calendar & Settings
  document.getElementById('btnConnectGoogle').addEventListener('click', async () => {
    const res = await fetch('/api/calendar/google/auth');
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else showToast(data.error || 'Add Google Client ID in Settings, or use a private .ics link below');
  });

  document.getElementById('btnConnectMicrosoft').addEventListener('click', async () => {
    const res = await fetch('/api/calendar/microsoft/auth');
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else showToast(data.error || 'Add Microsoft Client ID in Settings, or use a private .ics link below');
  });

  document.getElementById('btnSyncCalendars').addEventListener('click', async () => {
    showToast('Syncing calendars...');
    const res = await fetch('/api/calendar/sync', { method: 'POST' });
    const data = await res.json();
    state.calendarEvents = data.calendarEvents || state.calendarEvents;
    renderCalendarWorkspace();
    showToast('Calendars synced');
  });

  document.getElementById('btnAddIcsFeed').addEventListener('click', async () => {
    const label = document.getElementById('icsLabelInput').value.trim() || 'Calendar';
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
    const meetingUrl = prompt('Meeting Link (Google Meet / Teams URL - optional):') || '';
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
      renderCalendarWorkspace();
      renderUpcomingBanner();
      showToast('Meeting added');
    }
  });

  document.getElementById('btnSaveAiSettings').addEventListener('click', async () => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: document.getElementById('setAiProvider').value,
        anthropicApiKey: document.getElementById('setAnthropicKey').value.trim(),
        anthropicModel: document.getElementById('setAnthropicModel').value.trim(),
        geminiApiKey: document.getElementById('setGeminiKey').value.trim(),
        autoAddActionItemsToPM: document.getElementById('setAutoAddPm').checked
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      showToast('Settings saved');
    }
  });

  document.getElementById('btnSaveOAuthSettings').addEventListener('click', async () => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleClientId: document.getElementById('setGoogleClientId').value.trim(),
        googleClientSecret: document.getElementById('setGoogleClientSecret').value.trim(),
        googleRedirectUri: document.getElementById('setGoogleRedirect').value.trim(),
        msClientId: document.getElementById('setMsClientId').value.trim(),
        msClientSecret: document.getElementById('setMsClientSecret').value.trim(),
        msRedirectUri: document.getElementById('setMsRedirect').value.trim()
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.settings = data.settings;
      showToast('OAuth settings saved');
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
        html += '<table style="width:100%;border-collapse:collapse;margin:12px 0;">';
        inTable = true;
      }
      const cells = line.split('|').slice(1, -1).map(c => `<td style="border:1px solid var(--border-color);padding:7px 10px;">${escapeHtml(c.trim())}</td>`).join('');
      html += `<tr>${cells}</tr>`;
      continue;
    } else if (inTable) {
      html += '</table>';
      inTable = false;
    }

    if (line.startsWith('# ')) html += `<h2 style="margin:12px 0 6px;">${escapeHtml(line.slice(2))}</h2>`;
    else if (line.startsWith('## ')) html += `<h3 style="margin:14px 0 6px;font-size:15px;">${escapeHtml(line.slice(3))}</h3>`;
    else if (line.startsWith('### ')) html += `<h4 style="margin:10px 0 4px;font-size:13.5px;">${escapeHtml(line.slice(4))}</h4>`;
    else if (line.startsWith('- ')) html += `<li style="margin-left:18px;">${escapeHtml(line.slice(2))}</li>`;
    else if (line.trim() === '---') html += '<hr style="border:none;border-top:1px solid var(--border-color);margin:14px 0;"/>';
    else if (line.trim() === '') html += '<div style="height:6px;"></div>';
    else html += `<p style="margin-bottom:6px;">${escapeHtml(line)}</p>`;
  }
  if (inTable) html += '</table>';
  return html;
}
