Read AGENTS.md first. It has the stack, API, and domain rules.

Workflow rules:
- Use plan mode for anything touching more than one file. Wait for my approval before coding.
- One logical change per commit. Show the diff summary after each commit.
- Never change anything listed under "Domain rules" in AGENTS.md.
- Never read or print .env or any secret value.
- Don't add new dependencies without asking.
- If something in AGENTS.md or README contradicts the code, trust the code and tell me.