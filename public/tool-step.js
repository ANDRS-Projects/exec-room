'use strict';
// What a message's tool line says: "N tool calls", and while the agent is on a step, that step in plain words in
// front of it ("Reading room-server.js… · 3 tool calls"). Loaded by room.html before room.js; tests/room_suite.py
// runs this same file in node's vm.
// A tool event may lack a name or a detail (old chats, tools that take neither): those get the tool's own name, or
// "Working", never "undefined".
globalThis.ToolStep = (() => {
  const MAX = 80;
  const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const short = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);
  // The file's name only: the full path is in the list behind the line.
  const base = (p) => p.split('/').filter(Boolean).pop() || p;
  const count = (n) => `${n} tool call${n === 1 ? '' : 's'}`;

  const doing = (name, detail) => {
    const n = str(name);
    const d = str(detail);
    // `bare`: what to say when the step came without a detail.
    const about = (verb, bare, what = d) => short(what ? `${verb} ${what}` : bare);
    if (n === 'Read') return about('Reading', 'Reading a file', d && base(d));
    if (n === 'Write') return about('Writing', 'Writing a file', d && base(d));
    if (n === 'Edit') return about('Editing', 'Editing a file', d && base(d));
    if (n === 'Grep') return about('Searching files for', 'Searching files');
    if (n === 'Glob') return about('Looking for files named', 'Looking for files');
    if (n === 'WebSearch') return about('Searching the web for', 'Searching the web');
    if (n === 'WebFetch') return about('Opening', 'Opening a web page');
    if (n === 'ToolSearch') return 'Loading tools';
    if (n === 'Agent' || n === 'Task') return about('Asking another agent:', 'Asking another agent');
    if (n.startsWith('mcp__')) {
      const [, server = '', tool = ''] = n.split('__');
      if (/notion/i.test(server)) return /search|query/i.test(tool) ? about('Searching Notion for', 'Searching Notion') : 'Reading Notion';
      if (/microsoft|outlook/i.test(server)) return about('Searching mail for', 'Searching mail');
      return short(`Using ${tool || server}`);
    }
    return n ? short(d ? `${n} · ${d}` : n) : 'Working';
  };

  // `step`: what `doing` returned for the step the agent is on, or nothing once that step is over.
  const summary = (n, step) => (step ? `${step}… · ${count(n)}` : count(n));
  return { doing, summary };
})();
