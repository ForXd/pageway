# Security policy

Pageway is currently a developer preview. Security fixes target the latest released version; older versions do not have a separate support branch.

Report vulnerabilities privately through [GitHub security advisories](https://github.com/ForXd/pageway/security/advisories/new). Include the affected version, reproduction steps, and impact, using synthetic data. Do not include access tokens, private page data, or provider credentials. If private reporting is unavailable, open an issue requesting a private contact without disclosing the vulnerability.

Applications own authentication, authorization, rate limiting, and the business permissions of registered tools. CORS and a frontend tool schema are not authorization controls. Context, tool definitions, and tool results arriving from a browser are untrusted server inputs. Keep model credentials on the server and expose only the page data needed for a task.

Per-tool `enabled` and `allowedSources` restrict discovery and execution by chat or WebMCP. `approval` pauses a specific operation before its callback until the user accepts or rejects it. Keep approval descriptions application-owned, identify the affected object and consequence, and never expose `approveAction` or `rejectAction` as agent tools. Pending approvals are cancelled on stop/reset/session changes and never resumed from cache. These browser controls do not enforce identity, protect against malicious same-origin scripts, or replace backend authorization and transaction checks. Stored action/approval history is mutable client data, not a durable audit trail. Rejection declines one call; stop cancels the whole task.

Cancelling a task stops future tool execution and propagates an AbortSignal to cooperative operations. It does not roll back completed mutations or cancel side effects that ignore that signal. The visible page lock prevents accidental user interaction; it is not a security boundary against other scripts.
