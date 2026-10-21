const test = require('node:test');
const assert = require('node:assert/strict');
const FolderModel = require('../folder-model.js');

const project = (name, num) => ({
    name,
    id: 'g-p-' + String(num).padStart(8, '0'),
    url: 'https://chatgpt.com/g/g-p-' + num + '/project'
});
const projects = [
    project('AI', 1),
    project('AI - SGLang', 2),
    project('AI - SGLang - Scheduler', 3),
    project('AI - SGLang - KV', 4),
    project('AI - vLLM', 5),
    project('Infra - Modelexpress', 6),
    project('Standalone', 7)
];

test('A folder backed by a native Project is rendered exactly once', () => {
    const tree = FolderModel.build(projects);
    assert.equal(tree.filter(x => x.path === 'AI').length, 1);
    assert.equal(tree.filter(x => x.path === 'AI - SGLang').length, 1);
    assert.equal(tree.find(x => x.path === 'AI').id, projects[0].id);
    assert.equal(tree.find(x => x.path === 'AI - SGLang').isFolder, true);
    assert.equal(tree.find(x => x.path === 'AI - SGLang - Scheduler').isFolder, false);
    assert.equal(tree.some(x => x.path === 'Standalone'), false);
});

test('Move replaces only the original parent prefix for every descendant', () => {
    const move = FolderModel.planMove(projects, 'AI - SGLang', 'Infra');
    assert.equal(move.destination, 'Infra - SGLang');
    assert.deepEqual(move.changes.map(c => [c.oldName, c.newName]), [
        ['AI - SGLang', 'Infra - SGLang'],
        ['AI - SGLang - Scheduler', 'Infra - SGLang - Scheduler'],
        ['AI - SGLang - KV', 'Infra - SGLang - KV']
    ]);
});

test('Drop on the category header moves a folder to root', () => {
    const move = FolderModel.planMove(projects, 'AI - SGLang', '');
    assert.equal(move.destination, 'SGLang');
    assert.equal(move.changes.length, 3);
});

test('Move cannot target self, a descendant, or its current parent', () => {
    assert.throws(() => FolderModel.planMove(projects, 'AI - SGLang', 'AI - SGLang'));
    assert.throws(() => FolderModel.planMove(projects, 'AI', 'AI - SGLang'));
    assert.throws(() => FolderModel.planMove(projects, 'AI - SGLang', 'AI'));
});

test('Move rejects collisions and incomplete native Project IDs', () => {
    assert.throws(() => FolderModel.planMove([
        ...projects, project('Infra - SGLang', 8)
    ], 'AI - SGLang', 'Infra'), /同名/);
    assert.throws(() => FolderModel.planMove([
        ...projects, { name: 'AI - SGLang - Unsafe', id: null }
    ], 'AI - SGLang', 'Infra'), /ID/);
});

test('Path matching is segment-based rather than string prefix-based', () => {
    const other = [...projects, project('AI - SGLang2', 20)];
    const move = FolderModel.planMove(other, 'AI - SGLang', 'Infra');
    assert.equal(move.changes.some(c => c.oldName === 'AI - SGLang2'), false);
});
