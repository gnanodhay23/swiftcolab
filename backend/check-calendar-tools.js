// Script to check GOOGLECALENDAR_FIND_EVENT parameters
require('dotenv').config();

async function checkFindEventParams() {
  const apiKey = process.env.COMPOSIO_API_KEY;

  if (!apiKey) {
    console.error('COMPOSIO_API_KEY not found in .env');
    return;
  }

  try {
    console.log('Fetching GOOGLECALENDAR_FIND_EVENT action details...\n');

    // Get specific action details
    const response = await fetch('https://backend.composio.dev/api/v2/actions/GOOGLECALENDAR_FIND_EVENT', {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('API Error:', response.status, await response.text());
      return;
    }

    const data = await response.json();

    console.log('Action Name:', data.name);
    console.log('Description:', data.description);
    console.log('\nParameters:');
    console.log(JSON.stringify(data.parameters, null, 2));

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkFindEventParams();
