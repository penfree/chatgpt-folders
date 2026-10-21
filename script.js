class Extension {
    constructor() {
        this.projects = [];
        this.access_token = null;
        this.$div = null;
        this.observer_active = true;
        this.collapsedFolders = new Set();
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
                if (this.observer_active === true) {
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
                if (this.observer_active === true) {
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
        if (localStorage.getItem('projects') !== null) {
            this.projects = JSON.parse(localStorage.getItem('projects'));
        }
    }

    storeProjectsInCache() {
        localStorage.setItem('projects', JSON.stringify(this.projects));
    }

    async fetchProjects() {
        //console.log('fetchProjects(): START');
        const previousProjects = this.projects;
        try {
        this.projects = [];
        let cursor = null;
        while (true) {
            let url = 'https://chatgpt.com/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=10';
            if (cursor !== null) {
                url += '&cursor=' + cursor;
            }
            url += '&t=' + Date.now();
            let response = await new Promise((resolve, reject) => {
                //console.log(url);
                chrome.runtime.sendMessage(
                    {
                        action: 'fetch',
                        data: {
                            url: url,
                            args: {
                                method: 'GET',
                                cache: 'no-store',
                                headers: {
                                    Authorization: 'Bearer ' + this.access_token,
                                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                                    Pragma: 'no-cache',
                                    Expires: '0'
                                }
                            }
                        }
                    },
                    response => {
                        resolve(response);
                    }
                );
            });
            if (!response || !Array.isArray(response.items)) {
                throw new Error('Unexpected Project API response');
            }
            if (response.items.length > 0) {
                for (let items__value of response.items) {
                    //console.log(items__value);
                    let id = items__value.gizmo.gizmo.short_url,
                        name = items__value.gizmo.gizmo.display.name,
                        url = 'https://chatgpt.com/g/' + items__value.gizmo.gizmo.short_url + '/project',
                        level = 0;
                    if (id.split('-').length > 3) {
                        id = id.split('-').slice(0, 3).join('-');
                    }
                    if (name.split(' - ').length > 1) {
                        level = name.split(' - ').length - 1;
                    }
                    this.projects.push({
                        id: id,
                        name: name,
                        url: url,
                        level: level,
                        count: items__value.conversations.items.length,
                        icon: '📁',
                        type: 'project',
                        done: name.toLowerCase().includes('done') || name.toLowerCase().includes('erledigt')
                    });
                }
            }
            if (response.cursor !== null) {
                cursor = response.cursor;
            } else {
                break;
            }
        }
        // sort projects by name
        this.projects.sort((a, b) => {
            let name_a = a.name,
                name_b = b.name,
                done_a = a.done,
                done_b = b.done,
                unsorted_a = a.name.toLowerCase().includes('ungeordnet'),
                unsorted_b = b.name.toLowerCase().includes('ungeordnet');
            if (done_a && !done_b) {
                return 1;
            }
            if (!done_a && done_b) {
                return -1;
            }
            if (unsorted_a && !unsorted_b) {
                return 1;
            }
            if (!unsorted_a && unsorted_b) {
                return -1;
            }
            return name_a.localeCompare(name_b, undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        });
        // insert headings
        let projects_with_headings = [],
            projects_with_headings_orig = this.projects,
            last_heading = null,
            this_heading = null,
            max_levels = 0;
        for (let projects__value of projects_with_headings_orig) {
            if (projects__value.name.split(' - ').length - 1 > max_levels) {
                max_levels = projects__value.name.split(' - ').length - 1;
            }
        }
        //console.log('max_levels: ' + max_levels);
        for (let i = 0; i <= max_levels; i++) {
            projects_with_headings = [];
            last_heading = null;
            this_heading = null;
            for (let projects__value of projects_with_headings_orig) {
                if (projects__value.name.split(' - ').length > 1) {
                    this_heading = projects__value.name.split(' - ')[0];
                    if (last_heading !== this_heading) {
                        last_heading = this_heading;
                        projects_with_headings.push({
                            id: null,
                            name: this_heading,
                            url: '#',
                            level: i,
                            count: 0,
                            icon: '📦',
                            type: 'heading',
                            done: projects__value.done
                        });
                    }
                    if (projects__value.name.split(' - ').length > 1) {
                        projects__value.name = projects__value.name.split(' - ').slice(1).join(' - ');
                    }
                }
                projects_with_headings.push(projects__value);
            }
            projects_with_headings_orig = projects_with_headings;
            //console.log(projects_with_headings);
            //console.log(this.projects);
        }
        //console.log(this.projects);
        this.projects = projects_with_headings;

        // modify done
        for (let projects__value of this.projects) {
            if (projects__value.done) {
                if (projects__value.type === 'heading') {
                    projects__value.icon = '✅';
                }
            }
        }

        //console.log(this.projects);
        } catch (error) {
            this.projects = previousProjects;
            console.warn('[ChatGPT folders] Unable to refresh projects; using cached data.', error);
        }
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
        path.setAttribute('d', kind === 'chevron'
            ? 'm9 18 6-6-6-6'
            : 'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z');
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

            if (
                container.parentNode !== mount.parent ||
                (mount.before && container.nextSibling !== mount.before)
            ) {
                mount.parent.insertBefore(container, mount.before);
            }
            // Measure the native "项目" heading on the current sidebar and
            // align "项目目录" to that exact x-coordinate. This avoids a
            // hard-coded offset that differs across ChatGPT versions.
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
            // Native title typography can vary across ChatGPT versions.
            if (mount.nativeLabel) {
                const nativeStyle = getComputedStyle(mount.nativeLabel);
                title.style.fontSize = nativeStyle.fontSize;
                title.style.fontWeight = nativeStyle.fontWeight;
                title.style.color = nativeStyle.color;
            }
            titleButton.append(title);
            const categoryChevron = this.makeIcon('chevron');
            categoryChevron.classList.add('projects-container__category-chevron');
            if (this.folderSectionExpanded) categoryChevron.classList.add('projects-container__chevron--expanded');
            titleButton.append(categoryChevron);
            titleButton.addEventListener('click', () => {
                this.folderSectionExpanded = !this.folderSectionExpanded;
                this.injectProjects();
            });

            const list = document.createElement('ul');
            list.className = 'projects-container__list';
            list.setAttribute('role', 'tree');
            list.hidden = !this.folderSectionExpanded;

            const headings = [];
            let hiddenAncestor = false;
            for (const project of this.projects) {
                const level = Math.max(0, Number(project.level) || 0);
                // This category only lists grouped Projects. Plain Projects
                // remain accessible in ChatGPT's original "项目" category.
                if (project.type === 'project' && level === 0) continue;
                if (project.type !== 'project' && project.type !== 'heading') continue;

                if (project.type === 'heading') {
                    headings.length = level;
                    headings[level] = project.name;
                }
                hiddenAncestor = headings.slice(0, level).some((_, depth) =>
                    this.collapsedFolders.has(headings.slice(0, depth + 1).join(' / '))
                );
                if (hiddenAncestor) continue;

                const item = document.createElement('li');
                item.className = 'projects-container__list-item';
                item.style.setProperty('--folder-depth', String(level));
                item.setAttribute('role', 'treeitem');
                item.setAttribute('aria-level', String(level + 1));
                if (project.id != null) item.setAttribute('data-id', project.id);
                if (project.done) item.classList.add('projects-container__list-item--done');

                const isHeading = project.type === 'heading';
                const entry = document.createElement(isHeading ? 'button' : 'a');
                entry.className = 'projects-container__list-link';
                entry.title = project.name;
                if (isHeading) {
                    entry.type = 'button';
                    const folderPath = headings.slice(0, level + 1).join(' / ');
                    const collapsed = this.collapsedFolders.has(folderPath);
                    entry.setAttribute('aria-expanded', String(!collapsed));
                    const chevron = this.makeIcon('chevron');
                    chevron.classList.add('projects-container__chevron');
                    if (!collapsed) chevron.classList.add('projects-container__chevron--expanded');
                    // The chevron is placed after the label, so it no longer
                    // consumes 20px of indentation before every folder icon.
                    entry.addEventListener('click', () => {
                        if (collapsed) this.collapsedFolders.delete(folderPath);
                        else this.collapsedFolders.add(folderPath);
                        this.injectProjects();
                    });
                } else if (project.url) {
                    entry.href = project.url;
                }

                const icon = this.makeIcon('folder');
                icon.classList.add('projects-container__folder-icon');
                entry.append(icon);
                const label = document.createElement('span');
                label.className = 'projects-container__list-link-name';
                label.textContent = project.name;
                entry.append(label);
                if (isHeading) {
                    entry.append(chevron);
                }
                item.append(entry);
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
