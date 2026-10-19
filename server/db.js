const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(DATA_DIR, 'meetflow-store.json');

const DEFAULT_DATA = {
  settings: {
    aiProvider: 'claude_bridge', // 'claude_api' | 'gemini_api' | 'claude_bridge' | 'smart_local'
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: 'claude-3-7-sonnet-latest',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: 'gemini-2.5-flash',
    defaultTranscriptionEngine: 'whisper_offline', // 'whisper_offline' | 'burmese_hybrid' | 'webspeech_en'
    autoAddActionItemsToPM: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/calendar/google/callback',
    msClientId: process.env.MS_CLIENT_ID || '',
    msClientSecret: process.env.MS_CLIENT_SECRET || '',
    msTenantId: process.env.MS_TENANT_ID || 'common',
    msRedirectUri: process.env.MS_REDIRECT_URI || 'http://localhost:8080/api/calendar/microsoft/callback',
    icsFeeds: []
  },
  tokens: {
    google: null,
    microsoft: null
  },
  projects: [
    {
      id: 'proj-gcp-launch',
      name: 'GCP Cloud Platform Migration',
      color: '#6366f1',
      description: 'Core cloud infrastructure, API gateway, and deployment automation.',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString()
    },
    {
      id: 'proj-product-q4',
      name: 'Product Roadmap & Client Delivery',
      color: '#10b981',
      description: 'Feature delivery, Burmese localization, and stakeholder syncs.',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString()
    },
    {
      id: 'proj-personal',
      name: 'Personal & Admin Ops',
      color: '#f59e0b',
      description: 'General follow-ups and personal action items from daily calls.',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString()
    }
  ],
  meetings: [
    {
      id: 'meet-sample-1',
      title: 'Sprint Architecture & GCP Deployment Sync',
      date: new Date(Date.now() - 3600000 * 4).toISOString(),
      durationSeconds: 1420,
      platform: 'Google Meet',
      projectId: 'proj-gcp-launch',
      language: 'en + my',
      participants: ['Ethan (You)', 'Alex Rivera', 'Ko Thura'],
      notes: '- Need Cloud Run autoscaling set to min 0, max 3 for cost control.\n- Burmese transcription accuracy is critical for local client interviews.',
      transcript: [
        {
          id: 'seg-1',
          speaker: 'Alex Rivera',
          timestamp: '00:15',
          text: 'Hey Ethan, let us finalize the GCP Cloud Run deployment pipeline before Friday. We need Docker builds automated via Cloud Build.',
          lang: 'en'
        },
        {
          id: 'seg-2',
          speaker: 'Ethan (You)',
          timestamp: '00:42',
          text: 'Agreed. I will set up the Dockerfile and cloudbuild.yaml today so every push to GitHub automatically deploys the container.',
          lang: 'en'
        },
        {
          id: 'seg-3',
          speaker: 'Ko Thura',
          timestamp: '01:18',
          text: 'ကျွန်တော်တို့ client meeting တွေမှာ မြန်မာလိုရော အင်္ဂလိပ်လိုရော ရောပြောကြတာများတယ်ဗျ။ အဲဒါကြောင့် meeting minutes ထုတ်တဲ့အခါ action items တွေကို project board ထဲ တန်းဝင်အောင် လုပ်ထားရင် အရမ်းသက်သာမယ်။',
          lang: 'my'
        },
        {
          id: 'seg-4',
          speaker: 'Ethan (You)',
          timestamp: '01:55',
          text: 'Yes, we will use Offline Whisper for English sessions and Gemini/Hybrid Myanmar ASR for Burmese meetings, and auto-push action items straight into our Kanban board.',
          lang: 'en'
        }
      ],
      summary: {
        executiveSummary: 'The team aligned on deploying the application to GCP Cloud Run using automated Docker builds and integrating dual-language (English Offline Whisper + Burmese ASR) meeting transcription that automatically populates the personal Kanban project board.',
        keyDecisions: [
          'Deploy as a containerized Node.js web app on GCP Cloud Run with max 3 instances for cost efficiency.',
          'Use Offline Whisper (in-browser WASM/WebGPU) for English and Hybrid Burmese ASR for Myanmar meetings.',
          'Eliminate manual PM overhead by automatically turning meeting action items into Kanban tasks.'
        ],
        keyDiscussionPoints: [
          'Cloud Build CI/CD integration with GitHub repository under EthannMK.',
          'Handling bilingual English + Burmese (မြန်မာ) code-switching during client discussions.',
          'Direct synchronization with Google Calendar and Microsoft Teams.'
        ],
        risksAndBlockers: [
          'OAuth redirect URIs must be updated in Google Cloud Console and Azure Portal once the production Cloud Run URL is live.'
        ]
      },
      documents: [
        {
          id: 'doc-sample-1',
          type: 'mom',
          title: 'Minutes of Meeting: Sprint Architecture & GCP Deployment Sync',
          createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
          content: `# Minutes of Meeting (MOM)\n**Meeting:** Sprint Architecture & GCP Deployment Sync\n**Date:** ${new Date().toISOString().split('T')[0]}\n**Participants:** Ethan (You), Alex Rivera, Ko Thura\n\n## 1. Executive Summary\nThe team finalized the architecture for the GCP-hosted live meeting recorder and automated personal project management workspace.\n\n## 2. Key Decisions\n- Host on **GCP Cloud Run** using Docker.\n- Use **Offline Whisper** for English capture and **Burmese Hybrid ASR** for Myanmar sessions.\n- Automatically route extracted Action Items to the Kanban board.\n\n## 3. Action Items\n- **[HIGH]** Configure Dockerfile & GCP Cloud Run deployment script — *Owner: Ethan*\n- **[MEDIUM]** Test Burmese + English mixed transcription with client audio — *Owner: Ko Thura*`
        }
      ]
    }
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Set up Dockerfile and cloudbuild.yaml for GCP Cloud Run auto-deploy',
      description: 'Ensure container listens on PORT=8080 and persists data cleanly.',
      status: 'in_progress',
      priority: 'high',
      assignee: 'Ethan',
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
      projectId: 'proj-gcp-launch',
      meetingId: 'meet-sample-1',
      meetingTimestamp: '00:42',
      autoExtracted: true,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
    },
    {
      id: 'task-2',
      title: 'Test Burmese (မြန်မာ) + English mixed audio transcription workflow',
      description: 'Verify Myanmar Unicode output and automatic action item extraction from bilingual calls.',
      status: 'todo',
      priority: 'high',
      assignee: 'Ethan',
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
      projectId: 'proj-product-q4',
      meetingId: 'meet-sample-1',
      meetingTimestamp: '01:18',
      autoExtracted: true,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
    },
    {
      id: 'task-3',
      title: 'Connect Google Calendar & Microsoft Teams ICS / OAuth feeds',
      description: 'Link calendar events so upcoming calls can be recorded with 1 click.',
      status: 'todo',
      priority: 'medium',
      assignee: 'Ethan',
      dueDate: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
      projectId: 'proj-personal',
      meetingId: 'meet-sample-1',
      meetingTimestamp: '00:15',
      autoExtracted: true,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
    }
  ],
  calendarEvents: [
    {
      id: 'cal-demo-1',
      title: 'Weekly Product & Engineering Sync',
      start: new Date(Date.now() + 1800000).toISOString(),
      end: new Date(Date.now() + 5400000).toISOString(),
      source: 'Google Calendar',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'Google Meet',
      attendees: ['Ethan', 'Alex Rivera', 'Sarah Chen'],
      projectId: 'proj-product-q4'
    },
    {
      id: 'cal-demo-2',
      title: 'Yangon Client Requirements Review (Burmese/English)',
      start: new Date(Date.now() + 86400000).toISOString(),
      end: new Date(Date.now() + 86400000 + 3600000).toISOString(),
      source: 'Microsoft Teams',
      meetingUrl: 'https://teams.microsoft.com/l/meetup-join/sample',
      platform: 'MS Teams',
      attendees: ['Ethan', 'Ko Thura', 'Ma Hnin'],
      projectId: 'proj-product-q4'
    }
  ]
};

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
      return structuredClone(DEFAULT_DATA);
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DATA,
      ...parsed,
      settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) }
    };
  } catch (err) {
    console.error('Error loading DB, using defaults:', err);
    return structuredClone(DEFAULT_DATA);
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function uid(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = {
  loadDb,
  saveDb,
  uid
};
