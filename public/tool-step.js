'use strict';
// What a message's tool line says, in plain words: the step the agent is on ("Reading room-server.js… · 3 tool
// calls"), and once that step is over, what it did ("Read room-server.js · 3 tool calls"), so the trail stays
// readable. Also the line for what an agent has just started on ("Thinking…", "Writing a file…").
// Loaded by room.html before room.js; tests/room_suite.py runs this same file in node's vm.
// A tool event may lack a name or a detail (old chats, tools that take neither): those get the tool's own name, or
// just the count, never "undefined".
globalThis.ToolStep = (() => {
  const MAX = 80;
  const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const short = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
  // The file's name only: the full path is in the list behind the line.
  const base = (p) => p.split('/').filter(Boolean).pop() || p;
  const count = (n) => `${n} tool call${n === 1 ? '' : 's'}`;

  // `past`: the step is over ("Read x"), not going on ("Reading x").
  const words = (past) => (name, detail) => {
    const n = str(name);
    const d = str(detail);
    const t = (doing, done) => (past ? done : doing);
    // `bare`: what to say when the step came without a detail.
    const about = (verb, bare, what = d) => short(what ? `${verb} ${what}` : bare);
    if (n === 'Read') return about(t('Reading', 'Read'), t('Reading a file', 'Read a file'), d && base(d));
    if (n === 'Write') return about(t('Writing', 'Wrote'), t('Writing a file', 'Wrote a file'), d && base(d));
    if (n === 'Edit') return about(t('Editing', 'Edited'), t('Editing a file', 'Edited a file'), d && base(d));
    if (n === 'Grep') return about(t('Searching files for', 'Searched files for'), t('Searching files', 'Searched files'));
    if (n === 'Glob') return about(t('Looking for files named', 'Looked for files named'), t('Looking for files', 'Looked for files'));
    if (n === 'WebSearch') return about(t('Searching the web for', 'Searched the web for'), t('Searching the web', 'Searched the web'));
    if (n === 'WebFetch') return about(t('Opening', 'Opened'), t('Opening a web page', 'Opened a web page'));
    if (n === 'ToolSearch') return t('Loading tools', 'Loaded tools');
    if (n === 'Agent' || n === 'Task') return about(t('Asking another agent:', 'Asked another agent:'), t('Asking another agent', 'Asked another agent'));
    if (n.startsWith('mcp__')) {
      const [, server = '', tool = ''] = n.split('__');
      if (/notion/i.test(server)) {
        return /search|query/i.test(tool) ? about(t('Searching Notion for', 'Searched Notion for'), t('Searching Notion', 'Searched Notion')) : t('Reading Notion', 'Read Notion');
      }
      if (/microsoft|outlook/i.test(server)) return about(t('Searching mail for', 'Searched mail for'), t('Searching mail', 'Searched mail'));
      return short(`${t('Using', 'Used')} ${tool || server}`);
    }
    return n ? short(d ? `${n} · ${d}` : n) : t('Working', '');
  };
  const doing = words(false);
  const done = words(true);

  // While the agent is on a step. `step`: what `doing` returned for it.
  const summary = (n, step) => (step ? `${step}… · ${count(n)}` : count(n));
  // Once the step is over. `last`: what `done` returned for the line's latest step; a line of one step needs no count.
  const trail = (n, last) => (!last ? count(n) : n === 1 ? last : `${last} · ${count(n)}`);
  // What an agent has just started on: composing a step for the tool `name`, or, without a name, thinking.
  // `inferred`: a consulted agent, which doesn't report either; the room only knows it is between steps.
  const activity = (name, inferred) => (inferred ? 'Working on it…' : `${str(name) ? doing(name) : 'Thinking'}…`);
  return { doing, done, summary, trail, activity };
})();
