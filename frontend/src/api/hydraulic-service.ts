import {
  LOOPS,
  OPENING_MAX,
  OPENING_MIN,
  STATIONS,
  pumpCodeOf,
  toAdjustmentRecord,
  toEntryRow,
} from '@/data/hydraulic'
import type {
  AdjustmentRecord,
  BoardData,
  ReadjustInput,
  SubmitInput,
} from '@/data/hydraulic'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 水力平衡调节报送的受理口径，回路看板与调节列表都从这里取数。
const MODULE_KEY = 'hydraulic'
const PUMP_KEY = 'circpump'

export function listAdjustments(filters: Record<string, string> = {}): AdjustmentRecord[] {
  const rows = listRows(MODULE_KEY)
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  return rows
    .map(toAdjustmentRecord)
    .filter((record) =>
      pairs.every(([field, value]) => {
        const target =
          field === 'station'
            ? record.station
            : field === 'loop'
              ? record.loop
              : field === 'operator'
                ? record.operator
                : String(
                    (record as unknown as Record<string, string | number | null>)[field] ?? '',
                  )
        return String(target).includes(value.trim())
      }),
    )
}

function stationBatch(records: AdjustmentRecord[], station: string): number {
  return records
    .filter((record) => record.station === station && record.status !== '待调节')
    .reduce((max, record) => Math.max(max, record.batch), 0)
}

function nextCode(records: AdjustmentRecord[]): string {
  const seq = records.reduce((max, record) => {
    const match = /HYDR-(\d+)/.exec(record.code)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `HYDR-${String(seq + 1).padStart(4, '0')}`
}

function nextId(records: AdjustmentRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.id), 0) + 1
}

function validateReading(opening: number, flow: number, operator: string): string | null {
  // 开度上下限非法值：当场退回重填，不进入受理流程。
  if (!Number.isFinite(opening) || opening < OPENING_MIN || opening > OPENING_MAX) {
    return `阀门开度必须在 ${OPENING_MIN}%~${OPENING_MAX}% 之间，请退回重填`
  }
  if (!Number.isFinite(flow) || flow < 0) {
    return '流量读数必须是不小于 0 的数字，请退回重填'
  }
  if (operator.trim() === '') {
    return '调节人不能为空（流量读数由现场调节人抄录）'
  }
  return null
}

function persist(records: AdjustmentRecord[]): void {
  saveRows(
    MODULE_KEY,
    records.map(toEntryRow),
  )
}

export function submitAdjustment(input: SubmitInput): ActionResult {
  if (!STATIONS.includes(input.station)) {
    return { ok: false, message: '换热站不在本批调节站点内，请按换热站分批报送' }
  }
  if (!LOOPS.includes(input.loop)) {
    return { ok: false, message: '调节回路名称不符合既有回路口径' }
  }
  if (!Number.isInteger(input.batch) || input.batch <= 0) {
    return { ok: false, message: '调节批次必须是正整数，请按换热站分批报送' }
  }
  const invalid = validateReading(input.opening, input.flow, input.operator)
  if (invalid) {
    return { ok: false, message: invalid }
  }

  const records = listAdjustments()
  const latestBatch = stationBatch(records, input.station)
  // 倒序退回一律不受理：批次号不允许小于该站已受理的最大批次。
  if (input.batch < latestBatch) {
    return {
      ok: false,
      message: `${input.station}已受理到第 ${latestBatch} 批，第 ${input.batch} 批属于倒序退回，一律不受理`,
    }
  }

  const existing = records.find(
    (record) => record.station === input.station && record.loop === input.loop,
  )
  // 同一回路重复提交只留一条：已受理的不重复登记，待调节槽位直接补录。
  if (existing && existing.status !== '待调节') {
    return {
      ok: false,
      message: `${input.station} ${input.loop} 已在第 ${existing.batch} 批报送（编号 ${existing.code}），重复提交只记一遍`,
    }
  }

  const now = new Date()
  const payload: AdjustmentRecord = existing
    ? { ...existing }
    : {
        id: nextId(records),
        code: nextCode(records),
        station: input.station,
        loop: input.loop,
        opening: null,
        flow: null,
        operator: '',
        date: '',
        batch: 0,
        status: '待调节',
      }
  payload.batch = input.batch
  payload.opening = input.opening
  payload.flow = input.flow
  payload.operator = input.operator.trim()
  payload.date = input.date
  payload.status = '调节中'
  persist(records.map((record) => (record.id === payload.id ? payload : record)))
  return {
    ok: true,
    message: `${payload.code} 已受理：${input.station} ${input.loop}，阀门开度 ${Math.round(
      input.opening,
    )}%、流量 ${input.flow.toFixed(1)} m³/h`,
  }
}

export function markBalanced(id: number): ActionResult {
  const records = listAdjustments()
  const target = records.find((record) => record.id === id)
  if (!target) {
    return { ok: false, message: '没有找到这条调节记录' }
  }
  if (target.status === '已平衡') {
    return { ok: false, message: '该回路已平衡，不用重复确认' }
  }
  if (target.status === '待调节') {
    return { ok: false, message: '该回路尚未报送调节读数，不能确认平衡' }
  }
  persist(
    records.map((record) =>
      record.id === id ? { ...record, status: '已平衡' } : record,
    ),
  )
  return { ok: true, message: `${target.station} ${target.loop} 已确认平衡，看板不再显示` }
}

export function requestReadjust(id: number): ActionResult {
  const records = listAdjustments()
  const target = records.find((record) => record.id === id)
  if (!target) {
    return { ok: false, message: '没有找到这条调节记录' }
  }
  if (target.status === '需复调') {
    return { ok: false, message: '该回路已在等待复调' }
  }
  if (target.status === '待调节') {
    return { ok: false, message: '该回路尚未报送调节读数，无法要求复调' }
  }
  if (target.status === '已平衡') {
    return { ok: false, message: '已平衡回路不能再要求复调' }
  }
  persist(
    records.map((record) =>
      record.id === id ? { ...record, status: '需复调' } : record,
    ),
  )
  return { ok: true, message: `${target.station} ${target.loop} 已列入需复调，排在看板第一栏` }
}

// 复调结果驱动循环泵保养清单：仍不平衡就为对应循环泵登记/重新打开一条待保养项。
function upsertPumpMaintenance(record: AdjustmentRecord): void {
  const pumpRows = listRows(PUMP_KEY)
  const code = pumpCodeOf(record.station, record.loop)
  const index = pumpRows.findIndex((row) => String(row['泵编号']) === code)
  if (index >= 0) {
    if (String(pumpRows[index].status) === '待保养') {
      return
    }
    pumpRows[index] = {
      ...pumpRows[index],
      status: '待保养',
      pending: true,
      abnormal: true,
      上次保养日: record.date,
    }
    saveRows(PUMP_KEY, [...pumpRows])
    return
  }
  const nextPumpId = pumpRows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const pump: EntryRow = {
    id: nextPumpId,
    status: '待保养',
    pending: true,
    abnormal: true,
    泵编号: code,
    所属换热站: record.station,
    泵型号: 'KQL200-315（水力平衡联调）',
    运行电流: '',
    扬程: '32m',
    保养周期: '月度',
    上次保养日: record.date,
    运行状态: '待保养',
    关联回路: record.loop,
    保养来源: `复调仍不平衡（${record.code}）`,
  }
  saveRows(PUMP_KEY, [...pumpRows, pump])
}

export function submitReadjust(id: number, input: ReadjustInput): ActionResult {
  const invalid = validateReading(input.opening, input.flow, input.operator)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const records = listAdjustments()
  const target = records.find((record) => record.id === id)
  if (!target) {
    return { ok: false, message: '没有找到这条调节记录' }
  }
  if (target.status !== '需复调') {
    return { ok: false, message: '只有需复调回路才能报送复调结果' }
  }

  const updated: AdjustmentRecord = {
    ...target,
    opening: input.opening,
    flow: input.flow,
    operator: input.operator.trim(),
    date: input.date,
    status: input.balanced ? '调节中' : '需复调',
  }
  persist(records.map((record) => (record.id === id ? updated : record)))
  if (input.balanced) {
    return { ok: true, message: `${target.station} ${target.loop} 复调达标，可确认平衡` }
  }
  upsertPumpMaintenance(updated)
  return {
    ok: true,
    message: `${target.station} ${target.loop} 复调仍不平衡，已把 ${pumpCodeOf(
      target.station,
      target.loop,
    )} 列入循环泵保养清单`,
  }
}

// 看板取数：换热站分行、调节回路分栏；已平衡回路不挤进来，需复调排在最前一栏。
export function loadBoard(): BoardData {
  const records = listAdjustments()
  const active = records.filter((record) => record.status !== '已平衡')
  const matrix: Record<string, Record<string, AdjustmentRecord>> = {}
  for (const station of STATIONS) {
    matrix[station] = {}
    for (const record of active.filter((item) => item.station === station)) {
      matrix[station][record.loop] = record
    }
  }
  const columns = LOOPS.map((loop) => {
    const inLoop = active.filter((record) => record.loop === loop)
    return {
      loop,
      recheck: inLoop.filter((record) => record.status === '需复调').length,
      adjusting: inLoop.filter((record) => record.status === '调节中').length,
      waiting: inLoop.filter((record) => record.status === '待调节').length,
    }
  }).sort((a, b) => {
    if (b.recheck !== a.recheck) {
      return b.recheck - a.recheck
    }
    if (b.adjusting !== a.adjusting) {
      return b.adjusting - a.adjusting
    }
    if (b.waiting !== a.waiting) {
      return b.waiting - a.waiting
    }
    return a.loop.localeCompare(b.loop, 'zh-Hans-CN')
  })
  return { stations: STATIONS, columns, matrix }
}

export interface HydraulicStats {
  waiting: number
  adjusting: number
  recheck: number
  balanced: number
  pumpPending: number
}

export function hydraulicStats(): HydraulicStats {
  const records = listAdjustments()
  return {
    waiting: records.filter((record) => record.status === '待调节').length,
    adjusting: records.filter((record) => record.status === '调节中').length,
    recheck: records.filter((record) => record.status === '需复调').length,
    balanced: records.filter((record) => record.status === '已平衡').length,
    pumpPending: listRows(PUMP_KEY).filter((row) => String(row.status) === '待保养').length,
  }
}

// 重置演示数据：调节记录与被复调驱动的循环泵清单一起回到种子。
export function resetHydraulicDemo(): void {
  resetRows(MODULE_KEY)
  resetRows(PUMP_KEY)
}
