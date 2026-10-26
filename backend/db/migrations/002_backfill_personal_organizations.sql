-- Give every existing user a private organization before organization-scoped
-- routes and direct OAuth connections are enabled.

INSERT INTO organizations (name, slug)
SELECT
    COALESCE(NULLIF(TRIM(u.name), ''), split_part(u.email, '@', 1)) || ' Workspace',
    'user-' || replace(u.id::text, '-', '')
FROM users u
WHERE NOT EXISTS (
    SELECT 1
    FROM organization_members m
    WHERE m.user_id = u.id
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
FROM users u
JOIN organizations o ON o.slug = 'user-' || replace(u.id::text, '-', '')
WHERE NOT EXISTS (
    SELECT 1
    FROM organization_members m
    WHERE m.organization_id = o.id AND m.user_id = u.id
);
