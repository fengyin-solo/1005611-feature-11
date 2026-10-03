<template>
  <section class="page" data-module="hydraulic">
    <header class="page-head">
      <div>
        <h2>水力平衡管理</h2>
        <p class="page-desc">按换热站分批推进水力平衡调节，回路看板按站分行、按回路分栏，需复调回路置顶，已平衡回路不占格。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate()">登记调节报送</button>
        <button class="btn" type="button" @click="exportRows">导出水力平衡清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item" :class="{ 'legend-hot': item.status === '需复调' }">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-note">看板仅呈现未平衡回路，已平衡 {{ balancedCount }} 条不列入</span>
    </p>

    <div class="view-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
      <span class="tab-source-note">两处取数同源：均来自水力平衡调节记录</span>
    </div>

    <form v-if="activeTab === 'list'" class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 回路看板：换热站分行、调节回路分栏，需复调回路排在最前一栏 -->
    <div v-if="activeTab === 'board'" class="board-wrap">
      <table class="board-table" v-if="board.loops.length">
        <thead>
          <tr>
            <th class="board-station-col">换热站 ＼ 调节回路</th>
            <th
              v-for="loop in board.loops"
              :key="loop"
              :class="{ 'loop-hot-col': isRecheckLoop(loop) }"
            >
              <span v-if="isRecheckLoop(loop)" class="hot-flag" title="该回路存在需复调的站，置顶">需复调</span>
              {{ loop }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="station in board.stations" :key="station.name">
            <th class="board-station-col" scope="row">
              <span v-if="station.recheckCount" class="station-badge">{{ station.recheckCount }}</span>
              {{ station.name }}
            </th>
            <td v-for="loop in board.loops" :key="loop">
              <template v-if="cellOf(station.name, loop)" :key="cellOf(station.name, loop)!.id">
                <article :class="['loop-card', `loop-${statusKey(cellOf(station.name, loop)!.status)}`]">
                  <span class="loop-status">{{ cellOf(station.name, loop)!.status }}</span>
                  <dl class="loop-metrics">
                    <div><dt>阀门开度</dt><dd>{{ formatOpening(cellOf(station.name, loop)!['阀门开度']) }}</dd></div>
                    <div><dt>流量读数</dt><dd>{{ formatFlow(cellOf(station.name, loop)!['流量读数']) }}</dd></div>
                    <div><dt>调节人</dt><dd>{{ cellOf(station.name, loop)!['调节人'] || '—' }}</dd></div>
                    <div><dt>调节日期</dt><dd>{{ cellOf(station.name, loop)!['调节日期'] || '—' }}</dd></div>
                  </dl>
                  <p v-if="cellOf(station.name, loop)!['保养单号']" class="loop-maint">
                    保养单 {{ cellOf(station.name, loop)!['保养单号'] }}
                  </p>
                  <div class="loop-actions">
                    <button
                      v-for="action in cardActions(cellOf(station.name, loop)!)"
                      :key="action.label"
                      type="button"
                      class="link"
                      @click="action.run(cellOf(station.name, loop)!)"
                    >
                      {{ action.label }}
                    </button>
                  </div>
                </article>
              </template>
              <button v-else type="button" class="loop-empty" @click="openCreate(station.name, loop)">
                + 登记报送
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state board-empty">当前筛选条件下没有待处理回路，全部回路均已平衡。</p>
    </div>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td><span :class="['status-pill', `loop-${statusKey(row.status)}`]">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水力平衡数据，可先登记调节报送</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水力平衡记录（看板呈现 {{ activeCount }} 个未平衡回路格）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 按换热站分批报送：同站各回路连续抄录，不必逐格重填 -->
    <div v-if="formVisible" class="modal-mask" @click.self="closeForm">
      <form class="modal-card" @submit.prevent="submitForm()">
        <header class="modal-head">
          <h3>{{ formTitle }}</h3>
          <button type="button" class="link modal-close" @click="closeForm">关闭</button>
        </header>
        <p v-if="formHint" class="modal-hint">{{ formHint }}</p>
        <div class="modal-grid">
          <label class="form-item">
            <span>换热站（本批）</span>
            <input v-model="form.换热站" list="hydraulic-stations" placeholder="选择或填写本批换热站" />
            <datalist id="hydraulic-stations">
              <option v-for="station in stationOptions" :key="station" :value="station" />
            </datalist>
          </label>
          <label class="form-item">
            <span>调节回路</span>
            <input v-model="form.调节回路" list="hydraulic-loops" placeholder="选择或填写回路名" />
            <datalist id="hydraulic-loops">
              <option v-for="loop in loopOptions" :key="loop" :value="loop" />
            </datalist>
          </label>
          <label class="form-item">
            <span>阀门开度（0–100，%）</span>
            <input v-model="form.阀门开度" inputmode="decimal" placeholder="如 62" />
          </label>
          <label class="form-item">
            <span>流量读数（t/h，现场抄录）</span>
            <input v-model="form.流量读数" inputmode="decimal" placeholder="如 118.6" />
          </label>
          <label class="form-item">
            <span>调节人</span>
            <input v-model="form.调节人" placeholder="现场抄录人姓名" />
          </label>
          <label class="form-item">
            <span>调节日期</span>
            <input v-model="form.调节日期" type="date" />
          </label>
        </div>
        <p v-if="formError" class="error-text form-error">{{ formError }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="submitForm(true)">保存并继续本站下一回路</button>
          <button class="btn primary" type="submit">保存报送</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  STATUS_BALANCED,
  STATUS_PENDING,
  STATUS_RECHECK,
  STATUS_WORKING,
  boardCell,
  buildHydraulicBoard,
  changeHydraulicStatus,
  submitAdjustment,
  todayLabel,
  type AdjustmentInput,
  type BoardModel,
} from '@/api/hydraulic-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hydraulic')
const session = useSessionStore()

const columns = ['调节编号', '换热站', '调节回路', '阀门开度', '流量读数', '调节人', '调节日期', '调节状态']
const actions = ['提交调节', '确认平衡', '要求复调']
const filterFields = columns.slice(0, 3)
const tabs = [
  { key: 'board', label: '回路看板' },
  { key: 'list', label: '调节列表' },
] as const

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const activeTab = ref<'board' | 'list'>('board')

// 看板与列表同源：只取一次水力平衡记录，看板从同一份 rows 派生。
const board = computed<BoardModel>(() => buildHydraulicBoard(rows.value))
const activeCount = computed(() => board.value.cells.size)
const balancedCount = computed(
  () => rows.value.filter((row) => String(row.status) === STATUS_BALANCED).length,
)

const stats = computed(() => [
  { label: '待调节回路', value: countByStatus(STATUS_PENDING) },
  { label: '调节中回路', value: countByStatus(STATUS_WORKING) },
  { label: '需复调回路', value: countByStatus(STATUS_RECHECK) },
  { label: '已平衡回路', value: balancedCount.value },
])

const statusSummary = computed(() =>
  [STATUS_RECHECK, STATUS_PENDING, STATUS_WORKING, STATUS_BALANCED].map((status) => ({
    status,
    count: countByStatus(status),
  })),
)

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

const stationOptions = computed(() => [
  ...new Set(rows.value.map((row) => String(row['换热站'] ?? '').trim()).filter(Boolean)),
])
const loopOptions = computed(() => {
  const station = form.换热站.trim()
  return [
    ...new Set(
      rows.value
        .filter((row) => !station || String(row['换热站'] ?? '').trim() === station)
        .map((row) => String(row['调节回路'] ?? '').trim())
        .filter(Boolean),
    ),
  ]
})

function cellOf(station: string, loop: string): EntryRow | undefined {
  return boardCell(board.value, station, loop)
}

function isRecheckLoop(loop: string): boolean {
  return board.value.cells
    ? [...board.value.cells.values()].some(
        (row) => String(row['调节回路']) === loop && row.status === STATUS_RECHECK,
      )
    : false
}

function statusKey(status: string | number | boolean): string {
  switch (String(status)) {
    case STATUS_RECHECK:
      return 'recheck'
    case STATUS_PENDING:
      return 'pending'
    case STATUS_WORKING:
      return 'working'
    case STATUS_BALANCED:
      return 'balanced'
    default:
      return 'pending'
  }
}

function formatOpening(value: string | number | boolean | undefined): string {
  const text = String(value ?? '').trim()
  return text ? `${text}%` : '—'
}

function formatFlow(value: string | number | boolean | undefined): string {
  const text = String(value ?? '').trim()
  return text ? `${text} t/h` : '待抄录'
}

// 逐格动作：沿用既有「提交调节 / 确认平衡 / 要求复调」口径，报送类动作直接拉起分批表单。
function cardActions(row: EntryRow) {
  const openReport = (label: string) => () => openCreate(String(row['换热站']), String(row['调节回路']), row, label)
  const list: { label: string; run: (target: EntryRow) => void }[] = []
  if (row.status === STATUS_PENDING) {
    list.push({ label: '提交调节', run: openReport('提交调节') })
    list.push({ label: '要求复调', run: (target) => changeStatus('要求复调', target) })
  } else if (row.status === STATUS_WORKING) {
    list.push({ label: '更新抄录', run: openReport('更新抄录') })
    list.push({ label: '确认平衡', run: (target) => changeStatus('确认平衡', target) })
    list.push({ label: '要求复调', run: (target) => changeStatus('要求复调', target) })
  } else if (row.status === STATUS_RECHECK) {
    list.push({ label: '复调报送', run: openReport('复调报送') })
    list.push({ label: '确认平衡', run: (target) => changeStatus('确认平衡', target) })
  }
  return list
}

// ---- 按换热站分批报送表单 ----

const emptyForm = (): AdjustmentInput => ({
  换热站: '',
  调节回路: '',
  阀门开度: '',
  流量读数: '',
  调节人: session.operator ?? '',
  调节日期: todayLabel(),
})

const form = reactive<AdjustmentInput>(emptyForm())
const formVisible = ref(false)
const formError = ref('')
const formTitle = ref('登记调节报送')
const formHint = ref('')

function resetForm(station = '', loop = '') {
  Object.assign(form, emptyForm(), { 换热站: station, 调节回路: loop })
}

function openCreate(station = '', loop = '', row?: EntryRow, title?: string) {
  errorMessage.value = ''
  formError.value = ''
  if (row) {
    formTitle.value = title ?? '更新调节报送'
    formHint.value =
      row.status === STATUS_RECHECK
        ? '该回路需复调：本次复调结果会同步进入循环泵保养清单。'
        : '同一回路重复报送只保留一条，本表单将覆盖原记录的开度、流量与调节人。'
    Object.assign(form, {
      换热站: String(row['换热站'] ?? station),
      调节回路: String(row['调节回路'] ?? loop),
      阀门开度: String(row['阀门开度'] ?? ''),
      流量读数: String(row['流量读数'] ?? ''),
      调节人: String(row['调节人'] ?? session.operator ?? ''),
      调节日期: todayLabel(),
    })
  } else {
    formTitle.value = station ? `登记调节报送 · ${station}（本批）` : '登记调节报送'
    formHint.value = '调节按换热站分批推进，保存后可继续本站下一回路；流量读数由调节人现场抄录。'
    resetForm(station, loop)
  }
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
  formError.value = ''
}

function submitForm(continueBatch = false) {
  formError.value = ''
  const result = submitAdjustment({ ...form })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
  if (continueBatch) {
    // 同一换热站连续推进：只清空回路与读数，站名、调节人、日期保留。
    form.调节回路 = ''
    form.阀门开度 = ''
    form.流量读数 = ''
    formError.value = ''
    formTitle.value = `登记调节报送 · ${form.换热站}（本批）`
    formHint.value = result.message
  } else {
    closeForm()
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  changeStatus(action, row)
}

function changeStatus(action: string, row: EntryRow) {
  errorMessage.value = ''
  formError.value = ''
  const result = changeHydraulicStatus(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水力平衡列表读取失败'
  }
}

onMounted(reload)
</script>
