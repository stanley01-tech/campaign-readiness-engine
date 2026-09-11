// ============================================
// CAMPAIGN LAUNCH READINESS ENGINE
// Runs inside an n8n Code node, right after SPF and DMARC DNS lookups
// have been merged together. Classifies a draft campaign against a
// pre-flight checklist and builds the prompt for the AI narrator step.
// ============================================

const config = {
  spam_trigger_words: ["free", "act now", "limited time", "click here", "guarantee", "no cost", "urgent", "risk-free", "100% free", "winner", "cash bonus"],
  max_subject_length: 60,
  min_subject_length: 10
};

const dnsResults = items.map(i => i.json);
const spfResult = dnsResults.find(r => r.Question && !r.Question[0].name.startsWith('_dmarc'));
const dmarcResult = dnsResults.find(r => r.Question && r.Question[0].name.startsWith('_dmarc'));

const spfRecord = (spfResult?.Answer || []).find(a => a.data && a.data.startsWith('v=spf1'));
const dmarcRecord = (dmarcResult?.Answer || []).find(a => a.data && a.data.startsWith('v=DMARC1'));

// Pulled back from the Normalize Domain node, since the DNS lookups
// themselves don't carry the original campaign copy forward
const campaign = $('Normalize Domain').item.json;
const subject = campaign.subject_line || '';
const body = campaign.email_body || '';

const checks = [];

checks.push({
  check: 'SPF Record',
  status: spfRecord ? 'PASS' : 'FAIL',
  detail: spfRecord ? spfRecord.data : 'No SPF record found on sending domain'
});

checks.push({
  check: 'DMARC Record',
  status: dmarcRecord ? 'PASS' : 'FAIL',
  detail: dmarcRecord ? dmarcRecord.data : 'No DMARC record found on sending domain'
});

// Note: DKIM is intentionally out of scope. It requires knowing the
// sender's specific DKIM selector, which varies by provider and can't
// be reliably guessed from the outside, unlike SPF and DMARC, which
// both live at fixed, well-known DNS locations.

const hasUnsubscribe = /unsubscribe/i.test(body);
checks.push({
  check: 'Unsubscribe Link',
  status: hasUnsubscribe ? 'PASS' : 'FAIL',
  detail: hasUnsubscribe ? 'Unsubscribe language found' : 'No unsubscribe language found in body'
});

const bodyLower = (subject + ' ' + body).toLowerCase();
const foundTriggers = config.spam_trigger_words.filter(w => bodyLower.includes(w));
checks.push({
  check: 'Spam Trigger Words',
  status: foundTriggers.length === 0 ? 'PASS' : 'NEEDS_REVIEW',
  detail: foundTriggers.length ? `Found: ${foundTriggers.join(', ')}` : 'No common spam trigger phrases found'
});

const unfilledTags = (subject + ' ' + body).match(/\{\{.*?\}\}|\[\[.*?\]\]/g) || [];
checks.push({
  check: 'Unfilled Personalization Tags',
  status: unfilledTags.length === 0 ? 'PASS' : 'FAIL',
  detail: unfilledTags.length ? `Found: ${unfilledTags.join(', ')}` : 'No unfilled merge tags found'
});

const subjOk = subject.length >= config.min_subject_length && subject.length <= config.max_subject_length;
checks.push({
  check: 'Subject Line Length',
  status: subjOk ? 'PASS' : 'NEEDS_REVIEW',
  detail: `${subject.length} characters (recommended ${config.min_subject_length}-${config.max_subject_length})`
});

const failCount = checks.filter(c => c.status === 'FAIL').length;
const reviewCount = checks.filter(c => c.status === 'NEEDS_REVIEW').length;
const overallStatus = failCount > 0 ? 'BLOCKED' : (reviewCount > 0 ? 'NEEDS_REVIEW' : 'READY_TO_LAUNCH');

const summary = {
  overall_status: overallStatus,
  total_checks: checks.length,
  passed: checks.filter(c => c.status === 'PASS').length,
  failed: failCount,
  needs_review: reviewCount,
  sending_domain: campaign.sending_domain,
  subject_line: subject
};

// Prompt for the AI narrator step (sent to Groq's openai/gpt-oss-120b in the next node)
const promptText = `You are a GTM operations analyst reviewing a draft cold outreach campaign before it launches. Given this pre-flight check data, write a short, direct verdict: overall status, which checks failed or need review, and the specific fix needed for each one. If everything passed, say so clearly and confirm it's ready to launch. Under 150 words, no fluff.

Campaign: "${summary.subject_line}" (sending domain: ${summary.sending_domain})
Overall status: ${summary.overall_status}
Checks: ${summary.passed} passed, ${summary.failed} failed, ${summary.needs_review} need review

Check Results:
${checks.map(c => `- ${c.check}: ${c.status} — ${c.detail}`).join('\n')}

Write the verdict now.`;

const groqRequest = JSON.stringify({
  model: "openai/gpt-oss-120b",
  messages: [{ role: "user", content: promptText }],
  max_tokens: 800,
  temperature: 0.3,
  reasoning_effort: "low"
});

return [{ json: { summary, checks, prompt: promptText, groqRequest } }];
