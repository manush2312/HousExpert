import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, Boxes, Check, History, Info, Package, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import DatePicker from '../../components/DatePicker'
import Modal from '../../components/Modal'
import SearchableSelect from '../../components/SearchableSelect'
import {
  listAllInventoryStockLots,
  createInventoryItem,
  createInventoryMovement,
  deleteInventoryItem,
  getInventorySummary,
  listInventoryItems,
  listInventoryMovements,
  listInventoryStockLots,
  updateInventoryItem,
  type CreateInventoryItemPayload,
  type CreateInventoryMovementPayload,
  type InventoryItem,
  type InventoryMovement,
  type InventoryStockLot,
  type InventoryMovementType,
  type InventorySummary,
} from '../../services/inventoryService'
import {
  deleteLogItemInventoryLink,
  listLogCategories,
  listLogItems,
  listLogTypes,
  type LogType,
} from '../../services/logService'

type ItemDraft = {
  sku: string
  name: string
  category: string
  unit: string
  usage_unit: string
  usage_units_per_stock_unit: string
  supplier: string
  location: string
  min_stock_level: string
  opening_stock: string
  last_purchase_cost: string
  vendor_pricing: VendorPricingDraft[]
  notes: string
}

type VendorPricingDraft = {
  supplier_name: string
  default_buy_price: string
  default_sell_price: string
  lead_time_days: string
  preferred_supplier: boolean
  notes: string
}

type MovementDraft = {
  item_id: string
  type: InventoryMovementType
  reason: string
  quantity: string
  quantity_unit: 'stock' | 'usage'
  unit_cost: string
  party: string
  supplier_bucket: string
  lot_id: string
  document_number: string
  transaction_date: string
  reference: string
  notes: string
}

const EMPTY_ITEM_DRAFT: ItemDraft = {
  sku: '',
  name: '',
  category: '',
  unit: 'pcs',
  usage_unit: '',
  usage_units_per_stock_unit: '',
  supplier: '',
  location: '',
  min_stock_level: '0',
  opening_stock: '0',
  last_purchase_cost: '0',
  vendor_pricing: [],
  notes: '',
}

type MovementFilter = {
  item_id: string
  type: 'all' | InventoryMovementType
  reason: string
  date_from: string
  date_to: string
}

type MovementReasonOption = {
  value: string
  label: string
}

type StockView = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock'
type InventoryTab = 'overview' | 'items' | 'snapshot' | 'movements'

type InventoryLogLink = {
  logTypeId: string
  logTypeName: string
  categoryId: string
  categoryName: string
  itemId: string
  itemName: string
  inventoryUnit: string
  quantityUnit: string
  usagePerQuantity: number
}

const MOVEMENT_REASON_OPTIONS: Record<InventoryMovementType, MovementReasonOption[]> = {
  in: [
    { value: 'purchase', label: 'Purchase' },
    { value: 'return_from_site', label: 'Return from site' },
    { value: 'transfer_in', label: 'Transfer in' },
    { value: 'opening_stock', label: 'Opening stock' },
  ],
  out: [
    { value: 'issue', label: 'Issue to project/site' },
    { value: 'damage_or_wastage', label: 'Damage or wastage' },
    { value: 'purchase_return', label: 'Purchase return' },
    { value: 'transfer_out', label: 'Transfer out' },
    { value: 'log_consumption', label: 'Log consumption' },
  ],
  adjustment: [
    { value: 'adjustment', label: 'Manual adjustment' },
    { value: 'stock_count_gain', label: 'Stock count gain' },
    { value: 'stock_count_loss', label: 'Stock count loss' },
    { value: 'log_reversal', label: 'Log reversal' },
  ],
}

const EMPTY_MOVEMENT_FILTER: MovementFilter = {
  item_id: '',
  type: 'all',
  reason: '',
  date_from: '',
  date_to: '',
}

function defaultReasonForType(type: InventoryMovementType) {
  return MOVEMENT_REASON_OPTIONS[type][0]?.value ?? ''
}

function emptyMovementDraft(itemId = '', type: InventoryMovementType = 'in'): MovementDraft {
  return {
    item_id: itemId,
    type,
    reason: defaultReasonForType(type),
    quantity: '',
    quantity_unit: 'stock',
    unit_cost: '',
    party: '',
    supplier_bucket: '',
    lot_id: '',
    document_number: '',
    transaction_date: new Date().toISOString().split('T')[0],
    reference: '',
    notes: '',
  }
}

function fmtQty(value: number, unit: string) {
  const text = Number.isInteger(value) ? value.toString() : value.toFixed(3).replace(/\.?0+$/, '')
  return `${text} ${unit}`
}

function fmtMoney(value: number) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

function isNumericOnlyUnit(value: string) {
  const trimmed = value.trim()
  return trimmed !== '' && /^[-+]?\d*\.?\d+$/.test(trimmed)
}

function usageConversionLabel(item: InventoryItem) {
  if (!item.usage_unit) return null
  if (!item.usage_units_per_stock_unit || item.usage_units_per_stock_unit === 1 && item.usage_unit === item.unit) {
    return `1 ${item.unit} = 1 ${item.usage_unit}`
  }
  return `1 ${item.unit} = ${item.usage_units_per_stock_unit} ${item.usage_unit}`
}

function stockQuantityFromUsage(item: InventoryItem | undefined, quantity: number) {
  if (!item?.usage_unit || !item.usage_units_per_stock_unit || item.usage_units_per_stock_unit <= 0) {
    return quantity
  }
  return quantity / item.usage_units_per_stock_unit
}

function normalizeVendorPricingDrafts(rows: VendorPricingDraft[]) {
  return rows
    .map((row) => ({
      supplier_name: row.supplier_name.trim(),
      default_buy_price: Number(row.default_buy_price || 0) || 0,
      default_sell_price: Number(row.default_sell_price || 0) || 0,
      lead_time_days: Number(row.lead_time_days || 0) || 0,
      preferred_supplier: row.preferred_supplier,
      notes: row.notes.trim(),
    }))
    .filter((row) => row.supplier_name)
}

function movementTone(type: InventoryMovementType) {
  if (type === 'in') return { label: 'Stock In', color: '#166534', bg: '#dcfce7' }
  if (type === 'out') return { label: 'Stock Out', color: '#991b1b', bg: '#fee2e2' }
  return { label: 'Adjustment', color: '#92400e', bg: '#fef3c7' }
}

function movementReasonLabel(reason?: string) {
  if (!reason) return 'General'
  return reason
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function movementSourceText(movement: InventoryMovement) {
  if (movement.supplier_bucket?.trim()) return movement.supplier_bucket
  if (movement.type === 'in') return 'Unassigned supplier'
  return '—'
}

function movementPartyText(movement: InventoryMovement) {
  return movement.party?.trim() || '—'
}

function movementSignedQuantity(movement: InventoryMovement) {
  if (movement.type === 'in') return movement.quantity
  if (movement.type === 'out') return -movement.quantity
  return movement.quantity
}

function inferredMovementDisplay(movement: InventoryMovement, item?: InventoryItem) {
  if (movement.display_quantity != null && movement.display_unit) {
    return {
      quantity: movement.display_quantity,
      unit: movement.display_unit,
      inferred: false,
    }
  }
  if (
    movement.reference?.startsWith('log-entry:')
    && item?.usage_unit
    && item.usage_units_per_stock_unit
    && item.usage_units_per_stock_unit > 0
    && item.usage_unit !== item.unit
  ) {
    return {
      quantity: Math.abs(movement.quantity) * item.usage_units_per_stock_unit,
      unit: item.usage_unit,
      inferred: true,
    }
  }
  return null
}

function movementDisplayQty(movement: InventoryMovement, item?: InventoryItem) {
  const display = inferredMovementDisplay(movement, item)
  if (display) {
    const signed = movement.type === 'out' ? -display.quantity : display.quantity
    return fmtQty(signed, display.unit)
  }
  return fmtQty(movementSignedQuantity(movement), movement.item_unit)
}

function movementStockEffectLabel(movement: InventoryMovement) {
  return fmtQty(movementSignedQuantity(movement), movement.item_unit)
}

function movementBalanceLabel(movement: InventoryMovement, item?: InventoryItem) {
  if (
    item?.usage_unit
    && item.usage_units_per_stock_unit
    && item.usage_units_per_stock_unit > 0
    && item.usage_unit !== item.unit
  ) {
    const usageBalance = movement.balance_after * item.usage_units_per_stock_unit
    return `${fmtQty(movement.balance_after, movement.item_unit)} (${fmtQty(usageBalance, item.usage_unit)})`
  }
  return fmtQty(movement.balance_after, movement.item_unit)
}

function movementSummaryLine(movement: InventoryMovement, item?: InventoryItem) {
  const documentLabel = formatMovementDocumentLabel(movement)
  const display = inferredMovementDisplay(movement, item)
  if (display) {
    return [
      `Used ${fmtQty(display.quantity, display.unit)}`,
      `Stock deducted ${fmtQty(Math.abs(movement.quantity), movement.item_unit)}`,
      `Balance ${movementBalanceLabel(movement, item)}`,
      documentLabel !== '—' ? documentLabel : '',
    ].filter(Boolean).join(' · ')
  }
  return [
    `${movementReasonLabel(movement.reason)} · Qty ${movementStockEffectLabel(movement)}`,
    `Balance ${movementBalanceLabel(movement, item)}`,
    documentLabel !== '—' ? documentLabel : '',
  ].filter(Boolean).join(' · ')
}

function movementSourceFieldMeta(type: InventoryMovementType) {
  if (type === 'in') {
    return {
      label: 'Supplier / stock source',
      tooltip: 'Who supplied this stock. This name becomes the supplier bucket shown in inventory lots and vendor-wise stock.',
      placeholder: 'e.g. MK Screws',
    }
  }
  return {
    label: 'Stock source',
    tooltip: 'When adding stock by adjustment, choose which supplier bucket this quantity should belong to.',
    placeholder: 'e.g. JK Screws',
  }
}

function movementPartyFieldMeta(type: InventoryMovementType) {
  if (type === 'in') {
    return {
      label: 'Counterparty (optional)',
      tooltip: 'Optional extra note for the ledger, such as the vendor rep, transfer source, or purchase contact. If not needed, leave it blank.',
      placeholder: 'e.g. Mohan from MK Screws',
    }
  }
  if (type === 'out') {
    return {
      label: 'Issued to / party',
      tooltip: 'Who received the stock, such as the project, site, carpenter, or team member.',
      placeholder: 'e.g. Kitchen Project - Site A',
    }
  }
  return {
    label: 'Related party (optional)',
    tooltip: 'Optional ledger note for the project, person, team, or contact linked to this adjustment.',
    placeholder: 'e.g. Store audit team',
  }
}

function movementDocumentFieldMeta(type: InventoryMovementType) {
  if (type === 'in') {
    return {
      tooltip: 'Invoice number, purchase order, GRN, or challan for this incoming stock.',
      placeholder: 'Invoice / PO / GRN no.',
    }
  }
  if (type === 'out') {
    return {
      tooltip: 'Issue slip, challan, or project document for this stock issue.',
      placeholder: 'Issue slip / challan no.',
    }
  }
  return {
    tooltip: 'Any audit note, stock count sheet, or reference document linked to this adjustment.',
    placeholder: 'Adjustment ref / stock count no.',
  }
}

function aggregateSupplierLots(lots: InventoryStockLot[]) {
  const grouped = new Map<string, {
    supplier: string
    quantity: number
    unit: string
    totalCost: number
    averageUnitCost?: number
    lastUnitCost?: number
  }>()
  lots.forEach((lot) => {
    const key = lot.supplier_bucket || 'Unassigned stock'
    const current = grouped.get(key)
    const lotCost = lot.unit_cost ?? 0
    if (current) {
      current.quantity += lot.remaining_quantity
      current.totalCost += lot.remaining_quantity * lotCost
      if (lotCost > 0) current.lastUnitCost = lotCost
      return
    }
    grouped.set(key, {
      supplier: key,
      quantity: lot.remaining_quantity,
      unit: lot.item_unit,
      totalCost: lot.remaining_quantity * lotCost,
      lastUnitCost: lotCost > 0 ? lotCost : undefined,
    })
  })
  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      averageUnitCost: row.quantity > 0 && row.totalCost > 0
        ? row.totalCost / row.quantity
        : row.lastUnitCost,
    }))
    .sort((a, b) => b.quantity - a.quantity || a.supplier.localeCompare(b.supplier))
}

function formatCostValue(value?: number) {
  if (!value || value <= 0) return '—'
  return `Rs ${fmtMoney(value)}`
}

function inventoryCategoryLabel(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : 'Uncategorized'
}

function parseSafeDate(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDisplayDate(value: string) {
  const parsed = parseSafeDate(value)
  if (!parsed) return 'No date'
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDisplayDateLong(value: string) {
  const parsed = parseSafeDate(value)
  if (!parsed) return 'No date'
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMovementDocumentLabel(movement: InventoryMovement) {
  if (movement.reference?.startsWith('log-entry:') && (movement.party || movement.document_number)) {
    return [movement.party, movement.document_number].filter(Boolean).join(' · ')
  }
  if (movement.document_number) return movement.document_number
  if (!movement.reference) return '—'
  if (movement.reference.startsWith('log-entry:')) return 'Linked project log'
  return movement.reference
}

function formatMovementReferenceHint(movement: InventoryMovement) {
  if (!movement.reference) return null
  if (movement.reference.startsWith('log-entry:')) {
    if (movement.notes) return movement.notes
    return movement.document_number
      ? `Generated from project log in ${movement.document_number}`
      : 'Generated from a linked project log entry'
  }
  if (movement.document_number) return null
  return `Ref ${movement.reference}`
}

function inventoryLinkUsageLabel(link: InventoryLogLink) {
  if (!link.quantityUnit) return '—'
  const usagePerQuantity = Number.isInteger(link.usagePerQuantity)
    ? String(link.usagePerQuantity)
    : link.usagePerQuantity.toFixed(2)
  return `${usagePerQuantity} ${link.inventoryUnit} per ${link.quantityUnit}`
}

export default function InventoryPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [stockLots, setStockLots] = useState<InventoryStockLot[]>([])
  const [summary, setSummary] = useState<InventorySummary | null>(null)
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [inventoryLogLinks, setInventoryLogLinks] = useState<Record<string, InventoryLogLink[]>>({})
  const [loading, setLoading] = useState(true)
  const [movementLoading, setMovementLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeTab, setActiveTab] = useState<InventoryTab>('items')
  const [stockView, setStockView] = useState<StockView>('all')
  const [movementFilter, setMovementFilter] = useState<MovementFilter>(EMPTY_MOVEMENT_FILTER)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM_DRAFT)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [itemFormOpen, setItemFormOpen] = useState(false)
  const [movementDraft, setMovementDraft] = useState<MovementDraft>(emptyMovementDraft())
  const [movementFormOpen, setMovementFormOpen] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [savingMovement, setSavingMovement] = useState(false)
  const [deletingInventoryLinkId, setDeletingInventoryLinkId] = useState<string | null>(null)
  const [linkManagerItem, setLinkManagerItem] = useState<InventoryItem | null>(null)
  const [pendingInventoryLinkRemoval, setPendingInventoryLinkRemoval] = useState<InventoryLogLink | null>(null)

  const refreshOverview = async () => {
    try {
      setLoading(true)
      setError('')
      const [itemsRes, summaryRes, stockLotsRes] = await Promise.all([
        listInventoryItems(),
        getInventorySummary(),
        listAllInventoryStockLots(),
      ])
      setItems(itemsRes.data.data)
      setSummary(summaryRes.data.data)
      setStockLots(stockLotsRes.data.data)
    } catch {
      setError('Failed to load inventory. Make sure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const refreshMovements = async (filter = movementFilter) => {
    try {
      setMovementLoading(true)
      const movementsRes = await listInventoryMovements({
        item_id: filter.item_id || undefined,
        type: filter.type === 'all' ? undefined : filter.type,
        reason: filter.reason || undefined,
        date_from: filter.date_from || undefined,
        date_to: filter.date_to || undefined,
        limit: 120,
      })
      setMovements(movementsRes.data.data)
    } catch {
      setError('Failed to load inventory log.')
    } finally {
      setMovementLoading(false)
    }
  }

  const refreshInventoryLinks = async () => {
    try {
      const logTypesRes = await listLogTypes({ include_archived: true })
      const nextLinks: Record<string, InventoryLogLink[]> = {}

      await Promise.all(logTypesRes.data.data.map(async (logType: LogType) => {
        const categoriesRes = await listLogCategories(logType.id, { include_archived: true })
        await Promise.all(categoriesRes.data.data.map(async (category) => {
          const itemsRes = await listLogItems(category.id, { include_archived: true })
          itemsRes.data.data.forEach((item) => {
            const inventoryLink = item.inventory_link
            const inventoryItemId = inventoryLink?.inventory_item_id
            if (!inventoryItemId || !inventoryLink) return
            nextLinks[inventoryItemId] = [
              ...(nextLinks[inventoryItemId] ?? []),
              {
                logTypeId: logType.id,
                logTypeName: logType.name,
                categoryId: category.id,
                categoryName: category.name,
                itemId: item.id,
                itemName: item.name,
                inventoryUnit: inventoryLink.inventory_unit,
                quantityUnit: inventoryLink.quantity_unit,
                usagePerQuantity: inventoryLink.usage_per_quantity,
              },
            ]
          })
        }))
      }))

      setInventoryLogLinks(nextLinks)
    } catch {
      setInventoryLogLinks({})
    }
  }

  useEffect(() => {
    void refreshOverview()
    void refreshInventoryLinks()
  }, [])

  useEffect(() => {
    void refreshMovements()
  }, [movementFilter])

  const categories = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.category).filter(Boolean) as string[]))
    return values.sort((a, b) => a.localeCompare(b))
  }, [items])
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.item_id, item])),
    [items],
  )
  const categoryFilterOptions = useMemo(
    () => [
      { value: 'all', label: 'All categories', keywords: ['all inventory categories'] },
      ...categories.map((category) => ({ value: category, label: category })),
    ],
    [categories],
  )

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      const matchesQuery = !needle || [
        item.name,
        item.item_id,
        item.sku ?? '',
        item.category ?? '',
        item.supplier ?? '',
        item.location ?? '',
      ].some((value) => value.toLowerCase().includes(needle))
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
      return matchesQuery && matchesCategory
    })
  }, [items, query, categoryFilter])

  const groupedInventorySections = useMemo(() => {
    const groups = new Map<string, {
      key: string
      label: string
      items: InventoryItem[]
      totalStock: number
      totalValue: number
    }>()

    filteredItems
      .slice()
      .sort((a, b) => {
        const categoryCompare = inventoryCategoryLabel(a.category).localeCompare(inventoryCategoryLabel(b.category))
        if (categoryCompare !== 0) return categoryCompare
        return a.name.localeCompare(b.name)
      })
      .forEach((item) => {
        const key = item.category?.trim() || '__uncategorized__'
        const current = groups.get(key)
        if (current) {
          current.items.push(item)
          current.totalStock += item.current_stock
          current.totalValue += item.inventory_value ?? 0
          return
        }
        groups.set(key, {
          key,
          label: inventoryCategoryLabel(item.category),
          items: [item],
          totalStock: item.current_stock,
          totalValue: item.inventory_value ?? 0,
        })
      })

    return Array.from(groups.values())
  }, [filteredItems])

  const stockLotsByItem = useMemo(() => {
    const next = new Map<string, InventoryStockLot[]>()
    stockLots.forEach((lot) => {
      const rows = next.get(lot.item_id) ?? []
      rows.push(lot)
      next.set(lot.item_id, rows)
    })
    return next
  }, [stockLots])

  const stockViewCounts = useMemo(() => ({
    all: filteredItems.length,
    in_stock: filteredItems.filter((item) => item.current_stock > 0).length,
    low_stock: filteredItems.filter((item) => item.current_stock > 0 && item.min_stock_level > 0 && item.current_stock <= item.min_stock_level).length,
    out_of_stock: filteredItems.filter((item) => item.current_stock <= 0).length,
  }), [filteredItems])

  const inventoryCategoryCount = useMemo(
    () => new Set(items.map((item) => inventoryCategoryLabel(item.category))).size,
    [items],
  )

  const linkedInventoryItemCount = useMemo(
    () => Object.keys(inventoryLogLinks).length,
    [inventoryLogLinks],
  )

  const attentionItems = useMemo(
    () => items
      .filter((item) => item.current_stock <= 0 || (item.min_stock_level > 0 && item.current_stock <= item.min_stock_level))
      .sort((a, b) => {
        const aOut = a.current_stock <= 0 ? 1 : 0
        const bOut = b.current_stock <= 0 ? 1 : 0
        if (aOut !== bOut) return bOut - aOut
        if (a.current_stock !== b.current_stock) return a.current_stock - b.current_stock
        return a.name.localeCompare(b.name)
      })
      .slice(0, 6),
    [items],
  )

  const recentMovementPreview = useMemo(
    () => movements.slice(0, 6),
    [movements],
  )

  const inventoryTabs = useMemo(
    () => [
      { value: 'overview' as InventoryTab, label: 'Overview' },
      { value: 'items' as InventoryTab, label: 'Items', count: items.length },
      { value: 'snapshot' as InventoryTab, label: 'Stock Snapshot', count: stockViewCounts.all },
      { value: 'movements' as InventoryTab, label: 'Movements', count: movements.length },
    ],
    [items.length, movements.length, stockViewCounts.all],
  )

  const currentStockRows = useMemo(() => {
    const next = filteredItems.filter((item) => {
      if (stockView === 'in_stock') return item.current_stock > 0
      if (stockView === 'low_stock') return item.current_stock > 0 && item.min_stock_level > 0 && item.current_stock <= item.min_stock_level
      if (stockView === 'out_of_stock') return item.current_stock <= 0
      return true
    })

    return next.sort((a, b) => {
      const aOut = a.current_stock <= 0 ? 1 : 0
      const bOut = b.current_stock <= 0 ? 1 : 0
      if (aOut !== bOut) return aOut - bOut

      const aLow = a.current_stock > 0 && a.min_stock_level > 0 && a.current_stock <= a.min_stock_level ? 1 : 0
      const bLow = b.current_stock > 0 && b.min_stock_level > 0 && b.current_stock <= b.min_stock_level ? 1 : 0
      if (aLow !== bLow) return bLow - aLow

      return a.name.localeCompare(b.name)
    })
  }, [filteredItems, stockView])

  const movementReasonOptions = useMemo(
    () => movementFilter.type === 'all'
      ? Object.values(MOVEMENT_REASON_OPTIONS).flat()
      : MOVEMENT_REASON_OPTIONS[movementFilter.type],
    [movementFilter.type],
  )
  const ledgerItemOptions = useMemo(
    () => [
      { value: '', label: 'All items', keywords: ['all inventory items'] },
      ...items.map((item) => ({
        value: item.item_id,
        label: `${item.name} (${item.item_id})`,
        keywords: [item.category ?? '', item.sku ?? '', item.supplier ?? '', item.location ?? ''],
      })),
    ],
    [items],
  )
  const ledgerTypeOptions = useMemo(
    () => [
      { value: 'all', label: 'All types' },
      { value: 'in', label: 'Stock in' },
      { value: 'out', label: 'Stock out' },
      { value: 'adjustment', label: 'Adjustment' },
    ],
    [],
  )
  const ledgerReasonOptions = useMemo(
    () => [
      { value: '', label: 'All reasons', keywords: ['all movement reasons'] },
      ...movementReasonOptions.map((option) => ({ value: option.value, label: option.label })),
    ],
    [movementReasonOptions],
  )

  const ledgerDays = useMemo(() => {
    const groups = new Map<string, InventoryMovement[]>()
    movements.forEach((movement) => {
      const key = movement.transaction_date || movement.created_at
      const parsedDate = parseSafeDate(key)
      const dateKey = parsedDate
        ? parsedDate.toISOString().split('T')[0]
        : 'unknown-date'
      groups.set(dateKey, [...(groups.get(dateKey) ?? []), movement])
    })
    return Array.from(groups.entries()).map(([dateKey, rows]) => {
      const purchased = rows
        .filter((row) => row.reason === 'purchase')
        .reduce((sum, row) => sum + row.quantity, 0)
      const stockIn = rows
        .filter((row) => row.type === 'in')
        .reduce((sum, row) => sum + row.quantity, 0)
      const stockOut = rows
        .filter((row) => row.type === 'out')
        .reduce((sum, row) => sum + row.quantity, 0)
      const adjustments = rows
        .filter((row) => row.type === 'adjustment')
        .reduce((sum, row) => sum + row.quantity, 0)
      const totalValue = rows.reduce((sum, row) => sum + (row.total_amount ?? 0), 0)
      return {
        dateKey,
        dateLabel: formatDisplayDateLong(dateKey),
        rows,
        purchased,
        stockIn,
        stockOut,
        adjustments,
        totalValue,
      }
    })
  }, [movements])

  const resetItemForm = () => {
    setItemDraft(EMPTY_ITEM_DRAFT)
    setEditingItem(null)
    setItemFormOpen(false)
  }

  const openCreateItem = (category = '') => {
    setActiveTab('items')
    setEditingItem(null)
    setItemDraft({
      ...EMPTY_ITEM_DRAFT,
      category,
    })
    setItemFormOpen(true)
  }

  const openEditItem = (item: InventoryItem) => {
    setActiveTab('items')
    setEditingItem(item)
    setItemDraft({
      sku: item.sku ?? '',
      name: item.name,
      category: item.category ?? '',
      unit: item.unit,
      usage_unit: item.usage_unit ?? '',
      usage_units_per_stock_unit: item.usage_units_per_stock_unit ? String(item.usage_units_per_stock_unit) : '',
      supplier: item.supplier ?? '',
      location: item.location ?? '',
      min_stock_level: String(item.min_stock_level ?? 0),
      opening_stock: String(item.current_stock ?? 0),
      last_purchase_cost: String(item.last_purchase_cost ?? 0),
      vendor_pricing: (item.vendor_pricing ?? []).map((row) => ({
        supplier_name: row.supplier_name,
        default_buy_price: String(row.default_buy_price ?? 0),
        default_sell_price: String(row.default_sell_price ?? 0),
        lead_time_days: String(row.lead_time_days ?? 0),
        preferred_supplier: Boolean(row.preferred_supplier),
        notes: row.notes ?? '',
      })),
      notes: item.notes ?? '',
    })
    setItemFormOpen(true)
  }

  const openMovement = (itemId = '', type: InventoryMovementType = 'in') => {
    setActiveTab('movements')
    setMovementDraft(emptyMovementDraft(itemId, type))
    setMovementFormOpen(true)
  }

  const submitItem = async () => {
    if (!itemDraft.name.trim()) return
    if (isNumericOnlyUnit(itemDraft.usage_unit)) {
      alert('Usage unit should be a name like "piece", "handle", or "ft" — not a number.')
      return
    }

    const payload: CreateInventoryItemPayload = {
      sku: itemDraft.sku.trim() || undefined,
      name: itemDraft.name.trim(),
      category: itemDraft.category.trim() || undefined,
      unit: itemDraft.unit.trim() || 'pcs',
      usage_unit: itemDraft.usage_unit.trim(),
      usage_units_per_stock_unit: itemDraft.usage_unit.trim()
        ? Number(itemDraft.usage_units_per_stock_unit || 0)
        : 0,
      supplier: itemDraft.supplier.trim() || undefined,
      location: itemDraft.location.trim() || undefined,
      min_stock_level: Number(itemDraft.min_stock_level || 0),
      last_purchase_cost: Number(itemDraft.last_purchase_cost || 0),
      vendor_pricing: normalizeVendorPricingDrafts(itemDraft.vendor_pricing),
      notes: itemDraft.notes.trim() || undefined,
    }

    if (!editingItem) {
      payload.opening_stock = Number(itemDraft.opening_stock || 0)
    }

    try {
      setSavingItem(true)
      if (editingItem) {
        await updateInventoryItem(editingItem.item_id, payload)
      } else {
        await createInventoryItem(payload)
      }
      resetItemForm()
      await Promise.all([refreshOverview(), refreshMovements()])
    } catch {
      alert('Failed to save inventory item')
    } finally {
      setSavingItem(false)
    }
  }

  const submitMovement = async () => {
    if (!movementDraft.item_id || !movementDraft.quantity.trim()) return
    const selectedItem = items.find((item) => item.item_id === movementDraft.item_id)
    const enteredQuantity = Number(movementDraft.quantity)
    const quantity = movementDraft.quantity_unit === 'usage'
      ? stockQuantityFromUsage(selectedItem, enteredQuantity)
      : enteredQuantity

    const payload: CreateInventoryMovementPayload = {
      item_id: movementDraft.item_id,
      type: movementDraft.type,
      reason: movementDraft.reason || undefined,
      quantity,
      unit_cost: Number(movementDraft.unit_cost || 0) || undefined,
      party: movementDraft.party.trim() || undefined,
      supplier_bucket: movementDraft.supplier_bucket.trim() || undefined,
      lot_id: movementDraft.lot_id || undefined,
      document_number: movementDraft.document_number.trim() || undefined,
      transaction_date: movementDraft.transaction_date || undefined,
      reference: movementDraft.reference.trim() || undefined,
      notes: movementDraft.notes.trim() || undefined,
    }

    try {
      setSavingMovement(true)
      await createInventoryMovement(payload)
      setMovementFormOpen(false)
      setMovementDraft(emptyMovementDraft())
      await Promise.all([refreshOverview(), refreshMovements()])
    } catch {
      alert('Failed to save inventory movement')
    } finally {
      setSavingMovement(false)
    }
  }

  const handleDelete = async (item: InventoryItem) => {
    if (!confirm(`Delete "${item.name}" and its movement history? This cannot be undone.`)) return
    try {
      await deleteInventoryItem(item.item_id)
      await Promise.all([refreshOverview(), refreshMovements()])
    } catch {
      alert('Failed to delete inventory item')
    }
  }

  const handleDeleteInventoryLink = async (link: InventoryLogLink) => {
    try {
      setDeletingInventoryLinkId(link.itemId)
      await deleteLogItemInventoryLink(link.itemId)
      await refreshInventoryLinks()
      setPendingInventoryLinkRemoval(null)
    } catch {
      alert('Failed to remove inventory link')
    } finally {
      setDeletingInventoryLinkId(null)
    }
  }

  return (
    <div className="w-full px-4 py-5 md:px-8 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-7">
        <div>
          <div className="eyebrow mb-1">Operations</div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Inventory
          </h1>
          <p className="text-[13.5px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            Track stock, suppliers, locations, and every movement in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openMovement()} className="btn btn-ghost">
            <ArrowUpCircle size={15} />
            Record movement
          </button>
          <button onClick={() => openCreateItem()} className="btn btn-accent">
            <Plus size={15} />
            Add inventory item
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4 px-4 py-3 text-[13px]" style={{ color: '#991b1b', background: '#fef2f2', borderColor: '#fecaca' }}>
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        <SummaryCard
          label="Items"
          value={String(summary?.total_items ?? 0)}
          sub="Active SKUs and stock lines"
          Icon={Boxes}
        />
        <SummaryCard
          label="On Hand"
          value={fmtMoney(summary?.total_units ?? 0)}
          sub="Total units across inventory"
          Icon={Package}
        />
        <SummaryCard
          label="Low Stock"
          value={String(summary?.low_stock_count ?? 0)}
          sub="At or below reorder level"
          Icon={AlertTriangle}
          tone="warn"
        />
        <SummaryCard
          label="Inventory Value"
          value={`Rs ${fmtMoney(summary?.inventory_value ?? 0)}`}
          sub={`${summary?.out_of_stock_count ?? 0} items out of stock`}
          Icon={History}
        />
      </div>

      <div className="card mb-4 overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Inventory workspace</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                Switch between overview, items, stock, and movement history without scrolling through one long page.
              </div>
            </div>
            <div className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>
              {inventoryCategoryCount} categories · {linkedInventoryItemCount} linked items
            </div>
          </div>
        </div>
        <InventoryTabs value={activeTab} onChange={setActiveTab} items={inventoryTabs} />
      </div>

      {itemFormOpen && (
        <ItemFormCard
          draft={itemDraft}
          editing={Boolean(editingItem)}
          saving={savingItem}
          onChange={setItemDraft}
          onCancel={resetItemForm}
          onSave={submitItem}
        />
      )}

      {movementFormOpen && (
        <MovementFormCard
          items={items}
          draft={movementDraft}
          saving={savingMovement}
          onChange={setMovementDraft}
          onCancel={() => {
            setMovementFormOpen(false)
            setMovementDraft(emptyMovementDraft())
          }}
          onSave={submitMovement}
        />
      )}

      {activeTab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] mb-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Quick actions</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                Jump into the main inventory tasks without opening every section.
              </div>
            </div>
            <div className="p-5 space-y-3">
              <button onClick={() => openCreateItem()} className="btn btn-accent w-full justify-center">
                <Plus size={15} />
                Add inventory item
              </button>
              <button onClick={() => openMovement()} className="btn btn-ghost w-full justify-center">
                <ArrowUpCircle size={15} />
                Record stock movement
              </button>
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={() => setActiveTab('snapshot')} className="rounded-2xl px-4 py-4 text-left" style={{ background: 'var(--bg-sunken)', color: 'var(--ink)' }}>
                  <div className="text-[13px] font-semibold">Open stock snapshot</div>
                  <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>Check on-hand, average cost, and supplier-wise stock.</div>
                </button>
                <button onClick={() => setActiveTab('movements')} className="rounded-2xl px-4 py-4 text-left" style={{ background: 'var(--bg-sunken)', color: 'var(--ink)' }}>
                  <div className="text-[13px] font-semibold">Open movements</div>
                  <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>See purchases, issues, adjustments, and stock history.</div>
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <OverviewInfoCard
              label="Catalog"
              value={`${inventoryCategoryCount}`}
              description={`${items.length} items across inventory categories`}
            />
            <OverviewInfoCard
              label="Linked Logs"
              value={`${linkedInventoryItemCount}`}
              description="Inventory items currently linked into Log Types"
            />
            <OverviewInfoCard
              label="Live Lots"
              value={`${stockLots.length}`}
              description="Remaining supplier lots available for allocation"
            />
            <div className="card sm:col-span-3 overflow-hidden">
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Attention needed</div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                  Items that are out of stock or have reached their reorder level.
                </div>
              </div>
              <div className="p-5">
                {attentionItems.length === 0 ? (
                  <div className="rounded-2xl px-4 py-8 text-center" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                    Inventory looks healthy right now. Nothing is low or out of stock.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {attentionItems.map((item) => {
                      const isOut = item.current_stock <= 0
                      return (
                        <button
                          key={`attention-${item.item_id}`}
                          type="button"
                          onClick={() => {
                            setCategoryFilter(item.category?.trim() || 'all')
                            setQuery(item.name)
                            setActiveTab('items')
                          }}
                          className="w-full rounded-2xl px-4 py-3 text-left transition-colors"
                          style={{ background: 'var(--bg-sunken)', color: 'var(--ink)' }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-[13px] font-semibold">{item.name}</div>
                              <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>
                                {inventoryCategoryLabel(item.category)} · Reorder at {fmtQty(item.min_stock_level, item.unit)}
                              </div>
                            </div>
                            <span
                              className="text-[10.5px] px-2 py-1 rounded-full"
                              style={isOut
                                ? { background: '#fee2e2', color: '#991b1b' }
                                : { background: '#fef3c7', color: '#92400e' }}
                            >
                              {isOut ? 'Out of stock' : `Low at ${fmtQty(item.current_stock, item.unit)}`}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card lg:col-span-2 overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Recent activity</div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                    Latest stock movements across purchases, issues, and adjustments.
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('movements')}>
                  View all movements
                </button>
              </div>
            </div>
            <div className="p-5">
              {movementLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="skeleton h-12 w-full" />
                  ))}
                </div>
              ) : recentMovementPreview.length === 0 ? (
                <div className="rounded-2xl px-4 py-8 text-center" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                  No stock movements yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentMovementPreview.map((movement) => {
                    const tone = movementTone(movement.type)
                    const movementItem = itemsById.get(movement.item_id)
                    return (
                      <div key={`overview-${movement.movement_id}`} className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-sunken)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>{movement.item_name}</span>
                              <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: tone.bg, color: tone.color }}>
                                {tone.label}
                              </span>
                            </div>
                            <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-3)' }}>
                              {movementSummaryLine(movement, movementItem)}
                            </div>
                          </div>
                          <div className="text-[10.5px] shrink-0" style={{ color: 'var(--ink-4)' }}>
                            {formatDisplayDate(movement.transaction_date || movement.created_at)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'snapshot' && (
        <div className="card mb-4 overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Current stock snapshot</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                On-hand stock is combined, so average cost and last purchase are shown separately.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StockViewChip label="All items" value={stockViewCounts.all} active={stockView === 'all'} onClick={() => setStockView('all')} />
              <StockViewChip label="In stock" value={stockViewCounts.in_stock} active={stockView === 'in_stock'} onClick={() => setStockView('in_stock')} />
              <StockViewChip label="Low stock" value={stockViewCounts.low_stock} active={stockView === 'low_stock'} onClick={() => setStockView('low_stock')} />
              <StockViewChip label="Out of stock" value={stockViewCounts.out_of_stock} active={stockView === 'out_of_stock'} onClick={() => setStockView('out_of_stock')} />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton h-11 w-full mb-2 last:mb-0" />
            ))}
          </div>
        ) : currentStockRows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Package size={22} className="mx-auto mb-3" style={{ color: 'var(--ink-4)' }} />
            <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>No items in this stock view</p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
              Change the search, category, or stock filter to see a different snapshot.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-[12.5px]">
              <thead>
                <tr style={{ background: 'var(--bg-sunken)' }}>
                  <th className="px-5 py-3 text-left eyebrow">Item</th>
                  <th className="px-4 py-3 text-left eyebrow">Category</th>
                  <th className="px-4 py-3 text-left eyebrow">On hand</th>
                  <th className="px-4 py-3 text-left eyebrow">Avg cost</th>
                  <th className="px-4 py-3 text-left eyebrow">Last purchase</th>
                  <th className="px-4 py-3 text-left eyebrow">Usage</th>
                  <th className="px-4 py-3 text-left eyebrow">By supplier</th>
                  <th className="px-4 py-3 text-left eyebrow">Location</th>
                  <th className="px-4 py-3 text-left eyebrow">Status</th>
                </tr>
              </thead>
              <tbody>
                {currentStockRows.map((item) => {
                  const isOut = item.current_stock <= 0
                  const isLow = !isOut && item.min_stock_level > 0 && item.current_stock <= item.min_stock_level
                  const itemLots = stockLotsByItem.get(item.item_id) ?? []
                  const supplierRows = aggregateSupplierLots(itemLots)
                  return (
                    <tr key={`snapshot-${item.item_id}`} style={{ borderTop: '1px solid var(--line-2)' }}>
                      <td className="px-5 py-3">
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>{item.name}</div>
                        <div className="text-[11px] mt-0.5 flex flex-wrap gap-2" style={{ color: 'var(--ink-4)' }}>
                          <span className="numeral">{item.item_id}</span>
                          <span>SKU {item.sku || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{item.category || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium numeral" style={{ color: 'var(--ink)' }}>{fmtQty(item.current_stock, item.unit)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Reorder at {fmtQty(item.min_stock_level, item.unit)}</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        <div className="font-medium numeral" style={{ color: 'var(--ink)' }}>{formatCostValue(item.average_unit_cost)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Weighted across stock on hand</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        <div className="font-medium numeral" style={{ color: 'var(--ink)' }}>{formatCostValue(item.last_purchase_cost)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>Latest buy rate</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{usageConversionLabel(item) || '—'}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        {supplierRows.length > 0 ? (
                          <div className="space-y-1">
                            {supplierRows.map((row) => (
                              <div key={`${item.item_id}-${row.supplier}`} className="text-[11.5px]">
                                {row.supplier} · {fmtQty(row.quantity, row.unit)}{row.averageUnitCost ? ` @ Rs ${fmtMoney(row.averageUnitCost)}` : ''}
                              </div>
                            ))}
                          </div>
                        ) : (
                          item.supplier || '—'
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{item.location || '—'}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10.5px] px-1.5 py-0.5 rounded-full"
                          style={isOut
                            ? { background: '#fee2e2', color: '#991b1b' }
                            : isLow
                              ? { background: '#fef3c7', color: '#92400e' }
                              : { background: '#dcfce7', color: '#166534' }}
                        >
                          {isOut ? 'Out of stock' : isLow ? 'Low stock' : 'Available'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {linkManagerItem && (
        <InventoryLinkManagerModal
          item={linkManagerItem}
          links={inventoryLogLinks[linkManagerItem.item_id] ?? []}
          deletingLinkId={deletingInventoryLinkId}
          pendingRemoval={pendingInventoryLinkRemoval}
          onClose={() => {
            setLinkManagerItem(null)
            setPendingInventoryLinkRemoval(null)
          }}
          onOpenLink={(link) => navigate(`/log-types/${link.logTypeId}?category=${link.categoryId}&item=${link.itemId}`)}
          onRequestRemove={(link) => setPendingInventoryLinkRemoval(link)}
          onCancelRemove={() => setPendingInventoryLinkRemoval(null)}
          onConfirmRemove={(link) => void handleDeleteInventoryLink(link)}
        />
      )}

      {activeTab === 'items' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="input flex-1 min-w-[220px]"
                  placeholder="Search by item, SKU, category, supplier, location…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <SearchableSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={categoryFilterOptions}
                  placeholder="All categories"
                  searchPlaceholder="Search category…"
                  emptyMessage="No categories found"
                  className="w-[180px]"
                />
              </div>
            </div>

            {loading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="px-5 py-4" style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <div className="skeleton h-4 w-44 mb-2" />
                  <div className="skeleton h-3 w-64" />
                </div>
              ))
            ) : groupedInventorySections.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                  <Package size={22} />
                </div>
                <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>No inventory items found</p>
                <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
                  Add your first board, hardware item, or consumable to start tracking stock.
                </p>
              </div>
            ) : (
              groupedInventorySections.map((section, sectionIndex) => (
                <div key={section.key} style={{ borderTop: sectionIndex === 0 ? 'none' : '1px solid var(--line-2)' }}>
                  <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3" style={{ background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)' }}>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{section.label}</span>
                        <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'white', color: 'var(--ink-3)' }}>
                          {section.items.length} {section.items.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                      <div className="text-[12px] mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--ink-4)' }}>
                        <span>On hand <strong style={{ color: 'var(--ink-2)' }}>{fmtMoney(section.totalStock)}</strong></span>
                        <span>Stock value <strong style={{ color: 'var(--ink-2)' }}>{formatCostValue(section.totalValue)}</strong></span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCreateItem(section.key === '__uncategorized__' ? '' : section.label)}
                      className="btn btn-ghost btn-sm"
                    >
                      <Plus size={13} />
                      Add item
                    </button>
                  </div>

                  {section.items.map((item) => {
                    const isOut = item.current_stock <= 0
                    const isLow = item.min_stock_level > 0 && item.current_stock <= item.min_stock_level
                    const itemLots = stockLotsByItem.get(item.item_id) ?? []
                    const supplierRows = aggregateSupplierLots(itemLots)
                    const vendorPricingRows = item.vendor_pricing ?? []
                    return (
                      <div key={item.item_id} className="group px-5 py-4" style={{ borderBottom: '1px solid var(--line-2)' }}>
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="flex-1 min-w-[220px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{item.name}</span>
                              <span className="text-[10.5px] px-1.5 py-0.5 rounded-full numeral" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
                                {item.item_id}
                              </span>
                              {isOut && (
                                <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#991b1b' }}>
                                  Out of stock
                                </span>
                              )}
                              {!isOut && isLow && (
                                <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                                  Low stock
                                </span>
                              )}
                            </div>
                            <div className="text-[12px] mt-1.5 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--ink-3)' }}>
                              <span>SKU: <strong style={{ color: 'var(--ink-2)' }}>{item.sku || '—'}</strong></span>
                              <span>Supplier: <strong style={{ color: 'var(--ink-2)' }}>{item.supplier || '—'}</strong></span>
                              <span>Location: <strong style={{ color: 'var(--ink-2)' }}>{item.location || '—'}</strong></span>
                              <span>Last purchase: <strong style={{ color: 'var(--ink-2)' }}>{formatCostValue(item.last_purchase_cost)}</strong></span>
                              <span>Avg cost: <strong style={{ color: 'var(--ink-2)' }}>{formatCostValue(item.average_unit_cost)}</strong></span>
                              {usageConversionLabel(item) && (
                                <span>Usage: <strong style={{ color: 'var(--ink-2)' }}>{usageConversionLabel(item)}</strong></span>
                              )}
                            </div>
                            {supplierRows.length > 0 && (
                              <div className="mt-2">
                                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-4)' }}>Vendor-wise stock</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {supplierRows.map((row) => (
                                    <span
                                      key={`${item.item_id}-${row.supplier}`}
                                      className="text-[11px] px-2 py-1 rounded-full"
                                      style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}
                                    >
                                      {row.supplier} · {fmtQty(row.quantity, row.unit)}{row.averageUnitCost ? ` @ Rs ${fmtMoney(row.averageUnitCost)}` : ''}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {vendorPricingRows.length > 0 && (
                              <div className="mt-2">
                                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-4)' }}>Vendor selling prices</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {vendorPricingRows.map((row) => (
                                    <span
                                      key={`${item.item_id}-sell-${row.supplier_name}`}
                                      className="text-[11px] px-2 py-1 rounded-full"
                                      style={{ background: row.preferred_supplier ? 'var(--accent-wash)' : 'var(--bg-sunken)', color: row.preferred_supplier ? 'var(--accent-ink)' : 'var(--ink-2)' }}
                                    >
                                      {row.supplier_name} · Sell Rs {fmtMoney(row.default_sell_price ?? 0)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {(inventoryLogLinks[item.item_id] ?? []).length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span
                                  className="text-[10.5px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'color-mix(in oklab, var(--accent) 14%, white)', color: 'var(--accent-ink)' }}
                                >
                                  Linked in Log Types
                                </span>
                                <span className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                                  {inventoryLogLinks[item.item_id].length} linked {inventoryLogLinks[item.item_id].length === 1 ? 'item' : 'items'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingInventoryLinkRemoval(null)
                                    setLinkManagerItem(item)
                                  }}
                                  className="text-[10.5px] px-2 py-1 rounded-full"
                                  style={{ background: 'var(--bg-sunken)', color: 'var(--ink-2)' }}
                                >
                                  Manage links
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-3 min-w-[240px] md:min-w-[360px]">
                            <MetricCell label="On hand" value={fmtQty(item.current_stock, item.unit)} />
                            <MetricCell label="Reorder at" value={fmtQty(item.min_stock_level, item.unit)} />
                            <MetricCell label="Avg cost" value={formatCostValue(item.average_unit_cost)} />
                            <MetricCell label="Last purchase" value={formatCostValue(item.last_purchase_cost)} />
                            <MetricCell label="Stock value" value={formatCostValue(item.inventory_value)} />
                            <MetricCell label="Updated" value={new Date(item.updated_at).toLocaleDateString()} />
                          </div>

                          <div className="flex items-center gap-1 opacity-100 xl:opacity-0 xl:group-hover:opacity-100 transition-opacity">
                            <HoverTip content="Stock in: use this when new quantity is added to inventory, like a purchase or return from site.">
                              <button className="btn btn-ghost btn-sm btn-icon" title="Stock in" onClick={() => openMovement(item.item_id, 'in')}>
                                <ArrowUpCircle size={14} />
                              </button>
                            </HoverTip>
                            <HoverTip content="Stock out: use this when quantity leaves inventory, like site issue, usage, or damage.">
                              <button className="btn btn-ghost btn-sm btn-icon" title="Stock out" onClick={() => openMovement(item.item_id, 'out')}>
                                <ArrowDownCircle size={14} />
                              </button>
                            </HoverTip>
                            <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openEditItem(item)}>
                              <Pencil size={13} />
                            </button>
                            <button className="btn btn-ghost btn-sm btn-icon" title="Delete" style={{ color: 'var(--bad)' }} onClick={() => handleDelete(item)}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-4 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Inventory Log</div>
                <div className="text-[11.5px]" style={{ color: 'var(--ink-4)' }}>Latest ledger entries with reason and balance</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => openMovement()}>
                <Plus size={13} />
                Add
              </button>
            </div>

            <div className="max-h-[720px] overflow-y-auto">
              {movementLoading ? (
                [...Array(6)].map((_, i) => (
                  <div key={i} className="px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <div className="skeleton h-4 w-32 mb-2" />
                    <div className="skeleton h-3 w-48" />
                  </div>
                ))
              ) : movements.length === 0 ? (
                <div className="px-4 py-14 text-center">
                  <History size={20} className="mx-auto mb-3" style={{ color: 'var(--ink-4)' }} />
                  <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>No stock movements yet.</p>
                </div>
              ) : (
                movements.map((movement) => {
                  const tone = movementTone(movement.type)
                  const movementItem = itemsById.get(movement.item_id)
                  return (
                    <div key={movement.movement_id} className="px-4 py-3" style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: tone.bg, color: tone.color }}>
                          {movement.type === 'in' ? <ArrowUpCircle size={15} /> : movement.type === 'out' ? <ArrowDownCircle size={15} /> : <History size={15} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>{movement.item_name}</span>
                            <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: tone.bg, color: tone.color }}>
                              {tone.label}
                            </span>
                          </div>
                          <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-3)' }}>
                            {movementSummaryLine(movement, movementItem)}
                          </div>
                          {(movement.supplier_bucket || movement.party || movement.unit_cost) && (
                            <div className="text-[11px] mt-1" style={{ color: 'var(--ink-4)' }}>
                              {movement.supplier_bucket ? `Supplier ${movement.supplier_bucket}` : 'Supplier —'}
                              {movement.party ? ` · Party ${movement.party}` : ''}
                              {movement.unit_cost ? ` · Rate Rs ${fmtMoney(movement.unit_cost)}` : ''}
                            </div>
                          )}
                          {formatMovementReferenceHint(movement) && (
                            <div className="text-[11px] mt-1" style={{ color: 'var(--ink-4)' }}>
                              {formatMovementReferenceHint(movement)}
                            </div>
                          )}
                          {movement.notes && (
                            <div className="text-[11px] mt-1" style={{ color: 'var(--ink-4)' }}>{movement.notes}</div>
                          )}
                        </div>
                        <div className="text-[10.5px] text-right shrink-0" style={{ color: 'var(--ink-4)' }}>
                          {formatDisplayDate(movement.transaction_date || movement.created_at)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'movements' && (
      <div className="card mt-4 overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>Day-wise inventory ledger</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                See what was purchased, issued, adjusted, and valued on each date.
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setMovementFilter(EMPTY_MOVEMENT_FILTER)}>
              Reset filters
            </button>
          </div>
          <div className="grid gap-3 mt-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Ledger item">
              <SearchableSelect
                value={movementFilter.item_id}
                onChange={(value) => setMovementFilter((prev) => ({ ...prev, item_id: value }))}
                options={ledgerItemOptions}
                placeholder="All items"
                searchPlaceholder="Search inventory item…"
                emptyMessage="No inventory items found"
              />
            </Field>
            <Field label="Movement type">
              <SearchableSelect
                value={movementFilter.type}
                onChange={(value) => setMovementFilter((prev) => ({
                  ...prev,
                  type: value as MovementFilter['type'],
                  reason: '',
                }))}
                options={ledgerTypeOptions}
                placeholder="All types"
                searchPlaceholder="Search movement type…"
                emptyMessage="No movement types found"
              />
            </Field>
            <Field label="Reason">
              <SearchableSelect
                value={movementFilter.reason}
                onChange={(value) => setMovementFilter((prev) => ({ ...prev, reason: value }))}
                options={ledgerReasonOptions}
                placeholder="All reasons"
                searchPlaceholder="Search reason…"
                emptyMessage="No reasons found"
              />
            </Field>
            <Field label="From date">
              <DatePicker value={movementFilter.date_from} onChange={(value) => setMovementFilter((prev) => ({ ...prev, date_from: value }))} />
            </Field>
            <Field label="To date">
              <DatePicker value={movementFilter.date_to} onChange={(value) => setMovementFilter((prev) => ({ ...prev, date_to: value }))} />
            </Field>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {movementLoading ? (
            [...Array(3)].map((_, index) => (
              <div key={index} className="rounded-xl px-4 py-4" style={{ background: 'var(--bg-sunken)' }}>
                <div className="skeleton h-4 w-40 mb-3" />
                <div className="skeleton h-3 w-full mb-2" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            ))
          ) : ledgerDays.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <History size={22} className="mx-auto mb-3" style={{ color: 'var(--ink-4)' }} />
              <p className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>No ledger entries found</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--ink-4)' }}>
                Change the filters or record a stock movement to start your inventory register.
              </p>
            </div>
          ) : (
            ledgerDays.map((day) => (
              <div key={day.dateKey} className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--line-2)' }}>
                <div className="px-4 py-3.5" style={{ background: 'var(--bg-sunken)', borderBottom: '1px solid var(--line-2)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{day.dateLabel}</div>
                      <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>
                        {day.rows.length} {day.rows.length === 1 ? 'entry' : 'entries'} · Value Rs {fmtMoney(day.totalValue)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="chip">Purchased {day.purchased}</span>
                      <span className="chip">In {day.stockIn}</span>
                      <span className="chip">Out {day.stockOut}</span>
                      <span className="chip">Adjust {day.adjustments}</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                          <table className="w-full min-w-[1160px] text-[12.5px]">
                    <thead>
                      <tr style={{ background: 'white' }}>
                        <th className="px-4 py-2 text-left eyebrow">Item</th>
                        <th className="px-4 py-2 text-left eyebrow">Type</th>
                        <th className="px-4 py-2 text-left eyebrow">Reason</th>
                        <th className="px-4 py-2 text-left eyebrow">Usage / Qty</th>
                        <th className="px-4 py-2 text-left eyebrow">Stock effect</th>
                        <th className="px-4 py-2 text-left eyebrow">Balance</th>
                        <th className="px-4 py-2 text-left eyebrow">Supplier / Source</th>
                        <th className="px-4 py-2 text-left eyebrow">Party</th>
                        <th className="px-4 py-2 text-left eyebrow">Document</th>
                        <th className="px-4 py-2 text-right eyebrow">Rate</th>
                        <th className="px-4 py-2 text-right eyebrow">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.rows.map((movement) => {
                        const tone = movementTone(movement.type)
                        const movementItem = itemsById.get(movement.item_id)
                        const movementDisplay = inferredMovementDisplay(movement, movementItem)
                        return (
                          <tr key={movement.movement_id} style={{ borderTop: '1px solid var(--line-2)' }}>
                            <td className="px-4 py-3">
                              <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{movement.item_name}</div>
                              <div className="text-[11px] numeral" style={{ color: 'var(--ink-4)' }}>{movement.item_id}</div>
                              {movement.lot_label && (
                                <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>{movement.lot_label}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: tone.bg, color: tone.color }}>
                                {tone.label}
                              </span>
                            </td>
                            <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{movementReasonLabel(movement.reason)}</td>
                            <td className="px-4 py-3" style={{ color: 'var(--ink)' }}>
                              <div className="numeral" style={{ color: movement.type === 'out' ? '#991b1b' : 'var(--ink)' }}>
                                {movementDisplayQty(movement, movementItem)}
                              </div>
                              {movementDisplay && (
                                <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
                                  {movementDisplay.inferred ? 'Converted from project quantity' : 'Logged from project entry'}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 numeral" style={{ color: movement.type === 'out' ? '#991b1b' : 'var(--ink-2)' }}>
                              {movementStockEffectLabel(movement)}
                            </td>
                            <td className="px-4 py-3 numeral" style={{ color: 'var(--ink)' }}>{movementBalanceLabel(movement, movementItem)}</td>
                            <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{movementSourceText(movement)}</td>
                            <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>{movementPartyText(movement)}</td>
                            <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                              <div>{formatMovementDocumentLabel(movement)}</div>
                              {formatMovementReferenceHint(movement) && (
                                <div className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
                                  {formatMovementReferenceHint(movement)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right numeral" style={{ color: 'var(--ink-2)' }}>
                              {movement.unit_cost ? `Rs ${fmtMoney(movement.unit_cost)}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right numeral" style={{ color: 'var(--ink)' }}>
                              {movement.total_amount ? `Rs ${fmtMoney(movement.total_amount)}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      )}
    </div>
  )
}

function InventoryLinkManagerModal({
  item,
  links,
  deletingLinkId,
  pendingRemoval,
  onClose,
  onOpenLink,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  item: InventoryItem
  links: InventoryLogLink[]
  deletingLinkId: string | null
  pendingRemoval: InventoryLogLink | null
  onClose: () => void
  onOpenLink: (link: InventoryLogLink) => void
  onRequestRemove: (link: InventoryLogLink) => void
  onCancelRemove: () => void
  onConfirmRemove: (link: InventoryLogLink) => void
}) {
  return (
    <Modal open onClose={onClose} panelClassName="max-w-5xl">
      <div
        className="w-full rounded-[28px] overflow-hidden"
        style={{ background: 'white', boxShadow: '0 28px 80px rgba(15, 23, 42, 0.25)' }}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
          <div>
            <div className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>Manage inventory links</div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
              <strong style={{ color: 'var(--ink-2)' }}>{item.name}</strong> is linked to {links.length} {links.length === 1 ? 'log item' : 'log items'}.
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'var(--ink-4)' }}>
              Remove a link only when this inventory item should no longer be consumed by future project logs for that log item. Past entries stay unchanged.
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-icon" title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="rounded-2xl px-4 py-3" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
            Unlinking stops future stock deduction for that linked log item. Historical project logs and historical inventory movements are not deleted.
          </div>

          {links.length === 0 ? (
            <div className="rounded-2xl px-4 py-10 text-center" style={{ border: '1px solid var(--line-2)', color: 'var(--ink-3)' }}>
              This inventory item has no linked log items right now.
            </div>
          ) : (
            <div className="space-y-3">
              {links.map((link) => {
                const isPending = pendingRemoval?.itemId === link.itemId
                const isDeleting = deletingLinkId === link.itemId
                return (
                  <div key={link.itemId} className="rounded-2xl px-4 py-4" style={{ border: '1px solid var(--line-2)' }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                          {link.logTypeName} / {link.categoryName} / {link.itemName}
                        </div>
                        <div className="text-[12px] mt-1 flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--ink-3)' }}>
                          <span>Usage rule: <strong style={{ color: 'var(--ink-2)' }}>{inventoryLinkUsageLabel(link)}</strong></span>
                          <span className="numeral">Log item ID: {link.itemId}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => onOpenLink(link)} className="btn btn-ghost btn-sm">
                          Open
                        </button>
                        <button
                          onClick={() => onRequestRemove(link)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#991b1b' }}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Removing…' : 'Unlink'}
                        </button>
                      </div>
                    </div>

                    {isPending && (
                      <div className="mt-4 rounded-2xl px-4 py-4" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                        <div className="text-[13px] font-semibold" style={{ color: '#991b1b' }}>Remove this link?</div>
                        <div className="text-[12px] mt-1" style={{ color: '#7f1d1d' }}>
                          Future logs for <strong>{link.itemName}</strong> will no longer deduct stock from <strong>{item.name}</strong>.
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: '#7f1d1d' }}>
                          Past project logs and past inventory movements will remain as they are.
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button onClick={onCancelRemove} className="btn btn-ghost btn-sm">Cancel</button>
                          <button
                            onClick={() => onConfirmRemove(link)}
                            className="btn btn-sm"
                            style={{ background: '#991b1b', color: 'white' }}
                            disabled={isDeleting}
                          >
                            {isDeleting ? 'Removing…' : 'Confirm unlink'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  Icon,
  tone = 'default',
}: {
  label: string
  value: string
  sub: string
  Icon: React.ComponentType<{ size?: number }>
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="card px-4 py-4">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={tone === 'warn'
            ? { background: '#fef3c7', color: '#92400e' }
            : { background: 'var(--accent-wash)', color: 'var(--accent-ink)' }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-1">{label}</div>
          <div className="text-[23px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>{value}</div>
          <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>{sub}</div>
        </div>
      </div>
    </div>
  )
}

function InventoryTabs({
  value,
  onChange,
  items,
}: {
  value: InventoryTab
  onChange: (next: InventoryTab) => void
  items: Array<{ value: InventoryTab; label: string; count?: number }>
}) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto" style={{ borderTop: '1px solid var(--line)' }}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className="relative flex h-11 shrink-0 items-center gap-2 px-4 text-[13px] font-medium transition-colors"
            style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: active ? 'var(--accent-wash)' : 'var(--bg-sunken)',
                  color: active ? 'var(--accent-ink)' : 'var(--ink-3)',
                }}
              >
                {item.count}
              </span>
            )}
            {active && <div className="tab-active-bar" />}
          </button>
        )
      })}
    </div>
  )
}

function OverviewInfoCard({
  label,
  value,
  description,
}: {
  label: string
  value: string
  description: string
}) {
  return (
    <div className="card px-4 py-4">
      <div className="text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</div>
      <div className="text-[24px] font-semibold mt-2" style={{ color: 'var(--ink)' }}>{value}</div>
      <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink-4)' }}>{description}</div>
    </div>
  )
}

function StockViewChip({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-[11.5px] transition-colors"
      style={active
        ? { background: 'var(--accent)', color: 'white' }
        : { background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}
    >
      {label} · {value}
    </button>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-sunken)' }}>
      <div className="text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>{label}</div>
      <div className="text-[12.5px] font-semibold mt-1" style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function ItemFormCard({
  draft,
  editing,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ItemDraft
  editing: boolean
  saving: boolean
  onChange: (draft: ItemDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value })

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
        <div>
          <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>{editing ? 'Edit inventory item' : 'Add inventory item'}</div>
          <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
            {editing ? 'Update metadata without disturbing current stock.' : 'Set up an inventory record with opening stock and reorder level.'}
          </div>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm btn-icon" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Item name" tooltip="The main name you will search, select, and see across inventory and linked logs.">
            <input autoFocus className="input" value={draft.name} onChange={(e) => update('name', e.target.value)} placeholder="18mm BWP plywood" />
          </Field>
          <Field label="SKU" tooltip="A short stock code for this item, useful when names are similar or repeated across brands and sizes.">
            <input className="input" value={draft.sku} onChange={(e) => update('sku', e.target.value)} placeholder="PLY-18-BWP" />
          </Field>
          <Field label="Category" tooltip="A grouping label such as Hardware, Boards, Laminate, or Accessories to keep inventory organized.">
            <input className="input" value={draft.category} onChange={(e) => update('category', e.target.value)} placeholder="Boards / Hardware / Laminate" />
          </Field>
          <Field label="Unit" tooltip="The stock unit this item is purchased and stored in, such as packet, box, sheet, piece, or meter.">
            <input className="input" value={draft.unit} onChange={(e) => update('unit', e.target.value)} placeholder="pcs / sheets / boxes" />
          </Field>
          <Field label="Usage unit name" tooltip="The unit name in which this item is consumed on site or in logs, such as piece, handle, or foot. Do not enter a number here.">
            <input className="input" value={draft.usage_unit} onChange={(e) => update('usage_unit', e.target.value)} placeholder="piece / handle / ft (optional)" />
          </Field>
          <Field label="Usage units per stock unit" tooltip="How many usage units are inside one stock unit. Example: 1 packet = 10 handles, so enter 10.">
            <input
              className="input numeral"
              type="number"
              min="0"
              step="any"
              value={draft.usage_units_per_stock_unit}
              onChange={(e) => update('usage_units_per_stock_unit', e.target.value)}
              placeholder="10"
            />
          </Field>
          <Field label="Supplier" tooltip="The vendor or shop you usually buy this item from.">
            <input className="input" value={draft.supplier} onChange={(e) => update('supplier', e.target.value)} placeholder="Supplier name" />
          </Field>
          <Field label="Location" tooltip="Where this stock is physically kept, such as Main Store, Rack A2, Site Store, or Godown.">
            <input className="input" value={draft.location} onChange={(e) => update('location', e.target.value)} placeholder="Main store / Rack A2" />
          </Field>
          <Field label="Reorder level" tooltip="The minimum quantity at which the system should treat this item as low stock and ready for repurchase.">
            <input className="input numeral" type="number" value={draft.min_stock_level} onChange={(e) => update('min_stock_level', e.target.value)} />
          </Field>
          {!editing && (
            <Field label="Opening stock" tooltip="The quantity you already have right now when creating this inventory item for the first time.">
              <input className="input numeral" type="number" value={draft.opening_stock} onChange={(e) => update('opening_stock', e.target.value)} />
            </Field>
          )}
          <Field label="Last purchase price" tooltip="The most recent buy rate for one stock unit. Mixed on-hand stock will still show a separate average cost based on the remaining lots.">
            <input className="input numeral" type="number" value={draft.last_purchase_cost} onChange={(e) => update('last_purchase_cost', e.target.value)} />
          </Field>
        </div>

        <div className="rounded-xl px-4 py-3 text-[12px]" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
          Stock is tracked in <strong style={{ color: 'var(--ink)' }}>{draft.unit || 'pcs'}</strong>.
          {isNumericOnlyUnit(draft.usage_unit)
            ? ' Usage unit should be a name like "piece" or "handle", not a number.'
            : draft.usage_unit.trim() && Number(draft.usage_units_per_stock_unit || 0) > 0
            ? ` Usage can also be tracked in ${draft.usage_unit.trim()}. For example, 1 ${draft.unit || 'pcs'} = ${draft.usage_units_per_stock_unit} ${draft.usage_unit.trim()}. This makes log-item linking much easier.`
            : draft.usage_unit.trim()
              ? ' Add how many usage units are inside one stock unit to see a clear conversion example here.'
              : ' If you buy in packets/boxes but use individual pieces, add a usage unit and pack size here.'}
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-elev)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Vendor selling prices</div>
              <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>
                Set default buy and sell prices per vendor. Daily logs use the chosen vendor lot price, so one item like Handle can behave differently for JK, MK, and NK.
              </div>
            </div>
            <button
              type="button"
              onClick={() => update('vendor_pricing', [...draft.vendor_pricing, {
                supplier_name: '',
                default_buy_price: '',
                default_sell_price: '',
                lead_time_days: '',
                preferred_supplier: draft.vendor_pricing.length === 0,
                notes: '',
              }])}
              className="btn btn-ghost"
            >
              <Plus size={13} /> Add vendor
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {draft.vendor_pricing.length === 0 ? (
              <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
                No vendor pricing yet. Add vendors like `JK`, `MK`, and `NK` with their default sell prices.
              </div>
            ) : draft.vendor_pricing.map((row, index) => (
              <div key={`vendor-pricing-${index}`} className="rounded-xl border p-3" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-sunken)' }}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="Vendor" tooltip="Supplier or vendor name for this commercial price card.">
                    <input className="input" value={row.supplier_name} onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => rowIndex === index ? { ...entry, supplier_name: e.target.value } : entry))} placeholder="JK Suppliers" />
                  </Field>
                  <Field label="Default buy" tooltip="Typical purchase price from this vendor, used as a commercial reference.">
                    <input className="input numeral" type="number" min="0" step="any" value={row.default_buy_price} onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => rowIndex === index ? { ...entry, default_buy_price: e.target.value } : entry))} placeholder="90" />
                  </Field>
                  <Field label="Default sell" tooltip="Selling price for this vendor. Daily logs multiply this price by the logged quantity when stock is taken from this vendor's lot.">
                    <input className="input numeral" type="number" min="0" step="any" value={row.default_sell_price} onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => rowIndex === index ? { ...entry, default_sell_price: e.target.value } : entry))} placeholder="130" />
                  </Field>
                  <Field label="Lead time" tooltip="Typical lead time in days for this vendor.">
                    <input className="input numeral" type="number" min="0" step="1" value={row.lead_time_days} onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => rowIndex === index ? { ...entry, lead_time_days: e.target.value } : entry))} placeholder="2" />
                  </Field>
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>Preferred</span>
                    <label className="flex h-10 items-center gap-2 rounded-lg border px-3" style={{ borderColor: 'var(--line-2)', background: 'var(--bg-elev)', color: 'var(--ink-2)' }}>
                      <input
                        type="checkbox"
                        checked={row.preferred_supplier}
                        onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => ({
                          ...entry,
                          preferred_supplier: rowIndex === index ? e.target.checked : (e.target.checked ? false : entry.preferred_supplier),
                        })))}
                      />
                      Default vendor
                    </label>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-3">
                  <div className="flex-1">
                    <Field label="Vendor notes" tooltip="Commercial notes like finish, discount pattern, or special terms for this vendor.">
                      <input className="input" value={row.notes} onChange={(e) => update('vendor_pricing', draft.vendor_pricing.map((entry, rowIndex) => rowIndex === index ? { ...entry, notes: e.target.value } : entry))} placeholder="Premium finish, faster delivery, or better packaging" />
                    </Field>
                  </div>
                  <button type="button" onClick={() => update('vendor_pricing', draft.vendor_pricing.filter((_, rowIndex) => rowIndex !== index))} className="btn btn-ghost" style={{ color: 'var(--bad)' }}>
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Field label="Notes" tooltip="Any extra details like brand, finish, size, quality, vendor terms, or handling instructions.">
          <textarea className="input min-h-[92px] resize-none" value={draft.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Board grade, color, vendor terms, or special handling notes" />
        </Field>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button onClick={onSave} disabled={!draft.name.trim() || saving} className="btn btn-accent" style={saving ? { opacity: 1, cursor: 'wait' } : undefined}>
            {saving ? <span className="save-spinner" /> : <Check size={13} />}
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MovementFormCard({
  items,
  draft,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  items: InventoryItem[]
  draft: MovementDraft
  saving: boolean
  onChange: (draft: MovementDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const [availableLots, setAvailableLots] = useState<InventoryStockLot[]>([])
  const update = <K extends keyof MovementDraft>(key: K, value: MovementDraft[K]) => onChange({ ...draft, [key]: value })
  const reasonOptions = MOVEMENT_REASON_OPTIONS[draft.type]
  const itemOptions = [
    { value: '', label: 'Select item', keywords: ['inventory item'] },
    ...items.map((item) => ({
      value: item.item_id,
      label: `${item.name} (${item.item_id})`,
      keywords: [item.category ?? '', item.sku ?? '', item.supplier ?? ''],
    })),
  ]
  const typeOptions = [
    { value: 'in', label: 'Stock in' },
    { value: 'out', label: 'Stock out' },
    { value: 'adjustment', label: 'Adjustment' },
  ]
  const selectedItem = items.find((item) => item.item_id === draft.item_id)
  const hasUsageUnit = Boolean(
    selectedItem?.usage_unit &&
    selectedItem.usage_units_per_stock_unit &&
    selectedItem.usage_units_per_stock_unit > 0 &&
    selectedItem.usage_unit !== selectedItem.unit,
  )
  const needsLotSelection = (draft.type === 'out' || draft.type === 'adjustment') && availableLots.length > 0
  const sourceFieldMeta = movementSourceFieldMeta(draft.type)
  const partyFieldMeta = movementPartyFieldMeta(draft.type)
  const documentFieldMeta = movementDocumentFieldMeta(draft.type)

  useEffect(() => {
    if (!draft.item_id) {
      setAvailableLots([])
      return
    }
    listInventoryStockLots(draft.item_id)
      .then((response) => {
        const rows = response.data.data ?? []
        setAvailableLots(rows)
        if (rows.length === 1 && !draft.lot_id) {
          update('lot_id', rows[0].lot_id)
        } else if (draft.lot_id && !rows.some((lot) => lot.lot_id === draft.lot_id)) {
          update('lot_id', '')
        }
      })
      .catch(() => setAvailableLots([]))
  }, [draft.item_id])

  useEffect(() => {
    if (!selectedItem) return
    if ((draft.type === 'in' || draft.type === 'adjustment') && !draft.supplier_bucket.trim() && selectedItem.supplier) {
      update('supplier_bucket', selectedItem.supplier)
    }
    if (!hasUsageUnit && draft.quantity_unit !== 'stock') {
      update('quantity_unit', 'stock')
    }
  }, [selectedItem?.item_id, selectedItem?.supplier, draft.type, hasUsageUnit])

  const quantityPreview = (() => {
    if (!selectedItem || !draft.quantity.trim()) return null
    const parsed = Number(draft.quantity)
    if (!Number.isFinite(parsed) || parsed === 0) return null
    if (!hasUsageUnit || draft.quantity_unit === 'stock') return null
    const converted = stockQuantityFromUsage(selectedItem, parsed)
    return `${parsed} ${selectedItem.usage_unit} = ${converted.toFixed(2)} ${selectedItem.unit}`
  })()

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-sunken)' }}>
        <div>
          <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>Record stock movement</div>
          <div className="text-[12px]" style={{ color: 'var(--ink-4)' }}>
            Use positive quantity for stock in/out. For adjustments, positive adds stock and negative reduces it.
          </div>
          <div className="text-[11.5px] mt-1" style={{ color: 'var(--ink-4)' }}>
            For purchases, fill <strong style={{ color: 'var(--ink-2)' }}>Supplier / stock source</strong> with the vendor name so future logs clearly show whether stock came from JK Screws, MK Screws, or someone else.
          </div>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm btn-icon" title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="p-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Transaction date" tooltip="The business date this purchase, issue, or adjustment should appear under in the inventory register.">
          <DatePicker value={draft.transaction_date} onChange={(value) => update('transaction_date', value)} />
        </Field>
        <Field label="Item" tooltip="Choose which inventory item this stock movement belongs to.">
          <SearchableSelect
            value={draft.item_id}
            onChange={(value) => onChange({ ...draft, item_id: value, lot_id: '' })}
            options={itemOptions}
            placeholder="Select item"
            searchPlaceholder="Search inventory item…"
            emptyMessage="No inventory items found"
          />
        </Field>
        <Field label="Type" tooltip="Select whether stock is coming in, going out, or being corrected manually.">
          <SearchableSelect
            value={draft.type}
            onChange={(value) => onChange({ ...draft, type: value as InventoryMovementType, reason: defaultReasonForType(value as InventoryMovementType), lot_id: '' })}
            options={typeOptions}
            placeholder="Select type"
            searchPlaceholder="Search movement type…"
            emptyMessage="No movement types found"
          />
        </Field>
        <Field label="Reason" tooltip="The business reason for this entry, such as purchase, issue to site, damage, return, or manual correction.">
          <SearchableSelect
            value={draft.reason}
            onChange={(value) => update('reason', value)}
            options={reasonOptions.map((option) => ({ value: option.value, label: option.label }))}
            placeholder="Select reason"
            searchPlaceholder="Search reason…"
            emptyMessage="No reasons found"
          />
        </Field>
        <Field label="Quantity" tooltip="Enter the quantity to add, remove, or adjust in the item's stock unit.">
          <input className="input numeral" type="number" value={draft.quantity} onChange={(e) => update('quantity', e.target.value)} placeholder={draft.type === 'adjustment' ? 'e.g. -2 or 4' : 'e.g. 10'} />
        </Field>
        {hasUsageUnit && (
          <Field label="Qty unit" tooltip="Choose whether the entered quantity is in the stock unit or the usage unit. The system converts usage units back into stock automatically.">
            <SearchableSelect
              value={draft.quantity_unit}
              onChange={(value) => update('quantity_unit', value as MovementDraft['quantity_unit'])}
              options={[
                { value: 'stock', label: `Stock unit (${selectedItem?.unit})` },
                { value: 'usage', label: `Usage unit (${selectedItem?.usage_unit})` },
              ]}
              placeholder="Select quantity unit"
              searchPlaceholder="Search quantity unit…"
              emptyMessage="No quantity units found"
            />
          </Field>
        )}
        <Field label="Unit cost" tooltip="Optional rate per stock unit. This is especially useful for purchase entries and inventory value tracking.">
          <input className="input numeral" type="number" min="0" step="any" value={draft.unit_cost} onChange={(e) => update('unit_cost', e.target.value)} placeholder="e.g. 20000" />
        </Field>
        {(draft.type === 'in' || draft.type === 'adjustment') && (
          <Field label={sourceFieldMeta.label} tooltip={sourceFieldMeta.tooltip}>
            <input className="input" value={draft.supplier_bucket} onChange={(e) => update('supplier_bucket', e.target.value)} placeholder={sourceFieldMeta.placeholder} />
          </Field>
        )}
        <Field label={partyFieldMeta.label} tooltip={partyFieldMeta.tooltip}>
          <input className="input" value={draft.party} onChange={(e) => update('party', e.target.value)} placeholder={partyFieldMeta.placeholder} />
        </Field>
        {needsLotSelection && (
          <Field label="Stock lot" tooltip="Choose the exact stock lot to consume or adjust. Purchases create these lots automatically.">
            <SearchableSelect
              value={draft.lot_id}
              onChange={(value) => update('lot_id', value)}
              options={availableLots.map((lot) => ({
                value: lot.lot_id,
                label: `${lot.label} · ${lot.remaining_quantity} ${lot.item_unit} available`,
              }))}
              placeholder={selectedItem ? 'Select stock lot' : 'Pick an item first'}
              searchPlaceholder="Search stock lots…"
              emptyMessage="No stock lots found"
            />
          </Field>
        )}
        <Field label="Document no." tooltip={documentFieldMeta.tooltip}>
          <input className="input" value={draft.document_number} onChange={(e) => update('document_number', e.target.value)} placeholder={documentFieldMeta.placeholder} />
        </Field>
        <Field label="Reference" tooltip="An optional internal reference used to trace related records like log entries or system-generated transactions.">
          <input className="input" value={draft.reference} onChange={(e) => update('reference', e.target.value)} placeholder="Optional internal reference" />
        </Field>
        <div className="md:col-span-2 xl:col-span-4">
          {quantityPreview && (
            <div className="mb-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--bg-sunken)', color: 'var(--ink-3)' }}>
              {quantityPreview}
            </div>
          )}
          <Field label="Notes" tooltip="Explain why the stock changed, such as purchase, site issue, damage, return, or correction.">
            <textarea className="input min-h-[84px] resize-none" value={draft.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Why this stock changed" />
          </Field>
        </div>

        <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button onClick={onSave} disabled={!draft.item_id || !draft.quantity.trim() || saving || (needsLotSelection && !draft.lot_id)} className="btn btn-accent" style={saving ? { opacity: 1, cursor: 'wait' } : undefined}>
            {saving ? <span className="save-spinner" /> : <Check size={13} />}
            {saving ? 'Saving…' : 'Save movement'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  tooltip,
  children,
}: {
  label: string
  tooltip?: string
  children: React.ReactNode
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-4)' }}>
        <span>{label}</span>
        {tooltip && (
          <Tooltip content={tooltip} width={256} placement="bottom-start">
            <span className="inline-flex items-center">
              <Info size={12} aria-hidden="true" style={{ color: 'var(--ink-4)' }} />
            </span>
          </Tooltip>
        )}
      </span>
      {children}
    </label>
  )
}

function HoverTip({
  content,
  children,
}: {
  content: string
  children: React.ReactNode
}) {
  return (
    <Tooltip content={content} width={224} placement="top-center">
      <span className="inline-flex items-center">
        {children}
      </span>
    </Tooltip>
  )
}

function Tooltip({
  content,
  children,
  width = 220,
  placement = 'top-center',
}: {
  content: string
  children: React.ReactNode
  width?: number
  placement?: 'top-center' | 'bottom-start'
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({})

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return

      const viewportPadding = 12
      const gap = 8
      const tooltipWidth = width
      const leftBase = placement === 'bottom-start'
        ? rect.left
        : rect.left + rect.width / 2 - tooltipWidth / 2
      const left = Math.min(
        Math.max(viewportPadding, leftBase),
        Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding),
      )

      setTooltipStyle({
        position: 'fixed',
        top: placement === 'bottom-start' ? rect.bottom + gap : rect.top - gap,
        left,
        width: tooltipWidth,
        transform: placement === 'bottom-start' ? 'none' : 'translateY(-100%)',
        zIndex: 1200,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, placement, width])

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none rounded-lg px-2.5 py-2 text-[11px] normal-case tracking-normal shadow-lg"
          style={{ ...tooltipStyle, background: 'var(--ink)', color: 'white' }}
        >
          {content}
        </span>,
        document.body,
      )}
    </>
  )
}
