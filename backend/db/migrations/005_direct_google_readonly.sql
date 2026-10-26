-- Sprint 0/1: organization-owned direct Google OAuth, read-only initially.

CREATE TABLE IF NOT EXISTS organization_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    integration_key VARCHAR(100) NOT NULL,
    connected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'connected',
    scopes JSONB NOT NULL DEFAULT '[]',
    encrypted_credentials TEXT NOT NULL,
    connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    disconnected_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, provider, integration_key)
);

CREATE INDEX IF NOT EXISTS idx_organization_integrations_organization
    ON organization_integrations (organization_id, provider, status);

CREATE TABLE IF NOT EXISTS oauth_authorization_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_hash CHAR(64) UNIQUE NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    encrypted_code_verifier TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_states_expiry
    ON oauth_authorization_states (expires_at);

DROP TRIGGER IF EXISTS update_organization_integrations_updated_at ON organization_integrations;
CREATE TRIGGER update_organization_integrations_updated_at
    BEFORE UPDATE ON organization_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
