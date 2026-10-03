import type { EntryRow } from './types'

// 水力平衡领域口径：看板与调节列表共用这一份定义，页面不再各自约定字段。

export const HYD_STATUSES = ['待调节', '调节中', '已平衡', '需复调'] as const
export type HydStatus = (typeof HYD_STATUSES)[number]

// 阀门开度沿用既有口径：百分比开度，合法区间 0~100，越界一律退回重填。
export const OPENING_MIN = 0
export const OPENING_MAX = 100

// 调节按换热站分批推进：下列站点与回路同时充当报送表单的可选口径。
export const STATIONS = ['朝阳换热站', '滨河换热站', '西山换热站']
export const LOOPS = ['1#供水回路', '2#供水回路', '1#回水回路', '2#回水回路']

export interface AdjustmentRecord {
  id: number
  code: string
  station: string
  loop: string
  /** 阀门开度（%）；待调节记录尚未报送时为 null */
  opening: number | null
  /** 现场抄录流量（m³/h）；未报送时为 null */
  flow: number | null
  operator: string
  date: string
  /** 所属调节批次，按换热站各自累计；只增不退 */
  batch: number
  status: HydStatus
}

export interface SubmitInput {
  station: string
  loop: string
  batch: number
  opening: number
  flow: number
  operator: string
  date: string
}

export interface ReadjustInput {
  opening: number
  flow: number
  operator: string
  date: string
  /** false：复调后仍不平衡，维持「需复调」并驱动循环泵保养清单 */
  balanced: boolean
}

export interface BoardColumn {
  loop: string
  recheck: number
  adjusting: number
  waiting: number
}

export interface BoardData {
  stations: string[]
  columns: BoardColumn[]
  matrix: Record<string, Record<string, AdjustmentRecord>>
}

function toNumber(value: string | number | boolean | undefined): number | null {
  if (value === '' || value === undefined || value === null) {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function toAdjustmentRecord(row: EntryRow): AdjustmentRecord {
  return {
    id: Number(row.id),
    code: String(row['调节编号'] ?? ''),
    station: String(row['换热站'] ?? ''),
    loop: String(row['调节回路'] ?? ''),
    opening: toNumber(row['阀门开度']),
    flow: toNumber(row['流量读数']),
    operator: String(row['调节人'] ?? ''),
    date: String(row['调节日期'] ?? ''),
    batch: toNumber(row['批次']) ?? 0,
    status: String(row.status) as HydStatus,
  }
}

export function toEntryRow(record: AdjustmentRecord): EntryRow {
  return {
    id: record.id,
    status: record.status,
    pending: record.status !== '已平衡',
    abnormal: record.status === '需复调',
    调节编号: record.code,
    换热站: record.station,
    调节回路: record.loop,
    阀门开度: record.opening ?? '',
    流量读数: record.flow ?? '',
    调节人: record.operator,
    调节日期: record.date,
    批次: record.batch,
    调节状态: record.status,
  }
}

// 循环泵保养项与（换热站 + 调节回路）一一对应，复调报送多次也只维护同一条。
const STATION_CODE: Record<string, string> = {
  朝阳换热站: 'A',
  滨河换热站: 'B',
  西山换热站: 'C',
}

function stableHash(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

export function pumpCodeOf(station: string, loop: string): string {
  const stationCode = STATION_CODE[station] ?? `X${stableHash(station).toString(36)}`
  const loopIndex = LOOPS.indexOf(loop)
  const loopCode =
    loopIndex >= 0 ? String(loopIndex + 1).padStart(2, '0') : stableHash(loop).toString(36).slice(0, 3)
  return `CPM-${stationCode}-${loopCode}`
}

export function formatOpening(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}

export function formatFlow(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} m³/h`
}
