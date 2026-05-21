# MamaCheck API Quick Start Guide

## 🌐 Accessing the API

### Swagger UI (Interactive Documentation)

```
http://localhost:3000/docs
```

- Click "Try it out" on any endpoint
- Auto-generated code samples (cURL, Python, JavaScript)
- Schema validation in real-time

### Base URL

```
http://localhost:3000/api/v1    (Development)
https://api.staging.ng          (Staging)
https://api.mamacheck.ng        (Production)
```

---

## 🔑 Authentication

### 1. Login with Phone & Password

```bash
POST /auth/login
{
  "phone": "08012345678",
  "password": "securePassword123"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Abubakar Jambai",
    "role": "chew"
  }
}
```

### 2. Use Token in Requests

```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# All authenticated endpoints require this header
GET /pregnancies/chew/{chewId}
Authorization: Bearer {token}
```

### 3. OTP-Based Authentication (Alternative)

```bash
# Request OTP
POST /auth/request-otp
{ "phone": "08012345678" }

# Verify OTP
POST /auth/verify-otp
{
  "phone": "08012345678",
  "otp": "123456"
}
```

---

## 👩‍⚕️ CHEW Registration Flow (Backend/Mobile)

### Step 1: Request OTP

```bash
POST /auth/request-otp
Body: { "phone": "08012345678" }
Response: { "message": "OTP sent successfully" }
```

### Step 2: Verify OTP & Register Pregnancy

```bash
POST /pregnancies/register
{
  "womanDetails": {
    "name": "Hauwa Ibrahim",
    "phone": "09012345678",
    "preferredLanguage": "ha"  // English, Pidgin, Yoruba, Hausa, Igbo
  },
  "lmp": "2025-09-18",           // Last Menstrual Period
  "clinicName": "Ungwan Rimi PHC",
  "chewId": "64f8a3b2c1d2e3f4g5h6i7j8",
  "otp": "123456",
  "trustedContact": {
    "name": "Musa Ibrahim",
    "phone": "08012345670",
    "relationship": "husband"
  }
}

Response:
{
  "success": true,
  "pregnancyId": "507f1f77bcf86cd799439012",
  "message": "Pregnancy registered successfully"
}
```

---

## 📞 SMS Triage Workflow (Mobile Devs)

### How Women Respond

Women receive SMS reminder:

```
Hi Hauwa! How are you feeling today?
Reply:
0 = No symptoms
1 = Heavy bleeding
2 = Severe headache
3 = Swollen face/hands
4 = Blurry vision
5 = Fever
6 = Reduced baby movement
7 = Severe abdominal pain
8 = Convulsion
STOP = Opt out
```

### Webhook: Incoming SMS

```bash
POST /webhook/termii/sms
{
  "from": "09012345678",
  "text": "1,2",              // Comma-separated symptoms
  "message_id": "termii123"
}

Response:
{
  "success": true,
  "status": "processed",
  "triage": "RED",           // RED, YELLOW, or GREEN
  "reportId": "507f1f77bcf86cd799439013"
}
```

### Test SMS (Development)

```bash
POST /webhook/simulate-sms
{
  "from": "09012345678",
  "text": "1,2"   // Simulates woman texting symptoms
}
```

### Test STOP Keyword

```bash
POST /webhook/simulate-sms
{
  "from": "09012345678",
  "text": "STOP"
}

Response:
{
  "success": true,
  "status": "opt_out_processed"
}
```

---

## 📋 Pregnancy Management (Backend/Frontend)

### Register Pregnancy

```bash
POST /pregnancies/register
(See section above)
```

### Get All Pregnancies for CHEW

```bash
GET /pregnancies/chew/{chewId}
Authorization: Bearer {token}

Response: [
  {
    "_id": "507f1f77bcf86cd799439012",
    "womanId": {...},
    "gestationalWeek": 28,
    "status": "active",
    "edd": "2026-01-15",
    "ancVisits": [...]
  }
]
```

### Get Specific Pregnancy

```bash
GET /pregnancies/{pregnancyId}
Authorization: Bearer {token}
```

### Mark ANC Visit Attended

```bash
POST /pregnancies/{pregnancyId}/attended
Authorization: Bearer {token}
{
  "milestoneNumber": 6,    // FMOH milestone 1-8
  "visitDate": "2025-12-18"
}
```

### Undo Visit Attendance (10-Minute Window)

```bash
POST /pregnancies/{pregnancyId}/attended/undo
Authorization: Bearer {token}
{
  "milestoneNumber": 6,
  "reason": "Marked by mistake"
}

Response:
{
  "success": true,
  "message": "Attendance undone successfully"
}
```

### Get Attendance History

```bash
GET /pregnancies/{pregnancyId}/attendance-history
Authorization: Bearer {token}

Response: [
  {
    "visitWeek": 6,
    "action": "marked_attended",  // marked_attended, undone, unmarked
    "markedAt": "2025-12-18T10:00:00Z",
    "canUndo": true,
    "undoWindowExpires": "2025-12-18T10:10:00Z"
  }
]
```

---

## 📊 CHEW Dashboard (Frontend)

### Dashboard Overview

```bash
GET /dashboard/chew/overview
Authorization: Bearer {token}

Response:
{
  "summary": {
    "totalWomen": 45,
    "activePregnancies": 43,
    "highRiskWomen": 3,
    "dueThisWeek": 7,
    "overdueVisits": 2,
    "redFlagsToday": 1,
    "redFlagsThisWeek": 4,
    "averageResponseTime": 45  // minutes
  }
}
```

### Get Women Registry

```bash
GET /dashboard/chew/women?page=1&limit=20
Authorization: Bearer {token}

Response:
{
  "total": 45,
  "page": 1,
  "women": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Hauwa Ibrahim",
      "gestationalWeek": 28,
      "nextANCDue": "2025-12-25",
      "redFlagStatus": false
    }
  ]
}
```

### Get RED Flags (Critical Cases)

```bash
GET /dashboard/chew/red-flags
Authorization: Bearer {token}

Response: [
  {
    "_id": "507f1f77bcf86cd799439013",
    "reportedSymptoms": [1, 2],  // Heavy bleeding, Severe headache
    "triageOutcome": "RED",
    "timestamp": "2025-12-18T14:30:00Z",
    "requiresFollowup": true,
    "followup": {
      "status": "pending",
      "outcome": "phone_contact"
    }
  }
]
```

### Get Weekly Summary

```bash
GET /dashboard/chew/weekly-summary
Authorization: Bearer {token}

Response:
{
  "totalWomen": 45,
  "dueThisWeek": 7,
  "missedVisits": 2,
  "openRedFlags": 4,
  "weekStartDate": "2025-12-15",
  "weekEndDate": "2025-12-21"
}
```

---

## 🗺️ Reference Data - Location Lookup (Frontend/Mobile)

### Get All States

```bash
GET /reference/states
# No auth required

Response:
{
  "states": ["Kaduna", "Lagos", "Kano", "Katsina", ...]
}
```

### Get LGAs by State

```bash
GET /reference/lgas/state/Kaduna
# No auth required

Response: [
  {
    "_id": "507f1f77bcf86cd799439014",
    "name": "Kaduna North",
    "state": "Kaduna",
    "code": "KD001"
  }
]
```

### Get PHCs by LGA

```bash
GET /reference/phcs/lga/Kaduna%20North
# No auth required

Response: [
  {
    "_id": "507f1f77bcf86cd799439015",
    "name": "Ungwan Rimi Primary Healthcare Center",
    "lga": "Kaduna North",
    "state": "Kaduna",
    "address": "Ungwan Rimi, Kaduna North",
    "contactName": "Nurse Mary",
    "contactPhone": "08012345678",
    "coordinates": {
      "latitude": 10.5244,
      "longitude": 7.4392
    }
  }
]
```

### Find Nearest PHC (Geolocation)

```bash
GET /reference/phcs/nearest?latitude=10.5244&longitude=7.4392&maxDistance=5000
# No auth required, distance in meters

Response:
{
  "_id": "507f1f77bcf86cd799439015",
  "name": "Ungwan Rimi PHC",
  "distance": 320,  // meters
  "address": "Ungwan Rimi, Kaduna North"
}
```

---

## 🛠️ Error Handling

### Common Error Responses

**401 - Unauthorized (Missing/Invalid Token)**

```json
{
  "success": false,
  "message": "Not authenticated",
  "error": "invalid_token"
}
```

**403 - Forbidden (Insufficient Role)**

```json
{
  "success": false,
  "message": "Insufficient permissions",
  "error": "role_required",
  "requiredRole": "chew"
}
```

**404 - Not Found**

```json
{
  "success": false,
  "message": "Pregnancy not found",
  "error": "not_found"
}
```

**400 - Bad Request (Validation Error)**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "phone": "Invalid phone format",
    "otp": "OTP must be 6 digits"
  }
}
```

**429 - Rate Limited**

```json
{
  "success": false,
  "message": "Too many requests",
  "retryAfter": 60 // seconds
}
```

---

## 🧪 Testing with Postman/cURL

### Import Swagger

1. Go to http://localhost:3000/docs
2. Copy swagger.yaml URL
3. In Postman: File → Import → Paste URL

### Quick Test: Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "08012345678",
    "password": "test123"
  }'
```

### Quick Test: Get Women Registry

```bash
curl -X GET "http://localhost:3000/api/v1/dashboard/chew/women?page=1&limit=5" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Quick Test: Find Nearest PHC

```bash
curl -X GET "http://localhost:3000/api/v1/reference/phcs/nearest?latitude=6.5244&longitude=3.3792&maxDistance=5000"
```

---

## 📱 Mobile App Integration

### Required Endpoints

1. **Login** - Auth
2. **Request OTP** - Phone verification
3. **Register Pregnancy** - Woman registration
4. **Webhook: Incoming SMS** - Handle triage responses
5. **Test SMS** - Dev/testing

### Recommended Endpoints

1. **Dashboard Overview** - Real-time KPIs
2. **Women Registry** - Case management
3. **RED Flags** - Urgent alerts
4. **Reference Data** - Location/PHC lookup
5. **Attendance Undo** - Correction capability

### Error Codes to Handle

- 401: Re-prompt login
- 429: Show "Too many requests, try again in 60s"
- 5xx: Show "Service unavailable, try again later"

---

## 🔒 Security Notes

- **Never** store tokens in local storage on mobile
- Use secure storage (Keychain iOS, Keystore Android)
- **Always** validate phone numbers client-side before submission
- **Always** pass tokens in Authorization header, never in URL
- Implement token refresh before expiration
- Validate SMS content before sending (rate limit client-side)

---

## 📧 Support Channels

| Issue                   | Contact                 |
| ----------------------- | ----------------------- |
| API Documentation       | Check Swagger at /docs  |
| Authentication Problems | Support team            |
| Data Issues             | Database team           |
| SMS Not Working         | Termii integration team |
| Slack Alerts            | DevOps team             |

---

**Last Updated**: May 18, 2026  
**API Version**: 1.0.0  
**Status**: Production Ready
