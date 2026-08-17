// ==================== 配置 ====================
// 修改为你的设备IP地址（查看串口监视器获取）
const DEVICE_IP = '192.168.1.100';  // ← 修改这里
const API_BASE = 'http://' + DEVICE_IP;

// 巴法云MQTT配置（用于远程控制）
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    // 注意：巴法云WebSocket MQTT地址
    wsUrl: 'wss://mqtt.bemfa.com/mqtt'
};

// ==================== 全局变量 ====================
let currentMode = 'AUTO';
let isManualMode = false;
let updateTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ==================== DOM 引用 ====================
const $ = id => document.getElementById(id);
const logEl = $('log');
const badge = $('badge');
const modeBadge = $('modeBadge');
const modeDisplay = $('modeDisplay');
const statusText = $('statusText');
const mqttStatus = $('mqttStatus');
const sensorStatus = $('sensorStatus');
const deviceName = $('deviceName');
const lastUpdate = $('lastUpdate');

// ==================== 日志函数 ====================
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const prefix = isError ? '❌' : '✅';
    const lines = logEl.textContent.split('\n');
    if (lines.length > 100) {
        lines.splice(0, 20);
    }
    logEl.textContent = lines.join('\n') + '\n[' + time + '] ' + (isError ? '❌' : '') + msg;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==================== API 请求 ====================
async function apiFetch(endpoint, options = {}) {
    try {
        const url = API_BASE + endpoint;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        log('请求失败: ' + e.message, true);
        return null;
    }
}

// ==================== 获取状态 ====================
async function fetchStatus() {
    log('刷新状态...');
    const data = await apiFetch('/status');
    if (!data) {
        badge.textContent = '离线';
        badge.className = 'badge off';
        statusText.textContent = '❌ 连接失败';
        return;
    }

    // 更新传感器数据
    $('st').textContent = data.temp.toFixed(1);
    $('sh').textContent = data.humi.toFixed(1);
    $('sc').textContent = data.co2;

    // 传感器状态
    const sensorOk = data.sensorValid !== undefined ? data.sensorValid : true;
    sensorStatus.textContent = sensorOk ? '传感器:✅' : '传感器:❌';

    // 更新参数输入框
    $('tMin').value = data.tMin;
    $('tMax').value = data.tMax;
    $('hMin').value = data.hMin;
    $('hMax').value = data.hMax;
    $('cMin').value = data.cMin;
    $('cMax').value = data.cMax;

    // 更新模式
    currentMode = data.mode || 'AUTO';
    isManualMode = (currentMode === 'MANUAL');
    modeDisplay.textContent = currentMode;
    modeBadge.textContent = currentMode;
    modeBadge.className = 'mode-badge ' + (isManualMode ? 'manual' : 'auto');

    // 更新连接状态
    const connected = data.wifiConnected || false;
    badge.textContent = connected ? '已连接' : '离线';
    badge.className = 'badge ' + (connected ? 'on' : 'off');
    deviceName.textContent = data.ip || '--';
    statusText.textContent = connected ? '✅ Wi-Fi已连接' : '❌ 未连接';
    mqttStatus.textContent = data.mqttConnected ? 'MQTT:✅' : 'MQTT:❌';

    // 更新继电器状态
    if (data.relay) {
        updateRelays(data.relay);
    }

    // 更新时间
    lastUpdate.textContent = new Date().toLocaleTimeString();

    log('状态更新完成');
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

// ==================== 控制继电器 ====================
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

// ==================== 切换模式 ====================
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

// ==================== 设置参数 ====================
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

// ==================== 远程控制（巴法云） ====================
async function sendRemoteCommand(command) {
    log('📡 发送远程指令: ' + command);
    
    // 通过ESP32的Web API转发MQTT指令
    const data = await apiFetch('/mqtt?cmd=' + encodeURIComponent(command));
    
    if (data && data.success) {
        log('✅ 远程指令发送成功');
        $('remoteStatus').textContent = '状态: 指令已发送 ' + new Date().toLocaleTimeString();
        // 等待一下再刷新状态
        setTimeout(fetchStatus, 1000);
    } else {
        log('❌ 远程指令发送失败', true);
        $('remoteStatus').textContent = '状态: 发送失败';
    }
}

// ==================== 事件绑定 ====================
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
    log('📡 目标设备: ' + API_BASE);
    fetchStatus();

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

// ==================== 暴露全局函数供HTML调用 ====================
window.controlRelay = controlRelay;
window.setMode = setMode;
window.setParams = setParams;
window.resetDefault = resetDefault;
window.sendReset = sendReset;
window.fetchStatus = fetchStatus;
window.sendRemoteCommand = sendRemoteCommand;