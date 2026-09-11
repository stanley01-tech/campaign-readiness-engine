# Campaign Launch Readiness Engine

A working proof-of-concept for **the Channel Activation Ladder**, a framework on how multi-channel GTM tools can cut time-to-first-campaign without growing CSM headcount. This is Rung 3 of that ladder built for real: a config-driven pre-flight check that verifies a draft cold outreach campaign is actually safe to launch, using live DNS verification, not just string matching.

## Why this exists

Email deliverability and compliance checks today usually live as three or four separate tools, a spam checker, a warmup service, a DKIM/SPF verifier, that a customer has to already know exist before they know to run them. That fragmentation is exactly the kind of onboarding friction that gets solved with a CSM manually walking someone through it, over and over, for every new customer. This engine unifies those checks into a single automated pre-flight pass, no human required, before a campaign goes out.

## How it works

```
[Form Trigger: submit draft campaign]
        │
        ▼
[Normalize Domain]
        │
        ├──→ [SPF Lookup]  ─┐
        │                    ├→ [Merge] → [Pre-Flight Rule Engine] → [AI Narrator (Groq)] ─┬──→ [Form: Show Verdict]
        └──→ [DMARC Lookup] ─┘                                                              │
                                                                                              └──→ [Build CSV Row] → [Convert to File] → [Append to Audit Log]
```

1. **Submit** — a real form takes a subject line, email body, and sending domain.
2. **Normalize** — the sending domain is cleaned of protocol, `www`, and trailing paths, so a pasted URL and a bare domain both work.
3. **DNS verification** — real DNS-over-HTTPS lookups (Google's public resolver) check whether the sending domain actually has SPF and DMARC records configured, live infrastructure checks, not assumptions.
4. **Pre-Flight Rule Engine** (`pre-flight-rule-engine.js`) — a config object defines what counts as launch-ready: SPF and DMARC present, an unsubscribe path in the copy, no common spam-trigger phrasing, no unfilled personalization tags, a sane subject line length. Every campaign comes out as `READY_TO_LAUNCH`, `NEEDS_REVIEW`, or `BLOCKED`.
5. **AI Narrator** — the check results are sent to an LLM (Groq, `openai/gpt-oss-120b`), which writes a short, direct verdict: overall status, and the specific fix needed for anything that failed.
6. **Delivery** — the verdict is shown instantly back on the form's completion screen, and every run is also appended to `readiness_log.csv` for a historical record.

## The config

```javascript
{
  spam_trigger_words: ["free", "act now", "limited time", "click here", ...],
  max_subject_length: 60,
  min_subject_length: 10
}
```

## A scoping note on DKIM

Real email authentication has three legs: SPF, DKIM, and DMARC. This engine checks SPF and DMARC, both of which live at fixed, well-known DNS locations and can be verified with zero guessing. DKIM requires knowing the sender's specific DKIM selector, which varies by provider and can't be reliably inferred from the outside. Rather than faking a check that wouldn't actually work, DKIM is explicitly out of scope here.

## Repo contents

```
campaign-readiness-engine/
├── README.md
├── pre-flight-rule-engine.js   # the Pre-Flight Rule Engine Code node, standalone and commented
├── channel-activation-ladder.md   # the framework write-up this build proves out
└── sample-output/
    └── readiness_log_sample.csv
```

## Tech stack

- **n8n** (self-hosted, local) — workflow orchestration, with a real submission form (n8n Form Trigger)
- **Google Public DNS-over-HTTPS API** — live SPF and DMARC verification
- **JavaScript** — the rule engine, run in n8n's Code node
- **Groq API** (`openai/gpt-oss-120b`) — AI-generated launch verdicts

## Running it yourself

1. Install n8n locally: `npx n8n`
2. Rebuild the workflow shown above, using `pre-flight-rule-engine.js` for the Pre-Flight Rule Engine node.
3. Get a free Groq API key at console.groq.com for the AI Narrator step.

## Sample output

> **Overall Status: BLOCKED**
>
> **Failed Checks**
> - Unsubscribe Link – No unsubscribe language in the email body. Fix: add a clear, compliant unsubscribe statement with a functional link.
>
> **Checks Needing Review**
> - Subject Line Length – Current length is too short. Fix: expand the subject to fall within the recommended range.
>
> All other checks (SPF, DMARC, Spam Trigger Words, Unfilled Personalization Tags) passed. Resolve the items above before re-running the pre-flight.

---

Built as a portfolio project proving out the Channel Activation Ladder framework with a real, working automated check, not just a diagram.
