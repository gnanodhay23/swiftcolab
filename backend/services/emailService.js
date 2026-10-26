const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error('A valid email address is required');
  return normalized;
}

async function sendOrganizationInvitation({ email, organizationName, invitationUrl }) {
  const recipient = assertEmail(email);
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invitation email is not configured');
    }
    return { delivered: false, previewUrl: invitationUrl };
  }

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is required to send invitation email');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `You are invited to ${organizationName} on SwiftCollab`,
      text: `You have been invited to join ${organizationName} on SwiftCollab. Accept your invitation: ${invitationUrl}`,
    }),
  });
  if (!response.ok) throw new Error('Unable to send invitation email');
  return { delivered: true };
}

module.exports = { assertEmail, sendOrganizationInvitation };
