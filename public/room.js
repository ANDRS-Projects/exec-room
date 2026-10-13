'use strict';
// Exec Room client: Coen's thread in the main column, consulted peers as cards in the rail.
// Live events and replayed history (GET /api/room) go through the same handle(). A running job is
// followed via GET /api/stream, so reloading the page re-attaches instead of stopping Coen.

// Built-in agents; room-built ones (GET /api/agents) are added to these on load.
// Coen is the only built-in agent; room-built ones are added from /api/agents.
const NAMES = { coen: 'Coen' };
const MAKERS = new Set();
const BUILT_IN = new Set(Object.keys(NAMES));
// A room-built agent's colour tone, as a class (room.css .tone-1 … .tone-8); '' keeps the shared colours.
const toneOf = (who) => (CUSTOM.has(who) && CUSTOM.get(who).tone ? ` tone-${CUSTOM.get(who).tone}` : '');
const CUSTOM = new Map();  // key → agent, for agents added in the room
// A removed agent still shows up in older turns, under its key.
const nameOf = (who) => NAMES[who] || who;
const $ = (id) => document.getElementById(id);
const thread = $('thread');
const groupsEl = $('groups');
const layout = $('layout');
const input = $('input');
const sendBtn = $('send');
const stopBtn = $('stop');
const coenStatus = $('coen-status');
const narrow = window.matchMedia('(max-width: 719px)');

// ---- Markdown: sanitised, links open in a new tab, no images or inline styles.

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function renderMd(raw) {
  return DOMPurify.sanitize(marked.parse(raw, { gfm: true, breaks: true }), {
    FORBID_TAGS: ['img', 'style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });
}

// Bubbles keep their raw text in JS and re-render at most once per animation frame.
const dirty = new Set();
function renderSoon(bubble) {
  dirty.add(bubble);
  if (dirty.size === 1) requestAnimationFrame(renderDirty);
}
function renderDirty() {
  const scrollers = [thread, groupsEl];
  const pinned = scrollers.map((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  for (const b of dirty) {
    b.el.innerHTML = renderMd(b.stripRecs ? stripRecs(b.raw) : b.raw);
    // Nothing to copy from a message that is only a proposal block.
    if (b.copy) b.copy.hidden = !bubbleText(b);
    if (b.stripRecs) updateProposalHint(b);
  }
  dirty.clear();
  scrollers.forEach((el, i) => { if (pinned[i]) el.scrollTop = el.scrollHeight; });
}

// Coen's proposal blocks are shown as approval cards, so they're hidden from his message text
// (including a block that is still streaming in). As on the server, the closing fence must start a line:
// a ``` inside the JSON (e.g. a code block in a Notion page) sits in a string, where newlines are escaped.
function stripRecs(raw) {
  return raw.replace(/```recommendation[\s\S]*?(\n```|$)/g, '').trim();
}

// Coen writes his proposals last, and they only become cards once he has finished, which can take a while.
// Until then a line under his message (and the header status) says he's on it.
const proposalHint = el('div', 'proposal-hint');

function updateProposalHint(b) {
  // Only for the message being written right now (Coen's, or the focus agent's), not for replayed history.
  const live = (coenMsg && coenMsg.bubble === b) || (turn && [...turn.cards.values()].some((c) => c.inline && c.bubble === b && c.status === 'working'));
  if (!sendBtn.disabled || !live) return;
  const n = (b.raw.match(/```recommendation/g) || []).length;
  if (!n) return;
  proposalHint.textContent = n > 1 ? `${b.owner} is preparing ${n} proposals…` : `${b.owner} is preparing a proposal…`;
  if (thread.lastChild !== proposalHint) appendToThread(proposalHint);
  coenStatus.textContent = 'preparing a proposal…';
}

function clearProposalHint() {
  proposalHint.remove();
  coenStatus.textContent = 'thinking…';
}

// ---- Spoken updates. A screen reader hears nothing of a turn by itself: the thread redraws as text streams, so
// it is no live region. Instead one hidden line (#sr-announce) gets a short sentence at the few moments that
// matter; the sentences are built in announce.js. Only for what happens now: a saved chat drawn on load, and what
// a running job had already done when the page joined it, stay silent.
const srAnnounce = $('sr-announce');
let sayNow = false;  // true from the owner's first message or decision on this page, or once a joined job has caught up
let sayQueue = [];
function say(text) {
  if (!sayNow || !text) return;
  // What arrives together (two proposals and the end of the turn) is spoken as one update, and the line is emptied
  // first so that the same sentence twice in a row is spoken twice.
  if (!sayQueue.length) {
    srAnnounce.textContent = '';
    setTimeout(() => { srAnnounce.textContent = sayQueue.join(' '); sayQueue = []; }, 150);
  }
  sayQueue.push(text);
}

// ---- DOM helpers

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function appendToThread(node) {
  const empty = $('empty');
  if (empty) empty.remove();
  thread.appendChild(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

// The tool lines that name the step their agent is on right now.
const liveTools = new Set();

// One collapsed line of tool calls per message, in plain words (see tool-step.js): the step the agent is on while
// it lasts, so a long step doesn't look idle, and what it did once it is over, so the trail stays readable.
function addTool(holder, name, detail) {
  if (!holder.tools) {
    const details = el('details', 'tools');
    details.append(el('summary'), el('ol'));
    holder.el.appendChild(details);
    holder.tools = { details, count: 0 };
  }
  holder.tools.count += 1;
  holder.tools.last = { name, detail };
  holder.tools.details.querySelector('summary').textContent = ToolStep.summary(holder.tools.count, ToolStep.doing(name, detail));
  liveTools.add(holder.tools);
  holder.tools.details.querySelector('ol').appendChild(el('li', null, name + (detail ? ' · ' + detail : '')));
}

// The step is over (the agent wrote, moved on or finished): the line now says what was done.
function settleTools(tools) {
  if (!tools || !liveTools.delete(tools)) return;
  tools.details.querySelector('summary').textContent = ToolStep.trail(tools.count, ToolStep.done(tools.last.name, tools.last.detail));
}

function settleAllTools() {
  for (const tools of [...liveTools]) settleTools(tools);
}

// What an agent has just started on ("Thinking…", "Writing a file…"): one line per agent, there until its words or
// its step arrive. Never part of the chat: the server sends it only to pages that are watching.
const activityLines = new Map(); // 'coen', or a card's cid → the line

function showActivity(ev) {
  const card = ev.who === 'coen' ? null : cardFor(ev);
  if (ev.who !== 'coen' && !card) return;
  const key = card ? card.cid : 'coen';
  // Whatever the agent was on before is over. A consulted agent's step line would otherwise keep saying
  // "Reading…" until its reply: nothing else tells the page that such a step has come back.
  settleTools(card ? card.tools : coenMsg && coenMsg.tools);
  let line = activityLines.get(key);
  if (!line) {
    line = el('div', 'doing');
    activityLines.set(key, line);
    if (card) card.el.appendChild(line); else appendToThread(line);
  }
  line.textContent = ToolStep.activity(ev.name, ev.inferred);
}

function clearActivity(key) {
  const line = activityLines.get(key);
  if (!line) return;
  line.remove();
  activityLines.delete(key);
}

function clearAllActivity() {
  for (const key of [...activityLines.keys()]) clearActivity(key);
}

function addText(holder, text) {
  settleTools(holder.tools);
  if (!holder.bubble) {
    if (!text.trim()) return;
    holder.bubble = { el: el('div', 'bubble md'), raw: '', stripRecs: Boolean(holder.isCoen || holder.inline), owner: holder.inline ? nameOf(holder.who) : 'Coen' };
    holder.bubble.copy = copyButton(holder.bubble);
    // A reply in the panel is in a narrow column; Coen's, and one given in the chat, only get the icon for a table.
    holder.bubble.holder = holder;
    holder.bubble.pane = !holder.isCoen && !holder.inline;
    holder.bubble.asked = holder.isCoen ? '' : holder.prompt || '';
    holder.bubble.name = holder.isCoen ? 'Coen' : nameOf(holder.who);
    holder.bubble.enlarge = enlargeButton(holder.bubble);
    unsettled.add(holder.bubble);
    // The bubble and its icons share a box as wide as the bubble, so the icons sit under its right edge.
    const reply = el('div', 'reply');
    const actions = el('div', 'reply-actions');
    actions.append(holder.bubble.enlarge, holder.bubble.copy);
    reply.append(holder.bubble.el, actions);
    holder.el.appendChild(reply);
    holder.tools = null;
  }
  holder.bubble.raw += holder.bubble.raw ? text : text.replace(/^\s+/, '');
  renderSoon(holder.bubble);
}

// What a reply says, as it was written (markdown), without the proposal blocks that are shown as cards.
const bubbleText = (b) => (b.stripRecs ? stripRecs(b.raw) : b.raw.trim());

// A reply in a large window: the panel is a narrow column, and a table needs more room than any column here has.
// The icon comes once the reply is finished (the window shows the reply as it is then): on every reply in the
// panel, and on one in the chat only when it has a table.
const ENLARGE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const answerViewer = $('answer-viewer');
const unsettled = new Set(); // replies that may still grow

function enlargeButton(bubble) {
  const btn = el('button', 'copy-btn enlarge-btn');
  btn.type = 'button';
  btn.hidden = true;
  btn.title = 'Enlarge';
  btn.setAttribute('aria-label', `Enlarge this reply from ${bubble.name}`);
  btn.innerHTML = ENLARGE_ICON;
  btn.addEventListener('click', () => openAnswer(bubble));
  return btn;
}

function openAnswer(bubble) {
  $('answer-title').textContent = bubble.name;
  const body = $('answer-body');
  body.replaceChildren();
  if (bubble.asked) {
    const brief = el('details', 'brief');
    brief.append(el('summary', null, (MAKERS.has(bubble.holder.who) ? 'Brief: ' : 'Coen asks: ') + (bubble.asked.split('\n')[0] || '')), el('div', null, bubble.asked));
    body.appendChild(brief);
  }
  const text = el('div', 'md');
  text.innerHTML = renderMd(bubbleText(bubble));
  body.appendChild(text);
  answerViewer.showModal();
}

$('answer-close').addEventListener('click', () => answerViewer.close());

function settleEnlarge(bubble) {
  unsettled.delete(bubble);
  const text = bubbleText(bubble);
  bubble.enlarge.hidden = !(text && (bubble.pane || renderMd(text).includes('<table')));
}
const settleEnlargeOf = (holder) => { for (const b of [...unsettled]) if (b.holder === holder) settleEnlarge(b); };

// A small copy icon under each reply. The result is said in words next to it, since hover text is easy to miss.
const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
function copyButton(bubble) {
  const btn = el('button', 'copy-btn');
  btn.type = 'button';
  btn.title = 'Copy';
  btn.setAttribute('aria-label', 'Copy this reply');
  btn.innerHTML = COPY_ICON;
  const said = el('span', 'copy-said');
  said.setAttribute('aria-live', 'polite');
  btn.appendChild(said);
  let timer = null;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bubbleText(bubble));
      said.textContent = 'Copied';
    } catch {
      said.textContent = "Couldn't copy: select the text instead";
    }
    clearTimeout(timer);
    timer = setTimeout(() => { said.textContent = ''; }, 2500);
  });
  return btn;
}

// ---- Turns, Coen's messages and consult cards

let turn = null;          // { n, marker, slot, group, cards: Map(cid → card) }
let coenMsg = null;       // current Coen message holder { el, bubble, tools }
let turnCount = 0;
const groups = [];        // every turn's group, oldest first, for re-placing on resize

function setRail(open) {
  layout.classList.toggle('rail-open', open);
}

function placeGroup(g) {
  (narrow.matches ? g.slot : groupsEl).appendChild(g.group);
}

// `auto`: a turn the room started itself (Coen's nudge after a maker finished), not a message from the owner.
function startTurn(text, auto = false, files = null) {
  const userMsg = el('div', auto ? 'msg room' : 'msg user');
  // `auto` is true for Coen's nudge and 'chain' for a chain's next maker.
  userMsg.appendChild(el('div', 'bubble', auto === 'chain' ? `Room: ${text}` : auto ? `Room → Coen: ${text}` : text));
  // Names and sizes only: the files themselves were deleted when that turn ended. Nothing for a message without
  // files, such as every message from before attachments existed (see attach-label.js).
  const attached = AttachLabel.line(files);
  if (attached) userMsg.appendChild(el('div', 'attached', attached));
  appendToThread(userMsg);
  settleAllTools();
  if (turn && turn.group) turn.group.open = false;
  turnCount += 1;
  turn = { n: turnCount, text, marker: null, slot: null, group: null, cards: new Map(), ended: false };
  coenMsg = null;
  setRail(false);
}

function ensureCoenMsg() {
  if (!coenMsg) {
    // In a room with a focus agent, Coen's own messages start with his avatar and name, like the focus agent's
    // (the CSS shows it only there).
    const msg = appendToThread(el('div', 'msg coen'));
    const head = el('div', 'focus-head msg-name');
    head.append(avatarFor('coen'), el('span', 'name', 'Coen'));
    msg.appendChild(head);
    coenMsg = { el: msg, bubble: null, tools: null, isCoen: true };
  }
  return coenMsg;
}

function ensureTurn() {
  if (!turn) startTurn('(earlier message)');
  return turn;
}

function updateMarker(t) {
  if (!t.marker) return;
  const cards = [...t.cards.values()].filter((c) => !c.inline);
  const names = [...new Set(cards.map((c) => nameOf(c.who)))].join(', ');
  const replied = cards.filter((c) => c.status === 'replied').length;
  const verb = cards.every((c) => MAKERS.has(c.who)) ? 'Sent to' : 'Consulted';
  t.marker.textContent = `${verb} ${names} · ${replied}/${cards.length} ${verb === 'Sent to' ? 'done' : 'replied'}`;
}

function focusGroup(t) {
  setRail(true);
  t.group.open = true;
  t.group.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  t.group.classList.add('flash');
  setTimeout(() => t.group.classList.remove('flash'), 1200);
}

// `focus`: the room's focus agent, whose reply is the answer, so it goes in the main chat instead of the rail.
function addConsult(who, cid, prompt, focus = false) {
  const t = ensureTurn();
  if (focus) {
    coenMsg = null;
    const msg = { who, cid, prompt, status: 'working', inline: true, el: appendToThread(el('div', `msg focus ${who}${BUILT_IN.has(who) ? '' : ' custom'}${toneOf(who)}`)), bubble: null, tools: null };
    const head = el('div', 'focus-head');
    msg.pill = el('span', 'pill working', 'working');
    head.append(avatarFor(who), el('span', 'name', nameOf(who)), el('span', 'via', 'via Coen'), msg.pill);
    msg.el.appendChild(head);
    t.cards.set(cid, msg);
    say(Announce.handOff(nameOf(who)));
    return;
  }
  if (!t.marker) {
    // Coen's next words come after the marker, in a new message.
    coenMsg = null;
    t.marker = appendToThread(el('button', 'marker'));
    t.marker.type = 'button';
    // The marker opens the panel on this turn's replies, and closes the panel when it is already showing them.
    t.marker.addEventListener('click', () => (layout.classList.contains('rail-open') && t.group.open ? setRail(false) : focusGroup(t)));
    t.slot = appendToThread(el('div', 'inline-slot'));
    t.group = el('details', 'group');
    t.group.open = true;
    t.group.appendChild(el('summary', null, `Turn ${t.n} · ${t.text}`));
    t.group.appendChild(el('div', 'cards'));
    groups.push(t);
    placeGroup(t);
  }
  const cls = `card ${who}${MAKERS.has(who) ? ' maker' : ''}${BUILT_IN.has(who) ? '' : ' custom'}${toneOf(who)}`;
  const card = { who, cid, prompt, status: 'working', el: el('div', cls), bubble: null, tools: null };
  const head = el('div', 'card-head');
  card.pill = el('span', 'pill working', 'working');
  head.append(avatarFor(who), el('span', 'name', nameOf(who)), card.pill);
  const brief = el('details', 'brief');
  brief.append(el('summary', null, (MAKERS.has(who) ? 'Brief: ' : 'Coen asks: ') + (prompt.split('\n')[0] || '')), el('div', null, prompt));
  card.el.append(head, brief);
  t.group.querySelector('.cards').appendChild(card.el);
  t.cards.set(cid, card);
  updateMarker(t);
  setRail(true);
}

function setCardStatus(card, status) {
  card.status = status;
  if (status !== 'working') settleEnlargeOf(card);
  card.pill.className = `pill ${status}`;
  card.pill.textContent = MAKERS.has(card.who) && status === 'replied' ? 'done' : status;
}

function cardFor(ev) {
  if (!turn) return null;
  return turn.cards.get(ev.cid) || [...turn.cards.values()].reverse().find((c) => c.who === ev.who) || null;
}

function endTurn(ev) {
  settleAllTools();
  for (const b of [...unsettled]) settleEnlarge(b);
  clearProposalHint();
  loadChats();
  if (turn && !turn.ended) {
    turn.ended = true;
    for (const card of turn.cards.values()) {
      if (card.status !== 'working') continue;
      if (ev.status === 'ok') setCardStatus(card, card.bubble ? 'replied' : 'failed');
      else setCardStatus(card, ev.status === 'error' ? 'failed' : ev.status);
    }
    if (turn.marker) updateMarker(turn);
    const cards = [...turn.cards.values()];
    const answered = cards.filter((c) => c.inline && c.status === 'replied').pop();
    say(Announce.turnEnd(ev.status, cards.filter((c) => !c.inline).map((c) => ({ name: nameOf(c.who), maker: MAKERS.has(c.who), replied: c.status === 'replied' })), answered ? nameOf(answered.who) : ''));
  }
  const parts = [];
  if (ev.turns) parts.push(`${ev.turns} turn${ev.turns === 1 ? '' : 's'}`);
  if (typeof ev.costUsd === 'number' && ev.costUsd > 0) {
    // A run on an API key is real spend, not what the plan's usage would have cost. A chat that only ever ran on
    // a key has a plain total; one with runs in both modes says which part of its total was spent.
    const keySpend = typeof ev.keyCostUsd === 'number' && ev.keyCostUsd > 0 ? ev.keyCostUsd : 0;
    const allSpend = keySpend > 0 && typeof ev.totalCostUsd === 'number' && Math.abs(ev.totalCostUsd - keySpend) < 0.005;
    const total = typeof ev.totalCostUsd !== 'number' ? ''
      : allSpend ? ` (chat total $${ev.totalCostUsd.toFixed(2)})`
        : ` (chat total ~$${ev.totalCostUsd.toFixed(2)}${keySpend ? `, of which $${keySpend.toFixed(2)} API spend` : ''})`;
    parts.push(ev.auth === 'api-key' ? `$${ev.costUsd.toFixed(3)} API spend${total}` : `~$${ev.costUsd.toFixed(3)} equiv.${total}`);
  }
  const label = { stopped: 'Stopped', interrupted: 'Interrupted (the room server stopped)', error: 'Ended with an error' }[ev.status];
  if (label) parts.unshift(label);
  if (parts.length) appendToThread(el('div', label ? 'meta warn' : 'meta', parts.join(' · ')));
  coenMsg = null;
}

function handle(ev) {
  if (ev.type === 'activity') { showActivity(ev); return; }
  // Anything else from an agent means that what it had just started on has arrived, or is over.
  if (ev.type === 'user' || ev.type === 'end') clearAllActivity();
  else if (ev.who === 'coen' || ev.type === 'consult' || ev.type === 'recommendation') clearActivity('coen');
  else if (ev.who) { const card = cardFor(ev); if (card) clearActivity(card.cid); }
  if (ev.type === 'user') {
    startTurn(ev.text, ev.auto || false, ev.files);
  } else if (ev.type === 'break') {
    if (ev.who === 'coen') { settleTools(coenMsg && coenMsg.tools); coenMsg = null; }
    else { const card = cardFor(ev); if (card) { settleTools(card.tools); if (card.bubble) settleEnlarge(card.bubble); card.bubble = null; card.tools = null; } }
  } else if (ev.type === 'text') {
    if (ev.who === 'coen') addText(ensureCoenMsg(), ev.text);
    else { const card = cardFor(ev); if (card) addText(card, ev.text); }
  } else if (ev.type === 'tool') {
    if (ev.who === 'coen') addTool(ensureCoenMsg(), ev.name, ev.detail);
    else { const card = cardFor(ev); if (card) addTool(card, ev.name, ev.detail); }
  } else if (ev.type === 'recommendation') {
    clearProposalHint();
    settleTools(coenMsg && coenMsg.tools);
    coenMsg = null;
    addRecCard(ev.rec);
  } else if (ev.type === 'decision') {
    const entry = recCards.get(ev.recId);
    if (entry) {
      setRecState(entry, ev.decision);
      showDecided(entry, ev);
      if (ev.note) entry.status.replaceChildren(el('span', null, 'Your note to Coen: ' + ev.note));
      // A dismissal from before reasons existed, or one without a reason, has none and shows nothing.
      if (ev.decision === 'dismissed' && typeof ev.reason === 'string' && ev.reason) {
        entry.said.textContent = 'Your reason: ' + ev.reason;
        entry.said.hidden = false;
      }
      if (ev.decision === 'approved' && entry.rec.action === 'email_draft') {
        // Until when the room keeps the text; a decision from before texts were kept has none.
        if (typeof ev.keepUntil === 'string') entry.keepUntil = ev.keepUntil;
        showEmailLinks(entry);
      }
    }
  } else if (ev.type === 'rec_result') {
    showRecResult(ev);
  } else if (ev.type === 'draft') {
    const holder = ev.who === 'coen' ? ensureCoenMsg() : cardFor(ev);
    if (holder) addDraftChip(holder, ev.name);
  } else if (ev.type === 'consult') {
    settleTools(coenMsg && coenMsg.tools);
    addConsult(ev.who, ev.cid, ev.prompt || '', Boolean(ev.focus));
  } else if (ev.type === 'consult_done') {
    const card = cardFor(ev);
    if (card) { settleTools(card.tools); setCardStatus(card, ev.status || 'replied'); updateMarker(turn); }
  } else if (ev.type === 'notice') {
    appendToThread(el('div', 'notice', ev.text));
    say(ev.text);
  } else if (ev.type === 'error') {
    say(`Error: ${ev.error}`);
    const card = ev.who !== 'coen' && cardFor(ev);
    if (card) card.el.appendChild(el('div', 'bubble err', ev.error));
    else appendToThread(el('div', 'bubble err', ev.error));
  } else if (ev.type === 'end') {
    endTurn(ev);
  }
}

narrow.addEventListener('change', () => groups.forEach(placeGroup));

// The hint about Shift+Enter needs room: in a narrow message box it wrapped onto a second line that was cut off,
// so there the box only says what it is for. The full hint takes about 330px at the page's font size.
// Set once now and again whenever the box or the window changes size (a tab in the background runs no observers).
const INPUT_HINT = input.placeholder;
const fitInputHint = () => { input.placeholder = input.clientWidth < 345 ? 'Message the team…' : INPUT_HINT; };
fitInputHint();
new ResizeObserver(fitInputHint).observe(input);
window.addEventListener('resize', fitInputHint);

// ---- Proposal cards: Coen proposes, the owner approves or asks for a revision, the server acts.

const recCards = new Map();
// The owner's name, from /api/room: shown where a record saved before decisions carried an actor has none.
let ownerName = 'the owner';
const REC_STATES = {
  pending: 'waiting for you', approved: 'approved', running: 'in progress', done: 'done',
  failed: 'failed', stopped: 'stopped', revised: 'revision requested', dismissed: 'dismissed',
};

function recField(label, value) {
  const row = el('div', 'rec-field');
  row.append(el('span', 'rec-label', label), el('span', null, value));
  return row;
}

function recDetails(label, markdown) {
  const details = el('details', 'rec-details');
  const body = el('div', 'md');
  body.innerHTML = renderMd(markdown);
  details.append(el('summary', null, label), body);
  return details;
}

function addRecCard(rec) {
  const card = el('div', 'rec');
  const pill = el('span', 'pill');
  const head = el('div', 'rec-head');
  // Older Notion proposals had a single post in top-level fields.
  const posts = rec.action === 'notion_draft' ? (rec.posts || [{ channel: rec.channel, title: rec.title, content: rec.content, account: rec.account }]) : [];
  const makers = rec.action === 'dispatch' ? [rec.agent, rec.then].filter(Boolean).map(nameOf).join(' → ') : '';
  const title = rec.action === 'dispatch' ? `Proposal · send to ${makers}`
    : rec.action === 'create_agent' ? `Proposal · new ${rec.agent.role}`
    : rec.action === 'notion_draft' ? `Proposal · Notion draft${posts.length > 1 ? `s (${posts.length} posts)` : ''}`
    : rec.action === 'email_draft' ? 'Proposal · email draft'
    : rec.action === 'notion_page' ? 'Proposal · Notion page'
    : rec.action === 'notion_page_update' ? 'Proposal · update a Notion page'
    : rec.action === 'github_comment' ? 'Proposal · GitHub comment' : 'Proposal · GitHub issue';
  head.append(el('span', 'rec-kind', rec.by ? title.replace(/^Proposal/, `Proposal from ${nameOf(rec.by)}`) : title), pill);
  // Under the summary, for a dismissed card only: why it was dismissed (when the owner said), and a way to read
  // what was proposed again, as the card folds to its header and summary.
  const said = el('p', 'rec-said');
  said.hidden = true;
  const more = el('button', 'rec-more', 'Show what was proposed');
  more.type = 'button';
  more.hidden = true;
  more.setAttribute('aria-expanded', 'false');
  card.append(head, el('p', 'rec-summary', rec.summary), said, more);
  if (rec.action === 'dispatch') {
    card.append(recField(rec.then ? 'Chain' : 'Maker', `${makers} · writes into drafts/`), recDetails('Brief', rec.brief));
    if (rec.then) card.append(recField('Then', `${nameOf(rec.then)} works from ${nameOf(rec.agent)}'s draft automatically`));
    if (rec.then_brief) card.append(recDetails(`Context for ${nameOf(rec.then)}`, rec.then_brief));
  } else if (rec.action === 'create_agent') {
    const a = rec.agent;
    const nameField = recField('Name', '');
    if (a.avatar) {
      const img = el('img', 'rec-avatar');
      img.src = presetSrc(a.avatar);
      img.alt = '';
      img.width = 28;
      img.height = 28;
      nameField.lastChild.append(img);
    }
    nameField.lastChild.append(a.name);
    card.append(
      nameField,
      recField('Role', a.role === 'maker' ? 'Maker · works only after you approve a dispatch' : 'Advisor · Coen can consult it'),
      recField('Does', a.does),
      recField('Tools', a.tools.map((t) => toolLabel(t)).join(', ') || 'none'),
      recField('Model', modelLabel(a.model)),
      recDetails('Instructions, rules and script', a.instructions),
    );
  } else if (rec.action === 'notion_draft') {
    card.append(recField('Database', (notionDbs.find((db) => db.key === rec.database) || {}).name || rec.database), recField('Status', 'draft (you schedule it yourself)'));
    for (const post of posts) {
      const details = el('details', 'rec-details');
      const account = post.account ? ` · ${post.account}` : '';
      details.append(el('summary', null, `${post.channel}${account} · ${post.title}`), el('div', 'post-text', post.content));
      card.append(details);
    }
    if (rec.image_prompt) card.append(recDetails('Image prompt (on every row)', rec.image_prompt));
  } else if (rec.action === 'email_draft') {
    // A preview only: approving records the decision, and the links to open the draft appear after that.
    // After a decision the server removes addresses and text from the transcript: a reload shows domains only.
    if (!rec.to && rec.domains) {
      card.append(recField('To', `${rec.domains.join(', ')} · addresses and text removed after your decision`), recField('Subject', rec.subject || ''));
    } else {
      // What leaves the card when the room gives up the draft (see showEmailLinks): the addresses and the text.
      const priv = [recField('Send from', rec.from || 'not set: add the consulting address in the room settings'), recField('To', (rec.to || []).join(', '))];
      if (rec.cc && rec.cc.length) priv.push(recField('Cc', rec.cc.join(', ')));
      const preview = el('details', 'rec-details');
      preview.open = true;
      preview.append(el('summary', null, 'Email text (plain text)'), el('div', 'post-text', rec.body || ''));
      [...priv, preview].forEach((n) => n.classList.add('email-private'));
      card.append(...priv, recField('Subject', rec.subject || ''), preview,
        el('p', 'rec-note', 'Nothing is sent from the room. Approving only records your decision; then you open the draft in Outlook or your mail app and send it yourself.'));
      // Said before approving, so it is no surprise after: a long draft can only be copied.
      let opens = true;
      try {
        const d = { to: rec.to || [], cc: rec.cc || [], subject: rec.subject || '', body: rec.body || '' };
        opens = EmailLinks.outlookFits(EmailLinks.outlookUrl(d)) || EmailLinks.mailtoFits(EmailLinks.mailtoUrl(d));
      } catch { opens = false; }
      if (!opens) card.append(el('p', 'rec-note email-long', 'This draft is too long to open in Outlook or a mail app directly: after approving, use Copy and paste it into a new email.'));
    }
  } else if (rec.action === 'notion_page') {
    // Link the parent so the destination can be checked before approving.
    const under = el('a', null, 'open the parent page');
    under.href = `https://www.notion.so/${rec.parent}`;
    under.target = '_blank';
    under.rel = 'noopener noreferrer';
    const where = recField('Under', '');
    where.lastChild.append(under, ' · a new page, nothing existing changes');
    card.append(where, recField('Title', rec.title), recDetails('Page content', rec.content));
  } else if (rec.action === 'notion_page_update') {
    // Link the page so what is there now can be read before approving.
    const page = el('a', null, 'open the page as it is now');
    page.href = `https://www.notion.so/${rec.page}`;
    page.target = '_blank';
    page.rel = 'noopener noreferrer';
    const where = recField('Page', '');
    where.lastChild.append(page, ' · a page this room created');
    card.append(where, recField('Title', rec.title), recDetails('New version', rec.content),
      el('p', 'rec-note', 'The new version goes on top of the page. What is there now is kept under it, as "Previous version".'));
  } else if (rec.action === 'github_comment') {
    // Link the issue so it can be checked before approving.
    const issue = el('a', null, `${rec.repo}#${rec.issue}`);
    issue.href = `https://github.com/${rec.repo}/issues/${rec.issue}`;
    issue.target = '_blank';
    issue.rel = 'noopener noreferrer';
    const on = recField('On issue', '');
    on.lastChild.append(issue, rec.public ? ' · public repo (checked when you approve)' : ' · repo must be private (checked when you approve)');
    if (rec.public) card.append(el('p', 'rec-warning', 'This comment will be public: anyone can read it. Check it for anything internal before approving.'));
    card.append(on, recDetails('Comment', rec.body));
  } else {
    const repo = rec.repo;
    if (rec.public) {
      card.append(el('p', 'rec-warning', 'This issue will be public: anyone can read it. Check the body for anything internal before approving.'));
      card.append(recField('Repository', `${repo} · public (checked when you approve)`));
    } else {
      card.append(recField('Repository', `${repo} · must be private (checked when you approve)`));
    }
    card.append(recField('Title', rec.title), recDetails('Issue body', rec.body));
  }

  const actions = el('div', 'rec-actions');
  const approveLabel = {
    dispatch: `Approve · send to ${makers}`,
    notion_draft: posts.length > 1 ? `Approve · save ${posts.length} Notion drafts` : 'Approve · save as Notion draft',
    notion_page: 'Approve · create Notion page',
    notion_page_update: 'Approve · update the page, keep the old version',
    email_draft: 'Approve · nothing is sent',
    github_issue: rec.public ? 'Approve · publish public issue' : 'Approve · create issue',
    github_comment: rec.public ? 'Approve · post public comment' : 'Approve · post comment',
    create_agent: rec.action === 'create_agent' ? `Approve · add ${rec.agent.name} to the room` : '',
  };
  const approve = el('button', 'approve', approveLabel[rec.action]);
  const revise = el('button', 'ghost', 'Revise');
  const dismiss = el('button', 'ghost rec-dismiss', 'Dismiss');
  dismiss.title = 'Close this proposal without doing anything. This is final.';
  approve.type = 'button';
  revise.type = 'button';
  dismiss.type = 'button';
  actions.append(approve, revise, dismiss);

  const form = el('form', 'rec-revise');
  form.hidden = true;
  const note = el('textarea');
  note.rows = 3;
  note.placeholder = `What should ${rec.by ? nameOf(rec.by) : 'Coen'} change?`;
  const sendNote = el('button', 'approve', 'Send to Coen');
  sendNote.type = 'submit';
  const formError = el('div', 'form-error');
  form.append(note, formError, sendNote);

  // Dismiss asks first, in a form like Revise: nothing is dismissed until "Dismiss for good", with or without a reason.
  const dismissForm = el('form', 'rec-revise rec-dismiss-form');
  dismissForm.hidden = true;
  const reason = el('textarea');
  reason.rows = 2;
  reason.placeholder = 'Why are you dismissing this? (optional)';
  reason.setAttribute('aria-label', 'Why are you dismissing this? (optional)');
  const dismissError = el('div', 'form-error');
  const dismissButtons = el('div', 'rec-form-buttons');
  const dismissGo = el('button', 'approve', 'Dismiss for good');
  dismissGo.type = 'submit';
  const dismissCancel = el('button', 'ghost', 'Cancel');
  dismissCancel.type = 'button';
  dismissButtons.append(dismissGo, dismissCancel);
  // Whoever proposed it is told with the next message in this chat, reason or not (the server adds a note for Coen).
  dismissForm.append(reason, el('p', 'rec-note', "This is final: the proposal is closed and can't be reopened."),
    el('p', 'rec-note', `${rec.by ? nameOf(rec.by) : 'Coen'} hears about this with your next message.`), dismissError, dismissButtons);

  const status = el('div', 'rec-status');
  card.append(actions, form, dismissForm, status);
  appendToThread(card);
  const entry = { rec, el: card, pill, actions, form, dismissForm, status, said, more };
  recCards.set(rec.recId, entry);
  setRecState(entry, rec.state || 'pending');
  if ((rec.state || 'pending') === 'pending') say(Announce.proposal(rec.by ? nameOf(rec.by) : 'Coen', title.replace(/^Proposal · /, '').replace(/ → /g, ' then '), rec.summary));

  approve.addEventListener('click', () => decide(entry, 'approve', {}));
  // One form at a time: opening one closes the other.
  dismiss.addEventListener('click', () => {
    dismissForm.hidden = !dismissForm.hidden;
    form.hidden = true;
    if (!dismissForm.hidden) reason.focus();
  });
  const closeDismiss = () => { dismissForm.hidden = true; dismissError.textContent = ''; dismiss.focus(); };
  dismissCancel.addEventListener('click', closeDismiss);
  dismissForm.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDismiss(); } });
  reason.addEventListener('input', () => { dismissError.textContent = ''; });
  dismissForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const why = reason.value.trim();
    if (why.length > 4000) { dismissError.textContent = 'That reason is too long (4000 characters max).'; return; }
    dismissGo.disabled = true;
    await decide(entry, 'dismiss', why ? { reason: why } : {});
    dismissGo.disabled = false;
  });
  more.addEventListener('click', () => {
    const open = card.classList.toggle('unfolded');
    more.textContent = open ? 'Hide what was proposed' : 'Show what was proposed';
    more.setAttribute('aria-expanded', String(open));
  });
  revise.addEventListener('click', () => { form.hidden = !form.hidden; dismissForm.hidden = true; if (!form.hidden) note.focus(); });
  note.addEventListener('input', () => { formError.textContent = ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!note.value.trim()) { formError.textContent = 'Write what should change first.'; return; }
    decide(entry, 'revise', { note: note.value.trim() });
  });
}

function setRecState(entry, state) {
  entry.pill.className = `pill ${state}`;
  entry.pill.textContent = REC_STATES[state] || state;
  const open = state === 'pending';
  entry.actions.hidden = !open;
  if (!open) { entry.form.hidden = true; entry.dismissForm.hidden = true; }
  // A dismissed card folds to its header and summary, with a button to read the rest again; this runs live, on
  // replay and for a stored state.
  entry.el.classList.toggle('dismissed', state === 'dismissed');
  entry.more.hidden = state !== 'dismissed';
}

// The only addresses a result may become a link to: a Notion page, or an issue or comment on GitHub. One check for
// the card and for the Decisions tab in Room settings.
const isNotionUrl = (u) => /^https:\/\/(app\.notion\.com|www\.notion\.so)\//.test(u || '');
const isGithubUrl = (u) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues\/\d+(#issuecomment-\d+)?|pull\/\d+#issuecomment-\d+)$/.test(u || '');

// A time as the page shows it: day, month, year, hour and minute, in this browser's own format ('' when there is none).
function whenText(t) {
  const d = t == null || t === '' ? null : new Date(t);
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

// Who decided and when, next to the pill, so a folded (dismissed) card shows it too. Live and on replay; a decision
// saved before the actor existed shows the owner.
function showDecided(entry, ev) {
  if (!entry.decided) entry.decided = entry.pill.parentNode.appendChild(el('span', 'rec-decided'));
  const when = whenText(ev.ts);
  entry.decided.textContent = `${ev.decision} by ${ev.actor || ownerName}${when ? `, ${when}` : ''}`;
}

function showRecResult(ev) {
  const entry = recCards.get(ev.recId);
  if (!entry) return;
  setRecState(entry, ev.state);
  entry.status.replaceChildren();
  const isNotion = isNotionUrl(ev.url);
  if (entry.rec.action === 'create_agent' && ev.agent) {
    entry.status.append(el('span', null, `${ev.agent.name} is in the room now.`));
    refreshAgents();
  } else if (entry.rec.action === 'notion_draft' && (ev.urls || ev.state === 'done')) {
    const urls = ev.urls || (ev.url ? [ev.url] : []);
    const saved = urls.length || (ev.state === 'done' ? 1 : 0);
    entry.status.append(el('span', null, `Saved ${saved} Notion draft${saved === 1 ? '' : 's'}.`));
    urls.filter(isNotionUrl).forEach((u, i) => {
      const link = el('a', null, urls.length > 1 ? `Open ${i + 1}` : 'Open in Notion');
      link.href = u;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      entry.status.append(link);
    });
    if (ev.error) entry.status.append(el('span', 'err-text', "Stopped at: " + ev.error));
  } else if (entry.rec.action === 'notion_page_update' && (isNotion || ev.state === 'done')) {
    // `kept`: where the previous version went. "above" means it could not be copied, so nothing was removed.
    const how = ev.error ? 'Page partly updated. '
      : ev.kept === 'above' ? "New version added below the old one: the old one holds things the room can't copy, so nothing was removed. "
        : ev.kept === 'none' ? 'Page updated. ' : 'Page updated; the previous version is kept at the bottom. ';
    entry.status.append(el('span', null, how));
    if (isNotion) {
      const link = el('a', null, 'Open in Notion');
      link.href = ev.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      entry.status.append(link);
    }
    if (ev.error) entry.status.append(el('span', 'err-text', ' ' + ev.error));
  } else if (entry.rec.action === 'notion_page' && (isNotion || ev.state === 'done')) {
    entry.status.append(el('span', null, ev.error ? 'Page created. ' : 'Saved as a Notion page. '));
    if (isNotion) {
      const link = el('a', null, 'Open in Notion');
      link.href = ev.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      entry.status.append(link);
    }
    if (ev.error) entry.status.append(el('span', 'err-text', ' ' + ev.error));
  } else if (isNotion || isGithubUrl(ev.url)) {
    const comment = /#issuecomment-/.test(ev.url);
    const link = el('a', null, isNotion ? 'Open in Notion' : comment ? 'Open the comment on GitHub' : 'Open the issue on GitHub');
    link.href = ev.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    entry.status.append(el('span', null, isNotion ? 'Saved as a Notion draft. ' : comment ? 'Comment posted. ' : 'Issue created. '), link);
  } else if (ev.error) {
    entry.status.append(el('span', 'err-text', "Couldn't carry this out: " + ev.error));
  } else if (ev.drafts) {
    entry.status.append(el('span', null, ev.drafts.length ? 'Saved: ' : 'Finished without saving a draft.'));
    for (const name of ev.drafts) addDraftChip({ el: entry.status }, name);
  }
  // Spoken once the action is over (not while a maker is still at it): the pill's word and the line under it,
  // without the links' own labels.
  if (['done', 'failed', 'stopped'].includes(ev.state)) {
    say(Announce.result(REC_STATES[ev.state], [...entry.status.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' ')));
  }
}

// Approved email draft: buttons to open it in Outlook web or the mail app, and Copy. Nothing is sent from the room.
// Each link only when its whole URL is short enough to be carried reliably; otherwise it's greyed out and Copy leads.
// The buttons for an email draft whose text the room still has: Outlook web, the mail app and Copy. Each link only
// when its whole URL is short enough to be carried reliably; otherwise it's greyed out, with the reason next to it,
// and Copy is the main button.
function emailButtons(draft) {
  const copy = el('button', 'ghost', 'Copy');
  copy.type = 'button';
  copy.title = 'Copies the subject and the text';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EmailLinks.copyText(draft));
      copy.textContent = 'Copied';
      sayNow = true;
      say('Copied the subject and the text.');
    } catch {
      copy.textContent = "Couldn't copy: select the text in the preview";
    }
  });
  const link = (label, href) => {
    const a = el('a', 'ghost', label);
    a.href = href;
    if (href.startsWith('https:')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };
  const tooLong = [];
  const openOr = (label, href, fits, why) => {
    if (fits) return link(label, href);
    const off = el('button', 'ghost', label);
    off.type = 'button';
    off.disabled = true;
    off.title = why;
    tooLong.push(el('span', 'rec-note', why));
    return off;
  };
  const buttons = el('div', 'rec-actions email-links');
  let outlook;
  let mailto;
  try {
    outlook = EmailLinks.outlookUrl(draft);
    mailto = EmailLinks.mailtoUrl(draft);
  } catch {
    // encodeURIComponent throws on broken characters; the server refuses those, and Copy still works.
    copy.className = 'approve';
    buttons.append(copy);
    return buttons;
  }
  const opens = [
    openOr('Open in Outlook web', outlook, EmailLinks.outlookFits(outlook), 'Too long for Outlook web, use Copy'),
    openOr('Open in mail app', mailto, EmailLinks.mailtoFits(mailto), 'Too long for mailto, use Copy'),
  ];
  // With no link left, Copy is the way to get the text out, and looks it.
  if (tooLong.length === opens.length) copy.className = 'approve';
  buttons.append(...(tooLong.length ? [copy, ...opens, ...tooLong] : [...opens, copy]));
  return buttons;
}

// "Sent, remove the text": the room gives up the addresses and the text of an approved draft now, not when its time
// is up. `after` runs with the recipients' domains once the server has done it.
function forgetButton(recId, after) {
  const forget = el('button', 'ghost', 'Sent, remove the text');
  forget.type = 'button';
  forget.title = "Removes the addresses and the text from the room now. This can't be undone.";
  forget.addEventListener('click', async () => {
    forget.disabled = true;
    try {
      const res = await fetch(`/api/recs/${encodeURIComponent(recId)}/forget`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      after(Array.isArray(data.domains) ? data.domains : []);
    } catch (err) {
      forget.disabled = false;
      forget.textContent = `Couldn't remove it: ${err.message}`;
    }
  });
  return forget;
}
const keptNote = (until) => `The addresses and the text stay in the room${whenText(until) ? ` until ${whenText(until)}` : ' for a few days'}, so you can come back to them. Agents can't read them there.`;

// Approved email draft: buttons to open it in Outlook web or the mail app, and Copy. Nothing is sent from the room.
// The text stays for a while after approving (the server says until when), so this also draws on a reload; a draft
// whose text is gone, or one approved before texts were kept, says so.
function showEmailLinks(entry) {
  const r = entry.rec;
  if (!Array.isArray(r.to) || typeof r.body !== 'string') {
    entry.status.replaceChildren(el('span', null, 'Approved. Nothing was sent from the room. The addresses and the text have been removed from the room; to get the draft again, ask Coen for it.'));
    return;
  }
  entry.status.replaceChildren(el('span', null, `Approved. Nothing was sent: open the draft and send it yourself${r.from ? ` from ${r.from}` : ''}.`));
  const after = el('div', 'rec-actions email-kept');
  after.append(el('span', 'rec-note', keptNote(entry.keepUntil)), forgetButton(r.recId, (domains) => {
    for (const k of ['to', 'cc', 'body', 'from']) delete r[k];
    r.domains = domains;
    entry.el.querySelectorAll('.email-private').forEach((n) => n.remove());
    showEmailLinks(entry);
  }));
  entry.status.append(emailButtons({ to: r.to, cc: r.cc || [], subject: r.subject, body: r.body }), after);
}

async function decide(entry, kind, body) {
  entry.actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  sayNow = true;
  try {
    const res = await fetch(`/api/recs/${encodeURIComponent(entry.rec.recId)}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      entry.status.replaceChildren(el('span', 'err-text', data.error || `HTTP ${res.status}`));
      say(entry.status.textContent);
      return;
    }
    for (const ev of data.events) handle(ev);
    if (data.jobId) await attach();
  } catch (err) {
    entry.status.replaceChildren(el('span', 'err-text', err.message));
  } finally {
    entry.actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

// ---- Draft chips and the read-only draft viewer

const viewer = $('draft-viewer');

function addDraftChip(holder, name) {
  const chip = el('button', 'draft-chip', 'Draft · ' + name);
  chip.type = 'button';
  chip.addEventListener('click', () => openDraft(name));
  holder.el.appendChild(chip);
  settleTools(holder.tools);
  holder.bubble = null;
  holder.tools = null;
}

async function openDraft(name) {
  $('draft-title').textContent = name;
  const body = $('draft-body');
  body.textContent = 'Loading…';
  viewer.showModal();
  try {
    const res = await fetch('/api/drafts/' + encodeURIComponent(name));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    body.innerHTML = renderMd(data.content);
  } catch (err) {
    body.textContent = `Couldn't open this draft: ${err.message}`;
  }
}

$('draft-close').addEventListener('click', () => viewer.close());

// ---- Composer: textarea grows to ~10 lines, Enter sends, Shift+Enter is a new line.

function setBusy(busy) {
  // A button that gets disabled drops the keyboard focus to the page: hand it to the message box first.
  if (busy && document.activeElement === sendBtn) input.focus();
  sendBtn.disabled = busy;
  attachBtn.disabled = busy;
  stopBtn.hidden = !busy;
  coenStatus.hidden = !busy;
}

function growInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
}

// ---- Attached files: they go with one message, agents can read them for that turn only, and the server deletes
// them when the turn ends. The limits come from the server (/api/room); these are the same values as a fallback.

const attachBtn = $('attach-btn');
const attachInput = $('attach-input');
const attachRow = $('attach-row');
const attachError = $('attach-error');
let attachLimits = { maxFiles: 3, maxBytes: 5 * 1024 * 1024, extensions: ['txt', 'md', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'] };
let picked = [];   // File objects waiting to go with the next message

const { fileSize } = AttachLabel;

function attachProblem(text) {
  attachError.textContent = text || '';
  attachError.hidden = !text;
}

function drawPicked() {
  $('attach-files').replaceChildren(...picked.map((file) => {
    const chip = el('span', 'file-chip');
    const remove = el('button', 'file-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.addEventListener('click', () => {
      picked = picked.filter((f) => f !== file);
      attachProblem('');
      drawPicked();
    });
    chip.append(el('span', 'file-name', file.name), el('span', 'file-size', fileSize(file.size)), remove);
    return chip;
  }));
  const many = picked.length > 1;
  $('attach-note').textContent = `Agents can read ${many ? 'these files' : 'this file'} for this message only. ${many ? 'They are' : 'It is'} deleted when the turn ends; what was read from ${many ? 'them' : 'it'} stays in the chat.`;
  attachRow.hidden = !picked.length;
}

function pickFiles(list) {
  const problems = [];
  for (const file of list) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (!attachLimits.extensions.includes(ext)) problems.push(`"${file.name}" can't be attached: only ${attachLimits.extensions.map((e) => `.${e}`).join(', ')} files.`);
    else if (!file.size) problems.push(`"${file.name}" is empty.`);
    else if (file.size > attachLimits.maxBytes) problems.push(`"${file.name}" is larger than ${attachLimits.maxBytes / 1024 / 1024} MB.`);
    else if (picked.length >= attachLimits.maxFiles) problems.push(`At most ${attachLimits.maxFiles} files per message: "${file.name}" was left out.`);
    else picked.push(file);
  }
  attachProblem(problems.join(' '));
  drawPicked();
}

const asBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error(`Couldn't read "${file.name}".`));
  reader.readAsDataURL(file);
});

attachBtn.addEventListener('click', () => attachInput.click());
attachInput.addEventListener('change', () => {
  pickFiles([...attachInput.files]);
  attachInput.value = '';
});

async function send() {
  const text = input.value.trim();
  if (sendBtn.disabled) return;
  if (!text) {
    if (picked.length) attachProblem(`Write a question to go with the file${picked.length > 1 ? 's' : ''}.`);
    return;
  }
  input.value = '';
  growInput();
  setBusy(true);
  try {
    const files = await Promise.all(picked.map(async (file) => ({ name: file.name, data: await asBase64(file) })));
    const res = await fetch('/api/coen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(files.length ? { text, files } : { text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      appendToThread(el('div', 'bubble err', data.error || `HTTP ${res.status}`));
      sayNow = true;
      say(`Not sent: ${data.error || `HTTP ${res.status}`}`);
      input.value = text;
      setBusy(false);
      return;
    }
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
    sayNow = true;
    say(`Not sent: ${err.message}`);
    input.value = text;
    setBusy(false);
    return;
  }
  picked = [];
  attachProblem('');
  drawPicked();
  sayNow = true;
  say('Sent.');
  await attach();
}

// Follow the running job until it ends. The server replays everything the job has done so far.
async function attach() {
  setBusy(true);
  let ended = false;
  let followup = false;
  try {
    const res = await fetch('/api/stream');
    if (res.status === 204) { ended = true; return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const asked = performance.now();
      const { value, done } = await reader.read();
      if (done) break;
      // A page that joins a running job (a reload, another room) is first sent, at once, what the job did so far,
      // and only then what happens now: the first read that had to wait is the first one worth speaking.
      if (performance.now() - asked > 250) sayNow = true;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        // A job that has ended is not followed at all, so its end always happens now.
        if (ev.type === 'end') { ended = true; sayNow = true; }
        if (ev.type === 'followup') followup = true;
        handle(ev);
      }
    }
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
  } finally {
    if (!ended) {
      appendToThread(el('div', 'notice', 'Lost the connection to the room while Coen was working. Reload to catch up.'));
      sayNow = true;
      say('Lost the connection to the room while Coen was working. Reload to catch up.');
    }
    setBusy(false);
    input.focus();
  }
  // A maker just finished and the room started Coen's review turn: follow that too.
  if (followup && ended) await attach();
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
input.addEventListener('input', growInput);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try {
    await fetch('/api/coen/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  } finally {
    stopBtn.disabled = false;
  }
});

// A built-in agent comes from a folder of agent files, which the room reads at start and never writes: its
// chip (and Coen's avatar) opens a read-only view of what the room runs it with, and says where it is changed.
const agentView = $('agent-view');
async function openAgentView(key) {
  $('agent-view-title').textContent = nameOf(key);
  const facts = $('agent-view-facts');
  const body = $('agent-view-instructions');
  facts.replaceChildren();
  $('agent-view-note').textContent = '';
  body.textContent = 'Loading…';
  agentView.showModal();
  try {
    const res = await fetch('/api/agents/built-in/' + encodeURIComponent(key));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const a = data.agent;
    const role = { lead: 'Room lead · every message goes to him first', advisor: 'Advisor · Coen can consult it', maker: 'Maker · works only after you approve a dispatch' }[a.role] || a.role;
    facts.append(recField('Role', role), recField('What it does', a.does),
      recField('Model', a.model ? (models.find((m) => m.id === a.model) || {}).label || a.model : 'Account default'), recField('File', a.file));
    $('agent-view-note').textContent = `To change ${a.name}, edit that file. The room reads it when it starts, so a change shows here and reaches ${a.name} after the room's next restart. The room itself never writes to that folder.`;
    body.innerHTML = renderMd(a.instructions || '');
  } catch (err) {
    body.textContent = `Couldn't load ${nameOf(key)}: ${err.message}`;
  }
}
$('agent-view-close').addEventListener('click', () => agentView.close());
document.querySelectorAll('.chip[data-who]').forEach((chip) => {
  chip.addEventListener('click', () => openAgentView(chip.dataset.who));
});
$('coen-open').addEventListener('click', () => openAgentView('coen'));

async function newChat() {
  const res = await fetch('/api/coen/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    appendToThread(el('div', 'bubble err', data.error || `HTTP ${res.status}`));
    return;
  }
  const empty = el('div', 'empty', 'Fresh chat. Coen starts without the previous conversation; it stays in the chat list.');
  empty.id = 'empty';
  empty.dataset.fresh = '1';
  thread.replaceChildren(empty);
  groupsEl.replaceChildren();
  groups.length = 0;
  recCards.clear();
  turn = null;
  coenMsg = null;
  turnCount = 0;
  setRail(false);
  // What the room is for goes above it, as in an empty chat after a reload.
  if (space) applyMembership();
  loadChats();
}
$('reset').addEventListener('click', newChat);

// ---- Room-built agents: chips in the rail, and the editor to add, change or remove them.

let toolGroups = [];
let models = [];
let avatars = [];
const toolLabel = (key) => (toolGroups.find((g) => g.key === key) || { label: key }).label;
const modelLabel = (id) => (models.find((m) => m.id === (id || '')) || { label: id }).label;

const presetSrc = (id) => `avatars/presets/${id}.svg`;

// Built-in agents have their own SVG, room-built ones a preset; without one (or once removed) their initial.
function avatarFor(who) {
  const preset = CUSTOM.has(who) && CUSTOM.get(who).avatar;
  if (!BUILT_IN.has(who) && !preset) {
    return el('span', `initial${MAKERS.has(who) ? ' maker' : ''}${toneOf(who)}`, nameOf(who).charAt(0).toUpperCase());
  }
  const img = el('img');
  img.src = preset ? presetSrc(preset) : `avatars/${who}.svg`;
  img.alt = '';
  img.width = 28;
  img.height = 28;
  return img;
}

// After an agent changes: the server may also have added it to (or removed it from) rooms.
async function refreshAgents() {
  await loadAgentList();
  await loadSpaces();
}

async function loadAgentList() {
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) return;
    const data = await res.json();
    toolGroups = data.toolGroups;
    models = data.models;
    avatars = data.avatars || [];
    for (const key of CUSTOM.keys()) { MAKERS.delete(key); delete NAMES[key]; }
    CUSTOM.clear();
    for (const a of data.agents) {
      CUSTOM.set(a.key, a);
      NAMES[a.key] = a.name;
      if (a.role === 'maker') MAKERS.add(a.key);
    }
    renderCustomChips();
  } catch { /* the room works without them */ }
}

function renderCustomChips() {
  const slots = { advisor: $('custom-advisors'), maker: $('custom-makers') };
  slots.advisor.replaceChildren();
  slots.maker.replaceChildren();
  for (const a of CUSTOM.values()) {
    if (!inRoom(a.key)) continue;
    const chip = el('button', `chip custom${toneOf(a.key)}`);
    chip.type = 'button';
    chip.dataset.key = a.key;
    chip.title = `${a.name} · ${a.does} (added in the room; click to edit)`;
    // What the agent does is in the hover text; a screen reader gets it in the button's label (hidden text inside
    // the name was left out by VoiceOver in Safari).
    if (a.does) chip.setAttribute('aria-label', `${a.name}, ${a.does}`);
    chip.append(avatarFor(a.key), el('span', null, a.name));
    chip.addEventListener('click', () => openAgentEditor(a));
    slots[a.role].appendChild(chip);
  }
}

const editor = $('agent-editor');
const agentForm = $('agent-form');
const agentError = $('agent-error');
let editingKey = null;

function roleValue() {
  return agentForm.querySelector('input[name="agent-role"]:checked').value;
}

// Makers always write drafts (that's how their work reaches you), so that box is locked on for them.
function syncDraftsBox() {
  const box = agentForm.querySelector('input[data-tool="drafts"]');
  if (!box) return;
  const maker = roleValue() === 'maker';
  if (maker) box.checked = true;
  box.disabled = maker;
}

function openAgentEditor(agent = null) {
  editingKey = agent ? agent.key : null;
  $('agent-editor-title').textContent = agent ? `Edit ${agent.name}` : 'Build a new agent';
  $('agent-save').textContent = agent ? 'Save changes' : 'Build and add to room';
  $('agent-remove').hidden = !agent;
  $('agent-leave').hidden = !agent || !space;
  $('agent-export').hidden = !agent;
  $('agent-ask-coen').hidden = Boolean(agent);
  $('agent-import-open').hidden = Boolean(agent);
  $('agent-editor-note').textContent = 'joins this room · no restart needed';
  $('agent-name').value = agent ? agent.name : '';
  $('agent-name').readOnly = false;
  $('agent-does').value = agent ? agent.does : '';
  $('agent-instructions').value = agent ? agent.instructions : '';
  $('agent-instructions').placeholder = '## Job\nWhat it works on and for whom.\n\n## Steps\n1. …\n2. …\n\n## Rules\n- Never …\n\n## Output\nWhat the answer or draft looks like.';
  agentForm.querySelector(`input[name="agent-role"][value="${agent ? agent.role : 'advisor'}"]`).checked = true;
  const tools = $('agent-tools');
  tools.replaceChildren();
  const chosen = new Set(agent ? agent.tools : ['files']);
  for (const g of toolGroups) {
    const label = el('label', 'choice');
    const box = el('input');
    box.type = 'checkbox';
    box.dataset.tool = g.key;
    box.checked = chosen.has(g.key);
    label.append(box, el('span', null, g.label));
    tools.appendChild(label);
  }
  const select = $('agent-model');
  select.replaceChildren(...models.map((m) => {
    const opt = el('option', null, m.label);
    opt.value = m.id;
    return opt;
  }));
  select.value = agent ? agent.model || '' : '';
  // New agents start on the first animal no other room agent has yet. Animals other agents have are marked in the
  // picker but stay selectable: sharing one is allowed, it just shouldn't happen by accident.
  const usedBy = new Map();
  for (const a of CUSTOM.values()) {
    if (a.avatar && (!agent || a.key !== agent.key)) usedBy.set(a.avatar, [...(usedBy.get(a.avatar) || []), a.name]);
  }
  preselectedAvatar = agent ? null : avatars.find((a) => !usedBy.has(a)) || '';
  renderAvatarPicker(agent ? agent.avatar || '' : preselectedAvatar, usedBy);
  syncDraftsBox();
  agentError.textContent = '';
  editor.showModal();
  $('agent-name').focus();
}

// What the build form preselected for a new agent: only an avatar the owner changed is passed on to Coen as a choice already made.
let preselectedAvatar = null;

function renderAvatarPicker(selected, usedBy = new Map()) {
  const grid = $('agent-avatars');
  grid.replaceChildren();
  for (const id of [...avatars, '']) {
    const users = usedBy.get(id);
    const label = el('label', `avatar-option${users ? ' in-use' : ''}`);
    label.title = id ? `${id}${users ? ` · used by ${users.join(', ')}` : ''}` : 'Initial only';
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'agent-avatar';
    radio.value = id;
    radio.checked = id === selected;
    const face = id ? el('img') : el('span', 'initial', ($('agent-name').value.trim() || '?').charAt(0).toUpperCase());
    if (id) { face.src = presetSrc(id); face.alt = id; face.width = 44; face.height = 44; }
    label.append(radio, face);
    grid.appendChild(label);
  }
  // The built-in agents' own animals get a line of their own under a label, each with its agent's name:
  // shown so it's clear they exist, but they can't be picked.
  // Two lines of explanation, so "dimmed, still pickable" and "reserved, not pickable" aren't mistaken for each other.
  if (usedBy.size) grid.appendChild(el('span', 'avatar-note', 'Dimmed: an agent you built already has it. You can still pick it; agents may share one.'));
  grid.appendChild(el('span', 'avatar-note', 'Reserved for the built-in agents. These are theirs alone and can\'t be picked.'));
  for (const key of BUILT_IN) {
    const taken = el('span', 'avatar-option taken');
    taken.title = `Used by ${NAMES[key]}`;
    const face = el('img');
    face.src = `avatars/${key}.svg`;
    face.alt = '';
    face.width = 44;
    face.height = 44;
    taken.append(face, el('span', 'avatar-taken-name', NAMES[key]));
    grid.appendChild(taken);
  }
}

function agentFromForm() {
  return {
    name: $('agent-name').value.trim(),
    role: roleValue(),
    does: $('agent-does').value.trim(),
    instructions: $('agent-instructions').value.trim(),
    tools: [...agentForm.querySelectorAll('input[data-tool]:checked')].map((b) => b.dataset.tool),
    model: $('agent-model').value,
    avatar: (agentForm.querySelector('input[name="agent-avatar"]:checked') || { value: '' }).value,
  };
}

async function agentRequest(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

agentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const save = $('agent-save');
  save.disabled = true;
  try {
    const url = editingKey ? `/api/agents/${encodeURIComponent(editingKey)}` : '/api/agents';
    const { agent } = await agentRequest(url, agentFromForm());
    editor.close();
    await refreshAgents();
    appendToThread(el('div', 'notice', editingKey ? `Updated ${agent.name}.` : `Added ${agent.name} to the room as ${agent.role === 'maker' ? 'a maker' : 'an advisor'}. Coen can use them from your next message.`));
  } catch (err) {
    agentError.textContent = err.message;
  } finally {
    save.disabled = false;
  }
});

// The quick path: Coen designs the agent from whatever is filled in and proposes it as a card to approve.
$('agent-ask-coen').addEventListener('click', () => {
  const a = agentFromForm();
  if (!a.name && !a.does && !a.instructions) { agentError.textContent = 'Write at least what the agent should do.'; return; }
  if (sendBtn.disabled) { agentError.textContent = 'This chat is still working. Try again once it has finished.'; return; }
  const lines = [`Please design a new ${a.role} for the room and propose it as a create_agent card.`];
  if (a.name) lines.push(`Name: ${a.name}`);
  if (a.does) lines.push(`What it should do: ${a.does}`);
  if (a.instructions) lines.push(`Rules, steps or notes from me:\n${a.instructions}`);
  lines.push(`Tools I had in mind: ${a.tools.map(toolLabel).join(', ') || 'none'} (drop or add what the job needs).`);
  // The form always preselects an animal, so only a changed one counts as a choice; otherwise Coen picks one that fits.
  if (a.avatar !== preselectedAvatar) lines.push(a.avatar ? `Avatar: "${a.avatar}" (my choice, keep it)` : 'Avatar: "" (its initial; my choice, keep it)');
  if (a.model) lines.push(`Model: "${a.model}" (my choice, keep it)`);
  editor.close();
  input.value = lines.join('\n');
  growInput();
  send();
});

// Asks in the page itself: the browser's own confirm() can be switched off (some embedded browsers answer Cancel
// without showing anything), which made these buttons look dead. Esc or Cancel is a no.
const confirmDialog = $('confirm-dialog');
function askConfirm(text, ok = 'OK') {
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true }));
}

$('agent-remove').addEventListener('click', async () => {
  const agent = CUSTOM.get(editingKey);
  if (!agent || !(await askConfirm(`Delete ${agent.name} from every room? Earlier messages stay; Coen can't use them any more. To take them out of this room only, use "Remove from this room".`, 'Delete'))) return;
  try {
    await agentRequest(`/api/agents/${encodeURIComponent(editingKey)}/remove`, {});
    editor.close();
    await refreshAgents();
    appendToThread(el('div', 'notice', `Deleted ${agent.name}.`));
  } catch (err) {
    agentError.textContent = err.message;
  }
});

// Saves the agent (as it is stored, not unsaved form edits) as an AGENT.md in drafts/, with the commands to
// put it into ~/.claude/agents. The room itself never writes there; the owner runs them.
$('agent-export').addEventListener('click', async () => {
  const agent = CUSTOM.get(editingKey);
  if (!agent) return;
  try {
    const data = await agentRequest(`/api/agents/${encodeURIComponent(editingKey)}/export`, {});
    editor.close();
    const note = el('div', 'notice export-note');
    note.append(el('p', null, `Saved ${agent.name} as an AGENT.md in drafts/. To add it to your Claude Code agents:`));
    if (data.exists) note.append(el('p', 'err-text', `~/.claude/agents/${data.folder.split('/')[1]} already exists: pick another folder name so you don't overwrite that agent.`));
    note.append(el('code', 'install', data.install));
    note.append(el('p', null, 'The room keeps using its own copy; the one in ~/.claude/agents is for Claude Code in the terminal. After editing the agent here, export it again so the two stay the same.'));
    appendToThread(note);
    addDraftChip({ el: note }, data.name);
  } catch (err) {
    agentError.textContent = err.message;
  }
});

$('agent-leave').addEventListener('click', async () => {
  const agent = CUSTOM.get(editingKey);
  if (!agent || !space) return;
  const members = (space.members || catalogue.map((a) => a.key)).filter((k) => k !== agent.key);
  try {
    await agentRequest(`/api/workspaces/${encodeURIComponent(space.id)}`, { name: space.name, members, focus: space.focus === agent.key ? null : space.focus });
    editor.close();
    await refreshAgents();
    appendToThread(el('div', 'notice', `${agent.name} is no longer in ${space.name}. They stay in your other rooms; Add agent brings them back.`));
  } catch (err) {
    agentError.textContent = err.message;
  }
});

agentForm.querySelectorAll('input[name="agent-role"]').forEach((r) => r.addEventListener('change', syncDraftsBox));
agentForm.addEventListener('input', () => { agentError.textContent = ''; });
// The "initial only" option shows the name's first letter as it is typed.
$('agent-name').addEventListener('input', () => {
  const initial = $('agent-avatars').querySelector('.initial');
  if (initial) initial.textContent = ($('agent-name').value.trim() || '?').charAt(0).toUpperCase();
});
$('agent-close').addEventListener('click', () => editor.close());
// Add agent: first the agents already built but not in this room (one click adds them, as Room settings → Members
// would), then building a new one. With nothing to add it goes straight to building.
const picker = $('agent-picker');
function notInRoom() {
  if (!space || space.members == null) return [];
  return catalogue.filter((a) => !space.members.includes(a.key));
}

function openAddAgent() {
  const others = notInRoom();
  if (!others.length) return openAgentEditor();
  $('agent-picker-title').textContent = `Add an agent to ${space.name}`;
  $('agent-picker-error').textContent = '';
  $('agent-picker-list').replaceChildren(...others.map((a) => {
    const item = el('button', `picker-item${toneOf(a.key)}`);
    item.type = 'button';
    const does = CUSTOM.has(a.key) ? CUSTOM.get(a.key).does : '';
    item.append(avatarFor(a.key), el('span', 'name', a.name), el('span', 'meta', [a.role, does].filter(Boolean).join(' · ')), el('span', 'add', 'Add'));
    item.addEventListener('click', () => addToRoom(a));
    return item;
  }));
  picker.showModal();
}

async function addToRoom(agent) {
  try {
    await agentRequest(`/api/workspaces/${encodeURIComponent(space.id)}`, { name: space.name, members: [...space.members, agent.key], focus: space.focus });
    picker.close();
    await refreshAgents();
    appendToThread(el('div', 'notice', `${agent.name} is in ${space.name} now.`));
  } catch (err) {
    $('agent-picker-error').textContent = err.message;
  }
}

// Import: a copy of an agent from ~/.claude/agents. Its name, description, model and instructions fill the build
// form; the owner chooses the role, tools and avatar there and saves it like any new agent.
const importer = $('agent-import');
async function openImport() {
  $('agent-import-error').textContent = '';
  $('agent-import-list').replaceChildren();
  importer.showModal();
  try {
    const res = await fetch('/api/agents/importable');
    const data = await res.json();
    if (!data.agents.length) { $('agent-import-error').textContent = 'No agents found in ~/.claude/agents (as <name>.md or <name>/AGENT.md).'; return; }
    $('agent-import-list').replaceChildren(...data.agents.map((a) => {
      const item = el('button', 'picker-item');
      item.type = 'button';
      item.append(el('span', 'name', a.name), el('span', 'meta', a.description), el('span', 'add', 'Import'));
      item.addEventListener('click', () => importAgent(a.id));
      return item;
    }));
  } catch (err) {
    $('agent-import-error').textContent = err.message;
  }
}

async function importAgent(id) {
  try {
    const res = await fetch(`/api/agents/importable/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const a = data.agent;
    importer.close();
    picker.close();
    if (!editor.open) openAgentEditor();
    // The room's names are short and plain (letters, digits, spaces, hyphens); the rest is the owner's to adjust.
    $('agent-name').value = a.name.replace(/[^A-Za-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24).trim();
    $('agent-name').dispatchEvent(new Event('input', { bubbles: true }));
    $('agent-does').value = a.description.slice(0, 200);
    $('agent-instructions').value = a.instructions;
    $('agent-model').value = a.model;
    $('agent-editor-title').textContent = 'Import an agent';
    $('agent-save').textContent = 'Import and add to room';
    $('agent-editor-note').textContent = `copied from ~/.claude/agents/${a.id} · choose its role and tools`;
  } catch (err) {
    $('agent-import-error').textContent = err.message;
  }
}

$('agent-import-close').addEventListener('click', () => importer.close());
$('agent-import-open').addEventListener('click', openImport);
$('agent-picker-import').addEventListener('click', openImport);
$('agent-picker-close').addEventListener('click', () => picker.close());
$('agent-picker-build').addEventListener('click', () => { picker.close(); openAgentEditor(); });
$('add-agent').addEventListener('click', openAddAgent);
$('add-agent-top').addEventListener('click', openAddAgent);

// ---- Rooms: the header pill switches between them; each room has its own members and chats.
// (The server calls them workspaces, since there a "room" is one chat.)

let space = null;       // the current room: { id, name, members (null = everyone), isDefault }
let spaceList = [];
let catalogue = [];     // every agent a room can have: { key, name, role, builtIn }
let notionDbs = [];     // the Output DBs the server knows: { key, name }
let notionOn = false;   // whether the room started with its Notion token (Notion actions at all)
const inRoom = (key) => !space || space.members == null || space.members.includes(key);
const spaceMenu = $('space-menu');
const spaceButton = $('brand-workspace');

async function loadSpaces() {
  try {
    const res = await fetch('/api/workspaces');
    if (!res.ok) return;
    const data = await res.json();
    spaceList = data.workspaces;
    catalogue = data.agents;
    notionDbs = data.notionDbs || [];
    notionOn = Boolean(data.notion);
    // On an API key the connectors don't exist: the settings say so next to the two choices (which are kept).
    for (const id of ['access-notion-key', 'access-m365-key']) $(id).hidden = data.auth !== 'api-key';
    space = spaceList.find((w) => w.id === data.current) || null;
    if (space) spaceButton.textContent = space.name;
    markWorking();
    applyMembership();
  } catch { /* the room still works as a single room */ }
}

// Work carries on in other rooms while the owner is here: the pill gets a pulsing dot while another room is
// working, and the menu marks which ones. Checked every 10 seconds (and whenever the menu opens).
function markWorking() {
  const elsewhere = spaceList.filter((w) => w.working && (!space || w.id !== space.id));
  spaceButton.classList.toggle('bg-working', elsewhere.length > 0);
  spaceButton.title = elsewhere.length ? `Switch room · working now: ${elsewhere.map((w) => w.name).join(', ')}` : 'Switch room';
}

async function refreshWorking() {
  try {
    const res = await fetch('/api/workspaces');
    if (!res.ok) return;
    const data = await res.json();
    const working = new Map(data.workspaces.map((w) => [w.id, w.working]));
    for (const w of spaceList) w.working = Boolean(working.get(w.id));
    markWorking();
  } catch { /* try again next time */ }
}

setInterval(() => { if (!document.hidden) { refreshWorking(); loadChats(); } }, 10000);

// The rail and the empty-state line only show this room's members.
function applyMembership() {
  document.querySelectorAll('.chip[data-who]').forEach((chip) => { chip.hidden = !inRoom(chip.dataset.who); });
  renderCustomChips();
  const makersShown = [...document.querySelectorAll('.chip[data-who], .chip.custom')].some((c) => !c.hidden && MAKERS.has(c.dataset.who || c.dataset.key));
  document.querySelector('.chips-label').hidden = !makersShown;
  const focus = space && space.focus ? nameOf(space.focus) : null;
  document.querySelector('.coen-head .sub').textContent = focus ? `hands your requests to ${focus} · remembers this chat` : 'intake & triage · remembers this chat';
  // A focus agent is shown next to Coen: its avatar beside his, its name in the title, its colour on the header.
  const focusKey = space && space.focus;
  const head = document.querySelector('.coen-head');
  document.body.classList.toggle('room-has-focus', Boolean(focusKey));
  head.classList.remove('has-focus', 'focus-custom', ...[...head.classList].filter((c) => c.startsWith('tone-')));
  $('head-avatars').querySelectorAll('.focus-face').forEach((n) => n.remove());
  if (focusKey) {
    head.classList.add('has-focus', 'focus-custom', ...toneOf(focusKey).split(' ').filter(Boolean));
    const face = avatarFor(focusKey);
    face.classList.add('focus-face');
    face.title = `${focus} answers in this room`;
    $('head-avatars').appendChild(face);
  }
  $('head-title').textContent = focusKey ? `Coen · COO › ${focus} · advisor` : 'Coen · COO';
  const empty = $('empty');
  if (empty && !empty.dataset.fresh && focus) {
    empty.textContent = `Message the team. It lands with Coen, who hands it to ${focus}; ${focus}'s answer and proposals come straight to you.`;
  } else if (empty && !empty.dataset.fresh) {
    const advisors = catalogue.filter((a) => a.role === 'advisor' && inRoom(a.key)).map((a) => a.name);
    const list = advisors.length > 1 ? `${advisors.slice(0, -1).join(', ')} or ${advisors.at(-1)}` : advisors[0];
    empty.textContent = `Message the team. It lands with Coen first${list ? `, and he brings in ${list} when he needs them` : ''}.`;
  }
  // An empty chat opens with what the room is for.
  if (empty) {
    empty.querySelectorAll('.empty-about').forEach((n) => n.remove());
    if (space && space.description) empty.prepend(el('span', 'empty-about', space.description));
  }
}

function menuItem(label, onClick, cls = '') {
  const b = el('button', `space-item${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  spaceMenu.appendChild(b);
  return b;
}

// `moving`: the menu lists the other rooms to move this chat to, instead of rooms to switch to.
function renderSpaceMenu(moving = false) {
  spaceMenu.replaceChildren();
  if (moving) {
    spaceMenu.appendChild(el('p', 'space-menu-label', 'Move this chat to'));
    for (const w of spaceList.filter((x) => !space || x.id !== space.id)) menuItem(w.name, () => moveChat(w));
    spaceMenu.appendChild(el('hr'));
    menuItem('← Back', () => { renderSpaceMenu(); spaceMenu.querySelector('button').focus(); });
    return;
  }
  for (const w of spaceList) {
    const item = menuItem(w.name, () => switchSpace(w), `${space && w.id === space.id ? ' current' : ''}${w.working ? ' working' : ''}`);
    if (w.working) item.title = 'Working now';
    // What the room is for, under its name.
    if (w.description) {
      const text = el('span', 'space-item-text');
      text.append(el('span', null, w.name), el('small', 'space-item-desc', w.description));
      item.replaceChildren(text);
    }
  }
  spaceMenu.appendChild(el('hr'));
  if (spaceList.length > 1) menuItem('Move this chat to…', () => { renderSpaceMenu(true); spaceMenu.querySelector('button').focus(); });
  menuItem('Room settings…', () => { closeSpaceMenu(); openSpaceEditor(space); });
  menuItem('+ New room', () => { closeSpaceMenu(); openSpaceEditor(null); });
}

// The chat goes with its history and proposals; the room follows it, so the page reloads there.
async function moveChat(w) {
  closeSpaceMenu();
  try {
    await agentRequest(`/api/workspaces/${encodeURIComponent(w.id)}/move-chat`, {});
    location.reload();
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
  }
}

function closeSpaceMenu() {
  spaceMenu.hidden = true;
  spaceButton.setAttribute('aria-expanded', 'false');
}

spaceButton.addEventListener('click', async () => {
  if (!spaceMenu.hidden) { closeSpaceMenu(); return; }
  await refreshWorking();
  renderSpaceMenu();
  spaceMenu.hidden = false;
  spaceButton.setAttribute('aria-expanded', 'true');
  const first = spaceMenu.querySelector('button');
  if (first) first.focus();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.space-switch')) closeSpaceMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !spaceMenu.hidden) { closeSpaceMenu(); spaceButton.focus(); } });

// ---- Light or dark: a small menu in the header. The choice is this browser's, not a room's (see theme.js).
const themeMenu = $('theme-menu');
const themeToggle = $('theme-toggle');
// What is on the page now: after a choice in a private window nothing is remembered, and the page has still changed.
let themeNow = RoomTheme.current();
function closeThemeMenu() {
  themeMenu.hidden = true;
  themeToggle.setAttribute('aria-expanded', 'false');
}
function renderThemeMenu(focusOn = null) {
  themeMenu.replaceChildren();
  const group = (label, key, options, chosen) => {
    themeMenu.appendChild(el('p', 'space-menu-label', label));
    for (const [value, text] of options) {
      const b = el('button', `space-item${value === chosen ? ' current' : ''}`, text);
      b.type = 'button';
      b.dataset.value = value;
      b.setAttribute('aria-pressed', String(value === chosen));
      b.addEventListener('click', (e) => { e.stopPropagation(); themeNow = RoomTheme.choose(key, value); renderThemeMenu(value); });
      themeMenu.appendChild(b);
    }
  };
  group('Theme', 'room-theme', [['auto', 'Auto (follows your system)'], ['light', 'Light'], ['dark', 'Dark']], themeNow.theme);
  group('Dark style', 'room-dark-style', [['navy', 'Navy'], ['black', 'Black'], ['warm', 'Warm']], themeNow.style);
  const again = focusOn && themeMenu.querySelector(`[data-value="${focusOn}"]`);
  if (again) again.focus();
}
themeToggle.addEventListener('click', () => {
  if (!themeMenu.hidden) { closeThemeMenu(); return; }
  renderThemeMenu();
  themeMenu.hidden = false;
  themeToggle.setAttribute('aria-expanded', 'true');
  themeMenu.querySelector('.current').focus();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.theme-switch')) closeThemeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !themeMenu.hidden) { closeThemeMenu(); themeToggle.focus(); } });

// A different room means a different chat, history and rail: reloading draws it all from scratch.
async function switchSpace(w) {
  closeSpaceMenu();
  if (space && w.id === space.id) return;
  try {
    await agentRequest(`/api/workspaces/${encodeURIComponent(w.id)}/switch`, {});
    location.reload();
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
  }
}

// ---- The room's chats: a panel beside the chat on a wide window, a drawer over it otherwise. Every chat of the
// room is listed, the latest first; picking one goes back to it (the page reloads, as for another room).

const chatsWide = window.matchMedia('(min-width: 1100px)');
const chatList = $('chat-list');
const chatsNote = $('chats-note');
const chatsArchived = $('chats-archived');
const chatArchivedList = $('chat-archived-list');
let renamingChat = false;   // the list isn't redrawn under a name that is being typed
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>';
const PUT_BACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
let chatKeepDays = 30;
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

// Whether the panel is wanted on a wide window is remembered in this browser; a drawer always starts closed.
function chatsPref() {
  try { return localStorage.getItem('room-chats') !== 'closed'; } catch { return true; }
}
function setChats(open, remember = false) {
  document.body.classList.toggle('chats-open', open);
  $('chats-toggle').setAttribute('aria-expanded', String(open));
  if (remember && chatsWide.matches) { try { localStorage.setItem('room-chats', open ? 'open' : 'closed'); } catch { /* private window: not remembered */ } }
  if (open) loadChats();
}
const chatsOpen = () => document.body.classList.contains('chats-open');
// On a wide window the button disappears once the panel is open, so the focus moves into the panel.
$('chats-toggle').addEventListener('click', () => { setChats(!chatsOpen(), true); if (chatsOpen() && chatsWide.matches) $('chats-new').focus(); });
$('chats-close').addEventListener('click', () => { setChats(false, true); $('chats-toggle').focus(); });
$('chats-backdrop').addEventListener('click', () => setChats(false));
// When the open chat is already a new, empty one, the button is that chat's entry and only takes you to the message box.
$('chats-new').addEventListener('click', async () => {
  if (!chatsWide.matches) setChats(false);
  if ($('chats-new').classList.contains('current')) { input.focus(); return; }
  await newChat();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && chatsOpen() && !chatsWide.matches && !renamingChat) { setChats(false); $('chats-toggle').focus(); }
});
chatsWide.addEventListener('change', () => setChats(chatsWide.matches && chatsPref()));

function chatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86400000);
  if (days === 0) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
}

async function openChat(id) {
  try {
    await agentRequest(`/api/chats/${encodeURIComponent(id)}/open`, {});
    location.reload();
  } catch (err) {
    chatsNote.textContent = err.message;
    chatsNote.hidden = false;
    appendToThread(el('div', 'bubble err', err.message));
  }
}

// Archiving takes a chat out of the list and puts it under "Archived", where it can be opened or put back; nothing
// of it is removed. The server refuses while someone works in it or a proposal waits there, and says so. When it
// was the chat that's open, the room has a new, empty chat: the page loads that.
async function setArchived(c, label, archived) {
  sayNow = true;   // the owner's own action on this page: its result is spoken
  try {
    const data = await agentRequest(`/api/chats/${encodeURIComponent(c.id)}/${archived ? 'archive' : 'unarchive'}`, {});
    if (data.wasOpen) { location.reload(); return; }
    chatsDrawn = '';
    await fetchChats();
    say(archived ? `Archived the chat “${label}”. It is under Archived, at the bottom of the chat list.` : `Put the chat “${label}” back in the chat list.`);
    // The row that had the focus is gone: on to where the chat went.
    if (archived) chatsArchived.querySelector('summary').focus();
    else { const row = [...chatList.children].find((li) => li.dataset.id === c.id); if (row) row.querySelector('.chat-open').focus(); }
  } catch (err) {
    chatsNote.textContent = err.message;
    chatsNote.hidden = false;
    say(err.message);
  }
}

function chatRow(c) {
  const row = el('li', `chat-row${c.current ? ' current' : ''}`);
  row.dataset.id = c.id;
  const label = c.title ? `${c.title}${c.cut ? '…' : ''}` : 'New chat';
  const open = el('button', 'chat-open');
  open.type = 'button';
  if (c.current) open.setAttribute('aria-current', 'true');
  const started = c.named && c.started ? `Started with: ${c.started}${c.startedCut ? '…' : ''}` : '';
  open.title = c.current ? `The chat that's open${started ? `. ${started}` : ''}` : started || 'Go back to this chat';
  const meta = el('span', 'chat-meta');
  if (c.working) meta.append(el('span', 'chat-flag working', 'working'));
  if (c.title) meta.append(el('span', null, chatWhen(c.updatedAt)));
  if (c.waiting) {
    const waiting = el('span', 'chat-flag waiting', `${c.waiting} waiting`);
    waiting.title = `${c.waiting} proposal${c.waiting > 1 ? 's' : ''} waiting for your decision`;
    meta.append(waiting);
  }
  if (c.historyOnly) {
    const flag = el('span', 'chat-flag', 'history only');
    flag.title = `Coen has probably forgotten this chat: his memory of a chat is kept for about ${chatKeepDays} days after its last message. You can still read it and carry on here; he starts fresh.`;
    meta.append(flag);
  }
  open.append(el('span', 'chat-title', label), meta);
  open.addEventListener('click', () => { if (c.current) { if (!chatsWide.matches) setChats(false); } else openChat(c.id); });
  row.append(open);
  if (c.title && !c.archived) {
    const rename = el('button', 'chat-rename');
    rename.type = 'button';
    rename.innerHTML = PENCIL;
    rename.title = 'Rename';
    rename.setAttribute('aria-label', `Rename the chat “${label}”`);
    rename.addEventListener('click', () => editChatName(row, c));
    row.append(rename);
  }
  if (c.title) {
    const archive = el('button', 'chat-rename chat-archive');
    archive.type = 'button';
    archive.innerHTML = c.archived ? PUT_BACK_ICON : ARCHIVE_ICON;
    archive.title = c.archived ? 'Put back in the chat list' : 'Archive';
    archive.setAttribute('aria-label', c.archived ? `Put the chat “${label}” back in the chat list` : `Archive the chat “${label}”`);
    archive.addEventListener('click', () => setArchived(c, label, !c.archived));
    row.append(archive);
  }
  return row;
}

// The row becomes a small form in place: Enter or Save stores the name, Esc or Cancel leaves it. An empty name goes
// back to how the chat started.
function editChatName(row, c) {
  renamingChat = true;
  const form = el('form', 'chat-edit');
  const input = el('input');
  input.maxLength = 80;
  input.value = c.named ? c.title : '';
  input.placeholder = c.named ? c.started || '' : c.title;
  input.setAttribute('aria-label', 'Name for this chat');
  input.autocomplete = 'off';
  const actions = el('div', 'chat-edit-actions');
  const save = el('button', 'save', 'Save');
  save.type = 'submit';
  const cancel = el('button', null, 'Cancel');
  cancel.type = 'button';
  actions.append(save, cancel, el('small', null, 'empty = first message'));
  const error = el('p', 'form-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(input, actions, error);
  const done = () => { renamingChat = false; chatsDrawn = ''; loadChats(); };
  cancel.addEventListener('click', done);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await agentRequest(`/api/chats/${encodeURIComponent(c.id)}/rename`, { name: input.value });
      done();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      save.disabled = false;
      input.focus();
    }
  });
  row.replaceChildren(form);
  row.classList.remove('current');
  input.focus();
  input.select();
}

// Asked for from several places (a finished turn, the timer, opening the panel), and once per old turn while a
// chat is replayed on load: the calls of one moment become one request.
let chatsTimer = null;
let chatsDrawn = '';
function loadChats() {
  clearTimeout(chatsTimer);
  chatsTimer = setTimeout(fetchChats, 120);
}

async function fetchChats() {
  if (!space || !chatsOpen() || renamingChat) return;
  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(space.id)}/chats`);
    if (!res.ok) return;   // an older server has no chat list: the panel stays empty
    const data = await res.json();
    // Redrawn only when something changed, so the regular check doesn't take the focus out of the list.
    const drawn = JSON.stringify([space.id, data, new Date().toDateString()]);
    if (renamingChat || drawn === chatsDrawn) return;
    chatsDrawn = drawn;
    if (Number.isFinite(data.keepDays)) chatKeepDays = data.keepDays;
    $('chats-room').textContent = `· ${space.name}`;
    // An open chat without a message yet gets no row: "New chat" itself is highlighted for it.
    const fresh = (data.chats || []).some((c) => c.current && !c.title);
    $('chats-new').classList.toggle('current', fresh);
    $('chats-new').textContent = fresh ? 'New chat' : '+ New chat';
    if (fresh) $('chats-new').setAttribute('aria-current', 'true'); else $('chats-new').removeAttribute('aria-current');
    chatList.replaceChildren(...(data.chats || []).filter((c) => c.title || !c.current).map(chatRow));
    // Archived chats, when there are any (an older server sends none): closed until asked for, except when the
    // chat that's open is one of them.
    const archived = data.archived || [];
    chatsArchived.hidden = !archived.length;
    chatsArchived.querySelector('summary').textContent = `Archived (${data.archivedTotal || archived.length})`;
    chatArchivedList.replaceChildren(...archived.map(chatRow));
    if (archived.some((c) => c.current)) chatsArchived.open = true;
    const more = (data.total || 0) - (data.chats || []).length;
    chatsNote.textContent = more > 0 ? `Showing the latest ${data.chats.length} of ${data.total} chats.` : !(data.chats || []).some((c) => c.title) ? 'Chats in this room are kept here, so you can go back to one.' : '';
    chatsNote.hidden = !chatsNote.textContent;
  } catch { /* try again next time */ }
}

const spaceEditor = $('space-editor');
const spaceForm = $('space-form');
const spaceError = $('space-error');
let editingSpace = null;
let spaceSnapshot = null;   // the form as it was at open, to spot unsaved changes

function openSpaceEditor(w) {
  editingSpace = w;
  $('space-editor-title').textContent = w ? `${w.name} · settings` : 'New room';
  $('space-save').textContent = w ? 'Save' : 'Create room';
  $('space-remove').hidden = !w || w.isDefault;
  $('space-name').value = w ? w.name : '';
  $('space-description').value = w ? w.description || '' : '';
  // A room list from before briefs (an older server) has none.
  $('space-brief').value = w ? w.brief || '' : '';
  $('space-everyone').checked = Boolean(w && w.members == null);
  const list = $('space-members');
  list.replaceChildren();
  for (const [role, label] of [['advisor', 'Advisors'], ['maker', 'Makers · work only after your approval']]) {
    list.appendChild(el('p', 'member-group', label));
    const group = el('div', 'member-grid');
    for (const a of catalogue.filter((x) => x.role === role)) {
      const option = el('label', 'member-option');
      const box = el('input');
      box.type = 'checkbox';
      box.dataset.member = a.key;
      box.checked = Boolean(w && (w.members == null || w.members.includes(a.key)));
      option.append(box, avatarFor(a.key), el('span', null, a.name));
      group.appendChild(option);
    }
    list.appendChild(group);
  }
  const select = $('space-focus');
  select.replaceChildren(el('option', null, 'None · Coen answers himself'), ...catalogue.filter((a) => a.role === 'advisor').map((a) => {
    const opt = el('option', null, a.name);
    opt.value = a.key;
    return opt;
  }));
  select.firstChild.value = '';
  select.value = (w && w.focus) || '';
  // What the room can use; a new room starts with nothing beyond drafts/ (the server's default too).
  const access = (w && w.access) || { files: [], sites: [], webSearch: false, notion: false, m365: false };
  accessLists.files = [...access.files];
  accessLists.sites = [...access.sites];
  editingFolder = null;
  renderAccessList('files');
  renderAccessList('sites');
  $('access-websearch').checked = access.webSearch;
  $('access-notion').checked = access.notion;
  $('access-m365').checked = access.m365 === true;
  // What the room can propose; a new room starts with nothing (the server's default too).
  const targets = (w && w.targets) || { repos: [], notionDbs: [], notionPlaces: [] };
  // Public repos (e.g. open-source ones) are a separate list; the private list is the rest.
  accessLists.publicRepos = [...(targets.publicRepos || [])];
  accessLists.repos = targets.repos.filter((r) => !accessLists.publicRepos.includes(r));
  renderAccessList('repos');
  renderAccessList('publicRepos');
  accessLists.allowedRecipients = [...(targets.allowedRecipients || [])];
  renderAccessList('allowedRecipients');
  $('targets-send-from').value = targets.sendFrom || '';
  $('targets-dbs').replaceChildren(...notionDbs.map((db) => {
    const label = el('label', 'choice');
    const box = el('input');
    box.type = 'checkbox';
    box.dataset.db = db.key;
    box.checked = targets.notionDbs.includes(db.key);
    label.append(box, el('span', null, db.name));
    return label;
  }));
  places = targets.notionPlaces.map((p) => ({ ...p }));
  editingPlace = null;
  renderPlaces();
  $('targets-notion').hidden = !notionOn;
  $('targets-notion-off').hidden = notionOn;
  syncEveryone();
  updateSpaceSummary();
  selectSpaceTab(spaceTabs[0], false);   // always opens on General
  // Text left in the add boxes from an earlier visit would otherwise block the save.
  for (const id of PENDING_INPUTS) $(id).value = '';
  clearSpaceErrors();
  spaceSnapshot = JSON.stringify(spaceBody());
  spaceEditor.showModal();
  $('space-name').focus();
}

// "Everyone" keeps the room open to agents added later, so the individual boxes don't apply.
function syncEveryone() {
  const all = $('space-everyone').checked;
  $('space-members').querySelectorAll('input').forEach((b) => { b.disabled = all; if (all) b.checked = true; });
  $('space-members').classList.toggle('disabled', all);
}

// Folders and sites as editable lists; the server checks them (real folders, not too broad; exact site names).
const accessLists = { files: [], sites: [], repos: [], publicRepos: [], allowedRecipients: [] };   // repos: the private ones
let places = [];   // Notion places: { id or url, name, for }
let editingPlace = null;   // index of the place open for editing in its row
let editingFolder = null;  // the same for "Folders it can read"
let dragPlace = null;      // index of the place being dragged
const ACCESS_UI = {
  files: { list: 'access-files', input: 'access-file-input', add: 'access-file-add', error: 'access-file-error', label: 'Folders it can read', empty: 'Only drafts/' },
  sites: { list: 'access-sites', input: 'access-site-input', add: 'access-site-add', error: 'access-site-error', label: 'Sites it can open', empty: 'None: opening web pages is off' },
  repos: { list: 'targets-repos', input: 'targets-repo-input', add: 'targets-repo-add', error: 'targets-repo-error', label: 'Private repos for issues', empty: 'None' },
  publicRepos: { list: 'targets-public-repos', input: 'targets-public-repo-input', add: 'targets-public-repo-add', error: 'targets-public-repo-error', label: 'Public repos for issues', empty: 'None: no public issues from this room' },
  allowedRecipients: { list: 'targets-recipients', input: 'targets-recipient-input', add: 'targets-recipient-add', error: 'targets-recipient-error', label: 'Email recipients for drafts', empty: 'None: no email drafts from this room' },
};

// Error boxes per section, keyed like ACCESS_UI plus Notion places; and every add box that can hold unadded text.
const PLACE_INPUTS = ['targets-place-url', 'targets-place-name', 'targets-place-for'];
const PENDING_INPUTS = [...Object.values(ACCESS_UI).map((ui) => ui.input), ...PLACE_INPUTS];
const SECTION_ERRORS = { ...Object.fromEntries(Object.entries(ACCESS_UI).map(([kind, ui]) => [kind, ui.error])), places: 'targets-place-error' };

function clearSpaceErrors() {
  spaceError.textContent = '';
  for (const id of Object.values(SECTION_ERRORS)) { $(id).textContent = ''; $(id).hidden = true; }
}

// Show an error in its section (or the general box when there's none, or it's hidden), switching to that section's tab and bringing it into view.
function showSpaceError(message, section) {
  const own = section ? $(SECTION_ERRORS[section]) : null;
  // The box itself starts hidden, so look from its parent up. #targets-notion is hidden when Notion is off; a tab panel is only hidden because another tab is showing, so it doesn't count.
  const box = own && !own.parentElement.closest('[hidden]:not([role="tabpanel"])') ? own : spaceError;
  box.textContent = message;
  box.hidden = false;
  const panel = box.closest('[role="tabpanel"]');
  if (panel && panel.hidden) selectSpaceTab($(panel.getAttribute('aria-labelledby')), false);
  // The box itself, not its section: a long section would leave the box under the sticky Save bar.
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Text typed in an add box but never added; the save stops and names it rather than dropping it.
function unaddedValue() {
  const quote = (v) => (v.length > 60 ? `${v.slice(0, 57)}…` : v);
  // A folder left open for editing counts too: its box isn't in the form until Done.
  if (editingFolder !== null) return { section: 'files', input: 'access-file-edit', message: `“${quote(accessLists.files[editingFolder])}” under “${ACCESS_UI.files.label}” is still open for editing. Click Done or Cancel on it, then save.` };
  for (const [kind, ui] of Object.entries(ACCESS_UI)) {
    const value = $(ui.input).value.trim();
    if (value) return { section: kind, input: ui.input, message: `“${quote(value)}” under “${ui.label}” isn't added yet. Click ${$(ui.add).textContent}, or clear the box, then save.` };
  }
  if ($('targets-notion').hidden) return null;
  // A place left open for editing counts too: its boxes aren't in the form until Done.
  if (editingPlace !== null) return { section: 'places', input: 'targets-place-edit-name', message: `“${quote(places[editingPlace].name)}” under “Notion places for pages” is still open for editing. Click Done or Cancel on it, then save.` };
  const input = PLACE_INPUTS.find((id) => $(id).value.trim());
  if (!input) return null;
  return { section: 'places', input, message: `“${quote($(input).value.trim())}” under “Notion places for pages” isn't added yet. Click Add place, or clear the boxes, then save.` };
}

// Server errors go to the section whose current value they quote ("value"); failing that, to the one section they name.
function sectionForServerError(message) {
  const text = String(message || '');
  if (text.includes('for "Send from"')) return 'allowedRecipients';
  const quoted = (v) => Boolean(v) && text.includes(`"${v}"`);
  // An Output DB given as a place comes back unquoted, as "<name or id> is an Output DB…".
  const isPlace = (v) => quoted(v) || (Boolean(v) && text.startsWith(`${v} is `));
  const holders = Object.keys(ACCESS_UI).filter((kind) => accessLists[kind].some(quoted));
  if (places.some((p) => [p.url, p.id, p.name].some(isPlace))) holders.push('places');
  // Public repos are sent inside repos too, so a value in both lists belongs to Public repos.
  const sections = holders.includes('publicRepos') ? holders.filter((kind) => kind !== 'repos') : holders;
  const byKeyword = keywordSection(text);
  if (sections.length === 1) return sections[0];
  if (sections.length > 1) return sections.includes(byKeyword) ? byKeyword : null;
  return byKeyword;
}

// Fallback: the one section a message names by keyword (folder, site, repo, recipient, place), or null.
function keywordSection(text) {
  const named = (kind) => accessLists[kind].some((v) => text.includes(v));
  const found = [];
  if (/\bfolders?\b/i.test(text)) found.push('files');
  if (/\bsites?\b/i.test(text)) found.push('sites');
  if (/\brepos?\b|\brepositor(?:y|ies)\b/i.test(text)) found.push(named('publicRepos') || (!named('repos') && /\bpublic\b/i.test(text)) ? 'publicRepos' : 'repos');
  if (/\brecipients?\b/i.test(text)) found.push('allowedRecipients');
  if (/\bplaces?\b/i.test(text)) found.push('places');
  return found.length === 1 ? found[0] : null;
}

function renderAccessList(kind) {
  const ui = ACCESS_UI[kind];
  const list = $(ui.list);
  list.replaceChildren();
  if (!accessLists[kind].length) list.appendChild(el('li', 'access-empty', ui.empty));
  accessLists[kind].forEach((value, i) => {
    const item = el('li');
    const remove = el('button', 'access-remove', '×');
    remove.type = 'button';
    remove.title = `Remove ${value}`;
    remove.setAttribute('aria-label', `Remove ${value}`);
    remove.addEventListener('click', () => {
      accessLists[kind].splice(i, 1);
      if (kind === 'files' && editingFolder !== null && i < editingFolder) editingFolder -= 1;
      renderAccessList(kind);
    });
    item.append(el('code', null, value));
    // Folders are long and easy to mistype, so they get a pencil; the other lists are quicker to remove and re-add.
    if (kind === 'files') {
      const edit = el('button', 'access-remove row-change', '✎');
      edit.type = 'button';
      edit.title = `Edit ${value}`;
      edit.setAttribute('aria-label', `Edit ${value}`);
      edit.addEventListener('click', () => {
        editingFolder = i;
        renderAccessList(kind);
        $('access-file-edit').focus();
      });
      item.append(edit);
    }
    item.append(remove);
    list.appendChild(kind === 'files' && i === editingFolder ? folderEditRow(value, i) : item);
  });
  updateSpaceSummary();
}

// A folder row opened into a box, like a place: Done applies it to the form, Cancel or Esc leaves it as it was.
function folderEditRow(value, i) {
  const item = el('li', 'row-edit');
  const input = el('input');
  input.id = 'access-file-edit';
  input.value = value;
  input.setAttribute('aria-label', 'Folder');
  input.autocomplete = 'off';
  const close = () => {
    editingFolder = null;
    renderAccessList('files');
    const row = $('access-files').children[Math.min(i, accessLists.files.length - 1)];
    if (row) row.querySelector('.row-change').focus();
  };
  const apply = () => {
    const folder = input.value.trim().replace(/\/+$/, '');
    if (!folder) { showSpaceError('A folder needs its path.', 'files'); return; }
    // Changed into one that's already listed: the two become one.
    if (accessLists.files.some((f, at) => f === folder && at !== i)) accessLists.files.splice(i, 1);
    else accessLists.files[i] = folder;
    clearSpaceErrors();
    close();
  };
  const done = el('button', 'ghost', 'Done');
  done.type = 'button';
  done.addEventListener('click', apply);
  const cancel = el('button', 'ghost', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  item.append(input, done, cancel);
  return item;
}

for (const kind of Object.keys(ACCESS_UI)) {
  const ui = ACCESS_UI[kind];
  const add = () => {
    let value = $(ui.input).value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (kind === 'repos' || kind === 'publicRepos') {
      value = value.replace(/^github\.com\//, '');
      const other = kind === 'repos' ? 'publicRepos' : 'repos';
      accessLists[other] = accessLists[other].filter((r) => r !== value);
      renderAccessList(other);
    }
    if (!value) return;
    if (!accessLists[kind].includes(value)) accessLists[kind].push(value);
    $(ui.input).value = '';
    renderAccessList(kind);
  };
  $(ui.add).addEventListener('click', add);
  $(ui.input).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

function renderPlaces() {
  const list = $('targets-places');
  list.replaceChildren();
  if (!places.length) list.appendChild(el('li', 'access-empty', 'None: no Notion pages from this room'));
  places.forEach((p, i) => list.appendChild(i === editingPlace ? placeEditRow(p, i) : placeRow(p, i)));
  updateSpaceSummary();
}

// A saved place only has its page id; shown as a link so the box holds something that can be pasted back.
const placeLink = (p) => p.url || `https://www.notion.so/${p.id}`;

function movePlace(from, to) {
  if (to < 0 || to >= places.length || to === from) return false;
  places.splice(to, 0, places.splice(from, 1)[0]);
  return true;
}

// A row: drag it (or use the arrow keys on its grip) to reorder, the pencil to change it, × to remove it.
function placeRow(p, i) {
  const item = el('li', 'place-row');
  // A span, not a button: Firefox won't start a drag from a button.
  const grip = el('span', 'place-grip', '⠿');
  grip.tabIndex = 0;
  grip.setAttribute('role', 'button');
  grip.title = 'Drag to reorder, or use the up and down arrow keys';
  grip.setAttribute('aria-label', `Move ${p.name}, ${i + 1} of ${places.length}: up and down arrow keys`);
  grip.addEventListener('keydown', (e) => {
    const to = { ArrowUp: i - 1, ArrowDown: i + 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    if (editingPlace !== null || !movePlace(i, to)) return;
    renderPlaces();
    $('targets-places').children[to].querySelector('.place-grip').focus();
  });
  const edit = el('button', 'access-remove row-change', '✎');
  edit.type = 'button';
  edit.title = `Edit ${p.name}`;
  edit.setAttribute('aria-label', `Edit ${p.name}`);
  edit.addEventListener('click', () => {
    editingPlace = i;
    renderPlaces();
    $('targets-place-edit-name').focus();
  });
  const remove = el('button', 'access-remove', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${p.name}`);
  remove.addEventListener('click', () => {
    places.splice(i, 1);
    if (editingPlace !== null && i < editingPlace) editingPlace -= 1;
    renderPlaces();
  });
  item.append(grip, el('span', 'place-text', p.for ? `${p.name} · ${p.for}` : p.name), edit, remove);
  // No dragging while a row is open for editing: its index would move under it.
  if (editingPlace !== null) return item;
  item.draggable = true;
  const clearMarks = () => $('targets-places').querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  item.addEventListener('dragstart', (e) => {
    dragPlace = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.name);
    item.classList.add('dragging');
  });
  item.addEventListener('dragover', (e) => {
    if (dragPlace === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = item.getBoundingClientRect();
    clearMarks();
    item.classList.add(e.clientY > box.top + box.height / 2 ? 'drop-after' : 'drop-before');
  });
  item.addEventListener('drop', (e) => {
    if (dragPlace === null) return;
    e.preventDefault();
    const to = item.classList.contains('drop-after') ? i + 1 : i;
    movePlace(dragPlace, dragPlace < to ? to - 1 : to);
  });
  // Fires on the dragged row after a drop or a cancelled drag; the list is redrawn here, not in drop, so this row is still there to get it.
  item.addEventListener('dragend', () => { dragPlace = null; renderPlaces(); });
  return item;
}

// The same row opened into boxes. Done applies it to the form (the room's Save stores it); Cancel or Esc leaves it as it was.
function placeEditRow(p, i) {
  const item = el('li', 'row-edit');
  const box = (value, label) => {
    const input = el('input');
    input.value = value;
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    return input;
  };
  const link = box(placeLink(p), 'Notion page link');
  const name = box(p.name, 'Name');
  name.id = 'targets-place-edit-name';
  const what = box(p.for || '', "What it's for (optional)");
  const close = () => {
    editingPlace = null;
    renderPlaces();
    $('targets-places').children[i].querySelector('.row-change').focus();
  };
  const apply = () => {
    const url = link.value.trim();
    if (!url || !name.value.trim()) { showSpaceError('A place needs its Notion link and a name.', 'places'); return; }
    // An untouched link keeps the saved page id.
    places[i] = { ...(p.id && url === placeLink(p) ? { id: p.id } : { url }), name: name.value.trim(), for: what.value.trim() };
    clearSpaceErrors();
    close();
  };
  const done = el('button', 'ghost', 'Done');
  done.type = 'button';
  done.addEventListener('click', apply);
  const cancel = el('button', 'ghost', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  // Enter would submit the whole form and Esc would close the dialog; here they belong to the row.
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  item.append(link, name, what, done, cancel);
  return item;
}

// Live summary on top, a count per section and per tab, from the lists and boxes as they are now.
function updateSpaceSummary() {
  const len = (kind) => accessLists[kind].length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const setCount = (id, text, on) => { $(id).textContent = text; $(id).classList.toggle('on', on); };
  const everyone = $('space-everyone').checked;
  const members = $('space-members').querySelectorAll('input:checked').length;
  const webSearch = $('access-websearch').checked;
  const notionRead = $('access-notion').checked;
  const m365Read = $('access-m365').checked;
  const dbs = $('targets-dbs').querySelectorAll('input:checked').length;
  setCount('space-count-general', everyone ? 'all' : plural(members, 'member'), everyone || members > 0);
  setCount('access-file-count', String(len('files')), len('files') > 0);
  setCount('access-site-count', String(len('sites')), len('sites') > 0);
  setCount('access-websearch-count', webSearch ? 'on' : 'off', webSearch);
  setCount('access-notion-count', notionRead ? 'read' : 'off', notionRead);
  setCount('access-m365-count', m365Read ? 'read' : 'off', m365Read);
  setCount('targets-repo-count', String(len('repos')), len('repos') > 0);
  setCount('targets-public-repo-count', String(len('publicRepos')), len('publicRepos') > 0);
  setCount('targets-recipient-count', len('allowedRecipients') ? String(len('allowedRecipients')) : 'off', len('allowedRecipients') > 0);
  setCount('targets-db-count', String(dbs), dbs > 0);
  setCount('targets-place-count', String(places.length), places.length > 0);
  // Tab labels: how many sections there are switched on, and an amber dot when something there reaches outside.
  const useOn = [len('files'), len('sites'), webSearch, notionRead, m365Read].filter(Boolean).length;
  const proposeOn = [len('repos'), len('publicRepos'), len('allowedRecipients'), notionOn && dbs, notionOn && places.length].filter(Boolean).length;
  setCount('space-tab-use-count', String(useOn), useOn > 0);
  setCount('space-tab-propose-count', String(proposeOn), proposeOn > 0);
  $('space-tab-use-dot').hidden = !webSearch;
  $('space-tab-propose-dot').hidden = !(len('publicRepos') || len('allowedRecipients'));
  // Each part is [text, reaches outside?]; the ones that reach outside get the amber mark.
  const reads = [[len('files') ? plural(len('files'), 'folder') : 'drafts/ only'], [len('sites') ? plural(len('sites'), 'site') : 'no sites']];
  if (webSearch) reads.push(['web search', true]);
  if (notionRead) reads.push(['Notion (read)']);
  if (m365Read) reads.push(['Microsoft 365 mail (read)']);
  const proposes = [];
  if (len('repos')) proposes.push([plural(len('repos'), 'private repo')]);
  if (len('publicRepos')) proposes.push([plural(len('publicRepos'), 'public repo'), true]);
  if (notionOn && dbs) proposes.push([plural(dbs, 'Notion DB')]);
  if (notionOn && places.length) proposes.push([plural(places.length, 'Notion place')]);
  if (!proposes.length) proposes.push(['nothing']);
  proposes.push(len('allowedRecipients') ? [plural(len('allowedRecipients'), 'email recipient'), true] : ['email off']);
  const parts = (items) => items.flatMap(([text, out], i) => [...(i ? [' · '] : []), out ? el('span', 'out', text) : text]);
  $('space-summary').replaceChildren(el('b', null, 'Reads'), ' ', ...parts(reads), ' — ', el('b', null, 'Proposes'), ' ', ...parts(proposes));
}

// Folders, sites, public repos and recipients added since the dialog opened, and web search or Microsoft 365 mail
// switched on; each widens what the room reaches.
function spaceAdditions() {
  const before = JSON.parse(spaceSnapshot);
  const webSearch = $('access-websearch').checked && !before.access.webSearch ? ['web search'] : [];
  const m365 = $('access-m365').checked && !before.access.m365 ? ['Microsoft 365 mail (read-only)'] : [];
  return [...webSearch, ...m365, ...[
    ['folder', accessLists.files, before.access.files],
    ['site', accessLists.sites, before.access.sites],
    ['public repo', accessLists.publicRepos, before.targets.publicRepos],
    ['email recipient', accessLists.allowedRecipients, before.targets.allowedRecipients],
  ].flatMap(([label, now, was]) => now.filter((v) => !was.includes(v)).map((v) => `${label} ${v}`))];
}

// Tabs: General / Can use / Can propose / Decisions. Roving tabindex; Left/Right (wrapping), Home and End move between them.
const spaceTabs = [...spaceEditor.querySelectorAll('[role="tab"]')];

function selectSpaceTab(tab, focus) {
  for (const t of spaceTabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
  // The Decisions tab is read fresh each time it is opened; the other tabs are the form.
  if (tab.id === 'space-tab-decisions') loadDecisions();
}

spaceTabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectSpaceTab(tab, true));
  tab.addEventListener('keydown', (e) => {
    const last = spaceTabs.length - 1;
    const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (to === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    selectSpaceTab(spaceTabs[to], true);
  });
});

// ---- Decisions tab (Room settings): read-only, the whole room across all its chats, one row per decided proposal.
// It is no part of the form: it has no fields, so Save, the tab counts and the summary line never see it.

const ACTION_LABELS = {
  dispatch: 'Dispatch to a maker', github_issue: 'GitHub issue', github_comment: 'GitHub comment', notion_draft: 'Notion draft',
  notion_page: 'Notion page', notion_page_update: 'Notion page update', email_draft: 'Email draft', create_agent: 'New agent',
};
const DECISION_WORDS = { approved: 'approved', revised: 'asked for a revision', dismissed: 'dismissed' };
const DECISIONS_ABOUT = 'Every proposal you approve, send back for a revision or dismiss in this room is listed here, across all its chats: who decided, what it was, when, and what came of it.';
const decisionsList = $('decisions-list');
const decisionsEmpty = $('decisions-empty');
let decisionsLoad = 0;   // only the latest request may fill the list
const decisionChatTones = new Map();   // chat id → one of the 8 tones, in the order the chats appear in the list

function decisionsMessage(text) {
  decisionsList.replaceChildren();
  decisionsEmpty.textContent = text;
  decisionsEmpty.hidden = !text;
}

function decisionRow(d) {
  const row = el('li', 'decision');
  const head = el('div', 'decision-head');
  head.append(el('b', null, d.actor || ownerName), el('span', null, DECISION_WORDS[d.decision] || d.decision || ''), el('span', 'decision-kind', Object.hasOwn(ACTION_LABELS, d.action) ? ACTION_LABELS[d.action] : 'Proposal'), el('span', 'decision-when', whenText(d.at)));
  row.append(head, el('p', 'decision-summary', d.summary || ''));
  // Background, as tags: who proposed it, in that agent's own colour, and the chat it came up in. Each chat gets a
  // dot in one colour for this list, so rows from the same discussion are easy to spot. A row without them (an
  // older server, a proposal that is no longer stored) just has fewer tags.
  const tags = el('div', 'decision-tags');
  if (d.proposer && d.proposer.key) {
    const who = d.proposer.key;
    const kind = who === 'coen' ? 'coen' : 'custom';
    tags.append(el('span', `decision-tag by ${kind}${toneOf(who)}`, `Proposed by ${d.proposer.name || nameOf(who)}${who === 'coen' ? '' : ', via Coen'}`));
  }
  if (d.chat && d.chat.id) {
    if (!decisionChatTones.has(d.chat.id)) decisionChatTones.set(d.chat.id, (decisionChatTones.size % 8) + 1);
    // A button: it opens that chat. A chat the owner named shows its name, with how it started in the hover text.
    const chat = el('button', `decision-tag chat tone-${decisionChatTones.get(d.chat.id)}`);
    chat.type = 'button';
    const started = d.chat.named ? d.chat.started && `${d.chat.started}${d.chat.startedCut ? '…' : ''}` : d.chat.title;
    chat.title = `Open this chat. ${started ? `It started with: ${started}` : 'It has no first message on record.'}`;
    chat.append(el('span', null, d.chat.title ? `Chat · ${d.chat.title}${d.chat.cut ? '…' : ''}` : 'Chat · untitled'));
    chat.addEventListener('click', async () => {
      if (spaceDirty() && !(await askConfirm('Discard changes to this room?', 'Discard'))) return;
      openChat(d.chat.id);
    });
    tags.append(chat);
  }
  if (tags.children.length) row.append(tags);
  // An email draft has its subject and the recipients' domains. An approved one whose text the room still keeps can
  // be opened, copied and removed from here too; any other has no addresses or text left.
  if (d.action === 'email_draft') {
    row.append(el('p', 'rec-note', `Subject: ${d.subject || ''} · to ${(d.domains || []).join(', ')} (domains only)`));
    if (d.draft && Array.isArray(d.draft.to) && typeof d.draft.body === 'string') {
      const kept = el('div', 'decision-email');
      const after = el('div', 'rec-actions email-kept');
      after.append(el('span', 'rec-note', keptNote(d.keepUntil)), forgetButton(d.recId, () => kept.replaceChildren(el('p', 'rec-note', 'The addresses and the text have been removed from the room.'))));
      kept.append(emailButtons({ to: d.draft.to, cc: d.draft.cc || [], subject: d.draft.subject || '', body: d.draft.body }), after);
      row.append(kept);
    }
  }
  const words = d.decision === 'dismissed' ? 'Closed, nothing was done.'
    : d.decision === 'revised' ? 'Sent back for a revision.'
    : d.action === 'email_draft' ? 'Nothing was sent from the room.'
    : { done: 'Done.', failed: 'Failed.', stopped: 'Stopped.', running: 'In progress.' }[d.state] || 'No result logged.';
  const outcome = el('div', 'decision-outcome');
  outcome.append(el('span', null, words));
  // Only what the card itself would link to: the same checks as showRecResult.
  const urls = Array.isArray(d.urls) ? d.urls : [];
  urls.forEach((u, i) => {
    if (!isNotionUrl(u) && !isGithubUrl(u)) { outcome.append(el('span', 'rec-note', 'A link was left out: not a Notion page or a GitHub issue or comment.')); return; }
    const label = isNotionUrl(u) ? 'Open in Notion' : /#issuecomment-/.test(u) ? 'Open the comment on GitHub' : 'Open the issue on GitHub';
    const link = el('a', null, urls.length > 1 ? `${label} (${i + 1})` : label);
    link.href = u;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    outcome.append(link);
  });
  if (d.agent) outcome.append(el('span', null, `Added ${d.agent} to the room.`));
  // A draft that is gone is said so in words; it gets no chip, as there is nothing to open. A patch or a mockup is
  // named without a chip too: the viewer opens .md drafts only.
  for (const f of Array.isArray(d.drafts) ? d.drafts : []) {
    if (f.exists && f.opens !== false) addDraftChip({ el: outcome }, f.name);
    else outcome.append(el('span', 'decision-missing', f.exists ? `${f.name} · in drafts/` : `${f.name} · no longer in drafts/`));
  }
  if (d.error) outcome.append(el('span', 'err-text', d.error));
  row.append(outcome);
  // What the owner wrote with the decision. For an email draft the server holds it back (it may quote the
  // draft) and the row only says so; a decision from before reasons existed has neither.
  const kind = d.decision === 'dismissed' ? 'reason' : d.decision === 'revised' ? 'note' : '';
  const wrote = kind && typeof d[kind] === 'string' && d[kind] ? `${kind === 'reason' ? 'Reason' : 'Note'}: ${d[kind]}`
    : kind && d.noteWithheld ? `A ${kind} was given. It is on the card in the chat.` : '';
  if (wrote) row.append(el('p', 'decision-said', wrote));
  return row;
}

async function loadDecisions() {
  const load = ++decisionsLoad;
  // A room that doesn't exist yet has nothing to ask the server for.
  if (!editingSpace) { decisionsMessage(`${DECISIONS_ABOUT} There is nothing yet: this room starts its list once you have created it.`); return; }
  decisionsMessage('Loading…');
  try {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(editingSpace.id)}/decisions`);
    const data = await res.json().catch(() => ({}));
    if (load !== decisionsLoad) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const rows = Array.isArray(data.decisions) ? data.decisions : [];
    if (!rows.length) { decisionsMessage(`Nothing has been decided in this room yet. ${DECISIONS_ABOUT}`); return; }
    decisionsMessage(data.total > rows.length ? `Showing the latest ${rows.length} of ${data.total}.` : '');
    decisionChatTones.clear();
    decisionsList.replaceChildren(...rows.map(decisionRow));
  } catch (err) {
    if (load === decisionsLoad) decisionsMessage(`Couldn't load the decisions: ${err.message}`);
  }
}

$('targets-place-add').addEventListener('click', () => {
  const url = $('targets-place-url').value.trim();
  const name = $('targets-place-name').value.trim();
  if (!url || !name) { showSpaceError('A place needs its Notion link and a name.', 'places'); return; }
  places.push({ url, name, for: $('targets-place-for').value.trim() });
  for (const id of PLACE_INPUTS) $(id).value = '';
  renderPlaces();
});

$('space-everyone').addEventListener('change', syncEveryone);
// The focus agent has to be in the room, so picking one ticks them.
$('space-focus').addEventListener('change', () => {
  const box = $('space-members').querySelector(`input[data-member="${$('space-focus').value}"]`);
  if (box) box.checked = true;
});
// Unsaved changes: anything differing from the snapshot at open, or text left in an add box.
function spaceDirty() {
  return JSON.stringify(spaceBody()) !== spaceSnapshot || Boolean(unaddedValue());
}

$('space-close').addEventListener('click', async () => {
  if (spaceDirty() && !(await askConfirm('Discard changes to this room?', 'Discard'))) return;
  spaceEditor.close();
});
// Esc fires 'cancel' before the dialog closes: with unsaved changes it's held open until the owner answers.
spaceEditor.addEventListener('cancel', async (e) => {
  if (!spaceDirty()) return;
  e.preventDefault();
  if (await askConfirm('Discard changes to this room?', 'Discard')) spaceEditor.close();
});
spaceForm.addEventListener('input', clearSpaceErrors);
// Ticking a box changes the summary and counts; list edits update them as they render.
spaceForm.addEventListener('change', updateSpaceSummary);

// The form as the server gets it; also what the snapshot at open is made of.
function spaceBody() {
  return {
    name: $('space-name').value.trim(),
    description: $('space-description').value.trim(),
    brief: $('space-brief').value.trim(),
    members: $('space-everyone').checked ? null : [...$('space-members').querySelectorAll('input:checked')].map((b) => b.dataset.member),
    focus: $('space-focus').value || null,
    access: { files: accessLists.files, sites: accessLists.sites, webSearch: $('access-websearch').checked, notion: $('access-notion').checked, m365: $('access-m365').checked },
    targets: {
      repos: [...accessLists.repos, ...accessLists.publicRepos],
      publicRepos: accessLists.publicRepos,
      notionDbs: [...$('targets-dbs').querySelectorAll('input:checked')].map((b) => b.dataset.db),
      notionPlaces: places.map((p) => ({ ...(p.id ? { id: p.id } : { url: p.url }), name: p.name, for: p.for || '' })),
      allowedRecipients: accessLists.allowedRecipients,
      sendFrom: $('targets-send-from').value.trim(),
    },
  };
}

spaceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearSpaceErrors();
  const unadded = unaddedValue();
  if (unadded) {
    showSpaceError(unadded.message, unadded.section);
    $(unadded.input).focus({ preventScroll: true });
    return;
  }
  // Additions that widen what the room reaches get one explicit yes; Cancel sends nothing.
  const added = spaceAdditions();
  const listed = added.length > 8 ? [...added.slice(0, 8), `${added.length - 8} more`] : added;
  if (added.length && !(await askConfirm(`This adds: ${listed.join(', ')}. Save?`, 'Save'))) return;
  const body = spaceBody();
  const save = $('space-save');
  save.disabled = true;
  try {
    await agentRequest(editingSpace ? `/api/workspaces/${encodeURIComponent(editingSpace.id)}` : '/api/workspaces', body);
    spaceEditor.close();
    location.reload();
  } catch (err) {
    showSpaceError(err.message, sectionForServerError(err.message));
  } finally {
    save.disabled = false;
  }
});

$('space-remove').addEventListener('click', async () => {
  if (!editingSpace || !(await askConfirm(`Delete the room ${editingSpace.name}? Its agents stay in your other rooms, and its chats stay saved on this Mac, but you can't open them here any more.`, 'Delete room'))) return;
  try {
    await agentRequest(`/api/workspaces/${encodeURIComponent(editingSpace.id)}/remove`, {});
    spaceEditor.close();
    location.reload();
  } catch (err) {
    spaceError.textContent = err.message;
  }
});

// ---- Frame: theme.json names the product; the HTML defaults stay if it's missing.

(async function applyTheme() {
  try {
    const res = await fetch('theme.json');
    if (!res.ok) return;
    const theme = await res.json();
    const text = (id, v) => { if (typeof v === 'string' && v.trim()) $(id).textContent = v.trim(); };
    text('brand-name', theme.name);
    text('brand-byline', theme.byline);
    if (typeof theme.name === 'string' && theme.name.trim()) document.title = theme.name.trim();
    // Only a plain SVG file next to the page, never a URL.
    if (typeof theme.mark === 'string' && /^[\w-]+\.svg$/.test(theme.mark)) {
      $('brand-mark').src = theme.mark;
      $('brand-icon').href = theme.mark;
    }
  } catch { /* keep the defaults */ }
})();

// ---- Replay the saved conversation on load.

(async function restore() {
  // Names and roles of room-built agents are needed before their cards are replayed.
  await loadAgentList();
  await loadSpaces();
  try {
    const res = await fetch('/api/room');
    const room = await res.json();
    if (typeof room.owner === 'string' && room.owner) ownerName = room.owner;
    if (room.auth === 'api-key') {
      const caps = room.caps || {};
      const money = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'a set amount');
      $('auth-badge').title = `Runs are paid with an Anthropic API key (pay-as-you-go): at most ${money(caps.run)} a run and ${money(caps.day)} a day. Agents can't search Notion or Outlook mail; Notion pages you link in a message are read for them. Start the room with "npm run room" to use your Claude plan.`;
      $('auth-badge').hidden = false;
    }
    if (room.attachments) {
      attachLimits = room.attachments;
      attachInput.accept = attachLimits.extensions.map((e) => `.${e}`).join(',');
    }
    setChats(chatsWide.matches && chatsPref());
    for (const ev of room.events) handle(ev);
    // The room's start-up check found that agents are given files the room means to keep from them (see
    // contextCheck in room-server.js). Said on the page, as nobody watches the terminal the room runs in.
    if (Array.isArray(room.contextLeak) && room.contextLeak.length) {
      appendToThread(el('div', 'notice', `Heads-up: agents in every room are being given ${room.contextLeak.filter((x) => typeof x === 'string').join(' and ')} that were written for Claude Code, not for the room. The switch that keeps them out stopped working, probably after a Claude Code update. Ask Claude Code to look at the room's start-up check.`));
    }
    // The room was set up with a Notion token and could not read it when it started (1Password asks for approval
    // when it is locked, and the room waits a minute). Notion drafts and pages can't be saved until a restart.
    if (room.notionTokenMissing === true) {
      appendToThread(el('div', 'notice', "Heads-up: the room started without its Notion token, because 1Password didn't hand it over in time. Notion drafts and pages can't be saved until the room is restarted and the 1Password prompt is approved. Everything else works."));
    }
    // A finished job with no end event was cut off (the server stopped mid-answer).
    if (turn && !turn.ended) endTurn({ type: 'end', status: 'interrupted' });
    thread.scrollTop = thread.scrollHeight;
    if (room.runningJobId) await attach();
  } catch (err) {
    appendToThread(el('div', 'bubble err', `Couldn't load the conversation: ${err.message}`));
  }
})();
