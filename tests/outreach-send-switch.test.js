// OUTREACH_SEND=off holds all cold email while the pipeline keeps building.
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { console.log(`  FAIL - ${name}`); console.error(e); process.exitCode = 1; } }
const src = fs.readFileSync(new URL("../api/ga-metrics.js", import.meta.url), "utf8");
const fnSrc = src.slice(src.indexOf("function outreachSendOn"), src.indexOf("function outreachSendOn") + 200);
const outreachSendOn = new Function("env", fnSrc.slice(fnSrc.indexOf("{") + 1, fnSrc.indexOf("\n}")));

await test("switch: only 'off' (any case/spaces) stops sends; unset means on", () => {
  assert.equal(outreachSendOn({}), true);
  assert.equal(outreachSendOn({ OUTREACH_SEND: "on" }), true);
  assert.equal(outreachSendOn({ OUTREACH_SEND: "off" }), false);
  assert.equal(outreachSendOn({ OUTREACH_SEND: " OFF " }), false);
});

await test("switch: checked first in send_outreach, before follow-ups or any reservation", () => {
  const send = src.slice(src.indexOf("async function handleSendOutreach"));
  const hold = send.indexOf("if (!outreachSendOn() && req.query.dry_run !== \"1\")");
  assert.ok(hold > 0);
  assert.ok(hold < send.indexOf("sendFollowUpsOnce("));
  assert.ok(hold < send.indexOf('status: "sending"'));
});

console.log(`\n${passed} passed`);
