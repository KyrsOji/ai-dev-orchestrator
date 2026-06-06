# OFBiz Runner Validation Notes

This repository was recreated from validated OFBiz run artifacts.

Key findings:
- Kafka principal: `User:ai-dev-runner-ofbiz` (previously mis-documented with CN=...)
- Truststore: original bundle had 0 entries; fixed bundle contains `yahlife-root-ca`.
- Task consumer CLI usage: use `cmd.extend([...])` when passing multiple args programmatically.

