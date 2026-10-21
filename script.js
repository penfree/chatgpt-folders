class Extension {
    constructor() {
        this.projects = [];
        this.access_token = null;
        this.$div = null;
        this.observer_active = true;
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
        // get access token
        this.getAccessToken();

        // check activation
        if (!this.extensionShouldBeActive()) {
            return;
        }

        // set active class
        document.body.classList.add('custom-chatgpt');

        // inject images
        document.documentElement.style.setProperty(
            '--extension-bg-image',
            `url("${(typeof browser !== 'undefined' && browser.runtime ? browser.runtime : chrome.runtime).getURL(
                'bg.gif'
            )}")`
        );

        // read from cache
        this.loadProjectsFromCache();
        if (this.projects.length > 0) {
            await this.injectProjects();
            this.updateActiveStates();
            this.restoreScrollPosition();
            this.insertTitleToTop();
        }

        // setup observers
        this.setupUrlObserver();
        this.setupTitleObserver();
        this.setupScrollObserver();
        this.setupSidebarObserver();

        // make the main run
        this.observer_active = false;
        await this.fetchProjects();
        this.storeProjectsInCache();
        await this.injectProjects();
        this.updateActiveStates();
        this.restoreScrollPosition();
        this.insertTitleToTop();
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
                this.insertTitleToTop();
                last_url = window.location.href;
                if (this.observer_active === true) {
                    this.observer_active = false;
                    //console.log('RUN URL OBSERVER');
                    await this.waitForMainElement();
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
                this.insertTitleToTop();
                last_title = document.title;
                if (this.observer_active === true) {
                    this.observer_active = false;
                    //console.log('RUN TITLE OBSERVER');
                    // update name in projects first
                    this.updateNameOfActiveProject();
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

    async waitForMainElement(timeoutMs = 8000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const legacy = document.querySelector('.group.__menu-item[href*="project"]');
            const anchor = legacy && legacy.closest('div');
            if (anchor && anchor.parentNode) {
                return { parent: anchor.parentNode, before: anchor };
            }

            // Modern ChatGPT sidebar: native Projects may not be anchor links.
            // Use layout/semantic containers rather than generated class names.
            const candidates = Array.from(document.querySelectorAll('aside, nav, [role="navigation"]'))
                .filter(element => {
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
                )) ||
                candidates[0];

            if (sidebar) {
                return { parent: sidebar, before: sidebar.firstChild };
            }
            await this.sleep(250);
        }
        console.warn('[ChatGPT folders] Sidebar not found; will retry.');
        return null;
    }

    

    async sleep(ms) {
        await new Promise(resolve => setTimeout(() => resolve(), ms));
    }

    async injectProjects() {
        if (this.mountInProgress) {
            return false;
        }
        this.mountInProgress = true;
        try {
            const mount = await this.waitForMainElement();
            if (!mount) {
                return false;
            }

            let container = document.querySelector('.projects-container[data-chatgpt-folders="true"]');
            if (!container) {
                container = document.createElement('div');
                container.className = 'projects-container';
                container.setAttribute('data-chatgpt-folders', 'true');
                container.setAttribute('role', 'navigation');
                container.setAttribute('aria-label', 'Project folders');
            }
            if (container.parentNode !== mount.parent) {
                mount.parent.insertBefore(container, mount.before);
            }

            // Use DOM APIs, never parse untrusted Project names as HTML.
            const list = document.createElement('ul');
            list.className = 'projects-container__list';
            for (const project of this.projects) {
                const item = document.createElement('li');
                item.className = [
                    'projects-container__list-item',
                    'projects-container__list-item--' + project.type,
                    'projects-container__list-item--level-' + project.level,
                    project.done ? 'projects-container__list-item--done' : ''
                ].filter(Boolean).join(' ');
                if (project.id != null) item.setAttribute('data-id', project.id);

                const link = document.createElement(project.type === 'heading' ? 'span' : 'a');
                link.className = 'projects-container__list-link';
                link.title = project.name;
                if (project.type === 'project' && project.url) {
                    link.setAttribute('href', project.url);
                }

                const icon = document.createElement('span');
                icon.className = 'projects-container__list-link-icon';
                icon.textContent = project.icon;
                const name = document.createElement('span');
                name.className = 'projects-container__list-link-name';
                name.textContent = project.name;
                link.append(icon, name);
                if (project.type === 'project') {
                    const count = document.createElement('span');
                    count.className = 'projects-container__list-link-count';
                    count.textContent = ' (' + (project.count || 0) + ')';
                    link.append(count);
                }
                item.append(link);
                list.append(item);
            }
            container.replaceChildren(list);
            return true;
        } finally {
            this.mountInProgress = false;
        }
    }

    // React may replace the sidebar without a navigation or title change.
    setupSidebarObserver() {
        setInterval(() => {
            if (this.projects.length === 0 || this.mountInProgress ||
                document.querySelector('.projects-container[data-chatgpt-folders="true"]')) {
                return;
            }
            this.injectProjects()
                .then(() => this.updateActiveStates())
                .catch(error => console.warn('[ChatGPT folders] Remount failed:', error));
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
