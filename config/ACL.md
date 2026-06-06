# Kafka ACL Guidance for OFBiz Runner

- Effective Kafka principal to use in ACLs: `User:ai-dev-runner-ofbiz`
- Do NOT use `User:CN=ai-dev-runner-ofbiz` — this is incorrect for the runner certificate principal.
- When adding ACLs, prefer the exact `User:...` principal form used by Kafka's authorizer.

