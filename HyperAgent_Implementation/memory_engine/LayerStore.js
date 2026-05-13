const fs = require('fs');
const path = require('path');

class LayerStore {
    constructor(layerName, options = {}) {
        this.layerName = layerName;
        this.baseDir = options.baseDir || path.join(process.cwd(), 'mem_store');
        this.dir = path.join(this.baseDir, layerName);
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }

    save(id, data) {
        fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(data));
    }

    load(id) {
        const p = path.join(this.dir, `${id}.json`);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    }
}

module.exports = LayerStore;
