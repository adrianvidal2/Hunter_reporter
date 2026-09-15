# 🚨 CONFIRMED LIVE 2026-08-12 — AUTH COOKIE FORGERY via test page
# (/pws/Test/PwsModuleTest?user=<userId> → FormsAuthentication.SetAuthCookie without verification)

**Target:** www.example-target.com — Example Program (YWH, HIGH)
**Endpoint:** `GET /pws/Test/PwsModuleTest?user=<userId>&portal=<portalGuid>`
**Class:** Broken Authentication / Missing Authentication (CWE-287) — test page in production
**Severity:** 🟠 High (identity forgery primitive; chains with other flows)

---

## Vulnerable code (`App.Test.PwsModuleTest.cs`, Page_Load)

```csharp
if (!string.IsNullOrEmpty(Request.QueryString["user"]))
{
    // no ownership or role verification before issuing the auth cookie
    FormsAuthentication.SetAuthCookie(Request.QueryString["user"], true);
}
```

## Impact

Any unauthenticated attacker can mint a valid session for an arbitrary user
identifier and reach authenticated functionality.

## Remediation

Remove test endpoints from production and require server-side authorization
before issuing authentication cookies.
