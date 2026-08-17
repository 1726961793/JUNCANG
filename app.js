// ==================== 配置 ====================
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    wsUrl: 'wss://mqtt.bemfa.com/mqtt',  // 巴法云 WebSocket 地址
    setTopic: 'juncang006/set',
    stateTopic: 'juncang006/state'
};

// 局域网配置（用于与ESP32直连）
const DEVICE_IP = '192.168.1.100';  // 修改为你的ESP32 IP
const API_BASE = 'http://' + DEVICE_IP;

// ==================== 全局变量 ====================
let currentMode = 'AUTO';
let isManualMode = false;
let updateTimer = null;
let bemfaWs = null;
let bemfaConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

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
        const on = relay[i] === 1;
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

// ==================== API 请求（局域网） ====================
async function apiFetch(endpoint, options = {}) {
    try {
        const url = API_BASE + endpoint;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            // 添加超时
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        if (e.name !== 'AbortError') {
            log('请求失败: ' + e.message, true);
        }
        return null;
    }
}

// ==================== 获取状态 ====================
async function fetchStatus() {
    log('刷新状态...');
    const data = await apiFetch('/status');
    if (!data) {
        $('badge').textContent = '离线';
        $('badge').className = 'badge off';
        $('statusText').textContent = '❌ 连接失败';
        return;
    }

    $('st').textContent = data.temp.toFixed(1);
    $('sh').textContent = data.humi.toFixed(1);
    $('sc').textContent = data.co2;

    const sensorOk = data.sensorValid !== undefined ? data.sensorValid : true;
    $('sensorStatus').textContent = sensorOk ? '传感器:✅' : '传感器:❌';

    $('tMin').value = data.tMin;
    $('tMax').value = data.tMax;
    $('hMin').value = data.hMin;
    $('hMax').value = data.hMax;
    $('cMin').value = data.cMin;
    $('cMax').value = data.cMax;

    currentMode = data.mode || 'AUTO';
    isManualMode = (currentMode === 'MANUAL');
    $('modeDisplay').textContent = currentMode;
    $('modeBadge').textContent = currentMode;
    $('modeBadge').className = 'mode-badge ' + (isManualMode ? 'manual' : 'auto');

    const connected = data.wifiConnected || false;
    $('badge').textContent = connected ? '已连接' : '离线';
    $('badge').className = 'badge ' + (connected ? 'on' : 'off');
    $('deviceName').textContent = data.ip || '--';
    $('statusText').textContent = connected ? '✅ Wi-Fi已连接' : '❌ 未连接';
    $('mqttStatus').textContent = data.mqttConnected ? 'MQTT:✅' : 'MQTT:❌';

    if (data.relay) {
        updateRelays(data.relay);
    }

    $('lastUpdate').textContent = new Date().toLocaleTimeString();
    log('状态更新完成');
}

// ==================== 控制继电器（局域网） ====================
async function controlRelay(relay, state) {
    if (!isManualMode) {
        log('请先切换到手动模式', true);
        alert('请先切换到手动模式！');
        return;
    }
    log('控制 ' + relay + ' -> ' + (state ? '开启' : '关闭'));
    const data = await apiFetch('/relay?name=' + relay + '&state=' + state);
    if (data && data.success) {
        log('控制成功');
        setTimeout(fetchStatus, 300);
    } else {
        log('控制失败', true);
    }
}

// ==================== 切换模式（局域网） ====================
async function setMode(mode) {
    log('切换模式: ' + mode);
    const data = await apiFetch('/mode?mode=' + mode);
    if (data && data.success) {
        log('模式切换成功');
        setTimeout(fetchStatus, 500);
    } else {
        log('模式切换失败', true);
    }
}

// ==================== 设置参数（局域网） ====================
async function setParams() {
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

    log('应用参数...');
    const url = '/set?tMin=' + tMin + '&tMax=' + tMax +
        '&hMin=' + hMin + '&hMax=' + hMax +
        '&cMin=' + cMin + '&cMax=' + cMax;
    const data = await apiFetch(url);
    if (data && data.success) {
        log('参数应用成功');
        setTimeout(fetchStatus, 500);
    } else {
        log('参数应用失败', true);
    }
}

// ==================== 恢复默认 ====================
async function resetDefault() {
    if (!confirm('确认恢复出厂设置？')) return;
    log('恢复默认参数...');
    const data = await apiFetch('/reset');
    if (data && data.success) {
        log('恢复成功');
        setTimeout(fetchStatus, 500);
    } else {
        log('恢复失败', true);
    }
}

// ==================== 复位 ====================
async function sendReset() {
    if (!confirm('确认重启设备？')) return;
    log('发送复位指令...');
    const data = await apiFetch('/reset');
    if (data && data.success) {
        log('复位指令已发送');
    } else {
        log('复位指令发送失败', true);
    }
}

// ==================== 巴法云 WebSocket MQTT ====================
function connectBemfa() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        log('⚠️ 重连次数过多，停止重连', true);
        return;
    }

    try {
        log('🌐 连接巴法云 MQTT...');
        bemfaWs = new WebSocket(BEMFA_CONFIG.wsUrl);

        // 设置超时
        const timeout = setTimeout(() => {
            if (bemfaWs && bemfaWs.readyState !== WebSocket.OPEN) {
                log('⚠️ 连接超时', true);
                bemfaWs.close();
            }
        }, 10000);

        bemfaWs.onopen = function() {
            clearTimeout(timeout);
            log('WebSocket已连接，发送认证...');
            const connectMsg = {
                type: 'connect',
                userId: BEMFA_CONFIG.userId,
                topic: BEMFA_CONFIG.topic
            };
            bemfaWs.send(JSON.stringify(connectMsg));
        };

        bemfaWs.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                log('📩 收到: ' + event.data.substring(0, 100));
                
                if (data.type === 'connected') {
                    bemfaConnected = true;
                    reconnectAttempts = 0;
                    log('✅ 巴法云连接成功');
                    const remoteStatus = $('remoteStatus');
                    if (remoteStatus) {
                        remoteStatus.textContent = '状态: ✅ 已连接';
                        remoteStatus.style.color = '#48bb78';
                    }
                    // 订阅状态主题
                    const subMsg = {
                        type: 'subscribe',
                        topic: BEMFA_CONFIG.stateTopic
                    };
                    bemfaWs.send(JSON.stringify(subMsg));
                    log('📡 订阅主题: ' + BEMFA_CONFIG.stateTopic);
                    // 请求一次状态
                    setTimeout(() => sendRemoteCommand('STATUS'), 500);
                }
                else if (data.type === 'message') {
                    const payload = data.payload || '';
                    log('📩 收到状态数据');
                    try {
                        const jsonData = JSON.parse(payload);
                        if (jsonData.temp !== undefined) {
                            $('st').textContent = jsonData.temp.toFixed(1);
                        }
                        if (jsonData.humi !== undefined) {
                            $('sh').textContent = jsonData.humi.toFixed(1);
                        }
                        if (jsonData.co2 !== undefined) {
                            $('sc').textContent = jsonData.co2;
                        }
                        if (jsonData.relay) {
                            updateRelays(jsonData.relay);
                        }
                        if (jsonData.mode) {
                            const mode = jsonData.mode;
                            $('modeDisplay').textContent = mode;
                            $('modeBadge').textContent = mode;
                            $('modeBadge').className = 'mode-badge ' + (mode === 'MANUAL' ? 'manual' : 'auto');
                            isManualMode = (mode === 'MANUAL');
                            currentMode = mode;
                        }
                        if (jsonData.tMin !== undefined) {
                            $('tMin').value = jsonData.tMin;
                            $('tMax').value = jsonData.tMax;
                            $('hMin').value = jsonData.hMin;
                            $('hMax').value = jsonData.hMax;
                            $('cMin').value = jsonData.cMin;
                            $('cMax').value = jsonData.cMax;
                        }
                        $('lastUpdate').textContent = new Date().toLocaleTimeString();
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
                else if (data.type === 'ping') {
                    bemfaWs.send(JSON.stringify({ type: 'pong' }));
                }
                else if (data.type === 'error') {
                    log('❌ 巴法云错误: ' + (data.msg || '未知错误'), true);
                }
            } catch (e) {
                log('解析消息失败: ' + e.message, true);
            }
        };

        bemfaWs.onclose = function(event) {
            bemfaConnected = false;
            clearTimeout(timeout);
            log('⚠️ 巴法云断开 (code: ' + event.code + ')', true);
            const remoteStatus = $('remoteStatus');
            if (remoteStatus) {
                remoteStatus.textContent = '状态: ❌ 已断开';
                remoteStatus.style.color = '#fc8181';
            }
            reconnectAttempts++;
            const delay = Math.min(3000 * reconnectAttempts, 30000);
            log('🔄 ' + delay/1000 + '秒后重连 (第' + reconnectAttempts + '次)');
            setTimeout(connectBemfa, delay);
        };

        bemfaWs.onerror = function(error) {
            log('❌ WebSocket错误: ' + (error.message || '未知错误'), true);
        };

    } catch (e) {
        log('❌ 连接失败: ' + e.message, true);
        reconnectAttempts++;
        setTimeout(connectBemfa, 5000);
    }
}

// ==================== 发送远程指令（巴法云） ====================
function sendRemoteCommand(command) {
    log('📡 发送指令: ' + command);

    if (bemfaConnected && bemfaWs && bemfaWs.readyState === WebSocket.OPEN) {
        const msg = {
            type: 'publish',
            topic: BEMFA_CONFIG.setTopic,
            payload: command
        };
        bemfaWs.send(JSON.stringify(msg));
        log('✅ 远程指令已发送');
        const remoteStatus = $('remoteStatus');
        if (remoteStatus) {
            remoteStatus.textContent = '状态: 指令已发送 ' + new Date().toLocaleTimeString();
        }
        return true;
    }

    // 降级方案：通过局域网ESP32转发
    log('⚠️ 巴法云未连接，尝试通过局域网控制...', true);
    apiFetch('/mqtt?cmd=' + encodeURIComponent(command))
        .then(data => {
            if (data && data.success) {
                log('✅ 局域网转发成功');
            } else {
                log('❌ 局域网转发失败', true);
            }
        });
    return false;
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 模式切换按钮
    $('autoBtn').addEventListener('click', () => setMode('AUTO'));
    $('manualBtn').addEventListener('click', () => setMode('MANUAL'));

    // 输入框回车触发应用
    document.querySelectorAll('.param-row input').forEach(input => {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                setParams();
            }
        });
    });

    // 启动
    log('🚀 系统启动');

    // 尝试局域网连接
    fetchStatus();

    // 延迟连接巴法云
    setTimeout(connectBemfa, 2000);

    // 每3秒自动刷新
    updateTimer = setInterval(fetchStatus, 3000);

    // 页面可见时刷新
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            fetchStatus();
        }
    });

    // 错误处理
    window.onerror = function(msg, url, line, col, error) {
        log('错误: ' + msg, true);
        return false;
    };
});

// ==================== 暴露全局函数 ====================
window.controlRelay = controlRelay;
window.setMode = setMode;
window.setParams = setParams;
window.resetDefault = resetDefault;
window.sendReset = sendReset;
window.fetchStatus = fetchStatus;
window.sendRemoteCommand = sendRemoteCommand;
