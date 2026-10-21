/* Folder metadata is derived entirely from native ChatGPT Project titles. */
class FolderModel {
    static delimiter = ' - ';

    static parse(name) {
        return String(name || '').split(this.delimiter).map(x => x.trim()).filter(Boolean);
    }

    static isPrefix(prefix, parts) {
        return prefix.length <= parts.length &&
            prefix.every((segment, index) => segment === parts[index]);
    }

    static build(records) {
        const root = { name: '', parts: [], children: new Map(), project: null };
        for (const record of records) {
            const parts = this.parse(record.name);
            if (!parts.length) continue;
            let node = root;
            for (const segment of parts) {
                if (!node.children.has(segment)) {
                    node.children.set(segment, {
                        name: segment, parts: [...node.parts, segment],
                        children: new Map(), project: null
                    });
                }
                node = node.children.get(segment);
            }
            if (!node.project) node.project = record;
        }

        const result = [];
        const walk = (parent) => {
            const children = Array.from(parent.children.values())
                .sort((a, b) => a.name.localeCompare(b.name, undefined, {
                    numeric: true, sensitivity: 'base'
                }));
            for (const node of children) {
                // A native Project without a path or descendants stays in the
                // native "项目" section, not this virtual folder section.
                if (node.parts.length === 1 && node.children.size === 0) continue;
                const project = node.project;
                result.push({
                    name: node.name,
                    path: node.parts.join(this.delimiter),
                    parts: node.parts,
                    level: node.parts.length - 1,
                    type: project ? 'project' : 'heading',
                    isFolder: node.children.size > 0,
                    id: project?.id || null,
                    url: project?.url || null,
                    count: project?.count || 0,
                    done: !!project?.done
                });
                walk(node);
            }
        };
        walk(root);
        return result;
    }

    static planMove(records, sourcePath, targetPath) {
        const source = this.parse(sourcePath);
        const target = targetPath ? this.parse(targetPath) : [];
        if (!source.length) throw new Error('缺少被拖动的文件夹');
        if (this.isPrefix(source, target)) {
            throw new Error('不能把文件夹移动到自身或其子目录');
        }
        const destination = [...target, source[source.length - 1]];
        if (destination.join(this.delimiter) === source.join(this.delimiter)) {
            throw new Error('文件夹已经位于该目录');
        }

        const changed = [];
        const untouched = new Set();
        for (const record of records) {
            const parts = this.parse(record.name);
            if (this.isPrefix(source, parts)) {
                if (!record.id || !/^g-p-[a-zA-Z0-9-]+$/.test(record.id)) {
                    throw new Error('项目 ID 不完整，无法安全地批量重命名');
                }
                changed.push({
                    id: record.id,
                    oldName: record.name,
                    newName: [...destination, ...parts.slice(source.length)].join(this.delimiter)
                });
            } else {
                untouched.add(record.name);
            }
        }
        if (!changed.length) throw new Error('文件夹中没有可以移动的项目');
        const newNames = new Set();
        for (const change of changed) {
            if (untouched.has(change.newName) || newNames.has(change.newName)) {
                throw new Error('目标目录中已经存在同名项目：' + change.newName);
            }
            newNames.add(change.newName);
        }
        return { source: source.join(this.delimiter),
            destination: destination.join(this.delimiter), changes: changed };
    }
}

// Node.js test runner only; browser content scripts use the class directly.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FolderModel;
}
