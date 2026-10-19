/**
 * Calendar Integration Service for MeetFlow AI
 * Supports:
 * 1. Google Calendar OAuth 2.0 API v3
 * 2. Microsoft Graph API (Outlook / Microsoft Teams Calendar) OAuth 2.0
 * 3. Universal ICS / iCal URL Feed Parser (Zero-OAuth option for Google & Teams)
 */

const crypto = require('crypto');

function getGoogleAuthUrl(settings) {
  const clientId = settings.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const redirectUri = settings.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/calendar/google/callback';
  if (!clientId) {
    throw new Error('Google Client ID is not configured yet. Add it in Settings -> Calendar OAuth.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly',
    access_type: 'offline',
    prompt: 'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCode(code, settings) {
  const clientId = settings.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = settings.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = settings.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/calendar/google/callback';

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  return await res.json();
}

async function fetchGoogleCalendarEvents(tokens, settings) {
  if (!tokens || !tokens.access_token) {
    throw new Error('Not connected to Google Calendar.');
  }
  const now = new Date(Date.now() - 86400000).toISOString();
  const max = new Date(Date.now() + 86400000 * 14).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=30`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!res.ok) {
    throw new Error(`Google Calendar API error: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.items || []).map(item => {
    const meetUrl =
      item.hangoutLink ||
      item.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ||
      extractMeetingLinkFromText(item.description || item.location || '');
    return {
      id: `gcal-${item.id}`,
      title: item.summary || 'Untitled Google Event',
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      source: 'Google Calendar',
      meetingUrl: meetUrl || '',
      platform: detectPlatform(meetUrl || item.location || 'Google Meet'),
      attendees: (item.attendees || []).map(a => a.displayName || a.email)
    };
  });
}

function getMicrosoftAuthUrl(settings) {
  const clientId = settings.msClientId || process.env.MS_CLIENT_ID;
  const tenantId = settings.msTenantId || process.env.MS_TENANT_ID || 'common';
  const redirectUri = settings.msRedirectUri || process.env.MS_REDIRECT_URI || 'http://localhost:8080/api/calendar/microsoft/callback';
  if (!clientId) {
    throw new Error('Microsoft App Client ID is not configured yet. Add it in Settings -> Calendar OAuth.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access User.Read Calendars.Read OnlineMeetings.Read'
  });
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeMicrosoftCode(code, settings) {
  const clientId = settings.msClientId || process.env.MS_CLIENT_ID;
  const clientSecret = settings.msClientSecret || process.env.MS_CLIENT_SECRET;
  const tenantId = settings.msTenantId || process.env.MS_TENANT_ID || 'common';
  const redirectUri = settings.msRedirectUri || process.env.MS_REDIRECT_URI || 'http://localhost:8080/api/calendar/microsoft/callback';

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'offline_access User.Read Calendars.Read',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      client_secret: clientSecret
    })
  });
  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed: ${await res.text()}`);
  }
  return await res.json();
}

async function fetchMicrosoftCalendarEvents(tokens) {
  if (!tokens || !tokens.access_token) {
    throw new Error('Not connected to Microsoft Teams / Outlook Calendar.');
  }
  const startDateTime = new Date(Date.now() - 86400000).toISOString();
  const endDateTime = new Date(Date.now() + 86400000 * 14).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=30&$orderby=start/dateTime`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (!res.ok) {
    throw new Error(`Microsoft Graph API error: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.value || []).map(item => {
    const meetUrl =
      item.onlineMeeting?.joinUrl ||
      extractMeetingLinkFromText(item.bodyPreview || item.location?.displayName || '');
    return {
      id: `mscal-${item.id}`,
      title: item.subject || 'Microsoft Teams Meeting',
      start: item.start?.dateTime ? new Date(item.start.dateTime + 'Z').toISOString() : new Date().toISOString(),
      end: item.end?.dateTime ? new Date(item.end.dateTime + 'Z').toISOString() : new Date().toISOString(),
      source: 'Microsoft Teams',
      meetingUrl: meetUrl || '',
      platform: detectPlatform(meetUrl || 'MS Teams'),
      attendees: (item.attendees || []).map(a => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean)
    };
  });
}

/**
 * Lightweight Pure-JS ICS / iCal feed parser for Google Calendar & Outlook private ICS links
 */
async function fetchAndParseIcsFeed(icsUrl, sourceLabel = 'ICS Calendar') {
  const res = await fetch(icsUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ICS URL (${res.status})`);
  }
  const text = await res.text();
  return parseIcsString(text, sourceLabel);
}

function parseIcsString(icsText, sourceLabel = 'ICS Calendar') {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { attendees: [] };
      continue;
    }
    if (line === 'END:VEVENT' && current) {
      if (current.title && current.start) {
        const meetUrl = extractMeetingLinkFromText(`${current.location || ''} ${current.description || ''}`);
        events.push({
          id: current.uid || `ics-${crypto.randomUUID().slice(0, 8)}`,
          title: current.title,
          start: current.start,
          end: current.end || current.start,
          source: sourceLabel,
          meetingUrl: meetUrl,
          platform: detectPlatform(meetUrl || sourceLabel),
          attendees: current.attendees.slice(0, 8)
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',');
    const key = rawKey.split(';')[0].toUpperCase();

    if (key === 'SUMMARY') current.title = val;
    else if (key === 'UID') current.uid = `ics-${val.slice(0, 24)}`;
    else if (key === 'DTSTART') current.start = parseIcsDate(val);
    else if (key === 'DTEND') current.end = parseIcsDate(val);
    else if (key === 'LOCATION') current.location = val;
    else if (key === 'DESCRIPTION') current.description = val;
    else if (key === 'ATTENDEE') {
      const mail = val.replace(/^mailto:/i, '').trim();
      if (mail) current.attendees.push(mail);
    }
  }

  const cutoff = Date.now() - 86400000 * 3;
  return events
    .filter(e => new Date(e.start).getTime() >= cutoff)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 40);
}

function parseIcsDate(val) {
  const clean = val.trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!match) return new Date().toISOString();
  const [, y, m, d, hh = '09', mm = '00', ss = '00', z] = match;
  if (z === 'Z') {
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`).toISOString();
  }
  return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}`).toISOString();
}

function extractMeetingLinkFromText(text) {
  if (!text) return '';
  const match = text.match(/https?:\/\/(?:meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s>"']+|[\w.-]*zoom\.us\/j\/[^\s>"']+)/i);
  return match ? match[0] : '';
}

function detectPlatform(str) {
  const s = (str || '').toLowerCase();
  if (s.includes('meet.google') || s.includes('google')) return 'Google Meet';
  if (s.includes('teams') || s.includes('microsoft')) return 'MS Teams';
  if (s.includes('zoom')) return 'Zoom';
  return 'Web Meeting';
}

module.exports = {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleCalendarEvents,
  getMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftCalendarEvents,
  fetchAndParseIcsFeed,
  parseIcsString
};
