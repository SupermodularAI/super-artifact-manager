# Super Artifact Manager: instructions for Claude Code

This repo is a Claude Code skill: `artifact-manager/`. It wraps any prototype, document
or presentation in a player bar, a drawer and a comments sidebar, driven by one config
file (`journeys.json` for a prototype).

**Read `artifact-manager/SKILL.md` before doing anything with it.** It is the
canonical spec: how to add the manager to a prototype, document or deck, write
journeys, mock data, failures and steps, pick an access gate, and turn on live comments.

To use it in another project, copy `artifact-manager/` (and `annotate/` next to it,
for comments) into that project's `.claude/skills/`.

Don't rewrite `control-panel.js` or `annotate/annotator.js` unless asked to change
the tool itself. Treat them as tested, canonical source.
