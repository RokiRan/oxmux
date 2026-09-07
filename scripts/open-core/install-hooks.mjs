#!/usr/bin/env node
// [INPUT]: current Git worktree
// [OUTPUT]: repository-local hooks enabled

import { execFileSync } from 'node:child_process'

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
console.log('Installed Oxmux Open Core hooks at .githooks')
