// All requests stay scoped to ChatGPT. In particular, never allow an
// arbitrary extension message to forward the user's access token elsewhere.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!sender.url || !/^https:\/\/(?:[a-z0-9-]+\.)?chatgpt\.com\//i.test(sender.url)) {
        return false;
    }

    if (message.action === 'fetch') {
        const url = new URL(message.data.url);
        if (url.origin !== 'https://chatgpt.com' ||
            url.pathname !== '/backend-api/gizmos/snorlax/sidebar') {
            respond({ success: false, message: 'Endpoint not permitted' });
            return false;
        }
        fetch(url.href, message.data.args)
            .then(async response => {
                if (!response.ok) {
                    return { success: false, message: response.status };
                }
                return response.json();
            })
            .then(respond)
            .catch(error => respond({ success: false, message: error.message }));
        return true;
    }

    if (message.action === 'projectRequest') {
        const { method, path, token, body } = message;
        const canRead = method === 'GET' &&
            /^\/backend-api\/gizmos\/g-p-[a-z0-9-]+$/i.test(path || '');
        const canRename = method === 'PATCH' &&
            /^\/backend-api\/projects\/g-p-[a-z0-9-]+$/i.test(path || '');
        if (!canRead && !canRename) {
            respond({ ok: false, status: 400, error: 'Endpoint not permitted' });
            return false;
        }
        const options = {
            method,
            cache: 'no-store',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        };
        if (canRename) {
            // Reject any fields that are not required to rename the project.
            if (!body || typeof body.name !== 'string' || !body.name.trim() ||
                Object.keys(body).some(key => !['name', 'instructions', 'emoji', 'theme'].includes(key))) {
                respond({ ok: false, status: 400, error: 'Invalid rename payload' });
                return false;
            }
            options.body = JSON.stringify(body);
        }
        fetch('https://chatgpt.com' + path, options)
            .then(async response => {
                const text = await response.text();
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch { /* empty / non-JSON */ }
                respond({
                    ok: response.ok,
                    status: response.status,
                    data,
                    error: response.ok ? null :
                        String(data?.message || data?.detail || 'Request failed').slice(0, 250)
                });
            })
            .catch(error => respond({ ok: false, status: 0, error: error.message }));
        return true;
    }
    return false;
});
