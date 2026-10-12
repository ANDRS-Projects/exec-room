'use strict';
// Links for an approved email_draft card (issue #45): Outlook web's compose deeplink, mailto and the text for Copy.
// Loaded by room.html before room.js; tests/room_suite.py runs this same file in node's vm.
// Each field is encoded with encodeURIComponent, never URLSearchParams (which writes spaces as "+", and mail apps
// show those literally). Line breaks in the body become CRLF (%0D%0A), as mailto (RFC 6068) asks.
globalThis.EmailLinks = (() => {
  const OUTLOOK_COMPOSE = 'https://outlook.office.com/mail/deeplink/compose';
  // Longer mailto links get cut off or refused by some browsers and mail apps; from this length on, Copy leads.
  const MAILTO_MAX = 1800;
  // Outlook web documents no limit for the compose deeplink, but a link opened without a fresh Outlook session goes
  // through Microsoft's sign-in, which carries the whole link along and refuses a long one ("AADSTS90015: Requested
  // query string is too long"). Measured on 2026-10-12: a link of 2,493 characters got through, one of 2,744 did
  // not. 2000 for the whole URL leaves room for what sign-in adds; a longer link is greyed out and Copy leads.
  const OUTLOOK_MAX = 2000;
  const crlf = (text) => String(text).replace(/\r\n|\r|\n/g, '\r\n');
  const enc = (text) => encodeURIComponent(crlf(text));
  // The server only lets plain addresses through (letters, digits, . _ + - and one @), so the @ can stay readable
  // in the mailto address list; everything else is encoded.
  const addresses = (list, sep) => list.map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(sep);

  function outlookUrl(d) {
    return `${OUTLOOK_COMPOSE}?to=${enc(d.to.join(';'))}&cc=${enc((d.cc || []).join(';'))}&subject=${enc(d.subject)}&body=${enc(d.body)}`;
  }

  function mailtoUrl(d) {
    const cc = d.cc && d.cc.length ? `cc=${addresses(d.cc, ',')}&` : '';
    return `mailto:${addresses(d.to, ',')}?${cc}subject=${enc(d.subject)}&body=${enc(d.body)}`;
  }

  const mailtoFits = (url) => url.length < MAILTO_MAX;
  const outlookFits = (url) => url.length <= OUTLOOK_MAX;
  const copyText = (d) => `${d.subject}\n\n${d.body}`;

  return { MAILTO_MAX, OUTLOOK_MAX, outlookUrl, mailtoUrl, mailtoFits, outlookFits, copyText };
})();
