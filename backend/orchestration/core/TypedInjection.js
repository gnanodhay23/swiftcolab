/**
 * TypedInjection
 *
 * Deterministic (non-LLM) formatting for injecting tool outputs into later tool inputs.
 *
 * Supports:
 * - Jira -> Slack / Gmail / Calendar
 * - Gmail -> Slack
 * - Calendar -> Slack / Gmail
 * - Generic object/array -> readable text
 *
 * Design goals:
 * - Avoid raw JSON dumps unless necessary
 * - Keep output bounded (max chars)
 * - Prefer human-readable summaries and key fields
 */

const DEFAULT_LIMITS = {
  maxChars: 6000,
  maxItems: 10,
  maxKeyValuePairs: 16,
  maxValueChars: 260,
};

function truncate(text, maxChars) {
  if (!text) return "";
  const s = String(text);
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 3)) + "...";
}

function safeJoin(lines, maxChars) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    const s = String(line);
    if (used + s.length + 1 > maxChars) break;
    out.push(s);
    used += s.length + 1;
  }
  return out.join("\n");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickFirst(value, paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cur = value;
    let ok = true;
    for (const p of parts) {
      if (!cur || typeof cur !== "object" || !(p in cur)) {
        ok = false;
        break;
      }
      cur = cur[p];
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

function coerceArray(value, paths = []) {
  if (Array.isArray(value)) return value;
  if (paths.length > 0) {
    const v = pickFirst(value, paths);
    if (Array.isArray(v)) return v;
  }
  return null;
}

function normalizeJiraIssues(data) {
  // Composio Jira search results often look like { issues: [...] }
  const issues = coerceArray(data, ["issues", "data.issues"]);
  if (issues) return issues;

  // Some results are already arrays
  if (Array.isArray(data)) return data;

  return null;
}

function normalizeGmailMessages(data) {
  const messages = coerceArray(data, ["messages", "data.messages", "emails", "data.emails"]);
  if (messages) return messages;
  if (Array.isArray(data)) return data;
  return null;
}

function normalizeCalendarEvents(data) {
  const events = coerceArray(data, ["items", "data.items", "events", "data.events"]);
  if (events) return events;
  if (Array.isArray(data)) return data;
  return null;
}

function formatJiraForSlack(data, limits) {
  const issues = normalizeJiraIssues(data);
  if (!issues || issues.length === 0) return "*Jira:* no tickets found.";

  const lines = ["*Jira Tickets:*"];
  for (const issue of issues.slice(0, limits.maxItems)) {
    const key = issue.key || issue.issue_key || issue.id || "UNKNOWN";
    const summary = pickFirst(issue, ["fields.summary", "summary", "title", "name"]) || "N/A";
    lines.push(`• *${key}*: ${truncate(summary, 160)}`);
  }
  if (issues.length > limits.maxItems) lines.push(`• …and ${issues.length - limits.maxItems} more`);
  return safeJoin(lines, limits.maxChars);
}

function formatJiraForEmail(data, limits) {
  const issues = normalizeJiraIssues(data);
  if (!issues || issues.length === 0) return "Jira: no tickets found.";

  const lines = ["Jira Tickets:", ""];
  for (const issue of issues.slice(0, limits.maxItems)) {
    const key = issue.key || issue.issue_key || issue.id || "UNKNOWN";
    const summary = pickFirst(issue, ["fields.summary", "summary", "title", "name"]) || "N/A";
    const status = pickFirst(issue, ["fields.status.name", "status", "fields.status"]) || null;
    lines.push(`- ${key}: ${truncate(summary, 200)}${status ? ` (${status})` : ""}`);
  }
  if (issues.length > limits.maxItems) lines.push(`\n…plus ${issues.length - limits.maxItems} more.`);
  return safeJoin(lines, limits.maxChars);
}

function formatJiraForCalendar(data, limits) {
  const issues = normalizeJiraIssues(data);
  if (!issues || issues.length === 0) return "No Jira tickets found.";

  const lines = ["Agenda (from Jira):", ""];
  for (const issue of issues.slice(0, limits.maxItems)) {
    const key = issue.key || issue.issue_key || issue.id || "UNKNOWN";
    const summary = pickFirst(issue, ["fields.summary", "summary", "title", "name"]) || "N/A";
    lines.push(`• ${key} — ${truncate(summary, 200)}`);
  }
  if (issues.length > limits.maxItems) lines.push(`\n…plus ${issues.length - limits.maxItems} more.`);
  return safeJoin(lines, limits.maxChars);
}

function formatEmailsForSlack(data, limits) {
  const emails = normalizeGmailMessages(data);
  if (!emails || emails.length === 0) return "*Email:* no messages found.";

  const lines = ["*Emails:*"];
  for (const m of emails.slice(0, limits.maxItems)) {
    const from = pickFirst(m, ["from", "sender", "payload.headers.from"]) || "Unknown sender";
    const subject = pickFirst(m, ["subject", "snippet", "payload.headers.subject"]) || "(no subject)";
    lines.push(`• ${truncate(subject, 160)} — ${truncate(from, 120)}`);
  }
  if (emails.length > limits.maxItems) lines.push(`• …and ${emails.length - limits.maxItems} more`);
  return safeJoin(lines, limits.maxChars);
}

function formatCalendarForSlack(data, limits) {
  const events = normalizeCalendarEvents(data);
  if (!events || events.length === 0) return "*Calendar:* no events found.";

  const lines = ["*Calendar Events:*"];
  for (const e of events.slice(0, limits.maxItems)) {
    const title = pickFirst(e, ["summary", "title", "name"]) || "(no title)";
    const start = pickFirst(e, ["start.dateTime", "start.date", "start_datetime", "start"]) || null;
    lines.push(`• ${truncate(title, 160)}${start ? ` — ${truncate(start, 40)}` : ""}`);
  }
  if (events.length > limits.maxItems) lines.push(`• …and ${events.length - limits.maxItems} more`);
  return safeJoin(lines, limits.maxChars);
}

function formatObjectAsText(data, limits) {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return truncate(data, limits.maxChars);
  if (typeof data === "number" || typeof data === "boolean") return String(data);

  if (Array.isArray(data)) {
    const lines = [];
    for (const item of data.slice(0, limits.maxItems)) {
      if (isPlainObject(item)) {
        const label =
          pickFirst(item, ["key", "name", "summary", "title", "id"]) ||
          truncate(JSON.stringify(item), limits.maxValueChars);
        lines.push(`- ${truncate(label, 220)}`);
      } else {
        lines.push(`- ${truncate(item, 220)}`);
      }
    }
    if (data.length > limits.maxItems) lines.push(`- …and ${data.length - limits.maxItems} more`);
    return safeJoin(lines, limits.maxChars);
  }

  if (isPlainObject(data)) {
    // Prefer a compact key-value view for generic objects.
    const keys = Object.keys(data).slice(0, limits.maxKeyValuePairs);
    const lines = [];
    for (const k of keys) {
      const v = data[k];
      if (v === null || v === undefined) continue;
      if (typeof v === "string") lines.push(`${k}: ${truncate(v, limits.maxValueChars)}`);
      else if (typeof v === "number" || typeof v === "boolean") lines.push(`${k}: ${String(v)}`);
      else if (Array.isArray(v)) lines.push(`${k}: [${v.length} items]`);
      else if (isPlainObject(v)) lines.push(`${k}: {…}`);
      else lines.push(`${k}: ${truncate(String(v), limits.maxValueChars)}`);
    }
    return safeJoin(lines, limits.maxChars);
  }

  // Fallback
  return truncate(String(data), limits.maxChars);
}

/**
 * Main formatting entry.
 * @returns {string}
 */
function formatTypedInjection({ data, sourceAction, targetAction, targetParam, limits: overrides }) {
  const limits = { ...DEFAULT_LIMITS, ...(overrides || {}) };

  const src = String(sourceAction || "").toUpperCase();
  const tgt = String(targetAction || "").toUpperCase();
  const param = String(targetParam || "").toLowerCase();

  // Jira -> ...
  if (src.includes("JIRA") && (tgt.includes("SLACK") || param.includes("slack"))) {
    return formatJiraForSlack(data, limits);
  }
  if (src.includes("JIRA") && tgt.includes("GMAIL") && (param === "body" || param === "text" || param === "message")) {
    return formatJiraForEmail(data, limits);
  }
  if (src.includes("JIRA") && tgt.includes("GOOGLECALENDAR") && (param === "description" || param === "summary")) {
    return formatJiraForCalendar(data, limits);
  }

  // Gmail -> Slack
  if (src.includes("GMAIL") && tgt.includes("SLACK")) {
    return formatEmailsForSlack(data, limits);
  }

  // Calendar -> Slack / Gmail
  if (src.includes("CALENDAR") || src.includes("GOOGLECALENDAR")) {
    if (tgt.includes("SLACK")) return formatCalendarForSlack(data, limits);
  }

  // Param-driven defaults
  if (tgt.includes("SLACK") && (param === "text" || param === "message" || param === "markdown_text")) {
    return formatObjectAsText(data, { ...limits, maxChars: Math.min(limits.maxChars, 3500) });
  }

  // Default: readable text, bounded.
  return formatObjectAsText(data, limits);
}

module.exports = {
  formatTypedInjection,
};
