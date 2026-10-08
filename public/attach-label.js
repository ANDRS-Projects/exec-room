'use strict';
// How attached files are named in the chat: the size next to a picked file, and the "Attached: …" line under a
// message. Loaded by room.html before room.js; tests/room_suite.py runs this same file in node's vm.
// Chats saved before attachments have no `files` on their messages, and an entry may lack a size: those show
// nothing, or the name alone, never "NaN MB".
globalThis.AttachLabel = (() => {
  const fileSize = (n) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const line = (files) => {
    if (!Array.isArray(files)) return '';
    const parts = files.filter((f) => f && typeof f.name === 'string' && f.name)
      .map((f) => (Number.isFinite(f.size) ? `${f.name} (${fileSize(f.size)})` : f.name));
    return parts.length ? `Attached: ${parts.join(', ')}` : '';
  };
  return { fileSize, line };
})();
