<template>
  <section class="page" data-module="hydraulic">
    <header class="page-head">
      <div>
        <h2>水力平衡管理</h2>
        <p class="page-desc">
          调节按换热站分批推进，流量读数由调节人现场抄录。回路看板与调节列表同一份取数：需复调回路排在最前一栏，已平衡回路不再显示。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openSubmit()">调节报送</button>
        <button class="btn" type="button" @click="exportRows">导出水力平衡清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-alert': item.alert }">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tabs" role="tablist">
      <button
        class="tab"
        :class="{ active: tab === 'board' }"
        type="button"
        @click="tab = 'board'"
      >
        回路看板
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'list' }"
        type="button"
        @click="tab = 'list'"
      >
        调节列表
      </button>
    </div>

    <!-- 回路看板：换热站分行、调节回路分栏；栏序按 需复调 → 调节中 → 待调节 提前 -->
    <div v-if="tab === 'board'" class="board-wrap">
      <p class="status-legend">
        <span class="legend-item legend-recheck">需复调 {{ countOf('需复调') }}</span>
        <span class="legend-item legend-adjusting">调节中 {{ countOf('调节中') }}</span>
        <span class="legend-item legend-waiting">待调节 {{ countOf('待调节') }}</span>
        <span class="legend-item">已平衡回路不进入看板（{{ countOf('已平衡') }} 条）</span>
      </p>
      <table class="board-table">
        <thead>
          <tr>
            <th class="board-station-col">换热站 ＼ 调节回路</th>
            <th v-for="column in board.columns" :key="column.loop" class="board-loop-col">
              <span class="loop-name">{{ column.loop }}</span>
              <span class="loop-badges">
                <em v-if="column.recheck" class="badge badge-recheck">复调 {{ column.recheck }}</em>
                <em v-if="column.adjusting" class="badge badge-adjusting">调节中 {{ column.adjusting }}</em>
                <em v-if="column.waiting" class="badge badge-waiting">待调 {{ column.waiting }}</em>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="station in board.stations" :key="station">
            <th class="board-station-cell">{{ station }}</th>
            <td v-for="column in board.columns" :key="column.loop">
              <article
                v-if="board.matrix[station][column.loop]"
                class="loop-cell"
                :class="cellClass(board.matrix[station][column.loop].status)"
              >
                <div class="cell-head">
                  <span class="cell-code">{{ board.matrix[station][column.loop].code }}</span>
                  <span class="cell-status" :class="cellClass(board.matrix[station][column.loop].status)">
                    {{ board.matrix[station][column.loop].status }}
                  </span>
                </div>
                <dl class="cell-readings">
                  <div><dt>阀门开度</dt><dd>{{ formatOpening(board.matrix[station][column.loop].opening) }}</dd></div>
                  <div><dt>流量读数</dt><dd>{{ formatFlow(board.matrix[station][column.loop].flow) }}</dd></div>
                  <div><dt>调节人</dt><dd>{{ board.matrix[station][column.loop].operator || '—' }}</dd></div>
                </dl>
                <div class="cell-foot">
                  <button
                    v-if="board.matrix[station][column.loop].status === '需复调'"
                    class="link"
                    type="button"
                    @click="openReadjust(board.matrix[station][column.loop])"
                  >
                    复调报送
                  </button>
                  <template v-else-if="board.matrix[station][column.loop].status === '调节中'">
                    <button class="link" type="button" @click="confirmBalanced(board.matrix[station][column.loop])">
                      确认平衡
                    </button>
                    <button class="link" type="button" @click="askReadjust(board.matrix[station][column.loop])">
                      要求复调
                    </button>
                  </template>
                  <button
                    v-else
                    class="link"
                    type="button"
                    @click="openSubmit(board.matrix[station][column.loop])"
                  >
                    去报送
                  </button>
                </div>
              </article>
              <span v-else class="cell-balanced">已平衡</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 调节列表：与看板同一份取数，动作沿用既有口径 -->
    <template v-else>
      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>换热站</span>
          <select v-model="filters.station">
            <option value>全部站点</option>
            <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>调节回路</span>
          <select v-model="filters.loop">
            <option value>全部回路</option>
            <option v-for="loop in loops" :key="loop" :value="loop">{{ loop }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>调节人</span>
          <input v-model="filters.operator" placeholder="按调节人检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in listColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.code }}</td>
            <td>{{ row.station }}</td>
            <td>{{ row.loop }}</td>
            <td>第 {{ row.status === '待调节' ? '—' : row.batch }} 批</td>
            <td>{{ formatOpening(row.opening) }}</td>
            <td>{{ formatFlow(row.flow) }}</td>
            <td>{{ row.operator || '—' }}</td>
            <td>{{ row.date || '—' }}</td>
            <td>
              <span class="cell-status" :class="cellClass(row.status)">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button v-if="row.status === '待调节'" class="link" type="button" @click="openSubmit(row)">
                报送
              </button>
              <template v-else-if="row.status === '调节中'">
                <button class="link" type="button" @click="confirmBalanced(row)">确认平衡</button>
                <button class="link" type="button" @click="askReadjust(row)">要求复调</button>
              </template>
              <button v-else-if="row.status === '需复调'" class="link" type="button" @click="openReadjust(row)">
                复调报送
              </button>
              <span v-else class="muted-text">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="listColumns.length + 2" class="empty-state">没有符合条件的调节记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ rows.length }} 条调节记录（同回路重复报送只记一遍）</span>
      </footer>
    </template>

    <!-- 调节报送弹窗 -->
    <div v-if="submitOpen" class="modal-mask" @click.self="submitOpen = false">
      <div class="modal">
        <h3>调节报送 · 按换热站分批</h3>
        <form @submit.prevent="doSubmit">
          <label class="form-item">
            <span>换热站</span>
            <select v-model="submitForm.station" required>
              <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>调节回路</span>
            <select v-model="submitForm.loop" required>
              <option v-for="loop in loops" :key="loop" :value="loop">{{ loop }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>调节批次（按站只增不退）</span>
            <input v-model.number="submitForm.batch" type="number" min="1" step="1" required />
          </label>
          <div class="form-grid">
            <label class="form-item">
              <span>阀门开度（0~100%）</span>
              <input v-model.number="submitForm.opening" type="number" min="0" max="100" step="1" required />
            </label>
            <label class="form-item">
              <span>流量读数（m³/h，现场抄录）</span>
              <input v-model.number="submitForm.flow" type="number" min="0" step="0.1" required />
            </label>
          </div>
          <div class="form-grid">
            <label class="form-item">
              <span>调节人</span>
              <input v-model="submitForm.operator" placeholder="现场抄录调节人" required />
            </label>
            <label class="form-item">
              <span>调节日期</span>
              <input v-model="submitForm.date" type="date" required />
            </label>
          </div>
          <p v-if="submitError" class="error-text">{{ submitError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="submitOpen = false">取消</button>
            <button class="btn primary" type="submit">提交报送</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 复调结果报送弹窗 -->
    <div v-if="readjustOpen" class="modal-mask" @click.self="readjustOpen = false">
      <div class="modal">
        <h3>复调报送 · {{ readjustTarget?.station }} {{ readjustTarget?.loop }}</h3>
        <p class="modal-hint">编号 {{ readjustTarget?.code }}；复调仍不平衡将自动登记对应循环泵的保养项。</p>
        <form @submit.prevent="doReadjust">
          <div class="form-grid">
            <label class="form-item">
              <span>阀门开度（0~100%）</span>
              <input v-model.number="readjustForm.opening" type="number" min="0" max="100" step="1" required />
            </label>
            <label class="form-item">
              <span>流量读数（m³/h，现场抄录）</span>
              <input v-model.number="readjustForm.flow" type="number" min="0" step="0.1" required />
            </label>
          </div>
          <div class="form-grid">
            <label class="form-item">
              <span>调节人</span>
              <input v-model="readjustForm.operator" placeholder="现场抄录调节人" required />
            </label>
            <label class="form-item">
              <span>复调日期</span>
              <input v-model="readjustForm.date" type="date" required />
            </label>
          </div>
          <label class="form-item">
            <span>复调结论</span>
            <span class="radio-row">
              <label><input v-model="readjustForm.balanced" type="radio" :value="false" /> 仍不平衡，需继续复调（驱动保养清单）</label>
              <label><input v-model="readjustForm.balanced" type="radio" :value="true" /> 已达标，可确认平衡</label>
            </span>
          </label>
          <p v-if="readjustError" class="error-text">{{ readjustError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="readjustOpen = false">取消</button>
            <button class="btn primary" type="submit">提交复调结果</button>
          </div>
        </form>
      </div>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  hydraulicStats,
  listAdjustments,
  loadBoard,
  markBalanced,
  requestReadjust,
  resetHydraulicDemo,
  submitAdjustment,
  submitReadjust,
} from '@/api/hydraulic-service'
import {
  LOOPS,
  STATIONS,
  formatFlow,
  formatOpening,
} from '@/data/hydraulic'
import type { AdjustmentRecord, BoardData, HydStatus } from '@/data/hydraulic'

const meta = moduleMeta('hydraulic')
const stations = STATIONS
const loops = LOOPS
const listColumns = [
  '调节编号',
  '换热站',
  '调节回路',
  '批次',
  '阀门开度',
  '流量读数',
  '调节人',
  '调节日期',
]

const tab = ref<'board' | 'list'>('board')
const rows = ref<AdjustmentRecord[]>([])
const board = ref<BoardData>({ stations: STATIONS, columns: [], matrix: {} })
const filters = ref<Record<string, string>>({ station: '', loop: '', operator: '' })
const message = ref('')
const messageOk = ref(false)

const stats = computed(() => {
  const data = hydraulicStats()
  return [
    { label: '待调节回路', value: data.waiting, alert: false },
    { label: '调节中回路', value: data.adjusting, alert: false },
    { label: '需复调回路', value: data.recheck, alert: data.recheck > 0 },
    { label: '已平衡回路', value: data.balanced, alert: false },
    { label: '循环泵待保养', value: data.pumpPending, alert: data.pumpPending > 0 },
  ]
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function showMessage(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function cellClass(status: HydStatus): string {
  if (status === '需复调') {
    return 'cell-recheck'
  }
  if (status === '调节中') {
    return 'cell-adjusting'
  }
  return 'cell-waiting'
}

function countOf(status: HydStatus): number {
  return listAdjustments().filter((row) => row.status === status).length
}

function latestBatch(station: string): number {
  return listAdjustments()
    .filter((record) => record.station === station && record.status !== '待调节')
    .reduce((max, record) => Math.max(max, record.batch), 0)
}

function reload() {
  rows.value = listAdjustments(filters.value)
  board.value = loadBoard()
}

function resetFilters() {
  filters.value = { station: '', loop: '', operator: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetDemo() {
  resetHydraulicDemo()
  filters.value = { station: '', loop: '', operator: '' }
  reload()
  showMessage(true, '水力平衡调节与循环泵保养清单已恢复为演示数据')
}

// ---- 调节报送 ----
const submitOpen = ref(false)
const submitError = ref('')
const submitForm = reactive({
  station: STATIONS[0],
  loop: LOOPS[0],
  batch: 1,
  opening: 50,
  flow: 0,
  operator: '',
  date: today(),
})

function openSubmit(record?: AdjustmentRecord) {
  submitError.value = ''
  if (record) {
    submitForm.station = record.station
    submitForm.loop = record.loop
    submitForm.batch = Math.max(latestBatch(record.station) + 1, 1)
    submitForm.opening = record.opening ?? 50
    submitForm.flow = record.flow ?? 0
    submitForm.operator = record.operator
  } else {
    submitForm.station = STATIONS[0]
    submitForm.loop = LOOPS[0]
    submitForm.batch = Math.max(latestBatch(STATIONS[0]) + 1, 1)
    submitForm.opening = 50
    submitForm.flow = 0
    submitForm.operator = ''
  }
  submitForm.date = today()
  submitOpen.value = true
}

function doSubmit() {
  const result = submitAdjustment({ ...submitForm })
  if (!result.ok) {
    submitError.value = result.message
    return
  }
  submitOpen.value = false
  reload()
  showMessage(true, result.message)
}

// ---- 复调相关 ----
const readjustOpen = ref(false)
const readjustError = ref('')
const readjustTarget = ref<AdjustmentRecord | null>(null)
const readjustForm = reactive({
  opening: 50,
  flow: 0,
  operator: '',
  date: today(),
  balanced: false,
})

function openReadjust(record: AdjustmentRecord) {
  readjustTarget.value = record
  readjustError.value = ''
  readjustForm.opening = record.opening ?? 50
  readjustForm.flow = record.flow ?? 0
  readjustForm.operator = record.operator
  readjustForm.date = today()
  readjustForm.balanced = false
  readjustOpen.value = true
}

function doReadjust() {
  if (!readjustTarget.value) {
    return
  }
  const result = submitReadjust(readjustTarget.value.id, { ...readjustForm })
  if (!result.ok) {
    readjustError.value = result.message
    return
  }
  readjustOpen.value = false
  reload()
  showMessage(true, result.message)
}

function confirmBalanced(record: AdjustmentRecord) {
  const result = markBalanced(record.id)
  reload()
  showMessage(result.ok, result.message)
}

function askReadjust(record: AdjustmentRecord) {
  const result = requestReadjust(record.id)
  reload()
  showMessage(result.ok, result.message)
}

onMounted(reload)
</script>
