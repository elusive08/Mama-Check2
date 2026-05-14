# 🤰 MamaCheck — Antenatal Care Companion

A lightweight, SMS-first antenatal care companion designed for pregnant women in rural and semi-urban communities in Nigeria. **No app installation. No internet required. Works on any mobile phone.**

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Goals & Metrics](#goals--metrics)
4. [Core Features](#core-features)
5. [User Stories](#user-stories)
6. [System Architecture](#system-architecture)
7. [Pregnancy Timeline & Warning Signs](#pregnancy-timeline--warning-signs)

---

## Problem Statement

Pregnant women in many rural and semi-urban communities in Nigeria are dying from **preventable pregnancy complications** because warning signs are not identified early enough.

**Key challenges:**

- ⏱️ Delays in recognising symptoms
- 🚗 Delays in deciding to seek care and reaching healthcare facilities
- 📋 Community Health Extension Workers (CHEWs) using paper records lack real-time visibility into patients' conditions
- 📱 Women miss antenatal visits with no way to be reminded
- 🌐 Existing systems (paper registers, generic SMS, community sensitisation) fail to provide:
  - Personalised support
  - Timely interventions
  - Language-accessible guidance
  - Actionable data between clinic visits

**Result:** A dangerous gap between symptom recognition and medical intervention leaves thousands of preventable maternal deaths each year.

---

## Solution Overview

### What MamaCheck Is

MamaCheck is a **timely information and escalation tool** that sits between a pregnant woman and her Primary Healthcare Centre, closing the recognition-to-action gap.

**Key characteristics:**

- ✅ **SMS-first** — works on any phone (smartphone or feature phone)
- ✅ **No app installation required**
- ✅ **No reliable internet needed**
- ✅ **Multilingual** — English, Pidgin, Yoruba, Hausa, Igbo
- ✅ **Not a telemedicine platform**
- ✅ **Not an electronic medical record**
- ✅ **Not a clinical diagnosis tool**

### What MamaCheck Does

The product operates across two interfaces:

| Interface             | Users            | Function                                                       |
| --------------------- | ---------------- | -------------------------------------------------------------- |
| **Outbound SMS**      | Pregnant women   | Reminders, symptom check-ins, triage outcomes, warnings        |
| **Browser Dashboard** | CHEWs / Midwives | Registry view, ANC tracker, red-flag alerts, follow-up logging |

Both surfaces connect via a shared backend that:

- Tracks each woman's pregnancy timeline
- Queues and sends personalized reminders
- Processes symptom reports in real time
- Surfaces risk signals to the CHEW immediately

---

## Goals & Metrics

### Primary Goal

**Increase ANC visit completion** among registered women

| Metric                                                                       | Target                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| Percentage of registered women attending 6+ of 8 recommended FMOH ANC visits | **≥ 60%** by end of pilot (baseline ~20%) |

### Secondary Goals

**Danger sign response rate** — Indicates the checker is being used at the moment it matters

| Metric                                                                    | Target                  |
| ------------------------------------------------------------------------- | ----------------------- |
| % of Red-flag danger signs with documented CHEW follow-up within 24 hours | **≥ 50%** within 7 days |

**Reminder engagement rate** — Indicates messages are reaching women and prompting action

| Metric                                                                                 | Target                  |
| -------------------------------------------------------------------------------------- | ----------------------- |
| % of ANC reminders delivered AND resulting in clinic attendance or checker interaction | **≥ 50%** within 7 days |

### Guardrail Metric ⚠️

**Do not generate clinical false confidence**

| Metric                                                             | Target                    |
| ------------------------------------------------------------------ | ------------------------- |
| % of Red-flag symptom combinations correctly routed to RED outcome | **100% — zero tolerance** |

This is a **patient safety requirement**, not a product metric miss. Any failure is a clinical incident.

---

## Core Features

### Module 1: Onboarding & Pregnancy Timeline

**CHEW registers a pregnant woman** using a mobile browser form.

**Registration collects:**

- Full name
- Nigerian mobile phone number
- Last Menstrual Period (LMP) or Expected Delivery Date (EDD)
- Local Government Area (LGA)
- Preferred language (English, Pidgin, Yoruba, Hausa, Igbo)
- Nearest PHC / clinic
- Emergency contact (optional) — name, phone, language preference

**From LMP or back-calculated LMP:**

- System constructs a **full pregnancy timeline**
- Maps each woman to **Nigeria's Federal Ministry of Health 8-visit ANC protocol**
- Timeline drives every reminder and visit-tracking event

**Registration time:** Under 4 minutes on 3G connection

**Edge cases handled:**

- No network on CHEW's device → records cached in browser, synced when online
- Wrong phone number → OTP verification before confirmation

---

### Module 2: ANC Reminder Engine

**Daily scheduled job** runs at **07:00 West Africa Time**.

**Workflow:**

1. System calculates current gestational week for every active woman
2. When a woman enters the **first day of an FMOH milestone visit window**, a personalized SMS is queued
3. **Woman's SMS** includes: name, approximate week, registered clinic name, attendance prompt
4. **Trusted contact SMS** (if registered) sent same day — respectfully phrased, asking support with transport/time
5. If visit not marked attended within **7 days**, a **single follow-up reminder** is sent
6. Window then closes; missed visit reflected on CHEW dashboard in real time

**Why trusted contacts?** Health decisions in many Nigerian households require family consensus, not just individual intent.

---

### Module 3: Danger Sign Checker

**Every 7 days** (weeks 8–40), each registered woman receives a **weekly symptom check-in SMS** in her chosen language.

**Message format:**

```
Reply with the NUMBER of any symptom you are experiencing, or 0 if well:

1. Heavy bleeding
2. Severe headache
3. Swollen face or hand
4. Blurry vision
5. Fever
6. Reduced baby movement
7. Severe abdominal pain
8. Convulsion
0. None - I am fine
```

#### Triage Rules

| Reply | Symptoms              | Outcome       | Instructions                    |
| ----- | --------------------- | ------------- | ------------------------------- |
| 1     | Heavy bleeding        | **RED** 🔴    | Go to facility now              |
| 2     | Severe headache       | **YELLOW** 🟡 | Visit clinic within 24 hrs      |
| 3     | Swollen face or hand  | **YELLOW** 🟡 | Visit clinic within 24 hrs      |
| 4     | Blurry vision         | **YELLOW** 🟡 | Visit clinic within 24 hrs      |
| 5     | Fever                 | **YELLOW** 🟡 | Visit clinic within 24 hrs      |
| 6     | Reduced baby movement | **YELLOW** 🟡 | Visit clinic within 24 hrs      |
| 7     | Severe abdominal pain | **RED** 🔴    | Go to facility now              |
| 8     | Convulsion            | **RED** 🔴    | Go to facility now              |
| 0     | None - I am fine      | **GREEN** 🟢  | Rest well. Next reminder coming |

**Decision logic:** Apply highest-severity rule when multiple symptoms reported.

- **Any reply containing 1, 7, or 8 → RED** (regardless of other replies)

**Response timing:**

- Triage SMS sent to woman **within 30 seconds**
- If RED: Alert SMS sent to CHEW **within 60 seconds**
- Alert SMS sent to trusted contact **within 60 seconds**

**Every response includes:** A plain-language disclaimer stating MamaCheck is a safety guide, not a doctor.

---

### Module 4: CHEW Dashboard

**Mobile-responsive web application** — no installation required. Works on Android browser, shared clinic tablet, or desktop.

**Login:** Username and password (role-based access control)

**View shows:** Only women registered under the CHEW's PHC

#### Five Functional Views

| View                   | What It Shows                                                                                                  | What CHEW Can Do                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Women Registry**     | Full list of registered women: gestational week, next ANC due date, red-flag status (sortable by week)         | Primary navigation surface; tap to drill into details             |
| **ANC Tracker**        | Women due for visit this week; women who missed last scheduled visit                                           | Tap "Mark as Attended" after visit confirmation                   |
| **Red Flag Alert**     | All women who triggered RED in last 7 days: symptom reported, date, follow-up status (OPEN / CLOSED / RE-OPEN) | Select one of four follow-up outcomes to close case               |
| **Weekly Summary**     | Single-number overview: total registered, due this week, missed visits, open red flags                         | For CHEW reporting upward to SPHCDA supervisor                    |
| **Register New Woman** | Step-by-step registration wizard                                                                               | Primary onboarding channel — CHEW registers women on their behalf |

---

## User Stories

### Epic: Registration & Onboarding

#### Story 1: Enroll Pregnant Woman into System

**User Story:**  
_As a CHEW, I want to enroll a pregnant woman into the system, so that she can be monitored through MamaCheck._

**Required Details:**

1. Name
2. Address
3. Preferred Language
4. Phone Number
5. LGA
6. PHC
7. Assigned CHEW/Midwife
8. Emergency Contact Name
9. Emergency Contact Number
10. Emergency Contact Preferred Language

**Acceptance Criteria:**

- All required details saved to database
- Woman listed in registry
- Woman receives SMS notifications

**Edge Cases:**

- No network on CHEW's device → cache records locally, sync when online
- Woman provides wrong number → OTP sent to woman for verification before saving

**Flow:**

1. Nurse clicks "Enroll New Mama"
2. Registration form loads
3. Nurse inputs all details
4. Nurse clicks "Confirm Phone Number"
5. Mother receives OTP via SMS
6. Nurse inputs OTP into system
7. Nurse clicks "Confirm & Submit"
8. Mama enrolled and stored in database
9. Mama receives welcome message

---

#### Story 2: Onboarding SMS Confirmation

**User Story:**  
_As a pregnant woman just registered, I want an SMS in my language saying I'm on MamaCheck and how to opt out, so I know the messages are real and I consent._

**Acceptance Criteria:**

- SMS sent **within 2 minutes** of registration
- SMS states: service name, what messages to expect, "Reply STOP to opt out"
- Delivery logged; consent recorded

**Edge Cases:**

- Wrong number → OTP verification
- No network → queue SMS
- Duplicate registration → prompt CHEW

**Flow:**

- CHEW submits form → system saves → send OTP or onboarding SMS → log delivery → update consent

---

### Epic: ANC Reminder Engine

#### Story 3: Calculate Gestational Week & Queue Reminder

**User Story:**  
_As the scheduling system, I want to compute weeks from LMP/EDD daily and queue reminders automatically, so reminders are timely without manual work._

**Acceptance Criteria:**

- Week calculated daily for active women
- If week matches FMOH milestone, reminder queued with correct template and language
- Missing or conflicting dates flagged

**Edge Cases:**

- Missing dates → flag CHEW
- Conflicting dates → flag CHEW
- Late registration → follow catch-up policy

**Flow:**

- Nightly job → compute week → match schedule → queue message or flag

---

#### Story 4: Personalised ANC Visit Reminder

**User Story:**  
_As a pregnant woman at week 24, I want an SMS with my name, weeks, and clinic, so my family can help me attend._

**Acceptance Criteria:**

- Message includes name, weeks pregnant, PHC in chosen language
- Trusted contact message sent same day
- Delivery logged; opt-outs respected

**Edge Cases:**

- PHC missing → use "your clinic"
- Phone unreachable → retry and log
- Opted out → cancel send

---

#### Story 5: Trusted Contact Support Reminder

**User Story:**  
_As a trusted contact, I want a short SMS asking me to help with transport/time, so the visit becomes a shared family decision._

**Acceptance Criteria:**

- Companion SMS sent same day in woman's language
- Includes woman's name and clinic
- Delivery logged; opt-outs respected

**Edge Cases:**

- No trusted contact → skip
- Same number as woman → skip duplicate
- Wrong number → CHEW can update

---

### Epic: Danger Sign Checker

#### Story 6: Weekly Symptom Check-in SMS

**User Story:**  
_As a pregnant woman with symptoms, I want a simple numbered SMS to reply with, so I can report problems easily._

**Acceptance Criteria:**

- Weekly check SMS sent in chosen language
- Lists numbers 1–8 and 0 for "none" with clear reply instructions
- Numeric replies accepted and timestamped

**Edge Cases:**

- Text replies → ask to reply with numbers
- No reply → one reminder then flag
- Free text asking for help → route to CHEW

---

#### Story 7: Triage Outcome Returned Immediately

**User Story:**  
_As a woman who replied, I want an immediate message saying Green/Yellow/Red and what to do next._

**Acceptance Criteria:**

- Outcome returned **within 30 seconds**
- Any reply containing 1, 7, or 8 → **RED**
- RED triggers CHEW alert **within 60 seconds**

**Edge Cases:**

- Non-numeric or ambiguous replies → clarify or escalate
- Duplicate replies → use latest
- Processing delays → log and notify CHEW

---

#### Story 8: Non-Diagnostic Disclaimer Appended

**User Story:**  
_As a woman reading the response, I want a clear line saying MamaCheck is a guide not a doctor, so I don't delay care._

**Acceptance Criteria:**

- Disclaimer appended in chosen language to every outcome message
- Templates versioned and editable

**Edge Cases:**

- Character limit → shorten disclaimer and log
- Missing translation → default to English and flag

---

### Epic: CHEW Dashboard & Follow-up

#### Story 9: CHEW Views Caseload Table

**User Story:**  
_As a CHEW, I want a quick table of my women and their status, so I can review my caseload fast._

**Acceptance Criteria:**

- Table shows: name, phone, gestational week, next visit, red-flag badge
- Loads quickly on Android browser
- Supports offline cache

**Edge Cases:**

- Large caseload → pagination
- No network → show cached data

---

#### Story 10: CHEW Receives RED Alert SMS

**User Story:**  
_As a CHEW, I want an SMS with the woman's name, symptoms, and number when RED occurs, so I can act fast._

**Acceptance Criteria:**

- Alert sent **within 60 seconds** of RED
- Includes: name, week, symptoms, phone
- Delivery logged; case opened on dashboard

**Edge Cases:**

- CHEW unreachable → retry then escalate to supervisor
- CHEW on leave → send to backup

---

#### Story 11: Trusted Contact RED Alert

**User Story:**  
_As a trusted contact, I want an urgent SMS when the woman I support has a RED alert, so I can help get her to the clinic immediately._

**Acceptance Criteria:**

- Urgent SMS sent to trusted contact **within 60 seconds** of RED triage
- SMS includes: woman's name, brief symptom summary, instruction to get to facility now, CHEW phone number
- If delivery fails: retry twice, log failure for CHEW follow-up
- If no trusted contact recorded: skip send, log absence for CHEW action
- Trusted contact opt-out is respected

**Edge Cases:**

- No trusted contact → skip; flag for CHEW to call family
- Trusted contact = woman's number → skip duplicate; rely on woman SMS and CHEW alert
- Wrong trusted contact number → retries fail; log for CHEW to update
- Trusted contact opted out → do not send; notify CHEW
- Multiple trusted contacts → send to primary only

---

#### Story 12: CHEW Records Follow-up Outcome

**User Story:**  
_As a CHEW who followed up, I want to log the outcome (phone call, clinic visit, referral, unable to reach) so the case is closed and reported._

**Acceptance Criteria:**

- CHEW can select outcome and save with timestamp
- Case status updates and is removed from open list
- Entries are append-only for audit trail

**Edge Cases:**

- Offline save → queue and sync
- Duplicate entries → prevent duplicates
- Later updates → allow new entry

**Possible Outcomes:**

- ☎️ Contacted by phone
- 🏥 Woman attended clinic
- 🚑 Referred to specialist / hospital
- ❌ Unable to reach

---

#### Story 13: CHEW Marks ANC Visit Attended

**User Story:**  
_As a CHEW whose woman attended, I want to tap "Mark as Attended" so reminders stop and the record moves to the next milestone._

**Acceptance Criteria:**

- Tap logs attendance with date
- Cancels reminders for that milestone
- Record advances to next FMOH milestone
- Undo available within short window

**Edge Cases:**

- Offline action → queue and sync
- Attended at another facility → add facility note
- Accidental tap → undo within 10 minutes

---

## Core Workflow Summary

The thirteen stories trace one complete **end-to-end path:**

```
Register → Remind → Check Symptoms → Triage → Alert CHEW & Trusted Family → Follow Up → Record Outcome
```

Every story connects directly to:

- **Primary success metric** (ANC visit completion)
- **Secondary metrics** (danger sign response rate, reminder engagement)
- **Guardrail metric** (zero Red-flag under-triage)

---

## System Architecture

### Modular Design

Each functional concern is an **independent, replaceable module** that communicates over defined interfaces. Components can be swapped or scaled independently without affecting the rest of the system.

| Layer                 | Technology                          | Responsibility                                                                                                                                                                                         |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Frontend**          | Next.js / React (mobile responsive) | Registration wizard, women registry, ANC tracker, red flag view, weekly summary. Served over HTTPS. No app install required.                                                                           |
| **Backend API**       | Express.js / Node.js + Swagger      | Registration logic, duplicate detection, inbound SMS webhook handler, triage logic, outbound message queue writer, role-based access control. All endpoints documented via Swagger (OpenAPI).          |
| **Database**          | MongoDB                             | Collections: users, pregnancies, anc_visits, message_templates, message_queue, danger_reports, chew_profiles, system_events. Document-oriented storage for flexible schema.                            |
| **Scheduler**         | Cron Job                            | Daily 07:00 WAT: recalculates gestational weeks, queues milestone reminders, queues weekly check-ins, flags missed visits.                                                                             |
| **Messaging Gateway** | Termii (Transactional Route)        | Outbound SMS to women and CHEWs. DND-compliant transactional route. MamaCheck Sender ID. Delivery receipts logged.                                                                                     |
| **AI Layer**          | Groq API                            | Generates warm, non-alarming triage response language and CHEW follow-up checklists. Low-latency inference. Does not perform medical diagnosis. All outputs pass through fixed triage decision matrix. |
| **Monitoring**        | Slack                               | Alerts for: cron job failures, CRITICAL RED-flag SMS delivery failures, low Termii wallet balance. Engineering on-call notified within 5 minutes.                                                      |

### Non-Goals

MamaCheck will **NOT:**

- Provide live medical consultation, clinical diagnosis, or prescriptions
- Replace the PHC's paper ANC register or integrate with government HMIS in MVP
- Be distributed via Google Play Store or Apple App Store
- Support private hospital or private clinic workflows
- Require smartphone ownership or mobile data for core functionality
- Integrate USSD in this version (architecture does not foreclose it)
- Ingest, sync, or query external patient data sources
- Send promotional or marketing messages (all messages are transactional health communications)

---

## Pregnancy Timeline & Warning Signs

### Common Pregnancy Symptoms by Trimester

#### First Trimester (Weeks 1–12)

**Normal symptoms:**

- Missed period
- Nausea / vomiting (morning sickness)
- Breast tenderness
- Tiredness
- Mood swings
- Frequent urination

**⚠️ Warning Signs — Seek Urgent Medical Care:**

- Heavy bleeding
- Severe abdominal pain
- Fainting
- Severe vomiting with dehydration
- Fever

---

#### Second Trimester (Weeks 13–27)

**Normal symptoms:**

- Increased appetite
- Reduced nausea
- Fetal movements felt
- Backache
- Skin pigmentation changes

**⚠️ Warning Signs — Seek Urgent Medical Care:**

- Vaginal bleeding
- Severe swelling (face, hands, or feet)
- Severe headache
- Blurred vision
- Leaking fluid
- Painful contractions before 37 weeks

---

#### Third Trimester (Weeks 28–40)

**Normal symptoms:**

- Shortness of breath
- Leg cramps
- Swollen feet (moderate)
- Pelvic pressure
- Braxton Hicks contractions

**⚠️ Warning Signs — Seek Urgent Medical Care:**

- Heavy bleeding
- Severe headache or convulsions
- Water breaks with green or foul-smelling fluid
- Strong regular contractions too early
- Decreased fetal movements

---

#### Signs of Labor

- Mucus plug discharge
- Regular contractions
- Water breaking
- Lower back pain
- Baby "dropping"

---

### Nigeria FMOH ANC Appointment Schedule

All pregnant women should follow this visit schedule:

| Gestational Age       | Visit Frequency | Notes                                 |
| --------------------- | --------------- | ------------------------------------- |
| **4–28 weeks**        | Every 4–6 weeks | Monthly to bi-weekly                  |
| **28–36 weeks**       | Every 2 weeks   | Fortnightly                           |
| **36 weeks–delivery** | Weekly          | Until labour begins                   |
| **≥40 weeks**         | Every 2–3 days  | Until spontaneous labour or induction |

**Target for MamaCheck:** Women completing **6 of 8 recommended visits** ≥ 60% by end of pilot.

---

## Compliance & Safety

### SMS Compliance

- All messages sent via **Termii transactional SMS route** (bypasses NCC Do Not Disturb registry)
- **MamaCheck Sender ID** registered with NCC before go-live
- Explicit SMS consent obtained during registration
- Users can opt out by replying **STOP**

### Clinical Safety

- **Zero tolerance for under-triage** of Red-flag symptoms
- 100% accuracy required: Red-flag symptom combinations (severe headache + swelling, heavy bleeding, convulsions) must always route to RED outcome
- All Red-flag combinations validated against **WHO and FMOH obstetric emergency criteria** before go-live
- Plain-language disclaimer on every triage response: _"MamaCheck is a safety guide, not a doctor. Always follow your health worker's advice."_

### Data Privacy

- All data stored securely in MongoDB
- Role-based access control on dashboard
- Audit trail for all follow-up outcomes
- Sensitive information (phone numbers, symptoms) handled per Nigerian data protection standards

---

## Getting Started

### For CHEWs / Midwives

1. Access the dashboard via any web browser (no app install)
2. Log in with username and password
3. Click "Register New Woman" to begin enrolling pregnant women
4. Monitor reminders, track ANC visits, and respond to red-flag alerts

### For Pregnant Women

1. Be registered by your CHEW at the Primary Healthcare Centre
2. Receive SMS reminders in your chosen language (English, Pidgin, Yoruba, Hausa, Igbo)
3. Reply to weekly symptom check-ins with numbers corresponding to any symptoms
4. Receive immediate triage guidance and your CHEW's support

### For Supervisors / Program Managers

1. Monitor engagement via CHEW dashboard weekly summary
2. Track ANC completion rates and response to danger signs
3. Ensure Termii SMS balance is maintained
4. Review Slack alerts for system health

---

## Support

For issues, questions, or feedback, contact the MamaCheck development team or your SPHCDA supervisor.

---

**Last Updated:** May 2026  
**Status:** MVP Product Requirements  
**Pilot Target:** Rural and semi-urban PHCs across Nigeria
