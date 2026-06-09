# MamaCheck CI/CD Pipeline - Setup & Configuration Guide

## Overview

The updated CI/CD pipeline includes **11 stages** with enhanced SonarQube integration and PRD compliance verification:

1. **Validate & Lint** - Code quality checks
2. **Security Scan & SonarQube** - Security scanning + code quality analysis
3. **PRD Compliance Check** - Verify all PRD requirements are met
4. **Test Suite** - Unit and integration tests with coverage
5. **Build** - Application build and artifact creation
6. **Deploy to Staging** - Automated staging deployment
7. **Integration Tests (Staging)** - Run tests on staging environment
8. **Performance Tests** - Performance benchmarking
9. **Deploy to Production** - Automated production deployment with rollback
10. **Production Monitoring** - Health checks on production
11. **Generate Report** - Complete CI/CD report with SonarQube & PRD status

---

## GitHub Secrets Configuration

### Required for SonarQube Integration

Add these secrets to your GitHub repository settings:

```
SONAR_TOKEN          - Get from https://sonarcloud.io
SONAR_ORGANIZATION   - Your SonarCloud organization key
```

### Required for Deployment

```
STAGING_SERVER_HOST     - Staging server IP/domain
STAGING_SERVER_USER     - SSH username for staging
STAGING_SERVER_SSH_KEY  - Private SSH key for staging
PRODUCTION_SERVER_HOST  - Production server IP/domain
PRODUCTION_SERVER_USER  - SSH username for production
PRODUCTION_SERVER_SSH_KEY - Private SSH key for production
SLACK_WEBHOOK_URL       - Slack webhook for notifications (optional)
```

---

## SonarQube Setup

### 1. Create SonarCloud Project

- Visit https://sonarcloud.io
- Create new organization (if not exists)
- Create new project: `mama-check-backend`
- Note your Organization Key and Project Key

### 2. Generate Token

- Settings → Security → Generate token
- Copy and add as `SONAR_TOKEN` GitHub secret

### 3. SonarQube Quality Gate

The pipeline includes a SonarQube scan with:

- **Minimum test coverage**: 70% (lines coverage)
- **Exclusions**: `node_modules/`, `tests/`, `*.test.js`
- **LCOV report integration**: Coverage from Jest tests
- **Quality gates**: Enforced on PR/merge

---

## PRD Compliance Verification

The pipeline automatically verifies:

### ✓ Core Modules

- [x] **Module 1**: Onboarding & Pregnancy Timeline
  - OTP verification
  - Gestational age calculation
  - Multi-language support

- [x] **Module 2**: ANC Reminder Engine
  - Daily reminders at 07:00 WAT
  - Follow-up reminders (7 days)
  - Message templating

- [x] **Module 3**: Danger Sign Checker
  - 8-point symptom checker
  - Color-coded triage (RED/YELLOW/GREEN)
  - Real-time alerts

- [x] **Module 4**: CHEW Dashboard
  - Performance metrics
  - Pregnancy tracking
  - Activity logs

### ✓ Security Requirements

- Bcrypt password hashing (10 rounds)
- JWT authentication
- Role-Based Access Control (RBAC)
- Rate limiting on all endpoints
- Input validation

### ✓ Multi-language Support

- English, Pidgin, Yoruba, Hausa, Igbo

---

## Pipeline Triggers

### Automatic Triggers

- **Push to `main`** → Runs full pipeline + deploys to production
- **Push to `staging`** → Runs full pipeline + deploys to staging
- **Pull Request to `main`/`staging`** → Runs validation, security, tests only

### Manual Trigger

- Use GitHub Actions "Run workflow" to manually trigger any branch

---

## Test Coverage Requirements

The pipeline enforces **minimum 70% line coverage**:

```bash
# Run locally to check coverage
npm run test:coverage

# View coverage report
open coverage/lcov-report/index.html
```

### Coverage Targets by Type

- **Lines**: ≥ 70%
- **Branches**: ≥ 65%
- **Functions**: ≥ 70%
- **Statements**: ≥ 70%

---

## Deployment Strategy

### Staging Deployment

1. Build artifact created
2. Copied to staging server via SCP
3. Dependencies installed fresh (`npm ci --only=production`)
4. Migrations run (if any)
5. PM2 restart server
6. Health check waits for 5 attempts

### Production Deployment

1. **Prerequisite**: Staging tests pass successfully
2. Timestamped backup created
3. Graceful PM2 stop
4. Code updated
5. Dependencies installed fresh
6. Database migrations run
7. PM2 restart with production environment
8. **Health checks**: 10 attempts with 5s intervals
9. **Automatic Rollback**: If health checks fail
   - Restores latest backup
   - Restarts from backup
   - Keeps last 5 backups

---

## Monitoring & Notifications

### SonarQube Dashboard

After each build, check code quality at:

- https://sonarcloud.io/project/overview?id=mama-check-backend

### Codecov Coverage Reports

- Uploaded after each test run
- Track coverage trends over time
- View at: https://codecov.io

### Slack Notifications (Optional)

- Staging deployment status
- Production deployment status
- Build failures/successes

---

## Common Issues & Troubleshooting

### Issue: "SonarQube scan fails"

**Solution**:

- Verify `SONAR_TOKEN` is valid in GitHub secrets
- Check that `sonar-project.properties` exists in repo root

### Issue: "Tests fail due to MongoDB connection"

**Solution**:

- MongoDB service runs automatically in test stage
- Wait time is configurable in pipeline
- Increase if needed: `--health-timeout 10s`

### Issue: "Deployment fails, rollback initiated"

**Solution**:

- Check SSH key access to server
- Verify PM2 is installed on server: `pm2 -v`
- Check backup exists: `cd /opt/mamacheck-backend/backups && ls -la`

### Issue: "Rate limit coverage threshold not met"

**Solution**:

```bash
# Increase test coverage
npm run test:coverage

# Update threshold in ci-cd.yml if needed
# Current threshold: 70% (THRESHOLD=70)
```

---

## Local Testing

### Test Pipeline Locally

```bash
# Run full test suite
npm run test

# With coverage
npm run test:coverage

# Integration tests only
npm run test:integration

# Performance tests
npm run test:performance
```

### Lint & Format

```bash
# Check linting
npm run lint

# Format code
npm run format

# Check formatting without modifying
npm run format:check
```

---

## Performance & Optimization

### Pipeline Execution Time

- **Validate & Lint**: ~2-3 min
- **Security & SonarQube**: ~5-7 min
- **PRD Compliance**: ~1-2 min
- **Tests**: ~10-15 min
- **Build**: ~2-3 min
- **Staging Deployment**: ~3-5 min
- **Production Deployment**: ~5-7 min

**Total average**: ~30-40 minutes

### Optimization Tips

- Parallel jobs reduce overall time
- Caching speeds up dependency installation
- Use `needs:` to control job dependencies
- Matrix strategy tests multiple Node versions in parallel

---

## Additional Resources

- **GitHub Actions Documentation**: https://docs.github.com/en/actions
- **SonarCloud Setup**: https://sonarcloud.io/
- **Jest Testing**: https://jestjs.io/docs/getting-started
- **PM2 Deployment**: https://pm2.keymetrics.io/docs/usage/deployment/
