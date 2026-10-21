class Extension {
    constructor() {
        this.projects = [];
        this.rawProjects = [];
        this.apiFresh = false;
        this.moveInProgress = false;
        this.dragPath = null;
        this.access_token = null;
        this.$div = null;
        this.observer_active = true;
        try {
            this.collapsedFolders = new Set(
                JSON.parse(sessionStorage.getItem('chatgpt-folders-collapsed') || '[]')
            );
        } catch {
            this.collapsedFolders = new Set();
        }
        this.folderSectionExpanded = true;
    }

    // escape API-derived values before they are interpolated into HTML strings
    // (insertAdjacentHTML / innerHTML), preventing DOM XSS via project/conversation names
    escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async init() {
        this.getAccessToken();
        if (!this.extensionShouldBeActive()) return;

        // We only contribute a section to the existing sidebar.
        // Do not customize ChatGPT's page background, headers, or native Projects.
        this.loadProjectsFromCache();
        if (this.projects.length > 0) {
            await this.injectProjects();
            this.updateActiveStates();
        }

        this.setupUrlObserver();
        this.setupTitleObserver();
        this.setupSidebarObserver();

        this.observer_active = false;
        await this.fetchProjects();
        this.storeProjectsInCache();
        await this.injectProjects();
        this.updateActiveStates();
        this.observer_active = true;
    }

    

    getAccessToken() {
        let match = document.documentElement.outerHTML.match(/"accessToken":"(.*?)"/);
        if (match && match[1]) {
            this.access_token = match[1];
        }
    }

    extensionShouldBeActive() {
        return !(window.location.host.indexOf('chatgpt.com') === -1 || this.access_token === null);
    }

    async setupUrlObserver() {
        let last_url = window.location.href;
        setInterval(async () => {
            if (last_url !== window.location.href) {
                // The native ChatGPT conversation header is left untouched.
                last_url = window.location.href;
                if (this.observer_active === true && !this.moveInProgress) {
                    this.observer_active = false;
                    //console.log('RUN URL OBSERVER');
                    await this.sleep(1000); // small delay to ensure data is ready server side
                    await this.fetchProjects();
                    this.storeProjectsInCache();
                    await this.injectProjects();
                    this.updateActiveStates();
                    this.restoreScrollPosition();
                    this.observer_active = true;
                }
            }
        }, 500);
    }

    async setupTitleObserver() {
        let last_title = document.title;
        setInterval(async () => {
            if (last_title !== document.title) {
                // The native ChatGPT conversation header is left untouched.
                last_title = document.title;
                if (this.observer_active === true && !this.moveInProgress) {
                    this.observer_active = false;
                    //console.log('RUN TITLE OBSERVER');
                    await this.sleep(15000); // small delay to ensure data is ready server side
                    await this.fetchProjects();
                    this.storeProjectsInCache();
                    await this.injectProjects();
                    this.updateActiveStates();
                    this.restoreScrollPosition();
                    this.observer_active = true;
                }
            }
        }, 500);
    }

    loadProjectsFromCache() {
        try {
            const raw = JSON.parse(localStorage.getItem('chatgpt-folders-raw-v2') || '[]');
            if (Array.isArray(raw) && raw.length) {
                this.rawProjects = raw;
                this.projects = FolderModel.build(raw);
                return;
            }
            // Backward compatibility with the original extension's display cache.
            const legacy = JSON.parse(localStorage.getItem('projects') || '[]');
            if (Array.isArray(legacy)) this.projects = legacy;
        } catch (error) {
            console.warn('[ChatGPT folders] Ignoring invalid local cache:', error);
        }
    }

    storeProjectsInCache() {
        if (this.apiFresh) {
            localStorage.setItem('chatgpt-folders-raw-v2', JSON.stringify(this.rawProjects));
        }
    }

    async fetchProjects() {
        const previousRaw = this.rawProjects;
        const previousTree = this.projects;
        try {
            const records = [];
            let cursor = null;
            const seen = new Set();
            for (let page = 0; page < 100; page += 1) {
                const url = new URL('https://chatgpt.com/backend-api/gizmos/snorlax/sidebar');
                url.searchParams.set('conversations_per_gizmo', '0');
                if (cursor !== null) url.searchParams.set('cursor', cursor);
                url.searchParams.set('t', Date.now().toString());

                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'fetch',
                        data: {
                            url: url.href,
                            args: {
                                method: 'GET', cache: 'no-store',
                                headers: { Authorization: 'Bearer ' + this.access_token }
                            }
                        }
                    }, response => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                        else resolve(response);
                    });
                });
                if (!response || !Array.isArray(response.items)) {
                    throw new Error('Project API returned an unexpected response');
                }
                for (const item of response.items) {
                    const gizmo = item?.gizmo?.gizmo || item?.gizmo;
                    const id = gizmo?.id;
                    const shortUrl = gizmo?.short_url || id;
                    const name = gizmo?.display?.name;
                    if (!/^g-p-[a-zA-Z0-9-]+$/.test(id || '') ||
                        typeof name !== 'string' || !name.trim() || seen.has(id)) continue;
                    seen.add(id);
                    records.push({
                        id, name,
                        url: 'https://chatgpt.com/g/' + encodeURIComponent(shortUrl) + '/project',
                        count: item?.conversations?.items?.length || 0,
                        done: /done|erledigt/i.test(name)
                    });
                }
                if (response.cursor === null || response.cursor === undefined) {
                    cursor = null;
                    break;
                }
                if (response.cursor === cursor) throw new Error('Repeated Project API cursor');
                cursor = String(response.cursor);
                if (page === 99) throw new Error('Project listing exceeded pagination limit');
            }
            this.rawProjects = records;
            this.projects = FolderModel.build(records);
            this.apiFresh = true;
        } catch (error) {
            this.rawProjects = previousRaw;
            this.projects = previousTree;
            this.apiFresh = false;
            console.warn('[ChatGPT folders] Refresh failed; showing cached Projects:', error);
        }
    }

    saveCollapsedState() {
        sessionStorage.setItem(
            'chatgpt-folders-collapsed', JSON.stringify([...this.collapsedFolders])
        );
    }

    // Dragging changes native Project titles; we never persist a folder mapping.
    async projectRequest(method, path, body = undefined) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: 'projectRequest',
                method, path, body, token: this.access_token
            }, result => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!result || !result.ok) {
                    reject(new Error('Project API ' + method + ' ' + path +
                        ': HTTP ' + (result?.status ?? '?') +
                        (result?.error ? ' ' + result.error : '')));
                } else {
                    resolve(result.data);
                }
            });
        });
    }

    async getProjectDetails(id) {
        const result = await this.projectRequest('GET',
            '/backend-api/gizmos/' + encodeURIComponent(id));
        const detail = result?.gizmo?.gizmo || result?.gizmo || result;
        if (!detail || typeof detail.display?.name !== 'string') {
            throw new Error('Project details are incomplete: ' + id);
        }
        return detail;
    }

    async renameProject(id, expectedName, newName) {
        const current = await this.getProjectDetails(id);
        if (current.display.name !== expectedName) {
            throw new Error('项目名称已被其他窗口更改：' + expectedName);
        }
        const body = {
            name: newName,
            instructions: current.instructions || '',
            emoji: current.display.emoji ?? null,
            theme: current.display.theme ?? null
        };
        await this.projectRequest('PATCH',
            '/backend-api/projects/' + encodeURIComponent(id), body);
    }

    async moveFolder(sourcePath, targetPath) {
        if (this.moveInProgress) return;
        if (!this.apiFresh) {
            window.alert('项目列表尚未完成同步，无法安全地批量重命名。请刷新后重试。');
            return;
        }
        let plan;
        try {
            plan = FolderModel.planMove(this.rawProjects, sourcePath, targetPath);
        } catch (error) {
            window.alert(error.message);
            return;
        }
        const sample = plan.changes.slice(0, 3)
            .map(c => c.oldName + ' → ' + c.newName).join('\n');
        if (!window.confirm(
            '移动目录：' + plan.source + ' → ' + plan.destination + '\n' +
            '将重命名 ' + plan.changes.length + ' 个 ChatGPT 项目：\n' +
            sample + (plan.changes.length > 3 ? '\n…' : '') +
            '\n\n这些更改将同步到你的其他设备。是否继续？'
        )) return;

        this.moveInProgress = true;
        this.dragPath = null;
        let rollbackFailed = 0;
        let committed = false;
        try {
            // Preflight all affected Projects before changing anything.
            for (const change of plan.changes) {
                const current = await this.getProjectDetails(change.id);
                if (current.display.name !== change.oldName) {
                    throw new Error('项目在操作前已更名：' + change.oldName);
                }
            }

            for (const change of plan.changes) {
                await this.renameProject(change.id, change.oldName, change.newName);
            }
            committed = true;
            // Keep the UI consistent even when an immediate refetch fails.
            this.rawProjects = this.rawProjects.map(record => {
                const change = plan.changes.find(c => c.id === record.id);
                return change ? { ...record, name: change.newName } : record;
            });
            this.projects = FolderModel.build(this.rawProjects);
            this.collapsedFolders.delete(plan.destination);
            this.saveCollapsedState();
            window.alert('移动成功，已更新 ' + plan.changes.length + ' 个项目。');
        } catch (error) {
            console.error('[ChatGPT folders] Batch rename failed:', error);
            // An HTTP/network error can happen AFTER a PATCH succeeded. Check
            // actual server state for every changed item, not only acknowledged
            // requests, then roll back anything left with the new title.
            for (const change of [...plan.changes].reverse()) {
                try {
                    const current = await this.getProjectDetails(change.id);
                    if (current.display.name === change.newName) {
                        await this.renameProject(change.id, change.newName, change.oldName);
                    } else if (current.display.name !== change.oldName) {
                        rollbackFailed += 1;
                    }
                } catch (rollbackError) {
                    rollbackFailed += 1;
                    console.error('[ChatGPT folders] Rollback failed:', rollbackError);
                }
            }
            window.alert('目录移动失败：' + error.message +
                (rollbackFailed ? '\n有 ' + rollbackFailed +
                ' 个项目无法确认或回滚，请到原生“项目”列表核对名称。'
                    : '\n已确认或恢复受影响项目的原名称。'));
        } finally {
            // Always re-sync from ChatGPT, even if rollback is incomplete.
            await this.fetchProjects();
            this.storeProjectsInCache();
            this.moveInProgress = false;
            if (committed && !this.apiFresh) {
                window.alert('项目已更名，但刷新目录失败，请手动刷新 ChatGPT。');
            }
            await this.injectProjects();
            this.updateActiveStates();
        }
    }

        bindDropTarget(element, targetPath) {
        const valid = () => {
            if (!this.dragPath || this.moveInProgress || !this.apiFresh) return false;
            try {
                FolderModel.planMove(this.rawProjects, this.dragPath, targetPath);
                return true;
            } catch {
                return false;
            }
        };
        element.addEventListener('dragover', event => {
            if (!valid()) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            element.classList.add('projects-container__drop-target');
        });
        element.addEventListener('dragleave', event => {
            if (!element.contains(event.relatedTarget)) {
                element.classList.remove('projects-container__drop-target');
            }
        });
        element.addEventListener('drop', event => {
            if (!valid()) return;
            event.preventDefault();
            event.stopPropagation();
            element.classList.remove('projects-container__drop-target');
            const source = this.dragPath;
            this.dragPath = null;
            this.moveFolder(source, targetPath).catch(err =>
                console.error('[ChatGPT folders] Move failed:', err)
            );
        });
    }

    

    // Insert a standalone "项目目录" category next to the native Projects
    // heading. Never put our entire panel at the top of the global sidebar.
    findFolderMount() {
        const candidates = Array.from(
            document.querySelectorAll('aside, nav, [role="navigation"]')
        ).filter(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width >= 160 && rect.height >= 160 &&
                rect.left >= -20 && rect.left < window.innerWidth / 2 &&
                style.display !== 'none' && style.visibility !== 'hidden';
        });
        const sidebar =
            candidates.find(el => el.tagName.toLowerCase() === 'aside') ||
            candidates.find(el => /chat|history|sidebar|project|项目|历史/i.test(
                el.getAttribute('aria-label') || ''
            )) || candidates[0];
        if (!sidebar) return null;

        const nativeProjectTitle = Array.from(
            sidebar.querySelectorAll('span, button, h2, h3, p, div')
        ).find(el =>
            el.childElementCount === 0 &&
            /^(Projects|项目)$/i.test(el.textContent.trim()) &&
            !el.closest('[data-chatgpt-folders="true"]')
        );

        if (nativeProjectTitle) {
            const headerButton =
                nativeProjectTitle.closest('button, [role="button"]') ||
                nativeProjectTitle;
            // Keep the entire native heading row (including its controls)
            // together. Place our section immediately before that heading.
            const headerRow = headerButton.parentElement &&
                headerButton.parentElement !== sidebar
                ? headerButton.parentElement
                : headerButton;
            if (headerRow.parentNode) {
                return {
                    parent: headerRow.parentNode,
                    before: headerRow,
                    nativeLabel: nativeProjectTitle
                };
            }
        }

        // Loading / collapsed Projects: still render within the actual
        // sidebar, then move beside Projects when the heading appears.
        return { parent: sidebar, before: null, nativeLabel: null };
    }

    async waitForMainElement(timeoutMs = 8000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const mount = this.findFolderMount();
            if (mount) return mount;
            await this.sleep(250);
        }
        console.warn('[ChatGPT folders] Sidebar not found; will retry.');
        return null;
    }

    

    async sleep(ms) {
        await new Promise(resolve => setTimeout(() => resolve(), ms));
    }

    // Use SVG rather than emojis, consistent with native ChatGPT icons.
    makeIcon(kind) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('projects-container__icon');
        const path = document.createElementNS(ns, 'path');
        const paths = {
            chevron: 'm9 18 6-6-6-6',
            folder: 'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z',
            // A document outline distinguishes leaf Projects from folders.
            project: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6'
        };
        path.setAttribute('d', paths[kind] || paths.folder);
        svg.append(path);
        return svg;
    }

    async injectProjects() {
        if (this.mountInProgress) return false;
        this.mountInProgress = true;
        try {
            const mount = await this.waitForMainElement();
            if (!mount) return false;

            let container = document.querySelector('.projects-container[data-chatgpt-folders="true"]');
            if (!container) {
                container = document.createElement('section');
                container.className = 'projects-container';
                container.setAttribute('data-chatgpt-folders', 'true');
                container.setAttribute('aria-label', '项目目录');
            }
            if (container.parentNode !== mount.parent ||
                (mount.before && container.nextSibling !== mount.before)) {
                mount.parent.insertBefore(container, mount.before);
            }

            if (mount.nativeLabel) {
                const nativeLeft = mount.nativeLabel.getBoundingClientRect().left;
                const sectionLeft = container.getBoundingClientRect().left;
                const leftPadding = nativeLeft - sectionLeft;
                if (Number.isFinite(leftPadding) && leftPadding >= 0 && leftPadding <= 80) {
                    container.style.setProperty('--folders-title-indent', leftPadding + 'px');
                }
            }

            const titleButton = document.createElement('button');
            titleButton.type = 'button';
            titleButton.className = 'projects-container__category-toggle';
            titleButton.setAttribute('aria-expanded', String(this.folderSectionExpanded));
            const title = document.createElement('span');
            title.className = 'projects-container__category-title';
            title.textContent = '项目目录';
            if (mount.nativeLabel) {
                const nativeStyle = getComputedStyle(mount.nativeLabel);
                title.style.fontSize = nativeStyle.fontSize;
                title.style.fontWeight = nativeStyle.fontWeight;
                title.style.color = nativeStyle.color;
            }
            titleButton.append(title);
            const categoryChevron = this.makeIcon('chevron');
            categoryChevron.classList.add('projects-container__category-chevron');
            if (this.folderSectionExpanded) {
                categoryChevron.classList.add('projects-container__chevron--expanded');
            }
            titleButton.append(categoryChevron);
            titleButton.addEventListener('click', () => {
                this.folderSectionExpanded = !this.folderSectionExpanded;
                this.injectProjects();
            });
            // Dropping on the section header moves a folder to the root.
            this.bindDropTarget(titleButton, '');

            const list = document.createElement('ul');
            list.className = 'projects-container__list';
            list.setAttribute('role', 'tree');
            list.hidden = !this.folderSectionExpanded;
            const ancestors = [];
            for (const project of this.projects) {
                const level = Math.max(0, Number(project.level) || 0);
                const path = project.path || [...ancestors.slice(0, level), project.name].join(' - ');
                const folder = !!project.isFolder;
                ancestors.length = level;
                ancestors[level] = path;
                const ancestorPaths = ancestors.slice(0, level);
                if (ancestorPaths.some(p => this.collapsedFolders.has(p))) continue;

                const item = document.createElement('li');
                item.className = 'projects-container__list-item';
                item.style.setProperty('--folder-depth', String(level));
                item.setAttribute('role', 'treeitem');
                item.setAttribute('aria-level', String(level + 1));
                if (project.id) item.setAttribute('data-id', project.id);
                if (project.done) item.classList.add('projects-container__list-item--done');
                if (folder && project.id) item.classList.add('projects-container__list-item--hybrid');

                const row = document.createElement('div');
                row.className = 'projects-container__row';
                row.style.setProperty('--folder-depth', String(level));
                const isProject = project.type === 'project' && !!project.url;
                const entry = document.createElement(isProject ? 'a' : 'button');
                entry.className = 'projects-container__list-link';
                entry.title = project.name;
                if (isProject) {
                    entry.href = project.url;
                    // Clicking a hybrid node expands it AND navigates to
                    // the actual ChatGPT Project. The trailing chevron only
                    // toggles expansion without navigation.
                    if (folder) {
                        entry.addEventListener('click', event => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey ||
                                event.altKey || event.shiftKey) return;
                            event.preventDefault();
                            this.collapsedFolders.delete(path);
                            this.saveCollapsedState();
                            window.location.assign(project.url);
                        });
                    }
                } else {
                    entry.type = 'button';
                    entry.addEventListener('click', () => {
                        if (this.collapsedFolders.has(path)) this.collapsedFolders.delete(path);
                        else this.collapsedFolders.add(path);
                        this.saveCollapsedState();
                        this.injectProjects();
                    });
                }

                const icon = this.makeIcon(folder ? 'folder' : 'project');
                icon.classList.add('projects-container__folder-icon');
                entry.append(icon);
                const label = document.createElement('span');
                label.className = 'projects-container__list-link-name';
                label.textContent = project.name;
                entry.append(label);
                row.append(entry);

                if (folder) {
                    const collapsed = this.collapsedFolders.has(path);
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'projects-container__expand-button';
                    button.title = collapsed ? '展开 ' + project.name : '折叠 ' + project.name;
                    button.setAttribute('aria-label', button.title);
                    button.setAttribute('aria-expanded', String(!collapsed));
                    const chevron = this.makeIcon('chevron');
                    chevron.classList.add('projects-container__chevron');
                    if (!collapsed) chevron.classList.add('projects-container__chevron--expanded');
                    button.append(chevron);
                    button.addEventListener('click', () => {
                        if (collapsed) this.collapsedFolders.delete(path);
                        else this.collapsedFolders.add(path);
                        this.saveCollapsedState();
                        this.injectProjects();
                    });
                    row.append(button);
                    if (this.apiFresh && !this.moveInProgress) {
                        row.draggable = true;
                        row.title = project.name + '（拖拽移动目录）';
                        row.addEventListener('dragstart', event => {
                            this.dragPath = path;
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', path);
                            row.classList.add('projects-container__dragging');
                        });
                        row.addEventListener('dragend', () => {
                            this.dragPath = null;
                            row.classList.remove('projects-container__dragging');
                            document.querySelectorAll('.projects-container__drop-target')
                                .forEach(node => node.classList.remove('projects-container__drop-target'));
                        });
                    }
                    this.bindDropTarget(row, path);
                }
                item.append(row);
                list.append(item);
            }
            container.replaceChildren(titleButton, list);
            return true;
        } finally {
            this.mountInProgress = false;
        }
    }

    // New ChatGPT uses React to rebuild navigation sections; maintain our
    // position immediately beside Projects without creating duplicates.
    setupSidebarObserver() {
        setInterval(() => {
            if (this.mountInProgress) return;
            const container = document.querySelector('.projects-container[data-chatgpt-folders="true"]');
            const mount = this.findFolderMount();
            if (!mount || this.projects.length === 0) return;
            const incorrectlyPlaced = !container ||
                container.parentNode !== mount.parent ||
                (mount.before && container.nextSibling !== mount.before);
            if (incorrectlyPlaced) {
                this.injectProjects()
                    .then(() => this.updateActiveStates())
                    .catch(error => console.warn('[ChatGPT folders] Remount failed:', error));
            }
        }, 2000);
    }

    

    updateActiveStates() {
        //console.log('updateActiveStates(): START');
        if (document.querySelector('.projects-container__list-item') !== null) {
            document.querySelectorAll('.projects-container__list-item').forEach($el => {
                if ($el.getAttribute('data-id') && window.location.href.includes($el.getAttribute('data-id'))) {
                    $el.classList.add('projects-container__list-item--active');
                } else {
                    $el.classList.remove('projects-container__list-item--active');
                }
            });
        }
        //console.log('updateActiveStates(): END');
    }

    updateNameOfActiveProject() {
        if (document.querySelector('a[href="#edit-title"]') !== null) {
            if (document.querySelector('.projects-container__list-item') !== null) {
                document.querySelectorAll('.projects-container__list-item').forEach($el => {
                    if ($el.getAttribute('data-id') && window.location.href.includes($el.getAttribute('data-id'))) {
                        let name = document.querySelector('a[href="#edit-title"]').innerText;
                        if (name.split(' - ').length > 1) {
                            name = name.split(' - ').slice(1).join(' - ');
                        }
                        $el.querySelector('.projects-container__list-link-name').innerText = name;
                    }
                });
            }
        }
    }

    setupScrollObserver() {
        let $el = document.querySelector('.group\\/scrollport');
        if ($el !== null) {
            $el.addEventListener('scroll', () => {
                localStorage.setItem('scrollPos', $el.scrollTop);
            });
        }
    }

    restoreScrollPosition() {
        let $el = document.querySelector('.group\\/scrollport');
        if ($el !== null) {
            let scrollPos = localStorage.getItem('scrollPos');
            if (scrollPos !== null) {
                $el.scrollTop = parseInt(scrollPos, 10);
            }
        }
    }

    insertTitleToTop() {
        let $el = document.querySelector('#page-header > .flex.items-center:last-child');
        if ($el !== null && window.location.href.includes('/c/')) {
            let title = document.title;
            title = title.replace(/^ChatGPT | /, '');
            title = title.replace(/^ChatGPT - /, '');
            title = title.replace(/^ChatGPT/, '');
            if (title === '') {
                return;
            }
            // escape the conversation title before building markup (innerHTML sink below)
            title = this.escapeHtml(title);

            if (title.includes(' - ')) {
                let project_url = window.location.href;
                if (project_url.includes('/g/')) {
                    project_url = project_url.replace(/^(.+\/g\/(.+?)\/).+/, '$1');
                }
                title = title.replace(
                    /(.+) - (.+)/,
                    '<a href="' + this.escapeHtml(project_url) + '" class="text-token-text-tertiary">$1</a><span>-</span><span>$2</span>'
                );
            } else {
                title = '<span>' + title + '</span>';
            }
            title = '<span>💬</span>' + title + '<span>💬</span>';
            if (document.querySelector('.header-title') !== null) {
                document.querySelector('.header-title').innerHTML = title;
            } else {
                $el.before(
                    new DOMParser().parseFromString(
                        '<div class="flex items-center font-bold header-title">' + title + '</div>',
                        'text/html'
                    ).body.childNodes[0]
                );
                if ($el.parentNode.querySelector('.start-1\\/2') !== null) {
                    $el.parentNode.querySelector('.start-1\\/2').remove();
                }
            }
        }
    }
}

(async () => {
    let e = new Extension();
    e.init();
})();
