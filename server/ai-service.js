/**
 * AI & Speech Service for MeetFlow AI
 * - Supports Anthropic Claude API
 * - Supports Claude Pro Web Subscription Bridge (Prompt Builder + Response Parser)
 * - Supports Google Gemini 2.5 Multimodal Audio ASR (Best-in-class for Burmese မြန်မာ + English code-switching)
 * - Supports Smart Bilingual Local NLP Engine (English + Burmese fallback with zero API keys)
 */

function buildMeetingPrompt(meeting, project) {
  const transcriptText = (meeting.transcript || [])
    .map(t => `[${t.timestamp || '00:00'}] ${t.speaker || 'Speaker'}: ${t.text}`)
    .join('\n');

  return `You are an expert Executive Meeting Assistant & Technical Project Manager fluent in both English and Burmese (မြန်မာဘာသာ).
Analyze the following meeting recording transcript and live notes.

Meeting Title: ${meeting.title}
Date: ${meeting.date}
Platform: ${meeting.platform || 'Web Meeting'}
Project Context: ${project ? `${project.name} (${project.description || ''})` : 'General'}
Participants: ${(meeting.participants || []).join(', ') || 'Participants'}

Live Notes Taken During Call:
${meeting.notes || '(None)'}

Full Transcript (may contain English, Burmese / မြန်မာ, or mixed code-switching):
${transcriptText || '(No transcript segments recorded yet)'}

Return ONLY valid JSON (no markdown code fences around it) matching this exact schema:
{
  "executiveSummary": "Concise 2-4 sentence executive summary of what was discussed and agreed (include Burmese context if applicable).",
  "keyDecisions": ["Decision 1", "Decision 2"],
  "keyDiscussionPoints": ["Point 1", "Point 2", "Point 3"],
  "risksAndBlockers": ["Risk or blocker 1"],
  "actionItems": [
    {
      "title": "Clear actionable task title",
      "description": "Context and acceptance criteria from the discussion",
      "assignee": "Person responsible (default to 'Ethan' if self or unspecified)",
      "priority": "high | medium | low",
      "dueDate": "YYYY-MM-DD (estimate based on discussion or within 3-5 days)",
      "meetingTimestamp": "MM:SS where this was discussed"
    }
  ]
}`;
}

function buildDocumentPrompt(meeting, docType, project) {
  const transcriptText = (meeting.transcript || [])
    .map(t => `[${t.timestamp || '00:00'}] ${t.speaker || 'Speaker'}: ${t.text}`)
    .join('\n');

  const summaryText = meeting.summary
    ? JSON.stringify(meeting.summary, null, 2)
    : 'Not summarized yet.';

  const typeInstructions = {
    mom: 'Generate a comprehensive, formal Minutes of Meeting (MOM) document in Markdown with Executive Summary, Attendees, Detailed Discussion Log, Key Decisions, Risks, and an Action Items Table.',
    prd: 'Generate a detailed Product Requirements Document (PRD) & Technical Architecture Specification based on the meeting discussion. Include Problem Statement, Goals, Functional Requirements, Technical Stack / Infrastructure Notes, and Implementation Milestones.',
    followup: 'Generate a polished, ready-to-send Stakeholder Follow-up Email & Action Tracker summarizing agreements, next steps, owners, and deadlines.',
    bilingual: 'Generate a Bilingual Executive Report in both English and Burmese (မြန်မာဘာသာ Unicode). Include full English and Myanmar sections for Summary, Decisions (ဆုံးဖြတ်ချက်များ), and Action Items (ဆက်လက်လုပ်ဆောင်ရန်များ).',
    sprint: 'Generate an Agile Sprint Planning & Engineering Task Breakdown document with Epics, User Stories, Acceptance Criteria, and Story Point estimates.'
  };

  return `You are a Principal Technical Writer & Project Manager fluent in English and Burmese (မြန်မာဘာသာ).
${typeInstructions[docType] || typeInstructions.mom}

Meeting Title: ${meeting.title}
Date: ${meeting.date}
Project: ${project ? project.name : 'General'}
Participants: ${(meeting.participants || []).join(', ')}
Live Notes:
${meeting.notes || '(None)'}

Existing Structured Summary:
${summaryText}

Full Transcript:
${transcriptText}

Output clean, well-structured Markdown.`;
}

async function callClaudeApi(prompt, settings, expectJson = false) {
  const apiKey = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API Key is not configured.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.anthropicModel || 'claude-3-7-sonnet-latest',
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  if (expectJson) {
    return parseJsonSafely(text);
  }
  return text;
}

async function callGeminiApi(prompt, settings, expectJson = false) {
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API Key is not configured.');
  }
  const model = settings.geminiModel || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2
    }
  };
  if (expectJson) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (expectJson) {
    return parseJsonSafely(text);
  }
  return text;
}

/**
 * Transcribe Burmese (မြန်မာဘာသာ) or Mixed Burmese+English Audio Chunk using Gemini Multimodal Audio ASR
 */
async function transcribeBurmeseAudioChunk(audioBase64, mimeType, settings, languageHint = 'my') {
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('To use Cloud High-Accuracy Burmese Multimodal ASR, add a free Gemini API Key in Settings, or use Live Browser Burmese (my-MM) stream.');
  }

  const model = settings.geminiModel || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const instruction = languageHint === 'my'
    ? `Transcribe this audio accurately in Myanmar Unicode (မြန်မာဘာသာ) and keep any English technical terms or names in English as spoken. If there is silence or only background noise, return an empty string "". Return ONLY the spoken transcript text without any commentary.`
    : `Transcribe this audio accurately (supports English and Burmese/Myanmar Unicode). If silence, return "". Return ONLY the spoken words.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: instruction },
            {
              inlineData: {
                mimeType: mimeType || 'audio/webm',
                data: audioBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Burmese Audio ASR error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

function parseJsonSafely(rawText) {
  if (!rawText) throw new Error('Empty AI response');
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw e;
  }
}

/**
 * Smart Local Bilingual (English + Burmese) Analyzer so the app works immediately out-of-the-box
 * even before API keys are configured.
 */
function smartLocalAnalyze(meeting, project) {
  const segments = meeting.transcript || [];
  const notesLines = (meeting.notes || '')
    .split('\n')
    .map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const allSentences = [
    ...segments.map(s => ({
      speaker: s.speaker || 'Ethan',
      timestamp: s.timestamp || '00:00',
      text: s.text || ''
    })),
    ...notesLines.map(n => ({
      speaker: 'Meeting Note',
      timestamp: 'Note',
      text: n
    }))
  ];

  const actionPatterns = [
    /\b(i will|i'll|we will|we'll|need to|needs to|should|must|todo|action item|follow up|let's|assign|prepare|deploy|configure|send|create|fix|update|review|test)\b/i,
    /(လုပ်ပေးမယ်|လုပ်ရမယ်|လုပ်ကြမယ်|တာဝန်|အပြီး|ပို့ပေး|စစ်ပေး|ဆောင်ရွက်|ထည့်ထား|ပြင်ပေး)/
  ];

  const decisionPatterns = [
    /\b(agreed|decided|confirmed|finalized|approved|we are going with|will use|chosen)\b/i,
    /(သဘောတူ|ဆုံးဖြတ်|အတည်ပြု|သုံးမယ်)/
  ];

  const riskPatterns = [
    /\b(risk|blocker|issue|problem|concern|delay|careful|critical|burden|bottleneck)\b/i,
    /(အခက်အခဲ|သတိထား|ပြဿနာ|ကြန့်ကြာ)/
  ];

  const actionItems = [];
  const keyDecisions = [];
  const risksAndBlockers = [];
  const keyDiscussionPoints = [];

  const defaultDue = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];

  for (const item of allSentences) {
    const txt = item.text.trim();
    if (!txt) continue;

    if (actionPatterns.some(rx => rx.test(txt))) {
      const priority = /\b(urgent|critical|asap|high|today|friday|အရေးကြီး)\b/i.test(txt) ? 'high' : 'medium';
      actionItems.push({
        title: txt.length > 95 ? txt.slice(0, 92) + '...' : txt,
        description: `Extracted from ${item.speaker} at [${item.timestamp}]: "${txt}"`,
        assignee: item.speaker.includes('You') || item.speaker === 'Meeting Note' ? 'Ethan' : item.speaker,
        priority,
        dueDate: defaultDue,
        meetingTimestamp: item.timestamp
      });
    }

    if (decisionPatterns.some(rx => rx.test(txt))) {
      keyDecisions.push(txt);
    }

    if (riskPatterns.some(rx => rx.test(txt))) {
      risksAndBlockers.push(txt);
    }

    if (keyDiscussionPoints.length < 6 && txt.length > 20) {
      keyDiscussionPoints.push(`[${item.timestamp}] ${item.speaker}: ${txt}`);
    }
  }

  if (actionItems.length === 0 && allSentences.length > 0) {
    actionItems.push({
      title: `Follow up on "${meeting.title}" key outcomes`,
      description: allSentences.slice(0, 2).map(s => s.text).join(' '),
      assignee: 'Ethan',
      priority: 'medium',
      dueDate: defaultDue,
      meetingTimestamp: '00:00'
    });
  }

  if (keyDecisions.length === 0) {
    keyDecisions.push(`Proceed with action items discussed during "${meeting.title}".`);
  }

  const executiveSummary = allSentences.length > 0
    ? `Meeting "${meeting.title}" (${project ? project.name : 'General'}) covered ${segments.length} transcript segments and ${notesLines.length} live notes. Key focus areas included: ${allSentences.slice(0, 2).map(s => s.text).join(' — ')}`
    : `Meeting "${meeting.title}" recorded. Add transcript segments or notes to generate deeper insights.`;

  return {
    executiveSummary,
    keyDecisions: keyDecisions.slice(0, 5),
    keyDiscussionPoints: keyDiscussionPoints.slice(0, 6),
    risksAndBlockers: risksAndBlockers.length ? risksAndBlockers.slice(0, 4) : ['No critical blockers flagged during the session.'],
    actionItems: actionItems.slice(0, 8)
  };
}

function smartLocalDocument(meeting, docType, project, tasks = []) {
  const s = meeting.summary || smartLocalAnalyze(meeting, project);
  const dateStr = new Date(meeting.date || Date.now()).toLocaleString();
  const participants = (meeting.participants || ['Ethan (You)']).join(', ');
  const transcriptMd = (meeting.transcript || [])
    .map(t => `- **[${t.timestamp}] ${t.speaker}:** ${t.text}`)
    .join('\n');
  const tasksMd = tasks.length
    ? tasks.map(t => `| ${t.title} | ${t.assignee || 'Ethan'} | ${t.priority.toUpperCase()} | ${t.dueDate || 'TBD'} | ${t.status} |`).join('\n')
    : (s.actionItems || []).map(t => `| ${t.title} | ${t.assignee || 'Ethan'} | ${(t.priority || 'medium').toUpperCase()} | ${t.dueDate || 'TBD'} | todo |`).join('\n');

  if (docType === 'bilingual') {
    return `# Bilingual Executive Meeting Report / အစည်းအဝေး မှတ်တမ်းအကျဉ်းချုပ်
**Meeting / အစည်းအဝေး:** ${meeting.title}  
**Date / ရက်စွဲ:** ${dateStr}  
**Project / ပရောဂျက်:** ${project ? project.name : 'General'}  
**Participants / တက်ရောက်သူများ:** ${participants}

---

## 1. Executive Summary (အနှစ်ချုပ်)
${s.executiveSummary}

## 2. Key Decisions (အဓိက ဆုံးဖြတ်ချက်များ)
${(s.keyDecisions || []).map(d => `- ${d}`).join('\n')}

## 3. Action Items & Auto-PM Tasks (ဆက်လက်လုပ်ဆောင်ရန် တာဝန်များ)
| Task (တာဝန်) | Owner (တာဝန်ခံ) | Priority (ဦးစားပေး) | Due Date (နောက်ဆုံးရက်) | Status |
|---|---|---|---|---|
${tasksMd}

## 4. Full Bilingual Transcript (အစည်းအဝေး ပြောကြားချက်အပြည့်အစုံ)
${transcriptMd || '_No transcript recorded_'}
`;
  }

  if (docType === 'prd') {
    return `# Product & Technical Specification (Generated from Meeting)
**Source Meeting:** ${meeting.title}  
**Date:** ${dateStr}  
**Project:** ${project ? project.name : 'General'}  
**Stakeholders:** ${participants}

---

## 1. Overview & Problem Statement
${s.executiveSummary}

## 2. Core Objectives & Decisions
${(s.keyDecisions || []).map(d => `- ${d}`).join('\n')}

## 3. Functional & Technical Requirements
${(s.keyDiscussionPoints || []).map(p => `- ${p}`).join('\n')}

## 4. Risks, Dependencies & Mitigations
${(s.risksAndBlockers || []).map(r => `- ${r}`).join('\n')}

## 5. Implementation Plan & Assigned Tasks
| Deliverable / Task | Owner | Priority | Target Date | Status |
|---|---|---|---|---|
${tasksMd}
`;
  }

  if (docType === 'followup') {
    return `Subject: Follow-up & Action Items: ${meeting.title} (${new Date(meeting.date || Date.now()).toISOString().split('T')[0]})

Hi Team (${participants}),

Thank you for joining **${meeting.title}** today. Below is a concise summary of what we discussed, key decisions reached, and the action items automatically added to our project tracker.

### Executive Summary
${s.executiveSummary}

### Key Decisions
${(s.keyDecisions || []).map(d => `- ${d}`).join('\n')}

### Next Steps & Action Items
| Action Item | Owner | Priority | Due Date | Status |
|---|---|---|---|---|
${tasksMd}

### Notes & Risks
${(s.risksAndBlockers || []).map(r => `- ${r}`).join('\n')}

Best regards,  
**Ethan**
`;
  }

  return `# Minutes of Meeting (MOM): ${meeting.title}
**Date:** ${dateStr}  
**Platform:** ${meeting.platform || 'Web Meeting'}  
**Project:** ${project ? project.name : 'General'}  
**Participants:** ${participants}

---

## 1. Executive Summary
${s.executiveSummary}

## 2. Key Decisions
${(s.keyDecisions || []).map(d => `- ${d}`).join('\n')}

## 3. Discussion Highlights
${(s.keyDiscussionPoints || []).map(p => `- ${p}`).join('\n')}

## 4. Risks & Blockers
${(s.risksAndBlockers || []).map(r => `- ${r}`).join('\n')}

## 5. Action Items (Synced to Personal PM Board)
| Action Item | Assignee | Priority | Due Date | Status |
|---|---|---|---|---|
${tasksMd}

## 6. Live Meeting Notes
${meeting.notes || '_No manual notes recorded._'}

## 7. Full Verbatim Transcript
${transcriptMd || '_No transcript segments recorded._'}
`;
}

async function analyzeMeeting(meeting, project, settings) {
  const prompt = buildMeetingPrompt(meeting, project);

  try {
    if ((settings.aiProvider === 'claude_api' || settings.anthropicApiKey) && (settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY)) {
      const result = await callClaudeApi(prompt, settings, true);
      return { result, providerUsed: 'Claude API (' + (settings.anthropicModel || 'claude-3-7-sonnet') + ')' };
    }
    if ((settings.aiProvider === 'gemini_api' || settings.geminiApiKey) && (settings.geminiApiKey || process.env.GEMINI_API_KEY)) {
      const result = await callGeminiApi(prompt, settings, true);
      return { result, providerUsed: 'Google Gemini API (' + (settings.geminiModel || 'gemini-2.5-flash') + ')' };
    }
  } catch (err) {
    console.warn('Cloud AI call failed, falling back to Smart Local Bilingual Engine:', err.message);
    const fallback = smartLocalAnalyze(meeting, project);
    return {
      result: fallback,
      providerUsed: `Smart Bilingual Engine (Cloud fallback: ${err.message})`,
      claudePrompt: prompt
    };
  }

  const localResult = smartLocalAnalyze(meeting, project);
  return {
    result: localResult,
    providerUsed: 'Smart Bilingual Engine ( + Claude Pro Bridge Ready)',
    claudePrompt: prompt
  };
}

async function generateDocument(meeting, docType, project, tasks, settings) {
  const prompt = buildDocumentPrompt(meeting, docType, project);

  try {
    if ((settings.aiProvider === 'claude_api' || settings.anthropicApiKey) && (settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY)) {
      const content = await callClaudeApi(prompt, settings, false);
      return { content, providerUsed: 'Claude API', claudePrompt: prompt };
    }
    if ((settings.aiProvider === 'gemini_api' || settings.geminiApiKey) && (settings.geminiApiKey || process.env.GEMINI_API_KEY)) {
      const content = await callGeminiApi(prompt, settings, false);
      return { content, providerUsed: 'Gemini API', claudePrompt: prompt };
    }
  } catch (err) {
    console.warn('Cloud doc generation failed, using structured template generator:', err.message);
  }

  const content = smartLocalDocument(meeting, docType, project, tasks);
  return {
    content,
    providerUsed: 'Structured Document Engine (+ Claude Pro Prompt Ready)',
    claudePrompt: prompt
  };
}

module.exports = {
  buildMeetingPrompt,
  buildDocumentPrompt,
  analyzeMeeting,
  generateDocument,
  transcribeBurmeseAudioChunk,
  parseJsonSafely
};
