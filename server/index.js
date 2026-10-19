require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadDb, saveDb, uid } = require('./db');
const {
  buildMeetingPrompt,
  buildDocumentPrompt,
  analyzeMeeting,
  generateDocument,
  transcribeBurmeseAudioChunk,
  parseJsonSafely
} = require('./ai-service');
const {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleCalendarEvents,
  getMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftCalendarEvents,
  fetchAndParseIcsFeed
} = require('./calendar-service');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to mask secrets when sending state to client
function getSafeSettings(settings, tokens) {
  return {
    ...settings,
    anthropicApiKey: settings.anthropicApiKey ? '••••••••' + settings.anthropicApiKey.slice(-4) : '',
    hasAnthropicKey: Boolean(settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    geminiApiKey: settings.geminiApiKey ? '••••••••' + settings.geminiApiKey.slice(-4) : '',
    hasGeminiKey: Boolean(settings.geminiApiKey || process.env.GEMINI_API_KEY),
    googleConnected: Boolean(tokens?.google?.access_token),
    microsoftConnected: Boolean(tokens?.microsoft?.access_token)
  };
}

// Get full application state
app.get('/api/state', (req, res) => {
  const db = loadDb();
  res.json({
    projects: db.projects,
    meetings: db.meetings,
    tasks: db.tasks,
    calendarEvents: db.calendarEvents,
    settings: getSafeSettings(db.settings, db.tokens)
  });
});

// Update settings
app.put('/api/settings', (req, res) => {
  const db = loadDb();
  const incoming = req.body || {};

  const updated = { ...db.settings };
  for (const [k, v] of Object.entries(incoming)) {
    if ((k === 'anthropicApiKey' || k === 'geminiApiKey') && typeof v === 'string' && v.startsWith('••••')) {
      continue; // keep existing secret
    }
    updated[k] = v;
  }
  db.settings = updated;
  saveDb(db);
  res.json({ settings: getSafeSettings(db.settings, db.tokens) });
});

// ========================
// MEETINGS & LIVE RECORDER
// ========================

app.post('/api/meetings', (req, res) => {
  const db = loadDb();
  const { title, platform, projectId, language, participants, notes, calendarEventId } = req.body;
  const newMeeting = {
    id: uid('meet'),
    title: title || `Meeting - ${new Date().toLocaleString()}`,
    date: new Date().toISOString(),
    durationSeconds: 0,
    platform: platform || 'Google Meet / Tab Audio',
    projectId: projectId || (db.projects[0]?.id || 'proj-personal'),
    language: language || 'en + my',
    participants: Array.isArray(participants) ? participants : ['Ethan (You)'],
    notes: notes || '',
    calendarEventId: calendarEventId || null,
    transcript: [],
    summary: null,
    documents: []
  };
  db.meetings.unshift(newMeeting);
  saveDb(db);
  res.json(newMeeting);
});

app.put('/api/meetings/:id', (req, res) => {
  const db = loadDb();
  const idx = db.meetings.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Meeting not found' });

  db.meetings[idx] = {
    ...db.meetings[idx],
    ...req.body,
    id: db.meetings[idx].id
  };
  saveDb(db);
  res.json(db.meetings[idx]);
});

app.delete('/api/meetings/:id', (req, res) => {
  const db = loadDb();
  db.meetings = db.meetings.filter(m => m.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// Append live transcript segment
app.post('/api/meetings/:id/segment', (req, res) => {
  const db = loadDb();
  const meeting = db.meetings.find(m => m.id === req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const segment = {
    id: uid('seg'),
    speaker: req.body.speaker || 'Speaker',
    timestamp: req.body.timestamp || '00:00',
    text: req.body.text || '',
    lang: req.body.lang || 'en'
  };
  meeting.transcript.push(segment);
  if (typeof req.body.durationSeconds === 'number') {
    meeting.durationSeconds = req.body.durationSeconds;
  }
  saveDb(db);
  res.json({ segment, meeting });
});

// Analyze meeting -> Summarize + Extract Action Items -> Auto-populate PM Tasks
app.post('/api/meetings/:id/analyze', async (req, res) => {
  try {
    const db = loadDb();
    const meeting = db.meetings.find(m => m.id === req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const project = db.projects.find(p => p.id === meeting.projectId);
    const { result, providerUsed, claudePrompt } = await analyzeMeeting(meeting, project, db.settings);

    meeting.summary = {
      executiveSummary: result.executiveSummary || '',
      keyDecisions: result.keyDecisions || [],
      keyDiscussionPoints: result.keyDiscussionPoints || [],
      risksAndBlockers: result.risksAndBlockers || []
    };

    const createdTasks = [];
    const autoAdd = req.body.autoAddTasks !== undefined ? req.body.autoAddTasks : db.settings.autoAddActionItemsToPM;

    if (autoAdd && Array.isArray(result.actionItems)) {
      for (const item of result.actionItems) {
        // Avoid duplicate task titles for the same meeting
        const exists = db.tasks.some(
          t => t.meetingId === meeting.id && t.title.toLowerCase() === (item.title || '').toLowerCase()
        );
        if (!exists && item.title) {
          const newTask = {
            id: uid('task'),
            title: item.title,
            description: item.description || `From meeting: ${meeting.title}`,
            status: 'todo',
            priority: ['high', 'medium', 'low'].includes((item.priority || '').toLowerCase())
              ? item.priority.toLowerCase()
              : 'medium',
            assignee: item.assignee || 'Ethan',
            dueDate: item.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
            projectId: meeting.projectId || 'proj-personal',
            meetingId: meeting.id,
            meetingTimestamp: item.meetingTimestamp || '00:00',
            autoExtracted: true,
            createdAt: new Date().toISOString()
          };
          db.tasks.unshift(newTask);
          createdTasks.push(newTask);
        }
      }
    }

    saveDb(db);
    res.json({
      meeting,
      createdTasks,
      providerUsed,
      claudePrompt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Claude Pro prompt for 1-click copy to claude.ai web subscription
app.get('/api/meetings/:id/claude-prompt', (req, res) => {
  const db = loadDb();
  const meeting = db.meetings.find(m => m.id === req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  const project = db.projects.find(p => p.id === meeting.projectId);
  const mode = req.query.mode || 'analyze';
  const prompt = mode === 'doc'
    ? buildDocumentPrompt(meeting, req.query.docType || 'mom', project)
    : buildMeetingPrompt(meeting, project);
  res.json({ prompt });
});

// Import response pasted from Claude Pro web UI
app.post('/api/meetings/:id/import-claude', (req, res) => {
  try {
    const db = loadDb();
    const meeting = db.meetings.find(m => m.id === req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const { rawResponse } = req.body;
    const parsed = parseJsonSafely(rawResponse);

    meeting.summary = {
      executiveSummary: parsed.executiveSummary || '',
      keyDecisions: parsed.keyDecisions || [],
      keyDiscussionPoints: parsed.keyDiscussionPoints || [],
      risksAndBlockers: parsed.risksAndBlockers || []
    };

    const createdTasks = [];
    if (Array.isArray(parsed.actionItems)) {
      for (const item of parsed.actionItems) {
        if (!item.title) continue;
        const newTask = {
          id: uid('task'),
          title: item.title,
          description: item.description || `Extracted via Claude Pro from ${meeting.title}`,
          status: 'todo',
          priority: ['high', 'medium', 'low'].includes((item.priority || '').toLowerCase())
            ? item.priority.toLowerCase()
            : 'medium',
          assignee: item.assignee || 'Ethan',
          dueDate: item.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
          projectId: meeting.projectId || 'proj-personal',
          meetingId: meeting.id,
          meetingTimestamp: item.meetingTimestamp || '00:00',
          autoExtracted: true,
          createdAt: new Date().toISOString()
        };
        db.tasks.unshift(newTask);
        createdTasks.push(newTask);
      }
    }

    saveDb(db);
    res.json({ meeting, createdTasks });
  } catch (err) {
    res.status(400).json({ error: `Could not parse Claude JSON output: ${err.message}` });
  }
});

// Generate rich document (MOM, PRD, Follow-up Email, Bilingual Report, Sprint Spec)
app.post('/api/meetings/:id/generate-doc', async (req, res) => {
  try {
    const db = loadDb();
    const meeting = db.meetings.find(m => m.id === req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const docType = req.body.docType || 'mom';
    const project = db.projects.find(p => p.id === meeting.projectId);
    const meetingTasks = db.tasks.filter(t => t.meetingId === meeting.id);

    const { content, providerUsed, claudePrompt } = await generateDocument(
      meeting,
      docType,
      project,
      meetingTasks,
      db.settings
    );

    const docTitles = {
      mom: `Minutes of Meeting: ${meeting.title}`,
      prd: `Technical & Product Spec (PRD): ${meeting.title}`,
      followup: `Follow-up Email & Action Plan: ${meeting.title}`,
      bilingual: `Bilingual Executive Report (EN/မြန်မာ): ${meeting.title}`,
      sprint: `Sprint Backlog & Engineering Breakdown: ${meeting.title}`
    };

    const doc = {
      id: uid('doc'),
      type: docType,
      title: docTitles[docType] || `Document: ${meeting.title}`,
      createdAt: new Date().toISOString(),
      content
    };

    meeting.documents = meeting.documents || [];
    meeting.documents.unshift(doc);
    saveDb(db);

    res.json({ doc, meeting, providerUsed, claudePrompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Burmese (မြန်မာဘာသာ) Multimodal Audio Chunk Transcription endpoint
app.post('/api/ai/transcribe-burmese', async (req, res) => {
  try {
    const db = loadDb();
    const { audioBase64, mimeType, languageHint } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Missing audioBase64 payload' });
    const text = await transcribeBurmeseAudioChunk(audioBase64, mimeType, db.settings, languageHint || 'my');
    res.json({ text });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========================
// PERSONAL AUTO-PM TOOL
// ========================

app.post('/api/projects', (req, res) => {
  const db = loadDb();
  const project = {
    id: uid('proj'),
    name: req.body.name || 'New Project',
    color: req.body.color || '#6366f1',
    description: req.body.description || '',
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  saveDb(db);
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  const db = loadDb();
  db.projects = db.projects.filter(p => p.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

app.post('/api/tasks', (req, res) => {
  const db = loadDb();
  const task = {
    id: uid('task'),
    title: req.body.title || 'Untitled Task',
    description: req.body.description || '',
    status: req.body.status || 'todo',
    priority: req.body.priority || 'medium',
    assignee: req.body.assignee || 'Ethan',
    dueDate: req.body.dueDate || new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    projectId: req.body.projectId || (db.projects[0]?.id || 'proj-personal'),
    meetingId: req.body.meetingId || null,
    meetingTimestamp: req.body.meetingTimestamp || null,
    autoExtracted: Boolean(req.body.autoExtracted),
    createdAt: new Date().toISOString()
  };
  db.tasks.unshift(task);
  saveDb(db);
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const db = loadDb();
  const idx = db.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  db.tasks[idx] = {
    ...db.tasks[idx],
    ...req.body,
    id: db.tasks[idx].id
  };
  saveDb(db);
  res.json(db.tasks[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const db = loadDb();
  db.tasks = db.tasks.filter(t => t.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ========================
// CALENDAR INTEGRATIONS
// ========================

app.get('/api/calendar/google/auth', (req, res) => {
  try {
    const db = loadDb();
    const url = getGoogleAuthUrl(db.settings);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/calendar/google/callback', async (req, res) => {
  try {
    const db = loadDb();
    const tokens = await exchangeGoogleCode(req.query.code, db.settings);
    db.tokens.google = tokens;
    const events = await fetchGoogleCalendarEvents(tokens, db.settings);
    db.calendarEvents = [
      ...db.calendarEvents.filter(e => e.source !== 'Google Calendar'),
      ...events
    ];
    saveDb(db);
    res.redirect('/?calendar_connected=google');
  } catch (err) {
    res.status(400).send(`Google Calendar OAuth Error: ${err.message}`);
  }
});

app.get('/api/calendar/microsoft/auth', (req, res) => {
  try {
    const db = loadDb();
    const url = getMicrosoftAuthUrl(db.settings);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/calendar/microsoft/callback', async (req, res) => {
  try {
    const db = loadDb();
    const tokens = await exchangeMicrosoftCode(req.query.code, db.settings);
    db.tokens.microsoft = tokens;
    const events = await fetchMicrosoftCalendarEvents(tokens);
    db.calendarEvents = [
      ...db.calendarEvents.filter(e => e.source !== 'Microsoft Teams'),
      ...events
    ];
    saveDb(db);
    res.redirect('/?calendar_connected=microsoft');
  } catch (err) {
    res.status(400).send(`Microsoft Teams Calendar OAuth Error: ${err.message}`);
  }
});

// Sync calendars (OAuth + ICS feeds)
app.post('/api/calendar/sync', async (req, res) => {
  const db = loadDb();
  const synced = [];
  const errors = [];

  if (db.tokens?.google?.access_token) {
    try {
      const gEvents = await fetchGoogleCalendarEvents(db.tokens.google, db.settings);
      synced.push(...gEvents);
    } catch (e) {
      errors.push(`Google Calendar: ${e.message}`);
    }
  }

  if (db.tokens?.microsoft?.access_token) {
    try {
      const mEvents = await fetchMicrosoftCalendarEvents(db.tokens.microsoft);
      synced.push(...mEvents);
    } catch (e) {
      errors.push(`Microsoft Teams: ${e.message}`);
    }
  }

  for (const feed of db.settings.icsFeeds || []) {
    if (!feed.url) continue;
    try {
      const icsEvents = await fetchAndParseIcsFeed(feed.url, feed.label || 'ICS Feed');
      synced.push(...icsEvents);
    } catch (e) {
      errors.push(`${feed.label || 'ICS'}: ${e.message}`);
    }
  }

  if (synced.length > 0) {
    const manualEvents = db.calendarEvents.filter(e => e.id.startsWith('cal-demo-') || e.id.startsWith('cal-manual-'));
    db.calendarEvents = [...synced, ...manualEvents];
    saveDb(db);
  }

  res.json({
    calendarEvents: db.calendarEvents,
    syncedCount: synced.length,
    errors
  });
});

// Add custom calendar event or ICS feed
app.post('/api/calendar/events', (req, res) => {
  const db = loadDb();
  const ev = {
    id: uid('cal-manual'),
    title: req.body.title || 'Scheduled Meeting',
    start: req.body.start || new Date().toISOString(),
    end: req.body.end || new Date(Date.now() + 3600000).toISOString(),
    source: req.body.source || 'Google Calendar',
    meetingUrl: req.body.meetingUrl || '',
    platform: req.body.platform || 'Google Meet',
    attendees: req.body.attendees || ['Ethan'],
    projectId: req.body.projectId || 'proj-personal'
  };
  db.calendarEvents.unshift(ev);
  saveDb(db);
  res.json(ev);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'meetflow-ai', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`MeetFlow AI Server running on http://localhost:${PORT}`);
});
