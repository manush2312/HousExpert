import type {
  FieldValue,
  InventoryLotAllocation,
  LogCostMode,
  PricingRateEntry,
  PricingRule,
  SchemaField,
} from '../services/logService'
import type { InventoryStockLot } from '../services/inventoryService'

export function computeLogTotalCost(
  costMode: LogCostMode,
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
  quantity: number | null,
  pricingRule?: PricingRule | null,
): number | null {
  if (costMode === 'direct_amount') {
    return findDirectAmountValue(schema, values) ?? findTotalCostValue(schema, values)
  }
  if (costMode === 'manual_total') {
    return findTotalCostValue(schema, values)
  }
  if (quantity == null) return null

  const unitCost = findResolvedUnitCost(schema, itemFields, values, pricingRule)
  if (unitCost == null) return null
  const sizeMultiplier = findResolvedSizeMultiplier(schema, itemFields, values)
  return unitCost * quantity * (sizeMultiplier ?? 1)
}

export function computeInventoryVendorSellTotal(
  quantity: number | null,
  usagePerQuantity: number | null | undefined,
  allocations: InventoryLotAllocation[],
  stockLots: InventoryStockLot[],
): number | null {
  if (quantity == null || quantity <= 0) return null
  if (allocations.length === 0) return null
  if (!usagePerQuantity || usagePerQuantity <= 0) return null

  const stockLotsById = new Map(stockLots.map((lot) => [lot.lot_id, lot]))
  let total = 0
  for (const allocation of allocations) {
    const lot = stockLotsById.get(allocation.inventory_lot_id)
    if (!lot || lot.default_sell_price == null || lot.default_sell_price <= 0) {
      return null
    }
    total += (allocation.allocated_quantity / usagePerQuantity) * lot.default_sell_price
  }
  return total
}

export function findResolvedUnitCost(
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
  pricingRule?: PricingRule | null,
): number | null {
  const directUnitCost = findUnitCostValue(schema, itemFields, values)
  if (directUnitCost != null) return directUnitCost
  return findPricingRuleRate(pricingRule, values, itemFields)
}

export function findUnitCostValue(
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
): number | null {
  const costField = schema.find((field) => isUnitCostFieldLabel(field.label))
  if (costField) {
    const unitCost = toNumericValue(values[costField.field_id])
    if (unitCost != null) return unitCost
  }

  const itemField = itemFields.find((field) => isUnitCostFieldLabel(field.label))
  return itemField ? toNumericValue(itemField.value) : null
}

export function findUnitCostLabel(
  schema: SchemaField[],
  itemFields: FieldValue[],
  pricingRule?: PricingRule | null,
  allFields?: SchemaField[],
): string | null {
  const directLabel = schema.find((field) => isUnitCostFieldLabel(field.label))?.label
    ?? itemFields.find((field) => isUnitCostFieldLabel(field.label))?.label
  if (directLabel) return directLabel
  if (!pricingRule || pricingRule.dimension_fields.length === 0) return null

  const fieldMap = new Map((allFields ?? schema).map((field) => [field.field_id, field.label]))
  const labels = pricingRule.dimension_fields
    .map((fieldID) => fieldMap.get(fieldID))
    .filter((label): label is string => Boolean(label))
  return labels.length > 0 ? `${labels.join(' + ')} rate` : pricingRule.name || 'pricing rule'
}

export function findResolvedSizeMultiplier(
  schema: SchemaField[],
  itemFields: FieldValue[],
  values: Record<string, unknown>,
): number | null {
  const entryField = schema.find((field) => isSizeFieldLabel(field.label))
  if (entryField) {
    const multiplier = toSizeMultiplier(values[entryField.field_id])
    if (multiplier != null) return multiplier
  }

  const itemField = itemFields.find((field) => isSizeFieldLabel(field.label))
  return itemField ? toSizeMultiplier(itemField.value) : null
}

export function findSizeFieldLabel(schema: SchemaField[], itemFields: FieldValue[]): string | null {
  return schema.find((field) => isSizeFieldLabel(field.label))?.label
    ?? itemFields.find((field) => isSizeFieldLabel(field.label))?.label
    ?? null
}

export function findPricingRuleRate(
  pricingRule: PricingRule | null | undefined,
  values: Record<string, unknown>,
  itemFields: FieldValue[],
): number | null {
  if (!pricingRule || pricingRule.dimension_fields.length === 0) return null

  const selectedKeys: Record<string, string> = {}
  for (const fieldID of pricingRule.dimension_fields) {
    const entryValue = normalizeStringValue(values[fieldID])
    const itemValue = normalizeStringValue(itemFields.find((field) => field.field_id === fieldID)?.value)
    const value = entryValue || itemValue
    if (!value) return null
    selectedKeys[fieldID] = value
  }

  const rate = pricingRule.rates.find((candidate) =>
    pricingRule.dimension_fields.every((fieldID) => candidate.keys[fieldID] === selectedKeys[fieldID]),
  )
  return rate ? rate.rate : null
}

export function buildPricingRateRows(
  fields: SchemaField[],
  selectedFieldIds: string[],
  existingRates: PricingRateEntry[],
): PricingRateEntry[] {
  if (selectedFieldIds.length === 0) return []

  const selectedFields = selectedFieldIds
    .map((fieldID) => fields.find((field) => field.field_id === fieldID))
    .filter((field): field is SchemaField => Boolean(field))

  if (selectedFields.length !== selectedFieldIds.length) return []
  if (selectedFields.some((field) => (field.options ?? []).length === 0)) return []

  const existingBySignature = new Map(existingRates.map((rate) => [serializePricingKeys(rate.keys, selectedFieldIds), rate.rate]))
  const combinations = buildCombinationKeys(selectedFields)

  return combinations.map((keys) => ({
    keys,
    rate: existingBySignature.get(serializePricingKeys(keys, selectedFieldIds)) ?? 0,
  }))
}

export function findDirectAmountValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const amountField = schema.find((field) => isDirectAmountFieldLabel(field.label))
  if (!amountField) return null
  return toNumericValue(values[amountField.field_id])
}

export function findTotalCostValue(schema: SchemaField[], values: Record<string, unknown>): number | null {
  const totalField = schema.find((field) => isTotalCostFieldLabel(field.label))
  if (!totalField) return null
  return toNumericValue(values[totalField.field_id])
}

export function findDirectAmountLabel(schema: SchemaField[]): string | null {
  return schema.find((field) => isDirectAmountFieldLabel(field.label))?.label ?? null
}

export function findTotalCostLabel(schema: SchemaField[]): string | null {
  return schema.find((field) => isTotalCostFieldLabel(field.label))?.label ?? null
}

export function isUnitCostFieldLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return (
    value === 'cost' ||
    value === 'amount' ||
    value === 'payment' ||
    value.includes('unit cost') ||
    value.includes('cost per unit') ||
    value.includes('rate') ||
    value.includes('price') ||
    value.includes('payment') ||
    value.includes('amount')
  )
}

export function isDirectAmountFieldLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value.includes('daily cost') || value.includes('daily payment') || value.includes('payment') || value.includes('amount paid') || value.includes('wage') || value.includes('charges')
}

export function isTotalCostFieldLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'total' || value === 'total cost' || value.includes('total cost')
}

export function isQuantityFieldLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value === 'quantity' || value === 'qty' || value.includes('quantity') || value.includes('qty')
}

export function isSizeFieldLabel(label: string): boolean {
  const value = label.toLowerCase().trim()
  return value.includes('size') || value.includes('dimension') || value.includes('measurement')
}

function buildCombinationKeys(fields: SchemaField[]): Array<Record<string, string>> {
  return fields.reduce<Array<Record<string, string>>>((acc, field) => {
    const options = field.options ?? []
    if (acc.length === 0) {
      return options.map((option) => ({ [field.field_id]: option }))
    }
    return acc.flatMap((row) => options.map((option) => ({ ...row, [field.field_id]: option })))
  }, [])
}

function serializePricingKeys(keys: Record<string, string>, orderedFieldIds: string[]): string {
  return orderedFieldIds.map((fieldID) => `${fieldID}=${keys[fieldID] ?? ''}`).join('|')
}

function normalizeStringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function toSizeMultiplier(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value !== 'string' || !value.trim()) return null

  const normalized = value
    .toLowerCase()
    .replace(/\bby\b/g, 'x')
    .replace(/[×*]/g, 'x')
  const parts = normalized.split('x').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null

  let product = 1
  let foundNumericPart = false
  for (const part of parts) {
    const match = part.match(/-?\d+(?:\.\d+)?/)
    if (!match) return null
    const parsed = Number(match[0])
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    product *= parsed
    foundNumericPart = true
  }

  return foundNumericPart ? product : null
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
