// Quick script to check all Composio connection statuses
require('dotenv').config();
const { ComposioService } = require('./composioService');

async function checkConnections() {
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!apiKey) {
    console.error('❌ COMPOSIO_API_KEY not found in .env');
    return;
  }

  console.log('🔍 Checking SwiftColab Integration Status...\n');
  console.log('=' .repeat(50));

  const composio = new ComposioService(apiKey);

  // Check connected accounts
  try {
    console.log('\n📱 COMPOSIO CONNECTED APPS:');
    console.log('-'.repeat(40));

    const accounts = await composio.listConnectedAccounts();

    if (!accounts.items || accounts.items.length === 0) {
      console.log('⚠️  No apps connected via Composio');
      console.log('   Users need to connect apps through the SwiftColab UI');
    } else {
      accounts.items.forEach(account => {
        const status = account.status === 'ACTIVE' ? '✅' : '❌';
        console.log(`${status} ${account.toolkit?.name || account.appName} (${account.status})`);
        console.log(`   Account ID: ${account.id}`);
        console.log(`   User/Entity: ${account.member?.email || 'default'}`);
      });
    }

    // Check specific toolkits
    const toolkitsToCheck = ['GOOGLECALENDAR', 'GMAIL', 'SLACK', 'JIRA'];

    console.log('\n\n📊 TOOLKIT STATUS:');
    console.log('-'.repeat(40));

    for (const toolkit of toolkitsToCheck) {
      try {
        const tools = await composio.getToolsForToolkit(toolkit);
        if (tools && tools.length > 0) {
          console.log(`✅ ${toolkit}: ${tools.length} tools available`);
        } else {
          console.log(`⚠️  ${toolkit}: No tools (not connected or no auth config)`);
        }
      } catch (error) {
        console.log(`❌ ${toolkit}: Error - ${error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error checking Composio:', error.message);
  }

  // Check Frappe/ERPNext
  console.log('\n\n🏢 FRAPPE/ERPNEXT:');
  console.log('-'.repeat(40));

  const frappeUrl = process.env.FRAPPE_URL;
  const frappeApiKey = process.env.FRAPPE_API_KEY;
  const frappeApiSecret = process.env.FRAPPE_API_SECRET;

  if (frappeUrl && frappeApiKey && frappeApiSecret) {
    console.log(`✅ Frappe URL: ${frappeUrl}`);
    console.log(`✅ API Key configured: ${frappeApiKey.substring(0,4)}...`);

    // Try to ping Frappe
    try {
      const response = await fetch(`${frappeUrl}/api/method/frappe.auth.get_logged_user`, {
        headers: {
          'Authorization': `token ${frappeApiKey}:${frappeApiSecret}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Frappe Connected as: ${data.message}`);
      } else {
        console.log(`⚠️  Frappe Auth Error: ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ Frappe Connection Error: ${error.message}`);
    }
  } else {
    console.log('⚠️  Frappe credentials not fully configured');
  }

  console.log('\n' + '='.repeat(50));
  console.log('Done checking integrations');
}

checkConnections();
