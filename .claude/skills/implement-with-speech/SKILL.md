---
name: implement-with-speech
description: >-
  Implement a GitHub issue of this repository exactly as `/implement` does, with every
  reply read aloud as it lands. Use when asked to implement an issue "with speech" or "out
  loud" ("/implement-with-speech 22").
---

# Implement with speech

Base: read `.claude/att-docs/plugins/general/skills/implement-with-speech/SKILL.md` first and
follow it, except where this file overrides it. It hands off to the `implement` skill, which in
this repository is the extension at `.claude/skills/implement/SKILL.md`.

## Paths

| Placeholder | Value here |
| --- | --- |
| `<speech-mechanism>` | The `voice` plugin's hooks (`speak-attention.sh`), installed at user scope as `voice@att-docs`. This repository registers no hooks of its own |
| `<voice-relay>` | The voice bridge that same plugin feeds, when it is running on the machine. The session does nothing for it |
| `<reading-rules>` | The plugin's own rules, plus `spokenTerms` in `.claude/skills/voice-bridge-hooks/extension.json` |

## Overrides

None. Every rule in the base skill holds as written.
