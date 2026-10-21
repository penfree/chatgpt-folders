const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const sourceClass = source.slice(0, source.lastIndexOf('\n(async () => {'));

function element(tag, className = '', text = '') {
    const node = {
        tagName: tag.toUpperCase(), className, textContent: text,
        parentElement: null, parentNode: null, children: [],
        classList: {
            contains(name) { return className.split(/\s+/).includes(name); }
        },
        get childElementCount() { return this.children.length; },
        getBoundingClientRect() { return { left: 0, width: 260, height: 650 }; },
        getAttribute() { return ''; },
        closest() { return null; },
        querySelectorAll() { return []; },
        append(...children) {
            for (const child of children) {
                this.children.push(child);
                child.parentElement = this;
                child.parentNode = this;
            }
        }
    };
    return node;
}

function createFixture(sectionClass = 'relative px-row-x group/nav-section') {
    const aside = element('aside');
    const sidebarList = element('div', 'sidebar-content');
    const nativeSection = element('section', sectionClass);
    const nativeBody = element('div', 'group/nav-section flex flex-col');
    // From the user's live Chrome DOM inspection:
    const nativeTitleRow = element('div',
        'group/nav-section-title flex min-h-[var(--height-token-row)] items-center justify-between gap-2 ps-2');
    const titleWrapper = element('div', 'min-w-0 flex-1 text-base font-medium text-tertiary browser:leading-4.5');
    const flex = element('div', 'flex min-w-0 flex-1');
    const nativeButton = element('button', 'group/section-toggle -ms-1 flex min-w-0 flex-1 items-center');
    const label = element('span', 'min-w-0 truncate', '项目');
    const actions = element('div', 'flex');
    const plus = element('button', 'project-plus');
    const more = element('button', 'project-more');
    nativeButton.append(label);
    flex.append(nativeButton);
    titleWrapper.append(flex);
    actions.append(plus, more);
    nativeTitleRow.append(titleWrapper, actions);
    nativeBody.append(nativeTitleRow);
    nativeSection.append(nativeBody);
    sidebarList.append(nativeSection);
    aside.append(sidebarList);
    aside.querySelectorAll = () => [label];
    const document = {
        querySelectorAll: () => [aside]
    };
    const Extension = vm.runInNewContext(sourceClass + '\nExtension;', {
        document,
        window: { innerWidth: 1200 },
        sessionStorage: { getItem: () => null },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        console
    });
    return { Extension, aside, sidebarList, nativeSection, nativeTitleRow,
        label, nativeButton, plus, more };
}

test('custom folder section is mounted BEFORE the complete native Project section', () => {
    const { Extension, sidebarList, nativeSection, nativeTitleRow,
        nativeButton, plus, more } = createFixture();
    const mount = new Extension().findFolderMount();
    assert.equal(mount.parent, sidebarList);
    assert.equal(mount.before, nativeSection);
    assert.equal(nativeTitleRow.parentNode.querySelectorAll('button').length, 0);
    assert.equal(nativeTitleRow.children.length, 2);
    assert.equal(nativeTitleRow.children[1].children[0], plus);
    assert.equal(nativeTitleRow.children[1].children[1], more);
    assert.equal(nativeButton.parentNode.tagName, 'DIV');
});

test('unknown Project section layout does not insert inside native header', () => {
    const { Extension, aside } = createFixture('relative px-row-x unrelated-section');
    const mount = new Extension().findFolderMount();
    assert.equal(mount.parent, aside);
    assert.equal(mount.before, null);
});
