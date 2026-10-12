'use strict';
// What the page says to a screen reader while a turn runs: one short sentence at the few moments that matter (an
// agent takes over, the turn ends, a proposal arrives, a proposal's action is over), never the text as it streams.
// room.js puts these in the page's one live region (#sr-announce). Loaded by room.html before room.js;
// tests/room_suite.py runs this same file in node's vm.
globalThis.Announce = (() => {
  const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
  const sentence = (text) => {
    const t = String(text || '').trim().replace(/[:\s]+$/, '');
    return !t ? '' : /[.!?…]$/.test(t) ? t : `${t}.`;
  };

  // The room's focus agent answers in the chat instead of Coen.
  const handOff = (name) => `Coen handed this to ${name}.`;

  // The end of a turn. `status` is the end event's; `cards` are the agents in the rail for this turn, each
  // { name, maker, replied }; `focus` is the name of a focus agent that answered in the chat, if one did.
  const turnEnd = (status, cards = [], focus = '') => {
    const cut = { stopped: 'Stopped.', interrupted: 'Interrupted: the room server stopped.', error: 'Ended with an error.' }[status];
    if (cut) return cut;
    if (!cards.length) return `${focus || 'Coen'} replied.`;
    const names = list([...new Set(cards.map((c) => c.name))]);
    const replied = cards.filter((c) => c.replied).length;
    return cards.every((c) => c.maker) ? `Sent to ${names}, ${replied} of ${cards.length} done.` : `Consulted ${names}, ${replied} of ${cards.length} replied.`;
  };

  // A new proposal card. `what` is the card's kind ("GitHub issue", "send to" a maker), `summary` the proposal's own.
  const proposal = (owner, what, summary) => `New proposal from ${owner}, ${what}${summary ? `: ${sentence(summary)}` : '.'} Waiting for your decision.`;

  // A proposal's action is over. `state` as the card's pill words it ("done", "failed", "stopped"), `text` what the
  // card says under it, without its links.
  const result = (state, text) => `Proposal ${state}${sentence(text) ? `: ${sentence(text)}` : '.'}`;

  return { handOff, turnEnd, proposal, result };
})();
