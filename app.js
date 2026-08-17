// ==================== 巴法云配置 ====================
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    wsUrl: 'wss://bemfa.com:9504/wss',
    setTopic: 'juncang006/set',
    stateTopic: 'juncang006/state'
};

// ==================== 全局变量 ====================
let currentMode = 'AUTO';
let isManualMode = false;
let bemfaWs = null;
let bemfaConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

// ==================== DOM 引用 ====================
const $ = id => document.getElementById(id);
const logEl = $('log');

// ==================== 日志函数 ====================
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const lines = logEl.textContent.split('\n');
    if (lines.length > 100) {
        lines.splice(0, 20);
    }
    logEl.textContent = lines.join('\n') + '\n[' + time + '] ' + (isError ? '❌' : '✅') + msg;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==================== 更新继电器显示 ====================
function updateRelays(relay) {
    const names = ['cool', 'fan', 'humi', 'heat'];
    const icons = ['❄️', '🌀', '💦', '🔥'];
    names.forEach((n, i) => {
        const el = $('r-' + n);
        if (!el) return;
        const on = relay && relay[i] === 1;
        el.className = 'relay-item ' + (on ? 'on' : 'off');
        const statusEl = el.querySelector('.status');
        if (statusEl) {
            statusEl.textContent = on ? '● 开启' : '○ 关闭';
        }
        const iconEl = el.querySelector('.icon');
        if (iconEl) {
            iconEl.textContent = on ? icons[i] + '🔥' : icons[i];
        }
    });
}

// ==================== 更新界面数据 ====================
function updateUI(data) {
    if (!data) return;
    
    if (data.temp !== undefined) $('st').textContent = data.temp.toFixed(1);
    if (data.humi !== undefined) $('sh').textContent = data.humi.toFixed(1);
    if (data.co2 !== undefined) $('sc').textContent = data.co2;

    const sensorOk = data.sensorValid !== undefined ? data.sensorValid : true;
    $('sensorStatus').textContent = sensorOk ? '传感器:✅' : '传感器:❌';

    if (data.tMin !== undefined) {
        $('tMin').value = data.tMin;
        $('tMax').value = data.tMax;
        $('hMin').value = data.hMin;
        $('hMax').value = data.hMax;
        $('cMin').value = data.cMin;
        $('cMax').value = data.cMax;
    }

    if (data.mode) {
        currentMode = data.mode;
        isManualMode = (currentMode === 'MANUAL');
        $('modeDisplay').textContent = currentMode;
        $('modeBadge').textContent = currentMode;
        $('modeBadge').className = 'mode-badge ' + (isManualMode ? 'manual' : 'auto');
    }

    if (data.relay) {
        updateRelays(data.relay);
    }

    $('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// ==================== 发送指令（巴法云） ====================
function sendCommand(command) {
    log('📡 发送指令: ' + command);

    if (!bemfaConnected || !bemfaWs || bemfaWs.readyState !== WebSocket.OPEN) {
        log('❌ 巴法云未连接，指令发送失败', true);
        $('remoteStatus').textContent = '状态: ❌ 未连接';
        return false;
    }

    const msg = {
        type: 'publish',
        topic: BEMFA_CONFIG.setTopic,
        payload: command
    };
    bemfaWs.send(JSON.stringify(msg));
    log('✅ 指令已发送');
    $('remoteStatus').textContent = '状态: 指令已发送 ' + new Date().toLocaleTimeString();
    return true;
}

// ==================== 控制继电器（手动模式） ====================
function controlRelay(relay, state) {
    if (!isManualMode) {
        log('⚠️ 请先切换到手动模式', true);
        alert('请先切换到手动模式！');
        return;
    }
    sendCommand('M:' + relay + ',' + state);
}

// ==================== 切换模式 ====================
function setMode(mode) {
    sendCommand(mode);
    setTimeout(() => sendCommand('STATUS'), 500);
}

// ==================== 设置参数 ====================
function setParams() {
    const tMin = $('tMin').value;
    const tMax = $('tMax').value;
    const hMin = $('hMin').value;
    const hMax = $('hMax').value;
    const cMin = $('cMin').value;
    const cMax = $('cMax').value;

    if (parseFloat(tMin) >= parseFloat(tMax)) {
        alert('温度下限必须小于上限！');
        return;
    }
    if (parseFloat(hMin) >= parseFloat(hMax)) {
        alert('湿度下限必须小于上限！');
        return;
    }
    if (parseInt(cMin) >= parseInt(cMax)) {
        alert('CO₂下限必须小于上限！');
        return;
    }

    log('📤 设置参数...');
    const cmd = 'T:' + tMin + ',' + tMax;
    const cmd2 = 'H:' + hMin + ',' + hMax;
    const cmd3 = 'C:' + cMin + ',' + cMax;
    
    sendCommand(cmd);
    setTimeout(() => sendCommand(cmd2), 300);
    setTimeout(() => sendCommand(cmd3), 600);
    setTimeout(() => sendCommand('STATUS'), 1000);
}

// ==================== 恢复默认 ====================
function resetDefault() {
    if (!confirm('确认恢复出厂设置？')) return;
    log('↺ 恢复默认参数...');
    sendCommand('RST');
    setTimeout(() => sendCommand('STATUS'), 500);
}

// ==================== 巴法云 WebSocket 连接 ====================
function connectBemfa() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        log('⚠️ 重连次数过多，停止重连', true);
        $('remoteStatus').textContent = '状态: ❌ 连接失败';
        return;
    }

    try {
        log('🌐 连接巴法云...');
        $('remoteStatus').textContent = '状态: ⏳ 连接中...';
        
        bemfaWs = new WebSocket(BEMFA_CONFIG.wsUrl);

        const timeout = setTimeout(() => {
            if (bemfaWs && bemfaWs.readyState !== WebSocket.OPEN) {
                log('⚠️ 连接超时', true);
                bemfaWs.close();
            }
        }, 15000);

        bemfaWs.onopen = function() {
            clearTimeout(timeout);
            log('WebSocket 已连接，发送认证...');
            
            const connectMsg = {
                uid: BEMFA_CONFIG.userId,
                topic: BEMFA_CONFIG.topic
            };
            bemfaWs.send(JSON.stringify(connectMsg));
        };

        bemfaWs.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                
                if (data.msg === 'conn_success' || data.type === 'connected') {
                    bemfaConnected = true;
                    reconnectAttempts = 0;
                    log('✅ 巴法云连接成功');
                    $('remoteStatus').textContent = '状态: ✅ 已连接';
                    $('remoteStatus').style.color = '#48bb78';
                    $('badge').textContent = '已连接';
                    $('badge').className = 'badge on';
                    $('mqttStatus').textContent = 'MQTT:✅';
                    
                    // 订阅状态主题
                    const subMsg = {
                        type: 'subscribe',
                        topic: BEMFA_CONFIG.stateTopic
                    };
                    bemfaWs.send(JSON.stringify(subMsg));
                    log('📡 订阅: ' + BEMFA_CONFIG.stateTopic);
                    
                    // 请求状态
                    setTimeout(() => sendCommand('STATUS'), 1000);
                }
                else if (data.type === 'message' || data.msg === 'message') {
                    const payload = data.payload || data.data || '';
                    try {
                        const jsonData = JSON.parse(payload);
                        updateUI(jsonData);
                        log('📊 数据已更新');
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
                else if (data.type === 'ping') {
                    bemfaWs.send(JSON.stringify({ type: 'pong' }));
                }
                else if (data.type === 'error' || data.msg === 'error') {
                    log('❌ 错误: ' + (data.msg || data.data || '未知'), true);
                }
            } catch (e) {
                log('解析消息失败: ' + e.message, true);
            }
        };

        bemfaWs.onclose = function(event) {
            bemfaConnected = false;
            clearTimeout(timeout);
            log('⚠️ 断开连接 (code: ' + event.code + ')', true);
            $('remoteStatus').textContent = '状态: ❌ 已断开';
            $('remoteStatus').style.color = '#fc8181';
            $('badge').textContent = '离线';
            $('badge').className = 'badge off';
            $('mqttStatus').textContent = 'MQTT:❌';
            
            reconnectAttempts++;
            if (reconnectAttempts < MAX_RECONNECT) {
                const delay = Math.min(5000 * reconnectAttempts, 30000);
                log('🔄 ' + delay/1000 + '秒后重连 (第' + reconnectAttempts + '次)');
                setTimeout(connectBemfa, delay);
            }
        };

        bemfaWs.onerror = function(error) {
            log('❌ WebSocket错误', true);
        };

    } catch (e) {
        log('❌ 连接失败: ' + e.message, true);
        reconnectAttempts++;
        setTimeout(connectBemfa, 5000);
    }
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 按钮事件
    $('autoBtn').addEventListener('click', () => setMode('AUTO'));
    $('manualBtn').addEventListener('click', () => setMode('MANUAL'));

    // 回车触发应用
    document.querySelectorAll('.param-row input').forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') setParams();
        });
    });

    log('🚀 系统启动');
    log('🌐 巴法云地址: ' + BEMFA_CONFIG.wsUrl);

    // 连接巴法云
    setTimeout(connectBemfa, 1000);

    // 每10秒自动刷新状态
    setInterval(() => {
        if (bemfaConnected) {
            sendCommand('STATUS');
        }
    }, 10000);

    window.onerror = function(msg) {
        log('错误: ' + msg, true);
        return false;
    };
});

// ==================== 暴露全局函数 ====================
window.controlRelay = controlRelay;
window.setMode = setMode;
window.setParams = setParams;
window.resetDefault = resetDefault;
window.sendCommand = sendCommand;