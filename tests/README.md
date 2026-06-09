# 🧪 MamaCheck Test Suite

Comprehensive test suite for MamaCheck backend covering unit tests, integration tests, and service tests.

---

## 📁 Test Structure

```
tests/
├── fixtures/                    # Test data and mock objects
├── integration/                 # Integration tests
│   └── auth.integration.test.js # Auth flow & API integration tests
├── unit/                        # Unit tests
│   ├── api.test.js             # API endpoints & health checks
│   ├── middleware.test.js      # Error handling & request tracking
│   ├── triageService.test.js   # Triage service classification
│   ├── utils.test.js           # Utilities & validators
│   └── envValidator.test.js    # Environment validation
├── setup.js                     # Jest configuration & setup
└── README.md                    # This file
```

---

## 🚀 Running Tests

### Run all tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm test -- --watch
```

### Run specific test file

```bash
npm test -- tests/unit/api.test.js
```

### Run tests with coverage

```bash
npm test -- --coverage
```

### Run integration tests only

```bash
npm test -- tests/integration/
```

### Run unit tests only

```bash
npm test -- tests/unit/
```

---

## 📋 Test Coverage

### Unit Tests

#### `api.test.js`

- Health endpoint returns correct status
- API info endpoint functionality
- 404 error handling
- Security headers validation
- Request ID tracking

#### `triageService.test.js`

- RED symptom classification (heavy bleeding, convulsion, severe headache)
- YELLOW symptom classification (fever, discharge, edema)
- GREEN (no symptoms) classification
- Symptom priority handling (RED > YELLOW > GREEN)
- Emergency detection
- Risk scoring
- Facility referral recommendations

#### `utils.test.js`

- Phone number validation (Nigerian format)
- Email validation
- Pregnancy date validation
- Parity/Gravida validation
- Language mapping
- Gestational age calculations
- Trimester determination

#### `middleware.test.js`

- AppError creation and handling
- Request ID generation
- Request ID reuse from headers
- Request logging middleware
- Response duration tracking

#### `envValidator.test.js`

- Required variable validation
- JWT_SECRET strength checking
- Environment-specific warnings
- Sensitive value masking
- Missing variable handling

### Integration Tests

#### `auth.integration.test.js`

- OTP generation and validation
- OTP expiration (5 minutes)
- Failed attempt tracking (max 3)
- User registration data validation
- JWT token issuance
- Token refresh mechanism
- Pregnancy registration
- ANC milestone setup
- Gestational age calculation
- ANC visit tracking
- Missed visit alerts
- Symptom reporting
- CHEW dashboard statistics

---

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)

- Node test environment
- ES modules support
- Test timeout: 10 seconds
- Coverage collection from src/
- Test files: `tests/**/*.test.js`

### Setup File (`tests/setup.js`)

- Load test environment variables
- Set NODE_ENV to 'test'
- Configure test database connection
- Configure test Redis connection
- Suppress console logs during tests

---

## 📝 Writing New Tests

### Basic Test Structure

```javascript
import { describe, test, expect } from "@jest/globals";

describe("Feature Name", () => {
  test("should do something specific", () => {
    // Arrange
    const input = "test";

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe("expected");
  });
});
```

### Testing Async Code

```javascript
test("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Using Mocks

```javascript
import { vi } from "vitest";

test("should call mock function", () => {
  const mockFn = vi.fn();
  mockFn("test");

  expect(mockFn).toHaveBeenCalledWith("test");
});
```

### Using beforeEach/afterEach

```javascript
beforeEach(() => {
  // Setup before each test
});

afterEach(() => {
  // Cleanup after each test
});
```

---

## 🎯 Coverage Goals

| Category   | Target | Status         |
| ---------- | ------ | -------------- |
| Statements | 80%+   | 📊 In Progress |
| Branches   | 75%+   | 📊 In Progress |
| Functions  | 80%+   | 📊 In Progress |
| Lines      | 80%+   | 📊 In Progress |

### Generate Coverage Report

```bash
npm test -- --coverage --coverageReporters=html
# Opens coverage/index.html in browser
```

---

## 🐛 Debugging Tests

### Run single test with debugging

```bash
node --inspect-brk node_modules/.bin/jest --runInBand tests/unit/api.test.js
```

### View detailed error output

```bash
npm test -- --verbose
```

### Run tests silently (errors only)

```bash
npm test -- --silent
```

---

## 📚 Test Categories

### ✅ Passing Tests

- API health checks
- Error handling
- Request ID generation
- Triage service classification
- Environment validation

### ⏳ Tests to Add

- Authentication endpoints
- Pregnancy CRUD operations
- CHEW dashboard operations
- Messaging service
- Scheduler operations
- Database model validation

### 🔄 Integration Tests to Expand

- Full authentication flow
- Database operations
- External API calls (Termii, Groq)
- Webhook handling

---

## 🔐 Testing Best Practices

1. **Isolation**: Each test is independent
2. **Clarity**: Test names describe what they test
3. **Coverage**: Test both happy and sad paths
4. **Mocking**: Mock external dependencies
5. **Setup/Teardown**: Clean environment before/after
6. **Assertions**: Clear, specific assertions
7. **DRY**: Use helper functions to reduce duplication

---

## 🚨 Common Issues

### Tests Failing Due to Missing Env Vars

```bash
# Create .env.test file
cp .env.example .env.test
```

### Module Not Found Errors

- Ensure ES6 imports have `.js` extensions
- Check import paths are correct
- Verify package.json has `"type": "module"`

### Timeout Issues

Increase timeout in jest.config.js or specific test:

```javascript
test("long running test", async () => {
  // test code
}, 30000); // 30 second timeout
```

---

## 📊 Test Results

Run tests and view results:

```bash
npm test 2>&1 | tee test-results.txt
```

---

## 🔗 Related Documentation

- [Production Deployment](../PRODUCTION_DEPLOYMENT.md)
- [ES6 Module Migration](../ES6_MODULE_MIGRATION.md)
- [Production Fixes Summary](../PRODUCTION_FIXES_SUMMARY.md)

---

## 👥 Contributing Tests

When adding new features:

1. Write tests first (TDD approach)
2. Ensure tests pass before committing
3. Maintain or improve coverage percentage
4. Follow existing test patterns
5. Document complex test scenarios

---

## 🎓 Resources

- [Jest Documentation](https://jestjs.io/)
- [Testing Best Practices](https://jestjs.io/docs/getting-started)
- [Supertest for API Testing](https://github.com/visionmedia/supertest)
