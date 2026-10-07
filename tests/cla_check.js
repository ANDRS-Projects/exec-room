// Runs the script inside a CLA workflow file against made-up pull requests, with the GitHub API faked.
// Used by room_suite.py: node tests/cla_check.js <path to cla.yml> '<JSON list of cases>'
// A case: { name, opener, base: logins signed on the base branch (or [login, version]; null = no file),
//           files: what the pull request changes, commits: author logins (null = email not linked), count }.
// Prints { name: "pass…" | "FAIL: …" } as JSON. Nothing is sent anywhere.
import fs from 'node:fs';

// The script is the indented block under "script: |".
const yml = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const at = yml.findIndex((l) => /^\s*script: \|$/.test(l));
const indent = yml[at + 1].match(/^ */)[0].length;
const body = [];
for (const l of yml.slice(at + 1)) {
  if (l.trim() && l.match(/^ */)[0].length < indent) break;
  body.push(l.slice(indent));
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('github', 'context', 'core', body.join('\n'));

const signature = (login, version = 1) => `- @${login}, 2026-11-20: I have read the Contributor License Agreement (version ${version}) and I agree to it.`;

(async () => {
  const results = {};
  for (const c of JSON.parse(process.argv[3])) {
    const listFiles = () => {};
    const listCommits = () => {};
    const github = {
      paginate: async (fn) => (fn === listFiles
        ? c.files || []
        : (c.commits || [c.opener]).map((login, i) => ({ sha: `${i}abcdef0123`, author: login ? { login } : null }))),
      rest: {
        pulls: { listFiles, listCommits },
        repos: {
          getContent: async () => {
            if (c.base === null) throw Object.assign(new Error('Not Found'), { status: 404 });
            const text = ['# Signatures', '', ...(c.base || []).map((s) => signature(...[].concat(s)))].join('\n') + '\n';
            return { data: { content: Buffer.from(text).toString('base64') } };
          },
        },
      },
    };
    const context = {
      repo: { owner: 'owner', repo: 'repo' },
      payload: { pull_request: { number: 7, commits: c.count || 1, user: { login: c.opener }, base: { ref: 'main' } } },
    };
    let result = 'pass';
    const core = {
      // Today's date is in the message; replaced so the snapshot doesn't change daily.
      setFailed: (m) => { result = `FAIL: ${m.replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/\n+ */g, ' | ')}`; },
      info: (m) => { result = `pass: ${m}`; },
    };
    await run(github, context, core);
    results[c.name] = result;
  }
  console.log(JSON.stringify(results));
})();
