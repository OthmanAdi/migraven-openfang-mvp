export type SecurityCheck = {
  id: string;
  title: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  cypher: string;
  remediation: string;
};

export const SECURITY_CHECKS: Record<string, SecurityCheck> = {
  admin_sprawl: {
    id: "admin_sprawl",
    title: "Excessive members in privileged groups",
    severity: "high",
    cypher: `
      MATCH (g:Group)
      WHERE g.name IN ['Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators']
      OPTIONAL MATCH (g)<-[:MEMBER_OF*1..]-(u:User)
      WITH g, count(DISTINCT u) AS direct_members
      WHERE direct_members > 10
      RETURN g.name AS group_name, direct_members
      ORDER BY direct_members DESC
      LIMIT 50
    `,
    remediation:
      "Privileged groups should have <= 5 direct members. Move daily-driver accounts out, use tiered admin model.",
  },
  unconstrained_delegation: {
    id: "unconstrained_delegation",
    title: "Accounts with unconstrained delegation",
    severity: "critical",
    cypher: `
      MATCH (n)
      WHERE (n:User OR n:Computer)
        AND coalesce(n.unconstrainedDelegation, n.TRUSTED_FOR_DELEGATION) = true
      RETURN labels(n) AS kind, coalesce(n.sAMAccountName, n.name) AS account, n.distinguishedName AS dn
      LIMIT 100
    `,
    remediation:
      "Convert to constrained delegation or remove. Unconstrained delegation enables ticket theft and full domain compromise.",
  },
  weak_password_policy: {
    id: "weak_password_policy",
    title: "Accounts with 'password never expires' or no password required",
    severity: "high",
    cypher: `
      MATCH (u:User)
      WHERE coalesce(u.passwordNeverExpires, false) = true
         OR coalesce(u.passwordNotRequired, false) = true
      RETURN
        u.sAMAccountName AS sam,
        coalesce(u.passwordNeverExpires, false) AS neverExpires,
        coalesce(u.passwordNotRequired, false)  AS notRequired,
        u.lastLogonTimestamp AS lastLogon
      LIMIT 200
    `,
    remediation:
      "Disable 'password never expires' for non-service accounts. Service accounts use Group Managed Service Accounts (gMSA).",
  },
  orphan_sids: {
    id: "orphan_sids",
    title: "Group memberships referencing unresolvable SIDs",
    severity: "medium",
    cypher: `
      MATCH (g:Group)
      WHERE g.unresolvedSids IS NOT NULL AND size(g.unresolvedSids) > 0
      RETURN g.name AS group_name, g.distinguishedName AS dn, size(g.unresolvedSids) AS orphan_count
      ORDER BY orphan_count DESC
      LIMIT 100
    `,
    remediation:
      "Run a cleanup pass to remove SIDs of objects that no longer exist. Orphan SIDs hide stale trust relationships.",
  },
  stale_accounts: {
    id: "stale_accounts",
    title: "Enabled accounts with no logon in 180 days",
    severity: "medium",
    cypher: `
      WITH datetime() - duration({days: 180}) AS cutoff
      MATCH (u:User)
      WHERE coalesce(u.enabled, true) = true
        AND u.lastLogonTimestamp IS NOT NULL
        AND datetime(u.lastLogonTimestamp) < cutoff
      RETURN u.sAMAccountName AS sam, u.lastLogonTimestamp AS lastLogon, u.distinguishedName AS dn
      ORDER BY u.lastLogonTimestamp ASC
      LIMIT 200
    `,
    remediation:
      "Disable or remove accounts unused >180 days. Stale accounts widen the attack surface and inflate licence costs.",
  },
  kerberoastable: {
    id: "kerberoastable",
    title: "Kerberoastable service accounts (SPN + user)",
    severity: "high",
    cypher: `
      MATCH (u:User)
      WHERE u.servicePrincipalName IS NOT NULL
        AND size(u.servicePrincipalName) > 0
        AND coalesce(u.enabled, true) = true
      RETURN u.sAMAccountName AS sam, u.servicePrincipalName AS spn, u.adminCount AS adminCount
      LIMIT 100
    `,
    remediation:
      "Migrate service principals to gMSA, or enforce 25+ character random passwords. Privileged kerberoastable accounts are critical.",
  },
};
