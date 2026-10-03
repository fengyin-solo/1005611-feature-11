import { filterRows, runAction as applyAction } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 水力平衡的业务口径集中在这一层：回路看板和调节列表都从这里取数，
// 报送校验、重复/倒序拦截、复调联动循环泵保养也都走同一条通道。

export const HYDRAULIC_KEY = 'hydraulic'
export const CIRCPUMP_KEY = 'circpump'

export const STATUS_PENDING = '待调节'
export const STATUS_WORKING = '调节中'
export const STATUS_BALANCED = '已平衡'
export const STATUS_RECHECK = '需复调'

export const ACTIVE_STATUSES = [STATUS_RECHECK, STATUS_PENDING, STATUS_WORKING]

export type AdjustmentInput = {
  换热站: string
  调节回路: string
  阀门开度: string
  流量读数: string
  调节人: string
  调节日期: string
}

export type StationColumn = { name: string; recheckCount: number }

export type BoardModel = {
  loops: string[]
  stations: StationColumn[]
  cells: Map<string, EntryRow>
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function cellKey(station: string, loop: string): string {
  return `${station}␟${loop}`
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN')
}

/** 看板与列表共用的取数口径：同一份水力平衡记录，看板只剔掉已平衡的格子。 */
export function loadHydraulicBoard(filters: Record<string, string> = {}): BoardModel {
  return buildHydraulicBoard(filterRows(listRows(HYDRAULIC_KEY), filters))
}

/** 从已取出的记录直接构建看板：列表页取一次数，看板与表格都从这份 rows 派生。 */
export function buildHydraulicBoard(source: EntryRow[]): BoardModel {
  const activeRows = source.filter((row) => row.status !== STATUS_BALANCED)

  const cells = new Map<string, EntryRow>()
  const recheckLoops = new Set<string>()
  const recheckByStation = new Map<string, number>()

  for (const row of activeRows) {
    const station = text(row, '换热站')
    const loop = text(row, '调节回路')
    if (!station || !loop) {
      continue
    }
    cells.set(cellKey(station, loop), row)
    if (row.status === STATUS_RECHECK) {
      recheckLoops.add(loop)
      recheckByStation.set(station, (recheckByStation.get(station) ?? 0) + 1)
    }
  }

  // 需复调的回路排在最前一栏，其余按回路名排；换热站同样按卡壳数量优先。
  const loops = [...new Set(activeRows.map((row) => text(row, '调节回路')).filter(Boolean))]
  loops.sort((a, b) => {
    const ra = recheckLoops.has(a) ? 0 : 1
    const rb = recheckLoops.has(b) ? 0 : 1
    return ra - rb || byName(a, b)
  })

  const stations = [...new Set(activeRows.map((row) => text(row, '换热站')).filter(Boolean))]
  stations.sort((a, b) => {
    const gap = (recheckByStation.get(b) ?? 0) - (recheckByStation.get(a) ?? 0)
    return gap || byName(a, b)
  })

  return {
    loops,
    stations: stations.map((name) => ({ name, recheckCount: recheckByStation.get(name) ?? 0 })),
    cells,
  }
}

export function boardCell(board: BoardModel, station: string, loop: string): EntryRow | undefined {
  return board.cells.get(cellKey(station, loop))
}

export function todayLabel(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function asNumber(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return null
  }
  return Number(value)
}

/** 现场抄录调节数据：校验开度上下限，重复与倒序报送一律不受理。 */
export function submitAdjustment(input: AdjustmentInput): ActionResult & { maintenanceNo?: string } {
  const station = input.换热站.trim()
  const loop = input.调节回路.trim()
  const opening = input.阀门开度.trim()
  const flow = input.流量读数.trim()
  const operator = input.调节人.trim()
  const date = input.调节日期.trim()

  if (!station) {
    return { ok: false, message: '请选择本批调节的换热站' }
  }
  if (!loop) {
    return { ok: false, message: '请选择或填写调节回路' }
  }
  if (!operator) {
    return { ok: false, message: '请填写现场抄录的调节人' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: '调节日期格式应为 YYYY-MM-DD' }
  }

  // 开度上下限非法值：不是数字、超出 0–100 的，退回重填。
  const openingValue = asNumber(opening)
  if (openingValue === null) {
    return { ok: false, message: '阀门开度必须是数字，请退回重填' }
  }
  if (openingValue < 0 || openingValue > 100) {
    return { ok: false, message: `阀门开度 ${opening} 超出 0–100 的上下限，请退回重填` }
  }
  const flowValue = asNumber(flow)
  if (flowValue === null || flowValue < 0) {
    return { ok: false, message: '流量读数必须是不小于 0 的数字，请退回重填' }
  }

  const rows = [...listRows(HYDRAULIC_KEY)]
  const existingIndex = rows.findIndex(
    (row) => text(row, '换热站') === station && text(row, '调节回路') === loop,
  )
  const existing = existingIndex >= 0 ? rows[existingIndex] : undefined

  if (existing && existing.status === STATUS_BALANCED) {
    // 已平衡的回路要重新调节，必须先走「要求复调」，直接报送按倒序退回。
    return { ok: false, message: `${station} ${loop} 已平衡，倒序报送不予受理，请先提交「要求复调」` }
  }

  if (existing) {
    const previousDate = text(existing, '调节日期')
    if (previousDate && date < previousDate) {
      // 调节按日期分批往前推进，日期往回倒的报送一律不受理。
      return { ok: false, message: `调节日期早于该回路最近一次记录（${previousDate}），倒序报送不予受理` }
    }
    const sameSubmission =
      text(existing, '阀门开度') === opening &&
      text(existing, '流量读数') === flow &&
      text(existing, '调节人') === operator &&
      previousDate === date
    if (sameSubmission) {
      // 同一回路重复提交只留一条，原样重报不记第二遍。
      return { ok: false, message: `${station} ${loop} 的这份调节报送已存在，重复提交只记一遍` }
    }
  }

  const isRecheckReply = existing?.status === STATUS_RECHECK
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const serial = rows.reduce((max, row) => {
    const matched = /HYDR-(\d+)/.exec(text(row, '调节编号'))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1

  const updated: EntryRow = {
    id: nextId,
    status: STATUS_WORKING,
    pending: true,
    abnormal: false,
    调节编号: existing ? text(existing, '调节编号') : `HYDR-${String(serial).padStart(4, '0')}`,
    换热站: station,
    调节回路: loop,
    阀门开度: opening,
    流量读数: flow,
    调节人: operator,
    调节日期: date,
    调节状态: STATUS_WORKING,
  }

  // 复调结果回写时保留关联保养单号，便于看板追溯。
  if (existing && existing.保养单号) {
    updated.保养单号 = existing.保养单号
  }

  if (existingIndex >= 0) {
    rows[existingIndex] = updated
  } else {
    rows.push(updated)
  }

  let message: string
  let maintenanceNo: string | undefined
  if (isRecheckReply) {
    const maintained = ensurePumpMaintenance(station, loop, date, text(updated, '调节编号'))
    maintenanceNo = maintained.maintenanceNo
    updated.保养单号 = maintenanceNo
    rows[existingIndex >= 0 ? existingIndex : rows.length - 1] = updated
    message = maintained.created
      ? `${station} ${loop} 复调结果已登记，并已生成循环泵保养单 ${maintenanceNo}`
      : `${station} ${loop} 复调结果已登记，保养单 ${maintenanceNo} 此前已生成，不重复列入`
  } else {
    message = `${station} ${loop} 调节报送已登记，当前状态「${STATUS_WORKING}」`
  }

  saveRows(HYDRAULIC_KEY, rows)
  return { ok: true, message, ...(maintenanceNo ? { maintenanceNo } : {}) }
}

/** 复调结果驱动循环泵保养清单：同一换热站同一回路只列一条，重复报送不重复生成。 */
function ensurePumpMaintenance(
  station: string,
  loop: string,
  date: string,
  adjustmentNo: string,
): { maintenanceNo: string; created: boolean } {
  const pumps = [...listRows(CIRCPUMP_KEY)]
  const duplicate = pumps.find(
    (row) =>
      String(row.保养来源 ?? '') === '水力复调' &&
      text(row, '所属换热站') === station &&
      String(row.关联回路 ?? '') === loop,
  )
  if (duplicate) {
    return { maintenanceNo: text(duplicate, '泵编号'), created: false }
  }

  const nextId = pumps.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const serial = pumps.reduce((max, row) => {
    const matched = /CIRC-(\d+)/.exec(text(row, '泵编号'))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  const maintenanceNo = `CIRC-${String(serial).padStart(4, '0')}`

  pumps.push({
    id: nextId,
    status: '待保养',
    pending: true,
    abnormal: false,
    泵编号: maintenanceNo,
    所属换热站: station,
    关联回路: loop,
    泵型号: '待核对',
    运行电流: '—',
    扬程: '—',
    保养周期: '90天',
    上次保养日: date,
    运行状态: '待保养',
    保养来源: '水力复调',
    触发调节单: adjustmentNo,
  })
  saveRows(CIRCPUMP_KEY, pumps)
  return { maintenanceNo, created: true }
}

/** 状态流转沿用既有 runAction 口径，仅补三条拦截：已平衡不能直接倒回、无读数不能确认平衡、没报过不能要求复调。 */
export function changeHydraulicStatus(id: number, action: string): ActionResult {
  const row = listRows(HYDRAULIC_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return applyAction(HYDRAULIC_KEY, id, action)
  }
  if (action === '提交调节' && row.status === STATUS_BALANCED) {
    // 已平衡 → 调节中 属于倒序流转，一律不受理，重新调节必须先「要求复调」。
    return { ok: false, message: `${text(row, '换热站')} ${text(row, '调节回路')} 已平衡，倒序操作不予受理，请先提交「要求复调」` }
  }
  if (action === '确认平衡') {
    if (!text(row, '阀门开度') || !text(row, '流量读数')) {
      return { ok: false, message: `${text(row, '换热站')} ${text(row, '调节回路')} 还没有报送开度与流量，不能确认平衡` }
    }
  }
  if (action === '要求复调' && row.status === STATUS_PENDING) {
    return { ok: false, message: `${text(row, '换热站')} ${text(row, '调节回路')} 尚未报送调节数据，无需复调` }
  }
  return applyAction(HYDRAULIC_KEY, id, action)
}

/** 循环泵侧的复调驱动保养清单：看板联动过来的待保养项都在这里。 */
export function drivenMaintenanceRows(): EntryRow[] {
  return listRows(CIRCPUMP_KEY).filter(
    (row) => String(row.保养来源 ?? '') === '水力复调' && row.status === '待保养',
  )
}
