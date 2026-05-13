// KnowledgeGraph — 自建知识图谱

const fs = require('fs');
const path = require('path');

class KnowledgeGraph {
    constructor(options = {}) {
        this.storageDir = options.storageDir || path.join(process.cwd(), 'experience_store');
        this.debug = options.debug || false;

        this._entities = new Map();

        this._relationships = new Map();

        this._indexByType = new Map();     // type → Set<entityId>
        this._indexByTag = new Map();      // tag → Set<entityId>
        this._outgoingEdges = new Map();   // entityId → Set<relationshipId>
        this._incomingEdges = new Map();   // entityId → Set<relationshipId>

        this.config = {
            maxEntities: options.maxEntities || 5000,
            maxRelationships: options.maxRelationships || 20000,
            autoPersist: options.autoPersist !== false
        };

        this.stats = {
            totalEntities: 0,
            totalRelationships: 0,
            lastModified: null
        };
    }

    // 实体管理

    /**
     * 添加或更新实体
     * @param {string} id - 实体ID
     * @param {string} type - 实体类型
     * @param {string} name - 实体名称
     * @param {object} [properties] - 属性
     * @returns {object} 实体
     */
    addEntity(id, type, name, properties = {}) {
        const existing = this._entities.get(id);

        if (existing) {
            // 更新
            Object.assign(existing.properties, properties);
            existing.updatedAt = new Date().toISOString();
            this.stats.lastModified = existing.updatedAt;
            return existing;
        }

        if (this._entities.size >= this.config.maxEntities) {
            this._pruneEntities();
        }

        const entity = {
            id,
            type,
            name,
            properties,
            tags: properties.tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this._entities.set(id, entity);
        this._addToIndex(entity);

        this.stats.totalEntities = this._entities.size;
        this.stats.lastModified = entity.createdAt;

        return entity;
    }

    addEntities(entities) {
        const results = [];
        for (const e of entities) {
            results.push(this.addEntity(e.id, e.type, e.name, e.properties || {}));
        }
        return results;
    }

    /**
     * 获取实体
     */
    getEntity(id) {
        return this._entities.get(id) || null;
    }

    /**
     * 按类型查询实体
     */
    getEntitiesByType(type) {
        const ids = this._indexByType.get(type);
        if (!ids) return [];
        return Array.from(ids).map(id => this._entities.get(id)).filter(Boolean);
    }

    /**
     * 按标签查询实体
     */
    getEntitiesByTag(tag) {
        const ids = this._indexByTag.get(tag);
        if (!ids) return [];
        return Array.from(ids).map(id => this._entities.get(id)).filter(Boolean);
    }

    /**
     * 搜索实体（按名称或属性）
     */
    searchEntities(query) {
        const q = query.toLowerCase();
        const results = [];

        for (const entity of this._entities.values()) {
            if (entity.name.toLowerCase().includes(q) ||
                entity.id.toLowerCase().includes(q) ||
                JSON.stringify(entity.properties).toLowerCase().includes(q)) {
                results.push(entity);
            }
        }

        return results;
    }

    /**
     * 删除实体（同时删除相关关系）
     */
    removeEntity(id) {
        const entity = this._entities.get(id);
        if (!entity) return false;

        // 删除相关关系
        const outgoing = this._outgoingEdges.get(id) || new Set();
        const incoming = this._incomingEdges.get(id) || new Set();
        for (const relId of new Set([...outgoing, ...incoming])) {
            this.removeRelationship(relId);
        }

        this._entities.delete(id);
        this._removeFromIndex(entity);

        this.stats.totalEntities = this._entities.size;
        this.stats.lastModified = new Date().toISOString();

        return true;
    }

    // 关系管理

    /**
     * 添加关系
     * @param {string} sourceId - 源实体ID
     * @param {string} targetId - 目标实体ID
     * @param {string} type - 关系类型
     * @param {object} [properties] - 关系属性
     * @param {number} [weight=1.0] - 关系强度
     * @returns {object} 关系
     */
    addRelationship(sourceId, targetId, type, properties = {}, weight = 1.0) {
        // 验证实体存在
        if (!this._entities.has(sourceId) || !this._entities.has(targetId)) {
            throw new Error(`实体不存在: source=${sourceId}, target=${targetId}`);
        }

        // 检查是否已存在相同关系
        const existing = this._findRelationship(sourceId, targetId, type);
        if (existing) {
            existing.weight = (existing.weight + weight) / 2;
            existing.updatedAt = new Date().toISOString();
            Object.assign(existing.properties, properties);
            this.stats.lastModified = existing.updatedAt;
            return existing;
        }

        if (this._relationships.size >= this.config.maxRelationships) {
            this._pruneRelationships();
        }

        const relId = `rel_${sourceId.substring(0, 8)}_${targetId.substring(0, 8)}_${type}_${Date.now()}`;
        const rel = {
            id: relId,
            source: sourceId,
            target: targetId,
            type,
            properties,
            weight: Math.min(1, Math.max(0, weight)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this._relationships.set(relId, rel);
        this._addEdge(sourceId, targetId, relId);

        this.stats.totalRelationships = this._relationships.size;
        this.stats.lastModified = rel.createdAt;

        return rel;
    }

    addRelationships(rels) {
        const results = [];
        for (const r of rels) {
            results.push(this.addRelationship(r.source, r.target, r.type, r.properties || {}, r.weight || 1.0));
        }
        return results;
    }

    /**
     * 获取关系
     */
    getRelationship(id) {
        return this._relationships.get(id) || null;
    }

    /**
     * 获取实体的所有关系
     */
    getEntityRelationships(entityId, direction = 'both') {
        const outgoing = this._outgoingEdges.get(entityId) || new Set();
        const incoming = this._incomingEdges.get(entityId) || new Set();

        let relIds;
        if (direction === 'outgoing') relIds = outgoing;
        else if (direction === 'incoming') relIds = incoming;
        else relIds = new Set([...outgoing, ...incoming]);

        return Array.from(relIds)
            .map(id => this._relationships.get(id))
            .filter(Boolean);
    }

    /**
     * 获取实体的邻居（相连的实体）
     */
    getNeighbors(entityId, relType = null) {
        const rels = this.getEntityRelationships(entityId);
        const neighbors = new Map();

        for (const rel of rels) {
            if (relType && rel.type !== relType) continue;

            const neighborId = rel.source === entityId ? rel.target : rel.source;
            if (!neighbors.has(neighborId)) {
                neighbors.set(neighborId, {
                    entity: this._entities.get(neighborId),
                    relationship: rel,
                    direction: rel.source === entityId ? 'outgoing' : 'incoming'
                });
            }
        }

        return Array.from(neighbors.values());
    }

    /**
     * 查找两个实体之间的路径
     */
    findPath(sourceId, targetId, maxDepth = 4) {
        if (!this._entities.has(sourceId) || !this._entities.has(targetId)) return [];

        const visited = new Set([sourceId]);
        const queue = [{ id: sourceId, path: [sourceId] }];

        while (queue.length > 0) {
            const { id, path } = queue.shift();
            if (path.length > maxDepth) continue;

            const neighbors = this.getNeighbors(id);
            for (const n of neighbors) {
                if (n.entity && n.entity.id === targetId) {
                    return [...path, targetId];
                }
                if (!visited.has(n.entity.id)) {
                    visited.add(n.entity.id);
                    queue.push({ id: n.entity.id, path: [...path, n.entity.id] });
                }
            }
        }

        return [];
    }

    /**
     * 删除关系
     */
    removeRelationship(id) {
        const rel = this._relationships.get(id);
        if (!rel) return false;

        this._relationships.delete(id);
        this._removeEdge(rel.source, rel.target, id);

        this.stats.totalRelationships = this._relationships.size;
        return true;
    }

    // 查询与分析

    getStats() {
        const typeCounts = {};
        for (const entity of this._entities.values()) {
            typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
        }

        const relTypeCounts = {};
        for (const rel of this._relationships.values()) {
            relTypeCounts[rel.type] = (relTypeCounts[rel.type] || 0) + 1;
        }

        return {
            totalEntities: this._entities.size,
            totalRelationships: this._relationships.size,
            lastModified: this.stats.lastModified,
            entityTypes: typeCounts,
            relationshipTypes: relTypeCounts,
            density: this._calculateDensity()
        };
    }

    /**
     * 获取子图（以某实体为中心的N度关系网络）
     */
    getSubgraph(centerId, degrees = 2) {
        if (!this._entities.has(centerId)) return null;

        const entities = new Map();
        const relationships = new Map();
        const visited = new Set();
        const queue = [{ id: centerId, depth: 0 }];
        visited.add(centerId);

        while (queue.length > 0) {
            const { id, depth } = queue.shift();
            const entity = this._entities.get(id);
            if (entity) entities.set(id, entity);

            if (depth < degrees) {
                const rels = this.getEntityRelationships(id);
                for (const rel of rels) {
                    relationships.set(rel.id, rel);
                    const neighborId = rel.source === id ? rel.target : rel.source;
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push({ id: neighborId, depth: depth + 1 });
                    }
                }
            }
        }

        return {
            center: this._entities.get(centerId),
            entities: Array.from(entities.values()),
            relationships: Array.from(relationships.values()),
            size: entities.size
        };
    }

    getEntitySummary(entityId) {
        const entity = this._entities.get(entityId);
        if (!entity) return null;

        const rels = this.getEntityRelationships(entityId);
        const neighbors = this.getNeighbors(entityId);

        return {
            entity,
            relationshipCount: rels.length,
            neighborCount: neighbors.length,
            neighborTypes: neighbors.reduce((acc, n) => {
                const t = n.entity?.type || 'unknown';
                acc[t] = (acc[t] || 0) + 1;
                return acc;
            }, {}),
            relationships: rels.map(r => ({
                type: r.type,
                with: r.source === entityId ? r.target : r.source,
                weight: r.weight
            }))
        };
    }

    /**
     * 导入自发现清单
     */
    importFromDiscovery(inventory) {
        if (!inventory) return { entities: 0, relationships: 0 };
        let entities = 0, relationships = 0;

        const carrierName = inventory.summary?.hostname || inventory.system?.hostname || 'unknown';
        this.addEntity('carrier', 'carrier', `承载体:${carrierName}`, {
            type: inventory.carrierType,
            os: inventory.system?.platform || '',
            scanTime: inventory.scanTime
        });
        entities++;

        // 硬件
        if (inventory.hardware) {
            if (inventory.hardware.cpu) {
                this.addEntity('cpu', 'hardware_component', inventory.hardware.cpu.model || 'CPU', {
                    cores: inventory.hardware.cpu.cores,
                    speed: inventory.hardware.cpu.speed,
                    arch: inventory.hardware.cpu.architecture
                });
                entities++;

                this.addRelationship('carrier', 'cpu', 'contains', {}, 1.0);
                relationships++;
            }

            if (inventory.hardware.memory) {
                this.addEntity('memory', 'hardware_component',
                    `RAM ${inventory.hardware.memory.totalGB}GB`, {
                        total: inventory.hardware.memory.total,
                        totalGB: inventory.hardware.memory.totalGB
                    });
                entities++;
                this.addRelationship('carrier', 'memory', 'contains', {}, 1.0);
                relationships++;
            }

            if (inventory.hardware.disks) {
                for (const disk of inventory.hardware.disks) {
                    const diskId = `disk_${disk.drive?.replace(':', '') || 'unknown'}`;
                    this.addEntity(diskId, 'hardware_component', `磁盘 ${disk.drive}`, {
                        total: disk.total,
                        filesystem: disk.filesystem
                    });
                    entities++;
                    this.addRelationship('carrier', diskId, 'contains', {}, 0.9);
                    relationships++;
                    this.addRelationship(diskId, 'memory', 'provides_storage', {}, 0.8);
                    relationships++;
                }
            }
        }

        if (inventory.software?.installed) {
            const softwareGroup = inventory.software.installed.slice(0, 50);
            for (const app of softwareGroup) {
                const swId = `sw_${(app.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30)}`;
                this.addEntity(swId, 'software', app.name, {
                    version: app.version,
                    vendor: app.vendor
                });
                entities++;
                this.addRelationship('carrier', swId, 'contains', {}, 0.7);
                relationships++;
            }
        }

        if (inventory.software?.runtimes) {
            for (const rt of inventory.software.runtimes) {
                const rtId = `rt_${(rt.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                this.addEntity(rtId, 'runtime', rt.name, { version: rt.version });
                entities++;
                this.addRelationship('carrier', rtId, 'contains', {}, 0.8);
                relationships++;
            }
        }

        if (inventory.system?.services) {
            for (const svc of inventory.system.services.slice(0, 20)) {
                const svcId = `svc_${(svc.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 30)}`;
                this.addEntity(svcId, 'service', svc.displayName || svc.name, {
                    name: svc.name,
                    status: svc.status
                });
                entities++;
                this.addRelationship('carrier', svcId, 'runs', {}, 0.6);
                relationships++;
            }
        }

        if (inventory.capabilities?.interfaces) {
            for (const iface of inventory.capabilities.interfaces) {
                const capId = `cap_${iface}`;
                this.addEntity(capId, 'capability', iface, {});
                entities++;
                this.addRelationship('carrier', capId, 'has_capability', {}, 0.9);
                relationships++;
            }
        }

        this._log(`自发现导入: ${entities}实体, ${relationships}关系`);
        return { entities, relationships };
    }

    persist() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            const data = {
                exportedAt: new Date().toISOString(),
                entities: Array.from(this._entities.values()),
                relationships: Array.from(this._relationships.values())
            };
            const filePath = path.join(this.storageDir, 'knowledge_graph.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[KnowledgeGraph] Persist error:', e.message);
            return false;
        }
    }

    load() {
        try {
            const filePath = path.join(this.storageDir, 'knowledge_graph.json');
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data.entities) {
                    for (const e of data.entities) {
                        this._entities.set(e.id, e);
                        this._addToIndex(e);
                    }
                }
                if (data.relationships) {
                    for (const r of data.relationships) {
                        this._relationships.set(r.id, r);
                        this._addEdge(r.source, r.target, r.id);
                    }
                }
                this.stats = {
                    totalEntities: this._entities.size,
                    totalRelationships: this._relationships.size,
                    lastModified: data.exportedAt
                };
                console.log(`[KnowledgeGraph] Loaded: ${this._entities.size} entities, ${this._relationships.size} relationships`);
                return true;
            }
        } catch (e) {
            console.warn('[KnowledgeGraph] Load error:', e.message);
        }
        return false;
    }

    reset() {
        this._entities.clear();
        this._relationships.clear();
        this._indexByType.clear();
        this._indexByTag.clear();
        this._outgoingEdges.clear();
        this._incomingEdges.clear();
        this.stats = { totalEntities: 0, totalRelationships: 0, lastModified: null };
    }

    // 内部方法

    _addToIndex(entity) {
        // 按类型
        if (!this._indexByType.has(entity.type)) {
            this._indexByType.set(entity.type, new Set());
        }
        this._indexByType.get(entity.type).add(entity.id);

        // 按标签
        for (const tag of (entity.tags || [])) {
            if (!this._indexByTag.has(tag)) {
                this._indexByTag.set(tag, new Set());
            }
            this._indexByTag.get(tag).add(entity.id);
        }
    }

    _removeFromIndex(entity) {
        const typeSet = this._indexByType.get(entity.type);
        if (typeSet) typeSet.delete(entity.id);

        for (const tag of (entity.tags || [])) {
            const tagSet = this._indexByTag.get(tag);
            if (tagSet) tagSet.delete(entity.id);
        }
    }

    _addEdge(source, target, relId) {
        if (!this._outgoingEdges.has(source)) {
            this._outgoingEdges.set(source, new Set());
        }
        this._outgoingEdges.get(source).add(relId);

        if (!this._incomingEdges.has(target)) {
            this._incomingEdges.set(target, new Set());
        }
        this._incomingEdges.get(target).add(relId);
    }

    _removeEdge(source, target, relId) {
        this._outgoingEdges.get(source)?.delete(relId);
        this._incomingEdges.get(target)?.delete(relId);
    }

    _findRelationship(sourceId, targetId, type) {
        const outgoing = this._outgoingEdges.get(sourceId) || new Set();
        for (const relId of outgoing) {
            const rel = this._relationships.get(relId);
            if (rel && rel.target === targetId && rel.type === type) return rel;
        }
        return null;
    }

    _calculateDensity() {
        if (this._entities.size < 2) return 0;
        const maxPossible = this._entities.size * (this._entities.size - 1);
        return maxPossible > 0 ? this._relationships.size / maxPossible : 0;
    }

    _pruneEntities() {
        // 按更新时间排序，移除最旧的10%
        const sorted = Array.from(this._entities.values())
            .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
        const toRemove = Math.ceil(this.config.maxEntities * 0.1);
        for (let i = 0; i < toRemove && i < sorted.length; i++) {
            this.removeEntity(sorted[i].id);
        }
    }

    _pruneRelationships() {
        const sorted = Array.from(this._relationships.values())
            .sort((a, b) => a.weight - b.weight);
        const toRemove = Math.ceil(this.config.maxRelationships * 0.1);
        for (let i = 0; i < toRemove && i < sorted.length; i++) {
            this.removeRelationship(sorted[i].id);
        }
    }

    _log(msg) {
        console.log(`[KnowledgeGraph] ${msg}`);
    }
}

module.exports = KnowledgeGraph;
