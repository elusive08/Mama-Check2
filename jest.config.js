export default {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  maxWorkers: 1,
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/config/index.js",
    "!src/jobs/missedVisitTracker.js",
  ],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  testTimeout: 120000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/tests/setup/setup.js"],
  transform: {},
  transformIgnorePatterns: ["node_modules/(?!(bcryptjs|axios)/)"],
  forceExit: true,
  detectOpenHandles: true,
  detectLeaks: false,
  verbose: true,
  bail: false,
};
