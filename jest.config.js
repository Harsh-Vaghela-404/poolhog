export default {
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^(\\..*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  }
}