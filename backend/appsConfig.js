// backend/appsConfig.js
//
// Central registry of apps SwiftCollab knows about.
// Now integrated with Composio for 500+ app support.
// Only includes apps that are ACTUALLY available in Composio API (verified 2024)

const appsConfig = {
  // Productivity Apps
  gcalender: {
    id: "gcalender",
    name: "Google Calendar",
    type: "composio",
    composioToolkit: "GOOGLECALENDAR",
    icon: "google_calender.png",
  },
  gmail: {
    id: "gmail",
    name: "Gmail",
    type: "composio",
    composioToolkit: "GMAIL",
    icon: "gmail.png",
  },
  slack: {
    id: "slack",
    name: "Slack",
    type: "composio",
    composioToolkit: "SLACK",
    icon: "slack.png",
  },
  jira: {
    id: "jira",
    name: "Jira",
    type: "composio",
    composioToolkit: "JIRA",
    icon: "jira.png",
  },
  asana: {
    id: "asana",
    name: "Asana",
    type: "composio",
    composioToolkit: "ASANA",
    icon: "asana.png",
  },
  clickup: {
    id: "clickup",
    name: "ClickUp",
    type: "composio",
    composioToolkit: "CLICKUP",
    icon: "clickup.svg",
  },
  zoom: {
    id: "zoom",
    name: "Zoom",
    type: "composio",
    composioToolkit: "ZOOM",
    icon: "zoom.png",
  },
  notion: {
    id: "notion",
    name: "Notion",
    type: "composio",
    composioToolkit: "NOTION",
    icon: "notion.png",
  },
  trello: {
    id: "trello",
    name: "Trello",
    type: "composio",
    composioToolkit: "TRELLO",
    icon: "trello.png",
  },
  monday: {
    id: "monday",
    name: "Monday.com",
    type: "composio",
    composioToolkit: "MONDAY",
    icon: "monday.png",
  },

  // CRM & Business
  salesforce: {
    id: "salesforce",
    name: "Salesforce",
    type: "composio",
    composioToolkit: "SALESFORCE",
    icon: "salesforce.png",
  },
  axonaut: {
    id: "axonaut",
    name: "Axonaut",
    type: "composio",
    composioToolkit: "AXONAUT",
    icon: "axonaut.png",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    type: "composio",
    composioToolkit: "HUBSPOT",
    icon: "hubspot.png",
  },
  zendesk: {
    id: "zendesk",
    name: "Zendesk",
    type: "composio",
    composioToolkit: "ZENDESK",
    icon: "zendesk.png",
  },
  intercom: {
    id: "intercom",
    name: "Intercom",
    type: "composio",
    composioToolkit: "INTERCOM",
    icon: "intercom.png",
  },
  servicenow: {
    id: "servicenow",
    name: "ServiceNow",
    type: "composio",
    composioToolkit: "SERVICENOW",
    icon: "servicenow.png",
  },
  workday: {
    id: "workday",
    name: "Workday",
    type: "composio",
    composioToolkit: "WORKDAY",
    icon: "workday.png",
  },
  pipedrive: {
    id: "pipedrive",
    name: "Pipedrive",
    type: "composio",
    composioToolkit: "PIPEDRIVE",
    icon: "pipedrive.png",
  },
  freshdesk: {
    id: "freshdesk",
    name: "Freshdesk",
    type: "composio",
    composioToolkit: "FRESHDESK",
    icon: "freshdesk.png",
  },
  quickbooks: {
    id: "quickbooks",
    name: "QuickBooks",
    type: "composio",
    composioToolkit: "QUICKBOOKS",
    icon: "quickbooks.png",
  },
  xero: {
    id: "xero",
    name: "Xero",
    type: "composio",
    composioToolkit: "XERO",
    icon: "xero.png",
  },

  // Developer Tools
  github: {
    id: "github",
    name: "GitHub",
    type: "composio",
    composioToolkit: "GITHUB",
    icon: "github.png",
  },
  gitlab: {
    id: "gitlab",
    name: "GitLab",
    type: "composio",
    composioToolkit: "GITLAB",
    icon: "gitlab.png",
  },
  bitbucket: {
    id: "bitbucket",
    name: "Bitbucket",
    type: "composio",
    composioToolkit: "BITBUCKET",
    icon: "bitbucket.png",
  },
  linear: {
    id: "linear",
    name: "Linear",
    type: "composio",
    composioToolkit: "LINEAR",
    icon: "linear.png",
  },
  confluence: {
    id: "confluence",
    name: "Confluence",
    type: "composio",
    composioToolkit: "CONFLUENCE",
    icon: "confluence.png",
  },

  // Productivity & Storage
  airtable: {
    id: "airtable",
    name: "Airtable",
    type: "composio",
    composioToolkit: "AIRTABLE",
    icon: "airtable.png",
  },
  dropbox: {
    id: "dropbox",
    name: "Dropbox",
    type: "composio",
    composioToolkit: "DROPBOX",
    icon: "dropbox.png",
  },
  drive: {
    id: "drive",
    name: "Google Drive",
    type: "composio",
    composioToolkit: "GOOGLEDRIVE",
    icon: "drive.png",
  },
  docs: {
    id: "docs",
    name: "Google Docs",
    type: "composio",
    composioToolkit: "GOOGLEDOCS",
    icon: "docs.png",
  },
  sheets: {
    id: "sheets",
    name: "Google Sheets",
    type: "composio",
    composioToolkit: "GOOGLESHEETS",
    icon: "sheets.png",
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    type: "composio",
    composioToolkit: "OUTLOOK",
    icon: "outlook.png",
  },
  todoist: {
    id: "todoist",
    name: "Todoist",
    type: "composio",
    composioToolkit: "TODOIST",
    icon: "todoist.png",
  },
  calendly: {
    id: "calendly",
    name: "Calendly",
    type: "composio",
    composioToolkit: "CALENDLY",
    icon: "calendly.png",
  },
  figma: {
    id: "figma",
    name: "Figma",
    type: "composio",
    composioToolkit: "FIGMA",
    icon: "figma.png",
  },
  miro: {
    id: "miro",
    name: "Miro",
    type: "composio",
    composioToolkit: "MIRO",
    icon: "miro.png",
  },

  // Communication & Social
  discord: {
    id: "discord",
    name: "Discord",
    type: "composio",
    composioToolkit: "DISCORD",
    icon: "discord.png",
  },
  twitter: {
    id: "twitter",
    name: "Twitter/X",
    type: "composio",
    composioToolkit: "TWITTER",
    icon: "twitter.png",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    type: "composio",
    composioToolkit: "LINKEDIN",
    icon: "linkedin.png",
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    type: "composio",
    composioToolkit: "FACEBOOK",
    icon: "facebook.png",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    type: "composio",
    composioToolkit: "INSTAGRAM",
    icon: "instagram.png",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    type: "composio",
    composioToolkit: "YOUTUBE",
    icon: "youtube.png",
  },

  // ERP & Business Management
  frappe: {
    id: "frappe",
    name: "Frappe/ERPNext",
    type: "custom",
    composioToolkit: null, // Uses custom API integration
    icon: "frappe.png",
  },

};

// Helper to get Composio toolkit name from app ID
function getComposioToolkit(appId) {
  return appsConfig[appId]?.composioToolkit || null;
}

// Helper to get app ID from Composio toolkit name
function getAppIdFromToolkit(toolkit) {
  for (const [appId, config] of Object.entries(appsConfig)) {
    if (config.composioToolkit === toolkit) {
      return appId;
    }
  }
  return null;
}

module.exports = { appsConfig, getComposioToolkit, getAppIdFromToolkit };
