// The page a "Connect" sign-in comes back to: says how it went, in the words the server chose. The
// message is set as text, never as markup.
const q = new URLSearchParams(location.search);
const ok = q.get('result') === 'ok';
document.getElementById('mcp-return-title').textContent = ok ? 'Signed in' : 'Not signed in';
document.getElementById('mcp-return-message').textContent = q.get('message') || (ok ? 'You can close this tab.' : 'Something went wrong. Nothing was changed.');
document.body.classList.add(ok ? 'ok' : 'bad');
