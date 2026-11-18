// Lets `bun test` run the test files that need no engine, to measure coverage.
// `claude plugin test` is the real runner, and it reports no coverage.
import { expect, mock, test } from 'bun:test'

mock.module('claude-code/testing', () => ({ expect, test }))
