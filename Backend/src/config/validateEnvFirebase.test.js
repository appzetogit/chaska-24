import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findConfigProblems } from './validateEnv.js';

const dir = mkdtempSync(join(tmpdir(), 'fbenv-'));
const keyFor = (projectId) => {
    const p = join(dir, `${projectId}.json`);
    writeFileSync(p, JSON.stringify({ project_id: projectId }));
    return p;
};

// Only the fields this check reads; the rest of the config is satisfied so the
// assertions speak to the Firebase rule and nothing else.
const base = {
    nodeEnv: 'development',
    databaseUrl: 'postgresql://x',
    jwtAccessSecret: 'a',
    jwtRefreshSecret: 'b',
};

const firebaseProblems = (cfg) =>
    findConfigProblems({ ...base, ...cfg }).filter((p) => p.includes('FIREBASE_PROJECT_ID'));

test('flags a project id that disagrees with the service account', () => {
    const problems = firebaseProblems({
        firebaseProjectId: 'chaska-805bd',
        firebaseServiceAccountPath: keyFor('chaskafoods-8981a'),
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /chaska-805bd.*chaskafoods-8981a/s);
});

test('accepts a project id that agrees', () => {
    assert.deepEqual(firebaseProblems({
        firebaseProjectId: 'chaskafoods-8981a',
        firebaseServiceAccountPath: keyFor('chaskafoods-8981a'),
    }), []);
});

test('accepts the project id being unset', () => {
    assert.deepEqual(firebaseProblems({
        firebaseServiceAccountPath: keyFor('chaskafoods-8981a'),
    }), []);
});

test('reads an inline service account too', () => {
    assert.equal(firebaseProblems({
        firebaseProjectId: 'chaska-805bd',
        firebaseServiceAccount: JSON.stringify({ project_id: 'chaskafoods-8981a' }),
    }).length, 1);
});

test('stays quiet when the key cannot be read', () => {
    assert.deepEqual(firebaseProblems({
        firebaseProjectId: 'chaska-805bd',
        firebaseServiceAccountPath: join(dir, 'does-not-exist.json'),
    }), []);
});
