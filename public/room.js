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

// One collapsed "N tool calls" line per message.
function addTool(holder, name, detail) {
  if (!holder.tools) {
    const details = el('details', 'tools');
    details.append(el('summary'), el('ol'));
    holder.el.appendChild(details);
    holder.tools = { details, count: 0 };
  }
  holder.tools.count += 1;
  holder.tools.details.querySelector('summary').textContent = `${holder.tools.count} tool call${holder.tools.count === 1 ? '' : 's'}`;
  holder.tools.details.querySelector('ol').appendChild(el('li', null, name + (detail ? ' · ' + detail : '')));
}

function addText(holder, text) {
  if (!holder.bubble) {
    if (!text.trim()) return;
    holder.bubble = { el: el('div', 'bubble md'), raw: '', stripRecs: Boolean(holder.isCoen || holder.inline), owner: holder.inline ? nameOf(holder.who) : 'Coen' };
    holder.el.appendChild(holder.bubble.el);
    holder.tools = null;
  }
  holder.bubble.raw += holder.bubble.raw ? text : text.replace(/^\s+/, '');
  renderSoon(holder.bubble);
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
function startTurn(text, auto = false) {
  const userMsg = el('div', auto ? 'msg room' : 'msg user');
  // `auto` is true for Coen's nudge and 'chain' for a chain's next maker.
  userMsg.appendChild(el('div', 'bubble', auto === 'chain' ? `Room: ${text}` : auto ? `Room → Coen: ${text}` : text));
  appendToThread(userMsg);
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
    const msg = { who, cid, status: 'working', inline: true, el: appendToThread(el('div', `msg focus ${who}${BUILT_IN.has(who) ? '' : ' custom'}${toneOf(who)}`)), bubble: null, tools: null };
    const head = el('div', 'focus-head');
    msg.pill = el('span', 'pill working', 'working');
    head.append(avatarFor(who), el('span', 'name', nameOf(who)), el('span', 'via', 'via Coen'), msg.pill);
    msg.el.appendChild(head);
    t.cards.set(cid, msg);
    return;
  }
  if (!t.marker) {
    // Coen's next words come after the marker, in a new message.
    coenMsg = null;
    t.marker = appendToThread(el('button', 'marker'));
    t.marker.type = 'button';
    t.marker.addEventListener('click', () => focusGroup(t));
    t.slot = appendToThread(el('div', 'inline-slot'));
    t.group = el('details', 'group');
    t.group.open = true;
    t.group.appendChild(el('summary', null, `Turn ${t.n} · ${t.text}`));
    t.group.appendChild(el('div', 'cards'));
    groups.push(t);
    placeGroup(t);
  }
  const cls = `card ${who}${MAKERS.has(who) ? ' maker' : ''}${BUILT_IN.has(who) ? '' : ' custom'}${toneOf(who)}`;
  const card = { who, cid, status: 'working', el: el('div', cls), bubble: null, tools: null };
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
  card.pill.className = `pill ${status}`;
  card.pill.textContent = MAKERS.has(card.who) && status === 'replied' ? 'done' : status;
}

function cardFor(ev) {
  if (!turn) return null;
  return turn.cards.get(ev.cid) || [...turn.cards.values()].reverse().find((c) => c.who === ev.who) || null;
}

function endTurn(ev) {
  clearProposalHint();
  if (turn && !turn.ended) {
    turn.ended = true;
    for (const card of turn.cards.values()) {
      if (card.status !== 'working') continue;
      if (ev.status === 'ok') setCardStatus(card, card.bubble ? 'replied' : 'failed');
      else setCardStatus(card, ev.status === 'error' ? 'failed' : ev.status);
    }
    if (turn.marker) updateMarker(turn);
  }
  const parts = [];
  if (ev.turns) parts.push(`${ev.turns} turn${ev.turns === 1 ? '' : 's'}`);
  if (typeof ev.costUsd === 'number' && ev.costUsd > 0) {
    const total = typeof ev.totalCostUsd === 'number' ? ` (chat total ~$${ev.totalCostUsd.toFixed(2)})` : '';
    parts.push(`~$${ev.costUsd.toFixed(3)} equiv.${total}`);
  }
  const label = { stopped: 'Stopped', interrupted: 'Interrupted (the room server stopped)', error: 'Ended with an error' }[ev.status];
  if (label) parts.unshift(label);
  if (parts.length) appendToThread(el('div', label ? 'meta warn' : 'meta', parts.join(' · ')));
  coenMsg = null;
}

function handle(ev) {
  if (ev.type === 'user') {
    startTurn(ev.text, ev.auto || false);
  } else if (ev.type === 'break') {
    if (ev.who === 'coen') coenMsg = null;
    else { const card = cardFor(ev); if (card) { card.bubble = null; card.tools = null; } }
  } else if (ev.type === 'text') {
    if (ev.who === 'coen') addText(ensureCoenMsg(), ev.text);
    else { const card = cardFor(ev); if (card) addText(card, ev.text); }
  } else if (ev.type === 'tool') {
    if (ev.who === 'coen') addTool(ensureCoenMsg(), ev.name, ev.detail);
    else { const card = cardFor(ev); if (card) addTool(card, ev.name, ev.detail); }
  } else if (ev.type === 'recommendation') {
    clearProposalHint();
    coenMsg = null;
    addRecCard(ev.rec);
  } else if (ev.type === 'decision') {
    const entry = recCards.get(ev.recId);
    if (entry) {
      setRecState(entry, ev.decision);
      if (ev.note) entry.status.replaceChildren(el('span', null, 'Your note to Coen: ' + ev.note));
      if (ev.decision === 'approved' && entry.rec.action === 'email_draft') showEmailLinks(entry);
    }
  } else if (ev.type === 'rec_result') {
    showRecResult(ev);
  } else if (ev.type === 'draft') {
    const holder = ev.who === 'coen' ? ensureCoenMsg() : cardFor(ev);
    if (holder) addDraftChip(holder, ev.name);
  } else if (ev.type === 'consult') {
    addConsult(ev.who, ev.cid, ev.prompt || '', Boolean(ev.focus));
  } else if (ev.type === 'consult_done') {
    const card = cardFor(ev);
    if (card) { setCardStatus(card, ev.status || 'replied'); updateMarker(turn); }
  } else if (ev.type === 'notice') {
    appendToThread(el('div', 'notice', ev.text));
  } else if (ev.type === 'error') {
    const card = ev.who !== 'coen' && cardFor(ev);
    if (card) card.el.appendChild(el('div', 'bubble err', ev.error));
    else appendToThread(el('div', 'bubble err', ev.error));
  } else if (ev.type === 'end') {
    endTurn(ev);
  }
}

narrow.addEventListener('change', () => groups.forEach(placeGroup));

// ---- Proposal cards: Coen proposes, the owner approves or asks for a revision, the server acts.

const recCards = new Map();
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
    : rec.action === 'github_comment' ? 'Proposal · GitHub comment' : 'Proposal · GitHub issue';
  head.append(el('span', 'rec-kind', rec.by ? title.replace(/^Proposal/, `Proposal from ${nameOf(rec.by)}`) : title), pill);
  card.append(head, el('p', 'rec-summary', rec.summary));
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
      card.append(
        recField('Send from', rec.from || 'not set: add the consulting address in the room settings'),
        recField('To', (rec.to || []).join(', ')),
      );
      if (rec.cc && rec.cc.length) card.append(recField('Cc', rec.cc.join(', ')));
      const preview = el('details', 'rec-details');
      preview.open = true;
      preview.append(el('summary', null, 'Email text (plain text)'), el('div', 'post-text', rec.body || ''));
      card.append(recField('Subject', rec.subject || ''), preview,
        el('p', 'rec-note', 'Nothing is sent from the room. Approving only records your decision; then you open the draft in Outlook or your mail app and send it yourself.'));
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

  const status = el('div', 'rec-status');
  card.append(actions, form, status);
  appendToThread(card);
  const entry = { rec, el: card, pill, actions, form, status };
  recCards.set(rec.recId, entry);
  setRecState(entry, rec.state || 'pending');

  approve.addEventListener('click', () => decide(entry, 'approve', {}));
  dismiss.addEventListener('click', () => decide(entry, 'dismiss', {}));
  revise.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) note.focus(); });
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
  if (!open) entry.form.hidden = true;
  // A dismissed card folds to its header and summary; this runs live, on replay and for a stored state.
  entry.el.classList.toggle('dismissed', state === 'dismissed');
}

function showRecResult(ev) {
  const entry = recCards.get(ev.recId);
  if (!entry) return;
  setRecState(entry, ev.state);
  entry.status.replaceChildren();
  const isNotionUrl = (u) => /^https:\/\/(app\.notion\.com|www\.notion\.so)\//.test(u || '');
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
  } else if (isNotion || (ev.url && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues\/\d+(#issuecomment-\d+)?|pull\/\d+#issuecomment-\d+)$/.test(ev.url))) {
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
}

// Approved email draft: buttons to open it in Outlook web or the mail app, and Copy. Nothing is sent from the room.
// Each link only when its whole URL is short enough to be carried reliably; otherwise it's greyed out and Copy leads.
function showEmailLinks(entry) {
  const r = entry.rec;
  if (!Array.isArray(r.to) || typeof r.body !== 'string') {
    entry.status.replaceChildren(el('span', null, 'Approved. Nothing was sent from the room. The draft was removed from the room after your decision; to open it again, ask Coen for it again.'));
    return;
  }
  entry.status.replaceChildren(el('span', null, `Approved. Nothing was sent: open the draft and send it yourself${r.from ? ` from ${r.from}` : ''}.`));
  const draft = { to: r.to, cc: r.cc || [], subject: r.subject, body: r.body };
  const copy = el('button', 'ghost', 'Copy');
  copy.type = 'button';
  copy.title = 'Copies the subject and the text';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EmailLinks.copyText(draft));
      copy.textContent = 'Copied';
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
  // A link that's too long becomes a greyed-out button, with the reason next to it.
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
    buttons.append(copy);
    entry.status.append(buttons);
    return;
  }
  const opens = [
    openOr('Open in Outlook web', outlook, EmailLinks.outlookFits(outlook), 'Too long for Outlook web, use Copy'),
    openOr('Open in mail app', mailto, EmailLinks.mailtoFits(mailto), 'Too long for mailto, use Copy'),
  ];
  buttons.append(...(tooLong.length ? [copy, ...opens, ...tooLong] : [...opens, copy]));
  entry.status.append(buttons);
}

async function decide(entry, kind, body) {
  entry.actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const res = await fetch(`/api/recs/${encodeURIComponent(entry.rec.recId)}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      entry.status.replaceChildren(el('span', 'err-text', data.error || `HTTP ${res.status}`));
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
  sendBtn.disabled = busy;
  stopBtn.hidden = !busy;
  coenStatus.hidden = !busy;
}

function growInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
}

async function send() {
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  input.value = '';
  growInput();
  setBusy(true);
  try {
    const res = await fetch('/api/coen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      appendToThread(el('div', 'bubble err', data.error || `HTTP ${res.status}`));
      input.value = text;
      setBusy(false);
      return;
    }
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
    input.value = text;
    setBusy(false);
    return;
  }
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
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'end') ended = true;
        if (ev.type === 'followup') followup = true;
        handle(ev);
      }
    }
  } catch (err) {
    appendToThread(el('div', 'bubble err', err.message));
  } finally {
    if (!ended) appendToThread(el('div', 'notice', 'Lost the connection to the room while Coen was working. Reload to catch up.'));
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

document.querySelectorAll('.chip[data-who]').forEach((chip) => {
  chip.addEventListener('click', () => setRail(!layout.classList.contains('rail-open')));
});

$('reset').addEventListener('click', async () => {
  const res = await fetch('/api/coen/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    appendToThread(el('div', 'bubble err', data.error || `HTTP ${res.status}`));
    return;
  }
  const empty = el('div', 'empty', 'Fresh chat. Coen has forgotten the previous conversation.');
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
});

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

// What the build form preselected for a new agent: only an avatar the owner changed is passed on to Coen as their choice.
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

setInterval(() => { if (!document.hidden) refreshWorking(); }, 10000);

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
  b.setAttribute('role', 'menuitem');
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

// Tabs: General / Can use / Can propose. Roving tabindex; Left/Right (wrapping), Home and End move between them.
const spaceTabs = [...spaceEditor.querySelectorAll('[role="tab"]')];

function selectSpaceTab(tab, focus) {
  for (const t of spaceTabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
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
    for (const ev of room.events) handle(ev);
    // A finished job with no end event was cut off (the server stopped mid-answer).
    if (turn && !turn.ended) endTurn({ type: 'end', status: 'interrupted' });
    thread.scrollTop = thread.scrollHeight;
    if (room.runningJobId) await attach();
  } catch (err) {
    appendToThread(el('div', 'bubble err', `Couldn't load the conversation: ${err.message}`));
  }
})();
