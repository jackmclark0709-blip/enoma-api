import assert from "node:assert/strict";
import { parseFeedback, feedbackLinks, MAX_COMMENT } from "../api/_lib/feedback.js";

const ID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

// preview poll
{
  const r = parseFeedback({ source: "preview_poll", answer: "No", slug: "bobs-plumbing", comment: "  needs   photos " });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "insert");
  assert.equal(r.row.answer, "no");
  assert.equal(r.row.comment, "needs photos");
  assert.equal(r.row.outreach_message_id, null);
}
assert.equal(parseFeedback({ source: "preview_poll", answer: "yes" }).error, "missing_slug");
assert.equal(parseFeedback({ source: "preview_poll", answer: "up", slug: "x" }).error, "bad_answer");
assert.equal(parseFeedback({ source: "preview_poll", answer: "yes", slug: "../etc" }).error, "bad_slug");

// email vote
{
  const r = parseFeedback({ source: "email_vote", answer: "down", m: ID.toUpperCase() });
  assert.equal(r.ok, true);
  assert.equal(r.row.outreach_message_id, ID);
  assert.equal(r.row.slug, null);
}
assert.equal(parseFeedback({ source: "email_vote", answer: "up" }).error, "missing_message_id");
assert.equal(parseFeedback({ source: "email_vote", answer: "up", m: "not-a-uuid" }).error, "bad_message_id");
assert.equal(parseFeedback({ source: "survey", answer: "up" }).error, "bad_source");
assert.equal(parseFeedback(null).error, "bad_source");

// follow-up comment
{
  const r = parseFeedback({ feedback_id: ID, comment: "x".repeat(MAX_COMMENT + 50) });
  assert.equal(r.kind, "comment");
  assert.equal(r.comment.length, MAX_COMMENT);
}
assert.equal(parseFeedback({ feedback_id: ID, comment: "   " }).error, "empty_comment");
assert.equal(parseFeedback({ feedback_id: "1; drop", comment: "hi" }).error, "bad_feedback_id");

// links
assert.deepEqual(feedbackLinks(ID), {
  up: `https://enoma.io/feedback?m=${ID}&v=up`,
  down: `https://enoma.io/feedback?m=${ID}&v=down`
});

console.log("feedback tests passed");
