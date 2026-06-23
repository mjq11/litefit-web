/* ==========================================================================
   轻盈减脂助手 (LiteFit) - 业务逻辑与控制器
   ========================================================================== */

// 1. 全局状态 State
let state = {
    profile: {
        gender: 'male',
        age: 25,
        height: 175,
        weight: 75.0,
        targetWeight: 68.0,
        activity: 1.375, // 轻度运动
        speed: 500, // 标准减脂 (每日热量缺口 500 kcal)
        budget: 1800 // 默认预算卡路里
    },
    water: {
        current: 0,
        target: 2000
    },
    fasting: {
        isActive: false,
        planHours: 16,
        startTime: null,
        endTime: null
    },
    logs: [] // 历史打卡日志
};

// SVG 环形进度条的周长参数 (基于圆半径 r 计算: 2 * PI * r)
const CALORIE_RING_CIRCUMFERENCE = 2 * Math.PI * 76; // 477.5
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * 95;   // 596.9

// 图表实例变量
let weightChartInstance = null;
let calorieChartInstance = null;

// 断食倒计时定时器
let fastingTimerInterval = null;

// 2. 初始化演示数据 (让用户在第一次打开应用时看到精美的图表效果)
function initDemoData() {
    state.logs = []; // 初始无记录，保持纯净空状态
    state.water = { current: 0, target: 2000 };
    state.fasting = { isActive: false, planHours: 16, startTime: null, endTime: null };
    
    // 保存初始数据
    saveStateToLocalStorage();
}

// 3. 数据持久化 (LocalStorage)
function saveStateToLocalStorage() {
    localStorage.setItem('litefit_state', JSON.stringify(state));
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem('litefit_state');
    if (saved) {
        try {
            state = JSON.parse(saved);
            // 兼容性防呆设计：如果某些必要字段丢失，补充默认值
            if (!state.profile) state.profile = {};
            if (!state.water) state.water = { current: 0, target: 2000 };
            if (!state.fasting) state.fasting = { isActive: false, planHours: 16, startTime: null, endTime: null };
            if (!state.logs) state.logs = [];
        } catch (e) {
            console.error('加载本地存储失败，重置为默认值。', e);
            initDemoData();
        }
    } else {
        // 无数据，则初始化演示数据，增加体验感
        initDemoData();
    }
}

// 4. 计算器核心逻辑 (BMR / TDEE / 推荐热量预算)
function calculateFitnessMetrics(gender, age, height, weight, targetWeight, activity, speed) {
    // 1. BMI 计算
    const heightInMeters = height / 100;
    const bmi = (weight / (heightInMeters * heightInMeters)).toFixed(1);
    
    // 2. BMR 计算 (Mifflin-St Jeor 公式)
    let bmr = 0;
    if (gender === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }
    bmr = Math.round(bmr);
    
    // 3. TDEE 计算 (基础代谢率 * 日常活动系数)
    const tdee = Math.round(bmr * parseFloat(activity));
    
    // 4. 推荐每日卡路里预算 (TDEE - 热量缺口)
    // 限制：卡路里预算不能低于基础代谢率的 0.9 倍，以保障基本健康
    let budget = tdee - parseInt(speed);
    const minHealthyBudget = Math.round(bmr * 0.9);
    if (budget < minHealthyBudget) {
        budget = minHealthyBudget;
    }
    
    return {
        bmi: parseFloat(bmi),
        bmr,
        tdee,
        budget
    };
}

// 5. DOM 元素获取与事件绑定
document.addEventListener('DOMContentLoaded', () => {
    // 页面初次加载
    loadStateFromLocalStorage();
    
    // 初始化各个 Tab 切换
    initNavigation();
    
    // 初始化个人设置表单默认值
    initProfileForm();
    
    // 渲染今日面板和喝水进度
    updateTodayDashboard();
    
    // 重新开启断食定时器（如果刷新页面前是断食进行中）
    resumeFastingTimer();
    
    // 渲染图表和日志
    renderAllCharts();
    renderHistoryLogs();
    
    // 绑定模态框交互
    initModalEvents();
    
    // 绑定喝水按钮
    initWaterEvents();
    
    // 绑定断食交互
    initFastingEvents();
    
    // 绑定备份和数据重置交互
    initDataManageEvents();
});

// ==========================================
// 模块 A: 导航 Tab 切换
// ==========================================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            
            // 切换 Nav Button 激活状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 切换页面 Content 激活状态
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');
            
            // 如果切换到“趋势”，重新渲染图表以自适应宽度
            if (targetTab === 'tab-analytics') {
                setTimeout(() => {
                    renderAllCharts();
                    renderHistoryLogs();
                }, 50);
            }
        });
    });
}

// ==========================================
// 模块 B: 今日概览 Dashboard 渲染与逻辑
// ==========================================
function updateTodayDashboard() {
    const today = new Date().toDateString();
    
    // 1. 从日志中过滤出今天的饮食和运动
    let todayIntake = 0;
    let todayBurn = 0;
    let todayWeight = '--.-';
    
    state.logs.forEach(log => {
        const logDate = new Date(log.timestamp).toDateString();
        if (logDate === today) {
            if (log.type === 'food') {
                todayIntake += log.value;
            } else if (log.type === 'exercise') {
                todayBurn += log.value;
            } else if (log.type === 'weight') {
                todayWeight = log.value.toFixed(1);
            }
        }
    });

    // 2. 如果今天没有打卡体重，寻找历史上最近的一条体重记录
    if (todayWeight === '--.-') {
        const weightLogs = state.logs.filter(log => log.type === 'weight');
        if (weightLogs.length > 0) {
            // 按时间排序，获取最新的一条
            weightLogs.sort((a, b) => b.timestamp - a.timestamp);
            todayWeight = weightLogs[0].value.toFixed(1);
        }
    }
    
    // 3. 计算剩余卡路里
    const targetBudget = state.profile.budget || 1800;
    const remainingCalorie = targetBudget - todayIntake + todayBurn;
    
    // 4. 更新 DOM 文字
    document.getElementById('calorie-target').textContent = targetBudget;
    document.getElementById('calorie-intake').textContent = todayIntake;
    document.getElementById('calorie-burn').textContent = todayBurn;
    document.getElementById('calorie-remaining').textContent = remainingCalorie;
    
    document.getElementById('dash-intake-val').textContent = todayIntake;
    document.getElementById('dash-burn-val').textContent = todayBurn;
    document.getElementById('dash-weight-val').textContent = todayWeight;
    
    // 5. 更新大卡路里环进度条
    const ringBar = document.getElementById('progress-ring-bar');
    // 计算百分比：已摄入扣除运动后的净摄入量占目标的比例
    const netIntake = Math.max(0, todayIntake - todayBurn);
    let progressPercent = netIntake / targetBudget;
    if (progressPercent > 1) progressPercent = 1;
    if (progressPercent < 0) progressPercent = 0;
    
    const strokeOffset = CALORIE_RING_CIRCUMFERENCE - (progressPercent * CALORIE_RING_CIRCUMFERENCE);
    ringBar.style.strokeDasharray = `${CALORIE_RING_CIRCUMFERENCE} ${CALORIE_RING_CIRCUMFERENCE}`;
    ringBar.style.strokeDashoffset = strokeOffset;
    
    // 6. 更新喝水进度和波浪
    updateWaterUI();
}

// 喝水 UI 控制
function updateWaterUI() {
    const currentWater = state.water.current;
    const targetWater = state.water.target;
    
    document.getElementById('water-current').textContent = currentWater;
    document.getElementById('water-target').textContent = targetWater;
    
    const waveHeightPercent = Math.min(100, (currentWater / targetWater) * 100);
    document.getElementById('water-wave-element').style.height = `${waveHeightPercent}%`;
}

function initWaterEvents() {
    const btnDrink = document.getElementById('btn-drink-water');
    const btnReset = document.getElementById('btn-reset-water');
    
    btnDrink.addEventListener('click', () => {
        state.water.current += 250;
        
        // 播放酷炫纸屑动效 (达到喝水目标时)
        if (state.water.current >= state.water.target && state.water.current - 250 < state.water.target) {
            triggerConfetti();
        }
        
        saveStateToLocalStorage();
        updateWaterUI();
    });
    
    btnReset.addEventListener('click', () => {
        state.water.current = 0;
        saveStateToLocalStorage();
        updateWaterUI();
    });
}

// ==========================================
// 模块 C: 间歇性断食 (Fasting) 计时逻辑
// ==========================================
function initFastingEvents() {
    const btnToggle = document.getElementById('btn-toggle-fasting');
    const planRadios = document.querySelectorAll('input[name="fasting-plan"]');
    const planOptions = document.querySelectorAll('.plan-option');
    
    // 监听断食方案单选按钮的更改
    planRadios.forEach((radio, index) => {
        radio.addEventListener('change', (e) => {
            if (state.fasting.isActive) {
                // 断食进行中，恢复前一个状态的 radio 选择，且给予提示
                alert('您正在进行断食，不能更改方案。如需更改，请先结束当前断食。');
                // 恢复为 state.fasting.planHours
                planRadios.forEach(r => {
                    r.checked = (parseInt(r.value) === state.fasting.planHours);
                });
                return;
            }
            
            planOptions.forEach(opt => opt.classList.remove('active'));
            planOptions[index].classList.add('active');
            state.fasting.planHours = parseInt(e.target.value);
            saveStateToLocalStorage();
        });
    });

    btnToggle.addEventListener('click', () => {
        if (!state.fasting.isActive) {
            // 开始断食
            startFasting();
        } else {
            // 结束断食
            if (confirm('确定要现在结束当前的断食吗？')) {
                endFasting();
            }
        }
    });
}

function startFasting() {
    const now = Date.now();
    const planHours = state.fasting.planHours;
    
    state.fasting.isActive = true;
    state.fasting.startTime = now;
    state.fasting.endTime = now + (planHours * 3600 * 1000);
    
    saveStateToLocalStorage();
    
    // 切换按钮状态和开始计时器
    document.getElementById('btn-toggle-fasting').textContent = '结束断食';
    document.getElementById('btn-toggle-fasting').className = 'btn btn-outline-pink btn-lg';
    
    document.getElementById('fasting-time-info').style.display = 'flex';
    document.getElementById('fasting-start-time').textContent = formatTimeStr(new Date(state.fasting.startTime));
    document.getElementById('fasting-end-time').textContent = formatTimeStr(new Date(state.fasting.endTime));
    
    startCountdownLoop();
}

function endFasting() {
    clearInterval(fastingTimerInterval);
    
    const now = Date.now();
    const elapsedMs = now - state.fasting.startTime;
    const elapsedHours = elapsedMs / (3600 * 1000);
    const targetHours = state.fasting.planHours;
    const successRatio = elapsedHours / targetHours;
    
    // 弹出提示展示本次断食结果
    const formattedElapsed = formatElapsedHours(elapsedMs);
    let message = `您本次断食持续了 ${formattedElapsed}。`;
    
    if (successRatio >= 1) {
        message += `\n恭喜！您超额完成了本次断食目标（目标 ${targetHours} 小时）！身体脂肪正在快速分解。🔥`;
        triggerConfetti();
    } else {
        message += `\n本次完成了目标的 ${(successRatio * 100).toFixed(0)}%，下次继续加油！💪`;
    }
    
    alert(message);
    
    // 将这次断食记录保存进日志中
    state.logs.push({
        id: `fasting-${Date.now()}`,
        type: 'exercise', // 断食暂时归类为消耗类日志，代表健康支出
        timestamp: now,
        value: Math.round(elapsedHours * 40), // 估算断食额外消耗（每小时约40kcal）
        extra: `间歇断食 (${targetHours}小时方案，实际持续 ${formattedElapsed})`
    });
    
    // 重置断食状态
    state.fasting.isActive = false;
    state.fasting.startTime = null;
    state.fasting.endTime = null;
    
    saveStateToLocalStorage();
    
    // 重置 UI
    document.getElementById('btn-toggle-fasting').textContent = '开始断食';
    document.getElementById('btn-toggle-fasting').className = 'btn btn-purple btn-lg';
    document.getElementById('fasting-time-info').style.display = 'none';
    document.getElementById('fasting-state-label').textContent = '未开始';
    document.getElementById('fasting-countdown').textContent = '00:00:00';
    document.getElementById('fasting-time-type').textContent = '断食倒计时';
    
    // 重置表盘圆环
    const timerRing = document.getElementById('timer-ring-bar');
    timerRing.style.strokeDashoffset = TIMER_RING_CIRCUMFERENCE;
    
    // 重置科普卡片高亮
    document.querySelectorAll('.stage-item').forEach(item => item.classList.remove('active'));
    
    // 更新今日页面上的热量
    updateTodayDashboard();
}

function resumeFastingTimer() {
    if (state.fasting.isActive) {
        // 设置方案单选状态
        const planRadios = document.querySelectorAll('input[name="fasting-plan"]');
        const planOptions = document.querySelectorAll('.plan-option');
        planRadios.forEach((radio, index) => {
            if (parseInt(radio.value) === state.fasting.planHours) {
                radio.checked = true;
                planOptions.forEach(opt => opt.classList.remove('active'));
                planOptions[index].classList.add('active');
            }
        });
        
        document.getElementById('btn-toggle-fasting').textContent = '结束断食';
        document.getElementById('btn-toggle-fasting').className = 'btn btn-outline-pink btn-lg';
        
        document.getElementById('fasting-time-info').style.display = 'flex';
        document.getElementById('fasting-start-time').textContent = formatTimeStr(new Date(state.fasting.startTime));
        document.getElementById('fasting-end-time').textContent = formatTimeStr(new Date(state.fasting.endTime));
        
        startCountdownLoop();
    }
}

function startCountdownLoop() {
    // 先立即运行一次，避免 1s 延迟
    updateCountdownUI();
    fastingTimerInterval = setInterval(updateCountdownUI, 1000);
}

function updateCountdownUI() {
    if (!state.fasting.isActive) return;
    
    const now = Date.now();
    const startTime = state.fasting.startTime;
    const endTime = state.fasting.endTime;
    const targetDurationMs = endTime - startTime;
    
    // 计算已用时间和剩余时间
    const elapsedMs = Math.max(0, now - startTime);
    const remainingMs = Math.max(0, endTime - now);
    
    const elapsedHours = elapsedMs / (3600 * 1000);
    
    // 渲染倒计时文本
    let countdownText = '';
    let stateLabel = '断食中';
    let timeTypeLabel = '断食倒计时';
    
    if (remainingMs > 0) {
        countdownText = formatMsToHMS(remainingMs);
        stateLabel = '断食中';
        timeTypeLabel = '距进食区间还有';
    } else {
        // 超出目标时间，变成正向计时，代表已经进入超额断食
        const excessMs = now - endTime;
        countdownText = formatMsToHMS(excessMs);
        stateLabel = '超额断食';
        timeTypeLabel = '已超额持续';
    }
    
    document.getElementById('fasting-countdown').textContent = countdownText;
    document.getElementById('fasting-state-label').textContent = stateLabel;
    document.getElementById('fasting-time-type').textContent = timeTypeLabel;
    
    // 更新环形进度条
    let progressPercent = elapsedMs / targetDurationMs;
    if (progressPercent > 1) progressPercent = 1; // 满圈后不溢出
    
    const timerRing = document.getElementById('timer-ring-bar');
    const strokeOffset = TIMER_RING_CIRCUMFERENCE - (progressPercent * TIMER_RING_CIRCUMFERENCE);
    timerRing.style.strokeDasharray = `${TIMER_RING_CIRCUMFERENCE} ${TIMER_RING_CIRCUMFERENCE}`;
    timerRing.style.strokeDashoffset = strokeOffset;
    
    // 更新身体科普的高亮状态
    updateScienceStages(elapsedHours);
}

function updateScienceStages(elapsedHours) {
    const stages = [
        { id: 4, hoursMin: 0, hoursMax: 4 },
        { id: 8, hoursMin: 4, hoursMax: 12 },
        { id: 12, hoursMin: 12, hoursMax: 18 },
        { id: 18, hoursMin: 18, hoursMax: 999 }
    ];
    
    const stageItems = document.querySelectorAll('.stage-item');
    
    stages.forEach((stage, index) => {
        const item = stageItems[index];
        if (elapsedHours >= stage.hoursMin) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// 辅助格式化时间方法
function formatTimeStr(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatMsToHMS(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return `${hours}:${secs}:${mins}`; // 考虑到大字号，按 HH:MM:SS 排布更好
}

function formatElapsedHours(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    return `${hours}小时${mins}分钟`;
}

// ==========================================
// 模块 D: 记录与打卡弹出层 (Modal Events)
// ==========================================
function initModalEvents() {
    // 饮食 Modal 绑定
    bindModal('btn-add-food', 'modal-food', 'modal-food-close');
    // 运动 Modal 绑定
    bindModal('btn-add-exercise', 'modal-exercise', 'modal-exercise-close');
    // 体重 Modal 绑定
    bindModal('btn-record-weight', 'modal-weight', 'modal-weight-close');
    
    // 提交表单 1: 饮食
    document.getElementById('food-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const type = document.getElementById('food-type').value;
        const name = document.getElementById('food-name').value.trim();
        const calories = parseInt(document.getElementById('food-calories').value);
        
        let typeText = '午餐';
        if (type === 'breakfast') typeText = '早餐';
        else if (type === 'dinner') typeText = '晚餐';
        else if (type === 'snack') typeText = '加餐';
        
        const description = name ? `${typeText} (${name})` : `${typeText}`;
        
        state.logs.push({
            id: `food-${Date.now()}`,
            type: 'food',
            timestamp: Date.now(),
            value: calories,
            extra: description
        });
        
        saveStateToLocalStorage();
        updateTodayDashboard();
        closeModal('modal-food');
        
        // 每次记录饮食后重置表单
        document.getElementById('food-form').reset();
        
        // 触发酷炫庆祝动效
        triggerConfetti();
    });
    
    // 提交表单 2: 运动
    document.getElementById('exercise-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('exercise-name').value.trim();
        const calories = parseInt(document.getElementById('exercise-calories').value);
        const duration = document.getElementById('exercise-duration').value;
        
        const extraText = duration ? `${name} (时长 ${duration} 分钟)` : name;
        
        state.logs.push({
            id: `exer-${Date.now()}`,
            type: 'exercise',
            timestamp: Date.now(),
            value: calories,
            extra: extraText
        });
        
        saveStateToLocalStorage();
        updateTodayDashboard();
        closeModal('modal-exercise');
        
        document.getElementById('exercise-form').reset();
        triggerConfetti();
    });
    
    // 提交表单 3: 体重
    document.getElementById('weight-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const weight = parseFloat(document.getElementById('weight-value').value);
        const bodyfat = document.getElementById('bodyfat-value').value;
        
        const extraText = bodyfat ? `体脂率: ${bodyfat}%` : null;
        
        state.logs.push({
            id: `weight-${Date.now()}`,
            type: 'weight',
            timestamp: Date.now(),
            value: weight,
            extra: extraText
        });
        
        // 同时同步更新个人资料中的当前体重，这会使下一次计算时默认填写此权重
        state.profile.weight = weight;
        
        // 重新计算 TDEE
        recalculateAndSaveProfile();
        
        saveStateToLocalStorage();
        updateTodayDashboard();
        closeModal('modal-weight');
        
        document.getElementById('weight-form').reset();
        triggerConfetti();
    });
}

// 模态框辅助控制
function bindModal(triggerId, modalId, closeId) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);
    
    trigger.addEventListener('click', () => {
        modal.classList.add('active');
        
        // 如果是体重弹窗，默认带入之前的最新体重
        if (modalId === 'modal-weight') {
            const weightLogs = state.logs.filter(log => log.type === 'weight');
            if (weightLogs.length > 0) {
                weightLogs.sort((a, b) => b.timestamp - a.timestamp);
                document.getElementById('weight-value').value = weightLogs[0].value;
            } else if (state.profile.weight) {
                document.getElementById('weight-value').value = state.profile.weight;
            }
        }
    });
    
    close.addEventListener('click', () => {
        closeModal(modalId);
    });
    
    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal(modalId);
        }
    });
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ==========================================
// 模块 E: 身体档案与计算器 (Calculator & Profile)
// ==========================================
function initProfileForm() {
    const profile = state.profile;
    
    if (profile.gender) document.getElementById('calc-gender').value = profile.gender;
    if (profile.age) document.getElementById('calc-age').value = profile.age;
    if (profile.height) document.getElementById('calc-height').value = profile.height;
    if (profile.weight) document.getElementById('calc-weight').value = profile.weight;
    if (profile.targetWeight) document.getElementById('calc-target-weight').value = profile.targetWeight;
    if (profile.activity) document.getElementById('calc-activity').value = profile.activity;
    if (profile.speed) document.getElementById('calc-plan-speed').value = profile.speed;
    
    // 如果已经有个人档案计算数据，显示计算结果卡片
    if (profile.bmi) {
        showCalculatorResults(profile.bmi, profile.bmr, profile.tdee, profile.budget);
    }

    // 绑定计算表单提交
    document.getElementById('calculator-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const gender = document.getElementById('calc-gender').value;
        const age = parseInt(document.getElementById('calc-age').value);
        const height = parseInt(document.getElementById('calc-height').value);
        const weight = parseFloat(document.getElementById('calc-weight').value);
        const targetWeight = parseFloat(document.getElementById('calc-target-weight').value);
        const activity = parseFloat(document.getElementById('calc-activity').value);
        const speed = parseInt(document.getElementById('calc-plan-speed').value);
        
        const metrics = calculateFitnessMetrics(gender, age, height, weight, targetWeight, activity, speed);
        
        // 存入 state
        state.profile = {
            gender,
            age,
            height,
            weight,
            targetWeight,
            activity,
            speed,
            bmi: metrics.bmi,
            bmr: metrics.bmr,
            tdee: metrics.tdee,
            budget: metrics.budget
        };
        
        saveStateToLocalStorage();
        
        // 更新 UI
        showCalculatorResults(metrics.bmi, metrics.bmr, metrics.tdee, metrics.budget);
        updateTodayDashboard();
        
        triggerConfetti();
        
        // 自动滚动到计算结果
        document.getElementById('calc-results-card').scrollIntoView({ behavior: 'smooth' });
    });
}

// 供体重变动时自动重新计算卡路里预算使用
function recalculateAndSaveProfile() {
    const prof = state.profile;
    if (!prof.height || !prof.age || !prof.gender) return;
    
    const metrics = calculateFitnessMetrics(
        prof.gender,
        prof.age,
        prof.height,
        prof.weight,
        prof.targetWeight || prof.weight,
        prof.activity || 1.375,
        prof.speed || 500
    );
    
    state.profile.bmi = metrics.bmi;
    state.profile.bmr = metrics.bmr;
    state.profile.tdee = metrics.tdee;
    state.profile.budget = metrics.budget;
    
    saveStateToLocalStorage();
    
    // 更新设置页面中的输入框和计算结果
    document.getElementById('calc-weight').value = prof.weight;
    showCalculatorResults(metrics.bmi, metrics.bmr, metrics.tdee, metrics.budget);
}

function showCalculatorResults(bmi, bmr, tdee, budget) {
    const resCard = document.getElementById('calc-results-card');
    resCard.style.display = 'block';
    
    document.getElementById('res-bmi').textContent = bmi;
    document.getElementById('res-bmr').textContent = bmr;
    document.getElementById('res-tdee').textContent = tdee;
    document.getElementById('res-budget').textContent = budget;
    
    // 渲染 BMI 等级标签
    const bmiTag = document.getElementById('res-bmi-tag');
    bmiTag.className = 'res-badge';
    
    if (bmi < 18.5) {
        bmiTag.textContent = '体重过轻';
        bmiTag.classList.add('badge-underweight');
    } else if (bmi >= 18.5 && bmi < 24) {
        bmiTag.textContent = '健康正常';
        bmiTag.classList.add('badge-normal');
    } else if (bmi >= 24 && bmi < 28) {
        bmiTag.textContent = '超重';
        bmiTag.classList.add('badge-overweight');
    } else {
        bmiTag.textContent = '肥胖度高';
        bmiTag.classList.add('badge-obese');
    }
}

// ==========================================
// 模块 F: 趋势分析与 Chart.js 渲染
// ==========================================
function renderAllCharts() {
    renderWeightChart();
    renderCalorieComparisonChart();
}

function renderWeightChart() {
    const ctx = document.getElementById('weightChart').getContext('2d');
    
    // 1. 获取所有的体重记录并排序
    const weightLogs = state.logs
        .filter(log => log.type === 'weight')
        .sort((a, b) => a.timestamp - b.timestamp);
        
    // 限制在图表只展示最新的 10 条，以防止图表拥挤
    const recentLogs = weightLogs.slice(-10);
    
    const labels = recentLogs.map(log => {
        const d = new Date(log.timestamp);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    
    const dataPoints = recentLogs.map(log => log.value);
    
    // 计算减重总额并渲染
    if (weightLogs.length >= 2) {
        const startW = weightLogs[0].value;
        const currentW = weightLogs[weightLogs.length - 1].value;
        const loss = (startW - currentW).toFixed(1);
        if (loss >= 0) {
            document.getElementById('weight-loss-total').textContent = `累计减重: ${loss} kg`;
        } else {
            document.getElementById('weight-loss-total').textContent = `累计增重: ${Math.abs(loss)} kg`;
        }
    } else {
        document.getElementById('weight-loss-total').textContent = `累计减重: 0.0 kg`;
    }

    if (weightChartInstance) {
        weightChartInstance.destroy();
    }
    
    // 渐变填充背景
    const fillGradient = ctx.createLinearGradient(0, 0, 0, 200);
    fillGradient.addColorStop(0, 'rgba(236, 72, 153, 0.25)');
    fillGradient.addColorStop(1, 'rgba(236, 72, 153, 0)');

    weightChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '体重 (kg)',
                data: dataPoints,
                borderColor: '#ec4899',
                borderWidth: 3,
                pointBackgroundColor: '#ec4899',
                pointBorderColor: '#fff',
                pointHoverRadius: 6,
                pointRadius: 4,
                tension: 0.35,
                fill: true,
                backgroundColor: fillGradient
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                }
            }
        }
    });
}

function renderCalorieComparisonChart() {
    const ctx = document.getElementById('calorieChart').getContext('2d');
    
    // 获取过去 7 天的日期数组 (格式: MM/DD)
    const dates = [];
    const dateKeys = []; // 格式: YYYY-MM-DD
    const today = new Date();
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
        dateKeys.push(d.toDateString());
    }
    
    // 初始化每日卡路里统计
    const dailyIntake = Array(7).fill(0);
    const dailyBurn = Array(7).fill(0);
    
    state.logs.forEach(log => {
        const logDateStr = new Date(log.timestamp).toDateString();
        const index = dateKeys.indexOf(logDateStr);
        if (index !== -1) {
            if (log.type === 'food') {
                dailyIntake[index] += log.value;
            } else if (log.type === 'exercise') {
                dailyBurn[index] += log.value;
            }
        }
    });

    if (calorieChartInstance) {
        calorieChartInstance.destroy();
    }

    calorieChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [
                {
                    label: '摄入',
                    data: dailyIntake,
                    backgroundColor: '#10b981',
                    borderRadius: 4,
                    barThickness: 10
                },
                {
                    label: '运动消耗',
                    data: dailyBurn,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 4,
                    barThickness: 10
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                }
            }
        }
    });
}

// 渲染历史打卡日志
function renderHistoryLogs() {
    const container = document.getElementById('history-items-container');
    container.innerHTML = '';
    
    if (state.logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-list empty-icon"></i>
                <p>还没有任何打卡记录哦，去记一笔吧！</p>
            </div>
        `;
        return;
    }
    
    // 按时间由新到旧排序
    const sortedLogs = [...state.logs].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        let typeIcon = '';
        let typeClass = '';
        let title = '';
        let unitText = '';
        
        if (log.type === 'food') {
            typeIcon = '<i class="fa-solid fa-utensils"></i>';
            typeClass = 'bg-green-dim color-green';
            title = log.extra || '饮食记录';
            unitText = 'kcal';
        } else if (log.type === 'exercise') {
            typeIcon = '<i class="fa-solid fa-dumbbell"></i>';
            typeClass = 'bg-purple-dim color-purple';
            title = log.extra || '运动消耗';
            unitText = 'kcal';
        } else if (log.type === 'weight') {
            typeIcon = '<i class="fa-solid fa-scale-balanced"></i>';
            typeClass = 'bg-pink-dim color-pink';
            title = log.extra ? `称重记录 (${log.extra})` : '称重打卡';
            unitText = 'kg';
        }
        
        const date = new Date(log.timestamp);
        const timeStr = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        
        item.innerHTML = `
            <div class="history-item-left">
                <div class="hist-icon ${typeClass}">${typeIcon}</div>
                <div class="hist-details">
                    <span class="hist-title">${title}</span>
                    <span class="hist-time">${timeStr}</span>
                </div>
            </div>
            <div class="history-item-right">
                <span class="hist-val">${log.value} ${unitText}</span>
                <button class="hist-delete-btn" data-id="${log.id}" title="删除记录">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        
        container.appendChild(item);
    });
    
    // 绑定删除按钮
    container.querySelectorAll('.hist-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logId = btn.getAttribute('data-id');
            if (confirm('确认删除此条打卡记录吗？')) {
                deleteLog(logId);
            }
        });
    });
}

function deleteLog(id) {
    state.logs = state.logs.filter(log => log.id !== id);
    saveStateToLocalStorage();
    
    // 联动刷新
    updateTodayDashboard();
    renderAllCharts();
    renderHistoryLogs();
}

// ==========================================
// 模块 G: 数据导出、导入与重置
// ==========================================
function initDataManageEvents() {
    const btnExport = document.getElementById('btn-export-settings');
    const btnHeaderExport = document.getElementById('btn-export-data');
    const btnHeaderImport = document.getElementById('btn-import-data');
    const fileInput = document.getElementById('file-import-input');
    const btnClear = document.getElementById('btn-clear-data');
    
    const triggerExport = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 4));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `litefit_backup_${new Date().toISOString().split('T')[0]}.json`);
        dlAnchorElem.click();
    };
    
    btnExport.addEventListener('click', triggerExport);
    btnHeaderExport.addEventListener('click', triggerExport);
    
    // 导入数据
    btnHeaderImport.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const parsedState = JSON.parse(event.target.result);
                if (parsedState && typeof parsedState === 'object') {
                    state = parsedState;
                    saveStateToLocalStorage();
                    
                    alert('健康数据成功导入！');
                    location.reload(); // 刷新页面使新数据生效
                } else {
                    alert('导入失败，文件格式有误。');
                }
            } catch (err) {
                alert('解析文件出错，请确保是 LiteFit 备份文件。');
            }
        };
        reader.readAsText(file);
    });
    
    // 清空数据
    btnClear.addEventListener('click', () => {
        if (confirm('警告：此操作将清空您本地保存的全部饮食、运动和体重数据！此操作无法撤销。确定继续吗？')) {
            localStorage.removeItem('litefit_state');
            alert('数据已成功重置！');
            location.reload();
        }
    });
}

// ==========================================
// 辅助模块 H: 炫酷烟花动效 (Confetti)
// ==========================================
function triggerConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#10b981', '#8b5cf6', '#ec4899', '#3b82f6']
        });
    }
}
