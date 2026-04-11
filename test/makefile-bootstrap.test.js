'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.join(__dirname, '..')

function createTempDir(t) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastify-template-makefile-'))

    t.after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true })
    })

    return tempDir
}

function parseEnvFile(filePath) {
    return fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(line => line && !line.startsWith('#'))
        .reduce((env, line) => {
            const separatorIndex = line.indexOf('=')

            if (separatorIndex === -1) {
                return env
            }

            const key = line.slice(0, separatorIndex)
            const value = line.slice(separatorIndex + 1)

            env[key] = value
            return env
        }, {})
}

function runMake(args, options = {}) {
    const result = spawnSync('make', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            ...options.env,
        },
    })

    return {
        ...result,
        output: `${result.stdout}${result.stderr}`,
    }
}

test('make migrate fails fast when ENV_FILE is missing', (t) => {
    const tempDir = createTempDir(t)
    const envFile = path.join(tempDir, 'missing.env')

    const result = runMake([`ENV_FILE=${envFile}`, 'migrate'])

    assert.notStrictEqual(result.status, 0)
    assert.ok(result.output.includes(`${envFile} is missing.`), result.output)
    assert.ok(result.output.includes("Run 'make init-env' to create it"), result.output)
})

test('make init-env creates local defaults once and does not overwrite existing env files', (t) => {
    const tempDir = createTempDir(t)
    const envFile = path.join(tempDir, 'local.env')

    const firstRun = runMake([`ENV_FILE=${envFile}`, 'init-env'])

    assert.strictEqual(firstRun.status, 0, firstRun.output)
    assert.ok(firstRun.output.includes(`Created ${envFile} for local development.`), firstRun.output)

    const createdEnv = parseEnvFile(envFile)

    assert.ok(createdEnv.JWT_SECRET)
    assert.ok(createdEnv.COOKIE_SECRET)
    assert.strictEqual(createdEnv.MONGO_URL, 'mongodb://localhost:27017/note')
    assert.strictEqual(createdEnv.FRONTEND_URL, 'http://localhost:5173')
    assert.strictEqual(createdEnv.LOG_LEVEL, 'info')
    assert.strictEqual(createdEnv.MAIL_FROM, 'no-reply@notes.local')

    const initialContents = fs.readFileSync(envFile, 'utf8')
    const secondRun = runMake([`ENV_FILE=${envFile}`, 'init-env'])

    assert.strictEqual(secondRun.status, 0, secondRun.output)
    assert.ok(secondRun.output.includes(`${envFile} already exists; leaving it unchanged.`), secondRun.output)
    assert.strictEqual(fs.readFileSync(envFile, 'utf8'), initialContents)
})

test('make migrate reports every missing required env variable before running npm', (t) => {
    const tempDir = createTempDir(t)
    const envFile = path.join(tempDir, 'incomplete.env')

    fs.writeFileSync(
        envFile,
        [
            'MONGO_URL=mongodb://localhost:27017/note',
            'FRONTEND_URL=http://localhost:5173',
            'LOG_LEVEL=info',
            'MAIL_FROM=no-reply@notes.local',
            '',
        ].join('\n'),
    )

    const result = runMake([`ENV_FILE=${envFile}`, 'migrate'])

    assert.notStrictEqual(result.status, 0)
    assert.ok(result.output.includes(`Missing required variables in ${envFile}:`), result.output)
    assert.ok(result.output.includes('JWT_SECRET'), result.output)
    assert.ok(result.output.includes('COOKIE_SECRET'), result.output)
})

test('make migrate loads runtime values from the selected env file', (t) => {
    const tempDir = createTempDir(t)
    const envFile = path.join(tempDir, 'runtime.env')
    const binDir = path.join(tempDir, 'bin')
    const npmShim = path.join(binDir, 'npm')

    fs.writeFileSync(
        envFile,
        [
            'JWT_SECRET=test-jwt-secret',
            'COOKIE_SECRET=test-cookie-secret',
            'MONGO_URL=mongodb://localhost:27017/makefile-test',
            'FRONTEND_URL=http://localhost:4317',
            'LOG_LEVEL=warn',
            'MAIL_FROM=dev@notes.local',
            '',
        ].join('\n'),
    )

    fs.mkdirSync(binDir)
    fs.writeFileSync(
        npmShim,
        [
            '#!/bin/sh',
            'printf "ARGV:%s\\n" "$*"',
            'printf "JWT_SECRET:%s\\n" "$JWT_SECRET"',
            'printf "COOKIE_SECRET:%s\\n" "$COOKIE_SECRET"',
            'printf "MONGO_URL:%s\\n" "$MONGO_URL"',
            'printf "FRONTEND_URL:%s\\n" "$FRONTEND_URL"',
            'printf "LOG_LEVEL:%s\\n" "$LOG_LEVEL"',
            'printf "MAIL_FROM:%s\\n" "$MAIL_FROM"',
        ].join('\n'),
        { mode: 0o755 },
    )

    const result = runMake([`ENV_FILE=${envFile}`, 'migrate'], {
        env: {
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        },
    })

    assert.strictEqual(result.status, 0, result.output)
    assert.ok(result.output.includes('ARGV:run migrate'), result.output)
    assert.ok(result.output.includes('JWT_SECRET:test-jwt-secret'), result.output)
    assert.ok(result.output.includes('COOKIE_SECRET:test-cookie-secret'), result.output)
    assert.ok(result.output.includes('MONGO_URL:mongodb://localhost:27017/makefile-test'), result.output)
    assert.ok(result.output.includes('FRONTEND_URL:http://localhost:4317'), result.output)
    assert.ok(result.output.includes('LOG_LEVEL:warn'), result.output)
    assert.ok(result.output.includes('MAIL_FROM:dev@notes.local'), result.output)
})