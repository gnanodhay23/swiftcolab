/**
 * Enhanced Proactive Engine - Complete 8 Workflow Implementation
 *
 * Workflows:
 * 1. Daily Planner - "What should I do today" across all tools
 * 2. Focus Block Builder - 2-hour deep work suggestions
 * 3. Digest Generator - What changed since yesterday
 * 4. Blocker Detector - Stuck work detection
 * 5. Follow-up Recommender - Suggest messages/meetings
 * 6. Risk & Deadline Monitor - Prevent surprises
 * 7. Notification Dispatcher - Quiet hours, rate limits, batching
 * 8. Personalization Learner - Learn user preferences
 */

const { v4: uuidv4 } = require('uuid');

class ProactiveEngine {
  constructor({ composio, query, callGemini }) {
    this.composio = composio;
    this.query = query;
    this.callGemini = callGemini;

    // Tool selection policies by query type
    this.toolPolicies = {
      daily_planning: ['GOOGLECALENDAR', 'JIRA', 'TRELLO', 'GMAIL', 'SLACK', 'GITHUB', 'ASANA', 'NOTION', 'LINEAR'],
      focus_block: ['GOOGLECALENDAR', 'JIRA', 'TRELLO', 'LINEAR', 'ASANA'],
      blocker_detection: ['JIRA', 'GITHUB', 'TRELLO', 'LINEAR', 'ASANA', 'SLACK'],
      digest: ['JIRA', 'GITHUB', 'SLACK', 'GMAIL', 'TRELLO', 'NOTION'],
      followup: ['SLACK', 'GMAIL', 'JIRA', 'GITHUB'],
      risk_monitor: ['JIRA', 'TRELLO', 'GITHUB', 'LINEAR', 'ASANA', 'GOOGLECALENDAR'],
    };

    // User preference defaults
    this.defaultPreferences = {
      quietHoursStart: 22, // 10 PM
      quietHoursEnd: 8,    // 8 AM
      maxDailyNotifications: 10,
      focusBlockDuration: 120, // minutes
      digestFrequency: 'daily',
      priorityWeights: {
        urgency: 0.4,
        importance: 0.3,
        deadline: 0.2,
        recency: 0.1,
      },
    };

    // Notification rate limiting
    this.notificationState = new Map();
  }

  // ============================================
  // WORKFLOW 1: DAILY PLANNER
  // "What should I do today" - Multi-tool aggregation
  // ============================================

  async generateDailyPlan(userId, entityId, selectedToolkits) {
    console.log('[ProactiveEngine] Generating daily plan for:', entityId);

    // 1. Parallel fetch from all connected tools
    const snapshot = await this.getOrRefreshSnapshot(userId, entityId, selectedToolkits);

    // 2. Load user preferences
    const preferences = await this.getUserPreferences(userId);

    // 3. Analyze and prioritize using LLM
    const plan = await this.analyzeDailyPriorities(snapshot, entityId, preferences);

    // 4. Generate focus time suggestions
    const focusBlocks = await this.suggestFocusBlocks(snapshot, preferences);
    plan.focusBlocks = focusBlocks;

    // 5. Detect any blockers
    const blockers = await this.analyzeBlockers(snapshot);
    plan.blockers = blockers;

    // 6. Store recommendations for follow-up
    await this.storeRecommendations(userId, plan.recommendations);

    // 7. Learn from this interaction
    await this.recordInteraction(userId, 'daily_plan', { toolkits: selectedToolkits });

    return {
      type: 'daily_plan',
      greeting: plan.greeting,
      summary: plan.summary,
      priorities: plan.priorities,
      blockers: plan.blockers,
      focusBlocks: plan.focusBlocks,
      timeBlocks: plan.timeBlocks,
      quickActions: plan.quickActions,
      deadlines: plan.deadlines,
      recommendations: plan.recommendations,
    };
  }

  // ============================================
  // WORKFLOW 2: FOCUS BLOCK BUILDER
  // Suggest 2-hour deep work windows
  // ============================================

  async suggestFocusBlocks(snapshot, preferences) {
    const focusBlocks = [];
    const calendarEvents = snapshot.calendar || [];
    const duration = preferences?.focusBlockDuration || 120;

    // Parse calendar to find free slots
    const freeSlots = this.findFreeSlots(calendarEvents, duration);

    // Rank tasks by focus-worthiness
    const focusTasks = await this.rankTasksForFocus(snapshot.tasks || []);

    // Match tasks to slots
    for (const slot of freeSlots.slice(0, 3)) {
      const task = focusTasks.shift();
      if (task) {
        focusBlocks.push({
          id: uuidv4(),
          startTime: slot.start,
          endTime: slot.end,
          duration: duration,
          suggestedTask: task,
          reason: `Best time for deep work on "${task.title}"`,
          type: 'focus',
          canCreate: true,
        });
      } else {
        focusBlocks.push({
          id: uuidv4(),
          startTime: slot.start,
          endTime: slot.end,
          duration: duration,
          suggestedTask: null,
          reason: 'Free time for deep work or learning',
          type: 'free',
          canCreate: true,
        });
      }
    }

    return focusBlocks;
  }

  findFreeSlots(calendarEvents, minDuration) {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(18, 0, 0, 0); // Work ends at 6 PM

    const slots = [];
    let currentTime = new Date(Math.max(now.getTime(), this.getWorkdayStart().getTime()));

    // Sort events by start time
    const sortedEvents = calendarEvents
      .filter(e => new Date(e.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    for (const event of sortedEvents) {
      const eventStart = new Date(event.start);
      const gap = (eventStart - currentTime) / (1000 * 60); // minutes

      if (gap >= minDuration) {
        slots.push({
          start: currentTime.toISOString(),
          end: eventStart.toISOString(),
          duration: gap,
        });
      }

      const eventEnd = new Date(event.end);
      if (eventEnd > currentTime) {
        currentTime = eventEnd;
      }
    }

    // Check remaining time until end of day
    const remainingGap = (endOfDay - currentTime) / (1000 * 60);
    if (remainingGap >= minDuration) {
      slots.push({
        start: currentTime.toISOString(),
        end: endOfDay.toISOString(),
        duration: remainingGap,
      });
    }

    return slots;
  }

  getWorkdayStart() {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    return start;
  }

  async rankTasksForFocus(tasks) {
    // Score tasks based on focus-worthiness
    const scored = tasks.map(task => {
      let score = 0;

      // Prefer tasks that need concentration
      if (task.priority?.toLowerCase() === 'high' || task.priority?.toLowerCase() === 'highest') {
        score += 30;
      }

      // Prefer tasks with upcoming deadlines
      if (task.dueDate) {
        const daysUntilDue = (new Date(task.dueDate) - new Date()) / (1000 * 60 * 60 * 24);
        if (daysUntilDue <= 1) score += 40;
        else if (daysUntilDue <= 3) score += 25;
        else if (daysUntilDue <= 7) score += 10;
      }

      // Prefer "In Progress" tasks
      if (task.status?.toLowerCase().includes('progress')) {
        score += 20;
      }

      // Prefer tasks from Jira/Linear (typically more complex)
      if (task.source === 'jira' || task.source === 'linear') {
        score += 10;
      }

      return { ...task, focusScore: score };
    });

    return scored.sort((a, b) => b.focusScore - a.focusScore);
  }

  // ============================================
  // WORKFLOW 3: DIGEST GENERATOR
  // What changed since yesterday
  // ============================================

  async generateDigest(userId, entityId, selectedToolkits, since = null) {
    console.log('[ProactiveEngine] Generating digest for:', entityId);

    const sinceDate = since || this.getYesterdayStart();

    // Parallel fetch recent changes
    const changes = await this.fetchRecentChanges(userId, entityId, selectedToolkits, sinceDate);

    // Categorize changes
    const categorized = this.categorizeChanges(changes);

    // Generate summary using LLM
    const summary = await this.summarizeChanges(categorized, sinceDate);

    // Identify what needs attention
    const needsAttention = this.identifyNeedsAttention(categorized);

    return {
      type: 'digest',
      period: {
        start: sinceDate.toISOString(),
        end: new Date().toISOString(),
      },
      summary: summary,
      categories: categorized,
      needsAttention: needsAttention,
      stats: {
        totalChanges: Object.values(changes).reduce((sum, arr) => sum + arr.length, 0),
        newItems: changes.new?.length || 0,
        completedItems: changes.completed?.length || 0,
        updatedItems: changes.updated?.length || 0,
        mentionsAndMessages: changes.communications?.length || 0,
      },
    };
  }

  getYesterdayStart() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  }

  async fetchRecentChanges(userId, entityId, selectedToolkits, sinceDate) {
    this.composio.setEntityId(entityId);
    const changes = {
      new: [],
      updated: [],
      completed: [],
      communications: [],
    };

    const fetchPromises = [];

    // Jira changes
    if (selectedToolkits.includes('JIRA')) {
      fetchPromises.push(
        this.fetchJiraChanges(entityId, sinceDate)
          .then(data => this.mergeChanges(changes, data))
          .catch(e => console.error('[ProactiveEngine] Jira changes error:', e.message))
      );
    }

    // GitHub activity
    if (selectedToolkits.includes('GITHUB')) {
      fetchPromises.push(
        this.fetchGitHubActivity(entityId, sinceDate)
          .then(data => this.mergeChanges(changes, data))
          .catch(e => console.error('[ProactiveEngine] GitHub changes error:', e.message))
      );
    }

    // Slack messages (mentions, DMs)
    if (selectedToolkits.includes('SLACK')) {
      fetchPromises.push(
        this.fetchSlackActivity(entityId, sinceDate)
          .then(data => { changes.communications.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Slack changes error:', e.message))
      );
    }

    // Gmail threads
    if (selectedToolkits.includes('GMAIL')) {
      fetchPromises.push(
        this.fetchEmailActivity(entityId, sinceDate)
          .then(data => { changes.communications.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Gmail changes error:', e.message))
      );
    }

    await Promise.all(fetchPromises);
    return changes;
  }

  async fetchJiraChanges(entityId, sinceDate) {
    try {
      const execResult = await this.composio.executeAction(
        'JIRA_SEARCH_ISSUES',
        {
          jql: `updated >= "${sinceDate.toISOString().split('T')[0]}" ORDER BY updated DESC`,
          maxResults: 50,
        },
        entityId
      );

      const changes = { new: [], updated: [], completed: [] };
      for (const issue of execResult?.data?.issues || []) {
        const created = new Date(issue.fields?.created);
        const updated = new Date(issue.fields?.updated);
        const status = issue.fields?.status?.name?.toLowerCase();

        const item = {
          id: issue.key,
          title: issue.fields?.summary,
          source: 'jira',
          link: `https://jira.atlassian.com/browse/${issue.key}`,
          timestamp: updated.toISOString(),
        };

        if (created >= sinceDate) {
          changes.new.push(item);
        } else if (status === 'done' || status === 'closed') {
          changes.completed.push(item);
        } else {
          changes.updated.push(item);
        }
      }
      return changes;
    } catch (e) {
      return { new: [], updated: [], completed: [] };
    }
  }

  async fetchGitHubActivity(entityId, sinceDate) {
    try {
      // Fetch PRs and commits
      const execResult = await this.composio.executeAction(
        'GITHUB_LIST_EVENTS',
        { per_page: 50 },
        entityId
      );

      const changes = { new: [], updated: [], completed: [] };
      for (const event of execResult?.data || []) {
        const eventDate = new Date(event.created_at);
        if (eventDate < sinceDate) continue;

        const item = {
          id: event.id,
          title: this.formatGitHubEvent(event),
          source: 'github',
          type: event.type,
          timestamp: eventDate.toISOString(),
        };

        if (event.type === 'PullRequestEvent' && event.payload?.action === 'opened') {
          changes.new.push(item);
        } else if (event.type === 'PullRequestEvent' && event.payload?.action === 'closed') {
          changes.completed.push(item);
        } else {
          changes.updated.push(item);
        }
      }
      return changes;
    } catch (e) {
      return { new: [], updated: [], completed: [] };
    }
  }

  formatGitHubEvent(event) {
    switch (event.type) {
      case 'PullRequestEvent':
        return `PR: ${event.payload?.pull_request?.title || 'Unknown'}`;
      case 'PushEvent':
        return `Push to ${event.repo?.name}: ${event.payload?.commits?.length || 0} commits`;
      case 'IssuesEvent':
        return `Issue: ${event.payload?.issue?.title || 'Unknown'}`;
      case 'IssueCommentEvent':
        return `Comment on ${event.payload?.issue?.title || 'issue'}`;
      default:
        return `${event.type} in ${event.repo?.name}`;
    }
  }

  async fetchSlackActivity(entityId, sinceDate) {
    try {
      const execResult = await this.composio.executeAction(
        'SLACK_SEARCH_MESSAGES',
        { query: 'to:me', count: 30 },
        entityId
      );

      return (execResult?.data?.messages?.matches || [])
        .filter(m => new Date(parseFloat(m.ts) * 1000) >= sinceDate)
        .map(m => ({
          id: m.ts,
          title: m.text?.slice(0, 100),
          source: 'slack',
          channel: m.channel?.name,
          from: m.username,
          timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
        }));
    } catch (e) {
      return [];
    }
  }

  async fetchEmailActivity(entityId, sinceDate) {
    try {
      const execResult = await this.composio.executeAction(
        'GMAIL_FETCH_EMAILS',
        { query: `after:${sinceDate.toISOString().split('T')[0]}`, maxResults: 20 },
        entityId
      );

      return (execResult?.data || []).map(e => ({
        id: e.id,
        title: e.subject,
        source: 'gmail',
        from: e.from,
        timestamp: e.date,
      }));
    } catch (e) {
      return [];
    }
  }

  mergeChanges(target, source) {
    if (!source) return;
    target.new.push(...(source.new || []));
    target.updated.push(...(source.updated || []));
    target.completed.push(...(source.completed || []));
  }

  categorizeChanges(changes) {
    return {
      newWork: changes.new.slice(0, 10),
      progressUpdates: changes.updated.slice(0, 10),
      completedWork: changes.completed.slice(0, 10),
      communications: changes.communications.slice(0, 10),
    };
  }

  async summarizeChanges(categorized, sinceDate) {
    const totalItems = Object.values(categorized).reduce((sum, arr) => sum + arr.length, 0);

    if (totalItems === 0) {
      return "No significant updates since yesterday.";
    }

    const systemPrompt = `Summarize the following work activity in 2-3 sentences. Be concise and focus on the most important updates.

Changes since ${sinceDate.toLocaleDateString()}:
- New items: ${categorized.newWork.length}
- Progress updates: ${categorized.progressUpdates.length}
- Completed: ${categorized.completedWork.length}
- Messages/emails: ${categorized.communications.length}

Details:
${JSON.stringify(categorized, null, 2)}

Provide a brief, professional summary.`;

    try {
      return await this.callGemini(systemPrompt, '', 0.3);
    } catch (e) {
      return `${totalItems} updates: ${categorized.completedWork.length} completed, ${categorized.newWork.length} new items, ${categorized.communications.length} messages.`;
    }
  }

  identifyNeedsAttention(categorized) {
    const needsAttention = [];

    // Unread communications might need response
    for (const msg of categorized.communications.slice(0, 5)) {
      if (msg.source === 'slack' || msg.source === 'gmail') {
        needsAttention.push({
          type: 'message',
          item: msg,
          reason: 'May need a response',
          suggestedAction: msg.source === 'slack' ? 'Reply in Slack' : 'Reply to email',
        });
      }
    }

    return needsAttention;
  }

  // ============================================
  // WORKFLOW 4: BLOCKER DETECTOR
  // Stuck work detection with smart analysis
  // ============================================

  async detectBlockers(userId, entityId, selectedToolkits) {
    console.log('[ProactiveEngine] Detecting blockers for:', entityId);

    const snapshot = await this.getOrRefreshSnapshot(userId, entityId, selectedToolkits);
    const blockers = await this.analyzeBlockers(snapshot);

    // Store blockers as recommendations
    const recommendations = blockers.map(b => ({
      type: 'blocker',
      title: b.title,
      description: b.reason,
      urgency: b.severity || 'normal',
      relatedItems: [b],
      quickActions: b.suggestedActions || [],
    }));

    await this.storeRecommendations(userId, recommendations);

    return blockers;
  }

  async analyzeBlockers(snapshot) {
    const blockers = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Tasks stuck in "In Progress" for too long (>3 days)
    for (const task of snapshot.tasks || []) {
      const status = task.status?.toLowerCase() || '';

      if (status.includes('progress') || status.includes('review') || status.includes('blocked')) {
        // Calculate days in status (estimate based on last update)
        const daysSinceUpdate = task.lastUpdated
          ? (now - new Date(task.lastUpdated)) / (1000 * 60 * 60 * 24)
          : 3;

        if (daysSinceUpdate >= 3 || status.includes('blocked')) {
          blockers.push({
            id: uuidv4(),
            type: 'stuck_task',
            title: task.title,
            source: task.source,
            link: task.link,
            reason: status.includes('blocked')
              ? `Task is explicitly blocked`
              : `Task has been "${task.status}" for ${Math.round(daysSinceUpdate)} days`,
            severity: status.includes('blocked') ? 'high' : 'medium',
            suggestedActions: [
              { action: 'Update status', description: 'Check if this can be unblocked or needs help' },
              { action: 'Split task', description: 'Break into smaller pieces if too large' },
              { action: 'Ask for help', description: 'Reach out to team if blocked on dependencies' },
            ],
          });
        }
      }
    }

    // 2. Overdue tasks
    for (const task of snapshot.tasks || []) {
      if (task.dueDate && task.dueDate < today) {
        const daysOverdue = Math.ceil((now - new Date(task.dueDate)) / (1000 * 60 * 60 * 24));
        blockers.push({
          id: uuidv4(),
          type: 'overdue',
          title: task.title,
          source: task.source,
          link: task.link,
          reason: `Overdue by ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} (due: ${task.dueDate})`,
          severity: daysOverdue > 7 ? 'high' : 'medium',
          suggestedActions: [
            { action: 'Complete now', description: 'Prioritize completing this task' },
            { action: 'Reschedule', description: 'Update the due date if needed' },
            { action: 'Deprioritize', description: 'Close or defer if no longer needed' },
          ],
        });
      }
    }

    // 3. PRs waiting for review
    for (const pr of snapshot.prs || []) {
      if (pr.reviewRequested) {
        blockers.push({
          id: uuidv4(),
          type: 'pr_waiting',
          title: `PR #${pr.id}: ${pr.title}`,
          source: 'github',
          link: pr.link,
          reason: 'Waiting for your review',
          severity: 'medium',
          suggestedActions: [
            { action: 'Review now', description: 'Review this PR' },
            { action: 'Request changes', description: 'If not ready to review, request updates' },
          ],
        });
      }
    }

    // 4. Unanswered mentions (Slack)
    for (const mention of snapshot.mentions || []) {
      const mentionAge = (now - new Date(parseFloat(mention.timestamp) * 1000)) / (1000 * 60 * 60);
      if (mentionAge > 4) { // More than 4 hours old
        blockers.push({
          id: uuidv4(),
          type: 'unanswered_mention',
          title: mention.text?.slice(0, 60) + '...',
          source: 'slack',
          channel: mention.channel,
          from: mention.from,
          reason: `Unanswered mention from ${Math.round(mentionAge)} hours ago`,
          severity: mentionAge > 24 ? 'medium' : 'low',
          suggestedActions: [
            { action: 'Reply now', description: 'Respond to this message' },
            { action: 'Acknowledge', description: 'Let them know you saw it' },
          ],
        });
      }
    }

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    blockers.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return blockers;
  }

  // ============================================
  // WORKFLOW 5: FOLLOW-UP RECOMMENDER
  // Suggest messages, meetings, check-ins
  // ============================================

  async generateFollowupRecommendations(userId, entityId, selectedToolkits) {
    console.log('[ProactiveEngine] Generating follow-up recommendations for:', entityId);

    const snapshot = await this.getOrRefreshSnapshot(userId, entityId, selectedToolkits);
    const followups = [];

    // 1. Completed tasks that might need follow-up
    const recentlyCompleted = snapshot.tasks?.filter(t =>
      t.status?.toLowerCase().includes('done') || t.status?.toLowerCase().includes('closed')
    ).slice(0, 5) || [];

    for (const task of recentlyCompleted) {
      followups.push({
        id: uuidv4(),
        type: 'task_followup',
        title: `Follow up on completed: ${task.title}`,
        reason: 'Recently completed task may need stakeholder notification',
        suggestedAction: {
          type: 'slack_message',
          template: `Update: "${task.title}" has been completed.`,
        },
        priority: 'low',
      });
    }

    // 2. Old PRs that need attention
    const stalePRs = (snapshot.prs || []).filter(pr => {
      const created = new Date(pr.created_at || Date.now());
      const age = (Date.now() - created) / (1000 * 60 * 60 * 24);
      return age > 3;
    });

    for (const pr of stalePRs.slice(0, 3)) {
      followups.push({
        id: uuidv4(),
        type: 'pr_followup',
        title: `Follow up on PR: ${pr.title}`,
        reason: 'PR has been open for a while',
        suggestedAction: {
          type: 'comment',
          template: 'Friendly ping: any updates on this PR?',
        },
        priority: 'medium',
      });
    }

    // 3. Calendar meetings that might need prep
    const upcomingMeetings = (snapshot.calendar || []).filter(e => {
      const start = new Date(e.start);
      const hoursUntil = (start - Date.now()) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil < 24 && e.attendees > 1;
    });

    for (const meeting of upcomingMeetings.slice(0, 3)) {
      followups.push({
        id: uuidv4(),
        type: 'meeting_prep',
        title: `Prepare for: ${meeting.title}`,
        reason: `Meeting with ${meeting.attendees} attendees coming up`,
        suggestedAction: {
          type: 'prepare',
          template: 'Review relevant docs and prepare talking points',
        },
        priority: 'high',
      });
    }

    // 4. Emails that might need response
    for (const email of (snapshot.emails || []).slice(0, 5)) {
      const emailDate = new Date(email.date);
      const ageHours = (Date.now() - emailDate) / (1000 * 60 * 60);

      if (ageHours > 24) {
        followups.push({
          id: uuidv4(),
          type: 'email_response',
          title: `Respond to: ${email.subject}`,
          reason: `Email from ${email.from} waiting for response`,
          suggestedAction: {
            type: 'email',
            template: `Reply to ${email.from}`,
          },
          priority: ageHours > 48 ? 'high' : 'medium',
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    followups.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return followups;
  }

  // ============================================
  // WORKFLOW 6: RISK & DEADLINE MONITOR
  // Prevent surprises with proactive alerts
  // ============================================

  async monitorRisksAndDeadlines(userId, entityId, selectedToolkits) {
    console.log('[ProactiveEngine] Monitoring risks and deadlines for:', entityId);

    const snapshot = await this.getOrRefreshSnapshot(userId, entityId, selectedToolkits);
    const risks = [];
    const now = new Date();

    // 1. Upcoming deadlines (next 3 days)
    for (const task of snapshot.tasks || []) {
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        const daysUntilDue = (dueDate - now) / (1000 * 60 * 60 * 24);

        if (daysUntilDue > 0 && daysUntilDue <= 3) {
          const status = task.status?.toLowerCase() || '';
          const isAtRisk = !status.includes('done') && !status.includes('review');

          if (isAtRisk) {
            risks.push({
              id: uuidv4(),
              type: 'deadline_risk',
              title: task.title,
              source: task.source,
              link: task.link,
              dueDate: task.dueDate,
              daysUntilDue: Math.round(daysUntilDue),
              severity: daysUntilDue <= 1 ? 'critical' : 'warning',
              reason: `Due in ${Math.round(daysUntilDue)} day${daysUntilDue >= 1.5 ? 's' : ''}, currently "${task.status}"`,
              suggestedActions: [
                { action: 'Prioritize', description: 'Move to top of your list' },
                { action: 'Request extension', description: 'If unable to complete, communicate early' },
              ],
            });
          }
        }
      }
    }

    // 2. Calendar conflicts or back-to-back meetings
    const calendarEvents = snapshot.calendar || [];
    for (let i = 0; i < calendarEvents.length - 1; i++) {
      const current = calendarEvents[i];
      const next = calendarEvents[i + 1];

      const currentEnd = new Date(current.end);
      const nextStart = new Date(next.start);
      const gap = (nextStart - currentEnd) / (1000 * 60); // minutes

      if (gap < 5 && gap >= 0) {
        risks.push({
          id: uuidv4(),
          type: 'calendar_conflict',
          title: `Back-to-back: ${current.title} → ${next.title}`,
          source: 'calendar',
          severity: 'warning',
          reason: gap === 0 ? 'No break between meetings' : `Only ${gap} minute gap`,
          suggestedActions: [
            { action: 'Reschedule', description: 'Move one meeting to create buffer' },
            { action: 'Decline', description: 'Consider declining one if not essential' },
          ],
        });
      }
    }

    // 3. Too many meetings today (>5 hours)
    const todayMeetings = calendarEvents.filter(e => {
      const eventDate = new Date(e.start).toDateString();
      return eventDate === now.toDateString();
    });

    const totalMeetingMinutes = todayMeetings.reduce((sum, e) => {
      const start = new Date(e.start);
      const end = new Date(e.end);
      return sum + (end - start) / (1000 * 60);
    }, 0);

    if (totalMeetingMinutes > 300) { // More than 5 hours
      risks.push({
        id: uuidv4(),
        type: 'meeting_overload',
        title: 'Heavy meeting day',
        source: 'calendar',
        severity: 'warning',
        reason: `${Math.round(totalMeetingMinutes / 60)} hours of meetings today`,
        suggestedActions: [
          { action: 'Protect focus time', description: 'Ensure at least 2 hours for deep work' },
          { action: 'Decline optional meetings', description: 'Review which meetings are truly needed' },
        ],
      });
    }

    // 4. High-priority tasks with no progress
    const highPriorityStalled = (snapshot.tasks || []).filter(t => {
      const priority = t.priority?.toLowerCase() || '';
      const status = t.status?.toLowerCase() || '';
      return (priority.includes('high') || priority.includes('urgent') || priority.includes('critical')) &&
        (status.includes('todo') || status.includes('new') || status.includes('open'));
    });

    for (const task of highPriorityStalled.slice(0, 3)) {
      risks.push({
        id: uuidv4(),
        type: 'stalled_priority',
        title: task.title,
        source: task.source,
        link: task.link,
        severity: 'warning',
        reason: `High priority task still in "${task.status}"`,
        suggestedActions: [
          { action: 'Start working', description: 'Move to In Progress and begin' },
          { action: 'Reassign', description: 'Delegate if you cannot work on it' },
        ],
      });
    }

    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      risks: risks,
      summary: {
        critical: risks.filter(r => r.severity === 'critical').length,
        warning: risks.filter(r => r.severity === 'warning').length,
        upcomingDeadlines: risks.filter(r => r.type === 'deadline_risk').length,
        calendarIssues: risks.filter(r => r.type.includes('calendar') || r.type === 'meeting_overload').length,
      },
    };
  }

  // ============================================
  // WORKFLOW 7: NOTIFICATION DISPATCHER
  // Quiet hours, rate limits, batching
  // ============================================

  async dispatchNotification(userId, notification) {
    const preferences = await this.getUserPreferences(userId);

    // 1. Check quiet hours
    if (this.isQuietHours(preferences)) {
      console.log('[ProactiveEngine] Notification queued (quiet hours):', notification.title);
      await this.queueNotification(userId, notification);
      return { sent: false, reason: 'quiet_hours', queuedFor: this.getQuietHoursEnd(preferences) };
    }

    // 2. Check rate limit
    const rateLimitResult = this.checkRateLimit(userId, preferences);
    if (!rateLimitResult.allowed) {
      console.log('[ProactiveEngine] Notification rate limited:', notification.title);
      await this.queueNotification(userId, notification);
      return { sent: false, reason: 'rate_limited', remaining: rateLimitResult.remaining };
    }

    // 3. Check if should batch with similar notifications
    const batchResult = await this.checkBatching(userId, notification);
    if (batchResult.shouldBatch) {
      await this.addToBatch(userId, notification, batchResult.batchId);
      return { sent: false, reason: 'batched', batchId: batchResult.batchId };
    }

    // 4. Send the notification
    await this.sendNotification(userId, notification);
    this.recordNotificationSent(userId);

    return { sent: true };
  }

  isQuietHours(preferences) {
    const now = new Date();
    const hour = now.getHours();
    const start = preferences.quietHoursStart || this.defaultPreferences.quietHoursStart;
    const end = preferences.quietHoursEnd || this.defaultPreferences.quietHoursEnd;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (start > end) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  }

  getQuietHoursEnd(preferences) {
    const now = new Date();
    const end = preferences.quietHoursEnd || this.defaultPreferences.quietHoursEnd;

    const endTime = new Date(now);
    endTime.setHours(end, 0, 0, 0);

    if (endTime <= now) {
      endTime.setDate(endTime.getDate() + 1);
    }

    return endTime.toISOString();
  }

  checkRateLimit(userId, preferences) {
    const state = this.notificationState.get(userId) || { count: 0, lastReset: Date.now() };
    const maxDaily = preferences.maxDailyNotifications || this.defaultPreferences.maxDailyNotifications;

    // Reset if it's a new day
    const now = Date.now();
    if (now - state.lastReset > 24 * 60 * 60 * 1000) {
      state.count = 0;
      state.lastReset = now;
    }

    const remaining = maxDaily - state.count;
    return {
      allowed: remaining > 0,
      remaining: remaining,
      resetAt: new Date(state.lastReset + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  recordNotificationSent(userId) {
    const state = this.notificationState.get(userId) || { count: 0, lastReset: Date.now() };
    state.count++;
    this.notificationState.set(userId, state);
  }

  async queueNotification(userId, notification) {
    await this.query(
      `INSERT INTO notification_queue (id, user_id, notification_type, title, body, priority, scheduled_for, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        uuidv4(),
        userId,
        notification.type,
        notification.title,
        JSON.stringify(notification.body),
        notification.priority || 'normal',
        notification.scheduledFor || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ]
    );
  }

  async checkBatching(userId, notification) {
    // Check if there are similar pending notifications
    try {
      const result = await this.query(
        `SELECT id, notification_type, COUNT(*) as count
         FROM notification_queue
         WHERE user_id = $1 AND notification_type = $2 AND sent_at IS NULL
         GROUP BY id, notification_type
         LIMIT 1`,
        [userId, notification.type]
      );

      if (result.rows.length > 0 && result.rows[0].count >= 3) {
        return { shouldBatch: true, batchId: result.rows[0].id };
      }
    } catch (e) {
      // Table might not exist yet
    }

    return { shouldBatch: false };
  }

  async addToBatch(userId, notification, batchId) {
    await this.queueNotification(userId, { ...notification, batchId });
  }

  async sendNotification(userId, notification) {
    // For now, just store in recommendations
    await this.storeRecommendations(userId, [{
      type: notification.type,
      title: notification.title,
      description: notification.body?.description || notification.body,
      urgency: notification.priority || 'normal',
    }]);
  }

  async processQueuedNotifications(userId) {
    // Get notifications that are ready to send
    const result = await this.query(
      `SELECT * FROM notification_queue
       WHERE user_id = $1 AND sent_at IS NULL AND scheduled_for <= NOW()
       ORDER BY priority DESC, created_at ASC
       LIMIT 10`,
      [userId]
    );

    for (const notification of result.rows) {
      await this.dispatchNotification(userId, {
        type: notification.notification_type,
        title: notification.title,
        body: notification.body,
        priority: notification.priority,
      });

      await this.query(
        'UPDATE notification_queue SET sent_at = NOW() WHERE id = $1',
        [notification.id]
      );
    }
  }

  // ============================================
  // WORKFLOW 8: PERSONALIZATION LEARNER
  // Learn user preferences over time
  // ============================================

  async recordInteraction(userId, interactionType, details) {
    try {
      await this.query(
        `INSERT INTO user_interactions (id, user_id, interaction_type, details, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [uuidv4(), userId, interactionType, JSON.stringify(details)]
      );
    } catch (e) {
      // Table might not exist yet
      console.error('[ProactiveEngine] Error recording interaction:', e.message);
    }
  }

  async getUserPreferences(userId) {
    try {
      const result = await this.query(
        'SELECT preferences FROM user_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length > 0) {
        return { ...this.defaultPreferences, ...result.rows[0].preferences };
      }
    } catch (e) {
      // Table might not exist yet
    }

    return this.defaultPreferences;
  }

  async updateUserPreferences(userId, updates) {
    const current = await this.getUserPreferences(userId);
    const merged = { ...current, ...updates };

    try {
      await this.query(
        `INSERT INTO user_preferences (user_id, preferences, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET preferences = $2, updated_at = NOW()`,
        [userId, JSON.stringify(merged)]
      );
    } catch (e) {
      console.error('[ProactiveEngine] Error updating preferences:', e.message);
    }

    return merged;
  }

  async learnFromFeedback(userId, feedbackType, itemId, feedback) {
    // Record the feedback
    await this.recordInteraction(userId, 'feedback', {
      feedbackType,
      itemId,
      feedback,
    });

    // Adjust preferences based on feedback patterns
    const interactions = await this.getRecentInteractions(userId, 50);
    const preferences = await this.getUserPreferences(userId);

    // Learn from dismissals
    const dismissals = interactions.filter(i =>
      i.interaction_type === 'feedback' && i.details?.feedback === 'dismissed'
    );

    if (dismissals.length > 5) {
      // User is dismissing a lot - reduce notifications
      const newMax = Math.max(5, (preferences.maxDailyNotifications || 10) - 2);
      await this.updateUserPreferences(userId, { maxDailyNotifications: newMax });
    }

    // Learn from action times
    const actionTimes = interactions
      .filter(i => i.interaction_type === 'action')
      .map(i => new Date(i.created_at).getHours());

    if (actionTimes.length > 10) {
      // Find peak activity hours
      const hourCounts = new Array(24).fill(0);
      actionTimes.forEach(h => hourCounts[h]++);

      const peakHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)
        .map(h => h.hour);

      await this.updateUserPreferences(userId, { preferredHours: peakHours });
    }
  }

  async getRecentInteractions(userId, limit = 50) {
    try {
      const result = await this.query(
        `SELECT * FROM user_interactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (e) {
      return [];
    }
  }

  // ============================================
  // SHARED HELPER METHODS
  // ============================================

  async getOrRefreshSnapshot(userId, entityId, selectedToolkits) {
    const snapshot = {
      calendar: [],
      tasks: [],
      mentions: [],
      prs: [],
      emails: [],
    };

    // Check for cached snapshots
    const cached = await this.getCachedSnapshot(userId);
    const staleTypes = [];

    for (const type of ['calendar_today', 'assigned_issues', 'mentions', 'prs_waiting', 'unread_emails']) {
      const cachedType = cached.find(c => c.snapshot_type === type);
      if (!cachedType || new Date(cachedType.expires_at) < new Date()) {
        staleTypes.push(type);
      } else {
        this.mergeSnapshot(snapshot, type, cachedType.data);
      }
    }

    // Refresh stale data
    if (staleTypes.length > 0) {
      await this.refreshSnapshotData(userId, entityId, selectedToolkits, staleTypes, snapshot);
    }

    return snapshot;
  }

  async getCachedSnapshot(userId) {
    try {
      const result = await this.query(
        `SELECT * FROM context_snapshots
         WHERE user_id = $1 AND expires_at > NOW()`,
        [userId]
      );
      return result.rows;
    } catch (e) {
      return [];
    }
  }

  async refreshSnapshotData(userId, entityId, selectedToolkits, types, snapshot) {
    this.composio.setEntityId(entityId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    const fetchPromises = [];

    // Calendar events
    if (types.includes('calendar_today') && selectedToolkits.includes('GOOGLECALENDAR')) {
      fetchPromises.push(
        this.fetchCalendarEvents(entityId, todayStart, todayEnd)
          .then(data => this.storeSnapshot(userId, 'calendar_today', data, 'GOOGLECALENDAR'))
          .then(data => { snapshot.calendar = data || []; })
          .catch(e => console.error('[ProactiveEngine] Calendar fetch error:', e.message))
      );
    }

    // Jira issues
    if (types.includes('assigned_issues') && selectedToolkits.includes('JIRA')) {
      fetchPromises.push(
        this.fetchJiraIssues(entityId)
          .then(data => this.storeSnapshot(userId, 'assigned_issues', data, 'JIRA'))
          .then(data => { snapshot.tasks.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Jira fetch error:', e.message))
      );
    }

    // Trello cards
    if (types.includes('assigned_issues') && selectedToolkits.includes('TRELLO')) {
      fetchPromises.push(
        this.fetchTrelloCards(entityId)
          .then(data => { snapshot.tasks.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Trello fetch error:', e.message))
      );
    }

    // Linear issues
    if (types.includes('assigned_issues') && selectedToolkits.includes('LINEAR')) {
      fetchPromises.push(
        this.fetchLinearIssues(entityId)
          .then(data => { snapshot.tasks.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Linear fetch error:', e.message))
      );
    }

    // Asana tasks
    if (types.includes('assigned_issues') && selectedToolkits.includes('ASANA')) {
      fetchPromises.push(
        this.fetchAsanaTasks(entityId)
          .then(data => { snapshot.tasks.push(...(data || [])); })
          .catch(e => console.error('[ProactiveEngine] Asana fetch error:', e.message))
      );
    }

    // GitHub PRs
    if (types.includes('prs_waiting') && selectedToolkits.includes('GITHUB')) {
      fetchPromises.push(
        this.fetchGitHubPRs(entityId)
          .then(data => this.storeSnapshot(userId, 'prs_waiting', data, 'GITHUB'))
          .then(data => { snapshot.prs = data || []; })
          .catch(e => console.error('[ProactiveEngine] GitHub fetch error:', e.message))
      );
    }

    // Slack mentions
    if (types.includes('mentions') && selectedToolkits.includes('SLACK')) {
      fetchPromises.push(
        this.fetchSlackMentions(entityId)
          .then(data => this.storeSnapshot(userId, 'mentions', data, 'SLACK'))
          .then(data => { snapshot.mentions = data || []; })
          .catch(e => console.error('[ProactiveEngine] Slack fetch error:', e.message))
      );
    }

    // Gmail unread
    if (types.includes('unread_emails') && selectedToolkits.includes('GMAIL')) {
      fetchPromises.push(
        this.fetchUnreadEmails(entityId)
          .then(data => this.storeSnapshot(userId, 'unread_emails', data, 'GMAIL'))
          .then(data => { snapshot.emails = data || []; })
          .catch(e => console.error('[ProactiveEngine] Gmail fetch error:', e.message))
      );
    }

    await Promise.all(fetchPromises);
    return snapshot;
  }

  // Tool-specific fetch methods
  async fetchCalendarEvents(entityId, timeMin, timeMax) {
    const execResult = await this.composio.executeAction(
      'GOOGLECALENDAR_EVENTS_LIST',
      {
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      },
      entityId
    );

    return execResult?.data?.items?.map(e => ({
      id: e.id,
      title: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      link: e.htmlLink,
      attendees: e.attendees?.length || 0,
      organizer: e.organizer?.email,
      location: e.location,
    })) || [];
  }

  async fetchJiraIssues(entityId) {
    const execResult = await this.composio.executeAction(
      'JIRA_SEARCH_ISSUES',
      {
        jql: 'assignee = currentUser() AND status != Done ORDER BY priority DESC, updated DESC',
        maxResults: 20,
      },
      entityId
    );

    return execResult?.data?.issues?.map(i => ({
      id: i.key,
      title: i.fields?.summary,
      status: i.fields?.status?.name,
      priority: i.fields?.priority?.name,
      dueDate: i.fields?.duedate,
      lastUpdated: i.fields?.updated,
      link: `https://jira.atlassian.com/browse/${i.key}`,
      source: 'jira',
    })) || [];
  }

  async fetchTrelloCards(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'TRELLO_GET_CARDS',
        { filter: 'open' },
        entityId
      );

      return execResult?.data?.map(c => ({
        id: c.id,
        title: c.name,
        status: c.list?.name || 'Unknown',
        dueDate: c.due,
        link: c.url,
        source: 'trello',
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async fetchLinearIssues(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'LINEAR_LIST_ISSUES',
        { assignedToMe: true },
        entityId
      );

      return execResult?.data?.map(i => ({
        id: i.identifier,
        title: i.title,
        status: i.state?.name,
        priority: i.priority,
        dueDate: i.dueDate,
        link: i.url,
        source: 'linear',
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async fetchAsanaTasks(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'ASANA_GET_TASKS',
        { assignee: 'me', completed: false },
        entityId
      );

      return execResult?.data?.map(t => ({
        id: t.gid,
        title: t.name,
        status: t.completed ? 'Done' : 'Open',
        dueDate: t.due_on,
        link: `https://app.asana.com/0/${t.gid}`,
        source: 'asana',
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async fetchGitHubPRs(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'GITHUB_LIST_PULL_REQUESTS',
        { state: 'open' },
        entityId
      );

      return execResult?.data?.map(pr => ({
        id: pr.number,
        title: pr.title,
        repo: pr.base?.repo?.full_name,
        author: pr.user?.login,
        link: pr.html_url,
        created_at: pr.created_at,
        reviewRequested: pr.requested_reviewers?.length > 0,
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async fetchSlackMentions(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'SLACK_SEARCH_MESSAGES',
        { query: 'to:me', count: 20 },
        entityId
      );

      return execResult?.data?.messages?.matches?.map(m => ({
        id: m.ts,
        text: m.text?.slice(0, 100),
        channel: m.channel?.name,
        from: m.username,
        timestamp: m.ts,
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async fetchUnreadEmails(entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'GMAIL_FETCH_EMAILS',
        { query: 'is:unread', maxResults: 10 },
        entityId
      );

      return execResult?.data?.map(e => ({
        id: e.id,
        subject: e.subject,
        from: e.from,
        snippet: e.snippet?.slice(0, 100),
        date: e.date,
      })) || [];
    } catch (e) {
      return [];
    }
  }

  async storeSnapshot(userId, type, data, sourceApp) {
    try {
      await this.query(
        `INSERT INTO context_snapshots (id, user_id, snapshot_type, data, item_count, source_app, fetched_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 hour')
         ON CONFLICT (user_id, snapshot_type) DO UPDATE
         SET data = $4, item_count = $5, fetched_at = NOW(), expires_at = NOW() + INTERVAL '1 hour'`,
        [uuidv4(), userId, type, JSON.stringify(data), data?.length || 0, sourceApp]
      );
    } catch (e) {
      console.error('[ProactiveEngine] Error storing snapshot:', e.message);
    }
    return data;
  }

  mergeSnapshot(snapshot, type, data) {
    switch (type) {
      case 'calendar_today':
        snapshot.calendar = data || [];
        break;
      case 'assigned_issues':
        snapshot.tasks.push(...(data || []));
        break;
      case 'prs_waiting':
        snapshot.prs = data || [];
        break;
      case 'mentions':
        snapshot.mentions = data || [];
        break;
      case 'unread_emails':
        snapshot.emails = data || [];
        break;
    }
  }

  async analyzeDailyPriorities(snapshot, entityId, preferences) {
    const now = new Date();
    const hour = now.getHours();
    let timeOfDay = 'morning';
    if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17) timeOfDay = 'evening';

    // Calculate deadline urgency
    const today = now.toISOString().split('T')[0];
    const tasksWithDeadlines = snapshot.tasks.filter(t => t.dueDate);
    const urgentDeadlines = tasksWithDeadlines.filter(t => t.dueDate <= today);

    const systemPrompt = `You are an intelligent daily planner assistant. Analyze the user's data and create a prioritized daily plan.

Current time: ${now.toLocaleTimeString()}
Time of day: ${timeOfDay}
Day of week: ${now.toLocaleDateString('en-US', { weekday: 'long' })}

User's data:
- Calendar events today: ${JSON.stringify(snapshot.calendar)}
- Tasks (Jira/Trello/Linear/Asana): ${JSON.stringify(snapshot.tasks)}
- GitHub PRs waiting: ${JSON.stringify(snapshot.prs)}
- Slack mentions: ${JSON.stringify(snapshot.mentions)}
- Unread emails: ${JSON.stringify(snapshot.emails)}

Urgent deadlines (due today or overdue): ${JSON.stringify(urgentDeadlines)}

Create a response with:
1. A friendly greeting appropriate for the time of day
2. A brief summary of what's on their plate (2-3 sentences)
3. Top 5 priorities for today (ranked by importance and urgency)
4. Any blockers or items needing immediate attention
5. Suggested time blocks for the remaining day
6. Quick actions they can take right now (2-3 min tasks)
7. Upcoming deadlines in next 3 days

Respond with ONLY a JSON object:
{
  "greeting": "Good morning! Here's your day ahead.",
  "summary": "You have 3 meetings, 5 open tasks, and 2 PRs waiting for review.",
  "priorities": [
    {"rank": 1, "title": "...", "reason": "...", "source": "jira|calendar|etc", "link": "...", "urgency": "high|normal|low"}
  ],
  "blockers": [
    {"title": "...", "reason": "...", "suggestedAction": "..."}
  ],
  "timeBlocks": [
    {"time": "2pm-3pm", "suggestion": "Focus time for task X", "type": "focus|meeting|break"}
  ],
  "quickActions": [
    {"action": "Review PR #123", "command": "review PR", "estimate": "10 min"}
  ],
  "deadlines": [
    {"title": "...", "dueDate": "...", "daysRemaining": 1}
  ],
  "recommendations": [
    {"type": "priority|blocker|followup", "title": "...", "description": "...", "urgency": "high|normal|low"}
  ]
}`;

    try {
      const response = await this.callGemini(systemPrompt, '', 0.5);

      let jsonStr = response;
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('[ProactiveEngine] Error analyzing priorities:', error);
      return {
        greeting: `Good ${timeOfDay}!`,
        summary: 'I gathered your data but had trouble analyzing it.',
        priorities: [],
        blockers: [],
        timeBlocks: [],
        quickActions: [],
        deadlines: [],
        recommendations: [],
      };
    }
  }

  async storeRecommendations(userId, recommendations) {
    for (const rec of recommendations || []) {
      try {
        await this.query(
          `INSERT INTO proactive_recommendations (id, user_id, rec_type, title, description, urgency, related_items, quick_actions, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '24 hours')`,
          [
            uuidv4(),
            userId,
            rec.type,
            rec.title,
            rec.description,
            rec.urgency || 'normal',
            JSON.stringify(rec.relatedItems || []),
            JSON.stringify(rec.quickActions || []),
          ]
        );
      } catch (e) {
        console.error('[ProactiveEngine] Error storing recommendation:', e.message);
      }
    }
  }

  async getPendingRecommendations(userId) {
    try {
      const result = await this.query(
        `SELECT * FROM proactive_recommendations
         WHERE user_id = $1 AND status = 'pending' AND expires_at > NOW()
         ORDER BY urgency DESC, created_at DESC
         LIMIT 10`,
        [userId]
      );
      return result.rows;
    } catch (e) {
      return [];
    }
  }

  async updateRecommendationStatus(recId, status) {
    const column = status === 'shown' ? 'shown_at' : 'acted_at';
    try {
      await this.query(
        `UPDATE proactive_recommendations SET status = $1, ${column} = NOW() WHERE id = $2`,
        [status, recId]
      );
    } catch (e) {
      console.error('[ProactiveEngine] Error updating recommendation:', e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Lightweight webhook hooks (best-effort, non-blocking)
  // ---------------------------------------------------------------------------

  async processNewEmails({ userId, entityId, historyId }) {
    try {
      const sinceDate = new Date(Date.now() - 60 * 60 * 1000);
      const items = await this.fetchEmailActivity(entityId, sinceDate);

      if (userId) {
        await this.recordInteraction(userId, "gmail_push", { historyId, itemCount: (items || []).length });
      }

      return { type: "gmail_push", processed: true, itemCount: (items || []).length };
    } catch (e) {
      console.error("[ProactiveEngine] processNewEmails error:", e.message);
      return { type: "gmail_push", processed: false, error: e.message };
    }
  }

  async processJiraEvent({ userId, entityId, event, issue, changelog }) {
    try {
      if (userId) {
        await this.recordInteraction(userId, "jira_webhook", {
          event,
          issueKey: issue?.key,
          changelogFields: Array.isArray(changelog?.items) ? changelog.items.map((i) => i.field).filter(Boolean) : [],
        });
      }

      return { type: "jira_webhook", processed: true, issueKey: issue?.key || null, event: event || null };
    } catch (e) {
      console.error("[ProactiveEngine] processJiraEvent error:", e.message);
      return { type: "jira_webhook", processed: false, error: e.message };
    }
  }

  async processCalendarChange({ userId, entityId, resourceId, resourceState }) {
    try {
      if (userId) {
        await this.recordInteraction(userId, "calendar_webhook", { resourceId, resourceState });
      }

      return { type: "calendar_webhook", processed: true, resourceId: resourceId || null, resourceState: resourceState || null };
    } catch (e) {
      console.error("[ProactiveEngine] processCalendarChange error:", e.message);
      return { type: "calendar_webhook", processed: false, error: e.message };
    }
  }
}

module.exports = ProactiveEngine;
