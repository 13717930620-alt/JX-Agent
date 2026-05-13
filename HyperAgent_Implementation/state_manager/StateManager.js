const fs = require('fs');
const path = require('path');

// StateManager — state management center
class StateManager {
    constructor(options = {}) {
        this.storagePath = options.storagePath || 'state_snapshot.json';
        this.historyPath = options.historyPath || 'state_history';
        this.tempPath = this.storagePath + '.tmp';
        this.maxHistory = options.maxHistory || 50; // 最多保留50个历史快照
        this.currentState = {};
        this.transactionStack = [];
        this.isInTransaction = false;
        
        // 确保历史目录存在
        if (!fs.existsSync(this.historyPath)) {
            fs.mkdirSync(this.historyPath, { recursive: true });
        }
        
        // 加载上次状态
        this._loadPersisted();
    }

    /** 保存检查点 */
    async saveCheckpoint(state, metadata = {}) {
        const checkpointData = {
            timestamp: new Date().toISOString(),
            version: '3.0',
            state: state,
            metadata: {
                ...metadata,
                checkpointsCount: this._getCheckpointCount() + 1
            }
        };

        try {
            // 原子写入：先写 temp，再 rename
            const data = JSON.stringify(checkpointData, null, 2);
            fs.writeFileSync(this.tempPath, data, 'utf8');
            fs.renameSync(this.tempPath, this.storagePath);
            
            this.currentState = JSON.parse(JSON.stringify(state));
            
            // 保存历史
            await this._saveToHistory(checkpointData);
            
            return { success: true, timestamp: checkpointData.timestamp };
        } catch (error) {
            console.error('[StateManager] Checkpoint save failed:', error);
            throw error;
        }
    }

    async loadLastCheckpoint() {
        try {
            if (!fs.existsSync(this.storagePath)) {
                return null;
            }
            const data = fs.readFileSync(this.storagePath, 'utf8');
            const parsed = JSON.parse(data);
            this.currentState = parsed.state || {};
            return parsed;
        } catch (error) {
            console.error('[StateManager] Recovery failed:', error);
            return null;
        }
    }

    getCurrentState() {
        return JSON.parse(JSON.stringify(this.currentState));
    }

    setCurrentState(state) {
        this.currentState = JSON.parse(JSON.stringify(state));
    }

    clearState() {
        this.currentState = {};
    }

    beginTransaction() {
        if (this.isInTransaction) {
            throw new Error('Transaction already in progress');
        }
        this.isInTransaction = true;
        this.transactionStack.push(JSON.parse(JSON.stringify(this.currentState)));
        console.log('[StateManager] Transaction started');
    }

    async commitTransaction() {
        if (!this.isInTransaction) {
            throw new Error('No transaction in progress');
        }
        
        await this.saveCheckpoint(this.currentState, { 
            type: 'transaction_commit',
            transactionDepth: this.transactionStack.length
        });
        
        this.transactionStack = [];
        this.isInTransaction = false;
        console.log('[StateManager] Transaction committed');
    }

    rollbackTransaction() {
        if (!this.isInTransaction) {
            throw new Error('No transaction in progress');
        }
        
        if (this.transactionStack.length > 0) {
            this.currentState = this.transactionStack.pop();
        }
        this.isInTransaction = false;
        console.log('[StateManager] Transaction rolled back');
    }

    async getHistory(count = 10) {
        try {
            const files = await fs.promises.readdir(this.historyPath);
            const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
            const history = [];
            
            for (let i = 0; i < Math.min(count, jsonFiles.length); i++) {
                const filePath = path.join(this.historyPath, jsonFiles[i]);
                const data = await fs.promises.readFile(filePath, 'utf8');
                const parsed = JSON.parse(data);
                history.push({
                    timestamp: parsed.timestamp,
                    state: parsed.state,
                    metadata: parsed.metadata
                });
            }
            
            return history;
        } catch (e) {
            console.error('[StateManager] Failed to load history:', e);
            return [];
        }
    }

    async rollbackToTimestamp(timestamp) {
        const history = await this.getHistory(this.maxHistory);
        const target = history.find(h => h.timestamp === timestamp);
        
        if (!target) {
            throw new Error(`Snapshot at ${timestamp} not found`);
        }
        
        this.currentState = target.state;
        await this.saveCheckpoint(target.state, { type: 'rollback', targetTimestamp: timestamp });
        
        return { success: true, restoredTo: timestamp };
    }

    async rollbackToPrevious() {
        const history = await this.getHistory(2);
        if (history.length < 2) {
            throw new Error('No previous snapshot available');
        }
        return await this.rollbackToTimestamp(history[1].timestamp);
    }

    diff(stateA, stateB) {
        const diff = { added: {}, removed: {}, changed: {} };
        
        for (const key of Object.keys(stateB)) {
            if (!(key in stateA)) {
                diff.added[key] = stateB[key];
            } else if (JSON.stringify(stateA[key]) !== JSON.stringify(stateB[key])) {
                diff.changed[key] = { from: stateA[key], to: stateB[key] };
            }
        }
        
        for (const key of Object.keys(stateA)) {
            if (!(key in stateB)) {
                diff.removed[key] = stateA[key];
            }
        }
        
        return diff;
    }

    async compactHistory(keepCount = 20) {
        try {
            const files = await fs.promises.readdir(this.historyPath);
            const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
            
            // 删除多余的旧文件
            const toDelete = jsonFiles.slice(keepCount);
            for (const file of toDelete) {
                await fs.promises.unlink(path.join(this.historyPath, file));
            }
            
            return { deleted: toDelete.length, kept: Math.min(keepCount, jsonFiles.length) };
        } catch (e) {
            console.error('[StateManager] Compact failed:', e);
            throw e;
        }
    }

    getStats() {
        return {
            currentStateKeys: Object.keys(this.currentState).length,
            transactionInProgress: this.isInTransaction,
            transactionDepth: this.transactionStack.length,
            historyCount: this._getCheckpointCount(),
            storagePath: this.storagePath,
            historyPath: this.historyPath
        };
    }

    // 私有方法

    async _loadPersisted() {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                const parsed = JSON.parse(data);
                this.currentState = parsed.state || {};
                console.log('[StateManager] State restored from checkpoint');
            }
        } catch (e) {
            console.log('[StateManager] No previous state found, starting fresh');
        }
    }

    async _saveToHistory(checkpointData) {
        const filename = `history_${Date.now()}_${Math.random().toString(36).substring(2, 2+5)}.json`;
        const filePath = path.join(this.historyPath, filename);
        
        await fs.promises.writeFile(filePath, JSON.stringify(checkpointData, null, 2));
        
        // 清理旧历史
        const files = await fs.promises.readdir(this.historyPath);
        if (files.length > this.maxHistory) {
            const sortedFiles = files.sort();
            const toDelete = sortedFiles.slice(0, files.length - this.maxHistory);
            for (const file of toDelete) {
                await fs.promises.unlink(path.join(this.historyPath, file));
            }
        }
    }

    _getCheckpointCount() {
        try {
            const files = fs.readdirSync(this.historyPath);
            return files.filter(f => f.endsWith('.json')).length;
        } catch (e) {
            return 0;
        }
    }
}

module.exports = StateManager;