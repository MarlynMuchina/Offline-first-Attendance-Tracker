export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Goal 5: the offline and sync logic in src/lib must stay at 80% or more
  collectCoverageFrom: ['src/lib/**/*.js', '!src/lib/**/*.test.js'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
